#!/usr/bin/env node
/*
 * archive-carry-proof.js — OS-W4.4 C1 archive-carry logic-proof suite for the extended
 * snapshotCompute.hashRows (copy-fidelity gate) — REAL module, not re-derived.
 * Core claims: (1) a live row and its archive-named copy (TxnType/TxnTimestamp/TxnDate renames)
 * hash EQUAL when content matches; (2) a copy defect in ANY carried field — including the NEW
 * C1 carry set (EconSig, IdempotencyKey, stamps, prices, source/dest ids + labels, Date) —
 * diverges the hash (whole-population probe); (3) the '|'-injection class is dead (JSON framing).
 * Run: node test/archive-carry-proof.js
 */
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'snapshotCompute.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); } }
const J = (v) => JSON.parse(JSON.stringify(v));

// A live-list row exactly as Read_live surfaces it (SP echo: Date as datetime string).
function LIVE() {
  return {
    Id: 101, TransactionId: 'txn_arc_1', StoreId: 'boor', ProductId: 'prodA', Type: 'transfer_in',
    Qty: 25, Date: '2026-07-22T00:00:00Z', Timestamp: 1753000000000, Reason: 'HO restock', TransferId: 'tr9',
    TargetTransactionId: '', IdempotencyKey: 'transfer:tr9:receive:boor:prodA',
    EconSig: 'v1:k1:' + 'a'.repeat(64), SellAtSupply: 100, DiscAtSupply: 25, PricingVersion: 3,
    CatalogueVersion: 7, UnitPriceAtTime: 150, StockFromStoreId: 'head_office', StockToStoreId: 'boor',
    StockFrom: 'HO Warehouse', StockTo: 'Boor Store'
  };
}
// Its faithful archive copy per the Insert_archive mapping (renames + SourceId; run metadata not hashed).
function ARCHIVED() {
  const l = LIVE();
  return {
    Id: 900, SourceId: l.Id, TransactionId: l.TransactionId, StoreId: l.StoreId, ProductId: l.ProductId,
    TxnType: l.Type, Qty: l.Qty, TxnDate: l.Date, TxnTimestamp: l.Timestamp, Reason: l.Reason, TransferId: l.TransferId,
    TargetTransactionId: l.TargetTransactionId, IdempotencyKey: l.IdempotencyKey, EconSig: l.EconSig,
    SellAtSupply: l.SellAtSupply, DiscAtSupply: l.DiscAtSupply, PricingVersion: l.PricingVersion,
    CatalogueVersion: l.CatalogueVersion, UnitPriceAtTime: l.UnitPriceAtTime,
    StockFromStoreId: l.StockFromStoreId, StockToStoreId: l.StockToStoreId,
    StockFrom: l.StockFrom, StockTo: l.StockTo, ArchiveRunId: 'run1', SnapshotVersion: 4
  };
}
const H = (rows) => S.hashRows(rows);

// ── Claim 1: faithful copy ⇒ equal hash across the two field-name styles ─────────────────────────────
ok('live row and faithful archive copy hash EQUAL (renames + run metadata ignored)',
  H([LIVE()]) === H([ARCHIVED()]));
ok('order independence retained (2 rows, shuffled)', (() => {
  const a = LIVE(); const b = LIVE(); b.TransactionId = 'txn_arc_2'; b.Qty = 4;
  return H([a, b]) === H([b, a]);
})());
ok('Date day-part: bare \'2026-07-22\' ≡ SP echo \'2026-07-22T00:00:00Z\'; a different DAY diverges', (() => {
  const bare = ARCHIVED(); bare.TxnDate = '2026-07-22';
  const other = ARCHIVED(); other.TxnDate = '2026-07-23T00:00:00Z';
  return H([bare]) === H([LIVE()]) && H([other]) !== H([LIVE()]);
})());
ok('absent ≡ \'\' for optional numeric stamps (unstamped copy), but 0 is a VALUE', (() => {
  const a = ARCHIVED(); delete a.SellAtSupply;
  const b = ARCHIVED(); b.SellAtSupply = '';
  const c = ARCHIVED(); c.SellAtSupply = 0;
  return H([a]) === H([b]) && H([a]) !== H([c]);
})());

// ── Claim 2: EVERY carried field is fidelity-checked (whole population) ──────────────────────────────
const DEFECTS = {
  TransactionId: 'txn_other', StoreId: 'karrinyup', ProductId: 'prodB', TxnType: 'out', Qty: 2,
  TxnDate: '2026-01-01', TxnTimestamp: 1, TransferId: 'tr_hijack', TargetTransactionId: 'txn_victim',
  Reason: 'edited note', IdempotencyKey: 'other_key', EconSig: 'v1:k1:' + 'b'.repeat(64), SellAtSupply: 1, DiscAtSupply: 99,
  PricingVersion: 99, CatalogueVersion: 99, UnitPriceAtTime: 1, StockFromStoreId: 'boor',
  StockToStoreId: 'head_office', StockFrom: 'Peer Store', StockTo: 'Customer'
};
for (const [f, v] of Object.entries(DEFECTS)) {
  ok(`copy defect in ${f} diverges the hash`, (() => {
    const bad = ARCHIVED(); bad[f] = v; return H([bad]) !== H([LIVE()]);
  })());
}
ok('DROPPING a carried field (not just rewriting) diverges the hash', (() => {
  const bad = ARCHIVED(); delete bad.EconSig; return H([bad]) !== H([LIVE()]);
})());

// ── Claim 3: field-boundary injection dead (JSON framing) ────────────────────────────────────────────
ok('a \'|\' inside a label can no longer collide two different rows', (() => {
  const a = LIVE(); a.StockFrom = 'HO Warehouse|extra'; a.StockTo = '';
  const b = LIVE(); b.StockFrom = 'HO Warehouse'; b.StockTo = 'extra';
  return H([a]) !== H([b]);
})());
ok('quote/backslash label values hash distinctly', (() => {
  const a = LIVE(); a.StockFrom = '","x":"';
  const b = LIVE(); b.StockFrom = '\\",\\"x\\":\\"';
  return H([a]) !== H([b]) && H([a]) !== H([LIVE()]);
})());

console.log(`\n==== ${pass}/${pass + fail} archive-carry probes PASS ====`);
process.exit(fail === 0 ? 0 : 1);
