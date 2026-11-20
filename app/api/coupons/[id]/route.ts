import { NextResponse } from "next/server";
import { getPublicCouponById } from "@/src/modules/coupons/coupon.service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid coupon identifier" },
        { status: 400 }
      );
    }

    const coupon = await getPublicCouponById(id.trim());

    if (!coupon) {
      return NextResponse.json(
        { success: false, message: "Coupon not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      coupon,
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

    console.error("Get coupon by id error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
