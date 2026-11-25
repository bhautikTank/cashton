import crypto from "crypto";
import { prisma } from "@/src/lib/prisma";
import type { Prisma } from "@/src/generated/prisma/client";
import type {
  AdminClicksQueryInput,
  AdminClicksSummaryQueryInput,
} from "@/src/lib/validations/click.schema";

export class ClickServiceError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = "ClickServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Validates that a destination URL is strictly HTTP or HTTPS, well-formed,
 * free of control characters, and free of open-redirect / scheme injection vectors.
 */
export function isSafeRedirectUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== "string") return false;
  try {
    const trimmed = urlStr.trim();
    // Reject control characters, newlines, carriage returns, or backslashes
    if (/[\x00-\x1F\x7F\s\\]/.test(trimmed)) return false;

    // Reject javascript:, data:, file:, vbscript:, blob: explicitly
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith("javascript:") ||
      lower.startsWith("data:") ||
      lower.startsWith("file:") ||
      lower.startsWith("vbscript:") ||
      lower.startsWith("blob:")
    ) {
      return false;
    }

    const parsed = new URL(trimmed);
    // Enforce protocol strictly and disallow embedded userinfo credentials
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }

    // Strip trailing FQDN dot(s) so `localhost.` or `127.0.0.1.` cannot bypass hostname/IP checks
    const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    // Hostname validation
    if (!hostname || hostname.length < 3 || !hostname.includes(".")) {
      return false;
    }

    // SSRF & Localhost Defense: Reject localhost, local domains, and internal names
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }

    // SSRF Defense: Check for IPv4 addresses and block private/loopback/cloud-metadata ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);
    if (ipv4Match) {
      const [, o1, o2, o3, o4] = ipv4Match.map(Number);
      if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;
      // 0.0.0.0/8 (Broadcast/any)
      if (o1 === 0) return false;
      // 127.0.0.0/8 (Loopback)
      if (o1 === 127) return false;
      // 10.0.0.0/8 (RFC1918 Private)
      if (o1 === 10) return false;
      // 169.254.0.0/16 (Link-local & AWS/GCP/Azure/OCI Cloud Metadata: 169.254.169.254)
      if (o1 === 169 && o2 === 254) return false;
      // 172.16.0.0/12 (RFC1918 Private: 172.16.0.0 - 172.31.255.255)
      if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
      // 192.168.0.0/16 (RFC1918 Private)
      if (o1 === 192 && o2 === 168) return false;
      // 100.64.0.0/10 (Carrier-grade NAT)
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return false;
    }

    // SSRF Defense: Reject raw IPv6 literals (e.g. [::1], [fc00::])
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a cryptographically secure, unpredictable, tamper-resistant click token.
 * Uses 24 bytes of CSPRNG entropy encoded in hex (48 hex chars prefixed with "clk_").
 */
export function generateSecureClickId(): string {
  return `clk_${crypto.randomBytes(24).toString("hex")}`;
}

/**
 * Safely formats an affiliate URL by replacing server-side tracking macros:
 * - `{tid}`: Flipkart transaction tracking ID macro (e.g. affExtParam2=...{tid}...)
 * - `{clickId}`: Generic click ID macro
 * - `{subid}`: Affiliate network sub-ID macro
 *
 * Preserves all pre-configured affiliate parameters and prevents client URL injection.
 */
export function formatAffiliateUrl(urlTemplate: string, clickId: string): string {
  if (!urlTemplate || typeof urlTemplate !== "string") return "";

  return urlTemplate
    .replace(/\{tid\}/gi, clickId)
    .replace(/\{clickid\}/gi, clickId)
    .replace(/\{subid\}/gi, clickId);
}

export interface CreateClickOptions {
  userId?: string | null;
  source?: string | null;
}

export interface CreateClickResult {
  clickId: string;
  redirectUrl: string;
}

/**
 * Creates an affiliate click record atomically after validating the deal,
 * active status, date validity, and resolving trusted destination server-side.
 * Supports deal ID (UUID) or deal slug lookup.
 */
export async function createClickRecord(
  dealIdentifier: string,
  options: CreateClickOptions = {}
): Promise<CreateClickResult> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      dealIdentifier
    );

  // 1. Fetch deal with merchant by ID or slug
  const deal = await prisma.deal.findFirst({
    where: isUuid ? { id: dealIdentifier } : { slug: dealIdentifier },
    include: {
      merchant: true,
    },
  });

  if (!deal) {
    throw new ClickServiceError("Deal not found", "DEAL_NOT_FOUND", 404);
  }

  // 2. Validate deal active status
  if (!deal.isActive) {
    throw new ClickServiceError("Deal is inactive", "DEAL_INACTIVE", 400);
  }

  // 3. Validate merchant active status
  if (!deal.merchant || !deal.merchant.isActive) {
    throw new ClickServiceError("Merchant is inactive", "MERCHANT_INACTIVE", 400);
  }

  // 4. Validate deal date bounds
  const now = new Date();
  if (deal.startDate && deal.startDate > now) {
    throw new ClickServiceError("Deal has not started yet", "DEAL_NOT_STARTED", 400);
  }
  if (deal.endDate && deal.endDate < now) {
    throw new ClickServiceError("Deal has expired", "DEAL_EXPIRED", 400);
  }

  // 5. Require explicit, non-empty affiliateUrl to prevent untracked traffic leakage
  if (
    !deal.affiliateUrl ||
    typeof deal.affiliateUrl !== "string" ||
    deal.affiliateUrl.trim().length === 0
  ) {
    throw new ClickServiceError(
      "Deal affiliate URL is not configured",
      "INVALID_DESTINATION",
      400
    );
  }
  const rawDestination = deal.affiliateUrl.trim();

  // 6. Generate cryptographically unpredictable clickId
  const clickId = generateSecureClickId();

  // 7. Resolve affiliate template macros (e.g. Flipkart {tid}) server-side
  const destination = formatAffiliateUrl(rawDestination, clickId);

  if (!isSafeRedirectUrl(destination)) {
    throw new ClickServiceError(
      "Deal destination URL is invalid or unsafe",
      "INVALID_DESTINATION",
      400
    );
  }

  // 8. Store click record atomically
  await prisma.affiliateClick.create({
    data: {
      clickId,
      userId: options.userId ?? null,
      dealId: deal.id,
      merchantId: deal.merchantId,
      source: options.source ? options.source.slice(0, 50) : null,
      landingDestination: destination,
      status: "TRACKED",
    },
  });

  return {
    clickId,
    redirectUrl: `/api/go/${clickId}`,
  };
}

export interface RedirectResult {
  destinationUrl: string;
  clickId: string;
}

/**
 * Resolves a click record for redirection, verifies offer eligibility,
 * marks status as REDIRECTED, and returns the approved destination URL.
 */
export async function getClickForRedirect(clickId: string): Promise<RedirectResult> {
  // 1. Validate clickId format
  if (!clickId || !/^clk_[a-zA-Z0-9_-]{20,64}$/.test(clickId)) {
    throw new ClickServiceError(
      "Invalid click tracking identifier format",
      "INVALID_CLICK_ID",
      400
    );
  }

  // 2. Query click record
  const click = await prisma.affiliateClick.findUnique({
    where: { clickId },
    include: {
      deal: true,
      merchant: true,
    },
  });

  if (!click) {
    throw new ClickServiceError(
      "Click tracking record not found",
      "CLICK_NOT_FOUND",
      404
    );
  }

  // 3. Confirm deal and merchant eligibility
  const now = new Date();
  const isDealValid =
    click.deal &&
    click.deal.isActive &&
    (!click.deal.startDate || click.deal.startDate <= now) &&
    (!click.deal.endDate || click.deal.endDate >= now);

  const isMerchantValid = click.merchant && click.merchant.isActive;

  if (!isDealValid || !isMerchantValid) {
    if (click.status !== "FAILED") {
      await prisma.affiliateClick.update({
        where: { id: click.id },
        data: { status: "FAILED" },
      });
    }
    throw new ClickServiceError(
      "The requested offer is no longer available or has expired",
      "OFFER_INELIGIBLE",
      410
    );
  }

  // 4. Resolve and validate approved destination
  const destinationUrl = formatAffiliateUrl(click.landingDestination, click.clickId);

  if (!isSafeRedirectUrl(destinationUrl)) {
    if (click.status !== "FAILED") {
      await prisma.affiliateClick.update({
        where: { id: click.id },
        data: { status: "FAILED" },
      });
    }
    throw new ClickServiceError(
      "The offer destination URL is invalid",
      "INVALID_DESTINATION",
      400
    );
  }

  // 5. Mark as REDIRECTED if currently TRACKED
  if (click.status === "TRACKED") {
    await prisma.affiliateClick.update({
      where: { id: click.id },
      data: { status: "REDIRECTED" },
    });
  }
  // If already REDIRECTED, allow idempotent duplicate redirection

  return {
    destinationUrl,
    clickId: click.clickId,
  };
}

/**
 * Admin: Query paginated affiliate clicks with filtering and sanitized relations.
 */
export async function getAdminClicks(query: AdminClicksQueryInput) {
  const { page, limit, startDate, endDate, merchantId, dealId, status, sortBy, sortOrder } =
    query;
  const skip = (page - 1) * limit;

  const where: Prisma.AffiliateClickWhereInput = {};
  if (merchantId) where.merchantId = merchantId;
  if (dealId) where.dealId = dealId;
  if (status) where.status = status;

  if (startDate || endDate) {
    where.clickedAt = {};
    if (startDate) where.clickedAt.gte = new Date(startDate);
    if (endDate) where.clickedAt.lte = new Date(endDate);
  }

  const [clicks, total] = await Promise.all([
    prisma.affiliateClick.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      select: {
        id: true,
        clickId: true,
        userId: true,
        dealId: true,
        merchantId: true,
        clickedAt: true,
        source: true,
        landingDestination: true,
        status: true,
        createdAt: true,
        deal: {
          select: {
            id: true,
            title: true,
            slug: true,
          },
        },
        merchant: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    }),
    prisma.affiliateClick.count({ where }),
  ]);

  return {
    clicks,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Admin: Aggregated click summary metrics and distributions.
 */
export async function getAdminClicksSummary(query: AdminClicksSummaryQueryInput) {
  const { startDate, endDate, merchantId, dealId } = query;

  const where: Prisma.AffiliateClickWhereInput = {};
  if (merchantId) where.merchantId = merchantId;
  if (dealId) where.dealId = dealId;

  if (startDate || endDate) {
    where.clickedAt = {};
    if (startDate) where.clickedAt.gte = new Date(startDate);
    if (endDate) where.clickedAt.lte = new Date(endDate);
  }

  const [
    totalClicks,
    redirectedClicks,
    failedClicks,
    trackedClicks,
    clicksByMerchantRaw,
    clicksByDealRaw,
    allClicksForDaily,
  ] = await Promise.all([
    prisma.affiliateClick.count({ where }),
    prisma.affiliateClick.count({ where: { ...where, status: "REDIRECTED" } }),
    prisma.affiliateClick.count({ where: { ...where, status: "FAILED" } }),
    prisma.affiliateClick.count({ where: { ...where, status: "TRACKED" } }),
    prisma.affiliateClick.groupBy({
      by: ["merchantId"],
      where,
      _count: { _all: true },
      orderBy: { _count: { merchantId: "desc" } },
      take: 10,
    }),
    prisma.affiliateClick.groupBy({
      by: ["dealId"],
      where,
      _count: { _all: true },
      orderBy: { _count: { dealId: "desc" } },
      take: 10,
    }),
    prisma.affiliateClick.findMany({
      where,
      select: { clickedAt: true },
    }),
  ]);

  // Resolve merchant details
  const merchantIds = clicksByMerchantRaw.map((m) => m.merchantId);
  const merchants =
    merchantIds.length > 0
      ? await prisma.merchant.findMany({
          where: { id: { in: merchantIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
  const merchantMap = new Map(merchants.map((m) => [m.id, m]));

  const clicksByMerchant = clicksByMerchantRaw.map((item) => ({
    merchantId: item.merchantId,
    merchantName: merchantMap.get(item.merchantId)?.name ?? "Unknown",
    merchantSlug: merchantMap.get(item.merchantId)?.slug ?? "unknown",
    count: item._count._all,
  }));

  // Resolve deal details
  const dealIds = clicksByDealRaw.map((d) => d.dealId);
  const deals =
    dealIds.length > 0
      ? await prisma.deal.findMany({
          where: { id: { in: dealIds } },
          select: { id: true, title: true, slug: true },
        })
      : [];
  const dealMap = new Map(deals.map((d) => [d.id, d]));

  const clicksByDeal = clicksByDealRaw.map((item) => ({
    dealId: item.dealId,
    dealTitle: dealMap.get(item.dealId)?.title ?? "Unknown",
    dealSlug: dealMap.get(item.dealId)?.slug ?? "unknown",
    count: item._count._all,
  }));

  // Daily distribution (YYYY-MM-DD)
  const dailyMap = new Map<string, number>();
  for (const c of allClicksForDaily) {
    const day = c.clickedAt.toISOString().slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }
  const dailyClicks = Array.from(dailyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalClicks,
    redirectedClicks,
    failedClicks,
    trackedClicks,
    clicksByMerchant,
    clicksByDeal,
    dailyClicks,
  };
}
