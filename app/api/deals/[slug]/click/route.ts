import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth/current-user";
import { createClickBodySchema } from "@/src/lib/validations/click.schema";
import {
  createClickRecord,
  ClickServiceError,
} from "@/src/modules/affiliate-clicks/click.service";
import { checkRateLimit } from "@/src/modules/affiliate-clicks/rate-limiter";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    if (!slug || typeof slug !== "string" || slug.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid deal identifier" },
        { status: 400 }
      );
    }

    // Rate limiting: 60 requests per minute per IP or identifier
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "127.0.0.1";
    const rateCheck = checkRateLimit(clientIp, 60, 60 * 1000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: "Too many click requests. Please try again later.",
        },
        { status: 429 }
      );
    }

    // Parse and strictly validate body
    let rawBody: unknown = {};
    const text = await request.text();
    if (text && text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { success: false, message: "Invalid JSON payload" },
          { status: 400 }
        );
      }
    }

    const parsed = createClickBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid request payload",
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    // Server-side user attribution (never trusts client headers or payload)
    const userSession = await getCurrentUser();
    const userId = userSession?.profile?.id ?? null;

    const result = await createClickRecord(slug.trim(), {
      userId,
      source: parsed.data.source,
    });

    return NextResponse.json(
      {
        success: true,
        clickId: result.clickId,
        redirectUrl: result.redirectUrl,
      },
      { status: 201 }
    );
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

    console.error("Deal click tracking error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to record affiliate click" },
      { status: 500 }
    );
  }
}
