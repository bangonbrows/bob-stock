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
// afterAny: MUST include TimedOut. A Function cold start exceeding the connector timeout ends the
// action as 'TimedOut', not 'Failed' -- a gate that omits it is skipped, the refusal branch never
// fires, and the caller is left hanging with no HTTP response.
const afterAny = (deps) => {
  const r = {};
  for (const d of [].concat(deps || [])) r[d] = ['Succeeded', 'Failed', 'TimedOut'];
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
// ⚠ THE ENVELOPE IS `{op, input:{...}}`, NOT flat. Every entry in correctionCompute's OPS table is
// `(b) => f(b.input || {})`, so a flat body delivers `{}` to the function and every op silently
// refuses or returns a degenerate answer. The first generated definition got this wrong on all 16
// calls; check-fn-contracts.js now fails the build on it.
const op = (name, inputs, runAfter) => fn('correctionCompute', { op: name, input: inputs }, runAfter);

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
  // validateKeys v2 does the PAIRING itself: the LA reads StoreCredentials over the secured
  // connection and hands the rows in, so no hash material is ever computed in the workflow.
  // Contract (validateKeys.js): {claimedStoreId, storeKey, directorKey, rows} -> {storeOk, directorOk}.
  // There is no `ok`; the first cut invented one and rejected every request.
  A.Read_creds = sp(item('StoreCredentials_Staging', `?$select=StoreId,Salt,SecretHash,Version,GraceUntil,Active&$filter=Active eq 1 and (StoreId eq '__director')`));
  A.Gate_keys = fn('validateKeys', {
    claimedStoreId: '__director',
    storeKey: "@coalesce(triggerBody()?['auth']?['storeKey'],'')",
    directorKey: "@coalesce(triggerBody()?['auth']?['directorKey'],'')",
    rows: "@coalesce(body('Read_creds')?['value'],json('[]'))",
  }, afterAny('Read_creds'));
  A.Keys_ok = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Gate_keys')?['directorOk'],false)", true] }] },
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

  // Gate_role: the role must be director. Judge off the ROLE THE FUNCTION RETURNS, not the row —
  // verifyProof deliberately returns the CURRENT row's role rather than the role signed into the
  // proof (a proof self-certifies its role; a demotion that didn't bump TokenVersion would
  // otherwise still assert the old one).
  // NO TokenVersion comparison here: verifyProof does not return `tokenVersion`, and it ALREADY
  // enforces the check internally (validateUser.js — a password reset bumps TokenVersion and kills
  // every outstanding proof). The first cut compared against a property that never exists, so it
  // rejected every valid director.
  A.Gate_role = {
    type: 'If',
    expression: {
      and: [
        { equals: ["@coalesce(body('Gate_proof')?['ok'],false)", true] },
        { equals: ["@toLower(coalesce(body('Gate_proof')?['role'],''))", 'director'] },
      ],
    },
    runAfter: afterAny('Gate_proof'),
    actions: {},
    else: { actions: { Reject_role: response(403, { ok: false, reason: 'FORBIDDEN' }), Reject_role_stop: terminate(after('Reject_role')) } },
  };

  // ── P1: idempotency BEFORE any CAS ───────────────────────────────────────────────────────────────
  A.Digest = op('digest', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    // opDigest reads `targetTransactionId` — the first cut sent it as `target`, so EVERY digest
    // hashed null in the target position and all opIds collided, silently voiding the reuse guard.
    targetTransactionId: "@coalesce(triggerBody()?['intent']?['targetTransactionId'],'')",
    expected: "@triggerBody()?['intent']?['expected']",
    control: "@triggerBody()?['intent']?['control']",
    actorUsername: "@coalesce(triggerBody()?['actorUsername'],'')",
  }, after('Gate_role'));

  A.Journal_lookup = sp(item(L.journal, `?$select=Id,OpId,JournalId,Mode,Target,State,Digest,StoredResult,CandidateHeads,AdoptionDecisions,CandidateVersion,HeartbeatAt&$filter=OpId eq '@{coalesce(triggerBody()?[''intent'']?[''opId''],'''')}'`), { runAfter: after('Digest') });

  // Terminal + digest match => REPLAY StoredResult (incl. the C2-R8-1 convergence fields).
  // Terminal + digest MISMATCH => OPID_REUSED. Non-terminal own => reconcile.
  A.Journal_branch = {
    type: 'Switch',
    expression: "@if(empty(body('Journal_lookup')?['value']),'none',if(contains(json('[\"complete\",\"rolled_back\",\"needs_manual\"]'),coalesce(if(empty(body('Journal_lookup')?['value']), null, first(body('Journal_lookup')?['value']))?['State'],'')),if(equals(coalesce(if(empty(body('Journal_lookup')?['value']), null, first(body('Journal_lookup')?['value']))?['Digest'],''),coalesce(body('Digest')?['digest'],'')),'replay','reused'),'reconcile'))",
    runAfter: after('Journal_lookup'),
    cases: {
      Replay: { case: 'replay', actions: { Respond_replay: response(200, "@json(coalesce(if(empty(body('Journal_lookup')?['value']), null, first(body('Journal_lookup')?['value']))?['StoredResult'],'{}'))"), Respond_replay_stop: terminate(after('Respond_replay')) } },
      Reused: { case: 'reused', actions: { Respond_reused: refuse('OPID_REUSED', 409), Respond_reused_stop: terminate(after('Respond_reused')) } },
      Reconcile: { case: 'reconcile', actions: { Respond_reconcile: response(202, { ok: false, reason: 'RECOVERY_REQUIRED', detail: 'a non-terminal journal for this opId exists; the B-R reconcile sub-flow owns it' }), Respond_reconcile_stop: terminate(after('Respond_reconcile')) } },
    },
    default: { actions: {} },   // 'none' => proceed to P2
  };

  // ── P2: acquire + capture (the P6 ETag is captured HERE and never re-read, C2-R1-1) ──────────────
  A.Reconcile_prepass = sp(item(L.journal, `?$select=Id,OpId,State,HeartbeatAt&$filter=State ne 'complete' and State ne 'rolled_back' and State ne 'needs_manual'`), { runAfter: after('Journal_branch') });
  // ⚠ WDL HAS NO `filter()` AND NO LAMBDAS. The first cut wrote
  // `filter(array, item => ...)`, which is JavaScript — the expression parser rejects it, so the
  // definition fails validation or evaluation. Array filtering is a QUERY ACTION using `item()`.
  A.Filter_foreign_prepass = {
    type: 'Query',
    inputs: {
      from: "@coalesce(body('Reconcile_prepass')?['value'], json('[]'))",
      where: "@and(not(equals(item()?['OpId'], coalesce(triggerBody()?['intent']?['opId'],''))), greater(coalesce(item()?['HeartbeatAt'],''), addMinutes(utcNow(), -10)))",
    },
    runAfter: after('Reconcile_prepass'),
  };
  A.Prepass_gate = {
    type: 'If',
    // any FRESH foreign non-terminal journal (heartbeat within T-1 = 10 min) => 409 busy.
    expression: { and: [{ equals: ["@length(body('Filter_foreign_prepass'))", 0] }] },
    runAfter: after('Filter_foreign_prepass'),
    actions: {},
    else: { actions: { Respond_busy: refuse('BUSY_FOREIGN_CORRECTION', 409), Respond_busy_stop: terminate(after('Respond_busy')) } },
  };

  A.Get_archive_state = sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'archive_state'`), { runAfter: after('Prepass_gate') });
  A.Acquire = spMerge(
    item(L.config, "(@{if(empty(body('Get_archive_state')?['value']), null, first(body('Get_archive_state')?['value']))?['Id']})"),
    { ConfigData: "@{string(setProperty(setProperty(setProperty(setProperty(json(coalesce(if(empty(body('Get_archive_state')?['value']), null, first(body('Get_archive_state')?['value']))?['ConfigData'],'{}')),'state','correction_active'),'opId',coalesce(triggerBody()?['intent']?['opId'],'')),'owner',workflow()?['run']?['name']),'heartbeatAt',utcNow()))}" },
    "@{if(empty(body('Get_archive_state')?['value']), null, first(body('Get_archive_state')?['value']))?['odata.etag']}",
    after('Get_archive_state'));
  A.Acquire_ok = {
    type: 'If',
    expression: { and: [{ less: ["@int(coalesce(outputs('Acquire')?['statusCode'],500))", 300] }] },
    runAfter: afterAny('Acquire'), actions: {},
    else: { actions: { Respond_acquire_conflict: refuse('COORDINATION_CONFLICT', 409), Respond_acquire_conflict_stop: terminate(after('Respond_acquire_conflict')) } },
  };

  // Capture_snapshot — BOTH the ETag and the ConfigData go into variables NOW; P6 uses ONLY these.
  A.Capture_snapshot = sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'stock_snapshot'`), { runAfter: after('Acquire_ok') });
  A.Set_snapshot_etag = { type: 'InitializeVariable', inputs: { variables: [{ name: 'snapEtag', type: 'string', value: "@{if(empty(body('Capture_snapshot')?['value']), null, first(body('Capture_snapshot')?['value']))?['odata.etag']}" }] }, runAfter: after('Capture_snapshot') };
  A.Set_snapshot_data = { type: 'InitializeVariable', inputs: { variables: [{ name: 'snapData', type: 'string', value: "@{coalesce(if(empty(body('Capture_snapshot')?['value']), null, first(body('Capture_snapshot')?['value']))?['ConfigData'],'{}')}" }] }, runAfter: after('Set_snapshot_etag') };
  A.Set_snapshot_id = { type: 'InitializeVariable', inputs: { variables: [{ name: 'snapItemId', type: 'string', value: "@{if(empty(body('Capture_snapshot')?['value']), null, first(body('Capture_snapshot')?['value']))?['Id']}" }] }, runAfter: after('Set_snapshot_data') };

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
  A.Verify_epoch = fn('attestRows', { op: 'verify', frame: 'epoch-v1', rows: [{ obj: "@json(coalesce(if(empty(body('Get_seal_epoch')?['value']), null, first(body('Get_seal_epoch')?['value']))?['ConfigData'],'{}'))", sig: "@coalesce(json(coalesce(if(empty(body('Get_seal_epoch')?['value']), null, first(body('Get_seal_epoch')?['value']))?['ConfigData'],'{}'))?['EpochSig'],'')" }] }, afterAny('Verify_target_row'));
  A.Seal_threeway = op('targetSeal', {
    econSigPresent: "@not(empty(coalesce(first(coalesce(body('Target_live')?['value'],body('Target_archive')?['value']))?['EconSig'],'')))",
    verifyOk: "@coalesce(if(empty(body('Verify_target_row')?['results']), null, first(body('Verify_target_row')?['results']))?['ok'],false)",
    provenanceId: "@coalesce(if(empty(body('Target_live')?['value']), null, first(body('Target_live')?['value']))?['Id'],if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value']))?['SourceId'],'')",
    // targetSeal reads input.epoch.epochSigValid -- a NESTED field. Sending epochPresent/epochSigValid
    // at the TOP level left it undefined, so a well-sealed epoch returned EPOCH_TAMPERED. A null epoch
    // is how the function distinguishes EPOCH_UNDEFINED from EPOCH_TAMPERED, so absence stays null.
    epoch: "@if(empty(body('Get_seal_epoch')?['value']), null, setProperty(json(coalesce(first(body('Get_seal_epoch')?['value'])?['ConfigData'],'{}')), 'epochSigValid', coalesce(if(empty(body('Verify_epoch')?['results']), null, first(body('Verify_epoch')?['results'])), false)))",
  }, afterAny('Verify_epoch'));
  A.Seal_gate = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Seal_threeway')?['ok'],false)", true] }] },
    runAfter: after('Seal_threeway'), actions: {},
    else: { actions: { Respond_seal: response(409, { ok: false, reason: "@coalesce(body('Seal_threeway')?['reason'],'TARGET_SEAL_BROKEN')" }), Respond_seal_stop: terminate(after('Respond_seal')) } },
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
    registryItem: "@if(empty(body('Registry_lookup')?['value']), null, first(body('Registry_lookup')?['value']))",
    beltTombstone: "@if(empty(body('Belt_tombstone')?['value']), null, first(body('Belt_tombstone')?['value']))",
    retireEvidence: "@triggerBody()?['intent']?['retireEvidence']",
  }, after('Belt_tombstone'));
  A.Mode_gate_ok = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Mode_gate')?['ok'],false)", true] }] },
    runAfter: after('Mode_gate'), actions: {},
    else: { actions: { Respond_mode: response(409, { ok: false, reason: "@coalesce(body('Mode_gate')?['reason'],'MODE_REFUSED')" }), Respond_mode_stop: terminate(after('Respond_mode')) } },
  };

  // ── P4: compute — every decision via correctionCompute ───────────────────────────────────────────
  // The LA fetches EXACTLY the rows modeGate named in `needs` — it does not decide which.
  A.Fetch_prior_control = sp(item("@{if(empty(body('Target_live')?['value']),'StockTransactions_Archive_Staging','StockTransactions_Staging')}", "?$top=2&$filter=ControlId eq '@{coalesce(if(empty(body('Registry_lookup')?['value']), null, first(body('Registry_lookup')?['value']))?['ControlId'],'~none~')}'"), { runAfter: after('Mode_gate_ok') });
  A.Delta_cell = op('deltaCell', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    baseline: "@coalesce(body('Mode_gate')?['baseline'],'no-head')",
    controlType: "@coalesce(triggerBody()?['intent']?['control']?['controlType'],'replacement')",
    priorControlType: "@if(empty(body('Fetch_prior_control')?['value']), null, first(body('Fetch_prior_control')?['value']))?['ControlType']",
  }, after('Fetch_prior_control'));

  A.Target_line = op('targetLine', {
    target: "@first(coalesce(body('Target_live')?['value'],body('Target_archive')?['value']))",
    steps: "@coalesce(body('Steps_enumerate')?['value'],json('[]'))",
  }, after('Mode_gate_ok'));
  // mintStamps reads {target, replacement, steps} — it resolves tier (a) from the target row's own
  // stamps and tier (b) from the server steps projection. The first cut sent mode/control/targetLine,
  // none of which it reads, so every call fell through to STAMPS_UNRESOLVABLE.
  A.Stamps = op('stamps', {
    target: "@if(empty(body('Target_live')?['value']), if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value'])), if(empty(body('Target_live')?['value']), null, first(body('Target_live')?['value'])))",
    replacement: "@triggerBody()?['intent']?['control']?['replacement']",
    steps: "@coalesce(body('Steps_enumerate')?['value'],json('[]'))",
  }, after('Target_line'));

  // op:membership INPUT MAPPING — PINNED (§B 13a). Both target bindings are MANDATORY.
  A.Run_record = sp(item(L.runRecords, `?$top=2&$filter=RunId eq '@{coalesce(first(coalesce(body(''Target_live'')?[''value''],body(''Target_archive'')?[''value'']))?[''ArchiveRunId''],'''')}'`), { runAfter: after('Stamps') });
  A.Verify_run_record = fn('attestRows', { op: 'verify', frame: 'runrec-v1', rows: [{ obj: "@if(empty(body('Run_record')?['value']), null, first(body('Run_record')?['value']))", sig: "@coalesce(if(empty(body('Run_record')?['value']), null, first(body('Run_record')?['value']))?['RecordSig'],'')" }] }, afterAny('Run_record'));
  A.Membership = op('membership', {
    targetLocation: "@if(empty(body('Target_live')?['value']),'archive','live')",
    tombstoneTransactionId: "@coalesce(if(empty(body('Belt_tombstone')?['value']), null, first(body('Belt_tombstone')?['value']))?['TransactionId'],'')",
    target: {
      archiveRunId: "@coalesce(if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value']))?['ArchiveRunId'],'')",
      snapshotVersion: "@coalesce(if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value']))?['SnapshotVersion'],'')",
    },
    runRecord: {
      RunId: "@coalesce(if(empty(body('Run_record')?['value']), null, first(body('Run_record')?['value']))?['RunId'],'')",
      SnapshotVersion: "@coalesce(if(empty(body('Run_record')?['value']), null, first(body('Run_record')?['value']))?['SnapshotVersion'],'')",
      TombstoneIds: "@json(coalesce(if(empty(body('Run_record')?['value']), null, first(body('Run_record')?['value']))?['TombstoneIds'],'[]'))",
      recordSigValid: "@coalesce(if(empty(body('Verify_run_record')?['results']), null, first(body('Verify_run_record')?['results'])),false)",
    },
  }, afterAny('Verify_run_record'));

  A.Delta = op('delta', {
    cell: "@body('Delta_cell')?['cell']",
    targetLocation: "@if(empty(body('Target_live')?['value']),'archive','live')",
    target: "@body('Target_line')?['targetLine']",
    newOutput: "@triggerBody()?['intent']?['control']?['replacement']",
    prevOutput: "@if(empty(body('Fetch_prior_control')?['value']), null, first(body('Fetch_prior_control')?['value']))",
    originalTarget: "@if(empty(body('Target_live')?['value']), if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value'])), if(empty(body('Target_live')?['value']), null, first(body('Target_live')?['value'])))",
    membership: "@body('Membership')",
  }, after('Membership'));

  A.Candidate = op('candidate', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    opId: "@coalesce(triggerBody()?['intent']?['opId'],'')",
    target: "@coalesce(triggerBody()?['intent']?['targetTransactionId'],'')",
    revision: "@coalesce(if(empty(body('Registry_lookup')?['value']), null, first(body('Registry_lookup')?['value']))?['Revision'],0)",
    candidateVersion: "@add(int(coalesce(json(variables('snapData'))?['version'],0)),1)",
    adoptions: "@coalesce(triggerBody()?['intent']?['adoptions'],json('[]'))",
  }, after('Delta'));

  A.Compute_gate = {
    type: 'If',
    expression: { and: [{ equals: ["@and(coalesce(body('Delta')?['ok'],false),coalesce(body('Candidate')?['ok'],false))", true] }] },
    runAfter: afterAny('Candidate'), actions: {},
    else: { actions: { Respond_compute: response(409, { ok: false, reason: "@coalesce(body('Delta')?['reason'],body('Candidate')?['reason'],'COMPUTE_REFUSED')" }), Respond_compute_stop: terminate(after('Respond_compute')) } },
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
  A.Sign_ctl = fn('attestRows', { op: 'sign', frame: 'ctl-v1', rows: ["@body('Candidate')?['row']"] }, after('Candidate_row'));
  A.Stamp_ctl_sig = spMerge(
    item("@{if(empty(body('Target_live')?['value']),'" + L.archive + "','" + L.live + "')}", "(@{body('Candidate_row')?['Id']})"),
    { EconSig: "@{if(empty(body('Sign_ctl')?['sigs']), null, first(body('Sign_ctl')?['sigs']))}" },
    "@{body('Candidate_row')?['odata.etag']}",
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
    else: { actions: { Respond_verify: response(409, { ok: false, reason: 'CANDIDATE_VERIFY_FAILED' }), Respond_verify_stop: terminate(after('Respond_verify')) } },
  };

  // ── P6: THE PUBLISH (irrevocable) ────────────────────────────────────────────────────────────────
  // Re-read before the CAS: the pre-acquire body would write idle back over correction_active, and
  // a MERGE response carries no ETag to fence on.
  A.Reread_state_restamp = sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'archive_state'`), { runAfter: after('Verify_gate') });
  A.Final_restamp = spMerge(
    item(L.config, "(@{if(empty(body('Reread_state_restamp')?['value']), null, first(body('Reread_state_restamp')?['value']))?['Id']})"),
    { ConfigData: "@{string(setProperty(json(coalesce(if(empty(body('Reread_state_restamp')?['value']), null, first(body('Reread_state_restamp')?['value']))?['ConfigData'],'{}')),'heartbeatAt',utcNow()))}" },
    "@{if(empty(body('Reread_state_restamp')?['value']), null, first(body('Reread_state_restamp')?['value']))?['odata.etag']}",
    after('Reread_state_restamp'));

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
    activeManifest: "@json(coalesce(if(empty(body('Outcome_by_read')?['value']), null, first(body('Outcome_by_read')?['value']))?['ConfigData'],'{}'))",
    candidateVersion: "@body('Candidate')?['candidateVersion']",
    observedVersion: "@json(coalesce(if(empty(body('Outcome_by_read')?['value']), null, first(body('Outcome_by_read')?['value']))?['ConfigData'],'{}'))?['version']",
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
      ControlId: "@{coalesce(body('Candidate')?['controlId'],'')}",
      Revision: "@{body('Candidate')?['revision']}",
      PublicationVersion: "@{body('Candidate')?['candidateVersion']}",
    },
    "@{body('Reserve')?['odata.etag']}",
    after('Published_gate'));

  A.Journal_complete = spMerge(
    item(L.journal, "(@{body('Journal_create')?['Id']})"),
    {
      State: 'complete',
      StoredResult: "@{string(json(concat('{\"ok\":true,\"controlId\":\"',coalesce(body('Candidate')?['controlId'],''),'\",\"revision\":',string(body('Candidate')?['revision']),',\"publicationVersion\":',string(body('Candidate')?['candidateVersion']),',\"deviceConvergencePending\":',if(equals(coalesce(triggerBody()?['intent']?['mode'],''),'adopt'),'false','true'),',\"affectedTarget\":\"',coalesce(triggerBody()?['intent']?['targetTransactionId'],''),'\"}')))}",
    },
    "@{body('Journal_create')?['odata.etag']}",
    after('Registry_terminal'));

  Object.assign(A, releasePair('final', after('Journal_complete')).actions);
  A.Respond_ok = response(200, {
    ok: true,
    controlId: "@coalesce(body('Candidate')?['controlId'],'')",
    revision: "@body('Candidate')?['revision']",
    publicationVersion: "@body('Candidate')?['candidateVersion']",
    deviceConvergencePending: "@not(equals(coalesce(triggerBody()?['intent']?['mode'],''),'adopt'))",
    affectedTarget: "@coalesce(triggerBody()?['intent']?['targetTransactionId'],'')",
  }, after('Release_final'));

  return A;

  // Conditional release: ETag + content-conditional, asserting the state is still OURS (C2-R1-2).
  //
  // ⚠ TWO BUGS LIVED HERE, both found by the expression validator:
  //  1. It rebuilt ConfigData from the PRE-ACQUIRE `Get_archive_state` body — writing the old idle
  //     content back over `correction_active` and DROPPING opId and owner, immediately before the
  //     publish. The fence would have been released while we still believed we held it.
  //  2. It fenced on `outputs('Acquire')?['headers']?['ETag']`. A SharePoint MERGE answers 204 with
  //     no body and no usable ETag header, and Logic Apps lowercases header keys anyway — so the
  //     CAS was fencing on null, i.e. not fencing.
  // Both dissolve the same way: RE-READ the coordination record immediately before the CAS, and use
  // that read's `odata.etag` and its CURRENT content. The release additionally asserts the record is
  // still OURS by owner, so a displaced run cannot release a fence it no longer holds.
  //
  // Returns a PAIR of actions — the caller splices both into its scope.
  function releasePair(suffix, runAfter) {
    const readName = 'Reread_state_' + suffix;
    const mergeName = 'Release_' + suffix;
    const cur = `if(empty(body('${readName}')?['value']), null, first(body('${readName}')?['value']))`;
    return {
      readName, mergeName,
      actions: {
        [readName]: sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'archive_state'`), { runAfter: runAfter || {} }),
        [mergeName]: {
          type: 'If',
          // content-conditional: only release what we still own
          expression: { and: [{ equals: [`@coalesce(json(coalesce(${cur}?['ConfigData'],'{}'))?['owner'],'')`, "@workflow()?['run']?['name']"] }] },
          runAfter: after(readName),
          actions: {
            ['Do_' + mergeName]: spMerge(
              item(L.config, `(@{${cur}?['Id']})`),
              { ConfigData: `@{string(setProperty(setProperty(setProperty(json(coalesce(${cur}?['ConfigData'],'{}')),'state','idle'),'opId',''),'owner',''))}` },
              `@{${cur}?['odata.etag']}`,
              {}),
          },
          else: { actions: {} },   // not ours any more — a recoverer displaced us; leave it alone
        },
      },
    };
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
