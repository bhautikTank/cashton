import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { updateCampaignSchema } from "@/src/lib/validations/campaign.schema";
import {
  getAdminCampaignById,
  updateCampaign,
  deleteOrDeactivateCampaign,
  CampaignServiceError,
} from "@/src/modules/campaigns/campaign.service";

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
        { success: false, message: "Invalid campaign identifier" },
        { status: 400 }
      );
    }

    const campaign = await getAdminCampaignById(id.trim());
    if (!campaign) {
      return NextResponse.json(
        { success: false, message: "Campaign not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      campaign,
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

    console.error("Admin get campaign by id error:", error);
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
        { success: false, message: "Invalid campaign identifier" },
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

    const parsed = updateCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid campaign update data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const updated = await updateCampaign(id.trim(), parsed.data);
      return NextResponse.json({
        success: true,
        message: "Campaign updated successfully",
        campaign: updated,
      });
    } catch (err: unknown) {
      if (err instanceof CampaignServiceError) {
        return NextResponse.json(
          { success: false, message: err.message, code: err.code },
          { status: err.statusCode }
        );
      }
      throw err;
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

    console.error("Admin update campaign error:", error);
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
        { success: false, message: "Invalid campaign identifier" },
        { status: 400 }
      );
    }

    try {
      const result = await deleteOrDeactivateCampaign(id.trim());
      return NextResponse.json({
        success: true,
        ...result,
      });
    } catch (err: unknown) {
      if (err instanceof CampaignServiceError) {
        return NextResponse.json(
          { success: false, message: err.message, code: err.code },
          { status: err.statusCode }
        );
      }
      throw err;
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

    console.error("Admin delete campaign error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
