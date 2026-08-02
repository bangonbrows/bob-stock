'use strict';

const E = require('./azure-functions/src/functions/buybackExport.js');

const WFROM = '2025-06-01T00:00:00Z';
const WTO = '2025-11-01T00:00:00Z';
const TUP = { sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 };
const clone = (v) => JSON.parse(JSON.stringify(v));

function fixture() {
  return {
    storeId: 'boor',
    window: { from: WFROM, to: WTO },
    rows: {
      live: [
        { id: 'row_t1', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'tr1', idempotencyKey: 'transfer:tr1:receive:boor:prodA', stockFromStoreId: 'head_office', _spId: 200, ...TUP },
        { id: 'row_sale1', type: 'out', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-10', createdAt: '2025-07-10T05:00:00Z', idempotencyKey: 'row_sale1', stockTo: 'Customer Sale', unitPriceAtTime: 150, _spId: 210 },
      ],
      archive: [],
    },
    steps: [
      { stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'submit', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true, payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP }] } },
      { stepId: 'st2', recordId: 'tr1', recordType: 'transfer', stepType: 'receive', seq: 20, timestamp: Date.parse('2025-07-01T03:00:00Z'), _attested: true, payload: { lines: [{ productId: 'prodA', receivedQty: 5 }] } },
    ],
    controls: { live: [], archive: [], activeManifest: { version: 12, controlHeads: {} } },
    badVersionEvidence: { entries: [] },
    pricing: { storeMap: { '*': [{ rate: 25, from: WFROM, to: null }] }, globalMap: {} },
    products: [{ id: 'prodA', price: 100 }, { id: 'prodB', price: 40 }],
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
    drain: { graceRecords: [{ id: 'g1', state: 'committed', presentedIds: ['row_t1', 'row_sale1'], writtenIds: ['row_t1'], expectedStepIds: ['st1', 'st2'] }] },
  };
}

function run(change) {
  const input = fixture();
  change(input);
  return E.buildBuybackExport(input);
}

function summary(result) {
  return result.ok ? {
    status: result.settlement.status,
    owed: result.settlement.totals.owed,
    revenue: result.settlement.retailProfit.revenue,
    profit: result.settlement.retailProfit.profit,
    reasons: result.settlement.provisionalReasons,
    lines: result.settlement.costLines.map(({ transactionId, productId, date, qty, owed }) => ({ transactionId, productId, date, qty, owed })),
    unverifiable: result.settlement.meta.unverifiableQty,
  } : result;
}

const cases = {};
cases.base = summary(run(() => {}));
cases.quantity_edit = summary(run(v => { v.rows.live[0].qty = 4; }));
cases.product_edit = summary(run(v => { v.rows.live[0].productId = 'prodB'; }));
cases.source_edit = summary(run(v => { v.rows.live[0].stockFromStoreId = 'peer_store'; }));
cases.date_edit = summary(run(v => { v.rows.live[0].date = '2025-10-20'; }));
cases.instant_outside = summary(run(v => { v.rows.live[0].createdAt = '2025-12-01T03:00:00Z'; }));
cases.aggregate_reassignment = summary(run(v => {
  v.rows.live[0].qty = 3;
  Object.assign(v.rows.live[1], { type: 'transfer_in', qty: 2, transferId: 'tr1', stockFromStoreId: 'head_office', ...TUP });
  v.steps[1].payload.expectedLedgerKeys = ['row_t1'];
}));
cases.written_not_presented = summary(run(v => { v.drain.graceRecords[0].presentedIds = ['row_sale1']; }));
cases.fractional_authority = summary(run(v => {
  v.rows.live[0].qty = 1.5;
  v.steps[1].payload.lines[0].receivedQty = 1.5;
}));
cases.fractional_replacement = summary(run(v => {
  v.controls.live.push({
    controlId: 'ctl_replace', type: 'replacement', targetTransactionId: 'row_t1', revision: 1, bornPublicationVersion: 11,
    targetLine: { transferId: 'tr1', productId: 'prodA', qty: 5 },
    row: { id: 'ctl_replace_row', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 1.5, originalEventAt: '2025-07-01T02:00:00Z', stockFromStoreId: 'head_office', ...TUP },
  });
  v.controls.activeManifest.controlHeads.row_t1 = { controlId: 'ctl_replace', revision: 1, bornPublicationVersion: 11 };
}));
cases.unrelated_target_line = summary(run(v => {
  v.rows.live[0].type = 'out';
  v.rows.live.push({ id: 'row_direct', type: 'in', productId: 'prodB', storeId: 'boor', qty: 1, date: '2025-08-01', createdAt: '2025-08-01T02:00:00Z', idempotencyKey: 'row_direct', stockFrom: 'Supplier', _spId: 220 });
  v.controls.live.push({ controlId: 'ctl_direct', type: 'deletion', targetTransactionId: 'row_direct', revision: 1, bornPublicationVersion: 11, targetLine: { transferId: 'tr1', productId: 'prodA', qty: 5 } });
  v.controls.activeManifest.controlHeads.row_direct = { controlId: 'ctl_direct', revision: 1, bornPublicationVersion: 11 };
}));
cases.unverifiable_source_edit = summary(run(v => {
  v.rows.live.push({ id: 'row_direct', type: 'in', productId: 'prodB', storeId: 'boor', qty: 10, date: '2025-08-01', createdAt: '2025-08-01T02:00:00Z', idempotencyKey: 'row_direct', stockFrom: 'HO Warehouse', stockFromStoreId: 'peer_store', _spId: 220, _attested: true, sellAtSupply: 40, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 });
}));
cases.unverifiable_type_edit = summary(run(v => {
  v.rows.live.push({ id: 'row_direct', type: 'out', productId: 'prodB', storeId: 'boor', qty: 10, date: '2025-08-01', createdAt: '2025-08-01T02:00:00Z', idempotencyKey: 'row_direct', stockFrom: 'HO Warehouse', stockFromStoreId: 'head_office', _spId: 220, _attested: true, sellAtSupply: 40, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 });
}));
cases.unverifiable_instant_edit = summary(run(v => {
  v.rows.live.push({ id: 'row_direct', type: 'in', productId: 'prodB', storeId: 'boor', qty: 10, date: '2025-12-01', createdAt: '2025-12-01T02:00:00Z', idempotencyKey: 'row_direct', stockFrom: 'HO Warehouse', stockFromStoreId: 'head_office', _spId: 220, _attested: true, sellAtSupply: 40, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 });
}));

console.log(JSON.stringify(cases, null, 2));
