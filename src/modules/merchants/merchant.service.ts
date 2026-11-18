import { prisma } from "@/src/lib/prisma";
import type {
  CreateMerchantInput,
  UpdateMerchantInput,
  MerchantQueryInput,
} from "@/src/lib/validations/merchant.schema";
import type { Merchant } from "@/src/generated/prisma/client";

export interface PaginatedMerchantsResponse {
  merchants: Merchant[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function getMerchants(
  query: MerchantQueryInput
): Promise<PaginatedMerchantsResponse> {
  const { page, limit, search } = query;
  const skip = (page - 1) * limit;

  const where = {
    isActive: true,
    ...(search
      ? {
          name: {
            contains: search,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };

  const [merchants, total] = await Promise.all([
    prisma.merchant.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.merchant.count({ where }),
  ]);

  return {
    merchants,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getMerchantByIdOrSlug(
  identifier: string
): Promise<Merchant | null> {
  const merchant = await prisma.merchant.findFirst({
    where: {
      isActive: true,
      OR: [{ id: identifier }, { slug: identifier }],
    },
  });

  return merchant;
}

export async function createMerchant(
  input: CreateMerchantInput
): Promise<Merchant> {
  const merchant = await prisma.merchant.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      websiteUrl: input.websiteUrl,
      logoUrl: input.logoUrl,
      isActive: input.isActive ?? true,
    },
  });

  return merchant;
}

export async function updateMerchant(
  id: string,
  input: UpdateMerchantInput
): Promise<Merchant> {
  const updated = await prisma.merchant.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  return updated;
}

export async function deactivateMerchant(id: string): Promise<Merchant> {
  const deactivated = await prisma.merchant.update({
    where: { id },
    data: { isActive: false },
  });

  return deactivated;
}
