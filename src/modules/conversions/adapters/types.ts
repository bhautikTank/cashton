import crypto from "crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { AffiliateProvider, ConversionStatus } from "@/src/generated/prisma/client";

export interface NormalizedConversionPayload {
  provider: AffiliateProvider;
  externalTransactionId: string;
  clickId?: string | null;
  orderAmount: Prisma.Decimal | number | string;
  commissionAmount: Prisma.Decimal | number | string;
  currency?: string;
  status: ConversionStatus;
  convertedAt?: Date;
  rawPayload?: unknown;
  notes?: string;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
}

export type WebhookHeaders = Record<string, string | string[] | undefined> | Headers;

export interface AffiliateNetworkAdapter {
  provider: AffiliateProvider;

  verifyWebhook(
    headers: WebhookHeaders,
    rawBody: string,
    queryParams?: Record<string, string> | URLSearchParams
  ): Promise<VerificationResult> | VerificationResult;

  parsePayload(
    rawBody: string | Record<string, unknown>,
    queryParams?: Record<string, string> | URLSearchParams
  ): Promise<NormalizedConversionPayload> | NormalizedConversionPayload;

  extractClickId(
    payload: unknown,
    queryParams?: Record<string, string> | URLSearchParams
  ): string | null;
}

/**
 * Timing-safe string comparison to prevent timing side-channel attacks on webhook secrets.
 */
export function safeEqual(a?: string | null, b?: string | null): boolean {
  if (!a || !b || typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extracts a CashTon clickId from any string or composite affiliate parameter.
 * Handles Flipkart and affiliate composite parameters (e.g. 543212_136_{tid}_source)
 * by accurately extracting the 48-hex CSPRNG token without consuming trailing delimiters.
 */
export function extractClickIdFromText(text?: string | null): string | null {
  if (!text || typeof text !== "string") return null;

  // Match standard CashTon 48-hex CSPRNG clickId (clk_[a-f0-9]{48})
  const hexMatch = text.match(/clk_[a-f0-9]{48}/i);
  if (hexMatch) return hexMatch[0];

  // Fallback to bounded alphanumeric token
  const match = text.match(/clk_[a-zA-Z0-9]{20,64}/);
  return match ? match[0] : null;
}

/**
 * Normalizes headers from Next.js Headers or raw dictionary to lowercase key-value map.
 */
export function normalizeHeaders(headers: WebhookHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((val, key) => {
      result[key.toLowerCase()] = val;
    });
  } else if (typeof headers === "object" && headers !== null) {
    for (const [key, val] of Object.entries(headers)) {
      if (typeof val === "string") {
        result[key.toLowerCase()] = val;
      } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
        result[key.toLowerCase()] = val[0];
      }
    }
  }
  return result;
}

/**
 * Helper to safely extract query param value regardless of URLSearchParams or plain object.
 */
export function getQueryParam(
  queryParams: Record<string, string> | URLSearchParams | undefined,
  key: string
): string | undefined {
  if (!queryParams) return undefined;
  if (queryParams instanceof URLSearchParams) {
    const val = queryParams.get(key);
    return val !== null ? val : undefined;
  }
  return queryParams[key];
}

/**
 * Helper to parse URL-encoded form data into a key-value record.
 */
export function parseFormEncoded(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!body || typeof body !== "string") return result;
  const params = new URLSearchParams(body);
  params.forEach((val, key) => {
    result[key] = val;
  });
  return result;
}
