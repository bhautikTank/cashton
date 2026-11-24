import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { listDebtsQuerySchema } from "@/src/lib/validations/debt.schema";
import { listDebts } from "@/src/modules/wallet/debt.service";

export async function GET(request: Request) {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const rawParams = {
    status: searchParams.get("status") || undefined,
    userId: searchParams.get("userId") || undefined,
    walletId: searchParams.get("walletId") || undefined,
    page: searchParams.get("page") || undefined,
    limit: searchParams.get("limit") || undefined,
  };

  const parsed = listDebtsQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid query parameters",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const result = await listDebts(parsed.data);
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    console.error("[AdminDebtsAPI] Error fetching debts:", err);
    return NextResponse.json(
      { success: false, message: "Failed to fetch debts", error: (err as Error).message },
      { status: 500 }
    );
  }
}
