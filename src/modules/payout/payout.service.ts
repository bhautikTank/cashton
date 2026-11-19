import { prisma } from "@/src/lib/prisma";
import {
  encryptSensitive,
  decryptSensitive,
  maskAccountNumber,
  maskUpiId,
} from "@/src/lib/security/encryption";
import type { PayoutDetailsInput } from "@/src/lib/validations/payout.schema";

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
      return value;
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

  if (input.accountNumber) {
    encryptedAccountNumber = encryptSensitive(input.accountNumber);
    accountNumberLast4 = input.accountNumber.slice(-4);
  }

  if (input.upiId) {
    encryptedUpiId = encryptSensitive(input.upiId);
  }

  // Verification status is always reset to PENDING when details are added or modified
  const updated = await prisma.payoutDetails.upsert({
    where: { userId },
    create: {
      userId,
      payoutMethod: input.payoutMethod,
      accountHolderName: input.accountHolderName ?? null,
      encryptedAccountNumber,
      accountNumberLast4,
      ifscCode: input.ifscCode ?? null,
      bankName: input.bankName ?? null,
      upiId: encryptedUpiId,
      status: "PENDING",
    },
    update: {
      payoutMethod: input.payoutMethod,
      accountHolderName: input.accountHolderName ?? null,
      ...(encryptedAccountNumber ? { encryptedAccountNumber, accountNumberLast4 } : {}),
      ifscCode: input.ifscCode ?? null,
      bankName: input.bankName ?? null,
      ...(encryptedUpiId ? { upiId: encryptedUpiId } : {}),
      status: "PENDING",
    },
  });

  const decryptedUpi = input.upiId || decryptIfEncrypted(updated.upiId);
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
