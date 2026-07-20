#!/usr/bin/env node
/*
 * anchor-scan.js — verifies every saboteur mutation ANCHOR still matches its source file.
 *
 * A mutation whose `find` string no longer exists is a silently-unproven sentinel: the runner reports
 * SKIP-NOFIND only when that mutation actually runs, so an anchor broken by an unrelated edit can hide
 * until the next full sweep. This scan evaluates the runner's OWN MUTATIONS table (never a re-derived
 * regex extraction — the W4.2 lesson: the old regex extractor missed entries) and asserts each anchor
 * (find OR altFind, as-authored or CRLF-normalized — the same resolution logic the runner uses) matches
 * its file. Run after ANY edit to a mutated file: node test/anchor-scan.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(__dirname, 'saboteur-runner.js'), 'utf8');
const start = src.indexOf('const MUTATIONS = [');
const end = src.indexOf('\n];', start);
if (start === -1 || end === -1) { console.error('ANCHOR-SCAN ERROR: MUTATIONS table not found'); process.exit(2); }
// eslint-disable-next-line no-eval
const MUTATIONS = eval(src.slice(start + 'const MUTATIONS = '.length, end + 3));

const cache = new Map();
const read = (f) => { if (!cache.has(f)) cache.set(f, fs.readFileSync(path.join(REPO, f), 'utf8')); return cache.get(f); };

let ok = 0, bad = 0;
for (const m of MUTATIONS) {
  let body;
  try { body = read(m.file); } catch (e) { bad++; console.log(`  [NO-FILE] ${m.id} :: ${m.file}`); continue; }
  const hit = [m.find, m.altFind].filter(Boolean).some(cand => {
    if (body.indexOf(cand) !== -1) return true;
    const crlf = cand.replace(/\r?\n/g, '\r\n');
    return crlf !== cand && body.indexOf(crlf) !== -1;
  });
  if (hit) ok++;
  else { bad++; console.log(`  [BROKEN-ANCHOR] ${m.id} :: ${m.file} — the find string no longer matches (re-anchor before the next sweep)`); }
}
console.log(`\n==== anchor-scan: ${ok}/${MUTATIONS.length} anchors intact${bad ? ` — ${bad} BROKEN` : ''} ====`);
process.exit(bad === 0 ? 0 : 1);
