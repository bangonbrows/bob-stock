// BOB Stock — Azure Function: CORRECTION COMPUTE (OS-W4.4 Contract 2, N2).
// Spec: AZURE-CHUNK-ORG-W44-C2-DESIGN.md — SPEC CONVERGED 2026-07-25 (Codex R25 PASS "No findings"
// + AGY PASS confirmed unconditionally on the same revision; 25 review rounds, fold records R1-R24
// in the design doc). This function is the route's PURE DECISION CORE: the correction Logic App
// (N1) does ALL SharePoint I/O and hands the gathered state here; every economically meaningful
// decision — digests, target capture, stamp minting, delta arithmetic, candidate assembly,
// recovery, sweep classification, claim dispatch, push idempotency, export blocking — is computed
// HERE deterministically so the LA carries no logic. Nothing in this file performs I/O.
//
// Engine coupling: targetLine quantity authority and tier-(b) stamps come from the FROZEN engine's
// OWN exported foldProjection (buybackExport.js — resolve-pinned > received > sent; the SOLE
// definition, C2-R1-12). Canonical row equality reuses attestRows' econ-v1 canonical (two rows are
// "the same row" iff their signed canonicals are byte-equal, C2-R14-5).
//
// Ops (POST { op, ...inputs } -> pure JSON result; also exported for the proof suite):
//   digest            opId-reuse digest over {mode, target, expected, control, actorUsername}
//   targetLine        targetLine + originalEventAt capture (§5 P4; uses the REAL foldProjection)
//   stamps            replacement stamp minting, tier (a)/(b)/STAMPS_UNRESOLVABLE (SR-134/145)
//   delta             the delta-exactness law — all mode cells + the NORMALIZATION LAW (§5 P4)
//   candidate         deterministic ids + CandidateHeads + AdoptionDecisions assembly (P4/P5.1)
//   recoveryDecision  per-entry CandidateHeads test vs the active manifest (§6, C2-R2-7)
//   membership        tombstone TransactionId ∈ the N17 recorded set (C2-R10-3/C2-R11-3)
//   sweepClassify     the archive-cleanup classification (N10 — epoch, ledger-state mode split,
//                     signed member list, positive crash proof; C2-R17-1..C2-R24-1)
//   claimDispatch     the §8 own-claim state machine (registry x N18 x main-ledger)
//   pushIdempotency   the global Live+Archive TransactionId check (N9/C2-R21-3/C2-R22-2)
//   exportBlocker     the §7b(4) headless predicate (absent-target-key only, C2-R21-4)
//   rowsEqual         canonical byte-equality of two ledger rows (econ-v1 canonical)
'use strict';

const { app } = require('@azure/functions');
const crypto = require('crypto');
const path = require('path');
const engine = require(path.join(__dirname, 'buybackExport.js'));
const attest = require(path.join(__dirname, 'attestRows.js'));

// Local mirrors of engine-internal validators (not exported by the frozen engine; values pinned to
// its definitions — buybackExport.js:100-115. The proof suite asserts parity with engine behaviour
// through the real foldProjection/readTuple paths, so drift here cannot go unnoticed.)
function reqId(v) { return typeof v === 'string' && v.length > 0 && v.length <= 128; }
function validQty(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }
function isIsoUtc(s) {
  if (typeof s !== 'string') return false;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === s; // round-trip rejection of rolled-over dates (W2 rule)
}
const refuse = (reason, detail) => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail });

// ── SharePoint row -> ENGINE row shape (interim LA review, generated-artifact round) ───────────────
// Every ledger row the LA hands us comes straight off a SharePoint list: PascalCase columns, and the
// ARCHIVE list additionally aliases three econ fields (TxnType/TxnDate/TxnTimestamp, archive-def:220
// — the same aliasing normalizeArchiveRow already handles for pushIdempotency). The ops below read
// the ENGINE row form (buybackExport.js:25-34: id/type/productId/storeId/qty/timestamp/transferId/
// the four authority fields). Nothing bridged the two, so a fetched target arrived as an EMPTY
// engine row: targetLine refused BAD_TARGET_INSTANT on every call, mintStamps could never resolve
// tier (a), and every delta row failed validEconRow.
// WHY HERE AND NOT IN THE WORKFLOW: a 25-field column map is a decision about shape, and decisions
// live in the compute core (the F1 rule). Expressing it as setProperty chains in WDL would put the
// mapping beyond the reach of the proof suite and duplicate it at five call sites.
// Rows ALREADY in engine shape pass through byte-for-byte (no engine key appears in the map), so
// every existing fixture and every trigger-supplied replacement is unaffected.
const SP_TO_ENGINE = {
  TransactionId: 'id', StoreId: 'storeId', ProductId: 'productId',
  Type: 'type', TxnType: 'type', Qty: 'qty', Date: 'date', TxnDate: 'date',
  Timestamp: 'timestamp', TxnTimestamp: 'timestamp', TransferId: 'transferId', Reason: 'reason',
  StockFrom: 'stockFrom', StockTo: 'stockTo', StockFromStoreId: 'stockFromStoreId',
  StockToStoreId: 'stockToStoreId', IdempotencyKey: 'idempotencyKey',
  TargetTransactionId: 'targetTransactionId', UnitPriceAtTime: 'unitPriceAtTime',
  SellAtSupply: 'sellAtSupply', DiscAtSupply: 'discAtSupply', PricingVersion: 'pricingVersion',
  CatalogueVersion: 'catalogueVersion', ArchiveRunId: 'archiveRunId',
  SnapshotVersion: 'snapshotVersion', SourceId: 'sourceId', ControlId: 'controlId',
  ControlType: 'controlType', ControlRevision: 'controlRevision', ControlState: 'controlState',
};
// SharePoint Number columns can echo back as numeric STRINGS through the passthru, and the engine
// validators are TYPE-STRICT (Number.isSafeInteger), so a '8' would fail validQty exactly like a
// missing field. Coerce ONLY on an exact numeric round-trip; anything else is left alone to fail
// closed rather than be guessed at.
const NUMERIC_ENGINE_FIELDS = ['qty', 'timestamp', 'unitPriceAtTime', 'sellAtSupply', 'discAtSupply',
  'pricingVersion', 'catalogueVersion', 'snapshotVersion'];
function toEngineRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const mapped = SP_TO_ENGINE[k];
    if (mapped === undefined) { out[k] = v; continue; }
    // never let a blank alias (an empty Type column) beat the real aliased value, and never
    // overwrite a value the row already carries in engine shape
    if (out[mapped] === undefined || out[mapped] === null || out[mapped] === '') out[mapped] = v;
  }
  for (const f of NUMERIC_ENGINE_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v.trim() !== '' && String(Number(v.trim())) === v.trim()) out[f] = Number(v.trim());
  }
  return out;
}

// ── digest — the opId-reuse guard (§5 request contract) ─────────────────────────────────────────────
// JSON-array-framed canonical (never a join — field-boundary injection class, C1 lesson).
// stableClone: deep clone with RECURSIVELY SORTED object keys — a canonical serialization, so a
// semantically identical retry with a different key order hashes identically (C2-LA finding 9).
function stableClone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(stableClone);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = stableClone(v[k]);
  return out;
}
function opDigest(input) {
  const i = input || {};
  const parts = ['c2-op-v1',
    i.mode == null ? null : String(i.mode),
    i.targetTransactionId == null ? null : String(i.targetTransactionId),
    i.expected == null ? null : [
      // explicit-null activeControlId is a DISTINCT legal value (the withdrawn baseline, C2-R6-2)
      Object.prototype.hasOwnProperty.call(i.expected, 'activeControlId') ? [1, i.expected.activeControlId] : [0],
      i.expected.revision == null ? null : i.expected.revision,
      i.expected.publicationVersion == null ? null : i.expected.publicationVersion
    ],
    i.control == null ? null : stableClone(i.control),
    i.actorUsername == null ? null : String(i.actorUsername)
  ];
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// ── targetLine + originalEventAt (§5 P4; C2-R1-12) ─────────────────────────────────────────────────
// Inputs: target = the fetched target row (engine field shape: transferId?, productId, id, ...);
// steps = the enumerated RecordSteps for target.transferId (empty array when none);
// targetSealValid = the P3.2 three-way outcome ('valid' | 'broken' | 'unsealed-legacy').
function computeTargetLine(input) {
  const t = toEngineRow(input.target) || {};   // the LA hands us the RAW SharePoint row (see toEngineRow)
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (t.transferId) {
    if (steps.length === 0) return refuse('TARGET_PRE_EPOCH'); // transfer-linked, no steps (D-C2-2 manual lane)
    const proj = engine.foldProjection(steps);
    if (proj.error) return refuse('STEP_FOLD_ERROR', proj.error);
    if (!proj.hasGenesis) return refuse('TARGET_PRE_EPOCH');
    // The target row must BE one of the transfer's authoritative ledger identities (§5 P4).
    if (!proj.hasLedgerKeys || !proj.ledgerKeys.has(t.id)) return refuse('ROW_NOT_IN_TRANSFER_LEDGER', t.id);
    const item = proj.items.get(t.productId);
    if (!item || !validQty(item.qty)) return refuse('ROW_NOT_IN_TRANSFER_LEDGER', t.productId);
    if (!Number.isFinite(proj.submitMs)) return refuse('STEP_FOLD_ERROR', 'no submit instant');
    // originalEventAt: the SUBMIT step's instant — the engine equality-checks exactly this
    // (buybackExport.js:552-553 compares Date.parse(originalEventAt) === proj.submitMs).
    return { ok: true, targetLine: { transferId: t.transferId, productId: t.productId, qty: item.qty },
      originalEventAt: new Date(proj.submitMs).toISOString() };
  }
  // Transferless: targetLine from the row ONLY if C1-sealed; unsealed transferless => omitted.
  const instant = t.timestamp != null && Number.isFinite(t.timestamp) ? new Date(t.timestamp).toISOString() : null;
  if (!instant || !isIsoUtc(instant)) return refuse('BAD_TARGET_INSTANT');
  if (input.targetSealValid === 'valid') {
    return { ok: true, targetLine: null, transferless: { productId: t.productId, qty: t.qty }, originalEventAt: instant };
  }
  return { ok: true, targetLine: null, transferless: null, originalEventAt: instant };
}

// ── stamps — replacement minting (SR-134/145 + C2-R1-11; D-C2-1 no lens tier) ──────────────────────
// tier (a): the target row's stored four-tuple ONLY if valid AND product AND store AND
// classification (Type) identity all match the replacement's.
// tier (b): the transfer's ITEM stamps for the REPLACEMENT product via foldProjection —
// trusted (not backfill-untrusted) and mint-attested only.
function mintStamps(input) {
  // §5 CONTRACT: `control.row` is ECONOMIC IDENTITY ONLY — it carries NO storeId. The replacement's
  // store is the TARGET's store (completeReplacement), so the SR-145/C2-R1-11 store conjunct below is
  // satisfied BY CONSTRUCTION rather than by a client value, and a storeId smuggled into
  // `control.row` can never widen tier (a).
  const t = toEngineRow(input.target) || {}, r = completeReplacement(input.replacement, input.target);
  const tup = engine.readTuple(t.sellAtSupply, t.discAtSupply, t.pricingVersion, t.catalogueVersion);
  if (tup && !tup.absent
      // NOTE: the STORE conjunct is now satisfied BY CONSTRUCTION (completeReplacement takes storeId
      // from the TARGET row), so it can no longer FAIL. It is KEPT, not deleted, so SR-145/C2-R1-11
      // conformance stays readable at the check site — but do NOT treat it as the defence against a
      // caller storeId. That defence is completeReplacement's key whitelist, and that is where any
      // future test of the store vector belongs.
      && t.productId === r.productId && t.storeId === r.storeId && t.type === r.type) {
    return { ok: true, tier: 'a', stamps: { sellAtSupply: tup.sell, discAtSupply: tup.disc, pricingVersion: tup.pv, catalogueVersion: tup.cv } };
  }
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (steps.length > 0) {
    const proj = engine.foldProjection(steps);
    if (!proj.error && proj.hasGenesis) {
      const item = proj.items.get(r.productId);
      if (item && item.tuple && !item.untrusted && item.mintAttested) {
        return { ok: true, tier: 'b', stamps: { sellAtSupply: item.tuple.sell, discAtSupply: item.tuple.disc, pricingVersion: item.tuple.pv, catalogueVersion: item.tuple.cv } };
      }
    }
  }
  return refuse('STAMPS_UNRESOLVABLE'); // D-C2-1: fail closed, no lens tier
}

// ── delta — the delta-exactness law (§5 P4: general law + all cells + the NORMALIZATION LAW) ───────
// effect(row) per (storeId, productId): +qty inbound, −qty outbound (the engine's own classifier).
// C2-LA finding 4: every row entering delta arithmetic is VALIDATED first — a malformed row
// (negative/fractional qty, missing ids) must never publish a balance change.
// Interim LA review R2 finding 3b: "any non-empty type" was too weak. The FROZEN engine classifies
// 'deleted' and every UNKNOWN type as direction 'none' (buybackExport.js classify) — it folds them
// as NOTHING — while effectOf's isIn()?+1:-1 scored them as OUTBOUND. An archived +10 target with a
// 'deleted' replacement therefore published a -15 delta that the engine would never agree with, so
// snapshot arithmetic and settlement diverged permanently. A replacement always carries a real
// movement type (deletions use the *-delete cells, which pass no newOutput), so a directionless row
// entering delta arithmetic is malformed BY CONSTRUCTION: refuse it, never score it.
function hasEconDirection(type) {
  const d = engine.classify({ type }).direction;
  return d === 'in' || d === 'out';
}
function validEconRow(row) {
  return !!row && reqId(row.storeId) && reqId(row.productId) && validQty(row.qty)
    && typeof row.type === 'string' && row.type.length > 0 && hasEconDirection(row.type);
}
function effectOf(rawRow) {
  if (!rawRow) return null;
  // ONE seam covers target / newOutput / prevOutput / originalTarget: every row entering delta
  // arithmetic is normalised from SharePoint casing to the engine shape BEFORE validation, so a
  // fetched ledger row is judged on its real economics rather than rejected for its column names.
  const row = toEngineRow(rawRow);
  if (!validEconRow(row)) return { invalid: true };
  const dir = engine.isIn(row) ? 1 : -1;
  return { key: row.storeId + '|' + row.productId, amount: dir * row.qty };
}
function addDelta(map, eff, sign) {
  if (!eff) return null;
  if (eff.invalid) return 'INVALID_ROW';
  map[eff.key] = (map[eff.key] || 0) + sign * eff.amount;
  return null;
}
// input: { cell, targetLocation: 'live'|'archive', target?, newOutput?, prevOutput?, originalTarget?,
//          membership?: {decision:'excluded'|'in-balances'|'undecidable'} (adoption/retirement only) }
function computeDelta(input) {
  const cell = input.cell, deltas = {};
  // §5 CONTRACT: `newOutput` IS the caller's `control.row` — economic identity only, carrying no
  // storeId, which is the BALANCE KEY. Bind it to the TARGET row's store exactly as buildControlRow
  // does, so the sealed control row and the published balance cannot key off different stores and no
  // caller value can steer a delta onto another store's balance. `target` is sent on EVERY delta call.
  const newOutput = input.newOutput == null ? null : completeReplacement(input.newOutput, input.target);
  let err = null;
  const add = (row, sign) => { const e = addDelta(deltas, effectOf(row), sign); if (e && !err) err = e; };
  // NORMALIZATION LAW: live-target ensembles adjust NO balances in ANY cell (they are never in
  // balances; the N10 unit-move folds them at effective value when they archive).
  // Interim LA review R2 finding 3a: the live short-circuit used to sit HERE, ahead of every
  // validation, so a live-target replacement carrying qty:-5 returned ok/suppressed and could be
  // sealed and published as the ACTIVE control — the malformed row only surfaced later, at archive
  // time, where the unit-move silently dropped it (target suppressed by its head, replacement
  // skipped as invalid) and understated the balance. The cell arithmetic now ALWAYS runs, so the
  // rows a cell consumes are ALWAYS validated; the suppression is applied to the RESULT.
  const isLive = input.targetLocation === 'live';
  switch (cell) {
    case 'create-replace':   // first publication; archived create target is ALWAYS in balances
      add(input.target, -1); add(newOutput, +1); break;
    case 'create-delete':
      add(input.target, -1); break;
    case 'supersede-replace-replace':
      add(input.prevOutput, -1); add(newOutput, +1); break;
    case 'supersede-replace-delete':
      add(input.prevOutput, -1); break;
    case 'supersede-delete-replace':
      add(newOutput, +1); break;
    case 'withdraw':
      add(input.prevOutput, -1); add(input.originalTarget, +1); break;
    case 'null-replace':     // post-withdraw/retire baseline: the TARGET is the current effective value (C2-R6-2)
      add(input.originalTarget, -1); add(newOutput, +1); break;
    case 'null-delete':
      add(input.originalTarget, -1); break;
    case 'adopt': {          // first publication; in-snapshot gate by MEMBERSHIP (C2-R3-3/C2-R4-1)
      const m = input.membership && input.membership.decision;
      if (m === 'undecidable') return refuse('ADOPTION_DELTA_UNDECIDABLE');
      if (m === 'in-balances') add(input.target, -1);
      break;                 // 'excluded' => the archiver already excluded it => 0
    }
    case 'retire': {         // a NORMALIZING first publication (C2-R5-1): restore where the retired
      const m = input.membership && input.membership.decision; // tombstone had excluded the target
      if (m === 'undecidable') return refuse('RETIRE_DELTA_UNDECIDABLE');
      if (m === 'excluded') add(input.target, +1);
      break;                 // 'in-balances' (tombstone never folded) or live => 0
    }
    default: return refuse('UNKNOWN_CELL', cell);
  }
  if (err) return refuse(err); // C2-LA finding 4: a malformed row never publishes a balance change
  if (isLive) return { ok: true, deltas: {}, suppressed: 'live-ensemble' }; // R2 finding 3a
  return { ok: true, deltas };
}

// ── candidate — deterministic ids + CandidateHeads + AdoptionDecisions (§5 P4/P5.1) ────────────────
function assembleCandidate(input) {
  const mode = input.mode, opId = input.opId, rev = input.revision || 0, cv = input.candidateVersion;
  if (!reqId(opId) || !Number.isSafeInteger(cv)) return refuse('BAD_CANDIDATE_INPUT');
  const controlId = 'ctl:' + opId + (rev > 0 ? ':' + rev : '');
  const heads = {}, adoptionDecisions = {};
  if (mode === 'create' || mode === 'supersede') {
    if (!reqId(input.target)) return refuse('BAD_CANDIDATE_INPUT');
    heads[input.target] = { controlId, revision: rev, bornPublicationVersion: cv };
  } else if (mode === 'withdraw' || mode === 'retire_claim') {
    if (!reqId(input.target)) return refuse('BAD_CANDIDATE_INPUT');
    heads[input.target] = null; // the EXPLICIT-null withdrawn form (engine hasOwnProperty semantics)
    if (mode === 'retire_claim') adoptionDecisions[input.target] = { decision: (input.membership && input.membership.decision) || 'undecidable' };
  }
  for (const a of (input.adoptions || [])) { // adopt-mode heads AND every mode's opportunistic folds
    if (!reqId(a.tombstoneId) || !reqId(a.target)) return refuse('BAD_ADOPTION_INPUT');
    // THE CANONICAL HEAD SHAPE — the engine's exact field names (C2-R3-1, buybackExport.js:519).
    heads[a.target] = { controlId: a.tombstoneId, revision: 0, bornPublicationVersion: cv };
    adoptionDecisions[a.target] = { decision: (a.membership && a.membership.decision) || 'undecidable' };
  }
  if (Object.keys(heads).length === 0) return refuse('NO_PENDING_ADOPTIONS'); // C2-R3-5: empty set unbuildable
  const out = { ok: true, controlId, candidateHeads: heads, adoptionDecisions };
  // ECHO the inputs the caller must carry forward. The LA has to stamp these onto the journal,
  // registry and response, and it must NOT recompute them — the R1 rule is that the LA carries no
  // logic. Returning them here is what stops the LA doing arithmetic on a version number.
  out.candidateVersion = cv;
  out.revision = rev;
  out.journalId = 'jrn:' + opId + (rev > 0 ? ':' + rev : '');
  if (mode === 'create' || mode === 'supersede') {
    out.outputTransactionId = 'corr:' + opId + ':' + rev;
    // THE CONTROL ROW ITSELF (interim LA review, generated-artifact round). §B step 16 says the LA
    // "SP CREATEs the control row with N7 columns + minted stamps + TargetLine + OriginalEventAt",
    // but NO op returned that row — so the LA would have had to assemble it, violating the very
    // rule F1 established. It is built HERE, from the same inputs the delta was computed from, so
    // the signed row and the published balances cannot diverge.
    const row = buildControlRow(input, controlId, rev, cv, out.outputTransactionId);
    if (row.reason) return refuse(row.reason);
    out.row = row.row;
  }
  // ── THE P7 TERMINAL SHAPE (§B step 20). Which registry form a mode writes, whether it publishes a
  // control row at all, and which targets get their PublicationVersion filled are POLICY CHOICES, so
  // they are decided HERE and the LA merely executes them (the F1 rule). The LA used to write one
  // 'committed' shape for every mode, create a control row unconditionally (a null body on the modes
  // that build none), and ECHO Revision — a prior revision of 4 stayed 4 after a withdraw.
  out.publishesControlRow = mode === 'create' || mode === 'supersede';
  // THE REVISION THE REGISTRY ENDS ON. It must also be what the caller is TOLD, because modeGate
  // refuses the next correction unless expected.revision === the registry's Revision — reporting the
  // pre-bump number would EXPECTED_MISMATCH every follow-up on the same target.
  out.terminalRevision = (mode === 'supersede' || mode === 'withdraw' || mode === 'retire_claim') ? rev + 1 : rev;
  out.registryTerminal = mode === 'adopt' ? null : {
    State: 'committed',
    // '' IS the withdrawn null (§A, N3 ControlRegistry): withdraw/retire retire the head, OpId kept.
    ControlId: (mode === 'withdraw' || mode === 'retire_claim') ? '' : controlId,
    Revision: out.terminalRevision,
    PublicationVersion: cv,
  };
  out.adoptionFills = (input.adoptions || []).map(a => ({ targetTransactionId: a.target, publicationVersion: cv }));
  return out;
}

// The control row's exact shape — the ctl-v1 covered set (attestRows CTL_V1_FIELDS), no more and no
// less. A DELETION control carries the control identity only; the engine-row fields stay ABSENT so
// the typed canonical encodes them as [0] rather than as empty values.
// ── THE SERVER-COMPLETED REPLACEMENT (§5 request contract) ────────────────────────────────────────
// §5 pins `intent.control` to `{type:'deletion'} | {type:'replacement', row:{productId, qty, type,
// reason?, stockFrom?, stockTo?, stockFromStoreId?, stockToStoreId?}}` — "ECONOMIC identity only —
// stamps/instants NEVER accepted". This core read `control.controlType`/`control.replacement` and
// REQUIRED a caller `storeId` and `timestamp`, so every contract-shaped call refused
// BAD_REPLACEMENT_ROW — and had the shape matched, a Director could have BACKDATED a control row
// into a closed period and keyed a replacement's delta onto ANOTHER STORE's balance.
// The three non-contract fields are SERVER-DERIVED, from state the route already fetched:
//   StoreId    the TARGET row's own store — a correction is scoped to its target's store, and the
//              engine refuses any other outright (buybackExport.js:541 `r.storeId !== storeId`).
//   instant    `originalEventAt` — the transfer's SUBMIT step for a transfer-linked target, the
//              target row's stored instant otherwise (computeTargetLine). It is EXACTLY the value
//              the engine equality-checks (buybackExport.js:552-553) and is validated ISO-UTC
//              (SR-130). NEVER a clock read: this function must stay pure so a recovering worker
//              rebuilds the identical candidate (§6 roll-forward).
//   TransferId the SERVER-VALIDATED `targetLine.transferId` — isHOSupply resolves a control row's
//              billing from its transfer's own projection (buybackExport.js:180 reached from :659),
//              so a caller-chosen transferId would re-point the HO-supply decision.
// Anything the caller puts in those three keys is DROPPED, never read.
// Declared here rather than above its two earlier callers (mintStamps, computeDelta) deliberately —
// function declarations hoist; keeping the contract rule in ONE place is worth more than file order.
function completeReplacement(controlRow, targetRow) {
  const r = toEngineRow(controlRow) || {}, t = toEngineRow(targetRow) || {};
  return {
    storeId: t.storeId,                       // SERVER-DERIVED — never a caller field
    productId: r.productId, qty: r.qty, type: r.type,
    reason: r.reason, stockFrom: r.stockFrom, stockTo: r.stockTo,
    stockFromStoreId: r.stockFromStoreId, stockToStoreId: r.stockToStoreId,
  };
}

function buildControlRow(input, controlId, rev, cv, outputTransactionId) {
  const c = input.control || {};
  const type = c.type === 'deletion' ? 'deletion' : 'replacement';
  const row = {
    ControlId: controlId,
    ControlType: type,
    TargetTransactionId: input.target,
    ControlRevision: rev,
    BornPublicationVersion: cv,
    TargetLine: input.targetLine == null ? null : JSON.stringify(input.targetLine),
    OriginalEventAt: input.originalEventAt == null ? null : String(input.originalEventAt),
    ControlState: 'active',
  };
  // THE FOLD ABOVE ONLY PROTECTS REPLACEMENT ROWS. buybackExport.js:533 requires `targetLine` for
  // ANY control whose target row is TRANSFER-LINKED — that check sits OUTSIDE the
  // `c.type === 'replacement'` branch at :535, so a DELETION control is NOT exempt. Without this,
  // create-delete and supersede-*-delete seal and publish a control row with TargetLine null over a
  // transfer-linked target, the manifest names it the target's ACTIVE head, and the frozen engine
  // then refuses it FOREVER with MALFORMED_CONTROL ':targetLine-required', aborting the WHOLE
  // buyback export for that store — the identical failure mode the replacement fold exists to stop.
  // `input.targetRow` is already supplied to op:candidate by the C2-GEN-4 binding, so this needs no
  // new input.
  const tRow = toEngineRow(input.targetRow) || {};
  if (tRow.transferId && input.targetLine == null) return { reason: 'TARGET_LINE_UNRESOLVED' };
  if (type === 'deletion') return { row };

  // A replacement carries the FULL engine row form — the same fields the delta arithmetic consumed.
  const r = completeReplacement(c.row, input.targetRow);
  const s = input.stamps || {};
  const eventAt = input.originalEventAt == null ? '' : String(input.originalEventAt);
  const transferId = input.targetLine && input.targetLine.transferId ? String(input.targetLine.transferId) : '';
  // DIAGNOSABILITY, RECORDED DELIBERATELY: r.storeId is now SERVER-derived (completeReplacement takes
  // it from the fetched target row), so its absence is never the caller's doing — yet it still
  // reports under the CALLER's reason code, unlike the instant below. Kept as ONE guard rather than
  // minting a new reason string in a wave that is fixing reported defects only; the path is
  // reachable only via a binding regression, because Target_gate 404s an absent target first.
  // Listed in the known-gap block so an auditor sees the inconsistency named rather than hidden.
  if (!reqId(r.storeId) || !reqId(r.productId) || !validQty(r.qty) || !hasEconDirection(r.type)) {
    return { reason: 'BAD_REPLACEMENT_ROW' };
  }
  // ── THE P4 REFUSAL FOLD ──────────────────────────────────────────────────────────────────────
  // op:targetLine and op:stamps express refusal as HTTP 200 + {ok:false,reason}, so the LA bindings
  // body('Target_line')?['originalEventAt'] / body('Stamps')?['stamps'] simply resolve to NULL and
  // this function could not tell a refusal from a legitimately-absent value: it returned ok:true and
  // a control row carrying OriginalEventAt:null and all five stamp columns null, which the
  // Compute_gate passed, so the row was sealed under ctl-v1, written to the ledger and named by the
  // manifest as the target's ACTIVE head. The frozen engine then refuses it FOREVER
  // (buybackExport.js:537 ':originalEventAt', :543 ':stamps'), and one MALFORMED_CONTROL aborts the
  // WHOLE buyback export for that store.
  // WHY HERE AND NOT IN A LOGIC APP GATE: whether those refusals are fatal depends on the MODE
  // (withdraw/retire_claim/adopt publish no control row; a DELETION control legitimately carries no
  // stamps and no instant), so a WDL gate would have to encode the mode table — precisely the
  // condition tree F1 forbids. buildControlRow reaches this point ONLY for a create/supersede
  // REPLACEMENT row, so refusing here is mode-correct by construction and surfaces as
  // Candidate.ok=false, which the P4 Compute_gate stops on BEFORE Journal_create, the first durable
  // write of the correction.
  // Both predicates are the FROZEN ENGINE's own, not new policy:
  //  · originalEventAt is also the exact discriminator for an op:targetLine refusal —
  //    computeTargetLine returns it on EVERY success path (:146/:152/:154) and on NO refusal path,
  //    whereas targetLine itself is legitimately null for a transferless target. TARGET_LINE_
  //    UNRESOLVED, not BAD_REPLACEMENT_ROW: under the §5 contract the caller never supplies the
  //    instant, so blaming the caller's row would be a lie about where the fault is.
  //  · stamps — calling the ENGINE's own readTuple (all four present + validMoney/validDiscPct/
  //    validVersion) rather than hand-rolling a numeric test guarantees a row that passes here also
  //    passes buybackExport.js:543. UnitPriceAtTime is NOT checked: mintStamps never mints it
  //    (D-C1-3 keeps it informational, outside the seal).
  if (!isIsoUtc(eventAt)) return { reason: 'TARGET_LINE_UNRESOLVED' };
  const mintedTuple = engine.readTuple(s.sellAtSupply, s.discAtSupply, s.pricingVersion, s.catalogueVersion);
  if (mintedTuple === null || mintedTuple.absent) return { reason: 'STAMPS_UNRESOLVABLE' };
  Object.assign(row, {
    TransactionId: outputTransactionId,
    StoreId: r.storeId,
    ProductId: r.productId,
    Type: r.type,
    Qty: r.qty,
    // The instant is the SERVER's `originalEventAt`, never a caller field. THE STORED ENCODING IS
    // DELIBERATELY UNCHANGED BY THIS WAVE — `Date` stays Text 'YYYY-MM-DD' and `Timestamp` stays the
    // same ISO string it has always been written as. The only in-repo evidence that `Timestamp` is a
    // NUMBER column (diag-c1-insert.js:22 ['Timestamp','Number']) is that script's OWN scratch list
    // StockTransactions_DiagProbe (declared :12, created :40-44), not the live schema, and
    // snapshotCompute.js:259's Number(r.Timestamp) coerces either form, so it is not type evidence
    // either. ctl-v1 is a TYPED canonical (attestRows.js:178-191), so guessing wrong breaks the P5.4
    // re-read equality on EVERY create and supersede. Settle it by READING the column type before N1
    // is enabled anywhere — recorded in the known-gap block.
    Date: eventAt.slice(0, 10),
    Timestamp: eventAt,
    Reason: r.reason == null ? '' : String(r.reason),
    StockFrom: r.stockFrom == null ? '' : String(r.stockFrom),
    StockTo: r.stockTo == null ? '' : String(r.stockTo),
    StockFromStoreId: r.stockFromStoreId == null ? '' : String(r.stockFromStoreId),
    StockToStoreId: r.stockToStoreId == null ? '' : String(r.stockToStoreId),
    TransferId: transferId,
    IdempotencyKey: outputTransactionId,   // deterministic: the control row IS its own idempotency key
    UnitPriceAtTime: s.unitPriceAtTime == null ? null : Number(s.unitPriceAtTime),
    SellAtSupply: s.sellAtSupply == null ? null : Number(s.sellAtSupply),
    DiscAtSupply: s.discAtSupply == null ? null : Number(s.discAtSupply),
    PricingVersion: s.pricingVersion == null ? null : Number(s.pricingVersion),
    CatalogueVersion: s.catalogueVersion == null ? null : Number(s.catalogueVersion),
  });
  return { row };
}

// ── recoveryDecision — per-entry CandidateHeads vs the active manifest (§6, C2-R2-7/C2-R3-5) ───────
function headEqual(a, b) {
  if (a === null || b === null) return a === b;
  return !!a && !!b && a.controlId === b.controlId && a.revision === b.revision
    && a.bornPublicationVersion === b.bornPublicationVersion;
}
function recoveryDecision(input) {
  const cand = input.candidateHeads, cv = input.candidateVersion;
  const manifest = input.activeManifest || {}, mh = manifest.controlHeads || {};
  const keys = cand ? Object.keys(cand) : [];
  if (keys.length === 0) return { decision: 'INVARIANT_BROKEN', why: 'empty CandidateHeads is invalid by construction' };
  let present = 0;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(mh, k) && headEqual(mh[k], cand[k])) present++;
  }
  if (present === keys.length) return { decision: 'roll_forward' };
  if (present === 0 && Number.isSafeInteger(manifest.version) && manifest.version < cv) return { decision: 'roll_back' };
  return { decision: 'INVARIANT_BROKEN', why: present > 0 ? 'partial match (out-of-protocol writer)' : 'version >= candidate with heads absent' };
}

// ── membership — tombstone TransactionId ∈ the N17 recorded set (C2-R10-3/C2-R11-3) ────────────────
// input: { targetLocation, tombstoneTransactionId,
//          target: {archiveRunId, snapshotVersion},        // the ARCHIVED target row's bindings
//          runRecord: {RunId, SnapshotVersion, TombstoneIds, recordSigValid}|null }
// C2-LA finding 5: the record must BIND to the target — RunId must equal the target's ArchiveRunId
// AND SnapshotVersion must cohere (C2-R10-2) — else a wrong-run record silently mis-decides.
// Interim LA review R2 finding 4: the bind test was a bare !== comparison, so it PASSED when both
// sides were missing (undefined === undefined) — an unbound record then decided membership and, in
// the repro, excluded the target on nothing. Presence is now REQUIRED on both sides: a missing
// binding is undecidable, never a decision. The reader also accepts raw SharePoint casing
// (ArchiveRunId/SnapshotVersion) so a normalization gap in the LA cannot mis-key the comparison and
// make every legitimate archived adoption permanently undecidable; §B pins the mapping explicitly.
const bindStr = (o, ...keys) => { for (const k of keys) { const v = o[k]; if (v != null && v !== '') return String(v); } return null; };
const bindNum = (o, ...keys) => { for (const k of keys) { const v = o[k]; if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v); } return null; };
function membershipDecision(input) {
  if (input.targetLocation === 'live') return { ok: true, decision: 'live' }; // deltas suppressed anyway
  const rec = input.runRecord, t = input.target || {};
  if (!rec || rec.recordSigValid !== true || !Array.isArray(rec.TombstoneIds)) return { ok: true, decision: 'undecidable' };
  const tRun = bindStr(t, 'archiveRunId', 'ArchiveRunId'), rRun = bindStr(rec, 'RunId', 'runId');
  const tVer = bindNum(t, 'snapshotVersion', 'SnapshotVersion'), rVer = bindNum(rec, 'SnapshotVersion', 'snapshotVersion');
  if (tRun === null || rRun === null || tVer === null || rVer === null) return { ok: true, decision: 'undecidable' };
  if (rRun !== tRun || rVer !== tVer) return { ok: true, decision: 'undecidable' };
  return { ok: true, decision: rec.TombstoneIds.includes(input.tombstoneTransactionId) ? 'excluded' : 'in-balances' };
}

// ── sweepClassify — the archive-cleanup decision (N10, C2-R17-1..C2-R24-1) ─────────────────────────
// Pure classification: the LA gathers the archive rows, the run records, and the Live item-id set
// under the held lock + enumeration contract; this decides. Inputs:
//   rows: [{itemId, sourceId|null, archiveRunId|null, isControl, ctlSealValid}]
//   epoch: archiveC2EpochId
//   runRecords: { [runId]: { memberSourceIds:[...]|null, recordSigValid, publishedSigValid, stale, isCurrent } }
//   liveItemIds: [ids...]  (the COMPLETE Live enumeration — a Codex load-bearing build proof)
// Output: { delete:[], spare:[], halt:[{itemId?|runId, why}] }  — ANY halt entry aborts the sweep.
function sweepClassify(input) {
  const live = new Set(input.liveItemIds || []);
  const recs = input.runRecords || {};
  const out = { delete: [], spare: [], halt: [] };
  const byRun = new Map();
  for (const row of (input.rows || [])) {
    if (row.itemId <= input.epoch) { out.spare.push(row.itemId); continue; }        // pre-C2 LEGACY
    if (row.archiveRunId == null) {                                                  // direct-to-archive
      if (row.isControl && row.ctlSealValid === true) { out.spare.push(row.itemId); continue; } // its P6 manifest publication is its provenance
      out.halt.push({ itemId: row.itemId, why: 'above-epoch row with no run and no valid control seal' });
      continue;
    }
    if (!byRun.has(row.archiveRunId)) byRun.set(row.archiveRunId, []);
    byRun.get(row.archiveRunId).push(row);
  }
  for (const [runId, rows] of byRun) {
    const rec = recs[runId];
    if (!rec || rec.recordSigValid !== true || !Array.isArray(rec.memberSourceIds)) {
      // record-before-copy guarantees natural residue HAS a valid record => absence/corruption = TAMPER
      out.halt.push({ runId, why: 'above-epoch run with absent/corrupt N17 record (tamper)' });
      continue;
    }
    const intended = new Set(rec.memberSourceIds);
    for (const row of rows) {
      if (!intended.has(row.sourceId)) { out.halt.push({ itemId: row.itemId, why: 'SourceId not in the signed member list (tampered/planted)' }); }
    }
    if (out.halt.length > 0) continue;
    // THE LEDGER-STATE DISCRIMINATOR (C2-R24-1): subset mode ONLY while EVERY intended member is
    // still in Live (the pre-publication invariant). PublishedSig is a fast-path hint only.
    const allIntendedLive = rec.memberSourceIds.every(sid => live.has(sid));
    if (allIntendedLive) {
      // Genuinely unpublished (mid-copy/pre-publish) residue: authenticated subset => swept.
      for (const row of rows) out.delete.push(row.itemId);
    } else {
      // Cannot be unpublished => FULL-SET equality is REQUIRED (C2-R18-1 positive proof + C2-R24-1).
      // C2-LA finding 7: MULTISET equality — Set() loses duplicate SourceIds, so [101,101,102] vs
      // signed [101,102] would false-pass; compare sorted arrays element-for-element instead.
      const queried = rows.map(r => r.sourceId).slice().sort();
      const wanted = rec.memberSourceIds.slice().sort();
      const equal = queried.length === wanted.length && queried.every((v, i) => v === wanted[i]);
      if (equal) { for (const row of rows) out.spare.push(row.itemId); }             // published history
      else out.halt.push({ runId, why: 'published-run set deviation (missing/extra/duplicate member)' });
    }
  }
  return out;
}

// ── claimDispatch — the §8 own-claim state machine ─────────────────────────────────────────────────
// input: { match:'own'|'foreign'|'none', registryState, controlIdNull, n18Present, mainPresent,
//          mainIsOurs (canonical-equal + EconSig), mainCommitSigValid, intendedInLive? }
function claimDispatch(input) {
  if (input.match === 'foreign') return { action: 'quarantine_push', reason: 'CONTROL_TARGET_RESERVED' };
  if (input.match === 'none') return { action: 'proceed_new_claim' };
  switch (input.registryState) {
    case 'pending':
      return { action: 'reenter_pending' }; // finish the staged step (N18 insert -> pre-commit check -> CAS -> re-mint)
    case 'pending_supersede':
      // C2-R8-2/C2-R9-3: decide by read; never insert/quarantine/heal mid-Director-op.
      return input.mainPresent ? { action: 'ack_already_applied' } : { action: 'retry_transient' };
    case 'collision':
      return { action: 'resolve_collision' };  // ensure N18 deleted then release (C2-R16-3)
    case 'committed':
      if (input.controlIdNull) {
        // C2-LA finding 8: a leftover N18 row under a WITHDRAWN/retired claim must be CLEANED, never
        // left forever (the §6 matrix: committed(null)+N18 => delete N18, NEVER re-mint, C2-R13-1).
        return input.n18Present
          ? { action: 'delete_n18_then_ack_terminal', status: 'superseded_by_adjudication' }
          : { action: 'ack_terminal', status: 'superseded_by_adjudication' }; // C2-R7-3
      }
      if (input.mainPresent) {
        if (!input.mainIsOurs) return { action: 'control_id_collision' };            // C2-R17-3: never touch N18 blindly...
        if (!input.mainCommitSigValid) return { action: 'remint_commitsig_then_finish' }; // ours + bad sig (C2-R15-4)
        return input.n18Present ? { action: 'delete_n18_then_ack' } : { action: 'ack_ok' };
      }
      if (input.n18Present) return { action: 'run_remint' };                          // C2-R11-2: never an in-place flip
      return { action: 'control_row_missing' };                                       // C2-R9-2 (under the enumeration contract)
    default:
      return { action: 'retry_transient' };
  }
}

// ── pushIdempotency — the global Live+Archive TransactionId check (N9, C2-R21-3/C2-R22-2) ──────────
// input: { liveMatch: row|null, archiveMatch: row|null, incoming: row }  (source-first Live->Archive
// reads gathered by the LA). Exact canonical match => ack; differing => reject; none => proceed.
// C2-LA finding 6: the REAL archive list aliases three econ fields (TxnType/TxnDate/TxnTimestamp,
// archive-def:106) — normalize an archive row to the live/canonical shape BEFORE comparing, else a
// legitimate exact retry of an archived row canonicalises with blank Type/Date/Timestamp and is
// wrongly rejected as a mutated replay.
const ARCHIVE_ALIASES = { TxnType: 'Type', TxnDate: 'Date', TxnTimestamp: 'Timestamp' };
function normalizeArchiveRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const [a, f] of Object.entries(ARCHIVE_ALIASES)) {
    if (Object.prototype.hasOwnProperty.call(out, a)) {
      if (!Object.prototype.hasOwnProperty.call(out, f) || out[f] == null || out[f] === '') out[f] = out[a];
      delete out[a];
    }
  }
  return out;
}
function pushIdempotency(input) {
  const inc = input.incoming;
  const eq = (a, b) => a && b && attest.canonical(a) === attest.canonical(b);
  if (input.liveMatch) return eq(input.liveMatch, inc) ? { action: 'ack_duplicate' } : { action: 'reject_conflict', reason: 'DIFFERING_REPLAY' };
  if (input.archiveMatch) return eq(normalizeArchiveRow(input.archiveMatch), inc) ? { action: 'ack_archived_duplicate' } : { action: 'reject_conflict', reason: 'DIFFERING_REPLAY' };
  return { action: 'proceed' };
}

// ── exportBlocker — §7b(4): the headless predicate fires ONLY on an ABSENT target key (C2-R21-4) ───
// input: { targetKeyPresent: bool (hasOwnProperty on controlHeads), registryCommittedNonNull: bool,
//          materialized: bool }  — evaluated per headless row / committed claim.
function exportBlocker(input) {
  if (input.targetKeyPresent) return { blocked: false, why: 'target adjudicated (active or explicit-null head)' };
  if (input.registryCommittedNonNull && !input.materialized) return { blocked: true, reason: 'TOMBSTONE_PENDING_ADOPTION', why: 'committed claim not yet materialized (C2-R12-1 crash window)' };
  return { blocked: true, reason: 'TOMBSTONE_PENDING_ADOPTION', why: 'unadjudicated headless row' };
}

function rowsEqual(a, b) { return attest.canonical(a) === attest.canonical(b); }

// C2-LA finding 10: the P5.4 candidate verify must be FULL-FIELD — the econ-v1 canonical ignores the
// C2 control columns (ControlId/Revision/Born/TargetLine/OriginalEventAt), so a dropped control
// field would false-pass rowsEqual. ctlRowsEqual compares the ctl-v1 canonicals (control-level +
// full engine row form, typed 0/null/absent). §B pins that the ctl-v1 seal is minted from the
// INTENDED pre-write object and the re-read row is verified against THAT intent.
function ctlRowsEqual(a, b) {
  const ca = attest.canonicalFrame('ctl-v1', a), cb = attest.canonicalFrame('ctl-v1', b);
  return ca !== null && ca === cb;
}

// ── assembleSnapshot — the P6 payload builder (C2-LA finding 1a: NO map/array arithmetic in the LA)
// input: { snapshotConfigData (the P2-captured content, parsed), candidateVersion,
//          deltas: {'store|product': n}, candidateHeads }
// Returns the EXACT serialized ConfigData string for the single P6 MERGE: version bumped, balances
// adjusted, fence UNCHANGED, controlManifest = full prior heads + this publication's entries
// (explicit-null entries WRITTEN, never dropped — the hasOwnProperty withdraw semantics).
function assembleSnapshot(input) {
  const cfg = input.snapshotConfigData;
  if (!cfg || typeof cfg !== 'object' || !Number.isSafeInteger(input.candidateVersion)) return refuse('BAD_ASSEMBLY_INPUT');
  if (input.candidateVersion !== (cfg.version || 0) + 1) return refuse('BAD_ASSEMBLY_INPUT', 'candidateVersion must be captured version + 1');
  const out = JSON.parse(JSON.stringify(cfg));
  out.version = input.candidateVersion;
  if (out.fence == null) out.fence = 0;                       // first correction-era publish seeds fence
  const balances = Array.isArray(out.balances) ? out.balances : [];
  const idx = new Map(balances.map((b, i) => [b.storeId + '|' + b.productId, i]));
  for (const [key, delta] of Object.entries(input.deltas || {})) {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) return refuse('BAD_ASSEMBLY_INPUT', key);
    if (delta === 0) continue;
    if (idx.has(key)) balances[idx.get(key)].balance += delta;
    else {
      const [storeId, productId] = key.split('|');
      balances.push({ storeId, productId, balance: delta });
    }
  }
  out.balances = balances;
  const priorHeads = (out.controlManifest && out.controlManifest.controlHeads) || {};
  const heads = { ...priorHeads };
  for (const [target, head] of Object.entries(input.candidateHeads || {})) heads[target] = head; // null WRITTEN
  out.controlManifest = { version: input.candidateVersion, controlHeads: heads };
  return { ok: true, configData: JSON.stringify(out) };
}

// ── modeGate — the P3.4 mode-legality decision (C2-LA finding 1b: no condition trees in the LA) ────
// input: { mode, expected?, registryItem: {State, ControlId, Revision, PublicationVersion,
//          OpId, Origin}|null, beltTombstone: row|null (an existing unregistered tombstone found by
//          the belt query), retireEvidence?: {sealOutcome, provenancePreEpoch, rowAbsentEverywhere} }
function modeGate(input) {
  const reg = input.registryItem, mode = input.mode;
  const controlIdNull = !!reg && (reg.ControlId == null || reg.ControlId === '');
  const unadopted = !!reg && reg.State === 'committed' && (reg.PublicationVersion == null || reg.PublicationVersion === '');
  switch (mode) {
    case 'create':
      if (!reg) {
        if (input.beltTombstone) return { ok: false, reason: 'LAZY_ADOPTION_REQUIRED' }; // §4 C2-R1-4: register it, then the adopted-head lane
        return { ok: true, baseline: 'no-head', needs: ['target'] }; // first publication: the TARGET is the baseline
      }
      return { ok: false, reason: 'TARGET_RESERVED' };        // one registry item per target (SR-144)
    case 'supersede': case 'withdraw': {
      if (!reg || reg.State !== 'committed') return { ok: false, reason: reg ? 'TARGET_BUSY' : 'TARGET_NOT_CONTROLLED' };
      if (unadopted && !controlIdNull) return { ok: false, reason: 'TOMBSTONE_PENDING_ADOPTION' }; // C2-R2-6
      const e = input.expected;
      if (!e) return { ok: false, reason: 'EXPECTED_REQUIRED' };
      const wantNull = Object.prototype.hasOwnProperty.call(e, 'activeControlId') && e.activeControlId === null;
      if (controlIdNull !== wantNull) return { ok: false, reason: 'EXPECTED_MISMATCH' };
      if (!controlIdNull && e.activeControlId !== reg.ControlId) return { ok: false, reason: 'EXPECTED_MISMATCH' };
      if (e.revision !== reg.Revision || e.publicationVersion !== reg.PublicationVersion) return { ok: false, reason: 'EXPECTED_MISMATCH' };
      if (mode === 'withdraw' && controlIdNull) return { ok: false, reason: 'ALREADY_WITHDRAWN' };
      // `needs` tells the LA WHICH ROWS to fetch — it never decides that for itself. An active head
      // means a prior committed control row exists and its effect must be backed out, so the LA
      // fetches it; a null head means the baseline is the ORIGINAL target row instead.
      return { ok: true, baseline: controlIdNull ? 'null-head' : 'active-head',
               needs: controlIdNull ? ['originalTarget'] : ['priorControl'] };
    }
    case 'retire_claim': {
      if (!reg || reg.State !== 'committed' || controlIdNull || !unadopted || reg.Origin === 'director')
        return { ok: false, reason: 'RETIRE_NOT_APPLICABLE' }; // only a committed-UNADOPTED device claim
      const ev = input.retireEvidence || {};
      const laneA = ev.sealOutcome === 'unsealed-legacy' || (ev.sealOutcome === 'TARGET_SEAL_BROKEN' && ev.provenancePreEpoch === true);
      const laneB = ev.rowAbsentEverywhere === true;           // the journaled N18→L→A→Q enumeration IS the evidence (C2-R9-2)
      if (laneA || laneB) return { ok: true, lane: laneB ? 'absent-row' : 'pre-epoch-seal' };
      return { ok: false, reason: 'RETIRE_EVIDENCE_INSUFFICIENT' }; // a post-epoch unsealed claim stays LOCKED, loudly
    }
    case 'adopt': case 'reconcile':
      return { ok: true };                                     // no target argument; eligibility computed at P4
    default:
      return { ok: false, reason: 'UNKNOWN_MODE' };
  }
}

// ── deltaCell — WHICH delta-arithmetic branch applies (generated-artifact round) ────────────────────
// The LA used to read `cell` off modeGate, which never returned it — so computeDelta always got
// null and refused UNKNOWN_CELL. Choosing the branch is a DECISION (the six-cell table plus the
// null-head lane), so it belongs here, not in a Logic App condition tree (the F1 rule).
// It is a SEPARATE op from modeGate because the choice depends on the PRIOR control row's type,
// which the LA can only supply after fetching the row modeGate told it to fetch via `needs`.
// input: { mode, baseline: 'no-head'|'active-head'|'null-head', controlType: 'replacement'|'deletion',
//          priorControlType?: 'replacement'|'deletion' }
function deltaCell(input) {
  const mode = input.mode, base = input.baseline;
  const isDel = input.controlType === 'deletion';
  const priorDel = input.priorControlType === 'deletion';
  switch (mode) {
    case 'create':
      if (base !== 'no-head') return refuse('BAD_CELL_INPUT', 'create requires baseline no-head');
      return { ok: true, cell: isDel ? 'create-delete' : 'create-replace' };
    case 'supersede':
      if (base === 'null-head') return { ok: true, cell: isDel ? 'null-delete' : 'null-replace' }; // post-withdraw/retire baseline (C2-R6-2)
      if (base !== 'active-head') return refuse('BAD_CELL_INPUT', 'supersede requires an active or null head');
      if (!input.priorControlType) return refuse('BAD_CELL_INPUT', 'supersede requires priorControlType');
      // the six-cell table: a deletion cannot be superseded BY a deletion (nothing changes)
      if (priorDel && isDel) return refuse('BAD_CELL_INPUT', 'deletion superseded by deletion is a no-op');
      if (priorDel) return { ok: true, cell: 'supersede-delete-replace' };
      return { ok: true, cell: isDel ? 'supersede-replace-delete' : 'supersede-replace-replace' };
    case 'withdraw':
      if (base !== 'active-head') return refuse('BAD_CELL_INPUT', 'withdraw requires an active head');
      return { ok: true, cell: 'withdraw' };
    case 'retire_claim': return { ok: true, cell: 'retire' };
    case 'adopt': return { ok: true, cell: 'adopt' };
    default: return refuse('UNKNOWN_MODE', mode);
  }
}

// ── targetSeal — the P3.2 THREE-WAY caller-side contract (C2-R2-N2/C2-R3-4/C2-R4-3) ────────────────
// input: { econSigPresent, verifyOk, provenanceId (live _spId | archived SourceId, LIVE coordinate),
//          epoch: {epochId, epochSigValid} | null }
function targetSeal(input) {
  if (input.econSigPresent) return input.verifyOk ? { outcome: 'valid' } : { outcome: 'TARGET_SEAL_BROKEN' };
  if (!input.epoch) return { outcome: 'EPOCH_UNDEFINED' };
  if (input.epoch.epochSigValid !== true) return { outcome: 'EPOCH_TAMPERED' };
  // ⚠ STRIP-ATTACK EXTENSION (AGY, generated-artifact round). The comparison below treats absence of
  // a seal as the strip attack — but it compared against `input.epoch.epochId` WITHOUT checking that
  // the boundary is a real integer. Strip ONE MORE FIELD (epochId) from the seal artifact and
  // `provenanceId >= undefined` is false, so a POST-EPOCH UNSEALED row fell through to
  // 'unsealed-legacy' and was accepted. The defence was defeated by extending the same attack it
  // was written to stop. A malformed boundary is now indistinguishable from a tampered one.
  if (!Number.isSafeInteger(input.epoch.epochId)) return { outcome: 'EPOCH_TAMPERED' };
  if (!Number.isSafeInteger(input.provenanceId)) return { outcome: 'TARGET_SEAL_BROKEN' }; // no provenance => cannot be legacy
  return input.provenanceId >= input.epoch.epochId
    ? { outcome: 'TARGET_SEAL_BROKEN' }        // post-C1 ingest always seals => absence IS the strip attack
    : { outcome: 'unsealed-legacy' };
}

// ── stepSetDigest — the P3.3/P5.4 STEPS_CHANGED_RETRY comparator (C2-R1-12) ────────────────────────
// Canonical digest over the enumerated step identities+content; order-independent (sorted by stepId).
function stepSetDigest(input) {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const items = steps.map(s => [String(s.stepId), s.stepType || '', s.seq != null ? s.seq : null,
    s.timestamp != null ? s.timestamp : null, s.payload == null ? null : s.payload])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return { digest: crypto.createHash('sha256').update(JSON.stringify(['c2-steps-v1', items])).digest('hex'), count: items.length };
}

// ── HTTP dispatch ───────────────────────────────────────────────────────────────────────────────────
const OPS = {
  digest: (b) => ({ digest: opDigest(b.input) }),
  targetLine: (b) => computeTargetLine(b.input || {}),
  stamps: (b) => mintStamps(b.input || {}),
  delta: (b) => computeDelta(b.input || {}),
  candidate: (b) => assembleCandidate(b.input || {}),
  recoveryDecision: (b) => recoveryDecision(b.input || {}),
  membership: (b) => membershipDecision(b.input || {}),
  sweepClassify: (b) => sweepClassify(b.input || {}),
  claimDispatch: (b) => claimDispatch(b.input || {}),
  pushIdempotency: (b) => pushIdempotency(b.input || {}),
  exportBlocker: (b) => exportBlocker(b.input || {}),
  rowsEqual: (b) => ({ equal: rowsEqual(b.input && b.input.a, b.input && b.input.b) }),
  ctlRowsEqual: (b) => ({ equal: ctlRowsEqual(b.input && b.input.a, b.input && b.input.b) }),
  targetSeal: (b) => targetSeal(b.input || {}),
  stepSetDigest: (b) => stepSetDigest(b.input || {}),
  assembleSnapshot: (b) => assembleSnapshot(b.input || {}),
  modeGate: (b) => modeGate(b.input || {}),
  deltaCell: (b) => deltaCell(b.input || {})
};

app.http('correctionCompute', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request) => {
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'bad json' } }; }
    const fn = OPS[body.op];
    if (!fn) return { status: 400, jsonBody: { error: 'unknown op' } };
    try { return { jsonBody: fn(body) }; }
    catch (e) { return { status: 400, jsonBody: { error: 'compute failure', detail: String(e && e.message) } }; }
  }
});

module.exports = { opDigest, computeTargetLine, mintStamps, computeDelta, assembleCandidate,
  recoveryDecision, membershipDecision, sweepClassify, claimDispatch, pushIdempotency,
  exportBlocker, rowsEqual, ctlRowsEqual, effectOf, targetSeal, stepSetDigest,
  assembleSnapshot, modeGate, deltaCell, normalizeArchiveRow, stableClone, OPS,
  buildControlRow };   // buildControlRow exported for the proof suite (F30-F31 round-trip proofs)
