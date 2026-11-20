import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const httpUrl = (fieldName: string) =>
  z
    .string()
    .trim()
    .url(`${fieldName} must be a valid HTTP or HTTPS URL`)
    .refine(
      (url) => url.startsWith("https://") || url.startsWith("http://"),
      `${fieldName} must start with http:// or https://`
    )
    .max(1000, `${fieldName} must not exceed 1000 characters`);

const optionalDate = z
  .union([z.string(), z.date()])
  .optional()
  .nullable()
  .refine(
    (val) => {
      if (!val) return true;
      const d = new Date(val);
      return !isNaN(d.getTime());
    },
    { message: "Invalid date format" }
  )
  .transform((val) => (val ? new Date(val) : null));

export const createDealSchema = z
  .object({
    merchantId: z
      .string()
      .trim()
      .min(1, "Merchant ID is required"),
    title: z
      .string()
      .trim()
      .min(2, "Title must be at least 2 characters")
      .max(200, "Title must not exceed 200 characters"),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "Slug must be at least 2 characters")
      .max(150, "Slug must not exceed 150 characters")
      .regex(
        slugRegex,
        "Slug must contain only lowercase alphanumeric characters and single hyphens"
      ),
    description: z
      .string()
      .trim()
      .max(5000, "Description must not exceed 5000 characters")
      .optional()
      .nullable()
      .transform((val) => (val === "" ? null : val)),
    imageUrl: httpUrl("Image URL")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
    originalPrice: z.coerce
      .number({ message: "Original price must be a valid number" })
      .positive("Original price must be greater than 0")
      .optional()
      .nullable(),
    dealPrice: z.coerce
      .number({ message: "Deal price must be a valid number" })
      .min(0, "Deal price cannot be negative")
      .optional()
      .nullable(),
    affiliateUrl: httpUrl("Affiliate URL")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
    startDate: optionalDate,
    endDate: optionalDate,
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine(
    (data) => {
      if (data.originalPrice != null && data.dealPrice != null) {
        return data.dealPrice <= data.originalPrice;
      }
      return true;
    },
    {
      message: "Deal price must be less than or equal to original price",
      path: ["dealPrice"],
    }
  )
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.endDate) >= new Date(data.startDate);
      }
      return true;
    },
    {
      message: "End date must be after or equal to start date",
      path: ["endDate"],
    }
  );

export const updateDealSchema = z
  .object({
    merchantId: z
      .string()
      .trim()
      .min(1, "Merchant ID is required")
      .optional(),
    title: z
      .string()
      .trim()
      .min(2, "Title must be at least 2 characters")
      .max(200, "Title must not exceed 200 characters")
      .optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "Slug must be at least 2 characters")
      .max(150, "Slug must not exceed 150 characters")
      .regex(
        slugRegex,
        "Slug must contain only lowercase alphanumeric characters and single hyphens"
      )
      .optional(),
    description: z
      .string()
      .trim()
      .max(5000, "Description must not exceed 5000 characters")
      .optional()
      .nullable()
      .transform((val) => (val === "" ? null : val)),
    imageUrl: httpUrl("Image URL")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
    originalPrice: z.coerce
      .number({ message: "Original price must be a valid number" })
      .positive("Original price must be greater than 0")
      .optional()
      .nullable(),
    dealPrice: z.coerce
      .number({ message: "Deal price must be a valid number" })
      .min(0, "Deal price cannot be negative")
      .optional()
      .nullable(),
    affiliateUrl: httpUrl("Affiliate URL")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
    startDate: optionalDate,
    endDate: optionalDate,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.originalPrice != null && data.dealPrice != null) {
        return data.dealPrice <= data.originalPrice;
      }
      return true;
    },
    {
      message: "Deal price must be less than or equal to original price",
      path: ["dealPrice"],
    }
  )
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.endDate) >= new Date(data.startDate);
      }
      return true;
    },
    {
      message: "End date must be after or equal to start date",
      path: ["endDate"],
    }
  );

export const dealQuerySchema = z.object({
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
  merchantId: z.string().trim().optional(),
  merchant: z.string().trim().optional(),
  sortBy: z.enum(["createdAt", "dealPrice", "endDate"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  isActive: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .or(z.boolean())
    .optional(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type DealQueryInput = z.infer<typeof dealQuerySchema>;
