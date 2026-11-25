import crypto from "crypto";
import type {
  AffiliateNetworkAdapter,
  NormalizedConversionPayload,
  VerificationResult,
  WebhookHeaders,
} from "./types";
import {
  extractClickIdFromText,
  normalizeHeaders,
  getQueryParam,
} from "./types";
import { AffiliateProvider, ConversionStatus } from "@/src/generated/prisma/client";

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export class GenericAdapter implements AffiliateNetworkAdapter {
  readonly provider: AffiliateProvider = "GENERIC";

  verifyWebhook(
    headers: WebhookHeaders,
    rawBody: string,
    queryParams?: Record<string, string> | URLSearchParams
  ): VerificationResult {
    const normalized = normalizeHeaders(headers);
    const expectedSecret = process.env.GENERIC_WEBHOOK_SECRET;

    const signature =
      normalized["x-generic-signature"] ||
      normalized["x-affiliate-signature"] ||
      getQueryParam(queryParams, "signature");

    const token =
      normalized["x-generic-token"] ||
      normalized["x-affiliate-token"] ||
      normalized["x-webhook-secret"] ||
      normalized["authorization"]?.replace(/^Bearer\s+/i, "") ||
      getQueryParam(queryParams, "token") ||
      getQueryParam(queryParams, "secret");

    if (!expectedSecret) {
      return { valid: false, error: "GENERIC_WEBHOOK_SECRET is not configured" };
    }

    if (signature) {
      const computedHmac = crypto
        .createHmac("sha256", expectedSecret)
        .update(rawBody || "")
        .digest("hex");
      if (safeEqual(signature, computedHmac)) {
        return { valid: true };
      }
    }

    if (token && safeEqual(token, expectedSecret)) {
      return { valid: true };
    }

    return { valid: false, error: "Invalid webhook signature or token" };
  }

  extractClickId(
    payload: unknown,
    queryParams?: Record<string, string> | URLSearchParams
  ): string | null {
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      for (const k of ["clickId", "subId", "subid", "subid1", "aff_sub", "extParam2"]) {
        if (typeof obj[k] === "string") {
          const found = extractClickIdFromText(obj[k] as string);
          if (found) return found;
        }
      }
    }

    if (queryParams) {
      for (const k of ["clickId", "subId", "subid", "subid1", "aff_sub"]) {
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

    if (s === "confirmed" || s === "paid" || s === "completed" || s === "success") {
      return "CONFIRMED";
    }

    if (s === "approved") {
      return "APPROVED";
    }

    if (s === "cancelled" || s === "rejected" || s === "declined") {
      return "REJECTED";
    }

    if (s === "reversed" || s === "refunded") {
      return "REVERSED";
    }

    return "PENDING";
  }

  parsePayload(
    rawBody: string | Record<string, unknown>,
    queryParams?: Record<string, string> | URLSearchParams
  ): NormalizedConversionPayload {
    let body: Record<string, unknown> = {};
    if (typeof rawBody === "string") {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = {};
      }
    } else if (typeof rawBody === "object" && rawBody !== null) {
      body = rawBody;
    }

    const externalTransactionId =
      (body.externalTransactionId as string) ||
      (body.transactionId as string) ||
      (body.orderId as string) ||
      (body.id as string) ||
      getQueryParam(queryParams, "externalTransactionId") ||
      getQueryParam(queryParams, "transactionId") ||
      getQueryParam(queryParams, "orderId");

    if (!externalTransactionId) {
      throw new Error("Missing externalTransactionId");
    }

    const clickId = this.extractClickId(body, queryParams);

    const orderAmountRaw =
      body.orderAmount ??
      body.amount ??
      getQueryParam(queryParams, "orderAmount") ??
      getQueryParam(queryParams, "amount") ??
      "0";

    const commissionAmountRaw =
      body.commissionAmount ??
      body.commission ??
      getQueryParam(queryParams, "commissionAmount") ??
      getQueryParam(queryParams, "commission") ??
      "0";

    const rawStatus = (body.status as string) || getQueryParam(queryParams, "status");
    const status = this.mapStatus(rawStatus);

    const convertedAtRaw =
      (body.convertedAt as string) ||
      (body.createdAt as string) ||
      getQueryParam(queryParams, "convertedAt");

    const convertedAt = convertedAtRaw ? new Date(convertedAtRaw) : new Date();

    return {
      provider: "GENERIC",
      externalTransactionId: String(externalTransactionId).trim(),
      clickId,
      orderAmount: String(orderAmountRaw),
      commissionAmount: String(commissionAmountRaw),
      currency: (body.currency as string) || getQueryParam(queryParams, "currency") || "INR",
      status,
      convertedAt: isNaN(convertedAt.getTime()) ? new Date() : convertedAt,
      rawPayload: body,
      notes: (body.notes as string) || undefined,
    };
  }
}
