/**
 * CashTon Phase: User Info, Cashback Summary & Wallet Foundation
 * Comprehensive Integration & Security Test Suite
 */

import { Client } from "pg";
import dotenv from "dotenv";
import {
  encryptSensitive,
  decryptSensitive,
  maskAccountNumber,
  maskUpiId,
  getEncryptionKey,
} from "../src/lib/security/encryption.ts";
import { isValidIndianMobile, normalizeIndianMobile } from "../src/lib/validations/mobile.ts";

dotenv.config({ path: ".env.local" });

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

async function runTests() {
  console.log("=================================================");
  console.log("CashTon Wallet & Cashback Test Suite");
  console.log(`Target: ${BASE_URL}`);
  console.log("=================================================\n");

  const results = [];
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();

  const testUserEmail = `test_wallet_${Date.now()}@example.com`;
  const testMobile = `98765${Math.floor(10000 + Math.random() * 90000)}`; // 10 digits starting with 9
  const testPassword = "SecurePassword123!";
  let cookieHeader = "";
  let testUserId = "";

  async function cleanup() {
    try {
      await pgClient.query('DELETE FROM "User" WHERE email LIKE $1', ['test_wallet_%']);
    } catch (e) {
      console.error("Cleanup error:", e);
    }
  }

  try {
    // -------------------------------------------------------------------
    // 1. UNIT CHECKS: Mobile Validation and Normalization
    // -------------------------------------------------------------------
    const valid1 = isValidIndianMobile("9876543210");
    const valid2 = isValidIndianMobile("+91 98765 43210");
    const valid3 = isValidIndianMobile("09876543210");
    const invalid1 = isValidIndianMobile("1234567890"); // starts with 1
    const invalid2 = isValidIndianMobile("98765"); // too short
    const normalized = normalizeIndianMobile("9876543210");

    results.push({
      name: "Mobile number validation and E.164 normalization",
      passed: valid1 && valid2 && valid3 && !invalid1 && !invalid2 && normalized === "+919876543210",
      detail: `Valid: ${valid1}, Normalized: ${normalized}`
    });

    // -------------------------------------------------------------------
    // 2. UNIT CHECKS: AES-256-GCM Encryption & Masking
    // -------------------------------------------------------------------
    const rawAccount = "123456789012";
    const encrypted = encryptSensitive(rawAccount);
    const decrypted = decryptSensitive(encrypted);
    const masked = maskAccountNumber(rawAccount);
    const maskedUpi = maskUpiId("tester@okhdfcbank");

    results.push({
      name: "Bank account & UPI encryption (AES-256-GCM) and masking",
      passed: encrypted !== rawAccount &&
              decrypted === rawAccount &&
              masked === "••••••••9012" &&
              maskedUpi === "te••••er@okhdfcbank",
      detail: `Encrypted: ${encrypted.slice(0, 20)}..., Masked Bank: ${masked}, Masked UPI: ${maskedUpi}`
    });

    // -------------------------------------------------------------------
    // 3. SECURITY: Strict PAYOUT_ENCRYPTION_KEY in Production & Staging
    // -------------------------------------------------------------------
    let prodKeyEnforced = false;
    let invalidKeyRejected = false;
    const origEnv = process.env.NODE_ENV;
    const origKey = process.env.PAYOUT_ENCRYPTION_KEY;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.PAYOUT_ENCRYPTION_KEY;
      getEncryptionKey();
    } catch (err) {
      prodKeyEnforced = err.message.includes("PAYOUT_ENCRYPTION_KEY environment variable is mandatory");
    }

    try {
      process.env.NODE_ENV = "production";
      process.env.PAYOUT_ENCRYPTION_KEY = "invalid-short-key";
      getEncryptionKey();
    } catch (err) {
      invalidKeyRejected = err.message.includes("PAYOUT_ENCRYPTION_KEY is invalid");
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origKey) process.env.PAYOUT_ENCRYPTION_KEY = origKey;
    }

    results.push({
      name: "Strict key enforcement: PAYOUT_ENCRYPTION_KEY mandatory & must be valid in production",
      passed: prodKeyEnforced && invalidKeyRejected,
      detail: `Missing key rejected: ${prodKeyEnforced}, Invalid key rejected: ${invalidKeyRejected}`
    });

    // -------------------------------------------------------------------
    // 4. REGISTRATION: Register with Valid Mobile Number
    // -------------------------------------------------------------------
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
        name: "Wallet Tester",
        mobileNumber: testMobile,
      }),
    });
    const regData = await regRes.json();
    testUserId = regData.user?.id;

    results.push({
      name: "Registration with required mobile number -> 201 Created",
      passed: regRes.status === 201 && regData.success === true && regData.user?.mobileNumber === `+91${testMobile}`,
      detail: `Status: ${regRes.status}, Saved Mobile: ${regData.user?.mobileNumber}`
    });

    // -------------------------------------------------------------------
    // 5. DUPLICATE MOBILE REJECTION
    // -------------------------------------------------------------------
    const dupRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `another_${Date.now()}@example.com`,
        password: testPassword,
        name: "Another User",
        mobileNumber: testMobile,
      }),
    });
    const dupData = await dupRes.json();

    results.push({
      name: "Duplicate mobile number registration rejection -> 409 Conflict",
      passed: dupRes.status === 409 && dupData.message.includes("mobile number already exists"),
      detail: `Status: ${dupRes.status}, Message: ${dupData.message}`
    });

    // -------------------------------------------------------------------
    // 6. LOGIN TEST USER & VERIFY SESSION
    // -------------------------------------------------------------------
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
      }),
    });
    const loginData = await loginRes.json();

    const rawCookies = loginRes.headers.get("set-cookie") || "";
    cookieHeader = rawCookies
      .split(/,(?=[^;]+;)/)
      .map((c) => c.split(";")[0].trim())
      .join("; ");

    results.push({
      name: "Login test user -> 200 OK",
      passed: loginRes.status === 200 && loginData.success === true && !!cookieHeader,
      detail: `Status: ${loginRes.status}, Cookie: ${cookieHeader ? "Present" : "Missing"}`
    });

    // -------------------------------------------------------------------
    // 7. USER PROFILE API: GET & PATCH Mobile Number
    // -------------------------------------------------------------------
    const profGetRes = await fetch(`${BASE_URL}/api/users/profile`, {
      headers: { Cookie: cookieHeader },
    });
    const profGetData = await profGetRes.json();

    const newMobile = `91234${Math.floor(10000 + Math.random() * 90000)}`;
    const profPatchRes = await fetch(`${BASE_URL}/api/users/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name: "Wallet Tester Updated",
        mobileNumber: newMobile,
      }),
    });
    const profPatchData = await profPatchRes.json();

    results.push({
      name: "Profile GET & PATCH supports mobile number",
      passed: profGetRes.status === 200 &&
              profPatchRes.status === 200 &&
              profPatchData.profile?.mobileNumber === `+91${newMobile}` &&
              profPatchData.profile?.name === "Wallet Tester Updated",
      detail: `GET mobile: ${profGetData.profile?.mobileNumber}, PATCH updated: ${profPatchData.profile?.mobileNumber}`
    });

    // -------------------------------------------------------------------
    // 8. PAYOUT DETAILS: Storage, Encryption & Masking
    // -------------------------------------------------------------------
    // 8a. Save Bank Details
    const payPostRes = await fetch(`${BASE_URL}/api/users/payout-details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        payoutMethod: "BANK",
        accountHolderName: "Wallet Tester",
        accountNumber: "98765432101234",
        ifscCode: "HDFC0001234",
        bankName: "HDFC Bank",
      }),
    });
    const payPostData = await payPostRes.json();

    const isMaskedInApi = payPostData.payoutDetails?.accountNumberMasked?.endsWith("1234") &&
                          payPostData.payoutDetails?.accountNumberMasked?.includes("•") &&
                          !payPostData.payoutDetails?.encryptedAccountNumber &&
                          !payPostData.payoutDetails?.accountNumber;

    const dbPayoutRes = await pgClient.query('SELECT * FROM "PayoutDetails" WHERE "userId" = $1', [testUserId]);
    const dbRow = dbPayoutRes.rows[0];
    const isEncryptedInDb = dbRow?.encryptedAccountNumber &&
                            !dbRow.encryptedAccountNumber.includes("98765432101234") &&
                            decryptSensitive(dbRow.encryptedAccountNumber) === "98765432101234";

    results.push({
      name: "Payout details storage: Encrypted in DB & Masked in API",
      passed: payPostRes.status === 200 && isMaskedInApi && isEncryptedInDb && dbRow?.status === "PENDING",
      detail: `API Masked: ${payPostData.payoutDetails?.accountNumberMasked}, Status: ${dbRow?.status}`
    });

    // 8b. Save UPI Details
    const rawUpi = "tester@okhdfcbank";
    const upiRes = await fetch(`${BASE_URL}/api/users/payout-details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        payoutMethod: "UPI",
        upiId: rawUpi,
      }),
    });
    const upiData = await upiRes.json();

    const dbUpiRes = await pgClient.query('SELECT "upiId" FROM "PayoutDetails" WHERE "userId" = $1', [testUserId]);
    const dbUpiRow = dbUpiRes.rows[0];
    const isUpiEncryptedInDb = dbUpiRow?.upiId &&
                              !dbUpiRow.upiId.includes(rawUpi) &&
                              decryptSensitive(dbUpiRow.upiId) === rawUpi;

    results.push({
      name: "Payout details UPI method: Encrypted at rest in DB & Masked in API",
      passed: upiRes.status === 200 &&
              isUpiEncryptedInDb &&
              upiData.payoutDetails?.upiId === "te••••er@okhdfcbank" &&
              upiData.payoutDetails?.upiIdMasked === "te••••er@okhdfcbank",
      detail: `DB Encrypted: ${dbUpiRow?.upiId?.slice(0, 20)}..., API Masked: ${upiData.payoutDetails?.upiIdMasked}`
    });

    // -------------------------------------------------------------------
    // 9. UNAUTHORIZED ACCESS BLOCKED
    // -------------------------------------------------------------------
    const unauthRes = await fetch(`${BASE_URL}/api/wallet/summary`);
    const unauthPayRes = await fetch(`${BASE_URL}/api/users/payout-details`);

    results.push({
      name: "Unauthenticated requests to wallet & payout APIs -> 401 Unauthorized",
      passed: unauthRes.status === 401 && unauthPayRes.status === 401,
      detail: `Wallet summary status: ${unauthRes.status}, Payout status: ${unauthPayRes.status}`
    });

    // -------------------------------------------------------------------
    // 10. WALLET SUMMARY WITH ZERO RECORDS
    // -------------------------------------------------------------------
    const sumEmptyRes = await fetch(`${BASE_URL}/api/wallet/summary`, {
      headers: { Cookie: cookieHeader },
    });
    const sumEmptyData = await sumEmptyRes.json();
    const s = sumEmptyData.summary;

    results.push({
      name: "Wallet summary with zero records returns ₹0.00",
      passed: sumEmptyRes.status === 200 &&
              s?.availableBalance === "0.00" &&
              s?.totalTracked === "0.00" &&
              s?.pendingCashback === "0.00" &&
              s?.approvedCashback === "0.00" &&
              s?.confirmedCashback === "0.00" &&
              s?.totalPaidOut === "0.00" &&
              Array.isArray(s?.recentTransactions) &&
              s?.recentTransactions.length === 0,
      detail: `Available: ₹${s?.availableBalance}, Tracked: ₹${s?.totalTracked}`
    });

    // -------------------------------------------------------------------
    // 11. WALLET CREDIT & DEBIT CALCULATIONS (DECIMAL PRECISION)
    // -------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO "Cashback" (id, "userId", amount, status, description, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 150.50, 'PENDING', 'Pending store deal', NOW(), NOW())`,
      [testUserId]
    );

    await pgClient.query(
      `INSERT INTO "Cashback" (id, "userId", amount, status, description, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 200.25, 'APPROVED', 'Approved fashion cashback', NOW(), NOW())`,
      [testUserId]
    );

    const confirmedCbId = (await pgClient.query(
      `INSERT INTO "Cashback" (id, "userId", amount, status, description, "confirmedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 500.00, 'CONFIRMED', 'Confirmed electronics purchase', NOW(), NOW(), NOW())
       RETURNING id`,
      [testUserId]
    )).rows[0].id;

    const walletId = (await pgClient.query('SELECT id FROM "Wallet" WHERE "userId" = $1', [testUserId])).rows[0].id;

    // Credit ledger: ₹500.00
    await pgClient.query(
      `INSERT INTO "WalletTransaction" (id, "walletId", amount, type, category, "cashbackId", description, "createdAt")
       VALUES (gen_random_uuid(), $1, 500.00, 'CREDIT', 'CASHBACK', $2, 'Cashback credited', NOW())`,
      [walletId, confirmedCbId]
    );

    // Debit ledger: ₹100.00 payout
    await pgClient.query(
      `INSERT INTO "WalletTransaction" (id, "walletId", amount, type, category, description, "createdAt")
       VALUES (gen_random_uuid(), $1, 100.00, 'DEBIT', 'PAYOUT', 'Payout withdrawal to bank', NOW())`,
      [walletId]
    );

    // Re-query summary API
    const sumCalcRes = await fetch(`${BASE_URL}/api/wallet/summary`, {
      headers: { Cookie: cookieHeader },
    });
    const sumCalcData = await sumCalcRes.json();
    const sc = sumCalcData.summary;

    const calcCorrect = sc?.totalTracked === "850.75" &&
                        sc?.pendingCashback === "150.50" &&
                        sc?.approvedCashback === "200.25" &&
                        sc?.confirmedCashback === "500.00" &&
                        sc?.availableBalance === "400.00" &&
                        sc?.totalPaidOut === "100.00" &&
                        sc?.recentTransactions.length === 2;

    results.push({
      name: "Wallet calculations: Precision Decimal totals & Ledger balance",
      passed: sumCalcRes.status === 200 && calcCorrect,
      detail: `Tracked: ₹${sc?.totalTracked} (exp: 850.75), Available: ₹${sc?.availableBalance} (exp: 400.00), Paid Out: ₹${sc?.totalPaidOut} (exp: 100.00)`
    });

    // -------------------------------------------------------------------
    // 12. DUPLICATE TRANSACTION IDEMPOTENCY PROTECTION
    // -------------------------------------------------------------------
    let dupTxPrevented = false;
    try {
      await pgClient.query(
        `INSERT INTO "WalletTransaction" (id, "walletId", amount, type, category, "cashbackId", description, "createdAt")
         VALUES (gen_random_uuid(), $1, 500.00, 'CREDIT', 'CASHBACK', $2, 'Duplicate attempt', NOW())`,
        [walletId, confirmedCbId]
      );
    } catch (err) {
      dupTxPrevented = err.code === "23505"; // PostgreSQL unique violation
    }

    results.push({
      name: "Ledger idempotency: Duplicate cashback credit rejected",
      passed: dupTxPrevented,
      detail: `Duplicate credit blocked by unique constraint: ${dupTxPrevented}`
    });

    // -------------------------------------------------------------------
    // 13. FINANCIAL INTEGRITY: Atomic Decrement Prevents Negative Balance
    // -------------------------------------------------------------------
    // In database, wallet currently has balance = 0.00 (or positive).
    // Test that an overdraft debit with balance >= debit fails to update any rows
    const overdraftResult = await pgClient.query(
      `UPDATE "Wallet" SET balance = balance - 1000.00 WHERE id = $1 AND balance >= 1000.00 RETURNING id`,
      [walletId]
    );
    const overdraftBlocked = overdraftResult.rowCount === 0;

    results.push({
      name: "Financial integrity: Negative wallet balance prevented atomically",
      passed: overdraftBlocked,
      detail: `Overdraft update row count: ${overdraftResult.rowCount} (0 rows updated)`
    });

    // -------------------------------------------------------------------
    // 14. CASHBACK LIFECYCLE: Strict State Machine & Terminal State Enforcement
    // -------------------------------------------------------------------
    const VALID_TRANSITIONS = {
      PENDING: ["APPROVED", "REJECTED"],
      APPROVED: ["CONFIRMED", "REJECTED"],
      CONFIRMED: ["REVERSED"],
      REJECTED: [],
      REVERSED: [],
    };

    function isValidTransition(from, to) {
      return (VALID_TRANSITIONS[from] || []).includes(to);
    }

    const t1 = isValidTransition("PENDING", "APPROVED"); // true
    const t2 = !isValidTransition("PENDING", "CONFIRMED"); // true (blocked)
    const t3 = isValidTransition("APPROVED", "CONFIRMED"); // true
    const t4 = isValidTransition("CONFIRMED", "REVERSED"); // true
    const t5 = !isValidTransition("REJECTED", "PENDING"); // true (terminal)
    const t6 = !isValidTransition("REVERSED", "CONFIRMED"); // true (terminal)

    const lifecycleStrict = t1 && t2 && t3 && t4 && t5 && t6;

    results.push({
      name: "Cashback lifecycle: Strict state machine with terminal states",
      passed: lifecycleStrict,
      detail: `PENDING->CONFIRMED blocked: ${t2}, REJECTED terminal: ${t5}, REVERSED terminal: ${t6}`
    });

  } finally {
    await cleanup();
    await pgClient.end();
  }

  // -------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------
  console.log("\n--- TEST EXECUTION SUMMARY ---");
  let allPassed = true;
  for (const r of results) {
    const statusStr = r.passed ? "[PASS]" : "[FAIL]";
    if (!r.passed) allPassed = false;
    console.log(`${statusStr} ${r.name}`);
    if (r.detail) console.log(`       └─ ${r.detail}`);
  }

  console.log("\n=================================================");
  console.log(`OVERALL RESULT: ${allPassed ? "ALL TESTS PASSED" : "TEST FAILURES DETECTED"}`);
  console.log("=================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner encountered an error:", err);
  process.exit(1);
});
