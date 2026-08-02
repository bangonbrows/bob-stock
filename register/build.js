// register/build.js — generates the two human-readable documents from the register DATA.
//
// ONE SOURCE, TWO OUTPUTS. register/features.json and register/decisions.json are the truth.
// REGISTER.md (engineering) and TRAINING.md (staff + Head Office) are GENERATED and must never
// be hand-edited — test/check-register.js fails if they drift from the data.
//
// WHY IT IS BUILT THIS WAY. This project has ~100 markdown files at its root. Every one is a
// snapshot of a past moment, several assert things that are no longer true, and the owner has
// had to personally remember decisions because no document held current truth. Prose rots
// silently; data with a validator does not. This is the same lesson already banked when the
// item-5 edits stopped being prose and became JSON with a checker.
//
// THE TRAINING DOCUMENT ONLY TEACHES WHAT ACTUALLY WORKS. It is generated from the switchedOn
// status, so staff are never trained on a feature that is built but switched off. That falls
// straight out of the four-way status and is the main reason the status is four fields and not
// one.
//
//   node register/build.js            write REGISTER.md and TRAINING.md
//   node register/build.js --check    print what WOULD change, write nothing (used by the gate)
//
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

const readJson = f => {
  const p = path.join(REPO, 'register', f);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

const features = readJson('features.json');
const decisions = readJson('decisions.json');
if (!features) { console.error('register/features.json missing — nothing to build'); process.exit(1); }

const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// ── honest citations ──────────────────────────────────────────────────────────────────────
// Much of this project's analysis lives in audit-artifacts/, which is gitignored wholesale. A
// citation of the form "SOME-FILE.md:1037" promises a reader they can go and look at line 1037.
// For a gitignored file they cannot — and an audit package once had to be rebuilt for exactly
// this reason, having named ground truth that was absent from the commit an auditor was given.
// So a citation to an untracked file is rendered WITHOUT the false line-anchor and labelled for
// what it is. The decision itself is recorded here, in tracked data, which is the point: the
// gitignored file is where it was first written, not where it now lives.
let trackedMd = null;
function trackedMarkdown() {
  if (trackedMd) return trackedMd;
  trackedMd = new Set();
  try {
    require('child_process').execSync("git ls-files *.md", { cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .split('\n').map(s => s.trim()).filter(Boolean)
      .forEach(f => trackedMd.add(path.basename(f)));
  } catch (e) { /* not a git checkout — leave every citation untouched */ }
  return trackedMd;
}
function honestCitations(s) {
  const tracked = trackedMarkdown();
  if (!tracked.size) return s;
  return String(s == null ? '' : s).replace(/([A-Za-z0-9][A-Za-z0-9._-]*\.md):(\d+(?:-\d+)?)/g,
    (whole, file, line) => tracked.has(path.basename(file))
      ? whole
      : `${file} (line ${line} — local working analysis, not in git)`);
}
const ON = f => f.status.switchedOn === 'yes';
const PARTIAL = f => f.status.switchedOn === 'partial';

// ── status badge, deliberately blunt ──────────────────────────────────────────────────────
function badge(s) {
  if (s.switchedOn === 'yes') return 'LIVE';
  if (s.switchedOn === 'partial') return 'PARTLY ON';
  if (s.built === 'no') return 'NOT BUILT';
  if (s.built === 'partial') return 'HALF BUILT';
  if (s.proven === 'yes') return 'BUILT + PROVEN, OFF';
  return 'BUILT, OFF';
}

// ══ REGISTER.md — the engineering document ════════════════════════════════════════════════
function buildRegister() {
  const L = [];
  const allF = features.areas.flatMap(a => a.features);
  const on = allF.filter(ON).length, partial = allF.filter(PARTIAL).length;
  const offProven = allF.filter(f => f.status.built === 'yes' && f.status.proven === 'yes' && f.status.switchedOn === 'no').length;

  L.push('# BOB Stock App — Feature and Decision Register');
  L.push('');
  L.push('> **GENERATED FILE — DO NOT EDIT.** Edit `register/features.json` / `register/decisions.json`');
  L.push('> and run `node register/build.js`. `test/check-register.js` fails if this file is hand-edited,');
  L.push('> if a code reference in it has gone stale, or if a named test no longer exists.');
  L.push('');
  L.push(`*Generated ${features.generated}. ${allF.length} features across ${features.areas.length} areas` +
    (decisions ? `, ${(decisions.decisions || []).length} decisions` : '') + '.*');
  L.push('');
  L.push('## Read this first');
  L.push('');
  L.push('Every feature carries **four separate statuses**, because on this project they genuinely');
  L.push('come apart and blurring them has cost real time:');
  L.push('');
  L.push('| Status | Question it answers |');
  L.push('|---|---|');
  L.push('| **built** | Does the code exist? |');
  L.push('| **proven** | Does a test cover it? (a gate you have never seen fail is not a gate) |');
  L.push('| **cloud** | Is the server side deployed? |');
  L.push('| **on** | Does it actually run for a real person today? |');
  L.push('');
  L.push('A feature can be built, proven, deployed **and still switched off**. Right now ' + offProven +
    ' features are exactly that. "We built it" and "it works for staff" are different sentences.');
  L.push('');
  L.push(`**Today: ${on} features live, ${partial} partly on, ${allF.length - on - partial} not running.**`);
  L.push('');

  // contents
  L.push('## Contents');
  L.push('');
  features.areas.forEach(a => {
    const n = a.features.length, live = a.features.filter(ON).length;
    L.push(`- [${a.title}](#${a.key}) — ${n} features, ${live} live`);
  });
  if (decisions) L.push('- [Decisions](#decisions)');
  L.push('- [Open questions for Kunal](#open-questions)');
  L.push('- [Known gaps and surprises](#gaps)');
  L.push('');

  // features by area
  for (const a of features.areas) {
    L.push(`## <a id="${a.key}"></a>${a.title}`);
    L.push('');
    L.push('| Feature | What it does | Who | Status | Where | Proven by |');
    L.push('|---|---|---|---|---|---|');
    for (const f of a.features) {
      L.push(`| **${esc(f.name)}** | ${esc(honestCitations(f.plainEnglish))} | ${esc(f.whoUsesIt)} | ${badge(f.status)} | \`${esc(honestCitations(f.where))}\` | ${esc(honestCitations(f.provenBy))} |`);
    }
    L.push('');
    const noted = a.features.filter(f => f.notes && f.notes.trim());
    if (noted.length) {
      L.push('<details><summary>Notes and gotchas (' + noted.length + ')</summary>');
      L.push('');
      noted.forEach(f => L.push(`- **${esc(f.name)}** — ${esc(honestCitations(f.notes))}`));
      L.push('');
      L.push('</details>');
      L.push('');
    }
  }

  // decisions
  if (decisions && (decisions.decisions || []).length) {
    L.push('## <a id="decisions"></a>Decisions');
    L.push('');
    L.push('Why each one is here: a decision without its reasoning gets overturned by the next person');
    L.push('who does not know the reasoning. **rules out** is the column that stops re-litigation.');
    L.push('');
    const byStatus = s => (decisions.decisions || []).filter(d => d.status === s);
    for (const st of ['DECIDED', 'OPEN', 'SUPERSEDED', 'REVERSED']) {
      const ds = byStatus(st);
      if (!ds.length) continue;
      L.push(`### ${st} (${ds.length})`);
      L.push('');
      L.push('| # | Decision | Why | Rules out | Who / when | Source |');
      L.push('|---|---|---|---|---|---|');
      for (const d of ds) {
        L.push(`| ${esc(d.id || '')} | ${esc(honestCitations(d.what))} | ${esc(honestCitations(d.why))} | ${esc(honestCitations(d.rulesOut))} | ${esc(honestCitations(d.whoDecided))} ${esc(d.when)} | \`${esc(honestCitations(d.source))}\` |`);
      }
      L.push('');
    }
  }

  // open questions
  L.push('## <a id="open-questions"></a>Open questions for Kunal');
  L.push('');
  const oq = (decisions && decisions.openQuestions) || [];
  if (oq.length) {
    L.push('| Question | Why it matters | Source |');
    L.push('|---|---|---|');
    oq.forEach(q => L.push(`| ${esc(honestCitations(q.question))} | ${esc(honestCitations(q.whyItMatters))} | \`${esc(honestCitations(q.source))}\` |`));
  } else {
    L.push('*(none recorded — or the decisions pass has not run yet)*');
  }
  L.push('');

  // surprises
  L.push('## <a id="gaps"></a>Known gaps and surprises');
  L.push('');
  L.push('Things that are not what a reasonable person would assume. These are the entries most');
  L.push('worth reading before planning any work.');
  L.push('');
  for (const a of features.areas) {
    if (!a.surprises.length) continue;
    L.push(`### ${a.title}`);
    L.push('');
    a.surprises.forEach(s => L.push(`- ${honestCitations(s)}`));
    L.push('');
  }

  // uncertainty, stated rather than hidden
  const unc = features.areas.filter(a => a.uncertain.length);
  if (unc.length) {
    L.push('## Not yet established');
    L.push('');
    L.push('Recorded rather than guessed at. An unknown that is written down is a task; an unknown');
    L.push('that is glossed over is a defect waiting to happen.');
    L.push('');
    for (const a of unc) {
      L.push(`**${a.title}**`);
      L.push('');
      a.uncertain.forEach(u => L.push(`- ${u}`));
      L.push('');
    }
  }
  return L.join('\n') + '\n';
}

// ══ TRAINING.md — the staff and Head Office document ══════════════════════════════════════
function buildTraining() {
  const L = [];
  const allF = features.areas.flatMap(a => a.features);
  const live = allF.filter(f => ON(f) || PARTIAL(f));

  L.push('# BOB Stock App — What it does, and how to use it');
  L.push('');
  L.push('> **GENERATED FILE — DO NOT EDIT.** Built from `register/features.json`.');
  L.push('');
  L.push('A plain-English guide to every part of the Stock app, for salon staff, store managers and');
  L.push('Head Office. No technical knowledge assumed.');
  L.push('');
  L.push('**This guide only covers what actually works today.** Anything still being built is listed');
  L.push('separately at the end, so nobody is ever trained on a button that is not connected yet.');
  L.push('');
  L.push(`*${live.length} working features, current as at ${features.generated}.*`);
  L.push('');
  L.push('---');
  L.push('');

  for (const a of features.areas) {
    const fs_ = a.features.filter(f => ON(f) || PARTIAL(f));
    if (!fs_.length) continue;
    L.push(`## ${a.title}`);
    L.push('');
    for (const f of fs_) {
      L.push(`### ${f.name}${PARTIAL(f) ? '  *(partly working)*' : ''}`);
      L.push('');
      L.push(f.plainEnglish);
      L.push('');
      L.push(`**Who uses it:** ${f.whoUsesIt}`);
      L.push('');
      if (f.notes && f.notes.trim()) {
        L.push(`> **Worth knowing:** ${honestCitations(f.notes)}`);
        L.push('');
      }
    }
    L.push('---');
    L.push('');
  }

  // not-yet-working, so training never over-promises
  const later = features.areas
    .map(a => ({ title: a.title, fs: a.features.filter(f => !ON(f) && !PARTIAL(f)) }))
    .filter(x => x.fs.length);
  if (later.length) {
    L.push('## Not working yet');
    L.push('');
    L.push('These are built or part-built but are **not switched on**. Do not train staff on them and');
    L.push('do not rely on them. They are listed so everyone knows they exist and nobody rebuilds them.');
    L.push('');
    for (const x of later) {
      L.push(`**${x.title}**`);
      L.push('');
      x.fs.forEach(f => L.push(`- **${f.name}** — ${f.plainEnglish}`));
      L.push('');
    }
  }
  return L.join('\n') + '\n';
}

// ── write or compare ──────────────────────────────────────────────────────────────────────
const outputs = [['REGISTER.md', buildRegister()], ['TRAINING.md', buildTraining()]];
// Compare with line endings normalised. Git converts LF to CRLF on checkout on Windows, so a
// byte-for-byte comparison would fail on every fresh clone and the gate would be permanently red
// for reasons having nothing to do with the register's accuracy. This project has already lost a
// full sabotage sweep to exactly this: 24/24 healthy, and only the matcher was broken by CRLF.
const norm = s => (s == null ? null : String(s).replace(/\r\n/g, '\n'));
let drift = 0;
for (const [name, content] of outputs) {
  const p = path.join(REPO, name);
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (CHECK) {
    if (norm(existing) !== norm(content)) { drift++; console.log(`  [DRIFT] ${name} does not match the register data — run: node register/build.js`); }
    else console.log(`  [ok] ${name} matches the data`);
  } else {
    fs.writeFileSync(p, content);
    console.log(`  wrote ${name}  (${content.split('\n').length} lines, ${(content.length / 1024).toFixed(0)} KB)`);
  }
}
if (CHECK) process.exit(drift === 0 ? 0 : 1);
