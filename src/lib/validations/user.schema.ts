import { z } from "zod";
import { isValidIndianMobile, normalizeIndianMobile } from "./mobile";

export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(80, "Name must not exceed 80 characters")
      .optional(),
    mobileNumber: z
      .string()
      .trim()
      .refine(isValidIndianMobile, {
        message:
          "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9",
      })
      .transform((val) => normalizeIndianMobile(val)!)
      .optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
