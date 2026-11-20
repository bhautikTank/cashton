import { z } from "zod";

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

export const createCouponSchema = z
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
    code: z
      .string()
      .trim()
      .min(2, "Coupon code must be at least 2 characters")
      .max(50, "Coupon code must not exceed 50 characters")
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "Coupon code must contain only alphanumeric characters, underscores, and hyphens"
      )
      .transform((val) => val.toUpperCase()),
    description: z
      .string()
      .trim()
      .max(5000, "Description must not exceed 5000 characters")
      .optional()
      .nullable()
      .transform((val) => (val === "" ? null : val)),
    discountType: z.enum(["PERCENTAGE", "FIXED"], {
      message: "discountType must be PERCENTAGE or FIXED",
    }),
    discountValue: z.coerce
      .number({ message: "discountValue must be a valid number" }),
    minimumPurchase: z.coerce
      .number({ message: "minimumPurchase must be a valid number" })
      .min(0, "minimumPurchase cannot be negative")
      .optional()
      .nullable(),
    maximumDiscount: z.coerce
      .number({ message: "maximumDiscount must be a valid number" })
      .positive("maximumDiscount must be greater than 0")
      .optional()
      .nullable(),
    usageLimit: z.coerce
      .number({ message: "usageLimit must be an integer" })
      .int("usageLimit must be an integer")
      .min(1, "usageLimit must be at least 1")
      .optional()
      .nullable(),
    startDate: optionalDate,
    endDate: optionalDate,
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine(
    (data) => {
      if (data.discountType === "PERCENTAGE") {
        return data.discountValue > 0 && data.discountValue <= 100;
      }
      return data.discountValue > 0;
    },
    {
      message:
        "Percentage discount must be between 0 and 100, and Fixed discount must be greater than 0",
      path: ["discountValue"],
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

export const updateCouponSchema = z
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
    code: z
      .string()
      .trim()
      .min(2, "Coupon code must be at least 2 characters")
      .max(50, "Coupon code must not exceed 50 characters")
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "Coupon code must contain only alphanumeric characters, underscores, and hyphens"
      )
      .transform((val) => val.toUpperCase())
      .optional(),
    description: z
      .string()
      .trim()
      .max(5000, "Description must not exceed 5000 characters")
      .optional()
      .nullable()
      .transform((val) => (val === "" ? null : val)),
    discountType: z
      .enum(["PERCENTAGE", "FIXED"], {
        message: "discountType must be PERCENTAGE or FIXED",
      })
      .optional(),
    discountValue: z.coerce
      .number({ message: "discountValue must be a valid number" })
      .optional(),
    minimumPurchase: z.coerce
      .number({ message: "minimumPurchase must be a valid number" })
      .min(0, "minimumPurchase cannot be negative")
      .optional()
      .nullable(),
    maximumDiscount: z.coerce
      .number({ message: "maximumDiscount must be a valid number" })
      .positive("maximumDiscount must be greater than 0")
      .optional()
      .nullable(),
    usageLimit: z.coerce
      .number({ message: "usageLimit must be an integer" })
      .int("usageLimit must be an integer")
      .min(1, "usageLimit must be at least 1")
      .optional()
      .nullable(),
    startDate: optionalDate,
    endDate: optionalDate,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.discountType !== undefined && data.discountValue !== undefined) {
        if (data.discountType === "PERCENTAGE") {
          return data.discountValue > 0 && data.discountValue <= 100;
        }
        return data.discountValue > 0;
      }
      if (data.discountValue !== undefined) {
        return data.discountValue > 0;
      }
      return true;
    },
    {
      message:
        "Percentage discount must be between 0 and 100, and Fixed discount must be greater than 0",
      path: ["discountValue"],
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

export const couponQuerySchema = z.object({
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
  discountType: z.enum(["PERCENTAGE", "FIXED"]).optional(),
  sortBy: z.enum(["createdAt", "discountValue", "endDate"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  isActive: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .or(z.boolean())
    .optional(),
});

export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type CouponQueryInput = z.infer<typeof couponQuerySchema>;
