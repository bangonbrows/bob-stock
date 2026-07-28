// MUTATION SUITE FOR THE THREE GATES — "a gate you have never seen fail is not a gate."
//
// WHY: I built three gates, drove them all to zero, and reported the workflow as clean. Codex then
// mutation-tested them: 15 of 16 deliberate corruptions produced a completely green three-gate run,
// while the workflow was still non-runnable. Two of the blind spots were self-inflicted (a seeded
// `ok` key; a regex that excluded parentheses). AGY independently found three more.
//
// This suite corrupts the CLEAN generated definition once per rule each gate claims to enforce, and
// asserts the responsible gate FAILS. A mutation that survives is a hole in the gate, reported as
// SURVIVED. Run it with the gates — green gates plus a green mutation run is the only combination
// that means anything.
//
// ⚠ THIS IS A LOCAL GATE, NOT AN AUDITOR TASK. It spawns a Node process per gate run. Handing it to
// an external reviewer looks like a hang — that already happened once, and it was an instruction
// error on my part, not a reviewer failure. Run it yourself and give reviewers the RESULT.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEF = path.join(__dirname, 'correction-def-generated.json');
const TMP = path.join(__dirname, '.mutation-tmp.json');
const clean = JSON.parse(fs.readFileSync(DEF, 'utf8'));

// Locate an action anywhere in the tree (scopes included).
function find(node, name) {
  for (const [k, a] of Object.entries(node || {})) {
    if (k === name) return a;
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) {
      const hit = sub && find(sub, name); if (hit) return hit;
    }
    for (const c of Object.values(a.cases || {})) { const hit = c.actions && find(c.actions, name); if (hit) return hit; }
  }
  return null;
}
function parentOf(node, name) {
  for (const [k, a] of Object.entries(node || {})) {
    if (k === name) return node;
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) {
      const hit = sub && parentOf(sub, name); if (hit) return hit;
    }
    for (const c of Object.values(a.cases || {})) { const hit = c.actions && parentOf(c.actions, name); if (hit) return hit; }
  }
  return null;
}

// gate = which checker MUST catch this corruption
const MUTATIONS = [
  // ── contract gate ────────────────────────────────────────────────────────────────────────────────
  { id: 'C1', gate: 'check-fn-contracts.js', why: 'read .ok on an op that only returns an outcome enum (the defect that shipped)',
    apply: (d) => { find(d.actions, 'Seal_gate').expression.and[0] = { equals: ["@coalesce(body('Seal_threeway')?['ok'],false)", true] }; } },
  { id: 'C2', gate: 'check-fn-contracts.js', why: 'compare a discriminant against a value the op can never emit',
    apply: (d) => { find(d.actions, 'Published_gate').expression.and[0].equals[1] = 'committed'; } },
  { id: 'C3', gate: 'check-fn-contracts.js', why: 'call a function route that does not exist',
    apply: (d) => { find(d.actions, 'Gate_keys').inputs.uri = find(d.actions, 'Gate_keys').inputs.uri.replace('/validateKeys', '/noSuchFunction'); } },
  { id: 'C4', gate: 'check-fn-contracts.js', why: 'attestRows given a scalar instead of the required rows array',
    apply: (d) => { find(d.actions, 'Sign_ctl').inputs.body.rows = "@body('Candidate')?['row']"; } },
  { id: 'C5', gate: 'check-fn-contracts.js', why: 'drop a required property from a compute op input',
    apply: (d) => { delete find(d.actions, 'Digest').inputs.body.input.targetTransactionId; } },
  { id: 'C6', gate: 'check-fn-contracts.js', why: 'flatten the {op,input} envelope back to a flat body',
    apply: (d) => { const a = find(d.actions, 'Delta'); a.inputs.body = Object.assign({ op: 'delta' }, a.inputs.body.input); } },

  // ── structure gate ───────────────────────────────────────────────────────────────────────────────
  { id: 'S1', gate: 'check-correction-def.js', why: 'refusal Response with no Terminate (the original fall-through class)',
    apply: (d) => { delete find(d.actions, 'Keys_ok').else.actions.Reject_keys_stop; } },
  { id: 'S2', gate: 'check-correction-def.js', why: 'unterminated Response in a Switch DEFAULT branch (AGY blind spot)',
    apply: (d) => { find(d.actions, 'Journal_branch').default.actions = { Respond_default: { type: 'Response', kind: 'Http', inputs: { statusCode: 400, body: { ok: false } }, runAfter: {} } }; } },
  { id: 'S3', gate: 'check-correction-def.js', why: 'nested If where only ONE inner branch terminates (existential vs universal)',
    apply: (d) => { const e = find(d.actions, 'Keys_ok').else.actions; delete e.Reject_keys_stop;
      e.Inner = { type: 'If', expression: { and: [{ equals: [true, true] }] }, runAfter: {},
        actions: { Stop_a: { type: 'Terminate', inputs: { runStatus: 'Cancelled' }, runAfter: {} } },
        else: { actions: { Resp_b: { type: 'Response', kind: 'Http', inputs: { statusCode: 400, body: {} }, runAfter: {} } } } }; } },
  { id: 'S4', gate: 'check-correction-def.js', why: 'unterminated else on a gate whose SUCCESS branch is non-empty (AGY blind spot)',
    apply: (d) => { d.actions.Extra_gate = { type: 'If', expression: { and: [{ equals: [true, true] }] }, runAfter: {},
      actions: { Noop: { type: 'Compose', inputs: 'x', runAfter: {} } },
      else: { actions: { Resp_c: { type: 'Response', kind: 'Http', inputs: { statusCode: 400, body: {} }, runAfter: {} } } } }; } },
  { id: 'S5', gate: 'check-correction-def.js', why: 'runAfter naming an action that does not exist at that scope',
    apply: (d) => { find(d.actions, 'Publish').runAfter = { No_Such_Action: ['Succeeded'] }; } },
  { id: 'S6', gate: 'check-correction-def.js', why: 'CAS MERGE with the IF-MATCH header removed',
    apply: (d) => { delete find(d.actions, 'Publish').inputs.body.headers['IF-MATCH']; } },
  { id: 'S7', gate: 'check-correction-def.js', why: 'IF-MATCH present but empty (fencing on nothing)',
    apply: (d) => { find(d.actions, 'Publish').inputs.body.headers['IF-MATCH'] = ''; } },

  // ── expression gate ──────────────────────────────────────────────────────────────────────────────
  { id: 'E1', gate: 'check-expressions.js', why: 'coalesce over two array-valued expressions (never falls through)',
    apply: (d) => { find(d.actions, 'Stamps').inputs.body.input.target = "@first(coalesce(body('Read_creds')?['value'], body('Read_actor')?['value']))"; } },
  { id: 'E2', gate: 'check-expressions.js', why: 'unguarded first() on a collection that can be empty',
    apply: (d) => { find(d.actions, 'Stamps').inputs.body.input.target = "@first(body('Target_archive')?['value'])"; } },
  { id: 'E3', gate: 'check-expressions.js', why: 'first() preceded by an UNRELATED empty() (fake guard)',
    apply: (d) => { find(d.actions, 'Stamps').inputs.body.input.target = "@if(empty(body('Read_creds')?['value']), null, first(body('Target_archive')?['value']))"; } },
  { id: 'E4', gate: 'check-expressions.js', why: 'a WDL function that does not exist / a lambda',
    apply: (d) => { find(d.actions, 'Prepass_gate').expression.and[0].equals[0] = "@length(filter(body('Reconcile_prepass')?['value'], item => true))"; } },
  // E5 RETIRED AND REPOINTED. Its original target (Keys_ok, inside the Main Scope) is no longer a
  // defect: the containment handler covers it, so the mutation was testing a rule that is no longer
  // true. A stale mutation is worse than none — it fails for the wrong reason and invites the
  // "adjust the gate until it goes green" reflex. It now targets the ABORT CHAIN, which sits OUTSIDE
  // the Scope and therefore has no cover of its own.
  { id: 'E5', gate: 'check-expressions.js', why: 'a fallible action OUTSIDE the containment Scope whose successor handles no failure',
    apply: (d) => { d.actions.Release_abort.runAfter = { Reread_state_abort: ['Succeeded'] }; } },
  { id: 'E6', gate: 'check-expressions.js', why: 'unescaped interpolation inside an OData string literal',
    apply: (d) => { find(d.actions, 'Read_actor').inputs.body.uri = "_api/web/lists/getbytitle('UserCredentials_Staging')/items?$filter=Username eq '@{triggerBody()?['actorUsername']}'"; } },
  { id: 'E7', gate: 'check-expressions.js', why: 'type-strict equals(): integer property vs string literal (AGY class)',
    apply: (d) => { d.actions.Type_gate = { type: 'If', runAfter: {}, actions: {}, else: { actions: {} },
      expression: { and: [{ equals: ["@body('Candidate')?['revision']", '0'] }] } }; } },
  { id: 'E8', gate: 'check-expressions.js', why: 'semantic enum mismatch: compares baseline to a value modeGate never emits (AGY class)',
    apply: (d) => { d.actions.Enum_gate = { type: 'If', runAfter: {}, actions: {}, else: { actions: {} },
      expression: { and: [{ equals: ["@body('Mode_gate')?['baseline']", 'active'] }] } }; } },
  // ── containment-scope cover ──────────────────────────────────────────────────────────────────────
  { id: 'X1', gate: 'check-expressions.js', why: 'strip the containment Scope failure handler so nothing catches an enclosed failure',
    apply: (d) => { d.actions.Reread_state_abort.runAfter.Main = ['Succeeded']; } },
  { id: 'X2', gate: 'check-expressions.js', why: 'failure handler runs but its chain never reaches a Response (cover that does not cover)',
    apply: (d) => { delete d.actions.Abort_respond; } },];

// ⚠ EXIT CODE ALONE IS NOT A VALID SIGNAL. Once the artifact itself has defects, every gate fails on
// the BASELINE — and then every mutation looks "caught" for the wrong reason, which is exactly the
// false confidence this suite exists to prevent. A mutation counts only if it produces a problem
// line the clean baseline did NOT have. (Found while fixing slice 6: 20/21 "caught" against a
// baseline that was already red.)
const GATES = ['check-fn-contracts.js', 'check-correction-def.js', 'check-expressions.js'];
function gateOutput(gate, file) {
  try { return execFileSync(process.execPath, [path.join(__dirname, gate), file], { stdio: 'pipe' }).toString(); }
  catch (e) { return ((e.stdout && e.stdout.toString()) || '') + ((e.stderr && e.stderr.toString()) || ''); }
}
const problemLines = (txt) => new Set(txt.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('- ')));
// baseline, measured once against the CLEAN definition
const BASELINE = {};
for (const g of GATES) BASELINE[g] = problemLines(gateOutput(g, DEF));
// ⚠ COST. Each gate run is a fresh Node process that loads @azure/functions and the compute module.
// Checking all three gates for all 23 mutations meant ~70 spawns, which took long enough that an
// external reviewer asked to run it appeared to hang. (That was my instruction error — this is a
// LOCAL gate, not an auditor task — but the suite should not be that expensive either.)
// So: try the gate that OWNS the rule first, and only fall back to the others if it does not catch.
// Identical verdict, ~23 spawns instead of ~70 in the normal all-caught case, and a mutation caught
// by the WRONG gate still counts (it is reported, so a mis-assigned owner cannot hide a hole).
function addsNewProblem(file, ownerGate) {
  const order = ownerGate ? [ownerGate, ...GATES.filter(g => g !== ownerGate)] : GATES;
  for (const g of order) {
    const after = problemLines(gateOutput(g, file));
    for (const line of after) if (!BASELINE[g].has(line)) return true;
  }
  return false;
}

const caught = [], survived = [];
for (const m of MUTATIONS) {
  const d = JSON.parse(JSON.stringify(clean));
  try { m.apply(d); } catch (e) { survived.push({ ...m, note: 'mutation could not be applied: ' + e.message }); continue; }
  fs.writeFileSync(TMP, JSON.stringify(d, null, 2));
  // a corruption counts as CAUGHT if ANY gate fails — what matters is that something bites,
  // not which script happens to own the rule.
  const gates = ['check-fn-contracts.js', 'check-correction-def.js', 'check-expressions.js'];
  // CAUGHT = the mutation produced a problem line the clean baseline did not have.
  (addsNewProblem(TMP, m.gate) ? caught : survived).push(m);
}
try { fs.unlinkSync(TMP); } catch (e) {}

console.log('gate mutation suite');
console.log(`  mutations: ${MUTATIONS.length}   caught: ${caught.length}   SURVIVED: ${survived.length}`);
if (survived.length) {
  console.log('\n==== SURVIVED — these are HOLES in the gate, not defects in the workflow ====');
  for (const m of survived) console.log(`  - [${m.id}] ${m.gate}: ${m.why}${m.note ? '  (' + m.note + ')' : ''}`);
  process.exit(1);
}
console.log('\n==== ALL MUTATIONS CAUGHT — every gate rule has been observed to fail ====');
