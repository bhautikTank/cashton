/**
 * QA Audit Discipline 8: Complete Withdrawal & Payout Engine Testing (Phase 8)
 * 33 Exhaustive Database-Backed, Concurrency & Adversarial Scenarios Covering:
 * - 8.1  Successful withdrawal (Request -> PENDING -> Atomic Debit)
 * - 8.2  Minimum threshold (₹250.00 exact boundary accepted)
 * - 8.3  Below-minimum rejection (< ₹250.00)
 * - 8.4  Maximum threshold (Exceeding ₹1,000,000.00 rejected)
 * - 8.5  Unverified payout details rejection
 * - 8.6  Insufficient available balance rejection
 * - 8.7  Outstanding debt blocks withdrawal
 * - 8.8  Duplicate withdrawal request (sequential)
 * - 8.9  Concurrent identical withdrawal requests (Promise.allSettled)
 * - 8.10 Admin approval (PENDING -> PROCESSING)
 * - 8.11 Completion without approval rejected (PENDING -> PAID rejected)
 * - 8.12 Successful payout completion (PROCESSING -> PAID)
 * - 8.13 Admin rejection and refund (PENDING/PROCESSING -> REJECTED)
 * - 8.14 Duplicate rejection rejected (terminal state cannot be re-rejected)
 * - 8.15 Failed callback and refund (PROCESSING -> FAILED)
 * - 8.16 Duplicate failed callback (idempotent, no second refund)
 * - 8.17 Duplicate successful callback (idempotent, no duplicate credit)
 * - 8.18 Invalid callback authentication & manual provider blocked (Pure unit check)
 * - 8.19 Conflicting admin rejection and callback operations
 * - 8.20 Concurrent refund attempts (admin reject vs callback fail race)
 * - 8.21 User cannot access another user's payout (service + list isolation)
 * - 8.22 Cross-account idempotency collision guard
 * - 8.23 No partial payout behavior
 * - 8.24 Ledger-to-wallet balance reconciliation
 * - 8.25 Concurrent withdrawal requests competing for insufficient combined funds
 * - 8.26 Concurrent cross-user identical idempotencyKey collision
 * - 8.27 Simultaneous admin approval and rejection on PENDING payout
 * - 8.28 Simultaneous admin completion and rejection on PROCESSING payout
 * - 8.29 Duplicate & concurrent payout completion attempts
 * - 8.30 Concurrent identical webhook callbacks (SUCCESS and FAILED/REVERSED)
 * - 8.31 Database failure between wallet debit and payout creation + clean retry
 * - 8.32 Database failure during refund + clean retry
 * - 8.33 Exhaustive invalid state transitions & MANUAL payout webhook block
 */

import assert from "assert";
import crypto from "crypto";
import dotenv from "dotenv";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createWithdrawalRequest,
  approvePayout,
  completePayout,
  rejectPayout,
  handlePayoutCallback,
  getPayoutById,
  listPayouts,
  savePayoutDetails,
  validatePayoutTransition,
} from "../../src/modules/payout/payout.service.ts";
import { withdrawalRequestSchema } from "../../src/lib/validations/payout.schema.ts";
import { debitWallet } from "../../src/modules/wallet/wallet.service.ts";
import { verifyPayoutWebhookSignature } from "../../src/lib/security/payout-signature.ts";

dotenv.config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

async function createTestUser({
  prefix,
  balance = 0,
  availableBalance = 0,
  debtBalance = 0,
  payoutStatus = "VERIFIED",
  withPayoutDetails = true,
  role = "USER",
}) {
  const tag = uid(prefix);
  return prisma.user.create({
    data: {
      authUserId: `auth-${tag}`,
      email: `${tag}@example.com`,
      role,
      wallet: {
        create: {
          balance,
          availableBalance,
          heldBalance: 0.0,
          debtBalance,
        },
      },
      ...(withPayoutDetails
        ? {
            payoutDetails: {
              create: {
                payoutMethod: "UPI",
                upiId: `${tag}@upi`,
                status: payoutStatus,
              },
            },
          }
        : {}),
    },
    include: { wallet: true },
  });
}

async function cleanupUsers(users) {
  for (const u of users) {
    if (!u) continue;
    if (u.wallet?.id) {
      await prisma.walletTransaction.deleteMany({ where: { walletId: u.wallet.id } });
    }
    await prisma.payout.deleteMany({ where: { userId: u.id } });
    await prisma.payoutDetails.deleteMany({ where: { userId: u.id } });
    if (u.wallet?.id) {
      await prisma.wallet.deleteMany({ where: { id: u.wallet.id } });
    }
    await prisma.user.deleteMany({ where: { id: u.id } });
  }
}

export async function runWithdrawalPayoutTests() {
  console.log("\n================================================================================");
  console.log("   DISCIPLINE 8: COMPLETE WITHDRAWAL & PAYOUT ENGINE TEST SUITE (PHASE 8)");
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

  // ---------------------------------------------------------------------------
  // 8.1 SUCCESSFUL WITHDRAWAL
  // ---------------------------------------------------------------------------
  await test("8.1 Successful withdrawal (Request -> PENDING -> Atomic Debit)", async () => {
    const user = await createTestUser({ prefix: "wd-81", balance: 1000, availableBalance: 1000 });
    try {
      const res = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 500.0, idempotencyKey: uid("idemp-81") },
      });

      assert.strictEqual(res.isDuplicate, false);
      assert.strictEqual(res.payout.status, "PENDING");
      assert.strictEqual(Number(res.payout.amount), 500.0);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "500.00");
      assert.strictEqual(w.balance.toFixed(2), "500.00");

      const tx = await prisma.walletTransaction.findFirst({
        where: { walletId: user.wallet.id, payoutId: res.payout.id },
      });
      assert.ok(tx);
      assert.strictEqual(tx.category, "PAYOUT");
      assert.strictEqual(tx.type, "DEBIT");
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.2 MINIMUM THRESHOLD (₹250.00)
  // ---------------------------------------------------------------------------
  await test("8.2 Minimum threshold (₹250.00 exact boundary accepted)", async () => {
    const user = await createTestUser({ prefix: "wd-82", balance: 500, availableBalance: 500 });
    try {
      const res = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 250.0, idempotencyKey: uid("idemp-82") },
      });
      assert.strictEqual(res.payout.status, "PENDING");
      assert.strictEqual(Number(res.payout.amount), 250.0);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "250.00");
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.3 BELOW-MINIMUM REJECTION (< ₹250.00)
  // ---------------------------------------------------------------------------
  await test("8.3 Below-minimum rejection (₹249.99 rejected with clear code)", async () => {
    const user = await createTestUser({ prefix: "wd-83", balance: 500, availableBalance: 500 });
    try {
      let rejected = false;
      try {
        await createWithdrawalRequest({
          userId: user.id,
          input: { amount: 249.99, idempotencyKey: uid("idemp-83") },
        });
      } catch (err) {
        rejected = true;
        assert.strictEqual(err.code, "BELOW_MINIMUM_THRESHOLD");
      }
      assert.strictEqual(rejected, true);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "500.00");
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.4 MAXIMUM THRESHOLD (₹1,000,000.00)
  // ---------------------------------------------------------------------------
  await test("8.4 Maximum threshold (Exceeding ₹1,000,000.00 rejected)", async () => {
    const user = await createTestUser({ prefix: "wd-84", balance: 2000000, availableBalance: 2000000 });
    try {
      let rejected = false;
      try {
        await createWithdrawalRequest({
          userId: user.id,
          input: { amount: 1000001.0, idempotencyKey: uid("idemp-84") },
        });
      } catch (err) {
        rejected = true;
        assert.strictEqual(err.code, "EXCEEDS_MAXIMUM_THRESHOLD");
      }
      assert.strictEqual(rejected, true);
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.5 UNVERIFIED PAYOUT DETAILS REJECTION
  // ---------------------------------------------------------------------------
  await test("8.5 Unverified payout details (status !== VERIFIED blocks withdrawal)", async () => {
    const user = await createTestUser({
      prefix: "wd-85",
      balance: 500,
      availableBalance: 500,
      payoutStatus: "PENDING",
    });
    try {
      let rejected = false;
      try {
        await createWithdrawalRequest({
          userId: user.id,
          input: { amount: 300.0, idempotencyKey: uid("idemp-85") },
        });
      } catch (err) {
        rejected = true;
        assert.strictEqual(err.code, "PAYOUT_DETAILS_NOT_VERIFIED");
      }
      assert.strictEqual(rejected, true);
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.6 INSUFFICIENT AVAILABLE BALANCE
  // ---------------------------------------------------------------------------
  await test("8.6 Insufficient available balance (Withdrawal exceeds available balance)", async () => {
    const user = await createTestUser({ prefix: "wd-86", balance: 300, availableBalance: 300 });
    try {
      let rejected = false;
      try {
        await createWithdrawalRequest({
          userId: user.id,
          input: { amount: 400.0, idempotencyKey: uid("idemp-86") },
        });
      } catch (err) {
        rejected = true;
        assert.strictEqual(err.code, "INSUFFICIENT_BALANCE");
      }
      assert.strictEqual(rejected, true);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "300.00");
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.7 OUTSTANDING DEBT BLOCKS WITHDRAWAL
  // ---------------------------------------------------------------------------
  await test("8.7 Outstanding debt blocks withdrawal (debtBalance > 0)", async () => {
    const user = await createTestUser({
      prefix: "wd-87",
      balance: 500,
      availableBalance: 500,
      debtBalance: 75,
    });
    try {
      let rejected = false;
      try {
        await createWithdrawalRequest({
          userId: user.id,
          input: { amount: 300.0, idempotencyKey: uid("idemp-87") },
        });
      } catch (err) {
        rejected = true;
        assert.strictEqual(err.code, "OUTSTANDING_DEBT_BLOCKS_WITHDRAWAL");
      }
      assert.strictEqual(rejected, true);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "500.00");
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.8 DUPLICATE WITHDRAWAL REQUEST (SEQUENTIAL)
  // ---------------------------------------------------------------------------
  await test("8.8 Duplicate withdrawal request (Sequential delivery returns same payout)", async () => {
    const user = await createTestUser({ prefix: "wd-88", balance: 1000, availableBalance: 1000 });
    try {
      const idempKey = uid("idemp-88");
      const res1 = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: idempKey },
      });
      assert.strictEqual(res1.isDuplicate, false);

      const res2 = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: idempKey },
      });
      assert.strictEqual(res2.isDuplicate, true);
      assert.strictEqual(res1.payout.id, res2.payout.id);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "700.00");
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.9 CONCURRENT IDENTICAL WITHDRAWAL REQUESTS
  // ---------------------------------------------------------------------------
  await test("8.9 Concurrent identical withdrawal requests (Promise.allSettled serialization)", async () => {
    const user = await createTestUser({ prefix: "wd-89", balance: 1000, availableBalance: 1000 });
    try {
      const idempKey = uid("conc-wd-89");
      const promises = Array.from({ length: 5 }, () =>
        createWithdrawalRequest({
          userId: user.id,
          input: { amount: 300.0, idempotencyKey: idempKey },
        })
      );

      const results = await Promise.allSettled(promises);
      for (const r of results) {
        assert.strictEqual(r.status, "fulfilled");
      }

      const payoutIds = results.map((r) => r.value.payout.id);
      assert.strictEqual(new Set(payoutIds).size, 1);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "700.00");

      const txs = await prisma.walletTransaction.findMany({ where: { walletId: user.wallet.id } });
      assert.strictEqual(txs.length, 1);
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.10 ADMIN APPROVAL (PENDING -> PROCESSING)
  // ---------------------------------------------------------------------------
  await test("8.10 Admin approval (Transitions PENDING to PROCESSING)", async () => {
    const user = await createTestUser({ prefix: "wd-810", balance: 500, availableBalance: 500 });
    const admin = await createTestUser({ prefix: "adm-810", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 250.0, idempotencyKey: uid("idemp-810") },
      });

      const approved = await approvePayout(req.payout.id, admin.id);
      assert.strictEqual(approved.status, "PROCESSING");
      assert.strictEqual(approved.processedByAdminId, admin.id);
      assert.ok(approved.providerReference.startsWith("MANUAL-"));
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.11 COMPLETION WITHOUT APPROVAL REJECTED
  // ---------------------------------------------------------------------------
  await test("8.11 Completion without approval rejected (PENDING -> PAID disallowed)", async () => {
    const user = await createTestUser({ prefix: "wd-811", balance: 500, availableBalance: 500 });
    const admin = await createTestUser({ prefix: "adm-811", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 250.0, idempotencyKey: uid("idemp-811") },
      });

      let rejected = false;
      try {
        await completePayout(req.payout.id, admin.id, "UTR-PREMATURE");
      } catch (err) {
        rejected = true;
        assert.strictEqual(err.code, "INVALID_PAYOUT_STATUS_TRANSITION");
      }
      assert.strictEqual(rejected, true);
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.12 SUCCESSFUL PAYOUT COMPLETION
  // ---------------------------------------------------------------------------
  await test("8.12 Successful payout completion (PROCESSING -> PAID)", async () => {
    const user = await createTestUser({ prefix: "wd-812", balance: 600, availableBalance: 600 });
    const admin = await createTestUser({ prefix: "adm-812", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-812") },
      });
      await approvePayout(req.payout.id, admin.id);

      const completed = await completePayout(req.payout.id, admin.id, "UTR-HDFC-FINAL-99");
      assert.strictEqual(completed.status, "PAID");
      assert.strictEqual(completed.providerReference, "UTR-HDFC-FINAL-99");

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "300.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.13 ADMIN REJECTION AND REFUND
  // ---------------------------------------------------------------------------
  await test("8.13 Admin rejection and refund (Restores exact amount via PAYOUT_REFUND)", async () => {
    const user = await createTestUser({ prefix: "wd-813", balance: 800, availableBalance: 800 });
    const admin = await createTestUser({ prefix: "adm-813", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 400.0, idempotencyKey: uid("idemp-813") },
      });

      const rejected = await rejectPayout(req.payout.id, admin.id, "Account flagged by risk engine");
      assert.strictEqual(rejected.status, "REJECTED");
      assert.strictEqual(rejected.failureReason, "Account flagged by risk engine");

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "800.00");

      const refundTx = await prisma.walletTransaction.findFirst({
        where: { payoutId: req.payout.id, category: "PAYOUT_REFUND" },
      });
      assert.ok(refundTx);
      assert.strictEqual(refundTx.type, "CREDIT");
      assert.strictEqual(Number(refundTx.amount), 400.0);
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.14 DUPLICATE REJECTION REJECTED
  // ---------------------------------------------------------------------------
  await test("8.14 Duplicate rejection rejected (Terminal REJECTED cannot be rejected again)", async () => {
    const user = await createTestUser({ prefix: "wd-814", balance: 800, availableBalance: 800 });
    const admin = await createTestUser({ prefix: "adm-814", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-814") },
      });
      await rejectPayout(req.payout.id, admin.id, "Initial rejection");

      let rejectedAgain = false;
      try {
        await rejectPayout(req.payout.id, admin.id, "Second rejection attempt");
      } catch (err) {
        rejectedAgain = true;
        assert.strictEqual(err.code, "INVALID_PAYOUT_STATUS_TRANSITION");
      }
      assert.strictEqual(rejectedAgain, true);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "800.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.15 FAILED CALLBACK AND REFUND
  // ---------------------------------------------------------------------------
  await test("8.15 Failed callback and refund (External provider stub reports failure -> refunds wallet)", async () => {
    const user = await createTestUser({ prefix: "wd-815", balance: 700, availableBalance: 700 });
    const admin = await createTestUser({ prefix: "adm-815", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 350.0, idempotencyKey: uid("idemp-815") },
      });
      await approvePayout(req.payout.id, admin.id);
      await prisma.payout.update({ where: { id: req.payout.id }, data: { provider: "CASHFREE" } });

      const cbRes = await handlePayoutCallback("CASHFREE", {
        payoutId: req.payout.id,
        providerReferenceId: uid("CF-FAIL"),
        status: "FAILED",
        failureReason: "Beneficiary bank server down",
      });

      assert.strictEqual(cbRes.isDuplicate, false);
      assert.strictEqual(cbRes.status, "FAILED");

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "700.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.16 DUPLICATE FAILED CALLBACK
  // ---------------------------------------------------------------------------
  await test("8.16 Duplicate failed callback (Repeated delivery is idempotent; no 2x refund)", async () => {
    const user = await createTestUser({ prefix: "wd-816", balance: 900, availableBalance: 900 });
    const admin = await createTestUser({ prefix: "adm-816", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 450.0, idempotencyKey: uid("idemp-816") },
      });
      await approvePayout(req.payout.id, admin.id);
      await prisma.payout.update({ where: { id: req.payout.id }, data: { provider: "CASHFREE" } });

      const payload = {
        payoutId: req.payout.id,
        providerReferenceId: uid("CF-DUP"),
        status: "FAILED",
        failureReason: "Network timeout",
      };

      const cb1 = await handlePayoutCallback("CASHFREE", payload);
      assert.strictEqual(cb1.isDuplicate, false);

      const cb2 = await handlePayoutCallback("CASHFREE", payload);
      assert.strictEqual(cb2.isDuplicate, true);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "900.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.17 DUPLICATE SUCCESSFUL CALLBACK
  // ---------------------------------------------------------------------------
  await test("8.17 Duplicate successful callback (Idempotent delivery for PAID outcome)", async () => {
    const user = await createTestUser({ prefix: "wd-817", balance: 600, availableBalance: 600 });
    const admin = await createTestUser({ prefix: "adm-817", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-817") },
      });
      await approvePayout(req.payout.id, admin.id);
      await prisma.payout.update({ where: { id: req.payout.id }, data: { provider: "RAZORPAYX" } });

      const payload = {
        payoutId: req.payout.id,
        providerReferenceId: uid("RZ-SUCCESS"),
        status: "SUCCESS",
      };

      const cb1 = await handlePayoutCallback("RAZORPAYX", payload);
      assert.strictEqual(cb1.isDuplicate, false);
      assert.strictEqual(cb1.status, "PAID");

      const cb2 = await handlePayoutCallback("RAZORPAYX", payload);
      assert.strictEqual(cb2.isDuplicate, true);
      assert.strictEqual(cb2.status, "PAID");

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "300.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.18 INVALID CALLBACK AUTHENTICATION & MANUAL PROVIDER BLOCKED
  // ---------------------------------------------------------------------------
  await test("8.18 Invalid callback auth & IEEE-754 decimal schema (MANUAL 403, unsupported 400, missing secret 503, bad HMAC 401, valid HMAC 200)", async () => {
    const manualCheck = verifyPayoutWebhookSignature("MANUAL", "{}", "dummy-sig");
    assert.strictEqual(manualCheck.isValid, false);
    assert.strictEqual(manualCheck.statusCode, 403);

    const unknownCheck = verifyPayoutWebhookSignature("UNKNOWN_PROVIDER", "{}", "dummy-sig");
    assert.strictEqual(unknownCheck.isValid, false);
    assert.strictEqual(unknownCheck.statusCode, 400);

    const origSecret = process.env.PAYOUT_WEBHOOK_SECRET;
    delete process.env.PAYOUT_WEBHOOK_SECRET;

    const noSecretCheck = verifyPayoutWebhookSignature("CASHFREE", "{}", "dummy-sig");
    assert.strictEqual(noSecretCheck.isValid, false);
    assert.strictEqual(noSecretCheck.statusCode, 503);

    process.env.PAYOUT_WEBHOOK_SECRET = "super-secret-test-key";
    const invalidCheck = verifyPayoutWebhookSignature("CASHFREE", "{}", "001122334455");
    assert.strictEqual(invalidCheck.isValid, false);
    assert.strictEqual(invalidCheck.statusCode, 401);

    const testBody = JSON.stringify({ payoutId: "123", status: "SUCCESS" });
    const validHmac = crypto
      .createHmac("sha256", process.env.PAYOUT_WEBHOOK_SECRET)
      .update(testBody)
      .digest("hex");

    const validCheck = verifyPayoutWebhookSignature("CASHFREE", testBody, validHmac);
    assert.strictEqual(validCheck.isValid, true);
    assert.strictEqual(validCheck.statusCode, 200);

    // Optional x-webhook-timestamp replay window check (+-300s)
    const freshTs = String(Math.floor(Date.now() / 1000));
    assert.strictEqual(verifyPayoutWebhookSignature("CASHFREE", testBody, validHmac, freshTs).isValid, true);
    const staleTs = String(Math.floor(Date.now() / 1000) - 600);
    assert.strictEqual(verifyPayoutWebhookSignature("CASHFREE", testBody, validHmac, staleTs).statusCode, 401);

    // Verify IEEE-754 decimals pass & precision > 2 fails
    for (const validAmt of [250.29, 299.99, 500.55, 1000.14, "299.99"]) {
      assert.strictEqual(
        withdrawalRequestSchema.safeParse({ amount: validAmt, idempotencyKey: "idemp-valid-1234" }).success,
        true
      );
    }
    for (const badAmt of [250.999, "500abc", -300, Infinity]) {
      assert.strictEqual(
        withdrawalRequestSchema.safeParse({ amount: badAmt, idempotencyKey: "idemp-bad-1234" }).success,
        false
      );
    }

    if (origSecret) process.env.PAYOUT_WEBHOOK_SECRET = origSecret;
    else delete process.env.PAYOUT_WEBHOOK_SECRET;
  });

  // ---------------------------------------------------------------------------
  // 8.19 CONFLICTING ADMIN AND CALLBACK OPERATIONS
  // ---------------------------------------------------------------------------
  await test("8.19 Conflicting admin and callback (Admin reject followed by FAILED callback)", async () => {
    const user = await createTestUser({ prefix: "wd-819", balance: 800, availableBalance: 800 });
    const admin = await createTestUser({ prefix: "adm-819", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-819") },
      });
      await approvePayout(req.payout.id, admin.id);
      await prisma.payout.update({ where: { id: req.payout.id }, data: { provider: "CASHFREE" } });

      await rejectPayout(req.payout.id, admin.id, "Admin stopped transfer");

      const cb = await handlePayoutCallback("CASHFREE", {
        payoutId: req.payout.id,
        providerReferenceId: uid("CF-LATE"),
        status: "FAILED",
      });

      assert.strictEqual(cb.isDuplicate, true);
      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "800.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.20 CONCURRENT REFUND ATTEMPTS
  // ---------------------------------------------------------------------------
  await test("8.20 Concurrent refund attempts (Admin reject vs Callback fail race)", async () => {
    const user = await createTestUser({ prefix: "wd-820", balance: 1000, availableBalance: 1000 });
    const admin = await createTestUser({ prefix: "adm-820", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 400.0, idempotencyKey: uid("idemp-820") },
      });
      await approvePayout(req.payout.id, admin.id);
      await prisma.payout.update({ where: { id: req.payout.id }, data: { provider: "CASHFREE" } });

      const results = await Promise.allSettled([
        rejectPayout(req.payout.id, admin.id, "Concurrent admin rejection"),
        handlePayoutCallback("CASHFREE", {
          payoutId: req.payout.id,
          providerReferenceId: uid("CF-RACE"),
          status: "FAILED",
        }),
      ]);

      for (const r of results) {
        if (r.status === "rejected") {
          assert.ok(
            r.reason.message.includes("refunded") ||
              r.reason.message.includes("transition") ||
              r.reason.message.includes("REJECTED")
          );
        }
      }

      const refunds = await prisma.walletTransaction.findMany({
        where: { walletId: user.wallet.id, category: "PAYOUT_REFUND" },
      });
      assert.strictEqual(refunds.length, 1);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "1000.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.21 USER CANNOT ACCESS ANOTHER USER'S PAYOUT
  // ---------------------------------------------------------------------------
  await test("8.21 User cannot access another user's payout (Strict ownership & admin-email isolation)", async () => {
    const userA = await createTestUser({ prefix: "userA-821", balance: 500, availableBalance: 500 });
    const userB = await createTestUser({ prefix: "userB-821", balance: 500, availableBalance: 500, withPayoutDetails: false });
    try {
      const reqA = await createWithdrawalRequest({
        userId: userA.id,
        input: { amount: 250.0, idempotencyKey: uid("idemp-821") },
      });

      let blocked = false;
      try {
        await getPayoutById(reqA.payout.id, userB.id, false);
      } catch (err) {
        blocked = true;
        assert.strictEqual(err.code, "FORBIDDEN");
      }
      assert.strictEqual(blocked, true);

      // Non-admin listPayouts must not include admin PII
      const listRes = await listPayouts({ userId: userA.id, page: 1, limit: 10, includeAdminDetails: false });
      assert.strictEqual(listRes.payouts.length, 1);
      assert.strictEqual("processedByAdmin" in listRes.payouts[0], false);
    } finally {
      await cleanupUsers([userA, userB]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.22 CROSS-USER IDEMPOTENCY COLLISION (SEQUENTIAL)
  // ---------------------------------------------------------------------------
  await test("8.22 Cross-account idempotency collision guard (Sequential)", async () => {
    const userA = await createTestUser({ prefix: "userA-822", balance: 500, availableBalance: 500 });
    const userB = await createTestUser({ prefix: "userB-822", balance: 500, availableBalance: 500 });
    try {
      const sharedKey = uid("shared-idemp");
      await createWithdrawalRequest({
        userId: userA.id,
        input: { amount: 250.0, idempotencyKey: sharedKey },
      });

      let collision = false;
      try {
        await createWithdrawalRequest({
          userId: userB.id,
          input: { amount: 250.0, idempotencyKey: sharedKey },
        });
      } catch (err) {
        collision = true;
        assert.strictEqual(err.code, "IDEMPOTENCY_KEY_COLLISION");
      }
      assert.strictEqual(collision, true);
    } finally {
      await cleanupUsers([userA, userB]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.23 NO PARTIAL PAYOUT BEHAVIOR
  // ---------------------------------------------------------------------------
  await test("8.23 No partial payout behavior (All-or-nothing balance allocation)", async () => {
    const user = await createTestUser({ prefix: "wd-823", balance: 300, availableBalance: 300 });
    try {
      let failedReq = false;
      try {
        await createWithdrawalRequest({
          userId: user.id,
          input: { amount: 400.0, idempotencyKey: uid("idemp-823") },
        });
      } catch (err) {
        failedReq = true;
        assert.strictEqual(err.code, "INSUFFICIENT_BALANCE");
      }
      assert.strictEqual(failedReq, true);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "300.00");
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.24 LEDGER-TO-WALLET RECONCILIATION
  // ---------------------------------------------------------------------------
  await test("8.24 Ledger-to-wallet reconciliation (Historical integrity & ledger mathematical balance)", async () => {
    const user = await createTestUser({ prefix: "wd-824", balance: 1000, availableBalance: 1000 });
    const admin = await createTestUser({ prefix: "adm-824", role: "ADMIN", withPayoutDetails: false });
    try {
      const req1 = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-824-1") },
      });
      await approvePayout(req1.payout.id, admin.id);
      await completePayout(req1.payout.id, admin.id, "UTR-824-1");

      const req2 = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 250.0, idempotencyKey: uid("idemp-824-2") },
      });
      await rejectPayout(req2.payout.id, admin.id, "User requested cancellation");

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "700.00");

      const allTxs = await prisma.walletTransaction.findMany({ where: { walletId: user.wallet.id } });
      assert.strictEqual(allTxs.length, 3);

      const debits = allTxs.filter((t) => t.type === "DEBIT").reduce((acc, t) => acc + Number(t.amount), 0);
      const credits = allTxs.filter((t) => t.type === "CREDIT").reduce((acc, t) => acc + Number(t.amount), 0);
      assert.strictEqual((1000.0 + credits - debits).toFixed(2), w.availableBalance.toFixed(2));
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.25 CONCURRENT OVERDRAFT: TWO DISTINCT REQUESTS FOR INSUFFICIENT COMBINED FUNDS
  // ---------------------------------------------------------------------------
  await test("8.25 Concurrent withdrawal requests with distinct keys against ₹500 balance (₹300 x 2 -> 1 wins, 1 rejected)", async () => {
    const user = await createTestUser({ prefix: "wd-825", balance: 500, availableBalance: 500 });
    try {
      const results = await Promise.allSettled([
        createWithdrawalRequest({ userId: user.id, input: { amount: 300.0, idempotencyKey: uid("idemp-825-a") } }),
        createWithdrawalRequest({ userId: user.id, input: { amount: 300.0, idempotencyKey: uid("idemp-825-b") } }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.strictEqual(fulfilled.length, 1);
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].reason.code, "INSUFFICIENT_BALANCE");

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "200.00");

      const payouts = await prisma.payout.findMany({ where: { userId: user.id } });
      assert.strictEqual(payouts.length, 1);
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.26 CONCURRENT CROSS-USER IDEMPOTENCY KEY COLLISION
  // ---------------------------------------------------------------------------
  await test("8.26 Concurrent cross-user identical idempotencyKey -> 1 succeeds, 1 throws 409 IDEMPOTENCY_KEY_COLLISION", async () => {
    const userA = await createTestUser({ prefix: "userA-826", balance: 500, availableBalance: 500 });
    const userB = await createTestUser({ prefix: "userB-826", balance: 500, availableBalance: 500 });
    try {
      const sharedKey = uid("conc-shared-826");
      const results = await Promise.allSettled([
        createWithdrawalRequest({ userId: userA.id, input: { amount: 250.0, idempotencyKey: sharedKey } }),
        createWithdrawalRequest({ userId: userB.id, input: { amount: 250.0, idempotencyKey: sharedKey } }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.strictEqual(fulfilled.length, 1);
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].reason.code, "IDEMPOTENCY_KEY_COLLISION");
      assert.strictEqual(rejected[0].reason.statusCode, 409);
    } finally {
      await cleanupUsers([userA, userB]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.27 SIMULTANEOUS ADMIN APPROVAL AND REJECTION ON PENDING PAYOUT
  // ---------------------------------------------------------------------------
  await test("8.27 Simultaneous admin approve vs reject on PENDING payout serializes without double refund or corruption", async () => {
    const user = await createTestUser({ prefix: "wd-827", balance: 600, availableBalance: 600 });
    const admin = await createTestUser({ prefix: "adm-827", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-827") },
      });

      const results = await Promise.allSettled([
        approvePayout(req.payout.id, admin.id),
        rejectPayout(req.payout.id, admin.id, "Simultaneous reject"),
      ]);

      const updatedPayout = await prisma.payout.findUnique({ where: { id: req.payout.id } });
      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      const refunds = await prisma.walletTransaction.findMany({
        where: { payoutId: req.payout.id, category: "PAYOUT_REFUND" },
      });

      // Valid outcomes:
      // Case A: reject won lock first -> status REJECTED, approve failed INVALID_PAYOUT_STATUS_TRANSITION, balance 600, 1 refund
      // Case B: approve won lock first -> reject ran next (PROCESSING -> REJECTED), both fulfilled, balance 600, 1 refund
      assert.strictEqual(updatedPayout.status, "REJECTED");
      assert.strictEqual(w.availableBalance.toFixed(2), "600.00");
      assert.strictEqual(refunds.length, 1);

      const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
      assert.ok(fulfilledCount >= 1);
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.28 SIMULTANEOUS ADMIN COMPLETION AND REJECTION ON PROCESSING PAYOUT
  // ---------------------------------------------------------------------------
  await test("8.28 Simultaneous admin complete vs reject on PROCESSING payout is strictly mutually exclusive", async () => {
    const user = await createTestUser({ prefix: "wd-828", balance: 600, availableBalance: 600 });
    const admin = await createTestUser({ prefix: "adm-828", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-828") },
      });
      await approvePayout(req.payout.id, admin.id);

      const results = await Promise.allSettled([
        completePayout(req.payout.id, admin.id, "UTR-RACE-828"),
        rejectPayout(req.payout.id, admin.id, "Reject race 828"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.strictEqual(fulfilled.length, 1);
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].reason.code, "INVALID_PAYOUT_STATUS_TRANSITION");

      const finalPayout = await prisma.payout.findUnique({ where: { id: req.payout.id } });
      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      const refunds = await prisma.walletTransaction.findMany({
        where: { payoutId: req.payout.id, category: "PAYOUT_REFUND" },
      });

      if (finalPayout.status === "PAID") {
        assert.strictEqual(w.availableBalance.toFixed(2), "300.00");
        assert.strictEqual(refunds.length, 0);
      } else {
        assert.strictEqual(finalPayout.status, "REJECTED");
        assert.strictEqual(w.availableBalance.toFixed(2), "600.00");
        assert.strictEqual(refunds.length, 1);
      }
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.29 DUPLICATE & CONCURRENT PAYOUT COMPLETION
  // ---------------------------------------------------------------------------
  await test("8.29 Concurrent duplicate completePayout -> exactly 1 transitions to PAID, 1 rejected", async () => {
    const user = await createTestUser({ prefix: "wd-829", balance: 600, availableBalance: 600 });
    const admin = await createTestUser({ prefix: "adm-829", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-829") },
      });
      await approvePayout(req.payout.id, admin.id);

      const results = await Promise.allSettled([
        completePayout(req.payout.id, admin.id, "UTR-829-1"),
        completePayout(req.payout.id, admin.id, "UTR-829-2"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.strictEqual(fulfilled.length, 1);
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].reason.code, "INVALID_PAYOUT_STATUS_TRANSITION");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.30 CONCURRENT IDENTICAL WEBHOOK CALLBACKS (FAILED & SUCCESS)
  // ---------------------------------------------------------------------------
  await test("8.30 Concurrent identical FAILED callbacks -> exactly 1 refund; concurrent SUCCESS -> PAID once", async () => {
    const user = await createTestUser({ prefix: "wd-830", balance: 1000, availableBalance: 1000 });
    const admin = await createTestUser({ prefix: "adm-830", role: "ADMIN", withPayoutDetails: false });
    try {
      // Part A: Concurrent FAILED callbacks
      const reqFail = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-830-f") },
      });
      await approvePayout(reqFail.payout.id, admin.id);
      await prisma.payout.update({ where: { id: reqFail.payout.id }, data: { provider: "CASHFREE" } });

      const failPayload = {
        payoutId: reqFail.payout.id,
        providerReferenceId: uid("CF-CONC-FAIL"),
        status: "FAILED",
      };
      const failResults = await Promise.allSettled([
        handlePayoutCallback("CASHFREE", failPayload),
        handlePayoutCallback("CASHFREE", failPayload),
        handlePayoutCallback("CASHFREE", failPayload),
      ]);
      for (const r of failResults) {
        assert.strictEqual(r.status, "fulfilled");
      }
      assert.strictEqual(failResults.filter((r) => !r.value.isDuplicate).length, 1);

      const failRefunds = await prisma.walletTransaction.findMany({
        where: { payoutId: reqFail.payout.id, category: "PAYOUT_REFUND" },
      });
      assert.strictEqual(failRefunds.length, 1);

      // Part B: Concurrent SUCCESS callbacks
      const reqSuccess = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 250.0, idempotencyKey: uid("idemp-830-s") },
      });
      await approvePayout(reqSuccess.payout.id, admin.id);
      await prisma.payout.update({ where: { id: reqSuccess.payout.id }, data: { provider: "RAZORPAYX" } });

      const successPayload = {
        payoutId: reqSuccess.payout.id,
        providerReferenceId: uid("RZ-CONC-OK"),
        status: "SUCCESS",
      };
      const okResults = await Promise.allSettled([
        handlePayoutCallback("RAZORPAYX", successPayload),
        handlePayoutCallback("RAZORPAYX", successPayload),
        handlePayoutCallback("RAZORPAYX", successPayload),
      ]);
      for (const r of okResults) {
        assert.strictEqual(r.status, "fulfilled");
      }
      assert.strictEqual(okResults.filter((r) => !r.value.isDuplicate).length, 1);

      const w = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(w.availableBalance.toFixed(2), "750.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.31 DATABASE FAILURE BETWEEN DEBIT & PAYOUT CREATION + CLEAN RETRY
  // ---------------------------------------------------------------------------
  await test("8.31 DB failure between debitWallet and payout.create rolls back atomically, then retry succeeds", async () => {
    const user = await createTestUser({ prefix: "wd-831", balance: 600, availableBalance: 600 });
    try {
      const idempKey = uid("idemp-831");

      // Simulate mid-transaction DB failure right after debitWallet inside $transaction
      await assert.rejects(async () => {
        await prisma.$transaction(async (tx) => {
          await debitWallet({
            userId: user.id,
            amount: 300.0,
            category: "PAYOUT",
            description: "Simulated fault before payout insert",
            idempotencyKey: `tx:payout:${idempKey}`,
            tx,
          });
          throw new Error("SIMULATED_DB_FAILURE_AFTER_DEBIT");
        });
      }, /SIMULATED_DB_FAILURE_AFTER_DEBIT/);

      // Verify full rollback: wallet unchanged, zero ledger tx, zero payout
      const wAfterFault = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(wAfterFault.availableBalance.toFixed(2), "600.00");
      assert.strictEqual(await prisma.walletTransaction.count({ where: { walletId: user.wallet.id } }), 0);
      assert.strictEqual(await prisma.payout.count({ where: { userId: user.id } }), 0);

      // Clean retry with the SAME idempotencyKey succeeds cleanly
      const retryRes = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: idempKey },
      });
      assert.strictEqual(retryRes.isDuplicate, false);
      assert.strictEqual(retryRes.payout.status, "PENDING");

      const wAfterRetry = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(wAfterRetry.availableBalance.toFixed(2), "300.00");
    } finally {
      await cleanupUsers([user]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.32 DATABASE FAILURE DURING REFUND + CLEAN RETRY
  // ---------------------------------------------------------------------------
  await test("8.32 DB failure during refund rolls back atomically, then retry rejects & refunds once", async () => {
    const user = await createTestUser({ prefix: "wd-832", balance: 600, availableBalance: 600 });
    const admin = await createTestUser({ prefix: "adm-832", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 300.0, idempotencyKey: uid("idemp-832") },
      });
      await approvePayout(req.payout.id, admin.id);

      // Simulate DB failure mid-refund after payout status + wallet increment before ledger write
      await assert.rejects(async () => {
        await prisma.$transaction(async (tx) => {
          await tx.payout.update({ where: { id: req.payout.id }, data: { status: "REJECTED" } });
          await tx.wallet.update({
            where: { id: user.wallet.id },
            data: { availableBalance: { increment: 300.0 }, balance: { increment: 300.0 } },
          });
          throw new Error("SIMULATED_DB_FAILURE_MID_REFUND");
        });
      }, /SIMULATED_DB_FAILURE_MID_REFUND/);

      // Verify rollback: still PROCESSING, balance still 300.00, 0 refund rows
      const pAfterFault = await prisma.payout.findUnique({ where: { id: req.payout.id } });
      assert.strictEqual(pAfterFault.status, "PROCESSING");
      const wAfterFault = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(wAfterFault.availableBalance.toFixed(2), "300.00");
      assert.strictEqual(
        await prisma.walletTransaction.count({ where: { payoutId: req.payout.id, category: "PAYOUT_REFUND" } }),
        0
      );

      // Retry rejectPayout succeeds cleanly
      const retried = await rejectPayout(req.payout.id, admin.id, "Retry after DB fault");
      assert.strictEqual(retried.status, "REJECTED");
      const wAfterRetry = await prisma.wallet.findUnique({ where: { id: user.wallet.id } });
      assert.strictEqual(wAfterRetry.availableBalance.toFixed(2), "600.00");
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  // ---------------------------------------------------------------------------
  // 8.33 EXHAUSTIVE INVALID TRANSITIONS & MANUAL WEBHOOK GUARD
  // ---------------------------------------------------------------------------
  await test("8.33 Exhaustive invalid state transitions & MANUAL payout webhook guard", async () => {
    const illegalPairs = [
      ["PENDING", "PAID"],
      ["PENDING", "FAILED"],
      ["PAID", "PENDING"],
      ["PAID", "PROCESSING"],
      ["PAID", "FAILED"],
      ["PAID", "REJECTED"],
      ["FAILED", "PENDING"],
      ["FAILED", "PROCESSING"],
      ["FAILED", "PAID"],
      ["FAILED", "REJECTED"],
      ["REJECTED", "PENDING"],
      ["REJECTED", "PROCESSING"],
      ["REJECTED", "PAID"],
      ["REJECTED", "FAILED"],
    ];

    for (const [fromStatus, toStatus] of illegalPairs) {
      assert.throws(
        () => validatePayoutTransition(fromStatus, toStatus),
        (err) => err.code === "INVALID_PAYOUT_STATUS_TRANSITION"
      );
    }

    // Verify MANUAL payout cannot be mutated by external provider callback
    const user = await createTestUser({ prefix: "wd-833", balance: 600, availableBalance: 600 });
    const admin = await createTestUser({ prefix: "adm-833", role: "ADMIN", withPayoutDetails: false });
    try {
      const req = await createWithdrawalRequest({
        userId: user.id,
        input: { amount: 250.0, idempotencyKey: uid("idemp-833") },
      });
      await approvePayout(req.payout.id, admin.id);

      let manualBlocked = false;
      try {
        await handlePayoutCallback("CASHFREE", {
          payoutId: req.payout.id,
          providerReferenceId: uid("SPOOF-MANUAL"),
          status: "SUCCESS",
        });
      } catch (err) {
        manualBlocked = true;
        assert.strictEqual(err.code, "MANUAL_PROVIDER_WEBHOOK_FORBIDDEN");
        assert.strictEqual(err.statusCode, 403);
      }
      assert.strictEqual(manualBlocked, true);

      // Verify editing payout details is blocked while payout is PENDING/PROCESSING
      let editBlocked = false;
      try {
        await savePayoutDetails(user.id, { payoutMethod: "UPI", upiId: "newupi@okaxis" });
      } catch (err) {
        editBlocked = true;
        assert.strictEqual(err.code, "ACTIVE_PAYOUT_BLOCKS_DETAILS_UPDATE");
        assert.strictEqual(err.statusCode, 409);
      }
      assert.strictEqual(editBlocked, true);

      // Verify self-approval/rejection is forbidden (admin cannot act on own payout)
      const selfAdmin = await createTestUser({ prefix: "selfadm-833", balance: 600, availableBalance: 600, role: "ADMIN" });
      try {
        const selfReq = await createWithdrawalRequest({
          userId: selfAdmin.id,
          input: { amount: 250.0, idempotencyKey: uid("idemp-self-833") },
        });
        let selfBlocked = false;
        try {
          await approvePayout(selfReq.payout.id, selfAdmin.id);
        } catch (err) {
          selfBlocked = true;
          assert.strictEqual(err.code, "SELF_ACTION_FORBIDDEN");
          assert.strictEqual(err.statusCode, 403);
        }
        assert.strictEqual(selfBlocked, true);
      } finally {
        await cleanupUsers([selfAdmin]);
      }
    } finally {
      await cleanupUsers([user, admin]);
    }
  });

  console.log(`\nDiscipline 8 Results: ${passed} Passed, ${failed} Failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("8-withdrawal-payout.mjs")) {
  runWithdrawalPayoutTests()
    .catch((err) => {
      console.error("Discipline 8 failed with error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
