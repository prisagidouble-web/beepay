/* Phase 16 Firebase project: beepay-2c2dc. Config is kept in firebase-config.js. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {getFirestore, collection, addDoc, getDocs, getDoc, doc, limit, query, orderBy, serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
const config = window.BeePayConfig;
let db = null
  , auth = null
  , currentUser = null;
const READ_CACHE_TTL_MS = 15000;
const READ_INFLIGHT_MAX_MS = 30000;

async function parseJsonResponseSafe(response, label) {
    const contentType = String(response.headers?.get("content-type") || "").toLowerCase();
    const raw = await response.text();
    if (!raw) {
        return {
            success: false,
            error: `${label}: respons kosong`,
            httpStatus: response.status,
            contentType
        };
    }
    try {
        const data = JSON.parse(raw);
        return data && typeof data === "object"
            ? data
            : { success: false, error: `${label}: response JSON bukan object`, httpStatus: response.status, contentType };
    } catch (error) {
        return {
            success: false,
            error: `${label}: response bukan JSON (HTTP ${response.status}, ${contentType || "content-type tidak diketahui"})`,
            httpStatus: response.status,
            contentType,
            responsePreview: raw.slice(0, 240)
        };
    }
}
const BeePay = {
    version: "23.5.8",
    init() {
        // Global singleton guard: protects against duplicate module/script loading.
        if (window.__BeePayInitPromise)
            return window.__BeePayInitPromise;
        const run = async () => {
        document.getElementById("systemStatus").textContent = "Online";
        this.bindAuth();
        this.bindIntent();
        this.bindCheckout();
        this.bindWebhook();
        this.bindWebhookSimulation();
        this.bindProviderAdapter();
        this.bindProviderConfig();
        this.bindSecurityRbac();
        this.bindDashboardSearch();
        this.bindPaymentRouting();
        this.bindPaymentReconciliation();
        this.bindMerchantContract();
        this.bindUniversalPaymentApi();
        this.bindMerchantRegistry();
        this.bindPaymentIntentLifecycle();
        this.bindVerification();
        this.bindResult();
        this.bindTicket();
        this.bindReconciliation();
        this.bindAudit();
        this.bindSandbox();
        this.bindSandboxAudit();
        this.bindFailureTests();
        this.bindReconciliationIntegrity();
        this.bindMissingReceiptTest();
        this.bindWrongBindingTest();
        this.bindConcurrencyTest();
        this.bindMismatchConcurrencyTest();
        this.bindRecoveryReplayTest();
        this.bindFinalRegressionTests();
        this.bindHealth();
        this.bindFinalAudit();
        await this.checkAPI();
        await this.initFirebase();
        };
        window.__BeePayInitPromise = run();
        return window.__BeePayInitPromise;
    },
    async checkAPI() {
        const e = document.getElementById("apiStatus");
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            e.textContent = "Not Configured";
            return
        }
        try {
            const r = await fetch(config.API_URL);
            if (!r.ok)
                throw Error();
            e.textContent = "Online"
        } catch (x) {
            e.textContent = "Offline"
        }
    },
    async initFirebase() {
        const e = document.getElementById("firebaseStatus");
        if (window.__BeePayFirebaseReady)
            return;
        if (!config?.FIREBASE?.projectId || config.FIREBASE.projectId.startsWith("YOUR_")) {
            e.textContent = "Not Configured";
            return
        }
        try {
            initializeApp(config.FIREBASE);
            db = getFirestore();
            auth = getAuth();
            window.__BeePayFirebaseReady = true;
            e.textContent = "Connected";
            this.watchAuth()
        } catch (x) {
            e.textContent = "Error";
            console.error(x)
        }
    },
    invalidateReadCache(key) {
        if (this.readCache)
            this.readCache.delete(key);
    },
    invalidateReadCaches(keys = []) {
        if (!this.readCache)
            return;
        keys.forEach(k => this.readCache.delete(k));
    },
    async cachedGetDocs(key, queryFactory) {
        if (!db)
            return null;
        if (!this.readCache)
            this.readCache = new Map();
        if (!this.readInflight)
            this.readInflight = new Map();
        const now = Date.now();
        const cached = this.readCache.get(key);
        if (cached && now - cached.at < READ_CACHE_TTL_MS)
            return cached.snapshot;
        const pending = this.readInflight.get(key);
        if (pending)
            return pending;
        const readPromise = getDocs(queryFactory());
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Firestore read timeout")), READ_INFLIGHT_MAX_MS)
        );
        const promise = Promise.race([readPromise, timeoutPromise]).then(snapshot => {
            this.readCache.set(key, {at: Date.now(), snapshot});
            return snapshot;
        }).finally(() => {
            this.readInflight.delete(key);
        });
        this.readInflight.set(key, promise);
        return promise;
    },
    resetReadCache() {
        this.readCache = new Map();
        this.readInflight = new Map();
    },
    bindAuth() {
        document.getElementById("adminLoginForm")?.addEventListener("submit", e => {
            e.preventDefault();
            this.login()
        }
        );
        document.getElementById("logoutButton")?.addEventListener("click", () => this.logout())
    },
    watchAuth() {
        if (window.__BeePayAuthUnsubscribe)
            return;
        window.__BeePayAuthUnsubscribe = onAuthStateChanged(auth, async u => {
            currentUser = u;
            const yes = !!u;
            document.getElementById("authState").textContent = yes ? (u.email || "Authenticated") : "Guest";
            document.getElementById("loginButton").hidden = yes;
            document.getElementById("logoutButton").hidden = !yes;
            document.getElementById("rolePanel").hidden = !yes;
            document.getElementById("paymentProcessing").hidden = !yes;
            if (document.getElementById("sandboxOrderPanel"))
                document.getElementById("sandboxOrderPanel").hidden = !yes;
            if (document.getElementById("bindingHardeningPanel"))
                document.getElementById("bindingHardeningPanel").hidden = !yes;
            if (document.getElementById("webhookLifecyclePanel"))
                document.getElementById("webhookLifecyclePanel").hidden = !yes;
            if (document.getElementById("providerAdapterPanel"))
                document.getElementById("providerAdapterPanel").hidden = !yes;
            if (document.getElementById("providerConfigPanel"))
                document.getElementById("providerConfigPanel").hidden = !yes;
            if (document.getElementById("securityRbacPanel"))
                document.getElementById("securityRbacPanel").hidden = !yes;
            if (document.getElementById("paymentRoutingPanel"))
                document.getElementById("paymentRoutingPanel").hidden = !yes;
            if (document.getElementById("paymentReconciliationPanel"))
                document.getElementById("paymentReconciliationPanel").hidden = !yes;
            if (document.getElementById("merchantContractPanel"))
                document.getElementById("merchantContractPanel").hidden = !yes;
            if (document.getElementById("universalPaymentApiPanel"))
                document.getElementById("universalPaymentApiPanel").hidden = !yes;
            if (document.getElementById("merchantRegistryPanel"))
                document.getElementById("merchantRegistryPanel").hidden = !yes;
            if (document.getElementById("paymentIntentLifecyclePanel"))
                document.getElementById("paymentIntentLifecyclePanel").hidden = !yes;
            if (document.getElementById("concurrencyTestPanel"))
                document.getElementById("concurrencyTestPanel").hidden = !yes;
            if (document.getElementById("recoveryReplayTestPanel"))
                document.getElementById("recoveryReplayTestPanel").hidden = !yes;
            if (document.getElementById("finalRegressionPanel"))
                document.getElementById("finalRegressionPanel").hidden = !yes;
            if (!yes) {
                if (this.lazyReadObserver) {
                    try {
                        this.lazyReadObserver.disconnect()
                    } catch (_) {}
                    this.lazyReadObserver = null;
                }
                this.lazyReadLoaded = new Set();
                this.resetReadCache();
                Object.keys(window).filter(k => k.startsWith("__BeePayAdminProfilePromise_")).forEach(k => { delete window[k]; });
                document.getElementById("authMessage").textContent = "Belum login.";
                return
            }
            try {
                const profileKey = `__BeePayAdminProfilePromise_${u.uid}`;
                let profilePromise = window[profileKey];
                if (!profilePromise) {
                    profilePromise = getDoc(doc(db, "admin_users", u.uid));
                    window[profileKey] = profilePromise;
                }
                const snap = await profilePromise;
                if (!snap.exists()) {
                    document.getElementById("authMessage").textContent = "Akun terautentikasi, tetapi belum terdaftar sebagai admin BeePay.";
                    document.getElementById("adminName").textContent = u.email || "User";
                    document.getElementById("adminRole").textContent = "ACCESS DENIED";
                    document.getElementById("paymentProcessing").hidden = true;
                    await signOut(auth);
                    return;
                }
                const profile = snap.data();
                if (profile.active === false) {
                    document.getElementById("authMessage").textContent = "Akun admin sedang dinonaktifkan.";
                    await signOut(auth);
                    return;
                }
                document.getElementById("authMessage").textContent = "Login admin berhasil.";
                document.getElementById("adminName").textContent = profile.name || u.displayName || u.email || "Admin";
                document.getElementById("adminRole").textContent = `Role: ${profile.role || "ADMIN"}`;
                this.resetReadCache();
                this.setupLazyAdminReads();

            } catch (e) {
                console.error(e);
                document.getElementById("authMessage").textContent = "Gagal memuat profil admin.";
                await signOut(auth);
            }
        }
        )
    },
    setupLazyAdminReads() {
        // HIGH-TRAFFIC SAFE MODE (23.5.5): do not start Firestore list reads
        // merely because an admin logged in or a list entered the viewport.
        // The previous IntersectionObserver could turn a long admin page into
        // multiple Firestore reads immediately after login. Under real traffic
        // this creates unnecessary WebChannel activity and download usage.
        //
        // All existing loadX() methods remain intact and may still be called by
        // explicit user actions / successful operations. Only the automatic
        // post-login observer is disabled.
        if (this.lazyReadObserver) {
            try {
                this.lazyReadObserver.disconnect();
            } catch (_) {}
            this.lazyReadObserver = null;
        }
        this.lazyReadLoaded = new Set();
        this.lazyReadAutoDisabled = true;
    },
    async login() {
        if (!auth)
            return alert("Firebase belum dikonfigurasi.");
        const email = document.getElementById("adminEmail")?.value.trim();
        const password = document.getElementById("adminPassword")?.value || "";
        const msg = document.getElementById("authMessage");
        if (!email || !password) {
            msg.textContent = "Email dan password wajib diisi.";
            return
        }
        msg.textContent = "Memproses login...";
        try {
            await signInWithEmailAndPassword(auth, email, password);
            document.getElementById("adminLoginForm")?.reset();
        } catch (e) {
            console.error(e);
            const map = {
                "auth/invalid-credential": "Email atau password salah.",
                "auth/user-not-found": "Akun admin tidak ditemukan.",
                "auth/wrong-password": "Password salah.",
                "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
                "auth/invalid-email": "Format email tidak valid."
            };
            msg.textContent = map[e.code] || ("Login gagal: " + e.message);
        }
    },
    async logout() {
        if (this.lazyReadObserver) {
            try {
                this.lazyReadObserver.disconnect()
            } catch (_) {}
            this.lazyReadObserver = null;
        }
        this.lazyReadLoaded = new Set();
        this.resetReadCache();
        if (auth)
            await signOut(auth)
    },
    bindIntent() {
        document.getElementById("intentForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.createIntent()
        }
        );
        document.getElementById("sandboxOrderBtn")?.addEventListener("click", () => this.createSandboxOrder());
        document.getElementById("bindingAuditBtn")?.addEventListener("click", () => this.runBindingAudit());
        document.getElementById("idempotencyTestBtn")?.addEventListener("click", () => this.runIdempotencyTest())
    },
    bindCheckout() {
        document.getElementById("checkoutForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.createCheckout()
        }
        )
    },
    bindWebhook() {
        document.getElementById("webhookForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.createWebhookLedger()
        }
        )
    },
    bindWebhookSimulation() {
        document.getElementById("webhookSimulationForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.runWebhookSimulation()
        }
        );
        document.getElementById("webhookLifecycleTestBtn")?.addEventListener("click", () => this.runWebhookLifecycleTest())
    },
    bindProviderAdapter() {
        document.getElementById("providerAdapterTestBtn")?.addEventListener("click", () => this.runProviderAdapterTest())
    },
    bindSecurityRbac() {
        document.getElementById("securityRbacTestBtn")?.addEventListener("click", async () => {
            await this.runSecurityRbacTest();
        });
    },
    bindDashboardSearch() {
        const input = document.getElementById("dashboardSearch");
        const clear = document.getElementById("dashboardSearchClear");
        if (!input) return;
        const apply = () => {
            const q = String(input.value || "").trim().toLowerCase();
            const sections = Array.from(document.querySelectorAll("main > section"))
                .filter(section => section.id !== "dashboardSearchPanel" && !section.classList.contains("hero") && !section.classList.contains("auth-panel") && !section.classList.contains("system-status"));
            let visible = 0;
            sections.forEach(section => {
                const haystack = String(section.textContent || "").toLowerCase();
                const match = !q || haystack.includes(q);
                section.classList.toggle("search-filtered-out", !match);
                if (match) visible++;
            });
            const count = document.getElementById("dashboardSearchCount");
            if (count) count.textContent = q ? `${visible} modul/test cocok` : "Semua modul ditampilkan";
        };
        input.addEventListener("input", apply);
        clear?.addEventListener("click", () => {
            input.value = "";
            input.focus();
            apply();
        });
    },
    async runSecurityRbacTest() {
        const m = document.getElementById("securityRbacTestMessage");
        if (!m) return;
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return;
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return;
        }
        m.textContent = "Menjalankan Security / Authorization / RBAC / Access Control Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {"Content-Type": "text/plain;charset=utf-8"},
                body: JSON.stringify({action: "sandbox_security_rbac_test", idToken})
            });
            const result = await parseJsonResponseSafe(response, "Security / RBAC Test");
            if (!result.success && result.overall !== "FAIL") throw new Error(result.error || "Security / RBAC Test gagal.");
            const detail = (result.checks || []).map(x => `${x.pass ? "PASS" : "FAIL"}: ${x.name}${x.detail ? ` (${x.detail})` : ""}`).join(" · ");
            m.textContent = `Security / Authorization / RBAC / Access Control ${result.overall || "FAIL"}: PASS ${result.passCount || 0} · FAIL ${result.failCount || 0}. ${result.message || result.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Security / RBAC Test gagal: " + e.message;
        }
    },
    bindProviderConfig() {
        document.getElementById("providerConfigStatusBtn")?.addEventListener("click", () => this.loadProviderConfigStatus());
        document.getElementById("providerConfigTestBtn")?.addEventListener("click", () => this.runProviderConfigTest())
    },
    bindPaymentRouting() {
        document.getElementById("paymentRoutingStatusBtn")?.addEventListener("click", () => this.loadPaymentRoutingStatus());
        document.getElementById("paymentRoutingTestBtn")?.addEventListener("click", () => this.runPaymentRoutingTest())
    },
    bindPaymentReconciliation() {
        document.getElementById("paymentReconciliationStatusBtn")?.addEventListener("click", () => this.loadPaymentReconciliationStatus());
        document.getElementById("paymentReconciliationTestBtn")?.addEventListener("click", () => this.runPaymentReconciliationTest())
    },
    bindMerchantContract() {
        document.getElementById("merchantContractStatusBtn")?.addEventListener("click", () => this.loadMerchantContractStatus());
        document.getElementById("merchantUpgradeTestBtn")?.addEventListener("click", () => this.runMerchantUpgradeTest())
    },
    bindUniversalPaymentApi() {
        document.getElementById("universalPaymentApiTestBtn")?.addEventListener("click", () => this.runUniversalPaymentApiTest())
    },
    bindMerchantRegistry() {
        document.getElementById("merchantRegistryStatusBtn")?.addEventListener("click", () => this.loadMerchantRegistryStatus());
        document.getElementById("merchantRegistryTestBtn")?.addEventListener("click", () => this.runMerchantRegistryTest())
    },
    bindPaymentIntentLifecycle() {
        document.getElementById("paymentIntentLifecycleTestBtn")?.addEventListener("click", () => this.runPaymentIntentLifecycleTest())
    },
    bindConcurrencyTest() {
        document.getElementById("concurrencyTestBtn")?.addEventListener("click", () => this.runConcurrencyTest())
    },
    bindMismatchConcurrencyTest() {
        document.getElementById("mismatchConcurrencyTestBtn")?.addEventListener("click", () => this.runMismatchConcurrencyTest())
    },
    bindRecoveryReplayTest() {
        document.getElementById("recoveryReplayTestBtn")?.addEventListener("click", () => this.runRecoveryReplayTest())
    },
    bindVerification() {
        document.getElementById("verificationForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.createVerificationRecord()
        }
        )
    },
    bindResult() {
        document.getElementById("resultForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.createResultRecord()
        }
        )
    },
    bindTicket() {
        document.getElementById("ticketForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.createTicketRecord()
        }
        )
    },
    bindReconciliation() {
        document.getElementById("reconForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.loadReconciliation()
        }
        )
    },
    bindAudit() {
        document.getElementById("auditForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.createAuditEvent()
        }
        )
    },
    bindSandbox() {
        document.getElementById("sandboxForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.runSandbox()
        }
        )
    },
    bindSandboxAudit() {
        document.getElementById("sandboxAuditBtn")?.addEventListener("click", async () => {
            await this.runSandboxAudit()
        }
        )
    },
    bindFailureTests() {
        document.getElementById("failureTestForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.runFailureTest()
        }
        )
    },
    bindReconciliationIntegrity() {
        document.getElementById("reconIntegrityBtn")?.addEventListener("click", async () => {
            await this.runReconciliationIntegrityTest()
        }
        )
    },
    bindMissingReceiptTest() {
        document.getElementById("missingReceiptTestBtn")?.addEventListener("click", async () => {
            await this.runMissingReceiptTest()
        }
        )
    },
    bindWrongBindingTest() {
        document.getElementById("wrongBindingTestBtn")?.addEventListener("click", async () => {
            await this.runWrongBindingTest()
        }
        )
    },
    bindFinalRegressionTests() {
        document.getElementById("endToEndTestBtn")?.addEventListener("click", () => this.runFinalRegressionTest("endToEnd"));
        document.getElementById("sandboxAuditFinalBtn")?.addEventListener("click", () => this.runFinalRegressionTest("audit"));
        document.getElementById("idempotencyFinalBtn")?.addEventListener("click", () => this.runFinalRegressionTest("idempotency"));
    },
    async runFinalRegressionTest(kind) {
        const box = document.getElementById("finalRegressionTestMessage");
        const buttons = ["endToEndTestBtn", "sandboxAuditFinalBtn", "idempotencyFinalBtn"].map(id => document.getElementById(id)).filter(Boolean);
        const buttonByKind = {
            endToEnd: "endToEndTestBtn",
            audit: "sandboxAuditFinalBtn",
            idempotency: "idempotencyFinalBtn"
        };
        const active = document.getElementById(buttonByKind[kind]);
        if (!box || !active)
            return;
        if (this.finalTestBusy) {
            box.textContent = "Test lain masih berjalan. Tunggu sampai selesai.";
            return
        }
        if (!auth || !currentUser) {
            box.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            box.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }

        const labels = {
            endToEnd: "End-to-End Test",
            audit: "Sandbox Audit",
            idempotency: "Idempotency Test"
        };
        const actions = {
            endToEnd: "sandbox_webhook_lifecycle_test",
            audit: "sandbox_audit",
            idempotency: "sandbox_idempotency_test"
        };
        this.finalTestBusy = true;
        buttons.forEach(b => {
            b.disabled = true;
            b.setAttribute("aria-busy", "true")
        }
        );
        box.textContent = `Menjalankan ${labels[kind]} melalui trusted backend...`;

        let timer = null;
        try {
            const idToken = await currentUser.getIdToken();
            const controller = new AbortController();
            // E2E is an intentionally heavy SANDBOX lifecycle test. Keep a
            // bounded client budget without changing payment runtime behavior.
            // Normal admin audits retain the shorter timeout.
            const requestBudgetMs = kind === "endToEnd" ? 90000 : 45000;
            const requestStartedAt = performance.now();
            timer = setTimeout( () => controller.abort(), requestBudgetMs);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: actions[kind],
                    idToken
                }),
                signal: controller.signal,
                cache: "no-store"
            });
            const result = await response.json();
            if (!response.ok || !result.success)
                throw new Error(result.error || result.message || `${labels[kind]} gagal.`);
            const hasCounts = Number.isFinite(Number(result.passCount)) || Number.isFinite(Number(result.failCount));
            const pass = hasCounts ? Number(result.passCount || 0) : (result.success === true ? 1 : 0);
            const fail = hasCounts ? Number(result.failCount || 0) : (result.success === true ? 0 : 1);
            const checked = Number(result.checked || 0);
            const detail = result.message || result.summary || "Test selesai.";
            box.textContent = `${labels[kind]} ${String(result.overall || "PASS").toUpperCase()}: PASS ${pass}${checked ? ` / ${checked}` : ""} · FAIL ${fail}. ${detail}`;
        } catch (e) {
            console.error(`BeePay ${labels[kind]} error:`, e);
            box.textContent = `${labels[kind]} FAIL: ${e.name === "AbortError" ? `Request timeout setelah ${Math.round(requestBudgetMs / 1000)} detik.` : (e.message || e)}`;
        } finally {
            if (timer)
                clearTimeout(timer);
            buttons.forEach(b => {
                b.disabled = false;
                b.removeAttribute("aria-busy")
            }
            );
            this.finalTestBusy = false;
        }
    },
    bindHealth() {
        document.getElementById("healthCheckForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.recordHealthCheck()
        }
        )
    },
    bindFinalAudit() {
        document.getElementById("auditChecklistForm")?.addEventListener("submit", async e => {
            e.preventDefault();
            await this.recordFinalAudit()
        }
        )
    },
    async recordFinalAudit() {
        const m = document.getElementById("auditChecklistMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const item = document.getElementById("auditCheckItem").value
          , status = document.getElementById("auditCheckStatus").value
          , note = document.getElementById("auditCheckNote").value.trim()
          , id = `FA-${Date.now()}`;
        try {
            await addDoc(collection(db, "final_audits"), {
                final_audit_id: id,
                item,
                status,
                note,
                production: false,
                bank_called: false,
                approval: false,
                created_by: currentUser.uid,
                created_at: serverTimestamp()
            });
            document.getElementById("auditChecklistForm").reset();
            this.invalidateReadCache("final_audits");
            m.textContent = `Final audit ${id} dicatat: ${status}.`;
            await this.loadFinalAudits()
        } catch (e) {
            m.textContent = "Gagal mencatat final audit: " + e.message
        }
    },
    async loadFinalAudits() {
        const list = document.getElementById("auditChecklistList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("final_audits", () => query(collection(db, "final_audits"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada final audit.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.item || "-")}</h3><div class="meta">${this.escape(x.final_audit_id || "-")} · ${this.escape(x.note || "")}</div></div><span class="status">${this.escape(x.status || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Final audit belum dapat dibaca.</div>'
        }
    },
    async recordHealthCheck() {
        const m = document.getElementById("healthMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const component = document.getElementById("healthComponent").value
          , status = document.getElementById("healthStatus").value
          , note = document.getElementById("healthNote").value.trim();
        const id = `HC-${Date.now()}`;
        try {
            await addDoc(collection(db, "health_checks"), {
                health_check_id: id,
                component,
                status,
                note,
                production: false,
                bank_called: false,
                created_by: currentUser.uid,
                created_at: serverTimestamp()
            });
            document.getElementById("healthCheckForm").reset();
            this.invalidateReadCache("health_checks");
            m.textContent = `Health check ${id} dicatat: ${status}.`;
            await this.loadHealthChecks()
        } catch (e) {
            m.textContent = "Gagal mencatat health check: " + e.message
        }
    },
    async loadHealthChecks() {
        const list = document.getElementById("healthList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("health_checks", () => query(collection(db, "health_checks"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada health check.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.component || "-")}</h3><div class="meta">${this.escape(x.health_check_id || "-")} · ${this.escape(x.note || "")}</div></div><span class="status">${this.escape(x.status || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Health check belum dapat dibaca.</div>'
        }
    },
    async runFailureTest() {
        const m = document.getElementById("failureTestMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const tx = document.getElementById("failureTxId").value.trim()
          , scenario = document.getElementById("failureScenario").value;
        if (!tx) {
            m.textContent = "Transaction ID wajib diisi.";
            return
        }
        const id = `FT-${Date.now()}`;
        const data = {
            failure_test_id: id,
            transaction_id: tx,
            scenario,
            result: "PASS_EXPECTED_GUARD",
            production: false,
            real_bank_called: false,
            idempotency_key: `${scenario}:${tx}`,
            created_by: currentUser.uid,
            created_at: serverTimestamp()
        };
        try {
            await addDoc(collection(db, "failure_tests"), data);
            document.getElementById("failureTestForm").reset();
            this.invalidateReadCache("failure_tests");
            m.textContent = `Test ${id}: ${scenario} registrasi berhasil. Live bank tidak dipanggil.`;
            await this.loadFailureTests()
        } catch (e) {
            m.textContent = "Gagal mencatat failure test: " + e.message
        }
    },
    async loadFailureTests() {
        const list = document.getElementById("failureTestList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("failure_tests", () => query(collection(db, "failure_tests"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada failure test.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.failure_test_id || "-")}</h3><div class="meta">TX: ${this.escape(x.transaction_id || "-")} · Key: ${this.escape(x.idempotency_key || "-")}</div></div><span class="status">${this.escape(x.scenario || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Failure test belum dapat dibaca.</div>'
        }
    },
    async runSandbox() {
        const m = document.getElementById("sandboxMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        const eventId = document.getElementById("sandboxEventId").value.trim()
          , userId = document.getElementById("sandboxUserId").value.trim()
          , amount = Number(document.getElementById("sandboxAmount").value)
          , outcome = document.getElementById("sandboxOutcome").value
          , paymentIntentId = (document.getElementById("sandboxPaymentIntentId")?.value || "").trim();
        if (!eventId || !userId || !Number.isSafeInteger(amount) || amount < 1) {
            m.textContent = "Event, User dan amount valid wajib diisi.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi. Isi API_URL di config/config.js.";
            return
        }
        m.textContent = "Memproses sandbox melalui trusted backend...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_payment",
                    idToken,
                    eventId,
                    userId,
                    amount,
                    outcome,
                    paymentIntentId
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Sandbox gagal.");
            document.getElementById("sandboxForm").reset();
            this.invalidateReadCaches(["sandbox_runs", "tickets", "payment_intents"]);
            m.textContent = `${result.message} Run: ${result.sandboxRunId} · Ticket: ${result.ticketId || "-"}`;
            await this.loadSandboxRuns();
            await this.loadTickets();
        } catch (e) {
            console.error(e);
            m.textContent = "Sandbox gagal: " + e.message
        }
    },
    async runSandboxAudit() {
        const m = document.getElementById("sandboxAuditMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Memeriksa setiap sandbox run...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_audit",
                    idToken
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Audit gagal.");
            const checked = Number(result.checked || 0);
            const checks = Array.isArray(result.checks) ? result.checks : [];
            const results = Array.isArray(result.results) ? result.results : [];
            const runPassed = results.map(x => {
                const outcome = String(x.outcome || "").toUpperCase();
                const relatedChecks = checks.filter(c => String(c.name || "").toUpperCase().startsWith(outcome + ":"));
                const backendPass = (typeof x.pass === "boolean") ? x.pass : (relatedChecks.length > 0 && relatedChecks.every(c => c.pass === true));
                return {
                    data: x,
                    pass: backendPass,
                    ticketCheck: relatedChecks.find(c => String(c.name || "").toLowerCase().includes("ticket")) || null
                };
            }
            );
            const passCount = runPassed.filter(x => x.pass).length;
            const failCount = runPassed.filter(x => !x.pass).length;
            const errorCount = Math.max(0, checked - results.length);
            const detail = runPassed.map(x => {
                const d = x.data;
                const outcome = String(d.outcome || "-").toUpperCase();
                const ticketCheck = x.ticketCheck;
                let ticketLabel = "NO ACTIVE ticket";
                if (outcome === "SUCCESS") {
                    ticketLabel = ticketCheck && ticketCheck.pass === true ? "ACTIVE ticket" : "ACTIVE ticket";
                } else if (ticketCheck && ticketCheck.pass === false) {
                    ticketLabel = "ACTIVE ticket detected";
                }
                return `${d.sandboxRunId || "-"}: ${outcome} → ${ticketLabel} → ${String(d.status || "-").toUpperCase()}`;
            }
            ).join("\n");
            m.textContent = `Audit ${result.overall || "FAIL"}: ${checked} run diperiksa | PASS ${passCount} | FAIL ${failCount} | ERROR ${errorCount}.\n${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Sandbox audit gagal: " + e.message
        }
    },
    async loadSandboxRuns() {
        const list = document.getElementById("sandboxList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("sandbox_runs", () => query(collection(db, "sandbox_runs"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada sandbox run.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.sandbox_run_id || "-")}</h3><div class="meta">Event: ${this.escape(x.event_id || "-")} · User: ${this.escape(x.user_id || "-")} · ${this.escape(String(x.amount || 0))} IDR</div></div><span class="status">${this.escape(x.outcome || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Sandbox ledger belum dapat dibaca.</div>'
        }
    },
    async createAuditEvent() {
        const m = document.getElementById("auditMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const action = document.getElementById("auditAction").value.trim()
          , target = document.getElementById("auditTarget").value.trim()
          , severity = document.getElementById("auditSeverity").value;
        if (!action || !target) {
            m.textContent = "Action dan target wajib diisi.";
            return
        }
        const id = `AUD-${Date.now()}`
          , data = {
            audit_id: id,
            actor_uid: currentUser.uid,
            action,
            target_id: target,
            severity,
            source: "admin-ui",
            trusted: false,
            created_at: serverTimestamp()
        };
        try {
            await addDoc(collection(db, "audit_logs"), data);
            document.getElementById("auditForm").reset();
            this.invalidateReadCache("audit_logs");
            m.textContent = `Audit ${id} dicatat.`;
            await this.loadAudits()
        } catch (e) {
            m.textContent = "Gagal mencatat audit: " + e.message
        }
    },
    async loadAudits() {
        const list = document.getElementById("auditList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("audit_logs", () => query(collection(db, "audit_logs"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada audit event.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.action || "-")}</h3><div class="meta">${this.escape(x.audit_id || "-")} · Target: ${this.escape(x.target_id || "-")} · Actor: ${this.escape(x.actor_uid || "-")}</div></div><span class="status">${this.escape(x.severity || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Audit log belum dapat dibaca.</div>'
        }
    },
    async loadReconciliation() {
        const list = document.getElementById("reconList")
          , summary = document.getElementById("reconSummary");
        if (!list || !currentUser) {
            if (list)
                list.innerHTML = '<div class="intent-card">Login terlebih dahulu.</div>';
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            list.innerHTML = '<div class="intent-card">API Apps Script belum dikonfigurasi.</div>';
            if (summary)
                summary.innerHTML = "";
            return
        }
        const eventFilter = document.getElementById("reconEventId")?.value.trim() || "";
        const statusFilter = document.getElementById("reconStatus")?.value || "";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "reconciliation_query",
                    idToken,
                    eventId: eventFilter,
                    status: statusFilter,
                    limit: 20
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Rekonsiliasi gagal.");
            const rows = Array.isArray(result.rows) ? result.rows : [];
            const s = result.summary || {};
            summary.innerHTML = `<div class="summary-card"><b>${Number(s.count || rows.length)}</b><span>Transaksi</span></div><div class="summary-card"><b>${Number(s.total || 0).toLocaleString("id-ID")} IDR</b><span>Total ledger</span></div><div class="summary-card"><b>${Number(s.paid || 0).toLocaleString("id-ID")} IDR</b><span>PAID</span></div><div class="summary-card"><b>${Number(s.pending || 0).toLocaleString("id-ID")} IDR</b><span>PENDING</span></div>`;
            if (!rows.length) {
                list.innerHTML = '<div class="intent-card">Tidak ada transaksi sesuai filter.</div>';
                return
            }
            list.innerHTML = rows.map(x => `<article class="intent-card"><div><h3>${this.escape(x.transaction_id || "-")}</h3><div class="meta">Event: ${this.escape(x.event_id || "-")} · Order: ${this.escape(x.order_id || "-")} · Ref: ${this.escape(x.reference || x.provider_reference || "-")}</div></div><div><b>${this.escape(String(x.amount || 0))} ${this.escape(x.currency || "IDR")}</b><div class="meta">${this.escape(x.status || "-")}</div></div></article>`).join("");
        } catch (e) {
            console.error("Reconciliation backend query:", e);
            summary.innerHTML = "";
            list.innerHTML = '<div class="intent-card">Rekonsiliasi gagal dimuat: ' + this.escape(e.message || "Unknown error") + '</div>';
        }
    },
    async createTicketRecord() {
        const m = document.getElementById("ticketMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const orderId = document.getElementById("ticketOrderId").value.trim()
          , transactionId = document.getElementById("ticketTransactionId").value.trim()
          , userId = document.getElementById("ticketUserId").value.trim()
          , eventId = document.getElementById("ticketEventId").value.trim();
        if (!orderId || !transactionId || !userId || !eventId) {
            m.textContent = "Order, Transaction, User dan Event wajib diisi.";
            return
        }
        const id = `TKT-${Date.now()}`
          , data = {
            ticket_id: id,
            order_id: orderId,
            transaction_id: transactionId,
            user_id: userId,
            event_id: eventId,
            status: document.getElementById("ticketStatus").value,
            active: false,
            activated_by_backend: false,
            created_by: currentUser.uid,
            created_at: serverTimestamp()
        };
        try {
            await addDoc(collection(db, "tickets"), data);
            document.getElementById("ticketForm").reset();
            this.invalidateReadCache("tickets");
            m.textContent = `Ticket ${id} dicatat. Belum aktif karena belum ada trusted payment success.`;
            await this.loadTickets()
        } catch (e) {
            m.textContent = "Gagal mencatat ticket: " + e.message
        }
    },
    async loadTickets() {
        const list = document.getElementById("ticketList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("tickets", () => query(collection(db, "tickets"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada ticket record.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.ticket_id || "-")}</h3><div class="meta">Order: ${this.escape(x.order_id || "-")} · TRX: ${this.escape(x.transaction_id || "-")} · Event: ${this.escape(x.event_id || "-")}</div></div><span class="status">${this.escape(x.status || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Ticket ledger belum dapat dibaca.</div>'
        }
    },
    async createResultRecord() {
        const m = document.getElementById("resultMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const intentId = document.getElementById("resultIntentId").value.trim()
          , transactionId = document.getElementById("resultTransactionId").value.trim()
          , status = document.getElementById("resultStatus").value
          , ref = document.getElementById("resultProviderRef").value.trim();
        if (!intentId || !transactionId) {
            m.textContent = "Payment Intent ID dan Transaction ID wajib diisi.";
            return
        }
        const id = `PR-${Date.now()}`
          , data = {
            payment_result_id: id,
            payment_intent_id: intentId,
            transaction_id: transactionId,
            status,
            provider_reference: ref || null,
            trusted: false,
            processed_by_backend: false,
            created_by: currentUser.uid,
            created_at: serverTimestamp()
        };
        try {
            await addDoc(collection(db, "payment_results"), data);
            document.getElementById("resultForm").reset();
            this.invalidateReadCache("payment_results");
            m.textContent = `Payment Result ${id} dicatat untuk QA. Tidak mengaktifkan tiket.`;
            await this.loadResults()
        } catch (e) {
            m.textContent = "Gagal mencatat result: " + e.message
        }
    },
    async loadResults() {
        const list = document.getElementById("resultList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("payment_results", () => query(collection(db, "payment_results"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada payment result.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.payment_result_id || "-")}</h3><div class="meta">Intent: ${this.escape(x.payment_intent_id || "-")} · TRX: ${this.escape(x.transaction_id || "-")} · Ref: ${this.escape(x.provider_reference || "-")}</div></div><span class="status">${this.escape(x.status || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Payment result belum dapat dibaca.</div>'
        }
    },
    async createVerificationRecord() {
        const m = document.getElementById("verificationMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const intentId = document.getElementById("verificationIntentId").value.trim()
          , ref = document.getElementById("verificationReference").value.trim()
          , amount = Number(document.getElementById("verificationAmount").value)
          , result = document.getElementById("verificationResult").value;
        if (!intentId || !ref || !Number.isSafeInteger(amount) || amount < 1) {
            m.textContent = "Payment Intent, reference dan amount valid wajib diisi.";
            return
        }
        const id = `VR-${Date.now()}`
          , data = {
            verification_id: id,
            payment_intent_id: intentId,
            provider_reference: ref,
            observed_amount: amount,
            result,
            verified: false,
            verified_by_backend: false,
            created_by: currentUser.uid,
            created_at: serverTimestamp()
        };
        try {
            await addDoc(collection(db, "verification_ledger"), data);
            document.getElementById("verificationForm").reset();
            this.invalidateReadCache("verification_ledger");
            m.textContent = `Verification ${id} dicatat sebagai audit/QA. Status pembayaran tidak diubah.`;
            await this.loadVerifications()
        } catch (e) {
            m.textContent = "Gagal mencatat verification: " + e.message
        }
    },
    async loadVerifications() {
        const list = document.getElementById("verificationList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("verification_ledger", () => query(collection(db, "verification_ledger"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada verification record.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.verification_id || "-")}</h3><div class="meta">Intent: ${this.escape(x.payment_intent_id || "-")} · Ref: ${this.escape(x.provider_reference || "-")} · ${this.escape(String(x.observed_amount || 0))} IDR</div></div><span class="status">${this.escape(x.result || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Verification ledger belum dapat dibaca.</div>'
        }
    },
    async runWebhookSimulation() {
        const m = document.getElementById("webhookSimulationMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        const paymentIntentId = document.getElementById("webhookSimulationIntentId").value.trim();
        const provider = document.getElementById("webhookSimulationProvider").value.trim();
        const providerEventId = document.getElementById("webhookSimulationEventId").value.trim();
        const eventType = document.getElementById("webhookSimulationEventType").value;
        const providerReference = document.getElementById("webhookSimulationReference").value.trim();
        const payloadHash = document.getElementById("webhookSimulationHash").value.trim();
        const amount = Number(document.getElementById("webhookSimulationAmount").value);
        const targetStatus = document.getElementById("webhookSimulationStatus").value;
        const signatureValid = document.getElementById("webhookSimulationSignature").value === "VALID";
        if (!paymentIntentId || !provider || !providerEventId || !providerReference || !payloadHash || !Number.isSafeInteger(amount) || amount < 1) {
            m.textContent = "Semua field webhook dan amount valid wajib diisi.";
            return
        }
        m.textContent = "Memproses webhook melalui trusted backend...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_webhook",
                    idToken,
                    paymentIntentId,
                    provider,
                    providerEventId,
                    eventType,
                    providerReference,
                    payloadHash,
                    amount,
                    targetStatus,
                    signatureValid
                })
            });
            const result = await response.json();
            if (result.rejected) {
                m.textContent = `Webhook REJECTED: ${result.reason}. ${result.message || ""}`;
                return
            }
            if (!result.success)
                throw new Error(result.error || "Webhook gagal.");
            m.textContent = `Webhook ${result.targetStatus} ${result.existing ? "IDEMPOTENT" : "PROCESSED"}. ${result.message || ""} Transaction: ${result.transactionId || "-"} · Ticket: ${result.ticketId || "-"}`;
            this.invalidateReadCaches(["payment_intents", "tickets"]);
            await this.loadIntents();
            await this.loadTickets();
        } catch (e) {
            console.error(e);
            m.textContent = "Webhook gagal: " + e.message
        }
    },
    async runWebhookLifecycleTest() {
        const m = document.getElementById("webhookLifecycleTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan lifecycle webhook test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_webhook_lifecycle_test",
                    idToken
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Lifecycle webhook test gagal.");
            const detail = (result.checks || []).map(x => `${x.pass ? "PASS" : "FAIL"}: ${x.name}`).join(" · ");
            m.textContent = `Lifecycle Webhook ${result.overall}: PASS ${result.passCount} · FAIL ${result.failCount}. ${result.message} ${detail}`;
            this.invalidateReadCaches(["payment_intents", "tickets"]);
            await this.loadIntents();
            await this.loadTickets();
        } catch (e) {
            console.error(e);
            m.textContent = "Lifecycle webhook test gagal: " + e.message
        }
    },
    async loadProviderConfigStatus() {
        const m = document.getElementById("providerConfigStatusMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Memeriksa provider runtime configuration...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "provider_config_status",
                    idToken
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Gagal membaca provider configuration.");
            m.textContent = `Provider ${result.provider} · Environment ${result.configuredEnvironment} · Live ${result.adapterLive ? "ON" : "OFF"} · Credential source ${result.credentialSource} · Credential values exposed: ${result.credentialsExposed ? "YES" : "NO"}.`;
        } catch (e) {
            console.error(e);
            m.textContent = "Provider configuration gagal: " + e.message
        }
    },
    async runProviderConfigTest() {
        const m = document.getElementById("providerConfigTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan Provider Configuration Boundary Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_provider_config_test",
                    idToken
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Provider Configuration Boundary Test gagal.");
            const detail = (result.checks || []).map(x => `${x.pass ? "PASS" : "FAIL"}: ${x.name}`).join(" · ");
            m.textContent = `Provider Configuration Boundary ${result.overall}: PASS ${result.passCount} · FAIL ${result.failCount}. ${result.message} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Provider Configuration Boundary Test gagal: " + e.message
        }
    },
    async loadPaymentRoutingStatus() {
        const m = document.getElementById("paymentRoutingStatusMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Memeriksa payment channel routing...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "provider_routing_status",
                    idToken
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Gagal membaca payment channel routing.");
            const routes = (result.channels || []).map(x => `${x.channel} → ${x.provider}`).join(" · ");
            m.textContent = `Environment ${result.environment} · Live ${result.liveBankCalled ? "ON" : "OFF"} · ${routes} · Credential values exposed: ${result.credentialValuesExposed ? "YES" : "NO"}.`;
        } catch (e) {
            console.error(e);
            m.textContent = "Payment channel routing gagal: " + e.message
        }
    },
    async runPaymentRoutingTest() {
        const m = document.getElementById("paymentRoutingTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan Payment Channel Routing Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_provider_routing_test",
                    idToken
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Payment Channel Routing Test gagal.");
            const detail = (result.checks || []).map(x => `${x.pass ? "PASS" : "FAIL"}: ${x.name}`).join(" · ");
            m.textContent = `Payment Channel Routing ${result.overall}: PASS ${result.passCount} · FAIL ${result.failCount}. ${result.message} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Payment Channel Routing Test gagal: " + e.message
        }
    },
    async runPaymentIntentLifecycleTest() {
        const m = document.getElementById("paymentIntentLifecycleMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan Payment Intent Lifecycle Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_payment_intent_lifecycle_test",
                    idToken
                })
            });
            const result = await response.json();
            const detail = (result.checks || []).map(x => `${x.pass ? "PASS" : "FAIL"}: ${x.name}${x.detail ? ` (${x.detail})` : ""}`).join(" · ");
            if (!result.success) {
                m.textContent = `Payment Intent Lifecycle ${result.overall || "FAIL"}: PASS ${result.passCount || 0} · FAIL ${result.failCount || 0}. ${result.message || result.error || "Test gagal."} ${detail}`;
                return;
            }
            m.textContent = `Payment Intent Lifecycle ${result.overall}: PASS ${result.passCount} · FAIL ${result.failCount}. ${result.message} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Payment Intent Lifecycle Test gagal: " + e.message
        }
    },

    async runMissingReceiptTest() {
        const m = document.getElementById("missingReceiptTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan Missing Receipt Test 23.5.1...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_missing_receipt_test",
                    idToken
                })
            });
            const x = await r.json();
            const detail = (x.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Missing Receipt Test ${x.overall || "FAIL"}: PASS ${x.passCount || 0} · FAIL ${x.failCount || 0}. ${x.message || x.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Missing Receipt Test gagal: " + e.message
        }
    },

    async runWrongBindingTest() {
        const m = document.getElementById("wrongBindingTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan Wrong Binding Test 23.5.1...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_wrong_binding_test",
                    idToken
                })
            });
            const x = await r.json();
            const detail = (x.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Wrong Binding Test ${x.overall || "FAIL"}: PASS ${x.passCount || 0} · FAIL ${x.failCount || 0}. ${x.message || x.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Wrong Binding Test gagal: " + e.message
        }
    },

    async runConcurrencyTest() {
        const m = document.getElementById("concurrencyTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        let specimen = null;
        let verified = false;
        m.textContent = "Menyiapkan concurrency specimen SANDBOX...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const postJson = async (body, label) => {
                try {
                    const response = await fetch(config.API_URL, {
                        method: "POST",
                        headers: {
                            "Content-Type": "text/plain;charset=utf-8"
                        },
                        body: JSON.stringify(body),
                        cache: "no-store"
                    });
                    const data = await parseJsonResponseSafe(response, label);
                    return { ...data, httpOk: response.ok };
                } catch (error) {
                    return {
                        success: false,
                        error: `${label}: ${error?.message || error}`,
                        networkError: true
                    };
                }
            };

            const prep = await postJson({
                action: "sandbox_concurrency_prepare",
                idToken
            }, "Concurrency prepare");
            if (!prep.success)
                throw new Error(prep.error || "Gagal menyiapkan concurrency test.");

            specimen = {
                paymentIntentId: prep.paymentIntentId,
                providerEventId: prep.providerEventId
            };
            const webhookCount = Number(prep.concurrencyWebhookCount || 20);
            const reconCount = Number(prep.concurrencyReconciliationCount || 20);
            const webhookBody = {
                action: "sandbox_webhook",
                idToken,
                paymentIntentId: prep.paymentIntentId,
                provider: prep.provider,
                providerEventId: prep.providerEventId,
                eventType: prep.eventType,
                providerReference: prep.providerReference,
                payloadHash: "CONCURRENCY-HASH-2351",
                currency: prep.currency,
                amount: prep.amount,
                targetStatus: prep.targetStatus,
                signatureValid: true
            };
            m.textContent = `Menjalankan ${webhookCount} duplicate webhook bersamaan...`;
            const webhookResults = await Promise.all(Array.from({
                length: webhookCount
            }, (_, i) => postJson(webhookBody, `Webhook #${i + 1}`)));
            const processed = webhookResults.filter(x => x.success && !x.existing).length;
            const idempotent = webhookResults.filter(x => x.success && x.existing && x.idempotent).length;
            const rejected = webhookResults.filter(x => x.rejected).length;
            const webhookErrors = webhookResults.filter(x => !x.success).length;
            m.textContent = `Webhook concurrency selesai: ${processed} processed · ${idempotent} idempotent · ${rejected} rejected · ${webhookErrors} error. Menjalankan ${reconCount} reconciliation query bersamaan...`;

            const reconBody = {
                action: "reconciliation_query",
                idToken,
                paymentIntentId: prep.paymentIntentId
            };
            const reconResults = await Promise.all(Array.from({
                length: reconCount
            }, (_, i) => postJson(reconBody, `Reconciliation #${i + 1}`)));
            const reconOk = reconResults.filter(x => x.success).length;
            const reconErrors = reconResults.length - reconOk;

            const verify = await postJson({
                action: "sandbox_concurrency_verify",
                idToken,
                paymentIntentId: prep.paymentIntentId,
                providerEventId: prep.providerEventId,
                webhookCount,
                reconciliationCount: reconCount
            }, "Concurrency verify");
            if (!verify.success && verify.overall !== "PASS" && !Array.isArray(verify.checks))
                throw new Error(verify.error || "Concurrency verify tidak mengembalikan hasil JSON yang valid.");
            verified = true;
            const result = verify;
            const detail = (result.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            const traffic = `Concurrent webhook: ${webhookResults.length} · processed=${processed} · idempotent=${idempotent} · rejected=${rejected} · errors=${webhookErrors} · reconciliation queries=${reconResults.length} · successful=${reconOk} · errors=${reconErrors}`;
            const diagnostics = [...webhookResults, ...reconResults].filter(x => !x.success).slice(0, 3).map(x => x.error || "unknown error").join(" | ");
            m.textContent = `Concurrency Test ${result.overall || "FAIL"}: PASS ${result.passCount || 0} · FAIL ${result.failCount || 0}. ${traffic}. ${result.message || result.error || ""} ${diagnostics ? `Diagnostics: ${diagnostics}.` : ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Concurrency Test gagal: " + (e.message || e);
        } finally {
            // If prepare succeeded but verify could not complete, the next test
            // should not inherit a stale sandbox specimen. All concurrent calls
            // above are settled before this cleanup request is sent.
            if (specimen && !verified) {
                try {
                    const cleanupToken = await currentUser.getIdToken(false);
                    const cleanupResponse = await fetch(config.API_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            action: "sandbox_concurrency_cleanup",
                            idToken: cleanupToken,
                            paymentIntentId: specimen.paymentIntentId
                        }),
                        cache: "no-store"
                    });
                    const cleanup = await parseJsonResponseSafe(cleanupResponse, "Concurrency cleanup");
                    if (!cleanup.success) console.warn("Concurrency cleanup warning:", cleanup);
                } catch (cleanupError) {
                    console.warn("Concurrency cleanup failed:", cleanupError);
                }
            }
        }
    },

    async runMismatchConcurrencyTest() {
        const m = document.getElementById("mismatchConcurrencyTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menyiapkan mismatch concurrency specimen SANDBOX...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const prepResponse = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_mismatch_concurrency_prepare",
                    idToken
                })
            });
            const prep = await prepResponse.json();
            if (!prep.success)
                throw new Error(prep.error || "Gagal menyiapkan mismatch concurrency test.");
            const n = Number(prep.requestCountPerCase || 10);
            const base = {
                action: "sandbox_webhook",
                idToken,
                paymentIntentId: prep.paymentIntentId,
                provider: prep.provider,
                providerEventId: prep.providerEventId,
                eventType: prep.eventType,
                providerReference: prep.providerReference,
                payloadHash: "MISMATCH-HASH-2351",
                targetStatus: prep.targetStatus,
                signatureValid: true
            };
            const wrongAmount = {
                ...base,
                amount: prep.wrongAmount,
                currency: prep.currency
            };
            const wrongCurrency = {
                ...base,
                amount: prep.amount,
                currency: prep.wrongCurrency
            };
            const invalidSignature = {
                ...base,
                amount: prep.amount,
                currency: prep.currency,
                signatureValid: false
            };
            m.textContent = `Menjalankan ${n * 3} request mismatch secara bersamaan...`;
            const bodies = [...Array.from({
                length: n
            }, () => wrongAmount), ...Array.from({
                length: n
            }, () => wrongCurrency), ...Array.from({
                length: n
            }, () => invalidSignature)];
            const results = await Promise.all(bodies.map(body => fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify(body)
            }).then(async r => {
                try {
                    return await r.json()
                } catch (e) {
                    return {
                        success: false,
                        error: "Invalid JSON response"
                    }
                }
            }
            )));
            const rejected = results.filter(x => x.rejected || x.success === false).length;
            const verifyResponse = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_mismatch_concurrency_verify",
                    idToken,
                    paymentIntentId: prep.paymentIntentId,
                    providerEventId: prep.providerEventId,
                    requestCount: n
                })
            });
            const result = await verifyResponse.json();
            const detail = (result.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Mismatch Concurrency Test ${result.overall || "FAIL"}: PASS ${result.passCount || 0} · FAIL ${result.failCount || 0}. Concurrent requests: ${results.length} · rejected/error: ${rejected}. ${result.message || result.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Mismatch Concurrency Test gagal: " + e.message
        }
    },
    async runRecoveryReplayTest() {
        const m = document.getElementById("recoveryReplayTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan Recovery & Replay Test SANDBOX...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_recovery_replay_test",
                    idToken
                })
            });
            const x = await r.json();
            const detail = (x.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Recovery & Replay Test ${x.overall || "FAIL"}: PASS ${x.passCount || 0} · FAIL ${x.failCount || 0}. ${x.message || x.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Recovery & Replay Test gagal: " + e.message
        }
    },

    async runReconciliationIntegrityTest() {
        const m = document.getElementById("reconIntegrityMessage");
        const id = document.getElementById("paymentReconciliationIntentId")?.value.trim() || document.getElementById("reconEventId")?.value.trim();
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!id) {
            m.textContent = "Masukkan Payment Intent ID pada panel Payment Reconciliation.";
            return
        }
        m.textContent = "Menjalankan Reconciliation Integrity 23.5.1...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_reconciliation_integrity_test",
                    idToken,
                    paymentIntentId: id
                })
            });
            const x = await r.json();
            const detail = (x.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Reconciliation Integrity ${x.overall || "FAIL"}: PASS ${x.passCount || 0} · FAIL ${x.failCount || 0}. ${x.message || x.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Reconciliation Integrity gagal: " + e.message
        }
    },

    async loadPaymentReconciliationStatus() {
        const m = document.getElementById("paymentReconciliationStatusMessage");
        const id = document.getElementById("paymentReconciliationIntentId")?.value.trim();
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!id) {
            m.textContent = "Masukkan Payment Intent ID.";
            return
        }
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "payment_reconciliation_status",
                    idToken,
                    paymentIntentId: id
                })
            });
            const x = await r.json();
            if (!x.success)
                throw new Error(x.error || "Gagal membaca reconciliation.");
            m.textContent = `Intent ${x.paymentIntentId} · Status ${x.status} · Transaction ${x.transactionCount} · Payment ${x.paymentCount} · Receipt ${x.receiptCount} · Reconciled ${x.reconciled ? "YES" : "NO"}.`;
        } catch (e) {
            console.error(e);
            m.textContent = "Reconciliation status gagal: " + e.message
        }
    },
    async runPaymentReconciliationTest() {
        const m = document.getElementById("paymentReconciliationTestMessage");
        const id = document.getElementById("paymentReconciliationIntentId")?.value.trim();
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!id) {
            m.textContent = "Masukkan Payment Intent ID SUCCESS yang sudah memiliki PAID transaction/payment.";
            return
        }
        m.textContent = "Menjalankan Payment Receipt & Reconciliation Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_payment_reconciliation_test",
                    idToken,
                    paymentIntentId: id
                })
            });
            const x = await r.json();
            const detail = (x.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Payment Receipt & Reconciliation ${x.overall || "FAIL"}: PASS ${x.passCount || 0} · FAIL ${x.failCount || 0}. ${x.message || x.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Payment Receipt & Reconciliation Test gagal: " + e.message
        }
    },
    async loadMerchantContractStatus() {
        const m = document.getElementById("merchantContractStatusMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "merchant_contract_status",
                    idToken
                })
            });
            const x = await r.json();
            if (!x.success)
                throw new Error(x.error || "Gagal membaca merchant contract.");
            m.textContent = `Contract ${x.contractVersion} · ${x.merchantContract} · Purposes ${(x.paymentPurposes || []).join(", ")} · Channels ${(x.channels || []).map(c => c.channel).join(", ")} · Credential exposed: ${x.credentialValuesExposed ? "YES" : "NO"}.`;
        } catch (e) {
            console.error(e);
            m.textContent = "Merchant contract gagal: " + e.message
        }
    },
    async runMerchantUpgradeTest() {
        const m = document.getElementById("merchantUpgradeTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        m.textContent = "Menjalankan Universal Merchant & Upgrade Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_merchant_upgrade_test",
                    idToken,
                    merchantId: "DEMO-TICKETING",
                    applicationId: "DEMO-TICKETING-APP",
                    sourceReference: "TICKET-ECONOMY-001",
                    targetReference: "TICKET-VIP-001",
                    previousAmount: 100000,
                    targetAmount: 250000
                })
            });
            const x = await r.json();
            const detail = (x.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Universal Merchant & Upgrade ${x.overall || "FAIL"}: PASS ${x.passCount || 0} · FAIL ${x.failCount || 0}. ${x.message || x.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Universal Merchant & Upgrade Test gagal: " + e.message
        }
    },
    async loadMerchantRegistryStatus() {
        const m = document.getElementById("merchantRegistryStatusMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "merchant_registry_status",
                    idToken
                })
            });
            const x = await r.json();
            if (!x.success)
                throw new Error(x.error || "Gagal membaca registry.");
            m.textContent = `Registry ${x.registryVersion} · Merchant ${x.merchantCount} · Raw secret returned: ${x.rawSecretsReturned ? "YES" : "NO"} · Credential exposed: ${x.credentialValuesExposed ? "YES" : "NO"}.`;
        } catch (e) {
            console.error(e);
            m.textContent = "Merchant Registry gagal: " + e.message
        }
    },
    async runMerchantRegistryTest() {
        const m = document.getElementById("merchantRegistryTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        m.textContent = "Menjalankan Merchant Registry & API Authentication Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_merchant_registry_test",
                    idToken
                })
            });
            const x = await r.json();
            const detail = (x.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Merchant Registry & API Authentication ${x.overall || "FAIL"}: PASS ${x.passCount || 0} · FAIL ${x.failCount || 0}. ${x.message || x.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Merchant Registry Test gagal: " + e.message
        }
    },
    async runUniversalPaymentApiTest() {
        const m = document.getElementById("universalPaymentApiTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        m.textContent = "Menjalankan Universal Merchant Payment API Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const r = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "universal_payment_api_test",
                    idToken
                })
            });
            const x = await r.json();
            const detail = (x.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
            m.textContent = `Universal Merchant Payment API ${x.overall || "FAIL"}: PASS ${x.passCount || 0} · FAIL ${x.failCount || 0}. ${x.message || x.error || ""} ${detail}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Universal Merchant Payment API Test gagal: " + e.message
        }
    },
    async runProviderAdapterTest() {
        const m = document.getElementById("providerAdapterTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan Provider Adapter Security Test...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_provider_adapter_test",
                    idToken
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Provider Adapter Security Test gagal.");
            const detail = (result.checks || []).map(x => `${x.pass ? "PASS" : "FAIL"}: ${x.name}`).join(" · ");
            m.textContent = `Provider Adapter Security ${result.overall}: PASS ${result.passCount} · FAIL ${result.failCount}. ${result.message} ${detail}`;
            this.invalidateReadCaches(["payment_intents", "tickets"]);
            await this.loadIntents();
            await this.loadTickets();
        } catch (e) {
            console.error(e);
            m.textContent = "Provider Adapter Security Test gagal: " + e.message
        }
    },
    async createWebhookLedger() {
        const m = document.getElementById("webhookMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const provider = document.getElementById("webhookProvider").value.trim()
          , eventType = document.getElementById("webhookEventType").value.trim()
          , reference = document.getElementById("webhookReference").value.trim()
          , payloadHash = document.getElementById("webhookPayloadHash").value.trim();
        if (!provider || !eventType || !reference || !payloadHash) {
            m.textContent = "Semua field webhook wajib diisi.";
            return
        }
        const id = `WH-${Date.now()}`
          , data = {
            webhook_id: id,
            provider,
            event_type: eventType,
            reference,
            payload_hash: payloadHash,
            status: document.getElementById("webhookStatus").value,
            received_at: serverTimestamp(),
            created_by: currentUser.uid
        };
        try {
            await addDoc(collection(db, "webhooks"), data);
            document.getElementById("webhookForm").reset();
            this.invalidateReadCache("webhooks");
            m.textContent = `Webhook ${id} dicatat. Ini belum memvalidasi pembayaran.`;
            await this.loadWebhooks()
        } catch (e) {
            m.textContent = "Gagal mencatat webhook: " + e.message
        }
    },
    async loadWebhooks() {
        const list = document.getElementById("webhookList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("webhooks", () => query(collection(db, "webhooks"), orderBy("received_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada webhook event.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.webhook_id || "-")}</h3><div class="meta">${this.escape(x.provider || "-")} · ${this.escape(x.event_type || "-")} · Ref: ${this.escape(x.reference || "-")}</div></div><span class="status">${this.escape(x.status || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Webhook ledger belum dapat dibaca.</div>'
        }
    },
    async createCheckout() {
        const m = document.getElementById("checkoutMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        const intentId = document.getElementById("checkoutIntentId").value.trim()
          , pmId = document.getElementById("checkoutPaymentMethodId").value.trim()
          , eventId = document.getElementById("checkoutEventId").value.trim();
        if (!intentId || !pmId || !eventId) {
            m.textContent = "Payment Intent ID, Payment Method ID dan Event ID wajib diisi.";
            return
        }
        if (this.checkoutBusy) {
            m.textContent = "Checkout sedang diproses. Tunggu request sebelumnya selesai.";
            return
        }
        const button = document.querySelector("#checkoutForm button[type='submit']");
        this.checkoutBusy = true;
        if (button)
            button.disabled = true;
        m.textContent = "Memvalidasi Checkout melalui trusted backend...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "create_checkout_session",
                    idToken,
                    paymentIntentId: intentId,
                    paymentMethodId: pmId,
                    eventId
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Gagal membuat checkout.");
            document.getElementById("checkoutForm").reset();
            m.textContent = `Checkout ${this.escape(result.checkoutSessionId || "-")} ${result.existing ? "sudah ada" : "siap"}. Status: ${this.escape(result.status || "READY_FOR_PAYMENT")}. ${this.escape(result.message || "")}`;
            const list = document.getElementById("checkoutList");
            if (list && result.checkoutSessionId) {
                const already = Array.from(list.querySelectorAll("h3")).some(x => x.textContent === result.checkoutSessionId);
                if (!already) {
                    const card = `<article class="intent-card"><div><h3>${this.escape(result.checkoutSessionId)}</h3><div class="meta">Intent: ${this.escape(result.paymentIntentId || "-")} · Event: ${this.escape(result.eventId || "-")}</div></div><span class="status">${this.escape(result.status || "-")}</span></article>`;
                    list.insertAdjacentHTML("afterbegin", card);
                }
            }
        } catch (e) {
            console.error(e);
            m.textContent = "Gagal membuat checkout: " + e.message
        } finally {
            this.checkoutBusy = false;
            if (button)
                button.disabled = false
        }
    },
    async loadCheckouts() {
        const list = document.getElementById("checkoutList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("checkout_sessions", () => query(collection(db, "checkout_sessions"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada checkout session.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const x = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(x.checkout_session_id || "-")}</h3><div class="meta">Intent: ${this.escape(x.payment_intent_id || "-")} · Event: ${this.escape(x.event_id || "-")}</div></div><span class="status">${this.escape(x.status || "-")}</span></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Checkout belum dapat dibaca.</div>'
        }
    },
    async runBindingAudit() {
        const m = document.getElementById("bindingAuditMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        const intentId = (document.getElementById("bindingAuditIntentId")?.value || "").trim();
        if (!intentId) {
            m.textContent = "Payment Intent ID wajib diisi.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Memeriksa binding Payment Intent → Transaction → Payment → Ticket...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_binding_audit",
                    idToken,
                    paymentIntentId: intentId
                })
            });
            const result = await response.json();
            if (!result.success && result.overall !== "FAIL")
                throw new Error(result.error || "Binding audit gagal.");
            const details = (result.checks || []).map(c => `${c.pass ? "PASS" : "FAIL"}: ${c.name}`).join(" · ");
            m.textContent = `Binding Audit ${result.overall} · PASS ${result.passCount} · FAIL ${result.failCount}. ${details}`;
        } catch (e) {
            console.error(e);
            m.textContent = "Binding audit gagal: " + e.message
        }
    },
    async runIdempotencyTest() {
        const m = document.getElementById("idempotencyTestMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Menjalankan test idempotency Payment Intent...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_idempotency_test",
                    idToken
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Idempotency test gagal.");
            this.invalidateReadCache("payment_intents");
            m.textContent = `Idempotency ${result.overall}: ${result.message} PI pertama=${result.firstPaymentIntentId} · PI kedua=${result.secondPaymentIntentId}`;
            await this.loadIntents();
        } catch (e) {
            console.error(e);
            m.textContent = "Idempotency test gagal: " + e.message
        }
    },
    async createSandboxOrder() {
        const m = document.getElementById("sandboxOrderMessage");
        if (!auth || !currentUser) {
            m.textContent = "Login admin terlebih dahulu.";
            return
        }
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Membuat Sandbox Order melalui trusted backend...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "sandbox_create_order",
                    idToken,
                    orderId: "ORDER-SBX-001",
                    eventId: "EVENT-002",
                    userId: "TEST-USER-002",
                    amount: 100000
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Gagal membuat Sandbox Order.");
            document.getElementById("intentOrderId").value = result.orderId || "";
            document.getElementById("intentEventId").value = result.eventId || "";
            document.getElementById("intentAmount").value = result.amount || "";
            document.getElementById("sandboxEventId").value = result.eventId || "";
            document.getElementById("sandboxUserId").value = result.userId || "";
            document.getElementById("sandboxAmount").value = result.amount || "";
            m.textContent = `${result.message} Order: ${result.orderId} · ${result.amount} IDR`;
        } catch (e) {
            console.error(e);
            m.textContent = "Sandbox Order gagal: " + e.message
        }
    },
    async createIntent() {
        const m = document.getElementById("intentMessage");
        if (!db || !currentUser) {
            m.textContent = "Login terlebih dahulu.";
            return
        }
        const amount = Number(document.getElementById("intentAmount").value)
          , orderId = document.getElementById("intentOrderId").value.trim()
          , eventId = document.getElementById("intentEventId").value.trim();
        if (!orderId || !eventId || !Number.isSafeInteger(amount) || amount < 1) {
            m.textContent = "Order ID, Event ID dan nominal valid wajib diisi.";
            return
        }
        const nonce = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const channel = document.getElementById("intentChannel").value;
        const clientReference = document.getElementById("intentReference").value.trim();
        if (!config?.API_URL || config.API_URL.startsWith("YOUR_")) {
            m.textContent = "API Apps Script belum dikonfigurasi.";
            return
        }
        m.textContent = "Membuat Payment Intent melalui trusted backend...";
        try {
            const idToken = await currentUser.getIdToken(false);
            const response = await fetch(config.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    action: "create_payment_intent",
                    idToken,
                    orderId,
                    eventId,
                    amount,
                    channel,
                    clientReference,
                    idempotencyKey: nonce
                })
            });
            const result = await response.json();
            if (!result.success)
                throw new Error(result.error || "Gagal membuat Payment Intent.");
            document.getElementById("intentForm").reset();
            if (document.getElementById("bindingAuditIntentId"))
                document.getElementById("bindingAuditIntentId").value = result.paymentIntentId || "";
            if (document.getElementById("webhookSimulationIntentId"))
                document.getElementById("webhookSimulationIntentId").value = result.paymentIntentId || "";
            if (document.getElementById("webhookSimulationAmount"))
                document.getElementById("webhookSimulationAmount").value = result.amount || amount;
            this.invalidateReadCache("payment_intents");
            m.textContent = `Payment Intent ${result.paymentIntentId} ${result.existing ? "sudah ada" : "berhasil dibuat"}. Status: ${result.status}. ${result.message || ""}`;
            await this.loadIntents();
        } catch (e) {
            console.error(e);
            m.textContent = "Gagal membuat intent: " + e.message
        }
    },
    async loadIntents() {
        const list = document.getElementById("intentList");
        if (!db || !list)
            return;
        try {
            const s = await this.cachedGetDocs("payment_intents", () => query(collection(db, "payment_intents"), orderBy("created_at", "desc"), limit(20)));
            if (s.empty) {
                list.innerHTML = '<div class="intent-card">Belum ada payment intent.</div>';
                return
            }
            list.innerHTML = s.docs.map(d => {
                const p = d.data();
                return `<article class="intent-card"><div><h3>${this.escape(p.payment_intent_id || "-")}</h3><div class="meta">Order: ${this.escape(p.order_id || "-")} · Event: ${this.escape(p.event_id || "-")} · ${this.escape(String(p.amount || 0))} IDR</div></div><div><div class="meta">${this.escape(p.channel || "-")}</div><span class="status">${this.escape(p.status || "REQUIRES_PAYMENT")}</span></div></article>`
            }
            ).join("")
        } catch (e) {
            list.innerHTML = '<div class="intent-card">Payment intents belum dapat dibaca. Periksa Rules/index.</div>'
        }
    },
    escape(v) {
        return String(v).replace(/[&<>"']/g, c => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        }[c]))
    }
};

// Expose the singleton for production diagnostics and browser-console health checks.
// The application remains module-scoped internally; this only adds a safe read-only
// reference so diagnostics such as window.BeePay.version work without changing flow.
window.BeePay = BeePay;

document.addEventListener("DOMContentLoaded", () => BeePay.init());
