/**
 * CashTon Phase 5: Affiliate Click Tracking & Secure Redirect Engine Test Suite
 * Comprehensive End-to-End Functional, RBAC, Validation, Concurrency & Security Verification
 */

import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

async function runPhase5Tests() {
  console.log("================================================================================");
  console.log("CashTon Phase 5: Affiliate Click Tracking & Secure Redirect Engine Test Suite");
  console.log(`Target: ${BASE_URL}`);
  console.log("================================================================================\n");

  const results = [];
  function record(category, testName, passed, detail) {
    results.push({ category, name: testName, passed, detail });
    const mark = passed ? "✓ PASS" : "✗ FAIL";
    console.log(`  ${mark} [${category}] ${testName}`);
    if (detail) console.log(`         └─ ${detail}`);
  }

  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();

  const runId = Date.now();
  const testPrefix = `p5-${runId}`;
  const testUserEmail = `user-${testPrefix}@example.com`;
  const adminEmail = `admin-${testPrefix}@example.com`;
  const testPassword = "SecurePassword123!";
  const testMobile = `98765${Math.floor(10000 + Math.random() * 90000)}`;
  const adminMobile = `98766${Math.floor(10000 + Math.random() * 90000)}`;

  let userCookie = "";
  let adminCookie = "";
  let standardUserId = "";
  let adminUserId = "";

  let activeMerchantId = "";
  let validDealId = "";
  let inactiveDealId = "";
  let expiredDealId = "";
  let dangerousDealId = "";
  let flipkartDealId = "";
  let flipkartDeepLinkDealId = "";

  const approvedDestinationUrl = "https://partner-store.example.com/products/laptop?aff=cashton";
  const flipkartTemplateUrl = "https://www.flipkart.com/?affid=bh7162&affExtParam1=2010&affExtParam2=543212_136_{tid}_source";
  const flipkartDeepLinkTemplateUrl = "https://dl.flipkart.com/dl/?affid=bh7162&affExtParam1=2010&affExtParam2=543212_136_{tid}_source";

  async function cleanupAll() {
    try {
      await pgClient.query('DELETE FROM "User" WHERE email LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "Merchant" WHERE slug LIKE $1', [`%${testPrefix}%`]);
    } catch (e) {
      console.error("Cleanup warning:", e);
    }
  }

  try {
    // =========================================================================
    // SECTION 0: SETUP
    // =========================================================================
    console.log("▶ Running Section 0: Test Setup (Users, Sessions, Merchants & Deals)...");

    // 0.1 Register and login standard user
    const uRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
        name: "Standard User",
        mobileNumber: testMobile,
      }),
    });
    const uRegData = await uRegRes.json();
    standardUserId = uRegData.user?.id;
    record("Setup", "Register standard user account (201)", uRegRes.status === 201 && uRegData.success, `User ID: ${standardUserId}`);

    const uLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testUserEmail, password: testPassword }),
    });
    const rawUserCookies = uLoginRes.headers.get("set-cookie") || "";
    userCookie = rawUserCookies
      .split(/,(?=[^;]+;)/)
      .map((c) => c.split(";")[0].trim())
      .join("; ");
    record("Setup", "Login standard user (session cookie)", uLoginRes.status === 200 && !!userCookie, `Cookie established`);

    // 0.2 Register, elevate and login admin
    const aRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: testPassword,
        name: "Admin User",
        mobileNumber: adminMobile,
      }),
    });
    const aRegData = await aRegRes.json();
    adminUserId = aRegData.user?.id;
    await pgClient.query('UPDATE "User" SET role = \'ADMIN\' WHERE id = $1', [adminUserId]);

    const aLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: testPassword }),
    });
    const rawAdminCookies = aLoginRes.headers.get("set-cookie") || "";
    adminCookie = rawAdminCookies
      .split(/,(?=[^;]+;)/)
      .map((c) => c.split(";")[0].trim())
      .join("; ");
    record("Setup", "Register, elevate & login ADMIN account", aLoginRes.status === 200 && !!adminCookie, `Admin ID: ${adminUserId}`);

    // 0.3 Seed merchants directly in DB
    const mActiveRes = await pgClient.query(
      `INSERT INTO "Merchant" (id, name, slug, "websiteUrl", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'https://partner-store.example.com', true, NOW(), NOW())
       RETURNING id`,
      [`Active Merchant ${testPrefix}`, `merch-active-${testPrefix}`]
    );
    activeMerchantId = mActiveRes.rows[0].id;

    await pgClient.query(
      `INSERT INTO "Merchant" (id, name, slug, "websiteUrl", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'https://inactive-store.example.com', false, NOW(), NOW())`,
      [`Inactive Merchant ${testPrefix}`, `merch-inactive-${testPrefix}`]
    );

    // 0.4 Seed deals directly in DB
    // A) Valid Active Deal
    const dActiveRes = await pgClient.query(
      `INSERT INTO "Deal" (id, "merchantId", title, slug, "affiliateUrl", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Valid Laptop Deal', $2, $3, true, NOW(), NOW())
       RETURNING id`,
      [activeMerchantId, `deal-valid-${testPrefix}`, approvedDestinationUrl]
    );
    validDealId = dActiveRes.rows[0].id;

    // B) Inactive Deal
    const dInactiveRes = await pgClient.query(
      `INSERT INTO "Deal" (id, "merchantId", title, slug, "affiliateUrl", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Inactive Deal', $2, $3, false, NOW(), NOW())
       RETURNING id`,
      [activeMerchantId, `deal-inactive-${testPrefix}`, approvedDestinationUrl]
    );
    inactiveDealId = dInactiveRes.rows[0].id;

    // C) Expired Deal
    const dExpiredRes = await pgClient.query(
      `INSERT INTO "Deal" (id, "merchantId", title, slug, "affiliateUrl", "endDate", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Expired Deal', $2, $3, NOW() - INTERVAL '1 day', true, NOW(), NOW())
       RETURNING id`,
      [activeMerchantId, `deal-expired-${testPrefix}`, approvedDestinationUrl]
    );
    expiredDealId = dExpiredRes.rows[0].id;

    // D) Deal with Dangerous URL
    const dDangerRes = await pgClient.query(
      `INSERT INTO "Deal" (id, "merchantId", title, slug, "affiliateUrl", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Dangerous URL Deal', $2, 'javascript:alert(document.cookie)', true, NOW(), NOW())
       RETURNING id`,
      [activeMerchantId, `deal-danger-${testPrefix}`]
    );
    dangerousDealId = dDangerRes.rows[0].id;

    // E) Flipkart Affiliate Deal with {tid} Template
    const dFkRes = await pgClient.query(
      `INSERT INTO "Deal" (id, "merchantId", title, slug, "affiliateUrl", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Flipkart Big Billion Deal', $2, $3, true, NOW(), NOW())
       RETURNING id`,
      [activeMerchantId, `deal-fk-${testPrefix}`, flipkartTemplateUrl]
    );
    flipkartDealId = dFkRes.rows[0].id;

    // F) Flipkart Deep-Link Deal (dl.flipkart.com)
    const dFkDlRes = await pgClient.query(
      `INSERT INTO "Deal" (id, "merchantId", title, slug, "affiliateUrl", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'Flipkart Mobile Deep Link Deal', $2, $3, true, NOW(), NOW())
       RETURNING id`,
      [activeMerchantId, `deal-fk-dl-${testPrefix}`, flipkartDeepLinkTemplateUrl]
    );
    flipkartDeepLinkDealId = dFkDlRes.rows[0].id;

    record("Setup", "Seeded active/inactive merchants & deals in database", true, `Valid Deal: ${validDealId}`);

    // =========================================================================
    // SECTION 1: CLICK CREATION & ATTRIBUTION
    // =========================================================================
    console.log("\n▶ Running Section 1: Click Creation & Attribution...");

    // Test 1: Anonymous click creation
    const anonClickRes = await fetch(`${BASE_URL}/api/deals/${validDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "web_homepage" }),
    });
    const anonClickData = await anonClickRes.json();
    const anonClickId = anonClickData.clickId;
    const isAnonValid =
      anonClickRes.status === 201 &&
      anonClickData.success === true &&
      typeof anonClickId === "string" &&
      anonClickId.startsWith("clk_");
    record("Click_Creation", "1. Anonymous click creation returns 201 and clickId", isAnonValid, `Click ID: ${anonClickId}`);

    // Check DB for anonymous attribution
    const anonDbCheck = await pgClient.query('SELECT * FROM "AffiliateClick" WHERE "clickId" = $1', [anonClickId]);
    const isAnonDbOk = anonDbCheck.rows.length === 1 && anonDbCheck.rows[0].userId === null;
    record("Click_Creation", "1b. Anonymous click in DB has userId = null", isAnonDbOk, `DB userId: ${anonDbCheck.rows[0]?.userId}`);

    // Test 2: Authenticated click creation
    const authClickRes = await fetch(`${BASE_URL}/api/deals/${validDealId}/click`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userCookie,
      },
      body: JSON.stringify({ source: "deal_detail_btn" }),
    });
    const authClickData = await authClickRes.json();
    const authClickId = authClickData.clickId;
    const isAuthValid =
      authClickRes.status === 201 &&
      authClickData.success === true &&
      authClickId?.startsWith("clk_");
    record("Click_Creation", "2. Authenticated click creation returns 201", isAuthValid, `Click ID: ${authClickId}`);

    // Test 3: Correct server-side user attribution
    const authDbCheck = await pgClient.query('SELECT * FROM "AffiliateClick" WHERE "clickId" = $1', [authClickId]);
    const isAuthAttributed = authDbCheck.rows.length === 1 && authDbCheck.rows[0].userId === standardUserId;
    record("Click_Creation", "3. Correct server-side user attribution in DB", isAuthAttributed, `Attributed userId: ${authDbCheck.rows[0]?.userId}`);

    // Test 4: Client userId spoofing attempt
    const spoofUserRes = await fetch(`${BASE_URL}/api/deals/${validDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "spoof_attempt",
        userId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    record("Security", "4. Client userId spoofing rejected with 400 Bad Request", spoofUserRes.status === 400, `Status: ${spoofUserRes.status}`);

    // Test 5: Merchant ID spoofing attempt
    const spoofMerchRes = await fetch(`${BASE_URL}/api/deals/${validDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    record("Security", "5. Client merchantId spoofing rejected with 400 Bad Request", spoofMerchRes.status === 400, `Status: ${spoofMerchRes.status}`);

    // Test 6: Inactive deal rejection
    const inactDealRes = await fetch(`${BASE_URL}/api/deals/${inactiveDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    record("Validation", "6. Inactive deal click rejected with 400 (DEAL_INACTIVE)", inactDealRes.status === 400, `Status: ${inactDealRes.status}`);

    // Test 7: Expired deal rejection
    const expDealRes = await fetch(`${BASE_URL}/api/deals/${expiredDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    record("Validation", "7. Expired deal click rejected with 400 (DEAL_EXPIRED)", expDealRes.status === 400, `Status: ${expDealRes.status}`);

    // Test 8: Invalid deal ID rejection
    const invDealRes = await fetch(`${BASE_URL}/api/deals/00000000-0000-0000-0000-000000000000/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    record("Validation", "8. Invalid non-existent deal rejected with 404", invDealRes.status === 404, `Status: ${invDealRes.status}`);

    // =========================================================================
    // SECTION 2: SECURE REDIRECT ENGINE & OPEN REDIRECT PREVENTION
    // =========================================================================
    console.log("\n▶ Running Section 2: Secure Redirect Engine & Open Redirect Defense...");

    // Test 9: Unknown click ID
    const unkClickRes = await fetch(`${BASE_URL}/api/go/clk_000000000000000000000000000000000000000000000000`, {
      redirect: "manual",
    });
    record("Redirect", "9. Unknown click ID returns safe 404 Not Found", unkClickRes.status === 404, `Status: ${unkClickRes.status}`);

    // Test 10: Malformed click ID
    const malClickRes = await fetch(`${BASE_URL}/api/go/invalid-bad-format!!`, {
      redirect: "manual",
    });
    record("Redirect", "10. Malformed click ID returns safe 400 Bad Request", malClickRes.status === 400, `Status: ${malClickRes.status}`);

    // Test 11: Arbitrary redirect URL injection in query parameters
    const evilQueryRes = await fetch(`${BASE_URL}/api/go/${authClickId}?url=https://evil-phishing.com&dest=https://attacker.com`, {
      redirect: "manual",
    });
    const locHeader = evilQueryRes.headers.get("location");
    const isQueryIgnored =
      (evilQueryRes.status === 307 || evilQueryRes.status === 302) &&
      locHeader === approvedDestinationUrl &&
      !locHeader.includes("evil-phishing.com");
    record("Security", "11. Open redirect via query params strictly ignored (307 to approved URL)", isQueryIgnored, `Location: ${locHeader}`);

    // Check DB status updated to REDIRECTED
    const redirDbCheck = await pgClient.query('SELECT status FROM "AffiliateClick" WHERE "clickId" = $1', [authClickId]);
    record("Redirect", "11b. Click status updated to REDIRECTED in database", redirDbCheck.rows[0]?.status === "REDIRECTED", `Status: ${redirDbCheck.rows[0]?.status}`);

    // Test 12: javascript: URL rejection
    const jsClickRes = await fetch(`${BASE_URL}/api/deals/${dangerousDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    record("Security", "12. javascript: URL scheme rejected at click generation (400)", jsClickRes.status === 400, `Status: ${jsClickRes.status}`);

    // Direct DB injection test of dangerous URL into a click to verify redirect gate
    const dangerousClickId = `clk_danger_${runId}_${Math.random().toString(36).substring(2, 10)}`;
    await pgClient.query(
      `INSERT INTO "AffiliateClick" (id, "clickId", "dealId", "merchantId", "landingDestination", status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'javascript:alert(1)', 'TRACKED', NOW(), NOW())`,
      [dangerousClickId, validDealId, activeMerchantId]
    );
    const dangerGoRes = await fetch(`${BASE_URL}/api/go/${dangerousClickId}`, { redirect: "manual" });
    record("Security", "12b. javascript: URL destination rejected by redirect engine (400)", dangerGoRes.status === 400, `Status: ${dangerGoRes.status}`);

    // Test 13: data: URL rejection
    const dataClickId = `clk_data_${runId}_${Math.random().toString(36).substring(2, 10)}`;
    await pgClient.query(
      `INSERT INTO "AffiliateClick" (id, "clickId", "dealId", "merchantId", "landingDestination", status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'data:text/html,<script>alert(1)</script>', 'TRACKED', NOW(), NOW())`,
      [dataClickId, validDealId, activeMerchantId]
    );
    const dataGoRes = await fetch(`${BASE_URL}/api/go/${dataClickId}`, { redirect: "manual" });
    record("Security", "13. data: URL destination rejected by redirect engine (400)", dataGoRes.status === 400, `Status: ${dataGoRes.status}`);

    // Test 14: Host confusion attempts (control characters, backslashes)
    const hostConfClickId = `clk_hostconf_${runId}_${Math.random().toString(36).substring(2, 10)}`;
    await pgClient.query(
      `INSERT INTO "AffiliateClick" (id, "clickId", "dealId", "merchantId", "landingDestination", status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'https://legit.com\\evil.com', 'TRACKED', NOW(), NOW())`,
      [hostConfClickId, validDealId, activeMerchantId]
    );
    const hostConfGoRes = await fetch(`${BASE_URL}/api/go/${hostConfClickId}`, { redirect: "manual" });
    record("Security", "14. Host confusion / backslash URL rejected (400)", hostConfGoRes.status === 400, `Status: ${hostConfGoRes.status}`);

    // Test 15: Tracking ID tampering
    const tamperedClickId = authClickId.slice(0, -2) + "xx";
    const tamperedRes = await fetch(`${BASE_URL}/api/go/${tamperedClickId}`, { redirect: "manual" });
    record("Security", "15. Tampered tracking ID rejected with 404 Not Found", tamperedRes.status === 404, `Status: ${tamperedRes.status}`);

    // Test 21: Duplicate redirect handling
    const dupRedirRes = await fetch(`${BASE_URL}/api/go/${authClickId}`, { redirect: "manual" });
    const dupLocHeader = dupRedirRes.headers.get("location");
    const isDupHandled =
      (dupRedirRes.status === 307 || dupRedirRes.status === 302) &&
      dupLocHeader === approvedDestinationUrl;
    record("Idempotency", "21. Duplicate redirect handled cleanly (idempotent 307)", isDupHandled, `Status: ${dupRedirRes.status}`);

    // Test 25: Flipkart affiliate URL template {tid} replacement
    const fkClickRes = await fetch(`${BASE_URL}/api/deals/${flipkartDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "fk_banner" }),
    });
    const fkClickData = await fkClickRes.json();
    const fkClickId = fkClickData.clickId;
    const fkGoRes = await fetch(`${BASE_URL}/api/go/${fkClickId}`, { redirect: "manual" });
    const fkLocation = fkGoRes.headers.get("location");
    const expectedFkDestination = `https://www.flipkart.com/?affid=bh7162&affExtParam1=2010&affExtParam2=543212_136_${fkClickId}_source`;
    const isFkUrlValid =
      fkGoRes.status === 307 &&
      fkLocation === expectedFkDestination &&
      !fkLocation.includes("{tid}") &&
      fkLocation.includes(`543212_136_${fkClickId}_source`);
    record("Flipkart", "25. Flipkart {tid} template replaced server-side with clickId (307)", isFkUrlValid, `Location: ${fkLocation}`);

    // Test 26: Flipkart dl.flipkart.com deep-link format compatibility
    const fkDlClickRes = await fetch(`${BASE_URL}/api/deals/${flipkartDeepLinkDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "fk_app_deeplink" }),
    });
    const fkDlClickData = await fkDlClickRes.json();
    const fkDlClickId = fkDlClickData.clickId;
    const fkDlGoRes = await fetch(`${BASE_URL}/api/go/${fkDlClickId}`, { redirect: "manual" });
    const fkDlLocation = fkDlGoRes.headers.get("location");
    const expectedFkDlDestination = `https://dl.flipkart.com/dl/?affid=bh7162&affExtParam1=2010&affExtParam2=543212_136_${fkDlClickId}_source`;
    const isFkDlUrlValid =
      fkDlGoRes.status === 307 &&
      fkDlLocation === expectedFkDlDestination &&
      fkDlLocation.startsWith("https://dl.flipkart.com/dl/?");
    record("Flipkart", "26. Flipkart dl.flipkart.com deep-link preserved and formatted (307)", isFkDlUrlValid, `Location: ${fkDlLocation}`);

    // =========================================================================
    // SECTION 3: ADMIN ANALYTICS & RBAC
    // =========================================================================
    console.log("\n▶ Running Section 3: Admin Analytics & RBAC Security...");

    // Test 16: Unauthenticated admin analytics access
    const unauthAdminRes = await fetch(`${BASE_URL}/api/admin/affiliate-clicks`);
    record("RBAC", "16. Unauthenticated access to /api/admin/affiliate-clicks returns 401", unauthAdminRes.status === 401, `Status: ${unauthAdminRes.status}`);

    // Test 17: Standard USER admin analytics access
    const userAdminRes = await fetch(`${BASE_URL}/api/admin/affiliate-clicks`, {
      headers: { Cookie: userCookie },
    });
    record("RBAC", "17. Standard user access to /api/admin/affiliate-clicks returns 403 Forbidden", userAdminRes.status === 403, `Status: ${userAdminRes.status}`);

    // Test 18: ADMIN analytics access
    const adminListRes = await fetch(`${BASE_URL}/api/admin/affiliate-clicks`, {
      headers: { Cookie: adminCookie },
    });
    const adminListData = await adminListRes.json();
    const isAdminListOk =
      adminListRes.status === 200 &&
      adminListData.success === true &&
      Array.isArray(adminListData.clicks) &&
      typeof adminListData.pagination?.total === "number";
    record("RBAC", "18. ADMIN access to /api/admin/affiliate-clicks returns 200 and list", isAdminListOk, `Total clicks found: ${adminListData.pagination?.total}`);

    // Test 19: Pagination validation
    const badPageRes = await fetch(`${BASE_URL}/api/admin/affiliate-clicks?page=0`, {
      headers: { Cookie: adminCookie },
    });
    const badLimitRes = await fetch(`${BASE_URL}/api/admin/affiliate-clicks?limit=500`, {
      headers: { Cookie: adminCookie },
    });
    record("Validation", "19. Invalid pagination parameters rejected with 400", badPageRes.status === 400 && badLimitRes.status === 400, `Page=0: ${badPageRes.status}, Limit=500: ${badLimitRes.status}`);

    // Test 20: Merchant and deal analytics filtering
    const filterRes = await fetch(`${BASE_URL}/api/admin/affiliate-clicks?merchantId=${activeMerchantId}&dealId=${validDealId}`, {
      headers: { Cookie: adminCookie },
    });
    const filterData = await filterRes.json();
    const isFilteredOk =
      filterRes.status === 200 &&
      filterData.clicks.every((c) => c.merchantId === activeMerchantId && c.dealId === validDealId);
    record("Filtering", "20. Merchant & Deal analytics filtering returns exact matches", isFilteredOk, `Matching count: ${filterData.clicks?.length}`);

    // Test 22: Historical click record integrity (deal update / soft-delete)
    await pgClient.query('UPDATE "Deal" SET "isActive" = false, title = \'Archived Laptop Deal\' WHERE id = $1', [validDealId]);
    const histCheck = await pgClient.query('SELECT * FROM "AffiliateClick" WHERE "dealId" = $1', [validDealId]);
    const isHistIntact = histCheck.rows.length >= 2 && histCheck.rows.every((r) => r.dealId === validDealId);
    record("Integrity", "22. Historical click records preserved after deal soft-deactivation", isHistIntact, `Preserved clicks: ${histCheck.rows.length}`);

    // Test 23: No sensitive information in API responses
    const anonString = JSON.stringify(anonClickData);
    const adminString = JSON.stringify(adminListData);
    const hasSensitiveData =
      anonString.includes("passwordHash") ||
      anonString.includes("encryptedAccountNumber") ||
      adminString.includes("passwordHash") ||
      adminString.includes("encryptedAccountNumber");
    record("Privacy", "23. Zero sensitive credentials or tokens in API responses", !hasSensitiveData, `Safe payloads verified`);

    // Test 24: Admin Clicks Summary API
    const summaryRes = await fetch(`${BASE_URL}/api/admin/affiliate-clicks/summary?merchantId=${activeMerchantId}`, {
      headers: { Cookie: adminCookie },
    });
    const summaryData = await summaryRes.json();
    const isSummaryOk =
      summaryRes.status === 200 &&
      summaryData.success === true &&
      typeof summaryData.summary?.totalClicks === "number" &&
      typeof summaryData.summary?.redirectedClicks === "number" &&
      Array.isArray(summaryData.summary?.clicksByMerchant) &&
      Array.isArray(summaryData.summary?.dailyClicks);
    record("Analytics", "24. Admin Summary API returns aggregated distributions & counts", isSummaryOk, `Total: ${summaryData.summary?.totalClicks}, Redirected: ${summaryData.summary?.redirectedClicks}`);

    // =========================================================================
    // FINAL RESULTS SUMMARY
    // =========================================================================
    console.log("\n================================================================================");
    console.log("PHASE 5 TEST RESULTS SUMMARY:");
    console.log("================================================================================");
    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    console.log(`Passed: ${passedCount} / ${totalCount} (${Math.round((passedCount / totalCount) * 100)}%)\n`);

    if (passedCount !== totalCount) {
      console.error("Some Phase 5 tests failed!");
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution fatal error:", err);
    process.exit(1);
  } finally {
    await cleanupAll();
    await pgClient.end();
  }
}

runPhase5Tests();
