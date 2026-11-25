import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const adapter = new PrismaPg({ connectionString });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

/**
 * Interactive transaction timeouts accommodating remote Postgres latency and
 * serialized row-lock contention (`SELECT ... FOR UPDATE`).
 */
export const INTERACTIVE_TX_OPTIONS = {
  maxWait: 15000,
  timeout: 30000,
} as const;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}