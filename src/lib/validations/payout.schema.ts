import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/client";

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

export const MIN_WITHDRAWAL_AMOUNT = 250.0;
export const MAX_WITHDRAWAL_AMOUNT = 1000000.0;

export const withdrawalRequestSchema = z
  .object({
    amount: z
      .union([z.number(), z.string()])
      .superRefine((val, ctx) => {
        if (typeof val === "string") {
          const trimmed = val.trim();
          if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Amount must be a valid positive number with at most 2 decimal places",
            });
          }
        } else {
          if (!Number.isFinite(val)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Amount must be a finite number",
            });
            return;
          }
          try {
            const dec = new Decimal(String(val));
            if (!dec.isFinite() || dec.decimalPlaces() > 2) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Amount must have at most 2 decimal places",
              });
            }
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid monetary amount",
            });
          }
        }
      })
      .transform((val) => (typeof val === "string" ? Number(val.trim()) : val))
      .refine((val) => Number.isFinite(val) && val >= MIN_WITHDRAWAL_AMOUNT, {
        message: `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL_AMOUNT.toFixed(2)}`,
      })
      .refine((val) => val <= MAX_WITHDRAWAL_AMOUNT, {
        message: `Maximum withdrawal amount is ₹${MAX_WITHDRAWAL_AMOUNT.toFixed(2)}`,
      }),
    payoutMethod: z.enum(["BANK", "UPI"]).optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(8, "Idempotency key must be at least 8 characters")
      .max(128, "Idempotency key must not exceed 128 characters"),
  })
  .strict();

export type WithdrawalRequestInput = z.infer<typeof withdrawalRequestSchema>;

export const adminApprovePayoutSchema = z.object({}).strict();

export type AdminApprovePayoutInput = z.infer<typeof adminApprovePayoutSchema>;

export const adminCompletePayoutSchema = z
  .object({
    providerReference: z
      .string()
      .trim()
      .min(3, "Provider reference or UTR is required to mark as paid")
      .max(128),
  })
  .strict();

export type AdminCompletePayoutInput = z.infer<typeof adminCompletePayoutSchema>;

export const adminRejectPayoutSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(3, "Rejection reason is required")
      .max(500),
  })
  .strict();

export type AdminRejectPayoutInput = z.infer<typeof adminRejectPayoutSchema>;

export const payoutQuerySchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "PAID", "FAILED", "REJECTED"]).optional(),
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PayoutQueryInput = z.infer<typeof payoutQuerySchema>;

export const payoutCallbackSchema = z
  .object({
    payoutId: z.string().uuid(),
    providerReferenceId: z.string().trim().min(1).max(128),
    status: z.enum(["SUCCESS", "FAILED", "REVERSED"]),
    failureReason: z.string().trim().max(500).optional(),
  })
  .strict();

export type PayoutCallbackInput = z.infer<typeof payoutCallbackSchema>;
