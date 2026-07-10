#!/usr/bin/env node
/*
 * topology-proof.js — OS-W2 logic-proof suite for azure-functions/src/functions/topology.js.
 * Runs the REAL function code (required module, not re-derived logic — blind-sentinel rule) against
 * adversarial fixtures. Every OS-SR it proves is cited. Run: node test/topology-proof.js
 */
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'topology.js'));

const D = (s) => Date.parse(s);
let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); } }

// ── resolveEra (OS-SR-6 visibility) ─────────────────────────────────────────────────────────────────
console.log('== resolveEra ==');
const ERAS = [
  { owner: 'HO', from: '2025-01-01T00:00:00Z', to: '2025-07-01T00:00:00Z' },
  { owner: 'fr_a', from: '2025-07-01T00:00:00Z', to: '2025-10-01T00:00:00Z' },
  { owner: 'HO', from: '2025-10-01T00:00:00Z', to: null },
];
ok('date in HO era 1', T.resolveEra(ERAS, D('2025-03-01T00:00:00Z')).owner === 'HO');
ok('date in franchise era', T.resolveEra(ERAS, D('2025-08-01T00:00:00Z')).owner === 'fr_a');
ok('date in current HO era', T.resolveEra(ERAS, D('2025-12-01T00:00:00Z')).owner === 'HO');
ok('boundary is [from,to) — to is exclusive', T.resolveEra(ERAS, D('2025-07-01T00:00:00Z')).owner === 'fr_a');
ok('before any era => null', T.resolveEra(ERAS, D('2024-01-01T00:00:00Z')) === null);
ok('bad date => null', T.resolveEra(ERAS, NaN) === null);

console.log('== eraWindowsFor (device-bound = current era only) ==');
ok('device-bound sees CURRENT era only', JSON.stringify(T.eraWindowsFor(ERAS, 'anything', true)) === JSON.stringify([{ from: '2025-10-01T00:00:00Z', to: null }]));
ok('franchisee sees only its own era(s)', T.eraWindowsFor(ERAS, 'fr_a', false).length === 1 && T.eraWindowsFor(ERAS, 'fr_a', false)[0].from === '2025-07-01T00:00:00Z');
ok('HO account sees both HO eras', T.eraWindowsFor(ERAS, 'HO', false).length === 2);

// ── resolvePricingRate + append-only (OS-SR-3/11/12) ───────────────────────────────────────────────
console.log('== pricing (as-of rate + append-only immutability) ==');
const PRICING = [
  { rate: 10, from: '2025-01-01T00:00:00Z', to: '2025-07-01T00:00:00Z' },
  { rate: 15, from: '2025-07-01T00:00:00Z', to: null },
];
ok('rate as-of Jan = 10', T.resolvePricingRate(PRICING, D('2025-03-01T00:00:00Z')) === 10);
ok('rate as-of Aug = 15', T.resolvePricingRate(PRICING, D('2025-08-01T00:00:00Z')) === 15);
ok('rate before history => null', T.resolvePricingRate(PRICING, D('2024-01-01T00:00:00Z')) === null);
const SEP = D('2025-09-01T00:00:00Z');
const ap = T.appendPricingInterval(PRICING, 20, SEP);
ok('append closes open interval + opens new (never mutates prior)', ap.history.length === 3 && ap.history[0].rate === 10 && ap.history[0].to === '2025-07-01T00:00:00Z' && ap.history[1].to === new Date(SEP).toISOString() && ap.history[2].rate === 20 && ap.history[2].to === null);
ok('past interval UNCHANGED after append (OS-SR-12 immutability)', ap.history[0].from === '2025-01-01T00:00:00Z' && ap.history[0].to === '2025-07-01T00:00:00Z');
ok('append same rate is a no-op (no spurious interval)', T.appendPricingInterval(PRICING, 15, D('2025-09-01T00:00:00Z')).history.length === 2);
ok('backdated append rejected', T.appendPricingInterval(PRICING, 20, D('2025-06-01T00:00:00Z')).error === 'PRICING_BACKDATE');

// ── planTopologyChange ─────────────────────────────────────────────────────────────────────────────
console.log('== planTopologyChange ==');
const NOW = D('2025-11-01T00:00:00Z');
const creds = [
  { id: 'pos_boor', Role: 'staff', StoreIds: ['boor'], Active: 1, isStorePOS: true },
  { id: 'mgr_boor', Role: 'store_manager', StoreIds: ['boor'], Active: 1 },
  { id: 'tm_west', Role: 'territory_manager', StoreIds: ['boor', 'karr'], Active: 1 },
  { id: 'off_a', Role: 'franchisee', StoreIds: ['cockburn_office'], Active: 1, franchiseeId: 'fr_a', isFranchiseOffice: true },
];
const stateHO = { store: { id: 'boor', isFranchise: false }, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: null }], pricing: [], creds, franchisees: [{ franchiseeId: 'fr_a', officeStoreId: 'cockburn_office', officeUsername: 'fran_a' }] };

// CONVERT HO store -> existing franchisee fr_a
const conv = T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, stateHO, NOW);
ok('convert ok', conv.ok === true);
ok('convert closes HO era + opens fr_a era', conv.plan.eras.length === 2 && conv.plan.eras[0].to === T_iso(NOW) && conv.plan.eras[1].owner === 'fr_a' && conv.plan.eras[1].to === null);
ok('convert opens a pricing interval @25', conv.plan.pricing.length === 1 && conv.plan.pricing[0].rate === 25);
ok('convert: store POS bumps but keeps scope', conv.plan.fanout.find(f => f.id === 'pos_boor').action === 'bump');
ok('convert: single-store manager DEACTIVATED (zero left)', (() => { const f = conv.plan.fanout.find(x => x.id === 'mgr_boor'); return f.action === 'setStoreIds' && f.active === false && f.StoreIds.length === 0; })());
ok('convert: multi-store TM keeps other store, stays active (D-OS-2 nuance)', (() => { const f = conv.plan.fanout.find(x => x.id === 'tm_west'); return f.action === 'setStoreIds' && f.active === true && f.StoreIds.join() === 'karr'; })());
ok('convert: new franchisee office GAINS the store', (() => { const f = conv.plan.fanout.find(x => x.id === 'off_a'); return f.action === 'setStoreIds' && f.StoreIds.includes('boor'); })());
ok('convert: takeover snapshot requested', conv.plan.snapshot && conv.plan.snapshot.store === 'boor');
ok('convert of a non-HO store rejected', T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, { ...stateHO, eras: [{ owner: 'fr_a', from: '2025-01-01T00:00:00Z', to: null }] }, NOW).reason === 'NOT_HO_OWNED');
ok('convert to a nonexistent franchisee rejected', T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'ghost', rate: 25 }, stateHO, NOW).reason === 'NO_SUCH_FRANCHISEE');

// BUY-BACK franchise -> HO
const stateFr = { store: { id: 'boor', isFranchise: true }, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' }, { owner: 'fr_a', from: '2025-06-01T00:00:00Z', to: null }], pricing: [{ rate: 25, from: '2025-06-01T00:00:00Z', to: null }], creds: [{ id: 'pos_boor', Role: 'staff', StoreIds: ['boor'], Active: 1, isStorePOS: true }, { id: 'off_a', Role: 'franchisee', StoreIds: ['cockburn_office', 'boor'], Active: 1, franchiseeId: 'fr_a', isFranchiseOffice: true }], franchisees: [{ franchiseeId: 'fr_a', officeStoreId: 'cockburn_office' }] };
const bb = T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, stateFr, NOW);
ok('buyback ok', bb.ok === true);
ok('buyback closes fr_a era + opens HO era', bb.plan.eras[1].to === T_iso(NOW) && bb.plan.eras[2].owner === 'HO' && bb.plan.eras[2].to === null);
ok('buyback closes the pricing interval', bb.plan.pricing[0].to === T_iso(NOW));
ok('buyback: ex-franchisee office LOSES store but STAYS ACTIVE (D-OS-4)', (() => { const f = bb.plan.fanout.find(x => x.id === 'off_a'); return f.action === 'setStoreIds' && !f.StoreIds.includes('boor') && f.active === true; })());
ok('buyback: export bound to the CLOSED era [from,to) (OS-SR-4)', bb.plan.export && bb.plan.export.from === '2025-06-01T00:00:00Z' && bb.plan.export.to === T_iso(NOW) && bb.plan.export.franchiseeId === 'fr_a');
ok('buyback of an HO store rejected', T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, stateHO, NOW).reason === 'NOT_FRANCHISE_OWNED');

// ADD new store to existing franchisee
const addNew = T.planTopologyChange({ op: 'add', storeId: 'newst', toFranchiseeId: 'fr_a', rate: 25 }, { store: null, eras: [], pricing: [], creds, franchisees: stateHO.franchisees }, NOW);
ok('add new store to existing franchisee ok + creates store POS', addNew.ok && addNew.plan.createAccounts.some(a => a.kind === 'storePOS'));
ok('add: no takeover snapshot (born under franchisee)', addNew.plan.snapshot === null);

// guards
ok('bad store id rejected', T.planTopologyChange({ op: 'convert', storeId: 'bad id!', toFranchiseeId: 'fr_a' }, stateHO, NOW).reason === 'BAD_STORE_ID');
ok('__proto__ store id rejected', T.planTopologyChange({ op: 'convert', storeId: '__proto__', toFranchiseeId: 'fr_a' }, stateHO, NOW).reason === 'BAD_STORE_ID');
ok('unknown op rejected', T.planTopologyChange({ op: 'frobnicate', storeId: 'boor' }, stateHO, NOW).reason === 'UNKNOWN_OP');
ok('onboard duplicate franchiseeId rejected', T.planTopologyChange({ op: 'onboard', storeId: 'boor', newFranchisee: { franchiseeId: 'fr_a', officeUsername: 'x' } }, stateHO, NOW).reason === 'BAD_NEW_FRANCHISEE');

function T_iso(ms) { return new Date(ms).toISOString(); }

console.log(`\n== topology-proof: ${pass} PASS · ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
