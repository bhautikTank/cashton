import { z } from "zod";
import { normalizeIndianMobile, isValidIndianMobile } from "./mobile";

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .max(254)
    .transform((v) => v.toLowerCase()),
  mobileNumber: z
    .string()
    .trim()
    .min(1, "Mobile number is required")
    .refine(isValidIndianMobile, {
      message:
        "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9",
    })
    .transform((val) => normalizeIndianMobile(val)!),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must not exceed 72 characters"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1, "Password is required").max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
