import { z } from "zod";

export const campaignShareTypeEnum = z.enum(["PERCENTAGE", "FIXED"]);
export const affiliateProviderEnum = z.enum([
  "FLIPKART",
  "CUELINKS",
  "ADMITAD",
  "EARNKARO",
  "GENERIC",
]);

const monetaryValueSchema = z
  .union([z.number(), z.string()])
  .transform((val) => (typeof val === "string" ? parseFloat(val) : val))
  .refine((val) => !isNaN(val) && val >= 0, {
    message: "Amount must be a non-negative number",
  });

const positiveMonetaryValueSchema = z
  .union([z.number(), z.string()])
  .transform((val) => (typeof val === "string" ? parseFloat(val) : val))
  .refine((val) => !isNaN(val) && val > 0, {
    message: "Amount must be greater than zero",
  });

export const createCampaignSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Campaign name must be at least 2 characters")
      .max(120, "Campaign name cannot exceed 120 characters"),
    description: z.string().trim().max(500).optional().nullable(),
    merchantId: z.string().uuid("Invalid merchant ID format").optional().nullable(),
    dealId: z.string().uuid("Invalid deal ID format").optional().nullable(),
    network: affiliateProviderEnum.optional().nullable(),
    shareType: campaignShareTypeEnum.default("PERCENTAGE"),
    userShareValue: positiveMonetaryValueSchema,
    maxCashbackPerOrder: positiveMonetaryValueSchema.optional().nullable(),
    maxCashbackPerUser: positiveMonetaryValueSchema.optional().nullable(),
    maxCampaignBudget: positiveMonetaryValueSchema.optional().nullable(),
    minOrderAmount: monetaryValueSchema.optional().nullable(),
    startDate: z
      .string()
      .datetime({ message: "Invalid ISO date string for startDate" })
      .optional()
      .nullable(),
    endDate: z
      .string()
      .datetime({ message: "Invalid ISO date string for endDate" })
      .optional()
      .nullable(),
    isActive: z.boolean().default(true),
    priority: z
      .union([z.number(), z.string()])
      .transform((val) => (typeof val === "string" ? parseInt(val, 10) : val))
      .refine((val) => !isNaN(val) && val >= 0, {
        message: "Priority must be a non-negative integer",
      })
      .default(0),
  })
  .superRefine((data, ctx) => {
    // 1. Percentage cashback boundary check
    if (data.shareType === "PERCENTAGE" && data.userShareValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage cashback cannot exceed 100%",
        path: ["userShareValue"],
      });
    }

    // 2. Date boundary consistency
    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate).getTime();
      const end = new Date(data.endDate).getTime();
      if (start > end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "startDate cannot be after endDate",
          path: ["endDate"],
        });
      }
    }
  });

export const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    merchantId: z.string().uuid().optional().nullable(),
    dealId: z.string().uuid().optional().nullable(),
    network: affiliateProviderEnum.optional().nullable(),
    shareType: campaignShareTypeEnum.optional(),
    userShareValue: positiveMonetaryValueSchema.optional(),
    maxCashbackPerOrder: positiveMonetaryValueSchema.optional().nullable(),
    maxCashbackPerUser: positiveMonetaryValueSchema.optional().nullable(),
    maxCampaignBudget: positiveMonetaryValueSchema.optional().nullable(),
    minOrderAmount: monetaryValueSchema.optional().nullable(),
    startDate: z.string().datetime().optional().nullable(),
    endDate: z.string().datetime().optional().nullable(),
    isActive: z.boolean().optional(),
    priority: z
      .union([z.number(), z.string()])
      .transform((val) => (typeof val === "string" ? parseInt(val, 10) : val))
      .refine((val) => !isNaN(val) && val >= 0)
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.shareType === "PERCENTAGE" && data.userShareValue && data.userShareValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage cashback cannot exceed 100%",
        path: ["userShareValue"],
      });
    }

    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate).getTime();
      const end = new Date(data.endDate).getTime();
      if (start > end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "startDate cannot be after endDate",
          path: ["endDate"],
        });
      }
    }
  });

export const campaignQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(1, parseInt(val, 10) || 1) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(100, Math.max(1, parseInt(val, 10) || 20)) : 20)),
  search: z.string().trim().optional(),
  merchantId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  network: affiliateProviderEnum.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .optional(),
  sortBy: z
    .enum(["name", "createdAt", "updatedAt", "priority", "startDate", "endDate"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CampaignQueryInput = z.infer<typeof campaignQuerySchema>;
