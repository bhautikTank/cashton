/**
 * Unit Verification: Reversal Event Idempotency & Multi-Stage Drawdown Logic
 * Validates:
 * 1. Stable event key generation (event ID vs cumulative amount)
 * 2. Duplicate event rejection (zero duplicate financial effects)
 * 3. Two distinct partial reversals against the same cashback
 * 4. Multi-stage drawdown calculation (heldBalance -> availableBalance -> debtBalance)
 * 5. Reversal cap enforcement (heldAmount + reversedAmount <= amount)
 */

import assert from "assert";

function generateReversalEventKey(params) {
  const { provider, externalTransactionId, eventId, cumulativeReversedAmount } = params;
  if (eventId && eventId.trim() !== "") {
    return `reversal:${provider}:${externalTransactionId}:event:${eventId.trim()}`;
  }
  return `reversal:${provider}:${externalTransactionId}:cumul:${parseFloat(cumulativeReversedAmount).toFixed(2)}`;
}

function processReversalEvent(cashback, wallet, event, processedEvents) {
  // 1. Check event idempotency
  const eventKey = generateReversalEventKey(event);
  if (processedEvents.has(eventKey)) {
    return {
      success: true,
      isDuplicate: true,
      message: "Duplicate reversal event ignored idempotently",
      wallet: { ...wallet },
      cashback: { ...cashback },
    };
  }

  // 2. Determine newly reversed delta
  let deltaReversed = 0;
  if (event.reversalAmount !== undefined) {
    deltaReversed = parseFloat(event.reversalAmount);
  } else if (event.cumulativeReversedAmount !== undefined) {
    const newCumulative = parseFloat(event.cumulativeReversedAmount);
    deltaReversed = newCumulative - cashback.reversedAmount;
  }

  if (deltaReversed <= 0) {
    return {
      success: true,
      isDuplicate: true,
      message: "No new reversed amount detected",
      wallet: { ...wallet },
      cashback: { ...cashback },
    };
  }

  // 3. Enforce invariant: heldAmount + reversedAmount <= amount
  if (cashback.reversedAmount + deltaReversed > cashback.amount) {
    throw new Error(
      `Reversal amount ₹${deltaReversed.toFixed(2)} exceeds unreversed balance (Max allowable: ₹${(
        cashback.amount - cashback.reversedAmount
      ).toFixed(2)})`
    );
  }

  let remaining = deltaReversed;
  const ledgerEntries = [];
  const updatedWallet = { ...wallet };
  const updatedCashback = { ...cashback };

  // Stage 1: Drain from heldBalance
  const fromHeld = Math.min(remaining, updatedCashback.heldAmount, updatedWallet.heldBalance);
  if (fromHeld > 0) {
    updatedWallet.heldBalance -= fromHeld;
    updatedCashback.heldAmount -= fromHeld;
    remaining -= fromHeld;
    ledgerEntries.push({
      type: "REVERSAL",
      category: "REVERSAL_FROM_HELD",
      amount: fromHeld,
      idempotencyKey: `tx:held:${eventKey}`,
    });
  }

  // Stage 2: Drain from availableBalance
  const fromAvail = Math.min(remaining, updatedWallet.availableBalance);
  if (fromAvail > 0) {
    updatedWallet.availableBalance -= fromAvail;
    remaining -= fromAvail;
    ledgerEntries.push({
      type: "REVERSAL",
      category: "REVERSAL_FROM_AVAILABLE",
      amount: fromAvail,
      idempotencyKey: `tx:avail:${eventKey}`,
    });
  }

  // Stage 3: Debt Creation for uncovered shortfall
  let debtCreated = null;
  if (remaining > 0) {
    const debtAmount = remaining;
    updatedWallet.debtBalance += debtAmount;
    debtCreated = {
      amount: debtAmount,
      remainingAmount: debtAmount,
      status: "OPEN",
      idempotencyKey: `debt:${eventKey}`,
      originatingCashbackId: cashback.id,
    };
    ledgerEntries.push({
      type: "DEBIT",
      category: "DEBT_CREATED",
      amount: debtAmount,
      idempotencyKey: `tx:debt:${eventKey}`,
    });
    remaining = 0;
  }

  // Update cumulative counters
  updatedCashback.reversedAmount += deltaReversed;
  if (updatedCashback.reversedAmount >= updatedCashback.amount) {
    updatedCashback.status = "REVERSED";
  }

  processedEvents.add(eventKey);

  return {
    success: true,
    isDuplicate: false,
    eventKey,
    deltaReversed,
    debtCreated,
    ledgerEntries,
    wallet: updatedWallet,
    cashback: updatedCashback,
  };
}

async function runTests() {
  console.log("=== RUNNING REVERSAL IDEMPOTENCY & MULTI-STAGE DRAWDOWN TESTS ===\n");
  const processedEvents = new Set();

  // Test Case 1: Initial state (Cashback ₹100, held ₹100, available ₹0, debt ₹0)
  const initialCashback = {
    id: "cb-001",
    amount: 100.0,
    heldAmount: 100.0,
    reversedAmount: 0.0,
    status: "CONFIRMED",
  };
  const initialWallet = {
    availableBalance: 0.0,
    heldBalance: 100.0,
    debtBalance: 0.0,
  };

  // 1. First partial reversal: Event A (₹40 reversed from held)
  const event1 = {
    provider: "GENERIC",
    externalTransactionId: "tx-999",
    eventId: "evt-part-1",
    reversalAmount: 40.0,
  };
  const res1 = processReversalEvent(initialCashback, initialWallet, event1, processedEvents);
  assert.strictEqual(res1.isDuplicate, false);
  assert.strictEqual(res1.deltaReversed, 40.0);
  assert.strictEqual(res1.wallet.heldBalance, 60.0);
  assert.strictEqual(res1.cashback.heldAmount, 60.0);
  assert.strictEqual(res1.cashback.reversedAmount, 40.0);
  assert.strictEqual(res1.ledgerEntries.length, 1);
  assert.strictEqual(res1.ledgerEntries[0].category, "REVERSAL_FROM_HELD");
  console.log("✓ Partial Reversal 1 processed: ₹40.00 drained from heldBalance. Remaining held: ₹60.00");

  // 2. Replay of Event A (Exact duplicate delivery)
  const res1Replay = processReversalEvent(res1.cashback, res1.wallet, event1, processedEvents);
  assert.strictEqual(res1Replay.isDuplicate, true);
  assert.strictEqual(res1Replay.wallet.heldBalance, 60.0); // NO balance change
  assert.strictEqual(res1Replay.cashback.reversedAmount, 40.0);
  console.log("✓ Replay of Event 1 detected: Idempotent no-op, zero duplicate debit.");

  // 3. Second distinct partial reversal: Event B (₹70 reversed using cumulative amount = ₹110 or delta ₹50)
  // Let's release the remaining ₹60 held into available first to test stage 2 and stage 3
  const walletReleased = {
    availableBalance: 60.0,
    heldBalance: 0.0,
    debtBalance: 0.0,
  };
  const cashbackReleased = {
    ...res1.cashback,
    heldAmount: 0.0,
    holdReleased: true,
  };

  // Now customer has available: ₹20 (withdrew ₹40), and network sends second reversal for remaining ₹60!
  walletReleased.availableBalance = 20.0; // customer spent ₹40

  const event2 = {
    provider: "GENERIC",
    externalTransactionId: "tx-999",
    eventId: "evt-part-2",
    reversalAmount: 60.0, // Remaining unreversed portion
  };
  const res2 = processReversalEvent(cashbackReleased, walletReleased, event2, processedEvents);
  assert.strictEqual(res2.isDuplicate, false);
  assert.strictEqual(res2.deltaReversed, 60.0);
  assert.strictEqual(res2.wallet.heldBalance, 0.0);
  assert.strictEqual(res2.wallet.availableBalance, 0.0); // ₹20 drained
  assert.strictEqual(res2.wallet.debtBalance, 40.0); // ₹40 created as debt
  assert.strictEqual(res2.debtCreated.amount, 40.0);
  assert.strictEqual(res2.cashback.reversedAmount, 100.0);
  assert.strictEqual(res2.cashback.status, "REVERSED");
  assert.strictEqual(res2.ledgerEntries.length, 2);
  assert.strictEqual(res2.ledgerEntries[0].category, "REVERSAL_FROM_AVAILABLE");
  assert.strictEqual(res2.ledgerEntries[1].category, "DEBT_CREATED");
  console.log("✓ Partial Reversal 2 processed: Drained ₹20.00 from available, created ₹40.00 debt.");

  // 4. Cumulative Reversal handling without event IDs (e.g. cumulative ₹100.00)
  const processedCumulative = new Set();
  const cbCumul = { id: "cb-002", amount: 200.0, heldAmount: 200.0, reversedAmount: 0.0 };
  const wCumul = { availableBalance: 0.0, heldBalance: 200.0, debtBalance: 0.0 };

  // First webhook: cumulative reversal ₹75.00
  const cEvent1 = { provider: "FLIPKART", externalTransactionId: "fk-101", cumulativeReversedAmount: "75.00" };
  const cRes1 = processReversalEvent(cbCumul, wCumul, cEvent1, processedCumulative);
  assert.strictEqual(cRes1.deltaReversed, 75.0);
  assert.strictEqual(cRes1.wallet.heldBalance, 125.0);

  // Duplicate webhook: cumulative reversal ₹75.00
  const cRes1Dup = processReversalEvent(cRes1.cashback, cRes1.wallet, cEvent1, processedCumulative);
  assert.strictEqual(cRes1Dup.isDuplicate, true);
  assert.strictEqual(cRes1Dup.wallet.heldBalance, 125.0);

  // Second partial webhook: cumulative reversal ₹125.00 (delta ₹50.00)
  const cEvent2 = { provider: "FLIPKART", externalTransactionId: "fk-101", cumulativeReversedAmount: "125.00" };
  const cRes2 = processReversalEvent(cRes1.cashback, cRes1.wallet, cEvent2, processedCumulative);
  assert.strictEqual(cRes2.deltaReversed, 50.0);
  assert.strictEqual(cRes2.wallet.heldBalance, 75.0);
  console.log("✓ Cumulative Reversal: Correctly calculated delta ₹75.00, skipped duplicate, calculated delta ₹50.00.");

  // 5. Over-reversal rejection check: total reversed > amount
  const overEvent = { provider: "FLIPKART", externalTransactionId: "fk-101", cumulativeReversedAmount: "250.00" };
  assert.throws(
    () => processReversalEvent(cRes2.cashback, cRes2.wallet, overEvent, processedCumulative),
    /exceeds unreversed balance/
  );
  console.log("✓ Over-reversal correctly rejected by invariant check.");

  console.log("\n🎉 ALL REVERSAL IDEMPOTENCY & MULTI-STAGE DRAWDOWN TESTS PASSED!");
}

runTests().catch(console.error);
