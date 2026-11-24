/**
 * QA Audit Discipline 4: Concurrency, Race Condition & Idempotency Testing
 * Covers:
 * - Simultaneous wallet overdraft attempts (Promise.allSettled)
 * - Concurrent duplicate reversal events on the same cashback (event idempotency)
 * - Concurrent confirmations competing to offset open debt
 * - Concurrent hold-release job executions
 * - Concurrent campaign budget exhaustion
 * - Concurrent multi-cashback reversal drain (multi-stage draw-down without negative balance)
 */

import assert from "assert";
import dotenv from "dotenv";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { debitWallet, creditCashbackToWallet } from "../../src/modules/wallet/wallet.service.ts";
import { updateCashbackStatus } from "../../src/modules/cashback/cashback.service.ts";
import { processEligibleHoldReleases } from "../../src/modules/wallet/hold-back.service.ts";
import { ingestNormalizedConversion } from "../../src/modules/conversions/conversion.service.ts";

dotenv.config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export async function runConcurrencyTests() {
  console.log("\n================================================================================");
  console.log("   DISCIPLINE 4: CONCURRENCY, RACE CONDITIONS & IDEMPOTENCY TESTING");
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
  // 4.1 CONCURRENT OVERDRAFT PROTECTION
  // ---------------------------------------------------------------------------
  console.log("--- 4.1 Concurrent Wallet Overdraft Protection ---");

  await test("15 concurrent debits of ₹70 against a ₹100 balance: exactly 1 succeeds, 14 fail, balance = ₹30", async () => {
    // Create user with ₹100 available balance
    const user = await prisma.user.create({
      data: {
        authUserId: `conc-user-1-${runId}`,
        email: `conc-user-1-${runId}@example.com`,
        name: "Concurrency Tester 1",
        wallet: {
          create: {
            balance: 100.0,
            availableBalance: 100.0,
            heldBalance: 0.0,
            debtBalance: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    // Fire 15 simultaneous debits of ₹70
    const promises = Array.from({ length: 15 }, (_, i) =>
      debitWallet({
        userId: user.id,
        amount: 70.0,
        category: "PAYOUT",
        description: `Concurrent debit attempt #${i + 1}`,
        idempotencyKey: `conc-debit-${runId}-${i}`,
      })
    );

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1); // Exactly 1 debit succeeded
    assert.strictEqual(rejected.length, 14); // 14 debits rejected with overdraft error

    // Verify final balance is exactly ₹30.00
    const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.availableBalance.toFixed(2), "30.00");
    assert.strictEqual(w.balance.toFixed(2), "30.00");

    // Clean up
    await prisma.walletTransaction.deleteMany({ where: { walletId: user.wallet.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // ---------------------------------------------------------------------------
  // 4.2 CONCURRENT REVERSALS ON SAME CASHBACK
  // ---------------------------------------------------------------------------
  console.log("\n--- 4.2 Concurrent Reversals with Event Idempotency ---");

  await test("10 concurrent reversal deliveries of the same event: exactly 1 applies, 0 duplicate debit", async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `conc-user-2-${runId}`,
        email: `conc-user-2-${runId}@example.com`,
        name: "Concurrency Tester 2",
        wallet: {
          create: {
            balance: 100.0,
            availableBalance: 0.0,
            heldBalance: 100.0,
            debtBalance: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    const cb = await prisma.cashback.create({
      data: {
        userId: user.id,
        amount: 100.0,
        heldAmount: 100.0,
        status: "CONFIRMED",
      },
    });

    const sharedEventKey = `rev-shared-event-${runId}`;

    // Fire 10 simultaneous reversals with same eventKey
    const promises = Array.from({ length: 10 }, () =>
      updateCashbackStatus(cb.id, "REVERSED", "Simultaneous reversal webhook", {
        eventKey: sharedEventKey,
        provider: "GENERIC",
      })
    );

    await Promise.allSettled(promises);

    // Verify heldBalance is 0.00 (not negative or double-debited)
    const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");

    // Verify only 1 reversal transaction was created
    const txCount = await prisma.walletTransaction.count({
      where: { walletId: user.wallet.id, type: "REVERSAL" },
    });
    assert.strictEqual(txCount, 1);

    // Clean up
    await prisma.walletTransaction.deleteMany({ where: { walletId: user.wallet.id } });
    await prisma.cashbackDebt.deleteMany({ where: { walletId: user.wallet.id } });
    await prisma.cashback.delete({ where: { id: cb.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // ---------------------------------------------------------------------------
  // 4.3 CONCURRENT CONFIRMATIONS COMPETING TO OFFSET SAME DEBT
  // ---------------------------------------------------------------------------
  console.log("\n--- 4.3 Concurrent Confirmations Competing for Debt Offset ---");

  await test("Two concurrent confirmations against a single ₹50 debt: debt offset exactly once, no double-recovery", async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `conc-user-3-${runId}`,
        email: `conc-user-3-${runId}@example.com`,
        name: "Concurrency Tester 3",
        wallet: {
          create: {
            balance: 0.0,
            availableBalance: 0.0,
            heldBalance: 0.0,
            debtBalance: 50.0,
          },
        },
      },
      include: { wallet: true },
    });

    // Create single open debt of ₹50.00
    const debt = await prisma.cashbackDebt.create({
      data: {
        walletId: user.wallet.id,
        userId: user.id,
        amount: 50.0,
        remainingAmount: 50.0,
        status: "OPEN",
      },
    });

    // Create two separate approved cashbacks of ₹50 each
    const cb1 = await prisma.cashback.create({
      data: { userId: user.id, amount: 50.0, status: "APPROVED" },
    });
    const cb2 = await prisma.cashback.create({
      data: { userId: user.id, amount: 50.0, status: "APPROVED" },
    });

    // Concurrently confirm both cashbacks (competing to offset the same ₹50 debt)
    await Promise.allSettled([
      creditCashbackToWallet({
        userId: user.id,
        cashbackId: cb1.id,
        amount: cb1.amount,
        description: "Cashback 1",
        provider: "GENERIC",
      }),
      creditCashbackToWallet({
        userId: user.id,
        cashbackId: cb2.id,
        amount: cb2.amount,
        description: "Cashback 2",
        provider: "GENERIC",
      }),
    ]);

    // Debt liability must be exactly 0.00 (never negative)
    const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.debtBalance.toFixed(2), "0.00");

    const updatedDebt = await prisma.cashbackDebt.findUnique({ where: { id: debt.id } });
    assert.strictEqual(updatedDebt.status, "RECOVERED");
    assert.strictEqual(updatedDebt.remainingAmount.toFixed(2), "0.00");

    // The remainder of the second confirmation must have gone into heldBalance!
    // Total cashbacks confirmed = ₹100. Debt was ₹50. So heldBalance must be ₹50.00!
    assert.strictEqual(w.heldBalance.toFixed(2), "50.00");

    // Clean up
    await prisma.walletTransaction.deleteMany({ where: { walletId: user.wallet.id } });
    await prisma.cashbackDebt.delete({ where: { id: debt.id } });
    await prisma.cashback.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // ---------------------------------------------------------------------------
  // 4.4 CONCURRENT HOLD-RELEASE EXECUTIONS
  // ---------------------------------------------------------------------------
  console.log("\n--- 4.4 Concurrent Hold-Release Cron Executions ---");

  await test("5 concurrent hold-release executions: single ledger credit per eligible cashback", async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `conc-user-4-${runId}`,
        email: `conc-user-4-${runId}@example.com`,
        name: "Concurrency Tester 4",
        wallet: {
          create: {
            balance: 100.0,
            availableBalance: 0.0,
            heldBalance: 100.0,
            debtBalance: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    const cb = await prisma.cashback.create({
      data: {
        userId: user.id,
        amount: 100.0,
        heldAmount: 100.0,
        holdReleased: false,
        heldUntil: new Date(Date.now() - 10000), // Matured
        status: "CONFIRMED",
      },
    });

    // Fire 5 concurrent executions of processEligibleHoldReleases
    await Promise.allSettled([
      processEligibleHoldReleases(),
      processEligibleHoldReleases(),
      processEligibleHoldReleases(),
      processEligibleHoldReleases(),
      processEligibleHoldReleases(),
    ]);

    // Verify wallet: exactly ₹100 moved from held to available
    const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
    assert.strictEqual(w.availableBalance.toFixed(2), "100.00");

    // Exactly 1 HOLD_RELEASED ledger entry in database
    const releaseTxs = await prisma.walletTransaction.findMany({
      where: { cashbackId: cb.id, category: "HOLD_RELEASED" },
    });
    assert.strictEqual(releaseTxs.length, 1);

    // Clean up
    await prisma.walletTransaction.deleteMany({ where: { walletId: user.wallet.id } });
    await prisma.cashbackDebt.deleteMany({ where: { walletId: user.wallet.id } });
    await prisma.cashback.delete({ where: { id: cb.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // ---------------------------------------------------------------------------
  // 4.5 CONCURRENT CAMPAIGN BUDGET EXHAUSTION
  // ---------------------------------------------------------------------------
  console.log("\n--- 4.5 Concurrent Campaign Budget Exhaustion ---");

  await test("Concurrent conversions competing for limited campaign budget: total cashback never overruns maxCampaignBudget", async () => {
    // 1. Create test user with wallet
    const user = await prisma.user.create({
      data: {
        authUserId: `conc-budget-user-${runId}`,
        email: `conc-budget-${runId}@example.com`,
        name: "Budget Concurrency Tester",
        wallet: {
          create: {
            balance: 0.0,
            availableBalance: 0.0,
            heldBalance: 0.0,
            debtBalance: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    // 2. Create test merchant & deal
    const merchant = await prisma.merchant.create({
      data: {
        name: `Budget Test Merchant ${runId}`,
        slug: `budget-merchant-${runId}`,
      },
    });

    const deal = await prisma.deal.create({
      data: {
        title: `Budget Deal ${runId}`,
        slug: `budget-deal-${runId}`,
        merchantId: merchant.id,
        affiliateUrl: "https://example.com/dest",
        originalPrice: 200,
        dealPrice: 150,
      },
    });

    // 3. Create campaign with maxCampaignBudget = ₹150.00, fixed cashback = ₹100.00
    const campaign = await prisma.campaign.create({
      data: {
        name: `Budget Cap Campaign ${runId}`,
        merchantId: merchant.id,
        dealId: deal.id,
        shareType: "FIXED",
        userShareValue: 100.0,
        minOrderAmount: 10.0,
        maxCampaignBudget: 150.0,
        priority: 100,
        isActive: true,
      },
    });

    // 4. Create 3 affiliate clicks for user
    const click1 = await prisma.affiliateClick.create({
      data: {
        clickId: `click-budget-${runId}-1`,
        userId: user.id,
        merchantId: merchant.id,
        dealId: deal.id,
        landingDestination: "https://example.com/dest",
      },
    });
    const click2 = await prisma.affiliateClick.create({
      data: {
        clickId: `click-budget-${runId}-2`,
        userId: user.id,
        merchantId: merchant.id,
        dealId: deal.id,
        landingDestination: "https://example.com/dest",
      },
    });
    const click3 = await prisma.affiliateClick.create({
      data: {
        clickId: `click-budget-${runId}-3`,
        userId: user.id,
        merchantId: merchant.id,
        dealId: deal.id,
        landingDestination: "https://example.com/dest",
      },
    });

    // 5. Fire 3 concurrent conversions of orderAmount ₹200.00 each
    // Conversion 1 asks for ₹100 (budget remaining 150 -> gets 100, remaining 50)
    // Conversion 2 asks for ₹100 (budget remaining 50 -> clamped to 50, remaining 0)
    // Conversion 3 asks for ₹100 (budget remaining 0 -> gets 0, exhausted)
    const extId1 = `tx-budget-${runId}-1`;
    const extId2 = `tx-budget-${runId}-2`;
    const extId3 = `tx-budget-${runId}-3`;

    const results = await Promise.allSettled([
      ingestNormalizedConversion({
        provider: "GENERIC",
        externalTransactionId: extId1,
        clickId: click1.clickId,
        orderAmount: "200.00",
        commissionAmount: "120.00",
        status: "PENDING",
      }),
      ingestNormalizedConversion({
        provider: "GENERIC",
        externalTransactionId: extId2,
        clickId: click2.clickId,
        orderAmount: "200.00",
        commissionAmount: "120.00",
        status: "PENDING",
      }),
      ingestNormalizedConversion({
        provider: "GENERIC",
        externalTransactionId: extId3,
        clickId: click3.clickId,
        orderAmount: "200.00",
        commissionAmount: "120.00",
        status: "PENDING",
      }),
    ]);

    // All three should have settled successfully (fulfilled)
    for (const r of results) {
      assert.strictEqual(r.status, "fulfilled", `Expected fulfilled but got rejected: ${r.reason}`);
    }

    // Query conversions created for these transactions
    const convs = await prisma.conversion.findMany({
      where: {
        externalTransactionId: { in: [extId1, extId2, extId3] },
      },
      include: { cashback: true },
    });

    assert.strictEqual(convs.length, 3);

    // Sum of cashback amounts across all conversions for this campaign
    const totalCashback = convs.reduce((sum, c) => sum + Number(c.cashbackAmount), 0);
    assert.strictEqual(
      totalCashback <= 150.0,
      true,
      `Total cashback ₹${totalCashback} exceeds maxCampaignBudget ₹150.00!`
    );
    assert.strictEqual(
      totalCashback.toFixed(2),
      "150.00",
      `Expected total cashback to be exactly ₹150.00, got ₹${totalCashback.toFixed(2)}`
    );

    // Verify individual amounts: one got 100, one got 50, one got 0
    const amounts = convs.map((c) => Number(c.cashbackAmount).toFixed(2)).sort((a, b) => Number(a) - Number(b));
    assert.deepStrictEqual(amounts, ["0.00", "50.00", "100.00"]);

    // The conversion with 0.00 cashback must have reconciliationNotes documenting exhaustion
    const zeroConv = convs.find((c) => Number(c.cashbackAmount) === 0);
    assert.ok(zeroConv.reconciliationNotes?.includes("exhausted"));

    // Cleanup
    await prisma.conversion.deleteMany({
      where: { externalTransactionId: { in: [extId1, extId2, extId3] } },
    });
    await prisma.cashback.deleteMany({ where: { userId: user.id } });
    await prisma.affiliateClick.deleteMany({
      where: { clickId: { in: [click1.clickId, click2.clickId, click3.clickId] } },
    });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.deal.delete({ where: { id: deal.id } });
    await prisma.merchant.delete({ where: { id: merchant.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // ---------------------------------------------------------------------------
  // 4.6 CONCURRENT MULTI-CASHBACK REVERSAL DRAIN (STRESS TEST)
  // ---------------------------------------------------------------------------
  console.log("\n--- 4.6 Concurrent Multi-Cashback Reversal Drain ---");

  await test("Concurrent reversals of distinct cashbacks against tight balances: zero negative balance, exact debt created", async () => {
    // User with ₹50 held and ₹50 available (total ₹100 balance)
    const user = await prisma.user.create({
      data: {
        authUserId: `conc-rev-user-${runId}`,
        email: `conc-rev-${runId}@example.com`,
        name: "Reversal Concurrency Tester",
        wallet: {
          create: {
            balance: 100.0,
            availableBalance: 50.0,
            heldBalance: 50.0,
            debtBalance: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    // Two distinct confirmed cashbacks: CB1 has ₹50 held, CB2 has ₹0 held (already released)
    const cb1 = await prisma.cashback.create({
      data: {
        userId: user.id,
        amount: 80.0,
        heldAmount: 50.0,
        status: "CONFIRMED",
      },
    });

    const cb2 = await prisma.cashback.create({
      data: {
        userId: user.id,
        amount: 80.0,
        heldAmount: 0.0,
        status: "CONFIRMED",
      },
    });

    // Fire concurrent full reversals of both cashbacks (Total reversal = ₹160 against ₹100 balance)
    const rev1Promise = updateCashbackStatus(cb1.id, "REVERSED", "Concurrent return 1", {
      eventKey: `stress-rev-1-${runId}`,
      provider: "GENERIC",
    });
    const rev2Promise = updateCashbackStatus(cb2.id, "REVERSED", "Concurrent return 2", {
      eventKey: `stress-rev-2-${runId}`,
      provider: "GENERIC",
    });

    const results = await Promise.allSettled([rev1Promise, rev2Promise]);
    for (const r of results) {
      assert.strictEqual(r.status, "fulfilled", `Expected fulfilled reversal, got rejected: ${r.reason}`);
    }

    // Verify wallet state: balances must be 0.00, debt must be exactly ₹60.00, never negative!
    const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(Number(w.heldBalance) >= 0, true, "heldBalance must not be negative");
    assert.strictEqual(Number(w.availableBalance) >= 0, true, "availableBalance must not be negative");
    assert.strictEqual(Number(w.balance) >= 0, true, "balance must not be negative");

    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
    assert.strictEqual(w.availableBalance.toFixed(2), "0.00");
    assert.strictEqual(w.balance.toFixed(2), "0.00");
    assert.strictEqual(w.debtBalance.toFixed(2), "60.00");

    // Check open debt records created: total remainingAmount must be ₹60.00
    const debts = await prisma.cashbackDebt.findMany({
      where: { walletId: user.wallet.id, status: "OPEN" },
    });
    const totalDebt = debts.reduce((sum, d) => sum + Number(d.remainingAmount), 0);
    assert.strictEqual(totalDebt.toFixed(2), "60.00");

    // Clean up
    await prisma.walletTransaction.deleteMany({ where: { walletId: user.wallet.id } });
    await prisma.cashbackDebt.deleteMany({ where: { walletId: user.wallet.id } });
    await prisma.cashback.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  console.log(`\nDiscipline 4 Results: ${passed} Passed, ${failed} Failed`);
  return { category: "Concurrency & Race Condition Testing", passed, failed };
}

if (process.argv[1]?.endsWith("4-concurrency-race-conditions.mjs")) {
  runConcurrencyTests().catch(console.error);
}
