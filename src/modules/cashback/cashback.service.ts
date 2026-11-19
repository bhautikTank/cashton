import { prisma } from "@/src/lib/prisma";
import { Prisma, CashbackStatus } from "@/src/generated/prisma/client";
import { creditCashbackToWallet } from "@/src/modules/wallet/wallet.service";

export interface CreateCashbackInput {
  userId: string;
  amount: number | string | Prisma.Decimal;
  merchantId?: string;
  externalReferenceId?: string;
  description?: string;
}

const VALID_TRANSITIONS: Record<CashbackStatus, CashbackStatus[]> = {
  PENDING: ["APPROVED", "CONFIRMED", "REJECTED"],
  APPROVED: ["CONFIRMED", "REJECTED"],
  CONFIRMED: ["REVERSED"],
  REJECTED: ["PENDING"],
  REVERSED: [],
};

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
  reason?: string
) {
  const cashback = await prisma.cashback.findUnique({
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

  // If transitioning to CONFIRMED, atomically credit the user's wallet
  if (newStatus === "CONFIRMED") {
    return creditCashbackToWallet({
      userId: cashback.userId,
      cashbackId: cashback.id,
      amount: cashback.amount,
      description: `Cashback for ${cashback.description || "affiliate purchase"}`,
    });
  }

  // If reversing a CONFIRMED cashback, atomically reverse the wallet credit
  if (newStatus === "REVERSED" && cashback.status === "CONFIRMED") {
    return prisma.$transaction(async (tx) => {
      const existingTx = await tx.walletTransaction.findUnique({
        where: { cashbackId: cashback.id },
      });

      if (existingTx) {
        await tx.wallet.update({
          where: { userId: cashback.userId },
          data: { balance: { decrement: cashback.amount } },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: existingTx.walletId,
            amount: cashback.amount,
            type: "REVERSAL",
            category: "CASHBACK",
            description: `Reversal of cashback: ${cashback.description || cashback.id}`,
          },
        });
      }

      return tx.cashback.update({
        where: { id: cashbackId },
        data: {
          status: "REVERSED",
          ...(reason ? { rejectionReason: reason } : {}),
        },
      });
    });
  }

  return prisma.cashback.update({
    where: { id: cashbackId },
    data: {
      status: newStatus,
      ...(newStatus === "APPROVED" ? { approvedAt: new Date() } : {}),
      ...(reason ? { rejectionReason: reason } : {}),
    },
  });
}
