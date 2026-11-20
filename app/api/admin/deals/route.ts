import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import {
  createDealSchema,
  dealQuerySchema,
} from "@/src/lib/validations/deal.schema";
import {
  createDeal,
  getAdminDeals,
  DealServiceError,
} from "@/src/modules/deals/deal.service";

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
      isActive: searchParams.get("isActive") ?? undefined,
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

    const result = await getAdminDeals(parsed.data);

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

    console.error("Admin get deals error:", error);
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

    const parsed = createDealSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid deal data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const deal = await createDeal(parsed.data);

      return NextResponse.json(
        {
          success: true,
          message: "Deal created successfully",
          deal,
        },
        { status: 201 }
      );
    } catch (serviceError: unknown) {
      if (serviceError instanceof DealServiceError) {
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
            message: "A deal with this slug already exists",
          },
          { status: 409 }
        );
      }

      console.error("Database error during createDeal:", serviceError);
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

    console.error("Admin create deal error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
