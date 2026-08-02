'use strict';

const path = require('path');
const { buildBuybackExport } = require(path.join(__dirname, 'azure-functions', 'src', 'functions', 'buybackExport.js'));

const FROM = '2025-06-01T00:00:00Z';
const TO = '2025-11-01T00:00:00Z';
const TUP_A = { sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 };
const TUP_B = { sellAtSupply: 40, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 };
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  return {
    storeId: 'boor',
    window: { from: FROM, to: TO },
    rows: {
      live: [{
        id: 'row_t1', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5,
        date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'tr1',
        idempotencyKey: 'transfer:tr1:receive:boor:prodA', stockFromStoreId: 'head_office',
        stockFrom: 'HO Warehouse', _spId: 200, ...TUP_A,
      }],
      archive: [],
    },
    steps: [
      {
        stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'submit', seq: 10,
        timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
        payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_A }] },
      },
      {
        stepId: 'st2', recordId: 'tr1', recordType: 'transfer', stepType: 'receive', seq: 20,
        timestamp: Date.parse('2025-07-01T03:00:00Z'), _attested: true,
        payload: { lines: [{ productId: 'prodA', receivedQty: 5 }] },
      },
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
      badVersion: { complete: true, leaseId: 'lease_1' },
      stepsEpochId: 100,
    },
    graceClosed: true,
    drain: {
      graceRecords: [{
        id: 'g1', state: 'committed', presentedIds: ['row_t1'], writtenIds: ['row_t1'], expectedStepIds: ['st1', 'st2'],
      }],
    },
  };
}

function run(change) {
  const input = fixture();
  if (change) change(input);
  return buildBuybackExport(input);
}

function view(result) {
  if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail };
  const line = result.settlement.costLines.find(item => item.transactionId === 'row_t1');
  return {
    ok: true,
    status: result.settlement.status,
    owed: result.settlement.totals.owed,
    line: line ? { productId: line.productId, qty: line.qty, owed: line.owed, source: line.source } : null,
    revenue: result.settlement.retailProfit.revenue,
    refundQty: result.settlement.retailProfit.refundQty,
    blockers: result.settlement.provisionalReasons,
  };
}

function addSecondProduct(input) {
  input.steps[0].payload.items.push({ productId: 'prodB', sentQty: 5, basis: 'submit-stamped', ...TUP_B });
  input.steps[1].payload.lines.push({ productId: 'prodB', receivedQty: 5 });
}

function useTierTwoRow(input) {
  for (const key of Object.keys(TUP_A)) delete input.rows.live[0][key];
}

function addSecondTransfer(input) {
  input.steps.push(
    {
      stepId: 'st3', recordId: 'tr2', recordType: 'transfer', stepType: 'submit', seq: 10,
      timestamp: Date.parse('2025-07-01T02:30:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
      payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP_B }] },
    },
    {
      stepId: 'st4', recordId: 'tr2', recordType: 'transfer', stepType: 'receive', seq: 20,
      timestamp: Date.parse('2025-07-01T03:30:00Z'), _attested: true,
      payload: { lines: [{ productId: 'prodA', receivedQty: 5 }] },
    },
  );
  input.drain.graceRecords[0].expectedStepIds.push('st3', 'st4');
}

function useLegacyLensItem(input) {
  useTierTwoRow(input);
  for (const key of Object.keys(TUP_A)) delete input.steps[0].payload.items[0][key];
  delete input.steps[0].payload.items[0].basis;
  input.pricing.storeMap['*'] = [
    { rate: 25, from: FROM, to: '2025-08-01T00:00:00Z' },
    { rate: 50, from: '2025-08-01T00:00:00Z', to: null },
  ];
}

const checks = {};
checks.base = view(run());
checks.peer_label_edit = view(run(input => {
  input.rows.live[0].stockFromStoreId = 'peer_store';
  input.rows.live[0].stockFrom = 'Store Transfer';
}));
checks.transfer_wrong_destination = view(run(input => { input.steps[0].toStoreId = 'karr'; }));
checks.transfer_missing_product = view(run(input => { input.rows.live[0].productId = 'prodB'; }));
checks.mutated_type_missing_steps = view(run(input => {
  input.rows.live[0].type = 'out';
  input.steps = [];
  input.drain.graceRecords[0].expectedStepIds = [];
}));
checks.customer_and_supplier_refunds = view(run(input => {
  input.rows.live.push(
    { id: 'customer_refund', type: 'return_in', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-07-02', createdAt: '2025-07-02T03:00:00Z', idempotencyKey: 'customer_refund', stockFrom: 'Customer', unitPriceAtTime: 150, _spId: 201 },
    { id: 'supplier_return', type: 'return_in', productId: 'prodA', storeId: 'boor', qty: 1, date: '2025-07-03', createdAt: '2025-07-03T03:00:00Z', idempotencyKey: 'supplier_return', stockFrom: 'Supplier', unitPriceAtTime: 150, _spId: 202 },
  );
}));
checks.corrected_missing = view(run(input => {
  input.badVersionEvidence.entries = [{ rowId: 'missing_corrected_row', terminal: 'corrected-and-reattested' }];
}));
checks.corrected_present = view(run(input => {
  input.badVersionEvidence.entries = [{ rowId: 'row_t1', terminal: 'corrected-and-reattested' }];
}));
checks.pre_epoch_transfer = view(run(input => {
  const row = input.rows.live[0];
  row.transferId = 'tr_pre_epoch';
  row._spId = 90;
  for (const key of Object.keys(TUP_A)) delete row[key];
  input.steps = [];
  input.drain.graceRecords[0].expectedStepIds = [];
}));

checks.qty_edited_to_one = view(run(input => { input.rows.live[0].qty = 1; }));
checks.qty_edited_to_500 = view(run(input => { input.rows.live[0].qty = 500; }));
checks.valid_transfer_type_edited_to_out = view(run(input => { input.rows.live[0].type = 'out'; }));
checks.created_at_edited_outside_window = view(run(input => { input.rows.live[0].createdAt = '2025-11-02T03:00:00Z'; }));
checks.product_reassigned_within_transfer = view(run(input => {
  addSecondProduct(input);
  useTierTwoRow(input);
  input.rows.live[0].productId = 'prodB';
}));
checks.product_control_tier_two = view(run(input => {
  addSecondProduct(input);
  useTierTwoRow(input);
}));
checks.transfer_reassigned_to_another_valid_record = view(run(input => {
  addSecondTransfer(input);
  useTierTwoRow(input);
  input.rows.live[0].transferId = 'tr2';
}));
checks.transfer_reassignment_control = view(run(input => {
  addSecondTransfer(input);
  useTierTwoRow(input);
}));
checks.row_price_edit_rejected = view(run(input => { input.rows.live[0].sellAtSupply = 1; }));
checks.legacy_lens_date_control = view(run(input => { useLegacyLensItem(input); }));
checks.legacy_lens_date_edited = view(run(input => {
  useLegacyLensItem(input);
  input.rows.live[0].date = '2025-09-01';
}));

console.log(JSON.stringify(checks, null, 2));
