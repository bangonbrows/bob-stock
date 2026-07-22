#!/usr/bin/env node
/*
 * attest-proof.js — OS-W4.4 Contract 1 logic-proof suite for
 * azure-functions/src/functions/attestRows.js (row-level economic attestation).
 * Runs the REAL module (required, not re-derived — blind-sentinel rule) with a test keyring.
 * The core claim under proof: an edit to ANY covered field invalidates the seal (whole-population
 * probe, not first-instance), while deliberately-uncovered fields do NOT (the flagged boundary).
 * R1 spec-review fold 2026-07-22: Reason + the pricing tuple joined the covered set (AGY-1 splice,
 * AGY-2/Codex-1 Reason classifier) — both auditor repros are permanent probes here; key-ring kid
 * scheme (Q3) probed. Run: node test/attest-proof.js
 */
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'attestRows.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); } }
const J = (v) => JSON.parse(JSON.stringify(v));

const P1 = 'test-pepper-k1-0123456789abcdef0123456789abcdef';
const P2 = 'test-pepper-k2-fedcba9876543210fedcba9876543210';
const KR = { active: 'k1', peppers: { k1: P1 } };
const KR_ROTATED = { active: 'k2', peppers: { k1: P1, k2: P2 } };   // rotation: k2 signs, k1 still verifies
const KR_RETIRED = { active: 'k2', peppers: { k2: P2 } };            // k1 pepper removed ⇒ its seals die

// A representative direct-log HO supply row exactly as the LA stores it (post-projection), STAMPED
// (the four-field authority tuple rides direct-log rows per W4.3 — both-or-neither at egress).
function ROW() {
  return {
    TransactionId: 'txn_direct_1', StoreId: 'boor', Date: '2025-07-04', Timestamp: 1751600000000,
    ProductId: 'prodA', Type: 'transfer_in', Qty: 25, Reason: 'HO restock', TransferId: '',
    IdempotencyKey: 'txn_direct_1', StockFromStoreId: 'head_office', StockToStoreId: 'boor',
    StockFrom: 'Head Office Warehouse', StockTo: 'Boorogoon Store', TargetTransactionId: '',
    SellAtSupply: 100, DiscAtSupply: 25, PricingVersion: 3, CatalogueVersion: 7
  };
}
function signed(row, kr) { const r = J(row); r.EconSig = A.signRow(kr || KR, r); return r; }

// ── Basic contract ───────────────────────────────────────────────────────────────────────────────────
ok('sign yields v1:<kid>:<64 hex>', /^v1:k1:[0-9a-f]{64}$/.test(A.signRow(KR, ROW())));
ok('sign is deterministic (same row -> same seal)', A.signRow(KR, ROW()) === A.signRow(KR, ROW()));
ok('verify accepts an untampered signed row', A.verifyRow(KR, signed(ROW())));
ok('verify accepts UPPERCASE hex/kid (case-insensitive store round-trip)', (() => {
  const r = signed(ROW()); r.EconSig = 'v1:K1:' + r.EconSig.split(':')[2].toUpperCase(); return A.verifyRow(KR, r);
})());
ok('a different pepper under the same kid cannot verify (seal is pepper-bound)',
  !A.verifyRow({ active: 'k1', peppers: { k1: P2 } }, signed(ROW())));
ok('re-signing a row that already carries EconSig is idempotent (EconSig not self-covered)', (() => {
  const r = signed(ROW()); return A.signRow(KR, r) === r.EconSig;
})());

// ── Key ring (R1 Q3 fold — both auditors) ────────────────────────────────────────────────────────────
ok('rotation: a k1 seal still verifies while k2 is active (old pepper retained)',
  A.verifyRow(KR_ROTATED, signed(ROW(), KR)));
ok('rotation: new seals are minted under the ACTIVE kid', /^v1:k2:/.test(A.signRow(KR_ROTATED, ROW())));
ok('a retired kid fails closed (pepper removed ⇒ its seals no longer verify)',
  !A.verifyRow(KR_RETIRED, signed(ROW(), KR)));
ok('an unknown kid in the seal fails closed', (() => {
  const r = signed(ROW()); r.EconSig = r.EconSig.replace('v1:k1:', 'v1:zz:'); return !A.verifyRow(KR, r);
})());
ok('keyringFromEnv: builds from env, active kid must have a pepper', (() => {
  const good = A.keyringFromEnv({ BOB_ROW_ATTEST_ACTIVE: 'k1', BOB_ROW_ATTEST_PEPPER_K1: P1, BOB_ROW_ATTEST_PEPPER_K2: P2 });
  const noActive = A.keyringFromEnv({ BOB_ROW_ATTEST_PEPPER_K1: P1 });
  const missingPepper = A.keyringFromEnv({ BOB_ROW_ATTEST_ACTIVE: 'k3', BOB_ROW_ATTEST_PEPPER_K1: P1 });
  const shortPepper = A.keyringFromEnv({ BOB_ROW_ATTEST_ACTIVE: 'k1', BOB_ROW_ATTEST_PEPPER_K1: 'short' });
  return good && good.active === 'k1' && good.peppers.k2 === P2 && noActive === null && missingPepper === null && shortPepper === null;
})());

// ── THE core claim: EVERY covered field is tamper-evident (whole population, not first instance) ─────
const MUTATIONS = {
  TransactionId: 'txn_other', StoreId: 'karrinyup', Date: '2025-12-04', Timestamp: 1751600000001,
  ProductId: 'prodB', Type: 'out', Qty: 2, Reason: 'edited note', TransferId: 'tr_hijack',
  IdempotencyKey: 'other_key', StockFromStoreId: 'boor', StockToStoreId: 'head_office',
  StockFrom: 'Peer Store', StockTo: 'Customer', TargetTransactionId: 'txn_victim',
  SellAtSupply: 1, DiscAtSupply: 99, PricingVersion: 99, CatalogueVersion: 99
};
for (const f of A.COVERED_FIELDS) {
  ok(`tampering ${f} breaks the seal`, (() => {
    const r = signed(ROW());
    if (!(f in MUTATIONS)) return false; // a covered field with no mutation case = a probe gap, fail loud
    r[f] = MUTATIONS[f];
    return !A.verifyRow(KR, r);
  })());
}
ok('probe matrix covers the module\'s COVERED_FIELDS exactly',
  A.COVERED_FIELDS.length === Object.keys(MUTATIONS).length && A.COVERED_FIELDS.every(f => f in MUTATIONS));
ok('deleting a covered field (not just rewriting) breaks the seal', (() => {
  const r = signed(ROW()); delete r.StockFrom; return !A.verifyRow(KR, r);
})());
ok('qty sign flip breaks the seal (25 -> -25)', (() => {
  const r = signed(ROW()); r.Qty = -25; return !A.verifyRow(KR, r);
})());

// ── R1 auditor repros (permanent — the exact scenarios that motivated the fold) ──────────────────────
ok('R1 AGY-2/Codex-1 repro: blank-source direct-log row + Reason edit ("from ho") breaks the seal', (() => {
  // The engine's last-resort HO classifier is /head\s*office|from ho\b/i.test(t.reason) when
  // stockFromStoreId AND the StockFrom label are both blank (buybackExport.js isHOSupply).
  const r = J(ROW());
  r.StockFromStoreId = ''; r.StockFrom = ''; r.Reason = 'misc adjustment';
  r.EconSig = A.signRow(KR, r);
  ok('  (sanity: the blank-source row itself signs+verifies)', A.verifyRow(KR, r));
  const tampered = J(r); tampered.Reason = 'restock from ho';
  return !A.verifyRow(KR, tampered);
})());
ok('R1 AGY-1 repro: transplanting a validated pricing tuple from another row breaks the seal', (() => {
  const cheap = signed(ROW());
  const dear = J(ROW()); dear.TransactionId = 'txn_dear'; dear.IdempotencyKey = 'txn_dear';
  dear.SellAtSupply = 400; dear.DiscAtSupply = 0; dear.PricingVersion = 5; dear.CatalogueVersion = 9;
  dear.EconSig = A.signRow(KR, dear);
  // Frankenstein: paste the dear row's tuple onto the cheap row, keep the cheap row's valid seal.
  const spliced = J(cheap);
  spliced.SellAtSupply = dear.SellAtSupply; spliced.DiscAtSupply = dear.DiscAtSupply;
  spliced.PricingVersion = dear.PricingVersion; spliced.CatalogueVersion = dear.CatalogueVersion;
  return !A.verifyRow(KR, spliced) && A.verifyRow(KR, dear);
})());
ok('unstamped row (no tuple) signs and verifies (absent ≡ \'\' — both-or-neither egress intact)', (() => {
  const r = J(ROW());
  delete r.SellAtSupply; delete r.DiscAtSupply; delete r.PricingVersion; delete r.CatalogueVersion;
  r.EconSig = A.signRow(KR, r);
  return A.verifyRow(KR, r);
})());

// ── The deliberate boundary: UNCOVERED fields do not disturb the seal (documents decision 3) ─────────
ok('UnitPriceAtTime is NOT covered (sale prices informational — Kunal decision 3)', (() => {
  const r = signed(ROW()); r.UnitPriceAtTime = 999; return A.verifyRow(KR, r);
})());
ok('StaffName/DeviceId are NOT covered (non-economic; Reason moved INTO the covered set at R1)', (() => {
  const r = signed(ROW()); r.StaffName = 'Mallory'; r.DeviceId = 'other-device';
  return A.verifyRow(KR, r);
})());

// ── Canonicalisation edges ───────────────────────────────────────────────────────────────────────────
ok('absent, null and \'\' are one canonical value (SharePoint empty round-trip is not an "edit")', (() => {
  const a = ROW(); a.TransferId = '';
  const b = ROW(); b.TransferId = null;
  const c = ROW(); delete c.TransferId;
  const s = A.signRow(KR, a);
  return A.signRow(KR, b) === s && A.signRow(KR, c) === s;
})());
ok('IdempotencyKey coalesce mirror: absent key signs as TransactionId (matches the LA insert)', (() => {
  const a = ROW(); delete a.IdempotencyKey;
  const b = ROW(); b.IdempotencyKey = b.TransactionId;
  return A.signRow(KR, a) === A.signRow(KR, b);
})());
ok('a receive key (non-default IdempotencyKey) is genuinely covered', (() => {
  const r = signed(ROW()); r.IdempotencyKey = r.TransactionId; // strip the receive key back to default
  r.EconSig = A.signRow(KR, Object.assign(J(ROW()), { IdempotencyKey: 'transfer:tr1:receive:boor:prodA' }));
  return !A.verifyRow(KR, r);
})());
ok('field-boundary injection is dead (JSON framing): value-with-separator cannot collide two rows', (() => {
  const a = ROW(); a.ProductId = 'prodA ' + a.Type; a.Type = '';
  const b = ROW();
  return A.signRow(KR, a) !== A.signRow(KR, b);
})());
ok('quote/backslash values survive JSON framing distinctly', (() => {
  const a = ROW(); a.StockFrom = '","x":"';
  const b = ROW(); b.StockFrom = '\\",\\"x\\":\\"';
  const c = ROW();
  const sa = A.signRow(KR, a), sb = A.signRow(KR, b), sc = A.signRow(KR, c);
  return sa !== sb && sa !== sc && sb !== sc && A.verifyRow(KR, signed(a));
})());
ok('numeric Qty and its string form canonicalise together (SharePoint number round-trip safe)', (() => {
  const a = ROW(); a.Qty = 25;
  const b = ROW(); b.Qty = '25';
  return A.signRow(KR, a) === A.signRow(KR, b);
})());
ok('Date day-part normalisation: \'2025-07-04\' ≡ \'2025-07-04T00:00:00Z\' (SP DateTime echo), different DAY still breaks', (() => {
  const plain = signed(ROW());                       // signed with '2025-07-04'
  const echoed = J(plain); echoed.Date = '2025-07-04T00:00:00Z';
  const otherDay = J(plain); otherDay.Date = '2025-07-05T00:00:00Z';
  return A.verifyRow(KR, echoed) && !A.verifyRow(KR, otherDay);
})());

// ── Malformed seals never verify ─────────────────────────────────────────────────────────────────────
for (const [name, sig] of [
  ['missing EconSig', undefined], ['empty EconSig', ''], ['wrong version prefix', 'v2:k1:' + 'a'.repeat(64)],
  ['kid-less v1 form (pre-R1 draft format)', 'v1:' + 'a'.repeat(64)],
  ['non-hex payload', 'v1:k1:' + 'z'.repeat(64)], ['truncated hex', 'v1:k1:' + 'a'.repeat(63)],
  ['bare hex without prefix', 'a'.repeat(64)], ['object smuggle', { v: 1 }],
  ['oversized kid', 'v1:' + 'k'.repeat(17) + ':' + 'a'.repeat(64)]
]) {
  ok(`malformed seal never verifies: ${name}`, (() => {
    const r = J(ROW()); r.EconSig = sig; return !A.verifyRow(KR, r);
  })());
}

// ── evaluate() route contract ────────────────────────────────────────────────────────────────────────
ok('evaluate sign: sigs aligned to input order + TransactionId echoed (the LA zip cross-check input)', (() => {
  const r1 = ROW(); const r2 = ROW(); r2.TransactionId = 'txn_2'; r2.Qty = 3;
  const out = A.evaluate(KR, { op: 'sign', rows: [r1, r2] });
  return out.sigs.length === 2 && out.sigs[0].TransactionId === 'txn_direct_1' &&
    out.sigs[1].TransactionId === 'txn_2' && out.sigs.every(s => /^v1:k1:[0-9a-f]{64}$/.test(s.EconSig)) &&
    out.sigs[0].EconSig !== out.sigs[1].EconSig;
})());
ok('evaluate verify: mixed batch gives per-row booleans, only detail is ok:boolean (no oracle)', (() => {
  const good = signed(ROW());
  const bad = signed(ROW()); bad.Qty = 500;
  const out = A.evaluate(KR, { op: 'verify', rows: [good, bad] });
  return out.results.length === 2 && out.results[0].ok === true && out.results[1].ok === false &&
    Object.keys(out.results[0]).sort().join(',') === 'TransactionId,ok';
})());
ok('evaluate sign survives junk rows (null / non-object) without throwing', (() => {
  const out = A.evaluate(KR, { op: 'sign', rows: [null, 'junk', ROW()] });
  return out.sigs.length === 3 && /^v1:k1:[0-9a-f]{64}$/.test(out.sigs[2].EconSig);
})());

console.log(`\n==== ${pass}/${pass + fail} attest-rows probes PASS ====`);
process.exit(fail === 0 ? 0 : 1);
