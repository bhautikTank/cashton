import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth/rbac";
import {
  withdrawalRequestSchema,
  payoutQuerySchema,
} from "@/src/lib/validations/payout.schema";
import {
  createWithdrawalRequest,
  listPayouts,
  PayoutServiceError,
} from "@/src/modules/payout/payout.service";

export async function POST(request: Request) {
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

  const parsed = withdrawalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid withdrawal request payload",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const userId = authResult.data.profile.id;
    const result = await createWithdrawalRequest({
      userId,
      input: parsed.data,
    });

    return NextResponse.json(
      {
        success: true,
        message: result.isDuplicate
          ? "Withdrawal request already recorded (idempotent response)"
          : "Withdrawal request created successfully",
        data: result.payout,
      },
      { status: result.isDuplicate ? 200 : 201 }
    );
  } catch (err: unknown) {
    if (err instanceof PayoutServiceError) {
      return NextResponse.json(
        { success: false, code: err.code, message: err.message },
        { status: err.statusCode }
      );
    }
    console.error("[WithdrawalsAPI] Error creating withdrawal:", err);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to create withdrawal request",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const authResult = await requireAuth();
  if (!authResult.success) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const rawParams = {
    status: searchParams.get("status") || undefined,
    page: searchParams.get("page") || undefined,
    limit: searchParams.get("limit") || undefined,
  };

  const parsed = payoutQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid query parameters",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const userId = authResult.data.profile.id;
    const result = await listPayouts({
      status: parsed.data.status,
      page: parsed.data.page,
      limit: parsed.data.limit,
      userId,
      includeAdminDetails: false,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    console.error("[WithdrawalsAPI] Error listing user withdrawals:", err);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to list withdrawals",
      },
      { status: 500 }
    );
  }
}
