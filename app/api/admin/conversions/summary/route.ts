import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { AdminConversionsSummaryQuerySchema } from "@/src/lib/validations/conversion.schema";
import { getAdminConversionsSummary } from "@/src/modules/conversions/conversion.service";

export async function GET(request: Request) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      provider: searchParams.get("provider") ?? undefined,
      merchantId: searchParams.get("merchantId") ?? undefined,
      dealId: searchParams.get("dealId") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
    };

    const parsed = AdminConversionsSummaryQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid summary query parameters",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const summary = await getAdminConversionsSummary(parsed.data);

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

    console.error("Get admin conversions summary error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve conversions summary" },
      { status: 500 }
    );
  }
}
