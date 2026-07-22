// BOB Stock — Azure Function: ROW-LEVEL ECONOMIC ATTESTATION (OS-W4.4 Contract 1, staging-apply).
// Spec: AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md (Contract 1) + AZURE-CHUNK-ORG-W44-C1-DESIGN.md
// (concrete design; R1 spec-review fold 2026-07-22). Closes the banked W4.4 root cause: ledger rows
// are client-editable (device or SharePoint-direct); the settlement engine holds every row it cannot
// verify (MANUAL_REVIEW_UNVERIFIABLE_QTY). This route lets the SERVER stamp each row's ECONOMIC
// IDENTITY with a tamper-evident HMAC at push-v2 ingest, so a later edit of any covered field is
// detectable and honest rows can auto-FINAL.
//
// Covered fields (canonical order — the row's full economic identity):
//   TransactionId, StoreId, Date, Timestamp, ProductId, Type, Qty, Reason, TransferId,
//   IdempotencyKey, StockFromStoreId, StockToStoreId, StockFrom, StockTo, TargetTransactionId,
//   SellAtSupply, DiscAtSupply, PricingVersion, CatalogueVersion
// Coverage rationale (D-C1-1 extensions + the R1 spec-review fold — see the design doc §1):
//   - Date/Timestamp/StoreId: window membership, as-of rate, settlement owner for direct-log rows.
//   - StockFrom/StockTo labels: the actual sale-vs-wastage classifier inputs (W4-SR-58).
//   - Reason (R1 CONVERGED finding, AGY-2/Codex-1): the engine's LAST-RESORT HO-source classifier for a
//     direct-log row with blank structured source fields is a text match on Reason
//     (buybackExport.js isHOSupply) — editable under the seal = classification flips. Now covered.
//   - SellAtSupply/DiscAtSupply/PricingVersion/CatalogueVersion (R1 AGY-1 splice): the pricing
//     authority tuple must be CRYPTOGRAPHICALLY BOUND to the row identity or a SharePoint-direct
//     writer can transplant a validated tuple from another row under a still-valid seal. The seal now
//     IS the row-level binding; the SR-155 semantic validation (values recomputed against history)
//     gates SIGNING at ingest, and for ROWS the planned plain `_attested` marker column is SUBSUMED by
//     a valid EconSig (a plain marker is forgeable by the same threat actor anyway).
//   - TargetTransactionId: a tombstone is a CONTROL; an edited target redirects the deletion.
//   Deliberately NOT covered: UnitPriceAtTime (D-C1-3 — informational retailProfit only, never the
//   payable), StaffName/DeviceId (non-economic). Archive-only SourceId is server-set at archive-move
//   and outside an ingest seal; a sealed row claiming pre-epoch provenance is a CONTRADICTION the
//   engine can fail closed on (seal presence proves post-contract ingest) — design doc §1.
//
//   POST { op:'sign',   rows:[{...covered fields...}, ...] }
//     -> 200 { sigs: [{ TransactionId, EconSig }, ...] }        (aligned to input order)
//   POST { op:'verify', rows:[{...covered fields..., EconSig}, ...] }
//     -> 200 { results: [{ TransactionId, ok:boolean }, ...] }  (booleans only; no oracle detail)
//   -> 400 malformed; 500 keyring not configured.
// FAIL-CLOSED CONTRACT (opposite of validateMoney's fail-open, same as validateKeys): the calling
// Logic App treats ANY non-200 — or unreachable — as NOT SIGNED and returns the batch as RETRYABLE
// (devices already queue + retry; TransactionId/IdempotencyKey dedup absorbs the replay). Rows must
// never land unsigned. The LA calls op:'sign' ONCE per batch (R1 Q2 adjudication: batch + index zip,
// with a per-row TransactionId cross-check before insert).
//
// Signature: 'v1:<kid>:' + HMAC-SHA-256(pepper[kid], JSON.stringify(['econ-v1', ...field values in
// canonical order])), hex. JSON framing (not a join) — unambiguous field boundaries, see canonical().
// KEY RING (R1 Q3 fold, both auditors): <kid> names the pepper that minted the seal. Signing always
// uses the ACTIVE kid (setting BOB_ROW_ATTEST_ACTIVE, e.g. 'k1'); verification honours any kid whose
// pepper is still configured (setting BOB_ROW_ATTEST_PEPPER_<KID>, uppercased). Rotation = add the new
// pepper setting + flip ACTIVE; old seals keep verifying; removing a retired pepper invalidates its
// seals (fail closed). A full Director re-sign run is reserved for active-compromise only.
// Peppers live ONLY in Function App settings — never SharePoint / client / repo; SEPARATE from
// BOB_AUTH_PEPPER (key separation). authLevel 'function' — no anonymous oracle.

const { app } = require('@azure/functions');
const crypto = require('crypto');

const MAX_ROWS = 5000; // the client pushes its WHOLE unsynced backlog in ONE request (sync.js:1575,
                       // no chunking) — a cap below a long-offline flush would fail-closed FOREVER
                       // (every retry over-cap). 5000 ≫ any realistic backlog; HMAC cost is trivial;
                       // the SP insert loop, not signing, is the real per-run ceiling.

const COVERED_FIELDS = [
  'TransactionId', 'StoreId', 'Date', 'Timestamp', 'ProductId', 'Type', 'Qty', 'Reason',
  'TransferId', 'IdempotencyKey', 'StockFromStoreId', 'StockToStoreId',
  'StockFrom', 'StockTo', 'TargetTransactionId',
  'SellAtSupply', 'DiscAtSupply', 'PricingVersion', 'CatalogueVersion'
];

const KID_RE = /^[a-z0-9]{1,16}$/;   // kid charset pinned: lowercase alphanum, short
const SIG_RE = /^v1:([a-z0-9]{1,16}):([0-9a-f]{64})$/i;

function canonical(row) {
  const r = row && typeof row === 'object' ? row : {};
  const parts = ['econ-v1'];
  for (const f of COVERED_FIELDS) {
    let v = r[f];
    if (f === 'IdempotencyKey') v = v == null || v === '' ? r.TransactionId : v; // mirror the LA coalesce
    let s = v == null ? '' : String(v);
    // Date round-trip normalisation (staging-apply P1/P4 ground truth): the client signs '2026-07-22'
    // but SharePoint's Date column echoes '2026-07-22T00:00:00Z' — a REPRESENTATION change, not an
    // edit. Canonicalise Date to its day part so sign-at-ingest and verify-from-store agree; a tamper
    // to a DIFFERENT day still breaks the seal (time-of-day carries no meaning in a date-only column).
    if (f === 'Date' && /^\d{4}-\d{2}-\d{2}T/.test(s)) s = s.slice(0, 10);
    parts.push(s);
  }
  // JSON-encode the ordered parts: unambiguous field boundaries. A plain join(separator) would let a
  // crafted value containing the separator make two DIFFERENT rows canonicalise identically — an
  // attacker could have the server sign row X at ingest, then rewrite the stored row to the colliding
  // variant Y and keep a valid seal (field-boundary injection). JSON framing kills the class.
  return JSON.stringify(parts);
}

// keyring = { active: 'k1', peppers: { k1: '<pepper>', ... } } — built from env by the handler,
// injectable in tests. Every pepper must be >= 32 chars; a short/absent pepper is "not configured".
function keyringFromEnv(env) {
  const active = (env.BOB_ROW_ATTEST_ACTIVE || '').trim();
  if (!KID_RE.test(active)) return null;
  const peppers = {};
  for (const [k, v] of Object.entries(env)) {
    const m = /^BOB_ROW_ATTEST_PEPPER_([A-Z0-9]{1,16})$/.exec(k);
    if (m && typeof v === 'string' && v.length >= 32) peppers[m[1].toLowerCase()] = v;
  }
  if (!peppers[active]) return null; // the active kid MUST have a usable pepper
  return { active, peppers };
}

function signRow(keyring, row) {
  const kid = keyring.active;
  return 'v1:' + kid + ':' + crypto.createHmac('sha256', keyring.peppers[kid]).update(canonical(row)).digest('hex');
}

function verifyRow(keyring, row) {
  const sig = row && typeof row.EconSig === 'string' ? row.EconSig : '';
  const m = SIG_RE.exec(sig);
  if (!m) return false;
  const pepper = keyring.peppers[m[1].toLowerCase()];
  if (!pepper) return false; // unknown / retired kid ⇒ fail closed
  const expected = crypto.createHmac('sha256', pepper).update(canonical(row)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(m[2].toLowerCase(), 'hex'));
  } catch (e) {
    return false;
  }
}

function evaluate(keyring, body) {
  const rows = body.rows;
  if (body.op === 'sign') {
    return { sigs: rows.map(r => ({ TransactionId: r && r.TransactionId != null ? String(r.TransactionId) : '', EconSig: signRow(keyring, r) })) };
  }
  return { results: rows.map(r => ({ TransactionId: r && r.TransactionId != null ? String(r.TransactionId) : '', ok: verifyRow(keyring, r) })) };
}

app.http('attestRows', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request) => {
    const keyring = keyringFromEnv(process.env);
    if (!keyring) {
      // Misconfiguration FAILS CLOSED at the caller: non-200 -> the LA returns the batch retryable.
      return { status: 500, jsonBody: { error: 'attester not configured' } };
    }
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'bad json' } }; }
    if (body.op !== 'sign' && body.op !== 'verify') {
      return { status: 400, jsonBody: { error: "op must be 'sign' or 'verify'" } };
    }
    if (!Array.isArray(body.rows) || body.rows.length > MAX_ROWS) {
      return { status: 400, jsonBody: { error: 'rows must be an array (max ' + MAX_ROWS + ')' } };
    }
    return { jsonBody: evaluate(keyring, body) };
  }
});

module.exports = { COVERED_FIELDS, canonical, signRow, verifyRow, evaluate, keyringFromEnv }; // exported for the proof suite
