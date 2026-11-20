import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { updateDealSchema } from "@/src/lib/validations/deal.schema";
import {
  getAdminDealById,
  updateDeal,
  deactivateDeal,
  DealServiceError,
} from "@/src/modules/deals/deal.service";

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
        { success: false, message: "Invalid deal identifier" },
        { status: 400 }
      );
    }

    const deal = await getAdminDealById(id.trim());
    if (!deal) {
      return NextResponse.json(
        { success: false, message: "Deal not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deal,
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

    console.error("Admin get deal by id error:", error);
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
        { success: false, message: "Invalid deal identifier" },
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

    const parsed = updateDealSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid deal update data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const deal = await updateDeal(id.trim(), parsed.data);

      return NextResponse.json({
        success: true,
        message: "Deal updated successfully",
        deal,
      });
    } catch (serviceError: unknown) {
      if (serviceError instanceof DealServiceError) {
        return NextResponse.json(
          { success: false, message: serviceError.message },
          { status: serviceError.statusCode }
        );
      }

      const code = (serviceError as { code?: string })?.code;
      if (code === "P2025") {
        return NextResponse.json(
          { success: false, message: "Deal not found" },
          { status: 404 }
        );
      }

      if (code === "P2002") {
        return NextResponse.json(
          {
            success: false,
            message: "A deal with this slug already exists",
          },
          { status: 409 }
        );
      }

      console.error("Database error during updateDeal:", serviceError);
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

    console.error("Admin update deal error:", error);
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
        { success: false, message: "Invalid deal identifier" },
        { status: 400 }
      );
    }

    try {
      const deal = await deactivateDeal(id.trim());

      return NextResponse.json({
        success: true,
        message: "Deal deactivated successfully",
        deal,
      });
    } catch (serviceError: unknown) {
      if (serviceError instanceof DealServiceError) {
        return NextResponse.json(
          { success: false, message: serviceError.message },
          { status: serviceError.statusCode }
        );
      }

      const code = (serviceError as { code?: string })?.code;
      if (code === "P2025") {
        return NextResponse.json(
          { success: false, message: "Deal not found" },
          { status: 404 }
        );
      }

      console.error("Database error during deactivateDeal:", serviceError);
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

    console.error("Admin deactivate deal error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
