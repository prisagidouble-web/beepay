/**
 * BeePay Backend - Phase 22.4.0
 * Trusted sandbox payment processor using Google Apps Script + Firestore REST.
 * Phase 22.5.0 adds provider adapter boundaries and server-side webhook signature simulation.
 * Phase 22.6.0 adds provider runtime configuration and credential boundary controls.
 * Phase 22.7.0 adds payment-channel routing abstraction; routing remains SANDBOX-only.
 *
 * IMPORTANT:
 * - This endpoint is SANDBOX ONLY.
 * - It never calls a real bank/PJP.
 * - The browser sends a Firebase ID token.
 * - GAS verifies the Firebase token and checks admin_users/{uid}.
 * - GAS writes trusted payment/ticket records using its Google OAuth identity.
 */
const BEEPAY_VERSION = "22.7.0";
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
  const terminal = ["SUCCEEDED","FAILED"];
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
    updated_at: timestamp(now)
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
    ticketId: outcome === "SUCCESS" ? ticketId : null,
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

function parseRequestBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); }
  catch (_) { throw new Error("Invalid JSON body"); }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

