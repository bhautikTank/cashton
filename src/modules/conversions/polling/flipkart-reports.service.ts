import { extractClickIdFromText, NormalizedConversionPayload } from "../adapters/types";
import { ingestNormalizedConversion, IngestConversionResult } from "../conversion.service";
import { ConversionStatus } from "@/src/generated/prisma/client";

export interface FlipkartOrderRecord {
  affiliateOrderItemId?: string;
  orderId?: string;
  affExtParam1?: string;
  affExtParam2?: string;
  sales?: {
    amount?: number | string;
    currency?: string;
  } | number | string;
  tentativeCommission?: {
    amount?: number | string;
    currency?: string;
  } | number | string;
  commissionRate?: number;
  status?: string;
  orderDate?: string;
}

export interface FlipkartPollingOptions {
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  status?: string;    // tentative | approved | cancelled | all
  mockResponse?: { orderList?: FlipkartOrderRecord[]; orders?: FlipkartOrderRecord[] };
}

export interface FlipkartPollingResult {
  enabled: boolean;
  polledCount: number;
  results: IngestConversionResult[];
  errors: string[];
  skippedReason?: string;
}

/**
 * Maps Flipkart status string to CashTon ConversionStatus.
 */
export function mapFlipkartStatus(rawStatus?: string): ConversionStatus {
  if (!rawStatus) return "PENDING";
  const s = rawStatus.toLowerCase().trim();

  if (s === "completed" || s === "settled" || s === "confirmed") {
    return "CONFIRMED";
  }
  if (s === "approved" || s === "dispatched" || s === "delivered") {
    return "APPROVED";
  }
  if (s === "cancelled" || s === "rejected" || s === "failed") {
    return "REJECTED";
  }
  if (s === "returned" || s === "reversed" || s === "refunded") {
    return "REVERSED";
  }
  return "PENDING";
}

/**
 * Scheduled polling job for Flipkart Affiliate Reports API (af_report_ref).
 * 
 * Flipkart has NO webhook/postback mechanism. All conversion ingestion happens
 * via scheduled polling of the Reports API by date range.
 * 
 * Disabled by default behind FLIPKART_POLLING_ENABLED="false" until verified credentials are provided.
 */
export async function pollFlipkartOrders(
  options: FlipkartPollingOptions = {}
): Promise<FlipkartPollingResult> {
  const isEnabled = process.env.FLIPKART_POLLING_ENABLED === "true";
  const affiliateId = process.env.FK_AFFILIATE_ID;
  const affiliateToken = process.env.FK_AFFILIATE_TOKEN;
  const apiBaseUrl = process.env.FLIPKART_API_BASE_URL || "https://affiliate-api.flipkart.net";

  // Safety gate: skip execution if not enabled or credentials are missing (unless mockResponse provided for testing)
  if (!options.mockResponse) {
    if (!isEnabled) {
      console.warn(
        "[Flipkart Reports Poll] Polling is disabled by default (FLIPKART_POLLING_ENABLED is not 'true'). Skipping run."
      );
      return {
        enabled: false,
        polledCount: 0,
        results: [],
        errors: [],
        skippedReason: "FLIPKART_POLLING_ENABLED is not true",
      };
    }

    if (!affiliateId || !affiliateToken) {
      console.error(
        "[Flipkart Reports Poll] Missing FK_AFFILIATE_ID or FK_AFFILIATE_TOKEN credentials. Skipping run."
      );
      return {
        enabled: true,
        polledCount: 0,
        results: [],
        errors: ["Missing FK_AFFILIATE_ID or FK_AFFILIATE_TOKEN"],
        skippedReason: "Missing credentials",
      };
    }
  }

  let orderRecords: FlipkartOrderRecord[] = [];

  if (options.mockResponse) {
    orderRecords = options.mockResponse.orderList || options.mockResponse.orders || [];
  } else {
    // Determine date range: default to past 24 hours
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const startDate = options.startDate || yesterday.toISOString().split("T")[0];
    const endDate = options.endDate || today.toISOString().split("T")[0];
    const statusParam = options.status || "all";

    const url = `${apiBaseUrl}/affiliate/report/orders/detail/json?startDate=${startDate}&endDate=${endDate}&status=${statusParam}`;

    try {
      const response = await fetch(url, {
        headers: {
          "Fk-Affiliate-Id": affiliateId!,
          "Fk-Affiliate-Token": affiliateToken!,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Flipkart Reports API HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      orderRecords = data.orderList || data.orders || [];
    } catch (err: unknown) {
      const errorMsg = (err as Error).message;
      console.error(`[Flipkart Reports Poll] API Request Error: ${errorMsg}`);
      return {
        enabled: true,
        polledCount: 0,
        results: [],
        errors: [errorMsg],
      };
    }
  }

  const results: IngestConversionResult[] = [];
  const errors: string[] = [];

  for (const item of orderRecords) {
    try {
      // Documented fields from https://affiliate.flipkart.com/api-docs/af_report_ref.html
      const externalTransactionId = item.affiliateOrderItemId || item.orderId;
      if (!externalTransactionId) {
        errors.push("Missing affiliateOrderItemId in order record");
        continue;
      }

      // Extract click reference from affExtParam2 or affExtParam1
      const clickId =
        extractClickIdFromText(item.affExtParam2) ||
        extractClickIdFromText(item.affExtParam1);

      // Order Amount
      let orderAmount = "0.00";
      if (item.sales && typeof item.sales === "object" && item.sales.amount !== undefined) {
        orderAmount = String(item.sales.amount);
      } else if (item.sales !== undefined) {
        orderAmount = String(item.sales);
      }

      // Commission Amount
      let commissionAmount = "0.00";
      if (
        item.tentativeCommission &&
        typeof item.tentativeCommission === "object" &&
        item.tentativeCommission.amount !== undefined
      ) {
        commissionAmount = String(item.tentativeCommission.amount);
      } else if (item.tentativeCommission !== undefined) {
        commissionAmount = String(item.tentativeCommission);
      }

      const status = mapFlipkartStatus(item.status);
      const convertedAt = item.orderDate ? new Date(item.orderDate) : new Date();

      const normalized: NormalizedConversionPayload = {
        provider: "FLIPKART",
        externalTransactionId: String(externalTransactionId).trim(),
        clickId,
        orderAmount,
        commissionAmount,
        currency: "INR",
        status,
        convertedAt: isNaN(convertedAt.getTime()) ? new Date() : convertedAt,
        rawPayload: item,
        notes: `Imported via Flipkart Reports API (af_report_ref). Order Item: ${externalTransactionId}`,
      };

      // Feed into common ingestion service (guaranteeing exact same dedup & ledger logic)
      const ingestResult = await ingestNormalizedConversion(normalized);
      results.push(ingestResult);
    } catch (err: unknown) {
      errors.push(`Failed ingesting order ${item.affiliateOrderItemId || "unknown"}: ${(err as Error).message}`);
    }
  }

  return {
    enabled: true,
    polledCount: orderRecords.length,
    results,
    errors,
  };
}
