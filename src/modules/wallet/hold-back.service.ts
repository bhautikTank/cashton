import { prisma } from "@/src/lib/prisma";
import { Prisma } from "@/src/generated/prisma/client";

export interface HoldReleaseResult {
  processedCount: number;
  totalReleasedAmount: string;
  releasedCashbackIds: string[];
  skippedCount: number;
}

/**
 * Scheduled job to release matured cashback holds.
 * Finds all CONFIRMED cashbacks whose hold window has elapsed (heldUntil <= now),
 * and atomically moves heldAmount from Wallet.heldBalance to Wallet.availableBalance.
 *
 * Concurrency & Idempotency:
 * - Each cashback is processed in its own atomic transaction.
 * - Checks holdReleased == false and heldAmount > 0 under transaction.
 * - Idempotency key `hold-release:${cashback.id}` prevents duplicate ledger credits.
 */
export async function processEligibleHoldReleases(
  batchSize = 100
): Promise<HoldReleaseResult> {
  const now = new Date();

  const eligibleCashbacks = await prisma.cashback.findMany({
    where: {
      status: "CONFIRMED",
      holdReleased: false,
      heldUntil: { lte: now },
      heldAmount: { gt: 0 },
    },
    take: batchSize,
    orderBy: { heldUntil: "asc" },
  });

  let processedCount = 0;
  let skippedCount = 0;
  let totalReleased = new Prisma.Decimal("0.00");
  const releasedIds: string[] = [];

  for (const cb of eligibleCashbacks) {
    try {
      const releaseAmount = await prisma.$transaction(async (tx) => {
        // Acquire row lock to serialize concurrent cron workers processing the same cashback
        await tx.$queryRaw`SELECT id FROM "Cashback" WHERE id = ${cb.id} FOR UPDATE`;

        // Re-read under transaction to prevent concurrent double-release
        const current = await tx.cashback.findUnique({
          where: { id: cb.id },
          include: { user: { include: { wallet: true } } },
        });

        if (
          !current ||
          current.status !== "CONFIRMED" ||
          current.holdReleased ||
          current.heldAmount.lessThanOrEqualTo(0)
        ) {
          return null;
        }

        const wallet = current.user?.wallet;
        if (!wallet) {
          throw new Error(`Wallet not found for user ${current.userId}`);
        }

        const amountToRelease = current.heldAmount;

        // 1. Move funds from heldBalance to availableBalance
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            heldBalance: { decrement: amountToRelease },
            availableBalance: { increment: amountToRelease },
          },
        });

        // 2. Mark cashback hold as released
        await tx.cashback.update({
          where: { id: current.id },
          data: {
            holdReleased: true,
            heldAmount: new Prisma.Decimal("0.00"),
          },
        });

        // 3. Record immutable ledger transaction
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            cashbackId: current.id,
            amount: amountToRelease,
            type: "ADJUSTMENT",
            category: "HOLD_RELEASED",
            idempotencyKey: `hold-release:${current.id}`,
            description: `Hold released to available balance for cashback ${current.id}`,
          },
        });

        return amountToRelease;
      });

      if (releaseAmount) {
        processedCount++;
        totalReleased = totalReleased.plus(releaseAmount);
        releasedIds.push(cb.id);
      } else {
        skippedCount++;
      }
    } catch (err: unknown) {
      console.error(
        `[HoldReleaseService] Error processing hold release for cashback ${cb.id}:`,
        (err as Error).message
      );
      skippedCount++;
    }
  }

  return {
    processedCount,
    totalReleasedAmount: totalReleased.toFixed(2),
    releasedCashbackIds: releasedIds,
    skippedCount,
  };
}
