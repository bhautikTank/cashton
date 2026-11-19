import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/**
 * Derives a consistent 32-byte key for AES-256-GCM.
 * PAYOUT_ENCRYPTION_KEY is strictly mandatory in production and staging environments.
 * Outside production/staging (local development only), a fallback key is derived.
 */
export function getEncryptionKey(): Buffer {
  const secret = process.env.PAYOUT_ENCRYPTION_KEY;
  const isProductionOrStaging =
    process.env.NODE_ENV === "production" ||
    process.env.APP_ENV === "staging" ||
    process.env.APP_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";

  if (!secret) {
    if (isProductionOrStaging) {
      throw new Error(
        "PAYOUT_ENCRYPTION_KEY environment variable is mandatory in production and staging environments."
      );
    }
    const fallback = process.env.DATABASE_URL || "cashton-default-payout-secret-key-32";
    return crypto.createHash("sha256").update(fallback).digest();
  }

  // If 64 hex characters (32 bytes), parse directly
  if (secret.length === 64 && /^[0-9a-fA-F]+$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts sensitive text (e.g. bank account number) using AES-256-GCM.
 * Format: `${iv}:${authTag}:${encrypted}` (hex encoded)
 */
export function encryptSensitive(plaintext: string): string {
  if (!plaintext) return "";

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted text.
 */
export function decryptSensitive(ciphertext: string): string {
  if (!ciphertext) return "";

  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Masks a bank account number showing only the last 4 digits.
 * Example:
 * - full number "98765432101234" -> "••••••••••1234"
 * - last4 "1234" -> "••••••••1234"
 */
export function maskAccountNumber(accountNumberOrLast4: string | null | undefined): string | null {
  if (!accountNumberOrLast4) return null;
  const clean = accountNumberOrLast4.trim();
  const last4 = clean.slice(-4);
  const maskedLength = clean.length > 4 ? clean.length - 4 : 8;
  return `${"•".repeat(maskedLength)}${last4}`;
}

/**
 * Masks a UPI ID (e.g. "9876543210@paytm" -> "98••••••10@paytm")
 */
export function maskUpiId(upiId: string | null | undefined): string | null {
  if (!upiId) return null;
  const clean = upiId.trim();
  const parts = clean.split("@");
  if (parts.length !== 2) return clean;
  const [handle, provider] = parts;
  if (handle.length <= 4) {
    return `${handle[0]}•••@${provider}`;
  }
  const prefix = handle.slice(0, 2);
  const suffix = handle.slice(-2);
  const maskedLength = Math.max(handle.length - 4, 4);
  return `${prefix}${"•".repeat(maskedLength)}${suffix}@${provider}`;
}
