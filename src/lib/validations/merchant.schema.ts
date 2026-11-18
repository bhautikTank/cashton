import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createMerchantSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must not exceed 100 characters"),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "Slug must be at least 2 characters")
      .max(100, "Slug must not exceed 100 characters")
      .regex(
        slugRegex,
        "Slug must contain only lowercase alphanumeric characters and single hyphens"
      ),
    description: z
      .string()
      .trim()
      .max(2000, "Description must not exceed 2000 characters")
      .optional()
      .nullable()
      .transform((val) => (val === "" ? null : val)),
    websiteUrl: z
      .string()
      .trim()
      .url("Website URL must be a valid HTTP or HTTPS URL")
      .max(500, "Website URL must not exceed 500 characters")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
    logoUrl: z
      .string()
      .trim()
      .url("Logo URL must be a valid HTTP or HTTPS URL")
      .max(500, "Logo URL must not exceed 500 characters")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateMerchantSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must not exceed 100 characters")
      .optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "Slug must be at least 2 characters")
      .max(100, "Slug must not exceed 100 characters")
      .regex(
        slugRegex,
        "Slug must contain only lowercase alphanumeric characters and single hyphens"
      )
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, "Description must not exceed 2000 characters")
      .optional()
      .nullable()
      .transform((val) => (val === "" ? null : val)),
    websiteUrl: z
      .string()
      .trim()
      .url("Website URL must be a valid HTTP or HTTPS URL")
      .max(500, "Website URL must not exceed 500 characters")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
    logoUrl: z
      .string()
      .trim()
      .url("Logo URL must be a valid HTTP or HTTPS URL")
      .max(500, "Logo URL must not exceed 500 characters")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
    isActive: z.boolean().optional(),
  })
  .strict();

export const merchantQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1, "Page must be at least 1")
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100")
    .default(20),
  search: z
    .string()
    .trim()
    .max(100, "Search query must not exceed 100 characters")
    .optional(),
});

export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;
export type UpdateMerchantInput = z.infer<typeof updateMerchantSchema>;
export type MerchantQueryInput = z.infer<typeof merchantQuerySchema>;
