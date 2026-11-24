import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { resolveDebtSchema } from "@/src/lib/validations/debt.schema";
import { resolveDebt } from "@/src/modules/wallet/debt.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin();
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

  const parsed = resolveDebtSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid debt resolution payload",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const adminId = authResult.data.profile.id;
    const result = await resolveDebt(debtId, adminId, parsed.data);
    return NextResponse.json({
      success: true,
      message: `Debt ${debtId} resolved successfully with action ${parsed.data.action}`,
      data: result,
    });
  } catch (err: unknown) {
    console.error("[AdminResolveDebtAPI] Error resolving debt:", err);
    return NextResponse.json(
      { success: false, message: (err as Error).message || "Failed to resolve debt" },
      { status: 400 }
    );
  }
}
