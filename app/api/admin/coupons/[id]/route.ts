import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { updateCouponSchema } from "@/src/lib/validations/coupon.schema";
import {
  getAdminCouponById,
  updateCoupon,
  deactivateCoupon,
  CouponServiceError,
} from "@/src/modules/coupons/coupon.service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { id } = await context.params;
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid coupon identifier" },
        { status: 400 }
      );
    }

    const coupon = await getAdminCouponById(id.trim());
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

    console.error("Admin get coupon by id error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { id } = await context.params;
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid coupon identifier" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid JSON request body" },
        { status: 400 }
      );
    }

    if (Object.keys(body).length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "No update fields provided. Please provide at least one permitted field to update.",
        },
        { status: 400 }
      );
    }

    const parsed = updateCouponSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid coupon update data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const coupon = await updateCoupon(id.trim(), parsed.data);

      return NextResponse.json({
        success: true,
        message: "Coupon updated successfully",
        coupon,
      });
    } catch (serviceError: unknown) {
      if (serviceError instanceof CouponServiceError) {
        return NextResponse.json(
          { success: false, message: serviceError.message },
          { status: serviceError.statusCode }
        );
      }

      const code = (serviceError as { code?: string })?.code;
      if (code === "P2025") {
        return NextResponse.json(
          { success: false, message: "Coupon not found" },
          { status: 404 }
        );
      }

      if (code === "P2002") {
        return NextResponse.json(
          {
            success: false,
            message: "A coupon with this code already exists for this merchant",
          },
          { status: 409 }
        );
      }

      console.error("Database error during updateCoupon:", serviceError);
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

    console.error("Admin update coupon error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { id } = await context.params;
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid coupon identifier" },
        { status: 400 }
      );
    }

    try {
      const coupon = await deactivateCoupon(id.trim());

      return NextResponse.json({
        success: true,
        message: "Coupon deactivated successfully",
        coupon,
      });
    } catch (serviceError: unknown) {
      if (serviceError instanceof CouponServiceError) {
        return NextResponse.json(
          { success: false, message: serviceError.message },
          { status: serviceError.statusCode }
        );
      }

      const code = (serviceError as { code?: string })?.code;
      if (code === "P2025") {
        return NextResponse.json(
          { success: false, message: "Coupon not found" },
          { status: 404 }
        );
      }

      console.error("Database error during deactivateCoupon:", serviceError);
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

    console.error("Admin deactivate coupon error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
