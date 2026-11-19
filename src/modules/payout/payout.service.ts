import { prisma } from "@/src/lib/prisma";
import {
  encryptSensitive,
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
  upiId: string | null;
  upiIdMasked: string | null;
  status: "PENDING" | "VERIFIED" | "REJECTED";
  createdAt: Date;
  updatedAt: Date;
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
    upiId: details.upiId,
    upiIdMasked: details.upiId ? maskUpiId(details.upiId) : null,
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

  if (input.accountNumber) {
    encryptedAccountNumber = encryptSensitive(input.accountNumber);
    accountNumberLast4 = input.accountNumber.slice(-4);
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
      upiId: input.upiId ?? null,
      status: "PENDING",
    },
    update: {
      payoutMethod: input.payoutMethod,
      accountHolderName: input.accountHolderName ?? null,
      ...(encryptedAccountNumber ? { encryptedAccountNumber, accountNumberLast4 } : {}),
      ifscCode: input.ifscCode ?? null,
      bankName: input.bankName ?? null,
      upiId: input.upiId ?? null,
      status: "PENDING",
    },
  });

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
    upiId: updated.upiId,
    upiIdMasked: updated.upiId ? maskUpiId(updated.upiId) : null,
    status: updated.status,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}
