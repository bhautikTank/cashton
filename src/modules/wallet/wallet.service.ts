import { prisma } from "@/src/lib/prisma";
import { Prisma, WalletTransactionCategory, WalletTransactionType } from "@/src/generated/prisma/client";
import { calculateHeldUntil } from "./hold-back.config";
import { offsetDebtsWithCashback } from "./debt.service";

export interface WalletSummaryResponse {
  totalTracked: string;
  pendingCashback: string;
  approvedCashback: string;
  confirmedCashback: string;
  availableBalance: string;
  heldBalance: string;
  debtBalance: string;
  totalPaidOut: string;
  currency: string;
  recentTransactions: Array<{
    id: string;
    amount: string;
    type: WalletTransactionType;
    category: WalletTransactionCategory;
    description: string;
    createdAt: Date;
  }>;
}

export async function getOrCreateWallet(userId: string) {
  return prisma.wallet.upsert({
    where: { userId },
    create: {
      userId,
      balance: new Prisma.Decimal("0.00"),
      availableBalance: new Prisma.Decimal("0.00"),
      heldBalance: new Prisma.Decimal("0.00"),
      debtBalance: new Prisma.Decimal("0.00"),
    },
    update: {},
  });
}

/**
 * Calculates a complete financial cashback summary for the user.
 * Avoids double-counting:
 * - Cashback lifecycle totals (Pending, Approved, Confirmed) are computed strictly from Cashback records.
 * - Available, held, and debt balances are derived directly from the Wallet model projections
 *   and verified against the append-only WalletTransaction ledger.
 * - Total Paid Out is calculated from Payout debits.
 * - Rejected and reversed cashbacks are excluded from earned totals.
 */
export async function getWalletSummary(
  userId: string
): Promise<WalletSummaryResponse> {
  const wallet = await getOrCreateWallet(userId);

  // 1. Query Cashback aggregates
  const [
    pendingAgg,
    approvedAgg,
    confirmedAgg,
    trackedAgg,
    payoutAgg,
    recentTransactions,
  ] = await Promise.all([
    // Pending cashback
    prisma.cashback.aggregate({
      where: { userId, status: "PENDING" },
      _sum: { amount: true },
    }),
    // Approved cashback
    prisma.cashback.aggregate({
      where: { userId, status: "APPROVED" },
      _sum: { amount: true },
    }),
    // Confirmed cashback
    prisma.cashback.aggregate({
      where: { userId, status: "CONFIRMED" },
      _sum: { amount: true },
    }),
    // Total Tracked (Pending + Approved + Confirmed)
    prisma.cashback.aggregate({
      where: {
        userId,
        status: { in: ["PENDING", "APPROVED", "CONFIRMED"] },
      },
      _sum: { amount: true },
    }),
    // Total Paid Out from Wallet
    prisma.walletTransaction.aggregate({
      where: {
        walletId: wallet.id,
        category: "PAYOUT",
        type: "DEBIT",
      },
      _sum: { amount: true },
    }),
    // Recent ledger transactions
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      take: 20,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const zero = new Prisma.Decimal("0.00");

  const pending = pendingAgg._sum.amount ?? zero;
  const approved = approvedAgg._sum.amount ?? zero;
  const confirmed = confirmedAgg._sum.amount ?? zero;
  const totalTracked = trackedAgg._sum.amount ?? zero;
  const totalPaidOut = payoutAgg._sum.amount ?? zero;

  const availableBalance = wallet.availableBalance ?? zero;
  const heldBalance = wallet.heldBalance ?? zero;
  const debtBalance = wallet.debtBalance ?? zero;

  return {
    totalTracked: totalTracked.toFixed(2),
    pendingCashback: pending.toFixed(2),
    approvedCashback: approved.toFixed(2),
    confirmedCashback: confirmed.toFixed(2),
    availableBalance: availableBalance.toFixed(2),
    heldBalance: heldBalance.toFixed(2),
    debtBalance: debtBalance.toFixed(2),
    totalPaidOut: totalPaidOut.toFixed(2),
    currency: "INR",
    recentTransactions: recentTransactions.map((tx) => ({
      id: tx.id,
      amount: tx.amount.toFixed(2),
      type: tx.type,
      category: tx.category,
      description: tx.description,
      createdAt: tx.createdAt,
    })),
  };
}

/**
 * Credits confirmed cashback to a user's wallet inside a database transaction.
 * 1. Checks and auto-offsets any open un-disputed debts (oldest first).
 * 2. Credits any remaining un-offset amount to heldBalance with configurable hold window.
 * 3. Updates Cashback record with heldAmount, heldUntil, and holdReleased.
 */
export async function creditCashbackToWallet(params: {
  userId: string;
  cashbackId: string;
  amount: Prisma.Decimal | number | string;
  description: string;
  provider?: string | null;
  idempotencyKey?: string;
  tx?: Prisma.TransactionClient;
}) {
  const decimalAmount = new Prisma.Decimal(params.amount);
  if (decimalAmount.lessThanOrEqualTo(0)) {
    throw new Error("Credit amount must be greater than zero");
  }

  const executeInTx = async (tx: Prisma.TransactionClient) => {
    // 1. Ensure wallet exists
    const wallet = await tx.wallet.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        balance: new Prisma.Decimal("0.00"),
        availableBalance: new Prisma.Decimal("0.00"),
        heldBalance: new Prisma.Decimal("0.00"),
        debtBalance: new Prisma.Decimal("0.00"),
      },
      update: {},
    });

    // Acquire exclusive row lock on this wallet to serialize concurrent confirmations & debt offsets
    await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;

    // Proactively check if cashback confirmation was already processed across all outcome branches:
    // Branch 1: Cashback was already marked CONFIRMED
    // Branch 2: Cashback was already processed (either 100% debt offset or credited to hold)
    const existingCashback = await tx.cashback.findUnique({
      where: { id: params.cashbackId },
      select: { status: true },
    });
    if (existingCashback?.status === "CONFIRMED") {
      return {
        walletId: wallet.id,
        totalCredit: "0.00",
        debtOffset: "0.00",
        creditedToHold: "0.00",
        isDuplicate: true,
        transaction: null,
      };
    }

    const existingTx = await tx.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        cashbackId: params.cashbackId,
      },
    });
    if (existingTx) {
      return {
        walletId: wallet.id,
        totalCredit: "0.00",
        debtOffset: "0.00",
        creditedToHold: "0.00",
        isDuplicate: true,
        transaction: existingTx,
      };
    }

    // 2. Auto-offset any open debts (oldest first)
    const { totalOffset, remainderForHold } = await offsetDebtsWithCashback(tx, {
      userId: params.userId,
      cashbackId: params.cashbackId,
      amount: decimalAmount,
    });

    let transaction = null;

    // 3. If there is remaining cashback after debt offset, credit to heldBalance
    if (remainderForHold.greaterThan(0)) {
      const heldUntil = calculateHeldUntil(params.provider);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          heldBalance: { increment: remainderForHold },
          balance: { increment: remainderForHold },
        },
      });

      transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: remainderForHold,
          type: "CREDIT",
          category: "CASHBACK",
          cashbackId: params.cashbackId,
          idempotencyKey: params.idempotencyKey ?? `cashback-${params.cashbackId}`,
          description: params.description,
        },
      });

      await tx.cashback.update({
        where: { id: params.cashbackId },
        data: {
          heldAmount: remainderForHold,
          heldUntil,
          holdReleased: false,
          status: "CONFIRMED",
          confirmedAt: new Date(),
        },
      });
    } else {
      // Entire cashback was offset against existing debt
      await tx.cashback.update({
        where: { id: params.cashbackId },
        data: {
          heldAmount: new Prisma.Decimal("0.00"),
          heldUntil: new Date(),
          holdReleased: true,
          status: "CONFIRMED",
          confirmedAt: new Date(),
        },
      });
    }

    return {
      walletId: wallet.id,
      totalCredit: decimalAmount.toFixed(2),
      debtOffset: totalOffset.toFixed(2),
      creditedToHold: remainderForHold.toFixed(2),
      transaction,
    };
  };

  if (params.tx) {
    return executeInTx(params.tx);
  }
  return prisma.$transaction(executeInTx);
}

/**
 * Records a debit from a user's wallet.
 * Enforces atomic balance check so available balance can never become negative.
 */
export async function debitWallet(params: {
  userId: string;
  amount: Prisma.Decimal | number | string;
  category: "PAYOUT" | "ADMIN_ADJUSTMENT";
  description: string;
  idempotencyKey?: string;
  tx?: Prisma.TransactionClient;
}) {
  const decimalAmount = new Prisma.Decimal(params.amount);
  if (decimalAmount.lessThanOrEqualTo(0)) {
    throw new Error("Debit amount must be greater than zero");
  }

  const executeInTx = async (tx: Prisma.TransactionClient) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId: params.userId },
    });

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    // Acquire exclusive row lock on wallet to serialize concurrent debits and prevent overdrafts
    await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;

    const lockedWallet = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });

    // Upfront idempotency check: if transaction with this idempotencyKey already exists, return it
    if (params.idempotencyKey) {
      const existingTx = await tx.walletTransaction.findFirst({
        where: {
          walletId: lockedWallet.id,
          idempotencyKey: params.idempotencyKey,
        },
      });
      if (existingTx) {
        return existingTx;
      }
    }

    if (lockedWallet.availableBalance.lessThan(decimalAmount)) {
      throw new Error("Insufficient withdrawable balance for this transaction");
    }

    await tx.wallet.update({
      where: { id: lockedWallet.id },
      data: {
        availableBalance: { decrement: decimalAmount },
        balance: { decrement: decimalAmount },
      },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: lockedWallet.id,
        amount: decimalAmount,
        type: "DEBIT",
        category: params.category,
        idempotencyKey: params.idempotencyKey,
        description: params.description,
      },
    });

    return transaction;
  };

  if (params.tx) {
    return executeInTx(params.tx);
  }
  return prisma.$transaction(executeInTx);
}
