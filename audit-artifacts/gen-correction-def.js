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
//
// ⚠ THIS DEFINITION IS NOT A COMPLETE §B IMPLEMENTATION. The known gaps — what is deliberately not
// built, what each one protects against, and its build/defer classification — are enumerated in
// AZURE-CHUNK-ORG-C2-LA-CHANGES.md §B-G, which is the single source of truth. The three local gates
// pass green with every one of them absent: NO GATE HERE DETECTS A MISSING §B STEP, so a green gate
// report must never be presented as evidence that §B is implemented.
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

// Variable helpers. InitializeVariable is a TOP-LEVEL-ONLY action in Logic Apps — it cannot be
// created inside a Scope / Condition / Foreach — so DECLARATION and ASSIGNMENT are separate
// builders: declare at the top level with initVar(), assign in place with setVar().
const initVar = (name, value, runAfter) => ({ type: 'InitializeVariable', inputs: { variables: [{ name, type: 'string', value }] }, runAfter: runAfter || {} });
const setVar = (name, value, runAfter) => ({ type: 'SetVariable', inputs: { name, value }, runAfter: runAfter || {} });

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
  // afterAny, not after: once a releasePair is spliced in as the preamble (releasingRefusal), a
  // FAILED coordination re-read would otherwise skip the release gate, which would skip the
  // Response and the Terminate — reintroducing the very hang this file exists to prevent.
  b[name] = response(statusCode, body, last ? afterAny(last) : {});
  b[name + '_stop'] = terminate(after(name));
  return b;
}
const refuse = (reason, statusCode, runAfter) => response(statusCode || 400, { ok: false, reason }, runAfter);

// ── the definition ─────────────────────────────────────────────────────────────────────────────────
function build() {
  const A = {};
  const item = (list, filterOrId) => `_api/web/lists/getbytitle('${list}')/items${filterOrId}`;

  // A POST-ACQUIRE refusal terminal. Releasing the coordination fence is NOT optional here: the
  // refusal Terminates the run, so the scope-level abort handler never gets to run. The release is
  // ownership-conditional, so splicing it in front of a refusal that may not hold the fence is a
  // harmless no-op. Mirrors the DEPLOYED archive LA, which puts Release_<x> -> Respond_<x> in every
  // refusal branch. `runAfter` orders the re-read when the refusal is not the first thing in its
  // branch (the lazy-adoption lane re-reads only after the re-run has answered).
  function releasingRefusal(suffix, name, statusCode, body, runAfter) {
    const p = releasePair(suffix, runAfter || {});
    return refusalBranch(name, statusCode, body, { actions: p.actions, last: p.mergeName });
  }

  // ── P0: triple gate (mirrors the archive LA verbatim, purpose swapped to 'correction', N8) ───────
  // validateKeys v2 does the PAIRING itself: the LA reads StoreCredentials over the secured
  // connection and hands the rows in, so no hash material is ever computed in the workflow.
  // Contract (validateKeys.js): {claimedStoreId, storeKey, directorKey, rows} -> {storeOk, directorOk}.
  // There is no `ok`; the first cut invented one and rejected every request.
  // THE CLAIMED STORE IS THE PRESENTED ONE. `claimedStoreId:'__director'` was a hard-coded lie:
  // validateKeys.evaluate matches the '__director' row on its FIRST branch (validateKeys.js:64), so
  // the store branch was unreachable, `storeOk` was structurally always false, and the presented
  // auth.storeId / auth.deviceId bound to nothing at all — the device half of the triple gate was
  // decorative. The store row must also be READ or the pairing has nothing to verify against. The
  // interpolated storeId is OData-escaped (apostrophe doubled): an unescaped value terminates the
  // literal early and injects the filter. Keys_ok still requires ONLY directorOk — see the design
  // note before tightening it.
  const storeIdQ = "@{replace(coalesce(triggerBody()?['auth']?['storeId'],''),'''','''''')}";
  A.Read_creds = sp(item('StoreCredentials_Staging', `?$select=StoreId,Salt,SecretHash,Version,GraceUntil,Active&$filter=Active eq 1 and (StoreId eq '${storeIdQ}' or StoreId eq '__director')`));
  A.Gate_keys = fn('validateKeys', {
    claimedStoreId: "@coalesce(triggerBody()?['auth']?['storeId'],'')",
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

  // `@{...}` is EXPRESSION context, NOT a WDL string literal, so the apostrophes inside it must not
  // be doubled: `triggerBody()?[''actorUsername'']` parses as an empty string followed by a bare
  // token (and `''''` is the one-character string "'", not the empty-string default). The action
  // never evaluated, so Gate_proof verified every proof against ZERO rows and P0 was dead for EVERY
  // caller. The doubling belongs to the VALUE, which lands inside the OData literal — via replace().
  A.Read_actor = sp(item(L.users, `?$select=Id,Username,Role,TokenVersion,Active&$filter=Active eq 1 and Username eq '@{replace(coalesce(triggerBody()?['actorUsername'],''),'''','''''')}'`), { runAfter: after('Keys_ok') });
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
  // §B P0 pins THREE distinguishable outcomes and the combined gate collapsed two of them: a bad
  // key is 401, an invalid/expired/wrong-purpose/wrong-device PROOF is 401, and only a VERIFIED
  // person holding the wrong role is 403. Answering 403 to a failed proof tells the client "you are
  // not allowed" when the truth is "you are not authenticated" — so it stops instead of re-minting
  // the one thing that would fix it. Both branches stay FAIL-CLOSED: a Function failure/timeout
  // leaves body('Gate_proof') null, coalesce yields false, and the 401 branch fires.
  A.Proof_ok = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Gate_proof')?['ok'],false)", true] }] },
    runAfter: afterAny('Gate_proof'),
    actions: {},
    else: { actions: { Reject_proof: response(401, { ok: false, reason: 'PROOF_INVALID' }), Reject_proof_stop: terminate(after('Reject_proof')) } },
  };
  A.Gate_role = {
    type: 'If',
    expression: { and: [{ equals: ["@toLower(coalesce(body('Gate_proof')?['role'],''))", 'director'] }] },
    runAfter: after('Proof_ok'),
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

  A.Journal_lookup = sp(item(L.journal, `?$select=Id,OpId,JournalId,Mode,Target,State,Digest,StoredResult,CandidateHeads,AdoptionDecisions,CandidateVersion,HeartbeatAt&$filter=OpId eq '@{replace(coalesce(triggerBody()?['intent']?['opId'],''),'''','''''')}'`), { runAfter: after('Digest') });

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
  // The CAS alone cannot express "only if idle": an ETag match proves only that nobody has written
  // the record since our READ — it says nothing about WHICH state we read. A healthy run_active run
  // or a fresh foreign correction_active lease has a stable ETag, so the MERGE succeeds and stomps a
  // lock we do not hold. §3 pins that ONLY `idle` is acquirable for work; the gate asserts that on
  // the read and the IF-MATCH closes the read->write race. Reading a state is I/O sequencing, not a
  // policy decision, so it stays in the workflow (F1); the FAIRNESS request flags are NOT decided
  // here — see the coordinationAcquire design note.
  A.State_idle_gate = {
    type: 'If',
    expression: { and: [{ equals: ["@toLower(coalesce(json(coalesce(if(empty(body('Get_archive_state')?['value']), null, first(body('Get_archive_state')?['value']))?['ConfigData'],'{}'))?['state'],''))", 'idle'] }] },
    runAfter: afterAny('Get_archive_state'),
    actions: {},
    else: { actions: { Respond_state_busy: refuse('COORDINATION_BUSY', 409), Respond_state_busy_stop: terminate(after('Respond_state_busy')) } },
  };
  A.Acquire = spMerge(
    item(L.config, "(@{if(empty(body('Get_archive_state')?['value']), null, first(body('Get_archive_state')?['value']))?['Id']})"),
    { ConfigData: "@{string(setProperty(setProperty(setProperty(setProperty(json(coalesce(if(empty(body('Get_archive_state')?['value']), null, first(body('Get_archive_state')?['value']))?['ConfigData'],'{}')),'state','correction_active'),'opId',coalesce(triggerBody()?['intent']?['opId'],'')),'owner',workflow()?['run']?['name']),'heartbeatAt',utcNow()))}" },
    "@{if(empty(body('Get_archive_state')?['value']), null, first(body('Get_archive_state')?['value']))?['odata.etag']}",
    after('State_idle_gate'));
  A.Acquire_ok = {
    type: 'If',
    expression: { and: [{ less: ["@int(coalesce(outputs('Acquire')?['statusCode'],500))", 300] }] },
    runAfter: afterAny('Acquire'), actions: {},
    else: { actions: releasingRefusal('acq', 'Respond_acquire_conflict', 409, { ok: false, reason: 'COORDINATION_CONFLICT' }) },
  };

  // Capture_snapshot — BOTH the ETag and the ConfigData go into variables NOW; P6 uses ONLY these.
  A.Capture_snapshot = sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'stock_snapshot'`), { runAfter: after('Acquire_ok') });
  A.Set_snapshot_etag = setVar('snapEtag', "@{if(empty(body('Capture_snapshot')?['value']), null, first(body('Capture_snapshot')?['value']))?['odata.etag']}", after('Capture_snapshot'));
  A.Set_snapshot_data = setVar('snapData', "@{coalesce(if(empty(body('Capture_snapshot')?['value']), null, first(body('Capture_snapshot')?['value']))?['ConfigData'],'{}')}", after('Set_snapshot_etag'));
  A.Set_snapshot_id = setVar('snapItemId', "@{if(empty(body('Capture_snapshot')?['value']), null, first(body('Capture_snapshot')?['value']))?['Id']}", after('Set_snapshot_data'));

  // ── P3: authoritative state ──────────────────────────────────────────────────────────────────────
  // SOURCE-FIRST Live -> Archive (C2-R17-2).
  const tgt = "@{coalesce(triggerBody()?['intent']?['targetTransactionId'],'')}";
  // THE SAME VALUE INSIDE AN ODATA STRING LITERAL. An apostrophe in the id closes the literal
  // early: the query 400s, or its tail is parsed as filter syntax. OData escapes a quote by
  // DOUBLING it, so every interpolated literal goes through replace(x, '''', ''''''). `tgt` stays
  // UNESCAPED for the journal/registry PAYLOADS — escaping those would store the doubled form.
  const tgtQ = "@{replace(coalesce(triggerBody()?['intent']?['targetTransactionId'],''),'''','''''')}";
  // SOURCE-FIRST target row, live else archive (C2-R17-2) — NEVER coalesce(): an EMPTY live array
  // is not null, so coalesce returns the empty live array and the ARCHIVE IS NEVER CONSULTED,
  // making every archived target invisible to the expression.
  const targetRow = "if(empty(body('Target_live')?['value']), if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value'])), if(empty(body('Target_live')?['value']), null, first(body('Target_live')?['value'])))";
  A.Target_live = sp(item(L.live, `?$top=2&$filter=TransactionId eq '${tgtQ}'`), { runAfter: after('Set_snapshot_id') });
  A.Target_archive = sp(item(L.archive, `?$top=2&$filter=TransactionId eq '${tgtQ}'`), { runAfter: after('Target_live') });
  A.Target_gate = {
    type: 'Switch',
    expression: "@if(and(empty(body('Target_live')?['value']),empty(body('Target_archive')?['value'])),'none',if(and(not(empty(body('Target_live')?['value'])),not(empty(body('Target_archive')?['value']))),'both','one'))",
    runAfter: after('Target_archive'),
    cases: {
      None: { case: 'none', actions: releasingRefusal('notarget', 'Respond_no_target', 404, { ok: false, reason: 'TARGET_NOT_FOUND' }) },
      Both: { case: 'both', actions: releasingRefusal('duptarget', 'Respond_dup_target', 409, { ok: false, reason: 'TARGET_DUPLICATED' }) },
    },
    default: { actions: {} },
  };

  // Three-way seal: econ-v1 on the row, epoch-v1 on the seal artifact, then op:targetSeal adjudicates.
  A.Get_seal_epoch = sp(item(L.config, `?$select=Id,ConfigData&$filter=ConfigType eq 'seal_epoch'`), { runAfter: after('Target_gate') });
  A.Verify_target_row = fn('attestRows', { op: 'verify', frame: 'econ-v1', rows: "@coalesce(union(coalesce(body('Target_live')?['value'],json('[]')),coalesce(body('Target_archive')?['value'],json('[]'))),json('[]'))" }, after('Get_seal_epoch'));
  A.Verify_epoch = fn('attestRows', { op: 'verify', frame: 'epoch-v1', rows: [{ obj: "@json(coalesce(if(empty(body('Get_seal_epoch')?['value']), null, first(body('Get_seal_epoch')?['value']))?['ConfigData'],'{}'))", sig: "@coalesce(json(coalesce(if(empty(body('Get_seal_epoch')?['value']), null, first(body('Get_seal_epoch')?['value']))?['ConfigData'],'{}'))?['EpochSig'],'')" }] }, afterAny('Verify_target_row'));
  A.Seal_threeway = op('targetSeal', {
    // source-first via targetRow: coalesce(live,archive) returned the EMPTY live array, so
    // econSigPresent was FALSE for every ARCHIVED target and targetSeal never consulted its seal.
    econSigPresent: `@not(empty(coalesce(${targetRow}?['EconSig'],'')))`,
    verifyOk: "@coalesce(if(empty(body('Verify_target_row')?['results']), null, first(body('Verify_target_row')?['results']))?['ok'],false)",
    provenanceId: "@coalesce(if(empty(body('Target_live')?['value']), null, first(body('Target_live')?['value']))?['Id'],if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value']))?['SourceId'],'')",
    // targetSeal reads input.epoch.epochSigValid -- a NESTED field. Sending epochPresent/epochSigValid
    // at the TOP level left it undefined, so a well-sealed epoch returned EPOCH_TAMPERED. A null epoch
    // is how the function distinguishes EPOCH_UNDEFINED from EPOCH_TAMPERED, so absence stays null.
    epoch: "@if(empty(body('Get_seal_epoch')?['value']), null, setProperty(json(coalesce(first(body('Get_seal_epoch')?['value'])?['ConfigData'],'{}')), 'epochSigValid', coalesce(if(empty(body('Verify_epoch')?['results']), null, first(body('Verify_epoch')?['results'])), false)))",
  }, afterAny('Verify_epoch'));
  A.Seal_gate = {
    type: 'If',
    // targetSeal returns { outcome: valid | unsealed-legacy | TARGET_SEAL_BROKEN | EPOCH_UNDEFINED |
    // EPOCH_TAMPERED } and NEVER an ok boolean. Testing .ok refused every valid target.
    // 'unsealed-legacy' is a legitimate pre-epoch row, so both passing outcomes proceed.
    expression: { and: [{ contains: ["@json('[\"valid\",\"unsealed-legacy\"]')", "@coalesce(body('Seal_threeway')?['outcome'],'')"] }] },
    runAfter: after('Seal_threeway'), actions: {},
    else: { actions: releasingRefusal('seal', 'Respond_seal', 409, { ok: false, reason: "@coalesce(body('Seal_threeway')?['outcome'],'TARGET_SEAL_BROKEN')" }) },
  };

  // Steps enumeration (transfer-linked targets only) — paged walk, then a digest.
  A.Steps_enumerate = sp(item(L.steps, `?$top=200&$orderby=Id asc&$filter=RecordId eq '@{replace(coalesce(${targetRow}?['TransferId'],''),'''','''''')}'`), { runAfter: after('Seal_gate') });
  A.Step_digest = op('stepSetDigest', { steps: "@coalesce(body('Steps_enumerate')?['value'],json('[]'))" }, after('Steps_enumerate'));

  // Mode gate — ALL legality lives in the compute op (C2-LA-1b).
  A.Registry_lookup = sp(item(L.registry, `?$top=2&$filter=TargetTransactionId eq '${tgtQ}'`), { runAfter: after('Step_digest') });
  // THE BELT — §B step 12 requires BOTH ledger lists. Querying only Live means an ARCHIVED
  // tombstone is invisible: modeGate sees beltTombstone=null, 'create' returns ok/'no-head', and a
  // second control publishes over an already-controlled target — the exact gap lazy adoption exists
  // to close, and the compensating control for the deliberate absence of registry backfill (H4).
  // The archive list RENAMES the econ columns (Type -> TxnType, archive-def-current.json:106), so
  // the live filter cannot be reused verbatim; TargetTransactionId / TransactionId are carried
  // across unchanged, so those two bind identically on both sides.
  // beltRow is source-first live->archive as nested if(empty()) — NOT coalesce, which returns the
  // EMPTY live array and never consults the archive.
  const beltRow = "if(empty(body('Belt_tombstone')?['value']), if(empty(body('Belt_tombstone_archive')?['value']), null, first(body('Belt_tombstone_archive')?['value'])), first(body('Belt_tombstone')?['value']))";
  A.Belt_tombstone = sp(item(L.live, `?$top=5&$filter=Type eq 'deleted' and TargetTransactionId eq '${tgtQ}'`), { runAfter: after('Registry_lookup') });
  A.Belt_tombstone_archive = sp(item(L.archive, `?$top=5&$filter=TxnType eq 'deleted' and TargetTransactionId eq '${tgtQ}'`), { runAfter: after('Belt_tombstone') });
  A.Mode_gate = op('modeGate', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    expected: "@triggerBody()?['intent']?['expected']",
    registryItem: "@if(empty(body('Registry_lookup')?['value']), null, first(body('Registry_lookup')?['value']))",
    beltTombstone: '@' + beltRow,
    // RETIREMENT EVIDENCE IS GATHERED, NEVER ASSERTED. Taking this from the request body let the
    // CALLER supply modeGate's own justification: `retireEvidence:{rowAbsentEverywhere:true}` walks
    // straight past the RETIRE_EVIDENCE_INSUFFICIENT interlock (correctionCompute.js:555-559) and
    // retires a live, materialised device tombstone claim — publishing the explicit-null head and
    // restoring the target's balance on evidence nobody checked. `sealOutcome` is the compute op's
    // OWN P3 verdict (op:targetSeal), so it is authoritative. The other two lanes are pinned FALSE
    // until the workflow gathers them (see the design decisions): fail-closed, so retire_claim
    // survives only on the 'unsealed-legacy' evidence the workflow itself observed.
    retireEvidence: {
      sealOutcome: "@coalesce(body('Seal_threeway')?['outcome'],'')",
      provenancePreEpoch: false,
      rowAbsentEverywhere: false,
    },
  }, after('Belt_tombstone_archive'));
  A.Mode_gate_ok = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Mode_gate')?['ok'],false)", true] }] },
    runAfter: after('Mode_gate'), actions: {},
    else: {
      actions: {
        // LAZY_ADOPTION_REQUIRED IS NOT A TERMINAL REFUSAL (§B step 12, design §4 C2-R1-4).
        // Refusing it left the tombstone permanently unregistered, so EVERY later correction on
        // that target — including the supersede the Director is told to use instead — hit the same
        // refusal forever: the target became uncorrectable, which is the defect lazy adoption was
        // added to fix. The LA REGISTERS the belt tombstone (committed, ControlId = the tombstone's
        // own TransactionId, Revision 0, Origin 'device-adopted', PublicationVersion ABSENT so it
        // reads as committed-UNADOPTED) and RE-RUNS the gate against the RE-READ registry item.
        // Registration is create-if-absent: TargetTransactionId is Enforce-Unique, so the race is
        // atomic and a 409 simply means someone else registered it — hence afterAny on the re-read
        // and the re-run judging off the read rather than off the write. The LA does NOT predict
        // the verdict; it echoes whatever modeGate returns (the F1 rule).
        // BOTH terminals hand the coordination fence back before they respond.
        Lazy_gate: {
          type: 'If',
          expression: { and: [{ equals: ["@coalesce(body('Mode_gate')?['reason'],'')", 'LAZY_ADOPTION_REQUIRED'] }] },
          runAfter: {},
          actions: Object.assign({
            Lazy_register: spCreate(item(L.registry, ''), {
              TargetTransactionId: tgt,
              State: 'committed',
              ControlId: `@{coalesce(${beltRow}?['TransactionId'],'')}`,
              Revision: 0,
              OpId: `@{coalesce(${beltRow}?['TransactionId'],'')}`,
              Origin: 'device-adopted',
            }, {}),
            Lazy_reread: sp(item(L.registry, `?$top=2&$filter=TargetTransactionId eq '${tgtQ}'`), { runAfter: afterAny('Lazy_register') }),
            Mode_gate_rerun: op('modeGate', {
              mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
              expected: "@triggerBody()?['intent']?['expected']",
              registryItem: "@if(empty(body('Lazy_reread')?['value']), null, first(body('Lazy_reread')?['value']))",
              beltTombstone: '@' + beltRow,
              retireEvidence: {
                sealOutcome: "@coalesce(body('Seal_threeway')?['outcome'],'')",
                provenancePreEpoch: false,
                rowAbsentEverywhere: false,
              },
            }, afterAny('Lazy_reread')),
          }, releasingRefusal('lazy', 'Respond_lazy', 409, { ok: false, reason: "@coalesce(body('Mode_gate_rerun')?['reason'],'MODE_REFUSED')" }, afterAny('Mode_gate_rerun'))),
          else: { actions: releasingRefusal('mode', 'Respond_mode', 409, { ok: false, reason: "@coalesce(body('Mode_gate')?['reason'],'MODE_REFUSED')" }) },
        },
      },
    },
  };

  // ── P4: compute — every decision via correctionCompute ───────────────────────────────────────────
  // ⚠ NOT TRUE YET — see §B-G. `body('Mode_gate')?['needs']` is read NOWHERE in this file; this
  // fetch is UNCONDITIONAL for every mode, with '~none~' as the no-match filter value. It is benign
  // today (a 'null-head' baseline matches nothing, prevOutput resolves null, and
  // deltaCell/computeDelta take the originalTarget lane — the correct arithmetic), but the previous
  // wording claimed an F1 property the definition does not implement. Honouring `needs` is pure I/O
  // sequencing, so it stays an LA change when it is built; the DECISION already lives in modeGate.
  A.Fetch_prior_control = sp(item("@{if(empty(body('Target_live')?['value']),'StockTransactions_Archive_Staging','StockTransactions_Staging')}", "?$top=2&$filter=ControlId eq '@{replace(coalesce(if(empty(body('Registry_lookup')?['value']), null, first(body('Registry_lookup')?['value']))?['ControlId'],'~none~'),'''','''''')}'"), { runAfter: after('Mode_gate_ok') });
  A.Delta_cell = op('deltaCell', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    baseline: "@coalesce(body('Mode_gate')?['baseline'],'no-head')",
    // §5 names this field `type`, not `controlType`. Reading the wrong name made the coalesce default
    // fire on EVERY request, so a `{type:'deletion'}` intent silently selected a REPLACEMENT cell.
    // The op INPUT is still named controlType — that is deltaCell's own flat parameter name, not a
    // contract field; only the SOURCE expression changes.
    controlType: "@coalesce(triggerBody()?['intent']?['control']?['type'],'replacement')",
    priorControlType: "@if(empty(body('Fetch_prior_control')?['value']), null, first(body('Fetch_prior_control')?['value']))?['ControlType']",
  }, after('Fetch_prior_control'));

  A.Target_line = op('targetLine', {
    // TWO defects lived in this one line. (1) SOURCE-FIRST selection written as coalesce(live,
    // archive) NEVER reaches the archive — an EMPTY array is not null — so every ARCHIVED target
    // was invisible and first([]) ran on an empty collection. (2) computeTargetLine reads
    // targetSealValid (correctionCompute.js:103) to decide whether a TRANSFERLESS target's own
    // stamps are trustworthy; omitting it made every transferless target behave as though its C1
    // seal had failed. The SharePoint -> engine COLUMN CASING is normalised inside the op
    // (toEngineRow) — a 25-field shape table is logic, and logic does not live in the workflow.
    target: `@${targetRow}`,
    steps: "@coalesce(body('Steps_enumerate')?['value'],json('[]'))",
    targetSealValid: "@coalesce(body('Seal_threeway')?['outcome'],'')",
  }, after('Mode_gate_ok'));
  // mintStamps reads {target, replacement, steps} — it resolves tier (a) from the target row's own
  // stamps and tier (b) from the server steps projection. The first cut sent mode/control/targetLine,
  // none of which it reads, so every call fell through to STAMPS_UNRESOLVABLE.
  A.Stamps = op('stamps', {
    target: "@if(empty(body('Target_live')?['value']), if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value'])), if(empty(body('Target_live')?['value']), null, first(body('Target_live')?['value'])))",
    replacement: "@triggerBody()?['intent']?['control']?['row']",
    steps: "@coalesce(body('Steps_enumerate')?['value'],json('[]'))",
  }, after('Target_line'));

  // op:membership INPUT MAPPING — PINNED (§B 13a). Both target bindings are MANDATORY.
  A.Run_record = sp(item(L.runRecords, `?$top=2&$filter=RunId eq '@{replace(coalesce(${targetRow}?['ArchiveRunId'],''),'''','''''')}'`), { runAfter: after('Stamps') });
  A.Verify_run_record = fn('attestRows', { op: 'verify', frame: 'runrec-v1', rows: [{ obj: "@if(empty(body('Run_record')?['value']), null, first(body('Run_record')?['value']))", sig: "@coalesce(if(empty(body('Run_record')?['value']), null, first(body('Run_record')?['value']))?['RecordSig'],'')" }] }, afterAny('Run_record'));
  A.Membership = op('membership', {
    targetLocation: "@if(empty(body('Target_live')?['value']),'archive','live')",
    tombstoneTransactionId: `@coalesce(${beltRow}?['TransactionId'],'')`,
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
    // computeTargetLine returns `targetLine` as an IDENTITY/PROJECTION ({transferId, productId,
    // qty}) — the engine's resolve-pinned QUANTITY AUTHORITY, not an economic row. computeDelta
    // needs storeId (the balance key) and type (the direction), so this refused INVALID_ROW on
    // every create-replace / create-delete / adopt / retire cell. The economic row is the FETCHED
    // TARGET LEDGER ROW itself — the same source `originalTarget` uses. No cell consumes both
    // `target` and `originalTarget`, so there is no double-count.
    target: `@${targetRow}`,
    newOutput: "@triggerBody()?['intent']?['control']?['row']",
    prevOutput: "@if(empty(body('Fetch_prior_control')?['value']), null, first(body('Fetch_prior_control')?['value']))",
    originalTarget: "@if(empty(body('Target_live')?['value']), if(empty(body('Target_archive')?['value']), null, first(body('Target_archive')?['value'])), if(empty(body('Target_live')?['value']), null, first(body('Target_live')?['value'])))",
    membership: "@body('Membership')",
    // EXECUTION-ORDER RACE. This action reads body('Delta_cell') and body('Fetch_prior_control')
    // but ran after Membership ONLY. Logic Apps does NOT infer dependencies from output references
    // — they must be DECLARED. Mode_gate_ok forks two parallel branches and Delta joined only one,
    // so `cell` could resolve to nothing and computeDelta refuse UNKNOWN_CELL. Declaring Delta_cell
    // covers Fetch_prior_control too (it is Delta_cell's own runAfter parent).
  }, after(['Membership', 'Delta_cell']));

  A.Candidate = op('candidate', {
    mode: "@coalesce(triggerBody()?['intent']?['mode'],'')",
    opId: "@coalesce(triggerBody()?['intent']?['opId'],'')",
    target: "@coalesce(triggerBody()?['intent']?['targetTransactionId'],'')",
    revision: "@coalesce(if(empty(body('Registry_lookup')?['value']), null, first(body('Registry_lookup')?['value']))?['Revision'],0)",
    candidateVersion: "@add(int(coalesce(json(variables('snapData'))?['version'],0)),1)",
    adoptions: "@coalesce(triggerBody()?['intent']?['adoptions'],json('[]'))",
    // assembleCandidate now BUILDS THE CONTROL ROW itself (buildControlRow, correctionCompute.js:261)
    // — §B step 16 says the LA creates the row with N7 columns + minted stamps + TargetLine +
    // OriginalEventAt, and no op returned it, so it was moved into the function rather than
    // assembled in the workflow. Sending NONE of its inputs meant BAD_REPLACEMENT_ROW on EVERY
    // create/supersede — and, worse, retire_claim did NOT fail: with `membership` absent, :228
    // silently stamped AdoptionDecisions[target] = {decision:'undecidable'}, a wrong adjudication
    // rather than a refusal. All five sources are transitive runAfter ancestors via
    // Target_line -> Stamps -> Run_record -> Verify_run_record -> Membership -> Delta.
    control: "@triggerBody()?['intent']?['control']",
    targetLine: "@body('Target_line')?['targetLine']",
    originalEventAt: "@body('Target_line')?['originalEventAt']",
    stamps: "@body('Stamps')?['stamps']",
    // §5 pins control.row to ECONOMIC IDENTITY ONLY ("stamps/instants NEVER accepted"), so
    // buildControlRow derives the replacement's StoreId from the TARGET ROW (its instant from
    // originalEventAt, its TransferId from targetLine). The fetched row is a transitive runAfter
    // ancestor of this action via Target_line -> Stamps -> ... -> Delta.
    targetRow: `@${targetRow}`,
    membership: "@body('Membership')",
  }, after('Delta'));

  // THE P4 REFUSAL GATE — COMPLETE FOR THE SIX P4 COMPUTE OPS, NOT FOR P4 AS A WHOLE.
  // Journal_create is the FIRST DURABLE WRITE of the correction — the
  // P2 coordination fence is the only earlier one, and every refusal below hands it back — so every
  // P4 compute op whose refusal must stop the run has to be answered HERE. The P4 op set is
  // Delta_cell, Target_line, Stamps, Membership, Delta, Candidate; only two of the six were tested.
  //  · Delta_cell — UNCONDITIONALLY fatal: every mode needs a cell, and deltaCell has no mode for
  //    which a refusal is survivable. It was ungated, and its BAD_CELL_INPUT was LAUNDERED: a null
  //    `cell` makes computeDelta fall to its default arm and refuse UNKNOWN_CELL, so the run did stop
  //    but the caller was told the wrong cause and 'supersede requires priorControlType' was
  //    unreportable. Now gated, and reported FIRST in the reason chain.
  //  · Target_line / Stamps — deliberately NOT tested here, and that is not an omission. Their
  //    refusals are fatal only for the modes that publish a control row (withdraw/retire_claim/adopt
  //    publish none; a DELETION control legitimately carries no stamps and no instant), so a gate
  //    expression here would have to encode the mode table — precisely the condition tree F1 forbids.
  //    They are folded into op:candidate instead (buildControlRow => TARGET_LINE_UNRESOLVED /
  //    STAMPS_UNRESOLVABLE, judged by the frozen engine's own predicates), so they arrive here as
  //    Candidate.ok=false carrying a Candidate.reason that names the cause.
  //  · Membership — membershipDecision has NO refusal path (it always answers ok:true with a
  //    decision, 'undecidable' included); the undecidable case is adjudicated by computeDelta's
  //    ADOPTION_/RETIRE_DELTA_UNDECIDABLE, so it is already covered by Delta.ok.
  //  · NOT COVERED HERE, AND STILL OPEN: §5 P4 also requires `prevOutput` — the prior control row
  //    that drives the WHOLE supersede delta — to be SEAL-VERIFIED before use (design doc line 826).
  //    `Fetch_prior_control` is an unauthenticated read and no attestRows verify sits in that chain,
  //    so the supersede arithmetic currently trusts a row nobody attested. That is a MISSING STAGE,
  //    not a missing gate, and NO rule in check-correction-def.js detects a missing §B stage — it is
  //    recorded in the known-gap block instead.
  // Written as sibling `equals` terms rather than one nested and(): the If `and` array is the native
  // multi-term form and each term stays individually legible in the run history.
  A.Compute_gate = {
    type: 'If',
    expression: {
      and: [
        { equals: ["@coalesce(body('Delta_cell')?['ok'],false)", true] },
        { equals: ["@coalesce(body('Delta')?['ok'],false)", true] },
        { equals: ["@coalesce(body('Candidate')?['ok'],false)", true] },
      ],
    },
    runAfter: afterAny('Candidate'), actions: {},
    else: { actions: releasingRefusal('compute', 'Respond_compute', 409, { ok: false, reason: "@coalesce(body('Delta_cell')?['reason'],body('Delta')?['reason'],body('Candidate')?['reason'],'COMPUTE_REFUSED')" }) },
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

  // ⚠ RESERVE IS DELIBERATELY THE LAST WRITE BEFORE THE IRREVOCABLE PUBLISH — see the block below.
  // It used to sit here, immediately after Journal_create, and that placement is only survivable
  // while the route is BROKEN. Today every request refuses at op:candidate (BAD_REPLACEMENT_ROW)
  // before Journal_create, so nothing has ever reached this line. The moment the request contract is
  // fixed, five refusal lanes open BELOW an early Reserve — verify, restamp-ownership, restamp-CAS,
  // assemble, and the abort handler — and NONE of them deletes the registry item. Registry
  // `TargetTransactionId` is ENFORCE-UNIQUE, so one refused correction would leave a row that makes
  // that transaction PERMANENTLY UNCORRECTABLE: every future attempt, by anyone, dies on the unique
  // constraint. A correction route whose refusals brick their own target is worse than one that
  // refuses everything, and the fix that makes the route work is what arms it.
  // Moved rather than compensated: a delete-on-refusal path would be five new writes, each its own
  // failure mode, to undo a write we can simply not make yet. See A.Reserve after Assemble_ok.

  // §B step 16 says "create/supersede only", and op:candidate returns `row` for THOSE MODES ONLY.
  // An UNCONDITIONAL create therefore POSTed a NULL body on every withdraw / retire_claim / adopt:
  // a junk ledger item, signed as garbage, with the run then dying at the verify gate and that item
  // already committed and un-rolled-back. The mode decision stays in the function
  // (publishesControlRow); the workflow only obeys it (the F1 rule). No Response inside the scope —
  // a refusal there would trip the FALL-THROUGH GATE rule, so the outcome rides out on `rowOk`.
  A.Publish_control_row = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Candidate')?['publishesControlRow'],false)", true] }] },
    runAfter: after('Journal_create'),
    actions: {
      Candidate_row: spCreate(item("@{if(empty(body('Target_live')?['value']),'" + L.archive + "','" + L.live + "')}", ''), "@body('Candidate')?['row']", {}),
      Sign_ctl: fn('attestRows', { op: 'sign', frame: 'ctl-v1', rows: ["@body('Candidate')?['row']"] }, after('Candidate_row')),
      Stamp_ctl_sig: spMerge(
        item("@{if(empty(body('Target_live')?['value']),'" + L.archive + "','" + L.live + "')}", "(@{body('Candidate_row')?['Id']})"),
        { EconSig: "@{if(empty(body('Sign_ctl')?['sigs']), null, first(body('Sign_ctl')?['sigs']))}" },
        "@{body('Candidate_row')?['odata.etag']}",
        after('Sign_ctl')),
      // Verify: the seal is minted FROM THE INTENT, and the re-read row is compared to that intent.
      Reread_candidate: sp(item("@{if(empty(body('Target_live')?['value']),'" + L.archive + "','" + L.live + "')}", "(@{body('Candidate_row')?['Id']})"), { runAfter: after('Stamp_ctl_sig') }),
      Rows_equal: op('ctlRowsEqual', { a: "@body('Candidate')?['row']", b: "@body('Reread_candidate')" }, after('Reread_candidate')),
      Set_row_ok: setVar('rowOk', "@coalesce(body('Rows_equal')?['equal'],false)", afterAny('Rows_equal')),
    },
    else: { actions: {} },
  };
  A.Steps_recheck = sp(item(L.steps, `?$top=200&$orderby=Id asc&$filter=RecordId eq '@{replace(coalesce(${targetRow}?['TransferId'],''),'''','''''')}'`), { runAfter: after('Publish_control_row') });
  A.Steps_redigest = op('stepSetDigest', { steps: "@coalesce(body('Steps_recheck')?['value'],json('[]'))" }, after('Steps_recheck'));
  A.Verify_gate = {
    type: 'If',
    expression: {
      and: [
        { equals: ["@variables('rowOk')", true] },
        { equals: ["@coalesce(body('Steps_redigest')?['digest'],'x')", "@coalesce(body('Step_digest')?['digest'],'y')"] },
      ],
    },
    runAfter: after('Steps_redigest'), actions: {},
    else: { actions: releasingRefusal('verify', 'Respond_verify', 409, { ok: false, reason: 'CANDIDATE_VERIFY_FAILED' }) },
  };

  // ── P6: THE PUBLISH (irrevocable) ────────────────────────────────────────────────────────────────
  // Re-read before the CAS: the pre-acquire body would write idle back over correction_active, and
  // a MERGE response carries no ETag to fence on.
  A.Reread_state_restamp = sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'archive_state'`), { runAfter: after('Verify_gate') });
  // OWNERSHIP, not just freshness (§3a). The release pair asserts `owner === this run` before it
  // touches the record; the boundary re-stamp must do the same. A run displaced after its lease went
  // stale re-reads a record it no longer owns, CASes a fresh heartbeat onto the NEW holder's lock —
  // prolonging a lease it does not hold, and defeating the staleness exit every recoverer keys off —
  // and then walks on into P6. §3a: a re-stamp that is no longer ours => the worker ABORTS.
  // The abort deliberately does NOT release the state (it is not ours to release).
  A.Restamp_owner_gate = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(json(coalesce(if(empty(body('Reread_state_restamp')?['value']), null, first(body('Reread_state_restamp')?['value']))?['ConfigData'],'{}'))?['owner'],'')", "@workflow()?['run']?['name']"] }] },
    runAfter: afterAny('Reread_state_restamp'),
    actions: {},
    else: { actions: { Respond_displaced: response(202, { ok: false, reason: 'OWNERSHIP_LOST', detail: 'this run no longer owns the coordination record; a recoverer owns the journal' }), Respond_displaced_stop: terminate(after('Respond_displaced')) } },
  };
  A.Final_restamp = spMerge(
    item(L.config, "(@{if(empty(body('Reread_state_restamp')?['value']), null, first(body('Reread_state_restamp')?['value']))?['Id']})"),
    { ConfigData: "@{string(setProperty(json(coalesce(if(empty(body('Reread_state_restamp')?['value']), null, first(body('Reread_state_restamp')?['value']))?['ConfigData'],'{}')),'heartbeatAt',utcNow()))}" },
    "@{if(empty(body('Reread_state_restamp')?['value']), null, first(body('Reread_state_restamp')?['value']))?['odata.etag']}",
    after('Restamp_owner_gate'));
  // The gate above closes the observed-by-read case; the CAS closes the race (a seize between the
  // read and the MERGE changes the ETag => 412). That 412 used to be invisible: Assemble was
  // Succeeded-only, so on failure the run ended with no Response and the caller hung forever.
  A.Final_restamp_ok = {
    type: 'If',
    expression: { and: [{ less: ["@int(coalesce(outputs('Final_restamp')?['statusCode'],500))", 300] }] },
    runAfter: afterAny('Final_restamp'), actions: {},
    else: { actions: { Respond_restamp_conflict: response(202, { ok: false, reason: 'OWNERSHIP_LOST', detail: 'the boundary re-stamp CAS failed; the coordination record changed under this run' }), Respond_restamp_conflict_stop: terminate(after('Respond_restamp_conflict')) } },
  };

  // op:assembleSnapshot returns the EXACT serialized ConfigData — the LA does NO arithmetic.
  A.Assemble = op('assembleSnapshot', {
    // assembleSnapshot requires a PARSED OBJECT (`typeof cfg !== 'object'` => BAD_ASSEMBLY_INPUT),
    // and snapData is a STRING variable — so the op refused on 100% of runs. Parsed at the CALL
    // SITE, not by retyping the variable: A.Candidate does json(variables('snapData')) too, and
    // json() over an already-parsed object is not a valid WDL call.
    snapshotConfigData: "@json(variables('snapData'))",
    candidateVersion: "@body('Candidate')?['candidateVersion']",
    deltas: "@body('Delta')?['deltas']",
    candidateHeads: "@body('Candidate')?['candidateHeads']",
  }, after('Final_restamp_ok'));

  // assembleSnapshot expresses REFUSAL as HTTP 200 + {ok:false,reason} (correctionCompute.js:497-498
  // via refuse()), so the CALL succeeds and `configData` is simply ABSENT. Without this gate the
  // MERGE below writes `ConfigData: ""` over the live snapshot with the still-valid P2 ETag —
  // balances, controlManifest and fence destroyed, irrevocably, on a refusal.
  A.Assemble_ok = {
    type: 'If',
    expression: { and: [{ equals: ["@coalesce(body('Assemble')?['ok'],false)", true] }] },
    runAfter: afterAny('Assemble'), actions: {},
    else: { actions: releasingRefusal('assemble', 'Respond_assemble', 409, { ok: false, reason: "@coalesce(body('Assemble')?['reason'],'BAD_ASSEMBLY_INPUT')" }) },
  };

  // THE RESERVATION, PLACED AT THE LAST PRE-COMMIT INSTANT (moved from after Journal_create).
  // Registry TargetTransactionId is ENFORCE-UNIQUE, and NOTHING in this route ever deletes a registry
  // item — so wherever this create sits, every refusal lane BELOW it permanently bricks its target.
  // Placed here, the set of lanes below it is exactly: Publish, Outcome_by_read, Recovery_decision and
  // Published_gate — and on every one of those the correction may ALREADY HAVE COMMITTED, which is
  // precisely when a `pending` registry row is the CORRECT residue: §B step 19 leaves the journal
  // non-terminal and the fence held, and the B-R reconcile sub-flow needs this row to roll the
  // correction forward. Above it, refusals published nothing and leave nothing behind.
  // WHY LATE IS SAFE. The reservation's other job — stopping two corrections racing the same target —
  // is already done, and not by this row: the P2 coordination fence is a SINGLE record acquired by
  // CAS and held from P2 to P7, so at most one correction is in flight at a time, and
  // Restamp_owner_gate re-proves ownership before the commit boundary. This create claims durability,
  // not exclusivity.
  // WHAT IT COSTS. A unique-key clash (an orphan from an older era) is now discovered AFTER the
  // control row has been written to the ledger, not before. That trade is deliberate: an unpublished
  // control row is INERT — nothing points at it until the manifest names it at Publish, and reaching
  // Verify_gate already leaves one behind today — whereas an orphan registry row is permanently
  // blocking. A recoverable inert row beats an unrecoverable live one.
  A.Reserve = spCreate(item(L.registry, ''), {
    TargetTransactionId: tgt,
    State: 'pending',
    Owner: "@{workflow()?['run']?['name']}",
    OpId: "@{coalesce(triggerBody()?['intent']?['opId'],'')}",
    JournalId: "@{body('Candidate')?['journalId']}",
    TtlAt: '@{addMinutes(utcNow(),10)}',
    Origin: 'director',
  }, after('Assemble_ok'));

  // ONE MERGE, with the P2-CAPTURED ETag — never a re-read (C2-R1-1).
  A.Publish = spMerge(
    item(L.config, "(@{variables('snapItemId')})"),
    { ConfigData: "@{body('Assemble')?['configData']}" },
    "@{variables('snapEtag')}",
    after('Reserve'));

  A.Outcome_by_read = sp(item(L.config, `?$select=Id,ConfigData&$filter=ConfigType eq 'stock_snapshot'`), { runAfter: afterAny('Publish') });
  A.Recovery_decision = op('recoveryDecision', {
    candidateHeads: "@body('Candidate')?['candidateHeads']",
    // recoveryDecision reads manifest.controlHeads / manifest.version — the controlManifest OBJECT,
    // not the snapshot ROOT. Passing the root made controlHeads always undefined => present 0, and
    // after a SUCCESSFUL publish root.version === candidateVersion, so it returned INVARIANT_BROKEN
    // and P7 never ran: registry never committed, journal never terminal, fence never released.
    activeManifest: "@json(coalesce(if(empty(body('Outcome_by_read')?['value']), null, first(body('Outcome_by_read')?['value']))?['ConfigData'],'{}'))?['controlManifest']",
    candidateVersion: "@body('Candidate')?['candidateVersion']",
    observedVersion: "@json(coalesce(if(empty(body('Outcome_by_read')?['value']), null, first(body('Outcome_by_read')?['value']))?['ConfigData'],'{}'))?['version']",
  }, after('Outcome_by_read'));

  A.Published_gate = {
    type: 'If',
    // recoveryDecision emits roll_forward | roll_back | INVARIANT_BROKEN -- never 'committed'.
    // Testing for 'committed' meant NO publication could ever reach P7.
    expression: { and: [{ equals: ["@coalesce(body('Recovery_decision')?['decision'],'')", 'roll_forward'] }] },
    runAfter: after('Recovery_decision'),
    actions: {},   // P7 hangs off this branch
    else: {
      actions: {
        // NOT every non-roll_forward outcome is the same (§B step 19). recoveryDecision emits
        // 'roll_back' ONLY when every candidate head is positively ABSENT and the manifest version
        // is still below ours — the spec's positively-absent + version-unchanged case, provably
        // "the publish did not land". INVARIANT_BROKEN (partial/foreign write) is a different
        // animal and must be left pending for reconcile. The one thing recoveryDecision cannot know
        // is whether we are STILL THE OWNER — it takes no ownership input — so the workflow
        // supplies it the only way it can, by re-reading the record (the releasePair pattern).
        // NO compensating writes here: the rollback sub-flow (§B step 17) is a separate item.
        Reread_state_outcome: sp(item(L.config, `?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'archive_state'`), { runAfter: {} }),
        Rollback_or_hold: {
          type: 'If',
          expression: {
            and: [
              { equals: ["@coalesce(body('Recovery_decision')?['decision'],'')", 'roll_back'] },
              { equals: ["@coalesce(json(coalesce(if(empty(body('Reread_state_outcome')?['value']), null, first(body('Reread_state_outcome')?['value']))?['ConfigData'],'{}'))?['owner'],'')", "@workflow()?['run']?['name']"] },
            ],
          },
          runAfter: afterAny('Reread_state_outcome'),
          actions: {
            Respond_not_published: response(409, { ok: false, reason: 'PUBLICATION_FAILED', detail: 'nothing was published: the candidate heads are positively absent and the manifest version is unchanged; the journal stays pending for rollback' }),
            Respond_not_published_stop: terminate(after('Respond_not_published')),
          },
          else: {
            actions: {
              Respond_held: response(202, { ok: false, reason: 'PUBLICATION_HELD_FOR_RECONCILE' }),
              Respond_held_stop: terminate(after('Respond_held')),
            },
          },
        },
      },
    },
  };

  // The publish is IRREVOCABLE, so the window between it and the outcome verdict is the one place
  // the generic abort handler must NOT reach. If the outcome re-read or the verdict itself fails,
  // the publication may have committed: releasing the fence there would let the archive LA run over
  // an unreconciled snapshot. §B step 19 says exactly what to do instead — leave the journal pending
  // and the fence HELD, and let the B-R reconcile sub-flow seize it. These two handlers answer the
  // caller (so it never hangs) and stop, WITHOUT releasing.
  A.Respond_held_outcome = response(202, { ok: false, reason: 'PUBLICATION_HELD_FOR_RECONCILE', detail: 'the publication outcome could not be read back; the reconcile sub-flow owns this journal' }, { Outcome_by_read: ['Failed', 'TimedOut'] });
  A.Respond_held_outcome_stop = terminate(after('Respond_held_outcome'));
  A.Respond_held_recovery = response(202, { ok: false, reason: 'PUBLICATION_HELD_FOR_RECONCILE', detail: 'the recovery verdict could not be computed; the reconcile sub-flow owns this journal' }, { Recovery_decision: ['Failed', 'TimedOut'] });
  A.Respond_held_recovery_stop = terminate(after('Respond_held_recovery'));

  // ── P7: terminal ─────────────────────────────────────────────────────────────────────────────────
  // §B step 20 — THE TERMINAL REGISTRY WRITE IS PER MODE, and which shape a mode writes is a policy
  // choice, so op:candidate decides it and returns the exact field-set (`registryTerminal`); the
  // workflow MERGEs that verbatim and carries no condition tree (F1). What was here wrote ONE shape
  // for every mode: withdraw/retire never got the WITHDRAWN FORM (ControlId '' — the withdrawn
  // null), and Revision was ECHOED rather than bumped, so a prior revision of 4 stayed 4.
  // `registryTerminal` is null for adopt, which adjudicates no target of its own.
  A.Registry_terminal = {
    type: 'If',
    expression: { and: [{ equals: ["@empty(body('Candidate')?['registryTerminal'])", false] }] },
    runAfter: after('Published_gate'),
    actions: {
      Do_registry_terminal: spMerge(
        item(L.registry, "(@{body('Reserve')?['Id']})"),
        {
          State: "@{body('Candidate')?['registryTerminal']?['State']}",
          ControlId: "@{body('Candidate')?['registryTerminal']?['ControlId']}",
          Revision: "@{body('Candidate')?['registryTerminal']?['Revision']}",
          PublicationVersion: "@{body('Candidate')?['registryTerminal']?['PublicationVersion']}",
        },
        "@{body('Reserve')?['odata.etag']}",
        {}),
    },
    else: { actions: {} },
  };

  // §B step 20 — adoptions (ANY mode): CAS-fill each adopted target's PublicationVersion. The LIST
  // comes from op:candidate (`adoptionFills`); the workflow only walks it and writes. Sequential and
  // ETag-fenced, so a recovery re-run is idempotent (C2-R2-6).
  A.Adoption_fills = {
    type: 'Foreach',
    foreach: "@coalesce(body('Candidate')?['adoptionFills'],json('[]'))",
    runAfter: after('Registry_terminal'),
    runtimeConfiguration: { concurrency: { repetitions: 1 } },
    actions: {
      Adopt_lookup: sp(item(L.registry, "?$top=2&$filter=TargetTransactionId eq '@{replace(coalesce(items('Adoption_fills')?['targetTransactionId'],''),'''','''''')}'")),
      Adopt_fill: {
        type: 'If',
        expression: { and: [{ equals: ["@empty(body('Adopt_lookup')?['value'])", false] }] },
        runAfter: afterAny('Adopt_lookup'),
        actions: {
          Do_adopt_fill: spMerge(
            item(L.registry, "(@{if(empty(body('Adopt_lookup')?['value']), null, first(body('Adopt_lookup')?['value']))?['Id']})"),
            { PublicationVersion: "@{items('Adoption_fills')?['publicationVersion']}" },
            "@{if(empty(body('Adopt_lookup')?['value']), null, first(body('Adopt_lookup')?['value']))?['odata.etag']}",
            {}),
        },
        else: { actions: {} },
      },
    },
  };

  A.Journal_complete = spMerge(
    item(L.journal, "(@{body('Journal_create')?['Id']})"),
    {
      State: 'complete',
      StoredResult: "@{string(json(concat('{\"ok\":true,\"controlId\":\"',coalesce(body('Candidate')?['controlId'],''),'\",\"revision\":',string(body('Candidate')?['terminalRevision']),',\"publicationVersion\":',string(body('Candidate')?['candidateVersion']),',\"deviceConvergencePending\":',if(equals(coalesce(triggerBody()?['intent']?['mode'],''),'adopt'),'false','true'),',\"affectedTarget\":\"',coalesce(triggerBody()?['intent']?['targetTransactionId'],''),'\"}')))}",
    },
    "@{body('Journal_create')?['odata.etag']}",
    after('Adoption_fills'));

  Object.assign(A, releasePair('final', after('Journal_complete')).actions);
  A.Respond_ok = response(200, {
    ok: true,
    controlId: "@coalesce(body('Candidate')?['controlId'],'')",
    // the revision the REGISTRY now holds — the caller sends it straight back as expected.revision,
    // and modeGate refuses unless it equals the registry's Revision.
    revision: "@body('Candidate')?['terminalRevision']",
    publicationVersion: "@body('Candidate')?['candidateVersion']",
    deviceConvergencePending: "@not(equals(coalesce(triggerBody()?['intent']?['mode'],''),'adopt'))",
    affectedTarget: "@coalesce(triggerBody()?['intent']?['targetTransactionId'],'')",
  }, after('Release_final'));

  // ── CONTAINMENT SPLIT AT THE COMMIT BOUNDARY ────────────────────────────────────────────────────
  // `Publish` is the irrevocable act. BEFORE it a failure has published nothing, so the abort handler
  // may hand the coordination fence back and answer 500. AFTER it the same handler is a DATA-SAFETY
  // BUG: a failed Registry_terminal / adoption fill / Journal_complete would release the fence and
  // report 500 while the snapshot is ALREADY published and the journal is still pending — the archive
  // LA (or the next correction) then runs over an unreconciled snapshot. §B step 19 pins the opposite
  // posture post-commit: HOLD. Leave the fence held and the journal non-terminal, answer the caller so
  // it never hangs, and let the B-R reconcile sub-flow seize the lease once the heartbeat goes stale
  // (T-1) and roll the correction FORWARD (§6: heads present in the manifest => roll_forward only, and
  // every P7 step is idempotent). The two dedicated hold handlers already did this for Outcome_by_read
  // and Recovery_decision ONLY; everything else in P6/P7 fell through to the releasing abort.
  // The split is ORDINAL, not a hand-kept list: `A` is populated in source order, so everything from
  // `Publish` onward IS the post-commit region by construction — a P7 action added later is contained
  // automatically instead of silently inheriting the releasing handler.
  const commitCut = Object.keys(A).indexOf('Publish');
  if (commitCut < 0) throw new Error('commit-boundary split: no Publish action to cut at');
  const Commit = {};
  for (const n of Object.keys(A).slice(commitCut)) { Commit[n] = A[n]; delete A[n]; }
  // The Scope now carries the join to the pre-commit region, so Publish is simply its first action.
  Commit.Publish.runAfter = {};
  // The join is RESERVE, not Assemble_ok: `Reserve` was moved down to sit immediately above the
  // commit boundary, and P7's Do_registry_terminal reads `body('Reserve')`. Joining on Assemble_ok
  // would let the Scope run in PARALLEL with Reserve — Logic Apps never infers order from a
  // reference — so the registry MERGE would resolve its item id and ETag to null. The expression
  // gate's non-ancestor rule caught exactly that; this is the edge it was missing.
  A.Commit = { type: 'Scope', actions: Commit, runAfter: after('Reserve') };
  // The post-commit handler RELEASES NOTHING — that is the entire point of the split. It answers and
  // stops; the fence stays held and the journal stays non-terminal, which is exactly the state §6
  // expects to find. 202, not 500: the correction is not failed, it is UNSETTLED and owned by
  // reconcile. Re-sending the same opId returns 202 RECOVERY_REQUIRED until reconcile terminalises the
  // journal, and the StoredResult replay (200) afterwards.
  A.Respond_held_commit = response(202, {
    ok: false,
    reason: 'PUBLICATION_HELD_FOR_RECONCILE',
    detail: 'the snapshot publish is past the point of no return but the terminal steps did not complete; the coordination fence is deliberately still held and the journal left non-terminal so the reconcile sub-flow owns this correction. Re-send the SAME opId to read the settled outcome.',
  }, { Commit: ['Failed', 'TimedOut'] });
  A.Respond_held_commit_stop = terminate(after('Respond_held_commit'));

  return wrap(A);

  // ── FAILURE CONTAINMENT ────────────────────────────────────────────────────────────────────────
  // A Logic Apps action that ends Failed or TimedOut with NO successor handling that status ends the
  // RUN with no Response. For a request/response workflow that is a HANG, not an error: the caller
  // waits out its own timeout and learns nothing. Chaining 36 calls on [Succeeded] meant 36 hangs.
  // Bolting a status gate onto each call is not the fix — a Scope reports Failed/TimedOut whenever
  // anything inside it does, so ONE sibling handler covers every action in the workflow, including
  // every action added later. The handler RELEASES THE COORDINATION FENCE FIRST; releasePair is
  // ownership-conditional, so it is a no-op on the paths that never acquired.
  // ⚠ InitializeVariable is a TOP-LEVEL-ONLY action — it cannot be created inside a scope,
  // condition or loop — so all four variables are DECLARED here and ASSIGNED inside with SetVariable
  // (rowOk defaults TRUE: the modes that publish no control row have nothing to verify).
  function wrap(inner) {
    const abort = releasePair('abort', { Main: ['Failed', 'TimedOut'] });
    const out = {
      Init_snapEtag: initVar('snapEtag', '', {}),
      Init_snapData: initVar('snapData', '{}', after('Init_snapEtag')),
      Init_snapItemId: initVar('snapItemId', '', after('Init_snapData')),
      Init_row_ok: { type: 'InitializeVariable', inputs: { variables: [{ name: 'rowOk', type: 'boolean', value: true }] }, runAfter: after('Init_snapItemId') },
      Main: { type: 'Scope', actions: inner, runAfter: after('Init_row_ok') },
    };
    Object.assign(out, abort.actions);
    // NOT [.. 'Skipped']: Release_abort is Skipped exactly when the scope SUCCEEDED, and responding
    // there would send a second Response over the top of the happy path's 200.
    out.Abort_respond = response(500, { ok: false, reason: 'CORRECTION_ABORTED', detail: 'the correction could not complete; the coordination fence was released if it was still ours' }, afterAny(abort.mergeName));
    out.Abort_stop = terminate(after('Abort_respond'));
    return out;
  }

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
          // afterAny: a FAILED coordination re-read must not skip the release gate and everything
          // chained behind it. The expression degrades safely on a failed read — body(...) is
          // absent, the owner comparison yields '' != this run's name, and the else branch (leave
          // it alone) is taken, so nothing is written.
          runAfter: afterAny(readName),
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
      // The §B/§5 request contract, encoded SHALLOWLY. `properties:{}` documents nothing and accepts
      // anything: a body with no `intent` at all reaches P0, every downstream coalesce turns the
      // absence into '', and the refusal surfaces many actions later — AFTER the coordination fence
      // has been acquired — instead of at the door. Deliberately permissive: NO
      // additionalProperties:false (the envelope grows), nothing mode-specific required, and `mode`
      // carries NO enum — which modes exist and which fields each needs is op:modeGate's decision,
      // not a schema's (the F1 rule). `retireEvidence` is deliberately NOT declared: the workflow
      // now GATHERS it, so the contract must not advertise a caller-supplied field it must ignore.
      inputs: {
        method: 'POST',
        schema: {
          type: 'object',
          required: ['auth', 'actorUsername', 'proof', 'intent'],
          properties: {
            auth: {
              type: 'object',
              properties: {
                deviceId: { type: 'string' }, storeId: { type: 'string' },
                storeKey: { type: 'string' }, directorKey: { type: 'string' },
              },
            },
            actorUsername: { type: 'string' },
            proof: { type: 'string' },
            intent: {
              type: 'object',
              required: ['mode', 'opId'],
              properties: {
                mode: { type: 'string' },
                opId: { type: 'string' },
                targetTransactionId: { type: 'string' },
                expected: { type: 'object' },
                control: { type: 'object' },
                adoptions: { type: 'array' },
              },
            },
          },
        },
      },
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
