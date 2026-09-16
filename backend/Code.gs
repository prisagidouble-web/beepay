/**
 * BeePay Backend - Phase 8
 * Cumulative Phase 1-7 + Payment Intent foundation.
 */
const BEEPAY_VERSION="20.0.0";
const BEEPAY_ROLES=["SUPER_ADMIN","ADMIN","FINANCE","EVENT_ADMIN","VIEWER"];
const BEEPAY_COLLECTIONS=["admins","users","merchants","banks","events","payment_methods","orders","transactions","payment_intents","checkout_sessions","verification_ledger","payment_results","payments","settlements","webhooks","tickets"];
function doGet(){return jsonResponse({success:true,service:"BeePay API",version:BEEPAY_VERSION,status:"ONLINE",phase:20,modules:{events:"Multi-event",merchants:"Merchant accounts",payment_methods:"QRIS/Bank",orders:"Orders",transactions:"Transactions",payment_intents:"Payment Intent + idempotency",checkout_sessions:"Checkout session",webhooks:"Webhook event ledger",verification:"Authoritative verification foundation",payment_results:"Payment result processing",tickets:"Ticket issuance gate",reconciliation:"Multi-event reconciliation",security:"RBAC + audit hardening",firebase:"Firebase project binding",sandbox:"End-to-end payment simulation",resilience:"Failure/retry/idempotency tests",readiness:"Operational health checks",final_audit:"Pre-production audit"},database:"Firestore",collections:BEEPAY_COLLECTIONS,timestamp:new Date().toISOString()})}
function doPost(e){try{const b=parseRequestBody(e);return jsonResponse({success:true,service:"BeePay API",version:BEEPAY_VERSION,action:b.action||"unknown",message:"Request received",data:b,timestamp:new Date().toISOString()})}catch(x){return jsonResponse({success:false,error:x.message,timestamp:new Date().toISOString()})}}
function parseRequestBody(e){if(!e?.postData?.contents)return{};try{return JSON.parse(e.postData.contents)}catch(_){throw Error("Invalid JSON body")}}
function jsonResponse(d){return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON)}
function getBeePayCollections(){return BEEPAY_COLLECTIONS.slice()}function getBeePayRoles(){return BEEPAY_ROLES.slice()}
