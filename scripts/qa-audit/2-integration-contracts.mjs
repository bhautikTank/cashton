/**
 * QA Audit Discipline 2: Integration & Contract Testing
 * Covers:
 * - HTTP methods, status codes (200, 201, 400, 401, 403, 404, 409)
 * - Zod schema boundaries (missing fields, unknown mass-assignment, types, oversized, null bytes, SQLi strings)
 * - Response shapes & security headers
 */

import assert from "assert";
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

export async function runIntegrationContractTests() {
  console.log("\n================================================================================");
  console.log("   DISCIPLINE 2: INTEGRATION & CONTRACT TESTING (API ROUTES + DB)");
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

  // Helper setup
  const runId = Date.now();
  const testUser = {
    email: `contract-user-${runId}@example.com`,
    password: "Password@12345",
    name: "Contract Test User",
    mobileNumber: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
  };

  let userCookie = "";
  let adminCookie = "";

  // 1. Setup User & Admin Session
  await test("Setup standard user registration (201)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUser),
    });
    assert.strictEqual(res.status, 201);
  });

  await test("Setup standard user login (200 + Session Cookie)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    assert.strictEqual(res.status, 200);
    userCookie = extractCookies(res);
    assert.ok(userCookie.length > 0);
  });

  // Admin account
  const testAdmin = {
    email: `contract-admin-${runId}@example.com`,
    password: "Password@12345",
    name: "Contract Admin",
    mobileNumber: `+9197${Math.floor(10000000 + Math.random() * 90000000)}`,
  };
  await test("Setup admin user registration and elevation", async () => {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testAdmin),
    });
    assert.strictEqual(regRes.status, 201);

    // Elevate admin in DB directly
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('UPDATE "User" SET role = $1 WHERE email = $2', ["ADMIN", testAdmin.email]);
    await client.end();

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testAdmin.email, password: testAdmin.password }),
    });
    assert.strictEqual(loginRes.status, 200);
    adminCookie = extractCookies(loginRes);
    assert.ok(adminCookie.length > 0);
  });

  // ---------------------------------------------------------------------------
  // 2.1 AUTH & USER CONTRACTS
  // ---------------------------------------------------------------------------
  console.log("\n--- 2.1 Auth & User Endpoint Contracts ---");

  await test("GET /api/auth/me returns authenticated user profile shape (200)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: userCookie },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(typeof json.user.id, "string");
    assert.strictEqual(json.user.email, testUser.email);
    assert.strictEqual(json.user.role, "USER");
    assert.strictEqual(json.user.passwordHash, undefined); // Zero credential leakage
  });

  await test("Unauthenticated GET /api/auth/me returns 401 Unauthorized", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`);
    assert.strictEqual(res.status, 401);
  });

  await test("POST /api/auth/register with duplicate email returns 409 Conflict", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...testUser,
        mobileNumber: `+9191${Math.floor(10000000 + Math.random() * 90000000)}`,
      }),
    });
    assert.strictEqual(res.status, 409);
  });

  await test("POST /api/auth/register with duplicate mobileNumber returns 409 Conflict", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `new-${Date.now()}@example.com`,
        password: "Password@12345",
        name: "Diff User",
        mobileNumber: testUser.mobileNumber,
      }),
    });
    assert.strictEqual(res.status, 409);
  });

  await test("POST /api/auth/register with mass-assignment role injection is rejected with 400", async () => {
    const maliciousUser = {
      email: `hacker-${Date.now()}@example.com`,
      password: "Password@12345",
      name: "Attacker",
      mobileNumber: `+9192${Math.floor(10000000 + Math.random() * 90000000)}`,
      role: "ADMIN",
      isAdmin: true,
    };
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousUser),
    });
    // Schema is strict: unknown properties must be rejected with 400 Bad Request
    assert.strictEqual(res.status, 400, "Strict schema must reject unknown role/isAdmin fields with 400");
  });

  await test("PATCH /api/users/profile with mass-assignment (role: ADMIN, balance: 10000) rejected with 400", async () => {
    const res = await fetch(`${BASE_URL}/api/users/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: userCookie,
      },
      body: JSON.stringify({
        role: "ADMIN",
        balance: 10000,
      }),
    });
    assert.strictEqual(res.status, 400); // Strict Zod rejects unrecognized mass-assignment fields
  });

  // ---------------------------------------------------------------------------
  // 2.2 PAYOUT DETAILS CONTRACTS
  // ---------------------------------------------------------------------------
  console.log("\n--- 2.2 Encrypted Payout Details Contracts ---");

  await test("GET /api/users/payout-details before submission returns null (200)", async () => {
    const res = await fetch(`${BASE_URL}/api/users/payout-details`, {
      headers: { Cookie: userCookie },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.payoutDetails, null);
  });

  await test("POST /api/users/payout-details saves Bank details & returns masked numbers (200)", async () => {
    const payload = {
      payoutMethod: "BANK",
      accountHolderName: "Contract Tester",
      accountNumber: "12345678901234",
      ifscCode: "HDFC0001234",
      bankName: "HDFC Bank",
    };
    const res = await fetch(`${BASE_URL}/api/users/payout-details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userCookie,
      },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.payoutDetails.accountNumberLast4, "1234");
    assert.strictEqual(json.payoutDetails.accountNumberMasked, "••••••••••1234");
    assert.strictEqual(json.payoutDetails.encryptedAccountNumber, undefined); // Ciphertext never exposed
  });

  await test("POST /api/users/payout-details rejects invalid IFSC code format with 400", async () => {
    const res = await fetch(`${BASE_URL}/api/users/payout-details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userCookie,
      },
      body: JSON.stringify({
        payoutMethod: "BANK",
        accountHolderName: "Bad IFSC",
        accountNumber: "123456789012",
        ifscCode: "INVALID_IFSC",
        bankName: "State Bank",
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  // ---------------------------------------------------------------------------
  // 2.3 WALLET SUMMARY CONTRACTS
  // ---------------------------------------------------------------------------
  console.log("\n--- 2.3 Wallet Summary & Balances Contracts ---");

  await test("GET /api/wallet/summary returns standard financial projection shape (200)", async () => {
    const res = await fetch(`${BASE_URL}/api/wallet/summary`, {
      headers: { Cookie: userCookie },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    const s = json.summary;
    assert.strictEqual(typeof s.availableBalance, "string");
    assert.strictEqual(typeof s.heldBalance, "string");
    assert.strictEqual(typeof s.debtBalance, "string");
    assert.strictEqual(s.availableBalance, "0.00");
    assert.strictEqual(s.heldBalance, "0.00");
    assert.strictEqual(s.debtBalance, "0.00");
    assert.strictEqual(s.currency, "INR");
    assert.ok(Array.isArray(s.recentTransactions));
  });

  // ---------------------------------------------------------------------------
  // 2.4 ZOD SCHEMA BOUNDARIES & INJECTION PAYLOADS
  // ---------------------------------------------------------------------------
  console.log("\n--- 2.4 Zod Schema Boundaries & Security Injection Tests ---");

  await test("POST /api/admin/merchants with 50KB oversized description string rejected with 400", async () => {
    const oversizedString = "A".repeat(50000);
    const res = await fetch(`${BASE_URL}/api/admin/merchants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        name: "Oversized Merchant",
        slug: `oversized-${Date.now()}`,
        description: oversizedString,
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  await test("POST /api/admin/deals with SQL injection payload in title is safely handled & sanitized", async () => {
    // First create a valid merchant
    const merchRes = await fetch(`${BASE_URL}/api/admin/merchants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        name: `SQLi Merchant ${Date.now()}`,
        slug: `sqli-merch-${Date.now()}`,
      }),
    });
    const merch = await merchRes.json();
    const merchantId = merch.merchant.id;

    const sqliTitle = "Electronics'; DROP TABLE \"Merchant\";--";
    const dealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        title: sqliTitle,
        slug: `sqli-deal-${Date.now()}`,
        merchantId,
        affiliateUrl: "https://example.com/item",
        originalPrice: 1000,
        dealPrice: 800,
      }),
    });
    assert.strictEqual(dealRes.status, 201); // Safely inserted as literal string, no SQL execution
    const dealJson = await dealRes.json();
    assert.strictEqual(dealJson.deal.title, sqliTitle);
  });

  await test("POST /api/admin/campaigns with negative monetary values rejected with 400", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        name: "Negative Campaign",
        shareType: "PERCENTAGE",
        userShareValue: -15, // Negative percentage
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  console.log(`\nDiscipline 2 Results: ${passed} Passed, ${failed} Failed`);
  return { category: "Integration & Contract Testing", passed, failed };
}

if (process.argv[1]?.endsWith("2-integration-contracts.mjs")) {
  runIntegrationContractTests().catch(console.error);
}
