// BOB Stock — Azure Function: ROW-LEVEL ECONOMIC ATTESTATION (OS-W4.4 Contract 1, staging-apply).
// Spec: AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md (Contract 1) — closes the banked W4.4 root cause:
// ledger rows are client-editable (device or SharePoint-direct); the settlement engine holds every
// row it cannot verify (MANUAL_REVIEW_UNVERIFIABLE_QTY). This route lets the SERVER stamp each row's
// ECONOMIC IDENTITY with a tamper-evident HMAC at push-v2 ingest, so a later edit of any covered
// field is detectable and honest rows can auto-FINAL.
//
// Covered fields (canonical order — the row's full economic identity):
//   TransactionId, StoreId, Date, Timestamp, ProductId, Type, Qty, TransferId, IdempotencyKey,
//   StockFromStoreId, StockToStoreId, StockFrom, StockTo, TargetTransactionId
// Beyond the contract's minimum tuple (flagged deliberate extensions, Kunal-approved 2026-07-22):
//   - Date + Timestamp + StoreId: for direct-log rows (no server step) these decide window membership,
//     the as-of franchise rate, and whose settlement the row lands in (R6 AGY-4 covered step-backed
//     rows only).
//   - StockFrom/StockTo TEXT labels: per W4-SR-58 the labels ARE the sale-vs-wastage classifier inputs
//     (engine mirrors client _grossSales; R3 Codex-1 nets return_in only when baseLabel==='Customer').
//   - StockFromStoreId/StockToStoreId ids alongside the labels (the contract's "source").
//   - TargetTransactionId: a tombstone is a CONTROL — an edited target would redirect a deletion onto a
//     different row while the seal stayed valid.
//   Sale prices (UnitPriceAtTime) deliberately NOT covered — retailProfit is flagged
//   clientRecordedSalePrices+informationalOnly and does not affect the payable (R6 Codex-2; Kunal 2026-07-22).
// The SellAtSupply/DiscAtSupply authority tuple is NOT covered here: it has its own SR-153/155 semantic
// attestation contract (values RECOMPUTED against pricing/catalogue history, not just sealed).
//
//   POST { op:'sign',   rows:[{...covered fields...}, ...] }
//     -> 200 { sigs: [{ TransactionId, EconSig }, ...] }        (aligned to input order)
//   POST { op:'verify', rows:[{...covered fields..., EconSig}, ...] }
//     -> 200 { results: [{ TransactionId, ok:boolean }, ...] }  (booleans only; no oracle detail)
//   -> 400 malformed; 500 pepper not configured.
// FAIL-CLOSED CONTRACT (opposite of validateMoney's fail-open, same as validateKeys): the calling
// Logic App treats ANY non-200 — or unreachable — as NOT SIGNED and returns the batch as RETRYABLE
// (devices already queue + retry; TransactionId/IdempotencyKey dedup absorbs the replay). Rows must
// never land unsigned: unsigned rows would re-grow the manual-review pile Contract 1 exists to clear.
//
// Signature: 'v1:' + HMAC-SHA-256(pepper, JSON.stringify(['econ-v1', ...field values in canonical
// order])), hex. JSON framing (not a join) — unambiguous field boundaries, see canonical().
// Canonicalisation: absent/null/undefined -> ''; everything else String(v). The Logic App MUST pass the
// values it will STORE (post-projection); IdempotencyKey falls back to TransactionId here to mirror the
// LA's coalesce(row.IdempotencyKey, row.TransactionId) insert expression.
// Pepper lives ONLY in the Function App setting BOB_ROW_ATTEST_PEPPER — deliberately SEPARATE from
// BOB_AUTH_PEPPER (key separation: an auth-pepper rotation must not invalidate every stored row seal,
// and vice versa). Never in SharePoint / client / repo. authLevel 'function' — no anonymous oracle.

const { app } = require('@azure/functions');
const crypto = require('crypto');

const MAX_ROWS = 500; // comfortably above the client's push batch size

const COVERED_FIELDS = [
  'TransactionId', 'StoreId', 'Date', 'Timestamp', 'ProductId', 'Type', 'Qty',
  'TransferId', 'IdempotencyKey', 'StockFromStoreId', 'StockToStoreId',
  'StockFrom', 'StockTo', 'TargetTransactionId'
];

function canonical(row) {
  const r = row && typeof row === 'object' ? row : {};
  const parts = ['econ-v1'];
  for (const f of COVERED_FIELDS) {
    let v = r[f];
    if (f === 'IdempotencyKey') v = v == null || v === '' ? r.TransactionId : v; // mirror the LA coalesce
    parts.push(v == null ? '' : String(v));
  }
  // JSON-encode the ordered parts: unambiguous field boundaries. A plain join(separator) would let a
  // crafted value containing the separator make two DIFFERENT rows canonicalise identically — an
  // attacker could have the server sign row X at ingest, then rewrite the stored row to the colliding
  // variant Y and keep a valid seal (field-boundary injection). JSON framing kills the class.
  return JSON.stringify(parts);
}

function signRow(pepper, row) {
  return 'v1:' + crypto.createHmac('sha256', pepper).update(canonical(row)).digest('hex');
}

function verifyRow(pepper, row) {
  const sig = row && typeof row.EconSig === 'string' ? row.EconSig : '';
  if (!/^v1:[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = signRow(pepper, row);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected.slice(3), 'hex'),
      Buffer.from(sig.slice(3).toLowerCase(), 'hex')
    );
  } catch (e) {
    return false;
  }
}

function evaluate(pepper, body) {
  const rows = body.rows;
  if (body.op === 'sign') {
    return { sigs: rows.map(r => ({ TransactionId: r && r.TransactionId != null ? String(r.TransactionId) : '', EconSig: signRow(pepper, r) })) };
  }
  return { results: rows.map(r => ({ TransactionId: r && r.TransactionId != null ? String(r.TransactionId) : '', ok: verifyRow(pepper, r) })) };
}

app.http('attestRows', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request) => {
    const pepper = process.env.BOB_ROW_ATTEST_PEPPER;
    if (!pepper || pepper.length < 32) {
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
    return { jsonBody: evaluate(pepper, body) };
  }
});

module.exports = { COVERED_FIELDS, canonical, signRow, verifyRow, evaluate }; // exported for the proof suite
