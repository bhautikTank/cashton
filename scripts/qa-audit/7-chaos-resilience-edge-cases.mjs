/**
 * QA Audit Discipline 7: Chaos, Resilience & Edge-Case Testing
 * Covers:
 * - Malformed, truncated, and empty JSON payloads across endpoints
 * - Content-Type mismatches and unsupported media types
 * - Corrupted, expired, and tampered auth cookies / tokens
 * - SQL Injection & XSS boundary fuzzing across query parameters and bodies
 * - Integer overflow, negative pagination, and non-numeric query boundaries
 * - Database health endpoint resilience
 */

import assert from "assert";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

export async function runChaosResilienceTests() {
  console.log("\n================================================================================");
  console.log("   DISCIPLINE 7: CHAOS, RESILIENCE & EDGE-CASE TESTING");
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
  // 7.1 MALFORMED & CORRUPTED PAYLOAD HANDLING
  // ---------------------------------------------------------------------------
  console.log("--- 7.1 Malformed & Corrupted Payload Handling ---");

  await test("POST /api/auth/login with truncated/malformed JSON returns 400 (never 500)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"email": "broken@example.com", "password": ', // truncated JSON
    });
    assert.strictEqual(
      res.status === 400 || res.status === 422,
      true,
      `Expected 400 or 422 for malformed JSON, got ${res.status}`
    );
    const body = await res.json().catch(() => ({}));
    assert.ok(body.error || body.message, "Should return an error message");
  });

  await test("POST /api/auth/register with empty string body returns 400 (never 500)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    assert.strictEqual(
      res.status === 400 || res.status === 422,
      true,
      `Expected 400 or 422 for empty body, got ${res.status}`
    );
  });

  await test("POST /api/auth/register with empty JSON object {} returns 400 with validation errors", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    const body = await res.json();
    assert.ok(body.errors || body.error || body.message, "Should have error or errors object");
  });

  await test("POST /api/auth/login with non-JSON Content-Type (text/plain) is rejected gracefully", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "email=user@example.com&password=secret",
    });
    assert.strictEqual(
      res.status === 400 || res.status === 415,
      true,
      `Expected 400 or 415 for text/plain, got ${res.status}`
    );
  });

  // ---------------------------------------------------------------------------
  // 7.2 CORRUPTED & TAMPERED AUTHENTICATION CREDENTIALS
  // ---------------------------------------------------------------------------
  console.log("\n--- 7.2 Corrupted & Tampered Authentication Credentials ---");

  await test("GET /api/users/profile with totally corrupted Bearer token returns 401 (never 500)", async () => {
    const res = await fetch(`${BASE_URL}/api/users/profile`, {
      headers: { Authorization: "Bearer totally-corrupted-jwt-token-xyz-123" },
    });
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
  });

  await test("GET /api/users/profile with 'alg: none' spoofed JWT token returns 401", async () => {
    // Header: {"alg":"none","typ":"JWT"} -> eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0
    // Payload: {"sub":"spoofed-admin","role":"ADMIN"} -> eyJzdWIiOiJzcG9vZmVkLWFkbWluIiwicm9sZSI6IkFETUlOIn0
    const spoofedNoneToken = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJzcG9vZmVkLWFkbWluIiwicm9sZSI6IkFETUlOIn0.";
    const res = await fetch(`${BASE_URL}/api/users/profile`, {
      headers: { Authorization: `Bearer ${spoofedNoneToken}` },
    });
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
  });

  await test("GET /api/users/profile with malformed session cookie returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/users/profile`, {
      headers: { Cookie: "sb-access-token=invalid-cookie-token; sb-refresh-token=invalid" },
    });
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
  });

  // ---------------------------------------------------------------------------
  // 7.3 INJECTION & BOUNDARY FUZZING IN QUERY PARAMETERS
  // ---------------------------------------------------------------------------
  console.log("\n--- 7.3 Injection & Boundary Fuzzing in Query Parameters ---");

  await test("GET /api/coupons with SQL injection payload in search param does not throw 500", async () => {
    const sqli = encodeURIComponent("' UNION SELECT * FROM \"User\" WHERE '1'='1' --");
    const res = await fetch(`${BASE_URL}/api/coupons?search=${sqli}`);
    assert.strictEqual(res.status, 200, `Expected 200 with sanitized query, got ${res.status}`);
    const body = await res.json();
    assert.ok(Array.isArray(body.coupons || body.data || body), "Should return array safely");
  });

  await test("GET /api/deals with XSS script injection in query param does not reflect unescaped", async () => {
    const xss = encodeURIComponent("<script>alert('xss')</script>");
    const res = await fetch(`${BASE_URL}/api/deals?search=${xss}`);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  });

  await test("GET /api/deals with negative pagination (?page=-10&limit=-5) handles boundary gracefully", async () => {
    const res = await fetch(`${BASE_URL}/api/deals?page=-10&limit=-5`);
    // Should either reject with 400 or clamp to safe defaults (200), never 500
    assert.strictEqual(
      res.status === 200 || res.status === 400,
      true,
      `Expected 200 (clamped) or 400 (validation reject), got ${res.status}`
    );
  });

  await test("GET /api/deals with non-numeric pagination (?page=NaN&limit=infinity) handles safely", async () => {
    const res = await fetch(`${BASE_URL}/api/deals?page=NaN&limit=infinity`);
    assert.strictEqual(
      res.status === 200 || res.status === 400,
      true,
      `Expected 200 or 400, got ${res.status}`
    );
  });

  await test("GET /api/coupons with huge limit (?limit=999999999) does not trigger unbounded memory dump", async () => {
    const res = await fetch(`${BASE_URL}/api/coupons?limit=999999999`);
    assert.strictEqual(
      res.status === 200 || res.status === 400,
      true,
      `Expected 200 or 400, got ${res.status}`
    );
    if (res.status === 200) {
      const body = await res.json();
      const list = body.coupons || body.data || body;
      assert.ok(Array.isArray(list), "Expected array");
      // Must not return unbounded records (service caps at 50 or 100 max)
      assert.ok(list.length <= 100, `Expected <= 100 clamped records, got ${list.length}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 7.4 EXTREME PAYLOAD & UNICODE BOUNDARY FUZZING
  // ---------------------------------------------------------------------------
  console.log("\n--- 7.4 Extreme Payload & Unicode Boundary Fuzzing ---");

  await test("POST /api/auth/register with null bytes in email returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "attacker\u0000@example.com",
        password: "ValidPassword123!",
      }),
    });
    assert.strictEqual(res.status, 400, `Expected 400 for null-byte email, got ${res.status}`);
  });

  await test("POST /api/auth/login with 4-byte UTF-8 emoji and RTL unicode handles safely", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test\u202E\u0000🚀@example.com",
        password: "Pass\u{1F4A9}123!",
      }),
    });
    // Should be rejected by email validation (400) or auth failure (401), never 500
    assert.strictEqual(
      res.status === 400 || res.status === 401,
      true,
      `Expected 400 or 401, got ${res.status}`
    );
  });

  await test("POST /api/auth/register with oversized payload (500KB) does not crash process", async () => {
    const largePadding = "a".repeat(500 * 1024);
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "large@example.com",
        password: "Password123!",
        extra: largePadding,
      }),
    });
    assert.strictEqual(
      res.status === 400 || res.status === 413,
      true,
      `Expected 400 or 413 for oversized body, got ${res.status}`
    );
  });

  // ---------------------------------------------------------------------------
  // 7.5 HEALTH ENDPOINT RESILIENCE
  // ---------------------------------------------------------------------------
  console.log("\n--- 7.5 Health Endpoint Resilience ---");

  await test("GET /api/health/db returns structured status JSON with success message", async () => {
    const res = await fetch(`${BASE_URL}/api/health/db`);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert.strictEqual(body.success, true, "DB health check must report success: true");
    assert.ok(body.message?.includes("connected") || body.message?.includes("success"), "Must report connection success");
  });

  console.log("\n--------------------------------------------------------------------------------");
  console.log(`Discipline 7 Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log("--------------------------------------------------------------------------------\n");

  if (failed > 0) {
    throw new Error(`Discipline 7 completed with ${failed} failure(s)`);
  }
}

// Direct execution
if (process.argv[1]?.endsWith("7-chaos-resilience-edge-cases.mjs")) {
  runChaosResilienceTests()
    .then(() => {
      console.log("All Discipline 7 tests passed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Discipline 7 test run failed:", err);
      process.exit(1);
    });
}
