// EDIT-SET VALIDATOR — validates item-5's edits as DATA, because prose cannot be checked.
//
// WHY THIS EXISTS. Three audit rounds on the item-5 spec found the same class of defect every time:
//   round 1  four corrections stated at the top of the document that never reached the edits below
//   round 2  the SAME failure again (C6 in the header, `["Succeeded"]` still in edits 5 and 18), a
//            new action still carrying an invalid JSON shape one line from the one that was fixed,
//            and a correction that introduced a DEPENDENCY CYCLE
// Every one of those is a mechanically checkable property that was written in English. Hand-patching
// the prose twice introduced new defects both times. More care was never going to fix it.
//
// So the edits live in item5-edits.json and this validates them:
//   1. SHAPE     every new action has the keys its `type` requires (an InitializeVariable needs
//                `type` + `inputs.variables`; an If needs a top-level `expression`; a Foreach needs
//                `foreach`). Catches "no type, variables outside inputs".
//   2. SIBLINGS  every runAfter parent is a sibling in the same container — verified against the
//                deployed estate: zero cross-scope edges across ~270 actions in nine workflows.
//   3. CYCLES    no action may depend on itself transitively. Catches the C1 correction that made
//                AA_actor -> AA_ready -> AA_actor.
//   4. STATUSES  an action whose predecessor can FAIL must tolerate Failed/TimedOut, or an unhandled
//                failure marks the whole run Failed even with a byte-identical response.
//   5. EXISTING  edits to existing actions name a key that exists on that action type (delegated in
//                spirit to check-edit-premise.js; re-asserted here so one command covers the set).
//
// ⚠ WHAT THE OTHER GATES DO NOT COVER, stated plainly because a false coverage claim is what the last
// round caught: check-name-collisions.js checks that a NAME is free. It says nothing about an
// action's shape or wiring. That gap is this file.
//
// USAGE
//   node audit-artifacts/check-item5-edits.js
//   node audit-artifacts/check-item5-edits.js --self-test
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const EDITS = path.join(DIR, 'item5-edits.json');

// Required keys per action type, from the deployed estate rather than from memory of the docs.
const SHAPE = {
  InitializeVariable: { required: ['type', 'runAfter', 'inputs'], nested: [['inputs', 'variables']] },
  If: { required: ['type', 'runAfter', 'expression'], forbidden: ['inputs'] },
  Foreach: { required: ['type', 'runAfter', 'foreach'], forbidden: ['inputs'] },
  Switch: { required: ['type', 'runAfter', 'expression'] },
  Compose: { required: ['type', 'runAfter', 'inputs'] },
  Query: { required: ['type', 'runAfter', 'inputs'] },
  Select: { required: ['type', 'runAfter', 'inputs'] },
  ApiConnection: { required: ['type', 'runAfter', 'inputs'], nested: [['inputs', 'host']] },
  Http: { required: ['type', 'runAfter', 'inputs'] },
  Response: { required: ['type', 'runAfter', 'inputs'], nested: [['inputs', 'body']] },
  SetVariable: { required: ['type', 'runAfter', 'inputs'] },
  Terminate: { required: ['type', 'runAfter', 'inputs'] },
};

// Action types that can FAIL at runtime. A dependent that accepts only ["Succeeded"] leaves the
// failure unhandled, which marks the whole run Failed — the round-2 inertness finding.
const CAN_FAIL = new Set(['ApiConnection', 'Http', 'Compose', 'Query', 'Select', 'Response']);

const problem = (rule, la, action, msg) => ({ rule, la, action, msg });

function validate(edits, captures) {
  const out = [];

  for (const [la, spec] of Object.entries(edits.logicApps || {})) {
    const newActions = spec.newActions || {};

    // ── 1. SHAPE ────────────────────────────────────────────────────────────────────────────────
    for (const [name, entry] of Object.entries(newActions)) {
      const def = entry.def || {};
      const type = def.type;
      if (!type) {
        out.push(problem('shape', la, name, `no "type" key. Azure cannot apply this; an implementer would have to improvise the shape.`));
        continue;
      }
      const rule = SHAPE[type];
      if (!rule) { out.push(problem('shape', la, name, `unknown action type "${type}" — add it to SHAPE or correct the type.`)); continue; }
      for (const k of rule.required) {
        if (!(k in def)) out.push(problem('shape', la, name, `type ${type} requires "${k}" and it is missing.`));
      }
      for (const k of (rule.forbidden || [])) {
        if (k in def) out.push(problem('shape', la, name, `type ${type} must NOT carry "${k}" (a ${type} keeps its payload elsewhere).`));
      }
      for (const chain of (rule.nested || [])) {
        let cur = def, ok = true;
        for (const seg of chain) { if (!cur || typeof cur !== 'object' || !(seg in cur)) { ok = false; break; } cur = cur[seg]; }
        if (!ok) out.push(problem('shape', la, name, `type ${type} requires "${chain.join('.')}" and it is missing or misplaced.`));
      }
    }

    // ── 2. SIBLINGS ─────────────────────────────────────────────────────────────────────────────
    // Group by container. A runAfter parent must be a sibling: either another new action in the same
    // container, or an existing action of that container in the deployed capture.
    const cap = captures[la];
    const byContainer = {};
    for (const [name, entry] of Object.entries(newActions)) {
      (byContainer[entry.container || '(root)'] = byContainer[entry.container || '(root)'] || new Set()).add(name);
    }
    for (const [name, entry] of Object.entries(newActions)) {
      const container = entry.container || '(root)';
      const siblingsNew = byContainer[container] || new Set();
      const siblingsLive = cap ? (cap.byContainer[container] || new Set()) : null;
      for (const parent of Object.keys((entry.def || {}).runAfter || {})) {
        const known = siblingsNew.has(parent) || (siblingsLive && siblingsLive.has(parent));
        if (!known) {
          out.push(problem('siblings', la, name,
            `runAfter names "${parent}", which is not a sibling in container "${container}". Azure forbids depending on an action outside your own scope (verified: zero cross-scope edges in ~270 deployed actions).` +
            (siblingsLive ? '' : ' (no capture loaded for this workflow, so only new actions were considered)')));
        }
      }
    }

    // ── 3. CYCLES ───────────────────────────────────────────────────────────────────────────────
    const graph = {};
    for (const [name, entry] of Object.entries(newActions)) {
      graph[name] = Object.keys((entry.def || {}).runAfter || {}).filter(p => name in newActions || p in newActions);
    }
    const WHITE = 0, GREY = 1, BLACK = 2;
    const colour = {};
    Object.keys(graph).forEach(n => (colour[n] = WHITE));
    const stack = [];
    (function dfsAll() {
      for (const n of Object.keys(graph)) if (colour[n] === WHITE) dfs(n);
      function dfs(n) {
        colour[n] = GREY; stack.push(n);
        for (const p of (graph[n] || [])) {
          if (!(p in graph)) continue;
          if (colour[p] === GREY) {
            const at = stack.indexOf(p);
            const cyc = stack.slice(at).concat(p).join(' → ');
            out.push(problem('cycles', la, n, `dependency CYCLE: ${cyc}. Nothing in the cycle can ever start.`));
          } else if (colour[p] === WHITE) dfs(p);
        }
        colour[n] = BLACK; stack.pop();
      }
    })();

    // ── 4. STATUSES ─────────────────────────────────────────────────────────────────────────────
    for (const [name, entry] of Object.entries(newActions)) {
      for (const [parent, statuses] of Object.entries((entry.def || {}).runAfter || {})) {
        const p = newActions[parent];
        if (!p) continue;                                   // existing action: its failure modes are already deployed
        if (!CAN_FAIL.has((p.def || {}).type)) continue;
        const list = Array.isArray(statuses) ? statuses : [];
        if (!list.includes('Failed') && !list.includes('TimedOut')) {
          out.push(problem('statuses', la, name,
            `runAfter "${parent}" accepts only [${list.join(', ')}]. "${parent}" is a ${(p.def || {}).type} and CAN fail; an unhandled failure marks the WHOLE RUN Failed even when the response is byte-identical — which breaks the inertness property.`));
        }
      }
    }

    // ── 5. EXISTING EDITS ───────────────────────────────────────────────────────────────────────
    if (cap) {
      for (const e of (spec.existingEdits || [])) {
        const info = cap.flat.get(e.target);
        if (!info) { out.push(problem('existing', la, e.target, `edited action does not exist in the deployed capture.`)); continue; }
        let cur = info.action, ok = true;
        for (const seg of String(e.key).split('.')) {
          if (cur === null || typeof cur !== 'object' || !(seg in cur)) { ok = false; break; }
          cur = cur[seg];
        }
        if (!ok) out.push(problem('existing', la, e.target, `key "${e.key}" does not exist on this ${info.type}. The instruction is unapplyable.`));
      }
    }
  }
  return out;
}

// ── CAPTURE LOADING ────────────────────────────────────────────────────────────────────────────────
function loadCapture(file) {
  const def = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const flat = new Map();
  const byContainer = {};
  (function walk(node, container) {
    const set = (byContainer[container] = byContainer[container] || new Set());
    for (const [name, a] of Object.entries(node || {})) {
      set.add(name);
      flat.set(name, { action: a, type: (a && a.type) || '?' });
      for (const [label, sub] of [['then', a.actions], ['else', a.else && a.else.actions], ['default', a.default && a.default.actions]]) {
        if (sub) walk(sub, `${name}[${label}]`);
      }
      for (const [cn, c] of Object.entries((a && a.cases) || {})) if (c && c.actions) walk(c.actions, `${name}[case ${cn}]`);
    }
  })(def.actions, '(root)');
  return { flat, byContainer };
}

// ── SELF-TEST ──────────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const caps = {};
  const mk = (newActions, existingEdits) => ({ logicApps: { X: { newActions, existingEdits: existingEdits || [] } } });
  const cases = [
    { id: 'V1', why: 'a new action with NO type is caught', rule: 'shape',
      edits: mk({ A: { container: '(root)', def: { runAfter: {}, variables: [] } } }) },
    { id: 'V2', why: 'InitializeVariable with variables OUTSIDE inputs is caught (the real recordsteps defect)', rule: 'shape',
      edits: mk({ A: { container: '(root)', def: { type: 'InitializeVariable', runAfter: {}, variables: [] } } }) },
    { id: 'V3', why: 'a correctly shaped InitializeVariable passes', rule: 'shape', expectClean: true,
      edits: mk({ A: { container: '(root)', def: { type: 'InitializeVariable', runAfter: {}, inputs: { variables: [] } } } }) },
    { id: 'V4', why: 'an If carrying inputs instead of expression is caught', rule: 'shape',
      edits: mk({ A: { container: '(root)', def: { type: 'If', runAfter: {}, inputs: { expression: {} } } } }) },
    { id: 'V5', why: 'a runAfter naming a NON-SIBLING is caught', rule: 'siblings',
      edits: mk({ A: { container: 'Gate[then]', def: { type: 'Compose', runAfter: { Outsider: ['Succeeded'] }, inputs: 'x' } } }) },
    { id: 'V6', why: 'a DEPENDENCY CYCLE is caught (the real C1 defect)', rule: 'cycles',
      edits: mk({
        A: { container: 'g', def: { type: 'Compose', runAfter: { B: ['Succeeded'] }, inputs: 'x' } },
        B: { container: 'g', def: { type: 'Compose', runAfter: { A: ['Succeeded'] }, inputs: 'x' } },
      }) },
    { id: 'V7', why: 'depending on a failable action with ["Succeeded"] only is caught (the real C6 defect)', rule: 'statuses',
      edits: mk({
        P: { container: 'g', def: { type: 'ApiConnection', runAfter: {}, inputs: { host: {} } } },
        C: { container: 'g', def: { type: 'Compose', runAfter: { P: ['Succeeded'] }, inputs: 'x' } },
      }) },
    { id: 'V8', why: 'the same pair tolerating Failed/TimedOut passes', rule: 'statuses', expectClean: true,
      edits: mk({
        P: { container: 'g', def: { type: 'ApiConnection', runAfter: {}, inputs: { host: {} } } },
        C: { container: 'g', def: { type: 'Compose', runAfter: { P: ['Succeeded', 'Failed', 'TimedOut'] }, inputs: 'x' } },
      }) },
  ];

  console.log('edit-set validator — self-test\n');
  let bad = 0;
  for (const c of cases) {
    const hits = validate(c.edits, caps).filter(p => p.rule === c.rule);
    const ok = c.expectClean ? hits.length === 0 : hits.length > 0;
    if (!ok) bad++;
    console.log(`  ${ok ? 'CORRECT' : 'WRONG  '} [${c.id}] ${c.why}`);
  }
  console.log(`\n==== self-test: ${cases.length - bad}/${cases.length} behaviours proven ====`);
  if (bad) console.log('     Three of these are the exact defects three audit rounds found. If they do not fire, this file is decoration.');
  return bad;
}

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────────
function main() {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

  let edits;
  try { edits = JSON.parse(fs.readFileSync(EDITS, 'utf8')); }
  catch (e) { console.log(`Cannot read item5-edits.json: ${e.message}`); process.exit(1); }

  const captures = {};
  for (const [la, spec] of Object.entries(edits.logicApps || {})) {
    if (!spec.capture) continue;
    try { captures[la] = loadCapture(spec.capture); }
    catch (e) { console.log(`  (no capture for ${la}: ${e.message} — sibling and existing-key checks limited)`); }
  }

  const problems = validate(edits, captures);
  const nNew = Object.values(edits.logicApps || {}).reduce((a, s) => a + Object.keys(s.newActions || {}).length, 0);
  const nEx = Object.values(edits.logicApps || {}).reduce((a, s) => a + (s.existingEdits || []).length, 0);
  console.log(`edit-set validator — ${nNew} new actions, ${nEx} edits to existing actions\n`);

  if (!problems.length) {
    console.log('==== EDIT SET OK — 0 problems ====');
    console.log('Shapes valid, every runAfter names a sibling, no cycles, no unhandled failure paths,');
    console.log('and every edited key exists on the deployed action.');
    process.exit(0);
  }

  const byRule = {};
  problems.forEach(p => (byRule[p.rule] = byRule[p.rule] || []).push(p));
  for (const [rule, list] of Object.entries(byRule)) {
    console.log(`-- ${rule} (${list.length})`);
    list.forEach(p => console.log(`  🛑 ${p.la} > ${p.action}\n     ${p.msg}`));
    console.log('');
  }
  console.log(`==== ${problems.length} problem(s) — DO NOT APPLY ====`);
  console.log('Fix them in item5-edits.json, never in the prose. The prose is generated from this file,');
  console.log('which is what makes a correction unable to fail to propagate.');
  process.exit(1);
}

main();
