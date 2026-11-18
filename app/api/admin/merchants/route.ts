import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";
import { createMerchantSchema } from "@/src/lib/validations/merchant.schema";
import { createMerchant } from "@/src/modules/merchants/merchant.service";

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

    const parsed = createMerchantSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid merchant data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const merchant = await createMerchant(parsed.data);

      return NextResponse.json(
        {
          success: true,
          message: "Merchant created successfully",
          merchant,
        },
        { status: 201 }
      );
    } catch (dbError: unknown) {
      const code = (dbError as { code?: string })?.code;
      if (code === "P2002") {
        return NextResponse.json(
          {
            success: false,
            message: "A merchant with this slug already exists",
          },
          { status: 409 }
        );
      }

      console.error("Database error during createMerchant:", dbError);
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

    console.error("Admin create merchant error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
