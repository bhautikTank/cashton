import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { AdminConversionsQuerySchema } from "@/src/lib/validations/conversion.schema";
import { getAdminConversions } from "@/src/modules/conversions/conversion.service";

export async function GET(request: Request) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      provider: searchParams.get("provider") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      merchantId: searchParams.get("merchantId") ?? undefined,
      dealId: searchParams.get("dealId") ?? undefined,
      userId: searchParams.get("userId") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
    };

    const parsed = AdminConversionsQuerySchema.safeParse(rawQuery);
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

    const result = await getAdminConversions(parsed.data);

    return NextResponse.json({
      success: true,
      conversions: result.conversions,
      pagination: result.pagination,
    });
  } catch (error: unknown) {
    const digest = (error as { digest?: string })?.digest;
    if (
      digest === "HANGING_PROMISE_REJECTION" ||
      digest?.includes("DYNAMIC") ||
      digest?.includes("PRERENDER")
    ) {
      throw error;
    }

    console.error("Get admin conversions error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve conversions" },
      { status: 500 }
    );
  }
}
