import { prisma } from "@/src/lib/prisma";
import { Prisma, CashbackDebtStatus } from "@/src/generated/prisma/client";
import type { ListDebtsQueryInput, ResolveDebtInput } from "@/src/lib/validations/debt.schema";

export interface DebtSummary {
  id: string;
  walletId: string;
  userId: string;
  amount: string;
  remainingAmount: string;
  status: CashbackDebtStatus;
  originatingCashbackId: string | null;
  originatingConversionId: string | null;
  reason: string | null;
  resolvedByAdminId: string | null;
  resolvedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * List debts with administrative filters and pagination.
 */
export async function listDebts(params: ListDebtsQueryInput) {
  const where: Prisma.CashbackDebtWhereInput = {};

  if (params.status) {
    where.status = params.status;
  }
  if (params.userId) {
    where.userId = params.userId;
  }
  if (params.walletId) {
    where.walletId = params.walletId;
  }

  const page = params.page || 1;
  const limit = params.limit || 50;
  const skip = (page - 1) * limit;

  const [total, debts] = await Promise.all([
    prisma.cashbackDebt.count({ where }),
    prisma.cashbackDebt.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        resolvedByAdmin: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return {
    debts: debts.map((d) => ({
      id: d.id,
      walletId: d.walletId,
      userId: d.userId,
      user: d.user,
      amount: d.amount.toFixed(2),
      remainingAmount: d.remainingAmount.toFixed(2),
      status: d.status,
      idempotencyKey: d.idempotencyKey,
      originatingCashbackId: d.originatingCashbackId,
      originatingConversionId: d.originatingConversionId,
      reason: d.reason,
      resolvedByAdmin: d.resolvedByAdmin,
      resolvedAt: d.resolvedAt,
      notes: d.notes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Retrieve a debt by ID with relations.
 */
export async function getDebtById(debtId: string) {
  const debt = await prisma.cashbackDebt.findUnique({
    where: { id: debtId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      resolvedByAdmin: { select: { id: true, name: true, email: true } },
      originatingCashback: true,
      originatingConversion: true,
    },
  });

  if (!debt) return null;

  return {
    id: debt.id,
    walletId: debt.walletId,
    userId: debt.userId,
    user: debt.user,
    amount: debt.amount.toFixed(2),
    remainingAmount: debt.remainingAmount.toFixed(2),
    status: debt.status,
    idempotencyKey: debt.idempotencyKey,
    originatingCashbackId: debt.originatingCashbackId,
    originatingConversionId: debt.originatingConversionId,
    reason: debt.reason,
    resolvedByAdmin: debt.resolvedByAdmin,
    resolvedAt: debt.resolvedAt,
    notes: debt.notes,
    createdAt: debt.createdAt,
    updatedAt: debt.updatedAt,
  };
}

/**
 * Marks an open debt as disputed by the user.
 * Freezes the debt so it is excluded from automatic recovery against future cashback.
 */
export async function disputeDebt(debtId: string, userId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const debt = await tx.cashbackDebt.findUnique({
      where: { id: debtId },
    });

    if (!debt) {
      throw new Error("Debt record not found");
    }
    if (debt.userId !== userId) {
      throw new Error("Unauthorized to dispute this debt record");
    }
    if (debt.status !== "OPEN") {
      throw new Error(`Cannot dispute debt in ${debt.status} status`);
    }

    const updated = await tx.cashbackDebt.update({
      where: { id: debtId },
      data: {
        status: "DISPUTED",
        reason,
        notes: debt.notes ? `${debt.notes} | Disputed by user: ${reason}` : `Disputed by user: ${reason}`,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      remainingAmount: updated.remainingAmount.toFixed(2),
      reason: updated.reason,
    };
  });
}

/**
 * Administratively resolves or writes off an outstanding debt.
 */
export async function resolveDebt(
  debtId: string,
  adminId: string,
  input: ResolveDebtInput
) {
  return prisma.$transaction(async (tx) => {
    const debt = await tx.cashbackDebt.findUnique({
      where: { id: debtId },
    });

    if (!debt) {
      throw new Error("Debt record not found");
    }

    if (input.action === "WRITE_OFF") {
      if (debt.status === "WRITTEN_OFF" || debt.status === "RECOVERED") {
        throw new Error(`Debt is already ${debt.status}`);
      }

      const writeOffAmount = debt.remainingAmount;
      if (writeOffAmount.lessThanOrEqualTo(0)) {
        throw new Error("Debt has no remaining balance to write off");
      }

      // Decrement wallet debt liability
      await tx.wallet.update({
        where: { id: debt.walletId },
        data: {
          debtBalance: { decrement: writeOffAmount },
        },
      });

      // Update debt record
      const updatedDebt = await tx.cashbackDebt.update({
        where: { id: debtId },
        data: {
          status: "WRITTEN_OFF",
          remainingAmount: new Prisma.Decimal("0.00"),
          resolvedByAdminId: adminId,
          resolvedAt: new Date(),
          notes: input.notes
            ? `${debt.notes ? debt.notes + " | " : ""}${input.notes}`
            : debt.notes,
        },
      });

      // Record immutable ledger entry for audit trail
      await tx.walletTransaction.create({
        data: {
          walletId: debt.walletId,
          debtId: debt.id,
          amount: writeOffAmount,
          type: "ADJUSTMENT",
          category: "DEBT_WRITTEN_OFF",
          idempotencyKey: `write-off:${debt.id}`,
          description: `Admin debt write-off: ${input.notes || "Approved by administrator"}`,
        },
      });

      return {
        id: updatedDebt.id,
        status: updatedDebt.status,
        remainingAmount: updatedDebt.remainingAmount.toFixed(2),
        writtenOffAmount: writeOffAmount.toFixed(2),
        resolvedByAdminId: adminId,
        resolvedAt: updatedDebt.resolvedAt,
      };
    } else if (input.action === "UNFREEZE") {
      if (debt.status !== "DISPUTED" && debt.status !== "UNDER_REVIEW") {
        throw new Error(`Only DISPUTED or UNDER_REVIEW debts can be unfrozen (current: ${debt.status})`);
      }

      const updatedDebt = await tx.cashbackDebt.update({
        where: { id: debtId },
        data: {
          status: "OPEN",
          resolvedByAdminId: adminId,
          resolvedAt: new Date(),
          notes: input.notes
            ? `${debt.notes ? debt.notes + " | " : ""}${input.notes}`
            : debt.notes,
        },
      });

      return {
        id: updatedDebt.id,
        status: updatedDebt.status,
        remainingAmount: updatedDebt.remainingAmount.toFixed(2),
        resolvedByAdminId: adminId,
        resolvedAt: updatedDebt.resolvedAt,
      };
    } else if (input.action === "RECOVER_MANUAL") {
      if (debt.status === "WRITTEN_OFF" || debt.status === "RECOVERED") {
        throw new Error(`Debt is already ${debt.status}`);
      }

      const recoverAmount = debt.remainingAmount;
      if (recoverAmount.lessThanOrEqualTo(0)) {
        throw new Error("Debt has no remaining balance to recover");
      }

      // Decrement wallet debt liability
      await tx.wallet.update({
        where: { id: debt.walletId },
        data: {
          debtBalance: { decrement: recoverAmount },
        },
      });

      const updatedDebt = await tx.cashbackDebt.update({
        where: { id: debtId },
        data: {
          status: "RECOVERED",
          remainingAmount: new Prisma.Decimal("0.00"),
          resolvedByAdminId: adminId,
          resolvedAt: new Date(),
          notes: input.notes
            ? `${debt.notes ? debt.notes + " | " : ""}${input.notes}`
            : debt.notes,
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: debt.walletId,
          debtId: debt.id,
          amount: recoverAmount,
          type: "CREDIT",
          category: "DEBT_RECOVERED",
          idempotencyKey: `manual-recovery:${debt.id}`,
          description: `Manual debt recovery: ${input.notes || "Settled by administrator"}`,
        },
      });

      return {
        id: updatedDebt.id,
        status: updatedDebt.status,
        remainingAmount: updatedDebt.remainingAmount.toFixed(2),
        recoveredAmount: recoverAmount.toFixed(2),
        resolvedByAdminId: adminId,
        resolvedAt: updatedDebt.resolvedAt,
      };
    }

    throw new Error(`Unsupported debt resolution action: ${input.action}`);
  });
}

/**
 * Automatically offsets active, un-disputed debts (oldest first) using incoming confirmed cashback.
 * Executed inside an interactive transaction before any remaining cashback enters hold-back.
 */
export async function offsetDebtsWithCashback(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    cashbackId: string;
    amount: Prisma.Decimal;
  }
): Promise<{
  totalOffset: Prisma.Decimal;
  remainderForHold: Prisma.Decimal;
}> {
  let remainingCashback = new Prisma.Decimal(params.amount);
  let totalOffset = new Prisma.Decimal("0.00");

  // Fetch only OPEN debts for user (DISPUTED and UNDER_REVIEW are strictly excluded)
  const openDebts = await tx.cashbackDebt.findMany({
    where: {
      userId: params.userId,
      status: "OPEN",
    },
    orderBy: { createdAt: "asc" },
  });

  for (const debt of openDebts) {
    if (remainingCashback.lessThanOrEqualTo(0)) break;

    const offsetAmount = Prisma.Decimal.min(remainingCashback, debt.remainingAmount);
    if (offsetAmount.lessThanOrEqualTo(0)) continue;

    const newDebtRemaining = debt.remainingAmount.minus(offsetAmount);
    const isFullyRecovered = newDebtRemaining.isZero();

    // 1. Update debt record
    await tx.cashbackDebt.update({
      where: { id: debt.id },
      data: {
        remainingAmount: newDebtRemaining,
        status: isFullyRecovered ? "RECOVERED" : "OPEN",
        resolvedAt: isFullyRecovered ? new Date() : null,
      },
    });

    // 2. Decrement wallet debt liability
    await tx.wallet.update({
      where: { id: debt.walletId },
      data: {
        debtBalance: { decrement: offsetAmount },
      },
    });

    // 3. Record DEBT_RECOVERED ledger entry
    await tx.walletTransaction.create({
      data: {
        walletId: debt.walletId,
        cashbackId: params.cashbackId,
        debtId: debt.id,
        amount: offsetAmount,
        type: "CREDIT",
        category: "DEBT_RECOVERED",
        idempotencyKey: `debt-offset:${debt.id}:${params.cashbackId}`,
        description: `Automatic recovery for debt ${debt.id} from confirmed cashback`,
      },
    });

    totalOffset = totalOffset.plus(offsetAmount);
    remainingCashback = remainingCashback.minus(offsetAmount);
  }

  return {
    totalOffset,
    remainderForHold: remainingCashback,
  };
}

/**
 * Multi-stage reversal draw-down algorithm.
 * Stage 1: Drain from Cashback.heldAmount and Wallet.heldBalance.
 * Stage 2: Drain from Wallet.availableBalance.
 * Stage 3: Create CashbackDebt for uncovered balance and increment Wallet.debtBalance.
 */
export async function executeMultiStageReversal(
  tx: Prisma.TransactionClient,
  params: {
    cashbackId: string;
    amount: Prisma.Decimal;
    eventKey: string;
    reason?: string;
  }
) {
  const cashback = await tx.cashback.findUnique({
    where: { id: params.cashbackId },
    include: { user: { include: { wallet: true } } },
  });

  if (!cashback) {
    throw new Error(`Cashback ${params.cashbackId} not found`);
  }
  const wallet = cashback.user?.wallet;
  if (!wallet) {
    throw new Error(`Wallet not found for user ${cashback.userId}`);
  }

  // Lock the wallet row to serialize concurrent reversals and prevent race conditions on balance draw-down
  await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;

  // Fetch fresh balances under the row lock
  const lockedWallet = await tx.wallet.findUniqueOrThrow({
    where: { id: wallet.id },
  });

  // Idempotency check: verify neither debt nor ledger entry exists for this eventKey across all stages
  const existingDebt = await tx.cashbackDebt.findUnique({
    where: { idempotencyKey: `debt:${params.eventKey}` },
  });
  const existingTx = await tx.walletTransaction.findFirst({
    where: {
      idempotencyKey: {
        in: [
          `tx:held:${params.eventKey}`,
          `tx:avail:${params.eventKey}`,
          `tx:debt:${params.eventKey}`,
        ],
      },
    },
  });
  if (existingDebt || existingTx) {
    return { isDuplicate: true, debtId: existingDebt?.id || null };
  }

  const delta = new Prisma.Decimal(params.amount);
  if (delta.lessThanOrEqualTo(0)) {
    return { isDuplicate: true, debtId: null };
  }

  // Validate invariant: reversedAmount + delta <= amount
  if (cashback.reversedAmount.plus(delta).greaterThan(cashback.amount)) {
    throw new Error(
      `Reversal amount ₹${delta.toFixed(2)} exceeds unreversed cashback amount (Unreversed: ₹${cashback.amount
        .minus(cashback.reversedAmount)
        .toFixed(2)})`
    );
  }

  let remaining = delta;

  // Stage 1: Drain from heldBalance & cashback.heldAmount
  const fromHeld = Prisma.Decimal.min(remaining, cashback.heldAmount, lockedWallet.heldBalance);
  if (fromHeld.greaterThan(0)) {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        heldBalance: { decrement: fromHeld },
        balance: { decrement: fromHeld },
      },
    });
    await tx.cashback.update({
      where: { id: cashback.id },
      data: { heldAmount: { decrement: fromHeld } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        cashbackId: cashback.id,
        amount: fromHeld,
        type: "REVERSAL",
        category: "REVERSAL_FROM_HELD",
        idempotencyKey: `tx:held:${params.eventKey}`,
        description: `Reversal from held balance: ${params.reason || cashback.id}`,
      },
    });
    remaining = remaining.minus(fromHeld);
  }

  // Stage 2: Drain from availableBalance
  const fromAvail = Prisma.Decimal.min(remaining, lockedWallet.availableBalance);
  if (fromAvail.greaterThan(0)) {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: { decrement: fromAvail },
        balance: { decrement: fromAvail },
      },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        cashbackId: cashback.id,
        amount: fromAvail,
        type: "REVERSAL",
        category: "REVERSAL_FROM_AVAILABLE",
        idempotencyKey: `tx:avail:${params.eventKey}`,
        description: `Reversal from available balance: ${params.reason || cashback.id}`,
      },
    });
    remaining = remaining.minus(fromAvail);
  }

  // Stage 3: Debt creation for uncovered shortfall
  let createdDebtId: string | null = null;
  if (remaining.greaterThan(0)) {
    const debt = await tx.cashbackDebt.create({
      data: {
        walletId: wallet.id,
        userId: wallet.userId,
        originatingCashbackId: cashback.id,
        amount: remaining,
        remainingAmount: remaining,
        status: "OPEN",
        idempotencyKey: `debt:${params.eventKey}`,
        reason: params.reason || `Shortfall from cashback reversal ${cashback.id}`,
      },
    });
    createdDebtId = debt.id;

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        debtBalance: { increment: remaining },
      },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        cashbackId: cashback.id,
        debtId: debt.id,
        amount: remaining,
        type: "DEBIT",
        category: "DEBT_CREATED",
        idempotencyKey: `tx:debt:${params.eventKey}`,
        description: `Debt created from unbacked cashback reversal: ${cashback.id}`,
      },
    });
  }

  // Update cumulative counters on cashback
  const newReversedTotal = cashback.reversedAmount.plus(delta);
  const isFullyReversed = newReversedTotal.greaterThanOrEqualTo(cashback.amount);

  await tx.cashback.update({
    where: { id: cashback.id },
    data: {
      reversedAmount: newReversedTotal,
      status: isFullyReversed ? "REVERSED" : cashback.status,
      ...(params.reason ? { rejectionReason: params.reason } : {}),
    },
  });

  return {
    isDuplicate: false,
    delta: delta.toFixed(2),
    fromHeld: fromHeld.toFixed(2),
    fromAvail: fromAvail.toFixed(2),
    debtCreated: remaining.toFixed(2),
    debtId: createdDebtId,
    newReversedTotal: newReversedTotal.toFixed(2),
    isFullyReversed,
  };
}
