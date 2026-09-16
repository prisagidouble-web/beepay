function processSandboxAudit(body) {
  if (!body.idToken) {
    throw new Error("Firebase ID token wajib.");
  }

  const authUser = verifyFirebaseIdToken(body.idToken);
  const admin = getAdminProfile(authUser.uid);

  if (!admin || admin.active !== true) {
    throw new Error("Akun tidak memiliki akses admin BeePay.");
  }

  const expectedAmount = Number(body.amount || 75000);

  if (!Number.isSafeInteger(expectedAmount) || expectedAmount !== 75000) {
    throw new Error(
      "Audit Sandbox E2E menggunakan nominal pengujian 75000 IDR."
    );
  }

  /*
   * READ ONLY
   *
   * Audit tidak membuat:
   * - sandbox_runs
   * - payment_intents
   * - transactions
   * - payments
   * - tickets
   *
   * Audit hanya membaca Firestore.
   */

  const runs = listDocuments("sandbox_runs", 100)
    .map(function(doc) {
      return {
        id: doc.name.split("/").pop(),
        data: decodeFirestoreFields(doc.fields || {})
      };
    })
    .filter(function(item) {
      return (
        Number(item.data.amount) === expectedAmount &&
        item.data.production === false
      );
    })
    .sort(function(a, b) {
      return (
        new Date(b.data.created_at || 0).getTime() -
        new Date(a.data.created_at || 0).getTime()
      );
    });

  const outcomes = ["SUCCESS", "PENDING", "FAILED"];
  const selected = {};

  outcomes.forEach(function(outcome) {
    selected[outcome] =
      runs.find(function(item) {
        return (
          String(item.data.outcome || "").toUpperCase() === outcome
        );
      }) || null;
  });

  const checks = [];

  function addCheck(name, pass, detail) {
    checks.push({
      name: name,
      pass: Boolean(pass),
      detail: String(detail || "")
    });
  }

  outcomes.forEach(function(outcome) {

    const run = selected[outcome];

    addCheck(
      outcome + ": sandbox run",
      Boolean(run),
      run
        ? run.id +
          " · " +
          run.data.amount +
          " IDR · production=" +
          run.data.production
        : "Run " +
          outcome +
          " dengan nominal " +
          expectedAmount +
          " IDR tidak ditemukan."
    );

    if (!run) return;

    const d = run.data;

    /*
     * Sandbox harus:
     * production = false
     * real_bank_called = false
     */
    addCheck(
      outcome + ": trusted sandbox",
      d.production === false &&
        d.real_bank_called === false,
      "production=" +
        d.production +
        ", real_bank_called=" +
        d.real_bank_called
    );

    const intentId = String(
      d.sandbox_payment_intent_id || ""
    );

    const txId = String(
      d.sandbox_transaction_id || ""
    );

    addCheck(
      outcome + ": Run → Payment Intent",
      Boolean(intentId),
      intentId || "sandbox_payment_intent_id tidak ditemukan."
    );

    addCheck(
      outcome + ": Run → Transaction",
      Boolean(txId),
      txId || "sandbox_transaction_id tidak ditemukan."
    );

    const intent = intentId
      ? getDocument("payment_intents", intentId)
      : null;

    const tx = txId
      ? getDocument("transactions", txId)
      : null;

    const intentData = intent
      ? decodeFirestoreFields(intent.fields || {})
      : null;

    const txData = tx
      ? decodeFirestoreFields(tx.fields || {})
      : null;

    /*
     * ==========================
     * SUCCESS
     * ==========================
     */
    if (outcome === "SUCCESS") {

      addCheck(
        "SUCCESS: payment intent",
        Boolean(intentData) &&
          intentData.status === "SUCCEEDED" &&
          intentData.trusted === true &&
          intentData.production === false,
        intentData
          ? "status=" +
              intentData.status +
              ", trusted=" +
              intentData.trusted +
              ", production=" +
              intentData.production
          : "Payment intent tidak ditemukan."
      );

      addCheck(
        "SUCCESS: transaction PAID",
        Boolean(txData) &&
          txData.status === "PAID" &&
          Number(txData.amount) === expectedAmount &&
          txData.trusted === true &&
          txData.production === false,
        txData
          ? "status=" +
              txData.status +
              ", amount=" +
              txData.amount +
              ", trusted=" +
              txData.trusted +
              ", production=" +
              txData.production
          : "Transaction tidak ditemukan."
      );

      const payments = listDocuments("payments", 100)
        .map(function(doc) {
          return decodeFirestoreFields(doc.fields || {});
        })
        .filter(function(payment) {
          return (
            payment.payment_intent_id === intentId ||
            payment.transaction_id === txId
          );
        });

      const payment = payments[0] || null;

      addCheck(
        "SUCCESS: payment PAID",
        Boolean(payment) &&
          payment.status === "PAID" &&
          Number(payment.amount) === expectedAmount &&
          payment.trusted === true &&
          payment.production === false,
        payment
          ? "status=" +
              payment.status +
              ", amount=" +
              payment.amount +
              ", trusted=" +
              payment.trusted +
              ", production=" +
              payment.production
          : "Payment record tidak ditemukan."
      );

      const tickets = listDocuments("tickets", 100)
        .map(function(doc) {
          return decodeFirestoreFields(doc.fields || {});
        })
        .filter(function(ticket) {
          return (
            ticket.transaction_id === txId ||
            ticket.payment_intent_id === intentId
          );
        });

      const ticket =
        tickets.find(function(item) {
          return (
            item.status === "ACTIVE" &&
            item.active === true
          );
        }) || null;

      addCheck(
        "SUCCESS: ticket ACTIVE",
        Boolean(ticket) &&
          ticket.activated_by_backend === true &&
          ticket.activation_source ===
            "SANDBOX_TRUSTED_BACKEND" &&
          ticket.production === false,
        ticket
          ? "ticket=" +
              ticket.ticket_id +
              ", status=" +
              ticket.status +
              ", active=" +
              ticket.active
          : "Ticket ACTIVE tidak ditemukan."
      );

    /*
     * ==========================
     * PENDING
     * ==========================
     */
    } else if (outcome === "PENDING") {

      addCheck(
        "PENDING: payment intent",
        Boolean(intentData) &&
          intentData.status === "PROCESSING" &&
          intentData.trusted === true &&
          intentData.production === false,
        intentData
          ? "status=" +
              intentData.status +
              ", trusted=" +
              intentData.trusted +
              ", production=" +
              intentData.production
          : "Payment intent tidak ditemukan."
      );

      addCheck(
        "PENDING: transaction PENDING",
        Boolean(txData) &&
          txData.status === "PENDING" &&
          Number(txData.amount) === expectedAmount &&
          txData.trusted === true &&
          txData.production === false,
        txData
          ? "status=" +
              txData.status +
              ", amount=" +
              txData.amount +
              ", trusted=" +
              txData.trusted +
              ", production=" +
              txData.production
          : "Transaction PENDING tidak ditemukan."
      );

      const pendingTickets = listDocuments("tickets", 100)
        .map(function(doc) {
          return decodeFirestoreFields(doc.fields || {});
        })
        .filter(function(ticket) {
          return (
            ticket.transaction_id === txId ||
            ticket.payment_intent_id === intentId
          );
        });

      addCheck(
        "PENDING: no ACTIVE ticket",
        !pendingTickets.some(function(ticket) {
          return (
            ticket.status === "ACTIVE" &&
            ticket.active === true
          );
        }),
        pendingTickets.length
          ? pendingTickets.length +
              " ticket terkait ditemukan; tidak boleh ada ACTIVE."
          : "Tidak ada ticket terkait."
      );

    /*
     * ==========================
     * FAILED
     * ==========================
     */
    } else {

      addCheck(
        "FAILED: payment intent",
        Boolean(intentData) &&
          intentData.status === "FAILED" &&
          intentData.trusted === true &&
          intentData.production === false,
        intentData
          ? "status=" +
              intentData.status +
              ", trusted=" +
              intentData.trusted +
              ", production=" +
              intentData.production
          : "Payment intent FAILED tidak ditemukan."
      );

      /*
       * FAILED harus tidak mempunyai
       * transaction PAID dan tidak boleh
       * membuat ticket ACTIVE.
       */

      const failedTickets = listDocuments("tickets", 100)
        .map(function(doc) {
          return decodeFirestoreFields(doc.fields || {});
        })
        .filter(function(ticket) {
          return (
            ticket.transaction_id === txId ||
            ticket.payment_intent_id === intentId
          );
        });

      addCheck(
        "FAILED: no ACTIVE ticket",
        !failedTickets.some(function(ticket) {
          return (
            ticket.status === "ACTIVE" &&
            ticket.active === true
          );
        }),
        failedTickets.length
          ? failedTickets.length +
              " ticket terkait ditemukan; tidak boleh ada ACTIVE."
          : "Tidak ada ticket terkait."
      );
    }
  });

  const passCount = checks.filter(function(item) {
    return item.pass;
  }).length;

  const failCount =
    checks.length - passCount;

  const success =
    failCount === 0 &&
    outcomes.every(function(outcome) {
      return Boolean(selected[outcome]);
    });

  return {
    success: success,

    environment: "SANDBOX",

    readOnly: true,

    production: false,

    realBankCalled: false,

    amount: expectedAmount,

    summary: success
      ? "Sandbox audit berhasil. SUCCESS, PENDING, dan FAILED konsisten dengan trusted backend."
      : "Sandbox audit menemukan pemeriksaan yang belum sesuai.",

    passCount: passCount,

    failCount: failCount,

    checks: checks,

    runs: outcomes.map(function(outcome) {

      if (!selected[outcome]) {
        return {
          outcome: outcome,
          runId: null,
          transactionId: null,
          paymentIntentId: null
        };
      }

      return {
        outcome: outcome,
        runId: selected[outcome].id,
        transactionId:
          selected[outcome].data
            .sandbox_transaction_id || null,
        paymentIntentId:
          selected[outcome].data
            .sandbox_payment_intent_id || null
      };
    }),

    timestamp: new Date().toISOString()
  };
}
