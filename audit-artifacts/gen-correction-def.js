// OS-W4.4 Contract 2 — GENERATOR for the N1 correction Logic App definition.
// Spec: AZURE-CHUNK-ORG-C2-LA-CHANGES.md §B (phase-by-phase), built after the 10-round interim
// review (fold records §F/§H/§J/§L/§N/§P/§R/§T/§X; matrix proven disjoint R8 + complete R9).
//
// SECURITY: this generator NEVER writes a function key. Every function URI carries the literal
// placeholder `@@FN_KEY@@`, which `apply-c2-staging.js` substitutes IN-PROCESS at deploy time.
// The emitted file is therefore safe to read, diff and hand to a reviewer.
//
// Usage:  node gen-correction-def.js [outFile]
// Emits:  correction-def-generated.json   (definition only — no $connections values)
//
// House patterns mirrored verbatim from the DEPLOYED archive LA (archive-def-current.json):
//   - SharePoint I/O via the `sharepointonline` connection's `httpRequest` passthru (ApiConnection)
//   - Function calls = plain Http POST, with secureData on inputs+outputs
//   - CAS = `X-HTTP-Method: MERGE` + `IF-MATCH: <captured etag>`  (never `IF-MATCH: *`, C2-R1-2)
//   - Every branch terminates in a Response action (no dangling runs)
'use strict';

const fs = require('fs');
const path = require('path');

const SITE = 'https://bangonbrows.sharepoint.com';
const FN = 'https://bob-stock-money-fn.azurewebsites.net/api';
const KEY = '@@FN_KEY@@';                 // injected at apply time — never a real key in this file

const L = {
  live: 'StockTransactions_Staging',
  archive: 'StockTransactions_Archive_Staging',
  validate: 'StockTransactions_Validate',
  quarantine: 'StockTransactions_Quarantine_Staging',
  pending: 'StockControlPending_Staging',        // N18
  registry: 'ControlRegistry_Staging',           // N3
  journal: 'CorrectionJournal_Staging',          // N4
  runRecords: 'ArchiveRunRecords_Staging',       // N17
  approvals: 'BuildApprovals_Staging',           // N19 (append-only)
  users: 'UserCredentials_Staging',
  steps: 'RecordSteps_Staging',
  config: 'AppConfig_Staging',
};

// ── action builders ────────────────────────────────────────────────────────────────────────────────
const after = (deps) => {
  const r = {};
  for (const d of [].concat(deps || [])) r[d] = ['Succeeded'];
  return r;
};
const afterAny = (deps) => {
  const r = {};
  for (const d of [].concat(deps || [])) r[d] = ['Succeeded', 'Failed'];
  return r;
};

// SharePoint passthru. `uri` is an OData path relative to the site.
function sp(uri, opts) {
  const o = opts || {};
  const body = { method: o.method || 'GET', uri, headers: Object.assign({ Accept: 'application/json;odata=nometadata' }, o.headers || {}) };
  if (o.payload !== undefined) body.body = o.payload;
  return {
    type: 'ApiConnection',
    inputs: {
      host: { connection: { name: "@parameters('$connections')['sharepointonline']['connectionId']" } },
      method: 'post',
      path: `/datasets/@{encodeURIComponent(encodeURIComponent('${SITE}'))}/httpRequest`,
      body,
    },
    runAfter: o.runAfter || {},
  };
}

// SharePoint CAS MERGE — IF-MATCH is MANDATORY (C2-R1-2: `IF-MATCH: *` is retired).
function spMerge(uri, payload, etagExpr, runAfter) {
  if (!etagExpr || /^\s*\*\s*$/.test(etagExpr)) throw new Error('spMerge requires a captured ETag — IF-MATCH:* is retired (C2-R1-2)');
  return sp(uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;odata=nometadata', 'X-HTTP-Method': 'MERGE', 'IF-MATCH': etagExpr },
    payload, runAfter,
  });
}

function spCreate(uri, payload, runAfter) {
  return sp(uri, { method: 'POST', headers: { 'Content-Type': 'application/json;odata=nometadata' }, payload, runAfter });
}

// Function call. `route` is the function name; `body` the request object.
function fn(route, body, runAfter) {
  return {
    type: 'Http',
    inputs: {
      method: 'POST',
      uri: `${FN}/${route}?code=${KEY}`,
      headers: { 'Content-Type': 'application/json' },
      body,
    },
    runAfter: runAfter || {},
    runtimeConfiguration: { secureData: { properties: ['inputs', 'outputs'] } },
  };
}

// correctionCompute op call (N2 — every decision lives here, never in the LA).
const op = (name, inputs, runAfter) => fn('correctionCompute', Object.assign({ op: name }, inputs), runAfter);

function response(statusCode, body, runAfter) {
  return { type: 'Response', kind: 'Http', inputs: { statusCode, headers: { 'Content-Type': 'application/json' }, body }, runAfter: runAfter || {} };
}

// ⚠ A `Response` DOES NOT END A LOGIC APP RUN. Without an explicit Terminate, a gate's else-branch
// would send its 401/409 and then execution would CARRY ON into the happy path at the parent scope —
// i.e. every gate would be decorative and a refused correction would still publish. Found by
// check-correction-def.js on the first generated definition. Every refusal branch therefore ends
// `Response -> Terminate`, and the validator enforces it.
const terminate = (runAfter) => ({ type: 'Terminate', inputs: { runStatus: 'Cancelled' }, runAfter: runAfter || {} });

// A refusal terminal: respond, then STOP.
function refusalBranch(name, statusCode, body, pre) {
  const b = {};
  let last = null;
  if (pre) { Object.assign(b, pre.actions); last = pre.last; }
  b[name] = response(statusCode, body, last ? after(last) : {});
  b[name + '_stop'] = terminate(after(name));
  return b;
}
const refuse = (reason, statusCode, runAfter) => response(statusCode || 400, { ok: false, reason }, runAfter);

// ── the definition ─────────────────────────────────────────────────────────────────────────────────
function build() {
  const A = {};
  const item = (list, filterOrId) => `_api/web/lists/getbytitle('${list}')/items${filterOrId}`;

  // ── P0: triple gate (mirrors the archive LA verbatim, purpose swapped to 'correction', N8) ───────
  A.Gate_keys = fn('validateKeys', {
    deviceId: "@coalesce(triggerBody()?['auth']?['deviceId'],'')",
    storeId: "@coalesce(triggerBody()?['auth']?['storeId'],'')",
    directorKey: "@coalesce(triggerBody()?['auth']?['directorKey'],'')",
  });
  A.Keys_ok = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Gate_keys')?['ok'],false)", true] }] },
    runAfter: afterAny('Gate_keys'),
    actions: {},
    else: { actions: { Reject_keys: response(401, { ok: false, reason: 'UNAUTHORIZED' }), Reject_keys_stop: terminate(after('Reject_keys')) } },
  };

  A.Read_actor = sp(item(L.users, `?$select=Id,Username,Role,TokenVersion,Active&$filter=Active eq 1 and Username eq '@{coalesce(triggerBody()?[''actorUsername''],'''')}'`), { runAfter: after('Keys_ok') });
  A.Gate_proof = fn('verifyProof', {
    proof: "@coalesce(triggerBody()?['proof'],'')",
    expectedPurposes: ['correction'],                       // N8 — in SUDO_PURPOSES as of W-B1
    deviceContext: '__director',
    rows: "@coalesce(body('Read_actor')?['value'],json('[]'))",
  }, afterAny('Read_actor'));

  // Gate_role: role must be director AND the proof's TokenVersion must match the CURRENT row.
  A.Gate_role = {
    type: 'If',
    expression: {
      and: [
        { equals: ["@coalesce(body('Gate_proof')?['ok'],false)", true] },
        { equals: ["@toLower(coalesce(first(body('Read_actor')?['value'])?['Role'],''))", 'director'] },
        { equals: ["@string(coalesce(first(body('Read_actor')?['value'])?['TokenVersion'],''))", "@string(coalesce(body('Gate_proof')?['tokenVersion'],'x'))"] },
      ],
    },
    runAfter: afterAny('Gate_proof'),
    actions: {},
    else: { actions: { Reject_role: response(403, { ok: false, reason: 'FORBIDDEN' }), Reject_role_stop: terminate(after('Reject_role')) } },
  };

  // ── P1: idempotency BEFORE any CAS ───────────────────────────────────────────────────────────────
  A.Digest = op('digest', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    target: "@coalesce(triggerBody()?['intent']?['targetTransactionId'],'')",
    expected: "@triggerBody()?['intent']?['expected']",
    control: "@triggerBody()?['intent']?['control']",
    actorUsername: "@coalesce(triggerBody()?['actorUsername'],'')",
  }, after('Gate_role'));

  A.Journal_lookup = sp(item(L.journal, `?$select=Id,OpId,JournalId,Mode,Target,State,Digest,StoredResult,CandidateHeads,AdoptionDecisions,CandidateVersion,HeartbeatAt&$filter=OpId eq '@{coalesce(triggerBody()?[''intent'']?[''opId''],'''')}'`), { runAfter: after('Digest') });

  // Terminal + digest match => REPLAY StoredResult (incl. the C2-R8-1 convergence fields).
  // Terminal + digest MISMATCH => OPID_REUSED. Non-terminal own => reconcile.
  A.Journal_branch = {
    type: 'Switch',
    expression: "@if(empty(body('Journal_lookup')?['value']),'none',if(contains(json('[\"complete\",\"rolled_back\",\"needs_manual\"]'),coalesce(first(body('Journal_lookup')?['value'])?['State'],'')),if(equals(coalesce(first(body('Journal_lookup')?['value'])?['Digest'],''),coalesce(body('Digest')?['digest'],'')),'replay','reused'),'reconcile'))",
    runAfter: after('Journal_lookup'),
    cases: {
      Replay: { case: 'replay', actions: { Respond_replay: response(200, "@json(coalesce(first(body('Journal_lookup')?['value'])?['StoredResult'],'{}'))"), Respond_replay_stop: terminate(after('Respond_replay')) } },
      Reused: { case: 'reused', actions: { Respond_reused: refuse('OPID_REUSED', 409), Respond_reused_stop: terminate(after('Respond_reused')) } },
      Reconcile: { case: 'reconcile', actions: { Run_reconcile: op('claimDispatch', { lane: 'own-nonterminal', journal: "@first(body('Journal_lookup')?['value'])" }), Respond_reconcile: response(202, { ok: false, reason: 'RECOVERY_IN_PROGRESS' }, after('Run_reconcile')), Respond_reconcile_stop: terminate(after('Respond_reconcile')) } },
    },
    default: { actions: {} },   // 'none' => proceed to P2
  };

  // ── P2: acquire + capture (the P6 ETag is captured HERE and never re-read, C2-R1-1) ──────────────
  A.Reconcile_prepass = sp(item(L.journal, `?$select=Id,OpId,State,HeartbeatAt&$filter=State ne 'complete' and State ne 'rolled_back' and State ne 'needs_manual'`), { runAfter: after('Journal_branch') });
  A.Prepass_gate = {
    type: 'If',
    // any FRESH foreign non-terminal journal (heartbeat within T-1 = 10 min) => 409 busy.
    expression: { and: [{ equals: ["@length(filter(coalesce(body('Reconcile_prepass')?['value'],json('[]')), item => and(not(equals(item?['OpId'], coalesce(triggerBody()?['intent']?['opId'],''))), greater(coalesce(item?['HeartbeatAt'],''), addMinutes(utcNow(),-10)))))", 0] }] },
    runAfter: after('Reconcile_prepass'),
    actions: {},
    else: { actions: { Respond_busy: refuse('BUSY_FOREIGN_CORRECTION', 409), Respond_busy_stop: terminate(after('Respond_busy')) } },
  };

  A.Get_archive_state = sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'archive_state'`), { runAfter: after('Prepass_gate') });
  A.Acquire = spMerge(
    item(L.config, "(@{first(body('Get_archive_state')?['value'])?['Id']})"),
    { ConfigData: "@{string(setProperty(setProperty(setProperty(setProperty(json(coalesce(first(body('Get_archive_state')?['value'])?['ConfigData'],'{}')),'state','correction_active'),'opId',coalesce(triggerBody()?['intent']?['opId'],'')),'owner',workflow()?['run']?['name']),'heartbeatAt',utcNow()))}" },
    "@{first(body('Get_archive_state')?['value'])?['@odata.etag']}",
    after('Get_archive_state'));
  A.Acquire_ok = {
    type: 'If',
    expression: { and: [{ less: ["@int(coalesce(outputs('Acquire')?['statusCode'],500))", 300] }] },
    runAfter: afterAny('Acquire'), actions: {},
    else: { actions: { Respond_acquire_conflict: refuse('COORDINATION_CONFLICT', 409), Respond_acquire_conflict_stop: terminate(after('Respond_acquire_conflict')) } },
  };

  // Capture_snapshot — BOTH the ETag and the ConfigData go into variables NOW; P6 uses ONLY these.
  A.Capture_snapshot = sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'stock_snapshot'`), { runAfter: after('Acquire_ok') });
  A.Set_snapshot_etag = { type: 'InitializeVariable', inputs: { variables: [{ name: 'snapEtag', type: 'string', value: "@{first(body('Capture_snapshot')?['value'])?['@odata.etag']}" }] }, runAfter: after('Capture_snapshot') };
  A.Set_snapshot_data = { type: 'InitializeVariable', inputs: { variables: [{ name: 'snapData', type: 'string', value: "@{coalesce(first(body('Capture_snapshot')?['value'])?['ConfigData'],'{}')}" }] }, runAfter: after('Set_snapshot_etag') };
  A.Set_snapshot_id = { type: 'InitializeVariable', inputs: { variables: [{ name: 'snapItemId', type: 'string', value: "@{first(body('Capture_snapshot')?['value'])?['Id']}" }] }, runAfter: after('Set_snapshot_data') };

  // ── P3: authoritative state ──────────────────────────────────────────────────────────────────────
  // SOURCE-FIRST Live -> Archive (C2-R17-2).
  const tgt = "@{coalesce(triggerBody()?['intent']?['targetTransactionId'],'')}";
  A.Target_live = sp(item(L.live, `?$top=2&$filter=TransactionId eq '${tgt}'`), { runAfter: after('Set_snapshot_id') });
  A.Target_archive = sp(item(L.archive, `?$top=2&$filter=TransactionId eq '${tgt}'`), { runAfter: after('Target_live') });
  A.Target_gate = {
    type: 'Switch',
    expression: "@if(and(empty(body('Target_live')?['value']),empty(body('Target_archive')?['value'])),'none',if(and(not(empty(body('Target_live')?['value'])),not(empty(body('Target_archive')?['value']))),'both','one'))",
    runAfter: after('Target_archive'),
    cases: {
      None: { case: 'none', actions: { Respond_no_target: refuse('TARGET_NOT_FOUND', 404), Respond_no_target_stop: terminate(after('Respond_no_target')) } },
      Both: { case: 'both', actions: { Respond_dup_target: refuse('TARGET_DUPLICATED', 409), Respond_dup_target_stop: terminate(after('Respond_dup_target')) } },
    },
    default: { actions: {} },
  };

  // Three-way seal: econ-v1 on the row, epoch-v1 on the seal artifact, then op:targetSeal adjudicates.
  A.Get_seal_epoch = sp(item(L.config, `?$select=Id,ConfigData&$filter=ConfigType eq 'seal_epoch'`), { runAfter: after('Target_gate') });
  A.Verify_target_row = fn('attestRows', { op: 'verify', frame: 'econ-v1', rows: "@coalesce(union(coalesce(body('Target_live')?['value'],json('[]')),coalesce(body('Target_archive')?['value'],json('[]'))),json('[]'))" }, after('Get_seal_epoch'));
  A.Verify_epoch = fn('attestRows', { op: 'verify', frame: 'epoch-v1', record: "@json(coalesce(first(body('Get_seal_epoch')?['value'])?['ConfigData'],'{}'))" }, afterAny('Verify_target_row'));
  A.Seal_threeway = op('targetSeal', {
    econSigPresent: "@not(empty(coalesce(first(coalesce(body('Target_live')?['value'],body('Target_archive')?['value']))?['EconSig'],'')))",
    verifyOk: "@coalesce(body('Verify_target_row')?['ok'],false)",
    provenanceId: "@coalesce(first(body('Target_live')?['value'])?['Id'],first(body('Target_archive')?['value'])?['SourceId'],'')",
    epochPresent: "@not(empty(coalesce(body('Get_seal_epoch')?['value'],json('[]'))))",
    epochSigValid: "@coalesce(body('Verify_epoch')?['ok'],false)",
    epoch: "@json(coalesce(first(body('Get_seal_epoch')?['value'])?['ConfigData'],'{}'))",
  }, afterAny('Verify_epoch'));
  A.Seal_gate = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Seal_threeway')?['ok'],false)", true] }] },
    runAfter: after('Seal_threeway'), actions: {},
    else: { actions: { Rollback_release_seal: releaseAction('Respond_seal'), Respond_seal: response(409, { ok: false, reason: "@coalesce(body('Seal_threeway')?['reason'],'TARGET_SEAL_BROKEN')" }, after('Rollback_release_seal')), Respond_seal_stop: terminate(after('Respond_seal')) } },
  };

  // Steps enumeration (transfer-linked targets only) — paged walk, then a digest.
  A.Steps_enumerate = sp(item(L.steps, `?$top=200&$orderby=Id asc&$filter=RecordId eq '@{coalesce(first(coalesce(body(''Target_live'')?[''value''],body(''Target_archive'')?[''value'']))?[''TransferId''],'''')}'`), { runAfter: after('Seal_gate') });
  A.Step_digest = op('stepSetDigest', { steps: "@coalesce(body('Steps_enumerate')?['value'],json('[]'))" }, after('Steps_enumerate'));

  // Mode gate — ALL legality lives in the compute op (C2-LA-1b).
  A.Registry_lookup = sp(item(L.registry, `?$top=2&$filter=TargetTransactionId eq '${tgt}'`), { runAfter: after('Step_digest') });
  A.Belt_tombstone = sp(item(L.live, `?$top=5&$filter=Type eq 'deleted' and TargetTransactionId eq '${tgt}'`), { runAfter: after('Registry_lookup') });
  A.Mode_gate = op('modeGate', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    expected: "@triggerBody()?['intent']?['expected']",
    registryItem: "@first(body('Registry_lookup')?['value'])",
    beltTombstone: "@first(body('Belt_tombstone')?['value'])",
    retireEvidence: "@triggerBody()?['intent']?['retireEvidence']",
  }, after('Belt_tombstone'));
  A.Mode_gate_ok = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Mode_gate')?['ok'],false)", true] }] },
    runAfter: after('Mode_gate'), actions: {},
    else: { actions: { Rollback_release_mode: releaseAction('Respond_mode'), Respond_mode: response(409, { ok: false, reason: "@coalesce(body('Mode_gate')?['reason'],'MODE_REFUSED')" }, after('Rollback_release_mode')), Respond_mode_stop: terminate(after('Respond_mode')) } },
  };

  // ── P4: compute — every decision via correctionCompute ───────────────────────────────────────────
  A.Target_line = op('targetLine', {
    target: "@first(coalesce(body('Target_live')?['value'],body('Target_archive')?['value']))",
    steps: "@coalesce(body('Steps_enumerate')?['value'],json('[]'))",
  }, after('Mode_gate_ok'));
  A.Stamps = op('stamps', { mode: "@coalesce(triggerBody()?['intent']?['mode'],'')", control: "@triggerBody()?['intent']?['control']", targetLine: "@body('Target_line')?['targetLine']" }, after('Target_line'));

  // op:membership INPUT MAPPING — PINNED (§B 13a). Both target bindings are MANDATORY.
  A.Run_record = sp(item(L.runRecords, `?$top=2&$filter=RunId eq '@{coalesce(first(coalesce(body(''Target_live'')?[''value''],body(''Target_archive'')?[''value'']))?[''ArchiveRunId''],'''')}'`), { runAfter: after('Stamps') });
  A.Verify_run_record = fn('attestRows', { op: 'verify', frame: 'runrec-v1', record: "@first(body('Run_record')?['value'])" }, afterAny('Run_record'));
  A.Membership = op('membership', {
    targetLocation: "@if(empty(body('Target_live')?['value']),'archive','live')",
    tombstoneTransactionId: "@coalesce(first(body('Belt_tombstone')?['value'])?['TransactionId'],'')",
    target: {
      archiveRunId: "@coalesce(first(body('Target_archive')?['value'])?['ArchiveRunId'],'')",
      snapshotVersion: "@coalesce(first(body('Target_archive')?['value'])?['SnapshotVersion'],'')",
    },
    runRecord: {
      RunId: "@coalesce(first(body('Run_record')?['value'])?['RunId'],'')",
      SnapshotVersion: "@coalesce(first(body('Run_record')?['value'])?['SnapshotVersion'],'')",
      TombstoneIds: "@json(coalesce(first(body('Run_record')?['value'])?['TombstoneIds'],'[]'))",
      recordSigValid: "@coalesce(body('Verify_run_record')?['ok'],false)",
    },
  }, afterAny('Verify_run_record'));

  A.Delta = op('delta', {
    cell: "@body('Mode_gate')?['cell']",
    targetLocation: "@if(empty(body('Target_live')?['value']),'archive','live')",
    target: "@body('Target_line')?['econRow']",
    newOutput: "@body('Stamps')?['newOutput']",
    prevOutput: "@body('Mode_gate')?['prevOutput']",
    originalTarget: "@body('Mode_gate')?['originalTarget']",
    membership: "@body('Membership')",
  }, after('Membership'));

  A.Candidate = op('candidate', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    opId: "@coalesce(triggerBody()?['intent']?['opId'],'')",
    target: "@coalesce(triggerBody()?['intent']?['targetTransactionId'],'')",
    revision: "@coalesce(first(body('Registry_lookup')?['value'])?['Revision'],0)",
    candidateVersion: "@add(int(coalesce(json(variables('snapData'))?['version'],0)),1)",
    adoptions: "@body('Mode_gate')?['adoptions']",
  }, after('Delta'));

  A.Compute_gate = {
    type: 'If',
    expression: { and: [{ equals: ["@and(coalesce(body('Delta')?['ok'],false),coalesce(body('Candidate')?['ok'],false))", true] }] },
    runAfter: afterAny('Candidate'), actions: {},
    else: { actions: { Rollback_release_compute: releaseAction('Respond_compute'), Respond_compute: response(409, { ok: false, reason: "@coalesce(body('Delta')?['reason'],body('Candidate')?['reason'],'COMPUTE_REFUSED')" }, after('Rollback_release_compute')), Respond_compute_stop: terminate(after('Respond_compute')) } },
  };

  // ── P5: journal + candidate (publishes NOTHING) ──────────────────────────────────────────────────
  A.Journal_create = spCreate(item(L.journal, ''), {
    OpId: "@{coalesce(triggerBody()?['intent']?['opId'],'')}",
    JournalId: "@{body('Candidate')?['journalId']}",
    Mode: "@{coalesce(triggerBody()?['intent']?['mode'],'')}",
    Target: tgt,
    ActorUsername: "@{coalesce(triggerBody()?['actorUsername'],'')}",
    State: 'pending',
    Digest: "@{body('Digest')?['digest']}",
    StepSetDigest: "@{body('Step_digest')?['digest']}",
    CandidateVersion: "@{body('Candidate')?['candidateVersion']}",
    CandidateHeads: "@{string(body('Candidate')?['candidateHeads'])}",
    AdoptionDecisions: "@{string(body('Candidate')?['adoptionDecisions'])}",
    Payload: "@{string(triggerBody()?['intent'])}",
    HeartbeatAt: '@{utcNow()}',
  }, after('Compute_gate'));

  A.Reserve = spCreate(item(L.registry, ''), {
    TargetTransactionId: tgt,
    State: 'pending',
    Owner: "@{workflow()?['run']?['name']}",
    OpId: "@{coalesce(triggerBody()?['intent']?['opId'],'')}",
    JournalId: "@{body('Candidate')?['journalId']}",
    TtlAt: '@{addMinutes(utcNow(),10)}',
    Origin: 'director',
  }, after('Journal_create'));

  A.Candidate_row = spCreate(item("@{if(empty(body('Target_live')?['value']),'" + L.archive + "','" + L.live + "')}", ''), "@body('Candidate')?['row']", after('Reserve'));
  A.Sign_ctl = fn('attestRows', { op: 'sign', frame: 'ctl-v1', record: "@body('Candidate')?['row']" }, after('Candidate_row'));
  A.Stamp_ctl_sig = spMerge(
    item("@{if(empty(body('Target_live')?['value']),'" + L.archive + "','" + L.live + "')}", "(@{body('Candidate_row')?['Id']})"),
    { EconSig: "@{body('Sign_ctl')?['signature']}" },
    "@{body('Candidate_row')?['@odata.etag']}",
    after('Sign_ctl'));

  // Verify: the seal is minted FROM THE INTENT, and the re-read row is compared to that intent.
  A.Reread_candidate = sp(item("@{if(empty(body('Target_live')?['value']),'" + L.archive + "','" + L.live + "')}", "(@{body('Candidate_row')?['Id']})"), { runAfter: after('Stamp_ctl_sig') });
  A.Rows_equal = op('ctlRowsEqual', { a: "@body('Candidate')?['row']", b: "@body('Reread_candidate')" }, after('Reread_candidate'));
  A.Steps_recheck = sp(item(L.steps, `?$top=200&$orderby=Id asc&$filter=RecordId eq '@{coalesce(first(coalesce(body(''Target_live'')?[''value''],body(''Target_archive'')?[''value'']))?[''TransferId''],'''')}'`), { runAfter: after('Rows_equal') });
  A.Steps_redigest = op('stepSetDigest', { steps: "@coalesce(body('Steps_recheck')?['value'],json('[]'))" }, after('Steps_recheck'));
  A.Verify_gate = {
    type: 'If',
    expression: {
      and: [
        { equals: ["@coalesce(body('Rows_equal')?['equal'],false)", true] },
        { equals: ["@coalesce(body('Steps_redigest')?['digest'],'x')", "@coalesce(body('Step_digest')?['digest'],'y')"] },
      ],
    },
    runAfter: after('Steps_redigest'), actions: {},
    else: { actions: { Rollback_release_verify: releaseAction('Respond_verify'), Respond_verify: response(409, { ok: false, reason: 'CANDIDATE_VERIFY_FAILED' }, after('Rollback_release_verify')), Respond_verify_stop: terminate(after('Respond_verify')) } },
  };

  // ── P6: THE PUBLISH (irrevocable) ────────────────────────────────────────────────────────────────
  A.Final_restamp = spMerge(
    item(L.config, "(@{first(body('Get_archive_state')?['value'])?['Id']})"),
    { ConfigData: "@{string(setProperty(json(coalesce(first(body('Get_archive_state')?['value'])?['ConfigData'],'{}')),'heartbeatAt',utcNow()))}" },
    "@{outputs('Acquire')?['headers']?['ETag']}",
    after('Verify_gate'));

  // op:assembleSnapshot returns the EXACT serialized ConfigData — the LA does NO arithmetic.
  A.Assemble = op('assembleSnapshot', {
    snapshotConfigData: "@variables('snapData')",
    candidateVersion: "@body('Candidate')?['candidateVersion']",
    deltas: "@body('Delta')?['deltas']",
    candidateHeads: "@body('Candidate')?['candidateHeads']",
  }, after('Final_restamp'));

  // ONE MERGE, with the P2-CAPTURED ETag — never a re-read (C2-R1-1).
  A.Publish = spMerge(
    item(L.config, "(@{variables('snapItemId')})"),
    { ConfigData: "@{body('Assemble')?['configData']}" },
    "@{variables('snapEtag')}",
    after('Assemble'));

  A.Outcome_by_read = sp(item(L.config, `?$select=Id,ConfigData&$filter=ConfigType eq 'stock_snapshot'`), { runAfter: afterAny('Publish') });
  A.Recovery_decision = op('recoveryDecision', {
    candidateHeads: "@body('Candidate')?['candidateHeads']",
    manifest: "@json(coalesce(first(body('Outcome_by_read')?['value'])?['ConfigData'],'{}'))?['controlManifest']",
    candidateVersion: "@body('Candidate')?['candidateVersion']",
    observedVersion: "@json(coalesce(first(body('Outcome_by_read')?['value'])?['ConfigData'],'{}'))?['version']",
  }, after('Outcome_by_read'));

  A.Published_gate = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Recovery_decision')?['decision'],'')", 'committed'] }] },
    runAfter: after('Recovery_decision'),
    actions: {},   // P7 hangs off this branch
    else: { actions: { Respond_held: response(202, { ok: false, reason: 'PUBLICATION_HELD_FOR_RECONCILE' }), Respond_held_stop: terminate(after('Respond_held')) } },
  };

  // ── P7: terminal ─────────────────────────────────────────────────────────────────────────────────
  A.Registry_terminal = spMerge(
    item(L.registry, "(@{body('Reserve')?['Id']})"),
    {
      State: 'committed',
      ControlId: "@{coalesce(body('Candidate')?['headControlId'],'')}",
      Revision: "@{body('Candidate')?['revision']}",
      PublicationVersion: "@{body('Candidate')?['candidateVersion']}",
    },
    "@{body('Reserve')?['@odata.etag']}",
    after('Published_gate'));

  A.Journal_complete = spMerge(
    item(L.journal, "(@{body('Journal_create')?['Id']})"),
    {
      State: 'complete',
      StoredResult: "@{string(json(concat('{\"ok\":true,\"controlId\":\"',coalesce(body('Candidate')?['headControlId'],''),'\",\"revision\":',string(body('Candidate')?['revision']),',\"publicationVersion\":',string(body('Candidate')?['candidateVersion']),',\"deviceConvergencePending\":',if(equals(coalesce(triggerBody()?['intent']?['mode'],''),'adopt'),'false','true'),',\"affectedTarget\":\"',coalesce(triggerBody()?['intent']?['targetTransactionId'],''),'\"}')))}",
    },
    "@{body('Journal_create')?['@odata.etag']}",
    after('Registry_terminal'));

  A.Conditional_release = releaseAction(null, after('Journal_complete'));
  A.Respond_ok = response(200, {
    ok: true,
    controlId: "@coalesce(body('Candidate')?['headControlId'],'')",
    revision: "@body('Candidate')?['revision']",
    publicationVersion: "@body('Candidate')?['candidateVersion']",
    deviceConvergencePending: "@not(equals(coalesce(triggerBody()?['intent']?['mode'],''),'adopt'))",
    affectedTarget: "@coalesce(triggerBody()?['intent']?['targetTransactionId'],'')",
  }, after('Conditional_release'));

  return A;

  // Conditional release: ETag + content-conditional, asserting the state is still OURS (C2-R1-2).
  function releaseAction(_unused, runAfter) {
    return spMerge(
      item(L.config, "(@{first(body('Get_archive_state')?['value'])?['Id']})"),
      { ConfigData: "@{string(setProperty(setProperty(setProperty(json(coalesce(first(body('Get_archive_state')?['value'])?['ConfigData'],'{}')),'state','idle'),'opId',''),'owner',''))}" },
      "@{outputs('Acquire')?['headers']?['ETag']}",
      runAfter || {});
  }
}

const def = {
  $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  contentVersion: '1.0.0.0',
  parameters: { $connections: { defaultValue: {}, type: 'Object' } },
  triggers: {
    manual: {
      type: 'Request',
      kind: 'Http',
      inputs: { method: 'POST', schema: { type: 'object', properties: {} } },
      runtimeConfiguration: { secureData: { properties: ['inputs'] } },
    },
  },
  actions: build(),
  outputs: {},
};

const out = process.argv[2] || path.join(__dirname, 'correction-def-generated.json');
const json = JSON.stringify(def, null, 2);
if (json.includes('code=') && !json.includes(KEY)) { console.error('ABORT: a function key leaked into the definition'); process.exit(1); }
fs.writeFileSync(out, json);
const count = (o) => Object.keys(o).length;
console.log(`WROTE ${out}`);
console.log(`  actions: ${count(def.actions)} top-level`);
console.log(`  fn-key placeholders: ${(json.match(/@@FN_KEY@@/g) || []).length} (all substituted at apply time)`);
console.log(`  IF-MATCH:* occurrences: ${(json.match(/"IF-MATCH":\s*"\*"/g) || []).length} (must be 0 — C2-R1-2)`);
