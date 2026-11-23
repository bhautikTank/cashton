import { z } from "zod";

export const createClickBodySchema = z
  .object({
    source: z
      .string({ message: "Source must be a string" })
      .trim()
      .max(50, { message: "Source must not exceed 50 characters" })
      .regex(/^[a-zA-Z0-9_\-.:/ ]*$/, { message: "Source contains invalid characters" })
      .optional(),
  })
  .strict();

export type CreateClickBodyInput = z.infer<typeof createClickBodySchema>;

export const clickIdParamSchema = z
  .string({ message: "Click ID must be a string" })
  .regex(/^clk_[a-zA-Z0-9_-]{20,64}$/, {
    message: "Invalid click identifier format",
  });

export const adminClicksQuerySchema = z.object({
  page: z.coerce.number().int().min(1, { message: "Page must be at least 1" }).default(1),
  limit: z.coerce.number().int().min(1, { message: "Limit must be at least 1" }).max(100, { message: "Limit cannot exceed 100" }).default(20),
  startDate: z.string().datetime({ message: "Invalid startDate format" }).optional(),
  endDate: z.string().datetime({ message: "Invalid endDate format" }).optional(),
  merchantId: z.string().uuid({ message: "Invalid merchantId format" }).optional(),
  dealId: z.string().uuid({ message: "Invalid dealId format" }).optional(),
  status: z.enum(["TRACKED", "REDIRECTED", "FAILED"], { message: "Invalid status value" }).optional(),
  sortBy: z.enum(["clickedAt", "createdAt"]).default("clickedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type AdminClicksQueryInput = z.infer<typeof adminClicksQuerySchema>;

export const adminClicksSummaryQuerySchema = z.object({
  startDate: z.string().datetime({ message: "Invalid startDate format" }).optional(),
  endDate: z.string().datetime({ message: "Invalid endDate format" }).optional(),
  merchantId: z.string().uuid({ message: "Invalid merchantId format" }).optional(),
  dealId: z.string().uuid({ message: "Invalid dealId format" }).optional(),
});

export type AdminClicksSummaryQueryInput = z.infer<typeof adminClicksSummaryQuerySchema>;
