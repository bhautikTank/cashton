import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { adminRejectPayoutSchema } from "@/src/lib/validations/payout.schema";
import { rejectPayout, PayoutServiceError } from "@/src/modules/payout/payout.service";

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

  const parsed = adminRejectPayoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid rejection payload",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const adminId = authResult.data.profile.id;
    const result = await rejectPayout(payoutId, adminId, parsed.data.reason);
    return NextResponse.json({
      success: true,
      message: `Payout ${payoutId} marked as REJECTED and funds refunded to user wallet`,
      data: result,
    });
  } catch (err: unknown) {
    if (err instanceof PayoutServiceError) {
      return NextResponse.json(
        { success: false, code: err.code, message: err.message },
        { status: err.statusCode }
      );
    }
    console.error(`[AdminPayoutRejectAPI] Error rejecting payout ${payoutId}:`, err);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to reject payout",
      },
      { status: 500 }
    );
  }
}
