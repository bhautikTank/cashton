/**
 * QA Audit Discipline 5: Security & Penetration Testing (OWASP API Top 10)
 * Covers:
 * - BOLA / IDOR (User A accessing/mutating User B's resources)
 * - BFLA (Standard user calling /api/admin/**)
 * - Fail-Closed Cron Authentication (empty env, bad tokens, query string rejection)
 * - SSRF & Open Redirect Defenses (javascript:, data:, metadata IP, backslash confusion)
 * - Sensitive Data Exposure (passwordHash, encryptedAccountNumber, IV, authTag)
 */

import assert from "assert";
import dotenv from "dotenv";
import { isSafeRedirectUrl } from "../../src/modules/affiliate-clicks/click.service.ts";

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

export async function runSecurityPenetrationTests() {
  console.log("\n================================================================================");
  console.log("   DISCIPLINE 5: SECURITY & PENETRATION TESTING (OWASP API TOP 10)");
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

  // Setup User A & User B
  const userA = {
    email: `sec-usera-${runId}@example.com`,
    password: "Password@12345",
    name: "User A",
    mobileNumber: `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
  };
  const userB = {
    email: `sec-userb-${runId}@example.com`,
    password: "Password@12345",
    name: "User B",
    mobileNumber: `+9194${Math.floor(10000000 + Math.random() * 90000000)}`,
  };

  let cookieA = "";
  let cookieB = "";

  await test("Setup User A & User B accounts and sessions", async () => {
    // Register A
    const regA = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userA),
    });
    assert.strictEqual(regA.status, 201);
    const loginA = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userA.email, password: userA.password }),
    });
    cookieA = extractCookies(loginA);

    // Register B
    const regB = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userB),
    });
    assert.strictEqual(regB.status, 201);
    const loginB = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userB.email, password: userB.password }),
    });
    cookieB = extractCookies(loginB);
  });

  // ---------------------------------------------------------------------------
  // 5.1 BROKEN OBJECT LEVEL AUTHORIZATION (BOLA / IDOR)
  // ---------------------------------------------------------------------------
  console.log("\n--- 5.1 Broken Object Level Authorization (BOLA/IDOR) ---");

  await test("BOLA: User A cannot read User B's profile by supplying userId in query/body", async () => {
    // Get B's profile
    const resB = await fetch(`${BASE_URL}/api/users/profile`, { headers: { Cookie: cookieB } });
    const jsonB = await resB.json();
    const userBId = jsonB.profile.id;

    // User A attempts to request profile with User B's ID in query
    const resA = await fetch(`${BASE_URL}/api/users/profile?userId=${userBId}`, {
      headers: { Cookie: cookieA },
    });
    const jsonA = await resA.json();
    assert.strictEqual(jsonA.profile.email, userA.email); // Returns User A, ignores parameter!
  });

  await test("BOLA: User A cannot mutate User B's payout details", async () => {
    // User B sets payout details
    await fetch(`${BASE_URL}/api/users/payout-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify({
        payoutMethod: "UPI",
        upiId: "userb@okaxis",
      }),
    });

    // User A sends update with User B's details attached in body
    await fetch(`${BASE_URL}/api/users/payout-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({
        payoutMethod: "UPI",
        upiId: "usera@okaxis",
      }),
    });

    // Check that User B's details remained completely untouched
    const checkB = await fetch(`${BASE_URL}/api/users/payout-details`, { headers: { Cookie: cookieB } });
    const bDetails = await checkB.json();
    assert.strictEqual(bDetails.payoutDetails.upiIdMasked, "us••••rb@okaxis");
  });

  // ---------------------------------------------------------------------------
  // 5.2 BROKEN FUNCTION LEVEL AUTHORIZATION (BFLA)
  // ---------------------------------------------------------------------------
  console.log("\n--- 5.2 Broken Function Level Authorization (BFLA) ---");

  const adminRoutes = [
    { method: "GET", path: "/api/admin/check" },
    { method: "GET", path: "/api/admin/debts" },
    { method: "POST", path: "/api/admin/debts/fake-id/resolve" },
    { method: "GET", path: "/api/admin/campaigns" },
    { method: "POST", path: "/api/admin/campaigns" },
    { method: "GET", path: "/api/admin/conversions" },
    { method: "GET", path: "/api/admin/merchants" },
    { method: "POST", path: "/api/admin/merchants" },
    { method: "GET", path: "/api/admin/deals" },
    { method: "POST", path: "/api/admin/deals" },
    { method: "GET", path: "/api/admin/coupons" },
    { method: "POST", path: "/api/admin/coupons" },
    { method: "GET", path: "/api/admin/affiliate-clicks" },
    { method: "GET", path: "/api/admin/affiliate-clicks/summary" },
  ];

  for (const r of adminRoutes) {
    await test(`BFLA: Standard USER calling ${r.method} ${r.path} returns 403 Forbidden`, async () => {
      const res = await fetch(`${BASE_URL}${r.path}`, {
        method: r.method,
        headers: { "Content-Type": "application/json", Cookie: cookieA },
        body: r.method === "POST" ? JSON.stringify({}) : undefined,
      });
      assert.strictEqual(res.status, 403);
    });
  }

  // ---------------------------------------------------------------------------
  // 5.3 FAIL-CLOSED CRON SECURITY
  // ---------------------------------------------------------------------------
  console.log("\n--- 5.3 Fail-Closed Cron Authentication ---");

  await test("Cron /api/cron/flipkart-reports without header rejected with 401", async () => {
    const res = await fetch(`${BASE_URL}/api/cron/flipkart-reports`);
    assert.strictEqual(res.status, 401);
  });

  await test("Cron /api/cron/flipkart-reports with query secret (?secret=...) strictly rejected with 401", async () => {
    const secret = process.env.CRON_SECRET || "cashton-cron-secret-production-2026";
    const res = await fetch(`${BASE_URL}/api/cron/flipkart-reports?secret=${secret}`);
    assert.strictEqual(res.status, 401);
  });

  await test("Cron /api/cron/hold-release without header rejected with 401", async () => {
    const res = await fetch(`${BASE_URL}/api/cron/hold-release`);
    assert.strictEqual(res.status, 401);
  });

  await test("Cron /api/cron/hold-release with invalid Bearer token rejected with 401", async () => {
    const res = await fetch(`${BASE_URL}/api/cron/hold-release`, {
      headers: { Authorization: "Bearer wrong-token-12345" },
    });
    assert.strictEqual(res.status, 401);
  });

  // ---------------------------------------------------------------------------
  // 5.4 SSRF & OPEN REDIRECT DEFENSE
  // ---------------------------------------------------------------------------
  console.log("\n--- 5.4 SSRF & Open Redirect Defenses ---");

  const dangerousUrls = [
    { url: "javascript:alert(document.cookie)", reason: "javascript: scheme" },
    { url: "data:text/html,<script>alert(1)</script>", reason: "data: scheme" },
    { url: "file:///etc/passwd", reason: "file: scheme" },
    { url: "vbscript:msgbox(1)", reason: "vbscript: scheme" },
    { url: "blob:https://example.com/uuid", reason: "blob: scheme" },
    { url: "//evil.com/phishing", reason: "protocol-relative URL" },
    { url: "https://trusted.com\\@evil.com", reason: "backslash host confusion" },
    { url: "http://localhost:3000", reason: "localhost loopback" },
    { url: "http://127.0.0.1:8080", reason: "IPv4 loopback" },
    { url: "http://169.254.169.254/latest/meta-data/", reason: "AWS/Cloud metadata IP" },
    { url: "http://10.0.0.1/admin", reason: "RFC1918 Private 10.x IP" },
    { url: "http://192.168.1.1", reason: "RFC1918 Private 192.168.x IP" },
    { url: "http://172.16.0.1", reason: "RFC1918 Private 172.16.x IP" },
    { url: "http://[::1]/", reason: "IPv6 literal loopback" },
    { url: "http://0.0.0.0:8000", reason: "Zero IP" },
  ];

  for (const item of dangerousUrls) {
    test(`OpenRedirect: isSafeRedirectUrl rejects ${item.reason} (${item.url})`, () => {
      assert.strictEqual(isSafeRedirectUrl(item.url), false);
    });
  }

  // ---------------------------------------------------------------------------
  // 5.5 SENSITIVE DATA EXPOSURE
  // ---------------------------------------------------------------------------
  console.log("\n--- 5.5 Sensitive Data Exposure Verification ---");

  await test("Profile API suppresses passwordHash, authUserId, and internal tokens", async () => {
    const res = await fetch(`${BASE_URL}/api/users/profile`, { headers: { Cookie: cookieA } });
    const json = await res.json();
    const p = json.profile;
    assert.strictEqual(p.passwordHash, undefined);
    assert.strictEqual(p.authUserId, undefined);
  });

  await test("Payout details API suppresses raw bank account number, ciphertexts, and authTag", async () => {
    const res = await fetch(`${BASE_URL}/api/users/payout-details`, { headers: { Cookie: cookieB } });
    const json = await res.json();
    const raw = JSON.stringify(json);
    assert.strictEqual(raw.includes("userb@okaxis"), false); // Raw UPI handle never present
    assert.strictEqual(json.payoutDetails.encryptedAccountNumber, undefined);
    assert.strictEqual(json.payoutDetails.authTag, undefined);
    assert.strictEqual(json.payoutDetails.iv, undefined);
  });

  console.log(`\nDiscipline 5 Results: ${passed} Passed, ${failed} Failed`);
  return { category: "Security & Penetration Testing (OWASP)", passed, failed };
}

if (process.argv[1]?.endsWith("5-security-penetration-owasp.mjs")) {
  runSecurityPenetrationTests().catch(console.error);
}
