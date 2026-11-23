import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function checkAll() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const convCount = await client.query('SELECT count(*) FROM "Conversion"');
  const cbCount = await client.query('SELECT count(*) FROM "Cashback"');
  const wtCount = await client.query('SELECT count(*) FROM "WalletTransaction"');
  const clickCount = await client.query('SELECT count(*) FROM "AffiliateClick"');
  const userCount = await client.query('SELECT count(*) FROM "User"');

  console.log("Counts in live DB:");
  console.log("Conversions:", convCount.rows[0].count);
  console.log("Cashbacks:", cbCount.rows[0].count);
  console.log("WalletTransactions:", wtCount.rows[0].count);
  console.log("AffiliateClicks:", clickCount.rows[0].count);
  console.log("Users:", userCount.rows[0].count);

  if (parseInt(cbCount.rows[0].count, 10) > 0) {
    const cbs = await client.query('SELECT id, "userId", amount, status, "externalReferenceId", "createdAt" FROM "Cashback" LIMIT 10');
    console.log("Sample Cashbacks:", cbs.rows);
  }

  if (parseInt(wtCount.rows[0].count, 10) > 0) {
    const wts = await client.query('SELECT id, "walletId", amount, type, category, "cashbackId", "createdAt" FROM "WalletTransaction" LIMIT 10');
    console.log("Sample WalletTransactions:", wts.rows);
  }

  await client.end();
}

checkAll().catch(console.error);
