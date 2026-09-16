/**
 * BeePay Backend - Phase 21
 * Trusted sandbox payment processor using Google Apps Script + Firestore REST.
 *
 * IMPORTANT:
 * - This endpoint is SANDBOX ONLY.
 * - It never calls a real bank/PJP.
 * - The browser sends a Firebase ID token.
 * - GAS verifies the Firebase token and checks admin_users/{uid}.
 * - GAS writes trusted payment/ticket records using its Google OAuth identity.
 */
const BEEPAY_VERSION = "21.1.0";
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

  const expectedAmount = 75000;
  const runs = listDocuments("sandbox_runs", 200)
    .filter(function(r) {
      return Number(r.data.amount) === expectedAmount && r.data.production === false;
    })
    .sort(function(a,b) {
      return new Date(b.data.created_at || 0).getTime() - new Date(a.data.created_at || 0).getTime();
    });

  const outcomes = ["SUCCESS", "PENDING", "FAILED"];
  const selected = {};
  outcomes.forEach(function(outcome) {
    selected[outcome] = runs.find(function(r) {
      return String(r.data.outcome || "").toUpperCase() === outcome;
    }) || null;
  });

  const checks = [];
  function check(name, pass, detail) {
    checks.push({name:name, pass:Boolean(pass), detail:String(detail || "")});
  }
  function related(collection, field, value) {
    return listDocuments(collection, 200).filter(function(r) {
      return String(r.data[field] || "") === String(value);
    });
  }

  outcomes.forEach(function(outcome) {
    const run = selected[outcome];
    check(outcome + ": run 75000 IDR", !!run,
      run ? run.id + " · amount=" + run.data.amount + " · production=" + run.data.production : "Run tidak ditemukan");
    if (!run) return;

    const d = run.data;
    const intentId = String(d.sandbox_payment_intent_id || "");
    const txId = String(d.sandbox_transaction_id || "");
    const ref = String(d.sandbox_reference || "");

    check(outcome + ": production=false", d.production === false, "production=" + d.production);
    check(outcome + ": trusted sandbox", d.real_bank_called === false,
      "real_bank_called=" + d.real_bank_called);
    check(outcome + ": Run → Payment Intent", !!intentId, intentId || "missing");
    check(outcome + ": Run → Transaction", !!txId, txId || "missing");

    const intent = intentId ? getDocument("payment_intents", intentId) : null;
    const tx = txId ? getDocument("transactions", txId) : null;
    const intentData = intent ? decodeFirestoreFields(intent.fields || {}) : null;
    const txData = tx ? decodeFirestoreFields(tx.fields || {}) : null;

    check(outcome + ": Payment Intent exists", !!intentData, intentData ? "OK" : "missing");
    check(outcome + ": Transaction exists", !!txData, txData ? "OK" : "missing");

    if (outcome === "SUCCESS") {
      check("SUCCESS: payment PAID", !!txData && txData.status === "PAID" && Number(txData.amount) === expectedAmount && txData.trusted === true && txData.production === false,
        txData ? "status="+txData.status+", amount="+txData.amount+", trusted="+txData.trusted+", production="+txData.production : "missing");
      const payments = related("payments", "transaction_id", txId).concat(related("payments", "payment_intent_id", intentId));
      const payment = payments[0] ? payments[0].data : null;
      check("SUCCESS: payment record PAID", !!payment && payment.status === "PAID" && Number(payment.amount) === expectedAmount && payment.trusted === true && payment.production === false,
        payment ? "status="+payment.status+", amount="+payment.amount : "missing");
      const tickets = related("tickets", "transaction_id", txId).concat(related("tickets", "payment_intent_id", intentId));
      const active = tickets.find(function(t){return t.data.status === "ACTIVE" && t.data.active === true;});
      check("SUCCESS: ticket ACTIVE", !!active && active.data.activated_by_backend === true && active.data.activation_source === "SANDBOX_TRUSTED_BACKEND" && active.data.production === false,
        active ? "ticket="+(active.data.ticket_id || active.id)+", status="+active.data.status : "ACTIVE ticket missing");
    } else if (outcome === "PENDING") {
      check("PENDING: payment PENDING", !!txData && txData.status === "PENDING" && Number(txData.amount) === expectedAmount && txData.trusted === true && txData.production === false,
        txData ? "status="+txData.status+", amount="+txData.amount : "missing");
      const tickets = related("tickets", "transaction_id", txId).concat(related("tickets", "payment_intent_id", intentId));
      check("PENDING: no ACTIVE ticket", !tickets.some(function(t){return t.data.status === "ACTIVE" && t.data.active === true;}),
        tickets.length ? tickets.length + " related ticket(s)" : "No related ticket");
    } else {
      check("FAILED: payment FAILED", !!intentData && intentData.status === "FAILED" && intentData.trusted === true && intentData.production === false,
        intentData ? "intent status="+intentData.status : "missing");
      const tickets = related("tickets", "transaction_id", txId).concat(related("tickets", "payment_intent_id", intentId));
      check("FAILED: no ACTIVE ticket", !tickets.some(function(t){return t.data.status === "ACTIVE" && t.data.active === true;}),
        tickets.length ? tickets.length + " related ticket(s)" : "No related ticket");
    }

    check(outcome + ": reference link", !!ref, ref || "sandbox_reference missing");
  });

  const passed = checks.filter(function(c){return c.pass;}).length;
  const failed = checks.length - passed;
  const success = failed === 0 && outcomes.every(function(o){return !!selected[o];});

  return {
    success: success,
    environment: "SANDBOX",
    readOnly: true,
    amount: expectedAmount,
    overall: success ? "PASS" : "FAIL",
    summary: success ? "Sandbox audit berhasil" : "Sandbox audit menemukan pemeriksaan yang belum sesuai",
    passCount: passed,
    failCount: failed,
    checked: outcomes.length,
    results: outcomes.map(function(o){
      const r=selected[o];
      return {outcome:o,sandboxRunId:r?r.id:null,transactionId:r?r.data.sandbox_transaction_id:null,paymentIntentId:r?r.data.sandbox_payment_intent_id:null,status:r?r.data.outcome:"MISSING"};
    }),
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

  const now = new Date().toISOString();
  const stamp = Date.now();
  const runId = `SBX-${stamp}`;
  const txId = `SBX-TX-${stamp}`;
  const intentId = `SBX-PI-${stamp}`;
  const orderId = `SBX-ORD-${stamp}`;
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

  // Create the payment intent in a trusted state.
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

