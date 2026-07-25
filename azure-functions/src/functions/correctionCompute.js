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
  const t = input.target || {};
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
  const t = input.target || {}, r = input.replacement || {};
  const tup = engine.readTuple(t.sellAtSupply, t.discAtSupply, t.pricingVersion, t.catalogueVersion);
  if (tup && !tup.absent
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
function effectOf(row) {
  if (!row) return null;
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
      add(input.target, -1); add(input.newOutput, +1); break;
    case 'create-delete':
      add(input.target, -1); break;
    case 'supersede-replace-replace':
      add(input.prevOutput, -1); add(input.newOutput, +1); break;
    case 'supersede-replace-delete':
      add(input.prevOutput, -1); break;
    case 'supersede-delete-replace':
      add(input.newOutput, +1); break;
    case 'withdraw':
      add(input.prevOutput, -1); add(input.originalTarget, +1); break;
    case 'null-replace':     // post-withdraw/retire baseline: the TARGET is the current effective value (C2-R6-2)
      add(input.originalTarget, -1); add(input.newOutput, +1); break;
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
  if (mode === 'create' || mode === 'supersede') out.outputTransactionId = 'corr:' + opId + ':' + rev;
  return out;
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
        return { ok: true };
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
      return { ok: true, baseline: controlIdNull ? 'null-head' : 'active-head' };
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

// ── targetSeal — the P3.2 THREE-WAY caller-side contract (C2-R2-N2/C2-R3-4/C2-R4-3) ────────────────
// input: { econSigPresent, verifyOk, provenanceId (live _spId | archived SourceId, LIVE coordinate),
//          epoch: {epochId, epochSigValid} | null }
function targetSeal(input) {
  if (input.econSigPresent) return input.verifyOk ? { outcome: 'valid' } : { outcome: 'TARGET_SEAL_BROKEN' };
  if (!input.epoch) return { outcome: 'EPOCH_UNDEFINED' };
  if (input.epoch.epochSigValid !== true) return { outcome: 'EPOCH_TAMPERED' };
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
  modeGate: (b) => modeGate(b.input || {})
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
  assembleSnapshot, modeGate, normalizeArchiveRow, stableClone, OPS };
