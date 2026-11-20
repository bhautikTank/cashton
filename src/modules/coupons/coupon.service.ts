import { prisma } from "@/src/lib/prisma";
import type {
  CreateCouponInput,
  UpdateCouponInput,
  CouponQueryInput,
} from "@/src/lib/validations/coupon.schema";
import type { Coupon, Prisma } from "@/src/generated/prisma/client";

export interface CouponWithMerchant extends Coupon {
  merchant?: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    isActive: boolean;
  };
}

export interface PaginatedCouponsResponse {
  coupons: CouponWithMerchant[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class CouponServiceError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = "CouponServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function getPublicCoupons(
  query: CouponQueryInput
): Promise<PaginatedCouponsResponse> {
  const { page, limit, search, merchantId, merchant, discountType, sortBy, sortOrder } =
    query;
  const skip = (page - 1) * limit;
  const now = new Date();

  const where: Prisma.CouponWhereInput = {
    isActive: true,
    merchant: {
      isActive: true,
      ...(merchant ? { slug: merchant } : {}),
    },
    ...(discountType ? { discountType } : {}),
    AND: [
      {
        OR: [{ startDate: null }, { startDate: { lte: now } }],
      },
      {
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
    ],
  };

  if (merchantId) {
    where.merchantId = merchantId;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
    ];
  }

  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            websiteUrl: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.coupon.count({ where }),
  ]);

  return {
    coupons,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getPublicCouponById(
  idOrCode: string
): Promise<CouponWithMerchant | null> {
  const now = new Date();

  const coupon = await prisma.coupon.findFirst({
    where: {
      isActive: true,
      merchant: { isActive: true },
      OR: [{ id: idOrCode }, { code: idOrCode.toUpperCase() }],
      AND: [
        {
          OR: [{ startDate: null }, { startDate: { lte: now } }],
        },
        {
          OR: [{ endDate: null }, { endDate: { gte: now } }],
        },
      ],
    },
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          websiteUrl: true,
          isActive: true,
        },
      },
    },
  });

  return coupon;
}

export async function getAdminCoupons(
  query: CouponQueryInput
): Promise<PaginatedCouponsResponse> {
  const {
    page,
    limit,
    search,
    merchantId,
    merchant,
    discountType,
    isActive,
    sortBy,
    sortOrder,
  } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.CouponWhereInput = {
    ...(isActive !== undefined ? { isActive } : {}),
    ...(merchantId ? { merchantId } : {}),
    ...(merchant ? { merchant: { slug: merchant } } : {}),
    ...(discountType ? { discountType } : {}),
  };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
    ];
  }

  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            websiteUrl: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.coupon.count({ where }),
  ]);

  return {
    coupons,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getAdminCouponById(
  id: string
): Promise<CouponWithMerchant | null> {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          websiteUrl: true,
          isActive: true,
        },
      },
    },
  });

  return coupon;
}

export async function createCoupon(input: CreateCouponInput): Promise<Coupon> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: input.merchantId },
  });

  if (!merchant) {
    throw new CouponServiceError("Merchant not found", "MERCHANT_NOT_FOUND", 404);
  }

  const coupon = await prisma.coupon.create({
    data: {
      merchantId: input.merchantId,
      title: input.title,
      code: input.code,
      description: input.description,
      discountType: input.discountType,
      discountValue: input.discountValue,
      minimumPurchase:
        input.minimumPurchase != null ? input.minimumPurchase : null,
      maximumDiscount:
        input.maximumDiscount != null ? input.maximumDiscount : null,
      usageLimit: input.usageLimit != null ? input.usageLimit : null,
      startDate: input.startDate,
      endDate: input.endDate,
      isActive: input.isActive ?? true,
    },
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          websiteUrl: true,
          isActive: true,
        },
      },
    },
  });

  return coupon;
}

export async function updateCoupon(
  id: string,
  input: UpdateCouponInput
): Promise<Coupon> {
  const existing = await prisma.coupon.findUnique({ where: { id } });
  if (!existing) {
    throw new CouponServiceError("Coupon not found", "COUPON_NOT_FOUND", 404);
  }

  if (input.merchantId && input.merchantId !== existing.merchantId) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: input.merchantId },
    });
    if (!merchant) {
      throw new CouponServiceError("Merchant not found", "MERCHANT_NOT_FOUND", 404);
    }
  }

  const effectiveType = input.discountType ?? existing.discountType;
  const effectiveValue =
    input.discountValue !== undefined
      ? input.discountValue
      : Number(existing.discountValue);

  if (effectiveType === "PERCENTAGE" && (effectiveValue <= 0 || effectiveValue > 100)) {
    throw new CouponServiceError(
      "Percentage discount must be between 0 and 100",
      "INVALID_DISCOUNT_VALUE",
      400
    );
  }

  if (effectiveType === "FIXED" && effectiveValue <= 0) {
    throw new CouponServiceError(
      "Fixed discount must be greater than 0",
      "INVALID_DISCOUNT_VALUE",
      400
    );
  }

  const effectiveStart =
    input.startDate !== undefined ? input.startDate : existing.startDate;
  const effectiveEnd =
    input.endDate !== undefined ? input.endDate : existing.endDate;

  if (
    effectiveStart &&
    effectiveEnd &&
    new Date(effectiveEnd) < new Date(effectiveStart)
  ) {
    throw new CouponServiceError(
      "End date must be after or equal to start date",
      "INVALID_DATE_RANGE",
      400
    );
  }

  const data: Prisma.CouponUncheckedUpdateInput = {};
  if (input.merchantId !== undefined) data.merchantId = input.merchantId;
  if (input.title !== undefined) data.title = input.title;
  if (input.code !== undefined) data.code = input.code;
  if (input.description !== undefined) data.description = input.description;
  if (input.discountType !== undefined) data.discountType = input.discountType;
  if (input.discountValue !== undefined) data.discountValue = input.discountValue;
  if (input.minimumPurchase !== undefined) data.minimumPurchase = input.minimumPurchase;
  if (input.maximumDiscount !== undefined) data.maximumDiscount = input.maximumDiscount;
  if (input.usageLimit !== undefined) data.usageLimit = input.usageLimit;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.endDate !== undefined) data.endDate = input.endDate;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await prisma.coupon.update({
    where: { id },
    data,
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          websiteUrl: true,
          isActive: true,
        },
      },
    },
  });

  return updated;
}

export async function deactivateCoupon(id: string): Promise<Coupon> {
  const existing = await prisma.coupon.findUnique({ where: { id } });
  if (!existing) {
    throw new CouponServiceError("Coupon not found", "COUPON_NOT_FOUND", 404);
  }

  const deactivated = await prisma.coupon.update({
    where: { id },
    data: { isActive: false },
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          websiteUrl: true,
          isActive: true,
        },
      },
    },
  });

  return deactivated;
}
