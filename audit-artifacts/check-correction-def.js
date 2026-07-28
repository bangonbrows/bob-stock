// Structural validator for the generated N1 correction LA definition.
// Catches the failure modes that only show up at deploy time (or worse, at run time):
//   1. a runAfter naming an action that does not exist AT THAT SCOPE  -> deploy rejects
//   2. an action with no path to a Response                          -> dangling run (house rule)
//   3. a real function key in the file                               -> must never happen
//   4. IF-MATCH:* anywhere                                           -> retired at C2-R1-2
//   5. a CAS MERGE without an IF-MATCH header                        -> unfenced write
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'correction-def-generated.json');
const def = JSON.parse(fs.readFileSync(file, 'utf8'));
const problems = [];
let scopes = 0, actionCount = 0, responses = 0, merges = 0;
// Variables that PROVABLY carry a captured ETag: any variable ever ASSIGNED from an expression
// containing odata.etag. DERIVED, never hand-kept — a new fence variable is picked up automatically,
// and a BOOLEAN flag variable is not accepted as a fence (fencing on one sends 'IF-MATCH: True',
// which SharePoint rejects or, worse, treats as no usable precondition: a CAS that has quietly
// stopped being one, which is this rule's own stated target.
const ETAG_VARS = new Set();
(function collectEtagVars(actions) {
  for (const a of Object.values(actions || {})) {
    if (a.type === 'InitializeVariable') {
      for (const v of (a.inputs && a.inputs.variables) || []) if (/odata\.etag/.test(JSON.stringify(v.value == null ? '' : v.value))) ETAG_VARS.add(v.name);
    }
    if (a.type === 'SetVariable' && a.inputs && /odata\.etag/.test(JSON.stringify(a.inputs.value == null ? '' : a.inputs.value))) ETAG_VARS.add(a.inputs.name);
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions,
      ...Object.values(a.cases || {}).map(c => c && c.actions)]) if (sub) collectEtagVars(sub);
  }
})(def.actions);

// Walk every action scope. Within a scope, runAfter may only name siblings.
function walk(actions, scopePath) {
  scopes++;
  const names = new Set(Object.keys(actions));
  // ENTRY HEADS. Logic Apps starts EVERY action with an empty runAfter the moment its scope is
  // entered, all in parallel. A correct scope therefore has EXACTLY ONE entry head; a second one is
  // an action that has silently lost its ordering and now races the rest of the workflow. Deleting
  // `Publish.runAfter` outright — one of the surviving corruptions — makes the IRREVOCABLE publish an
  // entry head, and nothing else notices, because a missing runAfter dangles on nothing.
  const heads = Object.keys(actions).filter(n => Object.keys(actions[n].runAfter || {}).length === 0);
  if (names.size > 0 && heads.length !== 1) {
    problems.push(`ENTRY HEADS: scope '${scopePath || '(root)'}' has ${heads.length} action(s) with an empty runAfter [${heads.join(', ')}] — exactly one is correct; every other action must declare what it runs after`);
  }
  for (const [name, a] of Object.entries(actions)) {
    actionCount++;
    const where = scopePath ? `${scopePath} > ${name}` : name;
    for (const dep of Object.keys(a.runAfter || {})) {
      if (!names.has(dep)) problems.push(`DANGLING runAfter: '${where}' depends on '${dep}', which is not a sibling in this scope`);
    }
    if (a.type === 'Response') responses++;
    // HTTP HEADER NAMES ARE CASE-INSENSITIVE (RFC 9110 §5.1) and the connector treats them that way
    // at runtime. Exact-key lookup meant `x-http-method: merge` was not recognised as a MERGE at
    // all, so the entire CAS rule below was SKIPPED and an unfenced write passed clean — one of the
    // corruptions that survived the external mutation test. Fold the bag to lower case once.
    const hdrsRaw = a?.inputs?.body?.headers || {};
    const hdr = {};
    for (const [hk, hv] of Object.entries(hdrsRaw)) hdr[String(hk).toLowerCase()] = hv;
    const rawVerb = hdr['x-http-method'];
    const verb = (rawVerb === undefined || rawVerb === null ? '' : String(rawVerb)).trim().toUpperCase();
    if (verb && !['MERGE', 'DELETE', 'PUT', 'PATCH'].includes(verb)) problems.push(`UNKNOWN X-HTTP-Method '${verb}' at '${where}'`);
    if (['MERGE', 'DELETE', 'PUT', 'PATCH'].includes(verb)) {
      // EVERY destructive verb needs the fence, not just MERGE. Naming DELETE/PUT/PATCH as legal
      // above while fencing only MERGE below states IN CODE that an unfenced DELETE is fine.
      // (`merges` keeps its old meaning for the report line.)
      if (verb === 'MERGE') merges++;
      // TYPED ETag. An IF-MATCH is a fence only if it is a NON-NULL STRING that provably carries a
      // CAPTURED ETag. '' fences on nothing; '*' is retired (C2-R1-2); "@{null}" and a JSON null
      // evaluate to an empty header, the connector then sends no precondition at all, and the MERGE
      // is unconditional — a CAS that has quietly stopped being one. Presence is not a fence: the
      // mutation that set IF-MATCH to "@{null}" left every gate green.
      const im = hdr['if-match'];
      const t = typeof im === 'string' ? im.trim() : im;
      const stripped = typeof t === 'string' ? t.replace(/^@\{?/, '').replace(/\}$/, '').trim() : '';
      if (im === undefined || im === null) problems.push(`UNFENCED ${verb}: '${where}' has X-HTTP-Method: ${verb} with no IF-MATCH`);
      else if (typeof im !== 'string') problems.push(`IF-MATCH IS NOT A STRING at '${where}' (${JSON.stringify(im)}) — an ETag precondition must be a string`);
      else if (t === '') problems.push(`EMPTY IF-MATCH at '${where}' — fencing on nothing`);
      else if (t === '*') problems.push(`IF-MATCH:* at '${where}' — retired by C2-R1-2`);
      else if (/^(null|nullValue\(\))$/.test(stripped)) problems.push(`NULL IF-MATCH at '${where}': "${t}" evaluates to no precondition, so the MERGE is unconditional`);
      else if (!/odata\.etag/.test(t) && ![...t.matchAll(/variables\('([A-Za-z0-9_]+)'\)/g)].some(mv => ETAG_VARS.has(mv[1]))) problems.push(`UNPROVEN IF-MATCH SOURCE at '${where}': "${t.slice(0, 70)}" — an ETag must come from a captured read (?['odata.etag']) or a variable PROVABLY assigned one`);
      if (typeof im === 'string' && /\['@odata\.etag'\]/.test(im)) problems.push(`ETAG NAMING at '${where}': '@odata.etag' — nometadata returns 'odata.etag' with no '@' prefix`);
    }
    // recurse into nested scopes
    if (a.actions) walk(a.actions, where);
    if (a.else && a.else.actions) walk(a.else.actions, where + ' [else]');
    for (const [cn, c] of Object.entries(a.cases || {})) if (c.actions) walk(c.actions, `${where} [case ${cn}]`);
    if (a.default && a.default.actions) walk(a.default.actions, where + ' [default]');
  }
}

// THE RULE THAT MATTERS (found the hard way on the first generated definition):
// a `Response` does NOT end a Logic App run. A gate written as
//     If <ok> then {}  else { Respond 401 }
// lets the else-branch respond and then CONTINUES into the parent scope's next action — so the
// gate is decorative and a refused correction still publishes. An empty success branch is
// therefore legal ONLY IF every terminal path in the else/case branch ends in a Terminate.
// ⚠ THIS WAS EXISTENTIAL AND BOTH AUDITORS CAUGHT IT. `vals.some(...)` meant ANY Terminate anywhere
// in the branch made it "terminating" — so a nested If where only ONE inner path terminated passed,
// and the other path fell straight through into the parent scope. Termination must be UNIVERSAL:
// every path out of the branch has to end.
function branchTerminates(actions) {
  const vals = Object.values(actions || {});
  if (vals.length === 0) return false;
  if (vals.some(a => a.type === 'Terminate')) return true;   // a Terminate at this level ends every path here
  // otherwise the branch only terminates if some nested scope terminates on ALL of its own paths
  return vals.some(a => {
    if (a.type === 'If') {
      const s = branchTerminates(a.actions);
      const e = branchTerminates(a.else && a.else.actions);
      return s && e;                                          // BOTH sides, not either
    }
    if (a.type === 'Switch') {
      const cases = Object.values(a.cases || {});
      const allCases = cases.length > 0 && cases.every(c => branchTerminates(c.actions));
      return allCases && branchTerminates(a.default && a.default.actions);
    }
    return false;
  });
}
function auditGates(actions, scopePath) {
  for (const [name, a] of Object.entries(actions)) {
    const where = scopePath ? `${scopePath} > ${name}` : name;
    // Does this scope contain a Response anywhere (directly or nested)?
    const respondsIn = (acts) => Object.values(acts || {}).some(x => x.type === 'Response'
      || respondsIn(x.actions) || respondsIn(x.else && x.else.actions)
      || Object.values(x.cases || {}).some(c => respondsIn(c.actions)) || respondsIn(x.default && x.default.actions));

    if (a.type === 'If') {
      const successEmpty = Object.keys(a.actions || {}).length === 0;
      const elseActs = a.else && a.else.actions;
      if (successEmpty && (!elseActs || Object.keys(elseActs).length === 0)) {
        problems.push(`DEAD GATE: '${where}' has an empty success branch AND an empty else — it decides nothing`);
      }
      // ⚠ THE CHECK USED TO RUN ONLY WHEN THE SUCCESS BRANCH WAS EMPTY (AGY). A gate that DOES work
      // in its success branch could still have an unterminated Response in its else and fall
      // through. Any branch that responds must terminate, whatever the other branch does.
      if (elseActs && respondsIn(elseActs) && !branchTerminates(elseActs)) {
        problems.push(`FALL-THROUGH GATE: '${where}' responds in its else branch but never Terminates — execution continues into the happy path after a refusal`);
      }
      if (a.actions && respondsIn(a.actions) && !branchTerminates(a.actions)) {
        problems.push(`FALL-THROUGH GATE: '${where}' responds in its SUCCESS branch but never Terminates`);
      }
    }
    if (a.type === 'Switch') {
      for (const [cn, c] of Object.entries(a.cases || {})) {
        if (c.actions && respondsIn(c.actions) && !branchTerminates(c.actions)) {
          problems.push(`FALL-THROUGH CASE: '${where}' case '${cn}' responds but never Terminates`);
        }
      }
      // ⚠ THE DEFAULT BRANCH WAS NEVER AUDITED (AGY). A refusal in a switch's default responds and
      // falls straight through into whatever follows the switch.
      const dflt = a.default && a.default.actions;
      if (dflt && respondsIn(dflt) && !branchTerminates(dflt)) {
        problems.push(`FALL-THROUGH DEFAULT: '${where}' default branch responds but never Terminates`);
      }
    }
    if (a.actions) auditGates(a.actions, where);
    if (a.else && a.else.actions) auditGates(a.else.actions, where + ' [else]');
    for (const [cn, c] of Object.entries(a.cases || {})) if (c.actions) auditGates(c.actions, `${where} [case ${cn}]`);
    if (a.default && a.default.actions) auditGates(a.default.actions, where + ' [default]');
  }
}

walk(def.actions, '');
auditGates(def.actions, '');

// ── FLATTENED ACTION INDEX (shared by the inventory and the commit-boundary rules) ─────────────────
const FLAT = {};
(function flatten(actions) {
  for (const [n, a] of Object.entries(actions || {})) {
    FLAT[n] = a;
    if (a.actions) flatten(a.actions);
    if (a.else && a.else.actions) flatten(a.else.actions);
    for (const c of Object.values(a.cases || {})) if (c.actions) flatten(c.actions);
    if (a.default && a.default.actions) flatten(a.default.actions);
  }
})(def.actions);
// THE RELEASE SIGNATURE: a CAS that writes the coordination state back to 'idle'. Declared ONCE and
// used by BOTH commit-boundary rules below (the split rule and the failure-lane rule).
const releasesFence = (a) => {
  if (!a) return false;
  if (a.type === 'ApiConnection' && /'state'\s*,\s*'idle'/.test(JSON.stringify(a.inputs || {}))) return true;
  for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions,
    ...Object.values(a.cases || {}).map(c => c && c.actions)]) {
    if (sub && Object.values(sub).some(releasesFence)) return true;
  }
  return false;
};
const hasResponse = (a) => !!a && (a.type === 'Response'
  || Object.values(a.actions || {}).some(hasResponse)
  || Object.values((a.else && a.else.actions) || {}).some(hasResponse)
  || Object.values(a.cases || {}).some(c => Object.values(c.actions || {}).some(hasResponse))
  || Object.values((a.default && a.default.actions) || {}).some(hasResponse));

// ── REQUIRED ACTION INVENTORY (AZURE-CHUNK-ORG-C2-LA-CHANGES.md §B, phases P0..P7) ────────────────
// Every rule above reasons about the actions that ARE there. None of them notices an entire STAGE
// disappearing: deleting Read_creds/Gate_keys/Keys_ok left all three gates green while the
// correction route became unauthenticated. This manifest is the MINIMUM §B requires. It is written
// FROM THE SPEC — deliberately NOT derived from the artifact or from the generator, because a
// derived inventory deletes itself alongside the stage it exists to protect. Extra actions are
// legal; a MISSING one, a WRONG TYPE, a function call repointed at another route/op, or a documented
// refusal that no longer answers its documented status code is a build failure.
// ⚠ HAND-MAINTAINED ON PURPOSE. Any wave that renames a stage, changes its type, or re-codes a
// refusal MUST update this table in the same commit.
const REQUIRED_CALLS = {
  Gate_keys: 'validateKeys', Gate_proof: 'verifyProof',
  Digest: 'correctionCompute:digest',
  Verify_target_row: 'attestRows:verify', Verify_epoch: 'attestRows:verify',
  Seal_threeway: 'correctionCompute:targetSeal',
  Step_digest: 'correctionCompute:stepSetDigest', Steps_redigest: 'correctionCompute:stepSetDigest',
  Mode_gate: 'correctionCompute:modeGate', Mode_gate_rerun: 'correctionCompute:modeGate',
  Delta_cell: 'correctionCompute:deltaCell', Target_line: 'correctionCompute:targetLine',
  Stamps: 'correctionCompute:stamps', Verify_run_record: 'attestRows:verify',
  Membership: 'correctionCompute:membership', Delta: 'correctionCompute:delta',
  Candidate: 'correctionCompute:candidate', Sign_ctl: 'attestRows:sign',
  Rows_equal: 'correctionCompute:ctlRowsEqual',
  Assemble: 'correctionCompute:assembleSnapshot', Recovery_decision: 'correctionCompute:recoveryDecision',
};
const REQUIRED_STAGES = {
  Init_snapEtag: 'InitializeVariable', Init_snapData: 'InitializeVariable',
  Init_snapItemId: 'InitializeVariable', Init_row_ok: 'InitializeVariable',
  Main: 'Scope', Commit: 'Scope',
  Read_creds: 'ApiConnection', Keys_ok: 'If',                                  // P0 key gate
  Read_actor: 'ApiConnection', Proof_ok: 'If', Gate_role: 'If',                // P0 proof + role
  Journal_lookup: 'ApiConnection', Journal_branch: 'Switch',                   // P1 idempotency
  Reconcile_prepass: 'ApiConnection', Filter_foreign_prepass: 'Query', Prepass_gate: 'If',
  Get_archive_state: 'ApiConnection', State_idle_gate: 'If', Acquire: 'ApiConnection', Acquire_ok: 'If',
  Capture_snapshot: 'ApiConnection', Set_snapshot_etag: 'SetVariable',
  Set_snapshot_data: 'SetVariable', Set_snapshot_id: 'SetVariable',            // P2 acquire + capture
  Target_live: 'ApiConnection', Target_archive: 'ApiConnection', Target_gate: 'Switch',
  Get_seal_epoch: 'ApiConnection', Seal_gate: 'If',
  Steps_enumerate: 'ApiConnection', Registry_lookup: 'ApiConnection',
  Belt_tombstone: 'ApiConnection', Belt_tombstone_archive: 'ApiConnection',
  Mode_gate_ok: 'If', Lazy_gate: 'If', Lazy_register: 'ApiConnection', Lazy_reread: 'ApiConnection',
  Fetch_prior_control: 'ApiConnection', Run_record: 'ApiConnection', Compute_gate: 'If',
  Journal_create: 'ApiConnection',
  Reserve: 'ApiConnection',                                                    // P5 reservation — CREATE LANE ONLY (§B-G)
  Publish_control_row: 'If', Candidate_row: 'ApiConnection', Stamp_ctl_sig: 'ApiConnection',
  Reread_candidate: 'ApiConnection', Set_row_ok: 'SetVariable',
  Steps_recheck: 'ApiConnection', Verify_gate: 'If',
  Reread_state_restamp: 'ApiConnection', Restamp_owner_gate: 'If',
  Final_restamp: 'ApiConnection', Final_restamp_ok: 'If', Assemble_ok: 'If',
  Publish: 'ApiConnection',                                                    // P6 THE irrevocable CAS
  Outcome_by_read: 'ApiConnection', Published_gate: 'If',
  Reread_state_outcome: 'ApiConnection', Rollback_or_hold: 'If',
  Registry_terminal: 'If', Do_registry_terminal: 'ApiConnection',
  Adoption_fills: 'Foreach', Adopt_lookup: 'ApiConnection', Adopt_fill: 'If', Do_adopt_fill: 'ApiConnection',
  Journal_complete: 'ApiConnection',
  Reread_state_final: 'ApiConnection', Release_final: 'If', Do_Release_final: 'ApiConnection',
  Reread_state_abort: 'ApiConnection', Release_abort: 'If', Do_Release_abort: 'ApiConnection',
};
// THE PROTOCOL SURFACE. name -> [statusCode, the Terminate that must follow it | null].
// A refusal that is deleted, or silently re-coded, changes what the CLIENT is told to do next: a
// failed PROOF answered 403 tells the caller "you are not allowed" when the truth is "re-mint your
// proof", so it stops instead of doing the one thing that would fix it.
const REQUIRED_RESPONSES = {
  Reject_keys: [401, 'Reject_keys_stop'], Reject_proof: [401, 'Reject_proof_stop'], Reject_role: [403, 'Reject_role_stop'],
  Respond_replay: [200, 'Respond_replay_stop'], Respond_reused: [409, 'Respond_reused_stop'],
  Respond_reconcile: [202, 'Respond_reconcile_stop'], Respond_busy: [409, 'Respond_busy_stop'],
  Respond_state_busy: [409, 'Respond_state_busy_stop'], Respond_acquire_conflict: [409, 'Respond_acquire_conflict_stop'],
  Respond_no_target: [404, 'Respond_no_target_stop'], Respond_dup_target: [409, 'Respond_dup_target_stop'],
  Respond_seal: [409, 'Respond_seal_stop'], Respond_lazy: [409, 'Respond_lazy_stop'], Respond_mode: [409, 'Respond_mode_stop'],
  Respond_compute: [409, 'Respond_compute_stop'],
  Respond_verify: [409, 'Respond_verify_stop'],
  Respond_displaced: [202, 'Respond_displaced_stop'], Respond_restamp_conflict: [202, 'Respond_restamp_conflict_stop'],
  Respond_assemble: [409, 'Respond_assemble_stop'], Respond_not_published: [409, 'Respond_not_published_stop'],
  Respond_held: [202, 'Respond_held_stop'], Respond_held_outcome: [202, 'Respond_held_outcome_stop'],
  Respond_held_recovery: [202, 'Respond_held_recovery_stop'],
  Respond_held_commit: [202, 'Respond_held_commit_stop'],
  Abort_respond: [500, 'Abort_stop'], Respond_ok: [200, null],
};
for (const [n, sig] of Object.entries(REQUIRED_CALLS)) {
  const a = FLAT[n];
  if (!a) { problems.push(`MISSING REQUIRED ACTION: '${n}' (§B requires the ${sig} call) — a whole stage has been removed`); continue; }
  if (a.type !== 'Http') { problems.push(`REQUIRED ACTION '${n}' must be an Http function call, found type '${a.type}'`); continue; }
  const uri = String(a?.inputs?.uri || '');
  const route = uri.includes('/api/') ? uri.split('/api/')[1].split('?')[0] : '(none)';
  const opName = a?.inputs?.body?.op;
  const actual = route + (route === 'correctionCompute' || sig.includes(':') ? ':' + (opName || '') : '');
  if (actual !== sig) problems.push(`REQUIRED CALL REPOINTED: '${n}' must call '${sig}', found '${actual}'`);
}
for (const [n, t] of Object.entries(REQUIRED_STAGES)) {
  const a = FLAT[n];
  if (!a) problems.push(`MISSING REQUIRED ACTION: '${n}' (§B requires a '${t}' here) — a whole stage has been removed`);
  else if (a.type !== t) problems.push(`REQUIRED ACTION '${n}' must be type '${t}', found '${a.type}'`);
}
for (const [n, [code, stop]] of Object.entries(REQUIRED_RESPONSES)) {
  const a = FLAT[n];
  if (!a) { problems.push(`MISSING PROTOCOL RESPONSE: '${n}' (${code}) — this route can no longer tell the caller what happened`); continue; }
  if (a.type !== 'Response') { problems.push(`PROTOCOL RESPONSE '${n}' must be type 'Response', found '${a.type}'`); continue; }
  const actual = a?.inputs?.statusCode;
  if (actual !== code) problems.push(`PROTOCOL RESPONSE RE-CODED: '${n}' must answer ${code}, found ${actual}`);
  if (stop && (!FLAT[stop] || FLAT[stop].type !== 'Terminate')) {
    problems.push(`PROTOCOL RESPONSE '${n}' has no Terminate '${stop}' — a Response does not end a Logic App run, so execution continues past the refusal`);
  }
  // The status code alone is not the contract. A refusal that keeps its 409 and answers {ok:true}
  // tells the caller the OPPOSITE of what happened, and the inventory above would stay green.
  if (code >= 400 && a?.inputs?.body?.ok !== false) {
    problems.push(`PROTOCOL RESPONSE '${n}' answers ${code} but its body does not carry ok:false — the caller is told the opposite of the outcome`);
  }
  // FLAT[stop] is a definition-WIDE lookup: it proves a Terminate with that name exists SOMEWHERE,
  // not that it follows this Response. Unhooking its runAfter left this rule silent and the catch
  // fell to ENTRY HEADS by luck.
  // ⚠ AND THE EDGE MUST CARRY 'Succeeded'. Naming the Response in runAfter is not enough: a
  // `runAfter: {Respond_x: ['Skipped']}` names it and CAN NEVER FIRE, because a Response that ran is
  // Succeeded, not Skipped — so the refusal answers and then falls straight through, which is the
  // exact defect this rule exists to catch. Presence is not an edge; the STATUS SET is the edge.
  // (This is the same status-blindness fixed 300 lines up in the ETag rule — presence-vs-value — and
  // it went in with the very wave that fixed the other one. Check the statuses, not the keys.)
  const stopA = stop && FLAT[stop];
  if (stopA) {
    const statuses = (stopA.runAfter || {})[n];
    if (!Array.isArray(statuses)) {
      problems.push(`PROTOCOL RESPONSE '${n}': its Terminate '${stop}' no longer runs after it — the Response does not end the run and execution continues past the refusal`);
    } else if (!statuses.map(s => String(s).toLowerCase()).includes('succeeded')) {
      problems.push(`PROTOCOL RESPONSE '${n}': its Terminate '${stop}' runs after it only on [${statuses.join(', ')}] — a Response that RAN is 'Succeeded', so this edge can never fire and the refusal falls through`);
    }
  }
}

// ── WHAT A GATE ACTUALLY TESTS ────────────────────────────────────────────────────────────────────
// Every rule above this line polices a gate's SHAPE — that it exists, is an If, has a terminating
// else, answers the right status code. NOT ONE of them reads the condition. Replace the whole of
// `Compute_gate.expression` with `{and:[{equals:[true,true]}]}` and the definition is structurally
// perfect: the gate is present, its else still refuses and terminates, every stage is in place — and
// it passes everything, always. The refusal branch becomes dead code and every compute refusal
// publishes. The same hole covers the seal check and the P5.4 verify.
// So: pin the TERMS. Each gate must still mention the evidence it is supposed to be judging. This is
// deliberately a SUBSTRING test over the serialized expression, not an exact match — it must not
// fight ordinary rewording (`and()` folded into sibling terms, a coalesce default changed), only
// notice when the evidence itself stops being consulted.
const REQUIRED_GATE_TERMS = {
  // authorisation — the three that decide WHO may correct
  Keys_ok:            ['Gate_keys', 'directorOk'],
  Proof_ok:           ['Gate_proof', 'ok'],
  Gate_role:          ['Gate_proof', 'role', 'director'],
  // pre-conditions
  Prepass_gate:       ['Filter_foreign_prepass', 'length'],
  State_idle_gate:    ['Get_archive_state', 'idle'],
  Acquire_ok:         ['Acquire', 'statusCode'],
  // the seal three-way — the gate that decides whether the target is trustworthy at all
  Seal_gate:          ['Seal_threeway', 'outcome', 'valid', 'unsealed-legacy'],
  Mode_gate_ok:       ['Mode_gate', 'ok'],
  // the P4 refusal gate — ALL THREE compute ops, or a refusal is laundered into a publish
  Compute_gate:       ['Delta_cell', 'Delta', 'Candidate'],
  // P5.4 — the re-read verification and the step-set digest re-check
  Verify_gate:        ['rowOk', 'Steps_redigest', 'Step_digest'],
  // ownership at the commit boundary
  Restamp_owner_gate: ['Reread_state_restamp', 'owner', 'workflow'],
  Final_restamp_ok:   ['Final_restamp', 'statusCode'],
  Assemble_ok:        ['Assemble', 'ok'],
  // the publish verdict
  Published_gate:     ['Recovery_decision', 'roll_forward'],
};
for (const [gate, terms] of Object.entries(REQUIRED_GATE_TERMS)) {
  const a = FLAT[gate];
  if (!a) { problems.push(`MISSING GATE: '${gate}' — a decision gate named in REQUIRED_GATE_TERMS is gone`); continue; }
  if (a.type !== 'If') { problems.push(`GATE '${gate}' must be type 'If', found '${a.type}'`); continue; }
  const src = JSON.stringify(a.expression || {});
  const missing = terms.filter(t => !src.includes(t));
  if (missing.length) {
    problems.push(`GATE NO LONGER TESTS ITS EVIDENCE: '${gate}' does not mention [${missing.join(', ')}] — its condition has stopped consulting what it exists to judge, so the refusal branch is dead code: ${src.slice(0, 160)}`);
  }
}

// A CONDITION BUILT ONLY FROM LITERALS IS NOT A CONDITION. `equals: [true, true]` and
// `equals: ['x','x']` are constants: one branch is unreachable for every input the route will ever
// see. Catches the same class as the table above on gates the table does not name (and on any gate
// added later), so a new gate cannot ship pre-decided.
(function noTautologies(actions, scopePath) {
  for (const [name, a] of Object.entries(actions || {})) {
    const where = scopePath ? `${scopePath} > ${name}` : name;
    if (a.type === 'If') {
      // WALK TO THE LEAVES. `and`/`or`/`not` are CONNECTIVES, and their operand arrays hold clause
      // OBJECTS, not values — reading them as a comparison finds no string operand and reports every
      // multi-term gate in the definition as a tautology. (It did: three of them, on the first run.
      // A rule that reports non-bugs is how a real one gets skimmed past.) Only a leaf comparison has
      // value operands, so only a leaf can be a tautology.
      (function leaves(node) {
        if (!node || typeof node !== 'object') return;
        for (const [opName, operands] of Object.entries(node)) {
          if (['and', 'or', 'not'].includes(opName)) { (Array.isArray(operands) ? operands : [operands]).forEach(leaves); continue; }
          if (!Array.isArray(operands) || operands.length < 2) continue;
          // an operand is EVIDENCE if it reaches out of the definition for a value
          const evidence = operands.some(o => typeof o === 'string' && /@|body\(|outputs\(|variables\(|triggerBody\(|workflow\(|items\(|length\(|empty\(/.test(o));
          if (!evidence) problems.push(`TAUTOLOGICAL GATE: '${where}' tests ${opName}(${operands.map(o => JSON.stringify(o)).join(', ')}) — both operands are literals, so this gate has already decided and one branch is unreachable`);
        }
      })(a.expression);
    }
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions,
      ...Object.values(a.cases || {}).map(c => c && c.actions)]) if (sub) noTautologies(sub, where);
  }
})(def.actions, '');

// ── NO REFUSAL MAY RUN BETWEEN THE RESERVATION AND THE PUBLISH ────────────────────────────────────
// Registry `TargetTransactionId` is ENFORCE-UNIQUE and this route contains NO registry delete. So a
// refusal lane that runs after `Reserve` leaves a row nothing will ever remove, and every future
// correction of that transaction — by anyone, forever — dies on the unique constraint. The refusal
// bricks its own target. That is invisible today only because the route refuses before it ever
// reaches Reserve; fixing the request contract is precisely what arms it.
// Lanes BELOW `Publish` are the exception and are deliberately allowed: past the commit boundary the
// correction may already have landed, and §B step 19 wants the pending registry row left in place for
// the reconcile sub-flow to roll forward. So the rule is not "no refusals after Reserve" — it is "no
// refusals in the window between Reserve and Publish".
// Written as REACHABILITY, not as a hard-coded position, so it keeps holding when a gate is added.
{
  const kids = new Map();            // action -> actions that can only run after it
  (function edges(actions, parent) {
    const add = (from, to) => { if (!kids.has(from)) kids.set(from, new Set()); kids.get(from).add(to); };
    for (const [name, a] of Object.entries(actions || {})) {
      if (parent) add(parent, name);                       // entering a scope happens after its owner
      for (const dep of Object.keys(a.runAfter || {})) add(dep, name);
      for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions,
        ...Object.values(a.cases || {}).map(c => c && c.actions)]) if (sub) edges(sub, name);
    }
  })(def.actions, null);
  const reach = (start) => {
    const seen = new Set(); const stack = [start];
    while (stack.length) { for (const n of kids.get(stack.pop()) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
    return seen;
  };
  // THE BOUNDARY IS THE CONTAINING SCOPE, NOT THE ACTION. `Publish` lives inside the Commit scope,
  // and the post-commit hold handler hangs off `Commit: [Failed, TimedOut]` — a SIBLING of the scope,
  // so it is not a descendant of Publish, yet it is unambiguously past the point of no return: the
  // Commit scope failing is exactly the "the publish may have landed" case. Seeding the exempt set
  // from Publish alone reported it as a bricking lane (it is not — §B step 19 WANTS the pending
  // registry row there for reconcile). Anything reachable from entering the commit scope is post-commit.
  const scopeOfPublish = Object.keys(FLAT).find(n => FLAT[n].type === 'Scope' && FLAT[n].actions && Object.keys(FLAT[n].actions).includes('Publish'));
  if (!FLAT.Reserve) problems.push(`MISSING 'Reserve' — the registry reservation stage is gone`);
  else if (!FLAT.Publish) problems.push(`MISSING 'Publish' — cannot locate the commit boundary`);
  else {
    const afterReserve = reach('Reserve');
    const afterPublish = new Set([...reach('Publish'), 'Publish']);
    if (scopeOfPublish) for (const n of [...reach(scopeOfPublish), scopeOfPublish]) afterPublish.add(n);
    for (const [n, [code, stop]] of Object.entries(REQUIRED_RESPONSES)) {
      if (!stop || !FLAT[n]) continue;                    // only run-ENDING refusals matter
      if (code < 400 && code !== 202) continue;           // 200 is the success answer
      if (afterReserve.has(n) && !afterPublish.has(n)) {
        problems.push(`REFUSAL AFTER RESERVE: '${n}' (${code}) can run once the registry reservation exists but before the publish — nothing deletes a registry item and TargetTransactionId is Enforce-Unique, so this refusal leaves its target PERMANENTLY UNCORRECTABLE. Move 'Reserve' below this lane, or delete the reservation on it.`);
      }
    }
  }
}

// ── THE COMMIT BOUNDARY, PART 1: the SPLIT must exist and its handler must HOLD ────────────────────
// `Publish` is the irrevocable snapshot MERGE. A failure AFTER it can leave the journal non-terminal
// and the registry un-committed over an ALREADY-PUBLISHED snapshot. The generic abort handler is the
// WRONG catcher there: it hands the coordination fence back and answers 500, so the archive LA or the
// next correction runs over an unreconciled snapshot. §B step 19 pins the opposite posture — HOLD:
// respond, terminate, release NOTHING, and let the B-R reconcile sub-flow own the journal. So the
// post-commit actions must sit in their OWN Scope, and that Scope's failure handler must not release.
// This is the rule that stops a later P7 addition from silently inheriting the releasing handler.
function scopeChainOf(name) {
  let found = null;
  (function w(node, stack) {
    for (const [k, a] of Object.entries(node || {})) {
      if (found) return;
      if (k === name) { found = stack; return; }
      const next = a.type === 'Scope' ? stack.concat([{ scopeName: k, siblings: node }]) : stack;
      for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) if (sub) w(sub, next);
      for (const c of Object.values(a.cases || {})) if (c.actions) w(c.actions, next);
    }
  })(def.actions, []);
  return found;
}
const pubChain = scopeChainOf('Publish');
const acqChain = scopeChainOf('Acquire') || [];
if (!pubChain || pubChain.length === 0) {
  problems.push("COMMIT BOUNDARY: no 'Publish' action inside a Scope — the post-commit containment rule cannot be enforced");
} else {
  const inner = pubChain[pubChain.length - 1];
  if (acqChain.some(s => s.scopeName === inner.scopeName)) {
    problems.push(`COMMIT BOUNDARY NOT SPLIT: 'Publish' shares its innermost Scope '${inner.scopeName}' with the pre-commit 'Acquire' — a post-publish failure is caught by the releasing abort handler, which hands the fence back over an unreconciled snapshot`);
  }
  const heads = Object.entries(inner.siblings)
    .filter(([, sib]) => { const st = (sib.runAfter || {})[inner.scopeName] || []; return st.includes('Failed') && st.includes('TimedOut'); })
    .map(([n]) => n);
  if (heads.length === 0) {
    problems.push(`COMMIT BOUNDARY UNHANDLED: Scope '${inner.scopeName}' has no sibling running on both [Failed,TimedOut] — a post-publish failure ends the run with no Response`);
  } else {
    const seen = new Set(heads); const queue = [...heads]; let responds = false;
    while (queue.length) {
      const cur = queue.shift();
      const a = inner.siblings[cur];
      if (!a) continue;
      if (releasesFence(a)) problems.push(`COMMIT BOUNDARY RELEASES: post-commit failure handler '${cur}' writes the coordination state back to 'idle' — post-P6 failures must HOLD the fence for the reconcile sub-flow, never release it`);
      if (hasResponse(a)) responds = true;
      for (const [n, sib] of Object.entries(inner.siblings)) {
        if (seen.has(n)) continue;
        if (Object.keys(sib.runAfter || {}).includes(cur)) { seen.add(n); queue.push(n); }
      }
    }
    if (!responds) problems.push(`COMMIT BOUNDARY UNANSWERED: the failure handler for Scope '${inner.scopeName}' never reaches a Response — the caller hangs after an irrevocable publish`);
  }
}

// ── THE COMMIT BOUNDARY, PART 2: no fence release on ANY post-commit FAILURE lane (§B step 19) ─────
// Once `Publish` has been ATTEMPTED, a failure path must NOT hand the coordination fence back:
// releasing it lets the archive LA run over a snapshot nobody has reconciled. The ONE legal release
// after the commit is the CONFIRMED lane (Journal_complete -> Reread_state_final -> Release_final)
// and the adjudicated needs_manual lane, neither of which is a FAILURE lane. A post-commit cleanup
// that releases on FAILURE is a perfectly well-formed release in the wrong PHASE — no structural rule
// could see it. `Publish -> Outcome_by_read` is whitelisted because a failed Publish is adjudicated
// by READ-BACK, not by cleanup; any OTHER failure edge out of Publish is a cleanup lane and is judged.
// FAIL-CLOSED AND DERIVED, NEVER AN OPT-IN LIST. A hand-kept set of names leaves every post-commit
// action a later wave appends UNJUDGED by default — the exact opposite of the ordinal split, whose
// whole point is that the post-commit region is defined BY CONSTRUCTION. And enumerating only the
// Scope's DIRECT CHILDREN left a blind spot shaped exactly like this codebase: every
// releasingRefusal() emits its Reread_state_X -> Release_X pair NESTED inside an If's else, so a
// post-commit cleanup written in the house style released the fence and the walker never saw the
// edge. EVERY action anywhere inside the commit Scope is commit-critical.
const COMMIT_SCOPE = (pubChain && pubChain.length) ? pubChain[pubChain.length - 1].scopeName : null;
const COMMIT_CRITICAL = (() => {
  const out = [];
  (function rec(acts) {
    for (const [n, x] of Object.entries(acts || {})) {
      out.push(n);
      for (const sub of [x.actions, x.else && x.else.actions, x.default && x.default.actions,
        ...Object.values(x.cases || {}).map(c => c && c.actions)]) if (sub) rec(sub);
    }
  })(COMMIT_SCOPE && FLAT[COMMIT_SCOPE] ? FLAT[COMMIT_SCOPE].actions : {});
  return out;
})();
// The ONLY sanctioned post-commit releases, each an ADJUDICATED lane rather than a cleanup lane: a
// failed Publish is settled by READ-BACK (C2-R1-10), and Release_final is gated on its OWN re-read
// of the coordination row, so a failed re-read cannot release. Anything added here must carry that
// same argument IN WRITING — this map is the auditable record of every deliberate exception.
const ADJUDICATION_LANE = { Publish: 'Outcome_by_read', Reread_state_final: 'Release_final' };
(function commitPhase(actions) {
  for (const [name, a] of Object.entries(actions || {})) {
    if (a.actions) commitPhase(a.actions);
    if (a.else && a.else.actions) commitPhase(a.else.actions);
    for (const c of Object.values(a.cases || {})) if (c.actions) commitPhase(c.actions);
    if (a.default && a.default.actions) commitPhase(a.default.actions);
    for (const [dep, statuses] of Object.entries(a.runAfter || {})) {
      if (!COMMIT_CRITICAL.includes(dep)) continue;
      if (ADJUDICATION_LANE[dep] === name) continue;
      if (!(statuses || []).some(s => s === 'Failed' || s === 'TimedOut')) continue;
      const seenF = new Set([name]); const q = [name];
      while (q.length) {
        const cur = q.shift();
        if (releasesFence(actions[cur])) {
          problems.push(`POST-COMMIT FENCE RELEASE: '${cur}' releases the coordination fence on the failure lane '${dep}' -> '${name}' — after the irrevocable publish the fence must stay HELD for the reconcile sub-flow (§B step 19)`);
          break;
        }
        for (const [n2, sib] of Object.entries(actions)) {
          if (seenF.has(n2)) continue;
          if (Object.keys(sib.runAfter || {}).includes(cur)) { seenF.add(n2); q.push(n2); }
        }
      }
    }
  }
})(def.actions);

const raw = fs.readFileSync(file, 'utf8');
const keyish = raw.match(/code=(?!@@FN_KEY@@)[A-Za-z0-9_\-~=]{20,}/g);
if (keyish) problems.push(`FUNCTION KEY LEAK: ${keyish.length} literal key(s) in the file`);
if (!/@@FN_KEY@@/.test(raw)) problems.push('no @@FN_KEY@@ placeholders found — key injection would silently no-op');

// Report
console.log(`definition: ${path.basename(file)}`);
console.log(`  scopes ${scopes} · actions ${actionCount} · Response terminals ${responses} · CAS merges ${merges}`);
if (problems.length === 0) {
  console.log('\n==== STRUCTURE OK — 0 problems ====');
  process.exit(0);
}
console.log(`\n==== ${problems.length} PROBLEM(S) ====`);
for (const p of problems) console.log('  - ' + p);
process.exit(1);
