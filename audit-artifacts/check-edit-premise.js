// EDIT-PREMISE GATE — "an edit instruction is a CLAIM about the deployed graph. Test the claim."
//
// THE INCIDENT THIS EXISTS FOR. The Account Access item-5 plan contained EDIT 13: "re-parent BOTH
// Attest_rows and Attest_failed_map from body('ToInsert')". On the live push-v2 exactly ONE action
// reads body('ToInsert') — Attest_rows. Attest_failed_map reads @body('Attest_rows'). Following the
// instruction would have changed that action's item shape so every ATTEST_UNAVAILABLE entry came back
// with TransactionId: null — a behaviour change on any signing blip, with no policy involved.
//
// That plan had been triple-audited. And when the CORRECTED plan was written, the SAME class of error
// appeared again: an edit for push-v2 justified itself with a fact that is only true of recordsteps.
// Twice, past careful people. That is what a mechanical check is for.
//
// WHAT IT CHECKS — three premises every edit instruction silently asserts:
//   1. READER SET   "these actions read X"        -> enumerate who really reads X and compare
//   2. KEY EXISTS   "set Foo.inputs.from"         -> a Foreach has `foreach` and NO `inputs`, an If
//                                                    has a top-level `expression`. Catches an
//                                                    unapplyable instruction before someone improvises
//                                                    at the keyboard.
//   3. runAfter     "Invariant runs after A, B"   -> restate the map IN FULL. push-v2's Invariant has
//                                                    FOUR parents; the old edit named two, and a
//                                                    partial restatement DELETES the others.
//
// PREREQUISITE: fresh captures (capture-all-staging-defs.js). This reads those, never the cloud, so it
// is deterministic and its self-test can run on a synthetic definition.
//
// USAGE
//   node audit-artifacts/check-edit-premise.js             # check the manifest below
//   node audit-artifacts/check-edit-premise.js --self-test # prove it bites
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// ── THE MANIFEST ───────────────────────────────────────────────────────────────────────────────────
// One entry per premise an edit asserts. Seeded with the two REAL historical failures so the gate is
// demonstrably biting on live data, not just on fixtures. Replace them as item 5 is re-specced —
// an edit whose premises are not listed here has NOT been checked.
const CLAIMS = [
  // ── THE THREE HISTORICAL BAD EDITS ────────────────────────────────────────────────────────────────
  // Kept deliberately. They FAIL, which is how you can see at a glance that this gate is biting on
  // live data rather than passing because it checked nothing.
  {
    id: 'HISTORICAL EDIT 13 (KNOWN BAD — kept as the live proof this gate works)',
    la: 'bob-stock-push-v2-validate-staging', kind: 'readers', of: 'ToInsert',
    claimed: ['Attest_rows', 'Attest_failed_map'], expectFail: true,
  },
  {
    id: 'HISTORICAL EDIT 15/18 (KNOWN BAD — Foreach has no inputs)',
    la: 'bob-stock-push-v2-validate-staging', kind: 'key', target: 'Quarantine_loop', key: 'inputs.from',
    expectFail: true,
  },
  {
    id: 'HISTORICAL Invariant runAfter (KNOWN BAD — partial map deletes parents)',
    la: 'bob-stock-push-v2-validate-staging', kind: 'runAfter', target: 'Invariant',
    claimed: ['Insert_loop', 'Map_rejected'], expectFail: true,
  },

  // ── THE ACTUAL ITEM-5 RESPEC EDITS ────────────────────────────────────────────────────────────────
  // Added 2026-07-31 after BOTH auditors returned BLOCK. Codex finding 4 was that this gate contained
  // only the three superseded claims above, so every edit in the corrected spec sat OUTSIDE all three
  // checks — the gates reported clean on a document with three shape errors in it. A gate pointed at
  // nothing is worse than no gate, because it produces a green tick.
  //
  // Only edits that touch an EXISTING action can be premise-checked; the new AA_* actions are covered
  // by check-name-collisions.js instead.
  {
    id: 'RESPEC edit 10 — Attest_rows is the ONLY reader of ToInsert (the corrected EDIT 13)',
    la: 'bob-stock-push-v2-validate-staging', kind: 'readers', of: 'ToInsert', claimed: ['Attest_rows'],
  },
  {
    id: 'RESPEC edit 10 — Attest_rows.inputs.from is the key being set',
    la: 'bob-stock-push-v2-validate-staging', kind: 'key', target: 'Attest_rows', key: 'inputs.from',
  },
  {
    id: 'RESPEC edit 11 — Invariant.runAfter restated IN FULL (four parents, not two)',
    la: 'bob-stock-push-v2-validate-staging', kind: 'runAfter', target: 'Invariant',
    claimed: ['Insert_loop', 'Map_rejected', 'Quarantine_loop', 'Set_failed_attest'],
  },
  {
    id: 'RESPEC edit 11 — Invariant.inputs is the key being set',
    la: 'bob-stock-push-v2-validate-staging', kind: 'key', target: 'Invariant', key: 'inputs',
  },
  // AGY Q2-2: a Response action has inputs.body, NOT a top-level body. Edits 12 and 23 name a path
  // that does not exist on the action type. These two claims exist to make that fail mechanically.
  {
    id: 'RESPEC edit 12 — Response_ok.body.failed (AGY says this path does NOT exist)',
    la: 'bob-stock-push-v2-validate-staging', kind: 'key', target: 'Response_ok', key: 'body.failed',
  },
  {
    id: 'RESPEC edit 12 — Response_ok.inputs.body.failed (the path AGY says is correct)',
    la: 'bob-stock-push-v2-validate-staging', kind: 'key', target: 'Response_ok', key: 'inputs.body.failed',
  },
  {
    id: 'RESPEC edit 21 — Insert_loop.foreach is the key being set',
    la: 'bob-stock-recordsteps-push-staging', kind: 'key', target: 'Insert_loop', key: 'foreach',
  },
  {
    id: 'RESPEC edit 21 — Insert_loop.runAfter restated IN FULL',
    la: 'bob-stock-recordsteps-push-staging', kind: 'runAfter', target: 'Insert_loop',
    claimed: ['Map_rejected', 'ToInsert2'],
  },
  {
    id: 'RESPEC edit 23 — Response_ok.body.failed on recordsteps (same AGY finding)',
    la: 'bob-stock-recordsteps-push-staging', kind: 'key', target: 'Response_ok', key: 'body.failed',
  },
  {
    id: 'RESPEC edit 23 — Response_ok.inputs.body.failed on recordsteps',
    la: 'bob-stock-recordsteps-push-staging', kind: 'key', target: 'Response_ok', key: 'inputs.body.failed',
  },
];

// ── GRAPH HELPERS ──────────────────────────────────────────────────────────────────────────────────

const CONTAINER_KEYS = new Set(['actions', 'else', 'cases', 'default']);

/** An action's OWN definition, with nested children stripped.
 *
 *  ⚠ THIS IS THE WHOLE CORRECTNESS OF THE READER CHECK. Serialising a Scope or an If includes every
 *  descendant, so a naive scan reports every ANCESTOR as a reader. Verified on the real capture: a
 *  naive search for body('ToInsert') returns BOTH `Attest_rows` (the real reader) and `Authorized`
 *  (the If that merely contains it). Reporting a container as a reader would make this gate noisy on
 *  its very first run, and a noisy gate gets ignored. */
function ownDefinition(a) {
  const own = {};
  for (const [k, v] of Object.entries(a || {})) if (!CONTAINER_KEYS.has(k)) own[k] = v;
  return own;
}

function flatten(node, trail, into) {
  for (const [name, a] of Object.entries(node || {})) {
    const where = trail ? `${trail} > ${name}` : name;
    into.set(name, { action: a, path: where, type: (a && a.type) || '?' });
    for (const [label, sub] of [['then', a.actions], ['else', a.else && a.else.actions], ['default', a.default && a.default.actions]]) {
      if (sub) flatten(sub, `${where} [${label}]`, into);
    }
    for (const [cn, c] of Object.entries((a && a.cases) || {})) if (c && c.actions) flatten(c.actions, `${where} [case ${cn}]`, into);
  }
  return into;
}

/** Who ACTUALLY reads this action's output — direct references only, containers excluded. */
function readersOf(def, name) {
  const flat = flatten(def.actions, '', new Map());
  const needle = new RegExp(`(?:body|outputs)\\('${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`);
  const hits = [];
  for (const [n, info] of flat) {
    if (n === name) continue;
    if (needle.test(JSON.stringify(ownDefinition(info.action)))) hits.push(n);
  }
  return hits.sort();
}

/** Does a dotted key path exist on this action? Returns {exists, actualKeys, note}. */
function keyExists(action, dotted) {
  const parts = dotted.split('.');
  let cur = action;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) {
      return { exists: false, at: parts.slice(0, i + 1).join('.'), actualKeys: (cur && typeof cur === 'object') ? Object.keys(cur) : [] };
    }
    cur = cur[parts[i]];
  }
  return { exists: true };
}

const parentsOf = (action) => Object.keys((action && action.runAfter) || {}).sort();

function newestCapture(la) {
  const files = fs.readdirSync(DIR).filter(f => f.startsWith(`${la}-PRE-`) && f.endsWith('.json')).sort();
  if (!files.length) return null;
  const file = files[files.length - 1];
  try { return { file, def: JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')) }; } catch (e) { return { file, def: null }; }
}

// ── THE CHECK (pure over a definition, so the self-test can feed a synthetic one) ───────────────────
function verify(def, claim) {
  const flat = flatten(def.actions, '', new Map());

  if (claim.kind === 'readers') {
    const real = readersOf(def, claim.of);
    const want = [...claim.claimed].sort();
    const missing = want.filter(x => !real.includes(x));     // claimed but does not actually read it
    const extra = real.filter(x => !want.includes(x));       // reads it but the edit never mentions it
    if (!missing.length && !extra.length) return { ok: true, detail: `readers of body('${claim.of}') = [${real.join(', ')}]` };
    const lines = [`the edit says [${want.join(', ')}] read body('${claim.of}'); the deployed graph says [${real.join(', ') || 'nothing'}]`];
    for (const m of missing) {
      const info = flat.get(m);
      const actually = info ? JSON.stringify(ownDefinition(info.action)).match(/(?:body|outputs)\('[^']+'\)/g) : null;
      lines.push(`  · ${m} does NOT read it${actually ? ` — it reads ${[...new Set(actually)].join(', ')}` : ' (action not found at all)'}`);
    }
    for (const e of extra) lines.push(`  · ${e} DOES read it and the edit does not mention it — it would be left dangling`);
    return { ok: false, detail: lines.join('\n') };
  }

  if (claim.kind === 'key') {
    const info = flat.get(claim.target);
    if (!info) return { ok: false, detail: `action '${claim.target}' does not exist in the deployed graph` };
    const r = keyExists(info.action, claim.key);
    if (r.exists) return { ok: true, detail: `${claim.target}.${claim.key} exists (type ${info.type})` };
    return { ok: false, detail: `${claim.target}.${claim.key} does NOT exist — the instruction is unapplyable.\n  · ${claim.target} is a ${info.type}; it has [${r.actualKeys.join(', ')}]\n  · first missing segment: ${r.at}\n  · a Foreach carries 'foreach' and has no 'inputs'; an If carries a top-level 'expression'` };
  }

  if (claim.kind === 'runAfter') {
    const info = flat.get(claim.target);
    if (!info) return { ok: false, detail: `action '${claim.target}' does not exist in the deployed graph` };
    const real = parentsOf(info.action);
    const want = [...claim.claimed].sort();
    if (real.join('|') === want.join('|')) return { ok: true, detail: `${claim.target}.runAfter = [${real.join(', ')}]` };
    const dropped = real.filter(x => !want.includes(x));
    return { ok: false, detail: `${claim.target}.runAfter restated as [${want.join(', ')}] but the deployed map is [${real.join(', ')}]` +
      (dropped.length ? `\n  · writing the partial map DELETES: ${dropped.join(', ')} — those dependencies simply vanish` : '') };
  }

  return { ok: false, detail: `unknown claim kind '${claim.kind}'` };
}

// ── SELF-TEST ──────────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const synth = {
    actions: {
      Scope1: { type: 'Scope', runAfter: {}, actions: {
        Source: { type: 'Query', runAfter: {}, inputs: { from: '@triggerBody()' } },
        RealReader: { type: 'Select', runAfter: { Source: ['Succeeded'] }, inputs: { from: "@body('Source')" } },
        NotAReader: { type: 'Select', runAfter: {}, inputs: { from: "@body('RealReader')" } },
        Looper: { type: 'Foreach', runAfter: {}, foreach: "@body('Source')", actions: { Inner: { type: 'Compose', runAfter: {} } } },
        Joiner: { type: 'Compose', runAfter: { Source: ['Succeeded'], RealReader: ['Succeeded'], Looper: ['Succeeded'] }, inputs: 'x' },
      } },
    },
  };

  const cases = [
    { id: 'P1', why: 'a reader set that names an action which does not read it', expectFail: true,
      claim: { kind: 'readers', of: 'Source', claimed: ['RealReader', 'NotAReader'] } },
    { id: 'P2', why: 'a correct reader set passes', expectFail: false,
      claim: { kind: 'readers', of: 'Source', claimed: ['RealReader', 'Looper'] } },
    { id: 'P3', why: 'a reader the edit FORGOT is flagged (it would be left dangling)', expectFail: true,
      claim: { kind: 'readers', of: 'Source', claimed: ['RealReader'] } },
    { id: 'P4', why: 'an ancestor CONTAINER is not miscounted as a reader', expectFail: false,
      claim: { kind: 'readers', of: 'Source', claimed: ['RealReader', 'Looper'] } },
    { id: 'P5', why: 'setting .inputs on a Foreach is caught as unapplyable', expectFail: true,
      claim: { kind: 'key', target: 'Looper', key: 'inputs.from' } },
    { id: 'P6', why: 'setting a key that does exist passes', expectFail: false,
      claim: { kind: 'key', target: 'RealReader', key: 'inputs.from' } },
    { id: 'P7', why: 'editing an action that does not exist is caught', expectFail: true,
      claim: { kind: 'key', target: 'Ghost', key: 'inputs.from' } },
    { id: 'P8', why: 'a PARTIAL runAfter restatement is caught (it deletes the rest)', expectFail: true,
      claim: { kind: 'runAfter', target: 'Joiner', claimed: ['Source', 'RealReader'] } },
    { id: 'P9', why: 'a complete runAfter restatement passes', expectFail: false,
      claim: { kind: 'runAfter', target: 'Joiner', claimed: ['Source', 'RealReader', 'Looper'] } },
  ];

  console.log('edit-premise gate — self-test\n');
  let bad = 0;
  for (const c of cases) {
    const r = verify(synth, c.claim);
    const ok = (!r.ok) === c.expectFail;
    if (!ok) bad++;
    console.log(`  ${ok ? 'CORRECT' : 'WRONG  '} [${c.id}] ${c.why}${ok ? '' : `  (failed=${!r.ok}, expected fail=${c.expectFail})`}`);
  }

  // The decisive cases: the three REAL historical bad edits, against the REAL capture.
  const cap = newestCapture('bob-stock-push-v2-validate-staging');
  if (cap && cap.def) {
    const real = [
      { id: 'P10', why: 'THE REAL EDIT 13: claims 2 actions read body(ToInsert), only 1 does',
        claim: CLAIMS[0] },
      { id: 'P11', why: 'THE REAL Quarantine_loop.inputs.from: it is a Foreach with no inputs',
        claim: CLAIMS[1] },
      { id: 'P12', why: 'THE REAL Invariant runAfter: named 2 parents, deployed map has 4',
        claim: CLAIMS[2] },
    ];
    for (const c of real) {
      const r = verify(cap.def, c.claim);
      const ok = !r.ok;   // all three are known-bad; each MUST fail
      if (!ok) bad++;
      console.log(`  ${ok ? 'CORRECT' : 'WRONG  '} [${c.id}] ${c.why}`);
    }
  } else {
    console.log('  SKIPPED [P10-P12] real captures absent — run capture-all-staging-defs.js');
  }

  const total = cases.length + (cap && cap.def ? 3 : 0);
  console.log(`\n==== self-test: ${total - bad}/${total} behaviours proven ====`);
  if (bad) console.log('     A premise check that cannot be made to fail is not checking a premise.');
  return bad;
}

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────────
function main() {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

  console.log('edit-premise gate — every edit instruction is a CLAIM about the deployed graph\n');
  let failures = 0, missing = 0;
  const byLa = {};
  for (const c of CLAIMS) (byLa[c.la] = byLa[c.la] || []).push(c);

  for (const [la, claims] of Object.entries(byLa)) {
    const cap = newestCapture(la);
    if (!cap || !cap.def) { missing++; console.log(`  NO CAPTURE  ${la} — run capture-all-staging-defs.js`); continue; }
    console.log(`  ${la}  (${cap.file})`);
    for (const c of claims) {
      const r = verify(cap.def, c);
      // A claim marked expectFail is a HISTORICAL bad edit, kept so the gate is visibly biting on live
      // data. Its failing is the proof, not a finding — mixing the two makes a real finding easy to
      // skim past. But if one ever STARTS passing, the gate has stopped working and that IS a finding.
      if (c.expectFail) {
        if (r.ok) {
          failures++;
          console.log(`    ⚠ NOW OK  ${c.id}`);
          console.log('              this known-bad edit now PASSES — the gate has stopped biting. Investigate.');
        } else {
          console.log(`    known-bad ${c.id}  (still caught — the gate is working)`);
        }
        continue;
      }
      if (r.ok) { console.log(`    ok        ${c.id}\n              ${r.detail}`); continue; }
      failures++;
      console.log(`    🛑 WRONG  ${c.id}`);
      r.detail.split('\n').forEach(l => console.log(`              ${l}`));
    }
    console.log('');
  }

  if (missing) console.log(`${missing} workflow(s) have no capture.\n`);
  if (failures) {
    console.log(`==== ${failures} FALSE PREMISE(S) — DO NOT APPLY ====`);
    console.log('The instruction describes a graph that does not exist. Re-spec it against the capture;');
    console.log('do NOT improvise the edit at the keyboard, which is exactly how the original defect shipped.');
    process.exit(1);
  }
  console.log('==== ALL PREMISES HOLD ====');
  console.log('Note: only the claims listed in CLAIMS were checked. An edit whose premises are not listed');
  console.log('has been DECLARED UNCHECKED, not verified — that distinction is the point of this file.');
  process.exit(0);
}

main();
