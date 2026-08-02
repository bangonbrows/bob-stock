'use strict';

const path = require('path');
const { buildBuybackExport } = require(path.join(
  __dirname,
  'azure-functions',
  'src',
  'functions',
  'buybackExport.js'
));

const FROM = '2025-06-01T00:00:00Z';
const TO = '2025-11-01T00:00:00Z';
const TUPLE = { sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 };

function validInput() {
  return {
    storeId: 'boor',
    window: { from: FROM, to: TO },
    rows: {
      live: [
        { id: 'row_t1', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'tr1', idempotencyKey: 'transfer_tr1', stockFromStoreId: 'head_office', _spId: 200, ...TUPLE },
        { id: 'row_sale1', type: 'out', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-10', createdAt: '2025-07-10T05:00:00Z', idempotencyKey: 'row_sale1', stockTo: 'Customer Sale', unitPriceAtTime: 150, _spId: 210 },
      ],
      archive: [],
    },
    steps: [{
      stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'submit', seq: 10,
      timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
      payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUPLE }] },
    }],
    controls: { live: [], archive: [], activeManifest: { version: 12, controlHeads: {} } },
    badVersionEvidence: { entries: [] },
    pricing: { storeMap: { '*': [{ rate: 25, from: FROM, to: null }] }, globalMap: {} },
    products: [{ id: 'prodA', price: 100, stockType: 'retail' }],
    coverage: {
      continuity: true,
      live: { complete: true, leaseId: 'lease_1', runVersion: 7, window: { from: FROM, to: TO } },
      archive: { complete: true, leaseId: 'lease_1', runVersion: 7, window: { from: FROM, to: TO } },
      steps: { complete: true, leaseId: 'lease_1' },
      controls: { live: { complete: true, leaseId: 'lease_1' }, archive: { complete: true, leaseId: 'lease_1' } },
      badVersion: { complete: true, leaseId: 'lease_1' },
      stepsEpochId: 100,
    },
    graceClosed: true,
    drain: { graceRecords: [{ id: 'g1', state: 'committed', presentedIds: ['row_t1', 'row_sale1'], writtenIds: ['row_t1'], expectedStepIds: ['st1'] }] },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function run(name, mutate) {
  const value = clone(validInput());
  mutate(value);
  const out = buildBuybackExport(value);
  const summary = out.ok ? {
    ok: true,
    status: out.settlement.status,
    reasons: out.settlement.provisionalReasons,
    owed: out.settlement.totals.owed,
    revenue: out.settlement.retailProfit.revenue,
    salesQty: out.settlement.retailProfit.salesQty,
    refundQty: out.settlement.retailProfit.refundQty,
    lines: out.settlement.costLines.map(line => line.transactionId),
    usage: out.settlement.usage.prodA,
  } : { ok: false, reason: out.reason, detail: out.detail };
  console.log(`${name}: ${JSON.stringify(summary)}`);
}

function replacement(controlId, target, outputId, instant, qty) {
  return {
    controlId,
    type: 'replacement',
    targetTransactionId: target,
    revision: 1,
    bornPublicationVersion: 11,
    row: {
      id: outputId,
      type: 'transfer_in',
      productId: 'prodA',
      storeId: 'boor',
      qty,
      date: '2025-07-01',
      originalEventAt: instant,
      stockFromStoreId: 'head_office',
      ...TUPLE,
    },
  };
}

function head(controlId) {
  return { controlId, revision: 1, bornPublicationVersion: 11 };
}

run('r1_missing_presented_manifest', value => {
  delete value.drain.graceRecords[0].presentedIds;
});

run('r1_replacement_instant_mismatch', value => {
  value.controls.live.push(replacement('control_1', 'row_t1', 'replacement_1', '2025-12-01T03:00:00Z', 5));
  value.controls.activeManifest.controlHeads.row_t1 = head('control_1');
});

run('r2_missing_transfer_provenance', value => {
  value.rows.live.push({ id: 'row_hidden', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5, date: '2025-07-02', createdAt: '2025-07-02T04:00:00Z', transferId: 'tr_missing', idempotencyKey: 'row_hidden', _spId: 520 });
});

run('r2_missing_expected_step_manifest', value => {
  delete value.drain.graceRecords[0].expectedStepIds;
});

run('r2_replacement_chain', value => {
  value.controls.live.push(
    replacement('control_1', 'row_t1', 'replacement_1', '2025-07-01T03:00:00Z', 5),
    replacement('control_2', 'replacement_1', 'replacement_2', '2025-07-01T03:00:00Z', 7)
  );
  value.controls.activeManifest.controlHeads.row_t1 = head('control_1');
  value.controls.activeManifest.controlHeads.replacement_1 = head('control_2');
  value.drain.graceRecords[0].presentedIds.push('replacement_1');
  value.drain.graceRecords[0].writtenIds.push('replacement_1');
});

run('n9_customer_refund', value => {
  value.rows.live.push({ id: 'row_refund', type: 'return_in', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-07-11', createdAt: '2025-07-11T05:00:00Z', idempotencyKey: 'row_refund', stockFrom: 'Customer', unitPriceAtTime: 150, _spId: 240 });
});

run('n9_ho_return', value => {
  value.rows.live.push({ id: 'row_horet', type: 'transfer_out', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-12', createdAt: '2025-07-12T05:00:00Z', idempotencyKey: 'row_horet', stockToStoreId: 'head_office', stockTo: 'HO Warehouse', _spId: 250 });
});

run('adjacent_supplier_return', value => {
  value.rows.live.push({ id: 'row_supplier_return', type: 'return_in', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-07-11', createdAt: '2025-07-11T05:00:00Z', idempotencyKey: 'row_supplier_return', stockFrom: 'Supplier', unitPriceAtTime: 150, _spId: 241 });
});

run('adjacent_legacy_ho_return', value => {
  value.rows.live.push({ id: 'row_horet_legacy', type: 'out', productId: 'prodA', storeId: 'boor', qty: 2, date: '2025-07-12', createdAt: '2025-07-12T05:00:00Z', idempotencyKey: 'row_horet_legacy', stockTo: 'HO Warehouse', _spId: 251 });
});

run('adjacent_product_missing_from_origin', value => {
  const row = value.rows.live[0];
  row.productId = 'prodB';
  delete row.sellAtSupply;
  delete row.discAtSupply;
  delete row.pricingVersion;
  delete row.catalogueVersion;
  delete row.stockFromStoreId;
  row._spId = 520;
  value.products.push({ id: 'prodB', price: 40, stockType: 'retail' });
});

run('adjacent_transfer_source_conflict', value => {
  value.steps[0].fromStoreId = 'karr';
});

run('adjacent_transfer_destination_conflict', value => {
  delete value.rows.live[0].stockFromStoreId;
  value.steps[0].toStoreId = 'karr';
});
