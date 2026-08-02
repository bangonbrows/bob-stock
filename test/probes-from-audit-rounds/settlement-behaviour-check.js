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
const tuple = {
  sellAtSupply: 100,
  discAtSupply: 25,
  pricingVersion: 3,
  catalogueVersion: 7,
};

function base() {
  return {
    storeId: 'boor',
    window: { from: FROM, to: TO },
    rows: {
      live: [{
        id: 'row_1',
        type: 'transfer_in',
        productId: 'prodA',
        storeId: 'boor',
        qty: 5,
        date: '2025-07-01',
        createdAt: '2025-07-01T03:00:00Z',
        transferId: 'tr1',
        idempotencyKey: 'key_1',
        stockFromStoreId: 'head_office',
        stockFrom: 'HO Warehouse',
        _spId: 200,
        ...tuple,
      }],
      archive: [],
    },
    steps: [{
      stepId: 'step_1',
      recordId: 'tr1',
      recordType: 'transfer',
      stepType: 'submit',
      seq: 10,
      timestamp: Date.parse('2025-07-01T02:00:00Z'),
      fromStoreId: 'head_office',
      toStoreId: 'boor',
      _attested: true,
      payload: {
        items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...tuple }],
      },
    }],
    controls: {
      live: [],
      archive: [],
      activeManifest: { version: 12, controlHeads: {} },
    },
    badVersionEvidence: { entries: [] },
    pricing: {
      storeMap: { '*': [{ rate: 25, from: FROM, to: null }] },
      globalMap: {},
    },
    products: [{ id: 'prodA', price: 100 }],
    coverage: {
      continuity: true,
      live: { complete: true, leaseId: 'lease_1', runVersion: 7, window: { from: FROM, to: TO } },
      archive: { complete: true, leaseId: 'lease_1', runVersion: 7, window: { from: FROM, to: TO } },
      steps: { complete: true, leaseId: 'lease_1' },
      controls: {
        live: { complete: true, leaseId: 'lease_1' },
        archive: { complete: true, leaseId: 'lease_1' },
      },
      badVersion: { complete: true, leaseId: 'lease_1' },
      stepsEpochId: 100,
    },
    graceClosed: true,
    drain: {
      graceRecords: [{
        id: 'grace_1',
        state: 'committed',
        presentedIds: ['row_1'],
        writtenIds: ['row_1'],
        expectedStepIds: ['step_1'],
      }],
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function run(name, change, summarize) {
  const input = clone(base());
  change(input);
  const result = buildBuybackExport(input);
  console.log(`${name}: ${JSON.stringify(summarize(result))}`);
}

function line(result) {
  return result.ok ? result.settlement.costLines[0] || null : null;
}

run('drain_missing_manifests', input => {
  input.drain.graceRecords = [{ state: 'committed' }];
}, result => ({ ok: result.ok, status: result.ok && result.settlement.status, reasons: result.ok && result.settlement.provisionalReasons }));

run('replacement_unbound_original_instant', input => {
  input.controls.live.push({
    controlId: 'control_1',
    type: 'replacement',
    targetTransactionId: 'row_1',
    revision: 1,
    bornPublicationVersion: 11,
    row: {
      id: 'replacement_1',
      type: 'transfer_in',
      productId: 'prodA',
      storeId: 'boor',
      qty: 5,
      date: '2025-12-01',
      originalEventAt: '2025-12-01T03:00:00Z',
      stockFromStoreId: 'head_office',
      ...tuple,
    },
  });
  input.controls.activeManifest.controlHeads.row_1 = {
    controlId: 'control_1',
    revision: 1,
    bornPublicationVersion: 11,
  };
}, result => ({ ok: result.ok, status: result.ok && result.settlement.status, costLines: result.ok && result.settlement.costLines.length }));

run('invalid_lens_calendar_date', input => {
  delete input.rows.live[0].sellAtSupply;
  delete input.rows.live[0].discAtSupply;
  delete input.rows.live[0].pricingVersion;
  delete input.rows.live[0].catalogueVersion;
  input.rows.live[0]._spId = 50;
  input.rows.live[0].date = '2025-02-30';
  input.rows.live[0].createdAt = '2025-07-01T03:00:00Z';
  input.steps = [];
  input.drain.graceRecords[0].expectedStepIds = [];
  input.pricing.storeMap['*'] = [
    { rate: 10, from: '2025-02-01T00:00:00Z', to: '2025-03-01T00:00:00Z' },
    { rate: 40, from: '2025-03-01T00:00:00Z', to: null },
  ];
}, result => ({ ok: result.ok, status: result.ok && result.settlement.status, line: line(result) && { discPct: line(result).discPct, owed: line(result).owed } }));

run('post_epoch_unstamped_transferless', input => {
  delete input.rows.live[0].sellAtSupply;
  delete input.rows.live[0].discAtSupply;
  delete input.rows.live[0].pricingVersion;
  delete input.rows.live[0].catalogueVersion;
  delete input.rows.live[0].transferId;
  input.rows.live[0]._spId = 500;
  input.steps = [];
  input.drain.graceRecords[0].expectedStepIds = [];
}, result => ({ ok: result.ok, status: result.ok && result.settlement.status, line: line(result) && { source: line(result).source, owed: line(result).owed } }));

run('legacy_transfer_without_structured_source', input => {
  delete input.rows.live[0].sellAtSupply;
  delete input.rows.live[0].discAtSupply;
  delete input.rows.live[0].pricingVersion;
  delete input.rows.live[0].catalogueVersion;
  delete input.rows.live[0].stockFromStoreId;
  input.rows.live[0]._spId = 50;
  input.steps = [];
  input.drain.graceRecords[0].expectedStepIds = [];
}, result => ({ ok: result.ok, status: result.ok && result.settlement.status, costLines: result.ok && result.settlement.costLines.length, usage: result.ok && result.settlement.usage }));

run('attested_step_tuple_without_basis', input => {
  delete input.rows.live[0].sellAtSupply;
  delete input.rows.live[0].discAtSupply;
  delete input.rows.live[0].pricingVersion;
  delete input.rows.live[0].catalogueVersion;
  delete input.steps[0].payload.items[0].basis;
}, result => ({ ok: result.ok, reason: result.reason, status: result.ok && result.settlement.status, line: line(result) && { source: line(result).source, owed: line(result).owed } }));

run('catalogue_negative_money', input => {
  input.rows.live[0].type = 'out';
  input.rows.live[0].stockTo = 'Customer Sale';
  delete input.rows.live[0].transferId;
  delete input.rows.live[0].stockFromStoreId;
  delete input.rows.live[0].sellAtSupply;
  delete input.rows.live[0].discAtSupply;
  delete input.rows.live[0].pricingVersion;
  delete input.rows.live[0].catalogueVersion;
  input.products[0].price = -10;
  input.steps = [];
  input.drain.graceRecords[0].expectedStepIds = [];
}, result => ({ ok: result.ok, status: result.ok && result.settlement.status, revenue: result.ok && result.settlement.retailProfit.revenue }));

run('derived_money_overflow', input => {
  input.rows.live[0].qty = Number.MAX_VALUE;
}, result => ({ ok: result.ok, status: result.ok && result.settlement.status, owed: line(result) && line(result).owed, total: result.ok && result.settlement.totals.owed }));

run('step_destination_mismatch', input => {
  input.steps[0].toStoreId = 'karr';
}, result => ({ ok: result.ok, status: result.ok && result.settlement.status, line: line(result) && { source: line(result).source, owed: line(result).owed } }));
