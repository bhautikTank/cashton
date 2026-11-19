import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth/rbac";
import { updateProfileSchema } from "@/src/lib/validations/user.schema";
import { getProfile, updateProfile } from "@/src/modules/users/user.service";

export async function GET() {
  try {
    const authResult = await requireAuth();

    if (!authResult.success) {
      return authResult.response;
    }

    const { profile } = authResult.data;

    let currentProfile;
    try {
      currentProfile = await getProfile(profile.id);
    } catch (dbError) {
      console.error("Database error during getProfile:", dbError);
      return NextResponse.json(
        { success: false, message: "Something went wrong" },
        { status: 500 }
      );
    }

    if (!currentProfile) {
      return NextResponse.json(
        { success: false, message: "User profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      profile: currentProfile,
    });
  } catch (error: unknown) {
    const digest = (error as { digest?: string })?.digest;
    if (digest === "HANGING_PROMISE_REJECTION" || digest?.includes("DYNAMIC")) {
      throw error;
    }

    console.error("Get user profile error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
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

    if (Object.keys(body).length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No update fields provided. Please provide at least one permitted field to update.",
        },
        { status: 400 }
      );
    }

    const parsed = updateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid profile update data",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { profile } = authResult.data;

    try {
      const updatedProfile = await updateProfile(profile.id, parsed.data);

      return NextResponse.json({
        success: true,
        message: "Profile updated successfully",
        profile: updatedProfile,
      });
    } catch (dbError: unknown) {
      const code = (dbError as { code?: string })?.code;
      if (code === "P2025") {
        return NextResponse.json(
          { success: false, message: "User profile not found" },
          { status: 404 }
        );
      }

      if (code === "P2002") {
        return NextResponse.json(
          {
            success: false,
            message: "This mobile number is already in use by another account",
          },
          { status: 409 }
        );
      }

      console.error("Database error during updateProfile:", dbError);
      return NextResponse.json(
        { success: false, message: "Something went wrong" },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    const digest = (error as { digest?: string })?.digest;
    if (digest === "HANGING_PROMISE_REJECTION" || digest?.includes("DYNAMIC")) {
      throw error;
    }

    console.error("Update user profile error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
