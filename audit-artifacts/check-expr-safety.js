// EXPRESSION-SAFETY GATE — types and client input in Logic App expressions.
//
// TWO INCIDENTS THIS EXISTS FOR, both from the Account Access item-5 planning:
//
//  RULE 1 (types). EDITs 15/18 merged arrays with `concat(<array>, <array>)`. Logic Apps' concat() is
//  for strings and integers; array merges need union(). Verified precedent: push-v2 uses concat() 8
//  times and all 8 build strings, while recordsteps' only two array merges already use union().
//
//  RULE 2 (client input). The CORRECTED spec described a new credential query as the deployed one
//  "copied verbatim, filtered on actorUsername". The real deployed action does not use a plain filter —
//  it strips single quotes out of the username first. Of the credential reads in this estate, every one
//  that interpolates a client-supplied name uses that guard. The prose dropped it, and the edit
//  immediately before hands over a plain literal query, so the natural reading produces an UNGUARDED
//  OData filter — on the connection shared with the live Logic Apps.
//
// WHAT MAKES RULE 2 USABLE RATHER THAN NOISY. Not every interpolation is dangerous. Verified against
// the real captures: two `Get_creds` actions interpolate the literal `'__director'` and are perfectly
// safe. So an operand is only flagged when it is CLIENT-DERIVED — traceable to triggerBody() or to a
// loop item over client rows. Literals and server-derived values pass. A gate that flagged all three
// classes would be ignored by its second run.
//
// EXPECTED PRE-EXISTING FINDINGS: a small number of archive queries that predate item 5 drop a client
// date or run-id into a filter unguarded. They are NOT item-5's doing. Kunal decides fix-now or
// accepted-baseline; until then they are listed separately so a red light is never mistaken for a
// regression introduced by this wave.
//
// USAGE
//   node audit-artifacts/check-expr-safety.js              # all captures
//   node audit-artifacts/check-expr-safety.js <file.json>  # one definition
//   node audit-artifacts/check-expr-safety.js --self-test
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// Queries that predate item 5 and are known-unguarded. Listed so they report as BASELINE rather than
// as new breakage. Removing an entry after fixing it is the intended workflow.
const ACCEPTED_BASELINE = new Set([
  'bob-stock-archive-staging::Read_existing',
  'bob-stock-archive-staging::Reread_archive',
  'bob-stock-archive-pull-staging::Read_archive',
]);

// ── TYPE INFERENCE ─────────────────────────────────────────────────────────────────────────────────

// Action types whose body() is an ARRAY. Query/Select/Foreach outputs are collections.
const ARRAY_ACTION_TYPES = new Set(['Query', 'Select']);
// Functions that RETURN an array.
const ARRAY_FUNCS = /^(union|filter|select|split|range|take|skip|createArray|xpath|intersection)\s*\(/;
// Functions that return a string/scalar — used to prove an operand is NOT an array.
const SCALAR_FUNCS = /^(concat|string|toLower|toUpper|substring|replace|trim|coalesce|int|float|bool|first|last|length|join|utcNow|guid|formatDateTime|addDays|encodeUriComponent|json|base64)\s*\(/;

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

/** Array / scalar / unknown. Only 'array' is ever acted on — 'unknown' must never produce a finding,
 *  because a guess here is a false positive and false positives kill a gate. */
function operandType(expr, flat, arrayVars) {
  const e = String(expr).trim().replace(/^@+/, '');
  const bodyRef = e.match(/^body\('([^']+)'\)/);
  if (bodyRef) {
    const t = flat.get(bodyRef[1]);
    if (t && ARRAY_ACTION_TYPES.has(t.type) && e === `body('${bodyRef[1]}')`) return 'array';
    return 'unknown';
  }
  const varRef = e.match(/^variables\('([^']+)'\)$/);
  if (varRef) return arrayVars.has(varRef[1]) ? 'array' : 'unknown';
  if (ARRAY_FUNCS.test(e)) return 'array';
  if (SCALAR_FUNCS.test(e)) return 'scalar';
  if (/^'.*'$/.test(e) || /^\d+$/.test(e)) return 'scalar';
  return 'unknown';
}

/** Variables initialised as Array anywhere in the definition. */
function collectArrayVars(def) {
  const out = new Set();
  const flat = flatten(def.actions, '', new Map());
  for (const { action } of flat.values()) {
    const vars = action && action.inputs && action.inputs.variables;
    if (Array.isArray(vars)) for (const v of vars) if (v && String(v.type).toLowerCase() === 'array' && v.name) out.add(v.name);
  }
  return out;
}

/** Split a function call's top-level arguments, respecting nesting and quotes. */
function splitArgs(inner) {
  const args = []; let depth = 0, q = false, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'") { q = !q; cur += c; continue; }
    if (!q && c === '(') depth++;
    if (!q && c === ')') depth--;
    if (!q && c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

/** Every `name(...)` call in a string, with its raw argument list. */
function findCalls(text, fname) {
  const out = [];
  const re = new RegExp(`\\b${fname}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length, depth = 1, q = false, inner = '';
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === "'") q = !q;
      else if (!q && c === '(') depth++;
      else if (!q && c === ')') { depth--; if (!depth) break; }
      inner += c; i++;
    }
    out.push({ inner, at: m.index });
  }
  return out;
}

// ── RULE 1 — concat() on array operands ────────────────────────────────────────────────────────────
function ruleTypes(def, flat, arrayVars) {
  const out = [];
  for (const [name, info] of flat) {
    const text = JSON.stringify({ inputs: info.action.inputs, expression: info.action.expression, foreach: info.action.foreach });
    for (const call of findCalls(text, 'concat')) {
      const args = splitArgs(call.inner);
      const arrays = args.filter(a => operandType(a, flat, arrayVars) === 'array');
      if (arrays.length) {
        out.push({
          rule: 'types', action: name, path: info.path,
          msg: `concat() applied to ${arrays.length} ARRAY operand(s) — concat() is for strings and integers. Merging arrays needs union().`,
          detail: arrays.map(a => `      array operand: ${a.slice(0, 120)}`).join('\n'),
        });
      }
    }
  }
  return out;
}

// ── RULE 2 — client input into an OData filter ─────────────────────────────────────────────────────

/** Is this expression traceable to the REQUEST (as opposed to a literal or a server-derived value)? */
const CLIENT_DERIVED = /triggerBody\s*\(\)|items\s*\(\s*'[^']*'\s*\)\s*\?\s*\[\s*'row'/;
/** The house guard: strip single quotes before interpolating into an OData string literal. */
const HAS_GUARD = /replace\s*\(/;

function ruleClientInput(def, flat, laName) {
  const out = [];
  for (const [name, info] of flat) {
    const uri = info.action && info.action.inputs && info.action.inputs.body && info.action.inputs.body.uri;
    if (typeof uri !== 'string' || !/\$filter=/.test(uri)) continue;

    // Everything from $filter= onward is the dangerous region.
    const region = uri.slice(uri.indexOf('$filter='));
    if (!CLIENT_DERIVED.test(region)) continue;          // literal or server-derived -> safe, say nothing

    // A guard must sit around the client-derived operand itself, not merely somewhere in the URI.
    const calls = findCalls(region, 'replace');
    const guarded = calls.some(c => CLIENT_DERIVED.test(c.inner));
    if (guarded) continue;

    const key = `${laName}::${name}`;
    out.push({
      rule: 'client-input', action: name, path: info.path, baseline: ACCEPTED_BASELINE.has(key),
      msg: `client-supplied value interpolated into an OData $filter with NO quote-stripper — a name containing an apostrophe changes the query`,
      detail: `      ${region.replace(/code=[^&'"]+/g, 'code=<REDACTED>').slice(0, 190)}\n      house rule: wrap it as replace(<value>, '''', '')`,
    });
  }
  return out;
}

// ── SELF-TEST ──────────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const synth = {
    actions: {
      InitVars: { type: 'InitializeVariable', runAfter: {}, inputs: { variables: [{ name: 'failed', type: 'Array' }, { name: 'note', type: 'String' }] } },
      Q1: { type: 'Query', runAfter: {}, inputs: { from: '@triggerBody()', where: '@true' } },
      Q2: { type: 'Select', runAfter: {}, inputs: { from: "@body('Q1')", select: '@item()' } },
      BadMerge: { type: 'Compose', runAfter: {}, inputs: "@concat(body('Q1'), body('Q2'))" },
      GoodMerge: { type: 'Compose', runAfter: {}, inputs: "@union(body('Q1'), body('Q2'))" },
      BadVarMerge: { type: 'Compose', runAfter: {}, inputs: "@concat(variables('failed'), body('Q1'))" },
      GoodString: { type: 'Compose', runAfter: {}, inputs: "@concat('a', variables('note'), 'b')" },
      UnguardedRead: { type: 'ApiConnection', runAfter: {}, inputs: { body: { uri: "@{concat('_api/web/lists/getbytitle(''X'')/items?$filter=Username eq ''', triggerBody()?['actorUsername'], '''')}" } } },
      GuardedRead: { type: 'ApiConnection', runAfter: {}, inputs: { body: { uri: "@{concat('_api/web/lists/getbytitle(''X'')/items?$filter=Username eq ''', replace(coalesce(triggerBody()?['actorUsername'],''),'''',''), '''')}" } } },
      LiteralRead: { type: 'ApiConnection', runAfter: {}, inputs: { body: { uri: "@{concat('_api/web/lists/getbytitle(''X'')/items?$filter=StoreId eq ''__director''')}" } } },
      ServerRead: { type: 'ApiConnection', runAfter: {}, inputs: { body: { uri: "@{concat('_api/web/lists/getbytitle(''X'')/items?$filter=Id eq ''', body('Q2')?['id'], '''')}" } } },
    },
  };
  const flat = flatten(synth.actions, '', new Map());
  const av = collectArrayVars(synth);
  const t = ruleTypes(synth, flat, av);
  const c = ruleClientInput(synth, flat, 'synth');
  const hasT = (n) => t.some(x => x.action === n);
  const hasC = (n) => c.some(x => x.action === n);

  const cases = [
    { id: 'E1', why: 'concat() on two Query/Select bodies is caught', ok: hasT('BadMerge') },
    { id: 'E2', why: 'union() on the same operands is NOT flagged', ok: !hasT('GoodMerge') },
    { id: 'E3', why: 'concat() on an Array-typed variable is caught', ok: hasT('BadVarMerge') },
    { id: 'E4', why: 'ordinary string building with concat() is NOT flagged', ok: !hasT('GoodString') },
    { id: 'E5', why: 'client value in a $filter with no guard is caught', ok: hasC('UnguardedRead') },
    { id: 'E6', why: 'the same query WITH the quote-stripper is NOT flagged', ok: !hasC('GuardedRead') },
    { id: 'E7', why: 'a LITERAL in a $filter is NOT flagged (the real Get_creds case)', ok: !hasC('LiteralRead') },
    { id: 'E8', why: 'a SERVER-derived value in a $filter is NOT flagged', ok: !hasC('ServerRead') },
  ];

  console.log('expression-safety gate — self-test\n');
  let bad = 0;
  for (const x of cases) { if (!x.ok) bad++; console.log(`  ${x.ok ? 'CORRECT' : 'WRONG  '} [${x.id}] ${x.why}`); }
  console.log(`\n==== self-test: ${cases.length - bad}/${cases.length} behaviours proven ====`);
  if (bad) console.log('     Four of these prove it stays QUIET. A gate that flags safe code is worse than none.');
  return bad;
}

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

  const files = args.length && !args[0].startsWith('--')
    ? [args[0]]
    : fs.readdirSync(DIR).filter(f => /-PRE-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();

  if (!files.length) { console.log('No captures found. Run: node audit-artifacts/capture-all-staging-defs.js'); process.exit(1); }

  console.log(`expression-safety gate — ${files.length} definition(s)\n`);
  let newFindings = 0, baseline = 0;

  for (const f of files) {
    let def; try { def = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { console.log(`  UNREADABLE ${f}`); newFindings++; continue; }
    const la = f.replace(/-PRE-\d{4}-\d{2}-\d{2}\.json$/, '');
    const flat = flatten(def.actions, '', new Map());
    const av = collectArrayVars(def);
    const hits = [...ruleTypes(def, flat, av), ...ruleClientInput(def, flat, la)];
    if (!hits.length) { console.log(`  clean       ${la}`); continue; }

    console.log(`  ${hits.some(h => !h.baseline) ? 'FINDINGS  ' : 'baseline  '}  ${la}`);
    for (const h of hits) {
      if (h.baseline) { baseline++; console.log(`    · BASELINE (pre-dates item 5) ${h.action} — ${h.msg}`); continue; }
      newFindings++;
      console.log(`    🛑 [${h.rule}] ${h.path}`);
      console.log(`       ${h.msg}`);
      if (h.detail) console.log(h.detail);
    }
    console.log('');
  }

  if (baseline) {
    console.log(`${baseline} BASELINE finding(s) — pre-existing, NOT introduced by this wave. Kunal decides`);
    console.log('fix-now or accepted-baseline; they do not fail this gate so a red light always means a regression.\n');
  }
  if (newFindings) {
    console.log(`==== ${newFindings} FINDING(S) ====`);
    process.exit(1);
  }
  console.log('==== EXPRESSIONS OK ====');
  process.exit(0);
}

main();
