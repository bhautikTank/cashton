import { NextResponse } from "next/server";
import { logout } from "@/src/modules/auth/auth.service";

export async function POST() {
  try {
    const result = await logout();
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
