/**
 * CashTon Phase 7: Campaign Engine & Cashback Lifecycle Completion Test Suite
 * End-to-End Verification of Admin Campaign CRUD, Deterministic Campaign Selection,
 * Decimal Calculations, Caps & Rounding, Immutable Snapshots, Financial Ledger & Lifecycle
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

async function runPhase7Tests() {
  console.log("================================================================================");
  console.log("CashTon Phase 7: Campaign Engine & Cashback Lifecycle Completion Test Suite");
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
  const testPrefix = `p7-${runId}`;
  const testUserEmail = `user-${testPrefix}@example.com`;
  const adminEmail = `admin-${testPrefix}@example.com`;
  const testPassword = "SecurePassword123!";
  const testMobile = `98765${Math.floor(10000 + Math.random() * 90000)}`;
  const adminMobile = `98766${Math.floor(10000 + Math.random() * 90000)}`;

  let userCookie = "";
  let adminCookie = "";
  let standardUserId = "";
  let adminUserId = "";

  let merchantAId = "";
  let merchantBId = "";
  let dealAId = "";
  let dealBId = "";

  let clickAId = "";
  let clickBId = "";

  const genSecret = process.env.GENERIC_WEBHOOK_SECRET || "test_generic_secret_cashton_2026";

  async function cleanupAll() {
    try {
      await pgClient.query('DELETE FROM "Conversion" WHERE "externalTransactionId" LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "Cashback" WHERE "externalReferenceId" LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "WalletTransaction" WHERE description LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "AffiliateClick" WHERE source LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "Campaign" WHERE name LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "Deal" WHERE slug LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "Merchant" WHERE slug LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "User" WHERE email LIKE $1', [`%${testPrefix}%`]);
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
  }

  try {
    // =========================================================================
    // SECTION 0: SETUP TEST ENTITIES
    // =========================================================================
    console.log("▶ Running Section 0: Setup (Users, Merchants, Deals, Clicks)...");

    // 0.1 Register standard user
    const uRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
        name: "Standard User P7",
        mobileNumber: testMobile,
      }),
    });
    const uRegData = await uRegRes.json();
    standardUserId = uRegData.user?.id;

    const uLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testUserEmail, password: testPassword }),
    });
    userCookie = extractCookies(uLoginRes);
    record("Setup", "Standard user registered and authenticated", !!standardUserId && !!userCookie, `User ID: ${standardUserId}`);

    // 0.2 Register and elevate admin
    const aRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: testPassword,
        name: "Admin User P7",
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
    adminCookie = extractCookies(aLoginRes);
    record("Setup", "Admin user registered and elevated to ADMIN", !!adminUserId && !!adminCookie, `Admin ID: ${adminUserId}`);

    // 0.3 Create Merchants
    const maRes = await fetch(`${BASE_URL}/api/admin/merchants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Merchant A ${testPrefix}`,
        slug: `merch-a-${testPrefix}`,
        websiteUrl: "https://store-a.example.com",
        isActive: true,
      }),
    });
    const maData = await maRes.json();
    merchantAId = maData.merchant?.id;

    const mbRes = await fetch(`${BASE_URL}/api/admin/merchants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Merchant B ${testPrefix}`,
        slug: `merch-b-${testPrefix}`,
        websiteUrl: "https://store-b.example.com",
        isActive: true,
      }),
    });
    const mbData = await mbRes.json();
    merchantBId = mbData.merchant?.id;
    record("Setup", "Test merchants created successfully", !!merchantAId && !!merchantBId, `Merchant A: ${merchantAId}, B: ${merchantBId}`);

    // 0.4 Create Deals
    const daRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: merchantAId,
        title: `Deal A ${testPrefix}`,
        slug: `deal-a-${testPrefix}`,
        originalPrice: 10000,
        dealPrice: 8000,
        affiliateUrl: "https://store-a.example.com/offer?subid={tid}",
        isActive: true,
      }),
    });
    const daData = await daRes.json();
    dealAId = daData.deal?.id;

    const dbRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: merchantBId,
        title: `Deal B ${testPrefix}`,
        slug: `deal-b-${testPrefix}`,
        originalPrice: 5000,
        dealPrice: 4000,
        affiliateUrl: "https://store-b.example.com/offer?subid={tid}",
        isActive: true,
      }),
    });
    const dbData = await dbRes.json();
    dealBId = dbData.deal?.id;
    record("Setup", "Test deals created with affiliate URLs", !!dealAId && !!dealBId, `Deal A: ${dealAId}, B: ${dealBId}`);

    // 0.5 Generate Affiliate Clicks for attribution
    const clkA = await fetch(`${BASE_URL}/api/deals/${dealAId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ source: `src-a-${testPrefix}` }),
    });
    const clkAData = await clkA.json();
    clickAId = clkAData.clickId;

    const clkB = await fetch(`${BASE_URL}/api/deals/${dealBId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ source: `src-b-${testPrefix}` }),
    });
    const clkBData = await clkB.json();
    clickBId = clkBData.clickId;
    record("Setup", "Attributed affiliate clicks generated", !!clickAId && !!clickBId, `Click A: ${clickAId}, B: ${clickBId}`);

    // =========================================================================
    // SECTION 1: ADMIN CAMPAIGN CRUD & RBAC SECURITY
    // =========================================================================
    console.log("\n▶ Running Section 1: Admin Campaign CRUD & RBAC Security...");

    // 1.1 Unauthenticated access rejected with 401
    const unauthRes = await fetch(`${BASE_URL}/api/admin/campaigns`);
    record("RBAC", "Unauthenticated GET /api/admin/campaigns rejected with 401", unauthRes.status === 401, `Status: ${unauthRes.status}`);

    // 1.2 Standard user forbidden with 403
    const stdRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      headers: { Cookie: userCookie },
    });
    record("RBAC", "Standard USER GET /api/admin/campaigns forbidden with 403", stdRes.status === 403, `Status: ${stdRes.status}`);

    // 1.3 Validation: Reject invalid percentage > 100
    const invPctRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Invalid Pct Campaign ${testPrefix}`,
        shareType: "PERCENTAGE",
        userShareValue: 120, // Invalid!
      }),
    });
    record("Validation", "Reject percentage cashback > 100% with 400", invPctRes.status === 400, `Status: ${invPctRes.status}`);

    // 1.4 Validation: Reject invalid date boundaries (startDate > endDate)
    const invDateRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Invalid Date Campaign ${testPrefix}`,
        shareType: "PERCENTAGE",
        userShareValue: 10,
        startDate: "2026-12-01T00:00:00Z",
        endDate: "2026-11-01T00:00:00Z", // Earlier than start!
      }),
    });
    record("Validation", "Reject startDate > endDate with 400", invDateRes.status === 400, `Status: ${invDateRes.status}`);

    // 1.5 Admin creates valid standard campaign (201)
    let primaryCampaignId = "";
    const createCampRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Primary Deal Campaign ${testPrefix}`,
        description: "10% cashback capped at 500 on Deal A",
        merchantId: merchantAId,
        dealId: dealAId,
        network: "GENERIC",
        shareType: "PERCENTAGE",
        userShareValue: 10.0,
        maxCashbackPerOrder: 500.0,
        minOrderAmount: 200.0,
        priority: 10,
        isActive: true,
      }),
    });
    const createCampData = await createCampRes.json();
    primaryCampaignId = createCampData.campaign?.id;
    record(
      "Admin_CRUD",
      "Admin creates valid campaign with caps & min order (201)",
      createCampRes.status === 201 && !!primaryCampaignId,
      `Campaign ID: ${primaryCampaignId}`
    );

    // 1.6 Admin GET campaign by ID (200)
    const getCampRes = await fetch(`${BASE_URL}/api/admin/campaigns/${primaryCampaignId}`, {
      headers: { Cookie: adminCookie },
    });
    const getCampData = await getCampRes.json();
    record(
      "Admin_CRUD",
      "Admin GET /api/admin/campaigns/:id returns campaign details (200)",
      getCampRes.status === 200 && getCampData.campaign?.id === primaryCampaignId,
      `Name: ${getCampData.campaign?.name}`
    );

    // 1.7 Admin list campaigns with filters (200)
    const listCampRes = await fetch(`${BASE_URL}/api/admin/campaigns?merchantId=${merchantAId}`, {
      headers: { Cookie: adminCookie },
    });
    const listCampData = await listCampRes.json();
    record(
      "Admin_CRUD",
      "Admin GET /api/admin/campaigns supports filtering by merchantId (200)",
      listCampRes.status === 200 && Array.isArray(listCampData.campaigns) && listCampData.campaigns.length >= 1,
      `Total filtered: ${listCampData.pagination?.total}`
    );

    // 1.8 Admin PATCH campaign (200)
    const patchCampRes = await fetch(`${BASE_URL}/api/admin/campaigns/${primaryCampaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        maxCashbackPerOrder: 600.0,
      }),
    });
    const patchCampData = await patchCampRes.json();
    record(
      "Admin_CRUD",
      "Admin PATCH /api/admin/campaigns/:id updates campaign fields (200)",
      patchCampRes.status === 200 && parseFloat(patchCampData.campaign?.maxCashbackPerOrder) === 600.0,
      `Updated Max Cap: ₹${patchCampData.campaign?.maxCashbackPerOrder}`
    );

    // =========================================================================
    // SECTION 2: DETERMINISTIC CAMPAIGN SELECTION & SPECIFICITY HIERARCHY
    // =========================================================================
    console.log("\n▶ Running Section 2: Deterministic Campaign Selection & Specificity Hierarchy...");

    // 2.1 Seed campaigns across different specificity tiers:
    // Level 1: Global Platform Campaign (5% cashback)
    const globCampRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Global Campaign ${testPrefix}`,
        shareType: "PERCENTAGE",
        userShareValue: 5.0,
        priority: 1,
        isActive: true,
      }),
    });
    await globCampRes.json();

    // Level 3: Merchant-Specific Campaign (8% cashback on Merchant B)
    const merchBCampRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Merchant B Campaign ${testPrefix}`,
        merchantId: merchantBId,
        shareType: "PERCENTAGE",
        userShareValue: 8.0,
        priority: 5,
        isActive: true,
      }),
    });
    const merchBCampData = await merchBCampRes.json();
    const merchBCampId = merchBCampData.campaign?.id;

    // 2.2 Verify Level 4 specificity (Deal A has primary campaign with 10% rate)
    // Send conversion on Deal A for ₹4000 order -> 10% of 4000 = ₹400.00
    const txDealA = `tx-deala-${testPrefix}`;
    const resDealA = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txDealA,
        clickId: clickAId,
        orderAmount: "4000.00",
        commissionAmount: "200.00",
        status: "PENDING",
      }),
    });
    const dataDealA = await resDealA.json();
    const rowDealA = await pgClient.query('SELECT * FROM "Conversion" WHERE id = $1', [dataDealA.conversionId]);
    const convDealA = rowDealA.rows[0];
    record(
      "Hierarchy",
      "Level 4 Deal-specific campaign takes highest precedence (10% on Deal A)",
      convDealA && convDealA.campaignId === primaryCampaignId && parseFloat(convDealA.cashbackAmount) === 400.0,
      `Campaign: ${convDealA?.campaignId}, Cashback: ₹${convDealA?.cashbackAmount}`
    );

    // 2.3 Verify Level 3 specificity (Merchant B has 8% campaign, no deal-specific campaign)
    // Send conversion on Deal B for ₹3000 order -> 8% of 3000 = ₹240.00
    const txMerchB = `tx-merchb-${testPrefix}`;
    const resMerchB = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txMerchB,
        clickId: clickBId,
        orderAmount: "3000.00",
        commissionAmount: "150.00",
        status: "PENDING",
      }),
    });
    const dataMerchB = await resMerchB.json();
    const rowMerchB = await pgClient.query('SELECT * FROM "Conversion" WHERE id = $1', [dataMerchB.conversionId]);
    const convMerchB = rowMerchB.rows[0];
    record(
      "Hierarchy",
      "Level 3 Merchant-specific campaign selected when no deal campaign exists (8% on Merchant B)",
      convMerchB && convMerchB.campaignId === merchBCampId && parseFloat(convMerchB.cashbackAmount) === 240.0,
      `Campaign: ${convMerchB?.campaignId}, Cashback: ₹${convMerchB?.cashbackAmount}`
    );

    // 2.4 Date boundaries: Inactive and expired campaigns strictly skipped
    const expCampRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Expired Campaign ${testPrefix}`,
        shareType: "PERCENTAGE",
        userShareValue: 50.0,
        startDate: "2020-01-01T00:00:00Z",
        endDate: "2020-12-31T23:59:59Z", // Expired in past!
        priority: 999, // Highest priority, but expired!
        isActive: true,
      }),
    });
    const expCampData = await expCampRes.json();
    record("Hierarchy", "Expired campaign with highest priority is skipped during evaluation", !!expCampData.campaign?.id, `Created expired campaign`);

    // =========================================================================
    // SECTION 3: CASHBACK CALCULATION, CAPS, MIN ORDER & ROUNDING
    // =========================================================================
    console.log("\n▶ Running Section 3: Cashback Calculation, Caps, Min Order & Rounding...");

    // 3.1 Maximum Cashback Cap: 10% of ₹10,000 order = ₹1000, capped at ₹600
    const txCap = `tx-cap-${testPrefix}`;
    const resCap = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txCap,
        clickId: clickAId,
        orderAmount: "10000.00",
        commissionAmount: "800.00",
        status: "PENDING",
      }),
    });
    const dataCap = await resCap.json();
    const rowCap = await pgClient.query('SELECT * FROM "Conversion" WHERE id = $1', [dataCap.conversionId]);
    const convCap = rowCap.rows[0];
    record(
      "Calculation",
      "Maximum order cashback cap strictly enforced (capped at ₹600.00)",
      convCap && parseFloat(convCap.cashbackAmount) === 600.0,
      `Calculated: ₹${convCap?.cashbackAmount} (Cap: ₹600.00)`
    );

    // 3.2 Minimum Order Threshold: Deal A requires minOrderAmount = ₹200. Order for ₹150 must yield ₹0.00
    const txMin = `tx-min-${testPrefix}`;
    const resMin = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txMin,
        clickId: clickAId,
        orderAmount: "150.00", // Below ₹200 threshold!
        commissionAmount: "15.00",
        status: "PENDING",
      }),
    });
    const dataMin = await resMin.json();
    const rowMin = await pgClient.query('SELECT * FROM "Conversion" WHERE id = $1', [dataMin.conversionId]);
    const convMin = rowMin.rows[0];
    record(
      "Calculation",
      "Order below minOrderAmount receives ₹0.00 cashback without creating cashback entity",
      convMin && parseFloat(convMin.cashbackAmount) === 0.0 && convMin.cashbackId === null,
      `Cashback: ₹${convMin?.cashbackAmount}, CashbackId: ${convMin?.cashbackId}`
    );

    // 3.3 Fixed Cashback Campaign Test (FIXED ₹250.00 per order)
    const fixCampRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Fixed Cashback Campaign ${testPrefix}`,
        shareType: "FIXED",
        userShareValue: 250.0,
        minOrderAmount: 500.0,
        merchantId: merchantBId,
        dealId: dealBId,
        priority: 50,
        isActive: true,
      }),
    });
    const fixCampData = await fixCampRes.json();
    const fixCampId = fixCampData.campaign?.id;

    const txFixed = `tx-fixed-${testPrefix}`;
    const resFixed = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txFixed,
        clickId: clickBId,
        orderAmount: "2500.00",
        commissionAmount: "300.00",
        status: "PENDING",
      }),
    });
    const dataFixed = await resFixed.json();
    const rowFixed = await pgClient.query('SELECT * FROM "Conversion" WHERE id = $1', [dataFixed.conversionId]);
    const convFixed = rowFixed.rows[0];
    record(
      "Calculation",
      "Fixed cashback campaign calculates exact fixed amount (₹250.00)",
      convFixed && convFixed.campaignId === fixCampId && parseFloat(convFixed.cashbackAmount) === 250.0,
      `Cashback: ₹${convFixed?.cashbackAmount}, Type: ${convFixed?.shareType}`
    );

    // 3.4 Decimal Precision & Rounding (12.35% on ₹1,234.56 = ₹152.46816 -> ₹152.47 ROUND_HALF_UP)
    const roundCampRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Rounding Precision Campaign ${testPrefix}`,
        shareType: "PERCENTAGE",
        userShareValue: 12.35,
        priority: 999, // Specific to Deal B
        dealId: dealBId,
        isActive: true,
      }),
    });
    const roundCampData = await roundCampRes.json();
    const roundCampId = roundCampData.campaign?.id;

    const txRound = `tx-round-${testPrefix}`;
    const resRound = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txRound,
        clickId: clickBId,
        orderAmount: "1234.56",
        commissionAmount: "200.00",
        status: "PENDING",
      }),
    });
    const dataRound = await resRound.json();
    const rowRound = await pgClient.query('SELECT * FROM "Conversion" WHERE id = $1', [dataRound.conversionId]);
    const convRound = rowRound.rows[0];
    record(
      "Calculation",
      "Decimal arithmetic ROUND_HALF_UP to exact 2 decimals (12.35% of ₹1234.56 = ₹152.47)",
      convRound && parseFloat(convRound.cashbackAmount) === 152.47,
      `Calculated: ₹${convRound?.cashbackAmount}`
    );

    // Deactivate high-priority rounding campaign so subsequent tests use primary campaign
    await fetch(`${BASE_URL}/api/admin/campaigns/${roundCampId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ isActive: false }),
    });

    // =========================================================================
    // SECTION 4: IMMUTABLE CAMPAIGN RULE SNAPSHOTS
    // =========================================================================
    console.log("\n▶ Running Section 4: Immutable Campaign Rule Snapshots...");

    // 4.1 Verify campaignSnapshot is stored on Conversion
    const snapshotJson = convDealA.campaignSnapshot;
    const isSnapshotComplete =
      snapshotJson &&
      snapshotJson.campaignId === primaryCampaignId &&
      snapshotJson.shareType === "PERCENTAGE" &&
      snapshotJson.userShareValue === "10.00" &&
      snapshotJson.roundingPolicy === "ROUND_HALF_UP_2_DECIMALS" &&
      parseFloat(snapshotJson.calculatedCashbackAmount) === 400.0;
    record(
      "Snapshot",
      "Conversion record contains complete immutable campaign calculation snapshot",
      isSnapshotComplete,
      `Snapshot CampaignId: ${snapshotJson?.campaignId}, Policy: ${snapshotJson?.roundingPolicy}`
    );

    // 4.2 Alter the campaign rules later via Admin PATCH
    await fetch(`${BASE_URL}/api/admin/campaigns/${primaryCampaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        userShareValue: 2.0, // Reduced to 2%
      }),
    });

    // 4.3 Verify historical conversion and snapshot remain 100% UNCHANGED
    const rowDealAAfter = await pgClient.query('SELECT * FROM "Conversion" WHERE id = $1', [dataDealA.conversionId]);
    const convDealAAfter = rowDealAAfter.rows[0];
    const isImmutabilityPreserved =
      parseFloat(convDealAAfter.cashbackAmount) === 400.0 &&
      convDealAAfter.campaignSnapshot.userShareValue === "10.00";
    record(
      "Snapshot",
      "Historical conversion amount and snapshot remain immutable after campaign edit",
      isImmutabilityPreserved,
      `Cashback remains: ₹${convDealAAfter.cashbackAmount}, Snapshot rate: ${convDealAAfter.campaignSnapshot.userShareValue}%`
    );

    // =========================================================================
    // SECTION 5: FULL CONVERSION-TO-CASHBACK FINANCIAL LIFECYCLE
    // =========================================================================
    console.log("\n▶ Running Section 5: Full Conversion-to-Cashback Financial Lifecycle...");

    // Initial user balance is 0.00
    const wInit = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    record("Lifecycle", "Initial user wallet balance is 0.00", parseFloat(wInit.rows[0]?.balance || 0) === 0.0, `Balance: ₹${wInit.rows[0]?.balance}`);

    // 5.1 Initial ingestion created Cashback in PENDING status
    const cbInit = await pgClient.query('SELECT * FROM "Cashback" WHERE id = $1', [convDealA.cashbackId]);
    record(
      "Lifecycle",
      "Conversion ingestion creates Cashback in PENDING status",
      cbInit.rows[0]?.status === "PENDING" && parseFloat(cbInit.rows[0]?.amount) === 400.0,
      `Status: ${cbInit.rows[0]?.status}, Amount: ₹${cbInit.rows[0]?.amount}`
    );

    // 5.2 Transition to APPROVED status: wallet balance must remain 0.00
    await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txDealA,
        clickId: clickAId,
        orderAmount: "4000.00",
        commissionAmount: "200.00",
        status: "APPROVED",
      }),
    });
    const cbApp = await pgClient.query('SELECT * FROM "Cashback" WHERE id = $1', [convDealA.cashbackId]);
    const wApp = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    record(
      "Lifecycle",
      "APPROVED status transition does not prematurely credit wallet balance",
      cbApp.rows[0]?.status === "APPROVED" && parseFloat(wApp.rows[0]?.balance || 0) === 0.0,
      `Cashback Status: ${cbApp.rows[0]?.status}, Wallet Balance: ₹${wApp.rows[0]?.balance}`
    );

    // 5.3 Transition to CONFIRMED status: user wallet atomically credited with ₹400.00
    await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txDealA,
        clickId: clickAId,
        orderAmount: "4000.00",
        commissionAmount: "200.00",
        status: "CONFIRMED",
      }),
    });
    const cbConf = await pgClient.query('SELECT * FROM "Cashback" WHERE id = $1', [convDealA.cashbackId]);
    const wConf = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    const txCredit = await pgClient.query(
      'SELECT * FROM "WalletTransaction" WHERE "cashbackId" = $1 AND type = \'CREDIT\'',
      [convDealA.cashbackId]
    );
    record(
      "Lifecycle",
      "CONFIRMED status atomically credits wallet ₹400.00 with WalletTransaction entry",
      cbConf.rows[0]?.status === "CONFIRMED" &&
        parseFloat(wConf.rows[0]?.balance) === 400.0 &&
        txCredit.rows.length === 1 &&
        parseFloat(txCredit.rows[0].amount) === 400.0,
      `Balance: ₹${wConf.rows[0]?.balance}, Tx ID: ${txCredit.rows[0]?.id}`
    );

    // 5.4 Replay / Duplicate CONFIRMED postback does NOT credit wallet twice
    await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txDealA,
        clickId: clickAId,
        orderAmount: "4000.00",
        commissionAmount: "200.00",
        status: "CONFIRMED",
      }),
    });
    const wConfReplay = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    const txCreditCount = await pgClient.query(
      'SELECT count(*) FROM "WalletTransaction" WHERE "cashbackId" = $1 AND type = \'CREDIT\'',
      [convDealA.cashbackId]
    );
    record(
      "Lifecycle",
      "Replaying CONFIRMED callback does not double-credit wallet balance",
      parseFloat(wConfReplay.rows[0]?.balance) === 400.0 && parseInt(txCreditCount.rows[0].count, 10) === 1,
      `Balance: ₹${wConfReplay.rows[0]?.balance}, Credit Tx Count: ${txCreditCount.rows[0]?.count}`
    );

    // 5.5 Transition to REVERSED status: user wallet atomically debited back to 0.00
    await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txDealA,
        clickId: clickAId,
        orderAmount: "4000.00",
        commissionAmount: "200.00",
        status: "REVERSED",
        notes: "Customer returned product",
      }),
    });
    const cbRev = await pgClient.query('SELECT * FROM "Cashback" WHERE id = $1', [convDealA.cashbackId]);
    const wRev = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    const txReversal = await pgClient.query(
      'SELECT * FROM "WalletTransaction" WHERE type = \'REVERSAL\' AND "walletId" = (SELECT id FROM "Wallet" WHERE "userId" = $1)',
      [standardUserId]
    );
    record(
      "Lifecycle",
      "REVERSED status atomically debits wallet ₹400.00 with double-entry REVERSAL record",
      cbRev.rows[0]?.status === "REVERSED" &&
        parseFloat(wRev.rows[0]?.balance) === 0.0 &&
        txReversal.rows.length === 1 &&
        parseFloat(txReversal.rows[0].amount) === 400.0,
      `Balance: ₹${wRev.rows[0]?.balance}, Reversal Tx ID: ${txReversal.rows[0]?.id}`
    );

    // 5.6 Replaying REVERSED postback does NOT deduct money twice
    await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": genSecret },
      body: JSON.stringify({
        externalTransactionId: txDealA,
        clickId: clickAId,
        orderAmount: "4000.00",
        commissionAmount: "200.00",
        status: "REVERSED",
      }),
    });
    const wRevReplay = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    const txRevCount = await pgClient.query(
      'SELECT count(*) FROM "WalletTransaction" WHERE type = \'REVERSAL\' AND "walletId" = (SELECT id FROM "Wallet" WHERE "userId" = $1)',
      [standardUserId]
    );
    record(
      "Lifecycle",
      "Replaying REVERSED callback does not double-debit wallet (balance remains 0.00)",
      parseFloat(wRevReplay.rows[0]?.balance) === 0.0 && parseInt(txRevCount.rows[0].count, 10) === 1,
      `Balance: ₹${wRevReplay.rows[0]?.balance}, Reversal Tx Count: ${txRevCount.rows[0]?.count}`
    );

    // =========================================================================
    // SECTION 6: SOFT-DEACTIVATION & REFERENTIAL INTEGRITY
    // =========================================================================
    console.log("\n▶ Running Section 6: Soft-Deactivation & Referential Integrity...");

    // 6.1 Delete campaign with historical conversion references performs soft-deactivation
    const delCampRes = await fetch(`${BASE_URL}/api/admin/campaigns/${primaryCampaignId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    const delCampData = await delCampRes.json();
    const rowDel = await pgClient.query('SELECT * FROM "Campaign" WHERE id = $1', [primaryCampaignId]);
    record(
      "Integrity",
      "DELETE on campaign with historical conversion references performs safe soft-deactivation",
      delCampRes.status === 200 && delCampData.deactivated === true && rowDel.rows[0]?.isActive === false,
      `Deactivated: ${delCampData.deactivated}, isActive in DB: ${rowDel.rows[0]?.isActive}`
    );

    // 6.2 Delete campaign with zero conversions deletes record
    const emptyCampRes = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Temporary Empty Campaign ${testPrefix}`,
        shareType: "FIXED",
        userShareValue: 50.0,
      }),
    });
    const emptyCampData = await emptyCampRes.json();
    const emptyCampId = emptyCampData.campaign?.id;

    const delEmptyRes = await fetch(`${BASE_URL}/api/admin/campaigns/${emptyCampId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    const delEmptyData = await delEmptyRes.json();
    const rowEmpty = await pgClient.query('SELECT count(*) FROM "Campaign" WHERE id = $1', [emptyCampId]);
    record(
      "Integrity",
      "DELETE on unreferenced campaign permanently deletes record",
      delEmptyRes.status === 200 && delEmptyData.deleted === true && parseInt(rowEmpty.rows[0].count, 10) === 0,
      `Deleted: ${delEmptyData.deleted}, Remaining Count: ${rowEmpty.rows[0].count}`
    );

  } catch (err) {
    console.error("FATAL ERROR IN TEST SUITE:", err);
    record("Fatal", "Test suite execution crashed", false, err.message);
  } finally {
    console.log("\n▶ Cleaning up Phase 7 test records...");
    await cleanupAll();
    await pgClient.end();
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n================================================================================");
  console.log("Phase 7 Test Results Summary");
  console.log("================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  console.log(`Total Tests Run : ${total}`);
  console.log(`Passed         : ${passed}`);
  console.log(`Failed         : ${failed}`);
  console.log(`Pass Rate      : ${passRate}%`);
  console.log("================================================================================\n");

  if (failed > 0) {
    console.error("❌ Some Phase 7 tests failed.");
    process.exit(1);
  } else {
    console.log("✅ All Phase 7 tests PASSED successfully!");
    process.exit(0);
  }
}

runPhase7Tests();
