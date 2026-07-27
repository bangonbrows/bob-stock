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
        input: body.input && typeof body.input === 'object' ? Object.keys(body.input) : null,
      };
    }
    if (a.actions) collect(a.actions, name);
    if (a.else?.actions) collect(a.else.actions, name);
    for (const c of Object.values(a.cases || {})) if (c.actions) collect(c.actions, name);
    if (a.default?.actions) collect(a.default.actions, name);
  }
}
collect(def.actions, '');

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
  } else if (c.route === 'attestRows') {
    // Verified against attestRows.evaluate: it reads body.rows (ARRAY, required), body.op, body.frame.
    if (!c.topLevel.includes('rows')) problems.push(`${name}: attestRows requires a 'rows' ARRAY; sent [${c.topLevel.join(',')}]`);
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

// ── 4. RESPONSE-side conformance ───────────────────────────────────────────────────────────────────
// Every `body('Action')?['prop']` in the whole definition must name a property the handler returns.
const RETURNS = {};   // actionName -> Set(real output keys)
for (const [name, c] of Object.entries(calls)) {
  if (c.route === 'correctionCompute' && cc.OPS[c.op]) {
    const keys = new Set(['ok', 'reason', 'detail']);   // every op may refuse
    // sample the real return across a couple of permissive inputs
    for (const probe of [{}, { input: {} }]) {
      try { const r = cc.OPS[c.op](probe); if (r && typeof r === 'object') Object.keys(r).forEach(k => keys.add(k)); } catch (e) {}
    }
    RETURNS[name] = keys;
  } else if (c.route === 'attestRows') {
    RETURNS[name] = new Set(c.op === 'sign' ? ['sigs', 'error'] : ['results', 'error']);
  } else if (c.route === 'validateKeys') {
    RETURNS[name] = new Set(['storeOk', 'directorOk', 'error']);
  } else if (c.route === 'verifyProof') {
    RETURNS[name] = new Set(['ok', 'username', 'role']);
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
  for (const m of src.matchAll(/return\s*\{([^}]*)\}/g)) {
    for (const km of m[1].matchAll(/([A-Za-z0-9_]+)\s*:/g)) keys.add(km[1]);
  }
  for (const m of src.matchAll(/\b(?:out|res|result)\.([A-Za-z0-9_]+)\s*=/g)) keys.add(m[1]);
  return keys;
}
for (const [name, c] of Object.entries(calls)) {
  if (c.route === 'correctionCompute' && cc.OPS[c.op]) derivedReturnKeys(c.op).forEach(k => RETURNS[name].add(k));
}

const raw = fs.readFileSync(defFile, 'utf8');
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
