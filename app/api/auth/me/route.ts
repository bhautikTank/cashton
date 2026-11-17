import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth/current-user";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user || !user.auth) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.profile?.id ?? null,
        authUserId: user.auth.id,
        email: user.auth.email,
        name:
          user.profile?.name ??
          (user.auth.user_metadata?.name as string) ??
          null,
        role: user.profile?.role ?? "USER",
        emailConfirmedAt: user.auth.email_confirmed_at ?? null,
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
