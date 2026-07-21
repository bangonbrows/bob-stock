// BOB Stock - Azure Function: OS-W4.4 buy-back settlement EXPORT ENGINE (Org chunk).
// Spec: AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md (FROZEN R25, W4-SR-1..171 closed). Same division of labour
// as topology.js: the gated export route (LA-CHANGES §3/§6) does ALL SharePoint I/O, the Director gate,
// and the coordination-record CAS/lease machinery; THIS module owns the PURE settlement computation and
// is exercised directly by test/buyback-export-proof.js. The engine consumes ATTESTED INPUTS ONLY and
// itself refuses a FINAL (or the whole export) when the evidence doesn't prove what the route claims —
// never a route-side promise (W4-SR-91/170).
//
//   buildBuybackExport({ storeId, rows: { live, archive }, steps, controls, badVersionEvidence,
//                        pricing: { storeMap, globalMap }, window, products, coverage, graceClosed, drain })
//     -> { ok:true, settlement } | { ok:false, reason, detail? }
//
// OUTCOME CLASSES (pinned):
//   - REFUSAL (ok:false)      = corruption / malformed input / broken attestation — the fail-closed
//                               detectors (SR-55/70/90/92/96/151/152/169): dedup conflicts, cross-list
//                               controls, partial stamp tuples, bad money, coverage/lease gaps. Never a
//                               silently short or silently mis-valued settlement.
//   - PROVISIONAL (ok:true)   = a valid, regenerable settlement that must not close: grace open, drain
//                               incomplete, unaccounted presented identity, open BAD_VERSION entries,
//                               unattested/uncorroborated stamped lines, unproven origins (SR-37/57/94/
//                               122/129/152/153/170/171). Every blocker is surfaced by identity.
//   - FINAL (ok:true)         = graceClosed + drained + every presented identity accounted
//                               (PRESENT | COVERED | QUEUED-and-cleared) + no valuation blockers.
//
// ENGINE ROW FORM (the route maps SharePoint columns via the pinned pull maps — sync.js _fromSharePoint
// field names, so client and engine speak ONE shape): { id (TransactionId), type, productId, storeId,
// qty, date ('YYYY-MM-DD', lens as-of anchor per SR-25), createdAt (ISO-UTC instant — the WINDOW
// boundary field per SR-25), transferId?, idempotencyKey? ('' = legacy blank), sellAtSupply?/
// discAtSupply?/pricingVersion?/catalogueVersion? (the four authority fields, all-or-none), _attested?
// (SERVER-SET row attestation column, SR-155 — required for tier-1 on transferless rows), _rvSell?/
// _rvDisc?/_rvPv?/_rvCv? (server-resolved valuation, SR-157/163), unitPriceAtTime? (K4),
// stockFrom?/stockTo? (TEXT labels — the classifier inputs, SR-58), stockFromStoreId?/stockToStoreId?,
// reason?, _spId (live rows: the SharePoint item id — epoch provenance, SR-129), sourceId (archived
// rows: the preserved original live-list id, SR-129).
//
// ENGINE STEP FORM (RecordSteps via the same mapping): { stepId, recordId (the transferId), recordType,
// stepType ('submit'|'receive'|'resolve'|'cancel'|'backfill'), seq?, timestamp (ms), fromStoreId?,
// toStoreId?, payload (parsed object), _attested? (the SR-153 SERVER-SET semantic-attestation marker,
// stripped from clients at ingest) }.
//
// COVERAGE FORM (query-completion evidence, SR-26/56/68/75/92/93/170 — every attestation carries the
// lease + completed-run version so the engine can prove ONE continuous tenure):
//   { continuity: true,                            // post-second-query same-lease re-read (SR-93)
//     live:    { complete: true, leaseId, runVersion, window: {from,to} },
//     archive: { complete: true, leaseId, runVersion, window: {from,to} },
//     steps:   { complete: true, leaseId },        // every transferId in the row set enumerated (SR-114)
//     controls:{ live: {complete:true, leaseId}, archive: {complete:true, leaseId} },  // SR-123
//     badVersion: { complete: true, leaseId },     // the SR-170 enumeration-completeness watermark
//     stepsEpochId: <int> }                        // the Chunk-4 steps-epoch boundary id (SR-129)
//
// CONTROLS FORM (SR-115/123/124/130/151): { live: [ctl], archive: [ctl], activeManifest: { version,
//   controlHeads: { <targetTransactionId>: {controlId, revision, bornPublicationVersion} | null } } }
//   ctl = { controlId, type: 'deletion'|'replacement', targetTransactionId, revision,
//           bornPublicationVersion, row? } — a replacement carries its server-minted correction row
//   (engine row form + originalEventAt ISO-UTC instant, SR-130; its four authority fields are REQUIRED —
//   an unstamped replacement is malformed, SR-130/134). controlHeads is the ACTIVE publication
//   manifest's per-target head map (SR-148/151); null = explicitly WITHDRAWN.
//
// BAD-VERSION EVIDENCE FORM (SR-165/168/170): { entries: [ { rowId, digest, terminal:
//   null | 'corrected-and-reattested' | 'rejected', rejectedAccounted?: true } ] } — coverage.badVersion
//   carries the completeness watermark. Coverage-by-control is a DERIVED VIEW evaluated HERE against
//   controlHeads (SR-168), never a stored write.
//
// DRAIN FORM (SR-91/94/107/122/171): { graceRecords: [ { id, state: 'issued'|'consumed'|'committed',
//   presentedIds: [..], writtenIds: [..], expectedStepIds: [..] } ] } — presentedIds is the FULL
//   presented row manifest bound at consumption (SR-171). drain == null => the settlement is PROVISIONAL
//   (evidence absent), never an error.
//
// ENGINEER'S NOTES for auditors (deviations/definitions the frozen spec left to the build):
//   N1. The spec pins the P1 signature's TOP-LEVEL keys; the activeManifest rides INSIDE `controls`
//       and the steps-epoch id INSIDE `coverage` (both are route-attested facts; adding top-level args
//       would break the pinned signature).
//   N2. `reqId` is imported from topology.js (added to its exports — additive, zero behaviour change)
//       alongside the two pinned validators; the engine re-derives NO validation primitive.
//   N3. The item-stamp tier (P6 tier 2) ALSO requires the minting step to carry the server semantic
//       attestation — an unattested submit/receive/resolve step's stamps are the same forgery class
//       SR-152/153 closes at tier 1, so paying them at tier 2 would reopen it sideways.
//   N4. The engine is CLOCK-FREE and RNG-FREE — every instant comes from the inputs; identical inputs
//       always produce the identical settlement (replay/regenerate safe).
//   N5. The HTTP route registered here is a thin adapter for the staging-apply LA (authLevel:'function');
//       the LA supplies the attested envelope. It is NOT deployed until staging-apply.
//   N6. Catalogue-price edge parity: the client invoice computes `sell = p?.price || 0`; the engine
//       requires a FINITE NUMBER (else 0). Verdicts differ only on a corrupt catalogue (string/NaN
//       price), where the client would propagate garbage — the parity fixtures pin clean-catalogue
//       equality (S-285) and the engine side is the stricter of the two.
//
// Governing contracts: AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md; AZURE-CHUNK-ORG-LA-CHANGES.md §3/§6;
// frozen W4.3 stamps spec (field semantics); CHUNK8 (archive identities).

'use strict';

const { app } = require('@azure/functions');
const { validPricingSeries, isIsoUtc, reqId } = require('./topology.js');

const HEAD_OFFICE = 'head_office';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Money / tuple policy (P7, SR-62/73/89 — verdict-identical to the client: phase2 _validStampPair +
// sync _readRowStamps; the S-283 parity sentinel proves it against the REAL client code) ─────────────
function twoDp(n) { return Number(n.toFixed(2)) === n; }
function validMoney(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1000000 && twoDp(v); }
function validDiscPct(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100 && twoDp(v); }
function validVersion(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }
// The FOUR authority fields — ALL FOUR or none (W4.3 amendment 1 rev-3). Returns {absent:true} |
// {sell,disc,pv,cv} | null (null = PARTIAL or OUT-OF-POLICY = malformed, the SR-169 corruption class).
function readTuple(sell, disc, pv, cv) {
  const has = (v) => v !== undefined && v !== null && v !== '';
  const present = [has(sell), has(disc), has(pv), has(cv)].filter(Boolean).length;
  if (present === 0) return { absent: true };
  if (present !== 4) return null;
  if (!validMoney(sell) || !validDiscPct(disc) || !validVersion(pv) || !validVersion(cv)) return null;
  return { sell, disc, pv, cv };
}
function tupleEq(a, b) { return !!(a && b && a.sell === b.sell && a.disc === b.disc && a.pv === b.pv && a.cv === b.cv); }

// ── Canonical serialize (dedup bit-identity, mirrors records.js _canonicalSerialize) ─────────────────
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

// ── Classifier (SHARED semantics — verdict-identical to client Txn.classify/Txn.category/_isHOSupply;
// fixture-proven in the proof suite + the S-285 parity sentinel) ─────────────────────────────────────
function classify(t) {
  switch (t.type) {
    case 'in':             return { direction: 'in',   category: 'delivery' };
    case 'return_in':      return { direction: 'in',   category: 'return' };
    case 'transfer_in':    return { direction: 'in',   category: 'transfer' };
    case 'out':            return { direction: 'out',  category: 'sale' };
    case 'move_out':       return { direction: 'out',  category: 'move' };
    case 'transfer_out':   return { direction: 'out',  category: 'transfer' };
    case 'wastage':        return { direction: 'out',  category: 'wastage' };
    case 'adjustment_in':  return { direction: 'in',   category: 'adjustment' };
    case 'adjustment_out': return { direction: 'out',  category: 'adjustment' };
    case 'deleted':        return { direction: 'none', category: 'deleted' };
    default:               return { direction: 'none', category: 'unknown' };
  }
}
function baseLabel(s) { return (typeof s === 'string' ? s : '').split(' — ')[0]; }
// The report-facing TRUE category — destination-aware via the carried StockFrom/StockTo TEXT labels
// (SR-58: they ARE the sale-vs-wastage classifier inputs). Mirrors index.html Txn.category exactly.
function category(t) {
  if (!t || typeof t !== 'object') return 'unknown';
  const to = baseLabel(t.stockTo), from = baseLabel(t.stockFrom);
  switch (t.type) {
    case 'in':
      if (from === 'HO Warehouse' || from === 'Another Store' || from === 'Franchise Office') return 'transfer';
      return 'delivery';
    case 'return_in':      return 'return';
    case 'transfer_in':    return 'transfer';
    case 'transfer_out':   return 'transfer';
    case 'move_out':       return 'internal';
    case 'wastage':        return 'wastage';
    case 'adjustment_in':
    case 'adjustment_out': return 'adjustment';
    case 'deleted':        return 'deleted';
    case 'out':
      if (to === 'Customer Sale')                                                          return 'sale';
      if (to === 'Wastage/Damage')                                                         return 'wastage';
      if (to === 'Store Transfer' || to === 'Franchise Transfer' || to === 'HO Warehouse') return 'transfer';
      if (to === 'Same Store (In-House Use)')                                              return 'internal';
      return 'other_out';
    default:               return 'unknown';
  }
}
function isIn(t) { return classify(t).direction === 'in'; }
// HO-supply predicate. W44-R3 (Codex-2/AGY-2): for a TRANSFER-LINKED row the SERVER STEPS PROJECTION is
// authoritative — checked BEFORE any client-mutable field. The client `stockFromStoreId` label is
// trusted ONLY for transferless (direct-log) rows, where no step exists. Previously the client field
// was read first, so a genuine HO transfer relabelled to a peer store escaped billing (free stock),
// and a peer transfer relabelled 'head_office' was over-billed. Now the transfer's own genesis source
// decides. (The integrity gate above the valuation loop separately proves the transfer exists, has a
// genesis, delivers to THIS store, and contains this product.)
function isHOSupply(t, projections) {
  if (t.transferId) {
    const proj = projections.get(t.transferId);
    if (proj) return proj.hasGenesis ? proj.fromStoreId === HEAD_OFFICE : false;   // steps exist => server truth, ignore client labels
    // no projection: a genuine PRE-EPOCH legacy transfer (the integrity gate has already proven it is
    // pre-epoch — a post-epoch no-steps row blocked before reaching here), so its structured field is
    // the only source evidence and is trustworthy for a pre-Chunk-4 row. Fall through.
  }
  if (t.stockFromStoreId) return t.stockFromStoreId === HEAD_OFFICE;             // transferless direct-log / pre-epoch legacy
  const fromBase = baseLabel(t.stockFrom);
  if (fromBase) return fromBase === 'HO Warehouse';
  return /head\s*office|from ho\b/i.test(t.reason || '');
}
// W44-R3 (Codex-2/AGY-2): the single LEDGER-INTEGRITY gate for a transfer-linked row, bound to the
// SERVER steps projection — run BEFORE any classification/HO-supply skip so a mutated `type`, source
// label, product, or destination can't route the row past it. Returns null (ok) or a block reason.
function transferIntegrity(t, e, projections, storeId, stepsEpochId) {
  const proj = projections.get(t.transferId);
  if (!proj) {
    // no steps at all: legacy ONLY if the row provably predates the Chunk-4 steps epoch (SR-129).
    const provId = e.list === 'archive' ? t.sourceId : t._spId;
    if (!validVersion(provId)) return 'PROVENANCE_ABSENT';
    if (provId >= stepsEpochId) return 'POST_EPOCH_NO_STEPS';
    return null;   // genuine pre-epoch legacy — valued via the lens downstream
  }
  if (!proj.hasGenesis) return 'ORIGIN_UNPROVEN';                                // steps present, no origin (SR-122)
  if (proj.toStoreId !== storeId && proj.fromStoreId !== storeId) return 'STORE_NOT_IN_TRANSFER';   // the transfer must involve this store (Codex-2c)
  if (!proj.items.has(t.productId)) return 'PRODUCT_NOT_IN_TRANSFER';            // the row's product must belong to its claimed transfer (Codex-2a)
  return null;
}

// ── Pricing chain (P1 — the SAME chain as the client lens: storeMap[productId] -> globalMap[productId]
// -> storeMap['*'], WHOLE-CONFIG validation first; S-286 proves parity vs the real client Pricing) ────
function validStoreMap(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  for (const k of Object.keys(m)) { if (k !== '*' && !reqId(k)) return false; if (!validPricingSeries(m[k])) return false; }
  return true;
}
function validGlobalMap(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  for (const k of Object.keys(m)) { if (!reqId(k)) return false; if (!validPricingSeries(m[k])) return false; }  // no '*' in global (client validConfig parity)
  return true;
}
function resolveSeries(series, dateMs) {   // series pre-validated; [from,to) as-of walk
  for (const p of series) {
    const f = Date.parse(p.from);
    if (!Number.isFinite(f) || dateMs < f) continue;
    const t = p.to == null ? Infinity : Date.parse(p.to);
    if (dateMs < t) return p.rate;
  }
  return null;
}
function rateAsOf(storeMap, globalMap, productId, dateMs) {
  if (!Number.isFinite(dateMs)) return { error: 'PRICING_DATA_ERROR' };
  if (productId != null && !reqId(productId)) return { error: 'PRICING_DATA_ERROR' };
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (productId != null && hasOwn(storeMap, productId)) { const r = resolveSeries(storeMap[productId], dateMs); if (r != null) return { rate: r, source: 'store-override' }; }
  if (productId != null && hasOwn(globalMap, productId)) { const r = resolveSeries(globalMap[productId], dateMs); if (r != null) return { rate: r, source: 'global' }; }
  if (hasOwn(storeMap, '*')) { const r = resolveSeries(storeMap['*'], dateMs); if (r != null) return { rate: r, source: 'store-default' }; }
  return { notSet: true };
}

// ── Step fold -> item-stamp projection (P6 tier 2 — the SAME fold precedence as the client:
// records.js foldTransfer/_applyReceive/_applyResolve stamp subset; S-284 proves parity) ─────────────
function sortSteps(steps) {   // mirrors records.js sortSteps: seq (default 50) -> timestamp -> stepId
  return steps.slice().sort((a, b) => {
    const sa = (a.seq != null ? a.seq : 50), sb = (b.seq != null ? b.seq : 50);
    if (sa !== sb) return sa - sb;
    const ta = a.timestamp || 0, tb = b.timestamp || 0;
    if (ta !== tb) return ta - tb;
    return String(a.stepId).localeCompare(String(b.stepId));
  });
}
// Validate one step payload LINE's stamp claim (basis x authority cross-classes per W4.3 SR-162/167):
// returns {tuple|null(absent), basis} or the string reason when MALFORMED (the SR-169 stop class).
function readLineStamps(ln) {
  const tup = readTuple(ln.sellAtSupply, ln.discAtSupply, ln.pricingVersion, ln.catalogueVersion);
  if (tup === null) return 'PARTIAL_TUPLE';
  const basis = ln.basis != null ? ln.basis : null;
  if (basis !== null && basis !== 'submit-stamped' && basis !== 'receive-stamped' && basis !== 'legacy-lens') return 'BAD_BASIS';
  if ((basis === 'submit-stamped' || basis === 'receive-stamped') && tup.absent) return 'STAMPED_BASIS_NO_AUTHORITY';
  if (basis === 'legacy-lens' && !tup.absent) return 'LEGACY_BASIS_WITH_AUTHORITY';
  return { tuple: tup.absent ? null : tup, basis };
}
// Fold ONE transfer's steps into the item-stamp projection. Mirrors the client fold's stamp decisions
// exactly; ADDITIONALLY records which step MINTED the current tuple and whether that step carries the
// server semantic attestation (SR-153 — the client never sees attestation; the engine requires it).
// Returns { hasGenesis, originType, fromStoreId, toStoreId, items: Map(productId -> item) } | {error}.
// item = { tuple|null, basis|null, untrusted, mintAttested }.
function foldProjection(stepsForTransfer) {
  const sorted = sortSteps(stepsForTransfer);
  let t = null;
  for (const s of sorted) {
    const p = s.payload || {};
    const attested = s._attested === true;
    if (s.stepType === 'submit' || (s.stepType === 'backfill' && p.snapshot)) {
      const isBackfill = s.stepType === 'backfill';
      const base = isBackfill ? p.snapshot : p;
      // W44-R4: the genesis instant is authoritative for a transfer-linked row's window + lens date
      // (row createdAt/date are client-editable — Codex/AGY-4). Submit step: its own timestamp; a
      // backfill snapshot carries submittedAt/date.
      const gMs = (s.stepType === 'submit' && Number.isFinite(s.timestamp)) ? s.timestamp
        : (Date.parse(base.submittedAt || base.date || base.createdAt || '') || (Number.isFinite(s.timestamp) ? s.timestamp : null));
      t = { hasGenesis: true, originType: isBackfill ? 'backfill' : 'submit', submitMs: gMs,
            fromStoreId: s.fromStoreId || base.fromStoreId || '', toStoreId: s.toStoreId || base.toStoreId || '', items: new Map() };
      for (const it of (base.items || [])) {
        if (!it || !reqId(it.productId)) return { error: 'MALFORMED_STEP_LINE' };
        const r = readLineStamps(it);
        if (typeof r === 'string') return { error: r };
        // W44-R4 (Codex/AGY-2): the AUTHORITATIVE dispatched quantity from the server step — the
        // reconciliation below binds each ledger row's editable qty to it. sentQty at submit; the
        // received quantity overrides at receive (what actually landed and is billed).
        const sQty = Number.isFinite(it.sentQty) ? it.sentQty : null;
        // Backfill-sourced stamps are UNTRUSTED (SR-154/W4.3 amendment 2 — never tier-2 evidence).
        t.items.set(it.productId, { tuple: r.tuple, basis: r.basis, untrusted: isBackfill && !!r.tuple, mintAttested: !isBackfill && !!r.tuple && attested, qty: sQty, received: false });
      }
    } else if (!t) {
      continue;   // a step before its genesis — same hold as the client fold (re-pull reconciles)
    } else if (s.stepType === 'receive') {
      for (const ln of (p.lines || [])) {
        const item = ln && t.items.get(ln.productId);
        if (!item) continue;
        if (Number.isFinite(ln.receivedQty)) { item.qty = ln.receivedQty; item.received = true; }   // W44-R4: received overrides sent as the billed authority
        const r = readLineStamps(ln);
        if (typeof r === 'string') return { error: r };
        const lnStamped = !!r.tuple, itemStamped = !!item.tuple;
        // BASIS PRECEDENCE (SR-86/97): a stamped item is permanent; a stamped receive line fills a
        // stampless item; a step tuple upgrades an untrusted backfill tuple; a basis-less receive of a
        // stampless submit sets legacy-lens durably.
        if (lnStamped && !itemStamped) { item.tuple = r.tuple; item.basis = r.basis || 'receive-stamped'; item.untrusted = false; item.mintAttested = attested; }
        else if (lnStamped && itemStamped && item.untrusted) { item.tuple = r.tuple; item.basis = r.basis || item.basis; item.untrusted = false; item.mintAttested = attested; }
        else if (!lnStamped && !itemStamped && !item.basis) { item.basis = 'legacy-lens'; }
      }
    } else if (s.stepType === 'resolve') {
      for (const rl of (p.resolutions || [])) {
        const item = rl && t.items.get(rl.productId);
        if (!item) continue;
        const r = readLineStamps(rl);
        if (typeof r === 'string') return { error: r };
        if (r.tuple) { item.tuple = r.tuple; item.untrusted = false; item.mintAttested = attested; }   // the resolve PINS the outcome (SR-85)
        if (r.basis) item.basis = r.basis;
      }
    }
    // cancel: return rows inherit the item state (SR-88) — no projection change needed.
  }
  return t || { hasGenesis: false, originType: null, submitMs: null, fromStoreId: '', toStoreId: '', items: new Map() };
}

// ── The engine ───────────────────────────────────────────────────────────────────────────────────────
function refuse(reason, detail) { return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail }; }

function validAttest(a, needRun) {
  return !!(a && typeof a === 'object' && !Array.isArray(a) && a.complete === true && reqId(a.leaseId)
    && (!needRun || validVersion(a.runVersion)));
}

function buildBuybackExport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('BAD_INPUT');
  const { storeId, rows, steps, controls, badVersionEvidence, pricing, window, products, coverage, graceClosed, drain } = input;

  // A) envelope (conv-R4/R5 discipline: present-but-wrong-typed FAILS CLOSED; nothing silently defaults)
  if (!reqId(storeId)) return refuse('BAD_STORE_ID');
  if (!window || typeof window !== 'object' || Array.isArray(window) || !isIsoUtc(window.from) || !isIsoUtc(window.to)) return refuse('BAD_WINDOW');
  const fromMs = Date.parse(window.from), toMs = Date.parse(window.to);
  if (!(fromMs < toMs)) return refuse('BAD_WINDOW');
  // SR-90: provenance REQUIRED — a flat/unmarked row set cannot implement per-list tombstone semantics.
  if (!rows || typeof rows !== 'object' || Array.isArray(rows) || !Array.isArray(rows.live) || !Array.isArray(rows.archive)) return refuse('BAD_ROWS_SHAPE');
  if (!Array.isArray(steps)) return refuse('BAD_STEPS_SHAPE');
  if (!controls || typeof controls !== 'object' || Array.isArray(controls) || !Array.isArray(controls.live) || !Array.isArray(controls.archive)) return refuse('BAD_CONTROLS_SHAPE');
  const manifest = controls.activeManifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !validVersion(manifest.version)
    || !manifest.controlHeads || typeof manifest.controlHeads !== 'object' || Array.isArray(manifest.controlHeads)) return refuse('BAD_CONTROLS_SHAPE');
  for (const k of Object.keys(manifest.controlHeads)) if (!reqId(k)) return refuse('BAD_CONTROLS_SHAPE', 'controlHeads key: ' + k);
  if (!badVersionEvidence || typeof badVersionEvidence !== 'object' || Array.isArray(badVersionEvidence) || !Array.isArray(badVersionEvidence.entries)) return refuse('BAD_EVIDENCE_SHAPE');
  for (const q of badVersionEvidence.entries) {
    if (!q || typeof q !== 'object' || Array.isArray(q) || !reqId(q.rowId)) return refuse('BAD_EVIDENCE_SHAPE', 'entry');
    if (q.terminal != null && q.terminal !== 'corrected-and-reattested' && q.terminal !== 'rejected') return refuse('BAD_EVIDENCE_SHAPE', q.rowId + ':terminal');
  }
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) return refuse('MALFORMED_PRICING');
  // A multi-store `stores` object / franchisee-keyed map fails structurally: its values are MAPS, not
  // series, and validPricingSeries rejects them (P1 — the route pre-selects the single billing map).
  if (!validStoreMap(pricing.storeMap)) return refuse('MALFORMED_PRICING', 'storeMap');
  if (!validGlobalMap(pricing.globalMap)) return refuse('MALFORMED_PRICING', 'globalMap');
  if (!Array.isArray(products)) return refuse('BAD_PRODUCTS');
  for (const p of products) { if (!p || typeof p !== 'object' || !reqId(p.id)) return refuse('BAD_PRODUCTS'); }
  if (graceClosed !== true && graceClosed !== false) return refuse('BAD_INPUT', 'graceClosed');
  if (drain != null && (typeof drain !== 'object' || Array.isArray(drain) || !Array.isArray(drain.graceRecords))) return refuse('BAD_DRAIN_SHAPE');

  // B) coverage — query-completion evidence under ONE continuous lease (P4). Refusal, never a silently
  // short settlement.
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) return refuse('BAD_COVERAGE');
  if (coverage.continuity !== true) return refuse('BAD_COVERAGE', 'continuity');
  if (!validAttest(coverage.live, true)) return refuse('BAD_COVERAGE', 'live');
  if (!validAttest(coverage.archive, true)) return refuse('BAD_COVERAGE', 'archive');
  if (!validAttest(coverage.steps, false)) return refuse('BAD_COVERAGE', 'steps');
  if (!coverage.controls || !validAttest(coverage.controls.live, false) || !validAttest(coverage.controls.archive, false)) return refuse('BAD_COVERAGE', 'controls');
  if (!validAttest(coverage.badVersion, false)) return refuse('BAD_COVERAGE', 'badVersion');
  if (!validVersion(coverage.stepsEpochId)) return refuse('BAD_COVERAGE', 'stepsEpochId');
  const lease = coverage.live.leaseId;
  for (const a of [coverage.archive, coverage.steps, coverage.controls.live, coverage.controls.archive, coverage.badVersion]) {
    if (a.leaseId !== lease) return refuse('LEASE_MISMATCH');
  }
  if (coverage.live.runVersion !== coverage.archive.runVersion) return refuse('RUN_VERSION_MISMATCH');
  // The attested union must BE the settlement window (P4) — exact bounds, both lists.
  for (const a of [coverage.live, coverage.archive]) {
    if (!a.window || a.window.from !== window.from || a.window.to !== window.to) return refuse('BAD_COVERAGE', 'window mismatch');
  }

  // C) rows — validate + normalize (P2/P7). Malformed = STOP (SR-169: the ingest boundary enforces
  // these; a violation in engine input proves the boundary was bypassed).
  const all = [];
  for (const list of ['live', 'archive']) {
    for (const raw of rows[list]) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('MALFORMED_ROW', list);
      if (!reqId(raw.id)) return refuse('MALFORMED_ROW', 'id');
      if (raw.storeId !== storeId) return refuse('WRONG_STORE_ROW', raw.id);        // P2 re-check
      if (typeof raw.type !== 'string') return refuse('MALFORMED_ROW', raw.id + ':type');
      if (!reqId(raw.productId)) return refuse('MALFORMED_ROW', raw.id + ':productId');
      if (typeof raw.qty !== 'number' || !isFinite(raw.qty) || raw.qty < 0) return refuse('MALFORMED_ROW', raw.id + ':qty');
      if (!isIsoUtc(raw.createdAt)) return refuse('BAD_ROW_INSTANT', raw.id);       // SR-25: window boundary needs a valid UTC instant
      if (raw.date != null && (typeof raw.date !== 'string' || !DATE_RE.test(raw.date) || !Number.isFinite(Date.parse(raw.date + 'T00:00:00.000Z')))) return refuse('MALFORMED_ROW', raw.id + ':date');
      if (raw.idempotencyKey != null && typeof raw.idempotencyKey !== 'string') return refuse('MALFORMED_ROW', raw.id + ':idempotencyKey');
      const tup = readTuple(raw.sellAtSupply, raw.discAtSupply, raw.pricingVersion, raw.catalogueVersion);
      if (tup === null) return refuse('MALFORMED_ROW', raw.id + ':stamps');         // partial/out-of-policy authority tuple
      const rv = readTuple(raw._rvSell, raw._rvDisc, raw._rvPv, raw._rvCv);
      if (rv === null) return refuse('MALFORMED_ROW', raw.id + ':resolved');        // server-owned fields malformed = corruption
      if (raw.unitPriceAtTime != null && !validMoney(raw.unitPriceAtTime)) return refuse('MALFORMED_ROW', raw.id + ':unitPriceAtTime');
      all.push({ row: raw, list, tuple: tup.absent ? null : tup, rv: rv.absent ? null : rv, instantMs: Date.parse(raw.createdAt) });
    }
  }

  // D) dedup — BOTH identities (P3, SR-96/109 per CHUNK8 item 5).
  const byId = new Map();
  let legacyKeyedRowCount = 0;
  const keyOwners = new Map();   // non-empty IdempotencyKey -> Set(TransactionId)
  const deduped = [];
  for (const e of all) {
    const prior = byId.get(e.row.id);
    if (prior) {
      if (canon(prior.row) !== canon(e.row)) return refuse('DUPLICATE_ID_CONFLICT', e.row.id);   // differing same-ID copies FAIL CLOSED (SR-55)
      if (prior.list !== e.list) prior.inBoth = true;   // bit-identical collapse
      continue;
    }
    byId.set(e.row.id, e);
    deduped.push(e);
    const k = e.row.idempotencyKey;
    if (k == null || k === '') legacyKeyedRowCount++;   // blanks NEVER group (SR-109) — surfaced legacy count
    else {
      if (!keyOwners.has(k)) keyOwners.set(k, new Set());
      keyOwners.get(k).add(e.row.id);
    }
  }
  for (const [k, ids] of keyOwners) {
    if (ids.size > 1) return refuse('IDEMPOTENCY_KEY_CONFLICT', k + ' -> ' + Array.from(ids).join(','));   // one economic op duplicated = corrupt state
  }

  // E) steps -> projections (validated fold; any malformed line is a refusal per SR-169)
  const stepsByTransfer = new Map();
  const stepIds = new Set();
  for (const s of steps) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return refuse('MALFORMED_STEP');
    if (!reqId(s.recordId)) return refuse('MALFORMED_STEP', 'recordId');
    if (typeof s.stepType !== 'string') return refuse('MALFORMED_STEP', s.recordId);
    if (s.payload != null && (typeof s.payload !== 'object' || Array.isArray(s.payload))) return refuse('MALFORMED_STEP', s.recordId + ':payload');
    if (s.stepId != null) stepIds.add(String(s.stepId));
    if (!stepsByTransfer.has(s.recordId)) stepsByTransfer.set(s.recordId, []);
    stepsByTransfer.get(s.recordId).push(s);
  }
  const projections = new Map();
  for (const [tid, sset] of stepsByTransfer) {
    const proj = foldProjection(sset);
    if (proj.error) return refuse('MALFORMED_STEP_STAMPS', tid + ':' + proj.error);
    projections.set(tid, proj);
  }
  // W44-R4 (Codex/AGY-2,3): the AUTHORITATIVE HO-supply line set — every (transferId, productId) HO
  // dispatched to THIS store, keyed to the server step's quantity. Each such line must be claimed by the
  // supplied ledger rows summing to EXACTLY that quantity (built + reconciled around the valuation loop),
  // so an editable qty, a type flipped out of the cost filter, a product swapped within a transfer, or a
  // transferId repointed all fail closed — the ledger row is a pointer, the step is the authority.
  const hoLines = new Map();   // `${transferId}|${productId}` -> { qty, transferId, productId }
  for (const [tid, proj] of projections) {
    if (!proj.hasGenesis || proj.fromStoreId !== HEAD_OFFICE || proj.toStoreId !== storeId) continue;
    for (const [pid, item] of proj.items) {
      if (!Number.isFinite(item.qty)) return refuse('MALFORMED_STEP_STAMPS', tid + '|' + pid + ':qty');   // an HO line with no server quantity is unbindable
      hoLines.set(tid + '|' + pid, { qty: item.qty, transferId: tid, productId: pid });
    }
  }

  // F) controls — typed, target-bound, head-verified (P2, SR-115/123/124/130/144/151).
  const drainIdentitySet = new Set();
  if (drain) for (const g of drain.graceRecords) {
    if (!g || typeof g !== 'object') return refuse('BAD_DRAIN_SHAPE');
    for (const idList of [g.presentedIds, g.writtenIds]) {
      if (idList != null) { if (!Array.isArray(idList)) return refuse('BAD_DRAIN_SHAPE', g.id); for (const id of idList) if (typeof id === 'string') drainIdentitySet.add(id); }
    }
  }
  // A control may target a supplied ROW identity, a DRAIN-presented identity, or a QUEUED BAD_VERSION
  // identity (SR-168 view coverage: the covering control's target is the quarantined row, which by
  // construction never entered the ledger). Anything else is untargeted (P2).
  const queuedIds = new Set(badVersionEvidence.entries.map(q => q.rowId));
  const suppliedIdentity = (id) => byId.has(id) || drainIdentitySet.has(id) || queuedIds.has(id);
  const controlByTarget = new Map();   // targetTransactionId -> { ctl, list }
  const seenControlIds = new Map();    // controlId -> canonical form (dedup by control id, SR-145)
  for (const list of ['live', 'archive']) {
    for (const c of controls[list]) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) return refuse('MALFORMED_CONTROL', list);
      if (!reqId(c.controlId)) return refuse('MALFORMED_CONTROL', 'controlId');
      if (c.type !== 'deletion' && c.type !== 'replacement') return refuse('MALFORMED_CONTROL', c.controlId + ':type');   // exactly TWO types; no delta (SR-124)
      if (!reqId(c.targetTransactionId)) return refuse('MALFORMED_CONTROL', c.controlId + ':target');
      if (!validVersion(c.revision) || !validVersion(c.bornPublicationVersion)) return refuse('MALFORMED_CONTROL', c.controlId + ':revision');
      const priorC = seenControlIds.get(c.controlId);
      if (priorC !== undefined) { if (priorC !== canon(c)) return refuse('CONTROL_AMBIGUITY', c.controlId); continue; }
      seenControlIds.set(c.controlId, canon(c));
      const target = c.targetTransactionId;
      if (!suppliedIdentity(target)) return refuse('UNTARGETED_CONTROL', c.controlId);   // must target a supplied row/drain identity
      if (controlByTarget.has(target)) return refuse('CONTROL_AMBIGUITY', target);        // one ACTIVE control per target (SR-144); fail closed on multiples
      // Cross-list check (SR-70): a control must live in the SAME list as its target row (a drain-only
      // identity has no list to cross — its control stands on its own list's attestation).
      const targetEntry = byId.get(target);
      if (targetEntry && targetEntry.list !== list && !targetEntry.inBoth) return refuse('CROSS_LIST_CONTROL_CONFLICT', c.controlId + '->' + target);
      // PER-TARGET HEAD comparison (SR-148/151) — the supplied control must be EXACTLY the
      // published-effective revision; born <= active version; withdrawn targets carry null heads.
      const head = Object.prototype.hasOwnProperty.call(manifest.controlHeads, target) ? manifest.controlHeads[target] : undefined;
      if (head === undefined || head === null) return refuse('CONTROL_HEAD_MISMATCH', c.controlId + ':no-active-head');
      if (head.controlId !== c.controlId || head.revision !== c.revision || head.bornPublicationVersion !== c.bornPublicationVersion) return refuse('CONTROL_HEAD_MISMATCH', c.controlId);
      if (!(head.bornPublicationVersion <= manifest.version)) return refuse('CONTROL_HEAD_MISMATCH', c.controlId + ':born>active');
      if (c.type === 'replacement') {
        const r = c.row;
        if (!r || typeof r !== 'object' || Array.isArray(r)) return refuse('MALFORMED_CONTROL', c.controlId + ':row');
        if (!reqId(r.id)) return refuse('MALFORMED_CONTROL', c.controlId + ':row.id');   // the output row's id is a cost-line identity — validate it (chain/collision checks below rely on it)
        if (!isIsoUtc(r.originalEventAt)) return refuse('MALFORMED_CONTROL', c.controlId + ':originalEventAt');   // SR-130: window membership needs a validated UTC instant
        if (!reqId(r.productId) || typeof r.qty !== 'number' || !isFinite(r.qty) || r.qty < 0) return refuse('MALFORMED_CONTROL', c.controlId + ':row');
        if (r.storeId !== storeId) return refuse('MALFORMED_CONTROL', c.controlId + ':storeId');
        if (typeof r.type !== 'string') return refuse('MALFORMED_CONTROL', c.controlId + ':type');
        const rt = readTuple(r.sellAtSupply, r.discAtSupply, r.pricingVersion, r.catalogueVersion);
        if (rt === null || rt.absent) return refuse('MALFORMED_CONTROL', c.controlId + ':stamps');   // an UNSTAMPED replacement is malformed (SR-130/134)
        if (r.unitPriceAtTime != null && !validMoney(r.unitPriceAtTime)) return refuse('MALFORMED_CONTROL', c.controlId + ':unitPriceAtTime');
        // W44-R1 (Codex-2): the replacement's ORIGINAL-EVENT instant must be BOUND to the target it
        // substitutes (SR-130/134: the correction route binds it from the AUTHORITATIVE target). When the
        // target row is SUPPLIED, the engine re-checks the binding: an originalEventAt that disagrees with
        // the target's own economic instant would move the replacement's window membership INDEPENDENTLY of
        // the original — a Director-supplied out-of-window instant would then EXCLUDE an in-window original
        // AND drop its own line, silently under-billing the store owner and breaking SR-142 delta exactness.
        // (A target NOT in the supplied set — archived-not-pulled / drain-only — is trusted per SR-134's
        // server-side authoritative fetch; there is no local instant to compare against.)
        { const te = byId.get(target); if (te && Date.parse(r.originalEventAt) !== te.instantMs) return refuse('CONTROL_INSTANT_MISMATCH', c.controlId + '->' + target); }
        c._tuple = rt;
      }
      controlByTarget.set(target, { ctl: c, list });
    }
  }
  // Completeness the other way (SR-151): an ACTIVE head over a supplied identity whose control was NOT
  // supplied means the route omitted an effective control — the settlement would count a corrected row.
  for (const target of Object.keys(manifest.controlHeads)) {
    const head = manifest.controlHeads[target];
    if (head !== null && suppliedIdentity(target) && !controlByTarget.has(target)) return refuse('MISSING_CONTROL', target);
  }
  // W44-R2 (Codex-1): a replacement CHAIN — a control whose target is itself the OUTPUT row of another
  // replacement — must FAIL CLOSED (SR-146: a chain never resolves to a single effective value). The
  // output row of a replacement is a server-minted identity: no other control may target it, no two
  // replacements may mint the same one, and it must be DISJOINT from every supplied ledger row (else the
  // original re-enters as a replacement output AND is counted again — the double-charge Codex found).
  const replacementOutputs = new Set();
  for (const { ctl } of controlByTarget.values()) {
    if (ctl.type !== 'replacement') continue;
    const oid = ctl.row.id;
    if (replacementOutputs.has(oid)) return refuse('CONTROL_OUTPUT_COLLISION', oid);   // two replacements minting one output id
    replacementOutputs.add(oid);
  }
  for (const oid of replacementOutputs) {
    if (controlByTarget.has(oid)) return refuse('CONTROL_CHAIN', oid);          // another control targets this replacement's output
    if (byId.has(oid)) return refuse('CONTROL_OUTPUT_COLLISION', oid);          // the output id collides with a supplied ledger row
  }

  // G) effective economic set — apply controls, then the window (P2/P3).
  // EVERY validated control target is a covered identity (deletion / replaced original) — including
  // drain-only and queue-only targets whose row never arrived (SR-107 terminal outcomes).
  const coveredSet = new Set(controlByTarget.keys());
  const economic = [];            // { row, tuple, rv, instantMs, list, isControl }
  for (const e of deduped) {
    if (controlByTarget.has(e.row.id)) continue;   // deletion removes; replacement substitutes below
    economic.push(e);
  }
  for (const [target, held] of controlByTarget) {
    if (held.ctl.type !== 'replacement') continue;
    const r = held.ctl.row;
    economic.push({ row: r, tuple: held.ctl._tuple, rv: null, instantMs: Date.parse(r.originalEventAt), list: held.list, isControl: true });
  }

  // H) valuation + aggregation (P6/P7 — the invoice parity core, S-285).
  const productById = new Map(products.map(p => [p.id, p]));
  const finalBlockers = [];
  const surfaced = { pendingValuations: [], notSet: [], lineErrors: [], unclassified: [] };
  const costLines = [];
  const usage = {};              // productId -> { category -> qty }
  const claimedHO = new Map();   // `${transferId}|${productId}` -> summed billed row qty (W44-R4 reconciliation)
  let revenue = 0, legacyPriceFallbackCount = 0, salesQty = 0, refundQty = 0;
  const block = (code, id) => finalBlockers.push(code + ':' + id);
  const utcMidnight = (ms) => Date.parse(new Date(ms).toISOString().slice(0, 10) + 'T00:00:00.000Z');

  for (const e of economic) {
    const t = e.row;
    const inWindow = e.instantMs >= fromMs && e.instantMs < toMs;   // [from,to): at `to` EXCLUDED (S-W4-5)
    if (!inWindow) continue;                                        // post-buy-back HO rows never leak in
    // W44-R3 (Codex-2/AGY-2): LEDGER-INTEGRITY GATE — runs for EVERY in-window transfer-linked row
    // BEFORE any classification/HO-supply skip. A row that fails (no/late steps, wrong store, wrong
    // product) is surfaced + held FINAL and contributes NO economics — it cannot be hidden by mutating
    // its `type` (AGY-2a: a bad type used to `continue` at the classifier before integrity ran) or its
    // source label (AGY-2b). Control rows are server-minted (integrity is their head check).
    if (t.transferId && !e.isControl) {
      const bad = transferIntegrity(t, e, projections, storeId, coverage.stepsEpochId);
      if (bad) { block(bad, t.id); surfaced.lineErrors.push(t.id + ':' + bad); continue; }
    }
    const cls = classify(t);
    const cat = category(t);
    if (cls.direction === 'none') { if (cat !== 'deleted') surfaced.unclassified.push(t.id); continue; }
    if (cat === 'unknown' || cat === 'other_out') surfaced.unclassified.push(t.id);
    // usage tally (every effective economic in-window row)
    const u = usage[t.productId] || (usage[t.productId] = {});
    u[cat] = (u[cat] || 0) + t.qty;

    // retail profit — sales revenue at the FROZEN UnitPriceAtTime (K4); legacy fallback surfaced.
    // Kunal 2026-07-20 (N9): revenue is NET OF CUSTOMER REFUNDS — a return_in (category 'return') is a
    // returned sale and is DEDUCTED at the same frozen price. (HO returns — a transfer_out to HO — are
    // NOT credited against the supply bill: Kunal's rule is that returned supply is treated as a fresh HO
    // arrival because it was already billed to the franchisee; so it stays usage-only, no cost-line credit.)
    const unitOf = (t) => { const p = productById.get(t.productId); if (Number.isFinite(t.unitPriceAtTime)) return t.unitPriceAtTime; legacyPriceFallbackCount++; return (p && typeof p.price === 'number' && isFinite(p.price)) ? p.price : 0; };
    if (cat === 'sale') { revenue += unitOf(t) * t.qty; salesQty += t.qty; }
    // W44-R3 (Codex-1): ONLY a CUSTOMER return reverses a sale — store/franchise/supplier returns are
    // not refunds (mirrors the client `_grossSales` guard index.html:4423). The classifier input is the
    // StockFrom label ('Customer' | 'Another Store' | 'Franchise Store' | 'Supplier').
    else if (cat === 'return' && baseLabel(t.stockFrom) === 'Customer') { revenue -= unitOf(t) * t.qty; refundQty += t.qty; }

    // HO-supply COST LINES — the invoice's exact line filter (category delivery/transfer, incoming,
    // HO-sourced), then the full W4.3 valuation precedence. Control rows face the SAME filter on their
    // own carried fields — a replacement correcting a NON-HO movement must never become a billed line.
    if (!(isIn(t) && (cat === 'delivery' || cat === 'transfer') && isHOSupply(t, projections))) continue;   // not HO supply — integrity already gated above
    // W44-R4 (Codex/AGY-2,3): record this row's CLAIM on its authoritative HO transfer line. The row's
    // editable qty is summed here and reconciled against the server quantity after the loop — so a
    // lowered/inflated qty, a product-swap within the transfer, or a repointed transferId all fail closed.
    // Only STEP-BACKED rows (a genesis projection exists) participate; a genuine PRE-epoch legacy transfer
    // has no server line to bind to (its authenticity rests on the validated pre-epoch provenance id,
    // SR-129 — a flagged residual: pre-Chunk-4 rows carry no server-side quantity).
    if (t.transferId && !e.isControl) { const pj = projections.get(t.transferId); if (pj && pj.hasGenesis) claimedHO.set(t.transferId + '|' + t.productId, (claimedHO.get(t.transferId + '|' + t.productId) || 0) + t.qty); }
    const p = productById.get(t.productId);
    let sell = (p && typeof p.price === 'number' && isFinite(p.price)) ? p.price : 0;
    let disc = null, lineErr = null, source = null, paid = true;

    if (e.isControl) {
      // Server-minted control row: tier-1 BY PROVENANCE — the SR-151 head check IS the proof (SR-150);
      // never faces the origin assertion, even cross-product (SR-145: the server minted its stamps).
      sell = e.tuple.sell; disc = e.tuple.disc; source = 'control';
    } else if (e.tuple) {
      // TIER 1 — row stamps, trusted by PROVENANCE only (SR-152/153/155):
      if (!t.transferId) {
        if (t._attested === true) { sell = e.tuple.sell; disc = e.tuple.disc; source = 'stamped'; }
        else { sell = 0; disc = 0; lineErr = 'UNATTESTED'; paid = false; block('UNATTESTED_ROW', t.id); }   // never paid; FINAL refused
      } else {
        const proj = projections.get(t.transferId);
        const item = proj && proj.items.get(t.productId);
        if (item && item.tuple && !item.untrusted && item.mintAttested && tupleEq(e.tuple, item.tuple)) { sell = e.tuple.sell; disc = e.tuple.disc; source = 'stamped'; }
        else { sell = 0; disc = 0; lineErr = 'UNATTESTED'; paid = false; block('UNCORROBORATED_ROW', t.id); }
      }
    } else if (t.transferId) {
      const proj = projections.get(t.transferId);
      if (proj) {
        if (!proj.hasGenesis) { sell = 0; disc = 0; lineErr = 'ORIGIN_UNPROVEN'; paid = false; block('ORIGIN_UNPROVEN', t.id); }   // steps present, no origin (SR-122)
        else {
          const item = proj.items.get(t.productId);
          if (item && item.tuple) {
            if (item.untrusted) {
              // BACKFILL-only stamps are never evidence (SR-154/158) — server-resolved values or a
              // surfaced pending state; FINAL not blocked either way.
              if (e.rv) { sell = e.rv.sell; disc = e.rv.disc; source = 'server-resolved'; }
              else { sell = 0; disc = 0; lineErr = 'VALUATION_PENDING'; paid = false; surfaced.pendingValuations.push(t.id); }
            } else if (item.mintAttested) { sell = item.tuple.sell; disc = item.tuple.disc; source = 'transfer-stamped'; }   // TIER 2 — the stale-receiver class (SR-97)
            else { sell = 0; disc = 0; lineErr = 'UNATTESTED'; paid = false; block('UNATTESTED_ITEM', t.id); }               // N3: unattested mint never pays
          } else {
            disc = null;   // wholly-absent evidence -> TIER 3 lens below
          }
        }
      } else {
        // NO steps at all: legacy ONLY if the row provably predates the Chunk-4 steps epoch (SR-129) —
        // live rows by their own SP item id, archived rows by the preserved SourceId; absent => refuse.
        const provId = e.list === 'archive' ? t.sourceId : t._spId;
        if (!validVersion(provId)) { sell = 0; disc = 0; lineErr = 'PROVENANCE_ABSENT'; paid = false; block('PROVENANCE_ABSENT', t.id); }
        else if (provId >= coverage.stepsEpochId) { sell = 0; disc = 0; lineErr = 'POST_EPOCH_NO_STEPS'; paid = false; block('POST_EPOCH_NO_STEPS', t.id); }   // the resurrection corner — PROVISIONAL + surfaced
        // else: genuine pre-epoch legacy -> lens below
      }
    }
    // TIER 3 — the lens, as-of the pricing-commitment day at UTC midnight (SR-25). W44-R4 (Codex/AGY-4):
    // for a transfer-linked row the authoritative day is the SUBMIT step instant (server truth), NOT the
    // row's editable `date` — else shifting a legacy-lens row's date moves its franchise rate. A pre-epoch
    // legacy transfer (no step) has no server day and falls back to its own date (flagged residual).
    if (disc === null && !lineErr) {
      let lensMs = null;
      if (t.transferId && !e.isControl) { const proj = projections.get(t.transferId); if (proj && proj.hasGenesis && Number.isFinite(proj.submitMs)) lensMs = utcMidnight(proj.submitMs); }
      if (lensMs == null && t.date != null) lensMs = Date.parse(t.date + 'T00:00:00.000Z');
      if (lensMs == null) { sell = 0; disc = 0; lineErr = 'PRICING_DATA_ERROR'; paid = false; block('NO_LENS_DATE', t.id); }
      else {
        const r = rateAsOf(pricing.storeMap, pricing.globalMap, t.productId, lensMs);
        if (r.error) { disc = 0; lineErr = r.error; paid = false; block('LENS_' + r.error, t.id); }
        else if (r.notSet) { disc = 0; lineErr = 'NOT_SET'; }   // honest per-line-date NOT SET — loud, still billed at 0%
        else { disc = r.rate; source = r.source; }
      }
    }
    // A stamped honest 0% stays LOUD (W4.3 R1 AGY-2) — surfaced, never a silent full-price line.
    if (!lineErr && source && source !== 'store-override' && source !== 'global' && source !== 'store-default' && disc === 0) lineErr = 'NOT_SET';
    if (lineErr === 'NOT_SET') surfaced.notSet.push(t.id);
    else if (lineErr) surfaced.lineErrors.push(t.id + ':' + lineErr);
    const full = paid ? sell * t.qty : 0;
    const discAmt = paid ? full * (disc / 100) : 0;
    costLines.push({ transactionId: t.id, productId: t.productId, date: t.date || null, qty: t.qty, sell: paid ? sell : null, discPct: paid ? disc : null, full, discAmt, owed: full - discAmt, source, lineErr, control: !!e.isControl });
  }

  // W44-R4 (Codex/AGY-2,3): RECONCILE the claimed HO rows against the authoritative line set. Every HO
  // line the server dispatched to this store must be claimed by billed rows summing to EXACTLY its
  // quantity — a shortfall (a row dropped, typed out of the cost filter, window-evaded, or qty-lowered)
  // and an excess (qty inflated, product/transfer repointed onto a line) both fail closed. The ledger
  // row is a pointer; the step is the authority.
  // A DELETION/REPLACEMENT control legitimately removes a supplied row from ordinary billing (the
  // replacement bills via the control path, a deletion writes it off), so its quantity is netted OUT of
  // the line's expected ordinary claim — else a Director correction would trip the reconciliation.
  const controlledLineQty = new Map();
  for (const target of controlByTarget.keys()) {
    const te = byId.get(target);
    if (te && te.row.transferId && Number.isFinite(te.row.qty)) {
      const k = te.row.transferId + '|' + te.row.productId;
      controlledLineQty.set(k, (controlledLineQty.get(k) || 0) + te.row.qty);
    }
  }
  for (const [key, line] of hoLines) {
    const expected = line.qty - (controlledLineQty.get(key) || 0);
    const claimed = claimedHO.get(key) || 0;
    if (claimed !== expected) block('HO_LINE_QTY_MISMATCH', key + ' expected ' + expected + ' got ' + claimed);
  }
  for (const key of claimedHO.keys()) {
    if (!hoLines.has(key)) block('UNBOUND_HO_CLAIM', key);   // a billed transfer-linked row with no authoritative HO line (belt-and-braces; the integrity gate normally precludes it)
  }

  // I) FINAL evaluation (P5) — graceClosed + drain + presented-identity accounting + BAD_VERSION view.
  if (graceClosed !== true) finalBlockers.push('GRACE_OPEN');
  if (!drain) finalBlockers.push('NO_DRAIN_EVIDENCE');
  else {
    for (const g of drain.graceRecords) {
      if (g.state !== 'committed') { block('GRACE_NOT_TERMINAL', g.id != null ? g.id : '?'); continue; }   // consumed-but-not-committed = NOT drained
      // W44-R1 (Codex-1): a committed grace record MUST carry its FULL presented manifest + written set
      // (SR-171: the manifest is bound at CONSUMPTION, so a consumed/committed record without it is
      // incomplete attestation). A MISSING manifest is NOT "presented nothing" — the two are
      // indistinguishable, and treating absence as empty let a mid-flush escaped row evade the
      // presented-identity accounting entirely (FINAL closing over lost data — the exact SR-171 class).
      // An EMPTY array is legitimate (a flush that presented nothing); a MISSING field is malformed.
      // W44-R2 (Codex-2): the EXPECTED-STEP list joins the manifest-completeness requirement. A committed
      // record with presented/written rows but an ABSENT expectedStepIds let a suppressed minting step
      // slip through (the row fell to the lens instead of its attested stamp, and FINAL closed over it) —
      // the same "absence read as empty" class as R1's presented manifest. An EMPTY list stays legitimate
      // (a flush of stepless direct-log rows); a MISSING field is incomplete attestation.
      if (!Array.isArray(g.presentedIds) || !Array.isArray(g.writtenIds) || !Array.isArray(g.expectedStepIds)) { block('DRAIN_MANIFEST_MISSING', g.id != null ? g.id : '?'); continue; }
      for (const sid of (g.expectedStepIds || [])) {
        if (!stepIds.has(String(sid))) block('STEP_NOT_INGESTED', sid);   // drain proves STEP ingest too (SR-122)
      }
      // SR-94/171: every PRESENTED identity must be ACCOUNTED — PRESENT in the (deduped) rows, COVERED
      // by a validated same-list control head, or QUEUED in badVersionEvidence. None => refuse FINAL.
      for (const id of (g.presentedIds || [])) {
        if (!(byId.has(id) || coveredSet.has(id) || queuedIds.has(id))) block('UNACCOUNTED_IDENTITY', id);
      }
      for (const id of (g.writtenIds || [])) {
        if (!(byId.has(id) || coveredSet.has(id))) block('WRITTEN_ROW_MISSING', id);   // SR-94 containment proof
      }
    }
  }
  // BAD_VERSION queue (SR-165/168/170): stored-terminal OR view-covered unblocks; anything else holds
  // FINAL. Coverage is a DERIVED VIEW over the active control heads — evaluated here, never stored
  // (entries were shape-validated at the envelope).
  for (const q of badVersionEvidence.entries) {
    // W44-R3 (AGY-1): a corrected-and-reattested entry unblocks FINAL ONLY when the corrected row is
    // ACTUALLY PRESENT in the settlement (a ledger row or a control target). A Director's re-attestation
    // does not produce a client grace record, so the row is absent from writtenIds — without this check a
    // franchisee could delete the corrected row from the payload and finalize with it silently omitted.
    if (q.terminal === 'corrected-and-reattested') {
      if (!(byId.has(q.rowId) || controlByTarget.has(q.rowId))) block('CORRECTED_ROW_MISSING', q.rowId);
      continue;
    }
    if (q.terminal === 'rejected' && q.rejectedAccounted === true) continue;   // a bare rejection cannot unblock (SR-165)
    const head = Object.prototype.hasOwnProperty.call(manifest.controlHeads, q.rowId) ? manifest.controlHeads[q.rowId] : undefined;
    if (head != null && controlByTarget.has(q.rowId)) continue;                 // view-covered by the ACTIVE supplied control (withdraw auto-reopens: null head falls through)
    block('BAD_VERSION_OPEN', q.rowId);
  }

  const status = finalBlockers.length === 0 ? 'FINAL' : 'PROVISIONAL';
  const totalFull = costLines.reduce((s, l) => s + l.full, 0);
  const totalDisc = costLines.reduce((s, l) => s + l.discAmt, 0);
  const totalOwed = costLines.reduce((s, l) => s + l.owed, 0);
  return {
    ok: true,
    settlement: {
      schemaVersion: 1,
      storeId, window: { from: window.from, to: window.to },
      status, provisionalReasons: finalBlockers,
      costLines, totals: { full: totalFull, discount: totalDisc, owed: totalOwed },
      usage,
      retailProfit: { revenue, salesQty, refundQty, supplyCost: totalOwed, profit: revenue - totalOwed, legacyPriceFallbackCount },   // revenue is NET of customer refunds (N9, Kunal 2026-07-20)
      meta: {
        legacyKeyedRowCount,
        rowCounts: { live: rows.live.length, archive: rows.archive.length, deduped: deduped.length, economicInWindow: costLines.length },
        coveredIdentities: Array.from(coveredSet),
        pendingValuations: surfaced.pendingValuations,
        notSet: surfaced.notSet,
        lineErrors: surfaced.lineErrors,
        unclassified: surfaced.unclassified,
        coverage: { leaseId: lease, runVersion: coverage.live.runVersion },
      },
    },
  };
}

// ── HTTP handler (thin adapter for the staging-apply gated route — N5) ──────────────────────────────
app.http('buybackExport', {
  methods: ['POST'], authLevel: 'function',
  handler: async (request) => {
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { ok: false, reason: 'bad json' } }; }
    return { jsonBody: buildBuybackExport(body) };
  },
});

module.exports = { buildBuybackExport, readTuple, readLineStamps, foldProjection, sortSteps, rateAsOf, classify, category, isIn, isHOSupply, validMoney, validDiscPct, validVersion, validStoreMap, validGlobalMap, canon };
