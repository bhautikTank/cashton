import { z } from "zod";

export const AffiliateProviderEnum = z.enum([
  "FLIPKART",
  "CUELINKS",
  "ADMITAD",
  "EARNKARO",
  "GENERIC",
]);

export const ConversionStatusEnum = z.enum([
  "PENDING",
  "APPROVED",
  "CONFIRMED",
  "REJECTED",
  "REVERSED",
  "UNMATCHED",
]);

export const AdminConversionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  provider: AffiliateProviderEnum.optional(),
  status: ConversionStatusEnum.optional(),
  merchantId: z.string().uuid("Invalid merchantId UUID").optional(),
  dealId: z.string().uuid("Invalid dealId UUID").optional(),
  userId: z.string().uuid("Invalid userId UUID").optional(),
  startDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  endDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(["createdAt", "convertedAt", "orderAmount", "commissionAmount", "cashbackAmount"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type AdminConversionsQueryInput = z.infer<typeof AdminConversionsQuerySchema>;

export const AdminConversionsSummaryQuerySchema = z.object({
  provider: AffiliateProviderEnum.optional(),
  merchantId: z.string().uuid("Invalid merchantId UUID").optional(),
  dealId: z.string().uuid("Invalid dealId UUID").optional(),
  startDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  endDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

export type AdminConversionsSummaryQueryInput = z.infer<typeof AdminConversionsSummaryQuerySchema>;

export const ReconcileConversionSchema = z.object({
  clickId: z
    .string()
    .trim()
    .regex(/^clk_[a-zA-Z0-9_-]{20,64}$/, "Invalid clickId format")
    .optional(),
  userId: z.string().uuid("Invalid userId UUID").optional(),
  merchantId: z.string().uuid("Invalid merchantId UUID").optional(),
  dealId: z.string().uuid("Invalid dealId UUID").optional(),
  status: ConversionStatusEnum.optional(),
  notes: z.string().trim().max(500).optional(),
});

export type ReconcileConversionInput = z.infer<typeof ReconcileConversionSchema>;
