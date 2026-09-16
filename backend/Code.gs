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
const BEEPAY_VERSION = "22.0.0";
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
      return jsonResponse(auditSandboxRuns(body));
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
      sandbox_run_id: str(runId),
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


function auditSandboxRuns(body) {
  if (!body.idToken) throw new Error("Firebase ID token wajib.");
  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);
  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const requestedRunId = String(body.sandboxRunId || "").trim();
  const runs = requestedRunId
    ? [{document: firestoreGetDocument("sandbox_runs", requestedRunId), id: requestedRunId}]
    : listSandboxRuns(100);

  const results = [];
  runs.forEach(item => {
    const run = item.document;
    if (!run || !run.fields) {
      results.push({sandboxRunId: item.id, status: "ERROR", reason: "Sandbox run tidak ditemukan."});
      return;
    }
    const f = item.document.fields;
    const runId = stringField(f.sandbox_run_id, item.id);
    const outcome = stringField(f.outcome, "");
    const stamp = runId.replace(/^SBX-/, "");
    const txId = stringField(f.sandbox_transaction_id, `SBX-TX-${stamp}`);
    const expectedTicketId = `TKT-${stamp}`;
    const ticketById = firestoreGetDocument("tickets", expectedTicketId);
    const ticketDocs = listDocumentsByField("tickets", "transaction_id", txId);
    const ticketCount = ticketDocs.length;
    const tx = firestoreGetDocument("transactions", txId);
    const txStatus = tx && tx.fields ? stringField(tx.fields.status, "") : null;

    let status = "PASS";
    let reason = "";
    if (outcome === "SUCCESS") {
      if (!tx || !tx.fields || stringField(tx.fields.status, "") !== "PAID") {
        status = "FAIL";
        reason = "SUCCESS wajib memiliki transaction berstatus PAID.";
      } else if (ticketCount !== 1) {
        status = "FAIL";
        reason = `SUCCESS wajib tepat 1 ticket; ditemukan ${ticketCount}.`;
      } else if (!ticketById || !ticketById.fields ||
                 stringField(ticketById.fields.status, "") !== "ACTIVE" ||
                 stringField(ticketById.fields.ticket_id, "") !== expectedTicketId) {
        status = "FAIL";
        reason = "Ticket SUCCESS harus ACTIVE dan ID-nya sesuai run.";
      }
    } else if (outcome === "PENDING") {
      if (txStatus !== "PENDING") {
        status = "FAIL";
        reason = "PENDING wajib memiliki transaction berstatus PENDING.";
      } else if (ticketCount !== 0) {
        status = "FAIL";
        reason = "PENDING tidak boleh membuat ticket; ditemukan 1 atau lebih ticket.";
      }
    } else if (outcome === "FAILED") {
      if (tx) {
        status = "FAIL";
        reason = "FAILED tidak boleh membuat transaction.";
      } else if (ticketCount !== 0) {
        status = "FAIL";
        reason = "FAILED tidak boleh membuat ticket; ditemukan 1 atau lebih ticket.";
      }
    } else {
      status = "FAIL";
      reason = `Outcome tidak dikenal: ${outcome}`;
    }

    results.push({
      sandboxRunId: runId,
      outcome: outcome,
      transactionId: txId,
      transactionStatus: txStatus,
      expectedTicketId: expectedTicketId,
      ticketCount: ticketCount,
      status: status,
      reason: reason
    });
  });

  const passed = results.filter(x => x.status === "PASS").length;
  const failed = results.filter(x => x.status === "FAIL").length;
  const errors = results.filter(x => x.status === "ERROR").length;
  const auditId = `SBA-${Date.now()}`;
  createDocument("audit_logs", auditId, {
    audit_id: str(auditId),
    action: str("SANDBOX_E2E_AUDIT"),
    target_id: str(requestedRunId || "LATEST_100"),
    severity: str(failed || errors ? "ERROR" : "INFO"),
    outcome: str(failed || errors ? "FAIL" : "PASS"),
    passed: integer(passed),
    failed: integer(failed),
    errors: integer(errors),
    production: boolean(false),
    real_bank_called: boolean(false),
    created_by: str(authUser.uid),
    created_at: timestamp(new Date().toISOString())
  });

  return {
    success: true,
    environment: "SANDBOX",
    auditId: auditId,
    checked: results.length,
    passed: passed,
    failed: failed,
    errors: errors,
    overall: failed || errors ? "FAIL" : "PASS",
    results: results
  };
}

function listSandboxRuns(limit) {
  const url = `${DB_ROOT}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{collectionId: "sandbox_runs"}],
      orderBy: [{field: {fieldPath: "created_at"}, direction: "DESCENDING"}],
      limit: limit
    },
    parent: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`
  };
  const rows = firestoreRequest(url, "post", body);
  return (rows || []).filter(x => x.document).map(x => ({
    id: x.document.name.split("/").pop(),
    document: x.document
  }));
}

function listDocumentsByField(collection, fieldPath, value) {
  const url = `${DB_ROOT}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{collectionId: collection}],
      where: {fieldFilter: {
        field: {fieldPath: fieldPath},
        op: "EQUAL",
        value: {stringValue: String(value)}
      }}
    },
    parent: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`
  };
  const rows = firestoreRequest(url, "post", body);
  return (rows || []).filter(x => x.document).map(x => x.document);
}

function firestoreGetDocument(collection, documentId) {
  const url = `${DB_ROOT}/${collection}/${encodeURIComponent(documentId)}`;
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {Authorization: `Bearer ${ScriptApp.getOAuthToken()}`},
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    const text = response.getContentText() || "";
    throw new Error(`Firestore API ${code}: ${text.substring(0, 500)}`);
  }
  return JSON.parse(response.getContentText() || "{}");
}

function stringField(fields, key, fallback) {
  return fields && fields[key] && fields[key].stringValue != null
    ? fields[key].stringValue
    : fallback;
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
