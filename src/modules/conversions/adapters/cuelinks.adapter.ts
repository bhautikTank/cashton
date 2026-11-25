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
 * Explicit mapping of Cuelinks 5 status values to CashTon ConversionStatus.
 * Reference: https://developers.cuelinks.com/docs/reference/webhooks
 *
 * BUSINESS RATIONALE:
 * - 'pending'   -> PENDING   : Transaction tracked by Cuelinks, within merchant return/cancellation window.
 * - 'validated' -> APPROVED  : Merchant validated sale, awaiting Cuelinks publisher funds clearance.
 * - 'payable'   -> APPROVED  : Cuelinks approved commission.
 *                              CAUTION: Do not map 'payable' to CONFIRMED prematurely unless CashTon
 *                              accepts the float credit risk before actual bank disbursement.
 * - 'paid'      -> CONFIRMED : Commission funds physically settled/paid by Cuelinks to CashTon.
 *                              Triggers atomic user wallet credit.
 * - 'rejected'  -> REJECTED  : Merchant or network rejected/cancelled order.
 */
export const CUELINKS_STATUS_MAP: Record<string, ConversionStatus> = {
  pending: "PENDING",
  validated: "APPROVED",
  payable: "APPROVED",
  paid: "CONFIRMED",
  rejected: "REJECTED",
} as const;

export class CuelinksAdapter implements AffiliateNetworkAdapter {
  readonly provider: AffiliateProvider = "CUELINKS";

  /**
   * Verifies incoming Cuelinks webhook using a static shared-secret query parameter
   * (e.g. ?secret=... or ?token=...) configured in the Cuelinks publisher dashboard.
   */
  verifyWebhook(
    _headers: WebhookHeaders,
    _rawBody: string,
    queryParams?: Record<string, string> | URLSearchParams
  ): VerificationResult {
    const expectedSecret =
      process.env.CUELINKS_POSTBACK_SECRET || process.env.CUELINKS_WEBHOOK_SECRET;

    if (!expectedSecret) {
      return {
        valid: false,
        error: "CUELINKS_POSTBACK_SECRET / CUELINKS_WEBHOOK_SECRET is not configured",
      };
    }

    const providedSecret =
      getQueryParam(queryParams, "secret") ||
      getQueryParam(queryParams, "token") ||
      getQueryParam(queryParams, "key");

    if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
      return {
        valid: false,
        error: "Invalid or missing Cuelinks postback secret query parameter",
      };
    }

    return { valid: true };
  }

  /**
   * Extracts click reference from Cuelinks real macro {aff_sub}.
   */
  extractClickId(
    payload: unknown,
    queryParams?: Record<string, string> | URLSearchParams
  ): string | null {
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      // Cuelinks documented macro: {aff_sub}
      if (typeof obj.aff_sub === "string") {
        const found = extractClickIdFromText(obj.aff_sub);
        if (found) return found;
      }
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
      for (const k of ["aff_sub", "subid", "sub_id", "clickId"]) {
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
    return CUELINKS_STATUS_MAP[s] || "PENDING";
  }

  /**
   * Parses incoming Cuelinks delivery:
   * Supports GET query params, POST form-urlencoded, or JSON bodies.
   * Real Cuelinks macros:
   * - {transaction_id} : unique dedup key
   * - {aff_sub}        : CashTon click reference
   * - {transaction_reference_id} : merchant order ID
   * - {sale_amount}    : order amount
   * - {user_commission}: commission earned
   * - {status}         : pending | validated | payable | rejected | paid
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

    // Determine externalTransactionId: Cuelinks macro {transaction_id}
    const externalTransactionId =
      (body.transaction_id as string) ||
      (body.id as string) ||
      getQueryParam(queryParams, "transaction_id") ||
      getQueryParam(queryParams, "id");

    if (!externalTransactionId) {
      throw new Error("Missing Cuelinks externalTransactionId ({transaction_id})");
    }

    const clickId = this.extractClickId(body, queryParams);

    // Amounts from real Cuelinks macros: {sale_amount}, {user_commission}
    const orderAmountRaw =
      body.sale_amount ??
      body.amount ??
      getQueryParam(queryParams, "sale_amount") ??
      getQueryParam(queryParams, "amount") ??
      "0";

    const commissionAmountRaw =
      body.user_commission ??
      body.commission ??
      body.admin_commission ??
      getQueryParam(queryParams, "user_commission") ??
      getQueryParam(queryParams, "commission") ??
      "0";

    const rawStatus =
      (body.status as string) ||
      getQueryParam(queryParams, "status");

    const status = this.mapStatus(rawStatus);

    return {
      provider: "CUELINKS",
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
      notes: (body.transaction_reference_id as string)
        ? `Merchant Order Ref: ${body.transaction_reference_id}`
        : getQueryParam(queryParams, "transaction_reference_id")
        ? `Merchant Order Ref: ${getQueryParam(queryParams, "transaction_reference_id")}`
        : undefined,
    };
  }
}
