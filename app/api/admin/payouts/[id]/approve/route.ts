import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { adminApprovePayoutSchema } from "@/src/lib/validations/payout.schema";
import { approvePayout, PayoutServiceError } from "@/src/modules/payout/payout.service";

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

  const rawText = await request.text().catch(() => "");
  let body: unknown = {};
  if (rawText.trim().length > 0) {
    try {
      body = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON request body" },
        { status: 400 }
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid JSON request body" },
        { status: 400 }
      );
    }
  }

  const parsed = adminApprovePayoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid approve payload",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const adminId = authResult.data.profile.id;
    const result = await approvePayout(payoutId, adminId);
    return NextResponse.json({
      success: true,
      message: `Payout ${payoutId} approved and transitioned to PROCESSING`,
      data: result,
    });
  } catch (err: unknown) {
    if (err instanceof PayoutServiceError) {
      return NextResponse.json(
        { success: false, code: err.code, message: err.message },
        { status: err.statusCode }
      );
    }
    console.error(`[AdminPayoutApproveAPI] Error approving payout ${payoutId}:`, err);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to approve payout",
      },
      { status: 500 }
    );
  }
}
