import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth/rbac";
import { disputeDebtSchema } from "@/src/lib/validations/debt.schema";
import { disputeDebt } from "@/src/modules/wallet/debt.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (!authResult.success) {
    return authResult.response;
  }

  const { id: debtId } = await context.params;
  if (!debtId) {
    return NextResponse.json(
      { success: false, message: "Debt ID is required" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { success: false, message: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const parsed = disputeDebtSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid dispute payload",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const userId = authResult.data.profile.id;
    const result = await disputeDebt(debtId, userId, parsed.data.reason);
    return NextResponse.json({
      success: true,
      message: `Debt ${debtId} marked as DISPUTED and frozen from recovery`,
      data: result,
    });
  } catch (err: unknown) {
    console.error("[DisputeDebtAPI] Error disputing debt:", err);
    return NextResponse.json(
      { success: false, message: (err as Error).message || "Failed to dispute debt" },
      { status: 400 }
    );
  }
}
