import { prisma } from "@/src/lib/prisma";
import { Prisma, Campaign, AffiliateProvider, CampaignShareType } from "@/src/generated/prisma/client";
import type {
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignQueryInput,
} from "@/src/lib/validations/campaign.schema";

export class CampaignServiceError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = "CampaignServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ImmutableCampaignSnapshot {
  campaignId: string;
  campaignName: string;
  shareType: CampaignShareType;
  userShareValue: string;
  maxCashbackPerOrder: string | null;
  minOrderAmount: string | null;
  scope: {
    merchantId: string | null;
    dealId: string | null;
    network: AffiliateProvider | null;
  };
  eligibleOrderAmount: string;
  calculatedCashbackAmount: string;
  currency: string;
  roundingPolicy: "ROUND_HALF_UP_2_DECIMALS";
  calculatedAt: string;
}

export interface CalculationResult {
  campaign: Campaign | null;
  cashbackAmount: Prisma.Decimal;
  snapshot: ImmutableCampaignSnapshot | null;
  isEligible: boolean;
  ineligibilityReason?: string;
}

export interface PaginatedCampaignsResponse {
  campaigns: Array<
    Campaign & {
      merchant: { id: string; name: string; slug: string } | null;
      deal: { id: string; title: string; slug: string } | null;
      _count: { conversions: number };
    }
  >;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Creates a new cashback campaign after validating foreign key relations.
 */
export async function createCampaign(
  input: CreateCampaignInput,
  createdByAdminId?: string
): Promise<Campaign> {
  // 1. Validate Merchant if provided
  if (input.merchantId) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: input.merchantId },
    });
    if (!merchant) {
      throw new CampaignServiceError("Merchant not found", "MERCHANT_NOT_FOUND", 404);
    }
  }

  // 2. Validate Deal if provided
  if (input.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: input.dealId },
    });
    if (!deal) {
      throw new CampaignServiceError("Deal not found", "DEAL_NOT_FOUND", 404);
    }
    // If merchantId is also provided, ensure consistency
    if (input.merchantId && deal.merchantId !== input.merchantId) {
      throw new CampaignServiceError(
        "Deal does not belong to the specified merchant",
        "MERCHANT_DEAL_MISMATCH",
        400
      );
    }
  }

  return prisma.campaign.create({
    data: {
      name: input.name,
      description: input.description,
      merchantId: input.merchantId ?? null,
      dealId: input.dealId ?? null,
      network: input.network ?? null,
      shareType: input.shareType,
      userShareValue: new Prisma.Decimal(input.userShareValue),
      maxCashbackPerOrder:
        input.maxCashbackPerOrder !== undefined && input.maxCashbackPerOrder !== null
          ? new Prisma.Decimal(input.maxCashbackPerOrder)
          : null,
      maxCashbackPerUser:
        input.maxCashbackPerUser !== undefined && input.maxCashbackPerUser !== null
          ? new Prisma.Decimal(input.maxCashbackPerUser)
          : null,
      maxCampaignBudget:
        input.maxCampaignBudget !== undefined && input.maxCampaignBudget !== null
          ? new Prisma.Decimal(input.maxCampaignBudget)
          : null,
      minOrderAmount:
        input.minOrderAmount !== undefined && input.minOrderAmount !== null
          ? new Prisma.Decimal(input.minOrderAmount)
          : null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      isActive: input.isActive ?? true,
      priority: input.priority ?? 0,
      createdByAdminId: createdByAdminId ?? null,
    },
  });
}

/**
 * Retrieves paginated campaigns for admin management.
 */
export async function getAdminCampaigns(
  query: CampaignQueryInput
): Promise<PaginatedCampaignsResponse> {
  const { page, limit, search, merchantId, dealId, network, isActive, sortBy, sortOrder } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.CampaignWhereInput = {};

  if (merchantId) where.merchantId = merchantId;
  if (dealId) where.dealId = dealId;
  if (network) where.network = network;
  if (isActive !== undefined) where.isActive = isActive;

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        merchant: {
          select: { id: true, name: true, slug: true },
        },
        deal: {
          select: { id: true, title: true, slug: true },
        },
        _count: {
          select: { conversions: true },
        },
      },
    }),
    prisma.campaign.count({ where }),
  ]);

  return {
    campaigns,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieves single campaign by ID with relation metrics.
 */
export async function getAdminCampaignById(id: string) {
  return prisma.campaign.findUnique({
    where: { id },
    include: {
      merchant: {
        select: { id: true, name: true, slug: true, websiteUrl: true },
      },
      deal: {
        select: { id: true, title: true, slug: true, dealPrice: true },
      },
      _count: {
        select: { conversions: true },
      },
    },
  });
}

/**
 * Updates an existing campaign.
 */
export async function updateCampaign(
  id: string,
  input: UpdateCampaignInput
): Promise<Campaign> {
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) {
    throw new CampaignServiceError("Campaign not found", "CAMPAIGN_NOT_FOUND", 404);
  }

  // Validate Merchant if updated
  if (input.merchantId) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: input.merchantId },
    });
    if (!merchant) {
      throw new CampaignServiceError("Merchant not found", "MERCHANT_NOT_FOUND", 404);
    }
  }

  // Validate Deal if updated
  if (input.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: input.dealId },
    });
    if (!deal) {
      throw new CampaignServiceError("Deal not found", "DEAL_NOT_FOUND", 404);
    }
  }

  const data: Prisma.CampaignUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.merchantId !== undefined) {
    data.merchant = input.merchantId ? { connect: { id: input.merchantId } } : { disconnect: true };
  }
  if (input.dealId !== undefined) {
    data.deal = input.dealId ? { connect: { id: input.dealId } } : { disconnect: true };
  }
  if (input.network !== undefined) data.network = input.network;
  if (input.shareType !== undefined) data.shareType = input.shareType;
  if (input.userShareValue !== undefined) {
    data.userShareValue = new Prisma.Decimal(input.userShareValue);
  }
  if (input.maxCashbackPerOrder !== undefined) {
    data.maxCashbackPerOrder =
      input.maxCashbackPerOrder !== null ? new Prisma.Decimal(input.maxCashbackPerOrder) : null;
  }
  if (input.maxCashbackPerUser !== undefined) {
    data.maxCashbackPerUser =
      input.maxCashbackPerUser !== null ? new Prisma.Decimal(input.maxCashbackPerUser) : null;
  }
  if (input.maxCampaignBudget !== undefined) {
    data.maxCampaignBudget =
      input.maxCampaignBudget !== null ? new Prisma.Decimal(input.maxCampaignBudget) : null;
  }
  if (input.minOrderAmount !== undefined) {
    data.minOrderAmount =
      input.minOrderAmount !== null ? new Prisma.Decimal(input.minOrderAmount) : null;
  }
  if (input.startDate !== undefined) {
    data.startDate = input.startDate ? new Date(input.startDate) : null;
  }
  if (input.endDate !== undefined) {
    data.endDate = input.endDate ? new Date(input.endDate) : null;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.priority !== undefined) data.priority = input.priority;

  return prisma.campaign.update({
    where: { id },
    data,
  });
}

/**
 * Safely deactivates or deletes a campaign.
 * Preserves historical audit records: if conversions reference this campaign,
 * performs soft-deactivation (isActive=false) rather than destructive hard-delete.
 */
export async function deleteOrDeactivateCampaign(
  id: string
): Promise<{ deleted: boolean; deactivated: boolean; message: string }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      _count: {
        select: { conversions: true },
      },
    },
  });

  if (!campaign) {
    throw new CampaignServiceError("Campaign not found", "CAMPAIGN_NOT_FOUND", 404);
  }

  if (campaign._count.conversions > 0) {
    await prisma.campaign.update({
      where: { id },
      data: { isActive: false },
    });
    return {
      deleted: false,
      deactivated: true,
      message: `Campaign has ${campaign._count.conversions} historical conversion references. Deactivated successfully to preserve financial audit trail.`,
    };
  }

  await prisma.campaign.delete({ where: { id } });
  return {
    deleted: true,
    deactivated: false,
    message: "Campaign deleted successfully.",
  };
}

/**
 * Deterministic Campaign Selection Policy:
 * 1. Must be active (isActive = true).
 * 2. Effective date check: startDate <= convertedAt <= endDate.
 * 3. Specificity hierarchy:
 *    - Level 4: Deal-specific (dealId = params.dealId)
 *    - Level 3: Merchant-specific (merchantId = params.merchantId AND dealId IS NULL)
 *    - Level 2: Network-specific (network = params.network AND merchantId IS NULL AND dealId IS NULL)
 *    - Level 1: Global default (merchantId IS NULL AND dealId IS NULL AND network IS NULL)
 * 4. Tie-breaking within same level: priority DESC, createdAt DESC, id ASC.
 * 5. Exactly 1 winning campaign selected (no accidental stacking).
 */
export async function selectEligibleCampaign(params: {
  dealId?: string | null;
  merchantId?: string | null;
  network?: AffiliateProvider | null;
  convertedAt?: Date;
}): Promise<Campaign | null> {
  const convertedAt = params.convertedAt || new Date();

  // Query all active candidate campaigns matching any applicable scope
  const candidates = await prisma.campaign.findMany({
    where: {
      isActive: true,
      OR: [
        // Level 4: Deal-specific
        ...(params.dealId ? [{ dealId: params.dealId }] : []),
        // Level 3: Merchant-specific
        ...(params.merchantId ? [{ merchantId: params.merchantId, dealId: null }] : []),
        // Level 2: Network-specific
        ...(params.network ? [{ network: params.network, merchantId: null, dealId: null }] : []),
        // Level 1: Global platform campaign
        { merchantId: null, dealId: null, network: null },
      ],
    },
  });

  if (candidates.length === 0) {
    return null;
  }

  // Filter candidates by valid date bounds
  const activeInDateRange = candidates.filter((c) => {
    if (c.startDate && c.startDate > convertedAt) return false;
    if (c.endDate && c.endDate < convertedAt) return false;
    return true;
  });

  if (activeInDateRange.length === 0) {
    return null;
  }

  // Rank by specificity score
  function getSpecificityScore(c: Campaign): number {
    if (params.dealId && c.dealId === params.dealId) return 4;
    if (params.merchantId && c.merchantId === params.merchantId && !c.dealId) return 3;
    if (params.network && c.network === params.network && !c.merchantId && !c.dealId) return 2;
    if (!c.merchantId && !c.dealId && !c.network) return 1;
    return 0;
  }

  // Sort deterministically
  activeInDateRange.sort((a, b) => {
    const scoreDiff = getSpecificityScore(b) - getSpecificityScore(a);
    if (scoreDiff !== 0) return scoreDiff;

    const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;

    const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;

    return a.id.localeCompare(b.id);
  });

  return activeInDateRange[0];
}

/**
 * Calculates deterministic cashback and generates an immutable calculation snapshot.
 * Enforces Decimal precision, minimum order values, budget caps, and rounding rules.
 */
export async function calculateCashbackForConversion(params: {
  orderAmount: Prisma.Decimal;
  dealId?: string | null;
  merchantId?: string | null;
  network?: AffiliateProvider | null;
  convertedAt?: Date;
  userId?: string | null;
}): Promise<CalculationResult> {
  const zero = new Prisma.Decimal("0.00");
  const orderAmount = params.orderAmount;

  if (orderAmount.lessThanOrEqualTo(zero)) {
    return {
      campaign: null,
      cashbackAmount: zero,
      snapshot: null,
      isEligible: false,
      ineligibilityReason: "Order amount is zero or negative",
    };
  }

  const campaign = await selectEligibleCampaign(params);

  if (!campaign) {
    return {
      campaign: null,
      cashbackAmount: zero,
      snapshot: null,
      isEligible: false,
      ineligibilityReason: "No active eligible campaign matched conversion scope",
    };
  }

  // 1. Minimum order amount check
  if (campaign.minOrderAmount && orderAmount.lessThan(campaign.minOrderAmount)) {
    return {
      campaign,
      cashbackAmount: zero,
      snapshot: null,
      isEligible: false,
      ineligibilityReason: `Order amount (₹${orderAmount.toFixed(2)}) is below campaign minimum order threshold (₹${campaign.minOrderAmount.toFixed(2)})`,
    };
  }

  // 2. Max Campaign Budget check
  if (campaign.maxCampaignBudget) {
    const budgetUsedAgg = await prisma.conversion.aggregate({
      where: {
        campaignId: campaign.id,
        status: { in: ["PENDING", "APPROVED", "CONFIRMED"] },
      },
      _sum: { cashbackAmount: true },
    });
    const budgetUsed = budgetUsedAgg._sum.cashbackAmount ?? zero;
    if (budgetUsed.greaterThanOrEqualTo(campaign.maxCampaignBudget)) {
      return {
        campaign,
        cashbackAmount: zero,
        snapshot: null,
        isEligible: false,
        ineligibilityReason: `Campaign total budget cap (₹${campaign.maxCampaignBudget.toFixed(2)}) has been exhausted`,
      };
    }
  }

  // 3. User Max Cashback Cap check
  let userRemainingCap: Prisma.Decimal | null = null;
  if (campaign.maxCashbackPerUser && params.userId) {
    const userEarnedAgg = await prisma.conversion.aggregate({
      where: {
        campaignId: campaign.id,
        userId: params.userId,
        status: { in: ["PENDING", "APPROVED", "CONFIRMED"] },
      },
      _sum: { cashbackAmount: true },
    });
    const userEarned = userEarnedAgg._sum.cashbackAmount ?? zero;
    userRemainingCap = campaign.maxCashbackPerUser.sub(userEarned);
    if (userRemainingCap.lessThanOrEqualTo(zero)) {
      return {
        campaign,
        cashbackAmount: zero,
        snapshot: null,
        isEligible: false,
        ineligibilityReason: `User has reached the maximum allowed cashback cap (₹${campaign.maxCashbackPerUser.toFixed(2)}) for this campaign`,
      };
    }
  }

  // 4. Calculate Cashback based on shareType
  let calculatedAmount = zero;

  if (campaign.shareType === "PERCENTAGE") {
    // Formula: orderAmount * (userShareValue / 100)
    calculatedAmount = orderAmount
      .mul(campaign.userShareValue)
      .div(new Prisma.Decimal(100))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  } else if (campaign.shareType === "FIXED") {
    // Fixed cashback: capped at order amount if order is smaller than fixed value
    calculatedAmount = Prisma.Decimal.min(
      campaign.userShareValue,
      orderAmount
    ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  // 5. Apply Maximum Order Cap
  if (campaign.maxCashbackPerOrder) {
    calculatedAmount = Prisma.Decimal.min(calculatedAmount, campaign.maxCashbackPerOrder);
  }

  // 6. Apply User Remaining Cap
  if (userRemainingCap !== null) {
    calculatedAmount = Prisma.Decimal.min(calculatedAmount, userRemainingCap);
  }

  // Final rounding guarantee
  const finalCashback = calculatedAmount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  // 7. Construct Immutable Rule Snapshot
  const snapshot: ImmutableCampaignSnapshot = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    shareType: campaign.shareType,
    userShareValue: campaign.userShareValue.toFixed(2),
    maxCashbackPerOrder: campaign.maxCashbackPerOrder ? campaign.maxCashbackPerOrder.toFixed(2) : null,
    minOrderAmount: campaign.minOrderAmount ? campaign.minOrderAmount.toFixed(2) : null,
    scope: {
      merchantId: campaign.merchantId,
      dealId: campaign.dealId,
      network: campaign.network,
    },
    eligibleOrderAmount: orderAmount.toFixed(2),
    calculatedCashbackAmount: finalCashback.toFixed(2),
    currency: "INR",
    roundingPolicy: "ROUND_HALF_UP_2_DECIMALS",
    calculatedAt: new Date().toISOString(),
  };

  return {
    campaign,
    cashbackAmount: finalCashback,
    snapshot,
    isEligible: true,
  };
}
