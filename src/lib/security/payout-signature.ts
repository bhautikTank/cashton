import crypto from "crypto";

export interface WebhookVerificationResult {
  isValid: boolean;
  statusCode: number;
  message: string;
}

const SUPPORTED_EXTERNAL_PROVIDER_STUBS = new Set(["CASHFREE", "RAZORPAYX"]);
const MAX_TIMESTAMP_DRIFT_SECONDS = 300; // 5-minute replay window when x-webhook-timestamp is provided

/**
 * Validates webhook authenticity for payout provider callbacks.
 *
 * IMPORTANT:
 * This HMAC-SHA256 implementation is a CashTon-defined shared-secret mechanism
 * (hex HMAC-SHA256 digest over the raw request body via `x-webhook-signature`
 * using `PAYOUT_WEBHOOK_SECRET`, with optional `x-webhook-timestamp` freshness check).
 * It is NOT a verified Cashfree or RazorpayX vendor webhook implementation.
 * No real external payout provider is integrated yet; real provider integrations
 * must replace or extend this with vendor-specific signature and signed-timestamp protocols.
 *
 * - MANUAL provider: completely disabled from public webhooks (must use admin endpoints).
 * - Unrecognized providers: rejected with 400.
 * - External provider stubs: enforces CashTon shared-secret HMAC-SHA256 verification.
 * - Optional x-webhook-timestamp header: if supplied, validates freshness within +-300 seconds.
 * - If PAYOUT_WEBHOOK_SECRET is not configured, safely disables the endpoint (503).
 */
export function verifyPayoutWebhookSignature(
  provider: string,
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader?: string | null
): WebhookVerificationResult {
  const upperProvider = provider.toUpperCase();

  // Manual provider must NEVER expose an unauthenticated public callback
  if (upperProvider === "MANUAL") {
    return {
      isValid: false,
      statusCode: 403,
      message: "Manual payout provider does not accept public webhooks.",
    };
  }

  if (!SUPPORTED_EXTERNAL_PROVIDER_STUBS.has(upperProvider)) {
    return {
      isValid: false,
      statusCode: 400,
      message: "Unsupported payout webhook provider.",
    };
  }

  const webhookSecret = process.env.PAYOUT_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return {
      isValid: false,
      statusCode: 503,
      message: "Payout webhook callbacks are currently disabled.",
    };
  }

  if (timestampHeader !== undefined && timestampHeader !== null) {
    const trimmedTs = timestampHeader.trim();
    if (!/^\d{10,13}$/.test(trimmedTs)) {
      return {
        isValid: false,
        statusCode: 401,
        message: "Unauthorized webhook request.",
      };
    }
    const rawNum = Number(trimmedTs);
    const tsSeconds = trimmedTs.length >= 13 ? Math.floor(rawNum / 1000) : rawNum;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - tsSeconds) > MAX_TIMESTAMP_DRIFT_SECONDS) {
      return {
        isValid: false,
        statusCode: 401,
        message: "Webhook request timestamp expired.",
      };
    }
  }

  if (!signatureHeader) {
    return {
      isValid: false,
      statusCode: 401,
      message: "Unauthorized webhook request.",
    };
  }

  const cleanSignature = signatureHeader.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(cleanSignature)) {
    return {
      isValid: false,
      statusCode: 401,
      message: "Unauthorized webhook request.",
    };
  }

  try {
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const signatureBuffer = Buffer.from(cleanSignature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return {
        isValid: false,
        statusCode: 401,
        message: "Unauthorized webhook request.",
      };
    }

    return {
      isValid: true,
      statusCode: 200,
      message: "Webhook signature verified.",
    };
  } catch {
    return {
      isValid: false,
      statusCode: 401,
      message: "Unauthorized webhook request.",
    };
  }
}
