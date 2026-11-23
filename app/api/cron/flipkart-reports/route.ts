import { NextResponse } from "next/server";
import crypto from "crypto";
import { pollFlipkartOrders } from "@/src/modules/conversions/polling/flipkart-reports.service";

/**
 * Scheduled Cron route to poll Flipkart Reports API.
 * Triggered by Vercel Cron, external scheduler, or admin cron worker.
 *
 * Security:
 * - Fail-closed: returns 500 if CRON_SECRET is not configured on the server.
 * - Authenticated strictly via Authorization: Bearer <CRON_SECRET> header.
 * - Timing-safe comparison to prevent timing side-channel attacks.
 * - Query-string secrets are strictly rejected to avoid leaking secrets in URLs/server logs.
 */
export async function POST(request: Request) {
  return handleCron(request);
}

export async function GET(request: Request) {
  return handleCron(request);
}

async function handleCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim().length === 0) {
    return NextResponse.json(
      { success: false, message: "CRON_SECRET is not configured on server" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { success: false, message: "Unauthorized: Missing Bearer token in Authorization header" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7).trim();
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(cronSecret);

  if (
    tokenBuf.length !== secretBuf.length ||
    !crypto.timingSafeEqual(tokenBuf, secretBuf)
  ) {
    return NextResponse.json(
      { success: false, message: "Unauthorized cron execution" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const startDate = url.searchParams.get("startDate") ?? undefined;
  const endDate = url.searchParams.get("endDate") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  const result = await pollFlipkartOrders({ startDate, endDate, status });

  return NextResponse.json({
    success: true,
    ...result,
  });
}
