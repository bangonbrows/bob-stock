// check-seed-integrity.js — every store id the seed REFERENCES must be a store the seed DEFINES.
//
// WHY THIS EXISTS. Ardross and Bunbury (both closed) were deleted from the app on 2026-08-02.
// Ardross alone was referenced in ~41 places across index.html — the store row, stock thresholds,
// dozens of practice movements, and the store lists on staff logins. Delete the store row and miss
// one of the others and the app STILL BOOTS: the seed is a plain object literal in a file with no
// build step, so an inconsistent seed parses perfectly and simply behaves oddly. Orphaned rows are
// invisible in the interface (every dropdown is built from the store list) while still sitting in
// the quantity cache, and the app's own health check starts reporting "orphaned store (deleted)".
//
// Nothing checked this before. "I think I got them all" was the only available evidence, which on
// this project is not evidence at all.
//
//   node test/check-seed-integrity.js             run it
//   node test/check-seed-integrity.js --self-test prove it FAILS on a deliberately broken seed
//
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..');
const SELFTEST = process.argv.includes('--self-test');

// Pull the `stores: [ ... ]` array out of the seed by brace/bracket balance, then read its ids.
function extractStoreIds(html) {
  const at = html.search(/\bstores:\s*\[/);
  if (at === -1) return null;
  const open = html.indexOf('[', at);
  let depth = 0, end = -1;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const block = html.slice(open, end + 1);
  const ids = [];
  const re = /\bid\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block)) !== null) ids.push(m[1]);
  return { ids, block, from: open, to: end };
}

// Every shape in the seed that names a store. Each is a real pattern in this file, not a guess.
function extractReferences(html, storesBlockRange) {
  const refs = [];
  const inStoresBlock = i => storesBlockRange && i >= storesBlockRange.from && i <= storesBlockRange.to;
  const push = (id, kind, idx) => { if (!inStoresBlock(idx)) refs.push({ id, kind }); };

  // 1. thresholds and any other object literal carrying storeId:'x'
  let m, re = /\bstoreId\s*:\s*'([^']+)'/g;
  while ((m = re.exec(html)) !== null) push(m[1], "storeId:'…'", m.index);

  // 2. the `...['a','b',…].map(s=>({storeId:s,…}))` threshold builders
  re = /\.\.\.\[((?:\s*'[^']+'\s*,?)+)\]\s*\.map\s*\(\s*s\s*=>\s*\(\s*\{\s*storeId\s*:\s*s\b/g;
  while ((m = re.exec(html)) !== null) {
    for (const q of m[1].match(/'([^']+)'/g) || []) push(q.slice(1, -1), 'threshold list', m.index);
  }

  // 3. practice movements: tx('date','storeId',…)
  re = /\btx\(\s*'[^']*'\s*,\s*'([^']+)'/g;
  while ((m = re.exec(html)) !== null) push(m[1], "tx('…','store',…)", m.index);

  // 4. the `others` array driving the lighter practice stores
  re = /\bconst\s+others\s*=\s*\[([^\]]+)\]/g;
  while ((m = re.exec(html)) !== null) {
    for (const q of m[1].match(/\bid\s*:\s*'([^']+)'/g) || []) push(q.replace(/.*'([^']+)'.*/, '$1'), 'others[] list', m.index);
  }

  // 5. which stores a login can see
  re = /\bstoreIds\s*:\s*\[([^\]]*)\]/g;
  while ((m = re.exec(html)) !== null) {
    for (const q of m[1].match(/'([^']+)'/g) || []) push(q.slice(1, -1), 'user storeIds', m.index);
  }
  return refs;
}

function analyse(html, retired) {
  const stores = extractStoreIds(html);
  if (!stores) return { fatal: 'could not locate the stores array in the seed' };
  const defined = new Set(stores.ids);
  const refs = extractReferences(html, stores);
  const orphans = new Map(), retiredHits = new Map();
  for (const r of refs) {
    if (!defined.has(r.id)) {
      const k = r.id + ' (' + r.kind + ')';
      orphans.set(k, (orphans.get(k) || 0) + 1);
    }
    if (retired.has(r.id)) retiredHits.set(r.id, (retiredHits.get(r.id) || 0) + 1);
  }
  const definedRetired = stores.ids.filter(id => retired.has(id));
  return { defined: stores.ids, refs, orphans, retiredHits, definedRetired };
}

// Stores deliberately removed from the business. Referencing one is a FAILURE even if, by accident,
// it is still defined — otherwise a half-finished delete reads as clean.
const RETIRED = new Map([
  ['ardross', 'closed; deleted 2026-08-02 (Kunal)'],
  ['bunbury', 'closed; deleted 2026-08-02 (Kunal)'],
]);

// ── self-test ─────────────────────────────────────────────────────────────────────────────
if (SELFTEST) {
  const good = `stores: [
    { id:'karrinyup', name:'Karrinyup' },
    { id:'head_office', name:'HO' }
  ],
  thresholds: [ {storeId:'karrinyup',productId:'P1'} ],
  users: [ {storeIds:['karrinyup']} ]
  tx('2026-01-01','karrinyup','P1','in',1,'x','y');`;
  const orphanSeed = good.replace("{storeId:'karrinyup',productId:'P1'}", "{storeId:'ghoststore',productId:'P1'}");
  const retiredSeed = good.replace("'karrinyup','P1','in'", "'ardross','P1','in'");
  const listSeed = `stores: [ { id:'karrinyup', name:'K' } ],
    ...['karrinyup','ardross'].map(s=>({storeId:s,productId:'P1',minQty:2}))`;
  const userSeed = `stores: [ { id:'karrinyup', name:'K' } ], users:[{storeIds:['karrinyup','ghost']}]`;
  const othersSeed = `stores: [ { id:'karrinyup', name:'K' } ]
    const others = [{id:'karrinyup',staff:'A'},{id:'bunbury',staff:'B'}];`;

  const cases = [
    ['a clean seed passes', () => { const r = analyse(good, RETIRED); return r.orphans.size === 0 && r.retiredHits.size === 0; }],
    ['an ORPHAN storeId is caught', () => analyse(orphanSeed, RETIRED).orphans.size === 1],
    ['a RETIRED store referenced in a movement is caught', () => analyse(retiredSeed, RETIRED).retiredHits.has('ardross')],
    ['a retired store hidden in a threshold LIST is caught', () => analyse(listSeed, RETIRED).retiredHits.has('ardross')],
    ['an orphan in a login\'s store list is caught', () => analyse(userSeed, RETIRED).orphans.size === 1],
    ['a retired store in the others[] list is caught', () => analyse(othersSeed, RETIRED).retiredHits.has('bunbury')],
    ['store ids INSIDE the stores array are not counted as references',
      () => { const r = analyse(good, RETIRED); return !r.refs.some(x => x.kind === "storeId:'…'" && x.id === 'head_office'); }],
    ['a still-DEFINED retired store is reported', () => analyse(`stores: [ { id:'ardross', name:'A' } ]`, RETIRED).definedRetired.includes('ardross')],
  ];
  let bad = 0;
  console.log('\n=== check-seed-integrity --self-test ===');
  console.log('Each case proves a check FIRES on a deliberately broken seed (or stays quiet on a clean one).\n');
  for (const [name, fn] of cases) {
    let ok = false; try { ok = !!fn(); } catch (e) { ok = false; }
    if (!ok) bad++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
  }
  console.log(`\n${bad === 0 ? 'SELF-TEST PASS — every check demonstrably bites' : 'SELF-TEST FAIL (' + bad + ') — do NOT trust a green run'}`);
  process.exit(bad === 0 ? 0 : 1);
}

// ── the real run ──────────────────────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const r = analyse(html, RETIRED);
const problems = [];

console.log('\n=== check-seed-integrity ===');
console.log('Does every store the seed mentions actually exist?\n');

if (r.fatal) { console.log(`  [FAIL] ${r.fatal}`); process.exit(1); }

console.log(`  [info] ${r.defined.length} stores defined: ${r.defined.join(', ')}`);
console.log(`  [info] ${r.refs.length} store references checked across thresholds, movements and logins`);

for (const [k, n] of r.orphans) problems.push(`ORPHAN — "${k}" is referenced ${n}× but no such store is defined`);
for (const [id, n] of r.retiredHits) problems.push(`RETIRED STORE STILL REFERENCED — "${id}" appears ${n}× (${RETIRED.get(id)})`);
for (const id of r.definedRetired) problems.push(`RETIRED STORE STILL DEFINED — "${id}" is still in the stores array (${RETIRED.get(id)})`);

// A file that is served publicly and carries its own stale store directory.
const dataFile = path.join(REPO, 'data', 'bob-stock-data.json');
if (fs.existsSync(dataFile)) {
  const raw = fs.readFileSync(dataFile, 'utf8');
  const hits = [...RETIRED.keys()].filter(id => raw.includes(`"${id}"`));
  if (hits.length) problems.push(`data/bob-stock-data.json still contains retired store(s): ${hits.join(', ')} — this file is orphaned (nothing loads it); delete it`);
}

if (problems.length) { console.log(''); for (const p of problems) console.log(`  [FAIL] ${p}`); }
console.log(`\n==== ${problems.length === 0 ? 'SEED OK — every referenced store exists, no retired store remains' : problems.length + ' PROBLEM(S) — the delete is not finished'} ====`);
process.exit(problems.length === 0 ? 0 : 1);
