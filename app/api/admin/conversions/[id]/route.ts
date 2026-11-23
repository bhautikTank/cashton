import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import {
  getAdminConversionById,
  ConversionServiceError,
} from "@/src/modules/conversions/conversion.service";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { id } = await props.params;
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { success: false, message: "Invalid conversion identifier" },
        { status: 400 }
      );
    }

    const conversion = await getAdminConversionById(id);

    return NextResponse.json({
      success: true,
      conversion,
    });
  } catch (error: unknown) {
    if (error instanceof ConversionServiceError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    const digest = (error as { digest?: string })?.digest;
    if (
      digest === "HANGING_PROMISE_REJECTION" ||
      digest?.includes("DYNAMIC") ||
      digest?.includes("PRERENDER")
    ) {
      throw error;
    }

    console.error("Get admin conversion by ID error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve conversion" },
      { status: 500 }
    );
  }
}
