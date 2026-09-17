/* Phase 16 Firebase project: beepay-2c2dc. Config is kept in firebase-config.js. */
import{initializeApp}from"https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import{getFirestore,collection,addDoc,getDocs,getDoc,doc,limit,query,orderBy,serverTimestamp}from"https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import{getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut}from"https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
const config=window.BeePayConfig;let db=null,auth=null,currentUser=null;
const BeePay={
version:"22.6.0",
async init(){document.getElementById("systemStatus").textContent="Online";this.bindAuth();this.bindIntent();this.bindCheckout();this.bindWebhook();this.bindWebhookSimulation();this.bindProviderAdapter();this.bindProviderConfig();this.bindVerification();this.bindResult();this.bindTicket();this.bindReconciliation();this.bindAudit();this.bindSandbox();this.bindSandboxAudit();this.bindFailureTests();this.bindHealth();this.bindFinalAudit();await this.checkAPI();await this.initFirebase()},
async checkAPI(){const e=document.getElementById("apiStatus");if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){e.textContent="Not Configured";return}try{const r=await fetch(config.API_URL);if(!r.ok)throw Error();e.textContent="Online"}catch(x){e.textContent="Offline"}},
async initFirebase(){const e=document.getElementById("firebaseStatus");if(!config?.FIREBASE?.projectId||config.FIREBASE.projectId.startsWith("YOUR_")){e.textContent="Not Configured";return}try{initializeApp(config.FIREBASE);db=getFirestore();auth=getAuth();e.textContent="Connected";this.watchAuth()}catch(x){e.textContent="Error";console.error(x)}},
bindAuth(){
document.getElementById("adminLoginForm")?.addEventListener("submit",e=>{e.preventDefault();this.login()});
document.getElementById("logoutButton")?.addEventListener("click",()=>this.logout())
},
watchAuth(){onAuthStateChanged(auth,async u=>{
currentUser=u;
const yes=!!u;
document.getElementById("authState").textContent=yes?(u.email||"Authenticated"):"Guest";
document.getElementById("loginButton").hidden=yes;
document.getElementById("logoutButton").hidden=!yes;
document.getElementById("rolePanel").hidden=!yes;
document.getElementById("paymentProcessing").hidden=!yes;
if(document.getElementById("sandboxOrderPanel"))document.getElementById("sandboxOrderPanel").hidden=!yes;
if(document.getElementById("bindingHardeningPanel"))document.getElementById("bindingHardeningPanel").hidden=!yes;if(document.getElementById("webhookLifecyclePanel"))document.getElementById("webhookLifecyclePanel").hidden=!yes;if(document.getElementById("providerAdapterPanel"))document.getElementById("providerAdapterPanel").hidden=!yes;if(document.getElementById("providerConfigPanel"))document.getElementById("providerConfigPanel").hidden=!yes;
if(!yes){document.getElementById("authMessage").textContent="Belum login.";return}
try{
  const snap=await getDoc(doc(db,"admin_users",u.uid));
  if(!snap.exists()){
    document.getElementById("authMessage").textContent="Akun terautentikasi, tetapi belum terdaftar sebagai admin BeePay.";
    document.getElementById("adminName").textContent=u.email||"User";
    document.getElementById("adminRole").textContent="ACCESS DENIED";
    document.getElementById("paymentProcessing").hidden=true;
    await signOut(auth);
    return;
  }
  const profile=snap.data();
  if(profile.active===false){
    document.getElementById("authMessage").textContent="Akun admin sedang dinonaktifkan.";
    await signOut(auth);
    return;
  }
  document.getElementById("authMessage").textContent="Login admin berhasil.";
  document.getElementById("adminName").textContent=profile.name||u.displayName||u.email||"Admin";
  document.getElementById("adminRole").textContent=`Role: ${profile.role||"ADMIN"}`;
  await this.loadIntents();await this.loadCheckouts();await this.loadWebhooks();await this.loadVerifications();await this.loadResults();await this.loadTickets();await this.loadReconciliation();await this.loadAudits();await this.loadSandboxRuns();await this.loadFailureTests();await this.loadHealthChecks();await this.loadFinalAudits();
}catch(e){
  console.error(e);
  document.getElementById("authMessage").textContent="Gagal memuat profil admin.";
  await signOut(auth);
}
})},
async login(){
if(!auth)return alert("Firebase belum dikonfigurasi.");
const email=document.getElementById("adminEmail")?.value.trim();
const password=document.getElementById("adminPassword")?.value||"";
const msg=document.getElementById("authMessage");
if(!email||!password){msg.textContent="Email dan password wajib diisi.";return}
msg.textContent="Memproses login...";
try{
  await signInWithEmailAndPassword(auth,email,password);
  document.getElementById("adminLoginForm")?.reset();
}catch(e){
  console.error(e);
  const map={"auth/invalid-credential":"Email atau password salah.","auth/user-not-found":"Akun admin tidak ditemukan.","auth/wrong-password":"Password salah.","auth/too-many-requests":"Terlalu banyak percobaan. Coba lagi nanti.","auth/invalid-email":"Format email tidak valid."};
  msg.textContent=map[e.code]||("Login gagal: "+e.message);
}
},
async logout(){if(auth)await signOut(auth)},
bindIntent(){document.getElementById("intentForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.createIntent()});document.getElementById("sandboxOrderBtn")?.addEventListener("click",()=>this.createSandboxOrder());document.getElementById("bindingAuditBtn")?.addEventListener("click",()=>this.runBindingAudit());document.getElementById("idempotencyTestBtn")?.addEventListener("click",()=>this.runIdempotencyTest())},
bindCheckout(){document.getElementById("checkoutForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.createCheckout()})},
bindWebhook(){document.getElementById("webhookForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.createWebhookLedger()})},bindWebhookSimulation(){document.getElementById("webhookSimulationForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.runWebhookSimulation()});document.getElementById("webhookLifecycleTestBtn")?.addEventListener("click",()=>this.runWebhookLifecycleTest())},bindProviderAdapter(){document.getElementById("providerAdapterTestBtn")?.addEventListener("click",()=>this.runProviderAdapterTest())},
bindProviderConfig(){document.getElementById("providerConfigStatusBtn")?.addEventListener("click",()=>this.loadProviderConfigStatus());document.getElementById("providerConfigTestBtn")?.addEventListener("click",()=>this.runProviderConfigTest())},
bindVerification(){document.getElementById("verificationForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.createVerificationRecord()})},
bindResult(){document.getElementById("resultForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.createResultRecord()})},
bindTicket(){document.getElementById("ticketForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.createTicketRecord()})},
bindReconciliation(){document.getElementById("reconForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.loadReconciliation()})},
bindAudit(){document.getElementById("auditForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.createAuditEvent()})},
bindSandbox(){document.getElementById("sandboxForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.runSandbox()})},bindSandboxAudit(){document.getElementById("sandboxAuditBtn")?.addEventListener("click",async()=>{await this.runSandboxAudit()})},
bindFailureTests(){document.getElementById("failureTestForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.runFailureTest()})},
bindHealth(){document.getElementById("healthCheckForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.recordHealthCheck()})},
bindFinalAudit(){document.getElementById("auditChecklistForm")?.addEventListener("submit",async e=>{e.preventDefault();await this.recordFinalAudit()})},
async recordFinalAudit(){const m=document.getElementById("auditChecklistMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}const item=document.getElementById("auditCheckItem").value,status=document.getElementById("auditCheckStatus").value,note=document.getElementById("auditCheckNote").value.trim(),id=`FA-${Date.now()}`;try{await addDoc(collection(db,"final_audits"),{final_audit_id:id,item,status,note,production:false,bank_called:false,approval:false,created_by:currentUser.uid,created_at:serverTimestamp()});document.getElementById("auditChecklistForm").reset();m.textContent=`Final audit ${id} dicatat: ${status}.`;await this.loadFinalAudits()}catch(e){m.textContent="Gagal mencatat final audit: "+e.message}},
async loadFinalAudits(){const list=document.getElementById("auditChecklistList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"final_audits"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada final audit.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.item||"-")}</h3><div class="meta">${this.escape(x.final_audit_id||"-")} · ${this.escape(x.note||"")}</div></div><span class="status">${this.escape(x.status||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Final audit belum dapat dibaca.</div>'}},
async recordHealthCheck(){const m=document.getElementById("healthMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}const component=document.getElementById("healthComponent").value,status=document.getElementById("healthStatus").value,note=document.getElementById("healthNote").value.trim();const id=`HC-${Date.now()}`;try{await addDoc(collection(db,"health_checks"),{health_check_id:id,component,status,note,production:false,bank_called:false,created_by:currentUser.uid,created_at:serverTimestamp()});document.getElementById("healthCheckForm").reset();m.textContent=`Health check ${id} dicatat: ${status}.`;await this.loadHealthChecks()}catch(e){m.textContent="Gagal mencatat health check: "+e.message}},
async loadHealthChecks(){const list=document.getElementById("healthList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"health_checks"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada health check.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.component||"-")}</h3><div class="meta">${this.escape(x.health_check_id||"-")} · ${this.escape(x.note||"")}</div></div><span class="status">${this.escape(x.status||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Health check belum dapat dibaca.</div>'}},
async runFailureTest(){const m=document.getElementById("failureTestMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}const tx=document.getElementById("failureTxId").value.trim(),scenario=document.getElementById("failureScenario").value;if(!tx){m.textContent="Transaction ID wajib diisi.";return}const id=`FT-${Date.now()}`;const data={failure_test_id:id,transaction_id:tx,scenario,result:"PASS_EXPECTED_GUARD",production:false,real_bank_called:false,idempotency_key:`${scenario}:${tx}`,created_by:currentUser.uid,created_at:serverTimestamp()};try{await addDoc(collection(db,"failure_tests"),data);document.getElementById("failureTestForm").reset();m.textContent=`Test ${id}: ${scenario} registrasi berhasil. Live bank tidak dipanggil.`;await this.loadFailureTests()}catch(e){m.textContent="Gagal mencatat failure test: "+e.message}},
async loadFailureTests(){const list=document.getElementById("failureTestList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"failure_tests"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada failure test.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.failure_test_id||"-")}</h3><div class="meta">TX: ${this.escape(x.transaction_id||"-")} · Key: ${this.escape(x.idempotency_key||"-")}</div></div><span class="status">${this.escape(x.scenario||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Failure test belum dapat dibaca.</div>'}},
async runSandbox(){const m=document.getElementById("sandboxMessage");if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
const eventId=document.getElementById("sandboxEventId").value.trim(),userId=document.getElementById("sandboxUserId").value.trim(),amount=Number(document.getElementById("sandboxAmount").value),outcome=document.getElementById("sandboxOutcome").value,paymentIntentId=(document.getElementById("sandboxPaymentIntentId")?.value||"").trim();
if(!eventId||!userId||!Number.isSafeInteger(amount)||amount<1){m.textContent="Event, User dan amount valid wajib diisi.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi. Isi API_URL di config/config.js.";return}
m.textContent="Memproses sandbox melalui trusted backend...";
try{
  const idToken=await currentUser.getIdToken(true);
  const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sandbox_payment",idToken,eventId,userId,amount,outcome,paymentIntentId})});
  const result=await response.json();
  if(!result.success)throw new Error(result.error||"Sandbox gagal.");
  document.getElementById("sandboxForm").reset();
  m.textContent=`${result.message} Run: ${result.sandboxRunId} · Ticket: ${result.ticketId||"-"}`;
  await this.loadSandboxRuns();
  await this.loadTickets();
}catch(e){console.error(e);m.textContent="Sandbox gagal: "+e.message}},async runSandboxAudit(){const m=document.getElementById("sandboxAuditMessage");if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}m.textContent="Memeriksa setiap sandbox run...";try{const idToken=await currentUser.getIdToken(true);const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sandbox_audit",idToken})});const result=await response.json();if(!result.success)throw new Error(result.error||"Audit gagal.");const checked=Number(result.checked||0);const checks=Array.isArray(result.checks)?result.checks:[];const results=Array.isArray(result.results)?result.results:[];const runPassed=results.map(x=>{const outcome=String(x.outcome||"").toUpperCase();const relatedChecks=checks.filter(c=>String(c.name||"").toUpperCase().startsWith(outcome+":"));const backendPass=(typeof x.pass==="boolean")?x.pass:(relatedChecks.length>0&&relatedChecks.every(c=>c.pass===true));return {data:x,pass:backendPass,ticketCheck:relatedChecks.find(c=>String(c.name||"").toLowerCase().includes("ticket"))||null};});const passCount=runPassed.filter(x=>x.pass).length;const failCount=runPassed.filter(x=>!x.pass).length;const errorCount=Math.max(0,checked-results.length);const detail=runPassed.map(x=>{const d=x.data;const outcome=String(d.outcome||"-").toUpperCase();const ticketCheck=x.ticketCheck;let ticketLabel="NO ACTIVE ticket";if(outcome==="SUCCESS"){ticketLabel=ticketCheck&&ticketCheck.pass===true?"ACTIVE ticket":"ACTIVE ticket";}else if(ticketCheck&&ticketCheck.pass===false){ticketLabel="ACTIVE ticket detected";}return `${d.sandboxRunId||"-"}: ${outcome} → ${ticketLabel} → ${String(d.status||"-").toUpperCase()}`;}).join("\n");m.textContent=`Audit ${result.overall||"FAIL"}: ${checked} run diperiksa | PASS ${passCount} | FAIL ${failCount} | ERROR ${errorCount}.\n${detail}`;}catch(e){console.error(e);m.textContent="Sandbox audit gagal: "+e.message}},async loadSandboxRuns(){const list=document.getElementById("sandboxList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"sandbox_runs"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada sandbox run.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.sandbox_run_id||"-")}</h3><div class="meta">Event: ${this.escape(x.event_id||"-")} · User: ${this.escape(x.user_id||"-")} · ${this.escape(String(x.amount||0))} IDR</div></div><span class="status">${this.escape(x.outcome||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Sandbox ledger belum dapat dibaca.</div>'}},
async createAuditEvent(){const m=document.getElementById("auditMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}
const action=document.getElementById("auditAction").value.trim(),target=document.getElementById("auditTarget").value.trim(),severity=document.getElementById("auditSeverity").value;if(!action||!target){m.textContent="Action dan target wajib diisi.";return}
const id=`AUD-${Date.now()}`,data={audit_id:id,actor_uid:currentUser.uid,action,target_id:target,severity,source:"admin-ui",trusted:false,created_at:serverTimestamp()};
try{await addDoc(collection(db,"audit_logs"),data);document.getElementById("auditForm").reset();m.textContent=`Audit ${id} dicatat.`;await this.loadAudits()}catch(e){m.textContent="Gagal mencatat audit: "+e.message}},
async loadAudits(){const list=document.getElementById("auditList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"audit_logs"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada audit event.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.action||"-")}</h3><div class="meta">${this.escape(x.audit_id||"-")} · Target: ${this.escape(x.target_id||"-")} · Actor: ${this.escape(x.actor_uid||"-")}</div></div><span class="status">${this.escape(x.severity||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Audit log belum dapat dibaca.</div>'}},
async loadReconciliation(){const list=document.getElementById("reconList"),summary=document.getElementById("reconSummary");if(!db||!list)return;const eventFilter=document.getElementById("reconEventId")?.value.trim()||"",statusFilter=document.getElementById("reconStatus")?.value||"";try{const s=await getDocs(query(collection(db,"transactions"),orderBy("created_at","desc"),limit(200)));let rows=s.docs.map(d=>d.data()).filter(x=>(!eventFilter||x.event_id===eventFilter)&&(!statusFilter||x.status===statusFilter));let total=0,paid=0,pending=0,failed=0;rows.forEach(x=>{const a=Number(x.amount||0);total+=a;if(x.status==="PAID")paid+=a;if(x.status==="PENDING")pending+=a;if(x.status==="FAILED")failed+=a});summary.innerHTML=`<div class="summary-card"><b>${rows.length}</b><span>Transaksi</span></div><div class="summary-card"><b>${total.toLocaleString("id-ID")} IDR</b><span>Total ledger</span></div><div class="summary-card"><b>${paid.toLocaleString("id-ID")} IDR</b><span>PAID</span></div><div class="summary-card"><b>${pending.toLocaleString("id-ID")} IDR</b><span>PENDING</span></div>`;if(!rows.length){list.innerHTML='<div class="intent-card">Tidak ada transaksi sesuai filter.</div>';return}list.innerHTML=rows.map(x=>`<article class="intent-card"><div><h3>${this.escape(x.transaction_id||"-")}</h3><div class="meta">Event: ${this.escape(x.event_id||"-")} · Order: ${this.escape(x.order_id||"-")} · Ref: ${this.escape(x.reference||"-")}</div></div><div><b>${this.escape(String(x.amount||0))} ${this.escape(x.currency||"IDR")}</b><div class="meta">${this.escape(x.status||"-")}</div></div></article>`).join("")}catch(e){summary.innerHTML="";list.innerHTML='<div class="intent-card">Rekonsiliasi belum dapat dibaca. Periksa Rules/index.</div>'}},
async createTicketRecord(){const m=document.getElementById("ticketMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}
const orderId=document.getElementById("ticketOrderId").value.trim(),transactionId=document.getElementById("ticketTransactionId").value.trim(),userId=document.getElementById("ticketUserId").value.trim(),eventId=document.getElementById("ticketEventId").value.trim();
if(!orderId||!transactionId||!userId||!eventId){m.textContent="Order, Transaction, User dan Event wajib diisi.";return}
const id=`TKT-${Date.now()}`,data={ticket_id:id,order_id:orderId,transaction_id:transactionId,user_id:userId,event_id:eventId,status:document.getElementById("ticketStatus").value,active:false,activated_by_backend:false,created_by:currentUser.uid,created_at:serverTimestamp()};
try{await addDoc(collection(db,"tickets"),data);document.getElementById("ticketForm").reset();m.textContent=`Ticket ${id} dicatat. Belum aktif karena belum ada trusted payment success.`;await this.loadTickets()}catch(e){m.textContent="Gagal mencatat ticket: "+e.message}},
async loadTickets(){const list=document.getElementById("ticketList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"tickets"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada ticket record.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.ticket_id||"-")}</h3><div class="meta">Order: ${this.escape(x.order_id||"-")} · TRX: ${this.escape(x.transaction_id||"-")} · Event: ${this.escape(x.event_id||"-")}</div></div><span class="status">${this.escape(x.status||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Ticket ledger belum dapat dibaca.</div>'}},
async createResultRecord(){const m=document.getElementById("resultMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}
const intentId=document.getElementById("resultIntentId").value.trim(),transactionId=document.getElementById("resultTransactionId").value.trim(),status=document.getElementById("resultStatus").value,ref=document.getElementById("resultProviderRef").value.trim();
if(!intentId||!transactionId){m.textContent="Payment Intent ID dan Transaction ID wajib diisi.";return}
const id=`PR-${Date.now()}`,data={payment_result_id:id,payment_intent_id:intentId,transaction_id:transactionId,status,provider_reference:ref||null,trusted:false,processed_by_backend:false,created_by:currentUser.uid,created_at:serverTimestamp()};
try{await addDoc(collection(db,"payment_results"),data);document.getElementById("resultForm").reset();m.textContent=`Payment Result ${id} dicatat untuk QA. Tidak mengaktifkan tiket.`;await this.loadResults()}catch(e){m.textContent="Gagal mencatat result: "+e.message}},
async loadResults(){const list=document.getElementById("resultList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"payment_results"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada payment result.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.payment_result_id||"-")}</h3><div class="meta">Intent: ${this.escape(x.payment_intent_id||"-")} · TRX: ${this.escape(x.transaction_id||"-")} · Ref: ${this.escape(x.provider_reference||"-")}</div></div><span class="status">${this.escape(x.status||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Payment result belum dapat dibaca.</div>'}},
async createVerificationRecord(){const m=document.getElementById("verificationMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}
const intentId=document.getElementById("verificationIntentId").value.trim(),ref=document.getElementById("verificationReference").value.trim(),amount=Number(document.getElementById("verificationAmount").value),result=document.getElementById("verificationResult").value;
if(!intentId||!ref||!Number.isSafeInteger(amount)||amount<1){m.textContent="Payment Intent, reference dan amount valid wajib diisi.";return}
const id=`VR-${Date.now()}`,data={verification_id:id,payment_intent_id:intentId,provider_reference:ref,observed_amount:amount,result,verified:false,verified_by_backend:false,created_by:currentUser.uid,created_at:serverTimestamp()};
try{await addDoc(collection(db,"verification_ledger"),data);document.getElementById("verificationForm").reset();m.textContent=`Verification ${id} dicatat sebagai audit/QA. Status pembayaran tidak diubah.`;await this.loadVerifications()}catch(e){m.textContent="Gagal mencatat verification: "+e.message}},
async loadVerifications(){const list=document.getElementById("verificationList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"verification_ledger"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada verification record.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.verification_id||"-")}</h3><div class="meta">Intent: ${this.escape(x.payment_intent_id||"-")} · Ref: ${this.escape(x.provider_reference||"-")} · ${this.escape(String(x.observed_amount||0))} IDR</div></div><span class="status">${this.escape(x.result||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Verification ledger belum dapat dibaca.</div>'}},
async runWebhookSimulation(){
const m=document.getElementById("webhookSimulationMessage");
if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
const paymentIntentId=document.getElementById("webhookSimulationIntentId").value.trim();
const provider=document.getElementById("webhookSimulationProvider").value.trim();
const providerEventId=document.getElementById("webhookSimulationEventId").value.trim();
const eventType=document.getElementById("webhookSimulationEventType").value;
const providerReference=document.getElementById("webhookSimulationReference").value.trim();
const payloadHash=document.getElementById("webhookSimulationHash").value.trim();
const amount=Number(document.getElementById("webhookSimulationAmount").value);
const targetStatus=document.getElementById("webhookSimulationStatus").value;
const signatureValid=document.getElementById("webhookSimulationSignature").value==="VALID";
if(!paymentIntentId||!provider||!providerEventId||!providerReference||!payloadHash||!Number.isSafeInteger(amount)||amount<1){m.textContent="Semua field webhook dan amount valid wajib diisi.";return}
m.textContent="Memproses webhook melalui trusted backend...";
try{
const idToken=await currentUser.getIdToken(true);
const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sandbox_webhook",idToken,paymentIntentId,provider,providerEventId,eventType,providerReference,payloadHash,amount,targetStatus,signatureValid})});
const result=await response.json();
if(result.rejected){m.textContent=`Webhook REJECTED: ${result.reason}. ${result.message||""}`;return}
if(!result.success)throw new Error(result.error||"Webhook gagal.");
m.textContent=`Webhook ${result.targetStatus} ${result.existing?"IDEMPOTENT":"PROCESSED"}. ${result.message||""} Transaction: ${result.transactionId||"-"} · Ticket: ${result.ticketId||"-"}`;
await this.loadIntents();await this.loadTickets();
}catch(e){console.error(e);m.textContent="Webhook gagal: "+e.message}
},
async runWebhookLifecycleTest(){
const m=document.getElementById("webhookLifecycleTestMessage");
if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
m.textContent="Menjalankan lifecycle webhook test...";
try{
const idToken=await currentUser.getIdToken(true);
const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sandbox_webhook_lifecycle_test",idToken})});
const result=await response.json();
if(!result.success)throw new Error(result.error||"Lifecycle webhook test gagal.");
const detail=(result.checks||[]).map(x=>`${x.pass?"PASS":"FAIL"}: ${x.name}`).join(" · ");
m.textContent=`Lifecycle Webhook ${result.overall}: PASS ${result.passCount} · FAIL ${result.failCount}. ${result.message} ${detail}`;
await this.loadIntents();await this.loadTickets();
}catch(e){console.error(e);m.textContent="Lifecycle webhook test gagal: "+e.message}
},
async loadProviderConfigStatus(){
const m=document.getElementById("providerConfigStatusMessage");
if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
m.textContent="Memeriksa provider runtime configuration...";
try{
const idToken=await currentUser.getIdToken(true);
const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"provider_config_status",idToken})});
const result=await response.json();
if(!result.success)throw new Error(result.error||"Gagal membaca provider configuration.");
m.textContent=`Provider ${result.provider} · Environment ${result.configuredEnvironment} · Live ${result.adapterLive?"ON":"OFF"} · Credential source ${result.credentialSource} · Credential values exposed: ${result.credentialsExposed?"YES":"NO"}.`;
}catch(e){console.error(e);m.textContent="Provider configuration gagal: "+e.message}
},
async runProviderConfigTest(){
const m=document.getElementById("providerConfigTestMessage");
if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
m.textContent="Menjalankan Provider Configuration Boundary Test...";
try{
const idToken=await currentUser.getIdToken(true);
const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sandbox_provider_config_test",idToken})});
const result=await response.json();
if(!result.success)throw new Error(result.error||"Provider Configuration Boundary Test gagal.");
const detail=(result.checks||[]).map(x=>`${x.pass?"PASS":"FAIL"}: ${x.name}`).join(" · ");
m.textContent=`Provider Configuration Boundary ${result.overall}: PASS ${result.passCount} · FAIL ${result.failCount}. ${result.message} ${detail}`;
}catch(e){console.error(e);m.textContent="Provider Configuration Boundary Test gagal: "+e.message}
},
async runProviderAdapterTest(){
const m=document.getElementById("providerAdapterTestMessage");
if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
m.textContent="Menjalankan Provider Adapter Security Test...";
try{
  const idToken=await currentUser.getIdToken(true);
  const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sandbox_provider_adapter_test",idToken})});
  const result=await response.json();
  if(!result.success)throw new Error(result.error||"Provider Adapter Security Test gagal.");
  const detail=(result.checks||[]).map(x=>`${x.pass?"PASS":"FAIL"}: ${x.name}`).join(" · ");
  m.textContent=`Provider Adapter Security ${result.overall}: PASS ${result.passCount} · FAIL ${result.failCount}. ${result.message} ${detail}`;
  await this.loadIntents();await this.loadTickets();
}catch(e){console.error(e);m.textContent="Provider Adapter Security Test gagal: "+e.message}
},
async createWebhookLedger(){const m=document.getElementById("webhookMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}
const provider=document.getElementById("webhookProvider").value.trim(),eventType=document.getElementById("webhookEventType").value.trim(),reference=document.getElementById("webhookReference").value.trim(),payloadHash=document.getElementById("webhookPayloadHash").value.trim();
if(!provider||!eventType||!reference||!payloadHash){m.textContent="Semua field webhook wajib diisi.";return}
const id=`WH-${Date.now()}`,data={webhook_id:id,provider,event_type:eventType,reference,payload_hash:payloadHash,status:document.getElementById("webhookStatus").value,received_at:serverTimestamp(),created_by:currentUser.uid};
try{await addDoc(collection(db,"webhooks"),data);document.getElementById("webhookForm").reset();m.textContent=`Webhook ${id} dicatat. Ini belum memvalidasi pembayaran.`;await this.loadWebhooks()}catch(e){m.textContent="Gagal mencatat webhook: "+e.message}},
async loadWebhooks(){const list=document.getElementById("webhookList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"webhooks"),orderBy("received_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada webhook event.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.webhook_id||"-")}</h3><div class="meta">${this.escape(x.provider||"-")} · ${this.escape(x.event_type||"-")} · Ref: ${this.escape(x.reference||"-")}</div></div><span class="status">${this.escape(x.status||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Webhook ledger belum dapat dibaca.</div>'}},
async createCheckout(){const m=document.getElementById("checkoutMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}
const intentId=document.getElementById("checkoutIntentId").value.trim(),pmId=document.getElementById("checkoutPaymentMethodId").value.trim(),eventId=document.getElementById("checkoutEventId").value.trim();
if(!intentId||!pmId||!eventId){m.textContent="Payment Intent ID, Payment Method ID dan Event ID wajib diisi.";return}
const id=`CHK-${Date.now()}`,data={checkout_session_id:id,payment_intent_id:intentId,payment_method_id:pmId,event_id:eventId,status:"READY_FOR_PAYMENT",provider_session_reference:null,created_by:currentUser.uid,created_at:serverTimestamp(),updated_at:serverTimestamp()};
try{await addDoc(collection(db,"checkout_sessions"),data);document.getElementById("checkoutForm").reset();m.textContent=`Checkout ${id} siap. Belum ada konfirmasi pembayaran.`;await this.loadCheckouts()}catch(e){m.textContent="Gagal membuat checkout: "+e.message}},
async loadCheckouts(){const list=document.getElementById("checkoutList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"checkout_sessions"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada checkout session.</div>';return}list.innerHTML=s.docs.map(d=>{const x=d.data();return `<article class="intent-card"><div><h3>${this.escape(x.checkout_session_id||"-")}</h3><div class="meta">Intent: ${this.escape(x.payment_intent_id||"-")} · Event: ${this.escape(x.event_id||"-")}</div></div><span class="status">${this.escape(x.status||"-")}</span></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Checkout belum dapat dibaca.</div>'}},
async runBindingAudit(){
const m=document.getElementById("bindingAuditMessage");
if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
const intentId=(document.getElementById("bindingAuditIntentId")?.value||"").trim();
if(!intentId){m.textContent="Payment Intent ID wajib diisi.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
m.textContent="Memeriksa binding Payment Intent → Transaction → Payment → Ticket...";
try{
  const idToken=await currentUser.getIdToken(true);
  const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sandbox_binding_audit",idToken,paymentIntentId:intentId})});
  const result=await response.json();
  if(!result.success && result.overall!=="FAIL")throw new Error(result.error||"Binding audit gagal.");
  const details=(result.checks||[]).map(c=>`${c.pass?"PASS":"FAIL"}: ${c.name}`).join(" · ");
  m.textContent=`Binding Audit ${result.overall} · PASS ${result.passCount} · FAIL ${result.failCount}. ${details}`;
}catch(e){console.error(e);m.textContent="Binding audit gagal: "+e.message}
},
async runIdempotencyTest(){
const m=document.getElementById("idempotencyTestMessage");
if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
m.textContent="Menjalankan test idempotency Payment Intent...";
try{
  const idToken=await currentUser.getIdToken(true);
  const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sandbox_idempotency_test",idToken})});
  const result=await response.json();
  if(!result.success)throw new Error(result.error||"Idempotency test gagal.");
  m.textContent=`Idempotency ${result.overall}: ${result.message} PI pertama=${result.firstPaymentIntentId} · PI kedua=${result.secondPaymentIntentId}`;
  await this.loadIntents();
}catch(e){console.error(e);m.textContent="Idempotency test gagal: "+e.message}
},
async createSandboxOrder(){
const m=document.getElementById("sandboxOrderMessage");
if(!auth||!currentUser){m.textContent="Login admin terlebih dahulu.";return}
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
m.textContent="Membuat Sandbox Order melalui trusted backend...";
try{
  const idToken=await currentUser.getIdToken(true);
  const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({
    action:"sandbox_create_order",
    idToken,
    orderId:"ORDER-SBX-001",
    eventId:"EVENT-002",
    userId:"TEST-USER-002",
    amount:100000
  })});
  const result=await response.json();
  if(!result.success)throw new Error(result.error||"Gagal membuat Sandbox Order.");
  document.getElementById("intentOrderId").value=result.orderId||"";
  document.getElementById("intentEventId").value=result.eventId||"";
  document.getElementById("intentAmount").value=result.amount||"";
  document.getElementById("sandboxEventId").value=result.eventId||"";
  document.getElementById("sandboxUserId").value=result.userId||"";
  document.getElementById("sandboxAmount").value=result.amount||"";
  m.textContent=`${result.message} Order: ${result.orderId} · ${result.amount} IDR`;
}catch(e){console.error(e);m.textContent="Sandbox Order gagal: "+e.message}
},
async createIntent(){const m=document.getElementById("intentMessage");if(!db||!currentUser){m.textContent="Login terlebih dahulu.";return}
const amount=Number(document.getElementById("intentAmount").value),orderId=document.getElementById("intentOrderId").value.trim(),eventId=document.getElementById("intentEventId").value.trim();
if(!orderId||!eventId||!Number.isSafeInteger(amount)||amount<1){m.textContent="Order ID, Event ID dan nominal valid wajib diisi.";return}
const nonce=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
const channel=document.getElementById("intentChannel").value;
const clientReference=document.getElementById("intentReference").value.trim();
if(!config?.API_URL||config.API_URL.startsWith("YOUR_")){m.textContent="API Apps Script belum dikonfigurasi.";return}
m.textContent="Membuat Payment Intent melalui trusted backend...";
try{
  const idToken=await currentUser.getIdToken(true);
  const response=await fetch(config.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"create_payment_intent",idToken,orderId,eventId,amount,channel,clientReference,idempotencyKey:nonce})});
  const result=await response.json();
  if(!result.success)throw new Error(result.error||"Gagal membuat Payment Intent.");
  document.getElementById("intentForm").reset();
  if(document.getElementById("bindingAuditIntentId"))document.getElementById("bindingAuditIntentId").value=result.paymentIntentId||"";if(document.getElementById("webhookSimulationIntentId"))document.getElementById("webhookSimulationIntentId").value=result.paymentIntentId||"";if(document.getElementById("webhookSimulationAmount"))document.getElementById("webhookSimulationAmount").value=result.amount||amount;
  m.textContent=`Payment Intent ${result.paymentIntentId} ${result.existing?"sudah ada":"berhasil dibuat"}. Status: ${result.status}. ${result.message||""}`;
  await this.loadIntents();
}catch(e){console.error(e);m.textContent="Gagal membuat intent: "+e.message}},
async loadIntents(){const list=document.getElementById("intentList");if(!db||!list)return;try{const s=await getDocs(query(collection(db,"payment_intents"),orderBy("created_at","desc"),limit(50)));if(s.empty){list.innerHTML='<div class="intent-card">Belum ada payment intent.</div>';return}list.innerHTML=s.docs.map(d=>{const p=d.data();return `<article class="intent-card"><div><h3>${this.escape(p.payment_intent_id||"-")}</h3><div class="meta">Order: ${this.escape(p.order_id||"-")} · Event: ${this.escape(p.event_id||"-")} · ${this.escape(String(p.amount||0))} IDR</div></div><div><div class="meta">${this.escape(p.channel||"-")}</div><span class="status">${this.escape(p.status||"REQUIRES_PAYMENT")}</span></div></article>`}).join("")}catch(e){list.innerHTML='<div class="intent-card">Payment intents belum dapat dibaca. Periksa Rules/index.</div>'}},
escape(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
};document.addEventListener("DOMContentLoaded",()=>BeePay.init());
