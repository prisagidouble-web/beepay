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

    // Sandbox E2E audit is read-only.
    // It never creates or mutates payment/ticket data.
    // Accept the audit action names used by the frontend.
    if (
      [
        "sandbox_audit",
        "audit_sandbox",
        "audit_sandbox_e2e"
      ].includes(String(body.action || "").toLowerCase())
    ) {
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


/* =========================================================
   SANDBOX PAYMENT
   ========================================================= */

function processSandboxPayment(body) {

  if (!body.idToken) {
    throw new Error("Firebase ID token wajib.");
  }

  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);

  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const outcome = String(body.outcome || "SUCCESS").toUpperCase();

  if (!["SUCCESS", "PENDING", "FAILED"].includes(outcome)) {
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


  // Create payment intent in trusted state.
  createDocument("payment_intents", intentId, {

    payment_intent_id: str(intentId),

    order_id: str(orderId),

    event_id: str(eventId),

    user_id: str(userId),

    amount: integer(amount),

    currency: str("IDR"),

    channel: str("SANDBOX"),

    idempotency_key: str(`SANDBOX:${ref}`),

    status: str(
      outcome === "SUCCESS"
        ? "SUCCEEDED"
        : outcome === "PENDING"
          ? "PROCESSING"
          : "FAILED"
    ),

    trusted: boolean(true),

    production: boolean(false),

    created_by_backend: boolean(true),

    created_at: timestamp(now),

    updated_at: timestamp(now)

  });


  /* =========================================================
     SUCCESS
     ========================================================= */

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

  }


  /* =========================================================
     PENDING
     ========================================================= */

  else if (outcome === "PENDING") {

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


  /* =========================================================
     FAILED
     ========================================================= */

  else if (outcome === "FAILED") {

    // Tidak membuat transaction PAID/PENDING.
    // Payment intent sudah tercatat FAILED.
    // Ticket ACTIVE tidak dibuat.

  }


  /* =========================================================
     AUDIT LOG
     ========================================================= */

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

    message:
      outcome === "SUCCESS"
        ? "Sandbox payment berhasil. Payment PAID dan ticket ACTIVE dibuat oleh trusted backend."
        : `Sandbox payment tercatat dengan outcome ${outcome}.`,

    timestamp: now

  };
}


/* =========================================================
   SANDBOX AUDIT E2E
   READ ONLY
   ========================================================= */

function processSandboxAudit(body) {

  if (!body.idToken) {
    throw new Error("Firebase ID token wajib.");
  }

  const authUser = verifyFirebaseIdToken(body.idToken);

  const admin = getAdminProfile(authUser.uid);

  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }


  /*
   * Audit WAJIB menggunakan nominal pengujian 75.000 IDR.
   */

  const expectedAmount = Number(body.amount || 75000);

  if (
    !Number.isSafeInteger(expectedAmount) ||
    expectedAmount !== 75000
  ) {
    throw new Error(
      "Audit Sandbox E2E menggunakan nominal pengujian 75000 IDR."
    );
  }


  /*
   * READ ONLY.
   *
   * Tidak ada:
   * createDocument()
   * update
   * delete
   *
   * di dalam audit.
   */


  const runs = listDocuments("sandbox_runs", 100)

    .map(function(doc) {

      return {

        id: doc.name.split("/").pop(),

        data: decodeFirestoreFields(
          doc.fields || {}
        )

      };

    })

    .filter(function(x) {

      return (
        Number(x.data.amount) === expectedAmount &&
        x.data.production === false
      );

    })

    .sort(function(a, b) {

      return (
        new Date(
          b.data.created_at || 0
        ).getTime()

        -

        new Date(
          a.data.created_at || 0
        ).getTime()
      );

    });


  const outcomes = [
    "SUCCESS",
    "PENDING",
    "FAILED"
  ];


  const checks = [];

  const selected = {};


  outcomes.forEach(function(outcome) {

    selected[outcome] =
      runs.find(function(x) {

        return (
          String(
            x.data.outcome || ""
          ).toUpperCase() === outcome
        );

      }) || null;

  });


  function addCheck(name, pass, detail) {

    checks.push({

      name: name,

      pass: !!pass,

      detail: String(detail || "")

    });

  }


  /* =========================================================
     CHECK MASING-MASING OUTCOME
     ========================================================= */

  outcomes.forEach(function(outcome) {

    const run = selected[outcome];


    addCheck(

      `${outcome}: sandbox run`,

      !!run,

      run
        ? `${run.id} · ${run.data.amount} IDR · production=${run.data.production}`
        : `Run ${outcome} dengan nominal ${expectedAmount} IDR tidak ditemukan.`

    );


    if (!run) {
      return;
    }


    const d = run.data;


    /*
     * production harus false
     * real_bank_called harus false
     */

    addCheck(

      `${outcome}: trusted sandbox`,

      d.production === false &&
      d.real_bank_called === false,

      `production=${d.production}, real_bank_called=${d.real_bank_called}`

    );


    const intentId =
      String(
        d.sandbox_payment_intent_id || ""
      );


    const txId =
      String(
        d.sandbox_transaction_id || ""
      );


    /*
     * Run → Payment Intent
     */

    addCheck(

      `${outcome}: Run → Payment Intent`,

      !!intentId,

      intentId ||
      "sandbox_payment_intent_id tidak ditemukan."

    );


    /*
     * Run → Transaction
     */

    addCheck(

      `${outcome}: Run → Transaction`,

      !!txId,

      txId ||
      "sandbox_transaction_id tidak ditemukan."

    );


    const intent =
      intentId
        ? getDocument(
            "payment_intents",
            intentId
          )
        : null;


    const tx =
      txId
        ? getDocument(
            "transactions",
            txId
          )
        : null;


    const intentData =
      intent
        ? decodeFirestoreFields(
            intent.fields || {}
          )
        : null;


    const txData =
      tx
        ? decodeFirestoreFields(
            tx.fields || {}
          )
        : null;


    /* =======================================================
       SUCCESS
       ======================================================= */

    if (outcome === "SUCCESS") {


      /*
       * Payment Intent
       */

      addCheck(

        "SUCCESS: payment intent",

        !!intentData &&
        intentData.status === "SUCCEEDED" &&
        intentData.trusted === true &&
        intentData.production === false,

        intentData

          ? `status=${intentData.status}, trusted=${intentData.trusted}, production=${intentData.production}`

          : "Payment intent tidak ditemukan."

      );


      /*
       * Transaction harus PAID
       */

      addCheck(

        "SUCCESS: transaction PAID",

        !!txData &&
        txData.status === "PAID" &&
        Number(txData.amount) === expectedAmount &&
        txData.trusted === true &&
        txData.production === false,

        txData

          ? `status=${txData.status}, amount=${txData.amount}, trusted=${txData.trusted}, production=${txData.production}`

          : "Transaction tidak ditemukan."

      );


      /*
       * Payment harus PAID
       */

      const payments =
        listDocuments(
          "payments",
          100
        )

        .map(function(doc) {

          return decodeFirestoreFields(
            doc.fields || {}
          );

        })

        .filter(function(p) {

          return (
            p.payment_intent_id === intentId ||
            p.transaction_id === txId
          );

        });


      const payment =
        payments[0] || null;


      addCheck(

        "SUCCESS: payment PAID",

        !!payment &&
        payment.status === "PAID" &&
        Number(payment.amount) === expectedAmount &&
        payment.trusted === true &&
        payment.production === false,

        payment

          ? `status=${payment.status}, amount=${payment.amount}, trusted=${payment.trusted}, production=${payment.production}`

          : "Payment record tidak ditemukan."

      );


      /*
       * Ticket ACTIVE harus ada
       */

      const tickets =
        listDocuments(
          "tickets",
          100
        )

        .map(function(doc) {

          return decodeFirestoreFields(
            doc.fields || {}
          );

        })

        .filter(function(t) {

          return (
            t.transaction_id === txId ||
            t.payment_intent_id === intentId
          );

        });


      const ticket =
        tickets.find(function(t) {

          return (
            t.status === "ACTIVE" &&
            t.active === true
          );

        }) || null;


      addCheck(

        "SUCCESS: ticket ACTIVE",

        !!ticket &&
        ticket.activated_by_backend === true &&
        ticket.activation_source === "SANDBOX_TRUSTED_BACKEND" &&
        ticket.production === false,

        ticket

          ? `ticket=${ticket.ticket_id}, status=${ticket.status}, active=${ticket.active}`

          : "Ticket ACTIVE tidak ditemukan."

      );

    }


    /* =======================================================
       PENDING
       ======================================================= */

    else if (outcome === "PENDING") {


      /*
       * Payment intent harus PROCESSING
       */

      addCheck(

        "PENDING: payment intent",

        !!intentData &&
        intentData.status === "PROCESSING" &&
        intentData.trusted === true &&
        intentData.production === false,

        intentData

          ? `status=${intentData.status}, trusted=${intentData.trusted}, production=${intentData.production}`

          : "Payment intent tidak ditemukan."

      );


      /*
       * Transaction harus PENDING
       */

      addCheck(

        "PENDING: transaction PENDING",

        !!txData &&
        txData.status === "PENDING" &&
        Number(txData.amount) === expectedAmount &&
        txData.trusted === true &&
        txData.production === false,

        txData

          ? `status=${txData.status}, amount=${txData.amount}, trusted=${txData.trusted}, production=${txData.production}`

          : "Transaction PENDING tidak ditemukan."

      );


      /*
       * Tidak boleh ada ticket ACTIVE
       */

      const tickets =
        listDocuments(
          "tickets",
          100
        )

        .map(function(doc) {

          return decodeFirestoreFields(
            doc.fields || {}
          );

        })

        .filter(function(t) {

          return (
            t.transaction_id === txId ||
            t.payment_intent_id === intentId
          );

        });


      addCheck(

        "PENDING: no ACTIVE ticket",

        !tickets.some(function(t) {

          return (
            t.status === "ACTIVE" &&
            t.active === true
          );

        }),

        tickets.length

          ? `${tickets.length} ticket terkait ditemukan; tidak boleh ada ACTIVE.`

          : "Tidak ada ticket terkait."

      );

    }


    /* =======================================================
       FAILED
       ======================================================= */

    else {


      /*
       * Payment intent harus FAILED
       */

      addCheck(

        "FAILED: payment intent",

        !!intentData &&
        intentData.status === "FAILED" &&
        intentData.trusted === true &&
        intentData.production === false,

        intentData

          ? `status=${intentData.status}, trusted=${intentData.trusted}, production=${intentData.production}`

          : "Payment intent FAILED tidak ditemukan."

      );


      /*
       * Tidak boleh ada ticket ACTIVE
       */

      const tickets =
        listDocuments(
          "tickets",
          100
        )

        .map(function(doc) {

          return decodeFirestoreFields(
            doc.fields || {}
          );

        })

        .filter(function(t) {

          return (
            t.transaction_id === txId ||
            t.payment_intent_id === intentId
          );

        });


      addCheck(

        "FAILED: no ACTIVE ticket",

        !tickets.some(function(t) {

          return (
            t.status === "ACTIVE" &&
            t.active === true
          );

        }),

        tickets.length

          ? `${tickets.length} ticket terkait ditemukan; tidak boleh ada ACTIVE.`

          : "Tidak ada ticket terkait."

      );

    }

  });


  /* =========================================================
     SUMMARY
     ========================================================= */

  const passCount =
    checks.filter(function(x) {

      return x.pass;

    }).length;


  const failCount =
    checks.length - passCount;


  const success =
    failCount === 0 &&
    outcomes.every(function(x) {

      return !!selected[x];

    });


  return {

    success: success,

    environment: "SANDBOX",

    readOnly: true,

    production: false,

    realBankCalled: false,

    amount: expectedAmount,

    summary:

      success

        ? "Sandbox audit berhasil. SUCCESS, PENDING, dan FAILED konsisten dengan trusted backend."

        : "Sandbox audit menemukan pemeriksaan yang belum sesuai.",

    passCount: passCount,

    failCount: failCount,

    checks: checks,

    runs:

      outcomes.map(function(outcome) {

        return selected[outcome]

          ? {

              outcome: outcome,

              runId: selected[outcome].id,

              transactionId:
                selected[outcome].data
                  .sandbox_transaction_id ||
                null,

              paymentIntentId:
                selected[outcome].data
                  .sandbox_payment_intent_id ||
                null

            }

          : {

              outcome: outcome,

              runId: null,

              transactionId: null,

              paymentIntentId: null

            };

      }),

    timestamp:
      new Date().toISOString()

  };

}


/* =========================================================
   FIRESTORE READ
   ========================================================= */

function listDocuments(collectionName, pageSize) {

  const size =
    Math.max(
      1,
      Math.min(
        Number(pageSize || 100),
        100
      )
    );


  const url =
    `${DB_ROOT}/${collectionName}?pageSize=${size}`;


  const data =
    firestoreRequest(
      url,
      "get"
    );


  return Array.isArray(data.documents)
    ? data.documents
    : [];

}


/* =========================================================
   FIRESTORE GET DOCUMENT
   ========================================================= */

function getDocument(collectionName, documentId) {

  try {

    return firestoreRequest(

      `${DB_ROOT}/${collectionName}/${encodeURIComponent(documentId)}`,

      "get"

    );

  } catch (err) {

    const message =
      String(err.message || err);


    if (
      message.indexOf(
        "Firestore API 404"
      ) >= 0
    ) {

      return null;

    }

    throw err;

  }

}


/* =========================================================
   FIRESTORE DECODER
   ========================================================= */

function decodeFirestoreFields(fields) {

  const out = {};


  Object.keys(fields || {})
    .forEach(function(key) {

      out[key] =
        decodeFirestoreValue(
          fields[key]
        );

    });


  return out;

}


function decodeFirestoreValue(v) {

  if (!v) {
    return null;
  }


  if (
    Object.prototype.hasOwnProperty.call(
      v,
      "stringValue"
    )
  ) {

    return v.stringValue;

  }


  if (
    Object.prototype.hasOwnProperty.call(
      v,
      "integerValue"
    )
  ) {

    return Number(
      v.integerValue
    );

  }


  if (
    Object.prototype.hasOwnProperty.call(
      v,
      "doubleValue"
    )
  ) {

    return Number(
      v.doubleValue
    );

  }


  if (
    Object.prototype.hasOwnProperty.call(
      v,
      "booleanValue"
    )
  ) {

    return v.booleanValue === true;

  }


  if (
    Object.prototype.hasOwnProperty.call(
      v,
      "timestampValue"
    )
  ) {

    return v.timestampValue;

  }


  if (
    Object.prototype.hasOwnProperty.call(
      v,
      "nullValue"
    )
  ) {

    return null;

  }


  if (
    Object.prototype.hasOwnProperty.call(
      v,
      "mapValue"
    )
  ) {

    return decodeFirestoreFields(
      v.mapValue.fields || {}
    );

  }


  if (
    Object.prototype.hasOwnProperty.call(
      v,
      "arrayValue"
    )
  ) {

    return (
      v.arrayValue.values || []
    ).map(
      decodeFirestoreValue
    );

  }


  return null;

}


/* =========================================================
   FIREBASE ID TOKEN
   ========================================================= */

function verifyFirebaseIdToken(idToken) {

  const url =
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`;


  const response =
    UrlFetchApp.fetch(
      url,
      {

        method: "post",

        contentType:
          "application/json",

        payload:
          JSON.stringify({
            idToken: idToken
          }),

        muteHttpExceptions: true

      }
    );


  const code =
    response.getResponseCode();


  const data =
    JSON.parse(
      response.getContentText() ||
      "{}"
    );


  if (
    code < 200 ||
    code >= 300 ||
    !data.users ||
    !data.users.length
  ) {

    throw new Error(
      "Firebase ID token tidak valid atau sudah kedaluwarsa."
    );

  }


  const u =
    data.users[0];


  return {

    uid: u.localId,

    email: u.email || ""

  };

}


/* =========================================================
   ADMIN PROFILE
   ========================================================= */

function getAdminProfile(uid) {

  const url =
    `${DB_ROOT}/admin_users/${encodeURIComponent(uid)}`;


  const data =
    firestoreRequest(
      url,
      "get"
    );


  if (
    !data ||
    !data.fields
  ) {

    return null;

  }


  const fields =
    data.fields;


  return {

    active:
      fields.active
        ? fields.active.booleanValue === true
        : false,

    role:
      fields.role
        ? fields.role.stringValue
        : "",

    name:
      fields.name
        ? fields.name.stringValue
        : "",

    email:
      fields.email
        ? fields.email.stringValue
        : ""

  };

}


/* =========================================================
   FIRESTORE CREATE
   ========================================================= */

function createDocument(
  collection,
  documentId,
  fields
) {

  const url =
    `${DB_ROOT}/${collection}?documentId=${encodeURIComponent(documentId)}`;


  return firestoreRequest(

    url,

    "post",

    {
      fields: fields
    }

  );

}


/* =========================================================
   FIRESTORE REQUEST
   ========================================================= */

function firestoreRequest(
  url,
  method,
  body
) {

  const options = {

    method: method,

    contentType:
      "application/json",

    headers: {

      Authorization:
        `Bearer ${ScriptApp.getOAuthToken()}`

    },

    muteHttpExceptions: true

  };


  if (body) {

    options.payload =
      JSON.stringify(body);

  }


  const response =
    UrlFetchApp.fetch(
      url,
      options
    );


  const code =
    response.getResponseCode();


  const text =
    response.getContentText() ||
    "{}";


  if (
    code < 200 ||
    code >= 300
  ) {

    throw new Error(
      `Firestore API ${code}: ${text.substring(0, 500)}`
    );

  }


  return JSON.parse(text);

}


/* =========================================================
   HELPERS
   ========================================================= */

function requiredText(
  value,
  label
) {

  const v =
    String(value || "").trim();


  if (!v) {

    throw new Error(
      `${label} wajib diisi.`
    );

  }


  return v;

}


function str(value) {

  return {
    stringValue:
      String(value)
  };

}


function integer(value) {

  return {
    integerValue:
      String(value)
  };

}


function boolean(value) {

  return {
    booleanValue:
      Boolean(value)
  };

}


function timestamp(value) {

  return {
    timestampValue:
      value
  };

}


/* =========================================================
   REQUEST BODY
   ========================================================= */

function parseRequestBody(e) {

  if (
    !e ||
    !e.postData ||
    !e.postData.contents
  ) {

    return {};

  }


  try {

    return JSON.parse(
      e.postData.contents
    );

  } catch (_) {

    throw new Error(
      "Invalid JSON body"
    );

  }

}


/* =========================================================
   JSON RESPONSE
   ========================================================= */

function jsonResponse(data) {

  return ContentService

    .createTextOutput(
      JSON.stringify(data)
    )

    .setMimeType(
      ContentService.MimeType.JSON
    );

}
