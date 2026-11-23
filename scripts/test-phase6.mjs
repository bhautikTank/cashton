/**
 * CashTon Phase 6: Affiliate Network Integration & Conversion Tracking Test Suite
 * Comprehensive End-to-End Verification of Webhooks, Adapters, Attribution,
 * Idempotency, Cashback State Transitions, Financial Ledger Integrity, Cron Auth & Admin APIs
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

async function runPhase6Tests() {
  console.log("================================================================================");
  console.log("CashTon Phase 6: Affiliate Network Integration & Conversion Tracking Test Suite");
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
  const testPrefix = `p6-${runId}`;
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
  let testClickId1 = "";
  let guestClickId = "";

  const genSecret = process.env.GENERIC_WEBHOOK_SECRET || "test_generic_secret_cashton_2026";
  const cronSecret = process.env.CRON_SECRET;

  async function cleanupAll() {
    try {
      await pgClient.query('DELETE FROM "Conversion" WHERE "externalTransactionId" LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "Cashback" WHERE "externalReferenceId" LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "WalletTransaction" WHERE description LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "AffiliateClick" WHERE source LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "Deal" WHERE slug LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "Merchant" WHERE slug LIKE $1', [`%${testPrefix}%`]);
      await pgClient.query('DELETE FROM "User" WHERE email LIKE $1', [`%${testPrefix}%`]);
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
  }

  try {
    // =========================================================================
    // SECTION 0: SETUP
    // =========================================================================
    console.log("▶ Running Section 0: Test Setup (Users, Sessions, Merchant, Deal, Clicks)...");

    // 0.1 Register standard user
    const uRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
        name: "Standard User P6",
        mobileNumber: testMobile,
      }),
    });
    const uRegData = await uRegRes.json();
    standardUserId = uRegData.user?.id;
    record("Setup", "Register standard user account (201)", uRegRes.status === 201 && uRegData.success, `User ID: ${standardUserId}`);

    // 0.2 Login standard user
    const uLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testUserEmail, password: testPassword }),
    });
    userCookie = extractCookies(uLoginRes);
    record("Setup", "Login standard user (session cookie)", uLoginRes.status === 200 && !!userCookie, `Cookie established`);

    // 0.3 Register & elevate admin
    const aRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: testPassword,
        name: "Admin User P6",
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
    record("Setup", "Login elevated admin (admin session cookie)", aLoginRes.status === 200 && !!adminCookie, `Admin cookie established`);

    // 0.4 Create active merchant via Admin API
    const mRes = await fetch(`${BASE_URL}/api/admin/merchants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: `Merchant ${testPrefix}`,
        slug: `merchant-${testPrefix}`,
        websiteUrl: "https://www.example-store.com",
        isActive: true,
      }),
    });
    const mData = await mRes.json();
    activeMerchantId = mData.merchant?.id;
    record("Setup", "Create active merchant (201)", mRes.status === 201 && !!activeMerchantId, `Merchant ID: ${activeMerchantId}`);

    // 0.5 Create active deal with explicit affiliateUrl
    const dRes = await fetch(`${BASE_URL}/api/admin/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        merchantId: activeMerchantId,
        title: `Deal ${testPrefix}`,
        slug: `deal-${testPrefix}`,
        originalPrice: 10000,
        dealPrice: 8000,
        affiliateUrl: "https://www.example-store.com/offer?subid={tid}",
        isActive: true,
      }),
    });
    const dData = await dRes.json();
    validDealId = dData.deal?.id;
    record("Setup", "Create active deal with template affiliateUrl (201)", dRes.status === 201 && !!validDealId, `Deal ID: ${validDealId}`);

    // 0.6 Generate Authenticated Click Record
    const clkRes1 = await fetch(`${BASE_URL}/api/deals/${validDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ source: `test-${testPrefix}` }),
    });
    const clkData1 = await clkRes1.json();
    testClickId1 = clkData1.clickId;
    record("Setup", "Generate authenticated affiliate click (201)", clkRes1.status === 201 && !!testClickId1, `ClickId: ${testClickId1}`);

    // 0.7 Generate Guest Click Record (no session cookie)
    const clkResGuest = await fetch(`${BASE_URL}/api/deals/${validDealId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: `guest-${testPrefix}` }),
    });
    const clkDataGuest = await clkResGuest.json();
    guestClickId = clkDataGuest.clickId;
    record("Setup", "Generate guest affiliate click (201)", clkResGuest.status === 201 && !!guestClickId, `Guest ClickId: ${guestClickId}`);

    // =========================================================================
    // SECTION 1: WEBHOOK SECURITY & AUTHENTICATION (GENERIC PROVIDER)
    // =========================================================================
    console.log("\n▶ Running Section 1: Webhook Security & Secret Verification...");

    const secTxId = `tx-sec-${testPrefix}`;
    const testPayload = {
      externalTransactionId: secTxId,
      clickId: testClickId1,
      orderAmount: "5000.00",
      commissionAmount: "250.00",
      status: "PENDING",
    };

    // 1.1 Missing / Invalid secret
    const invalidSigRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": "invalid-secret-key",
      },
      body: JSON.stringify(testPayload),
    });
    record("Security", "Reject webhook with invalid secret (401)", invalidSigRes.status === 401, `Status: ${invalidSigRes.status}`);

    // 1.2 Valid secret authentication
    const validSigRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify(testPayload),
    });
    const validSigData = await validSigRes.json();
    record("Security", "Accept webhook with valid secret (201)", validSigRes.status === 201 && validSigData.success, `ConversionId: ${validSigData.conversionId}`);

    // 1.3 Reject negative monetary amounts
    const negRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: `tx-neg-${testPrefix}`,
        clickId: testClickId1,
        orderAmount: "-100.00",
        commissionAmount: "-50.00",
        status: "PENDING",
      }),
    });
    record("Security", "Reject conversion with negative monetary values (400)", negRes.status === 400, `Status: ${negRes.status}`);

    // =========================================================================
    // SECTION 2: CLICK ATTRIBUTION & MULTI-NETWORK ADAPTERS
    // =========================================================================
    console.log("\n▶ Running Section 2: Click Attribution & Multi-Network Adapters...");

    // 2.1 Generic postback attribution with 70% commission calculation
    const genTxId = `tx-gen-${testPrefix}`;
    const genRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: genTxId,
        clickId: testClickId1,
        orderAmount: "10000.00",
        commissionAmount: "500.00",
        status: "PENDING",
      }),
    });
    const genData = await genRes.json();
    record("Attribution", "Postback ingested and attributed to click (201)", genRes.status === 201 && genData.status === "PENDING", `ConversionId: ${genData.conversionId}`);

    // Verify cashback record in DB: 500 * 0.70 = 350.00 INR in PENDING status
    const cbRow = await pgClient.query('SELECT * FROM "Cashback" WHERE id = $1', [genData.cashbackId]);
    const cb = cbRow.rows[0];
    record(
      "Attribution",
      "Cashback created with 70% commission share in PENDING status",
      cb && cb.status === "PENDING" && parseFloat(cb.amount) === 350.0 && cb.userId === standardUserId,
      `Cashback: ₹${cb?.amount}, Status: ${cb?.status}`
    );

    // 2.2 Unmatched Conversion (missing / unknown clickId)
    const unmatchTxId = `tx-unmatched-${testPrefix}`;
    const unmatchRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: unmatchTxId,
        clickId: "00000000-0000-0000-0000-000000000000",
        orderAmount: "1500.00",
        commissionAmount: "75.00",
        status: "PENDING",
      }),
    });
    const unmatchData = await unmatchRes.json();
    record(
      "Attribution",
      "Missing clickId flagged as UNMATCHED with null user and zero cashback (201)",
      unmatchRes.status === 201 && unmatchData.isUnmatched && unmatchData.status === "UNMATCHED" && !unmatchData.cashbackId,
      `Status: ${unmatchData.status}`
    );

    // 2.3 Guest Click Attribution (valid click, but no registered user)
    const guestTxId = `tx-guest-${testPrefix}`;
    const guestRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: guestTxId,
        clickId: guestClickId,
        orderAmount: "8000.00",
        commissionAmount: "400.00",
        status: "PENDING",
      }),
    });
    const guestData = await guestRes.json();
    record(
      "Attribution",
      "Guest click records conversion but creates no user cashback (201)",
      guestRes.status === 201 && !guestData.cashbackId && guestData.status === "PENDING",
      `CashbackId: ${guestData.cashbackId}`
    );

    // 2.4 Multi-Network Kill Switch Guards
    const cueBlockRes = await fetch(`${BASE_URL}/api/webhooks/cuelinks?secret=test_cuelinks_secret_cashton_2026&transaction_id=cue_${testPrefix}`, {
      method: "POST",
    });
    record("KillSwitch", "Cuelinks webhook rejected with 503 when not whitelisted", cueBlockRes.status === 503, `Status: ${cueBlockRes.status}`);

    const admBlockRes = await fetch(`${BASE_URL}/api/webhooks/admitad?secret=test_admitad_secret_cashton_2026&action_id=adm_${testPrefix}`, {
      method: "POST",
    });
    record("KillSwitch", "Admitad webhook rejected with 503 when not whitelisted", admBlockRes.status === 503, `Status: ${admBlockRes.status}`);

    // 2.5 Deleted fabricated webhook routes return 404
    const fkRes = await fetch(`${BASE_URL}/api/webhooks/flipkart`, { method: "POST" });
    const ekRes = await fetch(`${BASE_URL}/api/webhooks/earnkaro`, { method: "POST" });
    record("KillSwitch", "Deleted fabricated webhook routes return 404", fkRes.status === 404 && ekRes.status === 404, `Flipkart: ${fkRes.status}, EarnKaro: ${ekRes.status}`);

    // =========================================================================
    // SECTION 3: IDEMPOTENCY & DUPLICATE DELIVERIES
    // =========================================================================
    console.log("\n▶ Running Section 3: Idempotency & Duplicate Deliveries...");

    const dupRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: genTxId,
        clickId: testClickId1,
        orderAmount: "10000.00",
        commissionAmount: "500.00",
        status: "PENDING",
      }),
    });
    const dupData = await dupRes.json();
    record("Idempotency", "Re-sending postback returns duplicate flag with 200 OK", dupRes.status === 200 && dupData.isDuplicate === true, `Duplicate acknowledged`);

    const countRow = await pgClient.query(
      'SELECT count(*) FROM "Conversion" WHERE provider = \'GENERIC\' AND "externalTransactionId" = $1',
      [genTxId]
    );
    record("Idempotency", "Database has strictly 1 conversion record for transaction", parseInt(countRow.rows[0].count, 10) === 1, `Count: ${countRow.rows[0].count}`);

    // =========================================================================
    // SECTION 4: LIFECYCLE STATE TRANSITIONS & FINANCIAL LEDGER
    // =========================================================================
    console.log("\n▶ Running Section 4: Lifecycle State Transitions & Financial Ledger Integrity...");

    const initialWallet = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    record("Ledger", "Initial user wallet balance is 0.00", parseFloat(initialWallet.rows[0]?.balance || 0) === 0.0, `Balance: ₹${initialWallet.rows[0]?.balance}`);

    // 4.1 Update status from PENDING to APPROVED
    const appRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: genTxId,
        clickId: testClickId1,
        orderAmount: "10000.00",
        commissionAmount: "500.00",
        status: "APPROVED",
      }),
    });
    const appData = await appRes.json();
    record("Lifecycle", "Transition conversion & cashback to APPROVED", appRes.status === 200 && appData.status === "APPROVED", `Status: ${appData.status}`);

    const walletAfterApp = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    record("Ledger", "Wallet balance remains unchanged on APPROVED status", parseFloat(walletAfterApp.rows[0]?.balance || 0) === 0.0, `Balance: ₹${walletAfterApp.rows[0]?.balance}`);

    // 4.2 Transition status from APPROVED to CONFIRMED (triggers wallet crediting)
    const confRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: genTxId,
        clickId: testClickId1,
        orderAmount: "10000.00",
        commissionAmount: "500.00",
        status: "CONFIRMED",
      }),
    });
    const confData = await confRes.json();
    record("Lifecycle", "Transition conversion & cashback to CONFIRMED", confRes.status === 200 && confData.status === "CONFIRMED", `Status: ${confData.status}`);

    // 4.3 Check user wallet balance after CONFIRMED (should be credited ₹350.00)
    const walletAfterConf = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    record(
      "Ledger",
      "Wallet atomically credited with ₹350.00 upon CONFIRMED status",
      parseFloat(walletAfterConf.rows[0]?.balance || 0) === 350.0,
      `Balance: ₹${walletAfterConf.rows[0]?.balance}`
    );

    // 4.4 Check WalletTransaction ledger entry
    const txLedger = await pgClient.query(
      'SELECT * FROM "WalletTransaction" WHERE "cashbackId" = $1 AND type = \'CREDIT\'',
      [genData.cashbackId]
    );
    record(
      "Ledger",
      "Double-entry WalletTransaction ledger CREDIT recorded for cashback",
      txLedger.rows.length === 1 && parseFloat(txLedger.rows[0].amount) === 350.0,
      `Tx ID: ${txLedger.rows[0]?.id}, Amount: ₹${txLedger.rows[0]?.amount}`
    );

    // 4.5 Duplicate delivery of CONFIRMED postback must not credit twice
    const confDupRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: genTxId,
        clickId: testClickId1,
        orderAmount: "10000.00",
        commissionAmount: "500.00",
        status: "CONFIRMED",
      }),
    });
    const walletAfterDupConf = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    record(
      "Ledger",
      "Duplicate CONFIRMED postback does not double-credit wallet",
      confDupRes.status === 200 && parseFloat(walletAfterDupConf.rows[0]?.balance || 0) === 350.0,
      `Balance: ₹${walletAfterDupConf.rows[0]?.balance}`
    );

    // 4.6 Reversal handling: postback status REVERSED
    const revRes = await fetch(`${BASE_URL}/api/webhooks/generic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": genSecret,
      },
      body: JSON.stringify({
        externalTransactionId: genTxId,
        clickId: testClickId1,
        orderAmount: "10000.00",
        commissionAmount: "500.00",
        status: "REVERSED",
        notes: "Item returned by customer",
      }),
    });
    const revData = await revRes.json();
    record("Lifecycle", "Transition conversion & cashback to REVERSED", revRes.status === 200 && revData.status === "REVERSED", `Status: ${revData.status}`);

    // 4.7 Wallet balance must be decremented back to 0.00
    const walletAfterRev = await pgClient.query('SELECT balance FROM "Wallet" WHERE "userId" = $1', [standardUserId]);
    record(
      "Ledger",
      "Wallet atomically debited by ₹350.00 upon REVERSED status (balance back to 0.00)",
      parseFloat(walletAfterRev.rows[0]?.balance || 0) === 0.0,
      `Balance: ₹${walletAfterRev.rows[0]?.balance}`
    );

    // 4.8 Ledger contains REVERSAL entry
    const revLedger = await pgClient.query(
      'SELECT * FROM "WalletTransaction" WHERE type = \'REVERSAL\' AND "walletId" = (SELECT id FROM "Wallet" WHERE "userId" = $1)',
      [standardUserId]
    );
    record(
      "Ledger",
      "Double-entry REVERSAL ledger entry recorded",
      revLedger.rows.length >= 1 && parseFloat(revLedger.rows[0].amount) === 350.0,
      `Reversal Tx ID: ${revLedger.rows[0]?.id}`
    );

    // =========================================================================
    // SECTION 5: FAIL-CLOSED CRON AUTHENTICATION
    // =========================================================================
    console.log("\n▶ Running Section 5: Fail-Closed Cron Authentication (/api/cron/flipkart-reports)...");

    // 5.1 Missing Authorization header -> 401
    const cronNoAuth = await fetch(`${BASE_URL}/api/cron/flipkart-reports`);
    record("CronAuth", "Cron without Authorization header rejected with 401", cronNoAuth.status === 401, `Status: ${cronNoAuth.status}`);

    // 5.2 Invalid Bearer token -> 401
    const cronBadToken = await fetch(`${BASE_URL}/api/cron/flipkart-reports`, {
      headers: { Authorization: "Bearer incorrect-secret-token" },
    });
    record("CronAuth", "Cron with invalid Bearer token rejected with 401", cronBadToken.status === 401, `Status: ${cronBadToken.status}`);

    // 5.3 Query parameter secret rejected -> 401
    const cronQuerySecret = await fetch(`${BASE_URL}/api/cron/flipkart-reports?secret=${cronSecret}`);
    record("CronAuth", "Cron with query param secret strictly rejected with 401", cronQuerySecret.status === 401, `Status: ${cronQuerySecret.status}`);

    // 5.4 Valid Bearer token authenticated -> 200
    const cronValid = await fetch(`${BASE_URL}/api/cron/flipkart-reports`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    record("CronAuth", "Cron with valid Bearer token accepted with 200", cronValid.status === 200, `Status: ${cronValid.status}`);

    // =========================================================================
    // SECTION 6: ADMIN CONVERSION MANAGEMENT APIS & RBAC
    // =========================================================================
    console.log("\n▶ Running Section 6: Admin Conversion Management APIs & RBAC...");

    // 6.1 Unauthenticated request rejected (401)
    const unauthRes = await fetch(`${BASE_URL}/api/admin/conversions`);
    record("RBAC", "Unauthenticated GET /api/admin/conversions rejected (401)", unauthRes.status === 401, `Status: ${unauthRes.status}`);

    // 6.2 Standard user forbidden (403)
    const stdUserRes = await fetch(`${BASE_URL}/api/admin/conversions`, {
      headers: { Cookie: userCookie },
    });
    record("RBAC", "Standard user GET /api/admin/conversions forbidden (403)", stdUserRes.status === 403, `Status: ${stdUserRes.status}`);

    // 6.3 Admin list conversions (200)
    const adminListRes = await fetch(`${BASE_URL}/api/admin/conversions?page=1&limit=20`, {
      headers: { Cookie: adminCookie },
    });
    const adminListData = await adminListRes.json();
    record(
      "Admin",
      "Admin GET /api/admin/conversions returns paginated conversions (200)",
      adminListRes.status === 200 && adminListData.success && Array.isArray(adminListData.conversions),
      `Total: ${adminListData.pagination?.total}`
    );

    // 6.4 Filter by status=UNMATCHED
    const filterUnmatchedRes = await fetch(`${BASE_URL}/api/admin/conversions?status=UNMATCHED`, {
      headers: { Cookie: adminCookie },
    });
    const filterUnmatchedData = await filterUnmatchedRes.json();
    const unmatchedItem = filterUnmatchedData.conversions?.find((c) => c.externalTransactionId === unmatchTxId);
    record(
      "Admin",
      "Filter conversions by status=UNMATCHED returns unmatched postback",
      filterUnmatchedRes.status === 200 && !!unmatchedItem,
      `Found unmatched Tx: ${unmatchedItem?.externalTransactionId}`
    );

    // 6.5 Get single conversion details by ID
    const singleRes = await fetch(`${BASE_URL}/api/admin/conversions/${genData.conversionId}`, {
      headers: { Cookie: adminCookie },
    });
    const singleData = await singleRes.json();
    record(
      "Admin",
      "Admin GET /api/admin/conversions/:id returns full details with audit payload",
      singleRes.status === 200 && singleData.conversion?.id === genData.conversionId && !!singleData.conversion?.rawPayload,
      `Tx ID: ${singleData.conversion?.externalTransactionId}`
    );

    // 6.6 Get conversion summary metrics
    const summaryRes = await fetch(`${BASE_URL}/api/admin/conversions/summary`, {
      headers: { Cookie: adminCookie },
    });
    const summaryData = await summaryRes.json();
    record(
      "Admin",
      "Admin GET /api/admin/conversions/summary returns aggregate totals & distributions",
      summaryRes.status === 200 && summaryData.summary?.totalConversions > 0 && !!summaryData.summary?.totals?.totalOrderAmount,
      `Conversions: ${summaryData.summary?.totalConversions}, Volume: ₹${summaryData.summary?.totals?.totalOrderAmount}`
    );

    // 6.7 Manual Reconciliation of UNMATCHED conversion
    const reconcileRes = await fetch(`${BASE_URL}/api/admin/conversions/${unmatchData.conversionId}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        clickId: testClickId1,
        notes: "Manually matched with user session clk_1",
      }),
    });
    const reconcileData = await reconcileRes.json();
    record(
      "Reconciliation",
      "Admin POST /api/admin/conversions/:id/reconcile attaches click and generates cashback (200)",
      reconcileRes.status === 200 && reconcileData.success && !!reconcileData.conversion?.cashbackId,
      `New CashbackId: ${reconcileData.conversion?.cashbackId}`
    );

    // Verify reconciled conversion in DB
    const recRow = await pgClient.query('SELECT * FROM "Conversion" WHERE id = $1', [unmatchData.conversionId]);
    const recConv = recRow.rows[0];
    record(
      "Reconciliation",
      "Reconciled conversion status transitioned from UNMATCHED to PENDING with user linked",
      recConv && recConv.status === "PENDING" && recConv.userId === standardUserId,
      `Status: ${recConv?.status}, User ID: ${recConv?.userId}`
    );

  } finally {
    console.log("\n▶ Cleaning up Phase 6 test records...");
    await cleanupAll();
    await pgClient.end();
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n================================================================================");
  console.log("Phase 6 Test Results Summary");
  console.log("================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total Tests Run : ${total}`);
  console.log(`Passed         : ${passed}`);
  console.log(`Failed         : ${failed}`);
  console.log(`Pass Rate      : ${((passed / total) * 100).toFixed(1)}%`);
  console.log("================================================================================\n");

  if (failed > 0) {
    console.error("❌ Some Phase 6 tests failed.");
    process.exit(1);
  } else {
    console.log("✅ All Phase 6 tests PASSED successfully!");
    process.exit(0);
  }
}

runPhase6Tests().catch((err) => {
  console.error("Fatal error running Phase 6 tests:", err);
  process.exit(1);
});
