'use strict';

const path = require('path');
const { buildBuybackExport } = require(path.join(__dirname, 'azure-functions', 'src', 'functions', 'buybackExport.js'));

const FROM = '2025-06-01T00:00:00Z';
const TO = '2025-11-01T00:00:00Z';
const TUP = { sellAtSupply: 100, discAtSupply: 25, pricingVersion: 3, catalogueVersion: 7 };

function fixture() {
  return {
    storeId: 'boor',
    window: { from: FROM, to: TO },
    rows: {
      live: [{
        id: 'row_t1', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 5,
        date: '2025-07-01', createdAt: '2025-07-01T03:00:00Z', transferId: 'tr1',
        idempotencyKey: 'transfer:tr1:receive:boor:prodA', stockFromStoreId: 'head_office',
        _spId: 200, ...TUP,
      }],
      archive: [],
    },
    steps: [
      {
        stepId: 'st1', recordId: 'tr1', recordType: 'transfer', stepType: 'submit', seq: 10,
        timestamp: Date.parse('2025-07-01T02:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
        payload: { items: [{ productId: 'prodA', sentQty: 5, basis: 'submit-stamped', ...TUP }] },
      },
      {
        stepId: 'st2', recordId: 'tr1', recordType: 'transfer', stepType: 'receive', seq: 20,
        timestamp: Date.parse('2025-07-01T03:00:00Z'), _attested: true,
        payload: { receiveAttemptId: 'a1', lines: [{ productId: 'prodA', receivedQty: 5 }] },
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
    drain: { graceRecords: [{ id: 'g1', state: 'committed', presentedIds: ['row_t1'], writtenIds: ['row_t1'], expectedStepIds: ['st1', 'st2'] }] },
  };
}

function run(change) {
  const input = fixture();
  if (change) change(input);
  return buildBuybackExport(input);
}

function view(result) {
  if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail };
  return {
    ok: true,
    status: result.settlement.status,
    owed: result.settlement.totals.owed,
    lines: result.settlement.costLines.map(line => ({ id: line.transactionId, productId: line.productId, qty: line.qty, owed: line.owed, source: line.source })),
    blockers: result.settlement.provisionalReasons,
  };
}

function useBackfill(input, rowQty) {
  input.rows.live[0].qty = rowQty;
  for (const key of Object.keys(TUP)) delete input.rows.live[0][key];
  input.steps = [{
    stepId: 'stbf', recordId: 'tr1', recordType: 'transfer', stepType: 'backfill', seq: 5,
    timestamp: Date.parse('2025-07-01T04:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
    payload: { snapshot: { fromStoreId: 'head_office', toStoreId: 'boor', submittedAt: '2025-07-01T02:00:00Z', items: [{ productId: 'prodA', sentQty: 5, receivedQty: 3 }] } },
  }];
  input.drain.graceRecords[0].expectedStepIds = ['stbf'];
}

function useResolvedConflict(input, includeResolve) {
  input.rows.live[0].qty = 5;
  input.steps[1].payload.lines[0].receivedQty = 3;
  input.steps.push({
    stepId: 'st3', recordId: 'tr1', recordType: 'transfer', stepType: 'receive', seq: 20,
    timestamp: Date.parse('2025-07-01T03:10:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
    payload: { receiveAttemptId: 'a2', lines: [{ productId: 'prodA', receivedQty: 5 }] },
  });
  if (includeResolve) input.steps.push({
    stepId: 'st4', recordId: 'tr1', recordType: 'transfer', stepType: 'resolve', seq: 30,
    timestamp: Date.parse('2025-07-01T04:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
    payload: { generation: 1, resolvesAttemptIds: ['a1', 'a2'], conflictResolution: true, resolutions: [{ productId: 'prodA', action: 'conflict_resolved', qty: 3, basis: 'submit-stamped', ...TUP }] },
  });
  input.drain.graceRecords[0].expectedStepIds = input.steps.map(step => step.stepId);
}

function useFlagResolution(input) {
  input.rows.live[0].qty = 8;
  input.steps[0].payload.items[0].sentQty = 10;
  input.steps[1].payload.lines[0].receivedQty = 8;
  input.steps.push({
    stepId: 'st3', recordId: 'tr1', recordType: 'transfer', stepType: 'resolve', seq: 30,
    timestamp: Date.parse('2025-07-01T04:00:00Z'), fromStoreId: 'head_office', toStoreId: 'boor', _attested: true,
    payload: { generation: 0, resolvesAttemptIds: ['a1'], resolutions: [{ productId: 'prodA', action: 'adjust', qty: 9, basis: 'submit-stamped', ...TUP }] },
  });
  input.rows.live.push({
    id: 'row_topup', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty: 1,
    date: '2025-07-01', createdAt: '2025-07-01T04:00:00Z', transferId: 'tr1',
    idempotencyKey: 'row_topup', stockFromStoreId: 'head_office', _spId: 201, ...TUP,
  });
  input.drain.graceRecords[0].expectedStepIds = input.steps.map(step => step.stepId);
}

function addReplacement(input, qty) {
  input.controls.live.push({
    controlId: 'ctl_r1', type: 'replacement', targetTransactionId: 'row_t1', revision: 1, bornPublicationVersion: 11,
    row: { id: 'ctl_r1_row', type: 'transfer_in', productId: 'prodA', storeId: 'boor', qty, originalEventAt: '2025-07-01T03:00:00Z', stockFromStoreId: 'head_office', ...TUP },
  });
  input.controls.activeManifest.controlHeads.row_t1 = { controlId: 'ctl_r1', revision: 1, bornPublicationVersion: 11 };
}

const checks = {};
checks.base = view(run());
checks.r4_qty_edit = view(run(input => { input.rows.live[0].qty = 500; }));
checks.r4_type_edit = view(run(input => { input.rows.live[0].type = 'out'; }));
checks.r4_window_edit = view(run(input => { input.rows.live[0].createdAt = '2025-11-02T00:00:00Z'; }));
checks.backfill_row_uses_received_qty = view(run(input => { useBackfill(input, 3); }));
checks.backfill_row_uses_sent_qty = view(run(input => { useBackfill(input, 5); }));
checks.unresolved_divergent_receives = view(run(input => { useResolvedConflict(input, false); }));
checks.resolved_conflict_qty_three = view(run(input => { useResolvedConflict(input, true); }));
checks.flag_resolution_to_nine = view(run(input => { useFlagResolution(input); }));
checks.flush_written_not_presented = view(run(input => { input.drain.graceRecords[0].presentedIds = []; }));
checks.replacement_qty_500 = view(run(input => { addReplacement(input, 500); }));
checks.replacement_uses_edited_out_of_window_target_time = view(run(input => {
  input.rows.live[0].createdAt = '2025-12-01T03:00:00Z';
  addReplacement(input, 5);
  input.controls.live[0].row.originalEventAt = '2025-12-01T03:00:00Z';
}));

console.log(JSON.stringify(checks, null, 2));
