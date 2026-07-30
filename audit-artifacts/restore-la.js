// RESTORE A LOGIC APP FROM ITS PRE-CHANGE CAPTURE — the thirty-second undo.
//
// This is the safety net under all nine Account Access apply sittings. If a probe comes back wrong,
// this puts the workflow back exactly as it was and you stop, rather than debugging a half-applied
// change on a connection shared with the live apps.
//
// ⚠ THIS ONE WRITES TO THE CLOUD. Everything else in this toolkit is read-only. Kunal runs it.
//
// HOW IT WRITES, AND WHY — this is the correctness point, and it was learned by failing.
//
// A Logic App resource holds BOTH the definition AND `properties.parameters`, which is where the
// `$connections` values live (the bindings to the sharepointonline and office365 connections). The
// captures contain the DEFINITION ONLY. So a naive whole-resource write from a capture would wipe the
// connection bindings and leave a workflow that cannot reach SharePoint at all — a "restore" that
// breaks it worse than the change did.
//
// The first version therefore PATCHed `properties.definition`, reasoning that a merge leaves the
// parameters alone. Azure rejects that outright:
//     PatchWorkflowPropertiesNotSupported — "None of the fields inside the properties object can be
//     patched."
// Logic Apps accept a whole-resource PUT only. So the connection bindings are OUR responsibility: they
// are read from the LIVE resource immediately before writing and sent back verbatim, and the script
// REFUSES to write at all if it cannot find them.
//
// That failure is the entire argument for `--prove-write`. The write path was wrong from the first
// line, every review of it read fine, and it would have been discovered at the exact moment a rollback
// was needed — mid-session, on the connection shared with the live apps.
//
// USAGE
//   node audit-artifacts/restore-la.js <logic-app-name>              # newest capture, asks first
//   node audit-artifacts/restore-la.js <logic-app-name> --yes        # no prompt (scripted)
//   node audit-artifacts/restore-la.js <logic-app-name> --dry-run    # show the plan, change nothing
//   node audit-artifacts/restore-la.js --list                        # what captures exist
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execSync } = require('child_process');

const SUB = '1543b78c-8061-44f8-a119-61dee9a3172d';
const RG = 'bob-stock-sync';
const API = '2016-06-01';
const DIR = __dirname;

// Shell, not execFile: on Windows `az` is a batch file and execFileSync fails with ENOENT.
function az(cmd) {
  return execSync('az ' + cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
}

function countActions(node) {
  let n = 0;
  for (const a of Object.values(node || {})) {
    n++;
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) if (sub) n += countActions(sub);
    for (const c of Object.values((a && a.cases) || {})) if (c && c.actions) n += countActions(c.actions);
  }
  return n;
}

function actionNames(node, into) {
  for (const [k, a] of Object.entries(node || {})) {
    into.add(k);
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) if (sub) actionNames(sub, into);
    for (const c of Object.values((a && a.cases) || {})) if (c && c.actions) actionNames(c.actions, into);
  }
  return into;
}

function capturesFor(la) {
  return fs.readdirSync(DIR)
    .filter(f => f.startsWith(`${la}-PRE-`) && f.endsWith('.json'))
    .sort();
}

function listAll() {
  const all = fs.readdirSync(DIR).filter(f => /-PRE-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!all.length) { console.log('No captures. Run: node audit-artifacts/capture-all-staging-defs.js'); return; }
  console.log('Available captures:\n');
  for (const f of all) {
    const t = fs.readFileSync(path.join(DIR, f), 'utf8');
    let n = '?'; try { n = countActions(JSON.parse(t).actions); } catch (e) {}
    console.log(`  ${f}   ${n} actions   ${Math.round(t.length / 1024)} KB`);
  }
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(res => rl.question(question, res));
  rl.close();
  return answer.trim().toUpperCase() === 'YES';
}

(async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { listAll(); process.exit(0); }

  const la = args.find(a => !a.startsWith('--'));
  if (!la) {
    console.log('usage: node audit-artifacts/restore-la.js <logic-app-name> [--yes] [--dry-run]');
    console.log('       node audit-artifacts/restore-la.js --list');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const skipPrompt = args.includes('--yes');

  const caps = capturesFor(la);
  if (!caps.length) {
    console.log(`NO CAPTURE for ${la}. There is nothing to restore from.`);
    console.log('This is why capture-all-staging-defs.js runs BEFORE any change.');
    process.exit(1);
  }
  const capFile = caps[caps.length - 1];
  let captured;
  try { captured = JSON.parse(fs.readFileSync(path.join(DIR, capFile), 'utf8')); }
  catch (e) { console.log(`Capture ${capFile} is unreadable: ${e.message}`); process.exit(1); }
  if (!captured || !captured.actions || !Object.keys(captured.actions).length) {
    console.log(`Capture ${capFile} has no actions — refusing to restore an empty definition.`);
    process.exit(1);
  }

  // Read the CURRENT definition so the operator can see what is about to change.
  let current = null;
  try {
    current = JSON.parse(az(`resource show -g ${RG} -n ${la} --resource-type Microsoft.Logic/workflows --query properties.definition -o json`));
  } catch (e) {
    console.log(`Could not read the live ${la}. Is az logged in and on the right subscription?`);
    process.exit(1);
  }

  const capNames = actionNames(captured.actions, new Set());
  const curNames = actionNames(current.actions, new Set());
  const willRemove = [...curNames].filter(n => !capNames.has(n)).sort();
  const willAddBack = [...capNames].filter(n => !curNames.has(n)).sort();
  const identical = JSON.stringify(current) === JSON.stringify(captured);

  console.log(`RESTORE ${la}`);
  console.log(`  from : ${capFile}   (${countActions(captured.actions)} actions)`);
  console.log(`  live : ${countActions(current.actions)} actions`);
  console.log('');
  // --prove-write: exercise the WRITE path with a payload that is byte-identical to what is already
  // deployed. An untested rollback is not a rollback — and the moment you need this for real is the
  // worst possible moment to discover the URL, the API version or the PATCH semantics are wrong.
  // Because the body equals the current state, the workflow cannot change. What it DOES prove:
  // az can PATCH this resource, the definition survives the round trip, and — the claim that actually
  // matters — properties.parameters ($connections) are NOT wiped by a definition-only PATCH.
  const proveWrite = args.includes('--prove-write');

  if (identical && !proveWrite) {
    console.log('  The live definition is ALREADY identical to the capture. Nothing to do.');
    console.log('  (To exercise the write path safely, re-run with --prove-write: it PATCHes this same');
    console.log('   definition back, which cannot change anything, and verifies $connections survive.)');
    process.exit(0);
  }
  if (proveWrite && !identical) {
    console.log('  REFUSING --prove-write: the live definition DIFFERS from the capture, so this would');
    console.log('  be a real restore wearing a test\'s clothes. Run it without --prove-write, deliberately.');
    process.exit(1);
  }

  let paramsBefore = null;
  if (proveWrite) {
    try {
      paramsBefore = az(`resource show -g ${RG} -n ${la} --resource-type Microsoft.Logic/workflows --query properties.parameters -o json`);
    } catch (e) { console.log('Could not read properties.parameters — aborting the proof.'); process.exit(1); }
    console.log('  --prove-write: writing back the IDENTICAL definition. The workflow cannot change.');
    console.log(`  connection parameters before: ${crypto.createHash('sha256').update(paramsBefore).digest('hex').slice(0, 12)}`);
    console.log('');
  }
  if (willRemove.length) {
    console.log(`  actions that will be REMOVED (${willRemove.length}):`);
    willRemove.forEach(n => console.log(`    - ${n}`));
  }
  if (willAddBack.length) {
    console.log(`  actions that will be PUT BACK (${willAddBack.length}):`);
    willAddBack.forEach(n => console.log(`    + ${n}`));
  }
  if (!willRemove.length && !willAddBack.length && !identical) {
    console.log('  same action NAMES, but the contents differ — an edit changed an existing action.');
  }
  console.log('');
  console.log('  PUTting the whole workflow, carrying the LIVE $connections forward explicitly.');
  console.log('');

  if (dryRun) { console.log('--dry-run: nothing was changed.'); process.exit(0); }

  if (!skipPrompt) {
    const ok = await confirm(`Type YES to restore ${la} from ${capFile}: `);
    if (!ok) { console.log('Aborted. Nothing was changed.'); process.exit(1); }
  }

  // ⚠ PUT, NOT PATCH — and this was learned the hard way, not designed.
  // The first version PATCHed properties.definition, on the reasoning that a merge would leave
  // $connections alone. Azure rejects that outright:
  //     PatchWorkflowPropertiesNotSupported — "None of the fields inside the properties object can be
  //     patched."
  // Logic Apps only accept a whole-resource PUT. That is precisely the failure mode --prove-write
  // exists to surface: had nobody exercised the write path, this would have been discovered at the
  // moment a rollback was actually needed, mid-session, on the shared connection.
  //
  // A PUT means the connection bindings are OUR responsibility now, so they are read from the LIVE
  // resource and sent back explicitly. Only definition/parameters/state are sent: accessEndpoint,
  // changedTime, createdTime, provisioningState and version are server-managed and must not be echoed.
  let live = null;
  try {
    live = JSON.parse(az(`resource show -g ${RG} -n ${la} --resource-type Microsoft.Logic/workflows -o json`));
  } catch (e) { console.log('Could not read the full resource before writing. Aborting.'); process.exit(1); }

  if (!live.properties || !live.properties.parameters || !live.properties.parameters.$connections) {
    console.log('🛑 REFUSING TO WRITE: the live resource has no properties.parameters.$connections to');
    console.log('   carry forward. Writing without it would leave a workflow that cannot reach SharePoint.');
    process.exit(1);
  }

  const body = {
    location: live.location,
    tags: live.tags || {},
    properties: {
      definition: captured,
      parameters: live.properties.parameters,   // carried forward VERBATIM — the whole point
      state: live.properties.state || 'Enabled',
    },
  };

  const bodyFile = path.join(os.tmpdir(), `restore-${la}-${Date.now()}.json`);
  fs.writeFileSync(bodyFile, JSON.stringify(body));
  const url = `https://management.azure.com/subscriptions/${SUB}/resourceGroups/${RG}` +
    `/providers/Microsoft.Logic/workflows/${la}?api-version=${API}`;
  try {
    az(`rest --method PUT --url "${url}" --body @"${bodyFile}"`);
  } catch (e) {
    console.log('RESTORE FAILED:');
    console.log('  ' + String((e.stderr && e.stderr.toString()) || e.message).slice(0, 600));
    console.log(`  The body is at ${bodyFile} if you need to apply it by hand.`);
    console.log('  NOTE: a failed PUT leaves the workflow as it was — Azure applies it whole or not at all.');
    process.exit(1);
  } finally {
    try { fs.unlinkSync(bodyFile); } catch (e) {}
  }

  // VERIFY. A restore that reports success without checking is just a hope.
  let after = null;
  try {
    after = JSON.parse(az(`resource show -g ${RG} -n ${la} --resource-type Microsoft.Logic/workflows --query properties.definition -o json`));
  } catch (e) {
    console.log('Restore sent, but the verification read FAILED. Check the workflow in the portal before continuing.');
    process.exit(1);
  }
  const h = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 12);
  if (h(after) !== h(captured)) {
    console.log('⚠ RESTORE DID NOT LAND CLEANLY.');
    console.log(`  wanted ${h(captured)}, got ${h(after)}  (${countActions(after.actions)} actions)`);
    console.log('  Azure may normalise some fields — compare in the portal before assuming it is wrong,');
    console.log('  but do NOT continue applying until this is understood.');
    process.exit(1);
  }

  // The claim this whole file rests on: a definition-only PATCH leaves $connections alone. Assert it.
  if (proveWrite) {
    let paramsAfter = null;
    try {
      paramsAfter = az(`resource show -g ${RG} -n ${la} --resource-type Microsoft.Logic/workflows --query properties.parameters -o json`);
    } catch (e) { console.log('⚠ Could not re-read properties.parameters after the PATCH. Check the portal.'); process.exit(1); }
    const hb = crypto.createHash('sha256').update(paramsBefore).digest('hex').slice(0, 12);
    const ha = crypto.createHash('sha256').update(paramsAfter).digest('hex').slice(0, 12);
    console.log('');
    if (hb !== ha) {
      console.log(`🛑 CONNECTION PARAMETERS CHANGED (${hb} -> ${ha}).`);
      console.log('   A definition-only PATCH was supposed to leave them alone. DO NOT USE THIS SCRIPT');
      console.log('   AS A ROLLBACK until that is understood — restoring would break the connections.');
      process.exit(1);
    }
    console.log(`WRITE PATH PROVEN — definition round-tripped exactly, and $connections is unchanged (${ha}).`);
    console.log('The rollback works. That is now a fact rather than an assumption.');
    process.exit(0);
  }

  console.log(`RESTORED — ${la} matches ${capFile} exactly (${countActions(after.actions)} actions, ${h(after)}).`);
  console.log('Connection parameters were not touched.');
  process.exit(0);
})();
