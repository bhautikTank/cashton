/**
 * MASTER QA & SECURITY AUDIT TEST RUNNER
 * Orchestrates all 8 automated audit suites across testing disciplines:
 * - Discipline 1: Unit & Pure Logic Testing
 * - Discipline 2: Integration & Contract Testing
 * - Discipline 3: State-Transition & Workflow Testing
 * - Discipline 4: Concurrency, Race Condition & Idempotency Testing
 * - Discipline 5: Security & Penetration Testing (OWASP API Top 10)
 * - Discipline 6: Database Integrity, Constraint & Transaction Atomicity
 * - Discipline 7: Chaos, Resilience & Edge-Case Testing
 * - Discipline 8: Withdrawal & Payout Engine Testing (Phase 8)
 */

import { runUnitLogicTests } from "./1-unit-pure-logic.mjs";
import { runIntegrationContractTests } from "./2-integration-contracts.mjs";
import { runStateMachineWorkflowTests } from "./3-state-machine-lifecycle.mjs";
import { runConcurrencyTests } from "./4-concurrency-race-conditions.mjs";
import { runSecurityPenetrationTests } from "./5-security-penetration-owasp.mjs";
import { runDatabaseIntegrityTests } from "./6-database-integrity-ledger.mjs";
import { runChaosResilienceTests } from "./7-chaos-resilience-edge-cases.mjs";
import { runWithdrawalPayoutTests } from "./8-withdrawal-payout.mjs";

const suites = [
  { name: "Discipline 1: Unit & Pure Logic", fn: runUnitLogicTests },
  { name: "Discipline 2: Integration & Contract (API + DB)", fn: runIntegrationContractTests },
  { name: "Discipline 3: State-Transition & Workflow", fn: runStateMachineWorkflowTests },
  { name: "Discipline 4: Concurrency, Race Conditions & Idempotency", fn: runConcurrencyTests },
  { name: "Discipline 5: Security & Penetration (OWASP API Top 10)", fn: runSecurityPenetrationTests },
  { name: "Discipline 6: Database Integrity & Ledger Invariant", fn: runDatabaseIntegrityTests },
  { name: "Discipline 7: Chaos, Resilience & Edge-Cases", fn: runChaosResilienceTests },
  { name: "Discipline 8: Withdrawal & Payout Engine (Phase 8)", fn: runWithdrawalPayoutTests },
];

async function main() {
  const startTime = Date.now();
  console.log("================================================================================");
  console.log("             CASHTON COMPREHENSIVE QA & SECURITY AUDIT RUNNER                   ");
  console.log("================================================================================");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV || "test"}`);
  console.log(`Node: ${process.version}`);
  console.log("================================================================================\n");

  const results = [];
  let totalFailures = 0;

  for (const suite of suites) {
    const suiteStart = Date.now();
    try {
      await suite.fn();
      const duration = Date.now() - suiteStart;
      results.push({ name: suite.name, status: "PASSED", duration });
    } catch (err) {
      const duration = Date.now() - suiteStart;
      totalFailures++;
      results.push({ name: suite.name, status: "FAILED", duration, error: err.message });
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n================================================================================");
  console.log("                       FINAL AUDIT SCORECARD                                    ");
  console.log("================================================================================");
  console.table(
    results.map((r) => ({
      "Audit Discipline": r.name,
      Status: r.status,
      "Duration (ms)": r.duration,
      Details: r.error || "100% green",
    }))
  );
  console.log(`Total Execution Time: ${totalDuration}s`);
  console.log(`Total Discipline Suites: ${suites.length}`);
  console.log(`Suites Passed: ${suites.length - totalFailures}`);
  console.log(`Suites Failed: ${totalFailures}`);
  console.log("================================================================================\n");

  if (totalFailures > 0) {
    console.error(`Audit finished with ${totalFailures} failing suite(s).`);
    process.exit(1);
  } else {
    console.log("ALL QA & SECURITY AUDIT SUITES COMPLETED WITH ZERO FAILURES.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("FATAL AUDIT HARNESS ERROR:", err);
  process.exit(1);
});
