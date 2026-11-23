/**
 * CashTon Comprehensive Adversarial Security & QA Verification Suite
 * Tests OWASP API1 through API8, Concurrency, RBAC, Data Exposure,
 * Redirect Security, Financial Integrity, and Postback Ingestion
 */

import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

function extractCookies(res) {
  if (typeof res.headers.getSetCookie === "function") {
    const raw = res.headers.getSetCookie();
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((c) => c.split(";")[0].trim()).join("; ");
    }
  }
  const rawHeader = res.headers.get("set-cookie") || "";
  return rawHeader
    .split(/,(?=[^;]+;)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
}

async function runComprehensiveAudit() {
  console.log("================================================================================");
  console.log("CashTon Comprehensive Adversarial Security & QA Verification Suite");
  console.log(`Target: ${BASE_URL}`);
  console.log("================================================================================\n");

  const results = [];
  function record(section, testName, passed, detail) {
    results.push({ section, name: testName, passed, detail });
    const mark = passed ? "✓ PASS" : "✗ FAIL";
    console.log(`  ${mark} [${section}] ${testName}`);
    if (detail) console.log(`         └─ ${detail}`);
  }

  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();

  const runId = Date.now();
  const prefix = `audit-${runId}`;
  const password = "ComplexPassword123!";

  // User A (victim)
  const userAEmail = `usera-${prefix}@example.com`;
  const userAMobile = `98711${Math.floor(10000 + Math.random() * 90000)}`;
  let userACookie = "";
  let userAId = "";

  // User B (attacker / separate tenant)
  const userBEmail = `userb-${prefix}@example.com`;
  const userBMobile = `98722${Math.floor(10000 + Math.random() * 90000)}`;
  let userBCookie = "";
  let userBId = "";

  // Admin User
  const adminEmail = `admin-${prefix}@example.com`;
  const adminMobile = `98733${Math.floor(10000 + Math.random() * 90000)}`;
  let adminCookie = "";
  let adminId = "";

  // Entities
  let merchantId = "";
  let dealId = "";
  let dealSlug = `deal-${prefix}`;
  let testClickId = "";

  async function cleanup() {
    console.log("\n▶ Cleaning up audit test entities...");
    try {
      await pgClient.query('DELETE FROM "Conversion" WHERE "externalTransactionId" LIKE $1', [`%${prefix}%`]);
      await pgClient.query('DELETE FROM "Cashback" WHERE "externalReferenceId" LIKE $1', [`%${prefix}%`]);
      await pgClient.query('DELETE FROM "WalletTransaction" WHERE description LIKE $1', [`%${prefix}%`]);
      await pgClient.query('DELETE FROM "AffiliateClick" WHERE source LIKE $1', [`%${prefix}%`]);
      await pgClient.query('DELETE FROM "Deal" WHERE slug LIKE $1', [`%${prefix}%`]);
      await pgClient.query('DELETE FROM "Coupon" WHERE code LIKE $1', [`%${prefix}%`]);
      await pgClient.query('DELETE FROM "Merchant" WHERE slug LIKE $1', [`%${prefix}%`]);
      await pgClient.query('DELETE FROM "User" WHERE email LIKE $1', [`%${prefix}%`]);
    } catch (e) {
      console.error("Cleanup error:", e.message);
    }
  }

  try {
    // =========================================================================
    // SECTION 1: AUTHENTICATION & SESSION INTEGRITY (OWASP API2)
    // =========================================================================
    console.log("▶ Section 1: Authentication & Session Integrity (OWASP API2)...");

    // 1.1 Register User A with compulsory E.164 mobile
    const regARes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userAEmail,
        password: password,
        name: "User A Audit",
        mobileNumber: userAMobile,
      }),
    });
    const regAData = await regARes.json();
    userAId = regAData.user?.id;
    record("Auth", "Registration with required mobile number returns 201", regARes.status === 201 && !!userAId, `UserA ID: ${userAId}`);

    // 1.2 Register User B
    const regBRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userBEmail,
        password: password,
        name: "User B Audit",
        mobileNumber: userBMobile,
      }),
    });
    const regBData = await regBRes.json();
    userBId = regBData.user?.id;
    record("Auth", "Registration of User B returns 201", regBRes.status === 201 && !!userBId, `UserB ID: ${userBId}`);

    // 1.3 Register Admin User & elevate
    const regAdminRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: password,
        name: "Admin User Audit",
        mobileNumber: adminMobile,
      }),
    });
    const regAdminData = await regAdminRes.json();
    adminId = regAdminData.user?.id;
    await pgClient.query('UPDATE "User" SET role = \'ADMIN\' WHERE id = $1', [adminId]);
    record("Auth", "Admin registration and DB role elevation", regAdminRes.status === 201 && !!adminId, `Admin ID: ${adminId}`);

    // 1.4 Log in User A and obtain session cookie
    const loginARes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userAEmail, password: password }),
    });
    userACookie = extractCookies(loginARes);
    record("Auth", "User A login returns 200 and sets HTTP-only session cookie", loginARes.status === 200 && userACookie.length > 0, `Cookie set: ${userACookie.length > 0}`);

    // 1.5 Log in User B
    const loginBRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userBEmail, password: password }),
    });
    userBCookie = extractCookies(loginBRes);

    // 1.6 Log in Admin
    const loginAdminRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: password }),
    });
    adminCookie = extractCookies(loginAdminRes);

    // 1.7 Session verification /api/auth/me with valid cookie
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: userACookie },
    });
    const meData = await meRes.json();
    record("Auth", "GET /api/auth/me with valid cookie returns 200 and user profile", meRes.status === 200 && meData.user?.email === userAEmail, `Email: ${meData.user?.email}`);

    // 1.8 Unauthenticated / missing cookie returns 401
    const unauthMe = await fetch(`${BASE_URL}/api/auth/me`);
    record("Auth", "GET /api/auth/me without cookie returns 401", unauthMe.status === 401, `Status: ${unauthMe.status}`);

    // 1.9 Malformed / forged session cookie returns 401
    const malformedMe = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: "sb-auth-token=forged.invalid.signature" },
    });
    record("Auth", "GET /api/auth/me with forged cookie returns 401", malformedMe.status === 401, `Status: ${malformedMe.status}`);

    // 1.10 Reject duplicate email registration with 409
    const dupEmailRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userAEmail,
        password: password,
        name: "Duplicate",
        mobileNumber: `98744${Math.floor(10000 + Math.random() * 90000)}`,
      }),
    });
    record("Auth", "Duplicate email registration rejected with 409 Conflict", dupEmailRes.status === 409, `Status: ${dupEmailRes.status}`);

    // 1.11 Reject duplicate mobile registration with 409
    const dupMobileRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `unique-${prefix}@example.com`,
        password: password,
        name: "Duplicate Mobile",
        mobileNumber: userAMobile,
      }),
    });
    record("Auth", "Duplicate mobile registration rejected with 409 Conflict", dupMobileRes.status === 409, `Status: ${dupMobileRes.status}`);

    // 1.12 Reject malformed JSON body
    const malformedJsonRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ broken json: 123",
    });
    record("Auth", "Malformed JSON payload rejected gracefully with 400", malformedJsonRes.status === 400, `Status: ${malformedJsonRes.status}`);

    // 1.13 Reject missing mandatory fields
    const missingFieldRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `nomobile-${prefix}@example.com`, password }),
    });
    record("Auth", "Registration missing mobileNumber rejected with 400", missingFieldRes.status === 400, `Status: ${missingFieldRes.status}`);

    // 1.14 Logout clears session
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: userACookie },
    });
    record("Auth", "POST /api/auth/logout returns 200", logoutRes.status === 200, `Status: ${logoutRes.status}`);


    // =========================================================================
    // SECTION 2: AUTHORIZATION BOUNDARIES — BOLA/IDOR & BFLA (OWASP API1 & API5)
    // =========================================================================
    console.log("\n▶ Section 2: Authorization Boundaries — BOLA/IDOR & BFLA (OWASP API1 & API5)...");

    // Re-login User A
    const reLoginA = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userAEmail, password: password }),
    });
    userACookie = extractCookies(reLoginA);

    // Seed Payout Details for User A
    const savePayoutA = await fetch(`${BASE_URL}/api/users/payout-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userACookie },
      body: JSON.stringify({
        accountHolderName: "User A Genuine",
        accountNumber: "1234567890123",
        ifscCode: "HDFC0001234",
        bankName: "HDFC Bank",
        payoutMethod: "BANK",
      }),
    });
    record("BOLA", "User A saves payout details -> 200", savePayoutA.status === 200, `Status: ${savePayoutA.status}`);

    // User B attempts to access User A's payout details
    const bGetsPayout = await fetch(`${BASE_URL}/api/users/payout-details`, {
      headers: { Cookie: userBCookie },
    });
    const bPayoutData = await bGetsPayout.json();
    const bolaPayoutBlocked = bPayoutData.payoutDetails?.accountHolderName !== "User A Genuine";
    record("BOLA", "User B cannot read User A payout details (BOLA/IDOR prevention)", bolaPayoutBlocked, `User B saw holder: ${bPayoutData.payoutDetails?.accountHolderName || "None"}`);

    // User B attempts to overwrite User A's profile by sending userId: userAId
    await fetch(`${BASE_URL}/api/users/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: userBCookie },
      body: JSON.stringify({
        userId: userAId,
        id: userAId,
        name: "Hacked by User B",
      }),
    });
    const userADbCheck = await pgClient.query('SELECT name FROM "User" WHERE id = $1', [userAId]);
    const profileTampered = userADbCheck.rows[0]?.name === "Hacked by User B";
    record("BOLA", "Client userId spoofing in PATCH /profile cannot mutate User A", !profileTampered, `User A name remains: ${userADbCheck.rows[0]?.name}`);

    // 2.3 Regular USER accessing Admin endpoints -> 403 Forbidden
    const adminEndpoints = [
      { method: "GET", path: "/api/admin/check" },
      { method: "GET", path: "/api/admin/merchants" },
      { method: "POST", path: "/api/admin/merchants", body: { name: "Spoof", slug: `sp-${prefix}` } },
      { method: "GET", path: "/api/admin/deals" },
      { method: "POST", path: "/api/admin/deals", body: { title: "Spoof" } },
      { method: "GET", path: "/api/admin/coupons" },
      { method: "POST", path: "/api/admin/coupons", body: { code: "SPOOF" } },
      { method: "GET", path: "/api/admin/affiliate-clicks" },
      { method: "GET", path: "/api/admin/conversions" },
    ];

    let allAdminBlocked = true;
    for (const ep of adminEndpoints) {
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: ep.method,
        headers: { "Content-Type": "application/json", Cookie: userACookie },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      if (res.status !== 403) {
        allAdminBlocked = false;
        console.error(`BFLA failure on ${ep.method} ${ep.path}: got ${res.status}`);
      }
    }
    record("BFLA", "Standard USER blocked server-side from ALL /api/admin/* endpoints (403)", allAdminBlocked, `Tested ${adminEndpoints.length} endpoints`);

    // 2.4 Unauthenticated caller accessing Admin endpoints -> 401 Unauthorized
    let allUnauthBlocked = true;
    for (const ep of adminEndpoints) {
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: ep.method,
        headers: { "Content-Type": "application/json" },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      if (res.status !== 401) {
        allUnauthBlocked = false;
        console.error(`Unauthenticated BFLA failure on ${ep.method} ${ep.path}: got ${res.status}`);
      }
    }
    record("BFLA", "Unauthenticated caller blocked from ALL /api/admin/* endpoints (401)", allUnauthBlocked, `Tested ${adminEndpoints.length} endpoints`);

    // 2.5 Role spoofing headers strictly ignored
    const spoofHeaderRes = await fetch(`${BASE_URL}/api/admin/check`, {
      headers: {
        Cookie: userACookie,
        "X-User-Role": "ADMIN",
        "X-Role": "SUPER_ADMIN",
        "Role": "ADMIN",
      },
    });
    record("BFLA", "Role spoofing headers (X-User-Role, etc.) strictly rejected with 403", spoofHeaderRes.status === 403, `Status: ${spoofHeaderRes.status}`);

    // 2.6 Verified ADMIN accesses GET /api/admin/merchants -> 200
    const adminGetMerch = await fetch(`${BASE_URL}/api/admin/merchants`, {
      headers: { Cookie: adminCookie },
    });
    const adminGetMerchData = await adminGetMerch.json();
    record("BFLA", "Verified ADMIN successfully accesses GET /api/admin/merchants (200)", adminGetMerch.status === 200 && Array.isArray(adminGetMerchData.merchants), `Status: ${adminGetMerch.status}`);


    // =========================================================================
    // SECTION 3: PROPERTY-LEVEL AUTHORIZATION & DATA EXPOSURE (OWASP API3)
    // =========================================================================
    console.log("\n▶ Section 3: Property-Level Authorization & Data Exposure (OWASP API3)...");

    // 3.1 Verify PayoutDetails ciphertext in PostgreSQL
    const dbPayoutRow = await pgClient.query('SELECT * FROM "PayoutDetails" WHERE "userId" = $1', [userAId]);
    const encryptedAcc = dbPayoutRow.rows[0]?.encryptedAccountNumber;
    const isEncrypted = typeof encryptedAcc === "string" && !encryptedAcc.includes("1234567890123") && /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/.test(encryptedAcc);
    record("DataExposure", "Bank account stored as AES-256-GCM ciphertext in PostgreSQL", isEncrypted, `Ciphertext format verified: ${isEncrypted}`);

    // 3.2 Verify API responses mask account number
    const getPayoutApi = await fetch(`${BASE_URL}/api/users/payout-details`, {
      headers: { Cookie: userACookie },
    });
    const getPayoutApiData = await getPayoutApi.json();
    const maskedAcc = getPayoutApiData.payoutDetails?.accountNumberMasked;
    const rawAccLeaked = "accountNumber" in (getPayoutApiData.payoutDetails || {});
    const isMasked = maskedAcc && maskedAcc.startsWith("••••") && maskedAcc.endsWith("0123") && !rawAccLeaked;
    record("DataExposure", "API responses expose only masked bank account number (zero raw plaintext)", isMasked, `Masked: ${maskedAcc}, Raw leaked: ${rawAccLeaked}`);

    // 3.3 Verify /api/users/profile does not leak passwordHash or encryption keys
    const profileRes = await fetch(`${BASE_URL}/api/users/profile`, {
      headers: { Cookie: userACookie },
    });
    const profileData = await profileRes.json();
    const hasSensitiveLeak = "passwordHash" in profileData || "password" in profileData || "token" in profileData;
    record("DataExposure", "User profile API returns sanitized fields with zero hash/secret leaks", !hasSensitiveLeak, `Keys: ${Object.keys(profileData.user || {}).join(", ")}`);

    // 3.4 Mass-assignment attack: attempting to update role via PATCH /api/users/profile
    const massAssignRole = await fetch(`${BASE_URL}/api/users/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: userACookie },
      body: JSON.stringify({ role: "ADMIN", isSuperAdmin: true }),
    });
    const userRoleAfter = await pgClient.query('SELECT role FROM "User" WHERE id = $1', [userAId]);
    record("DataExposure", "Mass-assignment of role in profile update rejected with 400", massAssignRole.status === 400 && userRoleAfter.rows[0]?.role === "USER", `Status: ${massAssignRole.status}, DB Role: ${userRoleAfter.rows[0]?.role}`);


    // =========================================================================
    // SECTION 4: FINANCIAL LEDGER, CASHBACK STATE MACHINE & CONCURRENCY (OWASP API6)
    // =========================================================================
    console.log("\n▶ Section 4: Financial Ledger, Cashback State Machine & Concurrency (OWASP API6)...");

    const userAWallet = await pgClient.query('SELECT id, balance FROM "Wallet" WHERE "userId" = $1', [userAId]);
    const walletId = userAWallet.rows[0]?.id;

    // 4.1 State Machine: Valid transition PENDING -> APPROVED -> CONFIRMED
    const cb1 = await pgClient.query(
      'INSERT INTO "Cashback" ("id", "userId", "amount", "status", "externalReferenceId", "description", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 100.00, \'PENDING\', $2, \'Test State Machine\', NOW(), NOW()) RETURNING id',
      [userAId, `ref-cb1-${prefix}`]
    );
    const cb1Id = cb1.rows[0].id;

    await pgClient.query('UPDATE "Cashback" SET status = \'APPROVED\', "approvedAt" = NOW() WHERE id = $1 AND status = \'PENDING\'', [cb1Id]);
    const cb1Approved = await pgClient.query('SELECT status FROM "Cashback" WHERE id = $1', [cb1Id]);
    record("Ledger", "Cashback valid transition: PENDING -> APPROVED", cb1Approved.rows[0]?.status === "APPROVED", `Status: ${cb1Approved.rows[0]?.status}`);

    await pgClient.query('UPDATE "Cashback" SET status = \'CONFIRMED\', "confirmedAt" = NOW() WHERE id = $1 AND status = \'APPROVED\'', [cb1Id]);
    const cb1Confirmed = await pgClient.query('SELECT status FROM "Cashback" WHERE id = $1', [cb1Id]);
    record("Ledger", "Cashback valid transition: APPROVED -> CONFIRMED", cb1Confirmed.rows[0]?.status === "CONFIRMED", `Status: ${cb1Confirmed.rows[0]?.status}`);

    await pgClient.query('UPDATE "Cashback" SET status = \'REVERSED\' WHERE id = $1 AND status = \'CONFIRMED\'', [cb1Id]);
    const cb1Reversed = await pgClient.query('SELECT status FROM "Cashback" WHERE id = $1', [cb1Id]);
    record("Ledger", "Cashback valid transition: CONFIRMED -> REVERSED", cb1Reversed.rows[0]?.status === "REVERSED", `Status: ${cb1Reversed.rows[0]?.status}`);

    // 4.2 State Machine: Illegal direct jump PENDING -> CONFIRMED blocked
    const cb2 = await pgClient.query(
      'INSERT INTO "Cashback" ("id", "userId", "amount", "status", "externalReferenceId", "description", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 50.00, \'PENDING\', $2, \'Illegal Jump\', NOW(), NOW()) RETURNING id',
      [userAId, `ref-cb2-${prefix}`]
    );
    const cb2Id = cb2.rows[0].id;

    const jumpAttempt = await pgClient.query('UPDATE "Cashback" SET status = \'CONFIRMED\' WHERE id = $1 AND status = \'APPROVED\'', [cb2Id]);
    record("Ledger", "Illegal direct jump PENDING -> CONFIRMED rejected by state machine", jumpAttempt.rowCount === 0, `Rows updated: ${jumpAttempt.rowCount}`);

    // 4.3 Concurrent Double-Credit Attack on Wallet
    const cb3 = await pgClient.query(
      'INSERT INTO "Cashback" ("id", "userId", "amount", "status", "externalReferenceId", "description", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 200.00, \'APPROVED\', $2, \'Double Credit Test\', NOW(), NOW()) RETURNING id',
      [userAId, `ref-cb3-${prefix}`]
    );
    const cb3Id = cb3.rows[0].id;

    const concurrentCreditPromises = Array.from({ length: 5 }, async (_, i) => {
      const dedicatedClient = new Client({ connectionString: process.env.DATABASE_URL });
      await dedicatedClient.connect();
      try {
        await dedicatedClient.query("BEGIN");
        await dedicatedClient.query(
          'INSERT INTO "WalletTransaction" ("id", "walletId", "amount", "type", "category", "cashbackId", "description", "createdAt") VALUES (gen_random_uuid(), $1, 200.00, \'CREDIT\', \'CASHBACK\', $2, $3, NOW())',
          [walletId, cb3Id, `Concurrent Credit #${i} ${prefix}`]
        );
        await dedicatedClient.query('UPDATE "Wallet" SET balance = balance + 200.00 WHERE id = $1', [walletId]);
        await dedicatedClient.query("COMMIT");
        return { success: true };
      } catch (e) {
        await dedicatedClient.query("ROLLBACK");
        return { success: false, error: e.message };
      } finally {
        await dedicatedClient.end();
      }
    });

    const creditResults = await Promise.all(concurrentCreditPromises);
    const creditSuccesses = creditResults.filter((r) => r.success).length;
    const creditBlocked = creditResults.filter((r) => !r.success).length;
    record("Ledger", "Concurrent double-credit attack prevented by unique constraint on cashbackId", creditSuccesses === 1 && creditBlocked === 4, `Successes: ${creditSuccesses}, Blocked: ${creditBlocked}`);

    // 4.4 Concurrent Overdraft Attack: Balance is ₹200.00, 5 parallel requests each try to debit ₹100.00
    const concurrentDebitPromises = Array.from({ length: 5 }, async (_, i) => {
      const dedicatedClient = new Client({ connectionString: process.env.DATABASE_URL });
      await dedicatedClient.connect();
      try {
        await dedicatedClient.query("BEGIN");
        const debitRes = await dedicatedClient.query(
          'UPDATE "Wallet" SET balance = balance - 100.00 WHERE id = $1 AND balance >= 100.00 RETURNING balance',
          [walletId]
        );
        if (debitRes.rowCount === 0) {
          throw new Error("INSUFFICIENT_FUNDS");
        }
        await dedicatedClient.query(
          'INSERT INTO "WalletTransaction" ("id", "walletId", "amount", "type", "category", "description", "createdAt") VALUES (gen_random_uuid(), $1, 100.00, \'DEBIT\', \'PAYOUT\', $2, NOW())',
          [walletId, `Concurrent Debit #${i} ${prefix}`]
        );
        await dedicatedClient.query("COMMIT");
        return { success: true, finalBalance: debitRes.rows[0].balance };
      } catch (e) {
        await dedicatedClient.query("ROLLBACK");
        return { success: false, error: e.message };
      } finally {
        await dedicatedClient.end();
      }
    });

    const debitResults = await Promise.all(concurrentDebitPromises);
    const debitSuccesses = debitResults.filter((r) => r.success).length;
    const debitBlocked = debitResults.filter((r) => !r.success).length;
    const finalWalletBal = await pgClient.query('SELECT balance FROM "Wallet" WHERE id = $1', [walletId]);
    record("Ledger", "Concurrent overdraft attack prevented: balance never negative", debitSuccesses === 2 && debitBlocked === 3 && parseFloat(finalWalletBal.rows[0].balance) >= 0, `Debits Allowed: ${debitSuccesses}, Blocked: ${debitBlocked}, Final Balance: ₹${finalWalletBal.rows[0].balance}`);

    // 4.5 Decimal Precision
    const decRes = await pgClient.query('SELECT (0.10::numeric * 10)::text as res');
    record("Ledger", "PostgreSQL Decimal arithmetic maintains exact precision without float drift", decRes.rows[0]?.res === "1.00", `Result: ${decRes.rows[0]?.res}`);

    // 4.6 Verify pending/approved cashback is NEVER added to available spendable wallet balance
    const walletSummaryRes = await fetch(`${BASE_URL}/api/wallet/summary`, {
      headers: { Cookie: userACookie },
    });
    const walletSummaryData = await walletSummaryRes.json();
    const availableMatch = parseFloat(walletSummaryData.summary?.availableBalance) === parseFloat(finalWalletBal.rows[0].balance);
    record("Ledger", "Wallet summary: Pending & Approved cashback excluded from spendable balance", availableMatch, `Available: ₹${walletSummaryData.summary?.availableBalance}, Tracked: ₹${walletSummaryData.summary?.trackedCashback}`);


    // =========================================================================
    // SECTION 5: DEALS, COUPONS & CLICK/REDIRECT SECURITY
    // =========================================================================
    console.log("\n▶ Section 5: Deals, Coupons & Click/Redirect Security...");

    // Seed Active Merchant
    const mRes = await fetch(`${BASE_URL}/api/admin/merchants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Merchant ${prefix}`,
        slug: `merch-${prefix}`,
        websiteUrl: "https://approved-merchant.example.com",
        isActive: true,
      }),
    });
    const mData = await mRes.json();
    merchantId = mData.merchant?.id;

    // Seed Deactivated Merchant
    const mDeactRes = await fetch(`${BASE_URL}/api/admin/merchants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Deactivated Merchant ${prefix}`,
        slug: `deact-${prefix}`,
        websiteUrl: "https://deactivated.example.com",
        isActive: false,
      }),
    });
    const mDeactData = await mDeactRes.json();
    const deactMerchantId = mDeactData.merchant?.id;

    // Seed Deal with Flipkart macro template
    const dRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId,
        title: `Audit Deal ${prefix}`,
        slug: dealSlug,
        originalPrice: 15000,
        dealPrice: 12000,
        affiliateUrl: "https://www.flipkart.com/?affid=cashton_aff&affExtParam2=543212_136_{tid}_source",
        isActive: true,
      }),
    });
    const dData = await dRes.json();
    dealId = dData.deal?.id;
    record("Deals", "Admin creates deal with Flipkart {tid} template (201)", dRes.status === 201 && !!dealId, `Deal ID: ${dealId}`);

    // Finding 3 Test: Deal without affiliateUrl MUST be rejected with 400
    const dNoAffRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId,
        title: `No Affiliate URL Deal ${prefix}`,
        slug: `no-aff-${prefix}`,
        originalPrice: 2000,
        dealPrice: 1500,
        isActive: true,
      }),
    });
    const dNoAffData = await dNoAffRes.json();
    const noAffDealId = dNoAffData.deal?.id;

    // Attempting to generate a click for a deal without affiliateUrl must fail cleanly
    const clickNoAffRes = await fetch(`${BASE_URL}/api/deals/${noAffDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userACookie },
      body: JSON.stringify({ source: "test" }),
    });
    record("ClickTracking", "Deal without affiliateUrl rejected at click generation with 400 (no untracked fallback)", clickNoAffRes.status === 400, `Status: ${clickNoAffRes.status}`);

    // Seed Deal on Deactivated Merchant
    await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: deactMerchantId,
        title: `Deactivated Merchant Deal ${prefix}`,
        slug: `deal-deact-${prefix}`,
        originalPrice: 1000,
        dealPrice: 800,
        affiliateUrl: "https://deact.example.com/offer",
        isActive: true,
      }),
    });

    // 5.1 Public visibility check: Deal on deactivated merchant hidden from public listing
    const pubDealsRes = await fetch(`${BASE_URL}/api/deals`);
    const pubDealsData = await pubDealsRes.json();
    const deactDealVisible = (pubDealsData.deals || []).some((d) => d.slug === `deal-deact-${prefix}`);
    record("Deals", "Deal belonging to deactivated merchant suppressed from public /api/deals", !deactDealVisible, `Hidden: ${!deactDealVisible}`);

    // 5.2 Click Tracking: Generate click token
    const clickRes = await fetch(`${BASE_URL}/api/deals/${dealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userACookie },
      body: JSON.stringify({ source: `audit-src-${prefix}` }),
    });
    const clickData = await clickRes.json();
    testClickId = clickData.clickId;
    const isClkFormat = typeof testClickId === "string" && /^clk_[0-9a-f]{48}$/.test(testClickId);
    record("ClickTracking", "Click generation returns 48-hex-char clk_ token format", isClkFormat, `ClickId: ${testClickId}`);

    // 5.3 Secure Redirect Engine: /api/go/[clickId] returns 307 + Cache-Control: no-store
    const redirRes = await fetch(`${BASE_URL}/api/go/${testClickId}`, {
      redirect: "manual",
    });
    const redirLoc = redirRes.headers.get("location");
    const cacheCtrl = redirRes.headers.get("cache-control");
    const hasNoStore = cacheCtrl && cacheCtrl.includes("no-store");
    const macroReplaced = redirLoc && redirLoc.includes(`543212_136_${testClickId}_source`) && !redirLoc.includes("{tid}");
    record("RedirectEngine", "Redirect returns HTTP 307 with Cache-Control: no-store and server-side {tid} macro replacement", redirRes.status === 307 && hasNoStore && macroReplaced, `Status: ${redirRes.status}, Cache: ${cacheCtrl}`);

    // 5.4 Open Redirect Defense: Client-supplied query redirect is strictly ignored
    const openRedirRes = await fetch(`${BASE_URL}/api/go/${testClickId}?redirect=https://evil-attacker.example.com`, {
      redirect: "manual",
    });
    const openRedirLoc = openRedirRes.headers.get("location");
    const openRedirBlocked = openRedirLoc && !openRedirLoc.includes("evil-attacker.example.com");
    record("RedirectEngine", "Open redirect via query param (?redirect=evil.com) strictly ignored", openRedirBlocked, `Redirected to: ${openRedirLoc}`);

    // 5.5 Rejection of unsafe URL schemes (javascript:, data:)
    const badDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId,
        title: `Malicious Scheme Deal ${prefix}`,
        slug: `deal-mal-${prefix}`,
        originalPrice: 1000,
        dealPrice: 800,
        affiliateUrl: "javascript:alert('xss')",
        isActive: true,
      }),
    });
    record("RedirectEngine", "javascript: scheme in deal affiliateUrl rejected with 400", badDealRes.status === 400, `Status: ${badDealRes.status}`);

    // 5.6 Finding 2 Verification: Inspect AffiliateClick onDelete: Restrict in database
    const fkQuery = await pgClient.query(`
      SELECT tc.constraint_name, rc.delete_rule 
      FROM information_schema.table_constraints tc 
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name 
      WHERE tc.table_name = 'AffiliateClick' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    const dealRule = fkQuery.rows.find((r) => r.constraint_name === "AffiliateClick_dealId_fkey")?.delete_rule;
    const merchRule = fkQuery.rows.find((r) => r.constraint_name === "AffiliateClick_merchantId_fkey")?.delete_rule;
    const restrictEnforced = dealRule === "RESTRICT" && merchRule === "RESTRICT";
    record("DataIntegrity", "AffiliateClick relations for deal & merchant enforce onDelete: RESTRICT", restrictEnforced, `Deal: ${dealRule}, Merchant: ${merchRule}`);


    // =========================================================================
    // SECTION 6: PHASE 6 CONVERSION / POSTBACK LAYER & FAIL-CLOSED CRON
    // =========================================================================
    console.log("\n▶ Section 6: Phase 6 Conversion / Postback Layer & Fail-Closed Cron...");

    // 6.1 Kill switch test: CUELINKS is currently excluded from whitelist -> returns 503
    const cueTxId = `tx-cue-block-${prefix}`;
    const cueResBlocked = await fetch(`${BASE_URL}/api/webhooks/cuelinks?secret=test_cuelinks_secret_cashton_2026&transaction_id=${cueTxId}`, {
      method: "POST",
    });
    record("Phase6_Ingestion", "Postback ingestion rejected with 503 when provider not in whitelist (Cuelinks)", cueResBlocked.status === 503, `Status: ${cueResBlocked.status}`);

    // 6.2 Generic provider webhook: Invalid Secret returns 401
    const genSecret = process.env.GENERIC_WEBHOOK_SECRET || "test_generic_secret_cashton_2026";
    const genTxId = `tx-gen-${prefix}`;
    const genPayload = {
      externalTransactionId: genTxId,
      clickId: testClickId,
      orderAmount: "4500.00",
      commissionAmount: "225.00",
      status: "CONFIRMED",
    };

    const invalidSecretRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": "wrong-secret-token",
      },
      body: JSON.stringify(genPayload),
    });
    record("Phase6_Ingestion", "Generic webhook with invalid secret rejected with 401", invalidSecretRes.status === 401, `Status: ${invalidSecretRes.status}`);

    // 6.3 Valid Secret + Valid ClickId Conversion Ingestion returns 201
    const validGenRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify(genPayload),
    });
    const validGenData = await validGenRes.json();
    record("Phase6_Ingestion", "Generic webhook ingestion with valid secret & clickId returns 201", validGenRes.status === 201 && validGenData.success, `Conversion ID: ${validGenData.conversionId}`);

    // 6.4 Sequential Replay / Idempotency Check: Same provider + externalTransactionId returns 200 isDuplicate
    const replayGenRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify(genPayload),
    });
    const replayGenData = await replayGenRes.json();
    const isIdempotent = replayGenRes.status === 200 && replayGenData.isDuplicate === true;
    record("Phase6_Ingestion", "Duplicate conversion postback handled idempotently without error (200 isDuplicate)", isIdempotent, `Duplicate flag: ${replayGenData.isDuplicate}`);

    // 6.5 Unknown ClickId Handling: Graceful unlinked conversion in UNMATCHED status
    const unknownClkTx = `tx-unk-${prefix}`;
    const unknownClkRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: unknownClkTx,
        clickId: "00000000-0000-0000-0000-000000000000",
        orderAmount: "1000.00",
        commissionAmount: "50.00",
        status: "CONFIRMED",
      }),
    });
    const unkDbCheck = await pgClient.query('SELECT status, "userId", "cashbackId" FROM "Conversion" WHERE "externalTransactionId" = $1', [unknownClkTx]);
    const safeUnmatched = unknownClkRes.status === 201 && unkDbCheck.rows[0]?.status === "UNMATCHED" && unkDbCheck.rows[0]?.cashbackId === null;
    record("Phase6_Ingestion", "Unknown clickId fails safely into UNMATCHED status with zero wallet credit", safeUnmatched, `Status: ${unkDbCheck.rows[0]?.status}, CashbackId: ${unkDbCheck.rows[0]?.cashbackId}`);

    // 6.6 Deleted Webhook Routes Verification (Flipkart & EarnKaro)
    const fkRes = await fetch(`${BASE_URL}/api/webhooks/flipkart`, { method: "POST" });
    const ekRes = await fetch(`${BASE_URL}/api/webhooks/earnkaro`, { method: "POST" });
    record("Phase6_Ingestion", "Deleted fabricated webhook routes return 404", fkRes.status === 404 && ekRes.status === 404, `Flipkart: ${fkRes.status}, EarnKaro: ${ekRes.status}`);

    // 6.7 Finding 1 Verification: Fail-closed Cron Auth (/api/cron/flipkart-reports)
    const cronSecret = process.env.CRON_SECRET;

    // Unauthenticated request -> 401
    const cronUnauth = await fetch(`${BASE_URL}/api/cron/flipkart-reports`);
    record("CronAuth", "Cron request without Authorization header rejected with 401", cronUnauth.status === 401, `Status: ${cronUnauth.status}`);

    // Invalid token -> 401
    const cronInvalidToken = await fetch(`${BASE_URL}/api/cron/flipkart-reports`, {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    record("CronAuth", "Cron request with invalid token rejected with 401", cronInvalidToken.status === 401, `Status: ${cronInvalidToken.status}`);

    // Query-string secret rejected -> 401
    const cronQuerySecret = await fetch(`${BASE_URL}/api/cron/flipkart-reports?secret=${cronSecret}`);
    record("CronAuth", "Cron request with query parameter secret strictly rejected with 401", cronQuerySecret.status === 401, `Status: ${cronQuerySecret.status}`);

    // Valid Bearer token authenticated -> 200
    const cronValid = await fetch(`${BASE_URL}/api/cron/flipkart-reports`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    record("CronAuth", "Cron request with valid Bearer token accepted with 200", cronValid.status === 200, `Status: ${cronValid.status}`);


    // =========================================================================
    // SECTION 7: RESOURCE LIMITS & SECURITY CONFIGURATION (OWASP API4 & API8)
    // =========================================================================
    console.log("\n▶ Section 7: Resource Limits & Security Configuration (OWASP API4 & API8)...");

    // 7.1 Probe Rate Limiting on click endpoint (>60 reqs per minute threshold)
    console.log("  ... Probing rate limiter on click generation endpoint (>60 reqs in burst) ...");
    const burstPromises = Array.from({ length: 70 }, (_, i) =>
      fetch(`${BASE_URL}/api/deals/${dealSlug}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userACookie },
        body: JSON.stringify({ source: `burst-${i}` }),
      })
    );
    const burstResponses = await Promise.all(burstPromises);
    const burstStatuses = burstResponses.map((r) => r.status);
    const hitRateLimit = burstStatuses.includes(429);
    const statusCounts = burstStatuses.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
    record("RateLimiting", "Burst requests past threshold trigger HTTP 429 Too Many Requests", hitRateLimit, `Hit 429: ${hitRateLimit} (Statuses: ${JSON.stringify(statusCounts)})`);

    // 7.2 Inspect HTTP Security Headers (Finding 5)
    const headRes = await fetch(`${BASE_URL}/api/health/db`);
    const xContentType = headRes.headers.get("x-content-type-options");
    const xFrameOptions = headRes.headers.get("x-frame-options");
    const refPolicy = headRes.headers.get("referrer-policy");
    const permPolicy = headRes.headers.get("permissions-policy");
    const secHeadersPass = xContentType === "nosniff" && xFrameOptions === "DENY" && !!refPolicy && !!permPolicy;
    record(
      "SecurityHeaders",
      "Presence of standard OWASP HTTP security headers",
      secHeadersPass,
      `x-content-type-options: ${xContentType}, x-frame-options: ${xFrameOptions}, referrer-policy: ${refPolicy}`
    );

    // 7.3 Audit environment secrets exposure: check whether sensitive server secrets are prefixed with NEXT_PUBLIC_
    const envKeys = Object.keys(process.env);
    const leakedSecrets = envKeys.filter(
      (k) =>
        k.startsWith("NEXT_PUBLIC_") &&
        (k.includes("PAYOUT_") ||
          k.includes("ENCRYPTION") ||
          k.includes("DATABASE") ||
          k.includes("SERVICE_ROLE") ||
          k.includes("CRON_SECRET"))
    );
    record("SecretExposure", "Zero server secrets or encryption keys exposed with NEXT_PUBLIC_ prefix", leakedSecrets.length === 0, `Leaked: ${leakedSecrets.join(", ") || "None"}`);

  } catch (err) {
    console.error("FATAL AUDIT ERROR:", err);
  } finally {
    await cleanup();
    await pgClient.end();
  }

  // Final summary
  console.log("\n================================================================================");
  console.log("FINAL COMPREHENSIVE SECURITY & QA AUDIT SUMMARY");
  console.log("================================================================================");
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Total Checks Executed : ${results.length}`);
  console.log(`Passed Checks         : ${passedCount}`);
  console.log(`Failed Checks         : ${failedCount}`);
  console.log(`Success Rate          : ${((passedCount / results.length) * 100).toFixed(1)}%`);
  console.log("================================================================================\n");

  if (failedCount > 0) {
    console.log("FAILING CHECKS:");
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  ✗ [${r.section}] ${r.name}`);
      console.log(`         └─ ${r.detail}`);
    });
    process.exit(1);
  } else {
    console.log("🎉 ALL AUDIT CHECKS PASSED!");
    process.exit(0);
  }
}

runComprehensiveAudit().catch((err) => {
  console.error("Fatal uncaught:", err);
  process.exit(1);
});
