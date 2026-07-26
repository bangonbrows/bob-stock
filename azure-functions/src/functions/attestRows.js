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

// ── OS-W4.4 CONTRACT 2 FRAMES (N11 scoped amendment — design AZURE-CHUNK-ORG-W44-C2-DESIGN.md) ──────
// FOUR additional canonical frames beside econ-v1 (which is FROZEN above — C1-audited, untouched):
//   ctl-v1        control seals (§7a): control-level fields + the replacement output row's FULL
//                 ENGINE ROW FORM (C2-R2-2 class rule — derived from the buybackExport.js header
//                 enumeration, incl. TransferId/UnitPriceAtTime/IdempotencyKey).
//   ctlcommit-v1  device-tombstone commit seals (§8/C2-R4-5): {TransactionId, TargetTransactionId}.
//   epoch-v1      the seal-epoch artifact (N16/C2-R4-7).
//   runrec-v1     archive run records' immutable fields (N17/C2-R9-1/C2-R22-1/C2-R23-1).
//   runrec-pub-v1 the N17 Published marker (C2-R14-3) — separate so stamping never invalidates
//                 RecordSig.
// TYPED canonical (C2-R7-5): each covered field encodes as [1, <raw JSON value>] when present or
// [0] when ABSENT — so 0, null, '' and field-absent are FOUR distinct encodings (the econ-v1
// String-coercion canonical is deliberately NOT reused; it collapses those). The frame name leads
// the array ⇒ full domain separation between frames under the same pepper.
const CTL_V1_FIELDS = [
  // control-level immutable identity (§7a):
  'ControlId', 'ControlType', 'TargetTransactionId', 'ControlRevision', 'BornPublicationVersion',
  'TargetLine', 'OriginalEventAt',
  // the replacement output row's FULL ENGINE ROW FORM (absent for deletions — [0] encodings):
  'TransactionId', 'StoreId', 'ProductId', 'Type', 'Qty', 'Date', 'Timestamp', 'Reason',
  'StockFrom', 'StockTo', 'StockFromStoreId', 'StockToStoreId', 'TransferId', 'IdempotencyKey',
  'UnitPriceAtTime', 'SellAtSupply', 'DiscAtSupply', 'PricingVersion', 'CatalogueVersion'
];
const FRAME_FIELDS = {
  'ctl-v1': CTL_V1_FIELDS,
  'ctlcommit-v1': ['TransactionId', 'TargetTransactionId'],
  // R6 finding 3: §D claimed the reviewed Function package digest was "bound into the signed epoch
  // artifact", but the canonical never covered it — attestRows ignores properties outside this
  // list, so a runner could pass `cutoverPackageDigest` for signing, the field would be stored, and
  // it could later be CHANGED while the original EpochSig kept verifying. It is now signed.
  // NOTE it is the CUTOVER-TIME package (historical evidence, frozen with the one-shot epoch), NOT
  // the current-build authority — see 'buildrec-v1'.
  'epoch-v1': ['epochId', 'tombstoneCommitEpochId', 'archiveC2EpochId', 'recordedAt', 'cutoverPackageDigest'],
  // R6 finding 4: the epoch is create-once and reused byte-for-byte, so it CANNOT also be the
  // permanent current-build authority — a later legitimately-reviewed package would be
  // misclassified as a rollback forever. The APPROVED-BUILD RECORD is a separate, signed, and
  // deliberately UPDATEABLE artifact: it names the package digest currently authorised to serve,
  // with a monotonic revision so an old record cannot be replayed over a newer one.
  'buildrec-v1': ['packageDigest', 'revision', 'approvedAt'],
  'runrec-v1': ['RunId', 'SnapshotVersion', 'InputDigest', 'TombstoneIds', 'ArchiveMemberSourceIds'],
  'runrec-pub-v1': ['RunId']
};
// Fixed literals baked into a frame's canonical (state the signature attests, not a field):
const FRAME_SUFFIX = { 'ctlcommit-v1': ['committed'], 'runrec-pub-v1': ['published'] };

function canonicalFrame(frame, obj) {
  const fields = FRAME_FIELDS[frame];
  if (!fields) return null;
  const o = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  const parts = [frame];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(o, f)) {
      const v = o[f];
      // Only JSON-representable primitives/arrays are attestable; anything else fails closed at sign.
      parts.push([1, v === undefined ? null : v]);
    } else {
      parts.push([0]);
    }
  }
  for (const s of (FRAME_SUFFIX[frame] || [])) parts.push(s);
  return JSON.stringify(parts);
}
function signFrame(keyring, frame, obj) {
  const canon = canonicalFrame(frame, obj);
  if (canon === null) return null;
  const kid = keyring.active;
  return 'v1:' + kid + ':' + crypto.createHmac('sha256', keyring.peppers[kid]).update(canon).digest('hex');
}
function verifyFrame(keyring, frame, obj, sig) {
  const canon = canonicalFrame(frame, obj);
  if (canon === null) return false;
  const m = SIG_RE.exec(typeof sig === 'string' ? sig : '');
  if (!m) return false;
  const pepper = keyring.peppers[m[1].toLowerCase()];
  if (!pepper) return false; // unknown / retired kid ⇒ fail closed
  const expected = crypto.createHmac('sha256', pepper).update(canon).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(m[2].toLowerCase(), 'hex'));
  } catch (e) {
    return false;
  }
}

function evaluate(keyring, body) {
  const rows = body.rows;
  // NEW FRAMES (N11): body.frame selects; absent/'econ-v1' ⇒ the FROZEN C1 row path below,
  // byte-for-byte unchanged. New-frame items: sign ⇒ {items:[obj,...]} → {sigs:[...]};
  // verify ⇒ {items:[{obj, sig},...]} → {results:[bool,...]}.
  if (body.frame && body.frame !== 'econ-v1') {
    if (!FRAME_FIELDS[body.frame]) return { error: 'unknown frame' };
    if (body.op === 'sign') {
      return { sigs: rows.map(r => signFrame(keyring, body.frame, r)) };
    }
    return { results: rows.map(r => verifyFrame(keyring, body.frame, r && r.obj, r && r.sig)) };
  }
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

module.exports = { COVERED_FIELDS, canonical, signRow, verifyRow, evaluate, keyringFromEnv,
  FRAME_FIELDS, CTL_V1_FIELDS, canonicalFrame, signFrame, verifyFrame }; // exported for the proof suite
