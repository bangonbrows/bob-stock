// CAPTURE THE LIVE STAGING LOGIC APP DEFINITIONS — step 0 of the Account Access apply plan.
//
// WHY THIS IS THE FIRST THING, BEFORE ANY CHANGE. These captures are the ENTIRE rollback story for
// the nine apply sessions. Without them there is no way back.
//
// And the two captures already sitting in the repo are WORSE than nothing, because they look like a
// safe undo while holding the wrong configuration:
//   · pushv2-def-current.json            — 2026-07-22, predates the 23 July attestation rewire
//   · recordsteps-push-staging-props.json — 2026-07-02, predates BOTH device auth and store isolation
// Restoring either would silently roll the cloud back past two whole chunks. That is exactly how the
// `ToInsert2` collision went unnoticed: the plan was written against a stale picture of the graphs.
//
// ⚠ THE FILES THIS WRITES CONTAIN LIVE SECRETS. A Logic App definition embeds function keys in its
// URIs (`?code=...`). They are written under audit-artifacts/, which is gitignored WHOLESALE and must
// stay that way. NEVER commit one, never paste one into a chat or an auditor pack, and rotate the keys
// at cutover regardless (they have been on disk).
//
// USAGE
//   node audit-artifacts/capture-all-staging-defs.js          # capture all targets
//   node audit-artifacts/capture-all-staging-defs.js --check  # verify existing captures, write nothing
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SUB = '1543b78c-8061-44f8-a119-61dee9a3172d';
const RG = 'bob-stock-sync';
const OUT_DIR = __dirname;

// The eight Logic Apps that Account Access items 5-11 touch, plus access-policy-write because the
// SRV-P3 fix (session 4) finalises it. Over-capturing costs a few seconds; under-capturing costs a
// rollback you cannot perform.
const TARGETS = [
  { la: 'bob-stock-push-v2-validate-staging', item: 'item 5 — ingest validation (LIVE-SHARED CONNECTION)' },
  { la: 'bob-stock-recordsteps-push-staging', item: 'item 5 — ingest validation (LIVE-SHARED CONNECTION)' },
  { la: 'bob-stock-corp-costs-staging', item: 'item 6 — seeCost policy check' },
  { la: 'bob-stock-archive-pull-staging', item: 'item 7 — seeArchive + store scope + era floor' },
  { la: 'bob-stock-user-admin-staging', item: 'item 8 — evaluateAccess defence-in-depth' },
  { la: 'bob-stock-catalogue-write-staging', item: 'item 9 — per-capability checks' },
  { la: 'bob-stock-user-verify-staging', item: 'item 10 — new pin op' },
  { la: 'bob-stock-archive-staging', item: 'item 11 — sudo map honour' },
  { la: 'bob-stock-access-policy-write-staging', item: 'SRV-P3 fix (session 4) — already applied' },
];

const stamp = () => {
  // Date is passed in or derived once; the filename must be stable across a single run.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fileFor = (la, day) => path.join(OUT_DIR, `${la}-PRE-${day}.json`);

// SHELL, not execFile. On Windows `az` is `az.cmd`, and execFileSync will not resolve a batch file
// without a shell — it fails with ENOENT, which reads identically to "not logged in" and sent me
// looking in the wrong place. The other runners here (rekey-staging.js, mint-test-director.js) use a
// shell for the same reason; match them. Args are all internal constants, no interpolated input.
function az(args) {
  const quoted = args.map(a => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
  return execSync('az ' + quoted, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** Count actions at every depth — scopes, If branches, Switch cases, foreach bodies. A definition
 *  whose action count looks wrong is a capture that did not fully land. */
function countActions(node) {
  let n = 0;
  for (const a of Object.values(node || {})) {
    n++;
    for (const sub of [a.actions, a.else && a.else.actions, a.default && a.default.actions]) {
      if (sub) n += countActions(sub);
    }
    for (const c of Object.values(a.cases || {})) if (c && c.actions) n += countActions(c.actions);
  }
  return n;
}

// ── REDACTION ──────────────────────────────────────────────────────────────────────────────────────
// Produces AUDITOR-SAFE copies that can be COMMITTED, so a review is reproducible from the cited
// commit. Codex found the packs unreviewable: the brief named these captures as ground truth while
// audit-artifacts/ is gitignored wholesale, so the files were not in the commit at all and had to be
// imported from another working copy.
//
// Scanned before writing this: the ONLY secret in the captures is the function key in `?code=` URIs
// (22 across nine workflows). The three `"password":` hits are expression references
// (`@coalesce(triggerBody()?['data']?['password'],'')`), i.e. field names, not values.
//
// A reviewer needs action names, wiring, conditions and expressions. None of that is secret. The key
// is not part of what is being reviewed, so redacting it costs the review nothing.
//
// ⚠ Redaction is verified, not assumed: the output is re-scanned and the run ABORTS rather than
// writing a file that still contains a secret. Publishing on hope is how a key reaches git history,
// and git history cannot be revoked later — only the key can, by rotating it.
const SECRET_PATTERNS = [
  [/([?&]code=)[A-Za-z0-9_\-=]{20,}/g, '$1REDACTED'],
  [/([?&]sig=)[A-Za-z0-9%_\-=+/]{20,}/g, '$1REDACTED'],
];
const RESIDUAL = [/[?&]code=[A-Za-z0-9_\-=]{20,}/, /[?&]sig=[A-Za-z0-9%_\-=+/]{20,}/, /sharedAccessKey/i];

function redactAll(day) {
  const out = [];
  for (const t of TARGETS) {
    const existing = fs.readdirSync(OUT_DIR).filter(f => f.startsWith(`${t.la}-PRE-`) && f.endsWith('.json')).sort();
    if (!existing.length) { console.log(`  MISSING capture for ${t.la} — run without --redacted first.`); return 1; }
    const src = path.join(OUT_DIR, existing[existing.length - 1]);
    let text = fs.readFileSync(src, 'utf8');
    let n = (text.match(/[?&]code=[A-Za-z0-9_\-=]{20,}/g) || []).length;
    for (const [re, rep] of SECRET_PATTERNS) text = text.replace(re, rep);

    for (const bad of RESIDUAL) {
      if (bad.test(text)) {
        console.log(`\n🛑 ABORT: ${t.la} still matches ${bad} AFTER redaction. Nothing written.`);
        console.log('   Do not publish this. Widen SECRET_PATTERNS first.');
        return 1;
      }
    }
    const dst = path.join(OUT_DIR, `${t.la}-REDACTED-${day}.json`);
    fs.writeFileSync(dst, text);
    out.push({ la: t.la, keys: n, file: path.basename(dst) });
  }
  console.log('');
  console.log('LOGIC APP'.padEnd(42) + 'KEYS REDACTED  FILE');
  console.log('-'.repeat(96));
  for (const r of out) console.log(r.la.padEnd(42) + String(r.keys).padEnd(15) + r.file);
  console.log(`\n==== ${out.length}/${TARGETS.length} redacted copies written, ${out.reduce((a, b) => a + b.keys, 0)} keys removed ====`);
  console.log('Verified: no residual code=/sig=/sharedAccessKey in any output.');
  console.log('These are SAFE TO COMMIT. The -PRE- originals remain gitignored and are the rollback source.');
  return 0;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const day = stamp();
  if (process.argv.includes('--redacted')) process.exit(redactAll(day));

  // Fail fast and loudly rather than writing nine empty files.
  try {
    const who = JSON.parse(az(['account', 'show', '-o', 'json']));
    if (who.id !== SUB) {
      console.log(`WRONG SUBSCRIPTION — az is on ${who.name} (${who.id}), expected ${SUB}.`);
      console.log(`  fix: az account set --subscription ${SUB}`);
      process.exit(1);
    }
    console.log(`az: ${who.user && who.user.name} on ${who.name}`);
  } catch (e) {
    console.log('az is not available or not logged in. Run `az login` first.');
    process.exit(1);
  }

  const rows = [];
  let bad = 0;
  for (const t of TARGETS) {
    const out = fileFor(t.la, day);
    let def = null;

    if (checkOnly) {
      // ⚠ --check verifies the NEWEST capture, NOT one dated today. The first version looked for
      // today's filename and reported all nine as MISSING the day after capturing them. That reads as
      // "you have no rollback" and invites a re-capture — and re-capturing AFTER a change overwrites
      // the PRE-change baseline with a POST-change one, destroying the rollback while appearing to
      // refresh it. A false MISSING here is more dangerous than no check at all.
      const existing = fs.readdirSync(OUT_DIR)
        .filter(f => f.startsWith(`${t.la}-PRE-`) && f.endsWith('.json')).sort();
      if (!existing.length) { rows.push({ la: t.la, status: 'MISSING', actions: '-', kb: '-', sha: '-' }); bad++; continue; }
      const newest = path.join(OUT_DIR, existing[existing.length - 1]);
      try { def = JSON.parse(fs.readFileSync(newest, 'utf8')); } catch (e) {
        rows.push({ la: t.la, status: 'CORRUPT', actions: '-', kb: '-', sha: '-' }); bad++; continue;
      }
      const text0 = fs.readFileSync(newest, 'utf8');
      rows.push({
        la: t.la, status: existing[existing.length - 1].slice(-15, -5),   // the capture's date
        actions: String(countActions(def.actions)),
        kb: String(Math.round(text0.length / 1024)),
        sha: crypto.createHash('sha256').update(text0).digest('hex').slice(0, 12),
      });
      continue;
    }
    {
      let raw;
      try {
        raw = az(['resource', 'show', '-g', RG, '-n', t.la, '--resource-type', 'Microsoft.Logic/workflows',
          '--query', 'properties.definition', '-o', 'json']);
      } catch (e) {
        rows.push({ la: t.la, status: 'AZ FAILED', actions: '-', kb: '-', sha: '-' }); bad++; continue;
      }
      try { def = JSON.parse(raw); } catch (e) {
        rows.push({ la: t.la, status: 'BAD JSON', actions: '-', kb: '-', sha: '-' }); bad++; continue;
      }
      if (!def || !def.actions || !Object.keys(def.actions).length) {
        rows.push({ la: t.la, status: 'NO ACTIONS', actions: '0', kb: '-', sha: '-' }); bad++; continue;
      }
      fs.writeFileSync(out, JSON.stringify(def, null, 2));
    }

    const text = fs.readFileSync(out, 'utf8');
    rows.push({
      la: t.la, status: 'CAPTURED',
      actions: String(countActions(def.actions)),
      kb: String(Math.round(text.length / 1024)),
      sha: crypto.createHash('sha256').update(text).digest('hex').slice(0, 12),
    });
  }

  const w = (s, n) => String(s).padEnd(n);
  console.log('');
  console.log(w('LOGIC APP', 42) + w('STATUS', 11) + w('ACTIONS', 9) + w('KB', 6) + 'SHA256');
  console.log('-'.repeat(96));
  for (const r of rows) console.log(w(r.la, 42) + w(r.status, 11) + w(r.actions, 9) + w(r.kb, 6) + r.sha);
  console.log('');

  if (bad) {
    console.log(`==== ${bad} of ${TARGETS.length} FAILED — DO NOT APPLY ANYTHING ====`);
    console.log('Without a complete set of fresh captures there is no rollback path. Fix and re-run.');
    process.exit(1);
  }

  if (checkOnly) {
    console.log(`==== ${TARGETS.length}/${TARGETS.length} captures present and readable (nothing written) ====`);
    console.log('The STATUS column is the date of each capture. If any predates a change you have made,');
    console.log('it is NOT a valid rollback for that workflow — re-capture BEFORE the next change, never after.');
    process.exit(0);
  }
  console.log(`==== ${TARGETS.length}/${TARGETS.length} captured to ${day} ====`);
  console.log('⚠ These files embed live function keys. audit-artifacts/ is gitignored — keep it that way.');
  console.log('  Never commit one, never paste one into a chat or an auditor pack.');
  console.log('');
  console.log('Next: node audit-artifacts/check-name-collisions.js');
  process.exit(0);
}

main();
