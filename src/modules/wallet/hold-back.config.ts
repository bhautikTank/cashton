/**
 * Hold-back configuration helper for CashTon.
 * 
 * Supports environment-driven lookup:
 * - HOLD_BACK_DAYS_<PROVIDER> (e.g. HOLD_BACK_DAYS_FLIPKART, HOLD_BACK_DAYS_GENERIC)
 * - HOLD_BACK_DAYS_DEFAULT (fallback default, e.g. 30 days)
 */

export function getHoldBackDays(provider?: string | null): number {
  if (provider) {
    const envKey = `HOLD_BACK_DAYS_${provider.toUpperCase().trim()}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined && envVal.trim() !== "") {
      const parsed = parseInt(envVal.trim(), 10);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }

  const defaultVal = process.env.HOLD_BACK_DAYS_DEFAULT;
  if (defaultVal !== undefined && defaultVal.trim() !== "") {
    const parsed = parseInt(defaultVal.trim(), 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  // Sensible production default: 30 days
  return 30;
}

export function calculateHeldUntil(
  provider?: string | null,
  baseDate = new Date()
): Date {
  const days = getHoldBackDays(provider);
  const target = new Date(baseDate.getTime());
  target.setUTCDate(target.getUTCDate() + days);
  return target;
}
