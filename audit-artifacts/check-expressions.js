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
const unharvested = [];
const addExpr = (s) => {
  if (typeof s !== 'string' || !s.includes('@')) return;
  if (s.startsWith('@') && !s.startsWith('@{')) { exprStrings.push(s.slice(1)); return; }
  const got = [...s.matchAll(/@\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)];
  for (const m of got) exprStrings.push(m[1]);
  // HARVEST COVERAGE. This regex tolerates only ONE level of nested braces, so an interpolation
  // carrying a two-level JSON literal matches NOTHING and leaves the corpus silently — every rule
  // below then skips it (function allowlist, the WDL lexer, the coalesce and first() rules). A rule
  // that cannot see its input is not a rule. Fail LOUDLY instead of skipping.
  if (got.length !== (s.match(/@\{/g) || []).length) unharvested.push(s.slice(0, 140));
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

for (const u of unharvested) problems.push(`UNHARVESTABLE EXPRESSION — the @{...} scanner could not extract this string, so NO rule in this file examined it: ${u}`);

// ── 0. REAL WDL LEXING — quote-level correctness inside @{...} and bare @expressions ───────────────
// `@{...}` is EXPRESSION context, not a WDL string literal. A single quote OPENS a literal and `''`
// INSIDE one is an escaped quote — so `triggerBody()?[''actorUsername'']` lexes as (empty literal)
// (bare token actorUsername)(empty literal), which is a PARSE ERROR, not a value. That shipped: the
// action never evaluated and P0 verified every proof against ZERO rows
// (gen-correction-def.js:186-189). No pattern match sees it — the character sequence looks
// deliberate — and the corruption survived the external mutation test. So LEX it: consume literals
// the way the parser does, then assert what may FOLLOW a literal and that brackets balance OUTSIDE
// literals. Cheap, and it is the only rule here that reads the expression as a parser would.
function lexProblems(s) {
  const out = [];
  let paren = 0, brack = 0, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'") {
      let j = i + 1, closed = false;
      while (j < s.length) {
        if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } closed = true; j++; break; }
        j++;
      }
      if (!closed) { out.push('UNTERMINATED STRING LITERAL'); break; }
      const next = s[j];
      if (next !== undefined && !/[\s,)\]}:?]/.test(next)) {
        out.push(`A STRING LITERAL IS FOLLOWED BY '${next}' — a doubled quote here opens and immediately CLOSES an empty literal, and the token after it is not valid WDL`);
      }
      i = j; continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') { paren--; if (paren < 0) { out.push('UNBALANCED — a closing paren with nothing open'); break; } }
    else if (ch === '[') brack++;
    else if (ch === ']') { brack--; if (brack < 0) { out.push('UNBALANCED — a closing bracket with nothing open'); break; } }
    i++;
  }
  if (paren > 0) out.push(`UNBALANCED — ${paren} unclosed paren(s)`);
  if (brack > 0) out.push(`UNBALANCED — ${brack} unclosed bracket(s)`);
  return out;
}
for (const s of exprStrings) {
  for (const p of lexProblems(s)) problems.push(`WDL PARSE ERROR: ${p} in: ${s.slice(0, 110)}`);
}

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
// ⚠ `fallible` USED TO MEAN "this action is itself an Http/ApiConnection call". That is wrong for
// CONTAINERS: an If / Scope / Foreach / Switch reports Failed whenever anything inside it fails, so
// a successor chained on [Succeeded] alone is SKIPPED and the run ends with no Response. It bites
// hardest on the abort chain, which sits OUTSIDE the containment Scope and has no cover of its own:
// `Release_abort` is an If wrapping a CAS MERGE, and pinning `Abort_respond` to [Succeeded] turns
// every failed release into a silent hang for the caller. That corruption survived the external
// mutation test. Fallibility is therefore STRUCTURAL — an action is fallible if it, or anything it
// contains, can fail.
const CALL_TYPES = new Set(['Http', 'ApiConnection', 'ApiConnectionWebhook', 'Function', 'Workflow']);
function containsFallible(a) {
  if (!a) return false;
  if (CALL_TYPES.has(a.type)) return true;
  for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions,
    ...Object.values(a.cases || {}).map(c => c && c.actions)]) {
    if (sub && Object.values(sub).some(containsFallible)) return true;
  }
  return false;
}
const fallible = (n) => containsFallible(findAction(def.actions, n));
// ── 5. runAfter must handle TimedOut wherever it handles Failed ────────────────────────────────────
// An action can end Succeeded / Failed / Skipped / TimedOut. A gate that lists only Succeeded+Failed
// is SKIPPED on a timeout, so the run ends with no Response — the caller hangs and the refusal
// branch never fires. Function cold starts make this ordinary, not exotic.
(function walkRunAfter(actions, scope) {
  for (const [name, a] of Object.entries(actions || {})) {
    for (const [dep, statuses] of Object.entries(a.runAfter || {})) {
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

// ── 7. DEPENDENCY ANCESTRY — every referenced action must be a runAfter ancestor ───────────────────
// LOGIC APPS DOES NOT INFER ORDER FROM OUTPUT REFERENCES. `body('X')` inside action A does not make
// X run before A; only `runAfter` does. When A does not descend from X, A runs in parallel with it
// and `body('X')` resolves to nothing — the action does not fail, it evaluates to null and the
// downstream op refuses on input it should never have seen. That is the EXECUTION-ORDER RACE
// recorded at gen-correction-def.js:509-513 (Delta read body('Delta_cell') while running after
// Membership only), and deleting that dependency again survived the external mutation test: no
// existing rule looks at what an expression READS versus what its action WAITS FOR.
// Ancestry is transitive and crosses scope boundaries the way the runtime does: an action inherits
// the ancestry of every container it sits inside. `items('F')`/`body('F')` naming an enclosing
// Foreach or Scope is legal. Variables are held to the same rule against their InitializeVariable.
const ACT_REF = /\b(?:body|outputs|actions|items)\('([^']+)'\)/g;
const VAR_REF = /\bvariables\('([^']+)'\)/g;
const DECLARED_VARS = new Set();
(function collectVars(actions) {
  for (const a of Object.values(actions || {})) {
    if (a.type === 'InitializeVariable') for (const v of (a.inputs && a.inputs.variables) || []) DECLARED_VARS.add(v.name);
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions,
      ...Object.values(a.cases || {}).map(c => c && c.actions)]) if (sub) collectVars(sub);
  }
})(def.actions);
// the text an action OWNS — its own inputs/expression/foreach, never its nested children's
function ownExprText(a) {
  const parts = [];
  const grab = (x) => {
    if (typeof x === 'string') { parts.push(x); return; }
    if (Array.isArray(x)) { x.forEach(grab); return; }
    if (x && typeof x === 'object') Object.values(x).forEach(grab);
  };
  grab(a.inputs); grab(a.expression); grab(a.foreach); grab(a.trackedProperties);
  return parts.join('');
}
// STATUS-AWARE. An edge that does NOT list 'Succeeded' orders the two actions but guarantees the
// dependency produced NO output on that path: runAfter {X:['Skipped']} / {X:['Failed']} means the
// successor runs precisely when body('X') is absent. Counting such an edge as an ancestor collapses
// the rule back into "is the name mentioned anywhere in runAfter", which is what it was built to
// replace — and it re-encodes the execution-order race in ONE WORD instead of a deletion.
// Only SUCCESS edges carry output.
const succEdges = (a) => Object.entries((a || {}).runAfter || {})
  .filter(([, st]) => !Array.isArray(st) || st.length === 0 || st.includes('Succeeded'))
  .map(([d]) => d);
function runAfterAncestors(siblings, name) {
  const seen = new Set(); const q = succEdges(siblings[name]);
  while (q.length) {
    const c = q.shift();
    if (seen.has(c)) continue;
    seen.add(c);
    for (const d of succEdges(siblings[c])) q.push(d);
  }
  return seen;
}
(function ancestry(actions, path, chain) {
  for (const [name, a] of Object.entries(actions || {})) {
    const where = path ? `${path} > ${name}` : name;
    const anc = runAfterAncestors(actions, name);
    for (const link of chain) { anc.add(link.name); for (const x of runAfterAncestors(link.siblings, link.name)) anc.add(x); }
    const txt = ownExprText(a);
    const refs = new Set();
    let m; ACT_REF.lastIndex = 0;
    while ((m = ACT_REF.exec(txt)) !== null) refs.add(m[1]);
    for (const r of refs) {
      if (r === name) continue;                       // items('Self') inside its own Foreach body
      if (!anc.has(r)) {
        problems.push(`NON-ANCESTOR REFERENCE: '${where}' reads the output of '${r}', which is NOT a runAfter ancestor — Logic Apps does not infer order from references, so the two run in parallel and the read resolves to null`);
      }
    }
    VAR_REF.lastIndex = 0;
    while ((m = VAR_REF.exec(txt)) !== null) {
      if (!DECLARED_VARS.has(m[1])) problems.push(`UNDECLARED VARIABLE: '${where}' reads variables('${m[1]}') — no InitializeVariable declares it`);
    }
    const nextChain = chain.concat([{ name, siblings: actions }]);
    if (a.actions) ancestry(a.actions, where, nextChain);
    if (a.else && a.else.actions) ancestry(a.else.actions, where + ' [else]', nextChain);
    for (const [cn, c] of Object.entries(a.cases || {})) if (c.actions) ancestry(c.actions, `${where} [case ${cn}]`, nextChain);
    if (a.default && a.default.actions) ancestry(a.default.actions, where + ' [default]', nextChain);
  }
})(def.actions, '', []);

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
