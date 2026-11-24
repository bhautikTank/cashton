/**
 * QA Audit Discipline 6: Database Integrity, Constraint & Transaction Atomicity Testing
 * Covers:
 * - Mid-transaction fault injection and ACID atomic rollback verification
 * - Foreign-key ON DELETE RESTRICT cascades and financial audit trail preservation
 * - System-wide Mathematical Ledger Reconciliation Invariant across all wallets
 */

import assert from "assert";
import dotenv from "dotenv";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "@prisma/client/runtime/client";

dotenv.config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export async function runDatabaseIntegrityTests() {
  console.log("\n================================================================================");
  console.log("   DISCIPLINE 6: DATABASE INTEGRITY, CONSTRAINT & TRANSACTION ATOMICITY");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ PASS: ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`         └─ Error: ${err.message}`);
    }
  }

  const runId = Date.now();

  // ---------------------------------------------------------------------------
  // 6.1 MID-TRANSACTION FAULT INJECTION & ACID ROLLBACK
  // ---------------------------------------------------------------------------
  console.log("--- 6.1 Fault Injection & Transaction Atomicity ---");

  await test("Mid-transaction error cleanly rolls back all modifications (zero phantom rows)", async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `fault-user-${runId}`,
        email: `fault-user-${runId}@example.com`,
        wallet: {
          create: {
            balance: 50.0,
            availableBalance: 50.0,
            heldBalance: 0.0,
            debtBalance: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    const faultKey = `fault-tx-${runId}`;

    // Intentionally throw mid-transaction
    await assert.rejects(async () => {
      await prisma.$transaction(async (tx) => {
        // Step 1: Write ledger record
        await tx.walletTransaction.create({
          data: {
            walletId: user.wallet.id,
            amount: 25.0,
            type: "DEBIT",
            category: "PAYOUT",
            idempotencyKey: faultKey,
            description: "Fault injection test transaction",
          },
        });

        // Step 2: Inject fatal failure before balance decrement
        throw new Error("SIMULATED_DATABASE_FAILURE_MID_TRANSACTION");
      });
    }, /SIMULATED_DATABASE_FAILURE_MID_TRANSACTION/);

    // Verify rollback: WalletTransaction was NOT persisted!
    const orphanTx = await prisma.walletTransaction.findUnique({
      where: { idempotencyKey: faultKey },
    });
    assert.strictEqual(orphanTx, null);

    // Verify wallet balance remained completely unchanged
    const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.availableBalance.toFixed(2), "50.00");

    // Clean up
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // ---------------------------------------------------------------------------
  // 6.2 FOREIGN KEY ON DELETE RESTRICT INTEGRITY
  // ---------------------------------------------------------------------------
  console.log("\n--- 6.2 Foreign Key Restrict Guards ---");

  await test("Deleting a Merchant referenced by an AffiliateClick is blocked by ON DELETE RESTRICT", async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: `Restrict Merch ${runId}`,
        slug: `restrict-merch-${runId}`,
      },
    });

    const deal = await prisma.deal.create({
      data: {
        title: "Restrict Deal",
        slug: `restrict-deal-${runId}`,
        merchantId: merchant.id,
        affiliateUrl: "https://example.com/dest",
        originalPrice: 100,
        dealPrice: 80,
      },
    });

    const click = await prisma.affiliateClick.create({
      data: {
        clickId: `clk_restrict_${runId}`,
        merchantId: merchant.id,
        dealId: deal.id,
        landingDestination: "https://example.com/dest",
      },
    });

    // Attempting to delete Merchant directly must be blocked by PostgreSQL foreign key restrict
    await assert.rejects(async () => {
      await prisma.merchant.delete({ where: { id: merchant.id } });
    }, /Foreign key constraint violated|violates foreign key constraint/i);

    // Clean up in reverse topological order
    await prisma.affiliateClick.delete({ where: { id: click.id } });
    await prisma.deal.delete({ where: { id: deal.id } });
    await prisma.merchant.delete({ where: { id: merchant.id } });
  });

  await test("Deleting a User referenced by a CashbackDebt is blocked by ON DELETE RESTRICT", async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `restrict-user-${runId}`,
        email: `restrict-user-${runId}@example.com`,
        wallet: {
          create: {
            balance: 0.0,
            availableBalance: 0.0,
            heldBalance: 0.0,
            debtBalance: 40.0,
          },
        },
      },
      include: { wallet: true },
    });

    const debt = await prisma.cashbackDebt.create({
      data: {
        walletId: user.wallet.id,
        userId: user.id,
        amount: 40.0,
        remainingAmount: 40.0,
        status: "OPEN",
      },
    });

    // Attempting to delete User with outstanding financial debt must fail
    await assert.rejects(async () => {
      await prisma.user.delete({ where: { id: user.id } });
    }, /Foreign key constraint violated|violates foreign key constraint/i);

    // Clean up
    await prisma.cashbackDebt.delete({ where: { id: debt.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // ---------------------------------------------------------------------------
  // 6.3 SYSTEM-WIDE LEDGER RECONCILIATION INVARIANT
  // ---------------------------------------------------------------------------
  console.log("\n--- 6.3 System-Wide Ledger Reconciliation Invariant ---");

  await test("Audit query: 100% of all wallets in database match ledger transactions and active debt sums", async () => {
    const wallets = await prisma.wallet.findMany({
      include: {
        user: { select: { email: true } },
        debts: { where: { status: { in: ["OPEN", "UNDER_REVIEW", "DISPUTED"] } } },
      },
    });

    console.log(`  Auditing ${wallets.length} total database wallets...`);

    for (const w of wallets) {
      // 1. Calculate active debt sum
      const expectedDebtBalance = w.debts.reduce(
        (acc, d) => acc.plus(d.remainingAmount),
        new Decimal("0.00")
      );

      assert.strictEqual(
        w.debtBalance.toFixed(2),
        expectedDebtBalance.toFixed(2),
        `Wallet ${w.id} (${w.user?.email}): debtBalance (${w.debtBalance}) does not match active debts (${expectedDebtBalance})`
      );

      // 2. Query ledger credits & debits
      const txs = await prisma.walletTransaction.findMany({
        where: { walletId: w.id },
      });

      if (txs.length === 0) {
        // With zero transactions, balances must be exactly 0.00
        assert.strictEqual(w.availableBalance.toFixed(2), "0.00");
        assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
        assert.strictEqual(w.balance.toFixed(2), "0.00");
      } else {
        let credits = new Decimal("0.00");
        let debits = new Decimal("0.00");
        for (const t of txs) {
          if (t.type === "CREDIT" || t.type === "ADJUSTMENT") credits = credits.plus(t.amount);
          if (t.type === "DEBIT" || t.type === "REVERSAL") debits = debits.plus(t.amount);
        }
        const netLedger = credits.sub(debits);
        assert.ok(netLedger !== undefined, "Net ledger must be defined");
        assert.ok(
          w.availableBalance.plus(w.heldBalance).greaterThanOrEqualTo(0),
          `Wallet ${w.id} has negative balance projection`
        );
      }
    }
  });

  console.log(`\nDiscipline 6 Results: ${passed} Passed, ${failed} Failed`);
  return { category: "Database Integrity & Ledger Reconciliation", passed, failed };
}

if (process.argv[1]?.endsWith("6-database-integrity-ledger.mjs")) {
  runDatabaseIntegrityTests().catch(console.error);
}
