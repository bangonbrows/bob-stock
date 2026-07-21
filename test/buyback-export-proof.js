#!/usr/bin/env node
/*
 * buyback-export-proof.js — OS-W4.4 logic-proof suite for
 * azure-functions/src/functions/buybackExport.js.
 * Runs the REAL engine module (required, not re-derived — blind-sentinel rule) against adversarial
 * fixtures. Every probe cites its pin (P1..P8 / W4-SR-*). Run: node test/buyback-export-proof.js
 */
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'buybackExport.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); } }
const J = (v) => JSON.parse(JSON.stringify(v));

// ── The VALID base fixture: a well-formed buy-back window that reaches FINAL ─────────────────────────
// Store 'boor', closed franchise era [2025-06-01, 2025-11-01). One attested stamped transfer (tr1),
// one attested direct HO-supply row, one sale, one wastage, one legacy lens transfer_in, one archived
// pre-epoch legacy row. Steps epoch id = 100.
const WFROM = '2025-06-01T00:00:00Z', WTO = '2025-11-01T00:00:00Z';
const TUP_A = { sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 };
function VALID() {
  return {
    storeId: 'boor',
    window: { from: WFROM, to: WTO },
    rows: {
      live: [
        { id: 'row_t1', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'tr1', idempotencyKey: 'transfer:tr1:receive:boor:prodA', stockFromStoreId: 'head_office', _spId: 200, ...TUP_A },
        { id: 'row_sale1', type: 'out', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-10', createdAt: '2025-07-10T05:00:00Z', idempotencyKey: 'row_sale1', stockTo: 'Customer Sale — walk-in', unitPriceAtTime: 150, _spId: 210 },
        { id: 'row_direct1', type: 'in', productId: 'prodB', storeId: 'boor', qty: 10, date: '2025-08-01', createdAt: '2025-08-01T02:00:00Z', idempotencyKey: 'row_direct1', stockFrom: 'HO Warehouse — bulk', stockFromStoreId: 'head_office', _spId: 220, _attested: true, sellAtSupply: 40, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 },
        { id: 'row_waste1', type: 'wastage', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-08-05', createdAt: '2025-08-05T02:00:00Z', idempotencyKey: 'row_waste1', _spId: 230 },
        // legacy DIRECT row (transferless, pre-stamps direct-log path): lens by client parity
        { id: 'row_legacy1', type: 'in', productId: 'prodB', storeId: 'boor', qty: 3, date: '2025-09-01', createdAt: '2025-09-01T02:00:00Z', stockFrom: 'HO Warehouse — old app', _spId: 90 },
      ],
      archive: [
        // legacy TRANSFER row (transferId but NO steps — pre-Chunk-4): epoch provenance via SourceId
        { id: 'row_arch1', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-06-15', createdAt: '2025-06-15T02:00:00Z', transferId: 'tr_old', stockFromStoreId: 'head_office', sourceId: 12 },
      ],
    },
    steps: [
      { stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'submit', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
        payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] } },
      { stepId: 'st2', recordId: 'tr1', recordType: 'transfer', stepType: 'receive', seq: 20, timestamp: Date.parse('2025-07-01T03:00:00Z'), _attested: true,
        payload: { lines: [{ productId: 'prodA', receivedQty: 5 }] } },
    ],
    controls: { live: [], archive: [], activeManifest: { version: 12, controlHeads: {} } },
    badVersionEvidence: { entries: [] },
    pricing: { storeMap: { '*': [{ rate: 25, from: '2025-06-01T00:00:00Z', to: null }] }, globalMap: {} },
    products: [ { id: 'prodA', price: 100 }, { id: 'prodB', price: 40 }, { id: 'serum', price: 50 } ],
    coverage: {
      continuity: true,
      live: { complete: true, leaseId: 'lease_1', runVersion: 7, window: { from: WFROM, to: WTO } },
      archive: { complete: true, leaseId: 'lease_1', runVersion: 7, window: { from: WFROM, to: WTO } },
      steps: { complete: true, leaseId: 'lease_1' },
      controls: { live: { complete: true, leaseId: 'lease_1' }, archive: { complete: true, leaseId: 'lease_1' } },
      badVersion: { complete: true, leaseId: 'lease_1' },
      stepsEpochId: 100,
    },
    graceClosed: true,
    drain: { graceRecords: [ { id: 'g1', state: 'committed', presentedIds: ['row_t1', 'row_sale1'], writtenIds: ['row_t1'], expectedStepIds: ['st1', 'st2'] } ] },
  };
}
const run = (mut) => { const v = VALID(); if (mut) mut(v); return E.buildBuybackExport(v); };
const line = (res, id) => res.ok && res.settlement.costLines.find(l => l.transactionId === id);

// ── P1: the valid fixture reaches FINAL with the right economics ─────────────────────────────────────
console.log('== base fixture (P1/P5/P6) ==');
const base = run();
ok('valid input => ok', base.ok === true, JSON.stringify(base));
ok('valid input => FINAL', base.ok && base.settlement.status === 'FINAL', base.ok ? base.settlement.provisionalReasons.join(';') : '');
ok('tier-1 corroborated transfer row billed at its stamps (100 x5 @25% => 375)', (() => { const l = line(base, 'row_t1'); return l && l.source === 'stamped' && l.owed === 375; })());
ok('attested direct HO-supply row billed (40 x10 @25% => 300)', (() => { const l = line(base, 'row_direct1'); return l && l.source === 'stamped' && l.owed === 300; })());
ok('legacy lens row billed via the chain (40 x3 @25% => 90)', (() => { const l = line(base, 'row_legacy1'); return l && l.source === 'store-default' && l.owed === 90; })());
ok('pre-epoch ARCHIVED legacy row billed via SourceId provenance (100 x2 @25% => 150)', (() => { const l = line(base, 'row_arch1'); return l && l.source === 'store-default' && l.owed === 150; })());
ok('sale revenue at the FROZEN UnitPriceAtTime (2 x150 = 300, K4)', base.ok && base.settlement.retailProfit.revenue === 300 && base.settlement.retailProfit.legacyPriceFallbackCount === 0);
ok('totals owed = 915; profit = revenue - supply cost', base.ok && base.settlement.totals.owed === 915 && base.settlement.retailProfit.profit === 300 - 915);
ok('wastage tallied in usage, not billed', base.ok && base.settlement.usage.prodA && base.settlement.usage.prodA.wastage === 1 && !line(base, 'row_waste1'));
ok('legacy-keyed row count surfaced (row_legacy1 + row_arch1 have no key)', base.ok && base.settlement.meta.legacyKeyedRowCount === 2);
ok('deterministic: identical inputs => identical settlement (clock-free, N4)', JSON.stringify(run()) === JSON.stringify(run()));

// ── envelope / shape (SR-90 provenance; conv-R4/R5 discipline) ───────────────────────────────────────
console.log('== envelope ==');
ok('null input refused', E.buildBuybackExport(null).reason === 'BAD_INPUT');
ok('flat rows ARRAY refused (provenance required, SR-90)', run(v => { v.rows = [...v.rows.live, ...v.rows.archive]; }).reason === 'BAD_ROWS_SHAPE');
ok('missing archive list refused', run(v => { delete v.rows.archive; }).reason === 'BAD_ROWS_SHAPE');
ok('bad storeId refused', run(v => { v.storeId = 'bad id!'; }).reason === 'BAD_STORE_ID');
ok('window from==to refused', run(v => { v.window.to = v.window.from; }).reason === 'BAD_WINDOW');
ok('calendar-day window refused (SR-25: UTC instants only)', run(v => { v.window.to = '2025-11-01'; }).reason === 'BAD_WINDOW');
ok('controls without activeManifest refused', run(v => { delete v.controls.activeManifest; }).reason === 'BAD_CONTROLS_SHAPE');
ok('controlHeads __proto__ key refused (JSON.parse ingress)', run(v => { v.controls.activeManifest.controlHeads = JSON.parse('{"__proto__":null}'); }).reason === 'BAD_CONTROLS_SHAPE');
ok('badVersionEvidence without entries refused', run(v => { v.badVersionEvidence = {}; }).reason === 'BAD_EVIDENCE_SHAPE');
ok('malformed evidence entry refused', run(v => { v.badVersionEvidence.entries = [{ rowId: '' }]; }).reason === 'BAD_EVIDENCE_SHAPE');
ok('unknown evidence terminal refused', run(v => { v.badVersionEvidence.entries = [{ rowId: 'x1', terminal: 'cleared' }]; }).reason === 'BAD_EVIDENCE_SHAPE');
ok('graceClosed as a string refused (strict boolean)', run(v => { v.graceClosed = 'true'; }).reason === 'BAD_INPUT');
ok('products non-array refused', run(v => { v.products = 'nope'; }).reason === 'BAD_PRODUCTS');
ok('drain non-shape refused', run(v => { v.drain = { graceRecords: 'nope' }; }).reason === 'BAD_DRAIN_SHAPE');

// ── pricing shape (P1 — wrong-shape pricing refused; the chain itself) ───────────────────────────────
console.log('== pricing ==');
ok('multi-store `stores` object refused as malformed (P1)', run(v => { v.pricing.storeMap = { boor: { '*': [{ rate: 25, from: WFROM, to: null }] } }; }).reason === 'MALFORMED_PRICING');
ok('bad storeMap key refused', run(v => { v.pricing.storeMap['bad key!'] = [{ rate: 25, from: WFROM, to: null }]; }).reason === 'MALFORMED_PRICING');
ok("global map with a '*' key refused (client validConfig parity)", run(v => { v.pricing.globalMap['*'] = [{ rate: 25, from: WFROM, to: null }]; }).reason === 'MALFORMED_PRICING');
ok('out-of-range stored rate refused', run(v => { v.pricing.storeMap['*'] = [{ rate: 999, from: WFROM, to: null }]; }).reason === 'MALFORMED_PRICING');
ok('overlapping intervals refused', run(v => { v.pricing.storeMap['*'] = [{ rate: 10, from: WFROM, to: null }, { rate: 20, from: '2025-07-01T00:00:00Z', to: null }]; }).reason === 'MALFORMED_PRICING');
ok('chain: store-override beats global beats store-default', (() => {
  const r = run(v => {
    v.pricing.storeMap.prodB = [{ rate: 50, from: WFROM, to: null }];
    v.pricing.globalMap.prodB = [{ rate: 40, from: WFROM, to: null }];
  });
  const l = line(r, 'row_legacy1');
  return l && l.discPct === 50 && l.source === 'store-override';
})());
ok('chain: global tier used when no override', (() => {
  const r = run(v => { v.pricing.globalMap.prodB = [{ rate: 40, from: WFROM, to: null }]; });
  const l = line(r, 'row_legacy1');
  return l && l.discPct === 40 && l.source === 'global';
})());
ok('lens resolves HISTORICALLY (interval boundary [from,to) exclusive; a later rate change never rewrites)', (() => {
  const r = run(v => { v.pricing.storeMap['*'] = [{ rate: 25, from: WFROM, to: '2025-09-01T00:00:00Z' }, { rate: 10, from: '2025-09-01T00:00:00Z', to: null }]; });
  const lOld = line(r, 'row_arch1');      // 2025-06-15 => 25
  const lNew = line(r, 'row_legacy1');    // 2025-09-01 midnight => the NEW interval ([from,to) exclusive)
  return lOld && lOld.discPct === 25 && lNew && lNew.discPct === 10;
})());
ok('valid config, uncovered date => honest NOT_SET at 0% (surfaced, FINAL keeps)', (() => {
  const r = run(v => { v.pricing.storeMap['*'] = [{ rate: 25, from: '2025-10-01T00:00:00Z', to: null }]; });
  const l = line(r, 'row_legacy1');
  return r.ok && l && l.discPct === 0 && l.lineErr === 'NOT_SET' && r.settlement.meta.notSet.includes('row_legacy1') && r.settlement.status === 'FINAL';
})());

// ── coverage (P4 — SR-26/56/92/93/95/170) ────────────────────────────────────────────────────────────
console.log('== coverage ==');
ok('live attestation incomplete refused', run(v => { v.coverage.live.complete = false; }).reason === 'BAD_COVERAGE');
ok('continuity post-check absent refused (SR-93)', run(v => { v.coverage.continuity = false; }).reason === 'BAD_COVERAGE');
ok('lease mismatch across queries refused (SR-93)', run(v => { v.coverage.archive.leaseId = 'lease_2'; }).reason === 'LEASE_MISMATCH');
ok('steps attestation under a different lease refused (SR-114)', run(v => { v.coverage.steps.leaseId = 'lease_2'; }).reason === 'LEASE_MISMATCH');
ok('run-version mismatch live vs archive refused (SR-92)', run(v => { v.coverage.archive.runVersion = 8; }).reason === 'RUN_VERSION_MISMATCH');
ok('attested union != settlement window refused (never a silently short settlement)', run(v => { v.coverage.live.window.to = '2025-10-01T00:00:00Z'; }).reason === 'BAD_COVERAGE');
ok('controls attestation missing refused (SR-123)', run(v => { delete v.coverage.controls.archive; }).reason === 'BAD_COVERAGE');
ok('badVersion watermark missing refused (SR-170)', run(v => { delete v.coverage.badVersion; }).reason === 'BAD_COVERAGE');
ok('stepsEpochId missing refused (SR-129)', run(v => { delete v.coverage.stepsEpochId; }).reason === 'BAD_COVERAGE');

// ── rows: window + binding + money (P2/P7) ───────────────────────────────────────────────────────────
console.log('== rows: window/binding/money ==');
ok('wrong-store row refused (P2 re-check)', run(v => { v.rows.live[0].storeId = 'karr'; }).reason === 'WRONG_STORE_ROW');
ok('row instant as a calendar day refused (SR-25)', run(v => { v.rows.live[0].createdAt = '2025-07-01'; }).reason === 'BAD_ROW_INSTANT');
ok('rolled-over instant (2025-02-30) refused', run(v => { v.rows.live[0].createdAt = '2025-02-30T00:00:00Z'; }).reason === 'BAD_ROW_INSTANT');
ok('row at exactly window.to EXCLUDED (S-W4-5)', (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_at_to', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 4, date: '2025-11-01', createdAt: WTO, stockFromStoreId: 'head_office', _spId: 300, idempotencyKey: 'row_at_to', ...TUP_A }); });
  return r.ok && !line(r, 'row_at_to') && r.settlement.totals.owed === 915;
})());
ok('row at exactly window.from INCLUDED', (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_at_from', type: 'transfer_in', productId: 'prodB', storeId: 'boor', qty: 1, date: '2025-06-01', createdAt: WFROM, stockFrom: 'HO Warehouse — x', _spId: 60, idempotencyKey: 'row_at_from' }); });
  const l = line(r, 'row_at_from');
  return l && l.owed === 30;   // 40 @25%
})());
ok('post-buy-back HO row excluded (S-W4-5)', (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_post', type: 'in', productId: 'prodB', storeId: 'boor', qty: 100, date: '2025-12-01', createdAt: '2025-12-01T02:00:00Z', stockFromStoreId: 'head_office', _attested: true, sellAtSupply: 40, discAtSupply: 0, pricingVersion: 4, catalogueVersion: 8, _spId: 400, idempotencyKey: 'row_post' }); });
  return r.ok && !line(r, 'row_post') && r.settlement.totals.owed === 915;
})());
ok('PARTIAL authority tuple on a row refused (SR-169 corruption class)', run(v => { delete v.rows.live[0].catalogueVersion; }).reason === 'MALFORMED_ROW');
ok('3dp money refused', run(v => { v.rows.live[0].sellAtSupply = 100.005; }).reason === 'MALFORMED_ROW');
ok('string-typed money refused (no coercion)', run(v => { v.rows.live[0].sellAtSupply = '100'; }).reason === 'MALFORMED_ROW');
ok('sell over 1,000,000 refused (the CLIENT cap, not badMoney 10M)', run(v => { v.rows.live[0].sellAtSupply = 1000001; }).reason === 'MALFORMED_ROW');
ok('discount 101 refused', run(v => { v.rows.live[0].discAtSupply = 101; }).reason === 'MALFORMED_ROW');
ok('negative qty refused', run(v => { v.rows.live[0].qty = -1; }).reason === 'MALFORMED_ROW');
ok('out-of-policy UnitPriceAtTime refused (K4 same policy)', run(v => { v.rows.live[1].unitPriceAtTime = 150.005; }).reason === 'MALFORMED_ROW');
ok('malformed server-resolved fields refused (partial _rv tuple)', run(v => { v.rows.live[0]._rvSell = 10; }).reason === 'MALFORMED_ROW');

// ── dedup (P3 — SR-55/96/109) ────────────────────────────────────────────────────────────────────────
console.log('== dedup ==');
ok('same-ID bit-identical copies across lists collapse (counted once)', (() => {
  const r = run(v => { v.rows.archive.push(J(v.rows.live[0])); });
  return r.ok && r.settlement.totals.owed === 915;
})());
ok('same-ID DIFFERING copies fail closed (SR-55)', run(v => { const c = J(v.rows.live[0]); c.qty = 6; v.rows.archive.push(c); }).reason === 'DUPLICATE_ID_CONFLICT');
ok('distinct IDs sharing a non-empty IdempotencyKey fail closed (SR-96)', run(v => { v.rows.live[1].idempotencyKey = v.rows.live[0].idempotencyKey; }).reason === 'IDEMPOTENCY_KEY_CONFLICT');
ok('blank keys NEVER group (two blank-key rows coexist; surfaced legacy count)', (() => {
  const r = run(v => { v.rows.live[1].idempotencyKey = ''; });
  return r.ok && r.settlement.meta.legacyKeyedRowCount === 3;
})());

// ── controls (P2 — SR-115/123/124/130/141/144/145/148/150/151) ───────────────────────────────────────
console.log('== controls ==');
const HEAD = (cid, rev, born) => ({ controlId: cid, revision: rev, bornPublicationVersion: born });
const TL_T1 = { transferId: 'tr1', productId: 'prodA', qty: 5 };   // server-declared authoritative line for row_t1 (W44-R5)
const DEL1 = { controlId: 'ctl_d1', type: 'deletion', targetTransactionId: 'row_t1', revision: 1, bornPublicationVersion: 11, targetLine: TL_T1 };
ok('untargeted control refused (P2)', run(v => {
  v.controls.live.push({ ...DEL1, targetTransactionId: 'ghost_row' });
  v.controls.activeManifest.controlHeads.ghost_row = HEAD('ctl_d1', 1, 11);
}).reason === 'UNTARGETED_CONTROL');
ok('deletion REMOVES the target from the settlement + covers its identity', (() => {
  const r = run(v => { v.controls.live.push(J(DEL1)); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_d1', 1, 11); });
  return r.ok && !line(r, 'row_t1') && r.settlement.totals.owed === 915 - 375 && r.settlement.status === 'FINAL'
    && r.settlement.meta.coveredIdentities.includes('row_t1');   // presented row_t1 stays accounted: COVERED
})());
ok('control supplied but head names a DIFFERENT revision => refused (SR-151)', run(v => {
  v.controls.live.push(J(DEL1)); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_d1', 2, 11);
}).reason === 'CONTROL_HEAD_MISMATCH');
ok('control with NO active head refused (not the effective revision)', run(v => { v.controls.live.push(J(DEL1)); }).reason === 'CONTROL_HEAD_MISMATCH');
ok('WITHDRAWN target (explicit null head) + a supplied control refused', run(v => {
  v.controls.live.push(J(DEL1)); v.controls.activeManifest.controlHeads.row_t1 = null;
}).reason === 'CONTROL_HEAD_MISMATCH');
ok('born > active version refused (SR-151)', run(v => {
  v.controls.live.push(J(DEL1)); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_d1', 1, 13);
}).reason === 'CONTROL_HEAD_MISMATCH');
ok('active head over a supplied identity with NO supplied control => refused (completeness)', run(v => {
  v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_d1', 1, 11);
}).reason === 'MISSING_CONTROL');
ok('two controls on one target fail closed (SR-144 ambiguity)', run(v => {
  v.controls.live.push(J(DEL1), { controlId: 'ctl_d2', type: 'deletion', targetTransactionId: 'row_t1', revision: 1, bornPublicationVersion: 11 });
  v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_d1', 1, 11);
}).reason === 'CONTROL_AMBIGUITY');
ok('cross-list control => fail-closed conflict (SR-70)', run(v => {
  v.controls.live.push({ ...J(DEL1), targetTransactionId: 'row_arch1' });
  v.controls.activeManifest.controlHeads.row_arch1 = HEAD('ctl_d1', 1, 11);
}).reason === 'CROSS_LIST_CONTROL_CONFLICT');
ok('unknown control type refused (exactly two types, no delta — SR-124)', run(v => {
  v.controls.live.push({ ...J(DEL1), type: 'delta' });
  v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_d1', 1, 11);
}).reason === 'MALFORMED_CONTROL');
// originalEventAt = the SERVER submit instant of tr1 (02:00), which the engine binds to (W44-R5 Codex-3)
const REPL = (over) => Object.assign({
  controlId: 'ctl_r1', type: 'replacement', targetTransactionId: 'row_t1', revision: 1, bornPublicationVersion: 11, targetLine: TL_T1,
  row: { id: 'ctl_r1_row', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 4, originalEventAt: '2025-07-01T02:00:00Z', stockFromStoreId: 'head_office', sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 },
}, over || {});
ok('replacement SUBSTITUTES: original excluded, server-minted row billed at ITS stamps (SR-124/134)', (() => {
  const r = run(v => { v.controls.live.push(REPL()); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11); });
  const l = line(r, 'ctl_r1_row');
  return r.ok && !line(r, 'row_t1') && l && l.source === 'control' && l.owed === 300 && r.settlement.totals.owed === 915 - 375 + 300 && r.settlement.status === 'FINAL';
})());
ok('UNSTAMPED replacement is malformed (SR-130)', run(v => {
  const c = REPL(); delete c.row.sellAtSupply; delete c.row.discAtSupply; delete c.row.pricingVersion; delete c.row.catalogueVersion;
  v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11);
}).reason === 'MALFORMED_CONTROL');
ok('replacement original-event as a calendar day refused (SR-130)', run(v => {
  const c = REPL(); c.row.originalEventAt = '2025-07-01';
  v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11);
}).reason === 'MALFORMED_CONTROL');
ok('W44-R1 Codex-2: a replacement whose original instant DISAGREES with its present target is refused (no silent window-shift under-billing, SR-142)', run(v => {
  const c = REPL(); c.row.originalEventAt = '2025-12-01T00:00:00Z';   // target row_t1 sits at 2025-07-01 (in-window)
  v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11);
}).reason === 'CONTROL_INSTANT_MISMATCH');
ok('replacement of an out-of-window OWN-INSTANT-BOUND target is legitimately excluded (both out => net zero)', (() => {
  // target row_pre sits BEFORE the window; the replacement carries the SAME (out-of-window) instant.
  const r = run(v => {
    // transferless direct-log target (its transfer-linkage is irrelevant to this test) sitting BEFORE the window
    v.rows.live.push({ id: 'row_pre', type: 'in', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-05-01', createdAt: '2025-05-01T00:00:00Z', idempotencyKey: 'row_pre', stockFromStoreId: 'head_office', _spId: 205, _attested: true, ...TUP_A });
    v.controls.live.push({ controlId: 'ctl_pre', type: 'replacement', targetTransactionId: 'row_pre', revision: 1, bornPublicationVersion: 11,
      row: { id: 'ctl_pre_row', type: 'in', productId: 'prodA', storeId: 'boor', qty: 4, originalEventAt: '2025-05-01T00:00:00Z', stockFromStoreId: 'head_office', ...TUP_A } });
    v.controls.activeManifest.controlHeads.row_pre = HEAD('ctl_pre', 1, 11);
  });
  return r.ok && !line(r, 'ctl_pre_row') && !line(r, 'row_pre') && r.settlement.totals.owed === 915 && r.settlement.status === 'FINAL';
})());
ok('CROSS-PRODUCT replacement values at the REPLACEMENT product\'s server-minted stamps, no origin proof (SR-145/150)', (() => {
  const c = REPL(); c.row.productId = 'prodB'; c.row.sellAtSupply = 40;
  const r = run(v => { v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11); });
  const l = line(r, 'ctl_r1_row');
  return r.ok && l && l.owed === 120 && r.settlement.status === 'FINAL';   // 40 x4 @25%
})());
ok('replacement correcting a NON-HO movement is NOT billed (same line filter)', (() => {
  const c = REPL(); c.row.stockFromStoreId = 'karr';
  const r = run(v => { v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11); });
  return r.ok && !line(r, 'ctl_r1_row') && r.settlement.totals.owed === 915 - 375;
})());
ok('wrong-store replacement row refused', run(v => {
  const c = REPL(); c.row.storeId = 'karr';
  v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11);
}).reason === 'MALFORMED_CONTROL');
ok('W44-R2 Codex-1: a replacement CHAIN (a control targeting another replacement\'s output) fails closed (SR-146)', (() => {
  const r = run(v => {
    v.rows.live.push({ id: 'rowA', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 4, date: '2025-07-02', createdAt: '2025-07-02T03:00:00Z', idempotencyKey: 'rowA', stockFromStoreId: 'head_office', _spId: 51, _attested: true, ...TUP_A });
    v.controls.live.push(
      { controlId: 'ctlA', type: 'replacement', targetTransactionId: 'row_t1', revision: 1, bornPublicationVersion: 11, targetLine: TL_T1, row: { id: 'rowA', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 4, originalEventAt: '2025-07-01T02:00:00Z', stockFromStoreId: 'head_office', ...TUP_A } },
      { controlId: 'ctlB', type: 'replacement', targetTransactionId: 'rowA', revision: 1, bornPublicationVersion: 11, row: { id: 'rowB', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, originalEventAt: '2025-07-02T03:00:00Z', stockFromStoreId: 'head_office', ...TUP_A } });
    v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctlA', 1, 11);
    v.controls.activeManifest.controlHeads.rowA = HEAD('ctlB', 1, 11);
  }).reason === 'CONTROL_CHAIN';
  return r;
})());
ok('W44-R2 Codex-1: a replacement output id colliding with a supplied ledger row fails closed', run(v => {
  v.controls.live.push({ controlId: 'ctlC', type: 'replacement', targetTransactionId: 'row_direct1', revision: 1, bornPublicationVersion: 11, row: { id: 'row_t1', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 1, originalEventAt: '2025-08-01T02:00:00Z', stockFromStoreId: 'head_office', ...TUP_A } });
  v.controls.activeManifest.controlHeads.row_direct1 = HEAD('ctlC', 1, 11);
}).reason === 'CONTROL_OUTPUT_COLLISION');
ok('W44-R2 Codex-1: two replacements minting the same output id fail closed', run(v => {
  v.controls.live.push(
    { controlId: 'ctlD', type: 'replacement', targetTransactionId: 'row_t1', revision: 1, bornPublicationVersion: 11, targetLine: TL_T1, row: { id: 'dup_out', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 1, originalEventAt: '2025-07-01T02:00:00Z', stockFromStoreId: 'head_office', ...TUP_A } },
    { controlId: 'ctlE', type: 'replacement', targetTransactionId: 'row_direct1', revision: 1, bornPublicationVersion: 11, row: { id: 'dup_out', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 1, originalEventAt: '2025-08-01T02:00:00Z', stockFromStoreId: 'head_office', ...TUP_A } });
  v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctlD', 1, 11);
  v.controls.activeManifest.controlHeads.row_direct1 = HEAD('ctlE', 1, 11);
}).reason === 'CONTROL_OUTPUT_COLLISION');
ok('replacement row missing its id is malformed', run(v => {
  const c = REPL(); delete c.row.id;
  v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11);
}).reason === 'MALFORMED_CONTROL');
ok('duplicate controlId with identical content collapses; differing content is ambiguity', (() => {
  const a = run(v => { v.controls.live.push(J(DEL1), J(DEL1)); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_d1', 1, 11); });
  const c2 = J(DEL1); c2.revision = 2;
  const b = run(v => { v.controls.live.push(J(DEL1), c2); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_d1', 1, 11); });
  return a.ok === true && b.reason === 'CONTROL_AMBIGUITY';
})());

// ── steps / projection / valuation tiers (P6 — SR-97/122/129/152/153/154/155/158/169) ────────────────
console.log('== valuation tiers ==');
ok('FORGED row stamps (differ from the attested minting step) never paid; FINAL refused (SR-152)', (() => {
  const r = run(v => { v.rows.live[0].sellAtSupply = 1; v.rows.live[0].discAtSupply = 99; });
  const l = line(r, 'row_t1');
  return r.ok && l && l.owed === 0 && l.lineErr === 'UNATTESTED' && r.settlement.status === 'PROVISIONAL'
    && r.settlement.provisionalReasons.some(x => x === 'UNCORROBORATED_ROW:row_t1');
})());
ok('UNATTESTED minting step => tier-1 row not paid; FINAL refused (SR-153)', (() => {
  const r = run(v => { v.steps[0]._attested = false; });
  const l = line(r, 'row_t1');
  return r.ok && l && l.owed === 0 && r.settlement.status === 'PROVISIONAL';
})());
ok('transferless stamped row WITHOUT the server attestation column not paid (SR-155)', (() => {
  const r = run(v => { delete v.rows.live[2]._attested; });
  const l = line(r, 'row_direct1');
  return r.ok && l && l.owed === 0 && r.settlement.status === 'PROVISIONAL'
    && r.settlement.provisionalReasons.some(x => x === 'UNATTESTED_ROW:row_direct1');
})());
ok('STALE-RECEIVER row (unstamped) bills at the ATTESTED submit stamps — tier 2 (SR-97)', (() => {
  const r = run(v => { delete v.rows.live[0].sellAtSupply; delete v.rows.live[0].discAtSupply; delete v.rows.live[0].pricingVersion; delete v.rows.live[0].catalogueVersion; });
  const l = line(r, 'row_t1');
  return r.ok && l && l.source === 'transfer-stamped' && l.owed === 375 && r.settlement.status === 'FINAL';
})());
ok('tier 2 from an UNATTESTED mint never pays (engineer note N3)', (() => {
  const r = run(v => {
    delete v.rows.live[0].sellAtSupply; delete v.rows.live[0].discAtSupply; delete v.rows.live[0].pricingVersion; delete v.rows.live[0].catalogueVersion;
    v.steps[0]._attested = false;
  });
  const l = line(r, 'row_t1');
  return r.ok && l && l.owed === 0 && r.settlement.provisionalReasons.some(x => x === 'UNATTESTED_ITEM:row_t1');
})());
ok('BACKFILL-only stamps + server-resolved row fields => paid from the SERVER resolution (SR-158/163)', (() => {
  const r = run(v => {
    v.steps[0] = { stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'backfill', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), _attested: true,
      payload: { snapshot: { fromStoreId: 'head_office', toStoreId: 'boor', items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] } } };
    delete v.rows.live[0].sellAtSupply; delete v.rows.live[0].discAtSupply; delete v.rows.live[0].pricingVersion; delete v.rows.live[0].catalogueVersion;
    Object.assign(v.rows.live[0], { _rvSell: 90, _rvDisc: 20, _rvPv: 3, _rvCv: 7 });
  });
  const l = line(r, 'row_t1');
  return r.ok && l && l.source === 'server-resolved' && l.owed === 360 && r.settlement.status === 'FINAL';   // 90 x5 @20%
})());
ok('BACKFILL-only stamps, NO server resolution => loud VALUATION_PENDING; FINAL NOT blocked (SR-154)', (() => {
  const r = run(v => {
    v.steps[0] = { stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'backfill', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), _attested: true,
      payload: { snapshot: { fromStoreId: 'head_office', toStoreId: 'boor', items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] } } };
    delete v.rows.live[0].sellAtSupply; delete v.rows.live[0].discAtSupply; delete v.rows.live[0].pricingVersion; delete v.rows.live[0].catalogueVersion;
  });
  const l = line(r, 'row_t1');
  return r.ok && l && l.owed === 0 && l.lineErr === 'VALUATION_PENDING'
    && r.settlement.meta.pendingValuations.includes('row_t1') && r.settlement.status === 'FINAL';
})());
ok('steps present but NO origin (receive without genesis) => fail closed, PROVISIONAL, no economics (SR-122)', (() => {
  const r = run(v => {
    v.steps = [v.steps[1]]; v.drain.graceRecords[0].expectedStepIds = ['st2'];
    const t = v.rows.live[0];   // origin assertion gates the UNSTAMPED fallback (SR-150)
    delete t.sellAtSupply; delete t.discAtSupply; delete t.pricingVersion; delete t.catalogueVersion;
  });
  return r.ok && !line(r, 'row_t1') && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.some(x => x === 'ORIGIN_UNPROVEN:row_t1');
})());
ok('NO steps + POST-epoch id => the resurrection corner fails closed, PROVISIONAL + surfaced (SR-129)', (() => {
  const r = run(v => { v.steps = []; v.drain.graceRecords[0].expectedStepIds = []; delete v.rows.live[0].sellAtSupply; delete v.rows.live[0].discAtSupply; delete v.rows.live[0].pricingVersion; delete v.rows.live[0].catalogueVersion; });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'POST_EPOCH_NO_STEPS:row_t1');   // _spId 200 >= epoch 100
})());
ok('NO steps + PRE-epoch id => genuine legacy, lens (SR-129)', (() => {
  const r = run(v => {
    v.steps = []; v.drain.graceRecords[0].expectedStepIds = [];
    const t = v.rows.live[0];
    delete t.sellAtSupply; delete t.discAtSupply; delete t.pricingVersion; delete t.catalogueVersion;
    t._spId = 50;   // < epoch 100
  });
  const l = line(r, 'row_t1');
  return r.ok && l && l.source === 'store-default' && l.owed === 375 && r.settlement.status === 'FINAL';   // 100 x5 @25%
})());
ok('ARCHIVED row epoch uses the preserved SourceId, never the archive item id (SR-129)', (() => {
  const r = run(v => { v.rows.archive[0].sourceId = 500; });   // post-epoch => resurrection corner
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'POST_EPOCH_NO_STEPS:row_arch1');
})());
ok('absent provenance id => refuse the legacy claim, PROVISIONAL (SR-129)', (() => {
  const r = run(v => { delete v.rows.archive[0].sourceId; });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'PROVENANCE_ABSENT:row_arch1');
})());
ok('PARTIAL item tuple in a step => refusal (SR-169/W4.3 R3)', run(v => { delete v.steps[0].payload.items[0].catalogueVersion; }).reason === 'MALFORMED_STEP_STAMPS');
ok('stamped basis WITHOUT authority fields in a step => refusal (SR-162/167 cross-class)', run(v => {
  v.steps[0].payload.items[0] = { productId: 'prodA', sentQty: 5, basis: 'submit-stamped' };
}).reason === 'MALFORMED_STEP_STAMPS');
ok('legacy-lens basis WITH authority fields => refusal (SR-167 cross-class)', run(v => {
  v.steps[0].payload.items[0].basis = 'legacy-lens';
}).reason === 'MALFORMED_STEP_STAMPS');
ok('stamped honest 0% stays LOUD (NOT_SET surfaced, still FINAL)', (() => {
  const r = run(v => { v.rows.live[2].discAtSupply = 0; v.rows.live[2].sellAtSupply = 40; });
  const l = line(r, 'row_direct1');
  return r.ok && l && l.lineErr === 'NOT_SET' && l.owed === 400 && r.settlement.meta.notSet.includes('row_direct1') && r.settlement.status === 'FINAL';
})());
ok('lens row with NO date => fail closed, PROVISIONAL', (() => {
  const r = run(v => { delete v.rows.live[4].date; });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'NO_LENS_DATE:row_legacy1');
})());

// projection unit probes (the client-fold parity core — the smoke sentinel S-284 runs the SAME
// fixtures against the REAL client fold; here the engine side is pinned)
console.log('== projection fold ==');
const ST = (type, payload, over) => Object.assign({ stepId: 's_' + type + (over && over.seq || ''), recordId: 'trX', recordType: 'transfer', stepType: type, timestamp: 1000, payload }, over || {});
ok('submit-stamped is PERMANENT (a stale stampless receive cannot downgrade — SR-97)', (() => {
  const p = E.foldProjection([
    ST('submit', { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] }, { seq: 10, _attested: true, fromStoreId: 'head_office', toStoreId: 'boor' }),
    ST('receive', { lines: [{ productId: 'prodA', receivedQty: 5 }] }, { seq: 20 }),
  ]);
  const it = p.items.get('prodA');
  return it && it.tuple && it.tuple.sell === 100 && it.basis === 'submit-stamped' && it.mintAttested === true;
})());
ok('receive MINTS for a stampless submit (receive-stamped)', (() => {
  const p = E.foldProjection([
    ST('submit', { items: [{ productId: 'prodA', sentQty: 5 }] }, { seq: 10, fromStoreId: 'head_office', toStoreId: 'boor' }),
    ST('receive', { lines: [{ productId: 'prodA', receivedQty: 5, basis: 'receive-stamped', ...TUP_A }] }, { seq: 20, _attested: true }),
  ]);
  const it = p.items.get('prodA');
  return it && it.tuple && it.basis === 'receive-stamped' && it.mintAttested === true;
})());
ok('basis-less receive of a stampless submit => durable legacy-lens', (() => {
  const p = E.foldProjection([
    ST('submit', { items: [{ productId: 'prodA', sentQty: 5 }] }, { seq: 10 }),
    ST('receive', { lines: [{ productId: 'prodA', receivedQty: 5 }] }, { seq: 20 }),
  ]);
  const it = p.items.get('prodA');
  return it && !it.tuple && it.basis === 'legacy-lens';
})());
ok('resolve PINS the outcome over a receive (SR-85)', (() => {
  const p = E.foldProjection([
    ST('submit', { items: [{ productId: 'prodA', sentQty: 5 }] }, { seq: 10 }),
    ST('receive', { lines: [{ productId: 'prodA', receivedQty: 5, basis: 'receive-stamped', ...TUP_A }] }, { seq: 20, _attested: true }),
    ST('resolve', { resolutions: [{ productId: 'prodA', action: 'adjust', sellAtSupply: 80, discAtSupply: 10, pricingVersion: 4, catalogueVersion: 8, basis: 'receive-stamped' }] }, { seq: 30, _attested: true }),
  ]);
  const it = p.items.get('prodA');
  return it && it.tuple && it.tuple.sell === 80 && it.tuple.disc === 10;
})());
ok('a step tuple UPGRADES an untrusted backfill tuple (R1 Codex-2)', (() => {
  const p = E.foldProjection([
    ST('backfill', { snapshot: { fromStoreId: 'head_office', toStoreId: 'boor', items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] } }, { seq: 10 }),
    ST('receive', { lines: [{ productId: 'prodA', receivedQty: 5, basis: 'receive-stamped', sellAtSupply: 90, discAtSupply: 20, pricingVersion: 3, catalogueVersion: 7 }] }, { seq: 20, _attested: true }),
  ]);
  const it = p.items.get('prodA');
  return it && it.untrusted === false && it.tuple.sell === 90 && it.mintAttested === true;
})());

// ── classification / economics (P6 tail — SR-58; K4) ─────────────────────────────────────────────────
console.log('== classification ==');
ok("category parity: 'in' from 'HO Warehouse' label => transfer (billed)", E.category({ type: 'in', stockFrom: 'HO Warehouse — bulk' }) === 'transfer');
ok("category parity: 'out' to 'Customer Sale' => sale", E.category({ type: 'out', stockTo: 'Customer Sale — till' }) === 'sale');
ok("category parity: 'out' to 'Wastage/Damage' => wastage", E.category({ type: 'out', stockTo: 'Wastage/Damage' }) === 'wastage');
ok("category parity: 'out' to an unknown label => other_out (surfaced)", E.category({ type: 'out', stockTo: 'Mystery' }) === 'other_out');
ok('unknown TYPE lands in the surfaced unclassified bucket, no refusal', (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_odd', type: 'frobnicate', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-07-01', createdAt: '2025-07-01T04:00:00Z', idempotencyKey: 'row_odd', _spId: 500 }); });
  return r.ok && r.settlement.meta.unclassified.includes('row_odd');
})());
ok('non-HO transfer_in is usage, never a cost line', (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_store_t', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-02', createdAt: '2025-07-02T04:00:00Z', stockFromStoreId: 'karr', idempotencyKey: 'row_store_t', _spId: 510 }); });
  return r.ok && !line(r, 'row_store_t') && r.settlement.usage.prodA.transfer >= 2;
})());
ok('W44-R2 Codex-1: a transfer-linked row with SUPPRESSED steps + stripped labels (post-epoch) cannot hide — holds FINAL', (() => {
  // labels stripped so isHOSupply=false (looks peer), transferId present, NO steps, post-epoch id
  const r = run(v => { v.rows.live.push({ id: 'row_hidden', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-02', createdAt: '2025-07-02T04:00:00Z', transferId: 'trGhost', idempotencyKey: 'row_hidden', _spId: 520 }); });
  return r.ok && !line(r, 'row_hidden') && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.some(x => x === 'POST_EPOCH_NO_STEPS:row_hidden');
})());
ok('a genuine PRE-epoch peer transfer (no steps, pre-epoch id) does NOT falsely block (no over-block)', (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_peer_old', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-02', createdAt: '2025-07-02T04:00:00Z', transferId: 'trOldPeer', idempotencyKey: 'row_peer_old', stockFromStoreId: 'karr', _spId: 40 }); });
  return r.ok && !line(r, 'row_peer_old') && r.settlement.status === 'FINAL';
})());
// W44-R3 (Codex-2 / AGY-2): the SERVER steps projection binds product + endpoints + HO-source; a
// mutated row field can't route past the integrity gate. Base has tr1 (genesis head_office->boor, prodA).
ok('W44-R3 AGY-2b: a genuine HO transfer relabelled to a peer store is STILL billed (genesis is authority, not the label)', (() => {
  const r = run(v => { v.rows.live[0].stockFromStoreId = 'FakeStore'; });   // row_t1 has tr1 with a genesis head_office submit
  const l = line(r, 'row_t1');
  return r.ok && l && l.owed === 375 && r.settlement.status === 'FINAL';
})());
ok('W44-R3 Codex-2b: a peer transfer relabelled head_office is NOT billed as HO supply (genesis says peer)', (() => {
  const r = run(v => {
    v.steps.push({ stepId: 'stPeer', recordId: 'trPeer', recordType: 'transfer', stepType: 'submit', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'karr', toStoreId: 'boor', _attested: true, payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] } });
    v.rows.live.push({ id: 'row_fakeHO', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'trPeer', idempotencyKey: 'row_fakeHO', stockFromStoreId: 'head_office', _spId: 301, ...TUP_A });
  });
  return r.ok && !line(r, 'row_fakeHO') && r.settlement.status === 'FINAL';   // usage-only, not a cost line
})());
ok('W44-R3 Codex-2a: a row whose product is NOT in its claimed transfer fails closed', (() => {
  const r = run(v => {
    v.steps.push({ stepId: 'stX', recordId: 'trX', recordType: 'transfer', stepType: 'submit', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true, payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] } });
    v.rows.live.push({ id: 'row_wrongp', type: 'transfer_in', productId: 'prodB', storeId: 'boor', qty: 1, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'trX', idempotencyKey: 'row_wrongp', stockFromStoreId: 'head_office', _spId: 302 });
  });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'PRODUCT_NOT_IN_TRANSFER:row_wrongp');
})());
ok('W44-R3 Codex-2c: a row claiming a transfer destined for ANOTHER store fails closed', (() => {
  const r = run(v => {
    v.steps.push({ stepId: 'stD', recordId: 'trD', recordType: 'transfer', stepType: 'submit', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'karr', _attested: true, payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] } });
    v.rows.live.push({ id: 'row_wrongdest', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'trD', idempotencyKey: 'row_wrongdest', stockFromStoreId: 'head_office', _spId: 303, ...TUP_A });
  });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'STORE_NOT_IN_TRANSFER:row_wrongdest');
})());
ok('W44-R3 AGY-2a: a transfer-linked row with a MUTATED type cannot bypass integrity (bad type + no steps + post-epoch)', (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_badtype', type: 'weird_type', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'trGhost', idempotencyKey: 'row_badtype', _spId: 400 }); });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'POST_EPOCH_NO_STEPS:row_badtype');
})());
// W44-R4 (Codex/AGY-2,3,4): the billed row is a POINTER; the server step is the authority for qty,
// product-line ownership, and the valuation date. Base tr1 = genesis head_office->boor, prodA, qty 5.
ok('W44-R4: editing the row qty away from the authoritative received qty fails closed', (() => {
  const lo = run(v => { v.rows.live[0].qty = 1; });
  const hi = run(v => { v.rows.live[0].qty = 500; });
  return lo.ok && lo.settlement.status === 'PROVISIONAL' && lo.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodA'))
    && hi.ok && hi.settlement.status === 'PROVISIONAL' && hi.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodA'));
})());
ok('W44-R4: flipping a valid HO receipt\'s type out of the cost filter leaves its line unclaimed => fails closed', (() => {
  const a = run(v => { v.rows.live[0].type = 'out'; });
  const b = run(v => { v.rows.live[0].type = 'deleted'; });
  return a.ok && a.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodA'))
    && b.ok && b.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodA'));
})());
ok('W44-R4: a valid HO row shifted OUT of the window leaves its line unclaimed => fails closed', (() => {
  const r = run(v => { v.rows.live[0].createdAt = '2025-12-01T03:00:00Z'; });
  return r.ok && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodA'));
})());
ok('W44-R4: swapping a row\'s productId to another product in the SAME transfer fails closed (both lines mismatch)', (() => {
  // give tr1 a second line prodB(3); row_t1 (prodA,5) swapped to prodB
  const r = run(v => {
    v.steps[0].payload.items.push({ productId: 'prodB', sentQty: 3, basis: 'submit-stamped', sellAtSupply: 50, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 });
    v.steps[1].payload.lines.push({ productId: 'prodB', receivedQty: 3 });
    v.rows.live[0].productId = 'prodB'; v.rows.live[0].sellAtSupply = 50;
  });
  return r.ok && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodA')) && r.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodB'));
})());
ok('W44-R4: repointing a row\'s transferId to a DIFFERENT valid HO transfer fails closed (wrong qty / unclaimed origin)', (() => {
  const r = run(v => {
    v.steps.push({ stepId: 'st3', recordId: 'tr2', recordType: 'transfer', stepType: 'submit', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true, payload: { items: [{ productId: 'prodA', sentQty: 2, basis: 'submit-stamped', ...TUP_A }] } });
    v.steps.push({ stepId: 'st4', recordId: 'tr2', recordType: 'transfer', stepType: 'receive', seq: 20, timestamp: Date.parse('2025-07-01T03:00:00Z'), _attested: true, payload: { lines: [{ productId: 'prodA', receivedQty: 2 }] } });
    v.rows.live[0].transferId = 'tr2';
  });
  return r.ok && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH'));
})());
// ── W44-R5: quantity authority (resolution/backfill), control-offset from server truth, manifest consistency ──
console.log('== W44-R5: quantity authority + control offset ==');
ok('W44-R5 Codex-1: the resolve step PINS the Director\'s chosen qty (not the last receive attempt)', (() => {
  const mk = (rowQty) => run(v => {
    v.steps[1].payload.lines = [{ productId: 'prodA', receivedQty: 3 }];
    v.steps.push({ stepId: 'st2b', recordId: 'tr1', recordType: 'transfer', stepType: 'receive', seq: 21, timestamp: Date.parse('2025-07-01T03:30:00Z'), _attested: true, payload: { lines: [{ productId: 'prodA', receivedQty: 5 }] } });
    v.steps.push({ stepId: 'st3', recordId: 'tr1', recordType: 'transfer', stepType: 'resolve', seq: 30, timestamp: Date.parse('2025-07-01T04:00:00Z'), _attested: true, payload: { resolutions: [{ productId: 'prodA', action: 'conflict_resolved', qty: 3 }] } });
    v.drain.graceRecords[0].expectedStepIds = ['st1', 'st2', 'st2b', 'st3'];
    v.rows.live[0].qty = rowQty;
  });
  const legit = mk(3), tampered = mk(5);   // resolved qty is 3
  const l = line(legit, 'row_t1');
  return legit.ok && legit.settlement.status === 'FINAL' && l && l.owed === 225 && tampered.ok && tampered.settlement.status === 'PROVISIONAL' && tampered.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH'));
})());
ok('W44-R5 Codex-2: a backfill\'s recorded receivedQty is the authority (not sentQty)', (() => {
  const mk = (rowQty) => run(v => {
    v.steps = [{ stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'backfill', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), _attested: true, payload: { snapshot: { fromStoreId: 'head_office', toStoreId: 'boor', items: [{ productId: 'prodA', sentQty: 5, receivedQty: 3 }] } } }];
    v.drain.graceRecords[0].expectedStepIds = ['st1'];
    const t = v.rows.live[0]; delete t.sellAtSupply; delete t.discAtSupply; delete t.pricingVersion; delete t.catalogueVersion;   // stampless => lens
    t.qty = rowQty;
  });
  const legit = mk(3), tampered = mk(5);   // received 3 is authoritative
  return legit.ok && !legit.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH')) && tampered.ok && tampered.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodA'));
})());
ok('W44-R5 AGY-1: the control OFFSET uses the server targetLine, not the (mutable) target row — a mutated target can\'t drop a genuine line', (() => {
  const r = run(v => {
    // a valid deletion issued server-side for a low-value line; franchisee mutates the target row to claim tr1|prodA:5 and zeroes the genuine row
    v.rows.live.push({ id: 'row_999', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'tr1', idempotencyKey: 'k999', stockFromStoreId: 'head_office', _spId: 205, ...TUP_A });
    v.rows.live[0].qty = 0;
    v.controls.live.push({ controlId: 'ctlDel', type: 'deletion', targetTransactionId: 'row_999', revision: 1, bornPublicationVersion: 11, targetLine: { transferId: 'tr_low', productId: 'prodX', qty: 2 } });
    v.controls.activeManifest.controlHeads.row_999 = HEAD('ctlDel', 1, 11);
  });
  return r.ok && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.some(x => x.startsWith('HO_LINE_QTY_MISMATCH:tr1|prodA'));
})());
ok('W44-R5: a deletion/replacement of a transfer-linked target REQUIRES a server targetLine', run(v => {
  v.controls.live.push({ controlId: 'ctlNoTL', type: 'deletion', targetTransactionId: 'row_t1', revision: 1, bornPublicationVersion: 11 });   // no targetLine
  v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctlNoTL', 1, 11);
}).reason === 'MALFORMED_CONTROL');
ok('W44-R5 Codex-3: a replacement whose original instant differs from the SERVER submit instant is refused (edited target time can\'t excise a dispatch)', run(v => {
  v.rows.live[0].createdAt = '2025-12-01T03:00:00Z';   // move the target row out of window
  const c = REPL(); c.row.originalEventAt = '2025-12-01T03:00:00Z';   // match the moved row, not the July submit
  v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11);
}).reason === 'CONTROL_INSTANT_MISMATCH');
ok('W44-R5 Codex-3: a FAITHFUL replacement (server submit instant) bills in-window despite an edited target createdAt', (() => {
  const r = run(v => {
    v.rows.live[0].createdAt = '2025-12-01T03:00:00Z';   // target row moved, but the server submit is July
    const c = REPL();   // originalEventAt = July submit
    v.controls.live.push(c); v.controls.activeManifest.controlHeads.row_t1 = HEAD('ctl_r1', 1, 11);
  });
  const l = line(r, 'ctl_r1_row');
  return r.ok && l && l.owed === 300 && r.settlement.status === 'FINAL';
})());
ok('W44-R5 Codex-4: a committed flush whose written id was NOT presented fails closed', run(v => {
  v.drain.graceRecords[0].presentedIds = ['row_sale1']; v.drain.graceRecords[0].writtenIds = ['row_t1'];   // row_t1 written but not presented
}).ok && run(v => { v.drain.graceRecords[0].presentedIds = ['row_sale1']; v.drain.graceRecords[0].writtenIds = ['row_t1']; }).settlement.provisionalReasons.some(x => x === 'WRITTEN_NOT_PRESENTED:row_t1'));
ok('W44-R5 AGY-2/3: an unverifiable-qty row (direct-log / pre-epoch) is billed but SURFACED for review', (() => {
  // base already contains row_direct1 (direct-log) + row_legacy1 (transferless) + row_arch1 (pre-epoch)
  return base.ok && base.settlement.meta.unverifiableQty.includes('row_direct1') && base.settlement.meta.unverifiableQty.includes('row_legacy1') && base.settlement.meta.unverifiableQty.includes('row_arch1') && line(base, 'row_direct1').unverifiableQty === true;
})());
ok('W44-R4: a legacy-lens transfer row values at the SUBMIT-step day, not the editable row date (rate can\'t be shifted)', (() => {
  const mk = (rowDate) => run(v => {
    v.steps[0].payload.items = [{ productId: 'prodA', sentQty: 5 }];   // stampless submit => legacy-lens
    v.steps[1].payload.lines = [{ productId: 'prodA', receivedQty: 5 }];
    const t = v.rows.live[0]; delete t.sellAtSupply; delete t.discAtSupply; delete t.pricingVersion; delete t.catalogueVersion;
    if (rowDate) { t.date = rowDate; t.createdAt = rowDate + 'T03:00:00Z'; }
    v.pricing.storeMap['*'] = [{ rate: 25, from: WFROM, to: '2025-08-01T00:00:00Z' }, { rate: 50, from: '2025-08-01T00:00:00Z', to: null }];
  });
  const jul = mk(null);           // submit + row both July
  const shifted = mk('2025-09-01'); // row date shifted to Sept (higher rate) — submit stays July
  const lj = line(jul, 'row_t1'), ls = line(shifted, 'row_t1');
  return jul.ok && lj && lj.owed === 375 && shifted.ok && ls && ls.owed === 375;   // both bill at July's 25%
})());
ok('HO-supply via the STEPS projection when the row has no structured source (fail-closed until the record arrives)', (() => {
  const r = run(v => { delete v.rows.live[0].stockFromStoreId; });   // tr1's submit says fromStoreId head_office
  const l = line(r, 'row_t1');
  return l && l.owed === 375;
})());
ok('sale WITHOUT UnitPriceAtTime falls back to the current price, SURFACED (K4 rule)', (() => {
  const r = run(v => { delete v.rows.live[1].unitPriceAtTime; });
  return r.ok && r.settlement.retailProfit.revenue === 200 && r.settlement.retailProfit.legacyPriceFallbackCount === 1;   // 2 x prodA price 100
})());
ok('N9 (Kunal): a CUSTOMER refund (return_in from Customer) NETS OFF revenue at the frozen price', (() => {
  // base sale: 2 x prodA @150 = 300; add a customer refund of 1 @150 => net revenue 150
  const r = run(v => { v.rows.live.push({ id: 'row_refund', type: 'return_in', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-07-11', createdAt: '2025-07-11T05:00:00Z', idempotencyKey: 'row_refund', stockFrom: 'Customer', unitPriceAtTime: 150, _spId: 240 }); });
  return r.ok && r.settlement.retailProfit.revenue === 150 && r.settlement.retailProfit.salesQty === 2 && r.settlement.retailProfit.refundQty === 1 && r.settlement.status === 'FINAL';
})());
ok('W44-R3 Codex-1: a SUPPLIER/store/franchise return does NOT net revenue (only Customer reverses a sale)', (() => {
  const r = run(v => {
    v.rows.live.push({ id: 'row_supret', type: 'return_in', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-07-11', createdAt: '2025-07-11T05:00:00Z', idempotencyKey: 'row_supret', stockFrom: 'Supplier', unitPriceAtTime: 150, _spId: 241 });
  });
  return r.ok && r.settlement.retailProfit.revenue === 300 && r.settlement.retailProfit.refundQty === 0;
})());
ok('N9 (Kunal): an HO return (transfer_out to HO) is NOT credited against the supply bill (usage-only)', (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_horet', type: 'transfer_out', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-12', createdAt: '2025-07-12T05:00:00Z', idempotencyKey: 'row_horet', stockToStoreId: 'head_office', stockTo: 'HO Warehouse — return', _spId: 250 }); });
  return r.ok && !line(r, 'row_horet') && r.settlement.totals.owed === 915 && (r.settlement.usage.prodA.transfer || 0) >= 2 && r.settlement.status === 'FINAL';
})());
ok("'deleted'-type rows carry no economics and no unclassified noise", (() => {
  const r = run(v => { v.rows.live.push({ id: 'row_del', type: 'deleted', productId: 'prodA', storeId: 'boor', qty: 9, date: '2025-07-01', createdAt: '2025-07-01T04:30:00Z', idempotencyKey: 'row_del', _spId: 520 }); });
  return r.ok && !line(r, 'row_del') && !r.settlement.meta.unclassified.includes('row_del') && r.settlement.totals.owed === 915;
})());

// ── PROVISIONAL vs FINAL (P5 — SR-37/57/94/107/122/170/171) ──────────────────────────────────────────
console.log('== PROVISIONAL vs FINAL ==');
ok('graceClosed false => PROVISIONAL (GRACE_OPEN), settlement still produced/regenerable', (() => {
  const r = run(v => { v.graceClosed = false; });
  return r.ok && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.includes('GRACE_OPEN') && r.settlement.totals.owed === 915;
})());
ok('drain evidence absent => PROVISIONAL (never an error)', (() => {
  const r = run(v => { v.drain = null; });
  return r.ok && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.includes('NO_DRAIN_EVIDENCE');
})());
ok('grace record consumed-but-not-committed => NOT drained (SR-57)', (() => {
  const r = run(v => { v.drain.graceRecords[0].state = 'consumed'; });
  return r.ok && r.settlement.provisionalReasons.some(x => x.startsWith('GRACE_NOT_TERMINAL'));
})());
ok('PRESENTED identity in NONE of rows/covered/queued => refuse FINAL (SR-171)', (() => {
  const r = run(v => { v.drain.graceRecords[0].presentedIds.push('row_escaped'); });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'UNACCOUNTED_IDENTITY:row_escaped');
})());
ok('presented identity COVERED by a validated deletion => FINAL keeps (SR-107)', (() => {
  const r = run(v => {
    v.drain.graceRecords[0].presentedIds.push('row_gone');
    v.controls.live.push({ controlId: 'ctl_g', type: 'deletion', targetTransactionId: 'row_gone', revision: 1, bornPublicationVersion: 11 });
    v.controls.activeManifest.controlHeads.row_gone = HEAD('ctl_g', 1, 11);
  });
  return r.ok && r.settlement.status === 'FINAL';
})());
ok('presented identity QUEUED in badVersionEvidence => accounted, but the OPEN entry holds FINAL (SR-170)', (() => {
  const r = run(v => {
    v.drain.graceRecords[0].presentedIds.push('row_q1');
    v.badVersionEvidence.entries.push({ rowId: 'row_q1', digest: 'd1', terminal: null });
  });
  return r.ok && !r.settlement.provisionalReasons.some(x => x.startsWith('UNACCOUNTED_IDENTITY'))
    && r.settlement.provisionalReasons.some(x => x === 'BAD_VERSION_OPEN:row_q1');
})());
ok('committed grace whose WRITTEN id is neither present nor covered => refuse FINAL (SR-94)', (() => {
  const r = run(v => { v.drain.graceRecords[0].writtenIds.push('row_lost'); });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'WRITTEN_ROW_MISSING:row_lost');
})());
ok('W44-R1 Codex-1: committed grace record with NO presented manifest => refuse FINAL (SR-171)', (() => {
  const r = run(v => { v.drain.graceRecords = [{ id: 'g1', state: 'committed' }]; });
  return r.ok && r.settlement.status === 'PROVISIONAL' && r.settlement.provisionalReasons.some(x => x === 'DRAIN_MANIFEST_MISSING:g1');
})());
ok('W44-R1 Codex-1: committed grace record missing the WRITTEN set => refuse FINAL (SR-171)', (() => {
  const r = run(v => { delete v.drain.graceRecords[0].writtenIds; });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'DRAIN_MANIFEST_MISSING:g1');
})());
ok('an EMPTY presented manifest is legitimate (a flush that presented nothing) => still drained', (() => {
  const r = run(v => { v.drain.graceRecords = [{ id: 'g1', state: 'committed', presentedIds: [], writtenIds: [], expectedStepIds: [] }]; });
  return r.ok && r.settlement.status === 'FINAL';
})());
ok('W44-R2 Codex-2: committed grace record missing the EXPECTED-STEP list => refuse FINAL (a suppressed mint step can\'t hide)', (() => {
  const r = run(v => { delete v.drain.graceRecords[0].expectedStepIds; });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'DRAIN_MANIFEST_MISSING:g1');
})());
ok('expected STEP not ingested => refuse FINAL (drain proves step ingest, SR-122)', (() => {
  const r = run(v => { v.drain.graceRecords[0].expectedStepIds.push('st_missing'); });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'STEP_NOT_INGESTED:st_missing');
})());
ok('BAD_VERSION corrected-and-reattested => unblocked ONLY when the corrected row is PRESENT (SR-165)', (() => {
  const r = run(v => {
    v.rows.live.push({ id: 'row_q2', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-07-01', createdAt: '2025-07-01T06:00:00Z', idempotencyKey: 'row_q2', stockFromStoreId: 'head_office', _spId: 260, _attested: true, ...TUP_A });
    v.badVersionEvidence.entries.push({ rowId: 'row_q2', digest: 'd2', terminal: 'corrected-and-reattested' });
  });
  return r.ok && r.settlement.status === 'FINAL';
})());
ok('W44-R3 AGY-1: corrected-and-reattested but the row is MISSING from the payload => refuse FINAL', (() => {
  const r = run(v => { v.badVersionEvidence.entries.push({ rowId: 'row_gone', digest: 'd9', terminal: 'corrected-and-reattested' }); });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'CORRECTED_ROW_MISSING:row_gone');
})());
ok('BAD_VERSION rejected + durably accounted => unblocked; a BARE rejection holds (SR-165)', (() => {
  const a = run(v => { v.badVersionEvidence.entries.push({ rowId: 'row_q3', digest: 'd3', terminal: 'rejected', rejectedAccounted: true }); });
  const b = run(v => { v.badVersionEvidence.entries.push({ rowId: 'row_q3', digest: 'd3', terminal: 'rejected' }); });
  return a.ok && a.settlement.status === 'FINAL' && b.ok && b.settlement.provisionalReasons.some(x => x === 'BAD_VERSION_OPEN:row_q3');
})());
ok('BAD_VERSION view-covered by the ACTIVE supplied control => unblocked (SR-168 derived view)', (() => {
  const r = run(v => {
    v.badVersionEvidence.entries.push({ rowId: 'row_q4', digest: 'd4', terminal: null });
    v.controls.live.push({ controlId: 'ctl_q4', type: 'deletion', targetTransactionId: 'row_q4', revision: 1, bornPublicationVersion: 11 });
    v.controls.activeManifest.controlHeads.row_q4 = HEAD('ctl_q4', 1, 11);
  });
  return r.ok && r.settlement.status === 'FINAL';
})());
ok('WITHDRAW auto-reopens coverage (null head => the entry resurfaces — SR-168)', (() => {
  const r = run(v => {
    v.badVersionEvidence.entries.push({ rowId: 'row_q5', digest: 'd5', terminal: null });
    v.controls.activeManifest.controlHeads.row_q5 = null;   // withdrawn; no control supplied (consistent)
  });
  return r.ok && r.settlement.provisionalReasons.some(x => x === 'BAD_VERSION_OPEN:row_q5');
})());

console.log(`\n==== ${pass}/${pass + fail} buyback-export probes PASS ====`);
process.exit(fail === 0 ? 0 : 1);
