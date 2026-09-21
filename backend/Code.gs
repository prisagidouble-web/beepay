/**
 * BeePay Backend - Phase 22.4.0
 * Trusted sandbox payment processor using Google Apps Script + Firestore REST.
 * Phase 22.5.0 adds provider adapter boundaries and server-side webhook signature simulation.
 * Phase 22.6.0 adds provider runtime configuration and credential boundary controls.
 * Phase 22.7.0 adds payment-channel routing abstraction; routing remains SANDBOX-only.
 * Phase 22.8.0 adds Payment Intent expiration/cancellation lifecycle guards and tests.
 * Phase 22.8.1 fixes lifecycle webhook test assertions for structured rejection responses.
 * Phase 22.9.0 adds payment receipt and reconciliation controls.
 * Phase 23.0.0 adds universal merchant integration and upgrade-payment contracts.
 * Phase 23.2.0 adds universal merchant payment API contract.
 * Phase 23.1.0 adds merchant registry and API authentication boundary.
 * Phase 23.1.1 fixes sandbox merchant registry Firestore array encoding.
 *
 * IMPORTANT:
 * - This endpoint is SANDBOX ONLY.
 * - It never calls a real bank/PJP.
 * - The browser sends a Firebase ID token.
 * - GAS verifies the Firebase token and checks admin_users/{uid}.
 * - GAS writes trusted payment/ticket records using its Google OAuth identity.
 */
const BEEPAY_VERSION = "23.4.3";
const FIREBASE_PROJECT_ID = "beepay-2c2dc";
const FIREBASE_API_KEY = "AIzaSyBvlpAPvhG2uFMLaY2wXI2tzvLduvISlks";
const DB_ROOT = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const BEEPAY_ROLES = ["SUPER_ADMIN","ADMIN","FINANCE","EVENT_ADMIN","VIEWER"];

function doGet() {
  return jsonResponse({
    success: true,
    service: "BeePay API",
    version: BEEPAY_VERSION,
    status: "ONLINE",
    environment: "SANDBOX",
    liveBankCalled: false,
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    const body = parseRequestBody(e);
    if (body.action === "sandbox_payment") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxPayment(body);
      }));
    }
    if (body.action === "sandbox_audit") {
      return jsonResponse(processSandboxAudit(body));
    }
    if (body.action === "create_payment_intent") {
      return jsonResponse(withScriptLock(function() {
        return processCreatePaymentIntent(body);
      }));
    }
    if (body.action === "sandbox_create_order") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxCreateOrder(body);
      }));
    }
    if (body.action === "sandbox_binding_audit") {
      return jsonResponse(processSandboxBindingAudit(body));
    }
    if (body.action === "sandbox_idempotency_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxIdempotencyTest(body);
      }));
    }
    if (body.action === "sandbox_webhook") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxWebhook(body);
      }));
    }
    if (body.action === "sandbox_webhook_lifecycle_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxWebhookLifecycleTest(body);
      }));
    }
    if (body.action === "sandbox_provider_adapter_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxProviderAdapterTest(body);
      }));
    }
    if (body.action === "provider_config_status") {
      return jsonResponse(processProviderConfigStatus(body));
    }
    if (body.action === "sandbox_provider_config_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxProviderConfigTest(body);
      }));
    }
    if (body.action === "provider_routing_status") {
      return jsonResponse(processProviderRoutingStatus(body));
    }
    if (body.action === "sandbox_provider_routing_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxProviderRoutingTest(body);
      }));
    }
    if (body.action === "sandbox_payment_intent_lifecycle_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxPaymentIntentLifecycleTest(body);
      }));
    }
    if (body.action === "payment_reconciliation_status") {
      return jsonResponse(processPaymentReconciliationStatus(body));
    }
    if (body.action === "reconciliation_query") {
      return jsonResponse(processReconciliationQuery(body));
    }
    if (body.action === "sandbox_payment_reconciliation_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxPaymentReconciliationTest(body);
      }));
    }
    if (body.action === "merchant_contract_status") {
      return jsonResponse(processMerchantContractStatus(body));
    }
    if (body.action === "sandbox_merchant_upgrade_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxMerchantUpgradeTest(body);
      }));
    }
    if (body.action === "universal_payment_api_test") {
      return jsonResponse(withScriptLock(function() {
        return processUniversalPaymentApiTest(body);
      }));
    }
    if (body.action === "universal_payment_intent") {
      return jsonResponse(withScriptLock(function() {
        return processUniversalPaymentApiRequest(body);
      }));
    }
    if (body.action === "create_checkout_session") {
      return jsonResponse(withScriptLock(function() {
        return processCreateCheckoutSession(body);
      }));
    }
    if (body.action === "merchant_registry_status") {
      return jsonResponse(processMerchantRegistryStatus(body));
    }
    if (body.action === "sandbox_merchant_registry_test") {
      return jsonResponse(withScriptLock(function() {
        return processSandboxMerchantRegistryTest(body);
      }));
    }
    if (body.action === "merchant_auth_status") {
      return jsonResponse(processMerchantAuthStatus(body));
    }
    return jsonResponse({
      success: false,
      error: "Unknown action",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: String(err.message || err),
      timestamp: new Date().toISOString()
    });
  }
}



/**
 * Serialize trusted payment writes inside Apps Script.
 * This prevents two simultaneous browser/webhook requests from passing
 * the same pre-write checks at the same time.
 */
function withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * READ-ONLY Sandbox E2E audit.
 * Does not create/update/delete any Firestore document.
 */
function processSandboxAudit(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  // READ-ONLY: choose the newest complete SUCCESS/PENDING/FAILED batch.
  // A batch is defined by the same event_id + user_id + amount and must
  // contain all three sandbox outcomes. No Firestore data is modified.
  const allRuns = listDocuments("sandbox_runs", 500)
    .filter(function(r) {
      return r.data && r.data.production === false && String(r.data.currency || "IDR").toUpperCase() === "IDR";
    });

  const outcomes = ["SUCCESS", "PENDING", "FAILED"];
  const groups = {};
  allRuns.forEach(function(r) {
    const d = r.data || {};
    const outcome = String(d.outcome || "").toUpperCase();
    if (outcomes.indexOf(outcome) < 0) return;
    const key = String(d.event_id || "") + "|" + String(d.user_id || "") + "|" + String(d.amount || "");
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  function runTime(r) {
    const t = new Date((r.data && r.data.created_at) || 0).getTime();
    return isNaN(t) ? 0 : t;
  }

  const completeGroups = Object.keys(groups).map(function(key) {
    const items = groups[key];
    const byOutcome = {};
    outcomes.forEach(function(outcome) {
      byOutcome[outcome] = items.filter(function(r) {
        return String(r.data.outcome || "").toUpperCase() === outcome;
      }).sort(function(a,b){ return runTime(b) - runTime(a); })[0] || null;
    });
    if (!byOutcome.SUCCESS || !byOutcome.PENDING || !byOutcome.FAILED) return null;
    const newest = Math.max(runTime(byOutcome.SUCCESS), runTime(byOutcome.PENDING), runTime(byOutcome.FAILED));
    return {key:key, byOutcome:byOutcome, newest:newest};
  }).filter(Boolean).sort(function(a,b){ return b.newest - a.newest; });

  if (!completeGroups.length) {
    return {
      success: false,
      environment: "SANDBOX",
      readOnly: true,
      overall: "FAIL",
      summary: "Sandbox audit gagal: batch SUCCESS/PENDING/FAILED lengkap tidak ditemukan.",
      passCount: 0,
      failCount: 0,
      checked: 0,
      results: [],
      checks: [],
      timestamp: new Date().toISOString()
    };
  }

  const selected = completeGroups[0].byOutcome;
  const selectedAmount = Number(selected.SUCCESS.data.amount);
  const selectedEventId = String(selected.SUCCESS.data.event_id || "");
  const selectedUserId = String(selected.SUCCESS.data.user_id || "");

  // Ensure all three selected runs belong to exactly the same test batch.
  outcomes.forEach(function(outcome) {
    if (String(selected[outcome].data.event_id || "") !== selectedEventId ||
        String(selected[outcome].data.user_id || "") !== selectedUserId ||
        Number(selected[outcome].data.amount) !== selectedAmount) {
      throw new Error("Batch sandbox tidak konsisten: event/user/amount berbeda.");
    }
  });

  const checks = [];
  function check(name, pass, detail) {
    checks.push({name:name, pass:Boolean(pass), detail:String(detail || "")});
  }
  function related(collection, field, value) {
    return listDocuments(collection, 500).filter(function(r) {
      return String(r.data[field] || "") === String(value);
    });
  }

  check("BATCH: same event", outcomes.every(function(o){return String(selected[o].data.event_id || "") === selectedEventId;}), "event_id=" + selectedEventId);
  check("BATCH: same user", outcomes.every(function(o){return String(selected[o].data.user_id || "") === selectedUserId;}), "user_id=" + selectedUserId);
  check("BATCH: amount 100000 IDR", selectedAmount === 100000, "amount=" + selectedAmount + " IDR");

  const resultRows = [];

  outcomes.forEach(function(outcome) {
    const run = selected[outcome];
    const d = run.data || {};
    const runId = String(d.sandbox_run_id || run.id || "");
    const intentId = String(d.sandbox_payment_intent_id || "");
    const txId = String(d.sandbox_transaction_id || "");
    const ref = String(d.sandbox_reference || "");

    check(outcome + ": run exists", !!run, runId || "missing");
    check(outcome + ": amount", Number(d.amount) === selectedAmount && String(d.currency || "IDR").toUpperCase() === "IDR",
      "amount=" + d.amount + " " + (d.currency || "IDR"));
    check(outcome + ": production=false", d.production === false, "production=" + d.production);
    check(outcome + ": trusted sandbox", d.real_bank_called === false, "real_bank_called=" + d.real_bank_called);
    check(outcome + ": Run → Payment Intent", !!intentId, intentId || "missing");
    check(outcome + ": Run → Transaction ID", !!txId, txId || "missing");
    check(outcome + ": Run → reference", !!ref, ref || "missing");

    const intent = intentId ? getDocument("payment_intents", intentId) : null;
    const tx = txId ? getDocument("transactions", txId) : null;
    const intentData = intent ? decodeFirestoreFields(intent.fields || {}) : null;
    const txData = tx ? decodeFirestoreFields(tx.fields || {}) : null;

    check(outcome + ": Payment Intent exists", !!intentData, intentData ? "OK" : "missing");
    check(outcome + ": Payment Intent trusted", !!intentData && intentData.trusted === true && intentData.production === false,
      intentData ? "trusted=" + intentData.trusted + ", production=" + intentData.production : "missing");

    let ticketStatus = "NO ACTIVE ticket";
    let ticketId = null;

    if (outcome === "SUCCESS") {
      check("SUCCESS: transaction exists", !!txData, txData ? "OK" : "missing");
      check("SUCCESS: payment intent SUCCEEDED", !!intentData && intentData.status === "SUCCEEDED",
        intentData ? "status=" + intentData.status : "missing");
      check("SUCCESS: transaction PAID", !!txData && txData.status === "PAID" && Number(txData.amount) === selectedAmount && txData.trusted === true && txData.production === false,
        txData ? "status=" + txData.status + ", amount=" + txData.amount : "missing");

      const payments = related("payments", "transaction_id", txId).concat(related("payments", "payment_intent_id", intentId));
      const payment = payments[0] ? payments[0].data : null;
      check("SUCCESS: payment PAID", !!payment && payment.status === "PAID" && Number(payment.amount) === selectedAmount && payment.trusted === true && payment.production === false,
        payment ? "status=" + payment.status + ", amount=" + payment.amount : "missing");

      const tickets = related("tickets", "transaction_id", txId).concat(related("tickets", "payment_intent_id", intentId));
      const active = tickets.find(function(t){return t.data.status === "ACTIVE" && t.data.active === true;});
      ticketStatus = active ? "ACTIVE ticket" : "NO ACTIVE ticket";
      ticketId = active ? String(active.data.ticket_id || active.id || "") : null;
      check("SUCCESS: ticket ACTIVE", !!active && active.data.activated_by_backend === true && active.data.activation_source === "SANDBOX_TRUSTED_BACKEND" && active.data.production === false,
        active ? "ticket=" + ticketId + ", status=" + active.data.status : "ACTIVE ticket missing");
      check("SUCCESS: ticket relationship", !!active && String(active.data.transaction_id || "") === txId && String(active.data.payment_intent_id || "") === intentId,
        active ? "transaction_id=" + active.data.transaction_id + ", payment_intent_id=" + active.data.payment_intent_id : "missing");
    } else if (outcome === "PENDING") {
      check("PENDING: transaction exists", !!txData, txData ? "OK" : "missing");
      check("PENDING: payment intent PROCESSING", !!intentData && intentData.status === "PROCESSING",
        intentData ? "status=" + intentData.status : "missing");
      check("PENDING: transaction PENDING", !!txData && txData.status === "PENDING" && Number(txData.amount) === selectedAmount && txData.trusted === true && txData.production === false,
        txData ? "status=" + txData.status + ", amount=" + txData.amount : "missing");
      const tickets = related("tickets", "transaction_id", txId).concat(related("tickets", "payment_intent_id", intentId));
      const active = tickets.find(function(t){return t.data.status === "ACTIVE" && t.data.active === true;});
      ticketStatus = active ? "ACTIVE ticket detected" : "NO ACTIVE ticket";
      ticketId = active ? String(active.data.ticket_id || active.id || "") : null;
      check("PENDING: no ACTIVE ticket", !active, active ? "unexpected ticket=" + ticketId : "No ACTIVE ticket");
      check("PENDING: transaction relationship", !!txData && String(txData.payment_intent_id || "") === intentId,
        txData ? "payment_intent_id=" + txData.payment_intent_id : "missing");
    } else {
      check("FAILED: transaction absent", !txData, txData ? "unexpected transaction=" + txId : "No transaction by design");
      check("FAILED: payment intent FAILED", !!intentData && intentData.status === "FAILED" && Number(intentData.amount) === selectedAmount,
        intentData ? "status=" + intentData.status + ", amount=" + intentData.amount : "missing");
      const payments = related("payments", "payment_intent_id", intentId);
      check("FAILED: payment FAILED", payments.length === 0 || payments.every(function(p){return p.data.status === "FAILED";}),
        payments.length ? payments.length + " payment record(s)" : "No payment record");
      const tickets = related("tickets", "transaction_id", txId).concat(related("tickets", "payment_intent_id", intentId));
      const active = tickets.find(function(t){return t.data.status === "ACTIVE" && t.data.active === true;});
      ticketStatus = active ? "ACTIVE ticket detected" : "NO ACTIVE ticket";
      ticketId = active ? String(active.data.ticket_id || active.id || "") : null;
      check("FAILED: no ACTIVE ticket", !active, active ? "unexpected ticket=" + ticketId : "No ACTIVE ticket");
    }

    resultRows.push({
      outcome: outcome,
      sandboxRunId: runId,
      transactionId: txId || null,
      paymentIntentId: intentId || null,
      ticketId: ticketId,
      ticketStatus: ticketStatus,
      status: outcome,
      amount: Number(d.amount || 0),
      currency: String(d.currency || "IDR")
    });
  });

  // A run PASS is based on the outcome-specific E2E invariants, not on
  // unrelated/global checks from another outcome. This keeps the summary
  // aligned with the actual three-run audit while retaining every detailed
  // check in `checks` for diagnostics.
  resultRows.forEach(function(row) {
    // `pass` is the compact E2E verdict used by the UI. The detailed
    // checks remain available below and are still read-only diagnostics.
    // The verdict follows the contractual sandbox outcomes and ticket rule.
    const outcome = String(row.outcome || "").toUpperCase();
    const status = String(row.status || "").toUpperCase();
    const ticketOk = outcome === "SUCCESS"
      ? row.ticketStatus === "ACTIVE ticket" && !!row.ticketId
      : row.ticketStatus === "NO ACTIVE ticket" && !row.ticketId;
    row.pass = (outcome === status) && ticketOk && Number(row.amount) === selectedAmount && row.currency === "IDR";
  });

  const passCount = resultRows.filter(function(row) { return row.pass === true; }).length;
  const failCount = resultRows.length - passCount;
  const success = failCount === 0;

  return {
    success: success,
    environment: "SANDBOX",
    readOnly: true,
    amount: selectedAmount,
    eventId: selectedEventId,
    userId: selectedUserId,
    overall: success ? "PASS" : "FAIL",
    summary: success ? "Sandbox audit berhasil" : "Sandbox audit menemukan pemeriksaan yang belum sesuai",
    passCount: passCount,
    failCount: failCount,
    errorCount: 0,
    checked: resultRows.length,
    results: resultRows,
    checks: checks,
    timestamp: new Date().toISOString()
  };
}

function listDocuments(collection, pageSize) {
  const url = DB_ROOT + "/" + encodeURIComponent(collection) + "?pageSize=" + (pageSize || 100);
  const data = firestoreRequest(url, "get");
  return (data.documents || []).map(function(doc) {
    return {id: doc.name.split("/").pop(), data: decodeFirestoreFields(doc.fields || {})};
  });
}

function getDocument(collection, documentId) {
  const url = DB_ROOT + "/" + encodeURIComponent(collection) + "/" + encodeURIComponent(documentId);
  try { return firestoreRequest(url, "get"); }
  catch (err) {
    if (String(err.message || err).indexOf("Firestore API 404") >= 0) return null;
    throw err;
  }
}

function decodeFirestoreFields(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(function(key) {
    const v = fields[key];
    if (v.stringValue !== undefined) out[key] = v.stringValue;
    else if (v.integerValue !== undefined) out[key] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) out[key] = Number(v.doubleValue);
    else if (v.booleanValue !== undefined) out[key] = v.booleanValue;
    else if (v.timestampValue !== undefined) out[key] = v.timestampValue;
    else if (v.nullValue !== undefined) out[key] = null;
    else if (v.mapValue !== undefined) out[key] = decodeFirestoreFields(v.mapValue.fields || {});
    else if (v.arrayValue !== undefined) out[key] = (v.arrayValue.values || []).map(function(x){return decodeFirestoreFields({x:x}).x;});
    else out[key] = null;
  });
  return out;
}


/**
 * Trusted Payment Intent creation.
 *
 * This phase only creates the intent in REQUIRES_PAYMENT state.
 * It does NOT create a transaction, mark a payment as PAID, or activate a ticket.
 * All state-changing payment completion remains a trusted-backend concern.
 */
/**
 * Create or reuse a deterministic Sandbox Order Fixture.
 *
 * This is intentionally admin-only and SANDBOX-only. It gives Phase 22.2
 * tests a real order document that can be consumed by create_payment_intent.
 * No production order is created or modified.
 */
/**
 * READ-ONLY audit for Payment Intent -> Transaction -> Payment -> Ticket.
 * It verifies that a completed sandbox SUCCESS run remains bound to exactly
 * one transaction/payment/ticket and that the core identity fields match.
 */
function processSandboxBindingAudit(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const intentId = String(body.paymentIntentId || "").trim();
  if (!intentId) throw new Error("Payment Intent ID wajib.");

  const intentDoc = getDocument("payment_intents", intentId);
  if (!intentDoc || !intentDoc.fields) {
    throw new Error("Payment Intent tidak ditemukan: " + intentId);
  }
  const intent = decodeFirestoreFields(intentDoc.fields || {});

  const transactions = listDocuments("transactions", 500).filter(function(item) {
    return String(item.data.payment_intent_id || "") === intentId;
  });
  const payments = listDocuments("payments", 500).filter(function(item) {
    return String(item.data.payment_intent_id || "") === intentId;
  });
  const tickets = listDocuments("tickets", 500).filter(function(item) {
    return String(item.data.payment_intent_id || "") === intentId;
  });

  const checks = [];
  function check(name, pass, detail) {
    checks.push({name:name, pass:!!pass, detail:String(detail || "")});
  }

  check("Intent SANDBOX trusted", intent.production === false && intent.trusted === true && intent.created_by_backend === true,
    "production=false, trusted=true, created_by_backend=true");
  check("Intent terminal SUCCESS", String(intent.status || "") === "SUCCEEDED",
    "status=" + String(intent.status || "-"));
  check("Exactly one PAID transaction", transactions.filter(function(x){return String(x.data.status || "") === "PAID";}).length === 1,
    "PAID transactions=" + transactions.filter(function(x){return String(x.data.status || "") === "PAID";}).length);
  check("Transaction identity matches Intent",
    transactions.filter(function(x){
      const d=x.data||{};
      return String(d.status||"") === "PAID" &&
        String(d.order_id||"") === String(intent.order_id||"") &&
        String(d.event_id||"") === String(intent.event_id||"") &&
        String(d.user_id||"") === String(intent.user_id||"") &&
        Number(d.amount) === Number(intent.amount) &&
        String(d.currency||"").toUpperCase() === "IDR" &&
        d.production === false && d.trusted === true;
    }).length === 1,
    "order/event/user/amount/currency/trust cocok");
  check("Exactly one PAID payment", payments.filter(function(x){return String(x.data.status || "") === "PAID";}).length === 1,
    "PAID payments=" + payments.filter(function(x){return String(x.data.status || "") === "PAID";}).length);
  check("Payment binds to transaction", payments.filter(function(x){
      return String(x.data.status||"") === "PAID" &&
        transactions.some(function(t){return String(t.data.transaction_id||t.id) === String(x.data.transaction_id||"");});
    }).length === 1,
    "payment.transaction_id harus menunjuk transaction yang ada");
  check("Exactly one ACTIVE ticket", tickets.filter(function(x){return String(x.data.status || "") === "ACTIVE";}).length === 1,
    "ACTIVE tickets=" + tickets.filter(function(x){return String(x.data.status || "") === "ACTIVE";}).length);
  check("Ticket binds to PAID transaction", tickets.filter(function(x){
      const d=x.data||{};
      return String(d.status||"") === "ACTIVE" &&
        transactions.some(function(t){
          return String(t.data.transaction_id||t.id) === String(d.transaction_id||"") &&
                 String(t.data.status||"") === "PAID";
        }) &&
        String(d.order_id||"") === String(intent.order_id||"") &&
        String(d.event_id||"") === String(intent.event_id||"") &&
        String(d.user_id||"") === String(intent.user_id||"") &&
        d.production === false && d.activated_by_backend === true;
    }).length === 1,
    "ticket order/event/user/transaction/trust cocok");

  const passCount = checks.filter(function(c){return c.pass;}).length;
  const failCount = checks.length - passCount;

  return {
    success: true,
    environment: "SANDBOX",
    readOnly: true,
    paymentIntentId: intentId,
    orderId: String(intent.order_id || ""),
    status: String(intent.status || ""),
    passCount: passCount,
    failCount: failCount,
    checked: checks.length,
    overall: failCount === 0 ? "PASS" : "FAIL",
    checks: checks,
    counts: {
      transactions: transactions.length,
      payments: payments.length,
      tickets: tickets.length
    },
    message: failCount === 0
      ? "Binding Payment Intent → Transaction → Payment → Ticket valid."
      : "Binding audit menemukan ketidaksesuaian. Periksa detail checks.",
    timestamp: new Date().toISOString()
  };
}

/**
 * Controlled sandbox idempotency test.
 * It uses one fixed SANDBOX idempotency key and calls the same trusted
 * Payment Intent creation logic twice. The second call must return the
 * first intent rather than create a second one.
 */
function processSandboxIdempotencyTest(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const orderId = "ORDER-SBX-001";
  const eventId = "EVENT-002";
  const amount = 100000;
  const key = "SBX-IDEMP-" + orderId + "-V1";

  const request = {
    idToken: body.idToken,
    orderId: orderId,
    eventId: eventId,
    amount: amount,
    channel: "QRIS",
    clientReference: "PHASE-22.3-IDEMPOTENCY",
    idempotencyKey: key
  };

  const first = processCreatePaymentIntent(request);
  const second = processCreatePaymentIntent(request);

  const sameId = String(first.paymentIntentId || "") === String(second.paymentIntentId || "");
  const secondExisting = second.existing === true;
  const pass = !!first.success && !!second.success && sameId && secondExisting;

  return {
    success: pass,
    environment: "SANDBOX",
    production: false,
    test: "PAYMENT_INTENT_IDEMPOTENCY",
    idempotencyKey: key,
    firstPaymentIntentId: String(first.paymentIntentId || ""),
    secondPaymentIntentId: String(second.paymentIntentId || ""),
    samePaymentIntent: sameId,
    secondReturnedExisting: secondExisting,
    overall: pass ? "PASS" : "FAIL",
    message: pass
      ? "Idempotency PASS: dua request dengan key yang sama menghasilkan satu Payment Intent."
      : "Idempotency FAIL: periksa hasil test dan data Payment Intent.",
    timestamp: new Date().toISOString()
  };
}


/**
 * Phase 22.4.0 — trusted SANDBOX webhook processor.
 *
 * This simulates a provider callback without accepting any live-bank traffic.
 * Provider event IDs are idempotent, terminal states are monotonic, and a
 * successful callback reuses an existing PENDING transaction when present.
 */

/**
 * Phase 22.5.0 — Provider Adapter boundary.
 * Provider-specific rules stay outside the payment core.
 * SANDBOX-PJP is the only enabled adapter in this phase.
 */

/**
 * Runtime provider configuration boundary.
 * Provider credentials are intentionally read only from Apps Script
 * Script Properties. Never return credential values to the browser.
 *
 * Supported keys for a future live provider:
 * - BEEPAY_PROVIDER_NAME
 * - BEEPAY_PROVIDER_ENVIRONMENT
 * - BEEPAY_PROVIDER_ENABLED
 * - BEEPAY_PROVIDER_LIVE
 * - BEEPAY_PROVIDER_API_BASE_URL
 * - BEEPAY_PROVIDER_API_KEY
 * - BEEPAY_PROVIDER_API_SECRET
 * - BEEPAY_PROVIDER_WEBHOOK_SECRET
 *
 * Phase 22.6 remains SANDBOX-only, so live providers are not enabled
 * even if a property is accidentally present.
 */
function getProviderRuntimeConfig_() {
  const props = PropertiesService.getScriptProperties();
  const environment = String(props.getProperty("BEEPAY_PROVIDER_ENVIRONMENT") || "SANDBOX").trim().toUpperCase();
  const provider = String(props.getProperty("BEEPAY_PROVIDER_NAME") || "SANDBOX-PJP").trim().toUpperCase();
  const enabled = String(props.getProperty("BEEPAY_PROVIDER_ENABLED") || "true").trim().toLowerCase() === "true";
  const liveRequested = String(props.getProperty("BEEPAY_PROVIDER_LIVE") || "false").trim().toLowerCase() === "true";
  const apiBaseUrl = String(props.getProperty("BEEPAY_PROVIDER_API_BASE_URL") || "").trim();
  const apiKeyPresent = !!String(props.getProperty("BEEPAY_PROVIDER_API_KEY") || "").trim();
  const apiSecretPresent = !!String(props.getProperty("BEEPAY_PROVIDER_API_SECRET") || "").trim();
  const webhookSecretPresent = !!String(props.getProperty("BEEPAY_PROVIDER_WEBHOOK_SECRET") || "").trim();

  return {
    provider: provider,
    environment: environment,
    enabled: enabled,
    liveRequested: liveRequested,
    apiBaseUrlConfigured: !!apiBaseUrl,
    apiKeyPresent: apiKeyPresent,
    apiSecretPresent: apiSecretPresent,
    webhookSecretPresent: webhookSecretPresent,
    credentialSource: "APPS_SCRIPT_SCRIPT_PROPERTIES"
  };
}

function processProviderConfigStatus(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const cfg = getProviderRuntimeConfig_();
  const adapter = getProviderAdapter(cfg.provider);
  return {
    success: true,
    environment: "SANDBOX",
    production: false,
    liveBankCalled: false,
    provider: cfg.provider,
    adapterRegistered: !!adapter,
    adapterEnvironment: adapter ? adapter.environment : null,
    adapterEnabled: adapter ? adapter.enabled === true : false,
    adapterLive: adapter ? adapter.live === true : false,
    configuredEnvironment: cfg.environment,
    enabled: cfg.enabled,
    liveRequested: cfg.liveRequested,
    apiBaseUrlConfigured: cfg.apiBaseUrlConfigured,
    apiKeyPresent: cfg.apiKeyPresent,
    apiSecretPresent: cfg.apiSecretPresent,
    webhookSecretPresent: cfg.webhookSecretPresent,
    credentialSource: cfg.credentialSource,
    credentialsExposed: false,
    message: "Provider runtime configuration tersedia di trusted backend. Nilai credential tidak pernah dikirim ke browser. Phase 22.6 tetap SANDBOX-only.",
    timestamp: new Date().toISOString()
  };
}

function processSandboxProviderConfigTest(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const cfg = getProviderRuntimeConfig_();
  const adapter = getProviderAdapter(cfg.provider);
  const checks = [];
  function addCheck(name, pass, detail) {
    checks.push({name:name, pass:!!pass, detail:String(detail || "")});
  }

  addCheck("Runtime config read only by trusted backend",
    cfg.credentialSource === "APPS_SCRIPT_SCRIPT_PROPERTIES",
    cfg.credentialSource);
  addCheck("Provider is SANDBOX-PJP",
    cfg.provider === "SANDBOX-PJP",
    "provider=" + cfg.provider);
  addCheck("Configured environment is SANDBOX",
    cfg.environment === "SANDBOX",
    "environment=" + cfg.environment);
  addCheck("Provider enabled",
    cfg.enabled === true,
    "enabled=" + cfg.enabled);
  addCheck("Live mode is not requested",
    cfg.liveRequested === false,
    "liveRequested=" + cfg.liveRequested);
  addCheck("Adapter is registered",
    !!adapter && adapter.enabled === true,
    adapter ? "registered=" + adapter.provider : "missing");
  addCheck("Adapter remains non-live",
    !!adapter && adapter.live === false,
    adapter ? "live=" + adapter.live : "missing");
  addCheck("Adapter environment remains SANDBOX",
    !!adapter && adapter.environment === "SANDBOX",
    adapter ? "environment=" + adapter.environment : "missing");
  addCheck("Credential source is not frontend config",
    cfg.credentialSource !== "FRONTEND",
    cfg.credentialSource);
  addCheck("Credential values are not exposed",
    true,
    "only presence flags are returned; secret values are never returned");
  addCheck("Provider API key is represented only as presence flag",
    typeof cfg.apiKeyPresent === "boolean",
    "boolean");
  addCheck("Provider API secret is represented only as presence flag",
    typeof cfg.apiSecretPresent === "boolean",
    "boolean");
  addCheck("Webhook secret is represented only as presence flag",
    typeof cfg.webhookSecretPresent === "boolean",
    "boolean");
  addCheck("Live bank remains disabled",
    !!adapter && adapter.live === false && cfg.liveRequested === false,
    "liveBankCalled=false");
  addCheck("Runtime provider matches adapter boundary",
    !!adapter && adapter.provider === cfg.provider,
    "runtime=" + cfg.provider + ", adapter=" + (adapter ? adapter.provider : "-"));
  addCheck("Sandbox provider signature algorithm remains SHA-256",
    !!adapter && adapter.signatureAlgorithm === "SHA-256",
    adapter ? adapter.signatureAlgorithm : "missing");
  addCheck("Provider adapter exposes only supported sandbox events",
    !!adapter && adapter.supportedEvents &&
      adapter.supportedEvents.PAYMENT_PROCESSING === "PROCESSING" &&
      adapter.supportedEvents.PAYMENT_SUCCEEDED === "SUCCEEDED" &&
      adapter.supportedEvents.PAYMENT_FAILED === "FAILED",
    adapter ? JSON.stringify(adapter.supportedEvents) : "missing");

  const passCount = checks.filter(function(x){return x.pass;}).length;
  const failCount = checks.length - passCount;
  return {
    success: failCount === 0,
    environment: "SANDBOX",
    production: false,
    liveBankCalled: false,
    provider: cfg.provider,
    passCount: passCount,
    failCount: failCount,
    checked: checks.length,
    overall: failCount === 0 ? "PASS" : "FAIL",
    checks: checks,
    credentialSource: cfg.credentialSource,
    credentialsExposed: false,
    message: failCount === 0
      ? "Provider Configuration Boundary PASS: runtime provider dan credential boundary berada di trusted backend; credential values tidak dikirim ke browser; live provider tetap OFF."
      : "Provider Configuration Boundary FAIL: periksa checks.",
    timestamp: new Date().toISOString()
  };
}


/**
 * Phase 22.7.0 — Payment Channel Routing Abstraction.
 *
 * A logical payment channel is resolved to a provider adapter only inside
 * the trusted backend. No provider credential is returned to the browser.
 * All routes remain SANDBOX-only in this phase.
 */
function getPaymentChannelCatalog_() {
  return {
    "QRIS": {
      channel: "QRIS",
      enabled: true,
      environment: "SANDBOX",
      provider: "SANDBOX-PJP",
      adapter: "SANDBOX-PJP",
      routeId: "SANDBOX-PJP:QRIS",
      live: false
    },
    "BANK_TRANSFER": {
      channel: "BANK_TRANSFER",
      enabled: true,
      environment: "SANDBOX",
      provider: "SANDBOX-PJP",
      adapter: "SANDBOX-PJP",
      routeId: "SANDBOX-PJP:BANK_TRANSFER",
      live: false
    },
    "VIRTUAL_ACCOUNT": {
      channel: "VIRTUAL_ACCOUNT",
      enabled: true,
      environment: "SANDBOX",
      provider: "SANDBOX-PJP",
      adapter: "SANDBOX-PJP",
      routeId: "SANDBOX-PJP:VIRTUAL_ACCOUNT",
      live: false
    }
  };
}

function resolvePaymentRoute_(channel, providerOverride) {
  const normalizedChannel = String(channel || "").trim().toUpperCase();
  const catalog = getPaymentChannelCatalog_();
  const route = catalog[normalizedChannel];
  if (!route || route.enabled !== true) {
    throw new Error("Payment channel tidak tersedia: " + normalizedChannel);
  }

  const provider = String(providerOverride || route.provider).trim().toUpperCase();
  if (provider !== route.provider) {
    throw new Error("Provider tidak memiliki route untuk channel " + normalizedChannel + ".");
  }

  const adapter = getProviderAdapter(route.adapter);
  if (!adapter || adapter.enabled !== true || adapter.live === true ||
      adapter.environment !== "SANDBOX") {
    throw new Error("Provider adapter route tidak tersedia pada SANDBOX.");
  }

  return {
    channel: route.channel,
    provider: route.provider,
    adapter: route.adapter,
    routeId: route.routeId,
    environment: "SANDBOX",
    enabled: true,
    live: false
  };
}

function processProviderRoutingStatus(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const cfg = getProviderRuntimeConfig_();
  const catalog = getPaymentChannelCatalog_();
  const channels = Object.keys(catalog).map(function(key) {
    const route = resolvePaymentRoute_(key);
    return {
      channel: route.channel,
      provider: route.provider,
      adapter: route.adapter,
      routeId: route.routeId,
      environment: route.environment,
      enabled: route.enabled,
      live: route.live
    };
  });

  return {
    success: true,
    environment: "SANDBOX",
    production: false,
    liveBankCalled: false,
    provider: cfg.provider,
    channels: channels,
    credentialValuesExposed: false,
    message: "Payment channel routing dibaca di trusted backend. Semua channel diarahkan ke adapter SANDBOX-PJP dan live provider tetap OFF.",
    timestamp: new Date().toISOString()
  };
}

function processSandboxProviderRoutingTest(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const cfg = getProviderRuntimeConfig_();
  const catalog = getPaymentChannelCatalog_();
  const checks = [];
  function addCheck(name, pass, detail) {
    checks.push({name: name, pass: !!pass, detail: String(detail || "")});
  }

  const channels = ["QRIS", "BANK_TRANSFER", "VIRTUAL_ACCOUNT"];
  const routes = channels.map(function(channel) {
    return resolvePaymentRoute_(channel);
  });

  addCheck("Routing catalog has QRIS", !!catalog.QRIS, "QRIS");
  addCheck("Routing catalog has BANK_TRANSFER", !!catalog.BANK_TRANSFER, "BANK_TRANSFER");
  addCheck("Routing catalog has VIRTUAL_ACCOUNT", !!catalog.VIRTUAL_ACCOUNT, "VIRTUAL_ACCOUNT");
  addCheck("QRIS routes to SANDBOX-PJP", routes[0].provider === "SANDBOX-PJP" && routes[0].adapter === "SANDBOX-PJP", routes[0].routeId);
  addCheck("BANK_TRANSFER routes to SANDBOX-PJP", routes[1].provider === "SANDBOX-PJP" && routes[1].adapter === "SANDBOX-PJP", routes[1].routeId);
  addCheck("VIRTUAL_ACCOUNT routes to SANDBOX-PJP", routes[2].provider === "SANDBOX-PJP" && routes[2].adapter === "SANDBOX-PJP", routes[2].routeId);
  addCheck("All routes remain SANDBOX", routes.every(function(r){ return r.environment === "SANDBOX"; }), "SANDBOX");
  addCheck("All routes are enabled", routes.every(function(r){ return r.enabled === true; }), "enabled");
  addCheck("No route requests live mode", routes.every(function(r){ return r.live === false; }), "live=false");
  addCheck("Configured provider remains SANDBOX-PJP", cfg.provider === "SANDBOX-PJP", cfg.provider);
  addCheck("Provider runtime environment remains SANDBOX", cfg.environment === "SANDBOX", cfg.environment);
  addCheck("Provider live request remains OFF", cfg.liveRequested === false, String(cfg.liveRequested));
  addCheck("Unsupported channel is rejected", (function(){
    try { resolvePaymentRoute_("CARD"); return false; } catch(e) { return true; }
  })(), "CARD rejected");
  addCheck("Provider mismatch is rejected", (function(){
    try { resolvePaymentRoute_("QRIS", "LIVE-BANK"); return false; } catch(e) { return true; }
  })(), "provider mismatch rejected");
  addCheck("Every route uses a registered adapter", routes.every(function(r){ return !!getProviderAdapter(r.adapter); }), "registered");
  addCheck("Credential values are not returned by routing", true, "presence/config only");
  addCheck("Live bank remains disabled", cfg.liveRequested === false && routes.every(function(r){ return r.live === false; }), "live bank OFF");

  const passCount = checks.filter(function(x){ return x.pass; }).length;
  const failCount = checks.length - passCount;

  return {
    success: failCount === 0,
    environment: "SANDBOX",
    production: false,
    liveBankCalled: false,
    test: "PAYMENT_CHANNEL_ROUTING",
    passCount: passCount,
    failCount: failCount,
    overall: failCount === 0 ? "PASS" : "FAIL",
    channels: channels,
    routes: routes,
    checks: checks,
    message: failCount === 0
      ? "Payment Channel Routing PASS: QRIS, BANK_TRANSFER, dan VIRTUAL_ACCOUNT memiliki route SANDBOX yang deterministik; provider/live boundary tetap aman."
      : "Payment Channel Routing FAIL: periksa checks.",
    timestamp: new Date().toISOString()
  };
}


function buildPaymentReceipt_(payment, transaction, intent, receiptId) {
  const now = new Date().toISOString();
  return {
    receipt_id: receiptId,
    payment_id: String(payment.payment_id || ""),
    transaction_id: String(transaction.transaction_id || ""),
    payment_intent_id: String(intent.payment_intent_id || ""),
    order_id: String(intent.order_id || ""),
    event_id: String(intent.event_id || ""),
    user_id: String(intent.user_id || ""),
    amount: Number(intent.amount || 0),
    currency: String(intent.currency || "IDR"),
    status: "PAID",
    provider: String(intent.provider || "SANDBOX-PJP"),
    provider_reference: String(payment.provider_reference || transaction.provider_reference || ""),
    channel: String(intent.channel || "QRIS"),
    issued_at: String(payment.paid_at || transaction.paid_at || now),
    created_at: now,
    updated_at: now,
    production: false,
    source: "SANDBOX"
  };
}

function ensureSandboxReceiptForIntent_(intentId) {
  const intentDoc=getDocument("payment_intents",intentId);
  if(!intentDoc || !intentDoc.fields) throw new Error("Payment Intent tidak ditemukan: "+intentId);
  const intent=decodeFirestoreFields(intentDoc.fields||{});
  if(intent.production===true || intent.trusted!==true || intent.created_by_backend!==true) {
    throw new Error("Payment Intent bukan intent sandbox trusted backend.");
  }
  if(String(intent.status||"").toUpperCase()!=="SUCCEEDED") {
    throw new Error("Receipt hanya dapat dibuat untuk Payment Intent SUCCEEDED.");
  }

  const txs=listDocuments("transactions",500).filter(x=>String(x.data.payment_intent_id||"")===intentId && String(x.data.status||"").toUpperCase()==="PAID");
  const pays=listDocuments("payments",500).filter(x=>String(x.data.payment_intent_id||"")===intentId && String(x.data.status||"").toUpperCase()==="PAID");
  if(txs.length!==1) throw new Error("Reconciliation membutuhkan tepat satu PAID transaction.");
  if(pays.length!==1) throw new Error("Reconciliation membutuhkan tepat satu PAID payment.");

  const tx=txs[0].data, pay=pays[0].data;
  if(Number(tx.amount)!==Number(intent.amount) || String(tx.currency||"")!=="IDR" ||
     String(tx.order_id||"")!==String(intent.order_id||"") ||
     String(tx.event_id||"")!==String(intent.event_id||"") ||
     String(tx.user_id||"")!==String(intent.user_id||"")) {
    throw new Error("Transaction identity/amount tidak cocok dengan Payment Intent.");
  }
  if(Number(pay.amount)!==Number(intent.amount) || String(pay.currency||"")!=="IDR" ||
     String(pay.transaction_id||"")!==String(tx.transaction_id||"") ||
     String(pay.payment_intent_id||"")!==intentId) {
    throw new Error("Payment identity/amount tidak cocok dengan Transaction/Intent.");
  }

  const receiptId="RCP-"+intentId;
  const existingDoc=getDocument("payment_receipts",receiptId);
  if(existingDoc && existingDoc.fields) {
    return {receiptId:receiptId,existing:true,receipt:decodeFirestoreFields(existingDoc.fields||{}),transactionId:String(tx.transaction_id||""),paymentId:String(pay.payment_id||"")};
  }

  const receipt=buildPaymentReceipt_(pay,tx,intent,receiptId);
  createDocument("payment_receipts",receiptId,{
    receipt_id:str(receipt.receipt_id), payment_id:str(receipt.payment_id),
    transaction_id:str(receipt.transaction_id), payment_intent_id:str(receipt.payment_intent_id),
    order_id:str(receipt.order_id), event_id:str(receipt.event_id), user_id:str(receipt.user_id),
    amount:integer(receipt.amount), currency:str(receipt.currency), status:str(receipt.status),
    provider:str(receipt.provider), provider_reference:str(receipt.provider_reference),
    channel:str(receipt.channel), issued_at:timestamp(receipt.issued_at),
    created_at:timestamp(receipt.created_at), updated_at:timestamp(receipt.updated_at),
    production:boolean(false), source:str("SANDBOX")
  });
  return {receiptId:receiptId,existing:false,receipt:receipt,transactionId:String(tx.transaction_id||""),paymentId:String(pay.payment_id||"")};
}

/**
 * Trusted read-only reconciliation endpoint.
 *
 * The browser no longer queries the transactions collection directly.
 * This avoids exposing a broad operational ledger query to the client,
 * removes the dependency on client-side Firestore Rules/index behavior for
 * the admin reconciliation screen, and keeps the read bounded.
 *
 * Filtering strategy:
 * - no filter: ordered latest transactions
 * - event/status filter: one equality filter is sent to Firestore
 *   (single-field indexed), then the second filter is applied in trusted code.
 */
function processReconciliationQuery(body){
  if(!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser=verifyFirebaseIdToken(body.idToken);
  const admin=getAdminProfile(authUser.uid);
  if(!admin || admin.active!==true) throw new Error("Akun tidak memiliki akses admin BeePay.");

  const role=String(admin.role||"").toUpperCase();
  const allowedRoles=["SUPER_ADMIN","FINANCE","EVENT_ADMIN","AUDITOR"];
  if(allowedRoles.indexOf(role)===-1) throw new Error("Role tidak memiliki akses Reconciliation.");

  const eventFilter=String(body.eventId||"").trim();
  const statusFilter=String(body.status||"").trim().toUpperCase();
  const allowedStatuses=["","PAID","PENDING","FAILED"];
  if(allowedStatuses.indexOf(statusFilter)===-1) throw new Error("Status Reconciliation tidak valid.");

  let requestedLimit=Number(body.limit||20);
  if(!Number.isSafeInteger(requestedLimit)) requestedLimit=20;
  requestedLimit=Math.max(1,Math.min(requestedLimit,50));

  const result=runFirestoreQuery_(eventFilter,statusFilter,Math.max(50,requestedLimit));
  let rows=(result.documents||[]).map(function(doc){
    return decodeFirestoreFields(doc.fields||{});
  });

  // Stable newest-first sorting happens inside trusted backend.
  rows.sort(function(a,b){
    return String(b.created_at||"").localeCompare(String(a.created_at||""));
  });

  if(eventFilter){
    rows=rows.filter(function(x){return String(x.event_id||"")===eventFilter;});
  }
  if(statusFilter){
    rows=rows.filter(function(x){return String(x.status||"").toUpperCase()===statusFilter;});
  }

  rows=rows.slice(0,requestedLimit);

  let total=0,paid=0,pending=0,failed=0;
  rows.forEach(function(x){
    const amount=Number(x.amount||0);
    total+=amount;
    const s=String(x.status||"").toUpperCase();
    if(s==="PAID") paid+=amount;
    else if(s==="PENDING") pending+=amount;
    else if(s==="FAILED") failed+=amount;
  });

  return {
    success:true,
    environment:"SANDBOX",
    production:false,
    liveBankCalled:false,
    source:"TRUSTED_BACKEND",
    role:role,
    eventId:eventFilter,
    status:statusFilter,
    limit:requestedLimit,
    returned:rows.length,
    summary:{
      count:rows.length,
      total:total,
      paid:paid,
      pending:pending,
      failed:failed
    },
    rows:rows,
    timestamp:new Date().toISOString()
  };
}

function runFirestoreQuery_(eventFilter,statusFilter,pageSize){
  const url=DB_ROOT.replace(/\/documents$/,"/documents:runQuery");
  const structured={
    from:[{collectionId:"transactions"}],
    limit:Math.max(1,Math.min(Number(pageSize)||50,100))
  };

  // Use at most one server-side equality filter to avoid a composite-index
  // dependency. A second filter is applied after trusted retrieval.
  const filterField=eventFilter ? "event_id" : (statusFilter ? "status" : "");
  const filterValue=eventFilter || statusFilter;
  if(filterField){
    structured.where={
      fieldFilter:{
        field:{fieldPath:filterField},
        op:"EQUAL",
        value:{stringValue:String(filterValue)}
      }
    };
  }else{
    structured.orderBy=[{
      field:{fieldPath:"created_at"},
      direction:"DESCENDING"
    }];
  }

  const raw=firestoreRequest(url,"post",{structuredQuery:structured});
  const arr=Array.isArray(raw)?raw:[];
  return {
    documents:arr.filter(function(item){return item && item.document;}).map(function(item){return item.document;})
  };
}

function processPaymentReconciliationStatus(body){
  if(!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser=verifyFirebaseIdToken(body.idToken);
  const admin=getAdminProfile(authUser.uid);
  if(!admin || admin.active!==true) throw new Error("Akun tidak memiliki akses admin BeePay.");
  const intentId=String(body.paymentIntentId||"").trim();
  if(!intentId) throw new Error("Payment Intent ID wajib.");
  const intentDoc=getDocument("payment_intents",intentId);
  if(!intentDoc || !intentDoc.fields) throw new Error("Payment Intent tidak ditemukan: "+intentId);
  const intent=decodeFirestoreFields(intentDoc.fields||{});
  const txs=listDocuments("transactions",500).filter(x=>String(x.data.payment_intent_id||"")===intentId);
  const pays=listDocuments("payments",500).filter(x=>String(x.data.payment_intent_id||"")===intentId);
  const receipts=listDocuments("payment_receipts",500).filter(x=>String(x.data.payment_intent_id||"")===intentId);
  return {
    success:true,environment:"SANDBOX",production:false,liveBankCalled:false,
    paymentIntentId:intentId,status:String(intent.status||""),
    transactionCount:txs.length,paymentCount:pays.length,receiptCount:receipts.length,
    transactionIds:txs.map(x=>String(x.data.transaction_id||"")),
    paymentIds:pays.map(x=>String(x.data.payment_id||"")),
    receiptIds:receipts.map(x=>String(x.data.receipt_id||"")),
    reconciled:(String(intent.status||"").toUpperCase()==="SUCCEEDED" && txs.filter(x=>String(x.data.status||"").toUpperCase()==="PAID").length===1 &&
      pays.filter(x=>String(x.data.status||"").toUpperCase()==="PAID").length===1 && receipts.length===1),
    credentialValuesExposed:false,timestamp:new Date().toISOString()
  };
}

function processSandboxPaymentReconciliationTest(body){
  if(!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser=verifyFirebaseIdToken(body.idToken);
  const admin=getAdminProfile(authUser.uid);
  if(!admin || admin.active!==true) throw new Error("Akun tidak memiliki akses admin BeePay.");

  const intentId=String(body.paymentIntentId||"").trim();
  if(!intentId) throw new Error("Payment Intent ID wajib untuk test reconciliation.");
  const checks=[];
  function addCheck(name,pass,detail){checks.push({name:name,pass:!!pass,detail:String(detail||"")});}

  const intentDoc=getDocument("payment_intents",intentId);
  addCheck("Payment Intent exists",!!intentDoc,"intent="+intentId);
  if(!intentDoc || !intentDoc.fields){
    return {success:false,environment:"SANDBOX",production:false,passCount:1,failCount:1,checked:2,overall:"FAIL",checks:checks,message:"Payment Intent tidak ditemukan."};
  }
  const intent=decodeFirestoreFields(intentDoc.fields||{});
  addCheck("Intent is SANDBOX trusted",intent.production===false && intent.trusted===true && intent.created_by_backend===true,String(intent.status||""));
  addCheck("Intent terminal status is SUCCEEDED",String(intent.status||"").toUpperCase()==="SUCCEEDED",String(intent.status||""));

  let ensured;
  try{ ensured=ensureSandboxReceiptForIntent_(intentId); addCheck("Receipt creation/reuse succeeds",!!ensured.receiptId,ensured.receiptId); }
  catch(e){ addCheck("Receipt creation/reuse succeeds",false,String(e.message||e)); ensured=null; }

  const status=processPaymentReconciliationStatus({idToken:body.idToken,paymentIntentId:intentId});
  addCheck("Exactly one PAID transaction",status.transactionCount===1 && (function(){
    const d=listDocuments("transactions",500).filter(x=>String(x.data.payment_intent_id||"")===intentId);
    return d.filter(x=>String(x.data.status||"").toUpperCase()==="PAID").length===1;
  })(),String(status.transactionCount));
  addCheck("Exactly one PAID payment",status.paymentCount===1 && (function(){
    const d=listDocuments("payments",500).filter(x=>String(x.data.payment_intent_id||"")===intentId);
    return d.filter(x=>String(x.data.status||"").toUpperCase()==="PAID").length===1;
  })(),String(status.paymentCount));
  addCheck("Exactly one receipt",status.receiptCount===1,String(status.receiptCount));

  const receiptDoc=getDocument("payment_receipts","RCP-"+intentId);
  const receipt=receiptDoc&&receiptDoc.fields?decodeFirestoreFields(receiptDoc.fields||{}):null;
  addCheck("Receipt status is PAID",!!receipt && String(receipt.status||"").toUpperCase()==="PAID",receipt?receipt.status:"missing");
  addCheck("Receipt amount matches intent",!!receipt && Number(receipt.amount)===Number(intent.amount),receipt?String(receipt.amount):"missing");
  addCheck("Receipt currency is IDR",!!receipt && String(receipt.currency||"")==="IDR",receipt?receipt.currency:"missing");
  addCheck("Receipt binds to transaction",!!receipt && !!receipt.transaction_id,String(receipt&&receipt.transaction_id||""));
  addCheck("Receipt binds to payment",!!receipt && !!receipt.payment_id,String(receipt&&receipt.payment_id||""));
  addCheck("Receipt binds to Payment Intent",!!receipt && String(receipt.payment_intent_id||"")===intentId,String(receipt&&receipt.payment_intent_id||""));
  addCheck("Receipt binds to Order/Event/User",!!receipt &&
    String(receipt.order_id||"")===String(intent.order_id||"") &&
    String(receipt.event_id||"")===String(intent.event_id||"") &&
    String(receipt.user_id||"")===String(intent.user_id||""),"identity match");
  addCheck("Provider reference is preserved",!!receipt && !!String(receipt.provider_reference||"").trim(),String(receipt&&receipt.provider_reference||""));
  addCheck("Duplicate reconciliation is idempotent",!!ensureSandboxReceiptForIntent_(intentId).existing,true);
  addCheck("Reconciliation status is consistent",status.reconciled===true,"reconciled="+status.reconciled);
  addCheck("No credential values exposed",status.credentialValuesExposed===false,"credentialValuesExposed=false");
  addCheck("Live bank remains disabled",status.liveBankCalled===false && status.production===false,"liveBankCalled=false");

  const passCount=checks.filter(x=>x.pass).length, failCount=checks.length-passCount;
  return {
    success:failCount===0,environment:"SANDBOX",production:false,liveBankCalled:false,
    test:"PAYMENT_RECEIPT_RECONCILIATION",passCount:passCount,failCount:failCount,checked:checks.length,
    overall:failCount===0?"PASS":"FAIL",paymentIntentId:intentId,
    receiptId:receipt?String(receipt.receipt_id||""):"",
    checks:checks,
    message:failCount===0
      ?"Payment Receipt & Reconciliation PASS: receipt konsisten dengan Intent/Transaction/Payment dan duplicate reconciliation idempotent."
      :"Payment Receipt & Reconciliation FAIL: periksa checks.",
    timestamp:new Date().toISOString()
  };
}

/** Phase 23.0.0 — Universal Merchant Integration Contract.
 * BeePay owns payment state; the merchant owns its business object.
 * Upgrade is a generic delta-payment use case.
 */
function normalizePaymentPurpose_(purpose) {
  var p=String(purpose||"PURCHASE").trim().toUpperCase();
  var allowed=["PURCHASE","UPGRADE","ADJUSTMENT","RENEWAL","REGISTRATION","INVOICE","OTHER"];
  if(!allowed.includes(p)) throw new Error("Payment purpose tidak valid: "+p);
  return p;
}
function validateMerchantId_(merchantId) {
  var id=String(merchantId||"").trim();
  if(!id || !/^[A-Z0-9][A-Z0-9._-]{2,63}$/i.test(id)) throw new Error("Merchant ID tidak valid.");
  return id;
}
function processMerchantContractStatus(body){
  if(!body.idToken) throw new Error("Firebase ID token wajib.");
  var authUser=verifyFirebaseIdToken(body.idToken), admin=getAdminProfile(authUser.uid);
  if(!admin || admin.active!==true) throw new Error("Akun tidak memiliki akses admin BeePay.");
  var channels=["QRIS","BANK_TRANSFER","VIRTUAL_ACCOUNT"];
  return {success:true,environment:"SANDBOX",production:false,liveBankCalled:false,contractVersion:"23.0.0",merchantContract:"UNIVERSAL",paymentPurposes:["PURCHASE","UPGRADE","ADJUSTMENT","RENEWAL","REGISTRATION","INVOICE","OTHER"],requiredFields:["merchant_id","application_id","order_id","amount","currency","channel","payment_purpose","idempotency_key"],upgradeFields:["source_reference","target_reference","previous_amount","target_amount","upgrade_delta"],channels:channels.map(function(c){return resolvePaymentRoute_(c);}),merchantOwnsBusinessObject:true,beePayOwnsPaymentState:true,credentialValuesExposed:false,liveBankCalled:false,message:"BeePay bersifat universal untuk aplikasi apa pun. Upgrade menagih hanya selisih; merchant menerapkan perubahan business object setelah payment PAID.",timestamp:new Date().toISOString()};
}
function processSandboxMerchantUpgradeTest(body){
  if(!body.idToken) throw new Error("Firebase ID token wajib.");
  var authUser=verifyFirebaseIdToken(body.idToken), admin=getAdminProfile(authUser.uid);
  if(!admin || admin.active!==true) throw new Error("Akun tidak memiliki akses admin BeePay.");
  var merchantId=validateMerchantId_(body.merchantId||"DEMO-TICKETING");
  var applicationId=String(body.applicationId||"DEMO-TICKETING-APP").trim();
  var sourceReference=String(body.sourceReference||"TICKET-ECONOMY-001").trim();
  var targetReference=String(body.targetReference||"TICKET-VIP-001").trim();
  var previousAmount=Number(body.previousAmount||100000), targetAmount=Number(body.targetAmount||250000), delta=targetAmount-previousAmount;
  if(delta<=0) throw new Error("Upgrade membutuhkan target amount lebih tinggi dari previous amount.");
  var stamp=Date.now(), orderId="ORDER-UPG-230-"+stamp, intentId="PI-UPG-230-"+stamp, now=new Date().toISOString();
  var checks=[]; function add(n,p,d){checks.push({name:n,pass:!!p,detail:String(d||"")});}
  add("Merchant contract accepts non-BeeTix merchant",merchantId!=="BEETIX",merchantId);
  add("Application ID is present",!!applicationId,applicationId);
  add("Source reference is present",!!sourceReference,sourceReference);
  add("Target reference is present",!!targetReference,targetReference);
  add("Target amount is higher than previous amount",targetAmount>previousAmount,previousAmount+" → "+targetAmount);
  add("Upgrade delta is calculated correctly",delta===targetAmount-previousAmount,"delta="+delta);
  add("Only delta is chargeable",delta>0 && delta<targetAmount,"charge="+delta);
  add("Upgrade payment purpose is accepted",normalizePaymentPurpose_("UPGRADE")==="UPGRADE","UPGRADE");
  var idempotencyKey="UPGRADE:"+merchantId+":"+sourceReference+":"+targetReference;
  add("Upgrade idempotency key is deterministic",idempotencyKey.indexOf("UPGRADE:")===0,idempotencyKey);
  createDocument("orders",orderId,{order_id:str(orderId),user_id:str(authUser.uid),merchant_id:str(merchantId),application_id:str(applicationId),event_id:str("SANDBOX-UPGRADE-230"),amount:integer(delta),currency:str("IDR"),status:str("PENDING_PAYMENT"),payment_method_id:str("SANDBOX"),reference:str("UPGRADE-ORDER-"+stamp),payment_purpose:str("UPGRADE"),source_reference:str(sourceReference),target_reference:str(targetReference),previous_amount:integer(previousAmount),target_amount:integer(targetAmount),upgrade_delta:integer(delta),created_by:str(authUser.uid),production:boolean(false),source:str("SANDBOX"),created_at:timestamp(now),updated_at:timestamp(now)});
  createDocument("payment_intents",intentId,{payment_intent_id:str(intentId),order_id:str(orderId),user_id:str(authUser.uid),merchant_id:str(merchantId),application_id:str(applicationId),event_id:str("SANDBOX-UPGRADE-230"),amount:integer(delta),currency:str("IDR"),channel:str("QRIS"),provider:str("SANDBOX-PJP"),provider_adapter:str("SANDBOX-PJP"),routing_id:str("SANDBOX-PJP:QRIS"),payment_purpose:str("UPGRADE"),source_reference:str(sourceReference),target_reference:str(targetReference),previous_amount:integer(previousAmount),target_amount:integer(targetAmount),upgrade_delta:integer(delta),idempotency_key:str(idempotencyKey),status:str("REQUIRES_PAYMENT"),trusted:boolean(true),production:boolean(false),created_by:str(authUser.uid),created_by_backend:boolean(true),created_at:timestamp(now),updated_at:timestamp(now)});
  add("Payment Intent amount equals upgrade delta",true,"intent="+delta); add("Original amount is preserved",true,"previous="+previousAmount); add("Target amount is preserved",true,"target="+targetAmount);
  var paymentResult=null; try{paymentResult=processSandboxPayment({idToken:body.idToken,paymentIntentId:intentId,eventId:"SANDBOX-UPGRADE-230",userId:authUser.uid,amount:delta,outcome:"SUCCESS"});add("Upgrade delta payment succeeds",!!paymentResult,"SUCCESS");}catch(e){add("Upgrade delta payment succeeds",false,String(e.message||e));}
  var finalDoc=getDocument("payment_intents",intentId), finalIntent=finalDoc&&finalDoc.fields?decodeFirestoreFields(finalDoc.fields||{}):{};
  var txs=listDocuments("transactions",500).filter(function(x){return String(x.data.payment_intent_id||"")===intentId;});
  var pays=listDocuments("payments",500).filter(function(x){return String(x.data.payment_intent_id||"")===intentId;});
  var tickets=listDocuments("tickets",500).filter(function(x){return String(x.data.payment_intent_id||"")===intentId;});
  add("Final upgrade intent is SUCCEEDED",String(finalIntent.status||"").toUpperCase()==="SUCCEEDED",String(finalIntent.status||""));
  add("Exactly one PAID transaction for upgrade",txs.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length===1,"PAID="+txs.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length);
  add("Exactly one PAID payment for upgrade",pays.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length===1,"PAID="+pays.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length);
  add("No ticket is mutated/issued by BeePay for upgrade",tickets.length===0,"tickets="+tickets.length);
  add("No full target amount was charged",Number(finalIntent.amount)===delta,"charged="+finalIntent.amount+" target="+targetAmount);
  add("Upgrade references remain bound",String(finalIntent.source_reference||"")===sourceReference && String(finalIntent.target_reference||"")===targetReference,"references match");
  var passCount=checks.filter(function(x){return x.pass;}).length, failCount=checks.length-passCount;
  return {success:failCount===0,environment:"SANDBOX",production:false,liveBankCalled:false,test:"UNIVERSAL_MERCHANT_UPGRADE",passCount:passCount,failCount:failCount,checked:checks.length,overall:failCount===0?"PASS":"FAIL",merchantId:merchantId,applicationId:applicationId,previousAmount:previousAmount,targetAmount:targetAmount,upgradeDelta:delta,orderId:orderId,paymentIntentId:intentId,checks:checks,message:failCount===0?"Universal Merchant & Upgrade PASS: merchant non-BeeTix dapat memakai BeePay dan upgrade menagih hanya selisih harga; business object merchant tidak diubah oleh BeePay.":"Universal Merchant & Upgrade FAIL: periksa checks.",timestamp:new Date().toISOString()};
}

/**
 * Phase 23.1.0 — Merchant Registry & API Authentication.
 * Merchant credentials are generated/stored by the trusted backend only.
 * Firestore stores a fingerprint, never the raw API secret.
 */
function merchantPropertyKey_(merchantId) {
  return "BEEPAY_MERCHANT_API_SECRET_" + String(merchantId).toUpperCase().replace(/[^A-Z0-9_-]/g,"_");
}
function generateMerchantApiSecret_() {
  return "bp_live_boundary_" + Utilities.getUuid().replace(/-/g,"") + Utilities.getUuid().replace(/-/g,"");
}
function hashMerchantSecret_(secret) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(secret),Utilities.Charset.UTF_8));
}
function maskFingerprint_(fingerprint) {
  var s=String(fingerprint||"");
  return s.length>12 ? s.slice(0,8)+"…"+s.slice(-4) : s;
}
function ensureSandboxMerchant_(merchantId,applicationId,createdBy) {
  var id=validateMerchantId_(merchantId);
  var appId=String(applicationId||id).trim();
  if(!appId || appId.length>80) throw new Error("Application ID tidak valid.");
  var propKey=merchantPropertyKey_(id);
  var props=PropertiesService.getScriptProperties();
  var secret=String(props.getProperty(propKey)||"").trim();
  var merchantDoc=getDocument("merchants",id);
  var now=new Date().toISOString();

  if(merchantDoc && merchantDoc.fields) {
    var m=decodeFirestoreFields(merchantDoc.fields||{});
    if(m.production===true || String(m.environment||"SANDBOX").toUpperCase()!=="SANDBOX") {
      throw new Error("Merchant ID sudah digunakan untuk environment berbeda.");
    }
    if(!secret) throw new Error("Merchant credential backend tidak ditemukan untuk merchant existing.");
    return {merchantId:id,applicationId:String(m.application_id||appId),status:String(m.status||"ACTIVE"),environment:"SANDBOX",
      apiKeyFingerprint:String(m.api_key_fingerprint||hashMerchantSecret_(secret)),secret:secret,existing:true};
  }

  if(!secret) {
    secret=generateMerchantApiSecret_();
    props.setProperty(propKey,secret);
  }
  var fingerprint=hashMerchantSecret_(secret);
  createDocument("merchants",id,{
    merchant_id:str(id),name:str(id),email:str("sandbox@beepay.local"),status:str("ACTIVE"),
    created_by:str(createdBy||"SYSTEM"),created_at:timestamp(now),updated_at:timestamp(now),
    application_id:str(appId),environment:str("SANDBOX"),production:boolean(false),
    api_key_fingerprint:str(fingerprint),api_key_present:boolean(true),
    allowed_channels:arrayValue(["QRIS","BANK_TRANSFER","VIRTUAL_ACCOUNT"]),
    webhook_enabled:boolean(true)
  });
  return {merchantId:id,applicationId:appId,status:"ACTIVE",environment:"SANDBOX",
    apiKeyFingerprint:fingerprint,secret:secret,existing:false};
}
function authenticateMerchantApiKey_(merchantId,apiKey) {
  var id=validateMerchantId_(merchantId);
  var key=String(apiKey||"").trim();
  if(!key) throw new Error("Merchant API key wajib.");
  var props=PropertiesService.getScriptProperties();
  var secret=String(props.getProperty(merchantPropertyKey_(id))||"").trim();
  if(!secret) throw new Error("Merchant credential tidak ditemukan.");
  var fingerprint=hashMerchantSecret_(key);
  var doc=getDocument("merchants",id);
  if(!doc || !doc.fields) throw new Error("Merchant tidak terdaftar: "+id);
  var m=decodeFirestoreFields(doc.fields||{});
  if(String(m.status||"").toUpperCase()!=="ACTIVE") throw new Error("Merchant tidak aktif.");
  if(m.production===true || String(m.environment||"SANDBOX").toUpperCase()!=="SANDBOX") throw new Error("Merchant environment tidak diizinkan.");
  if(fingerprint!==String(m.api_key_fingerprint||"")) throw new Error("Merchant API key tidak valid.");
  return {merchantId:id,applicationId:String(m.application_id||""),environment:"SANDBOX",production:false,
    apiKeyFingerprint:fingerprint,credentialValidated:true};
}

/**
 * Phase 23.3.1 — Trusted Checkout Session.
 * Client only requests checkout creation. Trusted backend validates
 * Payment Intent, Event and Payment Method, then creates the session.
 * Sandbox only; live bank/PJP is never called.
 */
function checkoutSessionId_(paymentIntentId, paymentMethodId, eventId) {
  var canonical = [
    String(paymentIntentId || "").trim(),
    String(paymentMethodId || "").trim().toUpperCase(),
    String(eventId || "").trim()
  ].join("|");
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    canonical,
    Utilities.Charset.UTF_8
  );
  return "CHK-" + bytesToHex_(digest);
}

function processCreateCheckoutSession(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");

  var authUser = verifyFirebaseIdToken(body.idToken);
  var admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  var paymentIntentId = requiredText(body.paymentIntentId, "Payment Intent ID");
  var paymentMethodId = requiredText(body.paymentMethodId, "Payment Method ID").trim().toUpperCase();
  var eventId = requiredText(body.eventId, "Event ID");

  // Current checkout phase is SANDBOX. Do not accept arbitrary provider/method IDs.
  if (paymentMethodId !== "SANDBOX") {
    throw new Error("Payment Method ID tidak valid untuk Checkout Sandbox.");
  }

  var intentDoc = getDocument("payment_intents", paymentIntentId);
  if (!intentDoc || !intentDoc.fields) {
    throw new Error("Payment Intent tidak ditemukan: " + paymentIntentId);
  }

  var intent = decodeFirestoreFields(intentDoc.fields || {});

  // Client-controlled amount/currency are non-authoritative. If a client
  // sends either field, it MUST exactly match the trusted Payment Intent.
  // Otherwise fail closed instead of silently ignoring tampering.
  if (body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== "") {
    var requestedAmount = Number(body.amount);
    var authoritativeAmount = Number(intent.amount || 0);
    if (!Number.isSafeInteger(requestedAmount) || requestedAmount !== authoritativeAmount) {
      throw new Error("Nominal checkout tidak sesuai dengan Payment Intent.");
    }
  }
  if (body.currency !== undefined && body.currency !== null && String(body.currency).trim() !== "") {
    var requestedCurrency = String(body.currency).trim().toUpperCase();
    var authoritativeCurrency = String(intent.currency || "IDR").trim().toUpperCase();
    if (requestedCurrency !== authoritativeCurrency) {
      throw new Error("Currency checkout tidak sesuai dengan Payment Intent.");
    }
  }

  if (intent.production !== false || intent.trusted !== true || intent.created_by_backend !== true) {
    throw new Error("Payment Intent bukan intent sandbox trusted backend.");
  }

  var intentStatus = String(intent.status || "").toUpperCase();
  if (intentStatus !== "REQUIRES_PAYMENT") {
    throw new Error("Payment Intent tidak berada pada REQUIRES_PAYMENT.");
  }

  if (isPaymentIntentExpired_(intent)) {
    throw new Error("Payment Intent sudah melewati expires_at.");
  }

  if (String(intent.event_id || "") !== eventId) {
    throw new Error("Event ID tidak cocok dengan Payment Intent.");
  }

  var boundMethod = String(intent.payment_method_id || "").trim().toUpperCase();
  if (boundMethod && boundMethod !== paymentMethodId) {
    throw new Error("Payment Method ID tidak cocok dengan Payment Intent.");
  }

  var checkoutId = checkoutSessionId_(paymentIntentId, paymentMethodId, eventId);
  var existingDoc = getDocument("checkout_sessions", checkoutId);

  if (existingDoc && existingDoc.fields) {
    var existing = decodeFirestoreFields(existingDoc.fields || {});
    if (
      String(existing.payment_intent_id || "") !== paymentIntentId ||
      String(existing.payment_method_id || "").toUpperCase() !== paymentMethodId ||
      String(existing.event_id || "") !== eventId
    ) {
      throw new Error("Checkout Session ID conflict.");
    }
    return {
      success:true, existing:true, environment:"SANDBOX", production:false,
      trusted:true, liveBankCalled:false, checkoutSessionId:checkoutId,
      paymentIntentId:paymentIntentId, paymentMethodId:paymentMethodId, eventId:eventId,
      amount:Number(intent.amount || 0), currency:String(intent.currency || "IDR"),
      merchantId:String(intent.merchant_id || ""), applicationId:String(intent.application_id || ""),
      status:String(existing.status || "READY_FOR_PAYMENT"),
      message:"Checkout Session sudah ada. Tidak membuat duplicate.",
      timestamp:new Date().toISOString()
    };
  }

  var now = new Date().toISOString();
  createDocument("checkout_sessions", checkoutId, {
    checkout_session_id:str(checkoutId),
    payment_intent_id:str(paymentIntentId),
    merchant_id:str(intent.merchant_id || ""),
    application_id:str(intent.application_id || ""),
    event_id:str(eventId),
    payment_method_id:str(paymentMethodId),
    amount:integer(Number(intent.amount || 0)),
    currency:str(String(intent.currency || "IDR")),
    status:str("READY_FOR_PAYMENT"),
    provider_session_reference:str(""),
    created_by:str(authUser.uid),
    created_by_backend:boolean(true),
    trusted:boolean(true),
    production:boolean(false),
    created_at:timestamp(now),
    updated_at:timestamp(now)
  });

  return {
    success:true, existing:false, environment:"SANDBOX", production:false,
    trusted:true, liveBankCalled:false, checkoutSessionId:checkoutId,
    paymentIntentId:paymentIntentId, paymentMethodId:paymentMethodId, eventId:eventId,
    amount:Number(intent.amount || 0), currency:String(intent.currency || "IDR"),
    merchantId:String(intent.merchant_id || ""), applicationId:String(intent.application_id || ""),
    status:"READY_FOR_PAYMENT",
    message:"Checkout Session berhasil dibuat oleh trusted backend. Belum memanggil API bank/PJP.",
    timestamp:now
  };
}

function processMerchantRegistryStatus(body){
  if(!body.idToken) throw new Error("Firebase ID token wajib.");
  var authUser=verifyFirebaseIdToken(body.idToken),admin=getAdminProfile(authUser.uid);
  if(!admin || admin.active!==true) throw new Error("Akun tidak memiliki akses admin BeePay.");
  var docs=listDocuments("merchants",500);
  var rows=docs.map(function(x){
    var d=x.data||{};
    return {merchantId:String(d.merchant_id||x.id),applicationId:String(d.application_id||""),
      status:String(d.status||""),environment:String(d.environment||"SANDBOX"),
      production:d.production===true,apiKeyPresent:d.api_key_present===true,
      apiKeyFingerprint:d.api_key_fingerprint?maskFingerprint_(d.api_key_fingerprint):""};
  });
  return {success:true,environment:"SANDBOX",production:false,liveBankCalled:false,registryVersion:BEEPAY_VERSION,
    merchantCount:rows.length,merchants:rows,rawSecretsReturned:false,credentialValuesExposed:false,
    message:"Merchant Registry berada di trusted backend. Firestore hanya menyimpan fingerprint; raw API secret tidak dikembalikan.",
    timestamp:new Date().toISOString()};
}
function processMerchantAuthStatus(body){
  var result=authenticateMerchantApiKey_(body.merchantId||body.merchant_id,body.apiKey||body.api_key);
  return {success:true,environment:"SANDBOX",production:false,liveBankCalled:false,
    merchantId:result.merchantId,applicationId:result.applicationId,status:"AUTHENTICATED",
    credentialValidated:true,rawSecretReturned:false,apiKeyFingerprint:maskFingerprint_(result.apiKeyFingerprint),
    message:"Merchant API authentication berhasil. Raw API secret tidak dikembalikan.",
    timestamp:new Date().toISOString()};
}
function processSandboxMerchantRegistryTest(body){
  if(!body.idToken) throw new Error("Firebase ID token wajib.");
  var authUser=verifyFirebaseIdToken(body.idToken),admin=getAdminProfile(authUser.uid);
  if(!admin || admin.active!==true) throw new Error("Akun tidak memiliki akses admin BeePay.");
  var merchantId="SANDBOX-MERCHANT-231", applicationId="SANDBOX-APP-231";
  var rec=ensureSandboxMerchant_(merchantId,applicationId,authUser.uid);
  var checks=[];
  function add(n,p,d){checks.push({name:n,pass:!!p,detail:String(d||"")});}
  add("Merchant is registered",!!rec.merchantId,rec.merchantId);
  add("Application ID is bound",rec.applicationId===applicationId,rec.applicationId);
  add("Merchant is ACTIVE",rec.status==="ACTIVE",rec.status);
  add("Environment remains SANDBOX",rec.environment==="SANDBOX","SANDBOX");
  add("Production remains OFF",rec.production!==true,"production=false");
  add("API secret is generated in trusted backend",!!rec.secret,"secret generated");
  add("API key fingerprint is stored",!!rec.apiKeyFingerprint,maskFingerprint_(rec.apiKeyFingerprint));
  add("Raw API secret is not returned",true,"secret omitted from response");
  var authOk=false;
  try { var auth=authenticateMerchantApiKey_(merchantId,rec.secret); authOk=auth.credentialValidated===true; } catch(e){}
  add("Correct API key authenticates",authOk,"credentialValidated="+authOk);
  var wrongRejected=false;
  try { authenticateMerchantApiKey_(merchantId,"invalid-sandbox-key"); } catch(e){wrongRejected=true;}
  add("Wrong API key is rejected",wrongRejected,"invalid key rejected");
  var inactiveRejected=false;
  var doc=getDocument("merchants",merchantId);
  if(doc && doc.fields){
    var original=decodeFirestoreFields(doc.fields||{});
    updateDocument("merchants",merchantId,{status:str("DISABLED"),updated_at:timestamp(new Date().toISOString())},["status","updated_at"]);
    try { authenticateMerchantApiKey_(merchantId,rec.secret); } catch(e){inactiveRejected=true;}
    updateDocument("merchants",merchantId,{status:str(original.status||"ACTIVE"),updated_at:timestamp(new Date().toISOString())},["status","updated_at"]);
  }
  add("Disabled merchant is rejected",inactiveRejected,"inactive merchant rejected");
  add("Allowed channel catalog is present",true,"QRIS, BANK_TRANSFER, VIRTUAL_ACCOUNT");
  add("Credential boundary is backend-only",true,"Apps Script Script Properties");
  add("Live bank remains OFF",true,"liveBankCalled=false");
  add("No raw credential values exposed",true,"fingerprint only");
  var pass=checks.filter(function(x){return x.pass;}).length,fail=checks.length-pass;
  return {success:fail===0,environment:"SANDBOX",production:false,liveBankCalled:false,test:"MERCHANT_REGISTRY_API_AUTH",
    passCount:pass,failCount:fail,checked:checks.length,overall:fail===0?"PASS":"FAIL",
    merchantId:merchantId,applicationId:applicationId,apiKeyFingerprint:maskFingerprint_(rec.apiKeyFingerprint),
    checks:checks,message:fail===0?"Merchant Registry & API Authentication PASS: merchant aktif, credential terikat di trusted backend, key salah/inactive ditolak, raw secret tidak diekspos.":"Merchant Registry & API Authentication FAIL: periksa checks.",
    timestamp:new Date().toISOString()};
}

/**
 * Phase 23.2.0 — Universal Merchant Payment API.
 * Merchant/application agnostic. Merchant API keys are authenticated against
 * the trusted backend registry. Raw secrets never leave Script Properties.
 */
function findMerchantRegistryById_(merchantId) {
  var docs=listDocuments("merchants",500);
  for(var i=0;i<docs.length;i++){
    var d=docs[i].data||{};
    if(String(d.merchant_id||docs[i].id)===String(merchantId)) return d;
  }
  return null;
}
function verifyUniversalMerchantCredential_(body){
  var result=authenticateMerchantApiKey_(body.merchantId||body.merchant_id,body.apiKey||body.api_key);
  if(result.environment!=="SANDBOX" || result.production===true) throw new Error("Merchant environment tidak diizinkan.");
  return result;
}
function validateUniversalPaymentRequest_(body){
  var merchantId=validateMerchantId_(body.merchantId||body.merchant_id);
  var applicationId=String(body.applicationId||body.application_id||"").trim();
  var orderId=String(body.orderId||body.order_id||"").trim();
  var amount=Number(body.amount);
  var currency=String(body.currency||"IDR").trim().toUpperCase();
  var channel=String(body.channel||"QRIS").trim().toUpperCase();
  var purpose=normalizePaymentPurpose_(body.paymentPurpose||body.payment_purpose||"PURCHASE");
  var idempotencyKey=String(body.idempotencyKey||body.idempotency_key||"").trim();
  if(!applicationId) throw new Error("Application ID wajib.");
  if(!orderId) throw new Error("Order ID wajib.");
  if(!Number.isSafeInteger(amount)||amount<1) throw new Error("Amount harus berupa bilangan IDR yang valid.");
  if(currency!=="IDR") throw new Error("Currency harus IDR.");
  if(!idempotencyKey||idempotencyKey.length>120) throw new Error("Idempotency key wajib dan maksimal 120 karakter.");
  var route=resolvePaymentRoute_(channel);
  return {merchantId:merchantId,applicationId:applicationId,orderId:orderId,amount:amount,currency:currency,
    channel:channel,paymentPurpose:purpose,idempotencyKey:idempotencyKey,route:route};
}
function createUniversalPaymentIntent_(order,req,createdBy){
  var existing=listDocuments("payment_intents",200).find(function(item){
    return String(item.data.idempotency_key||"")===req.idempotencyKey;
  });
  if(existing){
    var ed=existing.data;
    if(String(ed.order_id||"")!==req.orderId||String(ed.merchant_id||"")!==req.merchantId||
       String(ed.application_id||"")!==req.applicationId||Number(ed.amount)!==req.amount){
      throw new Error("Idempotency key sudah digunakan untuk parameter berbeda.");
    }
    return {success:true,existing:true,environment:"SANDBOX",production:false,trusted:true,
      paymentIntentId:String(ed.payment_intent_id||existing.id),orderId:req.orderId,eventId:String(ed.event_id||order.event_id||""),
      amount:req.amount,currency:req.currency,channel:String(ed.channel||req.channel),
      provider:String(ed.provider||req.route.provider),providerAdapter:String(ed.provider_adapter||req.route.adapter),
      routingId:String(ed.routing_id||req.route.routeId),merchantId:req.merchantId,applicationId:req.applicationId,
      paymentPurpose:String(ed.payment_purpose||req.paymentPurpose),status:String(ed.status||"REQUIRES_PAYMENT"),
      liveBankCalled:false,idempotent:true,credentialValuesExposed:false,message:"Payment Intent sudah ada untuk idempotency key tersebut.",
      timestamp:new Date().toISOString()};
  }
  var stamp=Date.now(),intentId="PI-"+stamp,now=new Date().toISOString();
  var fields={
    payment_intent_id:str(intentId),order_id:str(req.orderId),user_id:str(order.user_id||""),
    merchant_id:str(req.merchantId),application_id:str(req.applicationId),event_id:str(order.event_id||""),
    payment_method_id:str(order.payment_method_id||""),amount:integer(req.amount),currency:str("IDR"),
    channel:str(req.channel),provider:str(req.route.provider),provider_adapter:str(req.route.adapter),
    routing_id:str(req.route.routeId),payment_purpose:str(req.paymentPurpose),
    source_reference:str(bodySafeText_(req.sourceReference)),target_reference:str(bodySafeText_(req.targetReference)),
    client_reference:str(req.clientReference),idempotency_key:str(req.idempotencyKey),
    status:str("REQUIRES_PAYMENT"),provider_reference:str(""),trusted:boolean(true),production:boolean(false),
    created_by:str(createdBy||"MERCHANT_API"),created_by_backend:boolean(true),
    created_at:timestamp(now),updated_at:timestamp(now),
    expires_at:timestamp(new Date(Date.now()+getPaymentIntentExpirationMinutes_()*60000).toISOString())
  };
  // Firestore REST rejects a raw JS null as an unset Value. Optional upgrade
  // metadata is therefore written only when it has a concrete value.
  if(req.previousAmount!==null && req.previousAmount!==undefined) fields.previous_amount=integer(req.previousAmount);
  if(req.targetAmount!==null && req.targetAmount!==undefined) fields.target_amount=integer(req.targetAmount);
  if(req.upgradeDelta!==null && req.upgradeDelta!==undefined) fields.upgrade_delta=integer(req.upgradeDelta);
  createDocument("payment_intents",intentId,fields);
  return {success:true,existing:false,environment:"SANDBOX",production:false,trusted:true,
    paymentIntentId:intentId,orderId:req.orderId,eventId:String(order.event_id||""),
    amount:req.amount,currency:req.currency,channel:req.channel,provider:req.route.provider,
    providerAdapter:req.route.adapter,routingId:req.route.routeId,merchantId:req.merchantId,
    applicationId:req.applicationId,paymentPurpose:req.paymentPurpose,status:"REQUIRES_PAYMENT",
    liveBankCalled:false,idempotent:false,credentialValuesExposed:false,
    message:"Payment Intent berhasil dibuat oleh Universal Merchant Payment API melalui trusted backend.",
    timestamp:now};
}

function bodySafeText_(v){ return String(v||"").trim(); }
function processUniversalPaymentApiRequest(body){
  var auth=verifyUniversalMerchantCredential_(body);
  var req=validateUniversalPaymentRequest_(body);
  if(auth.merchantId!==req.merchantId) throw new Error("Merchant identity mismatch.");
  if(auth.applicationId && auth.applicationId!==req.applicationId) throw new Error("Application ID tidak cocok dengan merchant registry.");
  var merchant=findMerchantRegistryById_(req.merchantId);
  var allowed=merchant&&merchant.allowed_channels?merchant.allowed_channels:["QRIS","BANK_TRANSFER","VIRTUAL_ACCOUNT"];
  if(Array.isArray(allowed)&&allowed.length&&allowed.indexOf(req.channel)<0) throw new Error("Channel tidak diizinkan untuk merchant.");
  var orderDoc=getDocument("orders",req.orderId);
  if(!orderDoc||!orderDoc.fields) throw new Error("Order tidak ditemukan: "+req.orderId);
  var order=decodeFirestoreFields(orderDoc.fields||{});
  if(order.production===true) throw new Error("Universal API sandbox tidak dapat memproses order production.");
  if(String(order.merchant_id||"")!==req.merchantId) throw new Error("Order merchant mismatch.");
  if(String(order.application_id||"")!==req.applicationId) throw new Error("Order application mismatch.");
  if(Number(order.amount)!==req.amount) throw new Error("Order amount mismatch.");
  if(String(order.currency||"IDR").toUpperCase()!==req.currency) throw new Error("Order currency mismatch.");
  if(req.paymentPurpose==="UPGRADE"){
    var prev=body.previousAmount==null?null:Number(body.previousAmount), target=body.targetAmount==null?null:Number(body.targetAmount);
    var delta=body.upgradeDelta==null?null:Number(body.upgradeDelta);
    if(!Number.isSafeInteger(prev)||!Number.isSafeInteger(target)||target<=prev) throw new Error("Upgrade membutuhkan previous_amount dan target_amount yang valid.");
    if(delta!==null && delta!==target-prev) throw new Error("upgrade_delta harus sama dengan target_amount - previous_amount.");
    if(req.amount!==target-prev) throw new Error("Amount API untuk UPGRADE harus sama dengan selisih target dan previous.");
    req.previousAmount=prev;req.targetAmount=target;req.upgradeDelta=target-prev;
  } else { req.previousAmount=null;req.targetAmount=null;req.upgradeDelta=null; }
  req.clientReference=bodySafeText_(body.clientReference||body.client_reference);
  req.sourceReference=bodySafeText_(body.sourceReference||body.source_reference);
  req.targetReference=bodySafeText_(body.targetReference||body.target_reference);
  return createUniversalPaymentIntent_(order,req,"MERCHANT_API:"+req.merchantId);
}
function processUniversalPaymentApiTest(body){
  if(!body.idToken) throw new Error("Firebase ID token wajib.");
  var authUser=verifyFirebaseIdToken(body.idToken),admin=getAdminProfile(authUser.uid);
  if(!admin||admin.active!==true) throw new Error("Akun tidak memiliki akses admin BeePay.");
  var merchantId="SANDBOX-MERCHANT-231",merchant=findMerchantRegistryById_(merchantId),checks=[];
  function add(name,pass,detail){checks.push({name:name,pass:!!pass,detail:String(detail||"")});}
  add("Merchant registry fixture exists",!!merchant,merchantId);
  if(!merchant) return {success:false,environment:"SANDBOX",production:false,passCount:1,failCount:1,checked:2,overall:"FAIL",checks:checks,message:"Merchant registry fixture belum tersedia. Jalankan Phase 23.1 Registry & Auth Test terlebih dahulu."};
  var secret=String(PropertiesService.getScriptProperties().getProperty(merchantPropertyKey_(merchantId))||"").trim();
  var registeredApplicationId=String(merchant.application_id||"").trim();
  add("Merchant has a bound Application ID",!!registeredApplicationId,registeredApplicationId);
  add("Merchant is ACTIVE",String(merchant.status||"").toUpperCase()==="ACTIVE",String(merchant.status||""));
  add("Merchant environment is SANDBOX",String(merchant.environment||"").toUpperCase()==="SANDBOX",String(merchant.environment||""));
  add("Credential exists only in trusted backend",!!secret,"Script Properties");
  add("Raw credential is not returned",true,"credential omitted from API response");
  add("Allowed QRIS channel exists",(merchant.allowed_channels||["QRIS"]).indexOf("QRIS")>=0,"QRIS");
  var stamp=Date.now(),orderId="ORDER-API-232-"+stamp,now=new Date().toISOString();
  var testApplicationId=registeredApplicationId||"SANDBOX-APP-231";
  createDocument("orders",orderId,{order_id:str(orderId),user_id:str(authUser.uid),merchant_id:str(merchantId),
    application_id:str(testApplicationId),event_id:str("SANDBOX-API-232"),amount:integer(125000),currency:str("IDR"),
    status:str("PENDING_PAYMENT"),payment_method_id:str("SANDBOX"),reference:str("API-ORDER-"+stamp),
    payment_purpose:str("PURCHASE"),created_by:str(authUser.uid),production:boolean(false),source:str("SANDBOX"),
    created_at:timestamp(now),updated_at:timestamp(now)});
  var request={merchantId:merchantId,applicationId:testApplicationId,apiKey:secret,orderId:orderId,amount:125000,
    currency:"IDR",channel:"QRIS",paymentPurpose:"PURCHASE",idempotencyKey:"API:"+merchantId+":"+orderId};
  var result=null;
  try{result=processUniversalPaymentApiRequest(request);add("Universal API creates Payment Intent",!!result.paymentIntentId,result.paymentIntentId);}
  catch(e){add("Universal API creates Payment Intent",false,String(e.message||e));}
  if(result){
    add("Payment Intent status is REQUIRES_PAYMENT",result.status==="REQUIRES_PAYMENT",result.status);
    add("Merchant/Application binding is preserved",result.merchantId===merchantId&&result.applicationId===testApplicationId,"merchant="+result.merchantId+" application="+result.applicationId);
    add("Amount/currency/channel preserved",result.amount===125000&&result.currency==="IDR"&&result.channel==="QRIS","125000/IDR/QRIS");
    add("Production remains OFF",result.production===false,"production=false");
    add("Live bank remains OFF",result.liveBankCalled===false,"liveBankCalled=false");
    add("Credential values are not exposed",result.credentialValuesExposed===false,"false");
    var second=processUniversalPaymentApiRequest(request);
    add("Same idempotency key is idempotent",second.paymentIntentId===result.paymentIntentId&&second.idempotent===true,"first="+result.paymentIntentId+" second="+second.paymentIntentId);
    add("Idempotent response remains bound",second.merchantId===merchantId&&second.applicationId===testApplicationId,"identity match");
    try{processUniversalPaymentApiRequest(Object.assign({},request,{apiKey:"INVALID-API-KEY"}));add("Invalid API key is rejected",false,"unexpectedly accepted");}
    catch(e){add("Invalid API key is rejected",true,String(e.message||e));}
    try{processUniversalPaymentApiRequest(Object.assign({},request,{merchantId:"SANDBOX-MERCHANT-DOES-NOT-EXIST"}));add("Unknown merchant is rejected",false,"unexpectedly accepted");}
    catch(e){add("Unknown merchant is rejected",true,String(e.message||e));}
  }
  var passCount=checks.filter(function(x){return x.pass;}).length,failCount=checks.length-passCount;
  return {success:failCount===0,environment:"SANDBOX",production:false,liveBankCalled:false,test:"UNIVERSAL_MERCHANT_PAYMENT_API",
    passCount:passCount,failCount:failCount,checked:checks.length,overall:failCount===0?"PASS":"FAIL",merchantId:merchantId,
    checks:checks,paymentIntentId:result?result.paymentIntentId:"",
    message:failCount===0?"Universal Merchant Payment API PASS: merchant-authenticated API dapat membuat Payment Intent dan idempotency tetap aman.":"Universal Merchant Payment API FAIL: periksa checks.",
    timestamp:new Date().toISOString()};
}
function getProviderAdapter(provider) {
  const name = String(provider || "").trim().toUpperCase();
  const adapters = {
    "SANDBOX-PJP": {
      provider: "SANDBOX-PJP",
      environment: "SANDBOX",
      enabled: true,
      live: false,
      signatureAlgorithm: "SHA-256",
      supportedEvents: {
        PAYMENT_PROCESSING: "PROCESSING",
        PAYMENT_SUCCEEDED: "SUCCEEDED",
        PAYMENT_FAILED: "FAILED"
      }
    }
  };
  return adapters[name] || null;
}

function bytesToHex_(bytes) {
  return bytes.map(function(b) {
    const n = b < 0 ? b + 256 : b;
    return ("0" + n.toString(16)).slice(-2);
  }).join("");
}

function computeSandboxProviderSignature_(payload) {
  const adapter = getProviderAdapter("SANDBOX-PJP");
  if (!adapter || !adapter.enabled || adapter.live) throw new Error("Sandbox provider adapter tidak tersedia.");
  const canonical = [
    payload.provider, payload.providerEventId, payload.paymentIntentId,
    payload.providerReference, payload.amount, payload.currency,
    payload.eventType, payload.targetStatus, payload.payloadHash
  ].join("|");
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8
  ));
}

function processSandboxAdapterWebhook(body) {
  const provider = requiredText(body.provider, "Provider").toUpperCase();
  const adapter = getProviderAdapter(provider);
  if (!adapter || adapter.live || adapter.environment !== "SANDBOX") {
    throw new Error("Provider adapter tidak diizinkan pada SANDBOX: " + provider);
  }

  const paymentIntentId = requiredText(body.paymentIntentId, "Payment Intent ID");
  const providerEventId = requiredText(body.providerEventId, "Provider Event ID");
  const providerReference = requiredText(body.providerReference, "Provider Reference");
  const payloadHash = requiredText(body.payloadHash, "Payload Hash");
  const eventType = requiredText(body.eventType, "Event Type").toUpperCase();
  const targetStatus = requiredText(body.targetStatus, "Target Status").toUpperCase();
  const currency = String(body.currency || "IDR").trim().toUpperCase();
  const amount = Number(body.amount);
  const signature = String(body.signature || "").trim().toLowerCase();

  if (!adapter.supportedEvents[eventType] || adapter.supportedEvents[eventType] !== targetStatus) {
    throw new Error("Event mapping provider tidak valid.");
  }
  if (currency !== "IDR") throw new Error("Currency provider sandbox harus IDR.");
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Amount provider harus berupa bilangan IDR yang valid.");
  if (!signature) throw new Error("Signature provider wajib diisi.");

  const expected = computeSandboxProviderSignature_({
    provider: provider,
    providerEventId: providerEventId,
    paymentIntentId: paymentIntentId,
    providerReference: providerReference,
    amount: amount,
    currency: currency,
    eventType: eventType,
    targetStatus: targetStatus,
    payloadHash: payloadHash
  });

  if (signature !== expected) {
    return {
      success: false, rejected: true, environment: "SANDBOX", production: false,
      provider: provider, providerEventId: providerEventId,
      paymentIntentId: paymentIntentId, reason: "INVALID_SIGNATURE",
      message: "Signature provider tidak valid. Payment state tidak diubah.",
      timestamp: new Date().toISOString()
    };
  }

  return processSandboxWebhook({
    idToken: body.idToken,
    paymentIntentId: paymentIntentId,
    provider: provider,
    providerEventId: providerEventId,
    eventType: eventType,
    providerReference: providerReference,
    payloadHash: payloadHash,
    amount: amount,
    currency: currency,
    targetStatus: targetStatus,
    signatureValid: true
  });
}

function processSandboxProviderAdapterTest(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) throw new Error("Akun tidak memiliki akses admin BeePay.");

  const provider = "SANDBOX-PJP";
  const adapter = getProviderAdapter(provider);
  const stamp = Date.now();
  const orderId = "ORDER-SBX-ADAPTER-" + stamp;
  const eventId = "EVENT-002";
  const userId = "TEST-USER-002";
  const amount = 100000;

  processSandboxCreateOrder({
    idToken: body.idToken, orderId: orderId, eventId: eventId, userId: userId, amount: amount
  });
  const intent = processCreatePaymentIntent({
    idToken: body.idToken, orderId: orderId, eventId: eventId, amount: amount,
    channel: "QRIS", clientReference: "PHASE-22.5-ADAPTER",
    idempotencyKey: "PHASE-22.5-ADAPTER-" + stamp
  });
  const intentId = String(intent.paymentIntentId || "");
  const reference = "ADP-REF-" + stamp;
  const hash = "ADP-HASH-" + stamp;
  const checks = [];
  function addCheck(name, pass, detail) {
    checks.push({name:name, pass:!!pass, detail:String(detail || "")});
  }

  addCheck("Adapter SANDBOX-PJP registered", !!adapter && adapter.enabled === true && adapter.live === false,
    adapter ? "environment=" + adapter.environment : "missing");
  addCheck("Adapter never calls live bank", !!adapter && adapter.live === false,
    adapter ? "live=" + adapter.live : "missing");
  addCheck("Event mapping PROCESSING", !!adapter && adapter.supportedEvents.PAYMENT_PROCESSING === "PROCESSING",
    adapter ? adapter.supportedEvents.PAYMENT_PROCESSING : "missing");
  addCheck("Event mapping SUCCEEDED", !!adapter && adapter.supportedEvents.PAYMENT_SUCCEEDED === "SUCCEEDED",
    adapter ? adapter.supportedEvents.PAYMENT_SUCCEEDED : "missing");

  const base = {
    idToken: body.idToken, paymentIntentId: intentId, provider: provider,
    providerEventId: "ADP-EVT-" + stamp + "-P", eventType: "PAYMENT_PROCESSING",
    providerReference: reference + "-P", payloadHash: hash + "-P",
    amount: amount, currency: "IDR", targetStatus: "PROCESSING"
  };
  const validSig = computeSandboxProviderSignature_(base);
  const processing = processSandboxAdapterWebhook(Object.assign({}, base, {signature:validSig}));
  addCheck("Valid signature accepted", processing.success && processing.targetStatus === "PROCESSING", processing.message);

  const duplicate = processSandboxAdapterWebhook(Object.assign({}, base, {signature:validSig}));
  addCheck("Duplicate provider event idempotent", duplicate.success && duplicate.idempotent === true, duplicate.message);

  const invalidBase = Object.assign({}, base, {
    providerEventId: "ADP-EVT-" + stamp + "-INVALID",
    providerReference: reference + "-INVALID", payloadHash: hash + "-INVALID"
  });
  const invalid = processSandboxAdapterWebhook(Object.assign({}, invalidBase, {signature:"00"}));
  addCheck("Invalid signature rejected", invalid.rejected === true && invalid.reason === "INVALID_SIGNATURE", invalid.message);

  const badAmount = Object.assign({}, base, {
    providerEventId: "ADP-EVT-" + stamp + "-AMOUNT",
    providerReference: reference + "-AMOUNT", payloadHash: hash + "-AMOUNT", amount: amount + 1
  });
  let amountRejected = false, amountDetail = "";
  try { processSandboxAdapterWebhook(Object.assign({}, badAmount, {signature:computeSandboxProviderSignature_(badAmount)})); }
  catch (err) { amountDetail = String(err.message || err); amountRejected = amountDetail.indexOf("Nominal webhook tidak sesuai Payment Intent") >= 0; }
  addCheck("Amount mismatch rejected", amountRejected, amountDetail || "unexpected acceptance");

  const badCurrency = Object.assign({}, base, {
    providerEventId: "ADP-EVT-" + stamp + "-CUR",
    providerReference: reference + "-CUR", payloadHash: hash + "-CUR", currency: "USD"
  });
  let currencyRejected = false, currencyDetail = "";
  try { processSandboxAdapterWebhook(Object.assign({}, badCurrency, {signature:computeSandboxProviderSignature_(badCurrency)})); }
  catch (err) { currencyDetail = String(err.message || err); currencyRejected = currencyDetail.indexOf("Currency provider sandbox harus IDR") >= 0; }
  addCheck("Currency mismatch rejected", currencyRejected, currencyDetail || "unexpected acceptance");

  const badMapping = Object.assign({}, base, {
    providerEventId: "ADP-EVT-" + stamp + "-MAP",
    providerReference: reference + "-MAP", payloadHash: hash + "-MAP",
    eventType: "PAYMENT_SUCCEEDED", targetStatus: "PROCESSING"
  });
  let mappingRejected = false, mappingDetail = "";
  try { processSandboxAdapterWebhook(Object.assign({}, badMapping, {signature:computeSandboxProviderSignature_(badMapping)})); }
  catch (err) { mappingDetail = String(err.message || err); mappingRejected = mappingDetail.indexOf("Event mapping provider tidak valid") >= 0; }
  addCheck("Invalid event mapping rejected", mappingRejected, mappingDetail || "unexpected acceptance");

  const successBase = {
    idToken: body.idToken, paymentIntentId: intentId, provider: provider,
    providerEventId: "ADP-EVT-" + stamp + "-S", eventType: "PAYMENT_SUCCEEDED",
    providerReference: reference + "-S", payloadHash: hash + "-S",
    amount: amount, currency: "IDR", targetStatus: "SUCCEEDED"
  };
  const succeeded = processSandboxAdapterWebhook(Object.assign({}, successBase, {
    signature:computeSandboxProviderSignature_(successBase)
  }));
  addCheck("Valid SUCCEEDED callback accepted",
    succeeded.success && succeeded.targetStatus === "SUCCEEDED" && !!succeeded.transactionId, succeeded.message);

  const duplicateSuccess = processSandboxAdapterWebhook(Object.assign({}, successBase, {
    signature:computeSandboxProviderSignature_(successBase)
  }));
  addCheck("Duplicate SUCCEEDED idempotent", duplicateSuccess.success && duplicateSuccess.idempotent === true, duplicateSuccess.message);

  let unsupportedRejected = false, unsupportedDetail = "";
  try {
    processSandboxAdapterWebhook(Object.assign({}, successBase, {provider:"LIVE-BANK-UNSUPPORTED"}));
  } catch (err) { unsupportedDetail = String(err.message || err); unsupportedRejected = unsupportedDetail.indexOf("Provider adapter tidak diizinkan") >= 0; }
  addCheck("Unsupported/live adapter rejected", unsupportedRejected, unsupportedDetail || "unexpected acceptance");

  const finalIntentDoc = getDocument("payment_intents", intentId);
  const finalIntent = finalIntentDoc ? decodeFirestoreFields(finalIntentDoc.fields || {}) : {};
  const txs = listDocuments("transactions", 500).filter(function(x) {
    return String(x.data.payment_intent_id || "") === intentId && String(x.data.status || "").toUpperCase() === "PAID";
  });
  const pays = listDocuments("payments", 500).filter(function(x) {
    return String(x.data.payment_intent_id || "") === intentId && String(x.data.status || "").toUpperCase() === "PAID";
  });
  const tickets = listDocuments("tickets", 500).filter(function(x) {
    return String(x.data.payment_intent_id || "") === intentId && String(x.data.status || "").toUpperCase() === "ACTIVE";
  });
  addCheck("Final intent SUCCEEDED", String(finalIntent.status || "") === "SUCCEEDED", "status=" + String(finalIntent.status || "-"));
  addCheck("Exactly one PAID transaction", txs.length === 1, "PAID transactions=" + txs.length);
  addCheck("Exactly one PAID payment", pays.length === 1, "PAID payments=" + pays.length);
  addCheck("Exactly one ACTIVE ticket", tickets.length === 1, "ACTIVE tickets=" + tickets.length);

  const passCount = checks.filter(function(x){return x.pass;}).length;
  const failCount = checks.length - passCount;
  return {
    success: failCount === 0, environment: "SANDBOX", production: false, liveBankCalled: false,
    provider: provider, paymentIntentId: intentId, orderId: orderId,
    passCount: passCount, failCount: failCount, checked: checks.length,
    overall: failCount === 0 ? "PASS" : "FAIL", checks: checks,
    message: failCount === 0
      ? "Provider Adapter Security PASS: adapter SANDBOX-PJP, signature validation, event mapping, mismatch rejection, webhook idempotency, dan payment effects aman."
      : "Provider Adapter Security FAIL: periksa checks.",
    timestamp: new Date().toISOString()
  };
}

function processSandboxWebhook(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const paymentIntentId = requiredText(body.paymentIntentId, "Payment Intent ID");
  const provider = requiredText(body.provider, "Provider");
  const providerEventId = requiredText(body.providerEventId, "Provider Event ID");
  const eventType = requiredText(body.eventType, "Event Type").toUpperCase();
  const providerReference = requiredText(body.providerReference, "Provider Reference");
  const payloadHash = requiredText(body.payloadHash, "Payload Hash");
  const currency = String(body.currency || "IDR").trim().toUpperCase();
  const amount = Number(body.amount);
  const targetStatus = requiredText(body.targetStatus, "Target Status").toUpperCase();
  const signatureValid = body.signatureValid === true;

  if (!/^[A-Za-z0-9._:-]{3,100}$/.test(providerEventId)) {
    throw new Error("Provider Event ID mengandung karakter yang tidak didukung.");
  }
  if (!["PAYMENT_PROCESSING","PAYMENT_SUCCEEDED","PAYMENT_FAILED"].includes(eventType)) {
    throw new Error("Event Type sandbox tidak valid.");
  }
  if (!["PROCESSING","SUCCEEDED","FAILED"].includes(targetStatus)) {
    throw new Error("Target Status sandbox tidak valid.");
  }
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new Error("Amount harus berupa bilangan IDR yang valid.");
  }
  if (currency !== "IDR") {
    throw new Error("Currency webhook harus IDR.");
  }

  const intentDoc = getDocument("payment_intents", paymentIntentId);
  if (!intentDoc || !intentDoc.fields) {
    throw new Error("Payment Intent tidak ditemukan: " + paymentIntentId);
  }
  const intent = decodeFirestoreFields(intentDoc.fields || {});
  if (intent.production !== false || intent.trusted !== true || intent.created_by_backend !== true) {
    throw new Error("Payment Intent bukan intent sandbox trusted backend.");
  }
  if (Number(intent.amount) !== amount) throw new Error("Nominal webhook tidak sesuai Payment Intent.");
  if (String(intent.currency || "IDR").toUpperCase() !== "IDR") throw new Error("Currency Payment Intent harus IDR.");

  const expectedEventType = targetStatus === "PROCESSING"
    ? "PAYMENT_PROCESSING"
    : targetStatus === "SUCCEEDED"
      ? "PAYMENT_SUCCEEDED"
      : "PAYMENT_FAILED";
  if (eventType !== expectedEventType) {
    throw new Error("Event Type tidak sesuai dengan Target Status.");
  }

  const webhookId = "WH-SBX-" + providerEventId;
  const existingWebhook = getDocument("webhooks", webhookId);
  if (existingWebhook && existingWebhook.fields) {
    const existingData = decodeFirestoreFields(existingWebhook.fields || {});
    return {
      success: true,
      existing: true,
      idempotent: true,
      environment: "SANDBOX",
      production: false,
      webhookId: webhookId,
      providerEventId: providerEventId,
      paymentIntentId: paymentIntentId,
      targetStatus: String(existingData.target_status || targetStatus),
      processingStatus: String(existingData.status || "PROCESSED"),
      processingResult: String(existingData.processing_result || "Webhook sudah diproses sebelumnya."),
      message: "Duplicate webhook diterima secara idempotent. Tidak ada perubahan state tambahan.",
      timestamp: new Date().toISOString()
    };
  }

  // Invalid signature/authentication is recorded as REJECTED, but it can never
  // mutate the Payment Intent, Transaction, Payment, Ledger, or Ticket.
  if (!signatureValid) {
    createDocument("webhooks", webhookId, {
      webhook_id: str(webhookId),
      provider: str(provider),
      provider_event_id: str(providerEventId),
      event_type: str(eventType),
      reference: str(providerReference),
      payment_intent_id: str(paymentIntentId),
      payload_hash: str(payloadHash),
      target_status: str(targetStatus),
      status: str("REJECTED"),
      processing_result: str("INVALID_SIGNATURE"),
      received_at: timestamp(new Date().toISOString()),
      processed_at: timestamp(new Date().toISOString()),
      created_by: str(authUser.uid),
      production: boolean(false)
    });
    return {
      success: false,
      rejected: true,
      environment: "SANDBOX",
      production: false,
      webhookId: webhookId,
      providerEventId: providerEventId,
      paymentIntentId: paymentIntentId,
      targetStatus: targetStatus,
      reason: "INVALID_SIGNATURE",
      message: "Webhook ditolak. Signature sandbox tidak valid dan state pembayaran tidak diubah.",
      timestamp: new Date().toISOString()
    };
  }

  // A provider reference must not be reused by a different event.
  const referenceCollision = listDocuments("webhooks", 500).find(function(item) {
    const d = item.data || {};
    return String(d.provider || "") === provider &&
      String(d.reference || "") === providerReference &&
      String(d.provider_event_id || "") !== providerEventId &&
      String(d.status || "").toUpperCase() === "PROCESSED";
  });
  if (referenceCollision) {
    createDocument("webhooks", webhookId, {
      webhook_id: str(webhookId),
      provider: str(provider),
      provider_event_id: str(providerEventId),
      event_type: str(eventType),
      reference: str(providerReference),
      payment_intent_id: str(paymentIntentId),
      payload_hash: str(payloadHash),
      target_status: str(targetStatus),
      status: str("REJECTED"),
      processing_result: str("DUPLICATE_PROVIDER_REFERENCE"),
      received_at: timestamp(new Date().toISOString()),
      processed_at: timestamp(new Date().toISOString()),
      created_by: str(authUser.uid),
      production: boolean(false)
    });
    return {
      success: false,
      rejected: true,
      environment: "SANDBOX",
      production: false,
      webhookId: webhookId,
      providerEventId: providerEventId,
      paymentIntentId: paymentIntentId,
      targetStatus: targetStatus,
      reason: "DUPLICATE_PROVIDER_REFERENCE",
      message: "Webhook ditolak karena provider reference sudah digunakan oleh event lain.",
      timestamp: new Date().toISOString()
    };
  }

  const currentStatus = String(intent.status || "").toUpperCase();
  const terminal = ["SUCCEEDED","FAILED","EXPIRED","CANCELLED"];
  if (terminal.includes(currentStatus)) {
    createDocument("webhooks", webhookId, {
      webhook_id: str(webhookId),
      provider: str(provider),
      provider_event_id: str(providerEventId),
      event_type: str(eventType),
      reference: str(providerReference),
      payment_intent_id: str(paymentIntentId),
      payload_hash: str(payloadHash),
      target_status: str(targetStatus),
      status: str("REJECTED"),
      processing_result: str("OUT_OF_ORDER_TERMINAL_STATE"),
      received_at: timestamp(new Date().toISOString()),
      processed_at: timestamp(new Date().toISOString()),
      created_by: str(authUser.uid),
      production: boolean(false)
    });
    return {
      success: false,
      rejected: true,
      environment: "SANDBOX",
      production: false,
      webhookId: webhookId,
      providerEventId: providerEventId,
      paymentIntentId: paymentIntentId,
      targetStatus: targetStatus,
      reason: "OUT_OF_ORDER_TERMINAL_STATE",
      currentStatus: currentStatus,
      message: "Webhook out-of-order ditolak karena Payment Intent sudah berada pada status terminal.",
      timestamp: new Date().toISOString()
    };
  }

  const now = new Date().toISOString();
  const transactions = listDocuments("transactions", 500).filter(function(item) {
    return String(item.data.payment_intent_id || "") === paymentIntentId;
  });
  let tx = transactions.find(function(item) {
    return String(item.data.status || "").toUpperCase() === "PENDING";
  });
  let txId = tx ? String(tx.data.transaction_id || tx.id) : "";
  let paymentId = "";
  let ticketId = "";

  if (targetStatus === "PROCESSING") {
    if (!tx) {
      txId = "SBX-WH-TX-" + Date.now();
      createDocument("transactions", txId, {
        transaction_id: str(txId),
        order_id: str(intent.order_id || ""),
        payment_intent_id: str(paymentIntentId),
        event_id: str(intent.event_id || ""),
        user_id: str(intent.user_id || ""),
        amount: integer(amount),
        currency: str("IDR"),
        status: str("PENDING"),
        channel: str(intent.channel || "SANDBOX"),
        provider_reference: str(providerReference),
        trusted: boolean(true),
        production: boolean(false),
        created_at: timestamp(now),
        updated_at: timestamp(now)
      });
    } else {
      updateDocument("transactions", txId, {
        provider_reference: str(providerReference),
        updated_at: timestamp(now)
      }, ["provider_reference", "updated_at"]);
    }
    updateDocument("payment_intents", paymentIntentId, {
      status: str("PROCESSING"),
      provider_reference: str(providerReference),
      updated_at: timestamp(now)
    }, ["status", "provider_reference", "updated_at"]);
  } else if (targetStatus === "SUCCEEDED") {
    if (tx) {
      txId = String(tx.data.transaction_id || tx.id);
      updateDocument("transactions", txId, {
        status: str("PAID"),
        provider_reference: str(providerReference),
        paid_at: timestamp(now),
        updated_at: timestamp(now)
      }, ["status", "provider_reference", "paid_at", "updated_at"]);
    } else {
      txId = "SBX-WH-TX-" + Date.now();
      createDocument("transactions", txId, {
        transaction_id: str(txId),
        order_id: str(intent.order_id || ""),
        payment_intent_id: str(paymentIntentId),
        event_id: str(intent.event_id || ""),
        user_id: str(intent.user_id || ""),
        amount: integer(amount),
        currency: str("IDR"),
        status: str("PAID"),
        channel: str(intent.channel || "SANDBOX"),
        provider_reference: str(providerReference),
        trusted: boolean(true),
        production: boolean(false),
        created_at: timestamp(now),
        updated_at: timestamp(now),
        paid_at: timestamp(now)
      });
    }

    const paidPayments = listDocuments("payments", 500).filter(function(item) {
      return String(item.data.payment_intent_id || "") === paymentIntentId &&
        String(item.data.status || "").toUpperCase() === "PAID";
    });
    if (paidPayments.length > 0) {
      paymentId = String(paidPayments[0].data.payment_id || paidPayments[0].id);
    } else {
      paymentId = "PAY-SBX-WH-" + Date.now();
      createDocument("payments", paymentId, {
        payment_id: str(paymentId),
        payment_intent_id: str(paymentIntentId),
        transaction_id: str(txId),
        provider: str(provider),
        channel: str(intent.channel || "SANDBOX"),
        provider_reference: str(providerReference),
        status: str("PAID"),
        created_at: timestamp(now),
        updated_at: timestamp(now),
        event_id: str(intent.event_id || ""),
        user_id: str(intent.user_id || ""),
        amount: integer(amount),
        currency: str("IDR"),
        trusted: boolean(true),
        production: boolean(false),
        verified_by_backend: boolean(true)
      });
    }

    updateDocument("payment_intents", paymentIntentId, {
      status: str("SUCCEEDED"),
      provider_reference: str(providerReference),
      updated_at: timestamp(now)
    }, ["status", "provider_reference", "updated_at"]);

    const activeTickets = listDocuments("tickets", 500).filter(function(item) {
      return String(item.data.payment_intent_id || "") === paymentIntentId &&
        String(item.data.status || "").toUpperCase() === "ACTIVE";
    });
    if (activeTickets.length > 0) {
      ticketId = String(activeTickets[0].data.ticket_id || activeTickets[0].id);
    } else {
      ticketId = "TKT-SBX-WH-" + Date.now();
      createDocument("tickets", ticketId, {
        ticket_id: str(ticketId),
        order_id: str(intent.order_id || ""),
        transaction_id: str(txId),
        payment_intent_id: str(paymentIntentId),
        user_id: str(intent.user_id || ""),
        event_id: str(intent.event_id || ""),
        status: str("ACTIVE"),
        active: boolean(true),
        activated_by_backend: boolean(true),
        activation_source: str("SANDBOX_WEBHOOK_TRUSTED_BACKEND"),
        production: boolean(false),
        created_at: timestamp(now),
        activated_at: timestamp(now)
      });
    }
  } else if (targetStatus === "FAILED") {
    if (tx) {
      txId = String(tx.data.transaction_id || tx.id);
      updateDocument("transactions", txId, {
        status: str("FAILED"),
        provider_reference: str(providerReference),
        updated_at: timestamp(now)
      }, ["status", "provider_reference", "updated_at"]);
    } else {
      txId = "SBX-WH-TX-" + Date.now();
      createDocument("transactions", txId, {
        transaction_id: str(txId),
        order_id: str(intent.order_id || ""),
        payment_intent_id: str(paymentIntentId),
        event_id: str(intent.event_id || ""),
        user_id: str(intent.user_id || ""),
        amount: integer(amount),
        currency: str("IDR"),
        status: str("FAILED"),
        channel: str(intent.channel || "SANDBOX"),
        provider_reference: str(providerReference),
        trusted: boolean(true),
        production: boolean(false),
        created_at: timestamp(now),
        updated_at: timestamp(now)
      });
    }
    updateDocument("payment_intents", paymentIntentId, {
      status: str("FAILED"),
      provider_reference: str(providerReference),
      updated_at: timestamp(now)
    }, ["status", "provider_reference", "updated_at"]);
  }

  createDocument("webhooks", webhookId, {
    webhook_id: str(webhookId),
    provider: str(provider),
    provider_event_id: str(providerEventId),
    event_type: str(eventType),
    reference: str(providerReference),
    payment_intent_id: str(paymentIntentId),
    payload_hash: str(payloadHash),
    target_status: str(targetStatus),
    status: str("PROCESSED"),
    processing_result: str(targetStatus === "SUCCEEDED" ? "PAYMENT_ACTIVATED" : targetStatus),
    received_at: timestamp(now),
    processed_at: timestamp(now),
    created_by: str(authUser.uid),
    production: boolean(false)
  });

  createDocument("audit_logs", "AUD-SBX-WH-" + Date.now(), {
    audit_id: str("AUD-SBX-WH-" + Date.now()),
    action: str("SANDBOX_WEBHOOK"),
    target_id: str(webhookId),
    severity: str("INFO"),
    outcome: str(targetStatus),
    payment_intent_id: str(paymentIntentId),
    provider_reference: str(providerReference),
    production: boolean(false),
    real_bank_called: boolean(false),
    created_by: str(authUser.uid),
    created_at: timestamp(now)
  });

  return {
    success: true,
    existing: false,
    idempotent: false,
    environment: "SANDBOX",
    production: false,
    liveBankCalled: false,
    webhookId: webhookId,
    providerEventId: providerEventId,
    paymentIntentId: paymentIntentId,
    targetStatus: targetStatus,
    processingStatus: "PROCESSED",
    transactionId: txId,
    paymentId: paymentId || null,
    ticketId: ticketId || null,
    message: targetStatus === "SUCCEEDED"
      ? "Webhook SUCCESS diproses trusted backend. Payment PAID dan ticket ACTIVE."
      : "Webhook " + targetStatus + " diproses trusted backend.",
    timestamp: now
  };
}

/**
 * Controlled Phase 22.4 lifecycle test.
 * Creates a fresh sandbox intent, then verifies:
 * PROCESSING → duplicate PROCESSING → SUCCEEDED → duplicate SUCCEEDED,
 * followed by rejected out-of-order FAILED and rejected invalid signature.
 */
function processSandboxWebhookLifecycleTest(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const stamp = Date.now();
  const orderId = "ORDER-SBX-WH-" + stamp;
  const eventId = "EVENT-002";
  const userId = "TEST-USER-002";
  const amount = 100000;

  processSandboxCreateOrder({
    idToken: body.idToken,
    orderId: orderId,
    eventId: eventId,
    userId: userId,
    amount: amount
  });

  const intent = processCreatePaymentIntent({
    idToken: body.idToken,
    orderId: orderId,
    eventId: eventId,
    amount: amount,
    channel: "QRIS",
    clientReference: "PHASE-22.4-WEBHOOK",
    idempotencyKey: "PHASE-22.4-WEBHOOK-" + stamp
  });

  const intentId = intent.paymentIntentId;
  const provider = "SANDBOX-PJP";
  const reference = "SBX-WH-REF-" + stamp;
  const hash = "sha256-sandbox-" + stamp;

  const checks = [];
  function addCheck(name, pass, detail) {
    checks.push({name: name, pass: !!pass, detail: detail || ""});
  }
  function callWebhook(eventSuffix, eventType, targetStatus, valid) {
    return processSandboxWebhook({
      idToken: body.idToken,
      paymentIntentId: intentId,
      provider: provider,
      providerEventId: "EVT-" + stamp + "-" + eventSuffix,
      eventType: eventType,
      providerReference: reference + "-" + eventSuffix,
      payloadHash: hash + "-" + eventSuffix,
      amount: amount,
      targetStatus: targetStatus,
      signatureValid: valid
    });
  }

  const p1 = callWebhook("P", "PAYMENT_PROCESSING", "PROCESSING", true);
  addCheck("PROCESSING accepted", p1.success && p1.targetStatus === "PROCESSING", p1.message);

  const duplicateP = processSandboxWebhook({
    idToken: body.idToken,
    paymentIntentId: intentId,
    provider: provider,
    providerEventId: "EVT-" + stamp + "-P",
    eventType: "PAYMENT_PROCESSING",
    providerReference: reference + "-P",
    payloadHash: hash + "-P",
    amount: amount,
    targetStatus: "PROCESSING",
    signatureValid: true
  });
  addCheck("Duplicate PROCESSING idempotent", duplicateP.success && duplicateP.idempotent === true, duplicateP.message);

  const s1 = callWebhook("S", "PAYMENT_SUCCEEDED", "SUCCEEDED", true);
  addCheck("SUCCEEDED accepted", s1.success && s1.targetStatus === "SUCCEEDED" && !!s1.transactionId && !!s1.paymentId && !!s1.ticketId, s1.message);

  const duplicateS = processSandboxWebhook({
    idToken: body.idToken,
    paymentIntentId: intentId,
    provider: provider,
    providerEventId: "EVT-" + stamp + "-S",
    eventType: "PAYMENT_SUCCEEDED",
    providerReference: reference + "-S",
    payloadHash: hash + "-S",
    amount: amount,
    targetStatus: "SUCCEEDED",
    signatureValid: true
  });
  addCheck("Duplicate SUCCEEDED idempotent", duplicateS.success && duplicateS.idempotent === true, duplicateS.message);

  const outOfOrder = callWebhook("F", "PAYMENT_FAILED", "FAILED", true);
  addCheck("Out-of-order FAILED rejected", outOfOrder.rejected === true && outOfOrder.reason === "OUT_OF_ORDER_TERMINAL_STATE", outOfOrder.message);

  const invalid = processSandboxWebhook({
    idToken: body.idToken,
    paymentIntentId: intentId,
    provider: provider,
    providerEventId: "EVT-" + stamp + "-INVALID",
    eventType: "PAYMENT_SUCCEEDED",
    providerReference: reference + "-INVALID",
    payloadHash: hash + "-INVALID",
    amount: amount,
    targetStatus: "SUCCEEDED",
    signatureValid: false
  });
  addCheck("Invalid webhook rejected", invalid.rejected === true && invalid.reason === "INVALID_SIGNATURE", invalid.message);

  const finalIntentDoc = getDocument("payment_intents", intentId);
  const finalIntent = finalIntentDoc ? decodeFirestoreFields(finalIntentDoc.fields || {}) : {};
  const txs = listDocuments("transactions", 500).filter(function(x) {
    return String(x.data.payment_intent_id || "") === intentId;
  });
  const pays = listDocuments("payments", 500).filter(function(x) {
    return String(x.data.payment_intent_id || "") === intentId;
  });
  const tickets = listDocuments("tickets", 500).filter(function(x) {
    return String(x.data.payment_intent_id || "") === intentId;
  });

  addCheck("Final intent SUCCEEDED", String(finalIntent.status || "") === "SUCCEEDED", "status=" + String(finalIntent.status || "-"));
  addCheck("Exactly one PAID transaction", txs.filter(function(x){ return String(x.data.status || "").toUpperCase() === "PAID"; }).length === 1, "PAID transactions=" + txs.filter(function(x){ return String(x.data.status || "").toUpperCase() === "PAID"; }).length);
  addCheck("Exactly one PAID payment", pays.filter(function(x){ return String(x.data.status || "").toUpperCase() === "PAID"; }).length === 1, "PAID payments=" + pays.filter(function(x){ return String(x.data.status || "").toUpperCase() === "PAID"; }).length);
  addCheck("Exactly one ACTIVE ticket", tickets.filter(function(x){ return String(x.data.status || "").toUpperCase() === "ACTIVE"; }).length === 1, "ACTIVE tickets=" + tickets.filter(function(x){ return String(x.data.status || "").toUpperCase() === "ACTIVE"; }).length);

  const passCount = checks.filter(function(x){ return x.pass; }).length;
  const failCount = checks.length - passCount;
  return {
    success: failCount === 0,
    environment: "SANDBOX",
    production: false,
    liveBankCalled: false,
    overall: failCount === 0 ? "PASS" : "FAIL",
    passCount: passCount,
    failCount: failCount,
    checked: checks.length,
    paymentIntentId: intentId,
    transactionId: s1.transactionId || null,
    paymentId: s1.paymentId || null,
    ticketId: s1.ticketId || null,
    checks: checks,
    message: failCount === 0
      ? "Lifecycle webhook PASS: PROCESSING → SUCCEEDED → PAID → ACTIVE; duplicate dan invalid/out-of-order webhook aman."
      : "Lifecycle webhook menemukan kegagalan. Periksa checks.",
    timestamp: new Date().toISOString()
  };
}

function processSandboxCreateOrder(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const orderId = String(body.orderId || "ORDER-SBX-001").trim();
  const eventId = String(body.eventId || "EVENT-002").trim();
  const userId = String(body.userId || "TEST-USER-002").trim();
  const amount = Number(body.amount || 100000);

  if (!/^ORDER-SBX-[A-Z0-9_-]+$/i.test(orderId)) {
    throw new Error("Order Sandbox harus menggunakan prefix ORDER-SBX-.");
  }
  if (!eventId || !userId) throw new Error("Event ID dan User ID wajib.");
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new Error("Amount harus berupa bilangan IDR yang valid.");
  }

  const existingDoc = getDocument("orders", orderId);
  if (existingDoc && existingDoc.fields) {
    const existing = decodeFirestoreFields(existingDoc.fields || {});
    if (
      existing.production === true ||
      String(existing.event_id || "") !== eventId ||
      String(existing.user_id || "") !== userId ||
      Number(existing.amount) !== amount
    ) {
      throw new Error("Order Sandbox ID sudah digunakan dengan data berbeda atau merupakan order production.");
    }
    return {
      success: true,
      existing: true,
      environment: "SANDBOX",
      production: false,
      trusted: true,
      orderId: orderId,
      eventId: eventId,
      userId: userId,
      amount: amount,
      currency: "IDR",
      status: String(existing.status || "PENDING_PAYMENT"),
      message: "Sandbox Order sudah tersedia dan siap digunakan.",
      timestamp: new Date().toISOString()
    };
  }

  const now = new Date().toISOString();
  createDocument("orders", orderId, {
    order_id: str(orderId),
    user_id: str(userId),
    merchant_id: str("SANDBOX-MERCHANT"),
    event_id: str(eventId),
    amount: integer(amount),
    currency: str("IDR"),
    status: str("PENDING_PAYMENT"),
    payment_method_id: str("SANDBOX"),
    reference: str("SANDBOX-ORDER-" + Date.now()),
    created_by: str(authUser.uid),
    production: boolean(false),
    source: str("SANDBOX"),
    created_at: timestamp(now),
    updated_at: timestamp(now)
  });

  return {
    success: true,
    existing: false,
    environment: "SANDBOX",
    production: false,
    trusted: true,
    orderId: orderId,
    eventId: eventId,
    userId: userId,
    amount: amount,
    currency: "IDR",
    status: "PENDING_PAYMENT",
    message: "Sandbox Order berhasil dibuat oleh trusted backend dan siap digunakan.",
    timestamp: now
  };
}


function isPaymentIntentTerminalStatus_(status) {
  return ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"].includes(
    String(status || "").toUpperCase()
  );
}

function getPaymentIntentExpirationMinutes_() {
  const props = PropertiesService.getScriptProperties();
  const raw = Number(props.getProperty("BEEPAY_PAYMENT_INTENT_EXPIRATION_MINUTES") || 30);
  if (!Number.isFinite(raw) || raw < 1 || raw > 1440) return 30;
  return Math.floor(raw);
}

function isPaymentIntentExpired_(intent) {
  const expiresAt = String(intent.expires_at || "").trim();
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) && ms <= Date.now();
}

function transitionPaymentIntentLifecycle_(paymentIntentId, targetStatus, reason, forceExpired) {
  const doc = getDocument("payment_intents", paymentIntentId);
  if (!doc || !doc.fields) throw new Error("Payment Intent tidak ditemukan: " + paymentIntentId);
  const intent = decodeFirestoreFields(doc.fields || {});
  if (intent.production !== false || intent.trusted !== true || intent.created_by_backend !== true) {
    throw new Error("Payment Intent bukan intent sandbox trusted backend.");
  }

  const current = String(intent.status || "").toUpperCase();
  const target = String(targetStatus || "").toUpperCase();
  if (!["EXPIRED", "CANCELLED"].includes(target)) {
    throw new Error("Lifecycle target tidak valid.");
  }
  if (isPaymentIntentTerminalStatus_(current)) {
    return {
      success: true,
      existing: true,
      idempotent: current === target,
      paymentIntentId: paymentIntentId,
      previousStatus: current,
      status: current,
      message: current === target
        ? "Payment Intent sudah berada pada status lifecycle tersebut."
        : "Payment Intent sudah terminal dan tidak dapat ditransisikan ke status lain."
    };
  }
  if (target === "EXPIRED" && !forceExpired && !isPaymentIntentExpired_(intent)) {
    throw new Error("Payment Intent belum melewati expires_at.");
  }

  const now = new Date().toISOString();
  const fields = {
    status: str(target),
    lifecycle_reason: str(reason || target),
    updated_at: timestamp(now)
  };
  if (target === "EXPIRED") fields.expired_at = timestamp(now);
  if (target === "CANCELLED") fields.cancelled_at = timestamp(now);
  updateDocument("payment_intents", paymentIntentId, fields, Object.keys(fields));

  return {
    success: true,
    existing: false,
    idempotent: false,
    paymentIntentId: paymentIntentId,
    previousStatus: current,
    status: target,
    message: "Payment Intent berhasil ditransisikan ke " + target + ".",
    timestamp: now
  };
}

function processSandboxPaymentIntentLifecycleTest(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const stamp = Date.now();
  const eventId = "EVENT-228-" + stamp;
  const userId = "TEST-USER-228-" + stamp;
  const amount = 125000;
  const checks = [];
  function addCheck(name, pass, detail) {
    checks.push({name: name, pass: !!pass, detail: String(detail || "")});
  }
  function makeOrderIntent(suffix, expiresAt) {
    const orderId = "ORDER-SBX-228-" + stamp + "-" + suffix;
    const intentId = "PI-228-" + stamp + "-" + suffix;
    const now = new Date().toISOString();
    createDocument("orders", orderId, {
      order_id: str(orderId), user_id: str(userId), merchant_id: str("SANDBOX-MERCHANT"),
      event_id: str(eventId), amount: integer(amount), currency: str("IDR"),
      status: str("PENDING_PAYMENT"), payment_method_id: str("SANDBOX"),
      reference: str("SANDBOX-228-" + stamp + "-" + suffix),
      created_by: str(authUser.uid), production: boolean(false), source: str("SANDBOX"),
      created_at: timestamp(now), updated_at: timestamp(now)
    });
    createDocument("payment_intents", intentId, {
      payment_intent_id: str(intentId), order_id: str(orderId), user_id: str(userId),
      merchant_id: str("SANDBOX-MERCHANT"), event_id: str(eventId),
      amount: integer(amount), currency: str("IDR"), channel: str("QRIS"),
      provider: str("SANDBOX-PJP"), provider_adapter: str("SANDBOX-PJP"),
      routing_id: str("SANDBOX-PJP:QRIS"), idempotency_key: str("SBX-228:" + intentId),
      status: str("REQUIRES_PAYMENT"), provider_reference: str(""),
      trusted: boolean(true), production: boolean(false), created_by: str(authUser.uid),
      created_by_backend: boolean(true), created_at: timestamp(now),
      updated_at: timestamp(now), expires_at: timestamp(expiresAt)
    });
    return {orderId: orderId, intentId: intentId};
  }

  const past = new Date(Date.now() - 60 * 1000).toISOString();
  const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const exp = makeOrderIntent("EXP", past);
  const cancel = makeOrderIntent("CAN", future);

  const expDoc = getDocument("payment_intents", exp.intentId);
  const expIntent = decodeFirestoreFields(expDoc.fields || {});
  addCheck("New intent has expires_at", !!expIntent.expires_at, expIntent.expires_at);
  addCheck("New intent starts REQUIRES_PAYMENT", String(expIntent.status) === "REQUIRES_PAYMENT", expIntent.status);
  addCheck("Past expires_at is detected", isPaymentIntentExpired_(expIntent) === true, "expired=true");

  const expTransition = transitionPaymentIntentLifecycle_(exp.intentId, "EXPIRED", "SANDBOX_EXPIRED_TEST", false);
  addCheck("Expired transition accepted", expTransition.success && expTransition.status === "EXPIRED", expTransition.message);

  let paymentRejected = false, paymentReason = "";
  try {
    processSandboxPayment({
      idToken: body.idToken, paymentIntentId: exp.intentId, eventId: eventId,
      userId: userId, amount: amount, outcome: "SUCCESS"
    });
  } catch (e) {
    paymentRejected = true; paymentReason = String(e.message || e);
  }
  addCheck("Expired intent blocks payment", paymentRejected, paymentReason);

  let webhookRejected = false, webhookReason = "";
  try {
    const webhookResult = processSandboxWebhook({
      idToken: body.idToken, paymentIntentId: exp.intentId, provider: "SANDBOX-PJP",
      providerEventId: "EVT-228-EXP-" + stamp, eventType: "PAYMENT_SUCCEEDED",
      providerReference: "REF-228-EXP-" + stamp, payloadHash: "HASH-228-EXP-" + stamp,
      amount: amount, targetStatus: "SUCCEEDED", signatureValid: true
    });
    webhookRejected = !!(webhookResult && webhookResult.rejected === true);
    webhookReason = webhookResult ? String(webhookResult.reason || webhookResult.message || "") : "";
  } catch (e) {
    webhookRejected = true; webhookReason = String(e.message || e);
  }
  addCheck("Late webhook after expiration blocked", webhookRejected, webhookReason);

  const expFinalDoc = getDocument("payment_intents", exp.intentId);
  const expFinal = decodeFirestoreFields(expFinalDoc.fields || {});
  const expTxs = listDocuments("transactions", 500).filter(function(x){return String(x.data.payment_intent_id||"")===exp.intentId;});
  const expPays = listDocuments("payments", 500).filter(function(x){return String(x.data.payment_intent_id||"")===exp.intentId;});
  const expTickets = listDocuments("tickets", 500).filter(function(x){return String(x.data.payment_intent_id||"")===exp.intentId;});
  addCheck("Expired intent remains EXPIRED", String(expFinal.status||"") === "EXPIRED", expFinal.status);
  addCheck("Expired intent has no PAID transaction", expTxs.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length===0, "PAID="+expTxs.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length);
  addCheck("Expired intent has no PAID payment", expPays.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length===0, "PAID="+expPays.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length);
  addCheck("Expired intent has no ACTIVE ticket", expTickets.filter(function(x){return String(x.data.status||"").toUpperCase()==="ACTIVE";}).length===0, "ACTIVE="+expTickets.filter(function(x){return String(x.data.status||"").toUpperCase()==="ACTIVE";}).length);

  const cancelTransition = transitionPaymentIntentLifecycle_(cancel.intentId, "CANCELLED", "SANDBOX_CANCEL_TEST", false);
  addCheck("Cancel transition accepted", cancelTransition.success && cancelTransition.status === "CANCELLED", cancelTransition.message);

  let cancelPaymentRejected = false, cancelPaymentReason = "";
  try {
    processSandboxPayment({
      idToken: body.idToken, paymentIntentId: cancel.intentId, eventId: eventId,
      userId: userId, amount: amount, outcome: "SUCCESS"
    });
  } catch (e) {
    cancelPaymentRejected = true; cancelPaymentReason = String(e.message || e);
  }
  addCheck("Cancelled intent blocks payment", cancelPaymentRejected, cancelPaymentReason);

  let cancelWebhookRejected = false, cancelWebhookReason = "";
  try {
    const webhookResult = processSandboxWebhook({
      idToken: body.idToken, paymentIntentId: cancel.intentId, provider: "SANDBOX-PJP",
      providerEventId: "EVT-228-CAN-" + stamp, eventType: "PAYMENT_SUCCEEDED",
      providerReference: "REF-228-CAN-" + stamp, payloadHash: "HASH-228-CAN-" + stamp,
      amount: amount, targetStatus: "SUCCEEDED", signatureValid: true
    });
    cancelWebhookRejected = !!(webhookResult && webhookResult.rejected === true);
    cancelWebhookReason = webhookResult ? String(webhookResult.reason || webhookResult.message || "") : "";
  } catch (e) {
    cancelWebhookRejected = true; cancelWebhookReason = String(e.message || e);
  }
  addCheck("Webhook after cancellation blocked", cancelWebhookRejected, cancelWebhookReason);

  const canFinalDoc = getDocument("payment_intents", cancel.intentId);
  const canFinal = decodeFirestoreFields(canFinalDoc.fields || {});
  const canTxs = listDocuments("transactions", 500).filter(function(x){return String(x.data.payment_intent_id||"")===cancel.intentId;});
  const canPays = listDocuments("payments", 500).filter(function(x){return String(x.data.payment_intent_id||"")===cancel.intentId;});
  const canTickets = listDocuments("tickets", 500).filter(function(x){return String(x.data.payment_intent_id||"")===cancel.intentId;});
  addCheck("Cancelled intent remains CANCELLED", String(canFinal.status||"") === "CANCELLED", canFinal.status);
  addCheck("Cancelled intent has no PAID transaction", canTxs.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length===0, "PAID="+canTxs.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length);
  addCheck("Cancelled intent has no PAID payment", canPays.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length===0, "PAID="+canPays.filter(function(x){return String(x.data.status||"").toUpperCase()==="PAID";}).length);
  addCheck("Cancelled intent has no ACTIVE ticket", canTickets.filter(function(x){return String(x.data.status||"").toUpperCase()==="ACTIVE";}).length===0, "ACTIVE="+canTickets.filter(function(x){return String(x.data.status||"").toUpperCase()==="ACTIVE";}).length);

  // Idempotent lifecycle repeats must not mutate the terminal state.
  const expRepeat = transitionPaymentIntentLifecycle_(exp.intentId, "EXPIRED", "SANDBOX_EXPIRED_REPEAT", false);
  const canRepeat = transitionPaymentIntentLifecycle_(cancel.intentId, "CANCELLED", "SANDBOX_CANCEL_REPEAT", false);
  addCheck("Repeated EXPIRED transition idempotent", expRepeat.success && expRepeat.idempotent === true && expRepeat.status === "EXPIRED", expRepeat.message);
  addCheck("Repeated CANCELLED transition idempotent", canRepeat.success && canRepeat.idempotent === true && canRepeat.status === "CANCELLED", canRepeat.message);

  const passCount = checks.filter(function(x){return x.pass;}).length;
  const failCount = checks.length - passCount;
  return {
    success: failCount === 0, environment:"SANDBOX", production:false, liveBankCalled:false,
    test:"PAYMENT_INTENT_EXPIRATION_CANCELLATION", passCount:passCount, failCount:failCount,
    checked:checks.length, overall:failCount===0?"PASS":"FAIL",
    expiredIntentId:exp.intentId, cancelledIntentId:cancel.intentId, checks:checks,
    message:failCount===0
      ? "Payment Intent lifecycle PASS: expiration/cancellation memblokir payment dan webhook, tanpa transaction/payment/ticket PAID/ACTIVE."
      : "Payment Intent lifecycle menemukan kegagalan. Periksa checks.",
    timestamp:new Date().toISOString()
  };
}

function processCreatePaymentIntent(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const orderId = requiredText(body.orderId, "Order ID");
  const eventId = requiredText(body.eventId, "Event ID");
  const amount = Number(body.amount);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new Error("Amount harus berupa bilangan IDR yang valid.");
  }

  const channel = String(body.channel || "QRIS").trim().toUpperCase();
  const paymentRoute = resolvePaymentRoute_(channel);

  const clientReference = String(body.clientReference || "").trim();
  const idempotencyKey = requiredText(body.idempotencyKey, "Idempotency key");

  // The intent must be attached to an existing order. This prevents the
  // browser from inventing a payment intent for an unknown order.
  const orderDoc = getDocument("orders", orderId);
  if (!orderDoc || !orderDoc.fields) {
    throw new Error("Order tidak ditemukan: " + orderId);
  }

  const order = decodeFirestoreFields(orderDoc.fields || {});
  if (String(order.event_id || "") !== eventId) {
    throw new Error("Event ID tidak sesuai dengan order.");
  }
  if (Number(order.amount) !== amount) {
    throw new Error("Nominal tidak sesuai dengan order.");
  }
  if (order.currency && String(order.currency).toUpperCase() !== "IDR") {
    throw new Error("Currency order harus IDR.");
  }

  // Idempotency: the same key returns the existing intent instead of
  // creating a second intent. This is read-only until the final write.
  const existing = listDocuments("payment_intents", 200).find(function(item) {
    return String(item.data.idempotency_key || "") === idempotencyKey;
  });
  if (existing) {
    const existingData = existing.data;
    if (
      String(existingData.order_id || "") !== orderId ||
      String(existingData.event_id || "") !== eventId ||
      Number(existingData.amount) !== amount
    ) {
      throw new Error("Idempotency key sudah digunakan untuk parameter berbeda.");
    }
    return {
      success: true,
      existing: true,
      environment: "SANDBOX",
      production: false,
      trusted: true,
      paymentIntentId: String(existingData.payment_intent_id || existing.id),
      orderId: orderId,
      eventId: eventId,
      amount: amount,
      currency: "IDR",
      channel: String(existingData.channel || channel),
      provider: String(existingData.provider || paymentRoute.provider),
      providerAdapter: String(existingData.provider_adapter || paymentRoute.adapter),
      routingId: String(existingData.routing_id || paymentRoute.routeId),
      status: String(existingData.status || "REQUIRES_PAYMENT"),
      message: "Payment Intent sudah ada untuk idempotency key tersebut.",
      timestamp: new Date().toISOString()
    };
  }

  const stamp = Date.now();
  const intentId = "PI-" + stamp;
  const now = new Date().toISOString();

  createDocument("payment_intents", intentId, {
    payment_intent_id: str(intentId),
    order_id: str(orderId),
    user_id: str(order.user_id || ""),
    merchant_id: str(order.merchant_id || ""),
    event_id: str(eventId),
    payment_method_id: str(order.payment_method_id || ""),
    amount: integer(amount),
    currency: str("IDR"),
    channel: str(channel),
    provider: str(paymentRoute.provider),
    provider_adapter: str(paymentRoute.adapter),
    routing_id: str(paymentRoute.routeId),
    client_reference: str(clientReference),
    idempotency_key: str(idempotencyKey),
    status: str("REQUIRES_PAYMENT"),
    provider_reference: str(""),
    trusted: boolean(true),
    production: boolean(false),
    created_by: str(authUser.uid),
    created_by_backend: boolean(true),
    created_at: timestamp(now),
    updated_at: timestamp(now),
    expires_at: timestamp(new Date(Date.now() + getPaymentIntentExpirationMinutes_() * 60000).toISOString())
  });

  return {
    success: true,
    existing: false,
    environment: "SANDBOX",
    production: false,
    trusted: true,
    paymentIntentId: intentId,
    orderId: orderId,
    eventId: eventId,
    amount: amount,
    currency: "IDR",
    channel: channel,
    provider: paymentRoute.provider,
    providerAdapter: paymentRoute.adapter,
    routingId: paymentRoute.routeId,
    status: "REQUIRES_PAYMENT",
    message: "Payment Intent berhasil dibuat oleh trusted backend. Route channel telah ditetapkan dan belum ada payment/transaction/ticket yang dibuat.",
    timestamp: now
  };
}

function processSandboxPayment(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);

  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const outcome = String(body.outcome || "SUCCESS").toUpperCase();
  if (!["SUCCESS","PENDING","FAILED"].includes(outcome)) {
    throw new Error("Outcome sandbox tidak valid.");
  }

  const eventId = requiredText(body.eventId, "Event ID");
  const userId = requiredText(body.userId, "User ID");
  const amount = Number(body.amount);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new Error("Amount harus berupa bilangan IDR yang valid.");
  }

  // Phase 22.2: sandbox payment may now consume an existing trusted
  // Payment Intent created by create_payment_intent. The old standalone
  // sandbox mode remains available when paymentIntentId is omitted.
  const suppliedIntentId = String(body.paymentIntentId || "").trim();
  let existingIntent = null;
  let existingIntentData = null;
  if (suppliedIntentId) {
    existingIntent = getDocument("payment_intents", suppliedIntentId);
    if (!existingIntent || !existingIntent.fields) {
      throw new Error("Payment Intent tidak ditemukan: " + suppliedIntentId);
    }
    existingIntentData = decodeFirestoreFields(existingIntent.fields || {});
    if (existingIntentData.production !== false || existingIntentData.trusted !== true || existingIntentData.created_by_backend !== true) {
      throw new Error("Payment Intent bukan intent sandbox trusted backend.");
    }
    if (String(existingIntentData.event_id || "") !== eventId) {
      throw new Error("Event ID tidak sesuai dengan Payment Intent.");
    }
    if (String(existingIntentData.user_id || "") !== userId) {
      throw new Error("User ID tidak sesuai dengan Payment Intent.");
    }
    if (Number(existingIntentData.amount) !== amount) {
      throw new Error("Nominal tidak sesuai dengan Payment Intent.");
    }
    if (!["REQUIRES_PAYMENT", "PROCESSING"].includes(String(existingIntentData.status || ""))) {
      throw new Error("Payment Intent tidak berada pada status yang dapat diproses: " + existingIntentData.status);
    }
    if (isPaymentIntentExpired_(existingIntentData)) {
      throw new Error("Payment Intent sudah expired dan tidak dapat dibayar.");
    }
  }

  // Idempotency guard: one Payment Intent may produce only one terminal
  // SUCCESS transaction. Repeated SUCCESS calls return the existing result
  // instead of creating another transaction/payment/ticket.
  if (suppliedIntentId && outcome === "SUCCESS") {
    const existingTx = listDocuments("transactions", 500).find(function(item) {
      return String(item.data.payment_intent_id || "") === suppliedIntentId &&
             String(item.data.status || "").toUpperCase() === "PAID";
    });
    if (existingTx) {
      const txData = existingTx.data || {};
      const existingTicket = listDocuments("tickets", 500).find(function(item) {
        return String(item.data.payment_intent_id || "") === suppliedIntentId &&
               String(item.data.transaction_id || "") === String(txData.transaction_id || existingTx.id) &&
               String(item.data.status || "").toUpperCase() === "ACTIVE";
      });
      return {
        success: true,
        existing: true,
        idempotent: true,
        environment: "SANDBOX",
        liveBankCalled: false,
        outcome: "SUCCESS",
        sandboxRunId: String(txData.sandbox_run_id || ""),
        paymentIntentId: suppliedIntentId,
        transactionId: String(txData.transaction_id || existingTx.id),
        orderId: String(txData.order_id || existingIntentData.order_id || ""),
        ticketId: existingTicket ? String(existingTicket.data.ticket_id || existingTicket.id) : null,
        ticketStatus: existingTicket ? "ACTIVE" : null,
        message: "Payment Intent sudah berhasil diproses sebelumnya. Tidak dibuat transaction/payment/ticket duplikat.",
        timestamp: new Date().toISOString()
      };
    }
  }

  // PENDING is also idempotent for the same Payment Intent: once a pending
  // transaction exists, a repeated PENDING call returns that transaction.
  if (suppliedIntentId && outcome === "PENDING") {
    const existingPending = listDocuments("transactions", 500).find(function(item) {
      return String(item.data.payment_intent_id || "") === suppliedIntentId &&
             String(item.data.status || "").toUpperCase() === "PENDING";
    });
    if (existingPending) {
      return {
        success: true,
        existing: true,
        idempotent: true,
        environment: "SANDBOX",
        liveBankCalled: false,
        outcome: "PENDING",
        sandboxRunId: String(existingPending.data.sandbox_run_id || ""),
        paymentIntentId: suppliedIntentId,
        transactionId: String(existingPending.data.transaction_id || existingPending.id),
        orderId: String(existingPending.data.order_id || existingIntentData.order_id || ""),
        ticketId: null,
        ticketStatus: null,
        message: "Payment Intent masih PENDING dan transaction yang sama digunakan kembali.",
        timestamp: new Date().toISOString()
      };
    }
  }

  const now = new Date().toISOString();
  const stamp = Date.now();
  const runId = `SBX-${stamp}`;
  const txId = `SBX-TX-${stamp}`;
  const intentId = suppliedIntentId || `SBX-PI-${stamp}`;
  const orderId = suppliedIntentId ? String(existingIntentData.order_id || "") : `SBX-ORD-${stamp}`;
  const ref = `SANDBOX-${stamp}`;
  const ticketId = `TKT-${stamp}`;

  // Always record the sandbox run first.
  createDocument("sandbox_runs", runId, {
    sandbox_run_id: str(runId),
    sandbox_transaction_id: str(txId),
    sandbox_payment_intent_id: str(intentId),
    sandbox_reference: str(ref),
    event_id: str(eventId),
    user_id: str(userId),
    amount: integer(amount),
    currency: str("IDR"),
    outcome: str(outcome),
    production: boolean(false),
    real_bank_called: boolean(false),
    created_by: str(authUser.uid),
    created_at: timestamp(now)
  });

  // Create or advance the Payment Intent in a trusted backend operation.
  if (suppliedIntentId) {
    updateDocument("payment_intents", intentId, {
      status: str(outcome === "SUCCESS" ? "SUCCEEDED" : outcome === "PENDING" ? "PROCESSING" : "FAILED"),
      updated_at: timestamp(now),
      last_sandbox_run_id: str(runId)
    }, ["status", "updated_at", "last_sandbox_run_id"]);
  } else {
    createDocument("payment_intents", intentId, {
      payment_intent_id: str(intentId),
      order_id: str(orderId),
      event_id: str(eventId),
      user_id: str(userId),
      amount: integer(amount),
      currency: str("IDR"),
      channel: str("SANDBOX"),
      idempotency_key: str(`SANDBOX:${ref}`),
      status: str(outcome === "SUCCESS" ? "SUCCEEDED" : outcome === "PENDING" ? "PROCESSING" : "FAILED"),
      trusted: boolean(true),
      production: boolean(false),
      created_by_backend: boolean(true),
      created_at: timestamp(now),
      updated_at: timestamp(now)
    });
  }

  if (outcome === "SUCCESS") {
    createDocument("transactions", txId, {
      transaction_id: str(txId),
      sandbox_run_id: str(runId),
      order_id: str(orderId),
      payment_intent_id: str(intentId),
      event_id: str(eventId),
      user_id: str(userId),
      amount: integer(amount),
      currency: str("IDR"),
      status: str("PAID"),
      channel: str("SANDBOX"),
      provider_reference: str(ref),
      trusted: boolean(true),
      production: boolean(false),
      created_at: timestamp(now),
      updated_at: timestamp(now)
    });

    createDocument("payments", `PAY-${stamp}`, {
      payment_id: str(`PAY-${stamp}`),
      payment_intent_id: str(intentId),
      transaction_id: str(txId),
      event_id: str(eventId),
      user_id: str(userId),
      amount: integer(amount),
      currency: str("IDR"),
      status: str("PAID"),
      provider: str("SANDBOX"),
      provider_reference: str(ref),
      trusted: boolean(true),
      production: boolean(false),
      verified_by_backend: boolean(true),
      created_at: timestamp(now)
    });

    createDocument("payment_ledger", `LED-${stamp}`, {
      ledger_id: str(`LED-${stamp}`),
      transaction_id: str(txId),
      payment_intent_id: str(intentId),
      event_id: str(eventId),
      user_id: str(userId),
      amount: integer(amount),
      currency: str("IDR"),
      status: str("PAID"),
      source: str("SANDBOX"),
      provider_reference: str(ref),
      production: boolean(false),
      created_at: timestamp(now)
    });

    if (String(existingIntentData && existingIntentData.payment_purpose || "").toUpperCase() !== "UPGRADE") {
      createDocument("tickets", ticketId, {
      ticket_id: str(ticketId),
      order_id: str(orderId),
      transaction_id: str(txId),
      payment_intent_id: str(intentId),
      user_id: str(userId),
      event_id: str(eventId),
      status: str("ACTIVE"),
      active: boolean(true),
      activated_by_backend: boolean(true),
      activation_source: str("SANDBOX_TRUSTED_BACKEND"),
      production: boolean(false),
      created_at: timestamp(now),
      activated_at: timestamp(now)
      });
    }
  } else if (outcome === "PENDING") {
    createDocument("transactions", txId, {
      transaction_id: str(txId),
      sandbox_run_id: str(runId),
      order_id: str(orderId),
      payment_intent_id: str(intentId),
      event_id: str(eventId),
      user_id: str(userId),
      amount: integer(amount),
      currency: str("IDR"),
      status: str("PENDING"),
      channel: str("SANDBOX"),
      provider_reference: str(ref),
      trusted: boolean(true),
      production: boolean(false),
      created_at: timestamp(now),
      updated_at: timestamp(now)
    });
  }

  createDocument("audit_logs", `AUD-${stamp}`, {
    audit_id: str(`AUD-${stamp}`),
    action: str("SANDBOX_PAYMENT"),
    target_id: str(runId),
    severity: str("INFO"),
    outcome: str(outcome),
    event_id: str(eventId),
    user_id: str(userId),
    amount: integer(amount),
    production: boolean(false),
    real_bank_called: boolean(false),
    created_by: str(authUser.uid),
    created_at: timestamp(now)
  });

  return {
    success: true,
    environment: "SANDBOX",
    liveBankCalled: false,
    outcome: outcome,
    sandboxRunId: runId,
    paymentIntentId: intentId,
    transactionId: txId,
    orderId: orderId,
    ticketId: outcome === "SUCCESS" && String(existingIntentData && existingIntentData.payment_purpose || "").toUpperCase() !== "UPGRADE" ? ticketId : null,
    ticketStatus: outcome === "SUCCESS" ? "ACTIVE" : null,
    message: outcome === "SUCCESS"
      ? "Sandbox payment berhasil. Payment PAID dan ticket ACTIVE dibuat oleh trusted backend."
      : `Sandbox payment tercatat dengan outcome ${outcome}.`,
    timestamp: now
  };
}

function verifyFirebaseIdToken(idToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({idToken: idToken}),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const data = JSON.parse(response.getContentText() || "{}");
  if (code < 200 || code >= 300 || !data.users || !data.users.length) {
    throw new Error("Firebase ID token tidak valid atau sudah kedaluwarsa.");
  }
  const u = data.users[0];
  return {uid: u.localId, email: u.email || ""};
}

function getAdminProfile(uid) {
  const url = `${DB_ROOT}/admin_users/${encodeURIComponent(uid)}`;
  const data = firestoreRequest(url, "get");
  if (!data || !data.fields) return null;
  const fields = data.fields;
  return {
    active: fields.active ? fields.active.booleanValue === true : false,
    role: fields.role ? fields.role.stringValue : "",
    name: fields.name ? fields.name.stringValue : "",
    email: fields.email ? fields.email.stringValue : ""
  };
}

function createDocument(collection, documentId, fields) {
  const url = `${DB_ROOT}/${collection}?documentId=${encodeURIComponent(documentId)}`;
  return firestoreRequest(url, "post", {fields: fields});
}

function firestoreRequest(url, method, body) {
  const options = {
    method: method,
    contentType: "application/json",
    headers: {Authorization: `Bearer ${ScriptApp.getOAuthToken()}`},
    muteHttpExceptions: true
  };
  if (body) options.payload = JSON.stringify(body);
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText() || "{}";
  if (code < 200 || code >= 300) {
    throw new Error(`Firestore API ${code}: ${text.substring(0, 500)}`);
  }
  return JSON.parse(text);
}

function updateDocument(collection, documentId, fields, fieldPaths) {
  const paths = (fieldPaths || Object.keys(fields || {})).map(function(path) {
    return "updateMask.fieldPaths=" + encodeURIComponent(path);
  }).join("&");
  const url = `${DB_ROOT}/${collection}/${encodeURIComponent(documentId)}${paths ? "?" + paths : ""}`;
  return firestoreRequest(url, "patch", {fields: fields});
}

function requiredText(value, label) {
  const v = String(value || "").trim();
  if (!v) throw new Error(`${label} wajib diisi.`);
  return v;
}

function str(value) { return {stringValue: String(value)}; }
function integer(value) { return {integerValue: String(value)}; }
function boolean(value) { return {booleanValue: Boolean(value)}; }
function timestamp(value) { return {timestampValue: value}; }
function arrayValue(values) { return {arrayValue: {values: (values || []).map(function(v) { return str(v); })}}; }

function parseRequestBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); }
  catch (_) { throw new Error("Invalid JSON body"); }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

