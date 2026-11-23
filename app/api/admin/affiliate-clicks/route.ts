import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { adminClicksQuerySchema } from "@/src/lib/validations/click.schema";
import { getAdminClicks } from "@/src/modules/affiliate-clicks/click.service";

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
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      merchantId: searchParams.get("merchantId") ?? undefined,
      dealId: searchParams.get("dealId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
    };

    const parsed = adminClicksQuerySchema.safeParse(rawQuery);
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

    const result = await getAdminClicks(parsed.data);

    return NextResponse.json({
      success: true,
      clicks: result.clicks,
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

    console.error("Get admin clicks error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve affiliate clicks" },
      { status: 500 }
    );
  }
}
