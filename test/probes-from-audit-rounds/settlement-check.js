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
const TUPLE = {
  sellAtSupply: 100,
  discAtSupply: 25,
  pricingVersion: 3,
  catalogueVersion: 7,
};

function input() {
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
        transferId: 'transfer_1',
        idempotencyKey: 'key_1',
        stockFromStoreId: 'head_office',
        _spId: 200,
        ...TUPLE,
      }],
      archive: [],
    },
    steps: [{
      stepId: 'step_1',
      recordId: 'transfer_1',
      recordType: 'transfer',
      stepType: 'submit',
      seq: 10,
      timestamp: Date.parse('2025-07-01T02:00:00Z'),
      fromStoreId: 'head_office',
      toStoreId: 'boor',
      _attested: true,
      payload: {
        items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUPLE }],
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

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function result(name, mutate) {
  const value = copy(input());
  mutate(value);
  const out = buildBuybackExport(value);
  const summary = out.ok ? {
    ok: true,
    status: out.settlement.status,
    reasons: out.settlement.provisionalReasons,
    owed: out.settlement.totals.owed,
    lines: out.settlement.costLines.map(line => line.transactionId),
  } : { ok: false, reason: out.reason, detail: out.detail };
  console.log(`${name}: ${JSON.stringify(summary)}`);
}

function replacement(controlId, targetTransactionId, rowId, originalEventAt, qty) {
  return {
    controlId,
    type: 'replacement',
    targetTransactionId,
    revision: 1,
    bornPublicationVersion: 11,
    row: {
      id: rowId,
      type: 'transfer_in',
      productId: 'prodA',
      storeId: 'boor',
      qty,
      date: '2025-07-01',
      originalEventAt,
      stockFromStoreId: 'head_office',
      ...TUPLE,
    },
  };
}

function head(controlId) {
  return { controlId, revision: 1, bornPublicationVersion: 11 };
}

result('missing_presented_manifest', value => {
  delete value.drain.graceRecords[0].presentedIds;
});

result('empty_presented_manifest', value => {
  value.drain.graceRecords[0].presentedIds = [];
  value.drain.graceRecords[0].writtenIds = [];
});

result('replacement_instant_mismatch', value => {
  value.controls.live.push(replacement('control_1', 'row_1', 'replacement_1', '2025-12-01T03:00:00Z', 5));
  value.controls.activeManifest.controlHeads.row_1 = head('control_1');
});

result('replacement_instant_match', value => {
  value.controls.live.push(replacement('control_1', 'row_1', 'replacement_1', '2025-07-01T03:00:00Z', 5));
  value.controls.activeManifest.controlHeads.row_1 = head('control_1');
});

result('missing_expected_step_manifest', value => {
  delete value.rows.live[0].sellAtSupply;
  delete value.rows.live[0].discAtSupply;
  delete value.rows.live[0].pricingVersion;
  delete value.rows.live[0].catalogueVersion;
  value.rows.live[0]._spId = 50;
  value.steps = [];
  delete value.drain.graceRecords[0].expectedStepIds;
  value.pricing.storeMap['*'][0].rate = 10;
});

result('omitted_step_with_manifest_present', value => {
  delete value.rows.live[0].sellAtSupply;
  delete value.rows.live[0].discAtSupply;
  delete value.rows.live[0].pricingVersion;
  delete value.rows.live[0].catalogueVersion;
  value.rows.live[0]._spId = 50;
  value.steps = [];
  value.pricing.storeMap['*'][0].rate = 10;
});

result('attested_step_present_for_unstamped_row', value => {
  delete value.rows.live[0].sellAtSupply;
  delete value.rows.live[0].discAtSupply;
  delete value.rows.live[0].pricingVersion;
  delete value.rows.live[0].catalogueVersion;
  value.rows.live[0]._spId = 50;
  value.pricing.storeMap['*'][0].rate = 10;
});

result('replacement_chain', value => {
  const first = replacement('control_1', 'row_1', 'replacement_1', '2025-07-01T03:00:00Z', 5);
  const second = replacement('control_2', 'replacement_1', 'replacement_2', '2025-07-01T03:00:00Z', 7);
  value.controls.live.push(first, second);
  value.controls.activeManifest.controlHeads.row_1 = head('control_1');
  value.controls.activeManifest.controlHeads.replacement_1 = head('control_2');
  value.drain.graceRecords[0].presentedIds.push('replacement_1');
  value.drain.graceRecords[0].writtenIds.push('replacement_1');
});
