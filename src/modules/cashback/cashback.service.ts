import { prisma } from "@/src/lib/prisma";
import { Prisma, CashbackStatus } from "@/src/generated/prisma/client";
import { creditCashbackToWallet } from "@/src/modules/wallet/wallet.service";
import { executeMultiStageReversal } from "@/src/modules/wallet/debt.service";

export interface CreateCashbackInput {
  userId: string;
  amount: number | string | Prisma.Decimal;
  merchantId?: string;
  externalReferenceId?: string;
  description?: string;
}

export const VALID_CASHBACK_TRANSITIONS: Record<CashbackStatus, CashbackStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["CONFIRMED", "REJECTED"],
  CONFIRMED: ["REVERSED"],
  REJECTED: [],
  REVERSED: [],
};

export const VALID_TRANSITIONS = VALID_CASHBACK_TRANSITIONS;

export async function createCashbackRecord(input: CreateCashbackInput) {
  const decimalAmount = new Prisma.Decimal(input.amount);
  if (decimalAmount.lessThanOrEqualTo(0)) {
    throw new Error("Cashback amount must be greater than zero");
  }

  return prisma.cashback.create({
    data: {
      userId: input.userId,
      amount: decimalAmount,
      merchantId: input.merchantId,
      externalReferenceId: input.externalReferenceId,
      description: input.description,
      status: "PENDING",
    },
  });
}

export async function getUserCashbacks(userId: string, limit = 20) {
  return prisma.cashback.findMany({
    where: { userId },
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
        },
      },
    },
  });
}

export async function updateCashbackStatus(
  cashbackId: string,
  newStatus: CashbackStatus,
  reason?: string,
  options?: {
    provider?: string | null;
    reversalAmount?: Prisma.Decimal | number | string;
    eventKey?: string;
    tx?: Prisma.TransactionClient;
  }
) {
  const db = options?.tx ?? prisma;
  const cashback = await db.cashback.findUnique({
    where: { id: cashbackId },
  });

  if (!cashback) {
    throw new Error("Cashback record not found");
  }

  // Idempotent no-op if status is unchanged
  if (cashback.status === newStatus) {
    return cashback;
  }

  // Enforce valid business lifecycle transitions
  const allowedNext = VALID_TRANSITIONS[cashback.status] || [];
  if (!allowedNext.includes(newStatus)) {
    throw new Error(
      `Invalid cashback status transition from ${cashback.status} to ${newStatus}`
    );
  }

  // If transitioning to CONFIRMED, atomically credit the user's wallet with hold-back and debt offset
  if (newStatus === "CONFIRMED") {
    return creditCashbackToWallet({
      userId: cashback.userId,
      cashbackId: cashback.id,
      amount: cashback.amount,
      description: `Cashback for ${cashback.description || "affiliate purchase"}`,
      provider: options?.provider,
      tx: options?.tx,
    });
  }

  // If reversing a CONFIRMED cashback, atomically execute multi-stage draw-down
  if (newStatus === "REVERSED" && cashback.status === "CONFIRMED") {
    const reversalAmount = options?.reversalAmount
      ? new Prisma.Decimal(options.reversalAmount)
      : cashback.amount.minus(cashback.reversedAmount);

    const eventKey = options?.eventKey || `reversal:${cashback.id}:${Date.now()}`;

    if (options?.tx) {
      await executeMultiStageReversal(options.tx, {
        cashbackId: cashback.id,
        amount: reversalAmount,
        eventKey,
        reason,
      });

      return options.tx.cashback.findUnique({
        where: { id: cashbackId },
      });
    }

    return prisma.$transaction(async (tx) => {
      await executeMultiStageReversal(tx, {
        cashbackId: cashback.id,
        amount: reversalAmount,
        eventKey,
        reason,
      });

      return tx.cashback.findUnique({
        where: { id: cashbackId },
      });
    });
  }

  return db.cashback.update({
    where: { id: cashbackId },
    data: {
      status: newStatus,
      ...(newStatus === "APPROVED" ? { approvedAt: new Date() } : {}),
      ...(reason ? { rejectionReason: reason } : {}),
    },
  });
}
