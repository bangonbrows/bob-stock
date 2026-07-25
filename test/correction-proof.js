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
ok('OUTBOUND effect sign: deleting a usage(-4) row RESTORES +4',
  D(C.computeDelta({ cell: 'create-delete', targetLocation: 'archive', target: ROW(4, 'usage') })) === 4);
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
const cand = C.assembleCandidate({ mode: 'create', opId: 'op1', revision: 0, candidateVersion: 12, target: 'txT1' });
ok('deterministic ids: ctl:opId / corr:opId:rev', cand.ok && cand.controlId === 'ctl:op1' && cand.outputTransactionId === 'corr:op1:0');
ok('revision >0 joins the ctl id', C.assembleCandidate({ mode: 'supersede', opId: 'op1', revision: 2, candidateVersion: 13, target: 'txT1' }).controlId === 'ctl:op1:2');
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
const REC = { TombstoneIds: ['txDel1', 'txDel2'], recordSigValid: true };
ok('tombstone ∈ recorded set -> excluded (archiver already excluded the target)',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', runRecord: REC }).decision === 'excluded');
ok('tombstone ∉ set -> in-balances (the residual case)',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel9', runRecord: REC }).decision === 'in-balances');
ok('no record -> undecidable (fail-closed manual lane)',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', runRecord: null }).decision === 'undecidable');
ok('record with INVALID RecordSig -> undecidable',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel1', runRecord: { ...REC, recordSigValid: false } }).decision === 'undecidable');
ok('live target -> live (deltas suppressed by the normalization law)',
  C.membershipDecision({ targetLocation: 'live', tombstoneTransactionId: 'txDel1', runRecord: null }).decision === 'live');
ok('ABSENT-ROW retirement decides by the registry-retained TransactionId (C2-R10-3: no numeric coordinate needed)',
  C.membershipDecision({ targetLocation: 'archive', tombstoneTransactionId: 'txDel2', runRecord: REC }).decision === 'excluded');

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

console.log(`\n==== ${pass}/${pass + fail} correction-compute probes ${fail === 0 ? 'PASS' : 'FAIL (' + fail + ' failing)'} ====`);
process.exit(fail === 0 ? 0 : 1);
