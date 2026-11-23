import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import {
  createCampaignSchema,
  campaignQuerySchema,
} from "@/src/lib/validations/campaign.schema";
import {
  createCampaign,
  getAdminCampaigns,
  CampaignServiceError,
} from "@/src/modules/campaigns/campaign.service";

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
      dealId: searchParams.get("dealId") ?? undefined,
      network: searchParams.get("network") ?? undefined,
      isActive: searchParams.get("isActive") ?? undefined,
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
    };

    const parsed = campaignQuerySchema.safeParse(rawQuery);
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

    const result = await getAdminCampaigns(parsed.data);

    return NextResponse.json({
      success: true,
      campaigns: result.campaigns,
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

    console.error("Admin get campaigns error:", error);
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

    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid campaign data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const campaign = await createCampaign(
        parsed.data,
        authResult.data.profile.id
      );

      return NextResponse.json(
        {
          success: true,
          message: "Campaign created successfully",
          campaign,
        },
        { status: 201 }
      );
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

    console.error("Admin create campaign error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
