import { NextResponse } from "next/server";
import { dealQuerySchema } from "@/src/lib/validations/deal.schema";
import { getPublicDeals } from "@/src/modules/deals/deal.service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = {
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      merchantId: searchParams.get("merchantId") ?? undefined,
      merchant: searchParams.get("merchant") ?? undefined,
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
    };

    const parsed = dealQuerySchema.safeParse(rawQuery);
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

    const result = await getPublicDeals(parsed.data);

    return NextResponse.json({
      success: true,
      deals: result.deals,
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

    console.error("Get public deals error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
