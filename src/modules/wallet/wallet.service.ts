import { prisma } from "@/src/lib/prisma";
import { Prisma } from "@/src/generated/prisma/client";

export interface WalletSummaryResponse {
  totalTracked: string;
  pendingCashback: string;
  approvedCashback: string;
  confirmedCashback: string;
  availableBalance: string;
  totalPaidOut: string;
  currency: string;
  recentTransactions: Array<{
    id: string;
    amount: string;
    type: "CREDIT" | "DEBIT" | "REVERSAL" | "ADJUSTMENT";
    category: "CASHBACK" | "PAYOUT" | "ADMIN_ADJUSTMENT" | "BONUS";
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
    },
    update: {},
  });
}

/**
 * Calculates a complete financial cashback summary for the user.
 * Avoids double-counting:
 * - Cashback lifecycle totals (Pending, Approved, Confirmed) are computed strictly from Cashback records.
 * - Available balance is calculated from the append-only WalletTransaction ledger (Credits - Debits).
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
    ledgerCreditsAgg,
    ledgerDebitsAgg,
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
    // Ledger total credits
    prisma.walletTransaction.aggregate({
      where: {
        walletId: wallet.id,
        type: { in: ["CREDIT", "ADJUSTMENT"] },
      },
      _sum: { amount: true },
    }),
    // Ledger total debits
    prisma.walletTransaction.aggregate({
      where: {
        walletId: wallet.id,
        type: { in: ["DEBIT", "REVERSAL"] },
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

  const totalCredits = ledgerCreditsAgg._sum.amount ?? zero;
  const totalDebits = ledgerDebitsAgg._sum.amount ?? zero;

  // Ledger is source of truth for available balance
  const ledgerAvailableBalance = totalCredits.sub(totalDebits);
  const availableBalance = ledgerAvailableBalance.greaterThan(zero)
    ? ledgerAvailableBalance
    : zero;

  return {
    totalTracked: totalTracked.toFixed(2),
    pendingCashback: pending.toFixed(2),
    approvedCashback: approved.toFixed(2),
    confirmedCashback: confirmed.toFixed(2),
    availableBalance: availableBalance.toFixed(2),
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
 * Ensures strict idempotency via unique cashbackId on WalletTransaction.
 */
export async function creditCashbackToWallet(params: {
  userId: string;
  cashbackId: string;
  amount: Prisma.Decimal | number | string;
  description: string;
  idempotencyKey?: string;
}) {
  const decimalAmount = new Prisma.Decimal(params.amount);
  if (decimalAmount.lessThanOrEqualTo(0)) {
    throw new Error("Credit amount must be greater than zero");
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        balance: decimalAmount,
      },
      update: {
        balance: { increment: decimalAmount },
      },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: decimalAmount,
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
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });

    return transaction;
  });
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
}) {
  const decimalAmount = new Prisma.Decimal(params.amount);
  if (decimalAmount.lessThanOrEqualTo(0)) {
    throw new Error("Debit amount must be greater than zero");
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId: params.userId },
    });

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    // Atomic decrement with condition to prevent race conditions and negative balances
    const updateResult = await tx.wallet.updateMany({
      where: {
        id: wallet.id,
        balance: { gte: decimalAmount },
      },
      data: {
        balance: { decrement: decimalAmount },
      },
    });

    if (updateResult.count === 0) {
      throw new Error("Insufficient wallet balance for this transaction");
    }

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: decimalAmount,
        type: "DEBIT",
        category: params.category,
        idempotencyKey: params.idempotencyKey,
        description: params.description,
      },
    });

    return transaction;
  });
}
