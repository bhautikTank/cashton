import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { adminCompletePayoutSchema } from "@/src/lib/validations/payout.schema";
import { completePayout, PayoutServiceError } from "@/src/modules/payout/payout.service";

const uuidSchema = z.string().uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return authResult.response;
  }

  const { id: payoutId } = await context.params;
  if (!payoutId || !uuidSchema.safeParse(payoutId).success) {
    return NextResponse.json(
      { success: false, message: "Valid Payout UUID is required" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, message: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const parsed = adminCompletePayoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid completion payload",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const adminId = authResult.data.profile.id;
    const result = await completePayout(
      payoutId,
      adminId,
      parsed.data.providerReference
    );
    return NextResponse.json({
      success: true,
      message: `Payout ${payoutId} marked as PAID with reference ${parsed.data.providerReference}`,
      data: result,
    });
  } catch (err: unknown) {
    if (err instanceof PayoutServiceError) {
      return NextResponse.json(
        { success: false, code: err.code, message: err.message },
        { status: err.statusCode }
      );
    }
    console.error(`[AdminPayoutCompleteAPI] Error completing payout ${payoutId}:`, err);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to complete payout",
      },
      { status: 500 }
    );
  }
}
