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

// ── 0. GENERATOR / ARTIFACT EQUIVALENCE (runs before anything else) ────────────────────────────────
// Every rule in this suite mutates the JSON ARTIFACT. Not one of them notices the artifact drifting
// away from gen-correction-def.js — a hand-edit to the JSON, or a generator change nobody
// regenerated, and the whole gate stack is faithfully validating a file the deploy step will
// overwrite. The external mutation review named this exactly: "it mutates the JSON artifact only; it
// does not establish generator/artifact equivalence." So: regenerate into a temp file and require a
// byte-identical result.
// EOL-NORMALISED. A CRLF checkout would otherwise fail this on every Windows machine for no reason,
// which is how a real drift signal gets trained away.
// DELIBERATELY NOT ONE OF `GATES`: every mutation below writes a temp file, so a regenerate-and-diff
// applied per-mutation would "catch" all of them for the wrong reason and hide every real hole.
const GEN = path.join(__dirname, 'gen-correction-def.js');
const REGEN = path.join(__dirname, '.regen-check.json');
try { execFileSync(process.execPath, [GEN, REGEN], { stdio: 'pipe' }); }
catch (e) {
  console.log('==== GENERATOR DID NOT RUN ====');
  console.log('  ' + ((e.stderr && e.stderr.toString()) || e.message));
  process.exit(1);
}
{
  const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const artifact = norm(DEF), fresh = norm(REGEN);
  try { fs.unlinkSync(REGEN); } catch (e) {}
  if (artifact !== fresh) {
    const al = artifact.split('\n'), bl = fresh.split('\n');
    let i = 0; while (i < al.length && i < bl.length && al[i] === bl[i]) i++;
    console.log('==== GENERATOR / ARTIFACT DRIFT ====');
    console.log('  correction-def-generated.json is NOT what gen-correction-def.js produces.');
    console.log(`  first difference at line ${i + 1}:`);
    console.log(`    artifact : ${(al[i] === undefined ? '(end of file)' : al[i].trim()).slice(0, 150)}`);
    console.log(`    generator: ${(bl[i] === undefined ? '(end of file)' : bl[i].trim()).slice(0, 150)}`);
    console.log('  Everything below this line would have validated a file the deploy step overwrites.');
    console.log('  Fix: run `node gen-correction-def.js`, re-read the diff, then re-run the gates.');
    process.exit(1);
  }
  console.log('generator/artifact equivalence: OK — the artifact is a byte-for-byte regeneration');
}

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
      e.Inner = { type: 'If', expression: { and: [{ equals: ["@variables('rowOk')", true] }] }, runAfter: {},
        actions: { Stop_a: { type: 'Terminate', inputs: { runStatus: 'Cancelled' }, runAfter: {} } },
        else: { actions: { Resp_b: { type: 'Response', kind: 'Http', inputs: { statusCode: 400, body: {} }, runAfter: {} } } } }; } },
  { id: 'S4', gate: 'check-correction-def.js', why: 'unterminated else on a gate whose SUCCESS branch is non-empty (AGY blind spot)',
    apply: (d) => { d.actions.Extra_gate = { type: 'If', expression: { and: [{ equals: ["@variables('rowOk')", true] }] }, runAfter: {},
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
    apply: (d) => { delete d.actions.Abort_respond; } },

  // ── commit-boundary cover (post-P6 containment) ───────────────────────────────────────────────────
  // The generic abort handler RELEASES the fence and answers 500. That is correct BEFORE the publish
  // and unsafe AFTER it, so P6/P7 live in their own `Commit` Scope with a handler that HOLDS. These
  // two prove the structure gate notices when that split is undone.
  { id: 'X3', gate: 'check-correction-def.js', why: 'collapse the commit-boundary split — post-publish actions back inside the releasing Main scope',
    apply: (d) => { const m = d.actions.Main.actions; Object.assign(m, m.Commit.actions); delete m.Commit; delete m.Respond_held_commit; delete m.Respond_held_commit_stop; } },
  { id: 'X4', gate: 'check-correction-def.js', why: 'post-commit handler that RELEASES the fence instead of holding it for reconcile',
    apply: (d) => { const m = d.actions.Main.actions;
      m.Release_after_commit = { type: 'ApiConnection', runAfter: { Commit: ['Failed', 'TimedOut'] },
        inputs: { host: {}, method: 'post', path: '/x', body: { method: 'POST', uri: 'x',
          headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': "@{variables('snapEtag')}" },
          body: { ConfigData: "@{string(setProperty(json('{}'),'state','idle'))}" } } } };
      m.Respond_held_commit.runAfter = { Release_after_commit: ['Succeeded', 'Failed', 'TimedOut'] }; } },

  // ── SEMANTIC INVARIANTS ─────────────────────────────────────────────────────────────────────────
  // The thirteen corruptions an external reviewer ran against the previous gate set. TWELVE OF THEM
  // SURVIVED. Its diagnosis was not "add more mutations" — it was that the suite "covers exact
  // mutation encodings well, but lacks semantic invariants such as required action inventories,
  // mandatory dependency ancestry, WDL parsing, case-insensitive headers, typed ETags, and
  // commit-phase-aware failure policy." Every one of these now has a RULE behind it, and these
  // thirteen are the standing proof that the rule bites. Do not delete one because it "duplicates"
  // an S/E/C mutation: those test encodings, these test meanings.
  { id: 'M1', gate: 'check-fn-contracts.js', why: "attestRows rows = json('{}') — an OBJECT wearing an array-ish wrapper",
    apply: (d) => { find(d.actions, 'Verify_target_row').inputs.body.rows = "@json('{}')"; } },
  { id: 'M2', gate: 'check-fn-contracts.js', why: 'attestRows rows = a SCALAR read inside an array-ish coalesce',
    apply: (d) => { find(d.actions, 'Verify_target_row').inputs.body.rows = "@coalesce(body('Target_live')?['row'],json('{}'))"; } },
  { id: 'M3', gate: 'check-expressions.js', why: 'an expression reads an action that is NOT a runAfter ancestor (the execution-order race)',
    apply: (d) => { delete find(d.actions, 'Delta').runAfter.Delta_cell; } },
  // M4 targets the COMMIT SCOPE, not Publish itself: since the containment split, Publish is the
  // Commit scope's single (correct) entry head, so clearing ITS runAfter is a no-op. Clearing the
  // Commit scope's runAfter is the same corruption at the new boundary — the whole irrevocable region
  // becomes a second entry head of Main and races the auth gate, the fence and the compute chain.
  { id: 'M4', gate: 'check-correction-def.js', why: 'remove the Commit scope runAfter — the irrevocable post-publish region becomes a second scope entry head',
    apply: (d) => { find(d.actions, 'Commit').runAfter = {}; } },
  { id: 'M5', gate: 'check-correction-def.js', why: "lowercase 'x-http-method: merge' with NO IF-MATCH (headers are case-insensitive at runtime)",
    apply: (d) => { const a = find(d.actions, 'Publish'); delete a.inputs.body.headers['X-HTTP-Method']; delete a.inputs.body.headers['IF-MATCH']; a.inputs.body.headers['x-http-method'] = 'merge'; } },
  { id: 'M6', gate: 'check-correction-def.js', why: 'IF-MATCH: "@{null}" — present, non-empty, and not a fence',
    apply: (d) => { find(d.actions, 'Publish').inputs.body.headers['IF-MATCH'] = '@{null}'; } },
  { id: 'M7', gate: 'check-expressions.js', why: 'doubled-quote syntax inside a bare @{} interpolation — a WDL parse error, not a value',
    apply: (d) => { const a = find(d.actions, 'Read_actor'); a.inputs.body.uri = a.inputs.body.uri.replace("triggerBody()?['actorUsername']", "triggerBody()?[''actorUsername'']"); } },
  { id: 'M8', gate: 'check-fn-contracts.js', why: 'an impossible enum comparison written in STRING-form WDL rather than as a JSON operand pair',
    apply: (d) => { find(d.actions, 'Published_gate').expression.and[0] = { equals: ["@equals(coalesce(body('Recovery_decision')?['decision'],''),'committed')", true] }; } },
  { id: 'M9', gate: 'check-fn-contracts.js', why: 'read a handler property through outputs() rather than body() — always null',
    apply: (d) => { find(d.actions, 'Publish').inputs.body.body.ConfigData = "@{outputs('Assemble')?['configData']}"; } },
  { id: 'M10', gate: 'check-correction-def.js', why: 'delete the ENTIRE key-validation stage (required-action inventory)',
    apply: (d) => { const s = find(d.actions, 'Main').actions; delete s.Read_creds; delete s.Gate_keys; delete s.Keys_ok; s.Read_actor.runAfter = {}; } },
  { id: 'M11', gate: 'check-expressions.js', why: 'Abort_respond accepts only [Succeeded] from a predecessor that can Fail — the abort path hangs',
    apply: (d) => { d.actions.Abort_respond.runAfter = { Release_abort: ['Succeeded'] }; } },
  { id: 'M12', gate: 'check-correction-def.js', why: 'remove a gate-specific failure response — the protocol response is no longer preserved',
    apply: (d) => { const s = find(d.actions, 'Seal_gate').else.actions; delete s.Respond_seal; delete s.Respond_seal_stop; } },
  // M13 builds its post-commit cleanup INSIDE the Commit scope (that is where the post-publish
  // actions now live), so it is the real shape of the corruption after the containment split.
  { id: 'M13', gate: 'check-correction-def.js', why: 'a POST-COMMIT cleanup that releases the coordination fence',
    apply: (d) => {
      const s = find(d.actions, 'Commit').actions;
      s.Reread_state_pc = JSON.parse(JSON.stringify(s.Reread_state_final));
      s.Reread_state_pc.runAfter = { Outcome_by_read: ['Failed', 'TimedOut'] };
      const rel = JSON.parse(JSON.stringify(s.Release_final).replace(/Reread_state_final/g, 'Reread_state_pc'));
      rel.actions = { Do_Release_pc: rel.actions.Do_Release_final };
      rel.runAfter = { Reread_state_pc: ['Succeeded', 'Failed', 'TimedOut'] };
      s.Release_pc = rel;
      s.Respond_held_outcome.runAfter = { Release_pc: ['Succeeded', 'Failed', 'TimedOut'] };
    } },

  // ── the four rules added after the Option-A wave review (each one is here because the review found
  //    the rule missing, so each MUST be shown to bite) ──────────────────────────────────────────────
  { id: 'N1', gate: 'check-correction-def.js', why: 'put the registry reservation back above the refusal lanes — the placement that bricks a target on every refusal',
    apply: (d) => {
      const res = find(d.actions, 'Reserve');
      res.runAfter = { Journal_create: ['Succeeded'] };
      find(d.actions, 'Publish').runAfter = { Assemble_ok: ['Succeeded'] };
    } },
  { id: 'N2', gate: 'check-correction-def.js', why: 'a decision gate that stops consulting its evidence — Compute_gate no longer looks at Delta_cell or Candidate',
    apply: (d) => { find(d.actions, 'Compute_gate').expression = { and: [{ equals: ["@coalesce(body('Delta')?['ok'],false)", true] }] }; } },
  { id: 'N3', gate: 'check-correction-def.js', why: 'a gate pre-decided with a literal condition — the branch is unreachable and the refusal is dead code',
    apply: (d) => { find(d.actions, 'Verify_gate').expression = { and: [{ equals: [true, true] }] }; } },
  { id: 'N4', gate: 'check-correction-def.js', why: 'a Terminate hooked on a status its Response can never produce — named in runAfter, so a presence-only check passes',
    apply: (d) => { find(d.actions, 'Respond_seal_stop').runAfter = { Respond_seal: ['Skipped'] }; } },
];

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
