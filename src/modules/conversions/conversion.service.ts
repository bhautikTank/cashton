import { prisma } from "@/src/lib/prisma";
import { Prisma, AffiliateProvider, ConversionStatus } from "@/src/generated/prisma/client";
import { getAdapter, WebhookHeaders, NormalizedConversionPayload } from "./adapters";
import { updateCashbackStatus } from "@/src/modules/cashback/cashback.service";
import type {
  AdminConversionsQueryInput,
  AdminConversionsSummaryQueryInput,
  ReconcileConversionInput,
} from "@/src/lib/validations/conversion.schema";

export class ConversionServiceError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = "ConversionServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Default user share of affiliate network commission (70%).
 */
export const PLATFORM_CASHBACK_PERCENT = "0.70";

export interface IngestConversionResult {
  conversionId: string;
  provider: AffiliateProvider;
  externalTransactionId: string;
  status: ConversionStatus;
  cashbackId?: string | null;
  cashbackAmount: string;
  isDuplicate: boolean;
  isUnmatched: boolean;
}

/**
 * Ingests a pre-normalized conversion payload.
 * Attributes click, resolves campaign rate, performs atomic upsert,
 * and maintains financial ledger consistency without duplicate credits.
 */
export async function ingestNormalizedConversion(
  payload: NormalizedConversionPayload
): Promise<IngestConversionResult> {
  const orderAmount = new Prisma.Decimal(payload.orderAmount || 0);
  const commissionAmount = new Prisma.Decimal(payload.commissionAmount || 0);

  if (orderAmount.lessThan(0) || commissionAmount.lessThan(0)) {
    throw new ConversionServiceError(
      "Conversion order amount and commission must not be negative",
      "INVALID_AMOUNTS",
      400
    );
  }

  // 1. Resolve Click Attribution
  let matchedClick: (Prisma.AffiliateClickGetPayload<{
    include: { user: true; deal: true; merchant: true };
  }>) | null = null;

  if (payload.clickId) {
    matchedClick = await prisma.affiliateClick.findUnique({
      where: { clickId: payload.clickId },
      include: {
        user: true,
        deal: true,
        merchant: true,
      },
    });
  }

  const isClickMatched = Boolean(matchedClick);
  const effectiveStatus: ConversionStatus = isClickMatched ? payload.status : "UNMATCHED";

  const matchedClickId = matchedClick ? matchedClick.id : null;
  const matchedUserId = matchedClick && matchedClick.userId ? matchedClick.userId : null;
  const matchedMerchantId = matchedClick ? matchedClick.merchantId : null;
  const matchedDealId = matchedClick ? matchedClick.dealId : null;

  // 2. Calculate Cashback (70% of network commission for registered users; updated in Part C)
  let calculatedCashback = new Prisma.Decimal("0.00");
  if (matchedUserId && effectiveStatus !== "UNMATCHED" && commissionAmount.greaterThan(0)) {
    calculatedCashback = commissionAmount
      .mul(new Prisma.Decimal(PLATFORM_CASHBACK_PERCENT))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  // 3. Atomic Upsert & Lifecycle State Machine
  const existing = await prisma.conversion.findUnique({
    where: {
      provider_externalTransactionId: {
        provider: payload.provider,
        externalTransactionId: payload.externalTransactionId,
      },
    },
    include: {
      cashback: true,
    },
  });

  if (existing) {
    const statusChanged = existing.status !== payload.status;

    if (existing.status === "CONFIRMED" && payload.status === "CONFIRMED") {
      return {
        conversionId: existing.id,
        provider: existing.provider,
        externalTransactionId: existing.externalTransactionId,
        status: existing.status,
        cashbackId: existing.cashbackId,
        cashbackAmount: existing.cashbackAmount.toFixed(2),
        isDuplicate: true,
        isUnmatched: false,
      };
    }

    if (statusChanged && existing.cashbackId && existing.cashback) {
      const cb = existing.cashback;
      try {
        if (payload.status === "APPROVED" && cb.status === "PENDING") {
          await updateCashbackStatus(cb.id, "APPROVED");
        } else if (payload.status === "CONFIRMED") {
          if (cb.status === "PENDING") {
            await updateCashbackStatus(cb.id, "APPROVED");
          }
          if (cb.status !== "CONFIRMED" && cb.status !== "REVERSED") {
            await updateCashbackStatus(cb.id, "CONFIRMED");
          }
        } else if (payload.status === "REJECTED" && (cb.status === "PENDING" || cb.status === "APPROVED")) {
          await updateCashbackStatus(
            cb.id,
            "REJECTED",
            payload.notes || "Rejected by affiliate network postback"
          );
        } else if (payload.status === "REVERSED" && cb.status === "CONFIRMED") {
          await updateCashbackStatus(
            cb.id,
            "REVERSED",
            payload.notes || "Reversed / returned by affiliate network postback"
          );
        }
      } catch (err: unknown) {
        console.warn(`[ConversionService] Warning during cashback status sync: ${(err as Error).message}`);
      }
    }

    const updated = await prisma.conversion.update({
      where: { id: existing.id },
      data: {
        status: existing.status === "CONFIRMED" && payload.status !== "REVERSED" ? existing.status : payload.status,
        orderAmount,
        commissionAmount,
        rawPayload: payload.rawPayload ? (payload.rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
        reconciliationNotes: payload.notes
          ? `${existing.reconciliationNotes ? existing.reconciliationNotes + " | " : ""}${payload.notes}`
          : existing.reconciliationNotes,
      },
    });

    return {
      conversionId: updated.id,
      provider: updated.provider,
      externalTransactionId: updated.externalTransactionId,
      status: updated.status,
      cashbackId: updated.cashbackId,
      cashbackAmount: updated.cashbackAmount.toFixed(2),
      isDuplicate: true,
      isUnmatched: updated.status === "UNMATCHED",
    };
  }

  let createdCashbackId: string | null = null;

  if (matchedUserId && effectiveStatus !== "UNMATCHED" && calculatedCashback.greaterThan(0)) {
    const extRef = `${payload.provider}_${payload.externalTransactionId}`;

    const newCashback = await prisma.cashback.create({
      data: {
        userId: matchedUserId,
        merchantId: matchedMerchantId,
        amount: calculatedCashback,
        status: "PENDING",
        externalReferenceId: extRef,
        description: `Cashback from ${payload.provider} purchase (${payload.externalTransactionId})`,
      },
    });

    createdCashbackId = newCashback.id;

    try {
      if (effectiveStatus === "APPROVED") {
        await updateCashbackStatus(newCashback.id, "APPROVED");
      } else if (effectiveStatus === "CONFIRMED") {
        await updateCashbackStatus(newCashback.id, "APPROVED");
        await updateCashbackStatus(newCashback.id, "CONFIRMED");
      } else if (effectiveStatus === "REJECTED") {
        await updateCashbackStatus(newCashback.id, "REJECTED", payload.notes || "Rejected at ingestion");
      }
    } catch (err: unknown) {
      console.warn(`[ConversionService] Warning during initial cashback status transition: ${(err as Error).message}`);
    }
  }

  const reconciliationNotes = !isClickMatched
    ? `Unmatched conversion: clickId '${payload.clickId || "none"}' not found.`
    : !matchedUserId
    ? `Guest click attribution: no registered user attached to click ${payload.clickId}`
    : payload.notes || null;

  const conversion = await prisma.conversion.create({
    data: {
      provider: payload.provider,
      externalTransactionId: payload.externalTransactionId,
      affiliateClickId: matchedClickId,
      userId: matchedUserId,
      merchantId: matchedMerchantId,
      dealId: matchedDealId,
      cashbackId: createdCashbackId,
      orderAmount,
      commissionAmount,
      cashbackAmount: calculatedCashback,
      currency: payload.currency || "INR",
      status: effectiveStatus,
      convertedAt: payload.convertedAt || new Date(),
      rawPayload: payload.rawPayload ? (payload.rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
      reconciliationNotes,
    },
  });

  return {
    conversionId: conversion.id,
    provider: conversion.provider,
    externalTransactionId: conversion.externalTransactionId,
    status: conversion.status,
    cashbackId: conversion.cashbackId,
    cashbackAmount: conversion.cashbackAmount.toFixed(2),
    isDuplicate: false,
    isUnmatched: effectiveStatus === "UNMATCHED",
  };
}

/**
 * Ingests an incoming affiliate network conversion postback/webhook.
 * Validates authenticity, parses payload, attributes click, calculates cashback,
 * and maintains financial consistency without duplicate wallet credits.
 */
export async function ingestConversion(
  provider: AffiliateProvider | string,
  rawBody: string | Record<string, unknown>,
  headers: WebhookHeaders = {},
  queryParams?: Record<string, string> | URLSearchParams
): Promise<IngestConversionResult> {
  const adapter = getAdapter(provider);

  // 1. Authenticate webhook signature / token
  const bodyString = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
  const verification = await adapter.verifyWebhook(headers, bodyString, queryParams);
  if (!verification.valid) {
    throw new ConversionServiceError(
      verification.error || "Webhook authentication failed",
      "UNAUTHORIZED_WEBHOOK",
      401
    );
  }

  // 2. Parse and normalize incoming conversion payload
  const payload = await adapter.parsePayload(rawBody, queryParams);

  // 3. Ingest normalized payload
  return ingestNormalizedConversion(payload);
}

/**
 * Admin: Query paginated conversions with filtering, search, and relations.
 */
export async function getAdminConversions(query: AdminConversionsQueryInput) {
  const {
    page,
    limit,
    provider,
    status,
    merchantId,
    dealId,
    userId,
    startDate,
    endDate,
    search,
    sortBy,
    sortOrder,
  } = query;

  const skip = (page - 1) * limit;
  const where: Prisma.ConversionWhereInput = {};

  if (provider) where.provider = provider;
  if (status) where.status = status;
  if (merchantId) where.merchantId = merchantId;
  if (dealId) where.dealId = dealId;
  if (userId) where.userId = userId;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  if (search) {
    where.OR = [
      { externalTransactionId: { contains: search, mode: "insensitive" } },
      { affiliateClick: { clickId: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [conversions, total] = await Promise.all([
    prisma.conversion.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            mobileNumber: true,
          },
        },
        merchant: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
          },
        },
        deal: {
          select: {
            id: true,
            title: true,
            slug: true,
          },
        },
        affiliateClick: {
          select: {
            id: true,
            clickId: true,
            clickedAt: true,
            source: true,
          },
        },
        cashback: {
          select: {
            id: true,
            amount: true,
            status: true,
            confirmedAt: true,
          },
        },
      },
    }),
    prisma.conversion.count({ where }),
  ]);

  return {
    conversions: conversions.map((c) => ({
      ...c,
      orderAmount: c.orderAmount.toFixed(2),
      commissionAmount: c.commissionAmount.toFixed(2),
      cashbackAmount: c.cashbackAmount.toFixed(2),
      cashback: c.cashback
        ? {
            ...c.cashback,
            amount: c.cashback.amount.toFixed(2),
          }
        : null,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Admin: Get complete conversion record by ID including raw payload and audit details.
 */
export async function getAdminConversionById(id: string) {
  const conversion = await prisma.conversion.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          mobileNumber: true,
        },
      },
      merchant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
        },
      },
      deal: {
        select: {
          id: true,
          title: true,
          slug: true,
        },
      },
      affiliateClick: {
        select: {
          id: true,
          clickId: true,
          clickedAt: true,
          source: true,
          landingDestination: true,
        },
      },
      cashback: {
        select: {
          id: true,
          amount: true,
          status: true,
          createdAt: true,
          confirmedAt: true,
          walletTransaction: {
            select: {
              id: true,
              amount: true,
              type: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!conversion) {
    throw new ConversionServiceError("Conversion record not found", "NOT_FOUND", 404);
  }

  return {
    ...conversion,
    orderAmount: conversion.orderAmount.toFixed(2),
    commissionAmount: conversion.commissionAmount.toFixed(2),
    cashbackAmount: conversion.cashbackAmount.toFixed(2),
    cashback: conversion.cashback
      ? {
          ...conversion.cashback,
          amount: conversion.cashback.amount.toFixed(2),
          walletTransaction: conversion.cashback.walletTransaction
            ? {
                ...conversion.cashback.walletTransaction,
                amount: conversion.cashback.walletTransaction.amount.toFixed(2),
              }
            : null,
        }
      : null,
  };
}

/**
 * Admin: Aggregate conversion metrics, total volumes, and provider distributions.
 */
export async function getAdminConversionsSummary(query: AdminConversionsSummaryQueryInput) {
  const { provider, merchantId, dealId, startDate, endDate } = query;

  const where: Prisma.ConversionWhereInput = {};
  if (provider) where.provider = provider;
  if (merchantId) where.merchantId = merchantId;
  if (dealId) where.dealId = dealId;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [
    totalCount,
    pendingCount,
    approvedCount,
    confirmedCount,
    rejectedCount,
    reversedCount,
    unmatchedCount,
    orderSums,
    commissionSums,
    cashbackSums,
    byProviderRaw,
  ] = await Promise.all([
    prisma.conversion.count({ where }),
    prisma.conversion.count({ where: { ...where, status: "PENDING" } }),
    prisma.conversion.count({ where: { ...where, status: "APPROVED" } }),
    prisma.conversion.count({ where: { ...where, status: "CONFIRMED" } }),
    prisma.conversion.count({ where: { ...where, status: "REJECTED" } }),
    prisma.conversion.count({ where: { ...where, status: "REVERSED" } }),
    prisma.conversion.count({ where: { ...where, status: "UNMATCHED" } }),
    prisma.conversion.aggregate({ where, _sum: { orderAmount: true } }),
    prisma.conversion.aggregate({ where, _sum: { commissionAmount: true } }),
    prisma.conversion.aggregate({ where, _sum: { cashbackAmount: true } }),
    prisma.conversion.groupBy({
      by: ["provider"],
      where,
      _count: { _all: true },
      _sum: { orderAmount: true, commissionAmount: true, cashbackAmount: true },
    }),
  ]);

  const zero = new Prisma.Decimal("0.00");

  return {
    totalConversions: totalCount,
    statusCounts: {
      pending: pendingCount,
      approved: approvedCount,
      confirmed: confirmedCount,
      rejected: rejectedCount,
      reversed: reversedCount,
      unmatched: unmatchedCount,
    },
    totals: {
      totalOrderAmount: (orderSums._sum.orderAmount ?? zero).toFixed(2),
      totalCommissionAmount: (commissionSums._sum.commissionAmount ?? zero).toFixed(2),
      totalCashbackAmount: (cashbackSums._sum.cashbackAmount ?? zero).toFixed(2),
      currency: "INR",
    },
    byProvider: byProviderRaw.map((p) => ({
      provider: p.provider,
      count: p._count._all,
      totalOrderAmount: (p._sum.orderAmount ?? zero).toFixed(2),
      totalCommissionAmount: (p._sum.commissionAmount ?? zero).toFixed(2),
      totalCashbackAmount: (p._sum.cashbackAmount ?? zero).toFixed(2),
    })),
  };
}

/**
 * Admin: Reconcile an unmatched or misattributed conversion.
 * Links conversion to a valid click or user, recalculates cashback, and synchronizes the ledger.
 */
export async function reconcileConversion(id: string, input: ReconcileConversionInput) {
  const conversion = await prisma.conversion.findUnique({
    where: { id },
    include: {
      cashback: true,
    },
  });

  if (!conversion) {
    throw new ConversionServiceError("Conversion record not found", "NOT_FOUND", 404);
  }

  let newClickId = conversion.affiliateClickId;
  let newUserId = input.userId ?? conversion.userId;
  let newMerchantId = input.merchantId ?? conversion.merchantId;
  let newDealId = input.dealId ?? conversion.dealId;

  if (input.clickId) {
    const click = await prisma.affiliateClick.findUnique({
      where: { clickId: input.clickId },
    });

    if (!click) {
      throw new ConversionServiceError("Specified clickId was not found", "CLICK_NOT_FOUND", 404);
    }

    newClickId = click.id;
    newUserId = click.userId ?? newUserId;
    newMerchantId = click.merchantId ?? newMerchantId;
    newDealId = click.dealId ?? newDealId;
  }

  // Recalculate cashback amount
  let newCashbackAmount = conversion.cashbackAmount;
  if (newUserId && conversion.commissionAmount.greaterThan(0)) {
    newCashbackAmount = conversion.commissionAmount
      .mul(new Prisma.Decimal(PLATFORM_CASHBACK_PERCENT))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  const targetStatus: ConversionStatus =
    input.status ?? (conversion.status === "UNMATCHED" ? "PENDING" : conversion.status);

  let cashbackId = conversion.cashbackId;

  // If user is now attached and no cashback record exists, create one
  if (newUserId && !cashbackId && newCashbackAmount.greaterThan(0)) {
    const extRef = `${conversion.provider}_${conversion.externalTransactionId}`;
    const cb = await prisma.cashback.create({
      data: {
        userId: newUserId,
        merchantId: newMerchantId,
        amount: newCashbackAmount,
        status: "PENDING",
        externalReferenceId: extRef,
        description: `Reconciled cashback from ${conversion.provider} (${conversion.externalTransactionId})`,
      },
    });
    cashbackId = cb.id;

    if (targetStatus === "APPROVED") {
      await updateCashbackStatus(cb.id, "APPROVED");
    } else if (targetStatus === "CONFIRMED") {
      await updateCashbackStatus(cb.id, "APPROVED");
      await updateCashbackStatus(cb.id, "CONFIRMED");
    }
  }

  const updatedNotes = input.notes
    ? `${conversion.reconciliationNotes ? conversion.reconciliationNotes + " | " : ""}Reconciliation note: ${input.notes}`
    : conversion.reconciliationNotes;

  const updated = await prisma.conversion.update({
    where: { id },
    data: {
      affiliateClickId: newClickId,
      userId: newUserId,
      merchantId: newMerchantId,
      dealId: newDealId,
      cashbackId,
      cashbackAmount: newCashbackAmount,
      status: targetStatus,
      reconciliationNotes: updatedNotes,
    },
    include: {
      user: { select: { id: true, email: true, name: true } },
      merchant: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true } },
      cashback: true,
    },
  });

  return {
    ...updated,
    orderAmount: updated.orderAmount.toFixed(2),
    commissionAmount: updated.commissionAmount.toFixed(2),
    cashbackAmount: updated.cashbackAmount.toFixed(2),
  };
}
