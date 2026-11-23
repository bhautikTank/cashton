import { NextResponse } from "next/server";
import { AffiliateProvider } from "@/src/generated/prisma/client";
import { ingestConversion, ConversionServiceError } from "./conversion.service";
import { isProviderIngestionEnabled } from "./kill-switch";

/**
 * Handles incoming postback/webhook requests across all affiliate networks.
 * Supports POST (JSON / form-urlencoded) and GET (query string postbacks).
 * Enforces per-provider kill switch, payload size limits, authenticates webhooks, and manages idempotency.
 */
export async function handleWebhookRequest(
  provider: AffiliateProvider,
  request: Request
): Promise<NextResponse> {
  // 1. Mandatory per-provider kill switch check
  if (!isProviderIngestionEnabled(provider)) {
    console.warn(
      `[Webhook Kill-Switch] Ingestion for provider '${provider}' is disabled by CONVERSION_INGESTION_ENABLED_PROVIDERS. Request rejected without processing.`
    );
    return NextResponse.json(
      {
        success: false,
        message: `Conversion ingestion is currently disabled for provider: ${provider}`,
        code: "PROVIDER_DISABLED",
      },
      { status: 503 }
    );
  }

  try {
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    let rawBody = "";
    if (request.method === "POST" || request.method === "PUT") {
      const contentLength = request.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > 1024 * 1024) {
        return NextResponse.json(
          { success: false, message: "Payload too large (exceeds 1MB limit)" },
          { status: 413 }
        );
      }
      rawBody = await request.text();
    }

    const result = await ingestConversion(
      provider,
      rawBody,
      request.headers,
      searchParams
    );

    return NextResponse.json(
      {
        success: true,
        message: result.isDuplicate
          ? "Conversion postback recorded (duplicate delivery acknowledged)"
          : "Conversion postback processed successfully",
        ...result,
      },
      { status: result.isDuplicate ? 200 : 201 }
    );
  } catch (error: unknown) {
    if (error instanceof ConversionServiceError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    const digest = (error as { digest?: string })?.digest;
    if (
      digest === "HANGING_PROMISE_REJECTION" ||
      digest?.includes("DYNAMIC") ||
      digest?.includes("PRERENDER")
    ) {
      throw error;
    }

    console.error(`[Webhook] Unhandled error for ${provider}:`, error);
    return NextResponse.json(
      { success: false, message: "Failed to process conversion webhook" },
      { status: 500 }
    );
  }
}
