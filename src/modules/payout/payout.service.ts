import { prisma, INTERACTIVE_TX_OPTIONS } from "@/src/lib/prisma";
import { Prisma } from "@/src/generated/prisma/client";
import type { PayoutStatus } from "@/src/generated/prisma/client";
import {
  encryptSensitive,
  decryptSensitive,
  maskAccountNumber,
  maskUpiId,
} from "@/src/lib/security/encryption";
import type {
  PayoutDetailsInput,
  WithdrawalRequestInput,
  PayoutQueryInput,
  PayoutCallbackInput,
} from "@/src/lib/validations/payout.schema";
import {
  MIN_WITHDRAWAL_AMOUNT,
  MAX_WITHDRAWAL_AMOUNT,
} from "@/src/lib/validations/payout.schema";
import { debitWallet } from "@/src/modules/wallet/wallet.service";
import { manualPayoutProvider } from "./providers/manual.provider";

export class PayoutServiceError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = "PayoutServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Explicit state transition matrix for PayoutStatus.
 * Enforces lifecycle guarantees:
 * PENDING -> PROCESSING -> PAID
 * PENDING -> REJECTED
 * PROCESSING -> REJECTED
 * PROCESSING -> FAILED
 * Terminal states (PAID, FAILED, REJECTED) cannot transition again.
 */
export const VALID_PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  PENDING: ["PROCESSING", "REJECTED"],
  PROCESSING: ["PAID", "FAILED", "REJECTED"],
  PAID: [],
  FAILED: [],
  REJECTED: [],
};

export function validatePayoutTransition(current: PayoutStatus, next: PayoutStatus): void {
  const allowed = VALID_PAYOUT_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new PayoutServiceError(
      `Invalid payout status transition from ${current} to ${next}`,
      "INVALID_PAYOUT_STATUS_TRANSITION",
      400
    );
  }
}

export interface SanitizedPayoutDetails {
  id: string;
  payoutMethod: "BANK" | "UPI";
  accountHolderName: string | null;
  accountNumberMasked: string | null;
  accountNumberLast4: string | null;
  ifscCode: string | null;
  bankName: string | null;
  upiId: string | null; // Masked value for display
  upiIdMasked: string | null; // Masked representation
  status: "PENDING" | "VERIFIED" | "REJECTED";
  createdAt: Date;
  updatedAt: Date;
}

function decryptIfEncrypted(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length === 3) {
    try {
      return decryptSensitive(value);
    } catch {
      // Never leak raw ciphertext on decryption failure
      return null;
    }
  }
  return value;
}

export async function getPayoutDetails(
  userId: string
): Promise<SanitizedPayoutDetails | null> {
  const details = await prisma.payoutDetails.findUnique({
    where: { userId },
  });

  if (!details) {
    return null;
  }

  const decryptedUpi = decryptIfEncrypted(details.upiId);
  const maskedUpi = decryptedUpi ? maskUpiId(decryptedUpi) : null;

  return {
    id: details.id,
    payoutMethod: details.payoutMethod,
    accountHolderName: details.accountHolderName,
    accountNumberMasked: details.accountNumberLast4
      ? maskAccountNumber(details.accountNumberLast4)
      : null,
    accountNumberLast4: details.accountNumberLast4,
    ifscCode: details.ifscCode,
    bankName: details.bankName,
    upiId: maskedUpi,
    upiIdMasked: maskedUpi,
    status: details.status,
    createdAt: details.createdAt,
    updatedAt: details.updatedAt,
  };
}

export async function savePayoutDetails(
  userId: string,
  input: PayoutDetailsInput
): Promise<SanitizedPayoutDetails> {
  let encryptedAccountNumber: string | null = null;
  let accountNumberLast4: string | null = null;
  let encryptedUpiId: string | null = null;

  if (input.payoutMethod === "BANK" && input.accountNumber) {
    encryptedAccountNumber = encryptSensitive(input.accountNumber);
    accountNumberLast4 = input.accountNumber.slice(-4);
  }

  if (input.payoutMethod === "UPI" && input.upiId) {
    encryptedUpiId = encryptSensitive(input.upiId);
  }

  // Wrap in transaction: serialize against withdrawal creation via Wallet row lock and
  // block editing payout details while any withdrawal is actively PENDING or PROCESSING.
  const updated = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (wallet) {
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;
    }

    const activePayouts = await tx.payout.count({
      where: {
        userId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });
    if (activePayouts > 0) {
      throw new PayoutServiceError(
        "Cannot modify payout details while a withdrawal request is PENDING or PROCESSING",
        "ACTIVE_PAYOUT_BLOCKS_DETAILS_UPDATE",
        409
      );
    }

    const methodFields =
      input.payoutMethod === "BANK"
        ? {
            payoutMethod: "BANK" as const,
            accountHolderName: input.accountHolderName ?? null,
            encryptedAccountNumber,
            accountNumberLast4,
            ifscCode: input.ifscCode ?? null,
            bankName: input.bankName ?? null,
            upiId: null,
          }
        : {
            payoutMethod: "UPI" as const,
            accountHolderName: input.accountHolderName ?? null,
            encryptedAccountNumber: null,
            accountNumberLast4: null,
            ifscCode: null,
            bankName: null,
            upiId: encryptedUpiId,
          };

    // Verification status is always reset to PENDING when details are added or modified
    return tx.payoutDetails.upsert({
      where: { userId },
      create: {
        userId,
        ...methodFields,
        status: "PENDING",
      },
      update: {
        ...methodFields,
        status: "PENDING",
      },
    });
  }, INTERACTIVE_TX_OPTIONS);

  const decryptedUpi =
    updated.payoutMethod === "UPI"
      ? input.upiId || decryptIfEncrypted(updated.upiId)
      : null;
  const maskedUpi = decryptedUpi ? maskUpiId(decryptedUpi) : null;

  return {
    id: updated.id,
    payoutMethod: updated.payoutMethod,
    accountHolderName: updated.accountHolderName,
    accountNumberMasked: updated.accountNumberLast4
      ? maskAccountNumber(input.accountNumber || updated.accountNumberLast4)
      : null,
    accountNumberLast4: updated.accountNumberLast4,
    ifscCode: updated.ifscCode,
    bankName: updated.bankName,
    upiId: maskedUpi,
    upiIdMasked: maskedUpi,
    status: updated.status,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Creates a withdrawal request.
 * 1. Validates monetary format, precision (<= 2 decimal places), minimum (₹250.00) and maximum (₹1,000,000.00) thresholds.
 * 2. Enforces that user's PayoutDetails status must be exactly VERIFIED and payoutMethod matches if specified.
 * 3. Enforces that user has no outstanding debtBalance (> 0).
 * 4. Checks availableBalance under exclusive row lock (SELECT ... FOR UPDATE).
 * 5. Atomically debits availableBalance inside the same transaction that creates the Payout row (status PENDING).
 * 6. Enforces stable request-level idempotency and protects against cross-account key collisions & payload mismatches.
 * 7. Links the debit WalletTransaction to the Payout record.
 */
export async function createWithdrawalRequest(params: {
  userId: string;
  input: WithdrawalRequestInput;
}) {
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(params.input.amount);
  } catch {
    throw new PayoutServiceError("Invalid withdrawal amount", "INVALID_AMOUNT", 400);
  }

  if (!amount.isFinite() || amount.decimalPlaces() > 2) {
    throw new PayoutServiceError(
      "Withdrawal amount must be a finite number with at most 2 decimal places",
      "INVALID_AMOUNT_PRECISION",
      400
    );
  }

  if (amount.lessThan(MIN_WITHDRAWAL_AMOUNT)) {
    throw new PayoutServiceError(
      `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL_AMOUNT.toFixed(2)}`,
      "BELOW_MINIMUM_THRESHOLD",
      400
    );
  }
  if (amount.greaterThan(MAX_WITHDRAWAL_AMOUNT)) {
    throw new PayoutServiceError(
      `Maximum withdrawal amount is ₹${MAX_WITHDRAWAL_AMOUNT.toFixed(2)}`,
      "EXCEEDS_MAXIMUM_THRESHOLD",
      400
    );
  }

  // 1. Verify PayoutDetails status
  const payoutDetails = await prisma.payoutDetails.findUnique({
    where: { userId: params.userId },
  });

  if (!payoutDetails) {
    throw new PayoutServiceError(
      "No payout details configured. Please add payout details first.",
      "PAYOUT_DETAILS_MISSING",
      400
    );
  }

  if (payoutDetails.status !== "VERIFIED") {
    throw new PayoutServiceError(
      `Payout details must be VERIFIED before requesting a withdrawal (current status: ${payoutDetails.status})`,
      "PAYOUT_DETAILS_NOT_VERIFIED",
      400
    );
  }

  if (
    params.input.payoutMethod &&
    params.input.payoutMethod !== payoutDetails.payoutMethod
  ) {
    throw new PayoutServiceError(
      `Requested payout method (${params.input.payoutMethod}) does not match verified payout details (${payoutDetails.payoutMethod})`,
      "PAYOUT_METHOD_MISMATCH",
      400
    );
  }

  // 2. Upfront Idempotency Check with User Ownership & Payload Verification
  const existingPayout = await prisma.payout.findUnique({
    where: { idempotencyKey: params.input.idempotencyKey },
    include: { transactions: true },
  });
  if (existingPayout) {
    if (existingPayout.userId !== params.userId) {
      throw new PayoutServiceError(
        "Idempotency key already used by another account",
        "IDEMPOTENCY_KEY_COLLISION",
        409
      );
    }
    if (!existingPayout.amount.equals(amount)) {
      throw new PayoutServiceError(
        "Idempotency key already used with a different withdrawal amount",
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
        409
      );
    }
    return {
      payout: existingPayout,
      isDuplicate: true,
    };
  }

  // 2. Atomic Debit & Payout Creation in Transaction (re-reads PayoutDetails under lock to eliminate TOCTOU)
  try {
    return await prisma.$transaction(async (tx) => {
      // Acquire exclusive row lock on wallet
      const wallet = await tx.wallet.findUnique({
        where: { userId: params.userId },
      });
      if (!wallet) {
        throw new PayoutServiceError("User wallet not found", "WALLET_NOT_FOUND", 404);
      }
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;

      const lockedWallet = await tx.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });

      // Re-check idempotency under transaction lock
      const lockedExisting = await tx.payout.findUnique({
        where: { idempotencyKey: params.input.idempotencyKey },
        include: { transactions: true },
      });
      if (lockedExisting) {
        if (lockedExisting.userId !== params.userId) {
          throw new PayoutServiceError(
            "Idempotency key already used by another account",
            "IDEMPOTENCY_KEY_COLLISION",
            409
          );
        }
        if (!lockedExisting.amount.equals(amount)) {
          throw new PayoutServiceError(
            "Idempotency key already used with a different withdrawal amount",
            "IDEMPOTENCY_PAYLOAD_MISMATCH",
            409
          );
        }
        return {
          payout: lockedExisting,
          isDuplicate: true,
        };
      }

      // Re-verify PayoutDetails inside the transaction under Wallet lock (prevents TOCTOU with savePayoutDetails)
      const lockedPayoutDetails = await tx.payoutDetails.findUnique({
        where: { userId: params.userId },
      });
      if (!lockedPayoutDetails || lockedPayoutDetails.status !== "VERIFIED") {
        throw new PayoutServiceError(
          `Payout details must be VERIFIED before requesting a withdrawal (current status: ${lockedPayoutDetails?.status ?? "MISSING"})`,
          lockedPayoutDetails ? "PAYOUT_DETAILS_NOT_VERIFIED" : "PAYOUT_DETAILS_MISSING",
          400
        );
      }
      if (
        params.input.payoutMethod &&
        params.input.payoutMethod !== lockedPayoutDetails.payoutMethod
      ) {
        throw new PayoutServiceError(
          `Requested payout method (${params.input.payoutMethod}) does not match verified payout details (${lockedPayoutDetails.payoutMethod})`,
          "PAYOUT_METHOD_MISMATCH",
          400
        );
      }

      const decryptedUpi = decryptIfEncrypted(lockedPayoutDetails.upiId);
      const destinationMasked =
        lockedPayoutDetails.payoutMethod === "UPI"
          ? decryptedUpi
            ? maskUpiId(decryptedUpi) || "UPI"
            : "UPI"
          : `${lockedPayoutDetails.bankName || "Bank"} ****${lockedPayoutDetails.accountNumberLast4 || ""}`;

      // Guard: Block withdrawals when debtBalance > 0
      if (lockedWallet.debtBalance.greaterThan(0)) {
        throw new PayoutServiceError(
          `Cannot withdraw while an outstanding debt balance exists (₹${lockedWallet.debtBalance.toFixed(2)}). Outstanding debts must be settled first.`,
          "OUTSTANDING_DEBT_BLOCKS_WITHDRAWAL",
          400
        );
      }

      // Guard: Check available balance under lock
      if (lockedWallet.availableBalance.lessThan(amount)) {
        throw new PayoutServiceError(
          `Insufficient withdrawable balance (Available: ₹${lockedWallet.availableBalance.toFixed(2)}, Requested: ₹${amount.toFixed(2)})`,
          "INSUFFICIENT_BALANCE",
          400
        );
      }

      // Atomic debit via hardened debitWallet helper
      const debitTx = await debitWallet({
        userId: params.userId,
        amount,
        category: "PAYOUT",
        description: `Withdrawal request to ${destinationMasked}`,
        idempotencyKey: `tx:payout:${params.input.idempotencyKey}`,
        tx,
      });

      // Create Payout in PENDING status
      const payout = await tx.payout.create({
        data: {
          userId: params.userId,
          walletId: wallet.id,
          amount,
          status: "PENDING",
          payoutMethod: lockedPayoutDetails.payoutMethod,
          destinationMasked,
          provider: "MANUAL",
          idempotencyKey: params.input.idempotencyKey,
        },
      });

      // Link the debit WalletTransaction to this Payout
      await tx.walletTransaction.update({
        where: { id: debitTx.id },
        data: { payoutId: payout.id },
      });

      return {
        payout,
        isDuplicate: false,
      };
    }, INTERACTIVE_TX_OPTIONS);
  } catch (err: unknown) {
    // If concurrent race hits unique constraint on Payout.idempotencyKey, resolve safely
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const concurrentPayout = await prisma.payout.findUnique({
        where: { idempotencyKey: params.input.idempotencyKey },
        include: { transactions: true },
      });
      if (concurrentPayout) {
        if (concurrentPayout.userId !== params.userId) {
          throw new PayoutServiceError(
            "Idempotency key already used by another account",
            "IDEMPOTENCY_KEY_COLLISION",
            409
          );
        }
        if (!concurrentPayout.amount.equals(amount)) {
          throw new PayoutServiceError(
            "Idempotency key already used with a different withdrawal amount",
            "IDEMPOTENCY_PAYLOAD_MISMATCH",
            409
          );
        }
        return {
          payout: concurrentPayout,
          isDuplicate: true,
        };
      }
    }
    throw err;
  }
}

/**
 * Admin marks payout as approved -> transitions PENDING to PROCESSING.
 */
export async function approvePayout(payoutId: string, adminId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
    const payout = await tx.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) {
      throw new PayoutServiceError("Payout not found", "PAYOUT_NOT_FOUND", 404);
    }

    if (payout.userId === adminId) {
      throw new PayoutServiceError(
        "Administrators cannot approve their own payout requests",
        "SELF_ACTION_FORBIDDEN",
        403
      );
    }

    if (payout.provider.toUpperCase() !== "MANUAL") {
      throw new PayoutServiceError(
        `Payout is managed by external provider (${payout.provider})`,
        "PROVIDER_MANAGED_PAYOUT",
        400
      );
    }

    validatePayoutTransition(payout.status, "PROCESSING");

    // Re-verify PayoutDetails remains VERIFIED at approval time
    const details = await tx.payoutDetails.findUnique({
      where: { userId: payout.userId },
    });
    if (!details || details.status !== "VERIFIED") {
      throw new PayoutServiceError(
        "User payout details are no longer VERIFIED",
        "PAYOUT_DETAILS_NOT_VERIFIED",
        400
      );
    }

    const initResult = await manualPayoutProvider.initiatePayout({
      payoutId: payout.id,
      userId: payout.userId,
      amount: payout.amount.toFixed(2),
      destination: {
        payoutMethod: payout.payoutMethod,
      },
    });

    const updated = await tx.payout.update({
      where: { id: payoutId },
      data: {
        status: "PROCESSING",
        providerReference: initResult.providerReference,
        processedByAdminId: adminId,
        processedAt: new Date(),
      },
    });

    return updated;
  }, INTERACTIVE_TX_OPTIONS);
}

/**
 * Admin marks payout as successfully completed -> transitions PROCESSING to PAID.
 * Note: PENDING payouts cannot be completed directly; they must be approved into PROCESSING first.
 */
export async function completePayout(
  payoutId: string,
  adminId: string,
  providerReference: string
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
    const payout = await tx.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) {
      throw new PayoutServiceError("Payout not found", "PAYOUT_NOT_FOUND", 404);
    }

    if (payout.userId === adminId) {
      throw new PayoutServiceError(
        "Administrators cannot complete their own payout requests",
        "SELF_ACTION_FORBIDDEN",
        403
      );
    }

    if (payout.provider.toUpperCase() !== "MANUAL") {
      throw new PayoutServiceError(
        `Payout is managed by external provider (${payout.provider})`,
        "PROVIDER_MANAGED_PAYOUT",
        400
      );
    }

    validatePayoutTransition(payout.status, "PAID");

    const updated = await tx.payout.update({
      where: { id: payoutId },
      data: {
        status: "PAID",
        providerReference,
        processedByAdminId: adminId,
        processedAt: new Date(),
      },
    });

    return updated;
  }, INTERACTIVE_TX_OPTIONS);
}

/**
 * Admin rejects payout -> transitions to REJECTED and credits back availableBalance
 * via a compensating WalletTransaction (type CREDIT, category PAYOUT_REFUND).
 * Enforces:
 * - PENDING -> REJECTED or PROCESSING -> REJECTED
 * - Never refund twice (checks if refund ledger entry already exists)
 * - Serialized under Payout and Wallet row locks
 */
export async function rejectPayout(payoutId: string, adminId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
    const payout = await tx.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) {
      throw new PayoutServiceError("Payout not found", "PAYOUT_NOT_FOUND", 404);
    }

    if (payout.userId === adminId) {
      throw new PayoutServiceError(
        "Administrators cannot reject their own payout requests",
        "SELF_ACTION_FORBIDDEN",
        403
      );
    }

    validatePayoutTransition(payout.status, "REJECTED");

    // Guard: Prevent double-refund if callback or prior operation already refunded
    const existingRefund = await tx.walletTransaction.findFirst({
      where: {
        payoutId: payout.id,
        category: "PAYOUT_REFUND",
      },
    });
    if (existingRefund) {
      throw new PayoutServiceError(
        "Payout has already been refunded",
        "ALREADY_REFUNDED",
        400
      );
    }

    // Row lock wallet for refund
    await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${payout.walletId} FOR UPDATE`;

    // 1. Update payout status
    const updated = await tx.payout.update({
      where: { id: payoutId },
      data: {
        status: "REJECTED",
        failureReason: reason,
        processedByAdminId: adminId,
        processedAt: new Date(),
      },
    });

    // 2. Compensating refund transaction per Decision 1
    await tx.wallet.update({
      where: { id: payout.walletId },
      data: {
        availableBalance: { increment: payout.amount },
        balance: { increment: payout.amount },
      },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: payout.walletId,
        payoutId: payout.id,
        amount: payout.amount,
        type: "CREDIT",
        category: "PAYOUT_REFUND",
        idempotencyKey: `payout_refund:${payout.id}`,
        description: `Withdrawal rejected by administrator: ${reason}`,
      },
    });

    return updated;
  }, INTERACTIVE_TX_OPTIONS);
}

/**
 * Webhook/callback handler stub for future real external payout providers.
 * Enforces idempotency key: payout_callback:${payoutId}:${providerReferenceId}
 * before any status transition or balance mutation across all outcome branches.
 * Rejects MANUAL payouts and mismatched providers.
 * Guarantees that callback cannot double-refund an already rejected or refunded payout.
 */
export async function handlePayoutCallback(
  provider: string,
  payload: PayoutCallbackInput
) {
  const upperProvider = provider.toUpperCase();
  const eventKey = `payout_callback:${payload.payoutId}:${payload.providerReferenceId}`;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payload.payoutId} FOR UPDATE`;
    const payout = await tx.payout.findUnique({
      where: { id: payload.payoutId },
    });
    if (!payout) {
      throw new PayoutServiceError("Payout not found", "PAYOUT_NOT_FOUND", 404);
    }

    // Guard: Manual payouts must never be mutated via provider webhook callbacks
    if (payout.provider.toUpperCase() === "MANUAL") {
      throw new PayoutServiceError(
        "Manual payouts cannot be settled or modified via external webhook callbacks",
        "MANUAL_PROVIDER_WEBHOOK_FORBIDDEN",
        403
      );
    }

    // Guard: Callback provider must match the payout's assigned provider
    if (payout.provider.toUpperCase() !== upperProvider) {
      throw new PayoutServiceError(
        `Provider mismatch: callback arrived for ${upperProvider}, payout belongs to ${payout.provider}`,
        "PROVIDER_MISMATCH",
        400
      );
    }

    // Check explicit event idempotency key first before any transition or balance mutation
    const existingEventTx = await tx.walletTransaction.findUnique({
      where: { idempotencyKey: eventKey },
    });
    if (existingEventTx) {
      return { isDuplicate: true, status: payout.status };
    }

    if (payload.status === "SUCCESS") {
      if (payout.status === "PAID") {
        if (payout.providerReference === payload.providerReferenceId) {
          return { isDuplicate: true, status: payout.status };
        }
        throw new PayoutServiceError(
          "Payout already marked PAID with a different provider reference",
          "PAYOUT_ALREADY_PAID",
          409
        );
      }

      validatePayoutTransition(payout.status, "PAID");
      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: "PAID",
          providerReference: payload.providerReferenceId,
          processedAt: new Date(),
        },
      });
      return { isDuplicate: false, status: updated.status };
    }

    if (payload.status === "FAILED" || payload.status === "REVERSED") {
      if (payout.status === "FAILED" || payout.status === "REJECTED") {
        return { isDuplicate: true, status: payout.status };
      }

      // Guard: Check if compensating refund already exists for this payout
      const existingRefund = await tx.walletTransaction.findFirst({
        where: {
          payoutId: payout.id,
          category: "PAYOUT_REFUND",
        },
      });
      if (existingRefund) {
        return { isDuplicate: true, status: payout.status };
      }

      validatePayoutTransition(payout.status, "FAILED");

      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${payout.walletId} FOR UPDATE`;

      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: "FAILED",
          failureReason: payload.failureReason || `Provider callback reported ${payload.status}`,
          providerReference: payload.providerReferenceId,
          processedAt: new Date(),
        },
      });

      // Compensating refund per Decision 1
      await tx.wallet.update({
        where: { id: payout.walletId },
        data: {
          availableBalance: { increment: payout.amount },
          balance: { increment: payout.amount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: payout.walletId,
          payoutId: payout.id,
          amount: payout.amount,
          type: "CREDIT",
          category: "PAYOUT_REFUND",
          idempotencyKey: eventKey,
          description: `Payout failed (${upperProvider}): ${payload.failureReason || "Provider transaction declined"}`,
        },
      });

      return { isDuplicate: false, status: updated.status };
    }

    return { isDuplicate: false, status: payout.status };
  }, INTERACTIVE_TX_OPTIONS);
}

/**
 * List payouts with filters and pagination.
 * Only exposes admin user info when includeAdminDetails is explicitly true.
 */
export async function listPayouts(
  params: PayoutQueryInput & { includeAdminDetails?: boolean }
) {
  const where: Prisma.PayoutWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.userId) where.userId = params.userId;

  const page = params.page || 1;
  const limit = params.limit || 20;
  const skip = (page - 1) * limit;

  const [total, payouts] = await Promise.all([
    prisma.payout.count({ where }),
    prisma.payout.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: params.includeAdminDetails
        ? {
            user: { select: { id: true, name: true, email: true } },
            processedByAdmin: { select: { id: true, name: true, email: true } },
          }
        : undefined,
    }),
  ]);

  return {
    payouts: payouts.map((p) => ({
      id: p.id,
      userId: p.userId,
      ...(params.includeAdminDetails && "user" in p ? { user: p.user } : {}),
      amount: p.amount.toFixed(2),
      status: p.status,
      payoutMethod: p.payoutMethod,
      destinationMasked: p.destinationMasked,
      provider: p.provider,
      providerReference: p.providerReference,
      idempotencyKey: p.idempotencyKey,
      failureReason: p.failureReason,
      ...(params.includeAdminDetails && "processedByAdmin" in p
        ? { processedByAdmin: p.processedByAdmin }
        : {}),
      processedAt: p.processedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
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
 * Get payout by ID with strict fail-closed user isolation check.
 */
export async function getPayoutById(
  payoutId: string,
  requestingUserId?: string,
  isAdmin: boolean = false
) {
  const p = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: {
      ...(isAdmin
        ? {
            user: { select: { id: true, name: true, email: true } },
            processedByAdmin: { select: { id: true, name: true, email: true } },
          }
        : {}),
      transactions: true,
    },
  });

  if (!p) return null;

  // Fail-closed user isolation: non-admin callers must supply matching requestingUserId
  if (!isAdmin && (!requestingUserId || p.userId !== requestingUserId)) {
    throw new PayoutServiceError(
      "Unauthorized to view this payout record",
      "FORBIDDEN",
      403
    );
  }

  return {
    id: p.id,
    userId: p.userId,
    ...(isAdmin && "user" in p ? { user: p.user } : {}),
    amount: p.amount.toFixed(2),
    status: p.status,
    payoutMethod: p.payoutMethod,
    destinationMasked: p.destinationMasked,
    provider: p.provider,
    providerReference: p.providerReference,
    idempotencyKey: p.idempotencyKey,
    failureReason: p.failureReason,
    ...(isAdmin && "processedByAdmin" in p
      ? { processedByAdmin: p.processedByAdmin }
      : {}),
    processedAt: p.processedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    transactions: p.transactions,
  };
}
