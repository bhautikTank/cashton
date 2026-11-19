import { z } from "zod";

const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export const payoutDetailsSchema = z
  .object({
    payoutMethod: z.enum(["BANK", "UPI"]),
    accountHolderName: z
      .string()
      .trim()
      .min(2, "Account holder name must be at least 2 characters")
      .max(100, "Account holder name must not exceed 100 characters")
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{9,18}$/, "Bank account number must be between 9 and 18 digits")
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(ifscRegex, "Invalid IFSC code format (e.g. HDFC0001234)")
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    bankName: z
      .string()
      .trim()
      .max(100, "Bank name must not exceed 100 characters")
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    upiId: z
      .string()
      .trim()
      .toLowerCase()
      .regex(upiRegex, "Invalid UPI ID format (e.g. username@okhdfcbank)")
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.payoutMethod === "BANK") {
      if (!data.accountHolderName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accountHolderName"],
          message: "Account holder name is required for bank transfer",
        });
      }
      if (!data.accountNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accountNumber"],
          message: "Account number is required for bank transfer",
        });
      }
      if (!data.ifscCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ifscCode"],
          message: "IFSC code is required for bank transfer",
        });
      }
    } else if (data.payoutMethod === "UPI") {
      if (!data.upiId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["upiId"],
          message: "UPI ID is required for UPI payout",
        });
      }
    }
  });

export type PayoutDetailsInput = z.infer<typeof payoutDetailsSchema>;
