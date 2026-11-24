import { z } from "zod";

export const cashbackDebtStatusEnum = z.enum([
  "OPEN",
  "UNDER_REVIEW",
  "DISPUTED",
  "RECOVERED",
  "WRITTEN_OFF",
]);

export const listDebtsQuerySchema = z.object({
  status: cashbackDebtStatusEnum.optional(),
  userId: z.string().uuid("Invalid user ID format").optional(),
  walletId: z.string().uuid("Invalid wallet ID format").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const resolveDebtSchema = z.object({
  action: z.enum(["WRITE_OFF", "UNFREEZE", "RECOVER_MANUAL"]),
  notes: z.string().trim().max(1000, "Notes cannot exceed 1000 characters").optional(),
});

export const disputeDebtSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Dispute reason must be at least 5 characters")
    .max(500, "Dispute reason cannot exceed 500 characters"),
});

export type ListDebtsQueryInput = z.infer<typeof listDebtsQuerySchema>;
export type ResolveDebtInput = z.infer<typeof resolveDebtSchema>;
export type DisputeDebtInput = z.infer<typeof disputeDebtSchema>;
