import type { PayoutProvider, InitiatePayoutParams, InitiatePayoutResult } from "./types";

export class ManualPayoutProvider implements PayoutProvider {
  name = "MANUAL";

  async initiatePayout(params: InitiatePayoutParams): Promise<InitiatePayoutResult> {
    // For manual payouts, funds are queued for administrator settlement via bank transfer or UPI
    return {
      success: true,
      provider: this.name,
      providerReference: `MANUAL-${params.payoutId.slice(0, 8).toUpperCase()}`,
      status: "PROCESSING",
    };
  }
}

export const manualPayoutProvider = new ManualPayoutProvider();
