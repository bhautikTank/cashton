import { NextResponse } from "next/server";
import { getPublicDealBySlug } from "@/src/modules/deals/deal.service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    if (!slug || typeof slug !== "string" || slug.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid deal identifier" },
        { status: 400 }
      );
    }

    const deal = await getPublicDealBySlug(slug.trim().toLowerCase());

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

    console.error("Get deal by slug error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
