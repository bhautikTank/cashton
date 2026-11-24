import { NextResponse } from "next/server";
import crypto from "crypto";
import { processEligibleHoldReleases } from "@/src/modules/wallet/hold-back.service";

/**
 * Scheduled Cron route to process matured cashback holds.
 * Transfers held cashback into available withdrawable balance.
 *
 * Security:
 * - Fail-closed: returns 500 if CRON_SECRET is not configured on the server.
 * - Authenticated strictly via Authorization: Bearer <CRON_SECRET> header.
 * - Timing-safe comparison to prevent timing side-channel attacks.
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

  try {
    const result = await processEligibleHoldReleases();
    return NextResponse.json({
      success: true,
      message: `Successfully processed ${result.processedCount} matured hold releases`,
      data: result,
    });
  } catch (err: unknown) {
    console.error("[CronHoldRelease] Unhandled exception:", err);
    return NextResponse.json(
      { success: false, message: "Failed to process hold releases", error: (err as Error).message },
      { status: 500 }
    );
  }
}
