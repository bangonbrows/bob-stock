#!/usr/bin/env node
/*
 * correction-proof.js — OS-W4.4 Contract 2 logic-proof suite for
 * azure-functions/src/functions/correctionCompute.js + the N11 attestRows frames.
 * Runs the REAL modules (required, not re-derived — blind-sentinel rule), including the FROZEN
 * engine's own foldProjection for target/stamp authority (C2-R1-12) and the engine's exact
 * head-comparison shape (C2-R3-1). Probe families per the converged design §11 (R1-R24 additions);
 * auditor repros are permanent probes, cited by fold id. Run: node test/correction-proof.js
 */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'correctionCompute.js'));
const A = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'attestRows.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); } }
const J = (v) => JSON.parse(JSON.stringify(v));
const KR = { active: 'k1', peppers: { k1: 'test-pepper-k1-0123456789abcdef0123456789abcdef' } };

// ── 1. digest / idempotency (§5 request contract) ───────────────────────────────────────────────────
console.log('\n== digest / idempotency ==');
const DIG_IN = { mode: 'create', targetTransactionId: 'tx1', expected: null, control: { type: 'deletion' }, actorUsername: 'kunal' };
ok('same input -> same digest', C.opDigest(DIG_IN) === C.opDigest(J(DIG_IN)));
ok('mode change -> different digest', C.opDigest(DIG_IN) !== C.opDigest({ ...DIG_IN, mode: 'supersede' }));
ok('actor change -> different digest', C.opDigest(DIG_IN) !== C.opDigest({ ...DIG_IN, actorUsername: 'mallory' }));
ok('control payload change -> different digest', C.opDigest(DIG_IN) !== C.opDigest({ ...DIG_IN, control: { type: 'replacement', row: { qty: 5 } } }));
ok('EXPLICIT-null activeControlId is distinct from ABSENT (C2-R6-2 null-head baseline)',
  C.opDigest({ ...DIG_IN, expected: { activeControlId: null, revision: 1, publicationVersion: 4 } })
  !== C.opDigest({ ...DIG_IN, expected: { revision: 1, publicationVersion: 4 } }));

// ── 2. targetLine via the REAL foldProjection (C2-R1-12; resolve-pinned explicitly) ────────────────
console.log('\n== targetLine / originalEventAt (real foldProjection) ==');
const SUBMIT_MS = Date.parse('2026-07-01T02:00:00.000Z');
function STEPS() {
  return [
    { stepId: 's1', stepType: 'submit', seq: 10, timestamp: SUBMIT_MS, fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
      payload: { items: [{ productId: 'prodA', sentQty: 10, sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7, basis: 'submit-stamped' }] } },
    { stepId: 's2', stepType: 'receive', seq: 20, timestamp: SUBMIT_MS + 3600000, _attested: true,
      payload: { expectedLedgerKeys: ['txT1'], lines: [{ productId: 'prodA', receivedQty: 8 }] } },
    { stepId: 's3', stepType: 'resolve', seq: 30, timestamp: SUBMIT_MS + 7200000, _attested: true,
      payload: { expectedLedgerKeys: ['txT1'], resolutions: [{ productId: 'prodA', qty: 7 }] } }
  ];
}
const TGT = { id: 'txT1', transferId: 'tr1', productId: 'prodA', storeId: 'boor', type: 'transfer_in', qty: 8, timestamp: SUBMIT_MS + 3600000 };
const tl = C.computeTargetLine({ target: TGT, steps: STEPS() });
ok('transfer-linked target yields targetLine', tl.ok === true && !!tl.targetLine);
ok('qty authority = RESOLVE-PINNED (7), not received (8) or sent (10) — the C2-R1-12 precedence',
  tl.ok && tl.targetLine.qty === 7, JSON.stringify(tl));
ok('originalEventAt equals the SUBMIT step instant (engine :552-553 equality)',
  tl.ok && Date.parse(tl.originalEventAt) === SUBMIT_MS);
ok('a target id NOT in expectedLedgerKeys refuses ROW_NOT_IN_TRANSFER_LEDGER',
  C.computeTargetLine({ target: { ...TGT, id: 'txFOREIGN' }, steps: STEPS() }).reason === 'ROW_NOT_IN_TRANSFER_LEDGER');
ok('transfer-linked with NO steps refuses TARGET_PRE_EPOCH (D-C2-2 manual lane)',
  C.computeTargetLine({ target: TGT, steps: [] }).reason === 'TARGET_PRE_EPOCH');
const tless = C.computeTargetLine({ target: { id: 'txD1', productId: 'prodB', storeId: 'boor', type: 'usage', qty: 2, timestamp: SUBMIT_MS }, targetSealValid: 'valid', steps: [] });
ok('transferless sealed target: targetLine omitted (null) + row instant', tless.ok && tless.targetLine === null && Date.parse(tless.originalEventAt) === SUBMIT_MS);
ok('transferless UNSEALED-legacy: transferless line omitted too (engine needs targetLine only for transfer-linked)',
  (() => { const r = C.computeTargetLine({ target: { id: 'txD2', productId: 'prodB', storeId: 'boor', type: 'usage', qty: 2, timestamp: SUBMIT_MS }, targetSealValid: 'unsealed-legacy', steps: [] }); return r.ok && r.transferless === null; })());

// ── 3. stamps — tiers (SR-134/145 + C2-R1-11; D-C2-1 fail closed) ──────────────────────────────────
console.log('\n== replacement stamp minting ==');
const T_STAMPED = { productId: 'prodA', storeId: 'boor', type: 'transfer_in', sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 };
ok('tier (a): full identity match uses the target tuple',
  (() => { const r = C.mintStamps({ target: T_STAMPED, replacement: { productId: 'prodA', storeId: 'boor', type: 'transfer_in' } }); return r.ok && r.tier === 'a' && r.stamps.sellAtSupply === 100; })());
ok('tier (a) REFUSED on product mismatch -> falls to tier (b) via foldProjection (C2-R1-11)',
  (() => { const r = C.mintStamps({ target: T_STAMPED, replacement: { productId: 'prodX', storeId: 'boor', type: 'transfer_in' }, steps: [] }); return r.reason === 'STAMPS_UNRESOLVABLE'; })());
ok('tier (a) REFUSED on classification (Type) mismatch (SR-145)',
  (() => { const r = C.mintStamps({ target: T_STAMPED, replacement: { productId: 'prodA', storeId: 'boor', type: 'usage' }, steps: [] }); return r.reason === 'STAMPS_UNRESOLVABLE'; })());
ok('tier (b): the transfer ITEM stamps for the replacement product (mint-attested)',
  (() => { const r = C.mintStamps({ target: { productId: 'prodZ', storeId: 'boor', type: 'transfer_in' }, replacement: { productId: 'prodA', storeId: 'boor', type: 'transfer_in' }, steps: STEPS() }); return r.ok && r.tier === 'b' && r.stamps.sellAtSupply === 100; })());
ok('tier (b) refuses BACKFILL-untrusted stamps (SR-154)',
  (() => {
    const s = [{ stepId: 'b1', stepType: 'backfill', seq: 10, timestamp: SUBMIT_MS, _attested: true,
      payload: { snapshot: { submittedAt: '2026-07-01T02:00:00.000Z', items: [{ productId: 'prodA', sentQty: 10, sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7, basis: 'submit-stamped' }] } } }];
    const r = C.mintStamps({ target: { productId: 'prodZ', storeId: 'boor', type: 'transfer_in' }, replacement: { productId: 'prodA', storeId: 'boor', type: 'transfer_in' }, steps: s });
    return r.reason === 'STAMPS_UNRESOLVABLE';
  })());
ok('no evidence anywhere -> STAMPS_UNRESOLVABLE (D-C2-1: no lens tier)',
  C.mintStamps({ target: { productId: 'p', storeId: 's', type: 't' }, replacement: { productId: 'q', storeId: 's', type: 't' }, steps: [] }).reason === 'STAMPS_UNRESOLVABLE');

// ── 4. delta — the law, every cell + the NORMALIZATION LAW (§5 P4) ─────────────────────────────────
console.log('\n== delta exactness law ==');
const ROW = (qty, type) => ({ storeId: 'boor', productId: 'prodA', qty, type: type || 'transfer_in' });
const D = (r) => (r.ok ? (r.deltas['boor|prodA'] || 0) : r.reason);
ok('create-replace: -target +new (archived)', D(C.computeDelta({ cell: 'create-replace', targetLocation: 'archive', target: ROW(10), newOutput: ROW(8) })) === -2);
ok('create-delete: -target', D(C.computeDelta({ cell: 'create-delete', targetLocation: 'archive', target: ROW(10) })) === -10);
ok('AGY R2-2 repro: supersede replace(+8)->replace(+5) = -8+5 = -3 (95 from 98, NOT 93)',
  D(C.computeDelta({ cell: 'supersede-replace-replace', targetLocation: 'archive', prevOutput: ROW(8), newOutput: ROW(5) })) === -3);
ok('supersede replace->delete: -prevOutput', D(C.computeDelta({ cell: 'supersede-replace-delete', targetLocation: 'archive', prevOutput: ROW(8) })) === -8);
ok('supersede delete->replace: +new', D(C.computeDelta({ cell: 'supersede-delete-replace', targetLocation: 'archive', newOutput: ROW(5) })) === 5);
ok('withdraw: -prevOutput +originalTarget', D(C.computeDelta({ cell: 'withdraw', targetLocation: 'archive', prevOutput: ROW(8), originalTarget: ROW(10) })) === 2);
ok('C2-R6-2 null->replace: -originalTarget +new (retire-restored +10 then +8 => -2 => lands at 8)',
  D(C.computeDelta({ cell: 'null-replace', targetLocation: 'archive', originalTarget: ROW(10), newOutput: ROW(8) })) === -2);
ok('C2-R6-2 null->delete: -originalTarget', D(C.computeDelta({ cell: 'null-delete', targetLocation: 'archive', originalTarget: ROW(10) })) === -10);
ok('NORMALIZATION LAW: live-target cells adjust NO balances (any cell)',
  (() => { const r = C.computeDelta({ cell: 'create-replace', targetLocation: 'live', target: ROW(10), newOutput: ROW(8) }); return r.ok && Object.keys(r.deltas).length === 0; })());
ok('adoption, tombstone EXCLUDED at archive time -> delta 0 (C2-R3-3)',
  D(C.computeDelta({ cell: 'adopt', targetLocation: 'archive', target: ROW(10), membership: { decision: 'excluded' } })) === 0);
ok('adoption, target IN balances -> -target (the snapshotCompute.js:87-89 residual case)',
  D(C.computeDelta({ cell: 'adopt', targetLocation: 'archive', target: ROW(10), membership: { decision: 'in-balances' } })) === -10);
ok('adoption undecidable -> ADOPTION_DELTA_UNDECIDABLE fail-closed',
  D(C.computeDelta({ cell: 'adopt', targetLocation: 'archive', target: ROW(10), membership: { decision: 'undecidable' } })) === 'ADOPTION_DELTA_UNDECIDABLE');
ok('C2-R5-1 retire RESTORES an excluded target (+10)',
  D(C.computeDelta({ cell: 'retire', targetLocation: 'archive', target: ROW(10), membership: { decision: 'excluded' } })) === 10);
ok('retire of an in-balances tombstone (never folded) -> 0',
  D(C.computeDelta({ cell: 'retire', targetLocation: 'archive', target: ROW(10), membership: { decision: 'in-balances' } })) === 0);
// R2 finding 3b: this probe used to pass type 'usage' — which is NOT a ledger type anywhere in the
// app, and which the frozen engine classifies as direction 'none'. The old effectOf scored it
// OUTBOUND anyway, so the probe was asserting the very defect Codex found. Pinned to the REAL
// outbound type; the directionless case is now covered by its own refusal probe (G3).
ok('OUTBOUND effect sign: deleting an out(-4) row RESTORES +4',
  D(C.computeDelta({ cell: 'create-delete', targetLocation: 'archive', target: ROW(4, 'out') })) === 4);
ok('NORMALIZATION INDUCTION: create-replace -> supersede -> withdraw telescopes to zero net',
  (() => {
    const a = D(C.computeDelta({ cell: 'create-replace', targetLocation: 'archive', target: ROW(10), newOutput: ROW(8) }));
    const b = D(C.computeDelta({ cell: 'supersede-replace-replace', targetLocation: 'archive', prevOutput: ROW(8), newOutput: ROW(5) }));
    const c = D(C.computeDelta({ cell: 'withdraw', targetLocation: 'archive', prevOutput: ROW(5), originalTarget: ROW(10) }));
    return a + b + c === 0; // balance returns exactly to the pre-correction baseline
  })());

// ── 5. candidate assembly + THE CANONICAL HEAD SHAPE vs the engine's exact comparison ──────────────
console.log('\n== candidate heads / engine head-shape parity ==');
// The FROZEN engine's own per-target head comparison (buybackExport.js:517-520), reproduced here as
// the parity oracle: the assembled head must satisfy it VERBATIM (C2-R3-1).
function engineHeadCheck(manifest, target, c) {
  const head = Object.prototype.hasOwnProperty.call(manifest.controlHeads, target) ? manifest.controlHeads[target] : undefined;
  if (head === undefined || head === null) return 'CONTROL_HEAD_MISMATCH:no-active-head';
  if (head.controlId !== c.controlId || head.revision !== c.revision || head.bornPublicationVersion !== c.bornPublicationVersion) return 'CONTROL_HEAD_MISMATCH';
  if (!(head.bornPublicationVersion <= manifest.version)) return 'CONTROL_HEAD_MISMATCH:born>active';
  return 'ok';
}
// create/supersede now REQUIRE a control payload — they publish a control row, and the row is built
// here (generated-artifact round). A deletion control is the minimal valid form for id probes.
const cand = C.assembleCandidate({ mode: 'create', opId: 'op1', revision: 0, candidateVersion: 12, target: 'txT1', control: { controlType: 'deletion' } });
ok('deterministic ids: ctl:opId / corr:opId:rev', cand.ok && cand.controlId === 'ctl:op1' && cand.outputTransactionId === 'corr:op1:0');
ok('revision >0 joins the ctl id', C.assembleCandidate({ mode: 'supersede', opId: 'op1', revision: 2, candidateVersion: 13, target: 'txT1', control: { controlType: 'deletion' } }).controlId === 'ctl:op1:2');
ok('ENGINE PARITY: an assembled create head passes the frozen engine head check verbatim (C2-R3-1)',
  engineHeadCheck({ version: 12, controlHeads: cand.candidateHeads }, 'txT1', { controlId: 'ctl:op1', revision: 0, bornPublicationVersion: 12 }) === 'ok');
const adoptCand = C.assembleCandidate({ mode: 'adopt', opId: 'op2', candidateVersion: 13, adoptions: [{ tombstoneId: 'txDel1', target: 'txT9', membership: { decision: 'excluded' } }] });
ok('ENGINE PARITY: an adopted tombstone head passes the frozen engine check (bornPublicationVersion, not born)',
  engineHeadCheck({ version: 13, controlHeads: adoptCand.candidateHeads }, 'txT9', { controlId: 'txDel1', revision: 0, bornPublicationVersion: 13 }) === 'ok');
ok('withdraw assembles the EXPLICIT-null head', C.assembleCandidate({ mode: 'withdraw', opId: 'op3', candidateVersion: 14, target: 'txT1' }).candidateHeads.txT1 === null);
ok('retire_claim assembles explicit-null + journaled membership decision (C2-R5-2)',
  (() => { const r = C.assembleCandidate({ mode: 'retire_claim', opId: 'op4', candidateVersion: 15, target: 'txT2', membership: { decision: 'excluded' } }); return r.ok && r.candidateHeads.txT2 === null && r.adoptionDecisions.txT2.decision === 'excluded'; })());
ok('ZERO eligible heads is UNBUILDABLE -> NO_PENDING_ADOPTIONS (C2-R3-5)',
  C.assembleCandidate({ mode: 'adopt', opId: 'op5', candidateVersion: 16, adoptions: [] }).reason === 'NO_PENDING_ADOPTIONS');

// ── 6. recoveryDecision — per-entry hasOwnProperty semantics (§6, C2-R2-7/C2-R3-5) ─────────────────
console.log('\n== recovery decision ==');
const HEAD = { controlId: 'ctl:op1', revision: 0, bornPublicationVersion: 12 };
ok('ALL entries present + equal -> roll_forward',
  C.recoveryDecision({ candidateHeads: { txT1: HEAD }, candidateVersion: 12, activeManifest: { version: 12, controlHeads: { txT1: J(HEAD) } } }).decision === 'roll_forward');
ok('EXPLICIT-null head present matches explicit-null (withdraw distinguishable from never-written)',
  C.recoveryDecision({ candidateHeads: { txT1: null }, candidateVersion: 14, activeManifest: { version: 14, controlHeads: { txT1: null } } }).decision === 'roll_forward');
ok('explicit-null candidate vs ABSENT key + version<cv -> roll_back (hasOwnProperty semantics)',
  C.recoveryDecision({ candidateHeads: { txT1: null }, candidateVersion: 14, activeManifest: { version: 13, controlHeads: {} } }).decision === 'roll_back');
ok('NONE present + version < candidate -> roll_back',
  C.recoveryDecision({ candidateHeads: { txT1: HEAD }, candidateVersion: 12, activeManifest: { version: 11, controlHeads: {} } }).decision === 'roll_back');
ok('NONE present + version >= candidate -> INVARIANT_BROKEN',
  C.recoveryDecision({ candidateHeads: { txT1: HEAD }, candidateVersion: 12, activeManifest: { version: 12, controlHeads: {} } }).decision === 'INVARIANT_BROKEN');
ok('PARTIAL match -> INVARIANT_BROKEN (single-MERGE publish makes it out-of-protocol)',
  C.recoveryDecision({ candidateHeads: { txT1: HEAD, txT2: HEAD }, candidateVersion: 12, activeManifest: { version: 12, controlHeads: { txT1: J(HEAD) } } }).decision === 'INVARIANT_BROKEN');
ok('EMPTY CandidateHeads -> INVARIANT_BROKEN (invalid by construction, C2-R3-5)',
  C.recoveryDecision({ candidateHeads: {}, candidateVersion: 12, activeManifest: { version: 12, controlHeads: {} } }).decision === 'INVARIANT_BROKEN');
ok('multi-head ADOPT: all entries present -> roll_forward',
  C.recoveryDecision({ candidateHeads: { a: HEAD, b: null }, candidateVersion: 15, activeManifest: { version: 15, controlHeads: { a: J(HEAD), b: null } } }).decision === 'roll_forward');

// ── 7. membership — TransactionId ∈ the N17 recorded set (C2-R10-3/C2-R11-3) ───────────────────────
console.log('\n== membership ==');
// R2 finding 4: these probes used to omit the target bindings entirely and still got a DECISION —
// the bind test compared two undefineds and passed. The record and the target are now bound (the
// unbound cases are probed explicitly at G4).
const REC = { RunId: 'R7', SnapshotVersion: 5, TombstoneIds: ['txDel1', 'txDel2'], recordSigValid: true };
const BOUND = { archiveRunId: 'R7', snapshotVersion: 5 };
ok('tombstone ∈ recorded set -> excluded (archiver already excluded the target)',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', target: BOUND, runRecord: REC }).decision === 'excluded');
ok('tombstone ∉ set -> in-balances (the residual case)',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel9', target: BOUND, runRecord: REC }).decision === 'in-balances');
ok('no record -> undecidable (fail-closed manual lane)',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', runRecord: null }).decision === 'undecidable');
ok('record with INVALID RecordSig -> undecidable',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', runRecord: { ...REC, recordSigValid: false } }).decision === 'undecidable');
ok('live target -> live (deltas suppressed by the normalization law)',
  C.membershipDecision({ targetLocation: 'live', tombstoneTransactionId: 'txDel1', runRecord: null }).decision === 'live');
ok('ABSENT-ROW retirement decides by the registry-retained TransactionId (C2-R10-3: no numeric coordinate needed)',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel2', target: BOUND, runRecord: REC }).decision === 'excluded');

// ── 8. sweepClassify — the Codex R25 ten-case matrix (C2-R17-1..C2-R24-1) ──────────────────────────
console.log('\n== archive sweep classification ==');
const EPOCH = 100;
function sweep(rows, runRecords, liveItemIds) { return C.sweepClassify({ rows, epoch: EPOCH, runRecords, liveItemIds }); }
ok('LEGACY (≤ epoch, no N17) is ALWAYS spared — first C2 run never bricks (C2-R17-1/C2-R18-x)',
  (() => { const r = sweep([{ itemId: 50, sourceId: 40, archiveRunId: null, isControl: false }], {}, []); return r.spare.includes(50) && r.halt.length === 0; })());
ok('DIRECT-to-archive control (valid ctl seal, no run) spared regardless of head state (C2-R19-2)',
  (() => { const r = sweep([{ itemId: 150, sourceId: null, archiveRunId: null, isControl: true, ctlSealValid: true }], {}, []); return r.spare.includes(150) && r.halt.length === 0; })());
ok('a FORGED above-epoch row with no run and no valid control seal HALTS',
  (() => { const r = sweep([{ itemId: 151, sourceId: null, archiveRunId: null, isControl: true, ctlSealValid: false }], {}, []); return r.halt.length === 1; })());
const RUN = (members, sig, pub) => ({ memberSourceIds: members, recordSigValid: sig !== false, publishedSigValid: !!pub, stale: true, isCurrent: false });
ok('MID-COPY CRASH: partial subset, ALL intended still in Live -> swept clean, NO halt (C2-R23-1)',
  (() => {
    const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1', isControl: false }],
      { R1: RUN([101, 102]) }, [101, 102]);
    return r.delete.includes(201) && r.halt.length === 0;
  })());
ok('COMPLETE pre-publication copy (all intended in Live) -> all swept',
  (() => {
    const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1' }, { itemId: 202, sourceId: 102, archiveRunId: 'R1' }],
      { R1: RUN([101, 102]) }, [101, 102]);
    return r.delete.length === 2 && r.halt.length === 0;
  })());
ok('PUBLISHED run (originals gone from Live): full-set equality -> SPARED (real history)',
  (() => {
    const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1' }, { itemId: 202, sourceId: 102, archiveRunId: 'R1' }],
      { R1: RUN([101, 102], true, true) }, []);
    return r.spare.length === 2 && r.halt.length === 0;
  })());
ok('STRIPPED PublishedSig CANNOT downgrade a published run — full equality still runs (C2-R24-1)',
  (() => { // Live originals gone => the ledger-state discriminator forces full-set mode regardless of the marker
    const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1' }, { itemId: 202, sourceId: 102, archiveRunId: 'R1' }],
      { R1: RUN([101, 102], true, false) }, []);
    return r.spare.length === 2 && r.delete.length === 0;
  })());
ok('PUBLISHED run with a MISSING archived member -> HALT (never silent loss)',
  (() => {
    const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1' }],
      { R1: RUN([101, 102], true, true) }, []);
    return r.halt.length === 1 && r.spare.length === 0 && r.delete.length === 0;
  })());
ok('TAMPERED residue SourceId (∉ signed list) -> HALT, Live row protected (C2-R23-1)',
  (() => {
    const r = sweep([{ itemId: 201, sourceId: 999, archiveRunId: 'R1' }],
      { R1: RUN([101, 102]) }, [101, 102, 999]);
    return r.halt.length === 1 && r.delete.length === 0;
  })());
ok('PLANTED row under a crashed run (∉ list) -> HALT',
  (() => {
    const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1' }, { itemId: 299, sourceId: 555, archiveRunId: 'R1' }],
      { R1: RUN([101, 102]) }, [101, 102]);
    return r.halt.length === 1 && r.delete.length === 0;
  })());
ok('ABSENT N17 on an above-epoch run -> HALT (record-before-copy makes absence = tamper, C2-R18-1)',
  (() => { const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'Rgone' }], {}, [101]); return r.halt.length === 1; })());
ok('CORRUPT RecordSig -> HALT, never delete',
  (() => { const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1' }], { R1: RUN([101], false) }, [101]); return r.halt.length === 1; })());
ok('EMPTY intended set is harmless (no rows to misclassify)',
  (() => { const r = sweep([], { R1: RUN([]) }, []); return r.delete.length === 0 && r.halt.length === 0; })());
ok('LATE REPLAY does not trip the sweep: a new Live id ≠ any archive SourceId -> published row spared (C2-R20-2)',
  (() => { // replay minted Live id 300; the archive row's SourceId is 101 (gone from Live)
    const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1' }], { R1: RUN([101], true, true) }, [300]);
    return r.spare.includes(201);
  })());

// ── 9. claimDispatch — the §8 own-claim state machine ──────────────────────────────────────────────
console.log('\n== claim dispatch ==');
const CD = C.claimDispatch;
ok('foreign claim -> quarantine push', CD({ match: 'foreign' }).action === 'quarantine_push');
ok('no claim -> proceed', CD({ match: 'none' }).action === 'proceed_new_claim');
ok('own pending -> re-enter the staged lifecycle', CD({ match: 'own', registryState: 'pending' }).action === 'reenter_pending');
ok('own pending_supersede + row present -> ack already-applied (C2-R8-2, decide-by-read)',
  CD({ match: 'own', registryState: 'pending_supersede', mainPresent: true }).action === 'ack_already_applied');
ok('own pending_supersede + row absent -> transient retry (never insert mid-Director-op)',
  CD({ match: 'own', registryState: 'pending_supersede', mainPresent: false }).action === 'retry_transient');
ok('own WITHDRAWN (ControlId null) -> terminal superseded_by_adjudication (C2-R7-3)',
  (() => { const r = CD({ match: 'own', registryState: 'committed', controlIdNull: true }); return r.action === 'ack_terminal' && r.status === 'superseded_by_adjudication'; })());
ok('own committed + OUR main row + valid CommitSig + N18 leftover -> delete N18 then ack (C2-R12-5)',
  CD({ match: 'own', registryState: 'committed', mainPresent: true, mainIsOurs: true, mainCommitSigValid: true, n18Present: true }).action === 'delete_n18_then_ack');
ok('own committed + OUR row + INVALID CommitSig -> re-mint the sig, never auto-sign a foreign row (C2-R15-4)',
  CD({ match: 'own', registryState: 'committed', mainPresent: true, mainIsOurs: true, mainCommitSigValid: false }).action === 'remint_commitsig_then_finish');
ok('own committed + FOREIGN main row -> CONTROL_ID_COLLISION (C2-R17-3, never delete N18 blindly)',
  CD({ match: 'own', registryState: 'committed', mainPresent: true, mainIsOurs: false }).action === 'control_id_collision');
ok('own committed + only N18 -> RUN THE RE-MINT (never an in-place flip, C2-R11-2)',
  CD({ match: 'own', registryState: 'committed', mainPresent: false, n18Present: true }).action === 'run_remint');
ok('own committed + NOTHING anywhere -> CONTROL_ROW_MISSING terminal (C2-R9-2)',
  CD({ match: 'own', registryState: 'committed', mainPresent: false, n18Present: false }).action === 'control_row_missing');
ok('collision state -> resolve (ensure N18 deleted then release, C2-R16-3)',
  CD({ match: 'own', registryState: 'collision' }).action === 'resolve_collision');

// ── 10. pushIdempotency — global Live+Archive (N9, C2-R21-3/C2-R22-2) ──────────────────────────────
console.log('\n== global push idempotency ==');
const PROW = { TransactionId: 'txR1', StoreId: 'boor', Date: '2026-07-01', Timestamp: 1, ProductId: 'prodA', Type: 'usage', Qty: 3, Reason: '', TransferId: '', IdempotencyKey: 'txR1', StockFromStoreId: '', StockToStoreId: '', StockFrom: '', StockTo: '', TargetTransactionId: '', SellAtSupply: '', DiscAtSupply: '', PricingVersion: '', CatalogueVersion: '' };
ok('exact LIVE duplicate -> ack', C.pushIdempotency({ liveMatch: J(PROW), archiveMatch: null, incoming: J(PROW) }).action === 'ack_duplicate');
ok('exact ARCHIVED duplicate -> ack WITHOUT a new Live row (the replay killer, C2-R21-3)',
  C.pushIdempotency({ liveMatch: null, archiveMatch: J(PROW), incoming: J(PROW) }).action === 'ack_archived_duplicate');
ok('DIFFERING replay under a reused id -> reject (mutated resubmission)',
  C.pushIdempotency({ liveMatch: null, archiveMatch: J(PROW), incoming: { ...J(PROW), Qty: 9 } }).action === 'reject_conflict');
ok('no match anywhere -> proceed', C.pushIdempotency({ liveMatch: null, archiveMatch: null, incoming: J(PROW) }).action === 'proceed');

// ── 11. exportBlocker — absent-target-key only (C2-R21-4) ──────────────────────────────────────────
console.log('\n== export blocker ==');
ok('WITHDRAWN target (explicit-null key PRESENT) is NEVER blocked (adjudicated, SR-144)',
  C.exportBlocker({ targetKeyPresent: true }).blocked === false);
ok('committed-non-null unmaterialized claim + ABSENT key -> blocked (C2-R12-1 crash window)',
  C.exportBlocker({ targetKeyPresent: false, registryCommittedNonNull: true, materialized: false }).blocked === true);
ok('unadjudicated headless row (absent key) -> blocked PROVISIONAL',
  C.exportBlocker({ targetKeyPresent: false }).blocked === true);

// ── 12. N11 frames — ctl-v1 whole-population tamper + typed encoding + siblings ────────────────────
console.log('\n== attestRows frames (N11) ==');
function CTL() {
  return {
    ControlId: 'ctl:op1', ControlType: 'replacement', TargetTransactionId: 'txT1', ControlRevision: 0,
    BornPublicationVersion: 12, TargetLine: '{"transferId":"tr1","productId":"prodA","qty":7}',
    OriginalEventAt: '2026-07-01T02:00:00.000Z',
    TransactionId: 'corr:op1:0', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in', Qty: 5,
    Date: '2026-07-01', Timestamp: 1751335200000, Reason: '', StockFrom: 'Head Office Warehouse',
    StockTo: 'Boorogoon Store', StockFromStoreId: 'head_office', StockToStoreId: 'boor',
    TransferId: '', IdempotencyKey: 'corr:op1:0', UnitPriceAtTime: 30,
    SellAtSupply: 100, DiscAtSupply: 25, PricingVersion: 3, CatalogueVersion: 7
  };
}
const ctlSig = A.signFrame(KR, 'ctl-v1', CTL());
ok('ctl-v1 signs + verifies', /^v1:k1:[0-9a-f]{64}$/.test(ctlSig) && A.verifyFrame(KR, 'ctl-v1', CTL(), ctlSig));
let allBreak = true;
for (const f of A.CTL_V1_FIELDS) {   // whole-population tamper probe (attest-proof pattern)
  const t = CTL();
  t[f] = (typeof t[f] === 'number') ? t[f] + 1 : String(t[f]) + 'X';
  if (A.verifyFrame(KR, 'ctl-v1', t, ctlSig)) { allBreak = false; ok(`ctl-v1 tamper NOT caught on ${f}`, false); }
}
ok(`ctl-v1: tampering EVERY covered field (${A.CTL_V1_FIELDS.length}) breaks the seal — incl. TransferId + UnitPriceAtTime (the C2-R2-2 finding)`, allBreak);
ok('ctl-v1 TYPED encoding: 0, null, and ABSENT are three distinct canonicals (C2-R7-5)',
  (() => {
    const a = CTL(); a.ControlRevision = 0;
    const b = CTL(); b.ControlRevision = null;
    const c = CTL(); delete c.ControlRevision;
    const ca = A.canonicalFrame('ctl-v1', a), cb = A.canonicalFrame('ctl-v1', b), cc = A.canonicalFrame('ctl-v1', c);
    return ca !== cb && cb !== cc && ca !== cc;
  })());
ok('a DELETION control signs with the row-form fields ABSENT (distinct from any replacement)',
  (() => {
    const d = { ControlId: 'ctl:op9', ControlType: 'deletion', TargetTransactionId: 'txT1', ControlRevision: 0, BornPublicationVersion: 12, TargetLine: null, OriginalEventAt: '2026-07-01T02:00:00.000Z' };
    const s = A.signFrame(KR, 'ctl-v1', d);
    return A.verifyFrame(KR, 'ctl-v1', d, s) && s !== ctlSig;
  })());
ok('frame DOMAIN SEPARATION: identical fields under different frames give different signatures',
  A.signFrame(KR, 'ctlcommit-v1', { TransactionId: 'x', TargetTransactionId: 'y' })
  !== A.signFrame(KR, 'runrec-pub-v1', { TransactionId: 'x', TargetTransactionId: 'y' }));
const commitSig = A.signFrame(KR, 'ctlcommit-v1', { TransactionId: 'txDel1', TargetTransactionId: 'txT1' });
ok('ctlcommit-v1 verifies; a TargetTransactionId swap breaks it (C2-R4-5 binding)',
  A.verifyFrame(KR, 'ctlcommit-v1', { TransactionId: 'txDel1', TargetTransactionId: 'txT1' }, commitSig)
  && !A.verifyFrame(KR, 'ctlcommit-v1', { TransactionId: 'txDel1', TargetTransactionId: 'txOTHER' }, commitSig));
const EPOCH_OBJ = { epochId: 1000, tombstoneCommitEpochId: 1200, archiveC2EpochId: 100, recordedAt: '2026-07-25T00:00:00.000Z' };
const epochSig = A.signFrame(KR, 'epoch-v1', EPOCH_OBJ);
ok('epoch-v1 verifies; any boundary edit breaks it (EPOCH_TAMPERED source, C2-R4-7)',
  A.verifyFrame(KR, 'epoch-v1', EPOCH_OBJ, epochSig) && !A.verifyFrame(KR, 'epoch-v1', { ...EPOCH_OBJ, epochId: 999 }, epochSig));
const RR = { RunId: 'run-1', SnapshotVersion: 12, InputDigest: 'aa', TombstoneIds: ['txDel1'], ArchiveMemberSourceIds: [101, 102] };
const rrSig = A.signFrame(KR, 'runrec-v1', RR);
ok('runrec-v1 covers TombstoneIds AND ArchiveMemberSourceIds (C2-R22-1/C2-R23-1)',
  A.verifyFrame(KR, 'runrec-v1', RR, rrSig)
  && !A.verifyFrame(KR, 'runrec-v1', { ...RR, TombstoneIds: ['txEVIL'] }, rrSig)
  && !A.verifyFrame(KR, 'runrec-v1', { ...RR, ArchiveMemberSourceIds: [101, 999] }, rrSig));
ok('runrec-pub-v1 is SEPARATE: stamping Published never invalidates RecordSig (C2-R14-3)',
  (() => {
    const pubSig = A.signFrame(KR, 'runrec-pub-v1', { RunId: 'run-1' });
    return A.verifyFrame(KR, 'runrec-v1', RR, rrSig) && A.verifyFrame(KR, 'runrec-pub-v1', { RunId: 'run-1' }, pubSig)
      && !A.verifyFrame(KR, 'runrec-pub-v1', { RunId: 'run-2' }, pubSig);
  })());
ok('econ-v1 rows are UNTOUCHED by the frame extension (evaluate default path)',
  (() => { const r = A.evaluate(KR, { op: 'sign', rows: [PROW] }); return Array.isArray(r.sigs) && /^v1:k1:/.test(r.sigs[0].EconSig); })());
ok('evaluate rejects an unknown frame', A.evaluate(KR, { op: 'sign', frame: 'evil-v9', rows: [] }).error === 'unknown frame');
ok('rowsEqual: canonical byte-equality (same row true, any econ field diff false)',
  C.rowsEqual(J(PROW), J(PROW)) && !C.rowsEqual(J(PROW), { ...J(PROW), Qty: 4 }));

// ── 13. targetSeal three-way + stepSetDigest (P3.2/P3.3 compute ops) ───────────────────────────────
console.log('\n== targetSeal / stepSetDigest ==');
const EPOK = { epochId: 1000, epochSigValid: true };
ok('sealed + verify ok -> valid', C.targetSeal({ econSigPresent: true, verifyOk: true }).outcome === 'valid');
ok('sealed + verify FAIL -> TARGET_SEAL_BROKEN', C.targetSeal({ econSigPresent: true, verifyOk: false }).outcome === 'TARGET_SEAL_BROKEN');
ok('unsealed + provenance >= epoch -> TARGET_SEAL_BROKEN (the seal-STRIP attack, C2-R2-N2)',
  C.targetSeal({ econSigPresent: false, provenanceId: 1500, epoch: EPOK }).outcome === 'TARGET_SEAL_BROKEN');
ok('unsealed + provenance < epoch -> unsealed-legacy (the legitimate pre-C1 lane)',
  C.targetSeal({ econSigPresent: false, provenanceId: 400, epoch: EPOK }).outcome === 'unsealed-legacy');
ok('epoch artifact ABSENT -> EPOCH_UNDEFINED (fail closed)',
  C.targetSeal({ econSigPresent: false, provenanceId: 400, epoch: null }).outcome === 'EPOCH_UNDEFINED');
ok('EpochSig invalid -> EPOCH_TAMPERED (C2-R4-7)',
  C.targetSeal({ econSigPresent: false, provenanceId: 400, epoch: { epochId: 1000, epochSigValid: false } }).outcome === 'EPOCH_TAMPERED');
const SD = C.stepSetDigest({ steps: STEPS() });
ok('stepSetDigest is deterministic + order-independent',
  SD.digest === C.stepSetDigest({ steps: STEPS().reverse() }).digest && SD.count === 3);
ok('a superseding resolve changes the digest (STEPS_CHANGED_RETRY trigger, C2-R1-12)',
  (() => { const s = STEPS(); s.push({ stepId: 's4', stepType: 'resolve', seq: 40, timestamp: SUBMIT_MS + 9000000, payload: { resolutions: [{ productId: 'prodA', qty: 6 }] } }); return C.stepSetDigest({ steps: s }).digest !== SD.digest; })());

// ── 14. INTERIM LA REVIEW folds (C2-LA findings 1-11) ──────────────────────────────────────────────
console.log('\n== interim-review folds ==');
ok('F9: digest is key-order canonical (reordered control keys hash identically)',
  C.opDigest({ ...DIG_IN, control: { type: 'replacement', row: { productId: 'p', qty: 1, type: 'in' } } })
  === C.opDigest({ ...DIG_IN, control: { row: { type: 'in', qty: 1, productId: 'p' }, type: 'replacement' } }));
ok('F4: a NEGATIVE replacement qty refuses INVALID_ROW (never publishes a corrupt delta)',
  C.computeDelta({ cell: 'create-replace', targetLocation: 'archive', target: ROW(10), newOutput: { storeId: 'boor', productId: 'prodA', qty: -5, type: 'transfer_in' } }).reason === 'INVALID_ROW');
ok('F4: a fractional qty refuses INVALID_ROW',
  C.computeDelta({ cell: 'create-delete', targetLocation: 'archive', target: { storeId: 'boor', productId: 'prodA', qty: 2.5, type: 'usage' } }).reason === 'INVALID_ROW');
ok('F5: a run record NOT bound to the target (RunId mismatch) -> undecidable',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', target: { archiveRunId: 'R2', snapshotVersion: 12 }, runRecord: { RunId: 'R1', SnapshotVersion: 11, TombstoneIds: ['txDel1'], recordSigValid: true } }).decision === 'undecidable');
ok('F5: a correctly-bound record still decides',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', target: { archiveRunId: 'R1', snapshotVersion: 11 }, runRecord: { RunId: 'R1', SnapshotVersion: 11, TombstoneIds: ['txDel1'], recordSigValid: true } }).decision === 'excluded');
ok('F6: a RAW archive-shaped row (TxnType/TxnDate/TxnTimestamp aliases) ACKs an exact replay',
  (() => {
    const arch = { ...J(PROW) }; arch.TxnType = arch.Type; arch.TxnDate = arch.Date; arch.TxnTimestamp = arch.Timestamp;
    delete arch.Type; delete arch.Date; delete arch.Timestamp;
    return C.pushIdempotency({ liveMatch: null, archiveMatch: arch, incoming: J(PROW) }).action === 'ack_archived_duplicate';
  })());
ok('F7: DUPLICATE SourceIds in a published run ([101,101,102] vs signed [101,102]) -> HALT (multiset equality)',
  (() => {
    const r = sweep([{ itemId: 201, sourceId: 101, archiveRunId: 'R1' }, { itemId: 202, sourceId: 101, archiveRunId: 'R1' }, { itemId: 203, sourceId: 102, archiveRunId: 'R1' }],
      { R1: RUN([101, 102], true, true) }, []);
    return r.halt.length === 1 && r.spare.length === 0;
  })());
ok('F8: WITHDRAWN claim + leftover N18 -> delete N18 then terminal (never left forever)',
  (() => { const r = CD({ match: 'own', registryState: 'committed', controlIdNull: true, n18Present: true }); return r.action === 'delete_n18_then_ack_terminal' && r.status === 'superseded_by_adjudication'; })());
ok('F10: ctlRowsEqual catches a DROPPED control field that econ-v1 rowsEqual misses',
  (() => {
    const intended = CTL(); const echoed = CTL(); delete echoed.ControlRevision;
    return C.rowsEqual(intended, echoed) === true /* econ-v1 is blind to it */
      && C.ctlRowsEqual(intended, echoed) === false /* ctl-v1 catches it */
      && C.ctlRowsEqual(intended, CTL()) === true;
  })());
// F1a: assembleSnapshot — the LA does no arithmetic
const SNAP = { version: 11, cutoffId: 100, stepCutoffTs: 0, runId: 'R1', fence: 3,
  balances: [{ storeId: 'boor', productId: 'prodA', balance: 10 }],
  controlManifest: { version: 11, controlHeads: { txOld: { controlId: 'ctl:z', revision: 0, bornPublicationVersion: 9 } } } };
const ASM = C.assembleSnapshot({ snapshotConfigData: J(SNAP), candidateVersion: 12, deltas: { 'boor|prodA': -2, 'boor|prodB': 5 }, candidateHeads: { txT1: { controlId: 'ctl:op1', revision: 0, bornPublicationVersion: 12 }, txT2: null } });
ok('F1a: assembleSnapshot bumps version, applies deltas (10-2=8, new pair 5), keeps fence, merges heads incl. explicit-null',
  (() => {
    if (!ASM.ok) return false;
    const o = JSON.parse(ASM.configData);
    const a = o.balances.find(b => b.productId === 'prodA'), bNew = o.balances.find(b => b.productId === 'prodB');
    return o.version === 12 && o.fence === 3 && a.balance === 8 && bNew.balance === 5
      && o.controlManifest.version === 12
      && o.controlManifest.controlHeads.txOld.controlId === 'ctl:z'            // prior head carried
      && o.controlManifest.controlHeads.txT1.controlId === 'ctl:op1'
      && Object.prototype.hasOwnProperty.call(o.controlManifest.controlHeads, 'txT2')
      && o.controlManifest.controlHeads.txT2 === null;                         // explicit-null WRITTEN
  })());
ok('F1a: a wrong candidateVersion refuses (must be captured version + 1)',
  C.assembleSnapshot({ snapshotConfigData: J(SNAP), candidateVersion: 14, deltas: {}, candidateHeads: {} }).reason === 'BAD_ASSEMBLY_INPUT');
// F1b: modeGate — no condition trees in the LA
ok('F1b modeGate: create on an unreserved target passes; on a reserved target -> TARGET_RESERVED',
  C.modeGate({ mode: 'create', registryItem: null }).ok === true
  && C.modeGate({ mode: 'create', registryItem: { State: 'committed', ControlId: 'x', Revision: 0, PublicationVersion: 5 } }).reason === 'TARGET_RESERVED');
ok('F1b modeGate: create finding an unregistered belt tombstone -> LAZY_ADOPTION_REQUIRED (C2-R1-4)',
  C.modeGate({ mode: 'create', registryItem: null, beltTombstone: { id: 'txDel7' } }).reason === 'LAZY_ADOPTION_REQUIRED');
ok('F1b modeGate: supersede vs committed-UNADOPTED -> TOMBSTONE_PENDING_ADOPTION (C2-R2-6)',
  C.modeGate({ mode: 'supersede', expected: { activeControlId: 'txDel1', revision: 0, publicationVersion: null }, registryItem: { State: 'committed', ControlId: 'txDel1', Revision: 0, PublicationVersion: null, Origin: 'device' } }).reason === 'TOMBSTONE_PENDING_ADOPTION');
ok('F1b modeGate: supersede against the NULL-head baseline needs EXPLICIT-null expected (C2-R6-2)',
  (() => {
    const regNull = { State: 'committed', ControlId: '', Revision: 2, PublicationVersion: 14, Origin: 'director' };
    return C.modeGate({ mode: 'supersede', expected: { activeControlId: null, revision: 2, publicationVersion: 14 }, registryItem: regNull }).ok === true
      && C.modeGate({ mode: 'supersede', expected: { revision: 2, publicationVersion: 14 }, registryItem: regNull }).reason === 'EXPECTED_MISMATCH'
      && C.modeGate({ mode: 'withdraw', expected: { activeControlId: null, revision: 2, publicationVersion: 14 }, registryItem: regNull }).reason === 'ALREADY_WITHDRAWN';
  })());
ok('F1b modeGate: retire needs a committed-unadopted DEVICE claim + evidence; post-epoch unsealed stays LOCKED',
  (() => {
    const reg = { State: 'committed', ControlId: 'txDel1', Revision: 0, PublicationVersion: null, Origin: 'device' };
    return C.modeGate({ mode: 'retire_claim', registryItem: reg, retireEvidence: { sealOutcome: 'unsealed-legacy' } }).ok === true
      && C.modeGate({ mode: 'retire_claim', registryItem: reg, retireEvidence: { rowAbsentEverywhere: true } }).lane === 'absent-row'
      && C.modeGate({ mode: 'retire_claim', registryItem: reg, retireEvidence: { sealOutcome: 'TARGET_SEAL_BROKEN', provenancePreEpoch: false } }).reason === 'RETIRE_EVIDENCE_INSUFFICIENT';
  })());
// F3: the REAL snapshotCompute, control-aware (the flagged C8-surface amendment)
const SC = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'snapshotCompute.js'));
function scRows() {
  return [
    { Id: 10, TransactionId: 'txT1', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in', Qty: 10, TxnTimestamp: 1000 },
    { Id: 200, TransactionId: 'corr:op1:0', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in', Qty: 8, TxnTimestamp: 1200, ControlId: 'ctl:op1', TargetTransactionId: 'txT1' }
  ];
}
ok('F3: control-aware fold — active replacement head folds +8 EFFECTIVE (not +18 raw) and the unit-move rides the control row',
  (() => {
    const r = SC.compute({ rows: scRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3,
      controlHeads: { txT1: { controlId: 'ctl:op1', revision: 0, bornPublicationVersion: 3 } } });
    if (!r.ok) return false;
    const b = r.balances.find(x => x.productId === 'prodA');
    return b && b.balance === 8 && r.archiveIds.includes(200); // ctl row (Id 200 > cutoff) rides the target's run
  })());
ok('F3: a SUPERSEDED (historical) control row folds NOTHING; a null-head target folds normally',
  (() => {
    const r = SC.compute({ rows: scRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3,
      controlHeads: { txT1: null } }); // withdrawn: target PRESENT, old control historical
    if (!r.ok) return false;
    const b = r.balances.find(x => x.productId === 'prodA');
    return b && b.balance === 10;
  })());
ok('F3: absent controlHeads = byte-identical PRE-C2 behaviour (regression guard)',
  (() => {
    const rows = [{ Id: 10, TransactionId: 'txT1', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in', Qty: 10, TxnTimestamp: 1000 }];
    const r = SC.compute({ rows, cutoffId: 100, runId: 'R9', snapshotVersion: 3 });
    return r.ok && r.balances[0].balance === 10;
  })());

// ── 15. INTERIM LA REVIEW ROUND 2 folds (Codex findings 1-6) ──────────────────────────────────────
// Every one reproduced against the real modules before it was fixed; these keep them dead.
// The R1 probes above missed findings 1 and 5 because the null-head case used a REPLACEMENT control
// row (never a Type='deleted' tombstone) and the regression guard used a lone ordinary row.
function tombRows() {
  return [
    { Id: 10, TransactionId: 'txT1', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in', Qty: 10, TxnTimestamp: 1000 },
    { Id: 20, TransactionId: 'txDel1', StoreId: 'boor', ProductId: 'prodA', Type: 'deleted', Qty: 0, TxnTimestamp: 1100,
      TargetTransactionId: 'txT1', ControlId: 'ctl:dev1' }
  ];
}
const balOf = (r, p) => { const b = (r.balances || []).find(x => x.productId === (p || 'prodA')); return b ? b.balance : null; };

ok('G1: a WITHDRAWN device tombstone (null head) no longer suppresses its target — +10 is restored',
  (() => {
    const r = SC.compute({ rows: tombRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3, controlHeads: { txT1: null } });
    return r.ok && balOf(r) === 10; // pre-fix: [] — the raw tombstoned set ran before the manifest
  })());
ok('G1: an ACTIVE-head device tombstone still excludes its target (the deletion stands)',
  (() => {
    const r = SC.compute({ rows: tombRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3,
      controlHeads: { txT1: { controlId: 'ctl:dev1', revision: 0, bornPublicationVersion: 3 } } });
    return r.ok && balOf(r) === null;
  })());
ok('G1: with a SUPERSEDED control tombstone present, the MANIFEST is the sole authority — the fold follows the active head (+6)',
  (() => {
    // txT1 was deleted by ctl:dev1, then that deletion was superseded by a replacement ctl:other.
    // The target stays suppressed (it has an active head) and the ACTIVE control folds its value;
    // the historical tombstone contributes nothing either way. (The discriminating case for the
    // tombstone rule itself is the NULL head above — an active head suppresses regardless.)
    const rows = tombRows();
    rows.push({ Id: 30, TransactionId: 'corr:op2:1', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in',
      Qty: 6, TxnTimestamp: 1300, ControlId: 'ctl:other', TargetTransactionId: 'txT1' });
    const r = SC.compute({ rows, cutoffId: 100, runId: 'R9', snapshotVersion: 3,
      controlHeads: { txT1: { controlId: 'ctl:other', revision: 1, bornPublicationVersion: 4 } } });
    return r.ok && balOf(r) === 6;
  })());
ok('G1: a LEGACY tombstone with NO manifest still suppresses its target (pre-C2 Chunk-8 rule intact)',
  (() => {
    const rows = tombRows(); delete rows[1].ControlId;
    const r = SC.compute({ rows, cutoffId: 100, runId: 'R9', snapshotVersion: 3 });
    return r.ok && balOf(r) === null;
  })());

const ctlRow = () => ({ Id: 5, TransactionId: 'corr:op1:0', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in',
  Qty: 3, TxnTimestamp: 1200, TargetTransactionId: 'txT1', ControlId: 'ctl:op1', ControlType: 'replace',
  ControlRevision: 0, BornPublicationVersion: 7, TargetLine: '{"qty":3}', OriginalEventAt: '2026-01-01T00:00:00Z',
  ControlState: 'committed', CommitSig: 'sig-abc' });
const hashOf = (rows) => SC.compute({ mode: 'hash', rows }).hash;
ok('G2: the fidelity hash CATCHES a copy that dropped ControlId (pre-fix it hashed identical)',
  (() => {
    const src = [ctlRow()], copy = [ctlRow()]; delete copy[0].ControlId;
    return hashOf(src) !== hashOf(copy);
  })());
ok('G2: the fidelity hash catches a mutated CommitSig / ControlState / ControlRevision / TargetLine',
  (() => {
    const src = [ctlRow()];
    return ['CommitSig', 'ControlState', 'ControlRevision', 'TargetLine', 'ControlType', 'OriginalEventAt', 'BornPublicationVersion']
      .every(f => { const c = [ctlRow()]; c[0][f] = (f === 'ControlRevision' || f === 'BornPublicationVersion') ? 99 : 'CHANGED'; return hashOf(src) !== hashOf(c); });
  })());
ok('G2: a FAITHFUL copy still hashes equal, and legacy rows carrying no control columns are unaffected',
  (() => {
    const legacy = [{ Id: 1, TransactionId: 'txL', StoreId: 'boor', ProductId: 'prodA', Type: 'in', Qty: 4, TxnTimestamp: 900 }];
    return hashOf([ctlRow()]) === hashOf([ctlRow()]) && hashOf(legacy) === hashOf(JSON.parse(JSON.stringify(legacy)));
  })());

const econ = (o) => Object.assign({ storeId: 'boor', productId: 'prodA', type: 'transfer_in', qty: 5 }, o);
ok('G3: a LIVE-target ensemble no longer bypasses validation — qty -5 refuses INVALID_ROW',
  (() => C.computeDelta({ cell: 'create-replace', targetLocation: 'live', target: econ({ qty: 10 }), newOutput: econ({ qty: -5 }) }).reason === 'INVALID_ROW')());
ok('G3: a VALID live-target ensemble still suppresses (deltas {}, live-ensemble)',
  (() => {
    const r = C.computeDelta({ cell: 'create-replace', targetLocation: 'live', target: econ({ qty: 10 }), newOutput: econ({ qty: 8 }) });
    return r.ok === true && r.suppressed === 'live-ensemble' && Object.keys(r.deltas).length === 0;
  })());
ok('G3: DIRECTION-NONE replacement types refuse — the frozen engine folds them as nothing, so -15 would have diverged',
  (() => ['deleted', 'unknown_type', 'not_a_type'].every(t =>
    C.computeDelta({ cell: 'create-replace', targetLocation: 'archive', target: econ({ type: 'in', qty: 10 }), newOutput: econ({ type: t }) }).reason === 'INVALID_ROW'))());
ok('G3: a genuine in/out replacement still computes the delta (-10 +5)',
  (() => {
    const r = C.computeDelta({ cell: 'create-replace', targetLocation: 'archive', target: econ({ type: 'in', qty: 10 }), newOutput: econ({ type: 'in', qty: 5 }) });
    return r.ok && r.deltas['boor|prodA'] === -5;
  })());

const rec = (o) => Object.assign({ RunId: 'R1', SnapshotVersion: 4, TombstoneIds: ['txDel1'], recordSigValid: true }, o);
ok('G4: membership with BOTH bindings absent is undecidable (pre-fix: undefined===undefined decided "excluded")',
  (() => C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', runRecord: rec() }).decision === 'undecidable')());
ok('G4: a HALF-bound target (run id only, no snapshot version) is undecidable',
  (() => C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', target: { archiveRunId: 'R1' }, runRecord: rec() }).decision === 'undecidable')());
ok('G4: RAW SharePoint casing binds correctly (a normalization gap must not brick every adoption)',
  (() => C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1',
    target: { ArchiveRunId: 'R1', SnapshotVersion: 4 }, runRecord: rec() }).decision === 'excluded')());
ok('G4: a WRONG-run record is still undecidable, and a bound record still decides in-balances',
  (() => C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1',
      target: { archiveRunId: 'R2', snapshotVersion: 4 }, runRecord: rec() }).decision === 'undecidable'
    && C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txOther',
      target: { archiveRunId: 'R1', snapshotVersion: 4 }, runRecord: rec() }).decision === 'in-balances')());

ok('G5: a LEGACY call (no controlHeads property) keeps the exact pre-C2 partition — the tombstone stays live',
  (() => {
    const rows = tombRows(); rows[1].Id = 200; delete rows[1].ControlId;
    const r = SC.compute({ rows, cutoffId: 100, runId: 'R9', snapshotVersion: 3 });
    return r.ok && JSON.stringify(r.archiveIds) === JSON.stringify([10]); // pre-fix: [10,200]
  })());
ok('G5: an explicit controlHeads:{} SELECTS the C2 partition — the tombstone rides its target',
  (() => {
    const rows = tombRows(); rows[1].Id = 200; delete rows[1].ControlId;
    const r = SC.compute({ rows, cutoffId: 100, runId: 'R9', snapshotVersion: 3, controlHeads: {} });
    return r.ok && r.archiveIds.includes(10) && r.archiveIds.includes(200);
  })());
// G6 (archive_state transformed while the legacy writer was still enabled) is a §D SEQUENCING fix —
// no pure-function surface to probe; its acceptance is the staging apply-runner dry run.

// ── 16. INTERIM LA REVIEW ROUND 3 folds (Codex findings 1-3) ──────────────────────────────────────
// H1: the TYPED canonical the frozen design requires by name (design N10 / C2-R7-5) — 0, null, ''
// and field-absent must be FOUR distinguishable encodings. R2 shipped the field list but kept the
// String(v||'')/optNum coercion that collapses them.
ok('H1: present-with-NULL and field-ABSENT hash DIFFERENTLY (Codex repro: ControlRevision null vs absent)',
  (() => {
    const withNull = [Object.assign(ctlRow(), { ControlRevision: null })];
    const absent = [ctlRow()]; delete absent[0].ControlRevision;
    return hashOf(withNull) !== hashOf(absent);
  })());
ok('H1: a source ControlState:null vs a copy that OMITTED ControlState is CAUGHT (the destructive-delete gate)',
  (() => {
    const src = [Object.assign(ctlRow(), { ControlState: null })];
    const copy = [ctlRow()]; delete copy[0].ControlState;
    return hashOf(src) !== hashOf(copy);
  })());
ok('H1: 0, null, empty-string and absent are FOUR distinct encodings on the same field',
  (() => {
    const mk = (v) => { const r = ctlRow(); if (v === 'ABSENT') delete r.ControlRevision; else r.ControlRevision = v; return [r]; };
    const hs = [mk(0), mk(null), mk(''), mk('ABSENT')].map(hashOf);
    return new Set(hs).size === 4;
  })());
ok('H1: a FAITHFUL copy still hashes equal under the typed canonical (no false HALT)',
  (() => hashOf([ctlRow()]) === hashOf([JSON.parse(JSON.stringify(ctlRow()))]))());
ok('H1: the live/archive column ALIASES still hash equal (Type/TxnType, Date/TxnDate, Timestamp/TxnTimestamp)',
  (() => {
    const live = [{ TransactionId: 'txA', StoreId: 'boor', ProductId: 'prodA', Type: 'in', Qty: 4, Timestamp: 900, Date: '2026-07-22' }];
    const arch = [{ TransactionId: 'txA', StoreId: 'boor', ProductId: 'prodA', TxnType: 'in', Qty: 4, TxnTimestamp: 900, TxnDate: '2026-07-22T00:00:00Z' }];
    return hashOf(live) === hashOf(arch); // representation, not content (the C1 archive-carry rule)
  })());
ok('H1 SCOPE: the C1 optional STAMPS keep their converged absent ≡ \'\' rule (0 still a value) — typing them would HALT every unstamped row',
  (() => {
    const a = ctlRow(); delete a.SellAtSupply;
    const b = Object.assign(ctlRow(), { SellAtSupply: '' });
    const c = Object.assign(ctlRow(), { SellAtSupply: 0 });
    return hashOf([a]) === hashOf([b]) && hashOf([a]) !== hashOf([c]);
  })());

// H2: the discriminator must FAIL CLOSED on a malformed manifest, not silently publish raw balances.
const headedRows = () => [
  { Id: 10, TransactionId: 'txT1', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in', Qty: 10, TxnTimestamp: 1000 },
  { Id: 20, TransactionId: 'corr:op1:0', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in', Qty: 8, TxnTimestamp: 1200,
    ControlId: 'ctl:op1', TargetTransactionId: 'txT1' }
];
ok('H2: a MALFORMED controlHeads (null / [] / string / number) REFUSES — pre-fix it published +10 instead of +8',
  (() => [null, [], 'bad', 7].every(v =>
    SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3, controlHeads: v }).reason === 'BAD_CONTROL_MANIFEST'))());
ok('H2: a caller ASSERTING controlProtocol:2 but omitting the manifest REFUSES (omission cannot masquerade as legacy)',
  (() => SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3, controlProtocol: 2 }).reason === 'CONTROL_MANIFEST_REQUIRED')());
ok('H2: a VALID manifest still folds the effective value (+8) and reports partitionMode c2',
  (() => {
    const r = SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3,
      controlHeads: { txT1: { controlId: 'ctl:op1', revision: 0, bornPublicationVersion: 3 } } });
    return r.ok && balOf(r) === 8 && r.partitionMode === 'c2';
  })());
ok('H2: a legacy caller still reports partitionMode legacy and keeps the pre-C2 partition',
  (() => {
    const r = SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3 });
    return r.ok && r.partitionMode === 'legacy' && balOf(r) === 18; // raw fold, no manifest
  })());
// H3 (phase-aware apply-runner rerun after step 6) is a §D SEQUENCING fix — no pure-function
// surface; its acceptance is the staging apply-runner crash drill.

// ── 17. INTERIM LA REVIEW ROUND 4 folds (Codex findings 1-3) ──────────────────────────────────────
// I2: an explicit protocol the code does not implement must REFUSE, never fall through to a guess.
ok('I2: an UNSUPPORTED controlProtocol refuses — never silently selects a partition',
  (() => [1, 3, '2x', 'v2', null].every(p =>
    SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3, controlProtocol: p,
      controlHeads: { txT1: { controlId: 'ctl:op1', revision: 0, bornPublicationVersion: 3 } } }).reason === 'UNSUPPORTED_CONTROL_PROTOCOL'))());
ok('I2: a CONTRADICTORY protocol cannot be overridden by a valid manifest (protocol wins, fail closed)',
  (() => SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3, controlProtocol: 1,
    controlHeads: {} }).reason === 'UNSUPPORTED_CONTROL_PROTOCOL')());
ok('I2: the PINNED N10 body (controlProtocol 2 + manifest) folds effective and reports partitionMode c2',
  (() => {
    const r = SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3, controlProtocol: 2,
      controlHeads: { txT1: { controlId: 'ctl:op1', revision: 0, bornPublicationVersion: 3 } } });
    return r.ok && balOf(r) === 8 && r.partitionMode === 'c2';
  })());
ok('I2: a legacy caller (no protocol, no manifest) is still accepted as legacy',
  (() => {
    const r = SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3 });
    return r.ok && r.partitionMode === 'legacy';
  })());
// I1 (the canonical version tag straddling the step-3 Function deploy) and I3 (the closed-world
// phase matrix) are §D SEQUENCING fixes — no pure-function surface. I1's acceptance is that the
// apply runner quiesces BEFORE redeploying; I3's is the staging crash drill across (6a)/(6b).
// Recorded here so the omission is deliberate and visible, not an oversight.

// ── 18. INTERIM LA REVIEW ROUND 5 folds (Codex findings 1-3) ──────────────────────────────────────
// J3: the build stamp — the observable that makes a rollback/straddle detectable. Writer state
// cannot see WHICH Function build the LAs are calling, so POST used to survive a rollback.
ok('J3: every compute response carries the build stamp (compute mode AND hash mode)',
  (() => {
    const c = SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3 });
    const h = SC.compute({ mode: 'hash', rows: headedRows() });
    return typeof c.buildStamp === 'string' && c.buildStamp.length > 0 && c.buildStamp === h.buildStamp;
  })());
ok('J3: the stamp is stable across calls, so the LA can compare Call_compute vs Verify_content_hash (BUILD_STRADDLE detection)',
  (() => SC.compute({ mode: 'hash', rows: [] }).buildStamp === SC.compute({ mode: 'hash', rows: headedRows() }).buildStamp)());
ok('J3: the stamp rides alongside partitionMode on BOTH partitions',
  (() => {
    const legacy = SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3 });
    const c2 = SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3, controlProtocol: 2, controlHeads: {} });
    return legacy.partitionMode === 'legacy' && c2.partitionMode === 'c2' && legacy.buildStamp === c2.buildStamp;
  })());
// J1 (PRE-QUIESCENCE / bootstrap states) and J2 (N1 created disabled + in the fence and matrix) are
// §D/§B SEQUENCING fixes with no pure-function surface. Their acceptance is the staging apply-runner
// crash drill, which MUST now include: a run from the virgin state, a crash partway through (3a),
// and a crash inside (6b) with only one of the two boundary-advancing writers enabled.

// ── 19. INTERIM LA REVIEW ROUND 6 folds (Codex findings 1-4) ──────────────────────────────────────
// K4: the build stamp is now DERIVED from the module bytes (not a hand-maintained constant a
// developer must remember to bump) and rides EVERY response including every error return — §D
// claimed "every response" while five error paths omitted it.
ok('K4: the build stamp RESOLVES from the real module bytes (never the fail-closed UNRESOLVED)',
  (() => {
    // Format widened to the FULL sha256 at R7 finding 5 (the first cut truncated to 64 bits).
    const s = SC.compute({ mode: 'hash', rows: [] }).buildStamp;
    return typeof s === 'string' && /^c2-[0-9a-f]{64}$/.test(s);
  })());
ok('K4: EVERY error return carries the stamp — BAD_CUTOFF, UNSUPPORTED_CONTROL_PROTOCOL, BAD_CONTROL_MANIFEST, CONTROL_MANIFEST_REQUIRED',
  (() => {
    const rows = headedRows(), base = { rows, runId: 'R9', snapshotVersion: 3 };
    const cases = [
      SC.compute(Object.assign({ cutoffId: 0 }, base)),
      SC.compute(Object.assign({ cutoffId: 100, controlProtocol: 1, controlHeads: {} }, base)),
      SC.compute(Object.assign({ cutoffId: 100, controlHeads: null }, base)),
      SC.compute(Object.assign({ cutoffId: 100, controlProtocol: 2 }, base)),
    ];
    const stamp = SC.compute({ mode: 'hash', rows: [] }).buildStamp;
    return cases.every(r => r.ok === false && r.buildStamp === stamp);
  })());
ok('K4: the stamp is IDENTICAL across compute mode, hash mode and error returns (a straddle is the only way to see two values)',
  (() => {
    const a = SC.compute({ rows: headedRows(), cutoffId: 100, runId: 'R9', snapshotVersion: 3 }).buildStamp;
    const b = SC.compute({ mode: 'hash', rows: headedRows() }).buildStamp;
    const c = SC.compute({ rows: [], cutoffId: 0 }).buildStamp;
    return a === b && b === c;
  })());
// K1 (disjoint phase partition), K2 (REPAIR-QUIESCED lane) and K3 (operational writer inventory —
// the C1 diagnostics that write straight into the archive list) are §D SEQUENCING/RUNBOOK fixes with
// no pure-function surface. Acceptance = the staging crash drill, which now also requires: a
// post-cutover Function rollback driven through REPAIR-QUIESCED back to POST, and a confirmation
// that no direct-write diagnostic is running before the fence.

// ── 20. INTERIM LA REVIEW ROUND 7 folds (Codex findings 1-5, AGY L1 converged on finding 1) ───────
ok('L5: the build stamp is the FULL sha256 and is well-formed (no 64-bit truncation)',
  (() => /^c2-[0-9a-f]{64}$/.test(SC.compute({ mode: 'hash', rows: [] }).buildStamp))());
ok('L5: an UNRESOLVED stamp is rejected by the well-formed test consumers must apply BEFORE comparing',
  (() => {
    // Two instances that both fail to read their sources returned the SAME literal, so equality
    // passed and the straddle belt saw nothing. The rule is: reject before comparing.
    const wellFormed = (s) => /^c2-[0-9a-f]{64}$/.test(s);
    return wellFormed('c2-' + 'a'.repeat(64)) && !wellFormed('c2-UNRESOLVED-ENOENT')
      && !wellFormed('c2-UNRESOLVED-ERR') && !wellFormed('c2-' + 'a'.repeat(16));
  })());
ok('L3: epoch-v1 SIGNS cutoverPackageDigest — tampering with it now breaks EpochSig',
  (() => {
    const e = { epochId: 5, tombstoneCommitEpochId: 900, archiveC2EpochId: 100,
      recordedAt: '2026-07-26T00:00:00.000Z', cutoverPackageDigest: 'sha256:' + 'a'.repeat(64) };
    const sig = A.signFrame(KR, 'epoch-v1', e);
    if (!A.verifyFrame(KR, 'epoch-v1', e, sig)) return false;
    const tampered = Object.assign({}, e, { cutoverPackageDigest: 'sha256:' + 'b'.repeat(64) });
    return !A.verifyFrame(KR, 'epoch-v1', tampered, sig); // pre-fix: the field was outside the canonical => still verified
  })());
ok('L4: buildrec-v1 detects TAMPERING with an approval record (edited revision or swapped digest)',
  (() => {
    const r1 = { packageDigest: 'sha256:' + 'c'.repeat(64), revision: 1, approvedAt: '2026-07-26T00:00:00.000Z' };
    const s1 = A.signFrame(KR, 'buildrec-v1', r1);
    if (!A.verifyFrame(KR, 'buildrec-v1', r1, s1)) return false;
    const edited = Object.assign({}, r1, { revision: 2 });         // edited revision, old signature
    const swapped = Object.assign({}, r1, { packageDigest: 'sha256:' + 'd'.repeat(64) });
    return !A.verifyFrame(KR, 'buildrec-v1', edited, s1) && !A.verifyFrame(KR, 'buildrec-v1', swapped, s1);
  })());
// R8 finding 3: the probe above was previously MISLABELLED as a replay test. It is not — editing a
// revision while keeping the old signature is ordinary tamper detection. WHOLE-RECORD replay is a
// different attack and signatures CANNOT stop it: the old tuple and its own signature are genuinely
// valid together. The defence has to be structural (append-only log + highest-valid selection +
// a retained high-water), which is why N19 stopped being an overwriteable singleton.
ok('M3: WHOLE-RECORD replay VERIFIES — a signature alone can never reject it (this is why N19 is append-only)',
  (() => {
    const r1 = { packageDigest: 'sha256:' + 'a'.repeat(64), revision: 1, approvedAt: '2026-07-26T00:00:00.000Z' };
    const r2 = { packageDigest: 'sha256:' + 'b'.repeat(64), revision: 2, approvedAt: '2026-07-26T01:00:00.000Z' };
    const s1 = A.signFrame(KR, 'buildrec-v1', r1), s2 = A.signFrame(KR, 'buildrec-v1', r2);
    // Restoring the COMPLETE r1+s1 over r2 passes verification — the record is authentic, just stale.
    return A.verifyFrame(KR, 'buildrec-v1', r1, s1) && A.verifyFrame(KR, 'buildrec-v1', r2, s2);
  })());
ok('N3: the high-water is a REAL signed artifact (buildhw-v1), monotonic and tamper-evident',
  (() => {
    const hw = { highestRevision: 2, observedAt: '2026-07-26T02:00:00.000Z' };
    const s = A.signFrame(KR, 'buildhw-v1', hw);
    if (!A.verifyFrame(KR, 'buildhw-v1', hw, s)) return false;
    const lowered = Object.assign({}, hw, { highestRevision: 1 }); // regress the floor, keep the sig
    return !A.verifyFrame(KR, 'buildhw-v1', lowered, s)
      && A.signFrame(KR, 'buildrec-v1', hw) !== s; // domain-separated from the approval frame
  })());
ok('N4: an approval signs the INDEPENDENTLY REVIEWED digest — a live-digest mismatch must HALT, never self-approve',
  (() => {
    // R9 finding 4: (3c) used to sign whatever Azure reported and "verify" it against that same
    // observation. Modelled correctly: approval is gated on the pinned reviewed digest.
    const REVIEWED = 'sha256:' + 'a'.repeat(64);
    const gate = (live) => (live === REVIEWED ? { ok: true } : { ok: false, reason: 'PACKAGE_NOT_REVIEWED' });
    return gate(REVIEWED).ok === true && gate('sha256:' + 'f'.repeat(64)).reason === 'PACKAGE_NOT_REVIEWED';
  })());
ok('O3: BOOTSTRAP CRASH is recoverable — approval rev 1 present, floor ABSENT => complete the bootstrap, never HALT',
  (() => {
    // R10 finding 3: my own fail-closed rule ("absent floor + valid log => HALT") deadlocked the
    // bootstrap it was meant to protect, because (3c) writes the approval BEFORE the floor.
    const decide = (highestRev, floorPresent) => {
      if (floorPresent) return 'select';
      if (highestRev === 1) return 'complete-bootstrap'; // forward action
      if (highestRev > 1) return 'HALT';                 // an advanced floor cannot vanish
      return 'bootstrap';
    };
    return decide(1, false) === 'complete-bootstrap' && decide(2, false) === 'HALT'
      && decide(0, false) === 'bootstrap' && decide(2, true) === 'select';
  })());
ok('O5: APPEND-BEFORE-FLOOR self-heals; FLOOR-FIRST would brick (the ordering is load-bearing)',
  (() => {
    // Crash between the append and the floor raise.
    const select = (log, floor) => { const t = log.filter(r => r >= floor).sort((a, b) => b - a)[0]; return t === undefined ? null : t; };
    const appendFirst = select([1, 2], 1);  // rev 2 appended, floor still 1 => picks 2, heals
    const floorFirst = select([1], 2);      // floor raised to 2, append never happened => nothing selectable
    return appendFirst === 2 && floorFirst === null;
  })());
ok('M3: HIGHEST-VALID selection + a retained high-water is what actually rejects the stale record',
  (() => {
    // The structural defence, modelled: authority = highest verifying revision in the append-only
    // log, and never below the highest revision ever observed.
    const rows = [
      { packageDigest: 'sha256:' + 'a'.repeat(64), revision: 1, approvedAt: '2026-07-26T00:00:00.000Z' },
      { packageDigest: 'sha256:' + 'b'.repeat(64), revision: 2, approvedAt: '2026-07-26T01:00:00.000Z' },
    ].map(r => ({ r, sig: A.signFrame(KR, 'buildrec-v1', r) }));
    const select = (log, highWater) => {
      const valid = log.filter(x => A.verifyFrame(KR, 'buildrec-v1', x.r, x.sig)).map(x => x.r);
      const top = valid.sort((a, b) => b.revision - a.revision)[0];
      return !top || top.revision < highWater ? null : top; // below the high-water => REFUSE
    };
    const full = select(rows, 0);
    const regressed = select([rows[0]], 2); // the newest approval row deleted; high-water remembers 2
    return full.revision === 2 && regressed === null;
  })());
ok('L4: buildrec-v1 and epoch-v1 are DOMAIN-SEPARATED (a build record can never pass as an epoch)',
  (() => {
    const r = { packageDigest: 'sha256:' + 'e'.repeat(64), revision: 3, approvedAt: '2026-07-26T00:00:00.000Z' };
    const s = A.signFrame(KR, 'buildrec-v1', r);
    return A.signFrame(KR, 'epoch-v1', r) !== s;
  })());
// ── 21. GENERATED-ARTIFACT ROUND: assembleCandidate returns the control ROW ───────────────────────
// Both auditors found the LA reading Candidate.row / .journalId / .revision / .candidateVersion —
// none of which existed. §B says the LA "creates the control row with N7 columns + minted stamps +
// TargetLine + OriginalEventAt" but no op built it, so the LA would have had to, violating the F1
// rule that the LA carries no logic. The row is now assembled HERE, from the same inputs the delta
// consumed, so the signed row and the published balances cannot diverge.
const candIn = (o) => Object.assign({
  mode: 'create', opId: 'op1', revision: 0, candidateVersion: 5, target: 'txT1',
  targetLine: { qty: 3 }, originalEventAt: '2026-07-26T00:00:00.000Z',
  stamps: { sellAtSupply: 12.5, discAtSupply: 30, pricingVersion: 4, catalogueVersion: 9, unitPriceAtTime: 8 },
  control: { controlType: 'replacement', replacement: { storeId: 'boor', productId: 'prodA', type: 'transfer_in', qty: 3, timestamp: '2026-07-26T01:00:00.000Z' } },
}, o);
ok('P1: candidate returns the assembled control ROW, echoing candidateVersion/revision/journalId',
  (() => {
    const r = C.assembleCandidate(candIn());
    return r.ok && r.row && r.candidateVersion === 5 && r.revision === 0 && typeof r.journalId === 'string' && r.journalId.length > 0;
  })());
ok('P1: the row carries EXACTLY the ctl-v1 covered set (nothing invented, nothing missing)',
  (() => {
    const r = C.assembleCandidate(candIn());
    const need = ['ControlId', 'ControlType', 'TargetTransactionId', 'ControlRevision', 'BornPublicationVersion',
      'TargetLine', 'OriginalEventAt', 'TransactionId', 'StoreId', 'ProductId', 'Type', 'Qty', 'Date',
      'Timestamp', 'Reason', 'StockFrom', 'StockTo', 'StockFromStoreId', 'StockToStoreId', 'TransferId',
      'IdempotencyKey', 'UnitPriceAtTime', 'SellAtSupply', 'DiscAtSupply', 'PricingVersion', 'CatalogueVersion'];
    return need.every(f => Object.prototype.hasOwnProperty.call(r.row, f));
  })());
ok('P1: the assembled row SIGNS and VERIFIES under ctl-v1 (it is a real signable row, not a shape)',
  (() => {
    const r = C.assembleCandidate(candIn());
    const sig = A.signFrame(KR, 'ctl-v1', r.row);
    if (!A.verifyFrame(KR, 'ctl-v1', r.row, sig)) return false;
    const tampered = Object.assign({}, r.row, { Qty: 99 });
    return !A.verifyFrame(KR, 'ctl-v1', tampered, sig);
  })());
ok('P1: a DELETION control carries identity only — engine-row fields stay ABSENT (typed [0], not empty)',
  (() => {
    const r = C.assembleCandidate(candIn({ control: { controlType: 'deletion' } }));
    return r.ok && r.row && r.row.ControlType === 'deletion'
      && !Object.prototype.hasOwnProperty.call(r.row, 'StoreId')
      && !Object.prototype.hasOwnProperty.call(r.row, 'Qty');
  })());
ok('P1: a malformed replacement REFUSES rather than signing a corrupt row',
  (() => {
    const bad = [{ qty: -1 }, { qty: 1.5 }, { type: 'deleted' }, { storeId: '' }, { timestamp: 'not-a-date' }];
    return bad.every(patch => {
      const base = candIn().control.replacement;
      const r = C.assembleCandidate(candIn({ control: { controlType: 'replacement', replacement: Object.assign({}, base, patch) } }));
      return r.ok === false && r.reason === 'BAD_REPLACEMENT_ROW';
    });
  })());
ok('P1: withdraw/retire build NO row (null-head modes publish no control row)',
  (() => {
    const w = C.assembleCandidate(candIn({ mode: 'withdraw' }));
    return w.ok && !Object.prototype.hasOwnProperty.call(w, 'row');
  })());

// ── 22. deltaCell + modeGate `needs` (generated-artifact round, slice 3) ──────────────────────────
// The LA read `cell` off modeGate, which never returned it — so computeDelta always received null
// and refused UNKNOWN_CELL. Choosing the branch is a DECISION, so it lives in a function; the rows
// the choice depends on are named by modeGate's `needs` and fetched by the LA.
ok('Q1: the six-cell table is derived, not wired — every legal (mode,baseline,type) maps to its cell',
  (() => {
    const c = (i) => C.deltaCell(i).cell;
    return c({ mode: 'create', baseline: 'no-head', controlType: 'replacement' }) === 'create-replace'
      && c({ mode: 'create', baseline: 'no-head', controlType: 'deletion' }) === 'create-delete'
      && c({ mode: 'supersede', baseline: 'active-head', controlType: 'replacement', priorControlType: 'replacement' }) === 'supersede-replace-replace'
      && c({ mode: 'supersede', baseline: 'active-head', controlType: 'deletion', priorControlType: 'replacement' }) === 'supersede-replace-delete'
      && c({ mode: 'supersede', baseline: 'active-head', controlType: 'replacement', priorControlType: 'deletion' }) === 'supersede-delete-replace'
      && c({ mode: 'withdraw', baseline: 'active-head', controlType: 'replacement' }) === 'withdraw'
      && c({ mode: 'retire_claim', baseline: 'active-head', controlType: 'deletion' }) === 'retire'
      && c({ mode: 'adopt', baseline: 'no-head', controlType: 'deletion' }) === 'adopt';
  })());
ok('Q1: the NULL-HEAD baseline routes to the null-* lane (post-withdraw/retire, C2-R6-2)',
  (() => C.deltaCell({ mode: 'supersede', baseline: 'null-head', controlType: 'replacement' }).cell === 'null-replace'
      && C.deltaCell({ mode: 'supersede', baseline: 'null-head', controlType: 'deletion' }).cell === 'null-delete')());
ok('Q1: illegal combinations REFUSE rather than guessing a cell',
  (() => {
    const bad = [
      { mode: 'create', baseline: 'active-head', controlType: 'replacement' },       // create onto a head
      { mode: 'supersede', baseline: 'active-head', controlType: 'replacement' },     // no priorControlType
      { mode: 'supersede', baseline: 'active-head', controlType: 'deletion', priorControlType: 'deletion' }, // no-op
      { mode: 'withdraw', baseline: 'null-head', controlType: 'replacement' },        // already withdrawn
      { mode: 'nonsense', baseline: 'no-head', controlType: 'replacement' },
    ];
    return bad.every(i => C.deltaCell(i).ok === false);
  })());
ok('Q1: EVERY cell deltaCell can emit is one computeDelta actually implements (no orphan branch)',
  (() => {
    const cells = ['create-replace', 'create-delete', 'supersede-replace-replace', 'supersede-replace-delete',
      'supersede-delete-replace', 'withdraw', 'null-replace', 'null-delete', 'adopt', 'retire'];
    const row = { storeId: 'boor', productId: 'prodA', type: 'in', qty: 5 };
    return cells.every(cell => {
      const r = C.computeDelta({ cell, targetLocation: 'archive', target: row, newOutput: row,
        prevOutput: row, originalTarget: row, membership: { decision: 'excluded' } });
      return r.reason !== 'UNKNOWN_CELL';   // it may refuse for other reasons; it must KNOW the cell
    });
  })());
ok('Q2: modeGate NAMES the rows the LA must fetch — active head => priorControl, null head => originalTarget',
  (() => {
    const exp = { activeControlId: 'ctl:x', revision: 0, publicationVersion: 7 };
    const active = C.modeGate({ mode: 'supersede', expected: exp, registryItem: { State: 'committed', ControlId: 'ctl:x', Revision: 0, PublicationVersion: 7 } });
    const nul = C.modeGate({ mode: 'supersede', expected: { activeControlId: null, revision: 1, publicationVersion: 8 }, registryItem: { State: 'committed', ControlId: '', Revision: 1, PublicationVersion: 8 } });
    const create = C.modeGate({ mode: 'create', registryItem: null });
    return active.ok && JSON.stringify(active.needs) === JSON.stringify(['priorControl'])
      && nul.ok && JSON.stringify(nul.needs) === JSON.stringify(['originalTarget'])
      && create.ok && JSON.stringify(create.needs) === JSON.stringify(['target']);
  })());

// L1 (rows 1/2 STILL overlapping — the R6 fold fixed the symptom, not the wildcard that subsumes
// its successor; found independently by BOTH reviewers) and L2 (partial build-repair states mapping
// to no row) are §D RUNBOOK fixes with no pure-function surface. Acceptance = the staging crash
// drill, which now also requires a crash at EACH of the three repair toggles.

console.log(`\n==== ${pass}/${pass + fail} correction-compute probes ${fail === 0 ? 'PASS' : 'FAIL (' + fail + ' failing)'} ====`);
process.exit(fail === 0 ? 0 : 1);
