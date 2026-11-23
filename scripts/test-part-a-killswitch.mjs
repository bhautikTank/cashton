import assert from "assert";
import { isProviderIngestionEnabled } from "../src/modules/conversions/kill-switch.ts";

console.log("=== Testing Part A Kill-Switch Logic ===");

// Test 1: Empty / Unset environment variable -> disabled
process.env.CONVERSION_INGESTION_ENABLED_PROVIDERS = "";
assert.strictEqual(isProviderIngestionEnabled("FLIPKART"), false, "FLIPKART should be disabled when env is empty");
assert.strictEqual(isProviderIngestionEnabled("CUELINKS"), false, "CUELINKS should be disabled when env is empty");
assert.strictEqual(isProviderIngestionEnabled("ADMITAD"), false, "ADMITAD should be disabled when env is empty");
assert.strictEqual(isProviderIngestionEnabled("EARNKARO"), false, "EARNKARO should be disabled when env is empty");
assert.strictEqual(isProviderIngestionEnabled("GENERIC"), false, "GENERIC should be disabled when env is empty");
console.log("✓ Test 1 Passed: Empty env blocks all providers");

delete process.env.CONVERSION_INGESTION_ENABLED_PROVIDERS;
assert.strictEqual(isProviderIngestionEnabled("FLIPKART"), false, "FLIPKART should be disabled when env is undefined");
console.log("✓ Test 2 Passed: Undefined env blocks all providers");

// Test 3: Specific provider enabled
process.env.CONVERSION_INGESTION_ENABLED_PROVIDERS = "CUELINKS,ADMITAD";
assert.strictEqual(isProviderIngestionEnabled("CUELINKS"), true, "CUELINKS should be enabled");
assert.strictEqual(isProviderIngestionEnabled("ADMITAD"), true, "ADMITAD should be enabled");
assert.strictEqual(isProviderIngestionEnabled("FLIPKART"), false, "FLIPKART should remain disabled");
assert.strictEqual(isProviderIngestionEnabled("EARNKARO"), false, "EARNKARO should remain disabled");
assert.strictEqual(isProviderIngestionEnabled("cuelinks"), true, "Case-insensitivity should work");
console.log("✓ Test 3 Passed: Whitelisted providers are enabled, non-whitelisted are blocked");

console.log("\n✅ All Part A Kill-Switch unit checks PASSED!");
