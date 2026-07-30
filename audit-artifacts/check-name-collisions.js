// NAME-COLLISION GATE — the check whose absence nearly jammed the stock sync write path.
//
// THE INCIDENT THIS EXISTS FOR. The Account Access apply plan said to add an action named `ToInsert2`
// to `bob-stock-recordsteps-push-staging`. That name was ALREADY TAKEN on the deployed workflow, by
// the Chunk-9/10 context hold-back filter:
//     { "from": "@body('ToInsert')",
//       "where": "@not(contains(body('Ctx_ids'), item()?['row']?['StepId']))" }
// A Logic App's actions are a JSON OBJECT KEYED BY NAME. Adding a second `ToInsert2` does not sit
// alongside the first — it OVERWRITES it. With no policy published and no enforcement flag set, a
// stock-take step whose ledger row had not landed would be written to SharePoint anyway, the
// workflow's own arithmetic invariant would evaluate false, it would return HTTP 500 without acking,
// and the device would retry forever against a record already durably in the list.
//
// The plan had been triple-audited. The audits reviewed the DESIGN; nobody checked the design still
// matched the machine. This gate is that check, and it is three lines of real logic.
//
// PREREQUISITE: fresh captures. Run capture-all-staging-defs.js first — this gate reads those, not
// the cloud, so it is deterministic and its own self-test can run against a synthetic definition.
//
// USAGE
//   node audit-artifacts/check-name-collisions.js                      # check the seeded manifest
//   node audit-artifacts/check-name-collisions.js --self-test          # prove the gate bites
//   node audit-artifacts/check-name-collisions.js <la> <name> [name…]  # ad hoc, before any edit
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// ── THE MANIFEST ───────────────────────────────────────────────────────────────────────────────────
// Every action name an apply step intends to CREATE. Fill this in as each item is specced — an item
// whose additions are not listed here has not been checked, and that is exactly the state item 5 was
// in when it was signed off.
//
// A name here is a CLAIM that the deployed workflow does not already use it. The gate tests the claim.
const PLANNED_ADDITIONS = {
  // Item 5 — the real, reproduced collision. Kept as the seed case precisely because it FAILS: it
  // proves on live data that this gate does what it says, which no green run can.
  'bob-stock-recordsteps-push-staging': ['ToInsert2', 'Proof_gate', 'Classify_steps'],

  // TO BE FILLED as each item is specced. Empty is honest; a wrong entry is not.
  'bob-stock-push-v2-validate-staging': [],
  'bob-stock-corp-costs-staging': [],
  'bob-stock-archive-pull-staging': [],
  'bob-stock-user-admin-staging': [],
  'bob-stock-catalogue-write-staging': [],
  'bob-stock-user-verify-staging': [],
  'bob-stock-archive-staging': [],
};

// ── CORE ───────────────────────────────────────────────────────────────────────────────────────────

/** Every action name at every depth, mapped to where it lives and what it currently is. Scopes, If
 *  branches, Switch cases and foreach bodies all nest actions, and a collision at ANY depth
 *  overwrites — Logic Apps does not scope action names by branch. */
function flattenNames(node, trail, into) {
  for (const [name, a] of Object.entries(node || {})) {
    const where = trail ? `${trail} > ${name}` : name;
    if (!into.has(name)) into.set(name, []);
    into.get(name).push({ path: where, type: (a && a.type) || '?', action: a });
    for (const [label, sub] of [['then', a.actions], ['else', a.else && a.else.actions], ['default', a.default && a.default.actions]]) {
      if (sub) flattenNames(sub, `${where} [${label}]`, into);
    }
    for (const [cname, c] of Object.entries((a && a.cases) || {})) {
      if (c && c.actions) flattenNames(c.actions, `${where} [case ${cname}]`, into);
    }
  }
  return into;
}

/** Newest capture for a Logic App, or null. Deliberately prefers the most recent PRE- capture so a
 *  stale one cannot silently be used — the whole incident began with stale captures. */
function newestCapture(la) {
  const files = fs.readdirSync(DIR).filter(f => f.startsWith(`${la}-PRE-`) && f.endsWith('.json')).sort();
  if (!files.length) return null;
  const file = files[files.length - 1];
  try { return { file, def: JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')) }; }
  catch (e) { return { file, def: null, error: e.message }; }
}

/** The gate. Pure over a definition so the self-test can feed a synthetic one. */
function findCollisions(def, planned) {
  const existing = flattenNames(def.actions, '', new Map());
  const hits = [];
  for (const name of planned) {
    if (existing.has(name)) {
      hits.push({ name, occurrences: existing.get(name) });
    }
  }
  return { hits, total: existing.size };
}

/** Who reads this action today? A collision is only dangerous because something depends on the thing
 *  being overwritten — naming those dependents is what makes the report actionable. */
function dependentsOf(def, name) {
  const json = JSON.stringify(def);
  const out = [];
  if (new RegExp(`body\\('${name}'\\)`).test(json)) out.push(`body('${name}') is read somewhere`);
  if (new RegExp(`outputs\\('${name}'\\)`).test(json)) out.push(`outputs('${name}') is read somewhere`);
  const ra = [];
  (function walk(node, trail) {
    for (const [n, a] of Object.entries(node || {})) {
      if (a && a.runAfter && Object.keys(a.runAfter).includes(name)) ra.push(trail ? `${trail} > ${n}` : n);
      for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) if (sub) walk(sub, n);
      for (const c of Object.values((a && a.cases) || {})) if (c && c.actions) walk(c.actions, n);
    }
  })(def.actions, '');
  if (ra.length) out.push(`runAfter dependents: ${ra.join(', ')}`);
  return out;
}

// ── SELF-TEST ──────────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const synth = {
    actions: {
      Top: { type: 'Scope', runAfter: {}, actions: {
        Inner: { type: 'Compose', runAfter: {} },
        Gate: { type: 'If', runAfter: {}, actions: { DeepThen: { type: 'Compose', runAfter: {} } },
          else: { actions: { DeepElse: { type: 'Compose', runAfter: {} } } } },
        Switcher: { type: 'Switch', runAfter: {}, cases: { a: { actions: { InCase: { type: 'Compose', runAfter: {} } } } },
          default: { actions: { InDefault: { type: 'Compose', runAfter: {} } } } },
      } },
    },
  };
  const cases = [
    { id: 'N1', why: 'a top-level name already in use is caught', planned: ['Top'], expect: true },
    { id: 'N2', why: 'a name nested inside a Scope is caught (names are NOT scoped per branch)', planned: ['Inner'], expect: true },
    { id: 'N3', why: 'a name inside an If THEN branch is caught', planned: ['DeepThen'], expect: true },
    { id: 'N4', why: 'a name inside an If ELSE branch is caught', planned: ['DeepElse'], expect: true },
    { id: 'N5', why: 'a name inside a Switch CASE is caught', planned: ['InCase'], expect: true },
    { id: 'N6', why: 'a name inside a Switch DEFAULT is caught', planned: ['InDefault'], expect: true },
    { id: 'N7', why: 'a genuinely new name is allowed through', planned: ['BrandNewAction'], expect: false },
    { id: 'N8', why: 'a near-miss name is allowed (no fuzzy matching — that would be noise)', planned: ['Inner2'], expect: false },
  ];

  console.log('name-collision gate — self-test\n');
  let bad = 0;
  for (const c of cases) {
    const { hits } = findCollisions(synth, c.planned);
    const fired = hits.length > 0;
    const ok = fired === c.expect;
    if (!ok) bad++;
    console.log(`  ${ok ? 'CORRECT' : 'WRONG  '} [${c.id}] ${c.why}${ok ? '' : `  (fired=${fired}, expected=${c.expect})`}`);
  }

  // And the decisive one: the real incident, against the real capture, if it is present.
  const real = newestCapture('bob-stock-recordsteps-push-staging');
  if (real && real.def) {
    const { hits } = findCollisions(real.def, ['ToInsert2']);
    const ok = hits.length > 0;
    if (!ok) bad++;
    console.log(`  ${ok ? 'CORRECT' : 'WRONG  '} [N9] THE REAL INCIDENT: ToInsert2 collides on the live capture (${real.file})`);
  } else {
    console.log('  SKIPPED [N9] the real incident — no capture present. Run capture-all-staging-defs.js.');
  }

  console.log(`\n==== self-test: ${cases.length + 1 - bad}/${cases.length + 1} behaviours proven ====`);
  return bad;
}

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────────
function report(la, planned) {
  const cap = newestCapture(la);
  if (!cap) return { la, status: 'NO CAPTURE', hits: [] };
  if (!cap.def) return { la, status: 'CAPTURE UNREADABLE', hits: [] };
  if (!planned.length) return { la, status: 'nothing planned yet', hits: [], file: cap.file, total: flattenNames(cap.def.actions, '', new Map()).size };
  const { hits, total } = findCollisions(cap.def, planned);
  return { la, status: hits.length ? 'COLLISION' : 'clear', hits, file: cap.file, total, def: cap.def };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

  let manifest = PLANNED_ADDITIONS;
  if (args.length >= 2 && !args[0].startsWith('--')) manifest = { [args[0]]: args.slice(1) };

  const results = Object.entries(manifest).map(([la, planned]) => report(la, planned));
  let collisions = 0, missing = 0;

  console.log('name-collision gate — every action name an edit ADDS must be absent from the deployed workflow\n');
  for (const r of results) {
    if (r.status === 'NO CAPTURE' || r.status === 'CAPTURE UNREADABLE') { missing++; console.log(`  ${r.status.padEnd(20)} ${r.la}`); continue; }
    console.log(`  ${r.status.padEnd(20)} ${r.la}  (${r.total} existing actions, ${r.file})`);
    for (const h of r.hits) {
      collisions++;
      console.log('');
      console.log(`      🛑 "${h.name}" ALREADY EXISTS — adding it OVERWRITES the action below, it does not sit beside it.`);
      for (const o of h.occurrences) {
        console.log(`         at: ${o.path}   type: ${o.type}`);
        const body = JSON.stringify(o.action).slice(0, 300);
        console.log(`         currently: ${body}${body.length >= 300 ? '…' : ''}`);
      }
      const deps = dependentsOf(r.def, h.name);
      if (deps.length) {
        console.log('         WHAT DEPENDS ON IT (this is what breaks):');
        deps.forEach(d => console.log(`           · ${d}`));
      }
      console.log('');
    }
  }

  if (missing) {
    console.log(`\n${missing} workflow(s) have no capture. Run: node audit-artifacts/capture-all-staging-defs.js`);
  }
  if (collisions) {
    console.log(`==== ${collisions} COLLISION(S) — DO NOT APPLY ====`);
    console.log('Rename the new action, or re-spec the edit against the deployed graph. Do NOT assume the');
    console.log('existing action is dead: check the dependents listed above first.');
    process.exit(1);
  }
  console.log('\n==== NO COLLISIONS ====');
  console.log('Note: a workflow listed as "nothing planned yet" has NOT been checked — it has been declared');
  console.log('unchecked. Fill in PLANNED_ADDITIONS as each item is specced, or this gate is decoration.');
  process.exit(0);
}

main();
