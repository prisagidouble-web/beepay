/**
 * BeePay Backend - Phase 22.2.1
 * Trusted sandbox payment processor using Google Apps Script + Firestore REST.
 *
 * IMPORTANT:
 * - This endpoint is SANDBOX ONLY.
 * - It never calls a real bank/PJP.
 * - The browser sends a Firebase ID token.
 * - GAS verifies the Firebase token and checks admin_users/{uid}.
 * - GAS writes trusted payment/ticket records using its Google OAuth identity.
 */
const BEEPAY_VERSION = "22.2.0";
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
      return jsonResponse(processSandboxPayment(body));
    }
    if (body.action === "sandbox_audit") {
      return jsonResponse(processSandboxAudit(body));
    }
    if (body.action === "create_payment_intent") {
      return jsonResponse(processCreatePaymentIntent(body));
    }
    if (body.action === "sandbox_create_order") {
      return jsonResponse(processSandboxCreateOrder(body));
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
  if (!["QRIS", "BANK_TRANSFER", "VIRTUAL_ACCOUNT"].includes(channel)) {
    throw new Error("Channel pembayaran tidak valid.");
  }

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
    status: "REQUIRES_PAYMENT",
    message: "Payment Intent berhasil dibuat oleh trusted backend. Belum ada payment/transaction/ticket yang dibuat.",
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

