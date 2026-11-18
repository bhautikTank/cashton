import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { updateMerchantSchema } from "@/src/lib/validations/merchant.schema";
import {
  updateMerchant,
  deactivateMerchant,
} from "@/src/modules/merchants/merchant.service";

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
        { success: false, message: "Invalid merchant identifier" },
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

    const parsed = updateMerchantSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid merchant update data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const merchant = await updateMerchant(id.trim(), parsed.data);

      return NextResponse.json({
        success: true,
        message: "Merchant updated successfully",
        merchant,
      });
    } catch (dbError: unknown) {
      const code = (dbError as { code?: string })?.code;
      if (code === "P2025") {
        return NextResponse.json(
          { success: false, message: "Merchant not found" },
          { status: 404 }
        );
      }

      if (code === "P2002") {
        return NextResponse.json(
          {
            success: false,
            message: "A merchant with this slug already exists",
          },
          { status: 409 }
        );
      }

      console.error("Database error during updateMerchant:", dbError);
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

    console.error("Admin update merchant error:", error);
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
        { success: false, message: "Invalid merchant identifier" },
        { status: 400 }
      );
    }

    try {
      const merchant = await deactivateMerchant(id.trim());

      return NextResponse.json({
        success: true,
        message: "Merchant deactivated successfully",
        merchant,
      });
    } catch (dbError: unknown) {
      const code = (dbError as { code?: string })?.code;
      if (code === "P2025") {
        return NextResponse.json(
          { success: false, message: "Merchant not found" },
          { status: 404 }
        );
      }

      console.error("Database error during deactivateMerchant:", dbError);
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

    console.error("Admin deactivate merchant error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
