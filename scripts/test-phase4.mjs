/**
 * CashTon Phase 4: Deals & Coupons Management End-to-End HTTP & Database Test Suite
 * Comprehensive Functional, RBAC, Validation, Concurrency & Security Verification
 */

import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

async function runPhase4Tests() {
  console.log("================================================================================");
  console.log("CashTon Phase 4: Deals & Coupons Comprehensive End-to-End Test Suite");
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
  const testPrefix = `p4-${runId}`;
  const testUserEmail = `user-${testPrefix}@example.com`;
  const adminEmail = `admin-${testPrefix}@example.com`;
  const testPassword = "SecurePassword123!";
  const testMobile = `98765${Math.floor(10000 + Math.random() * 90000)}`;
  const adminMobile = `98766${Math.floor(10000 + Math.random() * 90000)}`;

  let userCookie = "";
  let adminCookie = "";
  let activeMerchantId = "";
  let inactiveMerchantId = "";
  let activeMerchantSlug = `merchant-active-${testPrefix}`;
  let inactiveMerchantSlug = `merchant-inactive-${testPrefix}`;

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
    // SECTION 0: SETUP USERS & MERCHANTS
    // =========================================================================
    console.log("\n▶ Running Section 0: Test Setup (Users, Sessions & Merchants)...");

    // 0.1 Register standard user
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
    record("Setup", "Register standard user account (201)", uRegRes.status === 201 && uRegData.success, `ID: ${uRegData.user?.id}`);

    // Log in standard user
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
    record("Setup", "Login standard user (session cookie)", uLoginRes.status === 200 && !!userCookie, `Cookie: ${!!userCookie}`);

    // 0.2 Register admin user
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
    const adminUserId = aRegData.user?.id;
    // Elevate role to ADMIN in database
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

    // 0.3 Seed Active & Inactive merchants directly in DB
    const mActiveRes = await pgClient.query(
      `INSERT INTO "Merchant" (id, name, slug, "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, true, NOW(), NOW())
       RETURNING id`,
      [`Active Merchant ${testPrefix}`, activeMerchantSlug]
    );
    activeMerchantId = mActiveRes.rows[0].id;

    const mInactiveRes = await pgClient.query(
      `INSERT INTO "Merchant" (id, name, slug, "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, false, NOW(), NOW())
       RETURNING id`,
      [`Inactive Merchant ${testPrefix}`, inactiveMerchantSlug]
    );
    inactiveMerchantId = mInactiveRes.rows[0].id;
    record("Setup", "Seed Active and Inactive merchants", !!activeMerchantId && !!inactiveMerchantId, `Active: ${activeMerchantId}, Inactive: ${inactiveMerchantId}`);

    // =========================================================================
    // SECTION 1: DEALS VALIDATION & ADMIN CRUD
    // =========================================================================
    console.log("\n▶ Running Section 1: Deals Validation, RBAC & Admin CRUD...");

    // 1.1 RBAC: Unauthenticated POST /api/admin/deals -> 401
    const unauthDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Unauth Deal",
        slug: `unauth-deal-${testPrefix}`,
      }),
    });
    record("Deals_RBAC", "Unauthenticated POST /api/admin/deals returns 401", unauthDealRes.status === 401, `Status: ${unauthDealRes.status}`);

    // 1.2 RBAC: Non-admin user POST /api/admin/deals -> 403
    const forbiddenDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Forbidden Deal",
        slug: `forbidden-deal-${testPrefix}`,
      }),
    });
    record("Deals_RBAC", "Non-admin user POST /api/admin/deals returns 403", forbiddenDealRes.status === 403, `Status: ${forbiddenDealRes.status}`);

    // 1.3 Validation: dealPrice > originalPrice rejected -> 400
    const invPriceRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Invalid Pricing Deal",
        slug: `inv-price-${testPrefix}`,
        originalPrice: 100,
        dealPrice: 150, // > originalPrice
      }),
    });
    const invPriceData = await invPriceRes.json();
    record("Deals_Val", "Reject dealPrice > originalPrice with 400", invPriceRes.status === 400, `Errors: ${JSON.stringify(invPriceData.errors || invPriceData.message)}`);

    // 1.4 Validation: endDate < startDate rejected -> 400
    const invDateRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Invalid Dates Deal",
        slug: `inv-dates-${testPrefix}`,
        startDate: "2026-12-31T00:00:00Z",
        endDate: "2026-01-01T00:00:00Z",
      }),
    });
    record("Deals_Val", "Reject endDate before startDate with 400", invDateRes.status === 400, `Status: ${invDateRes.status}`);

    // 1.5 Validation: Mass-assignment / unknown fields rejected -> 400
    const massDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Mass Injected Deal",
        slug: `mass-deal-${testPrefix}`,
        injectedRole: "SUPER_ADMIN",
      }),
    });
    record("Deals_Val", "Reject unknown mass-assignment fields with 400", massDealRes.status === 400, `Status: ${massDealRes.status}`);

    // 1.6 Non-existent merchantId -> 404
    const ghostMerchantDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: "00000000-0000-0000-0000-000000000000",
        title: "Ghost Merchant Deal",
        slug: `ghost-deal-${testPrefix}`,
      }),
    });
    record("Deals_Val", "Reject non-existent merchantId with 404", ghostMerchantDealRes.status === 404, `Status: ${ghostMerchantDealRes.status}`);

    // 1.7 Admin Create Valid Deal -> 201
    const createDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Valid Electronics Mega Deal ${testPrefix}`,
        slug: `mega-deal-${testPrefix}`,
        description: `Save big on top laptops and gadgets for ${testPrefix}`,
        originalPrice: 1000,
        dealPrice: 600,
        startDate: new Date(Date.now() - 3600000).toISOString(),
        endDate: new Date(Date.now() + 86400000 * 5).toISOString(),
        isActive: true,
      }),
    });
    const createDealData = await createDealRes.json();
    const createdDealId = createDealData.deal?.id;
    record("Deals_CRUD", "Admin creates valid deal -> 201 Created", createDealRes.status === 201 && !!createdDealId, `ID: ${createdDealId}, Slug: ${createDealData.deal?.slug}`);

    // 1.8 Unique slug constraint conflict -> 409 Conflict
    const dupDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Duplicate Slug Deal",
        slug: `mega-deal-${testPrefix}`, // duplicate slug
        originalPrice: 500,
        dealPrice: 300,
      }),
    });
    const dupDealData = await dupDealRes.json();
    record("Deals_CRUD", "Reject duplicate deal slug -> 409 Conflict", dupDealRes.status === 409 && dupDealData.message.includes("already exists"), `Status: ${dupDealRes.status}, Message: ${dupDealData.message}`);

    // 1.9 Admin GET deal by ID -> 200
    const adminGetDealRes = await fetch(`${BASE_URL}/api/admin/deals/${createdDealId}`, {
      headers: { Cookie: adminCookie },
    });
    const adminGetDealData = await adminGetDealRes.json();
    record("Deals_CRUD", "Admin GET /api/admin/deals/[id] -> 200", adminGetDealRes.status === 200 && adminGetDealData.deal?.id === createdDealId, `Retrieved Title: ${adminGetDealData.deal?.title}`);

    // 1.10 Admin PATCH deal: cross-field price check against existing originalPrice (400)
    const patchInvPriceRes = await fetch(`${BASE_URL}/api/admin/deals/${createdDealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ dealPrice: 1200 }), // originalPrice in DB is 1000
    });
    record("Deals_CRUD", "PATCH deal price > existing originalPrice rejected with 400", patchInvPriceRes.status === 400, `Status: ${patchInvPriceRes.status}`);

    // 1.11 Admin PATCH deal: valid update -> 200
    const patchDealRes = await fetch(`${BASE_URL}/api/admin/deals/${createdDealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        title: "Updated Electronics Mega Deal",
        dealPrice: 550,
      }),
    });
    const patchDealData = await patchDealRes.json();
    record("Deals_CRUD", "Admin PATCH deal -> 200 OK", patchDealRes.status === 200 && Number(patchDealData.deal?.dealPrice) === 550, `New title: ${patchDealData.deal?.title}, New dealPrice: ${patchDealData.deal?.dealPrice}`);

    // 1.12 Admin DELETE deal: soft-deactivate -> 200
    const deleteDealRes = await fetch(`${BASE_URL}/api/admin/deals/${createdDealId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    const deleteDealData = await deleteDealRes.json();
    const dbCheckDeal = await pgClient.query('SELECT "isActive" FROM "Deal" WHERE id = $1', [createdDealId]);
    record("Deals_CRUD", "Admin DELETE deal performs soft-deactivation (isActive=false, preserved in DB)", deleteDealRes.status === 200 && deleteDealData.deal?.isActive === false && dbCheckDeal.rows[0]?.isActive === false, `Preserved in DB: ${dbCheckDeal.rows.length === 1}, isActive: ${dbCheckDeal.rows[0]?.isActive}`);

    // Re-activate deal for public visibility testing in Section 3
    await pgClient.query('UPDATE "Deal" SET "isActive" = true WHERE id = $1', [createdDealId]);

    // =========================================================================
    // SECTION 2: COUPONS VALIDATION & ADMIN CRUD
    // =========================================================================
    console.log("\n▶ Running Section 2: Coupons Validation, RBAC & Admin CRUD...");

    // 2.1 RBAC: Unauthenticated POST /api/admin/coupons -> 401
    const unauthCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Unauth Coupon",
        code: "UNAUTH10",
        discountType: "PERCENTAGE",
        discountValue: 10,
      }),
    });
    record("Coupons_RBAC", "Unauthenticated POST /api/admin/coupons returns 401", unauthCoupRes.status === 401, `Status: ${unauthCoupRes.status}`);

    // 2.2 RBAC: Non-admin user POST /api/admin/coupons -> 403
    const forbiddenCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Forbidden Coupon",
        code: "FORBID10",
        discountType: "PERCENTAGE",
        discountValue: 10,
      }),
    });
    record("Coupons_RBAC", "Non-admin user POST /api/admin/coupons returns 403", forbiddenCoupRes.status === 403, `Status: ${forbiddenCoupRes.status}`);

    // 2.3 Validation: Percentage discount > 100 or <= 0 rejected -> 400
    const invPercentCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Invalid Percent Coupon",
        code: "OVER100",
        discountType: "PERCENTAGE",
        discountValue: 120, // > 100
      }),
    });
    record("Coupons_Val", "Reject percentage discount > 100 with 400", invPercentCoupRes.status === 400, `Status: ${invPercentCoupRes.status}`);

    // 2.4 Validation: Fixed discount <= 0 rejected -> 400
    const invFixedCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Invalid Fixed Coupon",
        code: "ZEROFIXED",
        discountType: "FIXED",
        discountValue: 0,
      }),
    });
    record("Coupons_Val", "Reject fixed discount <= 0 with 400", invFixedCoupRes.status === 400, `Status: ${invFixedCoupRes.status}`);

    // 2.5 Validation: usageLimit < 1 rejected -> 400
    const invUsageCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Invalid Usage Coupon",
        code: "ZEROUSAGE",
        discountType: "FIXED",
        discountValue: 50,
        usageLimit: 0,
      }),
    });
    record("Coupons_Val", "Reject usageLimit < 1 with 400", invUsageCoupRes.status === 400, `Status: ${invUsageCoupRes.status}`);

    // 2.6 Validation: Mass assignment / unknown fields rejected -> 400
    const massCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Mass Injected Coupon",
        code: "MASSC",
        discountType: "FIXED",
        discountValue: 50,
        hackedRole: "ADMIN",
      }),
    });
    record("Coupons_Val", "Reject unknown mass-assignment fields with 400", massCoupRes.status === 400, `Status: ${massCoupRes.status}`);

    // 2.7 Admin Create Valid Coupon -> 201
    const createCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Flat 200 Off Coupon ${testPrefix}`,
        code: `save200`, // Should normalize to upper SAVE200
        description: `Save 200 on all orders above 1000 for ${testPrefix}`,
        discountType: "FIXED",
        discountValue: 200,
        minimumPurchase: 1000,
        startDate: new Date(Date.now() - 3600000).toISOString(),
        endDate: new Date(Date.now() + 86400000 * 5).toISOString(),
        isActive: true,
      }),
    });
    const createCoupData = await createCoupRes.json();
    const createdCouponId = createCoupData.coupon?.id;
    record("Coupons_CRUD", "Admin creates valid coupon with uppercase normalization -> 201", createCoupRes.status === 201 && createCoupData.coupon?.code === "SAVE200", `ID: ${createdCouponId}, Code: ${createCoupData.coupon?.code}`);

    // 2.8 Duplicate coupon code for same merchant -> 409 Conflict
    const dupCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: "Duplicate Code Coupon",
        code: "SAVE200",
        discountType: "FIXED",
        discountValue: 100,
      }),
    });
    const dupCoupData = await dupCoupRes.json();
    record("Coupons_CRUD", "Reject duplicate coupon code for same merchant -> 409 Conflict", dupCoupRes.status === 409 && dupCoupData.message.includes("already exists"), `Status: ${dupCoupRes.status}, Message: ${dupCoupData.message}`);

    // 2.9 Same coupon code for DIFFERENT merchant is PERMITTED -> 201
    const diffMerchantCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: inactiveMerchantId,
        title: `Same Code Other Merchant ${testPrefix}`,
        code: "SAVE200",
        description: `Other merchant coupon for ${testPrefix}`,
        discountType: "FIXED",
        discountValue: 150,
      }),
    });
    const diffMerchantCoupData = await diffMerchantCoupRes.json();
    record("Coupons_CRUD", "Allow same code across distinct merchants -> 201 Created", diffMerchantCoupRes.status === 201 && !!diffMerchantCoupData.coupon?.id, `Other Merchant Coupon ID: ${diffMerchantCoupData.coupon?.id}`);

    // 2.10 Admin GET coupon by ID -> 200
    const adminGetCoupRes = await fetch(`${BASE_URL}/api/admin/coupons/${createdCouponId}`, {
      headers: { Cookie: adminCookie },
    });
    const adminGetCoupData = await adminGetCoupRes.json();
    record("Coupons_CRUD", "Admin GET /api/admin/coupons/[id] -> 200", adminGetCoupRes.status === 200 && adminGetCoupData.coupon?.id === createdCouponId, `Retrieved Title: ${adminGetCoupData.coupon?.title}`);

    // 2.11 Admin PATCH coupon: cross-field percentage validation (400)
    const patchInvCoupRes = await fetch(`${BASE_URL}/api/admin/coupons/${createdCouponId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        discountType: "PERCENTAGE",
        discountValue: 150, // > 100
      }),
    });
    record("Coupons_CRUD", "PATCH invalid percentage (> 100) rejected with 400", patchInvCoupRes.status === 400, `Status: ${patchInvCoupRes.status}`);

    // 2.12 Admin PATCH coupon: valid update -> 200
    const patchCoupRes = await fetch(`${BASE_URL}/api/admin/coupons/${createdCouponId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        title: "Updated Flat 250 Off Coupon",
        discountValue: 250,
      }),
    });
    const patchCoupData = await patchCoupRes.json();
    record("Coupons_CRUD", "Admin PATCH coupon -> 200 OK", patchCoupRes.status === 200 && Number(patchCoupData.coupon?.discountValue) === 250, `New title: ${patchCoupData.coupon?.title}, New value: ${patchCoupData.coupon?.discountValue}`);

    // 2.13 Admin DELETE coupon: soft-deactivate -> 200
    const deleteCoupRes = await fetch(`${BASE_URL}/api/admin/coupons/${createdCouponId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    const deleteCoupData = await deleteCoupRes.json();
    const dbCheckCoup = await pgClient.query('SELECT "isActive" FROM "Coupon" WHERE id = $1', [createdCouponId]);
    record("Coupons_CRUD", "Admin DELETE coupon performs soft-deactivation (isActive=false, preserved in DB)", deleteCoupRes.status === 200 && deleteCoupData.coupon?.isActive === false && dbCheckCoup.rows[0]?.isActive === false, `Preserved in DB: ${dbCheckCoup.rows.length === 1}, isActive: ${dbCheckCoup.rows[0]?.isActive}`);

    // Re-activate coupon for public visibility testing in Section 3
    await pgClient.query('UPDATE "Coupon" SET "isActive" = true WHERE id = $1', [createdCouponId]);

    // =========================================================================
    // SECTION 3: PUBLIC VISIBILITY & FILTERING BUSINESS RULES
    // =========================================================================
    console.log("\n▶ Running Section 3: Public Offers Visibility & Business Logic...");

    const pastDate = new Date(Date.now() - 86400000 * 10).toISOString();
    const pastEndDate = new Date(Date.now() - 86400000 * 2).toISOString();
    const futureDate = new Date(Date.now() + 86400000 * 2).toISOString();
    const futureEndDate = new Date(Date.now() + 86400000 * 10).toISOString();

    // Seed expired, future, inactive deals
    const expDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Expired Deal ${testPrefix}`,
        slug: `expired-deal-${testPrefix}`,
        startDate: pastDate,
        endDate: pastEndDate,
        isActive: true,
      }),
    });
    const expDealData = await expDealRes.json();

    const futDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Future Deal ${testPrefix}`,
        slug: `future-deal-${testPrefix}`,
        startDate: futureDate,
        endDate: futureEndDate,
        isActive: true,
      }),
    });
    const futDealData = await futDealRes.json();

    const inactDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Inactive Deal ${testPrefix}`,
        slug: `inactive-deal-${testPrefix}`,
        isActive: false,
      }),
    });
    const inactDealData = await inactDealRes.json();

    const inactMerchDealRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: inactiveMerchantId,
        title: `Inactive Merchant Deal ${testPrefix}`,
        slug: `inactive-merch-deal-${testPrefix}`,
        isActive: true,
      }),
    });
    const inactMerchDealData = await inactMerchDealRes.json();

    // 3.1 Public GET /api/deals
    const pubDealsRes = await fetch(`${BASE_URL}/api/deals?search=${testPrefix}&limit=50`);
    const pubDealsData = await pubDealsRes.json();
    const pubSlugs = (pubDealsData.deals || []).map((d) => d.slug);

    const hasActiveDeal = pubSlugs.includes(`mega-deal-${testPrefix}`);
    const excludesExpiredDeal = !pubSlugs.includes(`expired-deal-${testPrefix}`);
    const excludesFutureDeal = !pubSlugs.includes(`future-deal-${testPrefix}`);
    const excludesInactiveDeal = !pubSlugs.includes(`inactive-deal-${testPrefix}`);
    const excludesInactiveMerchDeal = !pubSlugs.includes(`inactive-merch-deal-${testPrefix}`);

    record(
      "Public_Vis",
      "Public GET /api/deals suppresses expired, future, inactive & inactive merchant deals",
      pubDealsRes.status === 200 &&
        hasActiveDeal &&
        excludesExpiredDeal &&
        excludesFutureDeal &&
        excludesInactiveDeal &&
        excludesInactiveMerchDeal,
      `Active: ${hasActiveDeal}, Expired hidden: ${excludesExpiredDeal}, Future hidden: ${excludesFutureDeal}, Inactive hidden: ${excludesInactiveDeal}, Inactive Merchant hidden: ${excludesInactiveMerchDeal}`
    );

    // 3.2 Public GET /api/deals/[slug]: 404 for expired/future/inactive/inactive merchant
    const sActiveRes = await fetch(`${BASE_URL}/api/deals/mega-deal-${testPrefix}`);
    const sExpiredRes = await fetch(`${BASE_URL}/api/deals/expired-deal-${testPrefix}`);
    const sFutureRes = await fetch(`${BASE_URL}/api/deals/future-deal-${testPrefix}`);
    const sInactiveRes = await fetch(`${BASE_URL}/api/deals/inactive-deal-${testPrefix}`);
    const sInactiveMerchRes = await fetch(`${BASE_URL}/api/deals/inactive-merch-deal-${testPrefix}`);

    record(
      "Public_Vis",
      "Public GET /api/deals/[slug] returns 404 for expired, future, inactive or inactive-merchant deals",
      sActiveRes.status === 200 &&
        sExpiredRes.status === 404 &&
        sFutureRes.status === 404 &&
        sInactiveRes.status === 404 &&
        sInactiveMerchRes.status === 404,
      `Active: ${sActiveRes.status}, Expired: ${sExpiredRes.status}, Future: ${sFutureRes.status}, Inactive: ${sInactiveRes.status}, Inactive Merch: ${sInactiveMerchRes.status}`
    );

    // Seed expired, future, inactive coupons
    const expCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Expired Coupon ${testPrefix}`,
        code: `EXP${runId.toString().slice(-4)}`,
        discountType: "FIXED",
        discountValue: 50,
        startDate: pastDate,
        endDate: pastEndDate,
        isActive: true,
      }),
    });
    const expCoupData = await expCoupRes.json();

    const futCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Future Coupon ${testPrefix}`,
        code: `FUT${runId.toString().slice(-4)}`,
        discountType: "FIXED",
        discountValue: 50,
        startDate: futureDate,
        endDate: futureEndDate,
        isActive: true,
      }),
    });
    const futCoupData = await futCoupRes.json();

    const inactCoupRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Inactive Coupon ${testPrefix}`,
        code: `INA${runId.toString().slice(-4)}`,
        discountType: "FIXED",
        discountValue: 50,
        isActive: false,
      }),
    });
    const inactCoupData = await inactCoupRes.json();

    // 3.3 Public GET /api/coupons
    const pubCoupsRes = await fetch(`${BASE_URL}/api/coupons?search=${testPrefix}&limit=50`);
    const pubCoupsData = await pubCoupsRes.json();
    const pubIds = (pubCoupsData.coupons || []).map((c) => c.id);

    const hasActiveCoup = pubIds.includes(createdCouponId);
    const excludesExpiredCoup = !pubIds.includes(expCoupData.coupon?.id);
    const excludesFutureCoup = !pubIds.includes(futCoupData.coupon?.id);
    const excludesInactiveCoup = !pubIds.includes(inactCoupData.coupon?.id);
    const excludesInactiveMerchCoup = !pubIds.includes(diffMerchantCoupData.coupon?.id);

    record(
      "Public_Vis",
      "Public GET /api/coupons suppresses expired, future, inactive & inactive merchant coupons",
      pubCoupsRes.status === 200 &&
        hasActiveCoup &&
        excludesExpiredCoup &&
        excludesFutureCoup &&
        excludesInactiveCoup &&
        excludesInactiveMerchCoup,
      `Active: ${hasActiveCoup}, Expired hidden: ${excludesExpiredCoup}, Future hidden: ${excludesFutureCoup}, Inactive hidden: ${excludesInactiveCoup}, Inactive Merch hidden: ${excludesInactiveMerchCoup}`
    );

    // 3.4 Public GET /api/coupons/[id]: 404 for expired/future/inactive/inactive merchant
    const cActiveRes = await fetch(`${BASE_URL}/api/coupons/${createdCouponId}`);
    const cExpiredRes = await fetch(`${BASE_URL}/api/coupons/${expCoupData.coupon?.id}`);
    const cFutureRes = await fetch(`${BASE_URL}/api/coupons/${futCoupData.coupon?.id}`);
    const cInactiveRes = await fetch(`${BASE_URL}/api/coupons/${inactCoupData.coupon?.id}`);
    const cInactiveMerchRes = await fetch(`${BASE_URL}/api/coupons/${diffMerchantCoupData.coupon?.id}`);

    record(
      "Public_Vis",
      "Public GET /api/coupons/[id] returns 404 for expired, future, inactive or inactive-merchant coupons",
      cActiveRes.status === 200 &&
        cExpiredRes.status === 404 &&
        cFutureRes.status === 404 &&
        cInactiveRes.status === 404 &&
        cInactiveMerchRes.status === 404,
      `Active: ${cActiveRes.status}, Expired: ${cExpiredRes.status}, Future: ${cFutureRes.status}, Inactive: ${cInactiveRes.status}, Inactive Merch: ${cInactiveMerchRes.status}`
    );

    // =========================================================================
    // SECTION 4: ADMIN COMPLETE VISIBILITY
    // =========================================================================
    console.log("\n▶ Running Section 4: Admin Full Oversight Verification...");

    // 4.1 Admin GET /api/admin/deals sees all offers
    const admDealsListRes = await fetch(`${BASE_URL}/api/admin/deals?search=${testPrefix}&limit=50`, {
      headers: { Cookie: adminCookie },
    });
    const admDealsListData = await admDealsListRes.json();
    const admDealIds = (admDealsListData.deals || []).map((d) => d.id);

    const adminSeesAllDeals =
      admDealIds.includes(createdDealId) &&
      admDealIds.includes(expDealData.deal?.id) &&
      admDealIds.includes(futDealData.deal?.id) &&
      admDealIds.includes(inactDealData.deal?.id) &&
      admDealIds.includes(inactMerchDealData.deal?.id);

    record("Admin_Oversight", "Admin GET /api/admin/deals sees ALL deals (active, inactive, expired, future)", admDealsListRes.status === 200 && adminSeesAllDeals, `Admin saw ${admDealIds.length} deals in test scope`);

    // 4.2 Admin GET /api/admin/coupons sees all offers
    const admCoupsListRes = await fetch(`${BASE_URL}/api/admin/coupons?search=${testPrefix}&limit=50`, {
      headers: { Cookie: adminCookie },
    });
    const admCoupsListData = await admCoupsListRes.json();
    const admCoupIds = (admCoupsListData.coupons || []).map((c) => c.id);

    const adminSeesAllCoups =
      admCoupIds.includes(createdCouponId) &&
      admCoupIds.includes(expCoupData.coupon?.id) &&
      admCoupIds.includes(futCoupData.coupon?.id) &&
      admCoupIds.includes(inactCoupData.coupon?.id) &&
      admCoupIds.includes(diffMerchantCoupData.coupon?.id);

    record("Admin_Oversight", "Admin GET /api/admin/coupons sees ALL coupons (active, inactive, expired, future)", admCoupsListRes.status === 200 && adminSeesAllCoups, `Admin saw ${admCoupIds.length} coupons in test scope`);

    // 4.3 Admin direct GET by ID works for inactive / expired offers
    const admGetInactDeal = await fetch(`${BASE_URL}/api/admin/deals/${inactDealData.deal?.id}`, {
      headers: { Cookie: adminCookie },
    });
    const admGetInactCoup = await fetch(`${BASE_URL}/api/admin/coupons/${inactCoupData.coupon?.id}`, {
      headers: { Cookie: adminCookie },
    });
    record("Admin_Oversight", "Admin GET /api/admin/*/[id] retrieves inactive & expired records (200)", admGetInactDeal.status === 200 && admGetInactCoup.status === 200, `Deal: ${admGetInactDeal.status}, Coupon: ${admGetInactCoup.status}`);

  } catch (err) {
    console.error("Test execution fatal error:", err);
    record("ERROR", "Execution failure", false, err.message);
  } finally {
    await cleanupAll();
    await pgClient.end();
  }

  console.log("\n================================================================================");
  console.log("TEST RESULTS BREAKDOWN:");
  console.log("================================================================================");
  let passedCount = 0;
  for (const r of results) {
    if (r.passed) passedCount++;
  }
  console.log(`Passed: ${passedCount} / ${results.length}`);
  console.log("================================================================================\n");

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runPhase4Tests().catch((e) => {
  console.error(e);
  process.exit(1);
});
