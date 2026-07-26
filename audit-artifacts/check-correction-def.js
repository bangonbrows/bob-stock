// Structural validator for the generated N1 correction LA definition.
// Catches the failure modes that only show up at deploy time (or worse, at run time):
//   1. a runAfter naming an action that does not exist AT THAT SCOPE  -> deploy rejects
//   2. an action with no path to a Response                          -> dangling run (house rule)
//   3. a real function key in the file                               -> must never happen
//   4. IF-MATCH:* anywhere                                           -> retired at C2-R1-2
//   5. a CAS MERGE without an IF-MATCH header                        -> unfenced write
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'correction-def-generated.json');
const def = JSON.parse(fs.readFileSync(file, 'utf8'));
const problems = [];
let scopes = 0, actionCount = 0, responses = 0, merges = 0;

// Walk every action scope. Within a scope, runAfter may only name siblings.
function walk(actions, scopePath) {
  scopes++;
  const names = new Set(Object.keys(actions));
  for (const [name, a] of Object.entries(actions)) {
    actionCount++;
    const where = scopePath ? `${scopePath} > ${name}` : name;
    for (const dep of Object.keys(a.runAfter || {})) {
      if (!names.has(dep)) problems.push(`DANGLING runAfter: '${where}' depends on '${dep}', which is not a sibling in this scope`);
    }
    if (a.type === 'Response') responses++;
    const hdrs = a?.inputs?.body?.headers || {};
    const isMerge = String(hdrs['X-HTTP-Method'] || '').toUpperCase() === 'MERGE';
    if (isMerge) {
      merges++;
      const im = hdrs['IF-MATCH'];
      if (!im) problems.push(`UNFENCED MERGE: '${where}' has X-HTTP-Method: MERGE with no IF-MATCH`);
      else if (String(im).trim() === '*') problems.push(`IF-MATCH:* at '${where}' — retired by C2-R1-2`);
    }
    // recurse into nested scopes
    if (a.actions) walk(a.actions, where);
    if (a.else && a.else.actions) walk(a.else.actions, where + ' [else]');
    for (const [cn, c] of Object.entries(a.cases || {})) if (c.actions) walk(c.actions, `${where} [case ${cn}]`);
    if (a.default && a.default.actions) walk(a.default.actions, where + ' [default]');
  }
}

// THE RULE THAT MATTERS (found the hard way on the first generated definition):
// a `Response` does NOT end a Logic App run. A gate written as
//     If <ok> then {}  else { Respond 401 }
// lets the else-branch respond and then CONTINUES into the parent scope's next action — so the
// gate is decorative and a refused correction still publishes. An empty success branch is
// therefore legal ONLY IF every terminal path in the else/case branch ends in a Terminate.
function branchTerminates(actions) {
  const vals = Object.values(actions || {});
  if (vals.length === 0) return false;
  if (vals.some(a => a.type === 'Terminate')) return true;
  // a nested scope counts if all of its own branches terminate
  return vals.some(a => (a.actions && branchTerminates(a.actions)) || (a.else && branchTerminates(a.else.actions)));
}
function auditGates(actions, scopePath) {
  for (const [name, a] of Object.entries(actions)) {
    const where = scopePath ? `${scopePath} > ${name}` : name;
    if (a.type === 'If') {
      const successEmpty = Object.keys(a.actions || {}).length === 0;
      const elseActs = a.else && a.else.actions;
      if (successEmpty) {
        if (!elseActs || Object.keys(elseActs).length === 0) problems.push(`DEAD GATE: '${where}' has an empty success branch AND an empty else — it decides nothing`);
        else if (!branchTerminates(elseActs)) problems.push(`FALL-THROUGH GATE: '${where}' responds in its else branch but never Terminates — execution continues into the happy path after a refusal`);
      }
    }
    if (a.type === 'Switch') {
      for (const [cn, c] of Object.entries(a.cases || {})) {
        if (c.actions && Object.values(c.actions).some(x => x.type === 'Response') && !branchTerminates(c.actions)) {
          problems.push(`FALL-THROUGH CASE: '${where}' case '${cn}' responds but never Terminates`);
        }
      }
    }
    if (a.actions) auditGates(a.actions, where);
    if (a.else && a.else.actions) auditGates(a.else.actions, where + ' [else]');
    for (const [cn, c] of Object.entries(a.cases || {})) if (c.actions) auditGates(c.actions, `${where} [case ${cn}]`);
    if (a.default && a.default.actions) auditGates(a.default.actions, where + ' [default]');
  }
}

walk(def.actions, '');
auditGates(def.actions, '');

const raw = fs.readFileSync(file, 'utf8');
const keyish = raw.match(/code=(?!@@FN_KEY@@)[A-Za-z0-9_\-~=]{20,}/g);
if (keyish) problems.push(`FUNCTION KEY LEAK: ${keyish.length} literal key(s) in the file`);
if (!/@@FN_KEY@@/.test(raw)) problems.push('no @@FN_KEY@@ placeholders found — key injection would silently no-op');

// Report
console.log(`definition: ${path.basename(file)}`);
console.log(`  scopes ${scopes} · actions ${actionCount} · Response terminals ${responses} · CAS merges ${merges}`);
if (problems.length === 0) {
  console.log('\n==== STRUCTURE OK — 0 problems ====');
  process.exit(0);
}
console.log(`\n==== ${problems.length} PROBLEM(S) ====`);
for (const p of problems) console.log('  - ' + p);
process.exit(1);
