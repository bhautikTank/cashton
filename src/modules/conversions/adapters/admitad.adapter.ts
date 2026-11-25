import type {
  AffiliateNetworkAdapter,
  NormalizedConversionPayload,
  VerificationResult,
  WebhookHeaders,
} from "./types";
import {
  extractClickIdFromText,
  getQueryParam,
  parseFormEncoded,
  safeEqual,
} from "./types";
import { AffiliateProvider, ConversionStatus } from "@/src/generated/prisma/client";

/**
 * Explicit mapping of Admitad status values to CashTon ConversionStatus.
 * Reference: https://developers.admitad.com/knowledge-base/article/postback-urls_1
 *
 * - 'pending'  -> PENDING  : Action registered by network, undergoing advertiser verification.
 * - 'approved' -> CONFIRMED: Action approved by advertiser, payment sum earned.
 * - 'declined' -> REJECTED : Action declined by advertiser.
 */
export const ADMITAD_STATUS_MAP: Record<string, ConversionStatus> = {
  pending: "PENDING",
  approved: "CONFIRMED",
  declined: "REJECTED",
} as const;

export class AdmitadAdapter implements AffiliateNetworkAdapter {
  readonly provider: AffiliateProvider = "ADMITAD";

  /**
   * SECURITY & INCOMING-CALL VERIFICATION:
   * NOTE (Still needs confirmation with Admitad account manager):
   * Admitad documentation does not define a native cryptographic header/HMAC scheme for incoming publisher postbacks.
   * Following the safe industry pattern, we verify a static shared-secret query parameter (`secret` or `token`)
   * baked into the postback URL configured in the Admitad publisher dashboard, compared via timing-safe equal
   * against ADMITAD_POSTBACK_SECRET.
   *
   * By instruction, Admitad is permanently KEPT OUT of CONVERSION_INGESTION_ENABLED_PROVIDERS
   * until incoming delivery format and auth are confirmed with Admitad support.
   */
  verifyWebhook(
    _headers: WebhookHeaders,
    _rawBody: string,
    queryParams?: Record<string, string> | URLSearchParams
  ): VerificationResult {
    const expectedSecret =
      process.env.ADMITAD_POSTBACK_SECRET || process.env.ADMITAD_WEBHOOK_SECRET;

    if (!expectedSecret) {
      return {
        valid: false,
        error: "ADMITAD_POSTBACK_SECRET / ADMITAD_WEBHOOK_SECRET is not configured",
      };
    }

    const providedSecret =
      getQueryParam(queryParams, "secret") ||
      getQueryParam(queryParams, "token") ||
      getQueryParam(queryParams, "key");

    if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
      return {
        valid: false,
        error: "Invalid or missing Admitad postback secret query parameter",
      };
    }

    return { valid: true };
  }

  /**
   * Extracts click reference from Admitad documented macro [[[subid]]].
   */
  extractClickId(
    payload: unknown,
    queryParams?: Record<string, string> | URLSearchParams
  ): string | null {
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      // Admitad macro: [[[subid]]]
      if (typeof obj.subid === "string") {
        const found = extractClickIdFromText(obj.subid);
        if (found) return found;
      }
      if (typeof obj.clickId === "string") {
        const found = extractClickIdFromText(obj.clickId);
        if (found) return found;
      }
    }

    if (queryParams) {
      for (const k of ["subid", "subid1", "clickId"]) {
        const val = getQueryParam(queryParams, k);
        if (val) {
          const found = extractClickIdFromText(val);
          if (found) return found;
        }
      }
    }

    return null;
  }

  mapStatus(rawStatus?: string): ConversionStatus {
    if (!rawStatus) return "PENDING";
    const s = rawStatus.toLowerCase().trim();
    return ADMITAD_STATUS_MAP[s] || "PENDING";
  }

  /**
   * Parses Admitad documented macros:
   * - [[[subid]]]       : CashTon click reference
   * - [[[order_id]]]    : order ID
   * - [[[order_sum]]]   : order sales volume
   * - [[[payment_sum]]] : publisher earnings/commission
   * - [[[action_id]]]   : unique action identifier
   * - [[[status]]]      : action status (pending | approved | declined)
   */
  parsePayload(
    rawBody: string | Record<string, unknown>,
    queryParams?: Record<string, string> | URLSearchParams
  ): NormalizedConversionPayload {
    let body: Record<string, unknown> = {};

    if (typeof rawBody === "string") {
      const trimmed = rawBody.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          body = JSON.parse(trimmed);
        } catch {
          body = parseFormEncoded(trimmed);
        }
      } else if (trimmed.length > 0) {
        body = parseFormEncoded(trimmed);
      }
    } else if (typeof rawBody === "object" && rawBody !== null) {
      body = rawBody;
    }

    // externalTransactionId: action_id or order_id
    const externalTransactionId =
      (body.action_id as string) ||
      (body.order_id as string) ||
      (body.id as string) ||
      getQueryParam(queryParams, "action_id") ||
      getQueryParam(queryParams, "order_id") ||
      getQueryParam(queryParams, "id");

    if (!externalTransactionId) {
      throw new Error("Missing Admitad externalTransactionId (action_id / order_id)");
    }

    const clickId = this.extractClickId(body, queryParams);

    // Real Admitad macros: [[[order_sum]]], [[[payment_sum]]]
    const orderAmountRaw =
      body.order_sum ??
      body.order_amount ??
      body.payment ??
      getQueryParam(queryParams, "order_sum") ??
      getQueryParam(queryParams, "order_amount") ??
      "0";

    const commissionAmountRaw =
      body.payment_sum ??
      body.commission ??
      getQueryParam(queryParams, "payment_sum") ??
      getQueryParam(queryParams, "commission") ??
      "0";

    const rawStatus =
      (body.status as string) ||
      (body.action_status as string) ||
      getQueryParam(queryParams, "status");

    const status = this.mapStatus(rawStatus);

    return {
      provider: "ADMITAD",
      externalTransactionId: String(externalTransactionId).trim(),
      clickId,
      orderAmount: String(orderAmountRaw),
      commissionAmount: String(commissionAmountRaw),
      currency: (body.currency as string) || getQueryParam(queryParams, "currency") || "INR",
      status,
      convertedAt: new Date(),
      rawPayload:
        Object.keys(body).length > 0
          ? body
          : queryParams instanceof URLSearchParams
          ? Object.fromEntries(queryParams.entries())
          : (queryParams as Record<string, unknown>) || {},
      notes: (body.order_id as string)
        ? `Order ID: ${body.order_id}`
        : getQueryParam(queryParams, "order_id")
        ? `Order ID: ${getQueryParam(queryParams, "order_id")}`
        : undefined,
    };
  }
}
