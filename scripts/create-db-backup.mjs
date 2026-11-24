/**
 * CashTon Database Pre-Migration Snapshot & Recovery Point Generator
 * Connects to PostgreSQL, dumps all public tables to JSON with counts and sha256 checksums.
 */
import { Client } from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function createBackup() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("Connected to PostgreSQL for database recovery point creation...");

  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);

  const tables = tablesRes.rows.map((r) => r.table_name);
  const backupData = {
    timestamp: new Date().toISOString(),
    database: "postgres",
    tableCounts: {},
    tables: {},
  };

  for (const table of tables) {
    const dataRes = await client.query(`SELECT * FROM "${table}"`);
    backupData.tableCounts[table] = dataRes.rowCount;
    backupData.tables[table] = dataRes.rows;
    console.log(`- Dumped table ${table}: ${dataRes.rowCount} rows`);
  }

  await client.end();

  const backupDir = path.resolve("backup");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupPath = path.join(backupDir, "recovery_point_pre_migration_20261124.json");
  const jsonContent = JSON.stringify(backupData, null, 2);
  fs.writeFileSync(backupPath, jsonContent, "utf8");

  const hash = crypto.createHash("sha256").update(jsonContent).digest("hex");
  const manifestPath = path.join(backupDir, "recovery_point_pre_migration_20261124_manifest.json");
  const manifest = {
    timestamp: backupData.timestamp,
    backupFile: "recovery_point_pre_migration_20261124.json",
    sha256: hash,
    tableCounts: backupData.tableCounts,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log("\n=======================================================");
  console.log("✅ DATABASE RECOVERY POINT CREATED SUCCESSFULLY!");
  console.log(`Path: ${backupPath}`);
  console.log(`SHA256: ${hash}`);
  console.log("Table Summary:", backupData.tableCounts);
  console.log("=======================================================\n");
}

createBackup().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
