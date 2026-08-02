'use strict';

const E = require('./azure-functions/src/functions/buybackExport.js');

const FROM = '2025-06-01T00:00:00Z';
const TO = '2025-11-01T00:00:00Z';
const TUP = { sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 };

function input() {
  return {
    storeId: 'boor', window: { from: FROM, to: TO },
    rows: { live: [
      { id: 'row_t1', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'tr1', idempotencyKey: 'key_t1', stockFromStoreId: 'head_office', _spId: 200, ...TUP },
      { id: 'row_sale1', type: 'out', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-10', createdAt: '2025-07-10T05:00:00Z', idempotencyKey: 'key_sale1', stockTo: 'Customer Sale', unitPriceAtTime: 150, _spId: 210 },
    ], archive: [] },
    steps: [
      { stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'submit', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true, payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP }] } },
      { stepId: 'st2', recordId: 'tr1', recordType: 'transfer', stepType: 'receive', seq: 20, timestamp: Date.parse('2025-07-01T03:00:00Z'), _attested: true, payload: { lines: [{ productId: 'prodA', receivedQty: 5 }], expectedLedgerKeys: ['row_t1'] } },
    ],
    controls: { live: [], archive: [], activeManifest: { version: 12, controlHeads: {} } },
    badVersionEvidence: { entries: [] },
    pricing: { storeMap: { '*': [{ rate: 25, from: FROM, to: null }] }, globalMap: {} },
    products: [{ id: 'prodA', price: 100 }, { id: 'prodB', price: 40 }],
    coverage: {
      continuity: true,
      live: { complete: true, leaseId: 'lease_1', runVersion: 7, window: { from: FROM, to: TO } },
      archive: { complete: true, leaseId: 'lease_1', runVersion: 7, window: { from: FROM, to: TO } },
      steps: { complete: true, leaseId: 'lease_1' },
      controls: { live: { complete: true, leaseId: 'lease_1' }, archive: { complete: true, leaseId: 'lease_1' } },
      badVersion: { complete: true, leaseId: 'lease_1' }, stepsEpochId: 100,
    },
    graceClosed: true,
    drain: { graceRecords: [{ id: 'g1', state: 'committed', presentedIds: ['row_t1', 'row_sale1'], writtenIds: ['row_t1'], expectedStepIds: ['st1', 'st2'] }] },
  };
}

function summarize(r) {
  if (!r.ok) return r;
  return {
    status: r.settlement.status,
    reasons: r.settlement.provisionalReasons,
    owed: r.settlement.totals.owed,
    revenue: r.settlement.retailProfit.revenue,
    profit: r.settlement.retailProfit.profit,
    lines: r.settlement.costLines.map(x => ({ id: x.transactionId, product: x.productId, qty: x.qty, date: x.date, owed: x.owed })),
  };
}

function run(change) { const v = input(); change(v); return summarize(E.buildBuybackExport(v)); }
function relabelSale(v) {
  v.rows.live[0].qty = 3;
  Object.assign(v.rows.live[1], { type: 'transfer_in', qty: 2, transferId: 'tr1', stockFromStoreId: 'head_office', ...TUP });
  delete v.rows.live[1].stockTo;
  delete v.rows.live[1].unitPriceAtTime;
}

const cases = {};
cases.valid = run(() => {});
cases.missing_key_manifest = run(v => { delete v.steps[1].payload.expectedLedgerKeys; relabelSale(v); });
cases.string_key_manifest = run(v => { v.steps[1].payload.expectedLedgerKeys = 'row_t1'; relabelSale(v); });
cases.backfill_without_keys = run(v => {
  v.steps = [{ stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'backfill', seq: 10, timestamp: Date.parse('2025-07-01T02:00:00Z'), _attested: true, payload: { snapshot: { fromStoreId: 'head_office', toStoreId: 'boor', items: [{ productId: 'prodA', sentQty: 5, receivedQty: 5 }] } } }];
  v.drain.graceRecords[0].expectedStepIds = ['st1'];
  relabelSale(v);
  for (const row of v.rows.live) { delete row.sellAtSupply; delete row.discAtSupply; delete row.pricingVersion; delete row.catalogueVersion; }
});
cases.fractional_row = run(v => { v.rows.live[0].qty = 1.5; });
cases.edited_date = run(v => { v.rows.live[0].date = '2025-10-20'; });

console.log(JSON.stringify(cases, null, 2));
