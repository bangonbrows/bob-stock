// check-register.js — keeps the feature/decision register HONEST.
//
// THE PROBLEM THIS SOLVES. This repo has ~100 markdown files. Every one was true when written
// and several are false now. One of them asserted there was "zero dated pricing history in the
// client or Functions" when a complete, tested implementation had been sitting in index.html
// and topology.js for weeks — and that false line was inherited by session after session. The
// owner ended up being the backup memory for his own project, which is what this register and
// this gate exist to end.
//
// A register nobody checks becomes document #101. So this asserts:
//   1. the data is structurally sound and internally consistent
//   2. every code reference RESOLVES — the file exists and the line is inside it (this is the
//      rot detector: when code moves, the register notices instead of quietly lying)
//   3. every test named as proof actually exists
//   4. nothing claims to be proven while naming no proof
//   5. REGISTER.md and TRAINING.md match the data (so a hand-edit is caught, not absorbed)
//
//   node test/check-register.js              run it
//   node test/check-register.js --self-test  prove every check FAILS on a broken input
//
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.resolve(__dirname, '..');
const SELFTEST = process.argv.includes('--self-test');

const VALID = {
  built: ['yes', 'partial', 'no'],
  proven: ['yes', 'partial', 'no'],
  appliedToCloud: ['yes', 'partial', 'no', 'na', 'unknown'],
  switchedOn: ['yes', 'no', 'partial', 'unknown'],
};
const CODE_EXT = 'js|html|json|md|yml|yaml|ps1|css';
const REF_RE = new RegExp('([A-Za-z]:\\\\[^\\s:,;()]+|[\\w./\\\\-]+\\.(?:' + CODE_EXT + '))\\s*:\\s*(\\d+)(?:\\s*[-\u2013]\\s*(\\d+))?', 'g');

// Turn an absolute-or-relative, backslash-or-forward-slash path into a repo-relative one.
function normalise(p) {
  let s = String(p).replace(/\\/g, '/');
  const low = s.toLowerCase(), root = REPO.replace(/\\/g, '/').toLowerCase() + '/';
  if (low.startsWith(root)) s = s.slice(root.length);
  return s.replace(/^\.\//, '');
}

const lineCache = new Map();
function lineCount(rel) {
  if (lineCache.has(rel)) return lineCache.get(rel);
  const full = path.join(REPO, rel);
  let n = -1;
  try { if (fs.statSync(full).isFile()) n = fs.readFileSync(full, 'utf8').split('\n').length; } catch (e) { n = -1; }
  lineCache.set(rel, n);
  return n;
}

// Bare-filename references ("accessPolicy.js:248") are shorthand people genuinely write. Resolve
// one against the repo when it is UNAMBIGUOUS, and keep failing when it is not — a name shared by
// two files is a real ambiguity and silently picking one would be the gate lying to protect itself.
let basenameIndex = null;
function indexBasenames() {
  if (basenameIndex) return basenameIndex;
  basenameIndex = new Map();
  let files = [];
  try {
    files = cp.execSync('git ls-files', { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) { /* not a git checkout — resolution simply stays unavailable */ }
  for (const f of files) {
    const b = path.basename(f);
    if (!basenameIndex.has(b)) basenameIndex.set(b, []);
    basenameIndex.get(b).push(f);
  }
  return basenameIndex;
}
function resolveBare(rel) {
  if (rel.includes('/')) return null;              // already qualified; do not guess
  const hits = indexBasenames().get(rel) || [];
  return hits.length === 1 ? hits[0] : null;
}

// Extract every {file, line} claim from a free-text field.
function extractRefs(text) {
  const out = [];
  if (!text) return out;
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(String(text))) !== null) {
    out.push({ file: normalise(m[1]), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]) });
  }
  return out;
}

// A reference is BAD if the file is missing, or the line is past the end of the file.
function checkRef(ref) {
  let file = ref.file;
  let n = lineCount(file);
  if (n === -1) {
    const resolved = resolveBare(file);
    if (resolved) { file = resolved; n = lineCount(file); }
  }
  if (n === -1) {
    const hits = (indexBasenames().get(ref.file) || []);
    if (hits.length > 1) return `ambiguous reference "${ref.file}" — ${hits.length} files share that name (${hits.slice(0, 3).join(', ')}...); qualify it with its folder`;
    return `file does not exist: ${ref.file}`;
  }
  const hi = Math.max(ref.from, ref.to);
  if (hi > n) return `${file}:${hi} is past end of file (${n} lines) — the code moved`;
  return null;
}

// Test names look like "test/smoke-test.js S-215" or "test/topology-proof.js".
function extractTestFiles(provenBy) {
  if (!provenBy || /^\s*none\s*$/i.test(provenBy)) return [];
  const out = [];
  const re = /((?:test|audit-artifacts)[\/\\][\w.-]+\.js)/g;
  let m;
  while ((m = re.exec(String(provenBy))) !== null) out.push(normalise(m[1]));
  return out;
}

// ── self-test ─────────────────────────────────────────────────────────────────────────────
if (SELFTEST) {
  const cases = [
    ['ref extractor finds a single-line reference',
      () => extractRefs('see index.html:1197').length === 1],
    ['ref extractor finds a line RANGE',
      () => { const r = extractRefs('index.html:1197-1287')[0]; return r.from === 1197 && r.to === 1287; }],
    ['ref extractor finds an absolute Windows path',
      () => extractRefs('C:\\Users\\joshi\\repos\\bob-stock\\sync.js:691')[0].file === 'sync.js'],
    ['ref extractor finds MULTIPLE refs in one field',
      () => extractRefs('index.html:10, sync.js:20 and phase2.js:30').length === 3],
    ['ref extractor ignores prose with no file',
      () => extractRefs('decided at 10:30 on the 5th').length === 0],
    ['checkRef FAILS on a missing file',
      () => checkRef({ file: 'no-such-file-xyz.js', from: 1, to: 1 }) !== null],
    ['checkRef FAILS on a line past end of file',
      () => checkRef({ file: 'package.json', from: 999999, to: 999999 }) !== null],
    ['checkRef PASSES on a real file and a real line',
      () => checkRef({ file: 'sync.js', from: 1, to: 1 }) === null],
    ['test-file extractor finds a named test',
      () => extractTestFiles('test/smoke-test.js S-215').includes('test/smoke-test.js')],
    ['test-file extractor treats NONE as no proof',
      () => extractTestFiles('NONE').length === 0],
    ['normalise strips the repo root from an absolute path',
      () => normalise(REPO + '\\index.html') === 'index.html'],
    ['a UNIQUE bare filename resolves to its real path',
      () => resolveBare('accessPolicy.js') === 'azure-functions/src/functions/accessPolicy.js'],
    ['checkRef PASSES on a unique bare filename with a valid line',
      () => checkRef({ file: 'accessPolicy.js', from: 1, to: 1 }) === null],
    ['checkRef still FAILS on a unique bare filename with a bogus line',
      () => checkRef({ file: 'accessPolicy.js', from: 999999, to: 999999 }) !== null],
    ['an AMBIGUOUS bare filename is NOT silently resolved',
      () => resolveBare('package.json') === null],
    ['checkRef FAILS LOUDLY on an ambiguous bare filename',
      () => /ambiguous/.test(String(checkRef({ file: 'package.json', from: 1, to: 1 })))],
    ['a qualified path is never basename-guessed',
      () => resolveBare('some/deep/accessPolicy.js') === null],
  ];
  let bad = 0;
  console.log('\n=== check-register --self-test ===');
  console.log('Each case proves a check FIRES on a deliberately broken input (or stays quiet on a clean one).\n');
  for (const [name, fn] of cases) {
    let ok = false; try { ok = !!fn(); } catch (e) { ok = false; }
    if (!ok) bad++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
  }
  console.log(`\n${bad === 0 ? 'SELF-TEST PASS — every check demonstrably bites' : 'SELF-TEST FAIL (' + bad + ') — do NOT trust a green run'}`);
  process.exit(bad === 0 ? 0 : 1);
}

// ── the real run ──────────────────────────────────────────────────────────────────────────
const problems = [], warnings = [], info = [];
const readJson = f => {
  const p = path.join(REPO, 'register', f);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { problems.push(`register/${f} is not valid JSON: ${e.message}`); return null; }
};

const features = readJson('features.json');
const decisions = readJson('decisions.json');

if (!features) {
  problems.push('register/features.json is missing — the register has no feature data');
} else {
  const seen = new Set();
  let nFeat = 0, nRefs = 0, badRefs = 0;
  for (const a of features.areas || []) {
    if (!a.key || !a.title) problems.push(`an area is missing key or title`);
    for (const f of a.features || []) {
      nFeat++;
      // 1. structure
      if (!f.id) problems.push(`${a.key}: a feature has no id`);
      if (seen.has(f.id)) problems.push(`duplicate feature id: ${f.id}`);
      seen.add(f.id);
      for (const req of ['name', 'plainEnglish', 'whoUsesIt', 'where']) {
        if (!f[req] || !String(f[req]).trim()) problems.push(`${f.id} (${f.name || '?'}): "${req}" is empty`);
      }
      for (const k of Object.keys(VALID)) {
        if (!VALID[k].includes((f.status || {})[k])) problems.push(`${f.id}: status.${k} = "${(f.status || {})[k]}" is not one of ${VALID[k].join('/')}`);
      }
      // 2. plain English is the whole point — flag jargon-free-ness cheaply by length
      if (f.plainEnglish && f.plainEnglish.trim().length < 40) {
        warnings.push(`${f.id} (${f.name}): plainEnglish is very short — this document is read by non-developers`);
      }
      // 3. the rot detector
      for (const ref of extractRefs(f.where)) {
        nRefs++;
        const bad = checkRef(ref);
        if (bad) { badRefs++; problems.push(`${f.id} (${f.name}): ${bad}`); }
      }
      // 4. proof must exist and must be named
      const tests = extractTestFiles(f.provenBy);
      if (f.status && f.status.proven === 'yes' && tests.length === 0 && !/\.js/.test(String(f.provenBy || ''))) {
        problems.push(`${f.id} (${f.name}): claims proven=yes but names no test file ("${f.provenBy}") — an adjective is not a gate`);
      }
      for (const t of tests) {
        if (lineCount(t) === -1) problems.push(`${f.id} (${f.name}): named proof does not exist: ${t}`);
      }
    }
  }
  info.push(`${nFeat} features, ${nRefs} code references checked, ${badRefs} stale`);
}

if (decisions) {
  const okStatus = ['DECIDED', 'SUPERSEDED', 'OPEN', 'REVERSED'];
  let nDec = 0;
  for (const d of decisions.decisions || []) {
    nDec++;
    if (!d.what || !String(d.what).trim()) problems.push(`a decision has no "what"`);
    if (!d.why || !String(d.why).trim()) problems.push(`decision "${(d.what || '').slice(0, 60)}" has no "why" — a decision without its reasoning gets overturned`);
    if (!okStatus.includes(d.status)) problems.push(`decision "${(d.what || '').slice(0, 60)}" has status "${d.status}"`);
    if (d.status === 'SUPERSEDED' && !d.supersededBy) warnings.push(`decision "${(d.what || '').slice(0, 60)}" is SUPERSEDED but does not say by what`);
    for (const ref of extractRefs(d.source)) {
      const bad = checkRef(ref);
      if (bad) problems.push(`decision "${(d.what || '').slice(0, 60)}": ${bad}`);
    }
  }
  info.push(`${nDec} decisions, ${(decisions.openQuestions || []).length} open question(s)`);
} else {
  warnings.push('register/decisions.json is missing — the decision half of the register is not built yet');
}

// 5. the generated documents must match the data
try {
  cp.execSync('node register/build.js --check', { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
  info.push('REGISTER.md and TRAINING.md match the register data');
} catch (e) {
  problems.push('REGISTER.md / TRAINING.md do not match the register data — they were hand-edited, or the data changed without a rebuild. Run: node register/build.js');
}

// ── report ────────────────────────────────────────────────────────────────────────────────
console.log('\n=== check-register ===');
console.log('Is the register still telling the truth?\n');
for (const i of info) console.log(`  [info] ${i}`);
if (warnings.length) { console.log(''); for (const w of warnings.slice(0, 25)) console.log(`  [warn] ${w}`); if (warnings.length > 25) console.log(`  [warn] ...and ${warnings.length - 25} more`); }
if (problems.length) { console.log(''); for (const p of problems.slice(0, 40)) console.log(`  [FAIL] ${p}`); if (problems.length > 40) console.log(`  [FAIL] ...and ${problems.length - 40} more`); }
console.log(`\n==== ${problems.length === 0 ? 'REGISTER OK — 0 problems, ' + warnings.length + ' warning(s)' : problems.length + ' PROBLEM(S) — the register is lying somewhere'} ====`);
process.exit(problems.length === 0 ? 0 : 1);
