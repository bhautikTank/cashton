/**
 * Normalizes and validates Indian mobile numbers.
 * Valid numbers are 10 digits starting with 6, 7, 8, or 9.
 * Handles optional prefixes: '+91', '91', '0' and separators (spaces, dashes).
 * Returns standardized E.164 format: '+91XXXXXXXXXX'.
 */
export function normalizeIndianMobile(raw: string): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  // Remove whitespace, hyphens, and parentheses
  const cleaned = raw.trim().replace(/[\s\-()]/g, "");

  let digits = "";
  if (cleaned.startsWith("+91")) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith("91") && cleaned.length === 12) {
    digits = cleaned.slice(2);
  } else if (cleaned.startsWith("0") && cleaned.length === 11) {
    digits = cleaned.slice(1);
  } else {
    digits = cleaned;
  }

  // Must be exactly 10 digits starting with 6, 7, 8, or 9
  if (/^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }

  return null;
}

export function isValidIndianMobile(raw: string): boolean {
  return normalizeIndianMobile(raw) !== null;
}
