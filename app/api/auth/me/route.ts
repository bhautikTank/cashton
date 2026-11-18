import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth/rbac";

export async function GET() {
  try {
    const authResult = await requireAuth();

    if (!authResult.success) {
      return authResult.response;
    }

    const { auth, profile } = authResult.data;

    return NextResponse.json({
      success: true,
      user: {
        id: profile.id,
        authUserId: auth.id,
        email: auth.email,
        name: profile.name ?? (auth.user_metadata?.name as string) ?? null,
        role: profile.role,
        emailConfirmedAt: auth.email_confirmed_at ?? null,
      },
    });
  } catch (error: unknown) {
    const digest = (error as { digest?: string })?.digest;
    if (digest === "HANGING_PROMISE_REJECTION" || digest?.includes("DYNAMIC")) {
      throw error;
    }

    console.error("Get current user error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
