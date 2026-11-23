import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { ReconcileConversionSchema } from "@/src/lib/validations/conversion.schema";
import {
  reconcileConversion,
  ConversionServiceError,
} from "@/src/modules/conversions/conversion.service";

export async function POST(
  request: Request,
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Malformed JSON payload" },
        { status: 400 }
      );
    }

    const parsed = ReconcileConversionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid reconciliation data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const updated = await reconcileConversion(id, parsed.data);

    return NextResponse.json({
      success: true,
      message: "Conversion reconciled successfully",
      conversion: updated,
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

    console.error("Reconcile conversion error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to reconcile conversion" },
      { status: 500 }
    );
  }
}
