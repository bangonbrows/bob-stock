// EXPRESSION VALIDATOR for the generated N1 Logic App definition.
//
// The third gate. The other two cannot see this class:
//   check-fn-contracts.js  knows WHAT we send a function, not whether the expression producing it evaluates.
//   check-correction-def.js knows HOW actions connect, not what the expressions inside them mean.
// Both auditors found runtime-semantics defects by hand — a `Response` that does not end a run, a
// `coalesce` that never falls through, a `filter()` that is not a Workflow Definition Language
// function at all. Those deploy cleanly and fail in production. This gate catches them at build time.
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'correction-def-generated.json');
const raw = fs.readFileSync(file, 'utf8');
const def = JSON.parse(raw);
const problems = [];

// ── 1. WDL function allowlist ──────────────────────────────────────────────────────────────────────
// Workflow Definition Language has a FIXED function set and NO user-defined functions or lambdas.
// `filter(array, item => ...)` is JavaScript, not WDL: it fails at definition validation or at
// evaluation. Array filtering is a Query ACTION with item(), never an inline expression.
const WDL = new Set([
  'concat', 'coalesce', 'if', 'equals', 'not', 'and', 'or', 'empty', 'length', 'first', 'last',
  'json', 'string', 'int', 'float', 'bool', 'array', 'createArray', 'union', 'intersection', 'take',
  'skip', 'join', 'split', 'replace', 'toLower', 'toUpper', 'trim', 'substring', 'indexOf',
  'lastIndexOf', 'startsWith', 'endsWith', 'contains', 'add', 'sub', 'mul', 'div', 'mod', 'min',
  'max', 'range', 'rand', 'utcNow', 'addMinutes', 'addHours', 'addDays', 'addSeconds',
  'formatDateTime', 'startOfDay', 'ticks', 'dayOfWeek', 'base64', 'base64ToString',
  'encodeUriComponent', 'encodeURIComponent', 'decodeUriComponent', 'uriComponent', 'guid',
  'workflow', 'trigger', 'triggerBody', 'triggerOutputs', 'triggerFormDataValue', 'body', 'outputs',
  'items', 'item', 'variables', 'parameters', 'actions', 'setProperty', 'addProperty',
  'removeProperty', 'xpath', 'greater', 'less', 'greaterOrEquals', 'lessOrEquals', 'nullValue',
  'isNull', 'result', 'action', 'binary', 'dataUri',
]);

// Harvest EXPRESSION CODE ONLY. A SharePoint URI is a literal that happens to contain `@{...}`
// interpolations — scanning the whole literal reported `getbytitle(` as an unknown WDL function,
// 23 times. A gate that reports 23 non-bugs teaches you to skim its output, which is how a real
// one gets missed. So: take the whole string when it is a bare `@expression`, otherwise take only
// what is inside each `@{ ... }`.
const exprStrings = [];
const addExpr = (s) => {
  if (typeof s !== 'string' || !s.includes('@')) return;
  if (s.startsWith('@') && !s.startsWith('@{')) { exprStrings.push(s.slice(1)); return; }
  for (const m of s.matchAll(/@\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) exprStrings.push(m[1]);
};
const uriStrings = [];
(function harvestUris(node) {
  if (typeof node === 'string') { if (node.includes('$filter=') || node.includes('getbytitle')) uriStrings.push(node); return; }
  if (Array.isArray(node)) { node.forEach(harvestUris); return; }
  if (node && typeof node === 'object') Object.values(node).forEach(harvestUris);
})(def);
(function harvest(node) {
  if (typeof node === 'string') { addExpr(node); return; }
  if (Array.isArray(node)) { node.forEach(harvest); return; }
  if (node && typeof node === 'object') { Object.values(node).forEach(harvest); }
})(def);

for (const s of exprStrings) {
  for (const m of s.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const fnName = m[1];
    if (!WDL.has(fnName)) problems.push(`UNKNOWN WDL FUNCTION '${fnName}(' in: ${s.slice(0, 110)}`);
  }
  if (/=>/.test(s)) problems.push(`ARROW FUNCTION in an expression — WDL has no lambdas: ${s.slice(0, 110)}`);
}

// ── 2. coalesce() against an ARRAY-valued expression ───────────────────────────────────────────────
// An empty array is NOT null, so coalesce(emptyArray, fallback) returns the EMPTY ARRAY and never
// reaches the fallback. Source-first "live else archive" selection written with coalesce therefore
// never sees the archive. Use if(empty(x), fallback, x).
// ⚠ THE FIRST VERSION OF THIS RULE COULD NEVER FIRE. It used `[^,()]*` for the first argument — but
// the shape it exists to catch, `coalesce(body('X')?['value'], ...)`, CONTAINS parentheses. The rule
// looked right, reported zero, and three real instances sat in the artifact. Match the argument
// properly (balanced one level) instead.
// TWO SUB-CLASSES, and only one is a defect:
//   coalesce(X?['value'], json('[]'))        — FINE. A missing property really is null, so it falls
//                                              through; and if it is an empty array, the fallback is
//                                              the same empty array. No behaviour change.
//   coalesce(live?['value'], archive?['value']) — FATAL. An EMPTY live array is not null, so the
//                                              archive is never consulted and archived targets are
//                                              invisible. This is the source-first selection bug.
// Flagging both would bury the fatal case in noise, which is how a real finding gets skimmed past.
for (const s of exprStrings) {
  for (const m of s.matchAll(/coalesce\(\s*((?:[^,()]|\([^()]*\))*\?\['value'\])\s*,\s*((?:[^,()]|\([^()]*\))*)/g)) {
    const fallback = (m[2] || '').trim();
    if (!/\?\['value'\]/.test(fallback)) continue;     // literal/empty fallback — harmless
    problems.push(`COALESCE OVER TWO ARRAYS — an empty array is not null, so the second is never reached: coalesce(${m[1].trim()}, ${fallback.slice(0, 40)})`);
  }
}

// ── 3. first() without an emptiness guard ──────────────────────────────────────────────────────────
// The two auditors DISAGREE on whether first([]) returns null or raises a template error, and that
// is an external platform fact neither I nor they can settle from this repo. Guarding is correct
// under BOTH readings, so the guard is mandatory and the disagreement is a staging probe.
// ⚠ THE GUARD TEST USED TO BE POSITIONAL — "some empty() appears before some first()" — so an
// empty() on a COMPLETELY DIFFERENT collection counted as a guard (AGY). The guard must test the
// SAME argument the first() consumes.
for (const s of exprStrings) {
  for (const m of s.matchAll(/first\(((?:[^()]|\([^()]*\))*)\)/g)) {
    const arg = m[1].trim();
    if (!arg) continue;
    const guarded = s.includes(`empty(${arg})`);
    if (!guarded) problems.push(`UNGUARDED first() — behaviour on an empty collection is platform-dependent, and any empty() guard must test THIS argument: first(${arg.slice(0, 70)})`);
  }
}

// ── 4. ETag property naming + reading an ETag off a MERGE response ─────────────────────────────────
// nometadata returns the item ETag as `odata.etag` (no '@' prefix) — the deployed archive LA proves
// it. And a SharePoint MERGE answers 204 with no body and no usable ETag header, so a CAS chained
// off a MERGE response is fencing on null.
if (raw.includes("['@odata.etag']")) problems.push("ETAG NAMING: ['@odata.etag'] — nometadata returns 'odata.etag' with no '@' prefix");
for (const s of exprStrings) {
  if (/outputs\('[^']+'\)\?\['headers'\]\?\['ETag'\]/i.test(s)) {
    problems.push(`ETAG FROM A MERGE RESPONSE: ${s.slice(0, 90)} — SharePoint MERGE returns 204 with no ETag header; reuse the ETag captured from the GET`);
  }
}

// Is `name` inside a Scope that HAS a failure handler which actually reaches a Response?
// This is deliberately strict: the mere existence of an enclosing Scope proves nothing — some
// sibling of that Scope must run on [Failed]/[TimedOut] AND that branch must reach a Response.
// Otherwise a failure inside the Scope still ends the run silently.
function reachesResponse(actions) {
  return Object.values(actions || {}).some(a => a.type === 'Response'
    || reachesResponse(a.actions) || reachesResponse(a.else && a.else.actions)
    || Object.values(a.cases || {}).some(c => reachesResponse(c.actions))
    || reachesResponse(a.default && a.default.actions));
}
function containedByFailureHandler(name) {
  // find the chain of Scopes enclosing `name`
  const enclosing = [];
  (function walk(node, stack) {
    for (const [k, a] of Object.entries(node || {})) {
      if (k === name) { enclosing.push(...stack); return; }
      const nextStack = a.type === 'Scope' ? stack.concat([{ scopeName: k, siblings: node }]) : stack;
      for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) if (sub) walk(sub, nextStack);
      for (const c of Object.values(a.cases || {})) if (c.actions) walk(c.actions, nextStack);
    }
  })(def.actions, []);
  // The handler is rarely the Response itself — it is usually the HEAD of a chain
  // (re-read state -> release the lock -> respond -> terminate). So from every sibling triggered by
  // the Scope failing, FOLLOW THE runAfter EDGES FORWARD and ask whether a Response is reachable.
  // Checking only the immediate sibling reported 31 false positives against a correct structure.
  return enclosing.some(({ scopeName, siblings }) => {
    const heads = Object.entries(siblings).filter(([, sib]) => {
      const st = (sib.runAfter || {})[scopeName] || [];
      return st.includes('Failed') || st.includes('TimedOut');
    }).map(([n]) => n);
    if (!heads.length) return false;
    const seen = new Set(heads);
    const queue = [...heads];
    while (queue.length) {
      const cur = queue.shift();
      const a = siblings[cur];
      if (!a) continue;
      if (a.type === 'Response' || reachesResponse(a.actions) || reachesResponse(a.else && a.else.actions)) return true;
      for (const [n, sib] of Object.entries(siblings)) {
        if (seen.has(n)) continue;
        if (Object.keys(sib.runAfter || {}).includes(cur)) { seen.add(n); queue.push(n); }
      }
    }
    return false;
  });
}

function findAction(node, name) {
  for (const [k, a] of Object.entries(node || {})) {
    if (k === name) return a;
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) { const h = sub && findAction(sub, name); if (h) return h; }
    for (const c of Object.values(a.cases || {})) { const h = c.actions && findAction(c.actions, name); if (h) return h; }
  }
  return null;
}
// ── 5. runAfter must handle TimedOut wherever it handles Failed ────────────────────────────────────
// An action can end Succeeded / Failed / Skipped / TimedOut. A gate that lists only Succeeded+Failed
// is SKIPPED on a timeout, so the run ends with no Response — the caller hangs and the refusal
// branch never fires. Function cold starts make this ordinary, not exotic.
(function walkRunAfter(actions, scope) {
  for (const [name, a] of Object.entries(actions || {})) {
    for (const [dep, statuses] of Object.entries(a.runAfter || {})) {
      const fallible = (n) => { const a = findAction(def.actions, n); return a && (a.type === 'Http' || a.type === 'ApiConnection'); };
      // ⚠ RULE RESHAPED — and I checked this was not just "make the gate pass".
      // The ORIGINAL rule was per-edge: every successor of a fallible call must itself handle
      // Failed/TimedOut. That was right while the workflow was a flat chain. It is WRONG once the
      // actions are wrapped in a containment Scope: a failure inside a Scope fails the SCOPE, and
      // the Scope's own failure handler catches it. Demanding per-edge handling inside an enclosed
      // Scope would force 31 redundant handlers and make the correct structure un-passable.
      // What ACTUALLY has to be true is unchanged: every failure must reach a Response. So the rule
      // now asks that — the action either handles the status itself, OR sits inside a Scope whose
      // failure handler reaches a Response. If that enclosure is missing or handles nothing, all 31
      // come back (proved by mutation X1, which strips the handler's runAfter statuses).
      if (fallible(dep) && !statuses.includes('Failed') && !statuses.includes('TimedOut') && !containedByFailureHandler(name)) {
        problems.push(`runAfter HANDLES NEITHER Failed NOR TimedOut: '${name}' after the fallible call '${dep}' handles only [${statuses.join(',')}], and it is not inside a Scope with a failure handler that responds — any failure ends the run with no Response`);
      }
      if (statuses.includes('Failed') && !statuses.includes('TimedOut')) {
        problems.push(`runAfter MISSING TimedOut: '${name}' after '${dep}' handles [${statuses.join(',')}] — a timeout skips it and the run ends with no Response`);
      }
    }
    if (a.actions) walkRunAfter(a.actions, name);
    if (a.else?.actions) walkRunAfter(a.else.actions, name);
    for (const c of Object.values(a.cases || {})) if (c.actions) walkRunAfter(c.actions, name);
    if (a.default?.actions) walkRunAfter(a.default.actions, name);
  }
})(def.actions, '');

// ── 6. unescaped interpolation inside an OData string literal ──────────────────────────────────────
// A value containing an apostrophe (O'Connor) terminates the literal early: the query 400s, or worse
// becomes injectable. OData escapes a quote by DOUBLING it, so every interpolated value needs
// replace(x, '''', '''''').
// ⚠ THIS SCANNED THE HARVESTED INTERPOLATION FRAGMENTS, which by construction never contain
// "$filter=" — the rule could not fire. OData literals live in the FULL URI string, so scan those.
for (const s of uriStrings) {
  if (!/\$filter=/.test(s)) continue;
  for (const m of s.matchAll(/eq\s*'@\{([^}]*)\}'/g)) {
    if (!/replace\(/.test(m[1])) problems.push(`UNESCAPED ODATA INTERPOLATION: eq '@{${m[1].slice(0, 70)}}' — an apostrophe in the value breaks or injects the filter`);
  }
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────────
console.log(`expression validator: ${path.basename(file)}`);
console.log(`  expressions scanned: ${exprStrings.length}`);
if (problems.length === 0) { console.log('\n==== EXPRESSIONS OK — 0 problems ===='); process.exit(0); }
const byKind = {};
for (const p of problems) { const k = p.split(':')[0]; (byKind[k] = byKind[k] || []).push(p); }
console.log(`\n==== ${problems.length} EXPRESSION PROBLEM(S) ====`);
for (const [k, list] of Object.entries(byKind)) {
  console.log(`\n  ${k}  (${list.length})`);
  list.slice(0, 6).forEach(p => console.log('    - ' + p));
  if (list.length > 6) console.log(`    … and ${list.length - 6} more`);
}
process.exit(1);
