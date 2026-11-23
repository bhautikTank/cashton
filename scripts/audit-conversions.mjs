import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function audit() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log("=== AUDIT: Conversions for FLIPKART and EARNKARO ===");
  const res = await client.query(`
    SELECT 
      c.id, 
      c.provider, 
      c."externalTransactionId", 
      c.status, 
      c."cashbackAmount", 
      c."orderAmount", 
      c."commissionAmount", 
      c."createdAt",
      c."reconciliationNotes",
      cb.id as "cashbackId",
      cb.status as "cashbackStatus",
      cb.amount as "cashbackAmountFromCb",
      wt.id as "walletTransactionId",
      wt.type as "walletTxType",
      wt.amount as "walletTxAmount",
      wt."walletId",
      w."userId" as "walletUserId",
      u.email as "userEmail"
    FROM "Conversion" c
    LEFT JOIN "Cashback" cb ON c."cashbackId" = cb.id
    LEFT JOIN "WalletTransaction" wt ON wt."cashbackId" = cb.id
    LEFT JOIN "Wallet" w ON wt."walletId" = w.id
    LEFT JOIN "User" u ON c."userId" = u.id
    WHERE c.provider IN ('FLIPKART', 'EARNKARO')
    ORDER BY c."createdAt" DESC;
  `);

  console.log(`Found ${res.rows.length} rows for FLIPKART / EARNKARO:`);
  console.log(JSON.stringify(res.rows, null, 2));

  console.log("\n=== AUDIT: Total Conversion counts across all providers ===");
  const counts = await client.query(`
    SELECT provider, count(*), status 
    FROM "Conversion" 
    GROUP BY provider, status;
  `);
  console.table(counts.rows);

  await client.end();
}

audit().catch(console.error);
