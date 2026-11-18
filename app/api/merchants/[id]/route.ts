import { NextResponse } from "next/server";
import { getMerchantByIdOrSlug } from "@/src/modules/merchants/merchant.service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid merchant identifier" },
        { status: 400 }
      );
    }

    const merchant = await getMerchantByIdOrSlug(id.trim());

    if (!merchant) {
      return NextResponse.json(
        { success: false, message: "Merchant not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      merchant,
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

    console.error("Get merchant by id or slug error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
