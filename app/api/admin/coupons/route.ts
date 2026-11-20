import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import {
  createCouponSchema,
  couponQuerySchema,
} from "@/src/lib/validations/coupon.schema";
import {
  createCoupon,
  getAdminCoupons,
  CouponServiceError,
} from "@/src/modules/coupons/coupon.service";

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
      search: searchParams.get("search") ?? undefined,
      merchantId: searchParams.get("merchantId") ?? undefined,
      merchant: searchParams.get("merchant") ?? undefined,
      discountType: searchParams.get("discountType") ?? undefined,
      isActive: searchParams.get("isActive") ?? undefined,
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

    const result = await getAdminCoupons(parsed.data);

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

    console.error("Admin get coupons error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid JSON request body" },
        { status: 400 }
      );
    }

    const parsed = createCouponSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid coupon data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const coupon = await createCoupon(parsed.data);

      return NextResponse.json(
        {
          success: true,
          message: "Coupon created successfully",
          coupon,
        },
        { status: 201 }
      );
    } catch (serviceError: unknown) {
      if (serviceError instanceof CouponServiceError) {
        return NextResponse.json(
          { success: false, message: serviceError.message },
          { status: serviceError.statusCode }
        );
      }

      const code = (serviceError as { code?: string })?.code;
      if (code === "P2002") {
        return NextResponse.json(
          {
            success: false,
            message: "A coupon with this code already exists for this merchant",
          },
          { status: 409 }
        );
      }

      console.error("Database error during createCoupon:", serviceError);
      return NextResponse.json(
        { success: false, message: "Something went wrong" },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    const digest = (error as { digest?: string })?.digest;
    if (
      digest === "HANGING_PROMISE_REJECTION" ||
      digest?.includes("DYNAMIC") ||
      digest?.includes("PRERENDER")
    ) {
      throw error;
    }

    console.error("Admin create coupon error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
