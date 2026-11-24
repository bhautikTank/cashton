import { AffiliateProvider } from "@/src/generated/prisma/client";
import type { AffiliateNetworkAdapter } from "./types";
import { CuelinksAdapter } from "./cuelinks.adapter";
import { AdmitadAdapter } from "./admitad.adapter";
import { GenericAdapter } from "./generic.adapter";

const cuelinksAdapter = new CuelinksAdapter();
const admitadAdapter = new AdmitadAdapter();
const genericAdapter = new GenericAdapter();

/**
 * Returns the webhook adapter for the requested provider.
 * Note: Flipkart does not support postback webhooks (pull-only via Reports API).
 * EarnKaro has no public developer postback program.
 */
export function getAdapter(provider: AffiliateProvider | string): AffiliateNetworkAdapter {
  const normalized = String(provider).toUpperCase().trim();
  switch (normalized) {
    case "CUELINKS":
      return cuelinksAdapter;
    case "ADMITAD":
      return admitadAdapter;
    case "GENERIC":
      return genericAdapter;
    case "FLIPKART":
      throw new Error(
        "Flipkart does not support postback webhooks. It is pull-only via the Flipkart Reports API (af_report_ref). Use the scheduled polling service."
      );
    case "EARNKARO":
      throw new Error(
        "EarnKaro has no confirmed public postback/webhook developer integration."
      );
    default:
      throw new Error(`Unsupported affiliate network provider: ${provider}`);
  }
}

export * from "./types";
export * from "./cuelinks.adapter";
export * from "./admitad.adapter";
export * from "./generic.adapter";
