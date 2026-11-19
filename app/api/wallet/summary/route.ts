import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth/rbac";
import { getWalletSummary } from "@/src/modules/wallet/wallet.service";

export async function GET() {
  try {
    const authResult = await requireAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { profile } = authResult.data;
    const summary = await getWalletSummary(profile.id);

    return NextResponse.json({
      success: true,
      summary,
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

    console.error("Get wallet summary error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
