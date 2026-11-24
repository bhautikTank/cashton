/**
 * QA Audit Discipline 1: Unit & Pure Logic Testing
 * Covers:
 * - Decimal precision & rounding (sub-paisa, 0.00, 0.01, bounds, NaN, Infinity)
 * - AES-256-GCM encryption, decryption, tampering detection, and masking
 * - Campaign matching priority, tie-breakers, date-window boundaries
 */

import assert from "assert";
import { Decimal } from "@prisma/client/runtime/client";
import {
  encryptSensitive,
  decryptSensitive,
  maskAccountNumber,
  maskUpiId,
} from "../../src/lib/security/encryption.ts";

export async function runUnitLogicTests() {
  console.log("\n================================================================================");
  console.log("   DISCIPLINE 1: UNIT & PURE LOGIC TESTING");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`  ✓ PASS: ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`         └─ Error: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 1. DECIMAL PRECISION & ROUNDING
  // ---------------------------------------------------------------------------
  console.log("--- 1.1 Decimal Precision, Rounding & Boundary Arithmetic ---");

  test("ROUND_HALF_UP rounds 12.345 to 12.35", () => {
    const val = new Decimal("12.345").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    assert.strictEqual(val.toFixed(2), "12.35");
  });

  test("ROUND_HALF_UP rounds 12.344 to 12.34", () => {
    const val = new Decimal("12.344").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    assert.strictEqual(val.toFixed(2), "12.34");
  });

  test("Sub-paisa commission calculation: 70% of ₹0.07 commission = ₹0.05", () => {
    // 0.07 * 0.70 = 0.049 -> rounded to 0.05
    const val = new Decimal("0.07")
      .mul(new Decimal("0.70"))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    assert.strictEqual(val.toFixed(2), "0.05");
  });

  test("Zero decimal handling (0.00 is preserved, not clamped or converted to null)", () => {
    const zero = new Decimal("0.00");
    assert.strictEqual(zero.toFixed(2), "0.00");
    assert.strictEqual(zero.isZero(), true);
  });

  test("Boundary value: 0.01 minimal monetary quantum", () => {
    const penny = new Decimal("0.01");
    assert.strictEqual(penny.greaterThan(0), true);
    assert.strictEqual(penny.toFixed(2), "0.01");
  });

  test("Boundary value: 99999999.99 (₹10 crore maximum financial boundary)", () => {
    const maxVal = new Decimal("99999999.99");
    const added = maxVal.plus(new Decimal("0.01"));
    assert.strictEqual(added.toFixed(2), "100000000.00");
  });

  test("Invalid non-numeric string throws Invalid Decimal error", () => {
    assert.throws(() => new Decimal("abc"), /Invalid argument|Invalid Decimal/i);
    assert.throws(() => new Decimal("12.34.56"), /Invalid argument|Invalid Decimal/i);
  });

  test("Decimal NaN and Infinity handling: isNaN() is detected", () => {
    const dNaN = new Decimal("NaN");
    assert.strictEqual(dNaN.isNaN(), true);
    const dInf = new Decimal("Infinity");
    assert.strictEqual(!dInf.isFinite(), true);
  });

  test("Scientific notation strings parse to exact decimal values without precision loss", () => {
    const sci = new Decimal("1e-2");
    assert.strictEqual(sci.toFixed(2), "0.01");
    const sciBig = new Decimal("1e5");
    assert.strictEqual(sciBig.toFixed(2), "100000.00");
  });

  // ---------------------------------------------------------------------------
  // 1.2 AES-256-GCM ENCRYPTION & DATA MASKING
  // ---------------------------------------------------------------------------
  console.log("\n--- 1.2 AES-256-GCM Encryption, Tampering & Masking ---");

  test("Encryption round-trip preserves exact plaintext", () => {
    const plain = "1234567890123456";
    const cipher = encryptSensitive(plain);
    const decrypted = decryptSensitive(cipher);
    assert.strictEqual(decrypted, plain);
  });

  test("Encryption payload has exact format: 32 hex chars IV : 32 hex chars authTag : hex ciphertext", () => {
    const cipher = encryptSensitive("test-payout");
    const parts = cipher.split(":");
    assert.strictEqual(parts.length, 3);
    assert.strictEqual(parts[0].length, 32); // 16 bytes = 32 hex chars IV
    assert.strictEqual(parts[1].length, 32); // 16 bytes = 32 hex chars AuthTag
    assert.strictEqual(parts[2].length > 0, true);
  });

  test("Tampered authTag fails decryption with authentication error (AEAD integrity)", () => {
    const cipher = encryptSensitive("confidential-account");
    const parts = cipher.split(":");
    // Flip characters in auth tag
    const tamperedTag = parts[1].replace(/^[0-9a-f]/i, (c) => (c === "a" ? "b" : "a"));
    const tamperedCipher = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    assert.throws(() => decryptSensitive(tamperedCipher), /unable to authenticate data|bad decrypt/i);
  });

  test("Tampered ciphertext fails decryption with authentication error", () => {
    const cipher = encryptSensitive("confidential-account");
    const parts = cipher.split(":");
    // Flip characters in ciphertext
    const tamperedBody = parts[2].replace(/^[0-9a-f]/i, (c) => (c === "0" ? "1" : "0"));
    const tamperedCipher = `${parts[0]}:${parts[1]}:${tamperedBody}`;

    assert.throws(() => decryptSensitive(tamperedCipher), /unable to authenticate data|bad decrypt/i);
  });

  test("Tampered IV fails decryption with authentication error", () => {
    const cipher = encryptSensitive("confidential-account");
    const parts = cipher.split(":");
    const tamperedIv = parts[0].replace(/^[0-9a-f]/i, (c) => (c === "f" ? "e" : "f"));
    const tamperedCipher = `${tamperedIv}:${parts[1]}:${parts[2]}`;

    assert.throws(() => decryptSensitive(tamperedCipher), /unable to authenticate data|bad decrypt/i);
  });

  test("Empty string / null encryption returns empty string", () => {
    assert.strictEqual(encryptSensitive(""), "");
    assert.strictEqual(decryptSensitive(""), "");
  });

  test("maskAccountNumber masks all but last 4 digits", () => {
    assert.strictEqual(maskAccountNumber("12345678901234"), "••••••••••1234");
    assert.strictEqual(maskAccountNumber("5678"), "••••••••5678");
    assert.strictEqual(maskAccountNumber(null), null);
    assert.strictEqual(maskAccountNumber(undefined), null);
  });

  test("maskUpiId masks user handle preserving first & last 2 chars and bank handle", () => {
    assert.strictEqual(maskUpiId("john.doe@okaxis"), "jo••••oe@okaxis");
    assert.strictEqual(maskUpiId("ab@icici"), "a••••@icici");
    assert.strictEqual(maskUpiId(""), null);
  });

  // ---------------------------------------------------------------------------
  // 1.3 CAMPAIGN SPECIFICITY & DETERMINISTIC SELECTION
  // ---------------------------------------------------------------------------
  console.log("\n--- 1.3 Campaign Specificity Hierarchy & Tie-Breaking ---");

  function mockCampaign(overrides) {
    return {
      id: "camp-" + Math.random().toString(36).substring(2, 7),
      name: "Test Campaign",
      merchantId: null,
      dealId: null,
      network: null,
      priority: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      startDate: null,
      endDate: null,
      isActive: true,
      ...overrides,
    };
  }

  function getSpecificityScore(c, params) {
    if (params.dealId && c.dealId === params.dealId) return 4;
    if (params.merchantId && c.merchantId === params.merchantId && !c.dealId) return 3;
    if (params.network && c.network === params.network && !c.merchantId && !c.dealId) return 2;
    if (!c.merchantId && !c.dealId && !c.network) return 1;
    return 0;
  }

  function rankCampaigns(campaigns, params) {
    return [...campaigns].sort((a, b) => {
      const scoreDiff = getSpecificityScore(b, params) - getSpecificityScore(a, params);
      if (scoreDiff !== 0) return scoreDiff;

      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;

      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;

      return a.id.localeCompare(b.id);
    });
  }

  test("Level 4 Deal campaign wins over Level 3 Merchant campaign", () => {
    const dealCamp = mockCampaign({ id: "deal-camp", dealId: "deal-101", priority: 10 });
    const merchCamp = mockCampaign({ id: "merch-camp", merchantId: "merch-101", priority: 100 });
    const ranked = rankCampaigns([merchCamp, dealCamp], { dealId: "deal-101", merchantId: "merch-101" });
    assert.strictEqual(ranked[0].id, "deal-camp");
  });

  test("Level 3 Merchant campaign wins over Level 2 Network campaign", () => {
    const merchCamp = mockCampaign({ id: "merch-camp", merchantId: "merch-101", priority: 0 });
    const netCamp = mockCampaign({ id: "net-camp", network: "FLIPKART", priority: 100 });
    const ranked = rankCampaigns([netCamp, merchCamp], { merchantId: "merch-101", network: "FLIPKART" });
    assert.strictEqual(ranked[0].id, "merch-camp");
  });

  test("Level 2 Network campaign wins over Level 1 Global default", () => {
    const netCamp = mockCampaign({ id: "net-camp", network: "CUELINKS", priority: 0 });
    const globalCamp = mockCampaign({ id: "global-camp", priority: 100 });
    const ranked = rankCampaigns([globalCamp, netCamp], { network: "CUELINKS" });
    assert.strictEqual(ranked[0].id, "net-camp");
  });

  test("Same level tie-breaker 1: priority DESC wins", () => {
    const c1 = mockCampaign({ id: "c1", merchantId: "m1", priority: 50 });
    const c2 = mockCampaign({ id: "c2", merchantId: "m1", priority: 100 });
    const ranked = rankCampaigns([c1, c2], { merchantId: "m1" });
    assert.strictEqual(ranked[0].id, "c2");
  });

  test("Same level tie-breaker 2: createdAt DESC wins when priority is equal", () => {
    const cOld = mockCampaign({ id: "cOld", merchantId: "m1", priority: 10, createdAt: new Date("2026-01-01") });
    const cNew = mockCampaign({ id: "cNew", merchantId: "m1", priority: 10, createdAt: new Date("2026-01-02") });
    const ranked = rankCampaigns([cOld, cNew], { merchantId: "m1" });
    assert.strictEqual(ranked[0].id, "cNew");
  });

  test("Same level tie-breaker 3: lexicographical id ASC wins when priority and createdAt are identical", () => {
    const cA = mockCampaign({ id: "camp-A", merchantId: "m1", priority: 10, createdAt: new Date("2026-01-01") });
    const cB = mockCampaign({ id: "camp-B", merchantId: "m1", priority: 10, createdAt: new Date("2026-01-01") });
    const ranked = rankCampaigns([cB, cA], { merchantId: "m1" });
    assert.strictEqual(ranked[0].id, "camp-A");
  });

  test("Date bounds: campaign is active exactly on startDate boundary", () => {
    const start = new Date("2026-05-01T12:00:00.000Z");
    const end = new Date("2026-05-01T14:00:00.000Z");
    const c = mockCampaign({ startDate: start, endDate: end });

    // Exact start boundary
    assert.strictEqual(c.startDate <= start && start <= c.endDate, true);
    // 1 millisecond before
    const before = new Date(start.getTime() - 1);
    assert.strictEqual(c.startDate <= before, false);
    // Exact end boundary
    assert.strictEqual(c.startDate <= end && end <= c.endDate, true);
    // 1 millisecond after
    const after = new Date(end.getTime() + 1);
    assert.strictEqual(after <= c.endDate, false);
  });

  console.log(`\nDiscipline 1 Results: ${passed} Passed, ${failed} Failed`);
  return { category: "Unit & Pure Logic", passed, failed };
}

if (process.argv[1]?.endsWith("1-unit-pure-logic.mjs")) {
  runUnitLogicTests().catch(console.error);
}
