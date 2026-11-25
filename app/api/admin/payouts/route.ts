import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { payoutQuerySchema } from "@/src/lib/validations/payout.schema";
import { listPayouts } from "@/src/modules/payout/payout.service";

export async function GET(request: Request) {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const rawParams = {
    status: searchParams.get("status") || undefined,
    userId: searchParams.get("userId") || undefined,
    page: searchParams.get("page") || undefined,
    limit: searchParams.get("limit") || undefined,
  };

  const parsed = payoutQuerySchema.safeParse(rawParams);
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
    const result = await listPayouts({
      ...parsed.data,
      includeAdminDetails: true,
    });
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    console.error("[AdminPayoutsAPI] Error fetching payouts:", err);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to fetch payouts",
      },
      { status: 500 }
    );
  }
}
