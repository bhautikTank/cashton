import { NextResponse } from "next/server";
import { couponQuerySchema } from "@/src/lib/validations/coupon.schema";
import { getPublicCoupons } from "@/src/modules/coupons/coupon.service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = {
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      merchantId: searchParams.get("merchantId") ?? undefined,
      merchant: searchParams.get("merchant") ?? undefined,
      discountType: searchParams.get("discountType") ?? undefined,
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
    };

    const parsed = couponQuerySchema.safeParse(rawQuery);
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

    const result = await getPublicCoupons(parsed.data);

    return NextResponse.json({
      success: true,
      coupons: result.coupons,
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

    console.error("Get public coupons error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
