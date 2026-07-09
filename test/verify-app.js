/**
 * BOB Stock App — verify-app.js  (SCAFFOLD v1.0)
 * ------------------------------------------------------------------
 * Static-analysis integrity check. No dependencies — plain `node`.
 * Ported in shape from the Roster App's verify-app.js, retargeted for Stock.
 *
 * Checks: files exist + size sanity; required objects/methods present;
 * required DOM ids present; forbidden patterns; the MFL-010 hardcoded
 * Logic-App-URL check; schema/version coherence; load-order sanity.
 *
 * STATUS: SCAFFOLD. ~30 checks wired. REQUIRED_DOM_IDS is a small seed marked
 * WARN (not FAIL) until the first audit curates the full list. Known-open
 * findings (e.g. MFL-010 hardcoded email URL) are tagged EXPECTED so the green
 * bar reflects reality — mirrors Roster's "417/420 (3 expected)".
 *
 * RUN:
 *     node verify-app.js
 *     APP_DIR="C:/path/to/bob-stock" node verify-app.js
 *     node verify-app.js --quiet
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = process.env.APP_DIR || 'C:/Users/joshi/repos/bob-stock';
const QUIET = process.argv.includes('--quiet');

let pass = 0, fail = 0, warn = 0, expected = 0;
function ok(name) { pass++; if (!QUIET) console.log(`  [PASS] ${name}`); }
function bad(name, detail, isExpected) {
  if (isExpected) { expected++; console.log(`  [EXPECTED-FAIL] ${name}${detail ? ' — ' + detail : ''}`); return; }
  fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
}
function warnOnly(name, detail) { warn++; if (!QUIET) console.log(`  [WARN] ${name}${detail ? ' — ' + detail : ''}`); }
function assert(name, cond, detail, isExpected) { cond ? ok(name) : bad(name, detail, isExpected); }

// ---- load files -------------------------------------------------------------
const FILES = ['index.html', 'db.js', 'sync.js', 'phase2.js', 'sw.js', 'manifest.json'];
const src = {};
console.log('BOB Stock App verify-app (scaffold) — dir: ' + APP_DIR + '\n== Files ==');
for (const f of FILES) {
  const p = path.join(APP_DIR, f);
  const exists = fs.existsSync(p);
  assert(`file exists: ${f}`, exists);
  src[f] = exists ? fs.readFileSync(p, 'utf8') : '';
}

// ---- size sanity ranges -----------------------------------------------------
console.log('\n== Size sanity ==');
// Wave D (GPT-ABC-H001): index.html/phase2.js upper bounds raised to current reality (index ~920KB after Wave A–D). verify-release.js is the authoritative release gate; this scaffold is supplemental.
// AA-W1 housekeeping: db.js/sync.js bounds raised to current reality (db ~65KB, sync ~121KB after Chunks 4-10 grew both).
const SIZE = { 'index.html': [120000, 1500000], 'db.js': [30000, 130000], 'sync.js': [60000, 240000], 'phase2.js': [30000, 160000], 'sw.js': [1000, 12000] };
for (const [f, [lo, hi]] of Object.entries(SIZE)) {
  const n = src[f].length;
  assert(`size in range: ${f} (${n})`, n >= lo && n <= hi, `expected ${lo}-${hi}`);
}

// ---- required objects / methods (regex presence) ----------------------------
console.log('\n== Required functions / methods ==');
const REQUIRED = {
  'db.js': ['DB', 'bobDB', 'addTransaction', 'addTransactions', 'addTransfer', 'updateTransfer',
            'commit', 'atomicTransferWrite', 'removeTransaction', 'refresh'],
  'sync.js': ['Sync', 'push', 'pull', '_fetchRemoteConfig', '_initLeaderElection', '_becomeLeader',
              '_isLeader', '_syncLock', '_lastSyncAt', 'scheduleSync'],
  'phase2.js': ['Transfer', 'submitDraft', 'receive', 'resolveFlag', 'cancel', '_notify'],
  'index.html': ['Auth', 'Txn', 'UI', 'Stock', 'Pages', 'App', 'esc', 'classify', 'qty'],
};
for (const [f, names] of Object.entries(REQUIRED)) {
  for (const n of names) {
    const re = new RegExp(`(\\b${n}\\b\\s*[:=({]|function\\s+${n}\\b|${n}\\s*\\()`);
    assert(`${f} defines ${n}`, re.test(src[f]), 'symbol not found');
  }
}

// ---- required DOM ids (SEED — WARN until audit curates) ----------------------
console.log('\n== Required DOM ids (seed; WARN-only in scaffold) ==');
const REQUIRED_DOM_IDS = ['app']; // TODO: expand to the real static id list after first DOM scan
for (const id of REQUIRED_DOM_IDS) {
  const present = new RegExp(`id=["']${id}["']`).test(src['index.html']);
  present ? ok(`DOM id present: #${id}`) : warnOnly(`DOM id NOT found: #${id}`, 'curate list after audit');
}

// ---- load-order / module sanity ---------------------------------------------
console.log('\n== Load order / modules ==');
assert('index.html loads ./db.js', /src=["']\.\/db\.js["']/.test(src['index.html']));
assert('index.html loads ./sync.js (live sync module)', /src=["']\.\/sync\.js["']/.test(src['index.html']));
assert('index.html loads phase2.js', /src=["']\.?\/?phase2\.js["']/.test(src['index.html']));
assert('sync-v2.js NOT loaded (dead alt)', !/src=["']\.\/sync-v2\.js["']/.test(src['index.html']),
       'a stale sync-v2 script tag would mean two sync engines');
assert('Dexie loaded before db.js', src['index.html'].indexOf('dexie') < src['index.html'].indexOf('db.js'));

// ---- schema / version coherence ---------------------------------------------
console.log('\n== Schema / version ==');
assert('bobDB schema version present', /bobDB\.version\(\d+\)\.stores\(/.test(src['db.js']));
assert('sw.js CACHE_NAME present', /CACHE_NAME\s*=\s*['"]bob-stock-v\d+['"]/.test(src['sw.js']));
// Stock has no APP_VERSION constant yet — this is itself a wave-done item.
assert('APP_VERSION constant defined', /APP_VERSION\s*[:=]/.test(src['index.html']),
       'no APP_VERSION constant — establish one (wave-done item)', /*expected*/ true);

// ---- forbidden / hygiene patterns -------------------------------------------
console.log('\n== Forbidden patterns ==');
// MFL-010: hardcoded SAS-signed Logic App URL in source (KNOWN-OPEN finding -> EXPECTED until fixed)
const logicUrlRe = /https:\/\/[a-z0-9-]+\.[a-z]+\.logic\.azure\.com/i;
const hardcoded = FILES.filter(f => logicUrlRe.test(src[f]));
assert('no hardcoded Logic App URL in source (MFL-010)', hardcoded.length === 0,
       'found in: ' + hardcoded.join(', '), /*expected*/ true);
// stray backup/scratch files in the repo
const stray = fs.readdirSync(APP_DIR).filter(f => /\.(bak|orig|tmp)$|\.crdownload$/.test(f));
assert('no stray .bak/.orig/.tmp/.crdownload files', stray.length === 0, stray.join(', '));
// CONFIG_URL placeholder (raw repo should carry the placeholder, injected at deploy)
assert("Sync.CONFIG_URL is the deploy placeholder", /CONFIG_URL:\s*['"]%%CONFIG_URL%%['"]/.test(src['sync.js']),
       'raw repo should keep %%CONFIG_URL%% so it boots offline');

// ---- XSS sentinel: the known MFL-005 audit-log site --------------------------
console.log('\n== XSS sentinels (static) ==');
// Once MFL-005 is fixed, _deletedBy/_deleteReason should be wrapped in UI.esc.
const auditLogEsc = /UI\.esc\([^)]*_deleted(By|Reason)/.test(src['index.html']) ||
                    /_deleted(By|Reason)[^)]*\)\s*\)/.test(src['index.html']);
assert('audit-log _deletedBy/_deleteReason escaped (MFL-005)', auditLogEsc,
       'unescaped audit-log fields', /*expected*/ true);

// ---- summary ----------------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log(`verify-app: ${pass} PASS · ${fail} FAIL · ${expected} EXPECTED-FAIL · ${warn} WARN`);
console.log(expected ? `(EXPECTED-FAILs are known-open findings: MFL-005 / MFL-010 / APP_VERSION — they clear as those fixes land.)` : '');
console.log('='.repeat(60));
process.exit(fail === 0 ? 0 : 1);
