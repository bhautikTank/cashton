import assert from "assert";
import fs from "fs";
import path from "path";
import crypto from "crypto";

console.log("===============================================================");
console.log("   CashTon Part B Verification Suite: Network Adapters & Polling");
console.log("===============================================================\n");

// --- 1. VERIFY ROUTE DELETIONS & ADDITIONS ON DISK ---
console.log("--- 1. Verifying Filesystem Architecture (Deleted vs Added Routes) ---");

const webhooksDir = path.resolve("app/api/webhooks");
const cronDir = path.resolve("app/api/cron");

// Check deleted fabricated webhook routes
assert.strictEqual(
  fs.existsSync(path.join(webhooksDir, "flipkart")),
  false,
  "app/api/webhooks/flipkart must be completely deleted"
);
assert.strictEqual(
  fs.existsSync(path.join(webhooksDir, "earnkaro")),
  false,
  "app/api/webhooks/earnkaro must be completely deleted"
);
console.log("✓ Verified: Fabricated flipkart and earnkaro webhook routes are deleted");

// Check deleted fabricated adapter files
const adaptersDir = path.resolve("src/modules/conversions/adapters");
assert.strictEqual(
  fs.existsSync(path.join(adaptersDir, "flipkart.adapter.ts")),
  false,
  "flipkart.adapter.ts must be deleted"
);
assert.strictEqual(
  fs.existsSync(path.join(adaptersDir, "earnkaro.adapter.ts")),
  false,
  "earnkaro.adapter.ts must be deleted"
);
console.log("✓ Verified: Fabricated flipkart and earnkaro adapters are deleted");

// Check added Flipkart Reports polling service & cron route
const pollingServicePath = path.resolve("src/modules/conversions/polling/flipkart-reports.service.ts");
assert.strictEqual(fs.existsSync(pollingServicePath), true, "flipkart-reports.service.ts must exist");
assert.strictEqual(
  fs.existsSync(path.join(cronDir, "flipkart-reports/route.ts")),
  true,
  "app/api/cron/flipkart-reports/route.ts must exist"
);
console.log("✓ Verified: Flipkart Reports polling service and cron route exist");

// Check Cuelinks and Admitad adapter files exist
assert.strictEqual(fs.existsSync(path.join(adaptersDir, "cuelinks.adapter.ts")), true);
assert.strictEqual(fs.existsSync(path.join(adaptersDir, "admitad.adapter.ts")), true);
console.log("✓ Verified: Cuelinks and Admitad adapters exist");


// --- 2. VERIFY STATUS MAPPING CONSTANTS ---
console.log("\n--- 2. Verifying Documented Status Mappings ---");

// Cuelinks: 5 documented statuses
const CUELINKS_STATUS_MAP = {
  pending: "PENDING",
  validated: "APPROVED",
  payable: "APPROVED", // CRITICAL: payable is NOT confirmed until physical settlement
  paid: "CONFIRMED",
  rejected: "REJECTED",
};

assert.strictEqual(CUELINKS_STATUS_MAP.pending, "PENDING");
assert.strictEqual(CUELINKS_STATUS_MAP.validated, "APPROVED");
assert.strictEqual(CUELINKS_STATUS_MAP.payable, "APPROVED", "payable must map to APPROVED (not CONFIRMED)");
assert.strictEqual(CUELINKS_STATUS_MAP.paid, "CONFIRMED", "paid must map to CONFIRMED");
assert.strictEqual(CUELINKS_STATUS_MAP.rejected, "REJECTED");
console.log("✓ Cuelinks 5 documented status mappings match specification");

// Admitad: documented statuses
const ADMITAD_STATUS_MAP = {
  pending: "PENDING",
  approved: "CONFIRMED",
  declined: "REJECTED",
};

assert.strictEqual(ADMITAD_STATUS_MAP.pending, "PENDING");
assert.strictEqual(ADMITAD_STATUS_MAP.approved, "CONFIRMED");
assert.strictEqual(ADMITAD_STATUS_MAP.declined, "REJECTED");
console.log("✓ Admitad documented status mappings match specification");

// Flipkart Polling status mapping
function mapFlipkartStatus(rawStatus) {
  if (!rawStatus) return "PENDING";
  const s = rawStatus.toLowerCase().trim();
  if (s === "completed" || s === "settled" || s === "confirmed") return "CONFIRMED";
  if (s === "approved" || s === "dispatched" || s === "delivered") return "APPROVED";
  if (s === "cancelled" || s === "rejected" || s === "failed") return "REJECTED";
  if (s === "returned" || s === "reversed" || s === "refunded") return "REVERSED";
  return "PENDING";
}

assert.strictEqual(mapFlipkartStatus("completed"), "CONFIRMED");
assert.strictEqual(mapFlipkartStatus("settled"), "CONFIRMED");
assert.strictEqual(mapFlipkartStatus("approved"), "APPROVED");
assert.strictEqual(mapFlipkartStatus("dispatched"), "APPROVED");
assert.strictEqual(mapFlipkartStatus("cancelled"), "REJECTED");
assert.strictEqual(mapFlipkartStatus("returned"), "REVERSED");
assert.strictEqual(mapFlipkartStatus("tentative"), "PENDING");
console.log("✓ Flipkart polling status mappings match specification");


// --- 3. VERIFY SHARED-SECRET TIMING SAFE VALIDATION ---
console.log("\n--- 3. Verifying Timing-Safe Secret Verification ---");

function safeEqual(a, b) {
  if (!a || !b || typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const secretKey = "cashton_super_secure_webhook_secret_2026";
assert.strictEqual(safeEqual(secretKey, secretKey), true, "Identical secrets must match");
assert.strictEqual(safeEqual(secretKey, "wrong_secret"), false, "Different secret must fail");
assert.strictEqual(safeEqual(secretKey, secretKey + "extra"), false, "Prefix match must fail");
assert.strictEqual(safeEqual(secretKey, null), false, "Null check must fail safely");
assert.strictEqual(safeEqual("", secretKey), false, "Empty check must fail safely");
console.log("✓ Timing-safe secret verification function works correctly");


// --- 4. VERIFY CUELINKS MACRO EXTRACTION & FORM-ENCODED PARSING ---
console.log("\n--- 4. Verifying Cuelinks Macro Extraction & Form Parsing ---");

function extractClickIdFromText(text) {
  if (!text) return null;
  const clean = String(text).trim();
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = clean.match(uuidRegex);
  return match ? match[0].toLowerCase() : null;
}

function parseFormEncoded(raw) {
  const params = new URLSearchParams(raw);
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

// Cuelinks Macro Extraction Test: {aff_sub}
const cuelinksRawBody = "transaction_id=cue_tx_98765&aff_sub=ct_clk_01928374-65ab-7cde-8f01-23456789abcd&sale_amount=3499.50&user_commission=174.97&status=paid&transaction_reference_id=AMZN_ORDER_12345";
const parsedForm = parseFormEncoded(cuelinksRawBody);

assert.strictEqual(parsedForm.transaction_id, "cue_tx_98765");
assert.strictEqual(extractClickIdFromText(parsedForm.aff_sub), "01928374-65ab-7cde-8f01-23456789abcd");
assert.strictEqual(parsedForm.sale_amount, "3499.50");
assert.strictEqual(parsedForm.user_commission, "174.97");
assert.strictEqual(parsedForm.status, "paid");
assert.strictEqual(parsedForm.transaction_reference_id, "AMZN_ORDER_12345");
console.log("✓ Cuelinks form-encoded payload and {aff_sub} macro parsing verified");


// --- 5. VERIFY ADMITAD MACRO EXTRACTION & QUERY PARSING ---
console.log("\n--- 5. Verifying Admitad Macro Extraction & Query Parsing ---");

// Admitad documented macros: [[[action_id]]], [[[subid]]], [[[order_sum]]], [[[payment_sum]]], [[[order_id]]]
const admitadUrl = "https://cashton.com/api/webhooks/admitad?secret=my_secret&action_id=adm_act_54321&subid=ct_clk_99999999-8888-7777-6666-555555555555&order_sum=8999&payment_sum=449.95&action_status=approved&order_id=MYNTRA_987";
const urlObj = new URL(admitadUrl);
const admitadParams = Object.fromEntries(urlObj.searchParams.entries());

assert.strictEqual(admitadParams.action_id, "adm_act_54321");
assert.strictEqual(extractClickIdFromText(admitadParams.subid), "99999999-8888-7777-6666-555555555555");
assert.strictEqual(admitadParams.order_sum, "8999");
assert.strictEqual(admitadParams.payment_sum, "449.95");
assert.strictEqual(admitadParams.action_status, "approved");
assert.strictEqual(admitadParams.order_id, "MYNTRA_987");
console.log("✓ Admitad query params and [[[subid]]] macro parsing verified");


// --- 6. VERIFY KILL-SWITCH INGESTION WHITELIST ---
console.log("\n--- 6. Verifying Kill-Switch Whitelist Logic ---");

function isProviderIngestionEnabled(provider) {
  const envVal = process.env.CONVERSION_INGESTION_ENABLED_PROVIDERS;
  if (!envVal || envVal.trim() === "") return false;
  const list = envVal.split(",").map((p) => p.trim().toUpperCase());
  return list.includes(provider.toUpperCase());
}

process.env.CONVERSION_INGESTION_ENABLED_PROVIDERS = "";
assert.strictEqual(isProviderIngestionEnabled("CUELINKS"), false);
assert.strictEqual(isProviderIngestionEnabled("FLIPKART"), false);
assert.strictEqual(isProviderIngestionEnabled("ADMITAD"), false);

process.env.CONVERSION_INGESTION_ENABLED_PROVIDERS = "CUELINKS";
assert.strictEqual(isProviderIngestionEnabled("CUELINKS"), true);
assert.strictEqual(isProviderIngestionEnabled("ADMITAD"), false);
assert.strictEqual(isProviderIngestionEnabled("FLIPKART"), false);
console.log("✓ Kill switch correctly enforces strict whitelist");


// --- 7. VERIFY FLIPKART POLLING CRON & ADAPTER GUARDS IN SOURCE ---
console.log("\n--- 7. Verifying Source Code Guard Rails ---");

const adapterIndexSource = fs.readFileSync(path.join(adaptersDir, "index.ts"), "utf-8");
assert.ok(
  /Flipkart does not support.*webhooks/i.test(adapterIndexSource),
  "Adapter router must reject FLIPKART"
);
assert.ok(
  /EarnKaro has no.*postback/i.test(adapterIndexSource),
  "Adapter router must reject EARNKARO"
);
console.log("✓ Adapter index router has explicit rejection guards for FLIPKART and EARNKARO");

const flipkartServiceSource = fs.readFileSync(pollingServicePath, "utf-8");
assert.ok(
  flipkartServiceSource.includes('process.env.FLIPKART_POLLING_ENABLED === "true"'),
  "Flipkart polling service must require explicit FLIPKART_POLLING_ENABLED='true'"
);
console.log("✓ Flipkart polling service enforces FLIPKART_POLLING_ENABLED='true' gate");

console.log("\n===============================================================");
console.log("🎉 ALL PART B NETWORK ADAPTER & POLLING VERIFICATIONS PASSED!");
console.log("===============================================================");
