// BOB Stock — Azure Function: catalogue MERGE logic (Chunk 6 master-data publish + catalogue write).
// The SharePoint I/O + auth live in the wrapping Logic App (bob-stock-catalogue-write-staging), which holds
// the sharepointonline connection; this Function owns the pure logic (validation, ref-integrity, conflict
// detection, merge, version bump) because that is fragile/verbose in WDL. Mirrors validateMoney/validateKeys.
//
// Contract:
//   POST {current:{products,stores,categories,productTypes,master_data,corporate_costs}(raw JSON strings),
//         changes:[{coll,row,baseRv}], costChanges:[{productId,costPrice,baseRv}]}
//   -> 200 {newBlobs:{...same keys, raw JSON strings...}, accepted:[ids], rejected:[{id,coll,reason}],
//           conflicts:[{id,coll,reason}], failed:[], masterVersion, costVersion, changed:{blobName:bool}}
// authLevel 'function' (called only by the Logic App). No SharePoint access here.
//
// D-COST (privacy): costPrice is STRIPPED from every public product row server-side (never in master_data /
// the products blob); corporate cost travels ONLY via costChanges -> corporate_costs (a separately-gated blob).
// D-SOURCE (concurrency): per-row _rv conflict detection — a change carries baseRv; if the current row's _rv
// moved, it's a conflict (the caller re-fetches + retries). The Logic App also serializes (concurrency=1) +
// writes back under If-Match, so this Function only needs the logical conflict check.
// D-VERSION: master_data.version + corporate_costs.version are bumped here, server-owned; a client never mints.

const { app } = require('@azure/functions');

const COLLS = ['products', 'stores', 'categories', 'productTypes'];
// NB: do NOT use an object literal keyed by '__proto__' — `{__proto__:1}` sets the prototype, not an own
// property, so the guard would silently miss '__proto__'. Use an explicit predicate.
function isReservedKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }
const MONEY_MAX = 10000000;
const ID_RE = /^[A-Za-z0-9_-]+$/;

function parse(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw;
  try { const v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function badMoney(v, opts) {
  opts = opts || {};
  if (v == null || v === '') return !opts.optional;
  const n = Number(v);
  if (!Number.isFinite(n)) return true;
  if (opts.positive ? n <= 0 : n < 0) return true;
  if (n > MONEY_MAX) return true;
  if (Math.round(n * 100) !== Math.round(n * 1000) / 10) return true;
  return false;
}
function badId(v) { return typeof v !== 'string' || !ID_RE.test(v) || isReservedKey(v); }
function safeName(v) { return typeof v === 'string' && v.trim() !== '' && v.length <= 200; }

// per-collection field validation (returns reason string, '' = ok). `refs` = {catIds:Set, ptIds:Set} after batch.
function validateRow(coll, row, refs) {
  if (!row || typeof row !== 'object') return 'BAD_ROW';
  if (badId(row.id)) return 'BAD_ID';
  if (!safeName(row.name)) return 'BAD_NAME';
  if (coll === 'products') {
    if (row.price != null && badMoney(row.price, { optional: true })) return 'BAD_PRICE';
    if (row.stockType != null && !['retail', 'consumable'].includes(row.stockType)) return 'BAD_STOCKTYPE';
    if (row.catId != null && !refs.catIds.has(row.catId)) return 'DANGLING_CATID';
    if (row.franchiseDiscount != null && (badMoney(row.franchiseDiscount, { optional: true }) || Number(row.franchiseDiscount) > 100)) return 'BAD_FRANCHISE_DISCOUNT';
  } else if (coll === 'categories') {
    if (row.ptId != null && !refs.ptIds.has(row.ptId)) return 'DANGLING_PTID';
  } else if (coll === 'stores') {
    // Store types must match the UI options (index.html add-store modal): inline/kiosk/franchise/online/warehouse.
    if (row.type != null && !['inline', 'kiosk', 'franchise', 'online', 'warehouse'].includes(row.type)) return 'BAD_STORETYPE';
    if (row.franchiseDiscount != null && (badMoney(row.franchiseDiscount, { optional: true }) || Number(row.franchiseDiscount) > 100)) return 'BAD_FRANCHISE_DISCOUNT';
    if (row.isFranchise != null && typeof row.isFranchise !== 'boolean') return 'BAD_ISFRANCHISE';
  }
  if (row.active != null && typeof row.active !== 'boolean') return 'BAD_ACTIVE';
  return '';
}

// strip reserved + cost from a public row; keep everything else. Never let costPrice into the public blob.
function publicRow(row) {
  const out = {};
  for (const k of Object.keys(row)) {
    if (isReservedKey(k)) continue;
    if (k === 'costPrice') continue; // D-COST: never public
    out[k] = row[k];
  }
  out.id = row.id;
  return out;
}

function merge(current, changes, costChanges) {
  const blobs = {};
  for (const c of COLLS) blobs[c] = Array.isArray(parse(current[c], [])) ? parse(current[c], []) : [];
  const masterCur = parse(current.master_data, { version: 0 });
  const costCur = parse(current.corporate_costs, { version: 0, costs: [] });

  const byId = {};
  for (const c of COLLS) { byId[c] = new Map(); blobs[c].forEach(r => { if (r && typeof r.id === 'string') byId[c].set(r.id, r); }); }

  const accepted = [], rejected = [], conflicts = [], seen = new Set();
  const changedColls = new Set();

  // refs AFTER applying batch inserts (so a new cat + product in one batch is ok). Chunk 7 C2: ONLY ACTIVE
  // refs count — a product may not attach to a deactivated category, nor a category to a deactivated
  // product-type (DANGLING_CATID/DANGLING_PTID). Client blocks deactivating an in-use ref, so this only
  // catches direct-API bypass / races.
  const catIds = new Set(blobs.categories.filter(r => r && r.active !== false).map(r => r.id));
  const ptIds = new Set(blobs.productTypes.filter(r => r && r.active !== false).map(r => r.id));
  for (const ch of (changes || [])) { if (ch && ch.coll === 'categories' && ch.row && typeof ch.row.id === 'string' && ch.row.active !== false) catIds.add(ch.row.id); if (ch && ch.coll === 'productTypes' && ch.row && typeof ch.row.id === 'string' && ch.row.active !== false) ptIds.add(ch.row.id); }
  const refs = { catIds, ptIds };

  for (const ch of (changes || [])) {
    const coll = ch && ch.coll, row = ch && ch.row, baseRv = Number(ch && ch.baseRv) || 0;
    if (!COLLS.includes(coll)) { rejected.push({ id: row && row.id, coll, reason: 'BAD_COLL' }); continue; }
    const rsn = validateRow(coll, row, refs);
    if (rsn) { rejected.push({ id: row && row.id, coll, reason: rsn }); continue; }
    const key = coll + ':' + row.id;
    if (seen.has(key)) { rejected.push({ id: row.id, coll, reason: 'DUPLICATE_IN_REQUEST' }); continue; }
    seen.add(key);
    const existing = byId[coll].get(row.id);
    const curRv = existing ? (Number(existing._rv) || 0) : 0;
    if (existing && curRv !== baseRv) { conflicts.push({ id: row.id, coll, reason: 'STALE_ROW', currentRv: curRv, baseRv }); continue; }
    if (!existing && baseRv !== 0) { conflicts.push({ id: row.id, coll, reason: 'ROW_GONE', baseRv }); continue; }
    const clean = coll === 'products' ? publicRow(row) : (() => { const o = {}; for (const k of Object.keys(row)) if (!isReservedKey(k)) o[k] = row[k]; o.id = row.id; return o; })();
    clean._rv = curRv + 1;
    if (clean.active == null) clean.active = true;
    if (existing) { const i = blobs[coll].findIndex(r => r && r.id === row.id); blobs[coll][i] = clean; byId[coll].set(row.id, clean); }
    else { blobs[coll].push(clean); byId[coll].set(row.id, clean); }
    accepted.push(row.id);
    changedColls.add(coll);
  }

  // cost changes -> corporate_costs only (never public)
  const costs = Array.isArray(costCur.costs) ? costCur.costs.slice() : [];
  const costById = new Map(costs.map(c => [c && c.productId, c]));
  const prodIds = new Set(blobs.products.map(r => r && r.id));
  let costChanged = false;
  for (const cc of (costChanges || [])) {
    const pid = cc && cc.productId, baseRv = Number(cc && cc.baseRv) || 0;
    if (typeof pid !== 'string' || !prodIds.has(pid)) { rejected.push({ id: pid, coll: 'cost', reason: 'BAD_PRODUCT' }); continue; }
    if (badMoney(cc.costPrice, { optional: false })) { rejected.push({ id: pid, coll: 'cost', reason: 'BAD_COST' }); continue; }
    const ex = costById.get(pid);
    const curRv = ex ? (Number(ex._rv) || 0) : 0;
    if (ex && curRv !== baseRv) { conflicts.push({ id: pid, coll: 'cost', reason: 'STALE_ROW', currentRv: curRv, baseRv }); continue; }
    const row = { productId: pid, costPrice: Number(cc.costPrice), _rv: curRv + 1 };
    if (ex) { const i = costs.findIndex(c => c && c.productId === pid); costs[i] = row; } else costs.push(row);
    costById.set(pid, row);
    accepted.push('cost:' + pid);
    costChanged = true;
  }

  // recompose master_data (public: NO cost) + bump versions server-side
  const anyPublicChange = changedColls.size > 0;
  const masterVersion = anyPublicChange ? (Number(masterCur.version) || 0) + 1 : (Number(masterCur.version) || 0);
  const costVersion = costChanged ? (Number(costCur.version) || 0) + 1 : (Number(costCur.version) || 0);
  const newMaster = {
    version: masterVersion,
    products: blobs.products.map(publicRow),
    stores: blobs.stores,
    categories: blobs.categories,
    productTypes: blobs.productTypes,
  };
  const newCost = { version: costVersion, costs };

  const changed = {
    products: changedColls.has('products'), stores: changedColls.has('stores'),
    categories: changedColls.has('categories'), productTypes: changedColls.has('productTypes'),
    master_data: anyPublicChange, corporate_costs: costChanged,
  };
  const newBlobs = {
    products: JSON.stringify(blobs.products), stores: JSON.stringify(blobs.stores),
    categories: JSON.stringify(blobs.categories), productTypes: JSON.stringify(blobs.productTypes),
    master_data: JSON.stringify(newMaster), corporate_costs: JSON.stringify(newCost),
  };
  // Ready-to-send SharePoint MERGE body per blob (ConfigData value JSON-escaped) — the Logic App can't
  // safely quote a JSON string inside WDL string-concat, so we hand it a finished body string.
  const newBlobsBody = {};
  for (const k of Object.keys(newBlobs)) newBlobsBody[k] = JSON.stringify({ ConfigData: newBlobs[k] });
  return { newBlobs, newBlobsBody, accepted, rejected, conflicts, failed: [], masterVersion, costVersion, changed };
}

app.http('catalogueMerge', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request) => {
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'bad json' } }; }
    const current = body.current || {};
    // WDL passes the raw AppConfig rows (it can't map them inline); build the current map here.
    if (Array.isArray(body.currentRows)) {
      for (const r of body.currentRows) { if (r && typeof r.ConfigType === 'string') current[r.ConfigType] = r.ConfigData; }
    }
    return { jsonBody: merge(current, body.changes, body.costChanges) };
  }
});

module.exports = { merge, validateRow, publicRow, badMoney, badId };
