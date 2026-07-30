// DOCUMENTATION GUARD — "a document that lies is a gate that never fires."
//
// WHY THIS EXISTS. This repo has ~100 markdown files. Most were written to capture a MOMENT (a spec
// as agreed that day, a wave review of what happened) but they READ like current truth, and nobody
// re-reads them. Over 2026-07-29/30 EIGHT separate stale-record failures were found — every one of
// them BY ACCIDENT, by a human who happened to be looking for something else. Not one was found by a
// system, because no system existed. Two of them were live dangers:
//   · a cleanup list called `bobstockfnval2607` a Function App and marked it safe to delete. It is
//     the STORAGE ACCOUNT the Function App runs on. Deleting it destroys all 10 server routes.
//   · an apply instruction added an action named `ToInsert2` to a Logic App where that name is
//     already taken, which OVERWRITES the live safety filter and jams the stock sync write path.
//
// The project already has mechanical gates that break when the CODE lies. It had nothing that breaks
// when a DOCUMENT lies. This is that.
//
// DESIGN. Every check is a pure function over an in-memory corpus — `[{path, text}]` — so the
// self-test can feed deliberately corrupted documents without touching the working tree. That is
// what makes `--self-test` honest: it proves each rule FIRES, which is this project's standing rule
// (a gate you have never seen fail is not a gate).
//
// USAGE
//   node audit-artifacts/check-docs.js              # check the real tracked corpus
//   node audit-artifacts/check-docs.js --self-test  # prove every rule bites (run this in CI too)
//   node audit-artifacts/check-docs.js --quiet      # problems only
//
// SCOPE. Deliberately a FIRST SLICE. Eight checks, each traceable to a real failure it would have
// caught. Five more from the specification are NOT implemented yet and are listed at the bottom with
// the reason — an unimplemented check that is honestly declared is worth more than a fuzzy one that
// cries wolf, because a noisy gate gets ignored and then it protects nothing.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ── CONFIG ─────────────────────────────────────────────────────────────────────────────────────────

// Standing markers that must have exactly ONE authoritative copy. Every other mention must be a
// short pointer. Seeded from the real failure: the never-skip engine re-audit marker was stated
// three different ways in three places, with three different item counts (none / three / five).
const CANONICAL_MARKERS = [
  { name: 'engine re-audit marker', canonical: 'HANDOVER.md',
    detect: /return[- ]engine re-audit|engine re-audit marker|frozen,? not finished/i,
    contentHint: /predicate change|sealed-row-pre-epoch|control-seal enforcement/i },
];

// Facts that must NEVER live only in a gitignored file. Seeded from the orphan sweep — the
// `ToInsert2` collision existed ONLY in a gitignored plan, so a dead laptop would have kept the
// instruction to apply item 5 and lost the reason not to.
const LOAD_BEARING_FACTS = [
  { name: 'ToInsert2 name collision (would jam the sync write path)', pattern: /ToInsert2/ },
  { name: 'colon-id defect (aborts a whole store buy-back export)', pattern: /MALFORMED_CONTROL|ctl:op-|colon/i },
  { name: 'store_eras fail-closed rule (prevents a franchisee seeing the prior owner history)', pattern: /store_eras/ },
  { name: 'the 3.75-vs-375 control-seal money hole', pattern: /3\.75/ },
  { name: 'C1 predicate change is a safety regression without the tombstone guard', pattern: /owed 675|tombstone guard/i },
];

// Numbers repeated across documents that must agree with a mechanical count.
//
// DELIBERATELY EMPTY. The first version counted `(\d+) routes` and produced FOUR findings, all four
// false: three matched "routes" used as a VERB ("W3 routes ALL of them through Auth.can"; "the ported
// pull-v2 routes on lastId"), and the rest were counts that were CORRECT on the day they were written
// inside a dated ledger entry.
//
// That is not a tuning problem, it is a category error. Most documents here are MOMENT-RECORDS, and a
// number that was true when written is not a lie — it is history. A check cannot tell "the app had 7
// routes when we deployed" from "the app has 7 routes" without understanding tense, and a gate that
// guesses will cry wolf. A noisy gate gets skimmed, and a skimmed gate protects nothing.
//
// To re-enable safely, docs would first need a convention marking a number as a CURRENT claim rather
// than a historical one (e.g. a `<!-- current -->` marker). Adopt the convention, then the check.
const COUNTED = [];

// Code-versus-doc invariants. Each carries plain-English failure text because a non-developer reads
// the output. These are the highest-signal checks in the file: they compare a claim to the code.
const INVARIANTS = [
  {
    name: 'colon-id defect is still live and reqId was NOT widened',
    check: () => {
      const cc = read('azure-functions/src/functions/correctionCompute.js');
      const tp = read('azure-functions/src/functions/topology.js');
      if (cc === null || tp === null) return null;
      const mintsColon = /'ctl:'|'corr:'|'jrn:'/.test(cc);
      const idReBansColon = /ID_RE\s*=\s*\/\^\[A-Za-z0-9_\.\-\]/.test(tp);
      if (mintsColon && !idReBansColon) {
        return 'ID_RE appears to have been WIDENED to accept colons. The agreed fix is to mint colon-free ids at the correction end — widening the validator loosens a check the whole server phase depends on. See HANDOVER.md §5a.';
      }
      return null;
    },
  },
  {
    name: 'the buy-back engine still has no EconSig coverage (probe obligation unmet)',
    knownOpen: true,   // a tracked obligation with a heartbeat, NOT a document that lies — see reporting note
    check: () => {
      const be = read('azure-functions/src/functions/buybackExport.js');
      if (be === null) return null;
      const econ = (be.match(/EconSig/g) || []).length;
      if (econ === 0) {
        return 'buybackExport.js does not reference EconSig at all, so its 170-probe suite cannot be covering the signature mechanism the engine is about to depend on. The re-audit obligation "build the EconSig probe family FIRST" is still unmet. See HANDOVER.md §5a obligation 4.';
      }
      return null;
    },
  },
  {
    name: 'C2 parking obligation 1 — the re-audit checklist still says "Land Contract 2"',
    check: () => {
      const sc = read('AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md');
      if (sc === null) return null;
      if (/Land Contract 2/i.test(sc)) {
        return 'AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md still lists "Land Contract 2" as a re-audit step, but Contract 2 is PARKED. An auditor following it will flag the missing route as a gap and burn a round. This is carried obligation 1 in HANDOVER.md §5a and it is NOT done.';
      }
      return null;
    },
  },
];

// ── HELPERS ────────────────────────────────────────────────────────────────────────────────────────

// MOMENT-RECORDS. These document what was true on a given day — an audit report, a pack as handed to
// a reviewer, a wave review. A commit hash or a file length inside one is a HISTORICAL FACT, and
// "correcting" it would falsify the record. So the tense-sensitive check (git pins) skips them.
//
// Learned the hard way on the first real run: the guard flagged an audit response for recording that
// Codex reviewed HEAD `d4d1dd4`, and an auditor pack for describing a file as ~450 lines when it was
// handed over. Both were perfectly accurate. Updating either would have been the actual error.
//
// Checks that are NOT tense-sensitive (citations, decision status) still apply here — a dangling
// pointer in an archive is still a dangling pointer.
const HISTORICAL_DOC = /(-AUDIT-RESPONSE\.md$|^PASTE-TO-AUDITORS-|^EXTERNAL-AUDIT-|^WAVE-[A-Z0-9]+-|-WAVE-REVIEW\.md$|^BLIND-AUDIT-|-CLIENT-REVIEW\.md$|^AZURE-CHUNK-ORG-W1W2-)/;
const isHistorical = (p) => HISTORICAL_DOC.test(path.basename(p));

function read(rel) {
  try { return fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch (e) { return null; }
}
function lineOf(text, idx) { return text.slice(0, idx).split('\n').length; }

/** Tracked markdown only. Gitignored analysis is deliberately EXCLUDED — a fact that lives only
 *  there is precisely what check 6 exists to catch. */
function loadCorpus() {
  const files = git(['ls-files', '*.md']).split('\n').filter(Boolean);
  return files.map(p => ({ path: p, text: read(p) || '' }));
}

const problem = (check, file, line, msg) => ({ check, file, line, msg });

// ── CHECKS (pure over corpus) ──────────────────────────────────────────────────────────────────────

/** C1 — git pins agree with git.
 *  CAUGHT: HANDOVER claiming HEAD `aecde76` and "262 commits ahead" when reality had moved on, and
 *  CLAUDE.md pinning main at `005caee` when main is `9ba9917`. The most likely check to fire. */
function checkGitPins(corpus, facts) {
  const out = [];
  for (const { path: p, text } of corpus) {
    if (isHistorical(p)) continue;   // a pin inside a moment-record is a historical fact, not a lie
    for (const m of text.matchAll(/HEAD\s+`([0-9a-f]{7,40})`/g)) {
      if (facts.head && !facts.head.startsWith(m[1]) && !m[1].startsWith(facts.head)) {
        out.push(problem('git-pins', p, lineOf(text, m.index), `claims HEAD is ${m[1]}, actually ${facts.head}`));
      }
    }
    for (const m of text.matchAll(/([\d,]+)\s+commits ahead/gi)) {
      const claimed = Number(m[1].replace(/,/g, ''));
      if (facts.ahead != null && Math.abs(claimed - facts.ahead) > 0) {
        out.push(problem('git-pins', p, lineOf(text, m.index), `claims ${claimed} commits ahead, actually ${facts.ahead}`));
      }
    }
    // The `(?!:\d)` is load-bearing. Without it this matched `index.html:647-842, ~195 lines` —
    // the length of a FUNCTION inside the file, not the file — and reported a healthy document as
    // wrong. A filename followed by a line reference is talking about a region, never the whole file.
    for (const m of text.matchAll(/`?([A-Za-z0-9_.\-\/]+\.(?:html|js))(?!:\d)`?[^\n]{0,40}?~?([\d,]{3,})\s*(?:lines|-line)/gi)) {
      const claimed = Number(m[2].replace(/,/g, ''));
      const real = facts.lineCounts[path.basename(m[1])];
      if (real && Math.abs(claimed - real) / real > 0.05) {
        out.push(problem('git-pins', p, lineOf(text, m.index), `says ${m[1]} is ~${claimed} lines, actually ${real}`));
      }
    }
  }
  return out;
}

/** C2 — no decision id is OPEN in one place and DECIDED in another.
 *  CAUGHT: AA-20 recorded DECIDED 2026-07-10 in the repo while HANDOVER and the memory index both
 *  still listed it as an open owner question. */
// ⚠ THESE PATTERNS ARE NARROW ON PURPOSE, AND THE NARROWNESS WAS PAID FOR.
// Version 1 matched any of open/pending/awaiting ANYWHERE on the line and produced four findings, all
// four false. In this repo's prose:
//   · "CLOSE the HO era; OPEN the franchise era `[now,null]`"  -> "OPEN" is a VERB
//   · "an EARLIER effective boundary is still pending"          -> a technical state, not a decision
//   · "...CONFIRMED closed... -> §OS-SR-5/7-amend"              -> the id is merely cross-referenced
// So a status word must now appear in an actual STATUS CONSTRUCTION, and within PROXIMITY chars of the
// id itself. Same lesson as the deleted counts check: this corpus is prose, and a check that guesses
// at meaning cries wolf. A noisy gate gets skimmed, and a skimmed gate protects nothing.
const OPEN_RE = /\b(?:(?:remains|is|still|currently)\s+open|open\s+(?:owner\s+|kunal\s+)?(?:decision|question|item)|pending\s+(?:a\s+)?(?:decision|kunal|owner)|awaiting\s+(?:a\s+)?(?:decision|kunal|owner)|needs\s+(?:a\s+)?(?:kunal|owner)\s+decision|\bTBD\b|\bundecided\b|to\s+decide)/i;
const DECIDED_RE = /\b(?:DECIDED|RESOLVED|LOCKED|SETTLED)\b|\(Kunal \d{4}-\d{2}-\d{2}\)/;
const PROXIMITY = 60;   // the status marker must be near the id, not merely on the same line

function checkDecisionStatus(corpus) {
  const seen = new Map();
  for (const { path: p, text } of corpus) {
    const lines = text.split('\n');
    lines.forEach((ln, i) => {
      for (const m of ln.matchAll(/\b((?:AA|D-AA|D-OS|OS-SR|W4-SR|SR|D)-\d+(?:\.\d+)?[a-z]?)\b/g)) {
        const id = m[1];
        const near = ln.slice(Math.max(0, m.index - PROXIMITY), m.index + id.length + PROXIMITY);
        const isOpen = OPEN_RE.test(near), isDecided = DECIDED_RE.test(near);
        if (isOpen === isDecided) continue;   // neither, or ambiguously both — not a usable signal
        if (!seen.has(id)) seen.set(id, { open: [], decided: [] });
        seen.get(id)[isDecided ? 'decided' : 'open'].push(`${p}:${i + 1}`);
      }
    });
  }
  const out = [];
  for (const [id, v] of seen) {
    if (v.open.length && v.decided.length) {
      out.push(problem('decision-status', v.open[0].split(':')[0], Number(v.open[0].split(':')[1]),
        `${id} is OPEN in [${v.open.join(', ')}] but DECIDED in [${v.decided.join(', ')}] — one of them is wrong and a session will act on whichever it reads first`));
    }
  }
  return out;
}

/** C3 — every documentation citation resolves.
 *  CAUGHT: gen-correction-def.js citing "AZURE-CHUNK-ORG-C2-LA-CHANGES.md §B-G" as "the single
 *  source of truth" for deliberate gaps, where no such section exists. Five real defects sat behind
 *  that dangling pointer for twelve audit rounds. */
function checkCitations(corpus, facts) {
  const out = [];
  const known = new Set(facts.allFiles.map(f => path.basename(f)));
  for (const { path: p, text } of corpus) {
    for (const m of text.matchAll(/([A-Za-z0-9][A-Za-z0-9._\-]*\.md):(\d+)/g)) {
      const [_, file, lineNo] = m;
      if (!known.has(path.basename(file))) {
        out.push(problem('citations', p, lineOf(text, m.index), `cites ${file} which does not exist`));
        continue;
      }
      const target = facts.lineCounts[path.basename(file)];
      if (target && Number(lineNo) > target) {
        out.push(problem('citations', p, lineOf(text, m.index), `cites ${file}:${lineNo} but that file has only ${target} lines`));
      }
    }
  }
  return out;
}

/** C4 — a designated standing marker has exactly ONE authoritative copy.
 *  CAUGHT: the never-skip engine re-audit marker stated three ways in three places with three
 *  different item counts. A money-critical step gets quietly shortened exactly like that. */
function checkCanonicalMarkers(corpus) {
  const out = [];
  for (const mk of CANONICAL_MARKERS) {
    const holders = corpus.filter(c => mk.detect.test(c.text) && mk.contentHint.test(c.text)).map(c => c.path);
    if (holders.length > 1) {
      out.push(problem('canonical-markers', holders[0], 0,
        `"${mk.name}" has its FULL CONTENT in ${holders.length} files [${holders.join(', ')}] — only ${mk.canonical} may; the rest must be one-line pointers, or the copies will drift`));
    }
  }
  return out;
}

/** C5 — repeated counts agree with a mechanical count. */
function checkCounts(corpus) {
  const out = [];
  for (const c of COUNTED) {
    let real; try { real = c.count(); } catch (e) { continue; }
    for (const { path: p, text } of corpus) {
      for (const m of text.matchAll(c.re)) {
        if (Number(m[1]) !== real) {
          out.push(problem('counts', p, lineOf(text, m.index), `says ${m[1]} ${c.name}, mechanical count is ${real}`));
        }
      }
    }
  }
  return out;
}

/** C6 — load-bearing facts must live in at least one TRACKED file.
 *  CAUGHT: the ToInsert2 collision existed ONLY in gitignored audit-artifacts/. A lost laptop would
 *  have kept the instruction to apply item 5 and lost the reason not to. */
function checkOrphanFacts(corpus) {
  const out = [];
  const all = corpus.map(c => c.text).join('\n');
  for (const f of LOAD_BEARING_FACTS) {
    if (!f.pattern.test(all)) {
      out.push(problem('orphan-facts', '(tracked corpus)', 0,
        `"${f.name}" appears in NO tracked file — it exists only in gitignored analysis or in someone's head. One lost machine from gone.`));
    }
  }
  return out;
}

/** C7 — nothing is newer than the index without being folded in. */
function checkIndexFreshness(corpus, facts) {
  if (!facts.commitTimes) return [];
  const idx = facts.commitTimes['HANDOVER.md'];
  if (!idx) return [];
  const newer = Object.entries(facts.commitTimes)
    .filter(([f, t]) => f !== 'HANDOVER.md' && t > idx && /^AZURE-|^REMAINING|^CLAUDE/.test(f))
    .map(([f]) => f);
  if (!newer.length) return [];
  return [problem('index-freshness', 'HANDOVER.md', 0,
    `${newer.length} governing doc(s) changed more recently than the index [${newer.slice(0, 6).join(', ')}${newer.length > 6 ? ', …' : ''}] — check any decision in them is reflected in HANDOVER`)];
}

/** C8 — hard-coded code-versus-doc invariants. */
function checkInvariants() {
  const out = [];
  for (const inv of INVARIANTS) {
    let msg = null;
    try { msg = inv.check(); } catch (e) { msg = `invariant could not run: ${e.message}`; }
    if (msg) out.push(Object.assign(problem(inv.knownOpen ? 'open-obligations' : 'invariants', '(code vs docs)', 0, `${inv.name}: ${msg}`), { knownOpen: !!inv.knownOpen }));
  }
  return out;
}

// ── RUNNER ─────────────────────────────────────────────────────────────────────────────────────────

const CORPUS_CHECKS = [
  ['git-pins', checkGitPins], ['decision-status', checkDecisionStatus], ['citations', checkCitations],
  ['canonical-markers', checkCanonicalMarkers], ['counts', checkCounts], ['orphan-facts', checkOrphanFacts],
  ['index-freshness', checkIndexFreshness],
];

function gatherFacts(corpus) {
  const facts = { allFiles: [], lineCounts: {}, commitTimes: {} };
  try { facts.head = git(['rev-parse', '--short', 'HEAD']); } catch (e) {}
  try { facts.ahead = Number(git(['rev-list', '--count', 'main..HEAD'])); } catch (e) {}
  try { facts.allFiles = git(['ls-files']).split('\n').filter(Boolean); } catch (e) {}
  for (const f of facts.allFiles) {
    const t = read(f); if (t !== null) facts.lineCounts[path.basename(f)] = t.split('\n').length;
  }
  for (const c of corpus) {
    try { facts.commitTimes[c.path] = Number(git(['log', '-1', '--format=%ct', '--', c.path])); } catch (e) {}
  }
  return facts;
}

function runAll(corpus, facts) {
  let out = [];
  for (const [, fn] of CORPUS_CHECKS) out = out.concat(fn(corpus, facts));
  return out;
}

// ── SELF-TEST — prove every rule BITES ─────────────────────────────────────────────────────────────
// One deliberate corruption per check, fed through as a synthetic corpus. A check that cannot be made
// to fail is not protecting anything, and this suite is the only thing that proves otherwise.
function selfTest() {
  const facts = {
    head: 'abc1234', ahead: 100, allFiles: ['REAL.md'],
    lineCounts: { 'REAL.md': 50, 'index.html': 6637 }, commitTimes: { 'HANDOVER.md': 100, 'AZURE-X.md': 200 },
  };
  const cases = [
    { id: 'M1', check: 'git-pins', why: 'a doc claiming a HEAD hash that is not HEAD',
      corpus: [{ path: 'D.md', text: 'Branch foo, HEAD `deadbee`, ready.' }] },
    { id: 'M2', check: 'git-pins', why: 'a doc claiming the wrong commits-ahead count',
      corpus: [{ path: 'D.md', text: 'The branch is 262 commits ahead of main.' }] },
    { id: 'M3', check: 'git-pins', why: 'a doc quoting a stale line count for a source file',
      corpus: [{ path: 'D.md', text: '`index.html` is a ~4,750 lines monolith.' }] },
    { id: 'M4', check: 'decision-status', why: 'one decision id recorded OPEN in one file and DECIDED in another',
      corpus: [{ path: 'A.md', text: 'AA-20 remains an open owner decision.' },
               { path: 'B.md', text: 'AA-20 DECIDED (Kunal 2026-07-10): instant kill-switch.' }] },
    { id: 'M5', check: 'citations', why: 'a citation pointing at a file that does not exist',
      corpus: [{ path: 'D.md', text: 'See GHOST-DOC.md:12 for the gap list.' }] },
    { id: 'M6', check: 'citations', why: 'a citation pointing past the end of a real file',
      corpus: [{ path: 'D.md', text: 'The rule is at REAL.md:9999.' }] },
    { id: 'M7', check: 'canonical-markers', why: 'a standing marker whose full content is copied into a second file',
      corpus: [{ path: 'HANDOVER.md', text: 'The return-engine re-audit: predicate change, sealed-row-pre-epoch, control-seal enforcement.' },
               { path: 'OTHER.md', text: 'The engine re-audit marker covers the predicate change and the sealed-row-pre-epoch rule and control-seal enforcement.' }] },
    { id: 'M8', check: 'orphan-facts', why: 'a load-bearing fact absent from every tracked file',
      corpus: [{ path: 'D.md', text: 'nothing of interest here' }] },
    { id: 'M9', check: 'index-freshness', why: 'a governing doc changed more recently than the index',
      corpus: [{ path: 'HANDOVER.md', text: 'x' }, { path: 'AZURE-X.md', text: 'y' }] },
  ];

  // The exemption must be proven too, not asserted. An identical stale pin must FIRE in a
  // current-truth doc and STAY SILENT in a moment-record — otherwise the exemption is either
  // useless (still noisy) or a hole (silences everything).
  const exemption = [
    { id: 'X1', why: 'a stale pin in a CURRENT-truth doc must fire',
      corpus: [{ path: 'HANDOVER.md', text: 'HEAD `deadbee` today.' }], expectFire: true },
    { id: 'X2', why: 'the SAME stale pin in a moment-record must NOT fire',
      corpus: [{ path: 'PASTE-TO-AUDITORS-X.md', text: 'HEAD `deadbee` today.' }], expectFire: false },
    { id: 'X3', why: 'a dangling citation in a moment-record STILL fires (not tense-sensitive)',
      corpus: [{ path: 'EXTERNAL-AUDIT-X.md', text: 'see GHOST-DOC.md:12' }], expectFire: true, check: 'citations' },
    // The four real false positives from the first run, pinned so they can never come back.
    { id: 'X4', why: '"OPEN" used as a VERB must NOT read as a decision status', check: 'decision-status',
      corpus: [{ path: 'A.md', text: '| OS-SR-5 | CLOSE HO era `to=now`; OPEN franchise era `[now,null]` |' },
               { path: 'B.md', text: 'OS-SR-5 DECIDED (Kunal 2026-07-10).' }], expectFire: false },
    { id: 'X5', why: '"still pending" describing a technical state must NOT read as a status', check: 'decision-status',
      corpus: [{ path: 'A.md', text: 'W4-SR-80: an EARLIER effective boundary is still pending, so the horizon admits rows.' },
               { path: 'B.md', text: 'W4-SR-80 SETTLED echo: the version carries settled:true only when...' }], expectFire: false },
    { id: 'X6', why: 'a status word FAR from the id on a long line must NOT bind to it', check: 'decision-status',
      corpus: [{ path: 'A.md', text: 'SR-1 was folded in during the spec round, and separately a completely different matter remains open for the owner to decide at some later point.' },
               { path: 'B.md', text: 'SR-1 LOCKED at spec close.' }], expectFire: false },
  ];

  console.log('doc-guard self-test — every rule must be observed to FAIL\n');
  let bad = 0;
  for (const c of cases) {
    const got = runAll(c.corpus, facts).filter(p => p.check === c.check);
    const ok = got.length > 0;
    if (!ok) bad++;
    console.log(`  ${ok ? 'CAUGHT ' : 'MISSED '} [${c.id}] ${c.check}: ${c.why}`);
    if (!ok) console.log('           ^^ this rule did not fire — it is not protecting anything');
  }
  for (const x of exemption) {
    const got = runAll(x.corpus, facts).filter(p => p.check === (x.check || 'git-pins'));
    const fired = got.length > 0;
    const ok = fired === x.expectFire;
    if (!ok) bad++;
    console.log(`  ${ok ? 'CORRECT' : 'WRONG  '} [${x.id}] ${x.why}${ok ? '' : `  (fired=${fired}, expected=${x.expectFire})`}`);
  }

  // and the clean corpus must be silent, or the rules are just noise
  const clean = runAll([{ path: 'REAL.md', text: 'A calm document with no claims.' }],
    { ...facts, commitTimes: { 'HANDOVER.md': 999 } })
    .filter(p => p.check !== 'orphan-facts');
  if (clean.length) {
    bad++;
    console.log(`  FALSE+  a clean document produced ${clean.length} problem(s) — a noisy gate gets ignored:`);
    clean.forEach(p => console.log(`           ${p.check}: ${p.msg}`));
  } else {
    console.log('  QUIET   a clean document produces no problems (no false positives)');
  }
  // total behaviours = one per mutation, plus the no-false-positives behaviour.
  const total = cases.length + exemption.length + 1;
  console.log(`\n==== self-test: ${total - bad}/${total} behaviours proven ====`);
  if (bad) console.log('     A rule that cannot be made to fail is not protecting anything. Fix it before trusting a clean run.');
  return bad;
}

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

  const quiet = args.includes('--quiet');
  // PRECONDITION: comparing a doc claim against an uncommitted edit proves nothing.
  let dirty = '';
  try { dirty = git(['status', '--short']); } catch (e) {}
  if (dirty && !quiet) {
    console.log('note: working tree is not clean — doc claims are being compared against uncommitted edits\n');
  }

  const corpus = loadCorpus();
  const facts = gatherFacts(corpus);
  const problems = runAll(corpus, facts).concat(checkInvariants());

  if (!quiet) console.log(`documentation guard — ${corpus.length} tracked markdown files, ${CORPUS_CHECKS.length + 1} checks\n`);

  const byCheck = {};
  problems.forEach(p => (byCheck[p.check] = byCheck[p.check] || []).push(p));
  for (const [check, list] of Object.entries(byCheck)) {
    console.log(`-- ${check} (${list.length})`);
    list.forEach(p => console.log(`  - ${p.file}${p.line ? ':' + p.line : ''} — ${p.msg}`));
    console.log('');
  }

  const real = problems.filter(p => !p.knownOpen);
  const obligations = problems.filter(p => p.knownOpen);
  if (obligations.length) {
    console.log('NOTE: the open-obligations above are REAL WORK not yet done, deliberately given a heartbeat so');
    console.log('      they cannot be quietly forgotten. They do not fail this gate — a permanently red gate');
    console.log('      trains everyone to ignore it, which is how the eight original failures went unnoticed.');
    console.log('');
  }
  if (!real.length) { console.log(`==== DOCS OK — 0 problems${obligations.length ? ', ' + obligations.length + ' open obligation(s) tracked' : ''} ====`); process.exit(0); }
  console.log(`==== ${real.length} problem(s) ====`);
  console.log('Each one is a document that would mislead the next session. Fix the DOCUMENT, not the check.');
  process.exit(1);
}

// NOT YET IMPLEMENTED, and honestly declared rather than half-built:
//  · resource-type assertion in delete instructions (needs `az`; would have caught the
//    bobstockfnval2607 storage-account near-miss — HIGHEST-VALUE remaining item)
//  · named durable entities exist or are marked NOT BUILT (needs `az` + broad grep; would have
//    caught store_eras being described across five specs while never existing)
//  · freshness stamps on cloud-facing instructions (needs a `verified against live YYYY-MM-DD`
//    convention that does not exist in the docs yet — adopt the convention first)
//  · a cited blocker is re-read at its source (hard to generalise without false positives)
//  · scope-vs-wave-review status contradiction, and supersession banners (medium value, fuzzy)
main();
