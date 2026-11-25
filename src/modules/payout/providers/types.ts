import type { PayoutMethod } from "@/src/generated/prisma/client";

export interface PayoutDestination {
  payoutMethod: PayoutMethod;
  accountHolderName?: string | null;
  accountNumber?: string | null;
  ifscCode?: string | null;
  bankName?: string | null;
  upiId?: string | null;
}

export interface InitiatePayoutParams {
  payoutId: string;
  userId: string;
  amount: string;
  destination: PayoutDestination;
}

export interface InitiatePayoutResult {
  success: boolean;
  provider: string;
  providerReference: string;
  status: "PROCESSING" | "PAID" | "FAILED";
  failureReason?: string;
}

export interface PayoutProvider {
  name: string;
  initiatePayout(params: InitiatePayoutParams): Promise<InitiatePayoutResult>;
}
