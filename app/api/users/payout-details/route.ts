import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth/rbac";
import { payoutDetailsSchema } from "@/src/lib/validations/payout.schema";
import {
  getPayoutDetails,
  savePayoutDetails,
  PayoutServiceError,
} from "@/src/modules/payout/payout.service";

export async function GET() {
  try {
    const authResult = await requireAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { profile } = authResult.data;
    const details = await getPayoutDetails(profile.id);

    return NextResponse.json({
      success: true,
      payoutDetails: details,
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

    console.error("Get payout details error:", error instanceof Error ? error.message : "Internal error");
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth();
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

    const parsed = payoutDetailsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid payout details",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { profile } = authResult.data;
    const saved = await savePayoutDetails(profile.id, parsed.data);

    return NextResponse.json({
      success: true,
      message: "Payout details saved successfully",
      payoutDetails: saved,
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

    if (error instanceof PayoutServiceError) {
      return NextResponse.json(
        { success: false, code: error.code, message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("Save payout details error:", error instanceof Error ? error.message : "Internal error");
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  return POST(request);
}
