// CONTRACT HARNESS for the generated N1 Logic App definition.
//
// WHY THIS EXISTS: the first generated definition had ALL TWENTY function calls wrong — the wrong
// envelope, the wrong property names, and responses read from properties the handlers never return.
// Both auditors caught it by hand. This makes that class impossible to reintroduce: it derives each
// contract FROM THE REAL DEPLOYED MODULE and fails the build on any mismatch.
//
// HOW IT DERIVES CONTRACTS (no hand-maintained table — that would rot like the spec did):
//   REQUEST side  — each correctionCompute op is invoked with `input` replaced by a recording
//                   Proxy, so we observe EXACTLY which properties the real function reads.
//   RESPONSE side — the same invocation's return value gives the real output key set; every
//                   `body('Action')?['prop']` expression in the definition is checked against it.
//
// Exit 0 = every emitted call matches the real handler. Exit 1 = at least one mismatch.
//
// ⚠ KNOWN LIMIT — READ BEFORE TRUSTING A CLEAN RUN. Proxy discovery observes only the branch the
// function takes when every input is undefined. A function that refuses early (`if (!input.cell)
// return refuse(...)`) never reaches its later reads, so those properties are never observed.
// Therefore:
//   "reads but NOT SENT"  is SOUND      — anything observed as read really is read.
//   "sent but never read" is a NOTE ONLY — it may simply be a property behind an early return.
// That asymmetry is why the second list never fails the build. It also means a clean run proves
// "nothing I send is wrong", NOT "everything the function needs is sent" on deeper branches — those
// are covered by the proof suite (test/correction-proof.js), which drives real inputs end to end.
'use strict';
const fs = require('fs');
const path = require('path');

const FN_DIR = path.join(__dirname, '..', 'azure-functions', 'src', 'functions');
const cc = require(path.join(FN_DIR, 'correctionCompute.js'));
const defFile = process.argv[2] || path.join(__dirname, 'correction-def-generated.json');
const def = JSON.parse(fs.readFileSync(defFile, 'utf8'));

const problems = [];
const note = [];

// ── 1. discover what each correctionCompute op READS, by proxy ─────────────────────────────────────
// The dispatch table maps op -> fn(body). Every op reads from body.input (verified: correctionCompute
// OPS entries are all `(b) => f(b.input || {})`). A Proxy on `input` records each property touched.
function readsOf(opName) {
  const touched = new Set();
  const rec = new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      touched.add(String(p));
      // return a permissive stand-in so the function keeps walking its own logic
      return undefined;
    },
    has(t, p) { touched.add(String(p)); return false; },
  });
  try { cc.OPS[opName]({ input: rec }); } catch (e) { /* refusals are expected; we only want the reads */ }
  return touched;
}

// ── 2. walk every function-call action in the definition ───────────────────────────────────────────
const calls = {};          // actionName -> {route, op, sentProps, hasInputEnvelope}
function collect(actions, scope) {
  for (const [name, a] of Object.entries(actions || {})) {
    if (a.type === 'Http' && typeof a?.inputs?.uri === 'string' && a.inputs.uri.includes('/api/')) {
      const route = a.inputs.uri.split('/api/')[1].split('?')[0];
      const body = a.inputs.body || {};
      calls[name] = {
        route,
        op: body.op,
        frame: body.frame,
        topLevel: Object.keys(body),
        input: body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? Object.keys(body.input) : null,
        rowsIsArray: Array.isArray(body.rows),
        rowsExpr: typeof body.rows === 'string' ? body.rows : null,
      };
    }
    if (a.actions) collect(a.actions, name);
    if (a.else?.actions) collect(a.else.actions, name);
    for (const c of Object.values(a.cases || {})) if (c.actions) collect(c.actions, name);
    if (a.default?.actions) collect(a.default.actions, name);
  }
}
collect(def.actions, '');

// An expression is ARRAY-SHAPED if its outermost call produces a collection, or it reads a
// SharePoint result set (?['value'] / ?['results']). A bare property access is scalar-shaped.
function arrayShapedExpr(s) {
  if (typeof s !== 'string') return false;
  const e = s.trim().replace(/^@/, '');
  if (/^(union|createArray|coalesce|json|take|skip|split|range|intersection)\s*\(/.test(e)) return true;
  if (/\?\['(value|results|sigs)'\]\s*$/.test(e)) return true;
  return false;
}
// ── 3. REQUEST-side conformance ────────────────────────────────────────────────────────────────────
for (const [name, c] of Object.entries(calls)) {
  if (c.route === 'correctionCompute') {
    if (!cc.OPS[c.op]) { problems.push(`${name}: op '${c.op}' does not exist in correctionCompute.OPS`); continue; }
    // THE ENVELOPE. Every op reads b.input — a flat body delivers {} to the function.
    if (c.input === null) {
      problems.push(`${name}: WRONG ENVELOPE — sends fields at top level (${c.topLevel.filter(k => k !== 'op').join(',')}); correctionCompute reads body.input, so the op receives {}`);
      continue;
    }
    const reads = readsOf(c.op);
    const sent = new Set(c.input);
    const missing = [...reads].filter(r => !sent.has(r));
    const unused = [...sent].filter(s => !reads.has(s));
    if (missing.length) problems.push(`${name} (op:${c.op}): reads but NOT SENT -> ${missing.join(', ')}`);
    if (unused.length) note.push(`${name} (op:${c.op}): sent but never read -> ${unused.join(', ')}`);
  } else if (!['attestRows', 'validateKeys', 'verifyProof'].includes(c.route)) {
    problems.push(`${name}: calls /api/${c.route}, which is not a known function route`);
  } else if (c.route === 'attestRows') {
    // Verified against attestRows.evaluate: it reads body.rows (ARRAY, required), body.op, body.frame.
    if (!c.topLevel.includes('rows')) problems.push(`${name}: attestRows requires a 'rows' ARRAY; sent [${c.topLevel.join(',')}]`);
    // attestRows.evaluate calls rows.map(...) — a SCALAR throws / 400s. Presence is not enough.
    // `rows` may legitimately be a WDL EXPRESSION that evaluates to an array (e.g.
    // "@union(coalesce(a,json('[]')), coalesce(b,json('[]')))"). Array.isArray() alone cannot tell
    // that from a genuine scalar, so it wrongly flagged a correct binding. Distinguish by SHAPE:
    // an array-producing form is fine; a BARE PROPERTY ACCESS (@body('X')?['row']) is the real
    // defect, because evaluate() calls rows.map(). Keeps the C4 mutation caught.
    else if (!c.rowsIsArray && !arrayShapedExpr(c.rowsExpr)) {
      problems.push(`${name}: attestRows 'rows' must be an ARRAY — a scalar expression was sent (${String(c.rowsExpr).slice(0, 60)}), and evaluate() maps over it`);
    }
    if (c.frame && c.frame !== 'econ-v1' && c.op === 'verify') note.push(`${name}: framed verify needs rows:[{obj,sig}] and returns results:[bool]`);
  } else if (c.route === 'validateKeys') {
    for (const need of ['claimedStoreId', 'storeKey', 'directorKey', 'rows']) {
      if (!c.topLevel.includes(need)) problems.push(`${name}: validateKeys requires '${need}'; sent [${c.topLevel.join(',')}]`);
    }
  } else if (c.route === 'verifyProof') {
    for (const need of ['proof', 'deviceContext', 'rows']) {
      if (!c.topLevel.includes(need)) problems.push(`${name}: verifyProof requires '${need}'; sent [${c.topLevel.join(',')}]`);
    }
  }
}

// STATIC RETURN KEYS the proxy pass cannot see — an op that refuses on empty input never builds its
// success object, so we must read the source.
//
// ⚠ THIS WAS A HAND-MAINTAINED TABLE AND IT ROTTED ON THE VERY FIRST CHANGE: extending
// assembleCandidate to return `row`/`journalId`/`candidateVersion` left the table stale, and the
// harness kept reporting properties as "never returned" when they now were. A gate that needs
// hand-maintenance is a gate that lies. Return keys are now DERIVED from the module source, so they
// track the code automatically — the same reason the request side uses a proxy rather than a list.
const CC_SRC = fs.readFileSync(path.join(FN_DIR, 'correctionCompute.js'), 'utf8');
function bodyOf(fnName) {
  const start = CC_SRC.indexOf(`function ${fnName}(`);
  if (start < 0) return '';
  // to the next top-level function/section marker
  const rest = CC_SRC.slice(start + 1);
  const endRel = rest.search(/\n(?:function |\/\/ ──|const OPS)/);
  return endRel < 0 ? rest : rest.slice(0, endRel);
}
// map op -> the function it dispatches to, read from the OPS table source
function fnNameForOp(opName) {
  const m = CC_SRC.match(new RegExp(`\\n\\s*${opName}:\\s*\\(b\\)\\s*=>\\s*\\(?\\s*\\{?\\s*([A-Za-z0-9_]+)`));
  return m ? m[1] : null;
}
function derivedReturnKeys(opName) {
  const keys = new Set();
  const fnName = fnNameForOp(opName);
  // an inline op like `digest: (b) => ({ digest: opDigest(b.input) })` names its keys in OPS itself
  const inline = CC_SRC.match(new RegExp(`\\n\\s*${opName}:\\s*\\(b\\)\\s*=>\\s*\\(\\{([^}]*)\\}\\)`));
  if (inline) for (const km of inline[1].matchAll(/([A-Za-z0-9_]+)\s*:/g)) keys.add(km[1]);
  const src = fnName ? bodyOf(fnName) : '';
  // Object-literal keys come in two forms and BOTH must be read. The first cut only matched `key:`,
  // so it missed SHORTHAND properties — `const out = { ok: true, controlId, candidateHeads: heads,
  // adoptionDecisions }` reported controlId and adoptionDecisions as "never returned", which is a
  // false alarm that would have sent me chasing a non-bug. A gate that cries wolf gets ignored.
  // TOP-LEVEL keys only: strip one level of nesting first, so `deltas: {}` does not hide the
  // literal from the scanner and a nested key is not mistaken for a returned one.
  const keysFromLiteral = (lit) => {
    const flat = lit.replace(/\{[^{}]*\}/g, '{}');   // collapse nested objects
    for (const km of flat.matchAll(/([A-Za-z0-9_]+)\s*:/g)) keys.add(km[1]);            // key: value
    // shorthand — note the `$` alternative: a TRAILING shorthand key has no ',' or '}' after it
    // once the closing brace is outside the captured group. Without it, `{ ok: true, deltas }`
    // silently dropped `deltas` and the harness reported a real property as never-returned.
    for (const km of flat.matchAll(/(?:^|[{,])\s*([A-Za-z0-9_]+)\s*(?=[,}]|$)/g)) keys.add(km[1]);
  };
  // literal capture tolerant of ONE nesting level (`return { ok: true, deltas: {}, x: 1 }`)
  const LITERAL = /\{((?:[^{}]|\{[^{}]*\})*)\}/;
  for (const m of src.matchAll(new RegExp('return\\s*' + LITERAL.source, 'g'))) keysFromLiteral(m[1]);
  // ...and literals built up in a variable that is returned later (`const out = {...}; out.x = ...`)
  for (const m of src.matchAll(new RegExp('\\b(?:const|let|var)\\s+(?:out|res|result)\\s*=\\s*' + LITERAL.source, 'g'))) keysFromLiteral(m[1]);
  for (const m of src.matchAll(/\b(?:out|res|result)\.([A-Za-z0-9_]+)\s*=/g)) keys.add(m[1]);
  return keys;
}
// ── 4. RESPONSE-side conformance ───────────────────────────────────────────────────────────────────
// Every `body('Action')?['prop']` in the whole definition must name a property the handler returns.
const RETURNS = {};   // actionName -> Set(real output keys)
for (const [name, c] of Object.entries(calls)) {
  if (c.route === 'correctionCompute' && cc.OPS[c.op]) {
    // ⚠ NO SEEDING. The first version unconditionally seeded ['ok','reason','detail'] "because any
    // op may refuse" — and that is precisely what blinded it to the defect that shipped: the
    // workflow tested `body('Seal_threeway')?['ok']` while targetSeal returns ONLY {outcome:...},
    // so every valid target was refused and the gate reported zero mismatches. A default that makes
    // a check pass more often is a hole. Refusal keys are DERIVED: an op gets them only if its own
    // source actually calls refuse() or returns ok/reason itself.
    const keys = new Set();
    const fnSrc = (function () { const n = fnNameForOp(c.op); return n ? bodyOf(n) : ''; })();
    if (/\brefuse\s*\(/.test(fnSrc)) { keys.add('ok'); keys.add('reason'); keys.add('detail'); }
    // sample the real return across a couple of permissive inputs
    for (const probe of [{}, { input: {} }]) {
      try { const r = cc.OPS[c.op](probe); if (r && typeof r === 'object') Object.keys(r).forEach(k => keys.add(k)); } catch (e) {}
    }
    RETURNS[name] = keys;
  } else if (!['attestRows', 'validateKeys', 'verifyProof'].includes(c.route)) {
    problems.push(`${name}: calls /api/${c.route}, which is not a known function route`);
  } else if (c.route === 'attestRows') {
    RETURNS[name] = new Set(c.op === 'sign' ? ['sigs', 'error'] : ['results', 'error']);
  } else if (c.route === 'validateKeys') {
    RETURNS[name] = new Set(['storeOk', 'directorOk', 'error']);
  } else if (c.route === 'verifyProof') {
    RETURNS[name] = new Set(['ok', 'username', 'role']);
  }
}

for (const [name, c] of Object.entries(calls)) {
  if (c.route === 'correctionCompute' && cc.OPS[c.op]) derivedReturnKeys(c.op).forEach(k => RETURNS[name].add(k));
}
// fold the source-derived return keys in now that RETURNS exists
for (const [name, c] of Object.entries(calls)) {
  if (c.route === 'correctionCompute' && cc.OPS[c.op]) derivedReturnKeys(c.op).forEach(k => RETURNS[name].add(k));
}

// ── ENUM DOMAINS + NUMERIC KEYS, derived from the function source ─────────────────────────────────
// Both fatal mismatches that shipped were DISCRIMINANT comparisons: `.ok` on an op that returns only
// `.outcome`, and `.decision === 'committed'` when the op emits roll_forward/roll_back/
// INVARIANT_BROKEN. A property-name check cannot see either — the name is real, the VALUE is
// impossible. So: harvest the string literals each op assigns to a discriminant key, and flag any
// expression comparing that key to a literal outside the set. Same for numeric keys vs string
// literals, because WDL equals() is type-strict (AGY).
const DISCRIMINANTS = ['outcome', 'decision', 'baseline', 'lane', 'action', 'status', 'tier', 'partitionMode'];
const NUMERIC_KEYS = ['revision', 'candidateVersion', 'cutoffId', 'snapshotVersion', 'highestRevision', 'count'];
const domains = {};   // op -> key -> Set(literals)
for (const opName of Object.keys(cc.OPS)) {
  const n = fnNameForOp(opName); if (!n) continue;
  const src = bodyOf(n);
  for (const key of DISCRIMINANTS) {
    for (const m of src.matchAll(new RegExp(`${key}\\s*:\\s*'([^']*)'`, 'g'))) {
      ((domains[opName] = domains[opName] || {})[key] = domains[opName][key] || new Set()).add(m[1]);
    }
  }
}

const raw = fs.readFileSync(defFile, 'utf8');

// Walk the PARSED comparison structures — never raw text. A regex over the JSON matched adjacent
// object keys as if they were operands ("revision is compared to 'publicationVersion'"), which is
// the same imprecision that makes a gate lie. Comparisons live in `expression` trees as
// { equals|contains|greater|...: [operandA, operandB] }.
const CMP = new Set(['equals', 'contains', 'greater', 'less', 'greaterOrEquals', 'lessOrEquals']);
const readRe = /body\('([A-Za-z0-9_]+)'\)\?\['([A-Za-z0-9_]+)'\]/;
function checkComparison(pair) {
  if (!Array.isArray(pair) || pair.length !== 2) return;
  for (const [a, b] of [[pair[0], pair[1]], [pair[1], pair[0]]]) {
    if (typeof a !== 'string' || typeof b !== 'string') continue;
    const m = a.match(readRe); if (!m) continue;
    const [, action, key] = m;
    const c = calls[action]; if (!c || c.route !== 'correctionCompute' || !c.op) continue;
    if (b.includes('@')) continue;                       // both sides dynamic — nothing to prove
    const dom = (domains[c.op] || {})[key];
    if (dom && dom.size && !dom.has(b)) {
      problems.push(`IMPOSSIBLE COMPARISON: body('${action}')?['${key}'] is compared to '${b}', but ${c.op} can only emit { ${[...dom].join(' | ')} }`);
    }
    if (NUMERIC_KEYS.includes(key) && b !== '' && isNaN(Number(b))) {
      problems.push(`TYPE-STRICT COMPARISON: body('${action}')?['${key}'] is numeric but is compared to the STRING "${b}" — WDL equals() is type-strict, so this is always false`);
    }
  }
}
(function walkExpr(node) {
  if (Array.isArray(node)) { node.forEach(walkExpr); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (CMP.has(k)) checkComparison(v);
    walkExpr(v);
  }
})(def);

const refRe = /body\('([A-Za-z0-9_]+)'\)\?\['([A-Za-z0-9_@.]+)'\]/g;
const seen = new Set();
let m;
while ((m = refRe.exec(raw)) !== null) {
  const [, action, prop] = m;
  const sig = action + '.' + prop;
  if (seen.has(sig)) continue;
  seen.add(sig);
  if (!RETURNS[action]) continue;                    // not a function call (SharePoint action) — skip
  if (!RETURNS[action].has(prop)) {
    problems.push(`READS A PROPERTY THAT IS NEVER RETURNED: body('${action}')?['${prop}'] — ${calls[action].route}${calls[action].op ? ' op:' + calls[action].op : ''} returns { ${[...RETURNS[action]].join(', ')} }`);
  }
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────────
console.log(`contract harness: ${path.basename(defFile)}`);
console.log(`  function calls found: ${Object.keys(calls).length}`);
console.log(`  correctionCompute ops in dispatch table: ${Object.keys(cc.OPS).length}`);
if (note.length) { console.log('\n-- notes (not failures) --'); note.forEach(n => console.log('  · ' + n)); }
if (problems.length === 0) { console.log('\n==== CONTRACTS OK — 0 mismatches ===='); process.exit(0); }
console.log(`\n==== ${problems.length} CONTRACT MISMATCH(ES) ====`);
problems.forEach(p => console.log('  - ' + p));
process.exit(1);
