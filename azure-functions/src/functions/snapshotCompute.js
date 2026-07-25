// BOB Stock - Azure Function: ledger archival snapshot COMPUTE + neutrality proof (Chunk 8).
// The archive Logic App holds the SharePoint I/O + the run-lock; this Function owns the pure math:
// given the live ledger rows and a cutoff (by monotonic SP Id), it computes the opening-balance snapshot,
// the archive set, integrity hashes, and PROVES stock-neutrality (snapshot + post-cutoff == full sum for
// EVERY (store,product) pair). If anything is off it returns ok:false and the Logic App aborts - nothing is
// written/archived, the live ledger is untouched. Mirrors validateKeys/catalogueMerge (logic JS, I/O in WDL).
//
// Contract:
//   POST {rows:[{Id,TransactionId,StoreId,ProductId,TxnType|Type,Qty,...}], cutoffId, retainAfterTs, runId,
//         snapshotVersion, stepCutoffTs, activeTypes?, inTypes?}
//   -> 200 {ok, reason?, cutoffId, snapshotVersion, balances:[{storeId,productId,balance}],
//           archiveIds:[SP Id...], liveKeepIds:[SP Id...], counts:{full,archive,keep}, hashes:{...}, stepCutoffTs}
// authLevel 'function'. No SharePoint access here.
//
// Cutoff = SP Id (monotonic), NOT business date (spec-audit crux fix): a late/offline backdated movement gets
// a NEW higher Id, so it folds post-cutoff and is never lost. retainAfterTs keeps a recent window live for UX.

const { app } = require('@azure/functions');
const crypto = require('crypto');

// Default stock classifier (kept in sync with the client Txn.classify direction). IN adds, everything else in
// the active set subtracts; types outside active are non-stock (ignored). The caller MAY override via inTypes/
// activeTypes to stay authoritative with the client.
const DEFAULT_IN = ['in', 'transfer_in', 'adjustment_in', 'return_in', 'stock_in'];
const DEFAULT_ACTIVE_EXTRA = ['out', 'transfer_out', 'adjustment_out', 'sale', 'wastage', 'move_out', 'return_out', 'stock_out', 'damage'];

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
// AGY hardening: the SP item id is 'Id' from the archive Logic App's $select=Id read (verified in staging), but
// other SharePoint read shapes surface it as 'ID' (all-caps). Accept BOTH so a future/alternate read path can
// never silently make Number(undefined)=NaN -> every row mis-partitioned to keep (archive nothing).
function idOf(r) { return Number(r.Id != null ? r.Id : r.ID); }
function typeOf(r) { return String(r.TxnType != null ? r.TxnType : (r.Type != null ? r.Type : '')); }
function tsOf(r) { return String(r.TxnTimestamp != null ? r.TxnTimestamp : (r.Timestamp != null ? r.Timestamp : '')); }
// OS-W4.4 C1 archive-carry: the live Date vs archive TxnDate, day-part normalised (SharePoint echoes
// 'YYYY-MM-DDT00:00:00Z' for a signed 'YYYY-MM-DD' — representation, not content; same rule as
// attestRows.canonical, a DIFFERENT day still diverges).
function dateOf(r) {
  let s = String(r.TxnDate != null ? r.TxnDate : (r.Date != null ? r.Date : ''));
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) s = s.slice(0, 10);
  return s;
}
const optNum = (v) => (v == null || v === '' ? '' : String(num(v)));
function hashRows(rows) {
  // GPT P2: order-independent hash of canonical row CONTENT (not just {Id,TransactionId}) so it proves the
  // archived rows carry the SAME content as the source - a copy/mapping corruption of StoreId/ProductId/type/
  // Qty now changes the hash and is caught before publish. Field-name agnostic (typeOf/tsOf/dateOf read the
  // live Type/Timestamp/Date OR the archive TxnType/TxnTimestamp/TxnDate), so source rows and their archive
  // copies hash equal.
  // OS-W4.4 C1 archive-carry extension (mirror-the-guard): the carried set joins the canon — EconSig,
  // IdempotencyKey, Date, the four stamp-authority fields, UnitPriceAtTime, and the source/dest ids +
  // labels — so a copy defect in ANY carried field aborts BEFORE publish/delete, same as the original set.
  // Framing switched join('|') -> JSON.stringify: the labels are free-ish text, and a '|' inside a value
  // could make two DIFFERENT rows canonicalise identically (the same field-boundary-injection class the
  // EconSig canonical closed). Symmetric on both sides of the compare, so equality semantics are preserved.
  // ⚠ OS-W4.4 C2 (C2-R6-4/C2-R7-5; interim LA review R2 finding 2 — flagged for the return
  // re-audit): the FULL N7 CONTROL FORM joins the canon, typed. Without it a copy mapping that
  // DROPPED ControlId (or mutated ControlState/CommitSig) hashed IDENTICAL to its source, the run
  // passed the fidelity gate, and the live-delete then destroyed the only complete control row —
  // leaving an archived control that can no longer be tied to its manifest head. The hash is
  // per-run TRANSIENT (computed on the source, compared to the archive re-read inside the same
  // run — no stored hash field exists anywhere), so extending the canon is safe by construction:
  // both sides are always hashed by the same code. Pre-C2 rows carry none of these columns => ''
  // on BOTH sides => equality semantics unchanged for legacy runs.
  const canon = r => JSON.stringify([String(r.TransactionId || ''), String(r.StoreId || ''), String(r.ProductId || ''),
    typeOf(r), String(num(r.Qty)), tsOf(r), String(r.TransferId || ''), String(r.TargetTransactionId || ''),
    dateOf(r), String(r.Reason || ''), String(r.IdempotencyKey || ''), String(r.EconSig || ''),
    optNum(r.SellAtSupply), optNum(r.DiscAtSupply), optNum(r.PricingVersion), optNum(r.CatalogueVersion),
    optNum(r.UnitPriceAtTime), String(r.StockFromStoreId || ''), String(r.StockToStoreId || ''),
    String(r.StockFrom || ''), String(r.StockTo || ''),
    String(r.ControlId || ''), String(r.ControlType || ''), optNum(r.ControlRevision),
    optNum(r.BornPublicationVersion), String(r.TargetLine || ''), String(r.OriginalEventAt || ''),
    String(r.ControlState || ''), String(r.CommitSig || '')]);
  const parts = rows.map(canon).sort();
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

function compute(body) {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  // GPT P2: hash-only mode — the archive Logic App re-reads the ARCHIVED rows' content and asks for their
  // content hash, then compares it to the source archive-hash from the main compute BEFORE it publishes/deletes.
  // Mismatch => a copy/mapping corruption => the run aborts, live ledger untouched.
  if (body.mode === 'hash') return { ok: true, hash: hashRows(rows), count: rows.length };
  const cutoffId = Number(body.cutoffId);
  const retainAfterTs = body.retainAfterTs != null ? Number(body.retainAfterTs) : null; // rows with Timestamp>=this stay LIVE even if Id<=cutoff
  if (!Number.isFinite(cutoffId) || cutoffId <= 0) return { ok: false, reason: 'BAD_CUTOFF' };

  const IN = new Set(body.inTypes || DEFAULT_IN);
  const ACTIVE = new Set([...(body.inTypes || DEFAULT_IN), ...(body.activeTypes || DEFAULT_ACTIVE_EXTRA)]);
  const key = r => r.StoreId + ' ' + r.ProductId;

  // Tombstones (Chunk 8, D8-7 live+archive dedup): the ledger is append-only, so a delete is a NEW
  // row Type='deleted' whose TargetTransactionId names the original - the original row STAYS in the list
  // (C7: never edit/delete in place). The CLIENT computes stock by REMOVING the tombstoned original, so
  // the snapshot must do the same or it over-counts a deleted movement. Exclude BOTH the 'deleted' rows
  // (already non-active) AND every tombstoned original from all balance sums. Applied consistently to
  // full/snap/kept so neutrality still holds AND the snapshot matches client truth. This also fixes the
  // cross-boundary case (original Id<=cutoff, tombstone Id>cutoff): as long as the tombstone is present in
  // this input, the original is excluded from the snapshot, and the client's later no-op tombstone (target
  // already pruned) leaves the correct total. RESIDUAL (documented): a tombstone that arrives in a LATER
  // archival cycle for an already-archived+snapshotted original cannot retroactively adjust that snapshot -
  // mitigated operationally (C7-style: don't delete long-archived movements; retain window keeps pairs together).
  // ⚠ OS-W4.4 CONTRACT 2 SCOPED AMENDMENT (C2-R4-E1 v3 / C2-R5-4 / C2-R6-3; C2-LA finding 3;
  // flagged for the return re-audit): CONTROL-AWARE EFFECTIVE-VALUE folding. When the caller
  // supplies the active control manifest (body.controlHeads — the C2 archive LA does; absent =>
  // {} => byte-identical pre-C2 behaviour):
  //   - a TARGET row named by an ACTIVE (non-null) head contributes NOTHING (its effect was
  //     corrected away — deletion or replacement);
  //   - a CONTROL row (ControlId set) contributes its raw effect IFF it IS the active head's
  //     control for its target (historical/superseded control rows contribute nothing);
  //   - a NULL-head (withdrawn/retired) target folds normally — it is PRESENT again.
  // Applied identically to full/snap/kept, so the neutrality proof below is preserved.
  // C2 DISCRIMINATOR (interim LA review R2 finding 5): the C2 archive LA ALWAYS supplies
  // `controlHeads` (possibly {}); a legacy/pre-C2 caller never sends the property at all. Keying
  // the C2 partition on PROPERTY PRESENCE — not on the map being non-empty — is what makes the
  // absent case byte-identical to pre-C2. Without it the unit-move fired on ordinary tombstones
  // for legacy callers too, so merely DEPLOYING this function (§D step 3) would have changed live
  // archive behaviour before the legacy writer was disabled (§D step 4).
  const c2Mode = Object.prototype.hasOwnProperty.call(body, 'controlHeads');
  const controlHeads = (body.controlHeads && typeof body.controlHeads === 'object' && !Array.isArray(body.controlHeads)) ? body.controlHeads : {};
  const hasHead = (t) => Object.prototype.hasOwnProperty.call(controlHeads, t);
  const controlSuppressed = (r) => {
    const cid = r.ControlId != null && r.ControlId !== '' ? String(r.ControlId) : null;
    if (cid !== null) { // a control row: folds only as the ACTIVE control for its target
      const tgt = r.TargetTransactionId != null ? String(r.TargetTransactionId) : '';
      const head = hasHead(tgt) ? controlHeads[tgt] : null;
      return !(head && head.controlId === cid);
    }
    const head = hasHead(String(r.TransactionId)) ? controlHeads[String(r.TransactionId)] : null;
    return !!head; // ACTIVE-headed target => corrected away; null head => folds normally
  };

  // Tombstone set — built AFTER the manifest is known (interim LA review R2 finding 1). The
  // pre-C2 rule ("any Type='deleted' row suppresses its target") silently defeated the null-head
  // lane: a device tombstone that was adopted and then WITHDRAWN/RETIRED leaves controlHeads[T]
  // === null, meaning T is PRESENT again — but the historical tombstone row still sat in the input
  // and excluded T from balances (repro: T=+10 folded as []). A tombstone therefore suppresses its
  // target only while it is the ACTIVE authority for it:
  //   - explicit NULL head on the target  => withdrawn/retired => suppresses NOTHING;
  //   - a CONTROL tombstone that is not the active head => historical => suppresses NOTHING;
  //   - no head recorded (incl. every legacy/pre-C2 call, where hasHead is always false)
  //     => unchanged Chunk-8 behaviour.
  const tombstoned = new Set();
  for (const r of rows) {
    if (typeOf(r) !== 'deleted') continue;
    const tgt = r.TargetTransactionId;
    if (tgt == null || tgt === '') continue;
    const t = String(tgt);
    if (hasHead(t)) {
      const head = controlHeads[t];
      if (!head) continue;                       // explicit null head: the target is restored
      const cid = r.ControlId != null && r.ControlId !== '' ? String(r.ControlId) : null;
      if (cid !== null && head.controlId !== cid) continue; // superseded control tombstone
    }
    tombstoned.add(t);
  }

  // FULL balance per pair (all rows) - the ground truth we must preserve.
  const full = new Map();
  const bump = (map, r) => {
    const t = typeOf(r);
    if (!ACTIVE.has(t)) return; // non-stock type ('deleted' tombstones included here)
    if (tombstoned.has(String(r.TransactionId))) return; // Chunk 8: a deleted movement contributes nothing
    if (controlSuppressed(r)) return; // C2: effective-value folding (no-op when controlHeads absent)
    const q = num(r.Qty);
    if (!Number.isFinite(q) || q < 0 || !Number.isSafeInteger(q)) return; // mirror client _safeQty
    const d = IN.has(t) ? q : -q;
    map.set(key(r), (map.get(key(r)) || 0) + d);
  };
  for (const r of rows) bump(full, r);

  // Partition by the ID cutoff, with the retention window (recent rows stay live even if Id<=cutoff).
  const toArchive = [], toKeep = [];
  for (const r of rows) {
    const id = idOf(r);
    const ts = r.TxnTimestamp != null ? Number(r.TxnTimestamp) : (r.Timestamp != null ? Number(r.Timestamp) : NaN);
    const recentKept = retainAfterTs != null && Number.isFinite(ts) && ts >= retainAfterTs;
    if (Number.isFinite(id) && id <= cutoffId && !recentKept) toArchive.push(r); else toKeep.push(r);
  }
  // ⚠ C2 UNIT-MOVE (C2-R6-3, same amendment): a qualifying TARGET pulls ALL its control/tombstone
  // rows into the SAME run regardless of their own ids/timestamps (they are never client-covering-
  // relevant; SR-70 same-list preserved by construction). Gated on the C2 DISCRIMINATOR — a caller
  // that never sends `controlHeads` gets the exact pre-C2 partition (R2 finding 5).
  if (c2Mode) {
    const archIds = new Set(toArchive.map(r => String(r.TransactionId)));
    const rides = (r) => {
      const tgt = r.TargetTransactionId != null && r.TargetTransactionId !== '' ? String(r.TargetTransactionId) : null;
      const isCtl = r.ControlId != null && r.ControlId !== '';
      const isTomb = typeOf(r) === 'deleted';
      return tgt !== null && (isCtl || isTomb) && archIds.has(tgt);
    };
    for (let i = toKeep.length - 1; i >= 0; i--) {
      if (rides(toKeep[i])) { toArchive.push(toKeep[i]); toKeep.splice(i, 1); }
    }
  }

  // Snapshot balance = the ARCHIVED rows' effect only. Compute directly so it is provably the archived set.
  const snap = new Map();
  for (const r of toArchive) bump(snap, r);

  // NEUTRALITY PROOF: for EVERY pair, snapshotBalance + keptBalance must equal fullBalance.
  const kept = new Map();
  for (const r of toKeep) bump(kept, r);
  const allPairs = new Set([...full.keys(), ...snap.keys(), ...kept.keys()]);
  const mismatches = [];
  for (const k of allPairs) {
    const f = full.get(k) || 0, s = snap.get(k) || 0, kp = kept.get(k) || 0;
    if (s + kp !== f) mismatches.push({ pair: k.replace(' ', '/'), full: f, snap: s, kept: kp });
  }
  if (mismatches.length) return { ok: false, reason: 'NOT_NEUTRAL', mismatches: mismatches.slice(0, 20) };

  // Snapshot balance = the ARCHIVED rows' effect ONLY (snap), NOT the full balance. The client seeds from this
  // snapshot then ADDS the live kept rows back - snap + kept == full (proven above). Emitting `full` here would
  // double-count the kept rows. A pair whose stock is entirely in kept rows has snap 0 (client derives it from
  // live rows). A pair with no post-cutoff movement keeps its whole balance in snap - correctly carried.
  const balances = [];
  for (const k of snap.keys()) {
    const [storeId, productId] = k.split(' ');
    balances.push({ storeId, productId, balance: snap.get(k) || 0 });
  }

  const stepCutoffTs = Number(body.stepCutoffTs) || 0; // ledger-cutoff's matching record-step timestamp (client resolver)
  return {
    ok: true,
    cutoffId,
    snapshotVersion: Number(body.snapshotVersion) || 0,
    runId: String(body.runId || ''),
    stepCutoffTs,
    balances,
    archiveIds: toArchive.map(idOf),
    liveKeepIds: toKeep.map(idOf),
    counts: { full: rows.length, archive: toArchive.length, keep: toKeep.length },
    hashes: { source: hashRows(rows), archive: hashRows(toArchive) },
  };
}

app.http('snapshotCompute', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request) => {
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { ok: false, reason: 'BAD_JSON' } }; }
    return { jsonBody: compute(body) };
  }
});

module.exports = { compute, hashRows };
