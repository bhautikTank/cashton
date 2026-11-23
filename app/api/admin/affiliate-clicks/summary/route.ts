import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { adminClicksSummaryQuerySchema } from "@/src/lib/validations/click.schema";
import { getAdminClicksSummary } from "@/src/modules/affiliate-clicks/click.service";

export async function GET(request: Request) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      merchantId: searchParams.get("merchantId") ?? undefined,
      dealId: searchParams.get("dealId") ?? undefined,
    };

    const parsed = adminClicksSummaryQuerySchema.safeParse(rawQuery);
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

    const summary = await getAdminClicksSummary(parsed.data);

    return NextResponse.json({
      success: true,
      summary,
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

    console.error("Get admin clicks summary error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve clicks summary" },
      { status: 500 }
    );
  }
}
