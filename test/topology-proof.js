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
console.log('== pricing (as-of rate + append-only immutability + PER-PRODUCT, Kunal 2026-07-10) ==');
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
// PER-PRODUCT: the store default '*' with a product override; product's own dated series wins as-of, else default.
const STOREPRICE = {
  '*': [{ rate: 25, from: '2025-01-01T00:00:00Z', to: null }],
  serum: [{ rate: 15, from: '2025-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' }, { rate: 12, from: '2025-06-01T00:00:00Z', to: null }],
};
ok('product override wins over store default (as-of Aug: serum=12)', T.resolvePricingForProduct(STOREPRICE, 'serum', D('2025-08-01T00:00:00Z')) === 12);
ok('product override historical (as-of Mar: serum=15, not the current 12)', T.resolvePricingForProduct(STOREPRICE, 'serum', D('2025-03-01T00:00:00Z')) === 15);
ok('product with NO override falls back to store default (consumable=25)', T.resolvePricingForProduct(STOREPRICE, 'consumable', D('2025-08-01T00:00:00Z')) === 25);
const apk = T.appendPricingForKey(STOREPRICE, 'serum', 10, SEP);
ok('append per-product override dates the change (serum: 3 intervals, default untouched)', apk.pricing.serum.length === 3 && apk.pricing.serum[2].rate === 10 && apk.pricing['*'].length === 1);
ok('product-rate change does NOT rewrite that product past invoices (Mar still 15)', T.resolvePricingForProduct(apk.pricing, 'serum', D('2025-03-01T00:00:00Z')) === 15);

// ── planTopologyChange ─────────────────────────────────────────────────────────────────────────────
console.log('== planTopologyChange ==');
const NOW = D('2025-11-01T00:00:00Z');
const creds = [
  { id: 'pos_boor', Role: 'staff', StoreIds: ['boor'], Active: 1, isStorePOS: true },
  { id: 'mgr_boor', Role: 'store_manager', StoreIds: ['boor'], Active: 1 },
  { id: 'tm_west', Role: 'territory_manager', StoreIds: ['boor', 'karr'], Active: 1 },
  { id: 'off_a', Role: 'franchisee', StoreIds: ['cockburn_office'], Active: 1, franchiseeId: 'fr_a', isFranchiseOffice: true },
];
const stateHO = { store: { id: 'boor', isFranchise: false }, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: null }], pricing: {}, creds, franchisees: [{ franchiseeId: 'fr_a', officeStoreId: 'cockburn_office', officeUsername: 'fran_a' }] };

// CONVERT HO store -> existing franchisee fr_a
const conv = T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, stateHO, NOW);
ok('convert ok', conv.ok === true);
ok('convert closes HO era + opens fr_a era', conv.plan.eras.length === 2 && conv.plan.eras[0].to === T_iso(NOW) && conv.plan.eras[1].owner === 'fr_a' && conv.plan.eras[1].to === null);
ok('convert opens a pricing interval @25 on the store default', conv.plan.pricing['*'].length === 1 && conv.plan.pricing['*'][0].rate === 25);
ok('convert: store POS bumps but keeps scope', conv.plan.fanout.find(f => f.id === 'pos_boor').action === 'bump');
ok('convert: single-store manager DEACTIVATED (zero left)', (() => { const f = conv.plan.fanout.find(x => x.id === 'mgr_boor'); return f.action === 'setStoreIds' && f.active === false && f.StoreIds.length === 0; })());
ok('convert: multi-store TM keeps other store, stays active (D-OS-2 nuance)', (() => { const f = conv.plan.fanout.find(x => x.id === 'tm_west'); return f.action === 'setStoreIds' && f.active === true && f.StoreIds.join() === 'karr'; })());
ok('convert: new franchisee office GAINS the store', (() => { const f = conv.plan.fanout.find(x => x.id === 'off_a'); return f.action === 'setStoreIds' && f.StoreIds.includes('boor'); })());
ok('convert: takeover snapshot requested', conv.plan.snapshot && conv.plan.snapshot.store === 'boor');
ok('convert of a non-HO store rejected', T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, { ...stateHO, eras: [{ owner: 'fr_a', from: '2025-01-01T00:00:00Z', to: null }] }, NOW).reason === 'NOT_HO_OWNED');
ok('convert to a nonexistent franchisee rejected', T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'ghost', rate: 25 }, stateHO, NOW).reason === 'NO_SUCH_FRANCHISEE');

// BUY-BACK franchise -> HO
const stateFr = { store: { id: 'boor', isFranchise: true }, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' }, { owner: 'fr_a', from: '2025-06-01T00:00:00Z', to: null }], pricing: { '*': [{ rate: 25, from: '2025-06-01T00:00:00Z', to: null }] }, creds: [{ id: 'pos_boor', Role: 'staff', StoreIds: ['boor'], Active: 1, isStorePOS: true }, { id: 'off_a', Role: 'franchisee', StoreIds: ['cockburn_office', 'boor'], Active: 1, franchiseeId: 'fr_a', isFranchiseOffice: true }], franchisees: [{ franchiseeId: 'fr_a', officeStoreId: 'cockburn_office' }] };
const bb = T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, stateFr, NOW);
ok('buyback ok', bb.ok === true);
ok('buyback closes fr_a era + opens HO era', bb.plan.eras[1].to === T_iso(NOW) && bb.plan.eras[2].owner === 'HO' && bb.plan.eras[2].to === null);
ok('buyback closes the pricing interval (all series)', bb.plan.pricing['*'][0].to === T_iso(NOW));
ok('buyback: ex-franchisee office LOSES store but STAYS ACTIVE (D-OS-4)', (() => { const f = bb.plan.fanout.find(x => x.id === 'off_a'); return f.action === 'setStoreIds' && !f.StoreIds.includes('boor') && f.active === true; })());
ok('buyback: export bound to the CLOSED era [from,to) (OS-SR-4)', bb.plan.export && bb.plan.export.from === '2025-06-01T00:00:00Z' && bb.plan.export.to === T_iso(NOW) && bb.plan.export.franchiseeId === 'fr_a');
ok('buyback of an HO store rejected', T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, stateHO, NOW).reason === 'NOT_FRANCHISE_OWNED');

// ADD new store to existing franchisee
const addNew = T.planTopologyChange({ op: 'add', storeId: 'newst', toFranchiseeId: 'fr_a', rate: 25 }, { store: null, eras: [], pricing: {}, creds, franchisees: stateHO.franchisees }, NOW);
ok('add new store to existing franchisee ok + creates store POS', addNew.ok && addNew.plan.createAccounts.some(a => a.kind === 'storePOS'));
ok('add: no takeover snapshot (born under franchisee)', addNew.plan.snapshot === null);

// guards
ok('bad store id rejected', T.planTopologyChange({ op: 'convert', storeId: 'bad id!', toFranchiseeId: 'fr_a' }, stateHO, NOW).reason === 'BAD_STORE_ID');
ok('__proto__ store id rejected', T.planTopologyChange({ op: 'convert', storeId: '__proto__', toFranchiseeId: 'fr_a' }, stateHO, NOW).reason === 'BAD_STORE_ID');
ok('unknown op rejected', T.planTopologyChange({ op: 'frobnicate', storeId: 'boor' }, stateHO, NOW).reason === 'UNKNOWN_OP');
ok('onboard duplicate franchiseeId rejected', T.planTopologyChange({ op: 'onboard', storeId: 'boor', newFranchisee: { franchiseeId: 'fr_a', officeUsername: 'x' } }, stateHO, NOW).reason === 'BAD_NEW_FRANCHISEE');

function T_iso(ms) { return new Date(ms).toISOString(); }

// ── W1-W2 external audit (Codex+AGY BLOCK) — one probe per finding, proving the fix ────────────────────
console.log('== W1-W2 audit fixes (OS-A-F1..F8) ==');
// OS-A-F1 (Codex-1): CONVERT cancels a NON-POS staff personal login too (store POS protected separately).
const credsStaff = [{ id: 'pos_boor', Role: 'staff', StoreIds: ['boor'], Active: 1, isStorePOS: true }, { id: 'staff_personal', Role: 'staff', StoreIds: ['boor'], Active: 1 }];
const convStaff = T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, { ...stateHO, creds: credsStaff }, NOW);
ok('OS-A-F1: convert keeps store POS, CANCELS non-POS staff', convStaff.plan.fanout.find(f => f.id === 'pos_boor').action === 'bump' && (() => { const f = convStaff.plan.fanout.find(x => x.id === 'staff_personal'); return f && f.active === false; })());
// OS-A-F2 (Codex-2 + AGY-1): BUYBACK cancels the ex-franchisee's personal manager (was leaking HO data).
const bbMgr = T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, { ...stateFr, creds: [...stateFr.creds, { id: 'fr_mgr', Role: 'store_manager', StoreIds: ['boor'], Active: 1, franchiseeId: 'fr_a' }] }, NOW);
ok('OS-A-F2: buyback deactivates the ex-franchisee manager (no HO-data leak)', (() => { const f = bbMgr.plan.fanout.find(x => x.id === 'fr_mgr'); return f && f.active === false && !f.StoreIds.includes('boor'); })());
// OS-A-F3 (Codex-3): malformed / missing rate rejected on a franchise op.
ok('OS-A-F3: non-numeric rate rejected', T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 'nope' }, stateHO, NOW).reason === 'BAD_RATE');
ok('OS-A-F3: missing rate rejected', T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'fr_a' }, stateHO, NOW).reason === 'BAD_RATE');
ok('OS-A-F3: out-of-range rate rejected', T.planTopologyChange({ op: 'convert', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 250 }, stateHO, NOW).reason === 'BAD_RATE');
// OS-A-F4 (Codex-4): backdated append over a CLOSED interval rejected.
ok('OS-A-F4: append overlapping a closed interval rejected', T.appendPricingInterval([{ rate: 10, from: '2025-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' }, { rate: 15, from: '2025-06-01T00:00:00Z', to: '2025-09-01T00:00:00Z' }], 20, D('2025-08-01T00:00:00Z')).error === 'PRICING_BACKDATE');
// OS-A-F5 (Codex-5): malformed multi-open-era state fails closed.
ok('OS-A-F5: two open eras => resolveEra null', T.resolveEra([{ owner: 'fr_old', from: '2025-01-01T00:00:00Z', to: null }, { owner: 'fr_cur', from: '2025-06-01T00:00:00Z', to: null }], NOW) === null);
ok('OS-A-F5: plan rejects a multi-open state', T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, { ...stateFr, eras: [{ owner: 'fr_old', from: '2025-01-01T00:00:00Z', to: null }, { owner: 'fr_cur', from: '2025-06-01T00:00:00Z', to: null }] }, NOW).reason === 'MALFORMED_STATE');
// OS-A-F6 (Codex-6): omitted ids rejected (not accepted as the literal 'undefined').
ok('OS-A-F6: missing storeId rejected', T.planTopologyChange({ op: 'create', type: 'HO' }, { store: null }, NOW).reason === 'BAD_STORE_ID');
ok('OS-A-F6: onboard missing officeUsername rejected', T.planTopologyChange({ op: 'onboard', storeId: 'newst', newFranchisee: { franchiseeId: 'fr_new' }, rate: 25 }, { store: null, eras: [], franchisees: [] }, NOW).reason === 'BAD_OFFICE_USERNAME');
// OS-A-F7 (Codex-7): the route resolves per-product overrides.
const routeStyle = (b) => ({ rate: T.resolvePricingForProduct(b.pricing, b.productId, b.dateMs) });
ok('OS-A-F7: route resolves per-product override', routeStyle({ pricing: { '*': [{ rate: 25, from: '2025-01-01T00:00:00Z', to: null }], serum: [{ rate: 12, from: '2025-01-01T00:00:00Z', to: null }] }, productId: 'serum', dateMs: NOW }).rate === 12);
// OS-A-F8 (AGY-2): add/onboard reject a store already owned by a franchisee (no direct fran→fran).
ok('OS-A-F8: add to a franchise-owned store rejected (DIRECT_TRANSFER_FORBIDDEN)', T.planTopologyChange({ op: 'add', storeId: 'boor', toFranchiseeId: 'fr_b', rate: 25 }, { ...stateFr, franchisees: [{ franchiseeId: 'fr_a' }, { franchiseeId: 'fr_b' }] }, NOW).reason === 'DIRECT_TRANSFER_FORBIDDEN');

// ── W1-W2 CONVERGENCE audit (Codex round 2) — OS-A-C1..C4 ──────────────────────────────────────────────
console.log('== W1-W2 convergence fixes (Codex OS-A-C1..C4) ==');
// C1: eraWindowsFor fails closed on malformed state; overlapping closed+open eras fail closed.
ok('C1: eraWindowsFor([] on 2-open) => []', T.eraWindowsFor([{ owner: 'a', from: '2025-01-01T00:00:00Z', to: null }, { owner: 'b', from: '2025-06-01T00:00:00Z', to: null }], 'x', true).length === 0);
ok('C1: overlapping closed+open era => resolveEra null', T.resolveEra([{ owner: 'fr_old', from: '2025-01-01T00:00:00Z', to: '2025-12-01T00:00:00Z' }, { owner: 'HO', from: '2025-06-01T00:00:00Z', to: null }], D('2025-08-01T00:00:00Z')) === null);
ok('C1: buyback on an overlapping-era state rejected', T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, { store: { id: 'boor' }, eras: [{ owner: 'fr_old', from: '2025-01-01T00:00:00Z', to: '2025-12-01T00:00:00Z' }, { owner: 'HO', from: '2025-06-01T00:00:00Z', to: null }], creds: [], franchisees: [] }, NOW).reason === 'MALFORMED_STATE');
// C2: an EXISTING store with no current era fails closed (not treated as new).
ok('C2: add on an existing store whose only era is CLOSED (no open era) => NO_ERA_RECORD', T.planTopologyChange({ op: 'add', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, { store: { id: 'boor' }, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' }], creds: [], franchisees: [{ franchiseeId: 'fr_a' }] }, NOW).reason === 'NO_ERA_RECORD');
// C3: pricing — same-rate backdate no longer short-circuits; multi-open series rejected.
ok('C3a: same-rate backdated append rejected (no gap over the change date)', T.appendPricingInterval([{ rate: 25, from: '2025-12-01T00:00:00Z', to: null }], 25, D('2025-11-01T00:00:00Z')).error === 'PRICING_BACKDATE');
ok('C3b: append to a multi-open series rejected', T.appendPricingInterval([{ rate: 10, from: '2025-01-01T00:00:00Z', to: null }, { rate: 15, from: '2025-06-01T00:00:00Z', to: null }], 20, NOW).error === 'MALFORMED_PRICING');
// C4: onboarding rejects a duplicate office username.
ok('C4: onboard with a taken office username rejected', T.planTopologyChange({ op: 'onboard', storeId: 'newst', newFranchisee: { franchiseeId: 'fr_new', officeUsername: 'office_taken' }, rate: 25 }, { store: null, eras: [], creds: [{ id: 'office_taken', Role: 'franchisee', StoreIds: [] }], franchisees: [] }, NOW).reason === 'USERNAME_TAKEN');

// ── W1-W2 CONVERGENCE round 2 (Codex) — OS-A-D1..D4 ────────────────────────────────────────────────────
console.log('== W1-W2 convergence R2 fixes (Codex OS-A-D1..D4) ==');
// D1: empty/malformed era owner rejected everywhere.
ok('D1: validEras-style — empty owner => resolveEra null', T.resolveEra([{ owner: '', from: '2025-01-01T00:00:00Z', to: null }], NOW) === null);
ok('D1: empty owner => eraWindowsFor []', T.eraWindowsFor([{ owner: '', from: '2025-01-01T00:00:00Z', to: null }], '', true).length === 0);
ok('D1: buyback on an empty-owner era rejected', T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, { store: { id: 'boor' }, eras: [{ owner: '', from: '2025-01-01T00:00:00Z', to: null }], creds: [], franchisees: [] }, NOW).ok === false);
// D2: create-franchise on an EXISTING store rejected; a future-closed-only era is NOT current.
ok('D2: create(franchise) with a fully-existing store (store + open era) => STORE_EXISTS', T.planTopologyChange({ op: 'create', type: 'franchise', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, { store: { id: 'boor' }, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: null }], creds: [], franchisees: [{ franchiseeId: 'fr_a' }] }, NOW).reason === 'STORE_EXISTS');
ok('D2: add on a store whose only era is closed-in-future => NO_ERA_RECORD (no open era)', T.planTopologyChange({ op: 'add', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, { store: { id: 'boor' }, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' }], creds: [], franchisees: [{ franchiseeId: 'fr_a' }] }, NOW).reason === 'NO_ERA_RECORD');
// D3: pricing close + resolve fail closed on a malformed (multi-open) series.
ok('D3: closePricing on a multi-open series => MALFORMED_PRICING', T.closePricing([{ rate: 10, from: '2025-01-01T00:00:00Z', to: null }, { rate: 15, from: '2025-06-01T00:00:00Z', to: null }], NOW).error === 'MALFORMED_PRICING');
ok('D3: resolvePricingRate on a multi-open series => null (not the first rate)', T.resolvePricingRate([{ rate: 10, from: '2025-01-01T00:00:00Z', to: null }, { rate: 15, from: '2025-06-01T00:00:00Z', to: null }], NOW) === null);
ok('D3: buyback on a multi-open pricing series rejected', T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, { store: { id: 'boor' }, eras: [{ owner: 'fr_a', from: '2025-01-01T00:00:00Z', to: null }], pricing: { '*': [{ rate: 10, from: '2025-01-01T00:00:00Z', to: null }, { rate: 15, from: '2025-06-01T00:00:00Z', to: null }] }, creds: [], franchisees: [] }, NOW).reason === 'MALFORMED_PRICING');
// D4: store-POS login uniqueness.
ok('D4: onboard where officeUsername === storeId rejected', T.planTopologyChange({ op: 'onboard', storeId: 'newst', newFranchisee: { franchiseeId: 'fr_new', officeUsername: 'newst' }, rate: 25 }, { store: null, eras: [], creds: [], franchisees: [] }, NOW).reason === 'USERNAME_TAKEN');
ok('D4: create HO whose storeId collides with an existing credential => STORE_LOGIN_TAKEN', T.planTopologyChange({ op: 'create', type: 'HO', storeId: 'office_taken' }, { store: null, eras: [], creds: [{ id: 'office_taken', Role: 'franchisee', StoreIds: [] }], franchisees: [] }, NOW).reason === 'STORE_LOGIN_TAKEN');

// ── W1-W2 CONVERGENCE round 3 (Codex) — OS-A-E1..E2 ────────────────────────────────────────────────────
console.log('== W1-W2 convergence R3 fixes (Codex OS-A-E1..E2) ==');
// E1: store existence and era-history existence must agree.
ok('E1: create(HO) with store:null but an existing era => STORE_ERA_MISMATCH', T.planTopologyChange({ op: 'create', type: 'HO', storeId: 'boor' }, { store: null, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: null }], creds: [], franchisees: [] }, NOW).reason === 'STORE_ERA_MISMATCH');
ok('E1: add with store:null but an orphan era => STORE_ERA_MISMATCH', T.planTopologyChange({ op: 'add', storeId: 'boor', toFranchiseeId: 'fr_a', rate: 25 }, { store: null, eras: [{ owner: 'HO', from: '2025-01-01T00:00:00Z', to: null }], creds: [], franchisees: [{ franchiseeId: 'fr_a' }] }, NOW).reason === 'STORE_ERA_MISMATCH');
ok('E1: existing store with EMPTY history => STORE_ERA_MISMATCH', T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, { store: { id: 'boor' }, eras: [], creds: [], franchisees: [] }, NOW).reason === 'STORE_ERA_MISMATCH');
// E2: pricing rate-value validation everywhere.
ok('E2: stored out-of-range rate => resolvePricingRate null', T.resolvePricingRate([{ rate: 101, from: '2025-01-01T00:00:00Z', to: null }], NOW) === null);
ok('E2: stored NaN rate => resolve null', T.resolvePricingRate([{ rate: NaN, from: '2025-01-01T00:00:00Z', to: null }], NOW) === null);
ok('E2: append onto a series with a bad stored rate => MALFORMED_PRICING', T.appendPricingInterval([{ rate: -1, from: '2025-01-01T00:00:00Z', to: null }], 20, NOW).error === 'MALFORMED_PRICING');
ok('E2: malformed product override fails CLOSED (no silent default fallback)', T.resolvePricingForProduct({ '*': [{ rate: 25, from: '2025-01-01T00:00:00Z', to: null }], serum: [{ rate: 999, from: '2025-01-01T00:00:00Z', to: null }] }, 'serum', NOW) === null);
ok('E2: closePricing on a non-array series fails closed', T.closePricing('not-an-array', NOW).error === 'MALFORMED_PRICING');
ok('E2: closeAllPricing on a non-array member fails closed', T.closeAllPricing({ '*': 'not-an-array' }, NOW).error === 'MALFORMED_PRICING');
ok('E2: buyback with a future-ended closed pricing interval rejected', T.planTopologyChange({ op: 'buyback', storeId: 'boor' }, { store: { id: 'boor' }, eras: [{ owner: 'fr_a', from: '2025-01-01T00:00:00Z', to: null }], pricing: { '*': [{ rate: 25, from: '2025-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' }] }, creds: [], franchisees: [] }, NOW).reason === 'PRICING_BACKDATE');

console.log(`\n== topology-proof: ${pass} PASS · ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
