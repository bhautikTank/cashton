import { NextResponse } from "next/server";
import { payoutCallbackSchema } from "@/src/lib/validations/payout.schema";
import { handlePayoutCallback, PayoutServiceError } from "@/src/modules/payout/payout.service";
import { verifyPayoutWebhookSignature } from "@/src/lib/security/payout-signature";

/**
 * External payout provider webhook endpoint stub.
 * Uses CashTon's shared-secret HMAC-SHA256 verification (`x-webhook-signature`).
 * No real external payout provider (e.g., Cashfree or RazorpayX) is integrated yet.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  const upperProvider = provider?.toUpperCase() || "MANUAL";

  // 1. Read raw body, signature header, and optional timestamp header
  const rawBody = await request.text().catch(() => "");
  const signatureHeader = request.headers.get("x-webhook-signature");
  const timestampHeader = request.headers.get("x-webhook-timestamp");

  // 2. Enforce CashTon shared-secret signature verification (rejects MANUAL and unsigned requests)
  const verification = verifyPayoutWebhookSignature(
    upperProvider,
    rawBody,
    signatureHeader,
    timestampHeader
  );

  if (!verification.isValid) {
    return NextResponse.json(
      { success: false, message: verification.message },
      { status: verification.statusCode }
    );
  }

  // 3. Parse JSON payload
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON callback payload" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, message: "Invalid JSON callback payload" },
      { status: 400 }
    );
  }

  const parsed = payoutCallbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid callback payload schema",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const result = await handlePayoutCallback(upperProvider, parsed.data);
    return NextResponse.json({
      success: true,
      message: result.isDuplicate
        ? "Callback already processed (idempotent response)"
        : `Payout callback processed successfully (${result.status})`,
      data: result,
    });
  } catch (err: unknown) {
    if (err instanceof PayoutServiceError) {
      return NextResponse.json(
        { success: false, code: err.code, message: err.message },
        { status: err.statusCode }
      );
    }
    console.error(`[PayoutWebhookAPI] Error processing callback from ${upperProvider}:`, err);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to process payout callback",
      },
      { status: 500 }
    );
  }
}
