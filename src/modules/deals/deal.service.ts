import { prisma } from "@/src/lib/prisma";
import type {
  CreateDealInput,
  UpdateDealInput,
  DealQueryInput,
} from "@/src/lib/validations/deal.schema";
import type { Deal, Prisma } from "@/src/generated/prisma/client";

export interface DealWithMerchant extends Deal {
  merchant?: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    isActive: boolean;
  };
}

export interface PaginatedDealsResponse {
  deals: DealWithMerchant[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class DealServiceError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = "DealServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function getPublicDeals(
  query: DealQueryInput
): Promise<PaginatedDealsResponse> {
  const { page, limit, search, merchantId, merchant, sortBy, sortOrder } = query;
  const skip = (page - 1) * limit;
  const now = new Date();

  const where: Prisma.DealWhereInput = {
    isActive: true,
    merchant: {
      isActive: true,
      ...(merchant ? { slug: merchant } : {}),
    },
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
      { slug: { contains: search, mode: "insensitive" } },
    ];
  }

  const [deals, total] = await Promise.all([
    prisma.deal.findMany({
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
    prisma.deal.count({ where }),
  ]);

  return {
    deals,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getPublicDealBySlug(
  slug: string
): Promise<DealWithMerchant | null> {
  const now = new Date();

  const deal = await prisma.deal.findFirst({
    where: {
      slug,
      isActive: true,
      merchant: { isActive: true },
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

  return deal;
}

export async function getAdminDeals(
  query: DealQueryInput
): Promise<PaginatedDealsResponse> {
  const { page, limit, search, merchantId, merchant, isActive, sortBy, sortOrder } =
    query;
  const skip = (page - 1) * limit;

  const where: Prisma.DealWhereInput = {
    ...(isActive !== undefined ? { isActive } : {}),
    ...(merchantId ? { merchantId } : {}),
    ...(merchant ? { merchant: { slug: merchant } } : {}),
  };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
    ];
  }

  const [deals, total] = await Promise.all([
    prisma.deal.findMany({
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
    prisma.deal.count({ where }),
  ]);

  return {
    deals,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getAdminDealById(
  id: string
): Promise<DealWithMerchant | null> {
  const deal = await prisma.deal.findUnique({
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

  return deal;
}

export async function createDeal(input: CreateDealInput): Promise<Deal> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: input.merchantId },
  });

  if (!merchant) {
    throw new DealServiceError("Merchant not found", "MERCHANT_NOT_FOUND", 404);
  }

  const deal = await prisma.deal.create({
    data: {
      merchantId: input.merchantId,
      title: input.title,
      slug: input.slug,
      description: input.description,
      imageUrl: input.imageUrl,
      originalPrice: input.originalPrice != null ? input.originalPrice : null,
      dealPrice: input.dealPrice != null ? input.dealPrice : null,
      affiliateUrl: input.affiliateUrl,
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

  return deal;
}

export async function updateDeal(
  id: string,
  input: UpdateDealInput
): Promise<Deal> {
  const existing = await prisma.deal.findUnique({ where: { id } });
  if (!existing) {
    throw new DealServiceError("Deal not found", "DEAL_NOT_FOUND", 404);
  }

  if (input.merchantId && input.merchantId !== existing.merchantId) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: input.merchantId },
    });
    if (!merchant) {
      throw new DealServiceError("Merchant not found", "MERCHANT_NOT_FOUND", 404);
    }
  }

  const effectiveOriginal =
    input.originalPrice !== undefined
      ? input.originalPrice
      : existing.originalPrice != null
      ? Number(existing.originalPrice)
      : null;

  const effectiveDeal =
    input.dealPrice !== undefined
      ? input.dealPrice
      : existing.dealPrice != null
      ? Number(existing.dealPrice)
      : null;

  if (
    effectiveOriginal != null &&
    effectiveDeal != null &&
    effectiveDeal > effectiveOriginal
  ) {
    throw new DealServiceError(
      "Deal price must be less than or equal to original price",
      "INVALID_PRICE_RANGE",
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
    throw new DealServiceError(
      "End date must be after or equal to start date",
      "INVALID_DATE_RANGE",
      400
    );
  }

  const data: Prisma.DealUncheckedUpdateInput = {};
  if (input.merchantId !== undefined) data.merchantId = input.merchantId;
  if (input.title !== undefined) data.title = input.title;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.description !== undefined) data.description = input.description;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
  if (input.originalPrice !== undefined) data.originalPrice = input.originalPrice;
  if (input.dealPrice !== undefined) data.dealPrice = input.dealPrice;
  if (input.affiliateUrl !== undefined) data.affiliateUrl = input.affiliateUrl;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.endDate !== undefined) data.endDate = input.endDate;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await prisma.deal.update({
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

export async function deactivateDeal(id: string): Promise<Deal> {
  const existing = await prisma.deal.findUnique({ where: { id } });
  if (!existing) {
    throw new DealServiceError("Deal not found", "DEAL_NOT_FOUND", 404);
  }

  const deactivated = await prisma.deal.update({
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
