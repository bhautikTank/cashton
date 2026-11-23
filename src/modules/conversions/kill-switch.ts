import type { AffiliateProvider } from "@/src/generated/prisma/client";

/**
 * Checks whether conversion ingestion is enabled for a specific affiliate provider.
 * Controlled by the environment variable `CONVERSION_INGESTION_ENABLED_PROVIDERS`.
 *
 * Expected format: comma-separated list of AffiliateProvider enum values.
 * Example: "CUELINKS,ADMITAD"
 *
 * SECURITY REQUIREMENT:
 * Defaults to disabled (empty/unset). If the environment variable is not defined,
 * is empty, or does not include the provider, returns false.
 */
export function isProviderIngestionEnabled(provider: AffiliateProvider | string): boolean {
  const envVal = process.env.CONVERSION_INGESTION_ENABLED_PROVIDERS;
  if (!envVal || typeof envVal !== "string" || envVal.trim().length === 0) {
    return false;
  }

  const enabledProviders = envVal
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);

  const target = String(provider).trim().toUpperCase();
  return enabledProviders.includes(target);
}
