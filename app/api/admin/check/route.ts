import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth/rbac";

export async function GET() {
  try {
    const authResult = await requireAdmin();

    if (!authResult.success) {
      return authResult.response;
    }

    const { profile } = authResult.data;

    return NextResponse.json({
      success: true,
      message: "Admin authorization verified",
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: profile.role,
      },
    });
  } catch (error: unknown) {
    const digest = (error as { digest?: string })?.digest;
    if (digest === "HANGING_PROMISE_REJECTION" || digest?.includes("DYNAMIC")) {
      throw error;
    }

    console.error("Admin check error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
