/**
 * QA Audit Discipline 3: State-Transition & Workflow Testing
 * Covers:
 * - Exhaustive state-machine matrix for Conversion, Cashback, and CashbackDebt
 * - Invalid transition rejection (e.g. PENDING -> REVERSED, REJECTED -> CONFIRMED)
 * - Complete end-to-end lifecycle from Click to Conversion to Confirmation to Reversal to Debt to Auto-Offset
 */

import assert from "assert";
import dotenv from "dotenv";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { updateCashbackStatus } from "../../src/modules/cashback/cashback.service.ts";
import { resolveDebt } from "../../src/modules/wallet/debt.service.ts";
import { processEligibleHoldReleases } from "../../src/modules/wallet/hold-back.service.ts";
import { debitWallet } from "../../src/modules/wallet/wallet.service.ts";
import { ingestNormalizedConversion, ConversionServiceError } from "../../src/modules/conversions/conversion.service.ts";

dotenv.config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export async function runStateMachineWorkflowTests() {
  console.log("\n================================================================================");
  console.log("   DISCIPLINE 3: STATE-TRANSITION & WORKFLOW TESTING");
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

  // Helper setup: test user & wallet
  const runId = Date.now();
  const user = await prisma.user.create({
    data: {
      authUserId: `sm-auth-${runId}`,
      email: `sm-user-${runId}@example.com`,
      name: "State Machine Tester",
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

  // ---------------------------------------------------------------------------
  // 3.1 EXHAUSTIVE CASHBACK STATE-TRANSITION MATRIX
  // ---------------------------------------------------------------------------
  console.log("--- 3.1 Exhaustive Cashback State-Transition Matrix ---");

  // Invalid: PENDING -> REVERSED
  await test("Reject invalid transition: PENDING -> REVERSED", async () => {
    const cb = await prisma.cashback.create({
      data: { userId: user.id, amount: 100.0, status: "PENDING" },
    });
    await assert.rejects(
      async () => updateCashbackStatus(cb.id, "REVERSED"),
      /Invalid cashback status transition from PENDING to REVERSED/
    );
  });

  // Invalid: PENDING -> CONFIRMED (skipping APPROVED)
  await test("Reject invalid transition: PENDING -> CONFIRMED (must be APPROVED first)", async () => {
    const cb = await prisma.cashback.create({
      data: { userId: user.id, amount: 100.0, status: "PENDING" },
    });
    await assert.rejects(
      async () => updateCashbackStatus(cb.id, "CONFIRMED"),
      /Invalid cashback status transition from PENDING to CONFIRMED/
    );
  });

  // Invalid: REJECTED -> CONFIRMED
  await test("Reject invalid transition: REJECTED -> CONFIRMED", async () => {
    const cb = await prisma.cashback.create({
      data: { userId: user.id, amount: 100.0, status: "REJECTED" },
    });
    await assert.rejects(
      async () => updateCashbackStatus(cb.id, "CONFIRMED"),
      /Invalid cashback status transition from REJECTED to CONFIRMED/
    );
  });

  // Invalid: REVERSED -> CONFIRMED
  await test("Reject invalid transition: REVERSED -> CONFIRMED", async () => {
    const cb = await prisma.cashback.create({
      data: { userId: user.id, amount: 100.0, status: "REVERSED" },
    });
    await assert.rejects(
      async () => updateCashbackStatus(cb.id, "CONFIRMED"),
      /Invalid cashback status transition from REVERSED to CONFIRMED/
    );
  });

  // Invalid: CONFIRMED -> PENDING
  await test("Reject invalid transition: CONFIRMED -> PENDING", async () => {
    const cb = await prisma.cashback.create({
      data: { userId: user.id, amount: 100.0, status: "CONFIRMED" },
    });
    await assert.rejects(
      async () => updateCashbackStatus(cb.id, "PENDING"),
      /Invalid cashback status transition from CONFIRMED to PENDING/
    );
  });

  // ---------------------------------------------------------------------------
  // 3.2 CASHBACK DEBT STATE-TRANSITION MATRIX
  // ---------------------------------------------------------------------------
  console.log("\n--- 3.2 CashbackDebt State-Transition Matrix ---");

  await test("Reject invalid debt transition: WRITTEN_OFF -> RECOVER_MANUAL", async () => {
    await prisma.wallet.update({
      where: { id: user.wallet.id },
      data: { debtBalance: 50.0 },
    });

    const debt = await prisma.cashbackDebt.create({
      data: {
        walletId: user.wallet.id,
        userId: user.id,
        amount: 50.0,
        remainingAmount: 50.0,
        status: "OPEN",
      },
    });

    // Write-off first (reduces debtBalance from 50 to 0)
    await resolveDebt(debt.id, user.id, { action: "WRITE_OFF", notes: "Test" });

    // Attempt to recover an already written-off debt
    await assert.rejects(
      async () => resolveDebt(debt.id, user.id, { action: "RECOVER_MANUAL", notes: "Bad action" }),
      /Debt is already WRITTEN_OFF/
    );

    // Clean up debt
    await prisma.cashbackDebt.delete({ where: { id: debt.id } });
  });

  await test("Reject unfreezing a debt that is already OPEN", async () => {
    const debt = await prisma.cashbackDebt.create({
      data: {
        walletId: user.wallet.id,
        userId: user.id,
        amount: 30.0,
        remainingAmount: 30.0,
        status: "OPEN",
      },
    });

    await assert.rejects(
      async () => resolveDebt(debt.id, user.id, { action: "UNFREEZE" }),
      /Only DISPUTED or UNDER_REVIEW debts can be unfrozen/
    );

    // Clean up debt
    await prisma.cashbackDebt.delete({ where: { id: debt.id } });
  });

  // ---------------------------------------------------------------------------
  // 3.3 FULL END-TO-END FINANCIAL LIFECYCLE WORKFLOW
  // ---------------------------------------------------------------------------
  console.log("\n--- 3.3 End-to-End Financial Lifecycle Workflow ---");

  await test("Full Lifecycle: Ingestion -> Hold -> Matured Release -> Payout -> Reversal -> Debt -> Offset", async () => {
    // 1. Initial State: Wallet is 0
    let w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.availableBalance.toFixed(2), "0.00");
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
    assert.strictEqual(w.debtBalance.toFixed(2), "0.00");

    // 2. Cashback created in PENDING
    const cb = await prisma.cashback.create({
      data: { userId: user.id, amount: 200.0, status: "PENDING" },
    });

    // 3. Status transitions to APPROVED (Zero wallet credit)
    await updateCashbackStatus(cb.id, "APPROVED");
    w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.availableBalance.toFixed(2), "0.00");
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");

    // 4. Status transitions to CONFIRMED (Credits ₹200 to heldBalance)
    await updateCashbackStatus(cb.id, "CONFIRMED", undefined, { provider: "GENERIC" });
    w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.availableBalance.toFixed(2), "0.00");
    assert.strictEqual(w.heldBalance.toFixed(2), "200.00");
    assert.strictEqual(w.debtBalance.toFixed(2), "0.00");

    // 5. Simulate hold duration elapsed: set heldUntil in past & execute hold release job
    await prisma.cashback.update({
      where: { id: cb.id },
      data: { heldUntil: new Date(Date.now() - 10000) },
    });
    const releaseRes = await processEligibleHoldReleases();
    assert.strictEqual(releaseRes.processedCount >= 1, true);

    w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
    assert.strictEqual(w.availableBalance.toFixed(2), "200.00");

    // 6. User withdraws ₹120.00 from available balance
    await debitWallet({
      userId: user.id,
      amount: 120.0,
      category: "PAYOUT",
      description: "User withdrawal",
      idempotencyKey: `payout-sm-${runId}`,
    });
    w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.availableBalance.toFixed(2), "80.00");

    // 7. Full reversal of original ₹200.00 cashback
    // Multi-stage drawdown: ₹0 held, ₹80 available drained, ₹120 shortfall created as Debt!
    await updateCashbackStatus(cb.id, "REVERSED", "Customer returned goods", {
      eventKey: `rev-sm-${runId}`,
      provider: "GENERIC",
    });

    w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
    assert.strictEqual(w.availableBalance.toFixed(2), "0.00");
    assert.strictEqual(w.debtBalance.toFixed(2), "120.00");

    // Check open debt record
    const createdDebt = await prisma.cashbackDebt.findFirst({
      where: { walletId: user.wallet.id, originatingCashbackId: cb.id },
    });
    assert.ok(createdDebt);
    assert.strictEqual(createdDebt.status, "OPEN");
    assert.strictEqual(createdDebt.amount.toFixed(2), "120.00");
    assert.strictEqual(createdDebt.remainingAmount.toFixed(2), "120.00");

    // 8. Subsequent confirmation of ₹70.00 cashback
    // Auto-offset: all ₹70 pays down debt! Debt drops from ₹120 to ₹50; ₹0 enters hold!
    const cb2 = await prisma.cashback.create({
      data: { userId: user.id, amount: 70.0, status: "APPROVED" },
    });
    await updateCashbackStatus(cb2.id, "CONFIRMED", undefined, { provider: "GENERIC" });

    w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.debtBalance.toFixed(2), "50.00");
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
    assert.strictEqual(w.availableBalance.toFixed(2), "0.00");

    const updatedDebt = await prisma.cashbackDebt.findUnique({ where: { id: createdDebt.id } });
    assert.strictEqual(updatedDebt.remainingAmount.toFixed(2), "50.00");
    assert.strictEqual(updatedDebt.status, "OPEN");
  });

  // Cleanup test records
  await prisma.walletTransaction.deleteMany({ where: { walletId: user.wallet.id } });
  await prisma.cashbackDebt.deleteMany({ where: { walletId: user.wallet.id } });
  await prisma.cashback.deleteMany({ where: { userId: user.id } });
  await prisma.wallet.delete({ where: { id: user.wallet.id } });
  await prisma.user.delete({ where: { id: user.id } });

  // ---------------------------------------------------------------------------
  // 3.4 CONVERSION STATE-TRANSITION MATRIX & FIRST-CONTACT CONFIRMED INGESTION
  // ---------------------------------------------------------------------------
  console.log("\n--- 3.4 Conversion State-Transition Matrix & First-Contact Ingestion ---");

  // First-contact CONFIRMED ingestion
  await test("First-contact CONFIRMED: conversion arriving as CONFIRMED auto-chains PENDING -> APPROVED -> CONFIRMED and credits wallet heldBalance", async () => {
    const fcUser = await prisma.user.create({
      data: {
        authUserId: `fc-user-${runId}`,
        email: `fc-user-${runId}@example.com`,
        name: "First Contact Tester",
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

    const fcMerchant = await prisma.merchant.create({
      data: {
        name: `FC Merchant ${runId}`,
        slug: `fc-merchant-${runId}`,
      },
    });

    const fcDeal = await prisma.deal.create({
      data: {
        title: `FC Deal ${runId}`,
        slug: `fc-deal-${runId}`,
        merchantId: fcMerchant.id,
        affiliateUrl: "https://example.com/dest",
        originalPrice: 300,
        dealPrice: 250,
      },
    });

    const fcCampaign = await prisma.campaign.create({
      data: {
        name: `FC Campaign ${runId}`,
        merchantId: fcMerchant.id,
        dealId: fcDeal.id,
        shareType: "FIXED",
        userShareValue: 150.0,
        minOrderAmount: 10.0,
        priority: 100,
        isActive: true,
      },
    });

    const fcClick = await prisma.affiliateClick.create({
      data: {
        clickId: `fc-click-${runId}`,
        userId: fcUser.id,
        merchantId: fcMerchant.id,
        dealId: fcDeal.id,
        landingDestination: "https://example.com/dest",
      },
    });

    // Ingest first contact with status: "CONFIRMED"
    const extId = `fc-tx-${runId}`;
    const result = await ingestNormalizedConversion({
      provider: "GENERIC",
      externalTransactionId: extId,
      clickId: fcClick.clickId,
      orderAmount: "300.00",
      commissionAmount: "180.00",
      status: "CONFIRMED",
    });

    assert.strictEqual(result.status, "CONFIRMED");
    assert.strictEqual(result.isDuplicate, false);
    assert.strictEqual(result.cashbackAmount, "150.00");
    assert.ok(result.cashbackId);

    // Verify Conversion status in DB
    const conv = await prisma.conversion.findUnique({
      where: { id: result.conversionId },
      include: { cashback: true },
    });
    assert.strictEqual(conv.status, "CONFIRMED");
    assert.strictEqual(conv.cashback.status, "CONFIRMED");
    assert.strictEqual(conv.cashback.heldAmount.toFixed(2), "150.00");

    // Verify wallet heldBalance received the credit
    const fcWallet = await prisma.wallet.findUnique({ where: { id: fcUser.wallet.id } });
    assert.strictEqual(fcWallet.heldBalance.toFixed(2), "150.00");
    assert.strictEqual(fcWallet.balance.toFixed(2), "150.00");

    // Verify idempotency: duplicate delivery of the same CONFIRMED conversion produces no duplicate credit
    const dupResult = await ingestNormalizedConversion({
      provider: "GENERIC",
      externalTransactionId: extId,
      clickId: fcClick.clickId,
      orderAmount: "300.00",
      commissionAmount: "180.00",
      status: "CONFIRMED",
    });
    assert.strictEqual(dupResult.isDuplicate, true);
    assert.strictEqual(dupResult.status, "CONFIRMED");

    const fcWalletAfterDup = await prisma.wallet.findUnique({ where: { id: fcUser.wallet.id } });
    assert.strictEqual(fcWalletAfterDup.heldBalance.toFixed(2), "150.00"); // Unchanged!

    // Cleanup
    await prisma.walletTransaction.deleteMany({ where: { walletId: fcUser.wallet.id } });
    await prisma.conversion.delete({ where: { id: conv.id } });
    await prisma.cashback.delete({ where: { id: conv.cashbackId } });
    await prisma.affiliateClick.delete({ where: { id: fcClick.id } });
    await prisma.campaign.delete({ where: { id: fcCampaign.id } });
    await prisma.deal.delete({ where: { id: fcDeal.id } });
    await prisma.merchant.delete({ where: { id: fcMerchant.id } });
    await prisma.wallet.delete({ where: { id: fcUser.wallet.id } });
    await prisma.user.delete({ where: { id: fcUser.id } });
  });

  // First-contact APPROVED ingestion
  await test("First-contact APPROVED: conversion arriving as APPROVED auto-chains PENDING -> APPROVED and creates zero wallet credit", async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `fc-app-user-${runId}`,
        email: `fc-app-${runId}@example.com`,
        name: "FC Approved Tester",
        wallet: {
          create: { balance: 0.0, availableBalance: 0.0, heldBalance: 0.0, debtBalance: 0.0 },
        },
      },
      include: { wallet: true },
    });

    const merchant = await prisma.merchant.create({
      data: { name: `FC App Merchant ${runId}`, slug: `fc-app-merch-${runId}` },
    });

    const deal = await prisma.deal.create({
      data: {
        title: `FC App Deal ${runId}`,
        slug: `fc-app-deal-${runId}`,
        merchantId: merchant.id,
        affiliateUrl: "https://example.com/dest",
        originalPrice: 200,
        dealPrice: 150,
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: `FC App Campaign ${runId}`,
        merchantId: merchant.id,
        dealId: deal.id,
        shareType: "FIXED",
        userShareValue: 75.0,
        minOrderAmount: 10.0,
        priority: 100,
        isActive: true,
      },
    });

    const click = await prisma.affiliateClick.create({
      data: {
        clickId: `fc-app-click-${runId}`,
        userId: user.id,
        merchantId: merchant.id,
        dealId: deal.id,
        landingDestination: "https://example.com/dest",
      },
    });

    const extId = `fc-app-tx-${runId}`;
    const result = await ingestNormalizedConversion({
      provider: "GENERIC",
      externalTransactionId: extId,
      clickId: click.clickId,
      orderAmount: "200.00",
      commissionAmount: "100.00",
      status: "APPROVED",
    });

    assert.strictEqual(result.status, "APPROVED");
    assert.strictEqual(result.isDuplicate, false);
    assert.strictEqual(result.cashbackAmount, "75.00");
    assert.ok(result.cashbackId);

    const conv = await prisma.conversion.findUnique({
      where: { id: result.conversionId },
      include: { cashback: true },
    });
    assert.strictEqual(conv.status, "APPROVED");
    assert.strictEqual(conv.cashback.status, "APPROVED");

    // Wallet balances must remain exactly 0.00 (no premature credit)
    const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.balance.toFixed(2), "0.00");
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
    assert.strictEqual(w.availableBalance.toFixed(2), "0.00");

    // Cleanup
    await prisma.conversion.delete({ where: { id: conv.id } });
    await prisma.cashback.delete({ where: { id: conv.cashbackId } });
    await prisma.affiliateClick.delete({ where: { id: click.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.deal.delete({ where: { id: deal.id } });
    await prisma.merchant.delete({ where: { id: merchant.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // First-contact REJECTED ingestion
  await test("First-contact REJECTED: conversion arriving as REJECTED auto-chains PENDING -> REJECTED and creates zero wallet credit", async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `fc-rej-user-${runId}`,
        email: `fc-rej-${runId}@example.com`,
        name: "FC Rejected Tester",
        wallet: {
          create: { balance: 0.0, availableBalance: 0.0, heldBalance: 0.0, debtBalance: 0.0 },
        },
      },
      include: { wallet: true },
    });

    const merchant = await prisma.merchant.create({
      data: { name: `FC Rej Merchant ${runId}`, slug: `fc-rej-merch-${runId}` },
    });

    const deal = await prisma.deal.create({
      data: {
        title: `FC Rej Deal ${runId}`,
        slug: `fc-rej-deal-${runId}`,
        merchantId: merchant.id,
        affiliateUrl: "https://example.com/dest",
        originalPrice: 200,
        dealPrice: 150,
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: `FC Rej Campaign ${runId}`,
        merchantId: merchant.id,
        dealId: deal.id,
        shareType: "FIXED",
        userShareValue: 75.0,
        minOrderAmount: 10.0,
        priority: 100,
        isActive: true,
      },
    });

    const click = await prisma.affiliateClick.create({
      data: {
        clickId: `fc-rej-click-${runId}`,
        userId: user.id,
        merchantId: merchant.id,
        dealId: deal.id,
        landingDestination: "https://example.com/dest",
      },
    });

    const extId = `fc-rej-tx-${runId}`;
    const result = await ingestNormalizedConversion({
      provider: "GENERIC",
      externalTransactionId: extId,
      clickId: click.clickId,
      orderAmount: "200.00",
      commissionAmount: "100.00",
      status: "REJECTED",
      notes: "Suspected fraud",
    });

    assert.strictEqual(result.status, "REJECTED");
    assert.strictEqual(result.isDuplicate, false);

    const conv = await prisma.conversion.findUnique({
      where: { id: result.conversionId },
      include: { cashback: true },
    });
    assert.strictEqual(conv.status, "REJECTED");
    assert.strictEqual(conv.cashback.status, "REJECTED");
    assert.strictEqual(conv.cashback.rejectionReason, "Suspected fraud");

    // Wallet balances must remain exactly 0.00
    const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
    assert.strictEqual(w.balance.toFixed(2), "0.00");
    assert.strictEqual(w.heldBalance.toFixed(2), "0.00");
    assert.strictEqual(w.availableBalance.toFixed(2), "0.00");

    // Cleanup
    await prisma.conversion.delete({ where: { id: conv.id } });
    await prisma.cashback.delete({ where: { id: conv.cashbackId } });
    await prisma.affiliateClick.delete({ where: { id: click.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.deal.delete({ where: { id: deal.id } });
    await prisma.merchant.delete({ where: { id: merchant.id } });
    await prisma.wallet.delete({ where: { id: user.wallet.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // Conversion state transition matrix tests
  await test("Enforce VALID_CONVERSION_TRANSITIONS: reject illegal lifecycle jumps", async () => {
    const matUser = await prisma.user.create({
      data: {
        authUserId: `mat-user-${runId}`,
        email: `mat-user-${runId}@example.com`,
        name: "Matrix Tester",
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

    const matMerchant = await prisma.merchant.create({
      data: {
        name: `Mat Merchant ${runId}`,
        slug: `mat-merchant-${runId}`,
      },
    });

    const matDeal = await prisma.deal.create({
      data: {
        title: `Mat Deal ${runId}`,
        slug: `mat-deal-${runId}`,
        merchantId: matMerchant.id,
        affiliateUrl: "https://example.com/dest",
        originalPrice: 200,
        dealPrice: 150,
      },
    });

    const matCampaign = await prisma.campaign.create({
      data: {
        name: `Mat Campaign ${runId}`,
        merchantId: matMerchant.id,
        dealId: matDeal.id,
        shareType: "FIXED",
        userShareValue: 50.0,
        minOrderAmount: 10.0,
        priority: 100,
        isActive: true,
      },
    });

    const matClick = await prisma.affiliateClick.create({
      data: {
        clickId: `mat-click-${runId}`,
        userId: matUser.id,
        merchantId: matMerchant.id,
        dealId: matDeal.id,
        landingDestination: "https://example.com/dest",
      },
    });

    const extId = `mat-tx-${runId}`;

    // 1. Initial ingestion as PENDING
    const initial = await ingestNormalizedConversion({
      provider: "GENERIC",
      externalTransactionId: extId,
      clickId: matClick.clickId,
      orderAmount: "100.00",
      commissionAmount: "60.00",
      status: "PENDING",
    });
    assert.strictEqual(initial.status, "PENDING");

    // 2. Reject illegal transition: PENDING -> REVERSED
    await assert.rejects(
      async () =>
        ingestNormalizedConversion({
          provider: "GENERIC",
          externalTransactionId: extId,
          clickId: matClick.clickId,
          orderAmount: "100.00",
          commissionAmount: "60.00",
          status: "REVERSED",
        }),
      (err) => {
        assert.ok(err instanceof ConversionServiceError || err.code === "INVALID_STATUS_TRANSITION");
        assert.ok(/Invalid conversion status transition from PENDING to REVERSED/.test(err.message));
        return true;
      }
    );

    // 3. Valid transition: PENDING -> CONFIRMED
    const confirmed = await ingestNormalizedConversion({
      provider: "GENERIC",
      externalTransactionId: extId,
      clickId: matClick.clickId,
      orderAmount: "100.00",
      commissionAmount: "60.00",
      status: "CONFIRMED",
    });
    assert.strictEqual(confirmed.status, "CONFIRMED");

    // 4. Reject illegal backward transition: CONFIRMED -> APPROVED
    await assert.rejects(
      async () =>
        ingestNormalizedConversion({
          provider: "GENERIC",
          externalTransactionId: extId,
          clickId: matClick.clickId,
          orderAmount: "100.00",
          commissionAmount: "60.00",
          status: "APPROVED",
        }),
      (err) => {
        assert.ok(err instanceof ConversionServiceError || err.code === "INVALID_STATUS_TRANSITION");
        assert.ok(/Invalid conversion status transition from CONFIRMED to APPROVED/.test(err.message));
        return true;
      }
    );

    // 5. Valid transition: CONFIRMED -> REVERSED
    const reversed = await ingestNormalizedConversion({
      provider: "GENERIC",
      externalTransactionId: extId,
      clickId: matClick.clickId,
      orderAmount: "100.00",
      commissionAmount: "60.00",
      status: "REVERSED",
      notes: "Customer return",
    });
    assert.strictEqual(reversed.status, "REVERSED");

    // 6. Reject illegal transition from terminal state: REVERSED -> CONFIRMED
    await assert.rejects(
      async () =>
        ingestNormalizedConversion({
          provider: "GENERIC",
          externalTransactionId: extId,
          clickId: matClick.clickId,
          orderAmount: "100.00",
          commissionAmount: "60.00",
          status: "CONFIRMED",
        }),
      (err) => {
        assert.ok(err instanceof ConversionServiceError || err.code === "INVALID_STATUS_TRANSITION");
        assert.ok(/Invalid conversion status transition from REVERSED to CONFIRMED/.test(err.message));
        return true;
      }
    );

    // Cleanup
    await prisma.walletTransaction.deleteMany({ where: { walletId: matUser.wallet.id } });
    await prisma.conversion.delete({ where: { id: initial.conversionId } });
    if (initial.cashbackId) {
      await prisma.cashback.delete({ where: { id: initial.cashbackId } });
    }
    await prisma.affiliateClick.delete({ where: { id: matClick.id } });
    await prisma.campaign.delete({ where: { id: matCampaign.id } });
    await prisma.deal.delete({ where: { id: matDeal.id } });
    await prisma.merchant.delete({ where: { id: matMerchant.id } });
    await prisma.wallet.delete({ where: { id: matUser.wallet.id } });
    await prisma.user.delete({ where: { id: matUser.id } });
  });

  console.log(`\nDiscipline 3 Results: ${passed} Passed, ${failed} Failed`);
  return { category: "State-Transition & Workflow Testing", passed, failed };
}

if (process.argv[1]?.endsWith("3-state-machine-lifecycle.mjs")) {
  runStateMachineWorkflowTests().catch(console.error);
}
