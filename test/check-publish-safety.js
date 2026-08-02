// check-publish-safety.js — asks ONE question: what does a stranger with the site URL get?
//
// Azure SWA publishes the repo contents. Anything tracked by git and not 404'd by a route
// rule in staticwebapp.config.json is downloadable by anyone, with no login. Two classes of
// mistake have already shipped this way:
//
//   1. data/bob-stock-data.json — an ORPHAN file nothing loads, HTTP 200 on the live site,
//      213 KB, holding 16 user rows with SHA-256 password AND pin hashes plus stockTakePin.
//      Found 2026-08-01 by fetching the live URL. No route rule covered /data/.
//   2. CONFIG_URL: '%%CONFIG_URL%%' — a build placeholder that no CI step ever substituted,
//      still unsubstituted on the live site. _fetchRemoteConfig bails on it (sync.js:691), so
//      the cloud config channel has NEVER run on any device. Ships silently; nothing checks.
//
// WHY THE GRADED SEVERITY. index.html legitimately carries the seed accounts today, so a gate
// that hard-failed on "credentials in a publishable file" would be red from birth — and a
// permanently red gate trains everyone to ignore it, which is how both of the above survived.
// So: a SECOND copy of credentials outside index.html is a hard FAIL (that is the class of
// mistake that is always accidental), while the seed itself is reported as a MEASURED, tracked
// cutover obligation. Per the banked lesson: state a number, never an adjective.
//
//   node test/check-publish-safety.js             day-to-day: obligations reported, not fatal
//   node test/check-publish-safety.js --cutover   at cutover: obligations BECOME fatal
//   node test/check-publish-safety.js --self-test proves every check FAILS on a broken input
//
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.resolve(__dirname, '..');
const CUTOVER = process.argv.includes('--cutover');
const SELFTEST = process.argv.includes('--self-test');

// ── what a stranger can actually fetch ────────────────────────────────────────────────────
// Tracked by git == deployed by CI. Untracked/gitignored files never reach the artifact.
function trackedFiles() {
  return cp.execSync('git ls-files', { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n').map(s => s.trim()).filter(Boolean);
}

// Translate the SWA 404 route globs into predicates. Supported forms, which is all the file
// uses: "/dir/*" (prefix) and "/*.{md,py,txt}" (root-level extension set).
function blockedMatchers(swa) {
  const out = [];
  for (const r of (swa && swa.routes) || []) {
    if (r.statusCode !== 404 || typeof r.route !== 'string') continue;
    const brace = r.route.match(/^\/\*\.\{([^}]+)\}$/);
    if (brace) {
      const exts = brace[1].split(',').map(s => s.trim().toLowerCase());
      out.push({ rule: r.route, test: f => exts.includes(path.extname(f).slice(1).toLowerCase()) });
      continue;
    }
    const pre = r.route.match(/^\/(.+)\/\*$/);
    if (pre) {
      const dir = pre[1] + '/';
      out.push({ rule: r.route, test: f => f === pre[1] || f.startsWith(dir) });
      continue;
    }
    if (!r.route.includes('*')) {
      const exact = r.route.replace(/^\//, '');
      out.push({ rule: r.route, test: f => f === exact });
    }
  }
  return out;
}

// ── the things we refuse to publish ───────────────────────────────────────────────────────
// Deliberately narrow: a long hex value bound to a credential key, or a live storage/SAS
// secret. Loose patterns produce noise, and a noisy gate gets switched off.
const CRED_PATTERNS = [
  { name: 'password hash', re: /["']?password["']?\s*[:=]\s*["'][0-9a-f]{32,}["']/i },
  { name: 'pin hash', re: /["']?\bpin["']?\s*[:=]\s*["'][0-9a-f]{32,}["']/i },
  // Must be bound to a REAL value. The bare identifier appears all over db.js as schema
  // plumbing (`stockTakePin: { pin: null }`) — matching that made the gate's first run a false
  // positive on its own codebase, which is precisely the noise that gets a gate switched off.
  { name: 'stockTakePin value', re: /stockTakePin["']?\s*:\s*(?:["'][^"']{3,}["']|\{[^}]*["']?\bpin["']?\s*:\s*["'][^"']{3,}["'])/ },
  { name: 'storage AccountKey', re: /AccountKey\s*=\s*[A-Za-z0-9+/=]{20,}/ },
  { name: 'SAS signature', re: /[?&]sig=[A-Za-z0-9%+/=]{20,}/ },
];
const PLACEHOLDER_RE = /%%[A-Z0-9_]+%%/g;
const TEXTUAL = new Set(['.js', '.html', '.json', '.css', '.md', '.txt', '.yml', '.yaml', '.webmanifest', '.map']);

function scanCredentials(content) {
  return CRED_PATTERNS.filter(p => p.re.test(content)).map(p => p.name);
}
function scanPlaceholders(content) {
  return [...new Set(content.match(PLACEHOLDER_RE) || [])];
}
function countSeedAccounts(html) {
  // Measured, not asserted: how many seed rows carry a usable credential.
  return (html.match(/["']?password["']?\s*[:=]\s*["'][0-9a-f]{32,}["']/gi) || []).length;
}

// ── self-test: every check must be SEEN to fail ───────────────────────────────────────────
// A gate you have never watched fail is not a gate (banked: the gate-mutation lesson).
if (SELFTEST) {
  const cases = [
    ['credential scan catches a password hash',
      () => scanCredentials(`{"username":"kunal","password":"${'a'.repeat(64)}"}`).length > 0],
    ['credential scan catches a pin hash',
      () => scanCredentials(`{"pin":"${'b'.repeat(64)}"}`).length > 0],
    ['credential scan catches a stockTakePin value',
      () => scanCredentials('{"stockTakePin":"1234"}').length > 0],
    ['credential scan catches a nested stockTakePin value',
      () => scanCredentials(`{"stockTakePin":{"pin":"${'e'.repeat(64)}","expiresAt":null}}`).length > 0],
    ['credential scan does NOT fire on the stockTakePin SCHEMA (db.js shape)',
      () => scanCredentials('stockTakePin: { pin: null, expiresAt: null }').length === 0],
    ['credential scan does NOT fire on a stockTakePin lookup key',
      () => scanCredentials("const metaPin = await bobDB.meta.get('stockTakePin');").length === 0],
    ['credential scan catches a storage AccountKey',
      () => scanCredentials('AccountKey=abcdefghijklmnopqrstuvwxyz012345==').length > 0],
    ['credential scan catches a SAS signature',
      () => scanCredentials('https://x.logic.azure.com/y?sv=2020&sig=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789').length > 0],
    ['credential scan does NOT fire on ordinary code',
      () => scanCredentials('const password = await promptForPassword(); // no literal here').length === 0],
    ['placeholder scan catches an unsubstituted token',
      () => scanPlaceholders("CONFIG_URL: '%%CONFIG_URL%%'").includes('%%CONFIG_URL%%')],
    ['placeholder scan does NOT fire on a real URL',
      () => scanPlaceholders("CONFIG_URL: 'https://x.logic.azure.com/workflows/abc'").length === 0],
    ['route matcher blocks a prefix rule',
      () => blockedMatchers({ routes: [{ route: '/data/*', statusCode: 404 }] })[0].test('data/x.json')],
    ['route matcher does NOT block an unrelated path',
      () => !blockedMatchers({ routes: [{ route: '/data/*', statusCode: 404 }] })[0].test('index.html')],
    ['route matcher blocks a root extension set',
      () => blockedMatchers({ routes: [{ route: '/*.{md,py,txt}', statusCode: 404 }] })[0].test('README.md')],
    ['route matcher ignores a non-404 rule',
      () => blockedMatchers({ routes: [{ route: '/data/*', statusCode: 200 }] }).length === 0],
    ['seed counter returns a number, not a boolean',
      () => countSeedAccounts(`password:'${'c'.repeat(64)}',password:'${'d'.repeat(64)}'`) === 2],
  ];
  let bad = 0;
  console.log('\n=== check-publish-safety --self-test ===');
  console.log('Each case proves a check FIRES on a deliberately broken input (or stays quiet on a clean one).\n');
  for (const [name, fn] of cases) {
    let ok = false; try { ok = !!fn(); } catch (e) { ok = false; }
    if (!ok) bad++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
  }
  console.log(`\n${bad === 0 ? 'SELF-TEST PASS — every check demonstrably bites' : 'SELF-TEST FAIL (' + bad + ') — do NOT trust a green run from this gate'}`);
  process.exit(bad === 0 ? 0 : 1);
}

// ── the real run ──────────────────────────────────────────────────────────────────────────
let swa = null, swaErr = null;
try { swa = JSON.parse(fs.readFileSync(path.join(REPO, 'staticwebapp.config.json'), 'utf8')); }
catch (e) { swaErr = e.message; }

const blocked = blockedMatchers(swa);
const isBlocked = f => blocked.find(b => b.test(f));

const failures = [], obligations = [], notes = [];

if (swaErr) failures.push(`staticwebapp.config.json unreadable (${swaErr}) — cannot determine what is published`);

const files = trackedFiles();
const publishable = files.filter(f => !isBlocked(f) && TEXTUAL.has(path.extname(f).toLowerCase()));

// CHECK 1 — a second copy of credentials outside index.html. Always accidental, always fatal.
for (const f of publishable) {
  if (f === 'index.html') continue;
  let content; try { content = fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (e) { continue; }
  const hits = scanCredentials(content);
  if (hits.length) failures.push(`${f} is PUBLICLY DOWNLOADABLE and contains: ${hits.join(', ')} — add a 404 route rule or remove the file`);
}

// CHECK 2 — unsubstituted build placeholders in anything that ships and runs.
for (const f of publishable) {
  if (!['.js', '.html'].includes(path.extname(f).toLowerCase())) continue;
  let content; try { content = fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (e) { continue; }
  for (const ph of scanPlaceholders(content)) {
    obligations.push(`${f} ships the unsubstituted placeholder ${ph} — no CI step replaces it. ` +
      (ph === '%%CONFIG_URL%%'
        ? 'CONSEQUENCE: _fetchRemoteConfig bails (sync.js:691), so master_data / access_policy / ' +
          'pricing_config / stock_snapshot are undeliverable, Sync._pricingFresh stays false, and ' +
          'Pricing.commitGate holds EVERY HO->franchise transfer at submit. BLOCKS CUTOVER.'
        : 'BLOCKS CUTOVER.'));
  }
}

// CHECK 3 — the seed's own credentials, as a measured number.
let seedN = 0;
try { seedN = countSeedAccounts(fs.readFileSync(path.join(REPO, 'index.html'), 'utf8')); } catch (e) {}
if (seedN > 0) {
  obligations.push(`index.html ships ${seedN} seed account(s) carrying a password hash, and index.html is ` +
    `public by necessity. SHA-256 is unsalted here, so a 4-digit PIN is ~10,000 guesses — treat every ` +
    `seed PIN as public. Every one of these ${seedN} must be rotated (or the seed shipped without ` +
    `credentials) before launch. BLOCKS CUTOVER.`);
}

// CHECK 4 — the /data/ regression specifically, so the original defect can never silently return.
const dataRule = ((swa && swa.routes) || []).find(r => r.route === '/data/*' && r.statusCode === 404);
if (!dataRule) failures.push('staticwebapp.config.json has no 404 rule for /data/* — the 2026-08-01 exposure would recur');
else notes.push('/data/* is 404 (the 2026-08-01 exposure is closed at the route layer)');

notes.push(`${files.length} tracked file(s); ${publishable.length} textual file(s) publicly reachable; ${blocked.length} block rule(s) in force`);

// ── report ────────────────────────────────────────────────────────────────────────────────
console.log('\n=== check-publish-safety ===');
console.log('What a stranger with the site URL can download.\n');
for (const n of notes) console.log(`  [info] ${n}`);
if (failures.length) { console.log(''); for (const f of failures) console.log(`  [FAIL] ${f}`); }
if (obligations.length) {
  console.log('\n  --- OPEN CUTOVER OBLIGATIONS ---');
  console.log('  Known and tracked. Reported every run so they cannot be quietly forgotten; they do');
  console.log('  NOT fail the day-to-day run, because a permanently red gate gets ignored — which is');
  console.log('  exactly how both of the defects above survived. Run with --cutover to make them fatal.');
  for (const o of obligations) console.log(`  [OPEN] ${o}`);
}

const fatal = failures.length + (CUTOVER ? obligations.length : 0);
console.log(`\n==== ${fatal === 0
  ? 'PUBLISH SAFETY OK — ' + failures.length + ' failure(s), ' + obligations.length + ' open obligation(s)' + (CUTOVER ? ' [cutover mode]' : '')
  : fatal + ' BLOCKING PROBLEM(S)' + (CUTOVER ? ' [cutover mode: obligations are fatal]' : '')} ====`);
process.exit(fatal === 0 ? 0 : 1);
