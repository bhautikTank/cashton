import { NextResponse } from "next/server";
import {
  getClickForRedirect,
  ClickServiceError,
} from "@/src/modules/affiliate-clicks/click.service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ clickId: string }> }
) {
  try {
    const { clickId } = await context.params;

    if (!clickId || typeof clickId !== "string" || clickId.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid click tracking identifier" },
        { status: 400 }
      );
    }

    const result = await getClickForRedirect(clickId.trim());

    // Secure HTTP 307 Temporary Redirect with strict cache-prevention headers
    const response = NextResponse.redirect(result.destinationUrl, { status: 307 });
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    return response;
  } catch (error: unknown) {
    if (error instanceof ClickServiceError) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
          code: error.code,
        },
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

    console.error("Secure redirect error:", error);
    return NextResponse.json(
      { success: false, message: "Redirect resolution failed" },
      { status: 500 }
    );
  }
}
