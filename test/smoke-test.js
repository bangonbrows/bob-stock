// BOB Stock App — saboteur sentinel suite (version-controlled WITH the app).
//
// 11 sentinels. Each MUST pass on clean code AND flip red when its matching
// saboteur mutation is applied (see ../SABOTEUR notes + test/saboteur-runner.js).
// A sentinel that asserts a re-derived copy of the logic proves nothing — every
// sentinel here drives the LIVE shipped code path.
//
//   node test/smoke-test.js            # runs against the repo this file lives in
//   node test/smoke-test.js <repoDir>  # runs against another copy (used by the mutation runner)
//
// Exports runSmoke(repoDir) -> [{id,name,cleanPass,detail}] for the mutation runner.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DEFAULT_REPO = path.resolve(__dirname, '..');
// AA-12: the server resolver, required so S-247 can assert client/server parity in-gate (closes the
// "mirrored verbatim" claim that had no test). Loaded against DEFAULT_REPO's module — mutation runs copy
// accessPolicy.js into the temp repo, so a one-sided edit to EITHER resolver diverges and flips S-247.
let AP_PARITY = null; try { AP_PARITY = require(path.join(DEFAULT_REPO, 'azure-functions', 'src', 'functions', 'accessPolicy.js')); } catch (e) {}
// OS-W4.2 (S-W4-1): the REAL topology.js primitives, so S-261 asserts client-lens/server parity in-gate
// (the same drift-closure mechanism as AP_PARITY/S-247 — a one-sided edit to either side diverges).
let TOPO = null; try { TOPO = require(path.join(DEFAULT_REPO, 'azure-functions', 'src', 'functions', 'topology.js')); } catch (e) {}

async function newPage(b) { const ctx = await b.newContext({ timezoneId: 'Australia/Perth' }); const page = await ctx.newPage(); return { ctx, page }; }
async function waitBoot(page, repo) {
  const url = 'file:///' + repo.replace(/\\/g, '/') + '/index.html';
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof DB !== 'undefined' && typeof Sync !== 'undefined' && typeof window.TransferUI !== 'undefined', { timeout: 20000 });
  await page.waitForTimeout(1200);
}
// F1-H04 (GPT FINAL H-04): setup must NEVER mutate app data. The old fallback
// (`prod.active = true`) silently repaired a broken clean boot, so 36/36 could
// pass while a fresh install showed an empty catalogue (C-01). If the invariant
// fails, throw loudly — S-37 is the dedicated clean-boot sentinel.
async function setup(page) { return page.evaluate(() => { const d = DB.get(); const u = (d.users || []).find(x => x.role === 'director') || d.users[0]; if (u) Auth._user = u; const store = d.stores.find(s => s.active && s.type !== 'warehouse'); const prod = d.products.find(p => p.active); if (!store || !prod) throw new Error('SETUP-INVARIANT VIOLATED: clean boot has no active store/product (C-01 regression) — setup no longer mutates state to hide this'); return { storeId: store.id, productId: prod.id }; }); }

async function runSmoke(repo) {
  repo = repo || DEFAULT_REPO;
  const out = [];
  const rec = (id, name, cleanPass, detail) => { out.push({ id, name, cleanPass, detail }); console.log(`  [${cleanPass ? 'CLEAN-PASS' : 'CLEAN-FAIL!'}] ${id} ${name} :: ${detail}`); };
  const b = await chromium.launch({ headless: true });
  try {
    // S-37 (F1-C01): CLEAN BOOT invariant — fresh install exposes the full seeded catalogue
    // with NO setup() mutation. Guards the active-flag primitive (db.js _defaultActiveTrue).
    // RUNS FIRST, before any setup()-dependent sentinel: setup() deliberately THROWS on a
    // broken clean boot (H-04), which aborts the rest of the suite — S-37 must have already
    // printed its verdict by then or the saboteur runner reads the silence as BLIND.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const d = DB.get(); return { total: d.products.length, active: d.products.filter(p => p.active).length, activeStores: d.stores.filter(s => s.active).length }; });
      rec('S-37', 'clean boot: seeded catalogue fully active without test mutation', r.total > 0 && r.active === r.total && r.activeStores > 0, `products=${r.total} active=${r.active} stores=${r.activeStores} (clean: active===total)`); await ctx.close(); }

    try {  // suite-abort isolation: a setup() invariant throw (broken clean boot) must not silently swallow the sentinels that already ran
    // S-01: durable write returns FALSE when the Dexie put fails
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { bobDB.transactions.put = () => Promise.reject(new Error('forced')); const txn = { id: 'c01_' + Date.now(), type: 'in', qty: 5, storeId: s.storeId, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString() }; const result = await DB.addTransactionDurable(txn); return { result }; }, s);
      rec('S-01', 'durable returns false on failed put', r.result === false, `durable=${r.result} (clean must be false)`); await ctx.close(); }

    // S-02: ambiguous ack leaves _synced false
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok' } : { items: [], serverTimestamp: 0 }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const id = 'c02_' + Date.now(); const txn = { id, type: 'in', qty: 3, storeId: s.storeId, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); await Sync.push(); await new Promise(r => setTimeout(r, 400)); await DB.refresh(); const t = DB.get().transactions.find(x => x.id === id); return { synced: t ? !!t._synced : 'GONE' }; }, s);
      rec('S-02', '_synced stays false on ambiguous ack', r.synced === false, `_synced=${r.synced} (clean must be false)`); await ctx.close(); }

    // S-03: NO email when the durable write fails
    { const { ctx, page } = await newPage(b); let emailCalls = 0; await page.exposeFunction('__email', () => { emailCalls++; }); await page.route('**logic.azure.com**', async r => { try { await page.evaluate(() => window.__email()); } catch (e) {} return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }); await waitBoot(page, repo); const s = await setup(page);
      await page.evaluate(async (s) => { Sync._emailUrl = 'https://x.logic.azure.com/email'; UI.confirm = (a, b, c) => { const cb = (typeof b === 'function') ? b : (typeof c === 'function' ? c : null); if (cb) return cb(); }; const d = DB.get(); const toStore = d.stores.find(x => x.id !== s.storeId && x.type !== 'warehouse') || d.stores.find(x => x.id !== s.storeId); const trId = 'c03_' + Date.now(); const tr = { id: trId, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: s.storeId, toStoreId: toStore.id, createdBy: Auth.user(), createdByName: 't', status: 'draft', items: [{ productId: s.productId, sentQty: 2, receivedQty: null, status: 'confirmed', flagNote: '' }], receivedBy: null, notes: '' }; d.transfers = d.transfers || []; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); d.transactions.push({ id: 'c03in', storeId: s.storeId, productId: s.productId, type: 'in', qty: 5, date: '2026-06-01', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); /* Wave L1: origin needs >=2 on hand or the new submitDraft over-send guard rejects before the notify/write path this sentinel tests (would mask the S-03 mutation -> BLIND) */ bobDB.transaction = () => Promise.reject(new Error('forced')); try { await Transfer.submitDraft(trId, { [s.productId]: 2 }); } catch (e) {} await new Promise(r => setTimeout(r, 500)); }, s);
      await page.waitForTimeout(200); rec('S-03', 'no email on failed write', emailCalls === 0, `emailCalls=${emailCalls} (clean must be 0)`); await ctx.close(); }

    // S-04 (BEHAVIOURAL): drive the real Sync.pull() carrying ONE new row + a LOWER frozen maxId (1000)
    // while the ID cursor is at 5000. The row forces the merge path (past the empty-page early return)
    // so the live Math.max ID-cursor clamp actually executes; it must NOT rewind the cursor to 1000.
    // A behaviour-equivalent rewrite of the clamp still flips this red (round-6 SA-F-F1-R7).
    { let SID = '', PID = ''; const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', processedCount: 0 } : { items: [{ ID: 4000, TransactionId: 'sp_s04_1', Type: 'in', Qty: 1, StoreId: SID, ProductId: PID, Date: '2026-06-04', DeviceId: 'PROBE_OTHER_DEVICE', SyncTimestamp: 900 }], maxId: '1000', count: 1, status: 'ok' }) }); });
      await waitBoot(page, repo); const s = await setup(page); SID = s.storeId; PID = s.productId;
      const r = await page.evaluate(async () => { Sync._pullUrl = 'https://x.logic.azure.com/pull'; Sync._syncLock = false; Sync._lastSyncId = 5000; const before = Sync._lastSyncId; try { await Sync.pull(); } catch (e) {} await new Promise(r => setTimeout(r, 300)); return { before, after: Sync._lastSyncId, merged: DB.get().transactions.some(t => t.id === 'sp_s04_1') }; });
      rec('S-04', 'live pull ID-cursor clamp prevents cursor rewind', r.merged && r.after >= r.before, `${r.before}->${r.after} merged=${r.merged} (clean: merged + no rewind to 1000)`); await ctx.close(); }

    // S-05: UI.esc neutralises an injected onerror (live UI.esc)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(() => { window.__xss = undefined; const safe = UI.esc('<img src=x onerror="window.__xss=1">'); const div = document.createElement('div'); div.innerHTML = `<span>${safe}</span>`; document.body.appendChild(div); return { xss: window.__xss, escaped: safe.indexOf('<img') === -1 }; }, s);
      rec('S-05', 'UI.esc neutralises injection', r.xss === undefined && r.escaped, `__xss=${r.xss}; escaped=${r.escaped} (clean: undefined+true)`); await ctx.close(); }

    // S-06 (LIVE): run the real Pages._exportStockCSV(), capture the Blob, assert the live
    // _csvCell formula guard prefixed the dangerous cell. Saboteur (guard removed) -> red.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const real = URL.createObjectURL.bind(URL); let blob = null; URL.createObjectURL = (b) => { blob = b; return 'blob:stub'; }; const d = DB.get(); const p = d.products.find(x => x.id === s.productId) || d.products[0]; p.name = '=SUM(99)'; p.active = true; let store = d.stores.find(x => x.active); if (!store) { store = d.stores.find(x => x.type !== 'warehouse'); store.active = true; } try { Pages._exportStockCSV(); } catch (e) {} URL.createObjectURL = real; const csv = blob ? await blob.text() : ''; return { guarded: csv.includes("'=SUM(99)"), sample: (csv.match(/.?=SUM\(99\)/) || [csv.slice(0, 60)])[0] }; }, s);
      rec('S-06', 'live CSV export guards formula cell', r.guarded, `cell=${r.sample} (clean must start with apostrophe)`); await ctx.close(); }

    // S-07: follower does NOT push on a sync-push message
    { const { ctx, page } = await newPage(b); let pushCount = 0; await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; if (body.includes('"transactions"')) pushCount++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', processedCount: 1 }) }); }); await waitBoot(page, repo); const s = await setup(page);
      await page.evaluate(async (s) => { Sync._isLeader = false; Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._syncLock = false; const txn = { id: 'c07_' + Date.now(), type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); /* drive the LIVE service-worker message listener (the real SW leader gate at index.html:4581), not a window event no listener consumes */ if (navigator.serviceWorker) navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'sync-push' } })); Sync.DEBOUNCE_MS = 10; Sync.scheduleSync(); await new Promise(r => setTimeout(r, 600)); }, s);
      rec('S-07', 'follower ignores SW sync-push (leader gate)', pushCount === 0, `followerPushCount=${pushCount} (clean must be 0)`); await ctx.close(); }

    // S-08: move_out remove returns qty to base
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const base = Stock.qty(s.productId, s.storeId); const txn = { id: 'c08_' + Date.now(), type: 'move_out', qty: 4, storeId: s.storeId, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString() }; DB.addTransaction(txn); DB.removeTransaction(txn.id); await new Promise(r => setTimeout(r, 100)); return { base, after: Stock.qty(s.productId, s.storeId) }; }, s);
      rec('S-08', 'move_out reversal returns to base', r.after === r.base, `base=${r.base} after=${r.after} (clean: equal)`); await ctx.close(); }

    // S-09: duplicate add deduped to 1
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const txn = { id: 'c09_dup', type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString() }; DB.addTransaction(txn); DB.addTransaction(txn); return { count: DB.get().transactions.filter(t => t.id === 'c09_dup').length }; }, s);
      rec('S-09', 'duplicate id deduped', r.count === 1, `count=${r.count} (clean must be 1)`); await ctx.close(); }

    // S-10: cross-store receive rejected
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { UI.confirm = (a, b, c) => { const cb = (typeof b === 'function') ? b : (typeof c === 'function' ? c : null); if (cb) return cb(); }; const d = DB.get(); const stores = d.stores.filter(x => x.type !== 'warehouse'); const storeA = stores[0], storeB = stores[1] || stores[0]; const staff = (d.users || []).find(u => u.role === 'staff') || { id: 'u_staff', role: 'staff', name: 'S', username: 's' }; const trId = 'c10_' + Date.now(); const tr = { id: trId, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: 'head_office', toStoreId: storeB.id, status: 'in_transit', createdBy: d.users[0], createdByName: 'x', items: [{ productId: s.productId, sentQty: 2, receivedQty: null, status: 'pending' }], receivedBy: null }; d.transfers = d.transfers || []; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); Auth._user = staff; Auth.storeIds = () => [storeA.id]; Auth.isHO = () => false; Auth.is = () => false; Auth.isAtLeast = (r) => (r === 'staff'); try { window.TransferUI.toggleMatch(trId, s.productId); } catch (e) {} try { window.TransferUI.submitReceive(trId); } catch (e) {} await new Promise(r => setTimeout(r, 400)); const after = DB.get().transfers.find(x => x.id === trId); const recvTxn = DB.get().transactions.some(t => t.transferId === trId && t.type === 'transfer_in'); return { statusAfter: after ? after.status : 'GONE', recvTxn }; }, s);
      rec('S-10', 'cross-store receive rejected', r.statusAfter === 'in_transit' && r.recvTxn === false, `status=${r.statusAfter}; txn=${r.recvTxn} (clean: in_transit + no txn)`); await ctx.close(); }

    // S-11: quota throw -> durable returns false + rollback
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { bobDB.transactions.put = () => Promise.reject(new DOMException('quota', 'QuotaExceededError')); const txn = { id: 'c11_' + Date.now(), type: 'in', qty: 9, storeId: s.storeId, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString() }; const result = await DB.addTransactionDurable(txn); await new Promise(r => setTimeout(r, 100)); const inCache = DB.get().transactions.some(t => t.id === txn.id); return { result, rolledBack: !inCache }; }, s);
      rec('S-11', 'quota -> false + rollback', r.result === false && r.rolledBack, `result=${r.result}; rolledBack=${r.rolledBack} (clean: false+true)`); await ctx.close(); }

    // S-12: bulk add dedupes duplicate ids WITHIN one batch (paginated pull double-count). Covers
    // the path single-add S-09 was blind to (round-5 DA-1/DA-2).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const base = Stock.qty(s.productId, s.storeId); const dup = { id: 'c12_dup', type: 'in', qty: 8, storeId: s.storeId, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString() }; DB.addTransactions([dup, { ...dup }]); await new Promise(r => setTimeout(r, 60)); return { count: DB.get().transactions.filter(t => t.id === 'c12_dup').length, delta: Stock.qty(s.productId, s.storeId) - base }; }, s);
      rec('S-12', 'bulk add dedupes within one batch', r.count === 1 && r.delta === 8, `count=${r.count} delta=${r.delta} (clean: 1 and 8 — not 2/16)`); await ctx.close(); }

    // S-13: UI.safeInt rejects >=16-digit (non-safe-integer) magnitudes + fractions/negatives (round-6 CONV-1)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => ({ huge: UI.safeInt('99999999999999999'), good: UI.safeInt('500'), frac: UI.safeInt('5.5'), neg: UI.safeInt('-3') }));
      rec('S-13', 'safeInt caps magnitude + strict int', !Number.isFinite(r.huge) && r.good === 500 && !Number.isFinite(r.frac) && !Number.isFinite(r.neg), `huge=${r.huge} good=${r.good} frac=${r.frac} neg=${r.neg} (clean: NaN/500/NaN/NaN)`); await ctx.close(); }

    // S-14: delivery display fields (invoiceNo/createdBy) are HTML-escaped in the detail modal (round-6 P2)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const u = (d.users || []).find(x => x.role === 'director') || d.users[0]; if (u) Auth._user = u; d.deliveries = d.deliveries || []; d.deliveries.push({ id: 'dx1', date: '2026-06-04', supplier: 'S', invoiceNo: '<svg onload="window.__dx=1">', createdBy: '<svg onload="window.__dx=1">', headerCosts: { freight: 0, tax: 0, customs: 0 }, lines: [] }); window.__dx = undefined; let html = ''; try { Pages._viewDeliveryDetail('dx1'); html = (document.getElementById('modal-body') || {}).innerHTML || ''; } catch (e) { return { err: e.message }; } return { fired: window.__dx, escaped: html.indexOf('<svg onload') === -1 }; }, s);
      rec('S-14', 'delivery display fields escaped', r.fired === undefined && r.escaped === true, `fired=${r.fired} escaped=${r.escaped} (clean: undefined+true)`); await ctx.close(); }

    // S-15: transaction actor (`by`) carries NO credential fields (GPT-EXT-001)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { const d = DB.get(); const u = (d.users||[]).find(x=>x.role==='director')||d.users[0]; u.passwordHash='PWH_M'; u.pinHash='PNH_M'; u.currentSession='SES_M'; Auth._user=u; UI.confirm=(m,cb)=>cb&&cb(); const stores=d.stores.filter(x=>x.type!=='warehouse'); const p=d.products[0]; d.transactions.push({id:'s15in',storeId:stores[0].id,productId:p.id,type:'in',qty:10,date:'2026-06-01',createdAt:new Date().toISOString()}); if(Stock._buildCache)Stock._buildCache(); /* Wave L1: origin needs stock or the new create over-send guard blocks the transfer -> no transfer_out row -> the actor-leak mutation can't manifest (BLIND) */ window._txState.createFrom=stores[0].id; window._txState.createTo=(stores[1]||stores[0]).id; window._txState.createType='normal'; window._txState.createItems={[p.id]:2}; window.TransferUI.submitCreate(); await new Promise(r=>setTimeout(r,400)); const tx=DB.get().transactions.filter(t=>t.type==='transfer_out').slice(-1)[0]; const str=JSON.stringify(tx||{}); return { clean: ['PWH_M','PNH_M','SES_M'].every(m=>str.indexOf(m)===-1), byKeys: tx&&tx.by?Object.keys(tx.by):[] }; });
      rec('S-15', 'txn actor carries no credentials', r.clean, `byKeys=${JSON.stringify(r.byKeys)} (clean: no hash/session)`); await ctx.close(); }

    // S-16: ref-data save (supplier) is durable-gated — no success before persist (GPT-EXT-002)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { const d=DB.get(); const u=(d.users||[]).find(x=>x.role==='director')||d.users[0]; if(u)Auth._user=u; const p=d.products[0]; ['sup-name-','sup-contact-','sup-lead-'].forEach((pre,i)=>{const el=document.createElement('input');el.id=pre+p.id;el.value=i===2?'5':'X';document.body.appendChild(el);}); p.supplierName='BEFORE'; await DB.commitDurable(); const beforeDexie=(await bobDB.products.get(p.id)).supplierName; let success=false; const realToast=UI.toast; UI.toast=(m,t)=>{ if(t==='success'&&/saved/i.test(String(m)))success=true; }; const realBulk=bobDB.products.bulkPut.bind(bobDB.products); bobDB.products.bulkPut=()=>Promise.reject(new Error('forced')); const fo=document.getElementById('fatal-save-overlay'); if(fo)fo.style.display='none'; await Pages._saveSupplier(p.id); await new Promise(r=>setTimeout(r,3800)); bobDB.products.bulkPut=realBulk; UI.toast=realToast; const afterDexie=(await bobDB.products.get(p.id)).supplierName; const fatal=(()=>{const x=document.getElementById('fatal-save-overlay');return !!(x&&x.style.display!=='none');})(); return { noFalseSuccess:!success, dexieUnchanged:beforeDexie===afterDexie, fatal }; });
      rec('S-16', 'ref-data save durable-gated', r.noFalseSuccess && r.dexieUnchanged && r.fatal, `noFalseSuccess=${r.noFalseSuccess} unchanged=${r.dexieUnchanged} fatal=${r.fatal}`); await ctx.close(); }

    // S-17: sanitisation runs on LOAD (import/migrate/restore bypass save-time sanitize) (GPT-EXT-003)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { const pid=DB.get().products[0].id; await bobDB.products.update(pid,{name:'<img src=x onerror="window.__s17=1">'}); window.__s17=undefined; await DB.refresh(); const nm=DB.get().products.find(p=>p.id===pid).name; return { sanitized: nm.indexOf('<')===-1, fired: window.__s17 }; });
      rec('S-17', 'sanitize on load blocks import XSS', r.sanitized && r.fired===undefined, `sanitized=${r.sanitized} fired=${r.fired}`); await ctx.close(); }

    // S-18: an APPROVED stock-take reconciles Stock.qty to the counted figure (M-4, I-87)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d=DB.get(); const u=(d.users||[]).find(x=>x.role==='director')||d.users[0]; Auth._user=u; const p=d.products.find(x=>x.id===s.productId)||d.products[0]; const stid=s.storeId; await DB.addTransactionDurable({id:'s18seed_'+Date.now(),type:'in',qty:10,storeId:stid,productId:p.id,date:'2026-06-01',createdAt:new Date().toISOString()}); const sys=Stock.qty(p.id,stid); Pages._stSelectedStoreId=stid; Pages._stData={[p.id]:String(sys-4)}; await Pages._submitStockTake(); const rs=document.getElementById('st-reason-'+p.id); if(rs)rs.value='Miscount'; await Pages._confirmStockTakePending(); const pend=DB.get().stockTakes.filter(t=>t.status==='pending').slice(-1)[0]; const qtyPending=Stock.qty(p.id,stid); await Pages._approveStockTake(pend.id); const qtyApproved=Stock.qty(p.id,stid); return { sys, qtyPending, qtyApproved, physical:sys-4 }; }, s);
      rec('S-18', 'approved stock-take reconciles stock', r.qtyPending===r.sys && r.qtyApproved===r.physical, `sys=${r.sys} pending=${r.qtyPending} approved=${r.qtyApproved} target=${r.physical}`); await ctx.close(); }

    // S-19: dates are Perth-local, not the UTC slice (M-1/I-86)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const RealDate=Date; const fixed=new RealDate('2026-06-05T01:00:00+08:00'); class FakeDate extends RealDate { constructor(...a){ if(a.length===0) super(fixed.getTime()); else super(...a); } static now(){ return fixed.getTime(); } } window.Date=FakeDate; let tl; try{ tl=UI.todayLocal(); } finally { window.Date=RealDate; } return { tl }; });
      rec('S-19', 'date is Perth-local not UTC slice', r.tl==='2026-06-05', `01:00 AWST -> ${r.tl} (clean: 2026-06-05, not UTC 2026-06-04)`); await ctx.close(); }

    // S-20: an empty pull still advances the ID cursor to the frozen maxId (Gemini-1/I-89 — sync stagnation)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body=r.request().postData()||''; const isPush=body.includes('"transactions"'); return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(isPush?{status:'ok'}:{items:[],maxId:'7777',count:0,status:'ok'}) }); }); await waitBoot(page, repo);
      const r = await page.evaluate(async () => { Sync._pullUrl='https://x.logic.azure.com/pull'; Sync._syncLock=false; Sync._lastSyncId=100; const before=Sync._lastSyncId; try{ await Sync.pull(); }catch(e){} await new Promise(r=>setTimeout(r,200)); return { before, after:Sync._lastSyncId }; });
      rec('S-20', 'empty pull advances ID cursor to frozen maxId', r.after>=7777, `${r.before}->${r.after} (clean: advances to 7777)`); await ctx.close(); }

    // S-21: deep actor-slim removes NESTED credential objects (SA-I-F1)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const pl={createdBy:{passwordHash:'ZPWHTOP'},flaggedItems:[{resolvedBy:{pinHash:'ZPNHNEST',id:1}}],items:[{by:{passwordHash:'ZPWHITEM'}}]}; Auth._slimActorsDeep(pl); const s=JSON.stringify(pl); return { clean:['ZPWHTOP','ZPNHNEST','ZPWHITEM'].every(m=>s.indexOf(m)===-1) }; });
      rec('S-21', 'deep actor-slim removes nested credentials', r.clean, `noMarkers=${r.clean} (clean: true)`); await ctx.close(); }

    // S-22: a manual Force Push claims leadership FIRST (so it is not an ungated push entry-door) (SA-C-R9-F1)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })); await waitBoot(page, repo);
      const r = await page.evaluate(async () => { Sync._isLeader = false; Sync._loadConfig = () => true; window.__s22push = false; Sync.push = () => { window.__s22push = true; return Promise.resolve(); }; try { await Pages._forcePush(); } catch (e) {} await new Promise(r => setTimeout(r, 50)); return { leader: Sync._isLeader, pushed: window.__s22push }; });
      rec('S-22', 'force-push claims leadership before pushing', r.leader === true && r.pushed === true, `leader=${r.leader} pushed=${r.pushed} (clean: true+true)`); await ctx.close(); }

    // S-23: privileged-write gate — a non-Director (staff) CANNOT record a delivery (Wave B / D-044, central Auth.can map)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const staff = (d.users||[]).find(u=>u.role==='staff') || { id:'s_t', role:'staff', name:'Staff', username:'staff', storeIds:[s.storeId] }; Auth._user = staff; const before = (DB.get().deliveries||[]).length; Pages._delLines = [{ productId:s.productId, qty:3, unitCost:10, weightGrams:0, packaging:0, labelling:0 }]; const mk=(id,val)=>{ let e=document.getElementById(id); if(!e){ e=document.createElement('input'); e.id=id; document.body.appendChild(e);} e.value=val; }; mk('del-supplier','TestCo'); mk('del-date','2026-06-07'); mk('del-invoice',''); mk('del-freight','0'); mk('del-tax','0'); mk('del-shipping','0'); try { await Pages._saveDelivery(); } catch(e) {} return { before, after:(DB.get().deliveries||[]).length }; }, s);
      rec('S-23', 'staff blocked from recording a delivery', r.after === r.before, `deliveries ${r.before}->${r.after} (clean: unchanged — gate blocks staff)`); await ctx.close(); }

    // S-24: cancel transfer is Director-only — a Franchisee owning BOTH stores is still blocked (Wave B / D-044, tightened from D-018)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const toStore = d.stores.find(x=>x.id!==s.storeId && x.type!=='warehouse') || d.stores.find(x=>x.id!==s.storeId); const trId = 's24_'+Date.now(); const tr = { id:trId, date:new Date().toISOString(), createdAt:new Date().toISOString(), fromStoreId:s.storeId, toStoreId:toStore.id, createdBy:Auth.actor(), createdByName:'t', status:'in_transit', items:[{productId:s.productId, sentQty:2, receivedQty:null, status:'in_transit', flagNote:''}], receivedBy:null, notes:'' }; d.transfers = d.transfers||[]; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); Auth._user = { id:'fr_t', role:'franchisee', name:'Fr', username:'fr', storeIds:[s.storeId, toStore.id] }; UI.confirm = (a,b,c)=>{ const cb=(typeof b==='function')?b:(typeof c==='function'?c:null); if(cb) return cb(); }; try { window.TransferUI.cancelTransfer(trId); } catch(e) {} await new Promise(r=>setTimeout(r,300)); const t2 = DB.get().transfers.find(x=>x.id===trId); return { status: t2 ? t2.status : 'GONE' }; }, s);
      rec('S-24', 'cancel transfer is Director-only', r.status === 'in_transit', `status=${r.status} (clean: in_transit — franchisee blocked)`); await ctx.close(); }

    // S-25: the central gate honours a valid 24h Stock-Take PIN unlock for a store computer (staff) (Wave B / D-044)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const staff = (d.users||[]).find(u=>u.role==='staff') || { id:'s_t', role:'staff', name:'Staff', username:'staff', storeIds:[s.storeId] }; Auth._user = staff; Auth._tempStockTake = null; const before = Auth.can('stockTakeCount'); d.stockTakePin = { pin: await sha256('1234'), expiresAt: new Date(Date.now()+24*60*60*1000).toISOString() }; const mk=(id)=>{ let e=document.getElementById(id); if(!e){ e=document.createElement(id==='st-pin-inp'?'input':'div'); e.id=id; document.body.appendChild(e);} return e; }; mk('st-pin-inp').value='1234'; mk('st-pin-err'); try { await Pages._verifyStockTakePin(); } catch(e) {} return { before, after: Auth.can('stockTakeCount') }; }, s);
      rec('S-25', 'valid 24h PIN unlocks stock-take for a store computer', r.before === false && r.after === true, `before=${r.before} after=${r.after} (clean: false then true)`); await ctx.close(); }

    // S-26: a non-Director opening a flagged transfer gets READ-ONLY, not the Director-only resolve screen — no dead UI (Wave B / D-044)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const toStore = d.stores.find(x=>x.id!==s.storeId && x.type!=='warehouse') || d.stores.find(x=>x.id!==s.storeId); const trId = 's26_'+Date.now(); const tr = { id:trId, date:new Date().toISOString(), createdAt:new Date().toISOString(), fromStoreId:s.storeId, toStoreId:toStore.id, createdBy:Auth.actor(), createdByName:'t', status:'flagged', items:[{productId:s.productId, sentQty:2, receivedQty:1, status:'flagged', flagNote:'short'}], receivedBy:null, notes:'' }; d.transfers = d.transfers||[]; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); window.__ro=false; window.TransferUI.showReadOnly = () => { window.__ro = true; }; Auth._user = { id:'s_t', role:'staff', name:'S', username:'s', storeIds:[toStore.id] }; try { window.TransferUI.openDetail(trId); } catch(e) {} return { ro: window.__ro }; }, s);
      rec('S-26', 'non-director sees read-only for a flagged transfer', r.ro === true, `readonly=${r.ro} (clean: true — not the resolve screen)`); await ctx.close(); }

    // S-27: backup export strips ALL reusable session/config material (live session token, SAS/URL, 24h stock-take grant) + adds integrity markers (Wave C / C1 / L36)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(async () => { const d = DB.get(); d.users[0].currentSession = 'SESSIONMARK_LIVE'; d.users[0].token = 'TOKENMARK'; d.stockTakePin = { pin: 'STPINHASHMARK', expiresAt: new Date(Date.now()+3600000).toISOString() }; d.sync_probe = { pushUrl: 'URLMARK_PUSH', sig: 'SIGMARK' }; const real = URL.createObjectURL.bind(URL); let blob = null; URL.createObjectURL = (x) => { blob = x; return 'blob:stub'; }; try { await Pages._exportBackup(); } catch (e) {} URL.createObjectURL = real; const txt = blob ? await blob.text() : ''; const markers = ['SESSIONMARK_LIVE','TOKENMARK','STPINHASHMARK','URLMARK_PUSH','SIGMARK']; return { clean: markers.every(m => txt.indexOf(m) === -1), hasMeta: txt.indexOf('"app": "bob-stock"') !== -1 }; });
      rec('S-27', 'backup strips reusable session/config material', r.clean && r.hasMeta, `noReusableAuth=${r.clean} hasIntegrityMeta=${r.hasMeta} (clean: true+true)`); await ctx.close(); }

    // S-28: backup import rejects wrong-app / future-version AND strips injected session material — import cannot restore an active login (Wave C / C1)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const base = () => ({ products:[{id:'p',name:'P'}], stores:[{id:'s',name:'S'}], transactions:[], users:[{id:'u',username:'x',role:'staff',currentSession:'INJECTMARK'}], categories:[] }); const wrongApp = Pages._validateAndScrubBackup({ _meta:{app:'evil-app'}, ...base() }); const future = Pages._validateAndScrubBackup({ _meta:{app:'bob-stock',backupFormat:9999}, ...base() }); const good = Pages._validateAndScrubBackup({ _meta:{app:'bob-stock',backupFormat:1}, ...base() }); const injectedStripped = good.ok && JSON.stringify(good.data).indexOf('INJECTMARK') === -1; return { wrongAppRejected: wrongApp.ok === false, futureRejected: future.ok === false, goodAccepted: good.ok === true, injectedStripped }; });
      rec('S-28', 'import rejects bad backups + strips injected session', r.wrongAppRejected && r.futureRejected && r.goodAccepted && r.injectedStripped, `wrongApp=${r.wrongAppRejected} future=${r.futureRejected} good=${r.goodAccepted} sessionStripped=${r.injectedStripped}`); await ctx.close(); }

    // S-29: the diagnostic log NEVER stores secrets/auth material — scrubbed to the locked allow/deny list (Wave C / C5 / L34). Uses SYNTHETIC fake secrets only.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { Diag.clear(); const hash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'; const uuid = '11112222-3333-4444-5555-666677778888'; const url = 'https://test.logic.azure.com/wf?sig=FAKE_SIG_CANARY'; Diag.log('canary', 'save failed hash ' + hash + ' session ' + uuid + ' endpoint ' + url); const stored = JSON.stringify(Diag._buf); const leaked = stored.indexOf(hash) !== -1 || stored.indexOf(uuid) !== -1 || stored.indexOf('FAKE_SIG_CANARY') !== -1 || stored.indexOf('logic.azure.com') !== -1; const safeFields = Diag._buf.length === 1 && !!Diag._buf[0].ts && Diag._buf[0].cat === 'canary'; Diag.clear(); return { leaked, safeFields }; });
      rec('S-29', 'diagnostic log scrubs all secrets/auth material', r.leaked === false && r.safeFields, `leaked=${r.leaked} safeFields=${r.safeFields} (clean: false+true)`); await ctx.close(); }

    // S-30: proto-pollution — a tampered txn with a __proto__ key is skipped (key guard) AND the stock cache stays null-proto (L35 / I-02)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); d.transactions.push({ id: 'pp_' + Date.now(), type: 'in', qty: 5, storeId: '__proto__', productId: s.productId, date: '2026-06-01', createdAt: new Date().toISOString() }); Stock._buildCache(); const protoEntry = Object.prototype.hasOwnProperty.call(Stock._qtyCache, '__proto__'); const nullProto = Object.getPrototypeOf(Stock._qtyCache) === null; return { protoEntry, nullProto }; }, s);
      rec('S-30', 'proto-pollution key skipped + null-proto cache', r.protoEntry === false && r.nullProto, `protoKeyEntry=${r.protoEntry} nullProto=${r.nullProto} (clean: false+true)`); await ctx.close(); }

    // S-31: hostile qty on LOAD — negative/huge/NaN/fractional quantities in a tampered row are rejected by _safeQty; only a valid safe-int applies (L35 / C6)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const stid = s.storeId, pid = s.productId; const base = Stock.qty(pid, stid); const mk = (q) => ({ id: 'hq_' + Math.random().toString(36).slice(2), type: 'in', qty: q, storeId: stid, productId: pid, date: '2026-06-01', createdAt: new Date().toISOString() }); d.transactions.push(mk(-5), mk(1e308), mk('abc'), mk(1.5), mk(10)); Stock._buildCache(); return { delta: Stock.qty(pid, stid) - base }; }, s);
      rec('S-31', 'hostile qty on load rejected (only valid safe-int applies)', r.delta === 10, `delta=${r.delta} (clean: 10 — neg/huge/NaN/fractional rejected)`); await ctx.close(); }

    // S-32: report CSV export buttons are live method calls, not stringified closures that die on click (Wave D / Gemini)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(() => { const mk = id => { let e = document.getElementById(id); if (!e) { e = document.createElement('div'); e.id = id; document.body.appendChild(e); } return e; }; mk('page-reorder'); mk('page-franchise-invoice'); try { Pages.reorderList(); } catch (e) {} try { Pages.franchiseInvoice(); } catch (e) {} const findExport = root => Array.from(document.querySelectorAll('#' + root + ' button')).find(b => /Export CSV/i.test(b.textContent)); const reBtn = findExport('page-reorder'), fiBtn = findExport('page-franchise-invoice'); const reOc = reBtn ? reBtn.getAttribute('onclick') : '', fiOc = fiBtn ? fiBtn.getAttribute('onclick') : ''; const real = URL.createObjectURL.bind(URL); let blobs = 0; URL.createObjectURL = () => { blobs++; return 'blob:x'; }; try { Pages._exportReorderCSV(); } catch (e) {} try { Pages._exportFICSV(); } catch (e) {} URL.createObjectURL = real; const wiringOk = /Pages\._exportReorderCSV/.test(reOc) && !/toString/.test(reOc) && /Pages\._exportFICSV/.test(fiOc) && !/toString/.test(fiOc); return { wiringOk, blobs }; });
      rec('S-32', 'report CSV export buttons are live method calls', r.wiringOk && r.blobs >= 1, `wiringOk=${r.wiringOk} csvBlobs=${r.blobs} (clean: true + >=1)`); await ctx.close(); }

    // S-33: reserved store/product IDs (__proto__/constructor/prototype) rejected at the backup-import boundary (Wave D / GPT-ABC-001)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const base = (pid, sid) => ({ _meta: { app: 'bob-stock', backupFormat: 1 }, products: [{ id: pid, name: 'P' }], stores: [{ id: sid, name: 'S' }], transactions: [], users: [], categories: [] }); const reservedRejected = Pages._validateAndScrubBackup(base('constructor', 's')).ok === false && Pages._validateAndScrubBackup(base('p', '__proto__')).ok === false; const normalAccepted = Pages._validateAndScrubBackup(base('p', 's')).ok === true; return { reservedRejected, normalAccepted }; });
      rec('S-33', 'reserved IDs rejected at backup import', r.reservedRejected && r.normalAccepted, `reservedRejected=${r.reservedRejected} normalAccepted=${r.normalAccepted}`); await ctx.close(); }

    // S-34: delivery rejects negative line costs (unit cost / packaging / labelling / weight), not just header costs (Wave D / GPT-ABC-002)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const before = (DB.get().deliveries || []).length; Pages._delLines = [{ productId: s.productId, qty: 2, unitCost: -10, weightGrams: 0, packaging: 0, labelling: 0 }]; const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('del-supplier', 'T'); mk('del-date', '2026-06-07'); mk('del-invoice', ''); mk('del-freight', '0'); mk('del-tax', '0'); mk('del-shipping', '0'); try { await Pages._saveDelivery(); } catch (e) {} return { before, after: (DB.get().deliveries || []).length }; }, s);
      rec('S-34', 'negative delivery line cost rejected', r.after === r.before, `deliveries ${r.before}->${r.after} (clean: unchanged)`); await ctx.close(); }

    // S-35: Phase-2 optimum GLOBAL save persists ('*'-keyed, not a null compound key) + rejects negative values (Wave D / GPT-ABC-003)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const pid = s.productId; let fatal = false; const realF = UI.fatalSaveError; UI.fatalSaveError = () => { fatal = true; }; window._txState.optScope = 'global'; window._txState.optStore = null; window._txState.optEdits = { [pid]: { min: 5, optimum: 10 } }; try { await window.TransferUI.saveOptimumLevels(); } catch (e) {} await DB.refresh(); const t = DB.get().thresholds.find(x => x.productId === pid && (x.storeId === '*' || x.storeId === null)); const persisted = !!t && t.minQty === 5 && t.optimumQty === 10; const beforeNeg = JSON.stringify(t || {}); window._txState.optEdits = { [pid]: { min: -2, optimum: 1 } }; try { await window.TransferUI.saveOptimumLevels(); } catch (e) {} await DB.refresh(); const t2 = DB.get().thresholds.find(x => x.productId === pid && (x.storeId === '*' || x.storeId === null)); UI.fatalSaveError = realF; const negRejected = JSON.stringify(t2 || {}) === beforeNeg; return { persisted, noFatal: fatal === false, negRejected }; }, s);
      rec('S-35', 'optimum global save persists + rejects negative', r.persisted && r.noFatal && r.negRejected, `persisted=${r.persisted} noFatal=${r.noFatal} negRejected=${r.negRejected}`); await ctx.close(); }

    // S-36: store-comparison 24-month boundaries use Perth-local dates (UI.dateLocal), not UTC toISOString slices (Wave D / GPT-ABC-004)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { let calls = 0; const real = UI.dateLocal.bind(UI); UI.dateLocal = (x) => { calls++; return real(x); }; const realMC = UI.makeChart; UI.makeChart = () => {}; const mk = id => { let e = document.getElementById(id); if (!e) { e = document.createElement('div'); e.id = id; document.body.appendChild(e); } }; mk('comp-table'); Pages._compStores = [{ id: s.storeId, name: 'S' }]; Pages._compIsDir = true; Pages._compToggle = 'out'; try { Pages._renderComparisonData(); } catch (e) {} await new Promise(res => setTimeout(res, 150)); UI.dateLocal = real; UI.makeChart = realMC; return { calls }; }, s);
      rec('S-36', 'store-comparison month boundaries are Perth-local', r.calls >= 40, `dateLocalCalls=${r.calls} (clean: ~48; buggy UTC-slice = ~0)`); await ctx.close(); }

    // S-38 (F1-C02): central money validator — 1e309 (Infinity) and negative cost entries
    // are rejected by the LIVE _saveCostEntry path; no cost-history row, no product mutation.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; const before = (DB.get().costHistory || []).length; mk('nc-date', '2026-06-10'); mk('nc-cost', '1e309'); mk('nc-notes', 'probe'); try { await Pages._saveCostEntry(s.productId); } catch (e) {} const mid = (DB.get().costHistory || []).length; mk('nc-cost', '-5'); try { await Pages._saveCostEntry(s.productId); } catch (e) {} const after = (DB.get().costHistory || []).length; const prod = DB.get().products.find(p => p.id === s.productId); return { before, mid, after, costSane: prod.costPrice == null || (Number.isFinite(prod.costPrice) && prod.costPrice >= 0) }; }, s);
      rec('S-38', 'non-finite/negative money rejected at live cost entry', r.mid === r.before && r.after === r.before && r.costSane, `costHistory ${r.before}->${r.mid}->${r.after} costSane=${r.costSane} (clean: unchanged+true)`); await ctx.close(); }

    // S-39 (F1-H01): backup import REJECTS (not coerces) negative qty + non-finite product money.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(() => { const mkB = qty => ({ _meta: { app: 'bob-stock', backupFormat: Pages._BACKUP_FORMAT }, products: [{ id: 'SB39', name: 'x' }], stores: [{ id: 'sb39', name: 'x' }], categories: [{ id: 'c39', name: 'x' }], users: [], transactions: [{ id: 't39', date: '2026-06-10', storeId: 'sb39', productId: 'SB39', type: 'in', qty }] }); const neg = Pages._validateAndScrubBackup(mkB(-7)); const pos = Pages._validateAndScrubBackup(mkB(7)); const infB = mkB(1); infB.products[0].price = Infinity; const inf = Pages._validateAndScrubBackup(infB); return { negRejected: !neg.ok, posAccepted: !!pos.ok, infRejected: !inf.ok }; });
      rec('S-39', 'backup import rejects negative qty + non-finite money', r.negRejected && r.posAccepted && r.infRejected, `negRejected=${r.negRejected} posAccepted=${r.posAccepted} infRejected=${r.infRejected} (clean: true+true+true)`); await ctx.close(); }

    // S-40 (F1-H02): delivery packaging edit is ALL-OR-NOTHING — one invalid line aborts
    // the whole save (no partial commit, no success toast).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); if (!d.deliveries) d.deliveries = []; if (!d.costHistory) d.costHistory = []; const del = { id: 'sb40', supplier: 'X', date: '2026-06-10', invoiceNo: '', headerCosts: { freight: 0, tax: 0, customs: 0 }, lines: [ { productId: s.productId, quantity: 2, unitCost: 5, packaging: 1, labelling: 0, landedCostPerUnit: 5.5, headerCostShare: 0, previousCost: null, costUpdated: false, appliedCost: null }, { productId: s.productId, quantity: 2, unitCost: 10, packaging: 0, labelling: 0, landedCostPerUnit: 10, headerCostShare: 0, previousCost: null, costUpdated: false, appliedCost: null } ], createdAt: new Date().toISOString(), createdBy: 't' }; d.deliveries.push(del); const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('epkg-0', '3.50'); mk('elab-0', ''); mk('epkg-1', '-2'); mk('elab-1', ''); const chBefore = d.costHistory.length; let successToast = false; const realToast = UI.toast.bind(UI); UI.toast = (m, t) => { if (t === 'success') successToast = true; return realToast(m, t); }; try { await Pages._saveDeliveryPackaging('sb40'); } catch (e) {} UI.toast = realToast; const after = DB.get().deliveries.find(x => x.id === 'sb40'); return { line0Unchanged: after.lines[0].packaging === 1, line1Unchanged: after.lines[1].packaging === 0, noNewCost: DB.get().costHistory.length === chBefore, noSuccess: !successToast }; }, s);
      rec('S-40', 'packaging edit all-or-nothing (no partial commit)', r.line0Unchanged && r.line1Unchanged && r.noNewCost && r.noSuccess, `line0Unchanged=${r.line0Unchanged} line1Unchanged=${r.line1Unchanged} noNewCost=${r.noNewCost} noSuccess=${r.noSuccess} (clean: all true)`); await ctx.close(); }

    // S-41 (F1-H03): Director cost table renders sell price + margin from the real field (p.price).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.price = 99.95; if (!d.costHistory) d.costHistory = []; d.costHistory.push({ id: 'sb41', productId: p.id, date: '2026-06-01', costPrice: 40, notes: '' }); let e = document.getElementById('dc-table'); if (!e) { e = document.createElement('div'); e.id = 'dc-table'; document.body.appendChild(e); } Pages._renderCostTable(); const html = e.innerHTML; const rows = html.split('<tr>'); const row = rows.find(x => x.includes(p.id)) || ''; return { hasPrice: row.includes('$99.95'), hasMargin: /badge-(green|amber|red)/.test(row) && row.includes('%') }; }, s);
      rec('S-41', 'cost table sell price + margin read p.price (no sellPrice drift)', r.hasPrice && r.hasMargin, `hasPrice=${r.hasPrice} hasMargin=${r.hasMargin} (clean: true+true)`); await ctx.close(); }

    // S-42 (F2-CRIT03): a successful push ack does a TARGETED row update — zero table
    // clears (the old DB.save path clear+rewrote all 12 tables per ack: freeze time-bomb).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); let pc = 0; if (isPush) { try { const p = JSON.parse(body); pc = ((p.data && p.data.transactions) || []).length; } catch (e) {} } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', processedCount: pc } : { items: [], serverTimestamp: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { let clears = 0; ['productTypes','categories','products','stores','users','thresholds','transactions','deletedTransactions','transfers','costHistory','stockTakes','deliveries'].forEach(n => { const t = bobDB[n]; const c = t.clear.bind(t); t.clear = (...a) => { clears++; return c(...a); }; }); const id = 'c42_' + Date.now(); await DB.addTransactionDurable({ id, type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-06-10', createdAt: new Date().toISOString(), _synced: false }); Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; clears = 0; try { await Sync.push(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 800)); const t = DB.get().transactions.find(x => x.id === id); return { synced: t ? !!t._synced : 'GONE', clears }; }, s);
      rec('S-42', 'push ack marks synced via targeted write (no table clears)', r.synced === true && r.clears === 0, `synced=${r.synced} tableClears=${r.clears} (clean: true + 0)`); await ctx.close(); }

    // S-43 (F2-CRIT04): IDs containing sanitizer-stripped chars are rejected at the
    // import boundary AND at product add — a stored id with < > " ' \` detaches from
    // its ledger history on next load (verified live).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { /* Wave J: put the forbidden char in a STORE id, not a product id — the new product-id allowlist (index.html ~3206) independently rejects bad product ids, which would MASK the 3205 catalogue-denylist this sentinel guards (S-43 went BLIND in the full sweep). Stores are guarded ONLY by 3205. */ const mkB = sid => ({ _meta: { app: 'bob-stock', backupFormat: Pages._BACKUP_FORMAT }, products: [{ id: 'p43', name: 'x' }], stores: [{ id: sid, name: 'x' }], categories: [{ id: 'c43', name: 'x' }], users: [], transactions: [] }); const bad = Pages._validateAndScrubBackup(mkB('SB<43')); const good = Pages._validateAndScrubBackup(mkB('SB43')); const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('np-id', 'EVIL<1'); mk('np-name', 'Evil Probe'); mk('np-price', '1'); const before = DB.get().products.length; try { await Pages._saveNewProduct(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 200)); const after = DB.get().products.length; const exists = DB.get().products.some(p => p.id.indexOf('EVIL') === 0); return { importBadRejected: !bad.ok, importGoodAccepted: !!good.ok, addRejected: after === before && !exists }; });
      rec('S-43', 'hostile-char IDs rejected at import + product add (no detach vector)', r.importBadRejected && r.importGoodAccepted && r.addRejected, `importBadRejected=${r.importBadRejected} importGoodAccepted=${r.importGoodAccepted} addRejected=${r.addRejected} (clean: all true)`); await ctx.close(); }

    // S-44 (F2-CRIT02): a second receive of the same transfer (other-device replay) is
    // BLOCKED by the ledger guard — stock cannot double.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { UI.confirm = (...args) => { const f = args.find(a => typeof a === 'function'); if (f) return f(); }; const drive = async (trId, pid, q) => { window.TransferUI.openDetail(trId); await new Promise(r2 => setTimeout(r2, 150)); const st = window['_stp_rv_' + pid]; if (typeof st === 'function') { st(q); await new Promise(r2 => setTimeout(r2, 150)); } window.TransferUI.toggleMatch(trId, pid); await new Promise(r2 => setTimeout(r2, 150)); window.TransferUI.submitReceive(trId); await new Promise(r2 => setTimeout(r2, 500)); }; const d = DB.get(); const toStore = s.storeId; const from = d.stores.find(x => x.id !== toStore && x.type === 'warehouse') || d.stores.find(x => x.id !== toStore); const trId = 'c44_' + Date.now(); d.transfers = d.transfers || []; d.transfers.push({ id: trId, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: from.id, toStoreId: toStore, createdBy: Auth.actor(), createdByName: 't', status: 'in_transit', items: [{ productId: s.productId, sentQty: 10, receivedQty: null, status: 'confirmed', flagNote: '' }], receivedBy: null, receivedDate: null, completedDate: null, notes: '' }); await DB.updateTransferDurable(d.transfers[d.transfers.length - 1], null); const q0 = Stock.qty(s.productId, toStore); await drive(trId, s.productId, 10); const t = DB.get().transfers.find(x => x.id === trId); t.status = 'in_transit'; t.items.forEach(i => { i.status = 'confirmed'; i.receivedQty = null; }); await drive(trId, s.productId, 10); const txns = DB.get().transactions.filter(x => x.transferId === trId && x.type === 'transfer_in'); return { count: txns.length, delta: Stock.qty(s.productId, toStore) - q0 }; }, s);
      rec('S-44', 'second receive of same transfer blocked (no stock doubling)', r.count === 1 && r.delta === 10, `transferIn=${r.count} qtyDelta=${r.delta} (clean: 1 + 10)`); await ctx.close(); }

    // S-45 (F2-HIGH02): a flagged receipt credits the PHYSICALLY RECEIVED qty immediately;
    // accept_as_is resolution settles only the shortfall (no double credit). Conservation:
    // receiver +8, sender gets the 2-unit shortfall back.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { UI.confirm = (...args) => { const f = args.find(a => typeof a === 'function'); if (f) return f(); }; const drive = async (trId, pid, q) => { window.TransferUI.openDetail(trId); await new Promise(r2 => setTimeout(r2, 150)); const st = window['_stp_rv_' + pid]; if (typeof st === 'function') { st(q); await new Promise(r2 => setTimeout(r2, 150)); } window.TransferUI.toggleMatch(trId, pid); await new Promise(r2 => setTimeout(r2, 150)); window.TransferUI.submitReceive(trId); await new Promise(r2 => setTimeout(r2, 500)); }; const d = DB.get(); const toStore = s.storeId; const from = d.stores.find(x => x.id !== toStore && x.type === 'warehouse') || d.stores.find(x => x.id !== toStore); const trId = 'c45_' + Date.now(); d.transfers = d.transfers || []; d.transfers.push({ id: trId, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: from.id, toStoreId: toStore, createdBy: Auth.actor(), createdByName: 't', status: 'in_transit', items: [{ productId: s.productId, sentQty: 10, receivedQty: null, status: 'confirmed', flagNote: '' }], receivedBy: null, receivedDate: null, completedDate: null, notes: '' }); await DB.updateTransferDurable(d.transfers[d.transfers.length - 1], null); const q0 = Stock.qty(s.productId, toStore); const f0 = Stock.qty(s.productId, from.id); await drive(trId, s.productId, 8); const afterReceive = Stock.qty(s.productId, toStore) - q0; const t = DB.get().transfers.find(x => x.id === trId); const marker = t.items[0].creditedAtReceive; window.TransferUI.setFlagAction(trId, s.productId, 'accept_as_is'); await new Promise(r2 => setTimeout(r2, 150)); window.TransferUI.completeFlags(trId); await new Promise(r2 => setTimeout(r2, 600)); const recvDelta = Stock.qty(s.productId, toStore) - q0; const senderDelta = Stock.qty(s.productId, from.id) - f0; return { afterReceive, marker, recvDelta, senderDelta, status: DB.get().transfers.find(x => x.id === trId).status }; }, s);
      rec('S-45', 'flagged receipt credits received qty immediately; resolution settles only the shortfall', r.afterReceive === 8 && r.marker === 8 && r.recvDelta === 8 && r.senderDelta === 2 && r.status === 'completed', `afterReceive=${r.afterReceive} marker=${r.marker} finalRecv=${r.recvDelta} senderReturn=${r.senderDelta} status=${r.status} (clean: 8/8/8/2/completed)`); await ctx.close(); }

    // S-46 (F3-CRIT01): master-data merge — a versioned catalogue in AppConfig updates
    // prices/adds products on launch; local-only rows + local cost survive; the version
    // gate makes re-fetches idempotent; invalid rows are skipped, never coerced.
    { const { ctx, page } = await newPage(b);
      let mdVersion = 1, mdPrice = 7.77;
      await page.route('**logic.azure.com**', r => {
        const url = r.request().url();
        if (url.includes('/config')) {
          // ConfigData ships as a STRING (SharePoint text column); 1e309 written raw so
          // JSON.parse yields Infinity client-side — JSON.stringify would null it out.
          const md = '{"version":' + mdVersion + ',"products":['
            + '{"id":"TRD_4","name":"Rose Toner","catId":"cat_trd","price":' + mdPrice + '},'
            + '{"id":"PROD_NEW46","name":"HQ New Product","catId":"cat_trd","price":12.5},'
            + '{"id":"TRD_5","name":"Tissues Boxes","catId":"cat_trd","price":1.7,"active":false},'
            + '{"id":"BAD<46","name":"Hostile","catId":"cat_trd","price":1},'
            + '{"id":"INF46","name":"Bad Money","catId":"cat_trd","price":1e309}'
            + ']}';
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [
            { ConfigType: 'master_data', ConfigData: md },
            { ConfigType: 'sync_config', ConfigData: { pushUrl: 'https://x.logic.azure.com/push', pullUrl: 'https://x.logic.azure.com/pull' } }
          ] }) });
        }
        return r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[],"serverTimestamp":0,"status":"ok"}' });
      });
      await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get();
        d.products.push({ id: 'LOCAL_46', name: 'Local Only', catId: 'cat_trd', price: 2, active: true });
        const t4 = d.products.find(p => p.id === 'TRD_4'); t4.costPrice = 3;
        Sync.CONFIG_URL = 'https://x.logic.azure.com/config';
        await Sync._fetchRemoteConfig();
        const after1 = {
          price: DB.get().products.find(p => p.id === 'TRD_4').price,
          costKept: DB.get().products.find(p => p.id === 'TRD_4').costPrice === 3,
          added: !!DB.get().products.find(p => p.id === 'PROD_NEW46'),
          deactivated: DB.get().products.find(p => p.id === 'TRD_5').active === false,
          localKept: !!DB.get().products.find(p => p.id === 'LOCAL_46'),
          badSkipped: !DB.get().products.some(p => p.id.indexOf('BAD') === 0) && !DB.get().products.some(p => p.id === 'INF46')
        };
        window.__setMd && window.__setMd();  // no-op hook
        return after1;
      });
      // same version re-fetch with a different price must be a no-op (idempotence)
      mdPrice = 99.99;
      const r2 = await page.evaluate(async () => { await Sync._fetchRemoteConfig(); return { priceAfterSameVersion: DB.get().products.find(p => p.id === 'TRD_4').price }; });
      rec('S-46', 'master-data merge: upsert + version gate + validation + local preservation', r.price === 7.77 && r.costKept && r.added && r.deactivated && r.localKept && r.badSkipped && r2.priceAfterSameVersion === 7.77, `price=${r.price} costKept=${r.costKept} added=${r.added} deactivated=${r.deactivated} localKept=${r.localKept} badSkipped=${r.badSkipped} sameVersionNoop=${r2.priceAfterSameVersion === 7.77} (clean: all true)`); await ctx.close(); }

    // S-47 (F-followup / GPT-WF-01): sync pull STRICT ingest — _fromSharePoint REJECTS
    // (returns null) fractional/NaN/huge/Infinity qty, unknown type, unknown product/store;
    // never coerces. Valid qty still maps. Guards the boundary-symmetry fix in sync.js.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const mk = (q, extra) => Object.assign({ TransactionId: 'sp_' + Math.random().toString(36).slice(2), Type: 'in', StoreId: s.storeId, ProductId: s.productId, Date: '2026-06-10', Qty: q }, extra || {}); const m = (q, extra) => { const v = Sync._fromSharePoint(mk(q, extra)); return v === null ? 'null' : v.qty; }; return { frac: m(5.9), nan: m('abc'), huge: m(9007199254740992), inf: m('1e309'), neg: m(-7), badType: m(3, { Type: 'HACKED' }), badProd: m(3, { ProductId: 'NOSUCH' }), badStore: m(3, { StoreId: 'NOSUCH' }), valid: m(7) }; }, s);
      const allRejected = ['frac','nan','huge','inf','neg','badType','badProd','badStore'].every(k => r[k] === 'null');
      rec('S-47', 'sync pull rejects invalid remote rows (no coercion)', allRejected && r.valid === 7, `frac=${r.frac} nan=${r.nan} huge=${r.huge} inf=${r.inf} neg=${r.neg} badType=${r.badType} badProd=${r.badProd} badStore=${r.badStore} valid=${r.valid} (clean: all null + valid 7)`); await ctx.close(); }

    // S-48 (F-followup / GPT-WF-02): backup import REJECTS fractional qty + out-of-policy
    // money through the shared Validate policy; normalises 3-decimal money to 2dp.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(() => { const mkB = (qty, price) => ({ _meta: { app: 'bob-stock', backupFormat: Pages._BACKUP_FORMAT }, products: [{ id: 'SB48', name: 'x', price }], stores: [{ id: 'sb48', name: 'x' }], categories: [{ id: 'c48', name: 'x' }], users: [], transactions: [{ id: 't48', date: '2026-06-10', storeId: 'sb48', productId: 'SB48', type: 'in', qty }] }); const frac = Pages._validateAndScrubBackup(mkB(1.5, 9)); const big = Pages._validateAndScrubBackup(mkB(1, 1000000.01)); const norm = Pages._validateAndScrubBackup(mkB(1, 1.239)); const good = Pages._validateAndScrubBackup(mkB(7, 9)); return { fracRejected: !frac.ok, bigRejected: !big.ok, normalized: norm.ok ? norm.data.products[0].price : null, goodAccepted: good.ok && good.data.transactions[0].qty === 7 }; });
      rec('S-48', 'backup import rejects fractional qty + out-of-policy money (normalises 2dp)', r.fracRejected && r.bigRejected && r.normalized === 1.24 && r.goodAccepted, `fracRejected=${r.fracRejected} bigRejected=${r.bigRejected} normalized=${r.normalized} goodAccepted=${r.goodAccepted} (clean: true/true/1.24/true)`); await ctx.close(); }

    // S-49 (F-followup / GPT-WF-03): master_data merge enforces the shared money policy —
    // rejects >MONEY_MAX, normalises 3-decimal prices to 2dp.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(() => { const mk = (v, price) => JSON.stringify({ version: v, products: [{ id: 'MD49', name: 'x', catId: 'cat_trd', price }] }); Sync._applyMasterData(mk(2, 1000000.01)); const overMax = DB.get().products.find(p => p.id === 'MD49'); Sync._applyMasterData(mk(3, 1.239)); const norm = DB.get().products.find(p => p.id === 'MD49'); return { overMaxSkipped: !overMax, normalized: norm ? norm.price : 'none' }; });
      rec('S-49', 'master_data merge enforces shared money policy (reject >max, normalise 2dp)', r.overMaxSkipped === true && r.normalized === 1.24, `overMaxSkipped=${r.overMaxSkipped} normalized=${r.normalized} (clean: true + 1.24)`); await ctx.close(); }

    // S-50 (F-followup / CL-01, I-02): master_data merge must NOT copy reserved keys —
    // a __proto__ field in a remote row must not swap the merged object's prototype.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      // payload built as a RAW JSON STRING (the real cloud path via JSON.parse). A
      // JS object literal {'__proto__':{…}} sets the PROTOTYPE and JSON.stringify
      // then drops it — so a stringified payload tests NOTHING (this exact mistake
      // made S-50 blind in run #2). Only a raw string carries an own __proto__ key.
      const r = await page.evaluate(() => { const raw = '{"version":5,"products":[{"id":"MD50","name":"y","catId":"cat_trd","price":5,"__proto__":{"polluted":true}}]}'; Sync._applyMasterData(raw); const p = DB.get().products.find(x => x.id === 'MD50'); return { rowPresent: !!p, protoIntact: p ? Object.getPrototypeOf(p) === Object.prototype : false, noLeak: p ? p.polluted === undefined : false, noGlobalLeak: ({}).polluted === undefined }; });
      rec('S-50', 'master_data merge rejects reserved-key (no prototype pollution)', r.rowPresent && r.protoIntact && r.noLeak && r.noGlobalLeak, `rowPresent=${r.rowPresent} protoIntact=${r.protoIntact} noLeak=${r.noLeak} noGlobalLeak=${r.noGlobalLeak} (clean: all true)`); await ctx.close(); }

    // S-51 (F-followup-2 / GPT-FF-01): LEXICAL gate — exponent/hex/octal/binary numeric
    // STRINGS are rejected (no coercion) at the shared validators AND the backup + pull
    // boundaries. '5e2' must NOT become 500; plain numbers still pass.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const vq = v => Validate.qty(v).ok; const vm = v => Validate.money(v).ok; const lexRejected = !vq('5e2') && !vq('0x10') && !vq('0o20') && !vq('0b10') && !vm('5e2') && !vm('0x10'); const plainOk = vq('7') && vq('0') && vm('4.99') && vm('1000000'); const backup = Pages._validateAndScrubBackup({ _meta: { app: 'bob-stock', backupFormat: Pages._BACKUP_FORMAT }, products: [{ id: 'SB51', name: 'x' }], stores: [{ id: 'sb51', name: 'x' }], categories: [{ id: 'c51', name: 'x' }], users: [], transactions: [{ id: 't51', date: '2026-06-10', storeId: 'sb51', productId: 'SB51', type: 'in', qty: '5e2' }] }); const pull = Sync._fromSharePoint({ TransactionId: 'p51', Type: 'in', StoreId: s.storeId, ProductId: s.productId, Date: '2026-06-10', Qty: '5e2' }); return { lexRejected, plainOk, backupRejected: !backup.ok, pullRejected: pull === null }; }, s);
      rec('S-51', 'exponent/hex numeric strings rejected at validators + backup + pull (no coercion)', r.lexRejected && r.plainOk && r.backupRejected && r.pullRejected, `lexRejected=${r.lexRejected} plainOk=${r.plainOk} backupRejected=${r.backupRejected} pullRejected=${r.pullRejected} (clean: all true)`); await ctx.close(); }

    // S-52 (F-followup-2 / GPT-FF-02): PUSH EGRESS validation — hostile/legacy local rows
    // (fractional/NaN qty, unknown type/product/store) are EXCLUDED from the push payload;
    // valid rows still push. The 4th trust boundary.
    { const { ctx, page } = await newPage(b); let pushed = null; await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; if (body.includes('"transactions"')) { try { pushed = (JSON.parse(body).data.transactions || []).map(t => t.TransactionId); } catch (e) {} } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', processedCount: 99 }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const good = 'e_good_' + Date.now(); const rows = [ { id: good, type: 'in', qty: 7, storeId: s.storeId, productId: s.productId, date: '2026-06-10', createdAt: new Date().toISOString(), _synced: false }, { id: 'e_frac', type: 'in', qty: 5.9, storeId: s.storeId, productId: s.productId, date: '2026-06-10', createdAt: new Date().toISOString(), _synced: false }, { id: 'e_nan', type: 'in', qty: 'abc', storeId: s.storeId, productId: s.productId, date: '2026-06-10', createdAt: new Date().toISOString(), _synced: false }, { id: 'e_type', type: 'HACKED', qty: 3, storeId: s.storeId, productId: s.productId, date: '2026-06-10', createdAt: new Date().toISOString(), _synced: false }, { id: 'e_prod', type: 'in', qty: 3, storeId: s.storeId, productId: 'NOSUCHPROD', date: '2026-06-10', createdAt: new Date().toISOString(), _synced: false } ]; await bobDB.transactions.bulkPut(rows); await DB.refresh(); Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; try { await Sync.push(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 500)); return { good }; }, s);
      const onlyGood = pushed && pushed.length === 1 && pushed[0] === r.good;
      rec('S-52', 'push egress excludes hostile local rows (only valid pushed)', onlyGood, `pushedIds=${JSON.stringify(pushed)} expectedOnly=${r.good} (clean: only the valid row)`); await ctx.close(); }
    // S-53 (Wave G / blind ×5, runtime-proven): delivery SHIPPING cost is included in landed
    // cost + stored on the record. The old code read a non-existent del-customs input and never
    // read del-shipping, so $100 shipping on 10 units left landed at $5 instead of $15.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Pages._delLines = [{ productId: s.productId, qty: 10, unitCost: 5, weightGrams: 0, packaging: 0, labelling: 0 }]; const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('del-supplier', 'ShipCo53'); mk('del-date', '2026-06-11'); mk('del-invoice', ''); mk('del-freight', '0'); mk('del-tax', '0'); mk('del-shipping', '100'); try { await Pages._saveDelivery(); } catch (e) {} await DB.refresh(); const del = (DB.get().deliveries || []).filter(dv => dv.supplier === 'ShipCo53').pop(); return { found: !!del, landed: del ? del.lines[0].landedCostPerUnit : null, storedShipping: del ? (del.headerCosts.shipping || 0) : null }; }, s);
      rec('S-53', 'delivery shipping cost reaches landed cost + stored on record', r.found && r.landed === 15 && r.storedShipping === 100, `landed=${r.landed} storedShipping=${r.storedShipping} (clean: 15 + 100; bug: 5 + 0)`); await ctx.close(); }

    // S-54 (Wave G / blind CaC-H4): a FAILED migration persist must THROW (so initDB serves
    // recovery mode) and must KEEP the localStorage source — never archive+delete after a
    // persist that returned false (the silent-empty-app trap).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(async () => { const KEY = DB.KEY; localStorage.setItem(KEY, JSON.stringify({ products: [{ id: 'm54', name: 'M' }], stores: [], users: [], transactions: [], _v: 1 })); const realTx = bobDB.transaction.bind(bobDB); bobDB.transaction = () => Promise.reject(new Error('forced-persist-fail')); let threw = false; try { await _migrateFromLocalStorage(); } catch (e) { threw = true; } bobDB.transaction = realTx; const kept = localStorage.getItem(KEY) !== null; localStorage.removeItem(KEY); localStorage.removeItem(KEY + '_migrated'); return { threw, kept }; });
      rec('S-54', 'failed migration persist throws + keeps localStorage source', r.threw && r.kept, `threw=${r.threw} sourceKept=${r.kept} (clean: true+true; bug: false+false = silent empty app)`); await ctx.close(); }

    // S-55 (Wave G / blind W3-1): the login-audit ROUTE is registered (the sidebar link used to
    // point at a route that didn't exist — whole feature unreachable) and is Director-gated.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(() => { const el = document.getElementById('page-login-audit'); el.innerHTML = ''; const d = DB.get(); const staff = (d.users || []).find(u => u.role === 'staff') || { id: 's55', role: 'staff', name: 'S', username: 's55', storeIds: [] }; Auth._user = staff; try { navigateTo('login-audit'); } catch (e) {} const staffBlocked = el.innerHTML.indexOf('Login Audit') === -1; const dir = (d.users || []).find(u => u.role === 'director'); Auth._user = dir; try { navigateTo('login-audit'); } catch (e) {} const dirSees = el.innerHTML.indexOf('Login Audit') !== -1; return { staffBlocked, dirSees }; });
      rec('S-55', 'login-audit route registered + director-gated', r.staffBlocked && r.dirSees, `staffBlocked=${r.staffBlocked} directorSees=${r.dirSees} (clean: true+true; bug: directorSees=false — dead route)`); await ctx.close(); }

    // S-56 (Wave G / blind W3-4): optimum-levels Save All PRESERVES leadDays — it used to
    // hard-code leadDays:null and silently wipe every reorder lead time set in Settings.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const pid = s.productId; const d = DB.get(); let idx = d.thresholds.findIndex(t => t.productId === pid && (t.storeId === '*' || t.storeId === null)); if (idx < 0) { d.thresholds.push({ productId: pid, storeId: '*', minQty: 1, optimumQty: 2, leadDays: 14 }); } else { d.thresholds[idx].leadDays = 14; } window._txState.optScope = 'global'; window._txState.optStore = null; window._txState.optEdits = { [pid]: { min: 3, optimum: 6 } }; try { await window.TransferUI.saveOptimumLevels(); } catch (e) {} await DB.refresh(); const t = DB.get().thresholds.find(x => x.productId === pid && (x.storeId === '*' || x.storeId === null)); return { lead: t ? t.leadDays : 'GONE', min: t ? t.minQty : null }; }, s);
      rec('S-56', 'optimum Save All preserves leadDays (no silent wipe)', r.lead === 14 && r.min === 3, `leadDays=${r.lead} min=${r.min} (clean: 14 + 3; bug: null + 3)`); await ctx.close(); }

    // S-57 (Wave G / blind W8, runtime-verified): LOGOUT clears every draft holder — movement
    // wizard, stock-take counts, delivery lines, transfer + optimum drafts — so the next user
    // on a shared store device cannot inherit or submit the previous user's work.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(() => { Pages._logData = { staffName: 'GHOST', qty: 9 }; Pages._stData = { p1: 5 }; Pages._delLines = [{ productId: 'x', qty: 1, unitCost: 1 }]; window._txState.createItems = { a: 2 }; window._txState.createReturnNotes = 'ghost-note'; window._txState.optEdits = { k: { min: 1, optimum: 2 } }; try { App.logout(); } catch (e) {} return { logCleared: !Pages._logData.staffName, stCleared: Object.keys(Pages._stData || {}).length === 0, delCleared: (Pages._delLines || []).length === 0, txCleared: Object.keys(window._txState.createItems).length === 0 && window._txState.createReturnNotes === '' && Object.keys(window._txState.optEdits).length === 0 }; });
      rec('S-57', 'logout clears all draft state (no cross-user bleed)', r.logCleared && r.stCleared && r.delCleared && r.txCleared, `log=${r.logCleared} st=${r.stCleared} del=${r.delCleared} tx=${r.txCleared} (clean: all true)`); await ctx.close(); }

    // S-58 (Wave G / blind W6+W7): DOUBLE-TAP re-entrancy guards — firing _submitLog twice
    // (touchscreen double-tap) records ONE movement, and firing _saveDelivery twice records
    // ONE delivery's stock-in. Distinct crypto ids defeat dedup, so only a guard prevents x2.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Pages._logData = { selectedStoreId: s.storeId, productId: s.productId, type: 'in', qty: 2, staffName: 'DTAP58', reason: 'Other' }; const p1 = Pages._submitLog(); const p2 = Pages._submitLog(); try { await Promise.all([p1, p2]); } catch (e) {} await new Promise(r2 => setTimeout(r2, 300)); await DB.refresh(); const moves = DB.get().transactions.filter(t => t.staffName === 'DTAP58').length; Pages._delLines = [{ productId: s.productId, qty: 1, unitCost: 2, weightGrams: 0, packaging: 0, labelling: 0 }]; const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('del-supplier', 'DTapCo58'); mk('del-date', '2026-06-11'); mk('del-invoice', ''); mk('del-freight', '0'); mk('del-tax', '0'); mk('del-shipping', '0'); const q1 = Pages._saveDelivery(); const q2 = Pages._saveDelivery(); try { await Promise.all([q1, q2]); } catch (e) {} await new Promise(r2 => setTimeout(r2, 300)); await DB.refresh(); const delTxns = DB.get().transactions.filter(t => (t.reason || '').indexOf('Delivery from DTapCo58') === 0).length; return { moves, delTxns }; }, s);
      rec('S-58', 'double-tap guards: one movement + one delivery stock-in', r.moves === 1 && r.delTxns === 1, `movements=${r.moves} deliveryTxns=${r.delTxns} (clean: 1+1; bug: 2+2)`); await ctx.close(); }
    // S-59 (Wave G follow-up / GPT BLOCK P3): the DELIVERY double-submit guard is mutation-proven
    // in isolation — S-58 tested both halves but only the _logSubmitting mutation existed, so the
    // _delSaving half was asserted-not-proven. This sentinel's saboteur removes _delSaving.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Pages._delLines = [{ productId: s.productId, qty: 1, unitCost: 3, weightGrams: 0, packaging: 0, labelling: 0 }]; const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('del-supplier', 'DelGuard59'); mk('del-date', '2026-06-13'); mk('del-invoice', ''); mk('del-freight', '0'); mk('del-tax', '0'); mk('del-shipping', '0'); const q1 = Pages._saveDelivery(); const q2 = Pages._saveDelivery(); try { await Promise.all([q1, q2]); } catch (e) {} await new Promise(r2 => setTimeout(r2, 300)); await DB.refresh(); const delTxns = DB.get().transactions.filter(t => (t.reason || '').indexOf('Delivery from DelGuard59') === 0).length; const dels = (DB.get().deliveries || []).filter(dv => dv.supplier === 'DelGuard59').length; return { delTxns, dels }; }, s);
      rec('S-59', 'delivery double-tap guard records one delivery (mutation-proven)', r.delTxns === 1 && r.dels === 1, `deliveryTxns=${r.delTxns} deliveries=${r.dels} (clean: 1+1; bug: 2+2)`); await ctx.close(); }

    // S-60 (Wave G follow-up / GPT+Gemini BLOCK P2, convergence ×2): editing a delivery's packaging
    // preserves the WEIGHT-allocated header share. Two equal-value lines, weights 100g/900g, $100
    // shipping → header shares $10/$90. Editing line-0 packaging by +$5 must change ONLY landed
    // (10+5+10=$25), NOT re-flatten the share to value-based ($50 → $65). headerCostShare stays $10.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const prods = d.products.filter(p => p.active).slice(0, 2); const pA = prods[0].id, pB = (prods[1] || prods[0]).id; Pages._delLines = [{ productId: pA, qty: 1, unitCost: 10, weightGrams: 100, packaging: 0, labelling: 0 }, { productId: pB, qty: 1, unitCost: 10, weightGrams: 900, packaging: 0, labelling: 0 }]; const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('del-supplier', 'WAlloc60'); mk('del-date', '2026-06-13'); mk('del-invoice', ''); mk('del-freight', '0'); mk('del-tax', '0'); mk('del-shipping', '100'); try { await Pages._saveDelivery(); } catch (e) {} await DB.refresh(); const del = (DB.get().deliveries || []).filter(dv => dv.supplier === 'WAlloc60').pop(); const initShareA = del.lines[0].headerCostShare; const initLandedA = del.lines[0].landedCostPerUnit; mk('epkg-0', '5'); mk('elab-0', '0'); mk('epkg-1', String(del.lines[1].packaging || 0)); mk('elab-1', String(del.lines[1].labelling || 0)); try { await Pages._saveDeliveryPackaging(del.id); } catch (e) {} await DB.refresh(); const del2 = (DB.get().deliveries || []).filter(dv => dv.supplier === 'WAlloc60').pop(); return { initShareA, initLandedA, editedShareA: del2.lines[0].headerCostShare, editedLandedA: del2.lines[0].landedCostPerUnit }; }, s);
      rec('S-60', 'packaging edit preserves weight-allocated header share', r.initShareA === 10 && r.initLandedA === 20 && r.editedShareA === 10 && r.editedLandedA === 25, `initShare=${r.initShareA} initLanded=${r.initLandedA} editedShare=${r.editedShareA} editedLanded=${r.editedLandedA} (clean: 10/20/10/25; bug: share re-flattened to 50 → landed 65)`); await ctx.close(); }

    // S-61 (Wave G follow-up / Gemini BLOCK P3): the optimum-levels "Save All" double-tap guard —
    // firing saveOptimumLevels twice commits ONCE (the second call early-returns), no overlapping
    // commitDurable. Completes the G6 re-entrancy sweep across all three write paths.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const pid = s.productId; let calls = 0; const realC = DB.commitDurable.bind(DB); DB.commitDurable = async () => { calls++; return realC(); }; window._txState.optScope = 'global'; window._txState.optStore = null; window._txState.optEdits = { [pid]: { min: 4, optimum: 8 } }; const p1 = window.TransferUI.saveOptimumLevels(); const p2 = window.TransferUI.saveOptimumLevels(); try { await Promise.all([p1, p2]); } catch (e) {} DB.commitDurable = realC; return { calls }; }, s);
      rec('S-61', 'optimum Save All double-tap commits once (re-entrancy guard)', r.calls === 1, `commitDurableCalls=${r.calls} (clean: 1; bug: 2 — overlapping commits)`); await ctx.close(); }
    // S-62 (Wave G follow-up / GPT+Gemini re-audit P3): _saveDeliveryPackaging double-tap guard.
    // MEASURES COMMIT COUNT, not surviving rows: two synchronously-fired calls mint the same
    // ch_+Date.now() id (DB dedupes them) — a real double-tap is ms apart, so row-counting is BLIND
    // in a test. The guard's true effect is that the second call never reaches _commitSettings
    // (which is the false-"could not be saved"-fatal path GPT proved). Guard → 1 commit; bug → 2.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Pages._delLines = [{ productId: s.productId, qty: 1, unitCost: 10, weightGrams: 0, packaging: 0, labelling: 0 }]; const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('del-supplier', 'PkgGuard62'); mk('del-date', '2026-06-13'); mk('del-invoice', ''); mk('del-freight', '0'); mk('del-tax', '0'); mk('del-shipping', '0'); try { await Pages._saveDelivery(); } catch (e) {} await DB.refresh(); const del = (DB.get().deliveries || []).filter(dv => dv.supplier === 'PkgGuard62').pop(); let commits = 0; const realCS = Pages._commitSettings.bind(Pages); Pages._commitSettings = async (...a) => { commits++; return realCS(...a); }; mk('epkg-0', '7'); mk('elab-0', '0'); const p1 = Pages._saveDeliveryPackaging(del.id); const p2 = Pages._saveDeliveryPackaging(del.id); try { await Promise.all([p1, p2]); } catch (e) {} await new Promise(r2 => setTimeout(r2, 250)); Pages._commitSettings = realCS; return { commits }; }, s);
      rec('S-62', 'packaging-edit double-tap guard (one commit, no false-fatal path)', r.commits === 1, `commitCalls=${r.commits} (clean: 1; bug: 2)`); await ctx.close(); }

    // S-63 (Wave G follow-up / Gemini write-path family): _saveCostEntry double-tap guard. Same
    // robust commit-count measure (the appended ch_+Date.now() rows collide on id in a synchronous
    // test). Guard → the second call early-returns before _commitSettings; bug → 2 commits (= 2 rows
    // in a real ms-apart double-tap).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const pid = s.productId; const mk = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = v; }; mk('nc-date', '2026-06-13'); mk('nc-cost', '12'); mk('nc-notes', 'GUARD63'); let commits = 0; const realCS = Pages._commitSettings.bind(Pages); Pages._commitSettings = async (...a) => { commits++; return realCS(...a); }; const p1 = Pages._saveCostEntry(pid); const p2 = Pages._saveCostEntry(pid); try { await Promise.all([p1, p2]); } catch (e) {} await new Promise(r2 => setTimeout(r2, 250)); Pages._commitSettings = realCS; return { commits }; }, s);
      rec('S-63', 'cost-entry double-tap guard (one commit)', r.commits === 1, `commitCalls=${r.commits} (clean: 1; bug: 2)`); await ctx.close(); }

    // S-64 (Wave G follow-up / Gemini write-path family): _submitStockTake CLEAN-take double-tap
    // guard. Robust DB.commitDurable count (the discrepancy path already had _stSubmitting; the clean
    // auto-finalise path was the gap). Guard → 1 commit; bug → 2 (= 2 st_+Date.now() records ms apart).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const pid = s.productId, sid = s.storeId; Pages._emailStockTake = () => {}; Pages.stockTake = () => {}; Pages._stSelectedStoreId = sid; const sys = Stock.qty(pid, sid); Pages._stData = { [pid]: String(sys) }; let commits = 0; const realCD = DB.commitDurable.bind(DB); DB.commitDurable = async (...a) => { commits++; return realCD(...a); }; const p1 = Pages._submitStockTake(); const p2 = Pages._submitStockTake(); try { await Promise.all([p1, p2]); } catch (e) {} await new Promise(r2 => setTimeout(r2, 250)); DB.commitDurable = realCD; return { commits }; }, s);
      rec('S-64', 'clean stock-take double-tap guard (one commit)', r.commits === 1, `commitCalls=${r.commits} (clean: 1; bug: 2)`); await ctx.close(); }
    // S-65 (Wave H / H1 — blind G1-22, ×4, P1): an offline delete queued as a type:'deleted' row
    // (carrying its TargetTransactionId) now EGRESSES through push(); a malformed tombstone with no
    // target is still excluded. The old in/out-only egress filter dropped ALL tombstones → offline
    // deletes never synced (ghost stock on every other device).
    { const { ctx, page } = await newPage(b); let pushed = null; await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; if (body.includes('"transactions"')) { try { pushed = (JSON.parse(body).data.transactions || []).map(t => t.TransactionId); } catch (e) {} } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', processedCount: 99 }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const good = { id: 'del_good_' + Date.now(), date: '2026-06-14', storeId: s.storeId, productId: s.productId, type: 'deleted', qty: 0, targetTransactionId: 'orig_1', createdAt: new Date().toISOString(), _synced: false }; const bad = { id: 'del_bad_' + Date.now(), date: '2026-06-14', storeId: s.storeId, productId: s.productId, type: 'deleted', qty: 0, createdAt: new Date().toISOString(), _synced: false }; await bobDB.transactions.bulkPut([good, bad]); await DB.refresh(); Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; try { await Sync.push(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 500)); return { goodId: good.id, badId: bad.id }; }, s);
      const _ids = pushed || [];
      rec('S-65', 'offline tombstone egresses; malformed one excluded', _ids.includes(r.goodId) && !_ids.includes(r.badId), `pushed=${JSON.stringify(_ids)} expectGood=${r.goodId} expectNoBad=${r.badId}`); await ctx.close(); }

    // S-66 (Wave H / H2 — blind G1-12, ×2): the catalogue version advances ONLY after a DURABLE
    // persist. Force the Dexie write to fail → version must NOT advance (else the next launch's
    // version<=lastApplied gate skips re-applying → catalogue desyncs forever).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { localStorage.setItem('bob_catalogue_version', '1'); const realTx = bobDB.transaction.bind(bobDB); bobDB.transaction = () => Promise.reject(new Error('forced-persist-fail')); try { await Sync._applyMasterData(JSON.stringify({ version: 9, products: [{ id: 'MDH66', name: 'x', catId: 'cat_trd', price: 5 }] })); } catch (e) {} bobDB.transaction = realTx; return { ver: localStorage.getItem('bob_catalogue_version') }; });
      rec('S-66', 'master-data version held when durable persist fails', r.ver === '1', `version=${r.ver} (clean: 1 held; bug: 9 advanced on failed persist)`); await ctx.close(); }

    // S-67 (Wave H / H3 — GPTa-31): when the server ack verifies but the LOCAL _synced write FAILS,
    // the UI must NOT show "Synced ✓" and must keep pending=true (the old code lied + cleared pending).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', processedCount: 1 } : { items: [], serverTimestamp: 0 }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { let lastStatus = ''; Sync._showStatus = (msg) => { lastStatus = String(msg || ''); }; DB.markTransactionsSynced = async () => false; Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'h67_' + Date.now(), type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-06-14', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); try { await Sync.push(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 300)); return { lastStatus, pending: Sync._getPending() }; }, s);
      rec('S-67', 'markSynced-fail does not lie "Synced" + keeps pending', r.lastStatus.indexOf('Synced ✓') === -1 && r.pending === true, `status="${r.lastStatus}" pending=${r.pending} (clean: not-Synced + pending true)`); await ctx.close(); }

    // S-68 (Wave H / H4 — GPTC-D): backup import rejects a category id with forbidden chars (the
    // on-load sanitiser would mutate it and orphan the products pointing at it) AND a dangling
    // product.catId. A clean, self-consistent backup still imports.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const base = (extra) => Object.assign({ _meta: { app: 'bob-stock', backupFormat: Pages._BACKUP_FORMAT }, products: [{ id: 'p1', name: 'P', catId: 'c1' }], stores: [{ id: 's1', name: 'S' }], transactions: [], users: [], categories: [{ id: 'c1', name: 'C' }] }, extra || {}); const badCat = Pages._validateAndScrubBackup(base({ categories: [{ id: 'c1"x', name: 'C' }], products: [{ id: 'p1', name: 'P', catId: 'c1"x' }] })); const dangling = Pages._validateAndScrubBackup(base({ products: [{ id: 'p1', name: 'P', catId: 'NOPE' }] })); const good = Pages._validateAndScrubBackup(base()); return { badCatRejected: badCat.ok === false, danglingRejected: dangling.ok === false, goodAccepted: good.ok === true }; });
      rec('S-68', 'backup rejects bad category id + dangling catId; accepts clean', r.badCatRejected && r.danglingRejected && r.goodAccepted, `badCat=${r.badCatRejected} dangling=${r.danglingRejected} good=${r.goodAccepted}`); await ctx.close(); }

    // S-69 (Wave H / H5 — GPTc-4): receive() REJECTS over-receipt (received>sent) instead of
    // silently clamping the credit to sentQty and losing the excess units; a short receipt is fine.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const mkTr = (id, sent) => { const tr = { id, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: 'head_office', toStoreId: s.storeId, createdBy: Auth.actor(), createdByName: 't', status: 'in_transit', items: [{ productId: s.productId, sentQty: sent, receivedQty: null, status: 'pending', flagNote: '' }], receivedBy: null, notes: '' }; DB.get().transfers = DB.get().transfers || []; DB.get().transfers.push(tr); return tr; }; const trA = mkTr('h69a_' + Date.now(), 10); await DB.updateTransferDurable(trA, null); const over = await Transfer.receive(trA.id, [{ productId: s.productId, receivedQty: 12 }]); const trB = mkTr('h69b_' + Date.now(), 10); await DB.updateTransferDurable(trB, null); const under = await Transfer.receive(trB.id, [{ productId: s.productId, receivedQty: 8 }]); return { overRejected: over.ok === false, underAccepted: under.ok === true }; }, s);
      rec('S-69', 'receive rejects over-receipt, accepts short receipt', r.overRejected && r.underAccepted, `overRejected=${r.overRejected} underAccepted=${r.underAccepted} (clean: true+true)`); await ctx.close(); }

    // S-70 (Wave H / H5 — GPT-15/GCLI-7): completeFlags resolves ALL flagged lines in ONE atomic
    // write. A forced mid-batch failure commits NOTHING and rolls the transfer back (no half-
    // resolved state): write fails → zero ledger rows + status rolled back to 'received'.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const prods = d.products.filter(p => p.active).slice(0, 2); const pA = prods[0].id, pB = (prods[1] || prods[0]).id; const trId = 'h70_' + Date.now(); const tr = { id: trId, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: 'head_office', toStoreId: s.storeId, createdBy: Auth.actor(), createdByName: 't', status: 'received', items: [{ productId: pA, sentQty: 5, receivedQty: 3, status: 'flagged', creditedAtReceive: 3, flagNote: '' }, { productId: pB, sentQty: 5, receivedQty: 3, status: 'flagged', creditedAtReceive: 3, flagNote: '' }], receivedBy: Auth.actor(), notes: '' }; d.transfers = d.transfers || []; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); const realTx = bobDB.transaction.bind(bobDB); bobDB.transaction = () => Promise.reject(new Error('forced')); const realFatal = UI.fatalSaveError; UI.fatalSaveError = () => {}; const result = await Transfer.resolveAllFlags(trId, [{ productId: pA, action: 'accept_as_is' }, { productId: pB, action: 'accept_as_is' }]); bobDB.transaction = realTx; UI.fatalSaveError = realFatal; /* NO DB.refresh(): the in-memory snapshot rollback (db.js:736) is what we test — a refresh would reload the already-correct durable state and mask it (this exact mistake made S-70 BLIND on the first run) */ const committed = DB.get().transactions.filter(t => t.transferId === trId).length; const t2 = DB.get().transfers.find(x => x.id === trId); return { failed: result.ok === false, nothingCommitted: committed === 0, rolledBack: !!t2 && t2.status === 'received' }; }, s);
      rec('S-70', 'completeFlags batch all-or-nothing (failed write rolls back)', r.failed && r.nothingCommitted && r.rolledBack, `failed=${r.failed} nothingCommitted=${r.nothingCommitted} rolledBack=${r.rolledBack} (clean: all true)`); await ctx.close(); }
    // S-71 (Wave H follow-up / GPT BLOCK P2): a FAILED master-data persist rolls the CACHE back —
    // no cache-only catalogue (a new product / changed price in memory but not on disk). Without the
    // rollback, a movement saved against a cache-only product persists durably while the product
    // vanishes on the next refresh = orphaned ledger row. (H2 already holds the version; this is the
    // cache half of the same failure.)
    // Captures a LIVE product object reference BEFORE the merge and asserts it is restored IN PLACE —
    // an array-swap rollback would leave that captured object mutated (Gemini reference-drift finding).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const ref = DB.get().products.find(p => p.active); const pid = ref.id; const origPrice = ref.price; localStorage.setItem('bob_catalogue_version', '1'); const realFatal = UI.fatalSaveError; UI.fatalSaveError = () => {}; const realTx = bobDB.transaction.bind(bobDB); bobDB.transaction = () => Promise.reject(new Error('forced')); try { await Sync._applyMasterData(JSON.stringify({ version: 9, products: [{ id: pid, name: ref.name, catId: ref.catId, price: 123.45 }, { id: 'H2_NEW71', name: 'New71', catId: ref.catId, price: 50 }] })); } catch (e) {} bobDB.transaction = realTx; UI.fatalSaveError = realFatal; const newInCache = !!DB.get().products.find(p => p.id === 'H2_NEW71'); return { refRestored: ref.price === origPrice, newInCache, ver: localStorage.getItem('bob_catalogue_version') }; }, s);
      rec('S-71', 'failed master-data persist rolls cache back IN PLACE (no ref-drift, no cache-only row)', r.refRestored && r.newInCache === false && r.ver === '1', `refRestored=${r.refRestored} newInCache=${r.newInCache} version=${r.ver} (clean: true+false+1)`); await ctx.close(); }

    // S-72 (Wave H follow-up / GPT+Gemini BLOCK P2): the fatal-save overlay forces a full RELOAD —
    // no "Dismiss" that lets the user keep working in a transient cache-only state after a confirmed
    // durable write failure (the "stop-on-durable-failure" gate must be truly fatal).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { UI.fatalSaveError('probe detail'); const ov = document.getElementById('fatal-save-overlay'); const btn = ov && ov.querySelector('button'); const oc = btn ? (btn.getAttribute('onclick') || '') : ''; return { hasOverlay: !!ov, reloads: /location\.reload\(\)/.test(oc), notDismiss: !/display\s*=\s*['"]?none/.test(oc) }; });
      rec('S-72', 'fatal-save overlay forces reload (not dismissible)', r.hasOverlay && r.reloads && r.notDismiss, `overlay=${r.hasOverlay} reload=${r.reloads} notDismiss=${r.notDismiss} (clean: all true)`); await ctx.close(); }

    // S-73 (Wave H follow-up / Gemini BLOCK P2): a master-data durable-persist failure surfaces the
    // CATALOGUE-SPECIFIC fatal message (matching the per-call-site pattern). NOTE: _retryWrite already
    // trips a GENERIC fatal on any exhausted durable write, so we can't just assert "fatal was called"
    // (that's over-determined → BLIND on the first cut). We assert the specific message text, which
    // ONLY this call provides — removing it leaves the generic _retryWrite message (no "catalogue").
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { let lastDetail = null; const realFatal = UI.fatalSaveError; UI.fatalSaveError = (d) => { lastDetail = String(d == null ? '' : d); }; const ex = DB.get().products.find(p => p.active); const realTx = bobDB.transaction.bind(bobDB); bobDB.transaction = () => Promise.reject(new Error('forced')); try { await Sync._applyMasterData(JSON.stringify({ version: 9, products: [{ id: ex.id, name: ex.name, catId: ex.catId, price: 99 }] })); } catch (e) {} bobDB.transaction = realTx; UI.fatalSaveError = realFatal; return { lastDetail }; });
      rec('S-73', 'master-data failure shows the catalogue-specific fatal message', r.lastDetail !== null && /catalogue/i.test(r.lastDetail), `detail="${r.lastDetail}" (clean: contains "catalogue"; bug: generic _retryWrite msg)`); await ctx.close(); }
    // S-74 (Wave I / Tier 2 I-6): a FAILED durable delete rolls back BOTH the delete AND the
    // optimistic tombstone — the original stays, no orphan tombstone (atomic, both-or-neither).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const id = 'wi74_' + Date.now(); await DB.addTransactionDurable({ id, type: 'in', qty: 5, storeId: s.storeId, productId: s.productId, date: '2026-06-15', createdAt: new Date().toISOString() }); await DB.refresh(); const realTx = bobDB.transaction.bind(bobDB); bobDB.transaction = () => Promise.reject(new Error('forced')); const ok = await DB.removeTransactionDurable(id, { deletedBy: 't', deletedAt: new Date().toISOString(), deleteReason: 'x' }); bobDB.transaction = realTx; const origKept = DB.get().transactions.some(t => t.id === id); const orphanTomb = DB.get().transactions.some(t => t.type === 'deleted' && t.targetTransactionId === id); return { ok, origKept, orphanTomb }; }, s);
      rec('S-74', 'failed durable delete rolls back both (original kept, no orphan tombstone)', r.ok === false && r.origKept && !r.orphanTomb, `ok=${r.ok} origKept=${r.origKept} noOrphan=${!r.orphanTomb} (clean: false+true+true)`); await ctx.close(); }

    // S-75 (Wave I / Tier 2 I-1 + I-2): a delete with NO push URL still leaves a DURABLE unsynced
    // tombstone (carrying targetTransactionId + DeletedBy/At/Reason) — no early drop; push() sends it later.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Sync._pushUrl = null; const id = 'wi75_' + Date.now(); await DB.addTransactionDurable({ id, type: 'in', qty: 3, storeId: s.storeId, productId: s.productId, date: '2026-06-15', createdAt: new Date().toISOString() }); await DB.refresh(); const ok = await DB.removeTransactionDurable(id, { deletedBy: 'Kim', deletedAt: '2026-06-15T00:00:00Z', deleteReason: 'Mistake' }); await DB.refresh(); const tomb = DB.get().transactions.find(t => t.type === 'deleted' && t.targetTransactionId === id); return { ok, hasTomb: !!tomb, unsynced: tomb ? tomb._synced === false : false, meta: tomb ? (tomb.deletedBy === 'Kim' && tomb.deleteReason === 'Mistake') : false }; }, s);
      rec('S-75', 'no-URL delete leaves a durable unsynced tombstone with metadata', r.ok && r.hasTomb && r.unsynced && r.meta, `ok=${r.ok} hasTomb=${r.hasTomb} unsynced=${r.unsynced} meta=${r.meta} (clean: all true)`); await ctx.close(); }

    // S-76 (Wave I / Tier 2 I-5 — ghost resurrection): a SINGLE pull batch carrying [create X, delete X]
    // must end with X DELETED, not resurrected (merge-new-first, then apply tombstones post-merge).
    { let SID = '', PID = ''; const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', processedCount: 0 } : { items: [ { TransactionId: 'GHOST76', Type: 'in', Qty: 2, StoreId: SID, ProductId: PID, Date: '2026-06-15', DeviceId: 'OTHER76', SyncTimestamp: 500 }, { TransactionId: 'ts76', Type: 'deleted', Qty: 0, TargetTransactionId: 'GHOST76', StoreId: SID, ProductId: PID, Date: '2026-06-15', DeviceId: 'OTHER76', SyncTimestamp: 501 } ], serverTimestamp: 600, status: 'ok' }) }); });
      await waitBoot(page, repo); const s = await setup(page); SID = s.storeId; PID = s.productId;
      const r = await page.evaluate(async () => { Sync._pullUrl = 'https://x.logic.azure.com/pull'; Sync._syncLock = false; Sync._lastSyncAt = 100; try { await Sync.pull(); } catch (e) {} await new Promise(r => setTimeout(r, 300)); await DB.refresh(); return { present: DB.get().transactions.some(t => t.id === 'GHOST76') }; });
      rec('S-76', 'same-batch create+delete does not resurrect (pull applies tombstones post-merge)', r.present === false, `ghostPresent=${r.present} (clean: false — deleted; bug: true — resurrected)`); await ctx.close(); }

    // S-77 (Wave I / Tier 2 I-4): the launch TTL prune drops SYNCED tombstones older than 30 days,
    // and KEEPS recent ones + unsynced ones (never drop an unconfirmed delete).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const old = Date.now() - 40 * 24 * 60 * 60 * 1000; const mk = (id, synced, syncedAt) => ({ id, type: 'deleted', qty: 0, targetTransactionId: id + '_t', storeId: s.storeId, productId: s.productId, date: '2026-05-01', createdAt: new Date(synced ? syncedAt : old).toISOString(), _synced: synced, _syncedAt: synced ? syncedAt : undefined }); await bobDB.transactions.bulkPut([mk('del_old77', true, old), mk('del_recent77', true, Date.now()), mk('del_unsynced77', false, 0)]); await DB.refresh(); await DB.pruneSyncedTombstones(); await DB.refresh(); const has = id => DB.get().transactions.some(t => t.id === id); return { oldGone: !has('del_old77'), recentKept: has('del_recent77'), unsyncedKept: has('del_unsynced77') }; }, s);
      rec('S-77', 'TTL prune drops old synced tombstones, keeps recent + unsynced', r.oldGone && r.recentKept && r.unsyncedKept, `oldGone=${r.oldGone} recentKept=${r.recentKept} unsyncedKept=${r.unsyncedKept} (clean: all true)`); await ctx.close(); }

    // S-78 (Wave I / Tier 2 I-2): _toSharePoint serialises the tombstone audit metadata
    // (DeletedBy/DeletedAt/DeleteReason), not just TargetTransactionId.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const sp = Sync._toSharePoint({ id: 'del_x', type: 'deleted', qty: 0, targetTransactionId: 'orig', deletedBy: 'Sam', deletedAt: '2026-06-15T00:00:00Z', deleteReason: 'Double entry', date: '2026-06-15' }); return { tgt: sp.TargetTransactionId === 'orig', by: sp.DeletedBy === 'Sam', at: sp.DeletedAt === '2026-06-15T00:00:00Z', reason: sp.DeleteReason === 'Double entry' }; });
      rec('S-78', '_toSharePoint maps tombstone audit metadata', r.tgt && r.by && r.at && r.reason, `tgt=${r.tgt} by=${r.by} at=${r.at} reason=${r.reason} (clean: all true)`); await ctx.close(); }

    // S-79 (Wave I / Tier 2, GPT): the leader's periodic poll() also DRAINS pending (pushes), not just
    // pulls — so a tombstone whose 'local-write' BC signal was missed still gets sent.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(async () => { Sync._isLeader = true; Sync._setPending(true); let pushed = false; const realPush = Sync.push.bind(Sync); const realPull = Sync.pull.bind(Sync); Sync.pull = async () => {}; Sync.push = async () => { pushed = true; }; try { await Sync.poll(); } catch (e) {} Sync.push = realPush; Sync.pull = realPull; return { pushed }; });
      rec('S-79', 'leader poll() drains pending (pushes), not just pulls', r.pushed === true, `pushed=${r.pushed} (clean: true)`); await ctx.close(); }

    // S-80 (Wave I / Tier 2, GPT inertness): a type:'deleted' tombstone row stays INERT in
    // reporting — direction 'none', not "active", zero stock effect — so it can never leak into a sum.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const base = Stock.qty(s.productId, s.storeId); DB.get().transactions.push({ id: 'del_inert80', type: 'deleted', qty: 0, targetTransactionId: 'x', storeId: s.storeId, productId: s.productId, date: '2026-06-15', createdAt: new Date().toISOString(), _synced: false }); Stock._buildCache(); return { stockUnchanged: Stock.qty(s.productId, s.storeId) === base, isActive: Txn.isActive({ type: 'deleted' }), dir: Txn.classify({ type: 'deleted' }).direction }; }, s);
      rec('S-80', 'tombstone is inert in reporting (direction none, not active, no stock effect)', r.stockUnchanged && r.isActive === false && r.dir === 'none', `stockUnchanged=${r.stockUnchanged} isActive=${r.isActive} dir=${r.dir} (clean: true+false+none)`); await ctx.close(); }

    // S-81 (Wave I follow-up / GPT+Gemini code re-audit): the NON-durable removeTransaction rolls the
    // cache back to match disk if its background delete+tombstone write fails (parity with the durable
    // path). Fire-and-forget, so the rollback fires in the .then AFTER the retry cycle (~3.5s: 500+1000+2000).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const id = 'wi81_' + Date.now(); await DB.addTransactionDurable({ id, type: 'in', qty: 4, storeId: s.storeId, productId: s.productId, date: '2026-06-15', createdAt: new Date().toISOString() }); await DB.refresh(); const realTx = bobDB.transaction.bind(bobDB); bobDB.transaction = () => Promise.reject(new Error('forced')); DB.removeTransaction(id, { deletedBy: 't', deletedAt: new Date().toISOString(), deleteReason: 'x' }); await new Promise(r => setTimeout(r, 5000)); bobDB.transaction = realTx; const origRestored = DB.get().transactions.some(t => t.id === id); const noTomb = !DB.get().transactions.some(t => t.type === 'deleted' && t.targetTransactionId === id); return { origRestored, noTomb }; }, s);
      rec('S-81', 'non-durable removeTransaction rolls back cache on failed background write', r.origRestored && r.noTomb, `origRestored=${r.origRestored} noTomb=${r.noTomb} (clean: true+true)`); await ctx.close(); }

    // S-82 (Wave J / Tier 3 — ingest reject, backup): _validateAndScrubBackup REJECTS a backup whose
    // transaction/transfer (or other ledger) id carries a breakout char; a clean backup still imports.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const base = () => ({ _meta: { app: 'bob-stock', backupFormat: Pages._BACKUP_FORMAT }, products: [{ id: 'p', name: 'P' }], stores: [{ id: 's', name: 'S' }], categories: [{ id: 'c', name: 'C' }], users: [], transactions: [] }); const badTxn = Pages._validateAndScrubBackup(Object.assign(base(), { transactions: [{ id: "x');evil();//", date: '2026-06-15', storeId: 's', productId: 'p', type: 'in', qty: 1 }] })); const badTransfer = Pages._validateAndScrubBackup(Object.assign(base(), { transfers: [{ id: "tr<img>" }] })); const good = Pages._validateAndScrubBackup(base()); return { badTxnRejected: badTxn.ok === false, badTransferRejected: badTransfer.ok === false, goodAccepted: good.ok === true }; });
      rec('S-82', 'backup import rejects hostile ledger ids', r.badTxnRejected && r.badTransferRejected && r.goodAccepted, `badTxn=${r.badTxnRejected} badTransfer=${r.badTransferRejected} good=${r.goodAccepted} (clean: all true)`); await ctx.close(); }

    // S-83 (Wave J / Tier 3 — ingest reject, sync): the raw-row id gate quarantines a hostile TransactionId
    // AND a hostile TransferId on a row whose TransactionId is otherwise BENIGN (so it WOULD merge but for
    // the multi-field check) — proving all 3 id fields are validated BEFORE the tombstone split (the
    // tombstone branch skips _fromSharePoint). A 3rd item is a tombstone with a hostile TargetTransactionId.
    { let SID = '', PID = ''; const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', processedCount: 0 } : { items: [ { TransactionId: "evil');x();//", Type: 'in', Qty: 1, StoreId: SID, ProductId: PID, Date: '2026-06-15', DeviceId: 'OTHER83', SyncTimestamp: 500 }, { TransactionId: 'okrow_tj83', TransferId: "tr');x();//", Type: 'in', Qty: 1, StoreId: SID, ProductId: PID, Date: '2026-06-15', DeviceId: 'OTHER83', SyncTimestamp: 501 }, { TransactionId: 'ts83_ok', Type: 'deleted', TargetTransactionId: "tgt<img>", StoreId: SID, ProductId: PID, Date: '2026-06-15', DeviceId: 'OTHER83', SyncTimestamp: 502 } ], serverTimestamp: 600, status: 'ok' }) }); });
      await waitBoot(page, repo); const s = await setup(page); SID = s.storeId; PID = s.productId;
      // Read DISK (Dexie) directly, NOT DB.get() after a refresh: refresh() now re-quarantines (F1 fix), which
      // would mask whether the SYNC gate did its job (the S-70 lesson). Disk reflects what was actually ingested.
      const r = await page.evaluate(async () => { Sync._pullUrl = 'https://x.logic.azure.com/pull'; Sync._syncLock = false; Sync._lastSyncAt = 100; try { await Sync.pull(); } catch (e) {} await new Promise(r => setTimeout(r, 300)); const disk = await bobDB.transactions.toArray(); const evilMerged = disk.some(t => String(t.id).indexOf('evil') === 0); const badTransferMerged = disk.some(t => t.id === 'okrow_tj83' || (t.transferId && /[^A-Za-z0-9_-]/.test(String(t.transferId)))); return { evilNotMerged: !evilMerged, transferIdNotMerged: !badTransferMerged }; });
      rec('S-83', 'sync pull quarantines hostile TransactionId AND TransferId on the raw row (pre-tombstone-split)', r.evilNotMerged && r.transferIdNotMerged, `evilNotMerged=${r.evilNotMerged} transferIdNotMerged=${r.transferIdNotMerged} (clean: both true)`); await ctx.close(); }

    // S-84 (Wave J / Tier 3 — load-time quarantine): an ALREADY-stored hostile-id row is dropped from
    // the active cache by quarantineUnsafeLedgerIds (so it never reaches a render sink); disk untouched.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const evil = { id: "x');alert(1);//", type: 'in', qty: 5, storeId: s.storeId, productId: s.productId, date: '2026-06-15', createdAt: new Date().toISOString() }; DB.get().transactions.push(evil); const before = DB.get().transactions.some(t => t.id === evil.id); DB.quarantineUnsafeLedgerIds(); const after = DB.get().transactions.some(t => t.id === evil.id); return { before, removed: !after }; }, s);
      rec('S-84', 'load-time quarantine drops hostile-id rows from cache', r.before && r.removed, `before=${r.before} removed=${r.removed} (clean: true+true)`); await ctx.close(); }

    // S-85 (Wave J / Tier 3 — RENDER, the headline): a transaction whose id is an XSS payload does NOT
    // execute when its delete button is clicked — the id rides in data-id (UI.esc'd) and the handler
    // reads this.dataset.id (string), never interpolated into the JS string. (The blind audit proved
    // executed:true on the old inline interpolation; this proves executed:false.)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { window.__xssJ = 0; const evilId = "1');window.__xssJ=1;//"; if (!document.getElementById('today-movements')) { const div = document.createElement('div'); div.id = 'today-movements'; document.body.appendChild(div); } const d = DB.get(); d.transactions.push({ id: evilId, date: UI.todayLocal(), storeId: s.storeId, productId: s.productId, type: 'in', qty: 1, staffName: 'x', reason: '', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); Pages._logData = { selectedStoreId: s.storeId }; Pages._renderTodayMovements(); const btn = Array.from(document.querySelectorAll('#today-movements button')).find(b => /Delete/.test(b.textContent)); let clicked = false; if (btn) { btn.click(); clicked = true; } try { if (UI.closeModal) UI.closeModal(); } catch (e) {} await new Promise(r => setTimeout(r, 50)); return { clicked, xss: window.__xssJ }; }, s);
      rec('S-85', 'hostile ledger id does NOT execute on click (Safe Inline render)', r.clicked && r.xss === 0, `clicked=${r.clicked} xssFired=${r.xss} (clean: clicked + xss 0; bug: xss 1)`); await ctx.close(); }

    // S-86 (Wave J / Tier 3 — GPT code re-audit F1): DB.refresh() runs after every sync pull and re-hydrates
    // the cache from Dexie; because quarantine is non-destructive (disk keeps the row), refresh MUST re-apply
    // it or a pre-fix hostile on-disk row re-enters the active cache. Write a hostile-id row straight to Dexie,
    // refresh, assert it's gone from the cache BUT still on disk (non-destructive).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const evilId = "x');refreshXSS();//"; await bobDB.transactions.put({ id: evilId, type: 'in', qty: 3, storeId: s.storeId, productId: s.productId, date: '2026-06-15', createdAt: new Date().toISOString() }); await DB.refresh(); const present = DB.get().transactions.some(t => t.id === evilId); const onDisk = !!(await bobDB.transactions.get(evilId)); return { quarantined: !present, onDisk }; }, s);
      rec('S-86', 'refresh() re-quarantines a hostile on-disk row (non-destructive)', r.quarantined && r.onDisk, `quarantinedFromCache=${r.quarantined} stillOnDisk=${r.onDisk} (clean: true+true — hidden from cache, disk untouched)`); await ctx.close(); }

    // S-87 (Wave J / Tier 3 — GPT code re-audit F2): _doAddProduct enforces the SAME allowlist as the ledger,
    // because a product id is embedded raw into cost-history LEDGER ids (ch_<ms>_<productId>) — a looser id
    // (dot/space/slash) would make its cost-history fail _isSafeLedgerId and get quarantined. Bad id rejected,
    // clean id added.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { await Pages._doAddProduct('MKU.evil 1', 'Bad', null, 10, null); const badAdded = DB.get().products.some(p => p.id === 'MKU.evil 1'); await Pages._doAddProduct('MKU_clean99', 'Good', null, 10, null); const goodAdded = DB.get().products.some(p => p.id === 'MKU_clean99'); return { badRejected: !badAdded, goodAdded }; });
      rec('S-87', 'product-id creation enforces the ledger allowlist (no embed divergence)', r.badRejected && r.goodAdded, `badRejected=${r.badRejected} goodAdded=${r.goodAdded} (clean: true+true)`); await ctx.close(); }

    // S-88 (Wave J / Tier 3 — GPT code re-audit F2-followup): backup import applies the product-id allowlist
    // too (not just the UI add path) — a backup product id with a dot/space would mint a cost-history ledger
    // id (ch_<ms>_<productId>) that _isSafeLedgerId later quarantines. Loose product id rejects; clean imports.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const base = () => ({ _meta: { app: 'bob-stock', backupFormat: Pages._BACKUP_FORMAT }, products: [{ id: 'p', name: 'P' }], stores: [{ id: 's', name: 'S' }], categories: [{ id: 'c', name: 'C' }], users: [], transactions: [] }); const badProd = Pages._validateAndScrubBackup(Object.assign(base(), { products: [{ id: 'MKU.1 evil', name: 'X' }] })); const good = Pages._validateAndScrubBackup(base()); return { badProdRejected: badProd.ok === false, goodAccepted: good.ok === true }; });
      rec('S-88', 'backup import rejects product ids outside the ledger allowlist', r.badProdRejected && r.goodAccepted, `badProdRejected=${r.badProdRejected} good=${r.goodAccepted} (clean: both true)`); await ctx.close(); }

    // S-89 (Wave J / Tier 3 — GPT code re-audit F2-followup): SharePoint master_data sync applies the same
    // allowlist — a synced product row with a loose id is SKIPPED (not merged), so it can't mint a quarantined
    // cost-history ledger id. A clean product still merges.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { try { localStorage.setItem('bob_catalogue_version', '0'); } catch (e) {} await Sync._applyMasterData({ version: 999999, products: [{ id: 'MKU.evil 9', name: 'Bad Prod' }, { id: 'MKU_ok9', name: 'Good Prod' }] }); const prods = DB.get().products; return { looseRejected: !prods.some(p => p.id === 'MKU.evil 9'), cleanMerged: prods.some(p => p.id === 'MKU_ok9') }; });
      rec('S-89', 'master_data sync skips product ids outside the ledger allowlist', r.looseRejected && r.cleanMerged, `looseRejected=${r.looseRejected} cleanMerged=${r.cleanMerged} (clean: both true)`); await ctx.close(); }

    // S-90 (Wave J / Tier 3 — GPT FINAL deep audit, length-coupling): a delivery's cost-history id is now an
    // OPAQUE suffix (ch_<ms>_<hex>), NOT ch_<ms>_<productId>. Product-id ingress checks charset but not length
    // (<=128 only applies to the LEDGER validator), so a 121-char product id used to mint a 138-char ch_ id
    // that _isSafeLedgerId then quarantined (present on disk, hidden from cache). Decoupling kills it at root.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { const longId = 'L' + 'A'.repeat(120); try { await Pages._doAddProduct(longId, 'Long Prod', null, 5, null); } catch (e) {} const productAdded = DB.get().products.some(p => p.id === longId); const mk = (id, val) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = val; return e; }; mk('del-supplier', 'TestSup'); mk('del-date', '2026-06-16'); mk('del-invoice', ''); mk('del-freight', ''); mk('del-tax', ''); mk('del-shipping', ''); Pages._delLines = [{ productId: longId, qty: 1, unitCost: 5, packaging: 0, labelling: 0, weightGrams: 0 }]; Pages._delSaving = false; try { await Pages._saveDelivery(); } catch (e) {} const beforeRefresh = DB.get().costHistory.some(h => h.productId === longId); await DB.refresh(); const afterRefresh = DB.get().costHistory.some(h => h.productId === longId); return { productAdded, beforeRefresh, afterRefresh }; });
      rec('S-90', 'delivery cost-history id is opaque — a long product id cannot mint a quarantined ledger id', r.productAdded && r.beforeRefresh && r.afterRefresh, `productAdded=${r.productAdded} costCreated=${r.beforeRefresh} survivesRefresh=${r.afterRefresh} (clean: all true; bug: survivesRefresh false)`); await ctx.close(); }

    // S-91 (Wave J / Tier 3 — GPT FINAL deep audit, harness symmetry with S-90): the SECOND cost-history
    // write path — _saveDeliveryPackaging (packaging/labelling edit) — must ALSO use an opaque id. Create a
    // delivery with a 121-char product id, then edit its packaging (raises landed cost → cost-history push);
    // the packaging-update cost row must survive refresh quarantine (opaque id), proving 4510 is decoupled too.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { const longId = 'P' + 'B'.repeat(120); try { await Pages._doAddProduct(longId, 'Long2', null, 5, null); } catch (e) {} const mk = (id, val) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = val; return e; }; mk('del-supplier', 'Sup2'); mk('del-date', '2026-06-16'); mk('del-invoice', ''); mk('del-freight', ''); mk('del-tax', ''); mk('del-shipping', ''); Pages._delLines = [{ productId: longId, qty: 1, unitCost: 5, packaging: 0, labelling: 0, weightGrams: 0 }]; Pages._delSaving = false; try { await Pages._saveDelivery(); } catch (e) {} const del = DB.get().deliveries.slice(-1)[0]; const delId = del && del.id; mk('epkg-0', '7'); mk('elab-0', '0'); Pages._pkgSaving = false; try { await Pages._saveDeliveryPackaging(delId); } catch (e) {} const pkgRow = h => h.productId === longId && /updated/i.test(h.notes || ''); /* "updated" appears ONLY in the packaging-edit note (4510), NOT the new-delivery note (4366, which says "...packaging, labelling)") — else the opaque delivery row masks this assertion = BLIND */ const beforeRefresh = DB.get().costHistory.some(pkgRow); await DB.refresh(); const afterRefresh = DB.get().costHistory.some(pkgRow); return { delId: !!delId, beforeRefresh, afterRefresh }; });
      rec('S-91', 'packaging-edit cost-history id is opaque too (length-coupling, second path)', r.delId && r.beforeRefresh && r.afterRefresh, `delivery=${r.delId} pkgCostCreated=${r.beforeRefresh} survivesRefresh=${r.afterRefresh} (clean: all true; bug: survivesRefresh false)`); await ctx.close(); }

    // S-92 (Wave K / Tier 4 — category root-fix + stock-math invariance): Txn.category derives the TRUE
    // category from type+stockTo (a coarse type:'out' is sale/wastage/transfer/internal by destination);
    // a no-stockTo row falls to 'other_out', never silently 'sale'. AND it's reporting-only — every OUT
    // still has direction 'out', so Stock.qty (= ΣIN−ΣOUT) is unchanged across all categories.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const F = [{ type: 'in', qty: 20 }, { type: 'out', qty: 2, stockTo: 'Customer Sale' }, { type: 'out', qty: 1, stockTo: 'Wastage/Damage' }, { type: 'out', qty: 1, stockTo: 'Same Store (In-House Use)' }, { type: 'out', qty: 1, stockTo: 'Store Transfer' }, { type: 'out', qty: 3 }, { type: 'out', qty: 1, stockTo: 'Store Transfer', reason: 'Wastage' }, { type: 'out', qty: 1, stockTo: 'Same Store (In-House Use)', reason: 'Wastage' }, { type: 'out', qty: 1, reason: 'Wastage' }]; const expected = ['delivery', 'sale', 'wastage', 'internal', 'transfer', 'other_out', 'transfer', 'internal', 'other_out']; const catsOk = F.every((f, i) => Txn.category(f) === expected[i]); const dirOutOk = F.slice(1).every(f => Txn.classify(f).direction === 'out'); const before = Stock.qty(s.productId, s.storeId); const d = DB.get(); F.forEach((f, i) => d.transactions.push(Object.assign({ id: 'k92_' + i, storeId: s.storeId, productId: s.productId, date: '2026-06-16', createdAt: new Date().toISOString() }, f))); if (Stock._buildCache) Stock._buildCache(); const after = Stock.qty(s.productId, s.storeId); return { catsOk, dirOutOk, delta: after - before }; }, s);
      rec('S-92', 'Txn.category: per-category labels (destination authoritative, reason never overrides) + stock-math invariance', r.catsOk && r.dirOutOk && r.delta === 9, `catsOk=${r.catsOk} dirOutOk=${r.dirOutOk} qtyDelta=${r.delta} (clean: true/true/9)`); await ctx.close(); }

    // S-93 (Wave K / Tier 4 — stock type): Stock.stockTypeOf returns Retail vs Consumable — explicit
    // product.stockType wins; else derived from internalUse (true -> consumable). Drives keeping
    // consumables OUT of sell-through/gross-sales while still costing/expiry-tracking them.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { return { consumableByFlag: Stock.stockTypeOf({ internalUse: true }) === 'consumable', retailByDefault: Stock.stockTypeOf({}) === 'retail', explicitWins: Stock.stockTypeOf({ stockType: 'retail', internalUse: true }) === 'retail' }; });
      rec('S-93', 'Stock.stockTypeOf: internalUse->consumable, default retail, explicit wins', r.consumableByFlag && r.retailByDefault && r.explicitWins, `consumable=${r.consumableByFlag} retailDefault=${r.retailByDefault} explicitWins=${r.explicitWins} (clean: all true)`); await ctx.close(); }

    // S-94 (Wave K / Tier 4 #9): the wastage report/CSV/dashboard share Pages._wastageTxns = category==='wastage'
    // ONLY. A genuine wastage (out -> Wastage/Damage) is counted; a transfer_out that happens to carry a
    // 'Wastage' reason is NOT (the old "any OUT with a wastage reason" string-match wrongly counted it).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const base = { storeId: s.storeId, productId: s.productId, date: '2026-06-16', createdAt: new Date().toISOString() }; d.transactions.push(Object.assign({ id: 'w94_real', type: 'out', qty: 1, stockTo: 'Wastage/Damage' }, base), Object.assign({ id: 'w94_xfer', type: 'transfer_out', qty: 1, reason: 'Wastage' }, base), Object.assign({ id: 'w94_xfer2', type: 'out', qty: 1, stockTo: 'Store Transfer', reason: 'Wastage' }, base)); const w = Pages._wastageTxns(d); return { includesGenuine: w.some(t => t.id === 'w94_real'), excludesTransfer: !w.some(t => t.id === 'w94_xfer'), excludesXfer2: !w.some(t => t.id === 'w94_xfer2') }; }, s);
      rec('S-94', 'wastage report counts category==wastage only (excludes transfer_out AND out+Store-Transfer that carry a wastage reason)', r.includesGenuine && r.excludesTransfer && r.excludesXfer2, `includesGenuine=${r.includesGenuine} excludesTransfer=${r.excludesTransfer} excludesXfer2=${r.excludesXfer2} (clean: all true)`); await ctx.close(); }

    // S-95 (Wave K / Tier 4 — GPT P3): Stock.stockTypeOf SURFACES an invalid explicit stockType as
    // 'unknown' (e.g. a typo'd 'consumble'), never silently 'retail' — so a mis-set type can't quietly
    // let a non-retail product leak into sell-through/gross-sales as retail. Valid values still resolve.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { return { invalidIsUnknown: Stock.stockTypeOf({ stockType: 'consumble', internalUse: false }) === 'unknown', validStillWorks: Stock.stockTypeOf({ stockType: 'consumable' }) === 'consumable' }; });
      rec('S-95', 'stockTypeOf surfaces an invalid explicit stockType as unknown (never silently retail)', r.invalidIsUnknown && r.validStillWorks, `invalidIsUnknown=${r.invalidIsUnknown} validStillWorks=${r.validStillWorks} (clean: both true)`); await ctx.close(); }

    // S-97 (Wave K / Tier 4 — Gross Sales): Pages._grossSales counts customer SALES minus RETURNS only;
    // wastage / transfers / in-house are NOT sales (the #9d bug counted every outflow). price×qty.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.price = 10; const consId = 'gs_cons'; if (!d.products.find(x => x.id === consId)) d.products.push({ id: consId, name: 'GSWax', catId: null, price: 10, internalUse: true, active: true }); if (Stock._buildCache) Stock._buildCache(); const base = { storeId: s.storeId, date: '2026-06-16', createdAt: new Date().toISOString() }; const txns = [Object.assign({ id: 'gs1', type: 'out', qty: 2, stockTo: 'Customer Sale', productId: s.productId }, base), Object.assign({ id: 'gs2', type: 'return_in', qty: 1, stockFrom: 'Customer', productId: s.productId }, base), Object.assign({ id: 'gs3', type: 'return_in', qty: 1, stockFrom: 'Another Store', productId: s.productId }, base), Object.assign({ id: 'gs4', type: 'out', qty: 5, stockTo: 'Wastage/Damage', productId: s.productId }, base), Object.assign({ id: 'gs5', type: 'out', qty: 9, stockTo: 'Customer Sale', productId: consId }, base)]; return { gs: Pages._grossSales(txns), expected: (2 - 1) * 10 }; }, s);
      rec('S-97', 'Gross Sales = retail sales − CUSTOMER returns only (wastage/store-return/consumable excluded)', r.gs === r.expected, `gross=${r.gs} expected=${r.expected} (clean: 10)`); await ctx.close(); }

    // S-98 (Wave K / Tier 4 — Total Cost used): Pages._costUsed sums cost-at-time of stock CONSUMED
    // (sale + in-house/demo + wastage); transfers + adjustments are NOT a cost.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.costPrice = 4; if (Stock._buildCache) Stock._buildCache(); const base = { storeId: s.storeId, productId: s.productId, date: '2026-06-16', createdAt: new Date().toISOString() }; const txns = [Object.assign({ id: 'cu1', type: 'out', qty: 2, stockTo: 'Customer Sale' }, base), Object.assign({ id: 'cu2', type: 'out', qty: 1, stockTo: 'Same Store (In-House Use)' }, base), Object.assign({ id: 'cu3', type: 'out', qty: 1, stockTo: 'Wastage/Damage' }, base), Object.assign({ id: 'cu4', type: 'out', qty: 3, stockTo: 'Store Transfer' }, base), Object.assign({ id: 'cu5', type: 'adjustment_out', qty: 2 }, base)]; return { cu: Pages._costUsed(txns), expected: (2 + 1 + 1) * 4 }; }, s);
      rec('S-98', 'Total Cost (used) = cost-at-time of sale+demo+wastage (transfer/adjustment excluded)', r.cu === r.expected, `costUsed=${r.cu} expected=${r.expected} (clean: 16)`); await ctx.close(); }

    // S-99 (Wave K / Tier 4 #13): sell-through aggregation — sold = customer SALES only (a wastage out is
    // NOT counted as sold), received = transfer-in for a single store, and CONSUMABLES are excluded entirely.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const consId = 'cons_st99'; if (!d.products.find(p => p.id === consId)) d.products.push({ id: consId, name: 'Wax99', catId: null, price: 5, internalUse: true, active: true, costPrice: 1 }); if (Stock._buildCache) Stock._buildCache(); const base = { storeId: s.storeId, date: '2026-06-16', createdAt: new Date().toISOString() }; d.transactions.push(Object.assign({ id: 'st99rin', type: 'transfer_in', qty: 10, productId: s.productId }, base), Object.assign({ id: 'st99sale', type: 'out', qty: 4, stockTo: 'Customer Sale', productId: s.productId }, base), Object.assign({ id: 'st99wst', type: 'out', qty: 2, stockTo: 'Wastage/Damage', productId: s.productId }, base), Object.assign({ id: 'st99cons', type: 'out', qty: 3, stockTo: 'Customer Sale', productId: consId }, base), Object.assign({ id: 'st99del', type: 'in', qty: 20, productId: s.productId, storeId: 'head_office' }, { date: '2026-06-16', createdAt: new Date().toISOString() })); const a = Pages._sellThroughAgg(d, new Set([s.storeId]), '2026-01-01', false)[s.productId] || { in: 0, out: 0 }; const cw = Pages._sellThroughAgg(d, new Set(['head_office', s.storeId]), '2026-01-01', true)[s.productId] || { in: 0, out: 0 }; const consAgg = Pages._sellThroughAgg(d, new Set([s.storeId]), '2026-01-01', false)[consId]; return { soldSalesOnly: a.out === 4, receivedTransferIn: a.in === 10, consumableExcluded: !consAgg, cwDeliveryReceived: cw.in === 20 }; }, s);
      rec('S-99', 'sell-through agg: sold=sales-only, received=transfer-in (store) / delivery (company-wide), consumables excluded', r.soldSalesOnly && r.receivedTransferIn && r.consumableExcluded && r.cwDeliveryReceived, `sold4=${r.soldSalesOnly} recvd10=${r.receivedTransferIn} consExcl=${r.consumableExcluded} cwDeliv20=${r.cwDeliveryReceived} (clean: all true)`); await ctx.close(); }

    // S-100 (Wave K / Tier 4): on-hand value at cost = Σ (current stock × current cost) per store.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.costPrice = 3; if (Stock._buildCache) Stock._buildCache(); const before = Pages._stockOnHandCost(s.storeId); d.transactions.push({ id: 'oh1', type: 'in', qty: 4, storeId: s.storeId, productId: s.productId, date: '2026-06-16', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); const after = Pages._stockOnHandCost(s.storeId); return { delta: after - before, expected: 4 * 3 }; }, s);
      rec('S-100', 'on-hand value at cost = stock × current cost', r.delta === r.expected, `delta=${r.delta} expected=${r.expected} (clean: 12)`); await ctx.close(); }

    // S-101 (Wave K / Tier 4 — GPT K2-P2): Txn.category for type:'in' distinguishes a manual TRANSFER-in
    // (stockFrom = HO Warehouse / Another Store / Franchise Office) from a supplier DELIVERY (Supplier / none).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { return { inHO: Txn.category({ type: 'in', stockFrom: 'HO Warehouse' }) === 'transfer', inStoreSuffixed: Txn.category({ type: 'in', stockFrom: 'Another Store — Booragoon' }) === 'transfer', inFranOffice: Txn.category({ type: 'in', stockFrom: 'Franchise Office' }) === 'transfer', supplierDelivery: Txn.category({ type: 'in', stockFrom: 'Supplier' }) === 'delivery', bareDelivery: Txn.category({ type: 'in' }) === 'delivery', outTransferSuffixed: Txn.category({ type: 'out', stockTo: 'Store Transfer — Booragoon' }) === 'transfer' }; });
      rec('S-101', 'Txn.category base-label: suffixed STOCK-IN from a location = transfer; supplier/bare = delivery; suffixed out-transfer = transfer', r.inHO && r.inStoreSuffixed && r.inFranOffice && r.supplierDelivery && r.bareDelivery && r.outTransferSuffixed, `inHO=${r.inHO} inStoreSfx=${r.inStoreSuffixed} inFran=${r.inFranOffice} supplier=${r.supplierDelivery} bare=${r.bareDelivery} outSfx=${r.outTransferSuffixed} (clean: all true)`); await ctx.close(); }

    // S-106 (Wave K3 / Tier 4 #10): franchise invoice bills the OFFICE for genuine HO supply ONLY — excludes
    // returns + adjustments (not supply), non-HO receipts (we didn't supply), and the shop's own receipts
    // (internal). Discount from the office. Here: 1 HO-supply line of 10 @ $100 less 25% = $750 owed.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const office = d.stores.find(x => x.isFranchise && x.isFranchiseOffice); const shop = d.stores.find(x => x.isFranchise && !x.isFranchiseOffice); if (!office || !shop) return { setup: false }; const p = d.products.find(x => x.id === s.productId); p.price = 100; p.franchiseDiscount = null; office.franchiseDiscount = 25; if (Stock._buildCache) Stock._buildCache(); const base = { productId: s.productId, date: '2026-06-16', createdAt: new Date().toISOString() }; d.transactions.push(Object.assign({ id: 'fi_ho', type: 'in', qty: 10, reason: 'Received from Head Office', storeId: office.id }, base), Object.assign({ id: 'fi_ret', type: 'return_in', qty: 3, reason: 'Received from Head Office', storeId: office.id }, base), Object.assign({ id: 'fi_adj', type: 'adjustment_in', qty: 2, reason: 'Received from Head Office', storeId: office.id }, base), Object.assign({ id: 'fi_sup', type: 'in', qty: 5, stockFrom: 'Supplier', reason: 'Supplier Delivery', storeId: office.id }, base), Object.assign({ id: 'fi_con', type: 'in', qty: 7, stockFrom: 'Supplier', reason: 'Received from Head Office', storeId: office.id }, base), Object.assign({ id: 'fi_shop', type: 'in', qty: 8, reason: 'Received from Franchise Office', storeId: shop.id }, base)); const data = Pages._franchiseInvoiceData(d, '2026-06-01', '2026-06-30'); const off = data.find(sd => sd.office.id === office.id); if (!off) return { found: false }; return { setup: true, found: true, onlyHO: off.lines.length === 1 && off.lines[0].qty === 10, owed: off.totalOwed, shopNotBilled: !data.some(sd => sd.office.id === shop.id) }; }, s);
      rec('S-106', 'franchise invoice bills OFFICE HO-supply only (no returns/adjustments/non-HO/shop-receipts) at office discount', r.setup && r.found && r.onlyHO && r.owed === 750 && r.shopNotBilled, `onlyHO=${r.onlyHO} owed=${r.owed} shopNotBilled=${r.shopNotBilled} (clean: onlyHO, owed 750, shop not billed)`); await ctx.close(); }

    // S-107 (Wave K3 / Tier 4): wastage valued at COST-at-time (not retail). Cost 30 × qty 2 = 60 (NOT 100×2=200).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.price = 100; p.costPrice = 30; if (Stock._buildCache) Stock._buildCache(); const base = { storeId: s.storeId, productId: s.productId, date: '2026-06-16', createdAt: new Date().toISOString() }; const wc = Pages._wastageCostTotal([Object.assign({ id: 'wc1', type: 'out', qty: 2, stockTo: 'Wastage/Damage' }, base)]); return { total: wc.total }; }, s);
      rec('S-107', 'wastage valued at cost-at-time, not retail (cost 30×2=60, not retail 100×2=200)', r.total === 60, `total=${r.total} (clean: 60 = cost×qty, NOT 200 = retail×qty)`); await ctx.close(); }

    // S-110 (Wave K4 / Tier 4 — FX): a foreign-currency delivery converts every cost to AUD at the entered
    // rate and stores AUD as the canonical (+ the foreign original for the invoice audit trail). USD@2: a
    // $100 line + $10 freight → AUD unit 200, landed 220; product.costPrice 220; currency.rate 2 recorded.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Pages.directorCosts = () => {}; Pages._recordDeliveryModal(); document.getElementById('del-supplier').value = 'FX Co'; document.getElementById('del-date').value = '2026-06-18'; document.getElementById('del-invoice').value = 'INV1'; document.getElementById('del-currency').value = 'USD'; document.getElementById('del-rate').value = '2'; document.getElementById('del-freight').value = '10'; document.getElementById('del-tax').value = '0'; document.getElementById('del-shipping').value = '0'; Pages._delLines = [{ productId: s.productId, qty: 1, unitCost: 100, weightGrams: 0, packaging: 0, labelling: 0 }]; const before = (DB.get().deliveries || []).length; await Pages._saveDelivery(); const dels = DB.get().deliveries || []; const del = dels[dels.length - 1]; const ln = del && del.lines[0]; const p = DB.get().products.find(x => x.id === s.productId); return { saved: dels.length === before + 1, unitAUD: ln && ln.unitCost, foreign: ln && ln.foreignUnitCost, landed: ln && ln.landedCostPerUnit, rate: del && del.currency && del.currency.rate, code: del && del.currency && del.currency.code, costPrice: p && p.costPrice }; }, s);
      rec('S-110', 'foreign delivery converts to AUD at rate (USD@2: unit 100→200, landed 220) + stores foreign original + rate', r.saved && r.unitAUD === 200 && r.foreign === 100 && r.landed === 220 && r.rate === 2 && r.code === 'USD' && r.costPrice === 220, `saved=${r.saved} unitAUD=${r.unitAUD} foreign=${r.foreign} landed=${r.landed} rate=${r.rate} cost=${r.costPrice} (clean: 200/100/220/2/220)`); await ctx.close(); }

    // S-111 (Wave K4 / Tier 4 — FX safety): a foreign delivery with an INVALID exchange rate (0) is REJECTED —
    // no delivery is written. Without the dedicated rate validator a rate of 0 would silently zero every cost.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Pages.directorCosts = () => {}; Pages._recordDeliveryModal(); document.getElementById('del-supplier').value = 'FX Co'; document.getElementById('del-date').value = '2026-06-18'; document.getElementById('del-currency').value = 'USD'; document.getElementById('del-freight').value = '0'; Pages._delLines = [{ productId: s.productId, qty: 1, unitCost: 100, weightGrams: 0, packaging: 0, labelling: 0 }]; const before = (DB.get().deliveries || []).length; document.getElementById('del-rate').value = '0'; await Pages._saveDelivery(); const afterBad = (DB.get().deliveries || []).length; document.getElementById('del-rate').value = '2'; await Pages._saveDelivery(); const afterGood = (DB.get().deliveries || []).length; return { rejectedBad: afterBad === before, acceptedGood: afterGood === before + 1 }; }, s);
      rec('S-111', 'foreign delivery with an invalid rate (0) is rejected; a valid rate then saves', r.rejectedBad && r.acceptedGood, `rejectedBad=${r.rejectedBad} acceptedGood=${r.acceptedGood} (clean: both true)`); await ctx.close(); }

    // S-112 (Wave K4 / Tier 4 — price snapshot): a sale freezes the sell price at log time (unitPriceAtTime);
    // Gross Sales values it at the FROZEN price even after the catalogue price later changes (10, not 99).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.price = 10; d.transactions.push({ id: 'k4in', storeId: s.storeId, productId: s.productId, type: 'in', qty: 5, date: '2026-06-01', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); Pages._logData = { productId: s.productId, type: 'out', qty: 1, staffName: 'T', reason: '', stockTo: 'Customer Sale', selectedStoreId: s.storeId }; Pages._getLogStoreId = () => s.storeId; await Pages._submitLog(); const sale = DB.get().transactions.find(t => t.productId === s.productId && Txn.category(t) === 'sale'); const stamped = sale && sale.unitPriceAtTime; p.price = 99; if (Stock._buildCache) Stock._buildCache(); const gs = Pages._grossSales(DB.get().transactions.filter(t => t.productId === s.productId)); return { stamped, gs }; }, s);
      rec('S-112', 'sale price is snapshotted at log time; Gross Sales uses the frozen price after a later price change (10, not 99)', r.stamped === 10 && r.gs === 10, `stamped=${r.stamped} grossAfterPriceChange=${r.gs} (clean: 10/10, bug: gs=99)`); await ctx.close(); }

    // S-113 (Wave K4 / Tier 4 — stock type): saving a product as Consumable writes the explicit stockType
    // AND clears the legacy internalUse flag, so isConsumableProduct reads the explicit value; flipping to
    // Retail writes retail (a stale internalUse:true must NOT force consumable).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.internalUse = true; p.stockType = undefined; Pages._editProductModal(s.productId); document.getElementById('ep-stocktype').value = 'consumable'; await Pages._saveEditProduct(s.productId); const p2 = DB.get().products.find(x => x.id === s.productId); const consumable = { stockType: p2.stockType, internalUse: p2.internalUse, isCons: Stock.isConsumableProduct(p2) }; Pages._editProductModal(s.productId); document.getElementById('ep-stocktype').value = 'retail'; await Pages._saveEditProduct(s.productId); const p3 = DB.get().products.find(x => x.id === s.productId); const retail = { stockType: p3.stockType, internalUse: p3.internalUse, isRetail: Stock.isRetailProduct(p3) }; return { consumable, retail }; }, s);
      rec('S-113', 'edit-product save writes explicit stockType + clears internalUse (consumable then retail)', r.consumable.stockType === 'consumable' && r.consumable.internalUse === false && r.consumable.isCons && r.retail.stockType === 'retail' && r.retail.internalUse === false && r.retail.isRetail, `cons=${JSON.stringify(r.consumable)} retail=${JSON.stringify(r.retail)} (clean: consumable/false/true then retail/false/true)`); await ctx.close(); }

    // S-114 (Wave K4 / Tier 4 — GPT K4-P1 BLOCK): the per-component MONEY_MAX caps pass individually, but the
    // AGGREGATE landed cost (unit + packaging + labelling + header share) must ALSO be capped before it persists
    // into landedCostPerUnit/costHistory/product.costPrice. USD@2 with each component = 500000 → each AUD part
    // is exactly 1,000,000 (passes), but the sum is ~4,000,000 → the whole save must be REJECTED, nothing written.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Pages.directorCosts = () => {}; const p0 = DB.get().products.find(x => x.id === s.productId); p0.costPrice = null; Pages._recordDeliveryModal(); document.getElementById('del-supplier').value = 'Big'; document.getElementById('del-date').value = '2026-06-18'; document.getElementById('del-currency').value = 'USD'; document.getElementById('del-rate').value = '2'; document.getElementById('del-freight').value = '500000'; document.getElementById('del-tax').value = '0'; document.getElementById('del-shipping').value = '0'; Pages._delLines = [{ productId: s.productId, qty: 1, unitCost: 500000, weightGrams: 0, packaging: 500000, labelling: 500000 }]; const before = (DB.get().deliveries || []).length; await Pages._saveDelivery(); const after = (DB.get().deliveries || []).length; const p = DB.get().products.find(x => x.id === s.productId); return { rejected: after === before, costUnchanged: p.costPrice === null }; }, s);
      rec('S-114', 'delivery rejects an AGGREGATE landed cost over MONEY_MAX (each part ≤1M, sum ~4M) — nothing persisted', r.rejected && r.costUnchanged, `rejected=${r.rejected} costUnchanged=${r.costUnchanged} (clean: both true; bug: 4M cost persisted)`); await ctx.close(); }

    // S-115 (Wave K4 / Tier 4 — GPT K4-P1 BLOCK, packaging-edit path): same aggregate-overflow class in
    // _saveDeliveryPackaging. Start from a $600k unit cost, then edit packaging to $500k (each ≤1M, both pass
    // the per-field money cap) → recomputed landed 1.1M > MONEY_MAX → the edit must be REJECTED, landed unchanged.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Pages.directorCosts = () => {}; Pages._renderDeliveryHistory = () => {}; const p0 = DB.get().products.find(x => x.id === s.productId); p0.costPrice = null; Pages._recordDeliveryModal(); document.getElementById('del-supplier').value = 'Pkg'; document.getElementById('del-date').value = '2026-06-18'; document.getElementById('del-currency').value = 'AUD'; document.getElementById('del-freight').value = '0'; document.getElementById('del-tax').value = '0'; document.getElementById('del-shipping').value = '0'; Pages._delLines = [{ productId: s.productId, qty: 1, unitCost: 600000, weightGrams: 0, packaging: 0, labelling: 0 }]; await Pages._saveDelivery(); const dels = DB.get().deliveries; const del = dels[dels.length - 1]; const landedBefore = del.lines[0].landedCostPerUnit; Pages._editDeliveryPackaging(del.id); document.getElementById('epkg-0').value = '500000'; document.getElementById('elab-0').value = '0'; await Pages._saveDeliveryPackaging(del.id); const del2 = DB.get().deliveries.find(x => x.id === del.id); return { landedBefore, landedAfter: del2.lines[0].landedCostPerUnit, unchanged: del2.lines[0].landedCostPerUnit === landedBefore }; }, s);
      rec('S-115', 'packaging-edit rejects an aggregate landed cost over MONEY_MAX (landed unchanged at 600000)', r.unchanged && r.landedBefore === 600000, `landedBefore=${r.landedBefore} landedAfter=${r.landedAfter} (clean: unchanged 600000; bug: ~1.1M persisted)`); await ctx.close(); }

    // S-116 (Wave K4 / Tier 4 — GPT P1 re-audit, second ingress): backup restore must validate cost-HISTORY
    // costPrice, because Stock.costAtDate PREFERS a cost-history row over product.costPrice. A backup carrying a
    // costHistory.costPrice over MONEY_MAX is REJECTED; a within-ceiling one is accepted.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const d = DB.get(); const mk = (cp) => JSON.parse(JSON.stringify({ products: d.products, stores: d.stores, transactions: [], users: d.users, categories: d.categories, productTypes: d.productTypes || [], costHistory: [{ id: 'chx', productId: (d.products[0] || {}).id || 'P', date: '2026-06-01', costPrice: cp }] })); const bad = Pages._validateAndScrubBackup(mk(4000000)); const good = Pages._validateAndScrubBackup(mk(50)); return { badRejected: bad.ok === false, goodAccepted: good.ok === true, acceptedVal: good.data && good.data.costHistory[0].costPrice }; });
      rec('S-116', 'backup restore rejects an over-MONEY_MAX costHistory.costPrice (accepts a within-ceiling one)', r.badRejected && r.goodAccepted && r.acceptedVal === 50, `badRejected=${r.badRejected} goodAccepted=${r.goodAccepted} acceptedVal=${r.acceptedVal} (clean: true/true/50)`); await ctx.close(); }

    // S-117 (Wave L1 / Tier 5 — GPT-14): Transfer.create rejects invalid/blank/zero qty in the DOMAIN (the old
    // Math.max(0,safeInt||0) coerced garbage into a 0-unit line). Only a valid positive whole qty creates a transfer.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const dest = d.stores.find(x => x.id !== s.storeId && x.type !== 'warehouse') || d.stores.find(x => x.id !== s.storeId); d.transactions.push({ id: 'l117in', storeId: s.storeId, productId: s.productId, type: 'in', qty: 100, date: '2026-06-01', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); const before = (DB.get().transfers || []).length; const zero = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: 0 }], {}); const blank = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: '' }], {}); const frac = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: 1.5 }], {}); const good = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: 3 }], {}); const after = (DB.get().transfers || []).length; return { zeroRej: zero.ok === false, blankRej: blank.ok === false, fracRej: frac.ok === false, goodOk: good.ok === true, netCreated: after - before }; }, s);
      rec('S-117', 'Transfer.create rejects zero/blank/fractional qty in the domain (only valid lines create a transfer)', r.zeroRej && r.blankRej && r.fracRej && r.goodOk && r.netCreated === 1, `zero=${r.zeroRej} blank=${r.blankRej} frac=${r.fracRej} good=${r.goodOk} created=${r.netCreated} (clean: rejects 3, 1 created)`); await ctx.close(); }

    // S-118 (Wave L1 / Tier 5 — GPTa-22, Kunal HARD-BLOCK): create + submitDraft refuse to send more than the
    // origin holds; origin stock is never driven negative; a rejected submitDraft restores the draft intact.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const dest = d.stores.find(x => x.id !== s.storeId && x.type !== 'warehouse') || d.stores.find(x => x.id !== s.storeId); d.transactions.push({ id: 'l118in', storeId: s.storeId, productId: s.productId, type: 'in', qty: 5, date: '2026-06-01', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); const qtyBefore = Stock.qty(s.productId, s.storeId); const over = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: 9 }], {}); const qtyAfterOver = Stock.qty(s.productId, s.storeId); const ok = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: 5 }], {}); const qtyAfterOk = Stock.qty(s.productId, s.storeId); const draft = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: 1 }], { isDraft: true }); const dt = DB.get().transfers.find(x => x.id === draft.transferId); dt.items[0].status = 'confirmed'; const subOver = await Transfer.submitDraft(draft.transferId, { [s.productId]: 99 }); const draftStatus = DB.get().transfers.find(x => x.id === draft.transferId).status; return { overRej: over.ok === false, stockUntouchedOnReject: qtyAfterOver === qtyBefore, okAccepted: ok.ok === true, stockDeductedOnOk: qtyAfterOk === qtyBefore - 5, subOverRej: subOver.ok === false, draftRestored: draftStatus === 'draft' }; }, s);
      rec('S-118', 'over-send hard-blocked in create + submitDraft (origin never negative; draft restored on reject)', r.overRej && r.stockUntouchedOnReject && r.okAccepted && r.stockDeductedOnOk && r.subOverRej && r.draftRestored, `overRej=${r.overRej} stockUntouched=${r.stockUntouchedOnReject} okAcc=${r.okAccepted} deducted=${r.stockDeductedOnOk} subOverRej=${r.subOverRej} draftRestored=${r.draftRestored} (clean: all true)`); await ctx.close(); }

    // S-119 (Wave L1 / Tier 5 — GPTa-23 + GPT L1-P2): receive VALIDATES received qty per Validate.qty's
    // no-truncation contract — a fractional/garbage qty is REJECTED (nothing stored, transfer untouched),
    // not silently truncated (which would complete a transfer on bad input); a valid whole qty is accepted.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const mk = (id, sent) => { const tr = { id, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: 'head_office', toStoreId: s.storeId, createdBy: Auth.actor(), createdByName: 't', status: 'in_transit', items: [{ productId: s.productId, sentQty: sent, receivedQty: null, status: 'pending', flagNote: '' }], receivedBy: null, notes: '' }; d.transfers = d.transfers || []; d.transfers.push(tr); return tr; }; const trA = mk('l119a_' + Date.now(), 5); await DB.updateTransferDurable(trA, null); const bad = await Transfer.receive(trA.id, [{ productId: s.productId, receivedQty: '3.9' }]); const itemA = DB.get().transfers.find(x => x.id === trA.id).items[0]; const statusA = DB.get().transfers.find(x => x.id === trA.id).status; const trB = mk('l119b_' + Date.now(), 5); await DB.updateTransferDurable(trB, null); const good = await Transfer.receive(trB.id, [{ productId: s.productId, receivedQty: 3 }]); const itemB = DB.get().transfers.find(x => x.id === trB.id).items[0]; return { badRejected: bad.ok === false, badNotStored: itemA.receivedQty == null && statusA === 'in_transit', goodOk: good.ok === true, goodStored: itemB.receivedQty === 3 }; }, s);
      rec('S-119', 'receive rejects a fractional/garbage receivedQty (nothing stored), accepts a valid whole', r.badRejected && r.badNotStored && r.goodOk && r.goodStored, `badRejected=${r.badRejected} badNotStored=${r.badNotStored} goodOk=${r.goodOk} goodStored=${r.goodStored} (clean: all true)`); await ctx.close(); }

    // S-120 (Wave L1 / Tier 5 — GPTa-27): return transfers are tagged type='return' (standard ones 'standard'),
    // so the hub stops rendering every transfer as "Standard".
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const dest = d.stores.find(x => x.id !== s.storeId && x.type !== 'warehouse') || d.stores.find(x => x.id !== s.storeId); d.transactions.push({ id: 'l120in', storeId: s.storeId, productId: s.productId, type: 'in', qty: 50, date: '2026-06-01', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); const ret = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: 2 }], { returnReason: 'Damaged' }); const std = await Transfer.create(s.storeId, dest.id, [{ productId: s.productId, qty: 2 }], {}); const retT = DB.get().transfers.find(x => x.id === ret.transferId); const stdT = DB.get().transfers.find(x => x.id === std.transferId); return { retType: retT.type, stdType: stdT.type }; }, s);
      rec('S-120', 'return transfers tagged type=return (standard transfers type=standard)', r.retType === 'return' && r.stdType === 'standard', `retType=${r.retType} stdType=${r.stdType} (clean: return/standard)`); await ctx.close(); }

    // S-121 (Wave L1 / Tier 5 — GPTa-21): cancel is refused when a transfer_in already exists for the transfer
    // (another device received it) — no stock reversal is written and the status is unchanged.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const trId = 'l121_' + Date.now(); const tr = { id: trId, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: 'head_office', toStoreId: s.storeId, createdBy: Auth.actor(), createdByName: 't', status: 'in_transit', items: [{ productId: s.productId, sentQty: 5, receivedQty: null, status: 'pending', flagNote: '' }], receivedBy: null, notes: '' }; d.transfers = d.transfers || []; d.transfers.push(tr); d.transactions.push({ id: 'l121rx', storeId: s.storeId, productId: s.productId, type: 'transfer_in', qty: 5, transferId: trId, date: '2026-06-02', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); await DB.updateTransferDurable(tr, null); const res = await Transfer.cancel(trId); const reversalAfter = DB.get().transactions.filter(t => t.transferId === trId && /cancelled/i.test(t.reason || '')).length; const status = DB.get().transfers.find(x => x.id === trId).status; return { refused: res.ok === false, noReversalAdded: reversalAfter === 0, notCancelled: status === 'in_transit' }; }, s);
      rec('S-121', 'cancel refused when a transfer_in already exists (another device received) — no reversal, status unchanged', r.refused && r.noReversalAdded && r.notCancelled, `refused=${r.refused} noReversal=${r.noReversalAdded} status=${r.notCancelled} (clean: all true)`); await ctx.close(); }

    // S-123 (Wave L2 / Tier 5 #8 — GPTa-29): the atomic TRANSFER + DELIVERY durable writes each schedule a
    // sync on success (these ledger writes used to be "stranded" — never pushed until an unrelated commit).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { let scheduled = 0; const realSched = Sync.scheduleSync; Sync.scheduleSync = () => { scheduled++; }; const ttxn = { id: 'l2sx_' + Date.now(), storeId: s.storeId, productId: s.productId, type: 'transfer_out', qty: 1, date: '2026-06-01', createdAt: new Date().toISOString() }; const transfer = { id: 'l2tx_' + Date.now(), status: 'in_transit', items: [], fromStoreId: s.storeId, toStoreId: s.storeId, createdAt: new Date().toISOString() }; const okT = await DB.atomicTransferWriteDurable([ttxn], transfer, null); const afterT = scheduled; const dtxn = { id: 'l2dx_' + Date.now(), storeId: 'head_office', productId: s.productId, type: 'in', qty: 1, date: '2026-06-01', createdAt: new Date().toISOString() }; const okD = await DB.atomicDeliveryWrite([dtxn]); const afterD = scheduled; Sync.scheduleSync = realSched; return { okT, okD, transferScheduled: afterT >= 1, deliveryScheduled: afterD > afterT }; }, s);
      rec('S-123', 'atomic transfer + delivery durable writes each schedule a sync (no stranded stock)', r.okT && r.okD && r.transferScheduled && r.deliveryScheduled, `okT=${r.okT} okD=${r.okD} transferSched=${r.transferScheduled} deliverySched=${r.deliveryScheduled} (clean: all true)`); await ctx.close(); }

    // S-124 (Wave L2 / Tier 5 #3 — GPT+Gemini P1): syncNow keeps the single-syncer invariant. As LEADER it
    // runs push THEN pull; as a FOLLOWER with a live leader it DELEGATES via BroadcastChannel and does NOT
    // push/pull directly (_syncLock is per-tab, so a direct follower sync would double-push against the leader).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { const calls = []; const realPush = Sync.push, realPull = Sync.pull; Sync.push = async () => { calls.push('push'); }; Sync.pull = async () => { calls.push('pull'); }; Sync._isLeader = true; Sync._syncing = false; Sync._syncQueued = false; await Sync.syncNow(); const leaderOrder = calls.join(','); calls.length = 0; Sync._isLeader = false; Sync._lastLeaderPing = Date.now(); let posted = null; const realBc = Sync._bc; Sync._bc = { postMessage: (m) => { posted = m; } }; await Sync.syncNow(); Sync._bc = realBc; Sync.push = realPush; Sync.pull = realPull; return { leaderOrder, followerNoDirect: calls.length === 0, followerDelegated: !!(posted && posted.type === 'request-sync') }; });
      rec('S-124', 'syncNow: leader runs push->pull; follower delegates via BroadcastChannel (no direct push/pull)', r.leaderOrder === 'push,pull' && r.followerNoDirect && r.followerDelegated, `leaderOrder=${r.leaderOrder} followerNoDirect=${r.followerNoDirect} delegated=${r.followerDelegated} (clean: push,pull/true/true)`); await ctx.close(); }

    // S-125 (Wave L2 / Tier 5 #5 — GPT+Gemini P0, DATA-LOSS GUARD): the UI sync-stamp writes the display-only
    // bob_ui_last_sync and NEVER bob_last_sync (the pull cursor — overwriting it with the device clock would
    // skip server rows newer than the local time = silent data loss).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { localStorage.setItem('bob_last_sync', '111111'); localStorage.removeItem('bob_ui_last_sync'); Sync._stampUiSync(); const ui = localStorage.getItem('bob_ui_last_sync'); return { cursorUntouched: localStorage.getItem('bob_last_sync') === '111111', uiStamped: !!ui && ui !== '111111' }; });
      rec('S-125', 'sync display-stamp writes bob_ui_last_sync only, never the bob_last_sync pull cursor', r.cursorUntouched && r.uiStamped, `cursorUntouched=${r.cursorUntouched} uiStamped=${r.uiStamped} (clean: both true)`); await ctx.close(); }

    // S-126 (Wave L2 / Tier 5 #2 — GPT-12): confirmDraftItem is DURABLE — it is async and gates its result on
    // the durable write, returning ok:false on failure (was fire-and-forget: returned ok:true before disk).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const trId = 'l126_' + Date.now(); const tr = { id: trId, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: 'head_office', toStoreId: s.storeId, createdBy: Auth.actor(), createdByName: 't', status: 'draft', items: [{ productId: s.productId, sentQty: 2, receivedQty: null, status: 'pending', flagNote: '' }], receivedBy: null, notes: '' }; d.transfers = d.transfers || []; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); const realUTD = DB.updateTransferDurable; DB.updateTransferDurable = async () => false; const realFatal = UI.fatalSaveError; UI.fatalSaveError = () => {}; const p = Transfer.confirmDraftItem(trId, s.productId); const isThenable = !!(p && typeof p.then === 'function'); const res = await p; DB.updateTransferDurable = realUTD; UI.fatalSaveError = realFatal; return { isThenable, okOnFailure: res.ok }; }, s);
      rec('S-126', 'confirmDraftItem is durable (async, returns ok:false when the durable write fails — not fire-and-forget ok:true)', r.isThenable && r.okOnFailure === false, `isThenable=${r.isThenable} okOnFailure=${r.okOnFailure} (clean: true/false)`); await ctx.close(); }

    // S-128 (Wave L2r1 / Tier 5 — GPT P2): a manual "Sync now" / reconnect cycle that collides with a raw
    // push()/pull() already in flight (a background poll or the debounce holds _syncLock WITHOUT _syncing)
    // must QUEUE — not silently no-op and report success — and must RUN the moment that raw op releases the lock.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(async () => { const calls = []; const realPush = Sync.push, realPull = Sync.pull; const lockAware = (name) => async () => { if (Sync._syncLock) return; Sync._syncLock = true; try { calls.push(name); } finally { Sync._syncLock = false; Sync._drainSyncQueue(); } }; Sync.push = lockAware('push'); Sync.pull = lockAware('pull'); Sync._isLeader = true; Sync._syncing = false; Sync._syncQueued = false; Sync._syncLock = true; /* a raw poll/debounce is mid-flight */ await Sync.syncNow(); const queuedNotRun = calls.length === 0 && Sync._syncQueued === true; Sync._syncLock = false; Sync._drainSyncQueue(); /* raw op finishes -> finally drains */ await new Promise(res => setTimeout(res, 10)); const ranAfter = calls.join(','); Sync.push = realPush; Sync.pull = realPull; return { queuedNotRun, ranAfter }; });
      rec('S-128', 'manual/reconnect sync collides with an in-flight raw push/pull: queues (not dropped) then runs push->pull on lock release', r.queuedNotRun && r.ranAfter === 'push,pull', `queuedNotRun=${r.queuedNotRun} ranAfter=${r.ranAfter} (clean: true/push,pull)`); await ctx.close(); }

    // S-129 (Wave L2r1 / Tier 5 — GPT P3): a REMOTE pull-merge bulk add (opts.remote — rows already _synced)
    // must NOT schedule a push (redundant churn); a normal LOCAL bulk add still must schedule one.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { let scheduled = 0; const realSched = Sync.scheduleSync; Sync.scheduleSync = () => { scheduled++; }; const mk = (id, sy) => ({ id, storeId: s.storeId, productId: s.productId, type: 'in', qty: 1, date: '2026-06-01', createdAt: new Date().toISOString(), _synced: sy }); const okRemote = await DB.addTransactionsDurable([mk('l129r_' + Date.now(), true)], { remote: true }); const afterRemote = scheduled; const okLocal = await DB.addTransactionsDurable([mk('l129l_' + Date.now(), false)]); const afterLocal = scheduled; Sync.scheduleSync = realSched; return { okRemote, okLocal, remoteDidNotSchedule: afterRemote === 0, localDidSchedule: afterLocal > afterRemote }; }, s);
      rec('S-129', 'pull-merge (remote) bulk add does NOT schedule a push; a local bulk add still does', r.okRemote && r.okLocal && r.remoteDidNotSchedule && r.localDidSchedule, `okRemote=${r.okRemote} okLocal=${r.okLocal} remoteNoSched=${r.remoteDidNotSchedule} localSched=${r.localDidSchedule} (clean: all true)`); await ctx.close(); }

    // S-130 (Wave L3 / Tier 5 #10): _canViewHistory routes through the central Auth.can('viewTransferHistory')
    // cap — a FRANCHISEE (ranks below store_manager in the isAtLeast order) CAN view transfer history; staff CANNOT.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const d = DB.get(); const fr = (d.users||[]).find(u => u.role==='franchisee'); const st = (d.users||[]).find(u => u.role==='staff'); Auth._user = fr; const franchisee = Transfer._canViewHistory(); Auth._user = st; const staff = Transfer._canViewHistory(); return { franchisee, staff }; });
      rec('S-130', '_canViewHistory: franchisee CAN view history (central cap), staff CANNOT', r.franchisee === true && r.staff === false, `franchisee=${r.franchisee} staff=${r.staff} (clean: true/false)`); await ctx.close(); }

    // S-131 (Wave L3 / Tier 5 #6): Transfer.list shows a multi-store franchisee BOTH their stores' transfers
    // (not just storeIds[0]); an unowned store's transfer is excluded.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const d = DB.get(); const fr = (d.users||[]).find(u => u.role==='franchisee'); Auth._user = fr; const ids = fr.storeIds || []; const a = ids[0], b2 = ids[1]; const other = ((d.stores.find(s => s.active && !ids.includes(s.id)))||{}).id; const mk = (id,from) => ({ id, date:new Date().toISOString(), createdAt:new Date().toISOString(), fromStoreId:from, toStoreId:'head_office', status:'in_transit', items:[] }); d.transfers = d.transfers || []; d.transfers.push(mk('l131a',a), mk('l131b',b2), mk('l131c',other)); const listed = Transfer.list().map(t => t.id); return { hasA: listed.includes('l131a'), hasB: listed.includes('l131b'), hasOther: listed.includes('l131c') }; });
      rec('S-131', 'Transfer.list shows BOTH of a franchisee store set, excludes unowned', r.hasA && r.hasB && !r.hasOther, `hasA=${r.hasA} hasB=${r.hasB} hasOther=${r.hasOther} (clean: true/true/false)`); await ctx.close(); }

    // S-132 (Wave L3 / Tier 5 #6b): the create-transfer store options are scoped to the user's OWN stores for a
    // franchisee — an unowned store is not offered (matches the domain reject at Transfer.create).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const d = DB.get(); const fr = (d.users||[]).find(u => u.role==='franchisee'); Auth._user = fr; const ids = fr.storeIds || []; const other = ((d.stores.find(s => s.active && !ids.includes(s.id)))||{}).id; if (!document.getElementById('page-create-transfer')) { const dv = document.createElement('div'); dv.id = 'page-create-transfer'; dv.className = 'page'; document.body.appendChild(dv); } window.renderCreateTransfer(); const sel = document.querySelector('#page-create-transfer select'); const opts = sel ? Array.from(sel.options).map(o => o.value).filter(Boolean) : []; return { count: opts.length, ownsAll: ids.every(id => opts.includes(id)), excludesOther: other ? !opts.includes(other) : true }; });
      rec('S-132', 'create-transfer store options scoped to owned stores for a franchisee (unowned excluded)', r.count > 0 && r.ownsAll && r.excludesOther, `count=${r.count} ownsAll=${r.ownsAll} excludesOther=${r.excludesOther} (clean: owns all, excludes unowned)`); await ctx.close(); }

    // S-133 (Wave L3 / Tier 5 #6c): a multi-store user (franchisee) is BLOCKED from the single-store storeStock
    // page (shown a "Multiple stores" notice); a single-store manager renders the normal stock view.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const d = DB.get(); const fr = (d.users||[]).find(u => u.role==='franchisee'); const mgr = (d.users||[]).find(u => u.role==='store_manager'); Auth._user = fr; Pages.storeStock(); const franHtml = ((document.getElementById('page-store-stock'))||{}).innerHTML || ''; Auth._user = mgr; Pages.storeStock(); const mgrHtml = ((document.getElementById('page-store-stock'))||{}).innerHTML || ''; return { franBlocked: franHtml.includes('Multiple stores'), mgrOk: mgrHtml.includes('Current Stock') && !mgrHtml.includes('Multiple stores') }; });
      rec('S-133', 'multi-store user blocked from single-store storeStock; single-store manager renders normally', r.franBlocked && r.mgrOk, `franBlocked=${r.franBlocked} mgrOk=${r.mgrOk} (clean: both true)`); await ctx.close(); }

    // S-134 (Wave L3 / Tier 5 #11): UI.stockBadge floors a NEGATIVE on-hand to 0 and renders red "OUT" — never
    // amber "LOW" and never a negative number (the raw value lives only in Stock.qty + the director alert).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const neg = UI.stockBadge(-7,5); const low = UI.stockBadge(2,5); return { negNoLow: !/LOW/.test(neg), negIsOut: /OUT/.test(neg), negNoMinus: neg.indexOf('-7') === -1, lowStillLow: /LOW/.test(low) }; });
      rec('S-134', 'stockBadge: negative floors to 0/OUT (red), never LOW or a negative number; a low-positive still LOW', r.negNoLow && r.negIsOut && r.negNoMinus && r.lowStillLow, `negNoLow=${r.negNoLow} negIsOut=${r.negIsOut} negNoMinus=${r.negNoMinus} lowStillLow=${r.lowStillLow} (clean: all true)`); await ctx.close(); }

    // S-135 (Wave L3 / Tier 5 #11, Option A): Stock.totalValue floors a negative on-hand to a $0 contribution
    // (a counting glitch must NOT subtract real dollars). Drive one product negative; value must not drop by its negative.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.price = 10; const before = Stock.totalValue(s.storeId); const cur = Stock.qty(s.productId, s.storeId); d.transactions.push({ id:'l135x_'+Date.now(), storeId:s.storeId, productId:s.productId, type:'transfer_out', qty: cur+7, date:'2026-06-01', createdAt:new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); const raw = Stock.qty(s.productId, s.storeId); const after = Stock.totalValue(s.storeId); const expectedFloored = before - cur*10; return { raw, after, expectedFloored, floored: after === expectedFloored }; }, s);
      rec('S-135', 'totalValue floors a negative on-hand to $0 (Option A — never subtracts)', r.raw < 0 && r.floored, `raw=${r.raw} after=${r.after} expected=${r.expectedFloored} (clean: raw<0 and value floored, not subtracted)`); await ctx.close(); }

    // S-136 (Wave L3 / Tier 5 #11): Stock.negativeStock detects RAW negatives (for the director alert); the
    // director banner renders only when negatives exist (empty string otherwise).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const cur = Stock.qty(s.productId, s.storeId); d.transactions.push({ id:'l136x_'+Date.now(), storeId:s.storeId, productId:s.productId, type:'transfer_out', qty: cur+5, date:'2026-06-01', createdAt:new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); const negs = Stock.negativeStock([s.storeId]); const found = negs.some(n => n.product.id === s.productId && n.store.id === s.storeId && n.qty < 0); const banner = Pages._negativeStockBanner([s.storeId]); const emptyBanner = Pages._negativeStockBanner(['__nonexistent_store__']); return { found, bannerShows: banner.length > 0 && /NEGATIVE/.test(banner), emptyWhenNone: emptyBanner === '' }; }, s);
      rec('S-136', 'negativeStock detects raw negatives; director banner renders only when negatives exist', r.found && r.bannerShows && r.emptyWhenNone, `found=${r.found} bannerShows=${r.bannerShows} emptyWhenNone=${r.emptyWhenNone} (clean: all true)`); await ctx.close(); }

    // S-137 (Wave L3r1 / Tier 5 #10 — SURFACE): the transfers hub hides the Completed tab AND excludes completed
    // transfers from the list for a user without viewTransferHistory (staff); a manager keeps both. Staff still
    // receive in-transit transfers (not gated). Drives the LIVE renderTransfersHub, not the helper.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const d = DB.get(); const st = (d.users||[]).find(u => u.role==='staff'); const mgr = (d.users||[]).find(u => u.role==='store_manager'); const sid = (st.storeIds||[])[0]; d.transfers = d.transfers || []; d.transfers.push({ id:'l137c', date:new Date().toISOString(), createdAt:new Date().toISOString(), fromStoreId:'head_office', toStoreId:sid, status:'completed', items:[], createdByName:'t' }); if (!document.getElementById('page-transfers')) { const dv = document.createElement('div'); dv.id='page-transfers'; dv.className='page'; document.body.appendChild(dv); } Auth._user = st; renderTransfersHub(); const sH = document.getElementById('page-transfers').innerHTML; Auth._user = mgr; renderTransfersHub(); const mH = document.getElementById('page-transfers').innerHTML; return { staffNoTab: !sH.includes('>Completed<'), staffNotListed: !sH.includes('l137c'), mgrHasTab: mH.includes('>Completed<') }; });
      rec('S-137', 'transfers hub hides Completed tab + completed rows from staff; manager keeps them', r.staffNoTab && r.staffNotListed && r.mgrHasTab, `staffNoTab=${r.staffNoTab} staffNotListed=${r.staffNotListed} mgrHasTab=${r.mgrHasTab} (clean: all true)`); await ctx.close(); }

    // S-138 (Wave L3r1 / Tier 5 #10 — SURFACE): openDetail BLOCKS a completed transfer for staff (history) even on
    // a direct call; a director can open it. Receiving in-transit transfers is unaffected.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo);
      const r = await page.evaluate(() => { const d = DB.get(); const st = (d.users||[]).find(u => u.role==='staff'); const dir = (d.users||[]).find(u => u.role==='director'); const sid = (st.storeIds||[])[0]; d.transfers = d.transfers || []; d.transfers.push({ id:'l138c', date:new Date().toISOString(), createdAt:new Date().toISOString(), fromStoreId:'head_office', toStoreId:sid, status:'completed', items:[], createdByName:'t' }); const realRO = TransferUI.showReadOnly; const realToast = UI.toast; UI.toast = () => {}; let opened = 0; TransferUI.showReadOnly = () => { opened++; }; Auth._user = st; TransferUI.openDetail('l138c'); const staffBlocked = opened === 0; Auth._user = dir; TransferUI.openDetail('l138c'); const dirOpened = opened === 1; TransferUI.showReadOnly = realRO; UI.toast = realToast; return { staffBlocked, dirOpened }; });
      rec('S-138', 'openDetail blocks a completed transfer for staff (history); director can open', r.staffBlocked && r.dirOpened, `staffBlocked=${r.staffBlocked} dirOpened=${r.dirOpened} (clean: both true)`); await ctx.close(); }

    // S-139 (Wave L3r1 / Tier 5 #11 — SURFACE): a negative on-hand is classified CRITICAL (OUT, not amber LOW) and
    // the Low Stock Alerts page renders NO negative number. Drives the LIVE Stock.alerts + Pages.hoAlerts.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const dir = (d.users||[]).find(u => u.role==='director'); Auth._user = dir; const cur = Stock.qty(s.productId, s.storeId); d.transactions.push({ id:'l139x_'+Date.now(), storeId:s.storeId, productId:s.productId, type:'transfer_out', qty: cur+777, date:'2026-06-01', createdAt:new Date().toISOString() }); d.thresholds = d.thresholds || []; d.thresholds.push({ productId:s.productId, storeId:s.storeId, minQty:5, leadDays:3 }); if (Stock._invalidateThrMap) Stock._invalidateThrMap(); if (Stock._buildCache) Stock._buildCache(); const al = Stock.alerts([s.storeId]).find(a => a.product.id === s.productId); const critical = !!(al && al.critical === true); if (!document.getElementById('page-alerts')) { const dv = document.createElement('div'); dv.id='page-alerts'; dv.className='page'; document.body.appendChild(dv); } Pages.hoAlerts([s.storeId]); const html = document.getElementById('page-alerts').innerHTML; return { raw: Stock.qty(s.productId, s.storeId), critical, noNeg: html.indexOf('-777') === -1 }; }, s);
      rec('S-139', 'negative on-hand = critical (OUT) in alerts; alerts page renders no negative number', r.raw < 0 && r.critical && r.noNeg, `raw=${r.raw} critical=${r.critical} noNeg=${r.noNeg} (clean: raw<0, critical, no negative shown)`); await ctx.close(); }

    // S-140 (Wave L3r1 / Tier 5 #11 — SURFACE): the Stock Overview table renders NO negative number — cells floored
    // via stockBadge, the per-product Total floored. A negative total would print `<strong>-...`. Drives live hoStock.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const dir = (d.users||[]).find(u => u.role==='director'); Auth._user = dir; const cur = Stock.qty(s.productId, s.storeId); d.transactions.push({ id:'l140x_'+Date.now(), storeId:s.storeId, productId:s.productId, type:'transfer_out', qty: cur+777, date:'2026-06-01', createdAt:new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); Pages._hsStoreIds = null; Pages.hoStock(); const html = (document.getElementById('page-all-stock')||{}).innerHTML || ''; return { raw: Stock.qty(s.productId, s.storeId), noNegTotal: html.indexOf('<strong>-') === -1, hasTable: html.includes('Total') }; }, s);
      rec('S-140', 'Stock Overview table renders no negative total/qty (cells + totals floored)', r.raw < 0 && r.noNegTotal && r.hasTable, `raw=${r.raw} noNegTotal=${r.noNegTotal} hasTable=${r.hasTable} (clean: raw<0, nothing negative rendered)`); await ctx.close(); }

    // S-141 (Wave L3r1 / Tier 5 #11): the central Stock.dispQty floors a negative on-hand to 0 (raw qty untouched).
    // Every non-director VALUE total routes through it (calcVal, report value, category/snapshot totals, stock CSV, on-hand cost).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const cur = Stock.qty(s.productId, s.storeId); d.transactions.push({ id:'l141x_'+Date.now(), storeId:s.storeId, productId:s.productId, type:'transfer_out', qty: cur+9, date:'2026-06-01', createdAt:new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); return { raw: Stock.qty(s.productId, s.storeId), disp: Stock.dispQty(s.productId, s.storeId) }; }, s);
      rec('S-141', 'Stock.dispQty floors a negative on-hand to 0 (raw stays negative)', r.raw < 0 && r.disp === 0, `raw=${r.raw} disp=${r.disp} (clean: raw<0, disp 0)`); await ctx.close(); }

    // S-142 (Wave L3r2 / Tier 5 #11+#6 — SURFACE, GPT re-audit): the LIVE Current-Stock CSV export floors negatives
    // (no raw negative cell/total) AND scopes its columns to a franchisee's OWN stores (no other store, no HO column).
    // Drives the real Pages._exportStockCSV (the earlier duplicate that leaked has been removed).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); const fr = (d.users||[]).find(u => u.role==='franchisee'); Auth._user = fr; const ids = fr.storeIds || []; const sid = ids[0]; const cur = Stock.qty(s.productId, sid); d.transactions.push({ id:'l142x_'+Date.now(), storeId:sid, productId:s.productId, type:'transfer_out', qty: cur+777, date:'2026-06-01', createdAt:new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); let cap = null; const real = Pages._downloadCSV; Pages._downloadCSV = (...a) => { cap = a; }; Pages._exportStockCSV(); Pages._downloadCSV = real; const headers = cap ? cap[1] : []; const flat = JSON.stringify(cap); const other = ((d.stores.find(st => st.active && !ids.includes(st.id)))||{}).name; const ownNames = ids.map(id => (d.stores.find(st => st.id===id)||{}).name).filter(Boolean); return { raw: Stock.qty(s.productId, sid), noNeg: flat.indexOf('-777') === -1, hasOwn: ownNames.length>0 && ownNames.every(n => headers.includes(n)), noHO: !headers.includes('HO Warehouse'), noOther: other ? !headers.includes(other) : true }; }, s);
      rec('S-142', 'live stock CSV floors negatives + scopes columns to a franchisee own stores (no other store, no HO)', r.raw < 0 && r.noNeg && r.hasOwn && r.noHO && r.noOther, `raw=${r.raw} noNeg=${r.noNeg} hasOwn=${r.hasOwn} noHO=${r.noHO} noOther=${r.noOther} (clean: all true)`); await ctx.close(); }

    // S-143 (Wave M1 / GPTa-37): delete-movement is gated by the deleteMovement cap — staff (the shared
    // store-computer account) cannot delete; store_manager+ can. Drives the LIVE Pages._confirmDelete guard.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => {
        const d = DB.get(); const dir = d.users.find(u => u.role === 'director') || d.users[0];
        Pages._renderTodayMovements = () => {}; UI.closeModal = () => {};
        document.body.insertAdjacentHTML('beforeend', '<input id="del-name" value="Tester"><select id="del-reason"><option value="Mistake" selected>Mistake</option></select>');
        const mk = () => { const id = 'm143_' + Date.now() + '_' + Math.floor(Math.random() * 1e6); d.transactions.push({ id, storeId: s.storeId, productId: s.productId, type: 'in', qty: 1, date: '2026-06-01', editLog: [], createdAt: new Date().toISOString() }); return id; };
        Auth._user = { ...dir, role: 'staff' }; const staffCan = Auth.can('deleteMovement');
        const idA = mk(); await Pages._confirmDelete(idA); const staffBlocked = DB.get().transactions.some(t => t.id === idA);
        Auth._user = { ...dir, role: 'store_manager' }; const mgrCan = Auth.can('deleteMovement');
        const idB = mk(); await Pages._confirmDelete(idB); const mgrDeleted = !DB.get().transactions.some(t => t.id === idB);
        return { staffCan, staffBlocked, mgrCan, mgrDeleted };
      }, s);
      rec('S-143', 'delete-movement cap blocks staff, allows store_manager+ (live _confirmDelete)', r.staffCan === false && r.staffBlocked && r.mgrCan === true && r.mgrDeleted, `staffCan=${r.staffCan} staffBlocked=${r.staffBlocked} mgrCan=${r.mgrCan} mgrDeleted=${r.mgrDeleted} (clean: false/true/true/true)`); await ctx.close(); }

    // S-144 (Wave M1 / GPTa-36): editing a user cannot take a username already held by another user (the EDIT
    // path lacked the uniqueness check the ADD path has). Drives the LIVE Pages._updateUser guard.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); Auth._user = d.users.find(u => u.role === 'director') || d.users[0];
        Pages._refreshSettings = () => {}; UI.closeModal = () => {};
        d.users.push({ id: 'u144a', username: 'alice144', name: 'Alice', role: 'staff', storeIds: [], password: 'x', pin: 'y' }, { id: 'u144b', username: 'bob144', name: 'Bob', role: 'staff', storeIds: [], password: 'x', pin: 'y' });
        document.body.insertAdjacentHTML('beforeend', '<input id="eu-name" value="Alice"><input id="eu-user" value="bob144"><input id="eu-pass" value=""><input id="eu-pin" value=""><select id="eu-role"><option value="staff" selected>staff</option></select>');
        await Pages._updateUser('u144a');
        const after = DB.get().users.find(u => u.id === 'u144a');
        return { username: after ? after.username : 'GONE' };
      });
      rec('S-144', 'user edit rejects a username already taken by another user', r.username === 'alice144', `username=${r.username} (clean: alice144 kept; bug: bob144)`); await ctx.close(); }

    // S-145 (Wave M1 / GPTa-36): the last Director cannot be demoted (or self-deleted) — admin-lockout guard.
    // Drives LIVE Pages._updateUser (demote, mutation-proven) + Pages._deleteUser (self-delete, defence-in-depth).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); const dir = d.users.find(u => u.role === 'director') || d.users[0];
        d.users.forEach(u => { if (u !== dir && u.role === 'director') u.role = 'store_manager'; }); // exactly one director
        Auth._user = dir;
        Pages._refreshSettings = () => {}; UI.closeModal = () => {}; UI.confirm = (t, m, cb) => { if (typeof cb === 'function') return cb(); };
        document.body.insertAdjacentHTML('beforeend', '<input id="eu-name" value="D"><input id="eu-user" value="' + dir.username + '"><input id="eu-pass" value=""><input id="eu-pin" value=""><select id="eu-role"><option value="staff" selected>staff</option></select>');
        await Pages._updateUser(dir.id);
        const roleAfterDemote = DB.get().users.find(u => u.id === dir.id).role;
        await Pages._deleteUser(dir.id);
        const stillPresent = DB.get().users.some(u => u.id === dir.id);
        return { roleAfterDemote, stillPresent };
      });
      rec('S-145', 'last Director cannot be demoted or self-deleted (lockout guard)', r.roleAfterDemote === 'director' && r.stillPresent, `roleAfterDemote=${r.roleAfterDemote} stillPresent=${r.stillPresent} (clean: director/true)`); await ctx.close(); }

    // S-146 (Wave M1 / GPTa-42): a REJECTED stock-take cannot be approved — no adjustments written, status stays rejected.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => {
        const d = DB.get(); Auth._user = d.users.find(u => u.role === 'director') || d.users[0];
        UI.closeModal = () => {}; Pages.stockTake = () => {};
        const takeId = 'st146_' + Date.now(); d.stockTakes = d.stockTakes || [];
        d.stockTakes.push({ id: takeId, date: '2026-06-01', storeId: s.storeId, completedBy: 't', status: 'rejected', items: [{ productId: s.productId, systemCount: 0, physicalCount: 5, difference: 5 }] });
        await Pages._approveStockTake(takeId);
        const t = DB.get().stockTakes.find(x => x.id === takeId);
        return { status: t.status, adjustmentMade: DB.get().transactions.some(x => x.stockTakeId === takeId) };
      }, s);
      rec('S-146', 'rejected stock-take cannot be approved (no adjustment, status stays rejected)', r.status === 'rejected' && r.adjustmentMade === false, `status=${r.status} adjustmentMade=${r.adjustmentMade} (clean: rejected/false)`); await ctx.close(); }

    // S-147 (Wave M1 / GPTa-43 + GPT P3): the AUTHORITATIVE in-use re-check INSIDE the confirm callback blocks
    // an orphaning delete even in the stale-modal race (a dependency appears AFTER the modal opened, so the
    // pre-check passed). An unused one (no race) still deletes. Drives LIVE Pages._deletePT / Pages._deleteCat.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); Auth._user = d.users.find(u => u.role === 'director') || d.users[0];
        UI.closeModal = () => {}; Pages._refreshSettings = () => {};
        d.productTypes.push({ id: 'pt147u', name: 'PT Used' });
        d.categories.push({ id: 'cat147u', name: 'Cat Used', ptId: 'pt147f' }, { id: 'cat147f', name: 'Cat Free', ptId: 'pt147f' });
        // PT: pre-check passes (no category uses pt147u yet); a referencing category appears before the destructive write
        let cbPT = Promise.resolve();
        UI.confirm = (t, m, cb) => { DB.get().categories.push({ id: 'cat147race', name: 'Race', ptId: 'pt147u' }); cbPT = Promise.resolve(cb()); };
        await Pages._deletePT('pt147u'); await cbPT;
        // C2 makes delete = deactivate, so "still exists" is blind — assert the in-use PT stays ACTIVE.
        const ptU = DB.get().productTypes.find(p => p.id === 'pt147u'); const ptUsedActive = !!ptU && ptU.active !== false;
        // Cat: pre-check passes (no product in cat147u yet); a referencing product appears before the destructive write
        let cbU = Promise.resolve();
        UI.confirm = (t, m, cb) => { DB.get().products.push({ id: 'P147race', name: 'P', catId: 'cat147u', active: true }); cbU = Promise.resolve(cb()); };
        await Pages._deleteCat('cat147u'); await cbU;
        // C2 makes delete = deactivate, so "still exists" is true either way — the discriminator is that the
        // in-use cat stays ACTIVE (the re-check blocks any change); the bug (re-check removed) DEACTIVATES it.
        const catU = DB.get().categories.find(c => c.id === 'cat147u'); const catUsedActive = !!catU && catU.active !== false;
        // unused category (no race) is now DEACTIVATED (Chunk 7 C2 — was hard-deleted), still exists w/ active:false
        let cbP = Promise.resolve();
        UI.confirm = (t, m, cb) => { cbP = Promise.resolve(typeof cb === 'function' ? cb() : undefined); };
        await Pages._deleteCat('cat147f'); await cbP;
        const catFree = DB.get().categories.find(c => c.id === 'cat147f'); const catFreeDeactivated = !!catFree && catFree.active === false;
        return { ptUsedActive, catUsedActive, catFreeDeactivated };
      });
      rec('S-147', 'in-use re-check blocks orphaning (in-use cat/PT stay ACTIVE in the stale-modal race); an unused cat is DEACTIVATED not removed (Chunk 7 C2)', r.ptUsedActive && r.catUsedActive && r.catFreeDeactivated, `ptUsedActive=${r.ptUsedActive} catUsedActive=${r.catUsedActive} catFreeDeactivated=${r.catFreeDeactivated} (clean: all true)`); await ctx.close(); }

    // S-148 (Wave M1 / GPTa-45): a multi-store NON-franchisee (store_manager/TM) gets the location picker in
    // Log Movement; a single-store user does not. Drives the LIVE Pages.logMovement render.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); const dir = d.users.find(u => u.role === 'director') || d.users[0];
        if (!document.getElementById('page-log-movement')) document.body.insertAdjacentHTML('beforeend', '<div id="page-log-movement"></div>');
        Pages._renderLogStep = () => {}; Pages._renderTodayMovements = () => {};
        const twoIds = d.stores.filter(st => st.active && st.type !== 'warehouse').slice(0, 2).map(st => st.id);
        Auth._user = { ...dir, role: 'store_manager', storeIds: twoIds };
        Pages.logMovement();
        const sel = document.getElementById('ho-store-sel');
        const multiHasPicker = !!sel, optCount = sel ? sel.options.length : 0, defaultPinnedOk = Pages._logData ? Pages._logData.selectedStoreId === twoIds[0] : false;
        Auth._user = { ...dir, role: 'store_manager', storeIds: [twoIds[0]] };
        Pages.logMovement();
        const singleHasPicker = !!document.getElementById('ho-store-sel');
        return { multiHasPicker, optCount, singleHasPicker, defaultPinnedOk };
      });
      rec('S-148', 'multi-store non-franchisee gets the location picker; single-store does not', r.multiHasPicker && r.optCount === 2 && r.singleHasPicker === false && r.defaultPinnedOk, `multiPicker=${r.multiHasPicker} opts=${r.optCount} singlePicker=${r.singleHasPicker} defaultOk=${r.defaultPinnedOk} (clean: true/2/false/true)`); await ctx.close(); }

    // S-149 (Wave M1 / GPTa-37 [1b] + GPT P3): every deletion audit row carries the verified account
    // (_deletedByUser = Auth.actor()) — both the hard-delete path and the staff Undo path.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => {
        const d = DB.get(); const dir = d.users.find(u => u.role === 'director') || d.users[0];
        Pages._renderTodayMovements = () => {}; UI.closeModal = () => {};
        document.body.insertAdjacentHTML('beforeend', '<input id="del-name" value="Mgr"><select id="del-reason"><option value="Mistake" selected>Mistake</option></select>');
        Auth._user = { ...dir, role: 'store_manager', id: 'mgr149', username: 'mgr149', name: 'Mgr' };
        const idH = 'h149_' + Date.now(); d.transactions.push({ id: idH, storeId: s.storeId, productId: s.productId, type: 'in', qty: 1, date: '2026-06-01', editLog: [], createdAt: new Date().toISOString() });
        await Pages._confirmDelete(idH);
        const hardRow = DB.get().deletedTransactions.find(x => x.id === idH);
        const hardStamped = !!(hardRow && hardRow._deletedByUser && hardRow._deletedByUser.username === 'mgr149');
        let undoDone = null; UI.confirm = (t, m, cb) => { undoDone = (typeof cb === 'function') ? cb() : null; return undoDone; }; // _undoMovement is sync + fire-and-forget; await the callback's async work
        Auth._user = { ...dir, role: 'staff', id: 'stf149', username: 'stf149', name: 'Stf' };
        const idU = 'u149_' + Date.now(); d.transactions.push({ id: idU, storeId: s.storeId, productId: s.productId, type: 'in', qty: 1, date: '2026-06-01', editLog: [], createdAt: new Date().toISOString() });
        if (Stock._buildCache) Stock._buildCache();
        Pages._undoMovement(idU); await undoDone;
        const undoRow = DB.get().deletedTransactions.find(x => x.id === idU);
        const undoStamped = !!(undoRow && undoRow._deletedByUser && undoRow._deletedByUser.username === 'stf149');
        return { hardStamped, undoStamped };
      }, s);
      rec('S-149', 'deletion audit rows carry the verified account on both hard-delete and Undo paths', r.hardStamped && r.undoStamped, `hardStamped=${r.hardStamped} undoStamped=${r.undoStamped} (clean: both true)`); await ctx.close(); }

    // S-150 (Wave M2 / GPTa-41): clearing a franchise discount stores null (inherits the store default), a value
    // stores that number, AND a legacy stored 0 is treated as "not set" in billing (inherits, not full price).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => {
        const d = DB.get(); Auth._user = d.users.find(u => u.role === 'director') || d.users[0];
        Pages._renderProductsTable = () => {};
        const p = d.products.find(x => x.id === s.productId); p.price = 100;
        await Pages._setProductFranDisc(p.id, '10'); const setVal = DB.get().products.find(x => x.id === p.id).franchiseDiscount;
        await Pages._setProductFranDisc(p.id, ''); const cleared = DB.get().products.find(x => x.id === p.id).franchiseDiscount;
        const office = d.stores.find(x => x.isFranchise && x.isFranchiseOffice); const hasOffice = !!office;
        let owed = null, prodDisc = null;
        if (office) {
          office.franchiseDiscount = 25;
          DB.get().products.find(x => x.id === p.id).franchiseDiscount = 0; // legacy polluted value
          if (Stock._buildCache) Stock._buildCache();
          d.transactions.push({ id: 'fi150', type: 'in', qty: 10, reason: 'Received from Head Office', storeId: office.id, productId: p.id, date: '2026-06-16', createdAt: new Date().toISOString() });
          const data = Pages._franchiseInvoiceData(d, '2026-06-01', '2026-06-30');
          const off = data.find(sd => sd.office.id === office.id);
          owed = off ? off.totalOwed : null; prodDisc = (off && off.lines[0]) ? off.lines[0].prodDisc : null;
        }
        return { setVal, cleared, owed, prodDisc, hasOffice };
      }, s);
      rec('S-150', 'clear stores null (inherit); a value stores the number; a legacy 0 bills at the office default (25%) not full price', r.setVal === 10 && r.cleared === null && r.hasOffice && r.owed === 750 && r.prodDisc === 25, `setVal=${r.setVal} cleared=${r.cleared} owed=${r.owed} prodDisc=${r.prodDisc} (clean: 10/null/750/25)`); await ctx.close(); }

    // S-151 (Wave M2 / GPTa-38): a delivery listing the same product on two lines is rejected (nothing saved);
    // a distinct-product delivery still saves. Drives LIVE Pages._saveDelivery.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); Auth._user = d.users.find(u => u.role === 'director') || d.users[0];
        UI.closeModal = () => {}; Pages.directorCosts = () => {};
        const prods = d.products.filter(p => p.active); const pA = prods[0].id, pB = prods[1].id;
        document.body.insertAdjacentHTML('beforeend', '<input id="del-supplier" value="TestSup"><input id="del-date" value="2026-06-20"><input id="del-invoice" value=""><input id="del-freight" value=""><input id="del-tax" value=""><input id="del-shipping" value=""><select id="del-currency"><option value="AUD" selected>AUD</option></select><input id="del-rate" value="">');
        const before = (DB.get().deliveries || []).length;
        Pages._delLines = [{ productId: pA, qty: 2, unitCost: 10, weightGrams: 0, packaging: 0, labelling: 0 }, { productId: pA, qty: 3, unitCost: 12, weightGrams: 0, packaging: 0, labelling: 0 }];
        Pages._delSaving = false; await Pages._saveDelivery();
        const dupRejected = (DB.get().deliveries || []).length === before;
        Pages._delLines = [{ productId: pA, qty: 2, unitCost: 10, weightGrams: 0, packaging: 0, labelling: 0 }, { productId: pB, qty: 3, unitCost: 12, weightGrams: 0, packaging: 0, labelling: 0 }];
        Pages._delSaving = false; await Pages._saveDelivery();
        const cleanSaved = (DB.get().deliveries || []).length === before + 1;
        return { dupRejected, cleanSaved };
      });
      rec('S-151', 'duplicate-product delivery is rejected (nothing saved); a distinct-product delivery saves', r.dupRejected && r.cleanSaved, `dupRejected=${r.dupRejected} cleanSaved=${r.cleanSaved} (clean: both true)`); await ctx.close(); }

    // S-152 (Wave M2 / GPTa-24): a never-synced device (_lastSyncId===0) pulls immediately at Sync.init() and
    // shows the syncing indicator. Drives the LIVE boot path (config via sessionStorage fallback → leader → pull).
    { let SID = '', PID = ''; const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', processedCount: 0 } : { items: [{ ID: 1000, TransactionId: 'sp_m152', Type: 'in', Qty: 1, StoreId: SID, ProductId: PID, Date: '2026-06-20', DeviceId: 'OTHER_DEVICE', SyncTimestamp: 1000 }], maxId: '1000', count: 1, status: 'ok' }) }); });
      await waitBoot(page, repo); const s = await setup(page); SID = s.storeId; PID = s.productId;
      const r = await page.evaluate(async () => {
        sessionStorage.setItem('bob_sync_config', JSON.stringify({ pushUrl: 'https://x.logic.azure.com/push', pullUrl: 'https://x.logic.azure.com/pull' }));
        localStorage.setItem('bob_last_sp_id', '0'); Sync._lastSyncId = 0;
        Sync._startPolling = () => {}; // don't leave a 30s interval running in the test
        Sync._initLeaderElection = () => { Sync._isLeader = true; }; // make this tab leader synchronously (leader election is covered by S-124/S-128); we test the first-run pull branch
        const statuses = []; Sync._showStatus = (msg) => { statuses.push(String(msg)); };
        Sync.init(); // do NOT await: init() later awaits navigator.serviceWorker.ready, which never resolves under headless file:// — the first-run pull runs well before that
        await new Promise(r => setTimeout(r, 1800)); // 600ms leader wait + the mocked pull + margin
        return { cursorAdvanced: Sync._lastSyncId > 0, merged: DB.get().transactions.some(t => t.id === 'sp_m152'), showedSyncing: statuses.some(m => /syncing/i.test(m)) };
      });
      rec('S-152', 'never-synced device pulls immediately at init + shows the syncing indicator', r.cursorAdvanced && r.merged && r.showedSyncing, `cursorAdvanced=${r.cursorAdvanced} merged=${r.merged} showedSyncing=${r.showedSyncing} (clean: all true)`); await ctx.close(); }

    // S-153 (Wave M3 / GPT-9): restore takes a REAL snapshot of current data; "Undo last restore" is director-gated
    // and round-trips (writes the snapshot back to DB.KEY, clears _prerestore). Drives LIVE _snapshotForUndo + _undoRestore.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const dir = DB.get().users.find(u => u.role === 'director') || DB.get().users[0];
        Auth._user = dir; UI.confirm = (t, m, cb) => { if (typeof cb === 'function') return cb(); };
        localStorage.removeItem(DB.KEY); localStorage.removeItem(DB.KEY + '_prerestore');
        Pages._snapshotForUndo();
        let snap = null; try { snap = JSON.parse(localStorage.getItem(DB.KEY + '_prerestore')); } catch (e) {}
        const snapReal = !!(snap && Array.isArray(snap.products) && snap.products.length > 0);
        const snapScrubbed = !!(snap && (!Array.isArray(snap.users) || snap.users.every(u => !u.currentSession && !u.token)));
        const snapStr = localStorage.getItem(DB.KEY + '_prerestore');
        Auth._user = { ...dir, role: 'staff' }; Pages._undoRestore();
        const staffBlocked = localStorage.getItem(DB.KEY) === null;
        Auth._user = dir; Pages._undoRestore();
        const undoWroteKey = localStorage.getItem(DB.KEY) === snapStr;
        const prerestoreCleared = localStorage.getItem(DB.KEY + '_prerestore') === null;
        return { snapReal, snapScrubbed, staffBlocked, undoWroteKey, prerestoreCleared };
      });
      rec('S-153', 'restore snapshots real current data; Undo is director-gated + round-trips (writes snapshot back, clears _prerestore)', r.snapReal && r.snapScrubbed && r.staffBlocked && r.undoWroteKey && r.prerestoreCleared, `snapReal=${r.snapReal} scrubbed=${r.snapScrubbed} staffBlocked=${r.staffBlocked} undoWrote=${r.undoWroteKey} cleared=${r.prerestoreCleared} (clean: all true)`); await ctx.close(); }

    // S-154 (Wave M3 / GPT-10): a clean backup passes the checksum, a body edited after the checksum is rejected,
    // a legacy backup (no checksum) is accepted. Drives LIVE Pages._verifyBackupChecksum.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const clean = Pages._scrubBackupSecrets(Auth._slimActorsDeep(JSON.parse(JSON.stringify(DB.get()))));
        const checksum = await sha256(JSON.stringify(clean));
        const good = Object.assign({}, clean, { _meta: { app: 'bob-stock', checksum } });
        const cleanOk = await Pages._verifyBackupChecksum(good);
        const tampered = JSON.parse(JSON.stringify(good)); tampered.products.push({ id: 'TAMPER', name: 'x' });
        const tamperRejected = !(await Pages._verifyBackupChecksum(tampered));
        const legacy = Object.assign({}, clean, { _meta: { app: 'bob-stock' } });
        const legacyAccepted = await Pages._verifyBackupChecksum(legacy);
        return { cleanOk, tamperRejected, legacyAccepted };
      });
      rec('S-154', 'backup checksum: clean passes, tampered rejected, legacy (no checksum) accepted', r.cleanOk && r.tamperRejected && r.legacyAccepted, `cleanOk=${r.cleanOk} tamperRejected=${r.tamperRejected} legacyAccepted=${r.legacyAccepted} (clean: all true)`); await ctx.close(); }

    // S-155 (Wave M3 / GPT-5c + GPT-5b): SW install caches the core shell (required) and tolerates CDN misses
    // (not an atomic addAll of everything), and the push icon path points at ./icons/. SW install is not cleanly
    // driveable under headless file://, so this is a source-level check against the (possibly-mutated) repo copy.
    { const sw = fs.readFileSync(path.join(repo, 'sw.js'), 'utf8');
      const resilientInstall = sw.includes('cache.addAll(CORE_URLS)') && sw.includes('cache.add(u).catch') && !sw.includes('cache.addAll(PRECACHE_URLS)');
      const iconPath = sw.includes("'./icons/icon-192.png'") && !sw.includes("'./icon-192.png'");
      rec('S-155', 'SW install caches core (required) + tolerates CDN misses; push icon path is ./icons/ (source check)', resilientInstall && iconPath, `resilientInstall=${resilientInstall} iconPath=${iconPath} (clean: both true)`); }

    // S-156 (Wave M3 / GPT-18): device/tab/stepper IDs use crypto.getRandomValues, not Math.random (source check).
    { const p2 = fs.readFileSync(path.join(repo, 'phase2.js'), 'utf8'); const sj = fs.readFileSync(path.join(repo, 'sync.js'), 'utf8');
      const stepperCrypto = /'stp_'\s*\+\s*Array\.from\(crypto\.getRandomValues/.test(p2);
      const devCrypto = /'dev_'[\s\S]{0,80}crypto\.getRandomValues/.test(sj);
      const tabCrypto = /'tab_'[\s\S]{0,80}crypto\.getRandomValues/.test(sj);
      rec('S-156', 'device/tab/stepper IDs use crypto.getRandomValues, not Math.random (source check)', stepperCrypto && devCrypto && tabCrypto, `stepper=${stepperCrypto} dev=${devCrypto} tab=${tabCrypto} (clean: all true)`); }

    // S-157 (Wave M3 / date-preset): _subMonths clamps month-end overflow (no 31 May −3mo → early March). Live.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const d = Pages._subMonths(new Date(2026, 4, 31), 3);  // 31 May 2026 − 3mo → Feb (2026 not leap → 28)
        const d2 = Pages._subMonths(new Date(2026, 2, 31), 1); // 31 Mar 2026 − 1mo → Feb 28
        return { month: d.getMonth(), date: d.getDate(), month2: d2.getMonth(), date2: d2.getDate() };
      });
      rec('S-157', '_subMonths clamps month-end (31 May −3mo → Feb 28; 31 Mar −1mo → Feb 28), no month overflow', r.month === 1 && r.date === 28 && r.month2 === 1 && r.date2 === 28, `mayMinus3=${r.month}/${r.date} marMinus1=${r.month2}/${r.date2} (clean: 1/28 and 1/28)`); await ctx.close(); }

    // S-158 (Wave M3 / Ca-M17): staticwebapp.config navigationFallback has an exclude list (static assets not
    // rewritten to HTML → no HTML-under-JS sticky offline breakage). Source check (config, not runtime).
    { const cfg = fs.readFileSync(path.join(repo, 'staticwebapp.config.json'), 'utf8'); let parsed = null; try { parsed = JSON.parse(cfg); } catch (e) {}
      const hasExclude = !!(parsed && parsed.navigationFallback && Array.isArray(parsed.navigationFallback.exclude) && parsed.navigationFallback.exclude.length > 0);
      rec('S-158', 'staticwebapp.config navigationFallback has an exclude list (static assets not rewritten to HTML)', hasExclude, `hasExclude=${hasExclude} (clean: true)`); }

    // S-159 (Azure pull-hardening): pull issues an ID-CURSOR request (body carries lastId, NOT since/$skip)
    // and advances the bob_last_sp_id cursor to the frozen maxId after a normal merge. Drives LIVE Sync.pull().
    { let SID = '', PID = ''; const reqs = []; const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); if (!isPush) reqs.push(body); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok' } : { items: [{ ID: 600, TransactionId: 'sp_s159', Type: 'in', Qty: 1, StoreId: SID, ProductId: PID, Date: '2026-06-20', DeviceId: 'OTHER_DEVICE', SyncTimestamp: 600 }], maxId: '600', count: 1, status: 'ok' }) }); });
      await waitBoot(page, repo); const s = await setup(page); SID = s.storeId; PID = s.productId;
      const r = await page.evaluate(async () => { Sync._pullUrl = 'https://x.logic.azure.com/pull'; Sync._syncLock = false; Sync._lastSyncId = 500; localStorage.removeItem('bob_last_sp_id'); try { await Sync.pull(); } catch (e) {} await new Promise(r => setTimeout(r, 300)); return { after: Sync._lastSyncId, persisted: localStorage.getItem('bob_last_sp_id'), merged: DB.get().transactions.some(t => t.id === 'sp_s159') }; });
      let p0 = {}; try { p0 = JSON.parse(reqs[0] || '{}'); } catch (e) {}
      const idCursorReq = p0.lastId !== undefined && p0.since === undefined && p0['$skip'] === undefined;
      rec('S-159', 'pull uses ID-cursor request (lastId, no since/$skip) + advances bob_last_sp_id on merge', idCursorReq && r.after === 600 && r.persisted === '600' && r.merged, `idCursorReq=${idCursorReq} after=${r.after} persisted=${r.persisted} merged=${r.merged} (clean: true/600/600/true)`); await ctx.close(); }

    // S-160 (Azure pull-hardening / C2 phantom-read): pull starts each cycle from (cursor - PULL_ID_LOOKBACK)
    // so async-committed rows from the previous cycle are re-seen (deduped locally). Drives LIVE Sync.pull().
    { const reqs = []; const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); if (!isPush) reqs.push(body); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok' } : { items: [], maxId: '9000', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo);
      await page.evaluate(async () => { Sync._pullUrl = 'https://x.logic.azure.com/pull'; Sync._syncLock = false; Sync._lastSyncId = 5000; try { await Sync.pull(); } catch (e) {} await new Promise(r => setTimeout(r, 150)); });
      let p0 = {}; try { p0 = JSON.parse(reqs[0] || '{}'); } catch (e) {}
      rec('S-160', 'pull applies the C2 phantom-read lookback (requests lastId = cursor - PULL_ID_LOOKBACK)', p0.lastId === '4900', `reqLastId=${p0.lastId} (clean: 4900 = 5000-100)`); await ctx.close(); }

    // S-161 (Azure pull-hardening / C1 freeze): across a 2-page pull, page 1 sends NO maxId (server freezes it),
    // and page 2 echoes that frozen maxId + advances lastId to the page max — so concurrent inserts can't extend
    // the cycle. Drives LIVE Sync.pull() with a forced full first page (1000 rows).
    { let SID = '', PID = ''; const reqs = []; let pageNo = 0; const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); if (isPush) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }); reqs.push(body); pageNo++; if (pageNo === 1) { const items = []; for (let i = 1; i <= 1000; i++) items.push({ ID: i, TransactionId: 'sp_p1_' + i, Type: 'in', Qty: 1, StoreId: SID, ProductId: PID, Date: '2026-06-20', DeviceId: 'OTHER_DEVICE', SyncTimestamp: i }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, maxId: '12345', count: 1000, status: 'ok' }) }); } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: '12345', count: 0, status: 'ok' }) }); });
      await waitBoot(page, repo); const s = await setup(page); SID = s.storeId; PID = s.productId;
      await page.evaluate(async () => { Sync._pullUrl = 'https://x.logic.azure.com/pull'; Sync._syncLock = false; Sync._lastSyncId = 0; try { await Sync.pull(); } catch (e) {} await new Promise(r => setTimeout(r, 500)); });
      let p1 = {}, p2 = {}; try { p1 = JSON.parse(reqs[0] || '{}'); } catch (e) {} try { p2 = JSON.parse(reqs[1] || '{}'); } catch (e) {}
      const twoPages = reqs.length >= 2; const page1NoMax = p1.maxId === undefined; const page2Echo = p2.maxId === '12345' && p2.lastId === '1000';
      rec('S-161', 'C1 freeze: page1 omits maxId; page2 echoes frozen maxId + advances lastId to page max', twoPages && page1NoMax && page2Echo, `pages=${reqs.length} p1NoMax=${page1NoMax} p2Echo=${page2Echo} (clean: all true)`); await ctx.close(); }

    // S-162 (Azure pull-hardening / Codex P2 — fail closed): a FULL page (1000) whose max ID does NOT advance
    // past the cursor = a malformed server page. pull() must ABORT the cycle without merging or advancing the
    // cursor (no infinite loop, no half-applied cycle). Cursor starts high; items have low IDs (no progress);
    // frozen maxId is high — so a non-fail-closed impl would wrongly advance the cursor to it. Drives LIVE pull().
    { let SID = '', PID = ''; const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); if (isPush) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }); const items = []; for (let i = 1; i <= 1000; i++) items.push({ ID: i, TransactionId: 'sp_fc_' + i, Type: 'in', Qty: 1, StoreId: SID, ProductId: PID, Date: '2026-06-20', DeviceId: 'OTHER_DEVICE', SyncTimestamp: i }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, maxId: '200000', count: 1000, status: 'ok' }) }); });
      await waitBoot(page, repo); const s = await setup(page); SID = s.storeId; PID = s.productId;
      const r = await page.evaluate(async () => { Sync._pullUrl = 'https://x.logic.azure.com/pull'; Sync._syncLock = false; Sync._lastSyncId = 100000; const before = Sync._lastSyncId; try { await Sync.pull(); } catch (e) {} await new Promise(r => setTimeout(r, 300)); return { before, after: Sync._lastSyncId, merged: DB.get().transactions.some(t => String(t.id).indexOf('sp_fc_') === 0) }; });
      rec('S-162', 'pull fails closed on a no-forward-progress full page (cursor unchanged, nothing merged)', r.after === r.before && r.merged === false, `before=${r.before} after=${r.after} merged=${r.merged} (clean: 100000/100000/false)`); await ctx.close(); }

    // S-163 (Azure Chunk 2 — honest ingest contract): a row the SERVER permanently REJECTS (validation
    // failure) is NOT marked _synced and IS surfaced — a durable _rejected flag + reason persists so an
    // admin can see it and push() excludes it from re-push. The old processedCount ack would have marked
    // the whole batch synced = silent data loss. Drives the LIVE Sync.push() against the v2 contract.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', inputCount: 1, accepted: [], duplicates: [], rejected: [{ index: 0, TransactionId: 'sb163', reasonCode: 'BAD_ID', reason: 'hostile id' }], failed: [], serverTimestamp: 1 } : { items: [], maxId: '0', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'sb163', type: 'in', qty: 3, storeId: s.storeId, productId: s.productId, date: '2026-06-24', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); await Sync.push(); await new Promise(r => setTimeout(r, 400)); await DB.refresh(); const t = DB.get().transactions.find(x => x.id === 'sb163'); return { synced: t ? !!t._synced : 'GONE', rejected: t ? t._rejected === true : 'GONE', code: t ? t._rejectCode : '' }; }, s);
      rec('S-163', 'server-rejected row is NOT synced + is flagged/surfaced (no silent data loss)', r.synced === false && r.rejected === true && r.code === 'BAD_ID', `synced=${r.synced} rejected=${r.rejected} code=${r.code} (clean: false+true+BAD_ID)`); await ctx.close(); }

    // S-164 (Azure Chunk 2): a DUPLICATE id returned in `duplicates` (server already has it / 409 idempotent)
    // is treated as synced — re-sending an already-landed row must clear, not loop forever unsynced.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', inputCount: 1, accepted: [], duplicates: ['sb164'], rejected: [], failed: [], serverTimestamp: 1 } : { items: [], maxId: '0', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'sb164', type: 'in', qty: 3, storeId: s.storeId, productId: s.productId, date: '2026-06-24', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); await Sync.push(); await new Promise(r => setTimeout(r, 400)); await DB.refresh(); const t = DB.get().transactions.find(x => x.id === 'sb164'); return { synced: t ? !!t._synced : 'GONE' }; }, s);
      rec('S-164', 'duplicate (409 idempotent) id is treated as synced', r.synced === true, `synced=${r.synced} (clean: true)`); await ctx.close(); }

    // S-165 (Azure Chunk 2): an ACCEPTED id is marked _synced — the normal success path under the new
    // contract (proves accepted rows are honoured, complementing the reject/dup/failed paths).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', inputCount: 1, accepted: ['sb165'], duplicates: [], rejected: [], failed: [], serverTimestamp: 1 } : { items: [], maxId: '0', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'sb165', type: 'in', qty: 3, storeId: s.storeId, productId: s.productId, date: '2026-06-24', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); await Sync.push(); await new Promise(r => setTimeout(r, 400)); await DB.refresh(); const t = DB.get().transactions.find(x => x.id === 'sb165'); return { synced: t ? !!t._synced : 'GONE', rejected: t ? t._rejected === true : false }; }, s);
      rec('S-165', 'accepted id is marked synced (and not flagged rejected)', r.synced === true && r.rejected === false, `synced=${r.synced} rejected=${r.rejected} (clean: true+false)`); await ctx.close(); }

    // S-166 (Azure Chunk 2): a row the server reports as `failed` (retryable: 429/5xx/transient create)
    // is left UNSYNCED and NOT quarantined (not _rejected) and triggers a pending retry — a recoverable
    // failure must never be lost (marked synced) NOR permanently quarantined like a validation reject.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', inputCount: 1, accepted: [], duplicates: [], rejected: [], failed: [{ index: 0, TransactionId: 'sb166', reason: 'throttled 429', retryable: true }], serverTimestamp: 1 } : { items: [], maxId: '0', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Sync._setPending(false); Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'sb166', type: 'in', qty: 3, storeId: s.storeId, productId: s.productId, date: '2026-06-24', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); await Sync.push(); await new Promise(r => setTimeout(r, 400)); await DB.refresh(); const t = DB.get().transactions.find(x => x.id === 'sb166'); return { synced: t ? !!t._synced : 'GONE', rejected: t ? t._rejected === true : 'GONE', pending: Sync._getPending() }; }, s);
      rec('S-166', 'retryable failed row left unsynced + not quarantined + pending retry', r.synced === false && r.rejected !== true && r.pending === true, `synced=${r.synced} rejected=${r.rejected} pending=${r.pending} (clean: false+notTrue+true)`); await ctx.close(); }

    // S-167 (Azure Chunk 2 — v2 H3 parity): under the new contract, when the server ACCEPTS a row but the
    // LOCAL _synced write fails, the UI must NOT lie "Synced ✓" and must keep pending=true (the Wave-H/H3
    // guarantee, on the v2 path). The v2 ack is gated by a single `_clean` invariant (all durable writes
    // ok + nothing failed/unaccounted/conflicting); a failed markSynced makes _clean false → retry.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', inputCount: 1, accepted: ['sb167'], duplicates: [], rejected: [], failed: [], serverTimestamp: 1 } : { items: [], maxId: '0', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { let lastStatus = ''; Sync._showStatus = (msg) => { lastStatus = String(msg || ''); }; DB.markTransactionsSynced = async () => false; Sync._setPending(false); Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'sb167', type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-06-24', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); try { await Sync.push(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 300)); return { lastStatus, pending: Sync._getPending() }; }, s);
      rec('S-167', 'v2 markSynced-fail does not lie "Synced" + keeps pending', r.lastStatus.indexOf('Synced ✓') === -1 && r.pending === true, `status="${r.lastStatus}" pending=${r.pending} (clean: not-Synced + pending true)`); await ctx.close(); }

    // S-168 (Azure Chunk 2 — GPT audit P2, coverage): a sent row the server returns in NO bucket
    // (accepted/duplicate/rejected/failed all omit it — e.g. a partial 2xx) must stay unsynced AND force a
    // retry (pending true) — never a clean "Synced ✓" with pending cleared that strands the row.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', inputCount: 1, accepted: [], duplicates: [], rejected: [], failed: [], serverTimestamp: 1 } : { items: [], maxId: '0', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { let lastStatus = ''; Sync._showStatus = (msg) => { lastStatus = String(msg || ''); }; Sync._setPending(false); Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'sb168', type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-06-24', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); try { await Sync.push(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 300)); await DB.refresh(); const t = DB.get().transactions.find(x => x.id === 'sb168'); return { synced: t ? !!t._synced : 'GONE', rejected: t ? t._rejected === true : false, pending: Sync._getPending(), lastStatus }; }, s);
      rec('S-168', 'no-bucket sent row stays unsynced + forces retry (not falsely Synced)', r.synced === false && r.rejected !== true && r.pending === true && r.lastStatus.indexOf('Synced ✓') === -1, `synced=${r.synced} rejected=${r.rejected} pending=${r.pending} status="${r.lastStatus}" (clean: false/notTrue/true/not-Synced)`); await ctx.close(); }

    // S-169 (Azure Chunk 2 — GPT audit P2): if the durable quarantine write (markTransactionsRejected)
    // FAILS, push must keep pending + retry and NOT report a clean "Synced" — else the rejected row is
    // stranded (un-flagged, un-synced, no proactive retry).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', inputCount: 1, accepted: [], duplicates: [], rejected: [{ index: 0, TransactionId: 'sb169', reasonCode: 'BAD_ID', reason: 'x' }], failed: [], serverTimestamp: 1 } : { items: [], maxId: '0', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { let lastStatus = ''; Sync._showStatus = (msg) => { lastStatus = String(msg || ''); }; DB.markTransactionsRejected = async () => false; Sync._setPending(false); Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'sb169', type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-06-24', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); try { await Sync.push(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 300)); return { pending: Sync._getPending(), lastStatus }; }, s);
      rec('S-169', 'failed quarantine write keeps pending + retry (not falsely Synced)', r.pending === true && r.lastStatus.indexOf('Synced ✓') === -1, `pending=${r.pending} status="${r.lastStatus}" (clean: true + not-Synced)`); await ctx.close(); }

    // S-170 (Azure Chunk 2 — GPT audit P2, fail-closed; round-2 strengthened): if the server returns the SAME
    // id in BOTH a "landed" bucket (accepted/duplicate) AND rejected/failed, the response is contradictory.
    // The client must make NO durable change to that row — NOT _synced AND NOT quarantined (_rejected) — and
    // keep pending + retry, so the row genuinely re-sends next cycle. (Round-1 quarantined it, which silently
    // removed it from the retry set — GPT's round-2 BLOCK. Asserting rejected!==true captures that.)
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPush = body.includes('"transactions"'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isPush ? { status: 'ok', inputCount: 1, accepted: ['sb170'], duplicates: [], rejected: [{ index: 0, TransactionId: 'sb170', reasonCode: 'BAD_ID', reason: 'x' }], failed: [], serverTimestamp: 1 } : { items: [], maxId: '0', count: 0, status: 'ok' }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Sync._setPending(false); Sync._pushUrl = 'https://x.logic.azure.com/push'; Sync._isLeader = true; Sync._syncLock = false; const txn = { id: 'sb170', type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-06-24', createdAt: new Date().toISOString(), _synced: false }; await DB.addTransactionDurable(txn); try { await Sync.push(); } catch (e) {} await new Promise(r2 => setTimeout(r2, 300)); await DB.refresh(); const t = DB.get().transactions.find(x => x.id === 'sb170'); return { synced: t ? !!t._synced : 'GONE', rejected: t ? t._rejected === true : 'GONE', pending: Sync._getPending() }; }, s);
      rec('S-170', 'conflicting-bucket id: not synced AND not quarantined (retries) + keeps pending', r.synced === false && r.rejected !== true && r.pending === true, `synced=${r.synced} rejected=${r.rejected} pending=${r.pending} (clean: false + notTrue + true)`); await ctx.close(); }

    // ───────── Azure Chunk 4 — multi-table record sync (records.js) ─────────
    // S-171: submitting a transfer ALSO emits a `submit` record-step (additive), carrying the
    // transfer_out ledger ids as expectedLedgerKeys (R1). Drives the LIVE Transfer.create path.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const to = (d.stores.find(x => x.id !== s.storeId && x.active) || {}).id; await DB.addTransactionDurable({ id: 'seed171_' + Date.now(), type: 'in', qty: 50, storeId: s.storeId, productId: s.productId, date: '2026-07-01', createdAt: new Date().toISOString() }); if (Stock._buildCache) Stock._buildCache(); const res = await Transfer.create(s.storeId, to, [{ productId: s.productId, qty: 5 }]); await new Promise(r => setTimeout(r, 200)); const sub = (DB.get().recordSteps || []).find(x => x.recordId === res.transferId && x.stepType === 'submit'); return { ok: res.ok, hasSubmit: !!sub, type: sub ? sub.recordType : '', keys: sub ? (sub.payload.expectedLedgerKeys || []).length : 0 }; }, s);
      rec('S-171', 'submitting a transfer emits a submit record-step (with ledger keys for R1)', r.ok && r.hasSubmit && r.type === 'transfer' && r.keys > 0, `ok=${r.ok} submit=${r.hasSubmit} type=${r.type} keys=${r.keys} (clean: true/true/transfer/>0)`); await ctx.close(); }

    // S-172: receiving a transfer emits a `receive` step keyed on the STABLE receiveAttemptId (D4-E),
    // carrying the transfer_in ledger ids. Drives the LIVE Transfer.receive path.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const to = s.storeId; const from = (d.stores.find(x => x.id !== to && x.active) || {}).id; const tid = 'r172_' + Date.now(); const tr = { id: tid, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: from, toStoreId: to, createdBy: Auth.actor(), createdByName: 't', status: 'in_transit', type: 'standard', items: [{ productId: s.productId, sentQty: 5, receivedQty: null, status: 'pending', flagNote: '' }], receivedBy: null, notes: '' }; d.transfers = d.transfers || []; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); const res = await Transfer.receive(tid, [{ productId: s.productId, receivedQty: 5 }]); await new Promise(r => setTimeout(r, 200)); const step = (DB.get().recordSteps || []).find(x => x.recordId === tid && x.stepType === 'receive'); return { ok: res.ok, hasReceive: !!step, keyed: step ? step.stepId.indexOf(':receive:' + to + ':') > 0 : false, attempt: step ? !!step.payload.receiveAttemptId : false, keys: step ? (step.payload.expectedLedgerKeys || []).length : 0 }; }, s);
      rec('S-172', 'receiving emits a receive step keyed on receiveAttemptId + ledger keys', r.ok && r.hasReceive && r.keyed && r.attempt && r.keys > 0, `ok=${r.ok} recv=${r.hasReceive} keyed=${r.keyed} attempt=${r.attempt} keys=${r.keys} (clean: all true/>0)`); await ctx.close(); }

    // S-173: the fold rebuilds a transfer from its steps and is ORDER-INDEPENDENT (sort Seq→Timestamp→StepId).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { const tid = 't173'; const submit = { stepId: 'tr:' + tid + ':submit', recordType: 'transfer', recordId: tid, stepType: 'submit', seq: 10, fromStoreId: 'a', toStoreId: 'b', status: 'in_transit', timestamp: 1000, payload: { fromStoreId: 'a', toStoreId: 'b', type: 'standard', items: [{ productId: 'p1', sentQty: 5 }], expectedLedgerKeys: [] } }; const receive = { stepId: 'tr:' + tid + ':receive:b:ra1', recordType: 'transfer', recordId: tid, stepType: 'receive', seq: 20, fromStoreId: 'a', toStoreId: 'b', status: 'completed', timestamp: 2000, deviceId: 'D1', payload: { receiveAttemptId: 'ra1', lines: [{ productId: 'p1', receivedQty: 5, flagged: false }], completed: true, expectedLedgerKeys: [] } }; const a = Records.foldRecord([submit, receive]); const b = Records.foldRecord([receive, submit]); return { statusA: a && a.status, qtyA: a && a.items[0].receivedQty, sameStatus: !!a && !!b && a.status === b.status, sameQty: !!a && !!b && a.items[0].receivedQty === b.items[0].receivedQty }; });
      rec('S-173', 'fold rebuilds a transfer from steps, order-independent', r.statusA === 'completed' && r.qtyA === 5 && r.sameStatus && r.sameQty, `status=${r.statusA} qty=${r.qtyA} sameStatus=${r.sameStatus} sameQty=${r.sameQty} (clean: completed/5/true/true)`); await ctx.close(); }

    // S-174: double-receive conflict detection — two receive attempts with DIFFERENT per-line qty → status
    // 'conflict'; SAME qty → NOT a conflict (benign duplicate, silent). Pure Records.foldRecord logic.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { const mk = (att, qty, ts, dev) => ({ stepId: 'tr:t174:receive:b:' + att, recordType: 'transfer', recordId: 't174', stepType: 'receive', seq: 20, fromStoreId: 'a', toStoreId: 'b', status: 'completed', timestamp: ts, deviceId: dev, payload: { receiveAttemptId: att, lines: [{ productId: 'p1', receivedQty: qty, flagged: false }], completed: true, expectedLedgerKeys: [] } }); const submit = { stepId: 'tr:t174:submit', recordType: 'transfer', recordId: 't174', stepType: 'submit', seq: 10, fromStoreId: 'a', toStoreId: 'b', status: 'in_transit', timestamp: 1000, payload: { fromStoreId: 'a', toStoreId: 'b', items: [{ productId: 'p1', sentQty: 10 }], expectedLedgerKeys: [] } }; const diff = Records.foldRecord([submit, mk('ra1', 5, 2000, 'D1'), mk('ra2', 3, 2100, 'D2')]); const same = Records.foldRecord([submit, mk('ra1', 5, 2000, 'D1'), mk('ra2', 5, 2100, 'D2')]); return { diffStatus: diff && diff.status, sameStatus: same && same.status }; });
      rec('S-174', 'double-receive: different qty → conflict, same qty → no conflict (silent)', r.diffStatus === 'conflict' && r.sameStatus !== 'conflict', `diff=${r.diffStatus} same=${r.sameStatus} (clean: conflict / not-conflict)`); await ctx.close(); }

    // S-175: R1 stock-state derivation — 'confirmed' (ledger rows present + not rejected), 'mismatch' (any
    // expected key server-rejected), 'pending' (any key not yet seen). Pure Records.stockStateFor logic.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { const d = DB.get(); d.transactions.push({ id: 'k_ok', type: 'in', qty: 1, storeId: 'x', productId: 'p', date: '2026-07-01', createdAt: new Date().toISOString(), _synced: true }); d.transactions.push({ id: 'k_rej', type: 'in', qty: 1, storeId: 'x', productId: 'p', date: '2026-07-01', createdAt: new Date().toISOString(), _synced: false, _rejected: true }); return { confirmed: Records.stockStateFor(['k_ok']), mismatch: Records.stockStateFor(['k_ok', 'k_rej']), pending: Records.stockStateFor(['k_missing']) }; });
      rec('S-175', 'R1 stock state: confirmed / mismatch (rejected) / pending (missing)', r.confirmed === 'confirmed' && r.mismatch === 'mismatch' && r.pending === 'pending', `confirmed=${r.confirmed} mismatch=${r.mismatch} pending=${r.pending} (clean: confirmed/mismatch/pending)`); await ctx.close(); }

    // S-176: pushSteps R1 FAIL-CLOSED ordering — a stock-effecting step is HELD (not pushed) until ALL its
    // expectedLedgerKeys are durably _synced; once they are, it becomes eligible. Drives LIVE Sync.pushSteps.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; let steps = []; try { steps = (JSON.parse(body).data.steps) || []; } catch (e) {} const ids = steps.map(x => x.StepId); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', inputCount: ids.length, accepted: ids, duplicates: [], rejected: [], failed: [], serverTimestamp: 1 }) }); }); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { Sync._stepsPushUrl = 'https://x.logic.azure.com/steps-push'; Sync._isLeader = true; Sync._syncLock = false; const lk = 'lk176'; await DB.addTransactionDurable({ id: lk, type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-07-01', createdAt: new Date().toISOString(), _synced: false }); const step = { stepId: 'tr:t176:receive:b:ra', recordType: 'transfer', recordId: 't176', stepType: 'receive', seq: 20, fromStoreId: 'a', toStoreId: 'b', status: 'completed', timestamp: 1, payload: { receiveAttemptId: 'ra', lines: [], expectedLedgerKeys: [lk] }, _synced: false }; await DB.addStepDurable(step); await Sync.pushSteps(); await new Promise(r => setTimeout(r, 200)); const heldStep = DB.get().recordSteps.find(x => x.stepId === step.stepId); const held = heldStep ? heldStep._synced !== true : false; await DB.markTransactionsSynced(new Set([lk])); Sync._syncLock = false; await Sync.pushSteps(); await new Promise(r => setTimeout(r, 200)); const after = DB.get().recordSteps.find(x => x.stepId === step.stepId); return { held, eligibleAfter: after ? after._synced === true : false }; }, s);
      rec('S-176', 'pushSteps R1 fail-closed: step held until ledger synced, then eligible', r.held && r.eligibleAfter, `held=${r.held} eligibleAfter=${r.eligibleAfter} (clean: both true)`); await ctx.close(); }

    // S-177: pushSteps honours the honest contract — a server-rejected step is durably quarantined
    // (_rejected) and NOT marked _synced (no silent data loss). Drives LIVE Sync.pushSteps.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; let steps = []; try { steps = (JSON.parse(body).data.steps) || []; } catch (e) {} const ids = steps.map(x => x.StepId); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', inputCount: ids.length, accepted: [], duplicates: [], rejected: ids.map((id, i) => ({ index: i, StepId: id, reasonCode: 'BAD_STEP', reason: 'x' })), failed: [], serverTimestamp: 1 }) }); }); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { Sync._stepsPushUrl = 'https://x.logic.azure.com/steps-push'; Sync._isLeader = true; Sync._syncLock = false; const step = { stepId: 'st:t177:reject', recordType: 'stocktake', recordId: 't177', stepType: 'reject', seq: 30, ownerStoreId: 'x', status: 'rejected', timestamp: 1, payload: { rejectedBy: 'd' }, _synced: false }; await DB.addStepDurable(step); await Sync.pushSteps(); await new Promise(r => setTimeout(r, 200)); const s2 = DB.get().recordSteps.find(x => x.stepId === step.stepId); return { synced: s2 ? s2._synced === true : 'GONE', rejected: s2 ? s2._rejected === true : 'GONE', code: s2 ? s2._rejectCode : '' }; });
      rec('S-177', 'pushSteps: server-rejected step quarantined (_rejected) + NOT synced', r.synced === false && r.rejected === true && r.code === 'BAD_STEP', `synced=${r.synced} rejected=${r.rejected} code=${r.code} (clean: false+true+BAD_STEP)`); await ctx.close(); }

    // S-178: pullSteps merges a remote step and FOLDS it into a materialised local record (a transfer this
    // device never created becomes visible). Drives LIVE Sync.pullSteps + Records.applyFold.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; const isPull = body.includes('lastId'); if (!isPull) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ ID: 10, StepId: 'tr:p178:submit', RecordType: 'transfer', RecordId: 'p178', StepType: 'submit', Seq: 10, OwnerStoreId: 'a', FromStoreId: 'a', ToStoreId: 'b', Status: 'in_transit', Payload: JSON.stringify({ fromStoreId: 'a', toStoreId: 'b', type: 'standard', items: [{ productId: 'p', sentQty: 3 }], expectedLedgerKeys: [] }), ActorId: '', ActorName: 'x', DeviceId: 'OTHER', Timestamp: 1000, Deleted: false }], maxId: '10', count: 1, status: 'ok' }) }); }); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { Sync._stepsPullUrl = 'https://x.logic.azure.com/steps-pull'; Sync._syncLock = false; Sync._lastStepSyncId = 0; localStorage.removeItem('bob_last_step_sp_id'); try { await Sync.pullSteps(); } catch (e) {} await new Promise(r => setTimeout(r, 300)); const stepStored = (DB.get().recordSteps || []).some(x => x.stepId === 'tr:p178:submit'); const tr = (DB.get().transfers || []).find(x => x.id === 'p178'); return { stepStored, materialised: !!tr, status: tr ? tr.status : '' }; });
      rec('S-178', 'pullSteps merges a remote step + folds it into a materialised record', r.stepStored && r.materialised && r.status === 'in_transit', `stepStored=${r.stepStored} materialised=${r.materialised} status=${r.status} (clean: true/true/in_transit)`); await ctx.close(); }

    // S-179: automatic backfill (D4-I) emits ONE deterministic snapshot step per pre-existing local record and
    // runs ONCE (guarded by the migration flag). Drives LIVE Records.runBackfillOnce.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { localStorage.removeItem('bob_records_backfilled'); const d = DB.get(); d.transfers = d.transfers || []; const tid = 'bf179_' + Date.now(); const tr = { id: tid, fromStoreId: 'a', toStoreId: 'b', status: 'completed', items: [{ productId: 'p', sentQty: 1 }] }; d.transfers.push(tr); await DB.updateTransferDurable(tr); const first = await Records.runBackfillOnce(); const step = (DB.get().recordSteps || []).find(x => x.recordId === tid && x.stepType === 'backfill'); const second = await Records.runBackfillOnce(); const count = (DB.get().recordSteps || []).filter(x => x.recordId === tid && x.stepType === 'backfill').length; return { first, hasStep: !!step, detId: step ? step.stepId.indexOf('tr:' + tid + ':backfill:') === 0 : false, flag: localStorage.getItem('bob_records_backfilled') === '1', count }; });
      rec('S-179', 'backfill emits one deterministic snapshot step per record, runs once', r.first && r.hasStep && r.detId && r.flag && r.count === 1, `first=${r.first} step=${r.hasStep} detId=${r.detId} flag=${r.flag} count=${r.count} (clean: true×4 + count 1)`); await ctx.close(); }

    // S-180 (D4-M): new delivery + stock-take ids carry a crypto suffix (Records.genId), not bare Date.now()
    // — required for cross-device id uniqueness once records sync. Source check against the (mutated) repo copy.
    { const idx = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
      const delCrypto = idx.includes("Records.genId('del_')") && !/id:'del_'\+Date\.now\(\),/.test(idx);
      const stCrypto = idx.includes("Records.genId('st_')");
      rec('S-180', 'new delivery/stocktake ids use a crypto suffix (Records.genId), not bare Date.now() (source check)', delCrypto && stCrypto, `delCrypto=${delCrypto} stCrypto=${stCrypto} (clean: both true)`); }

    // S-181: Director resolveConflict applies ONLY the delta adjustment (chosen − already-credited), emits a
    // resolve step at a BUMPED generation that NAMES the settled attempts, and completes the transfer.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const to = s.storeId; const pid = s.productId; const tid = 'c181_' + Date.now(); await DB.addTransactionDurable({ id: 'cin181_' + Date.now(), type: 'transfer_in', qty: 5, storeId: to, productId: pid, transferId: tid, date: '2026-07-01', createdAt: new Date().toISOString(), _synced: true }); if (Stock._buildCache) Stock._buildCache(); const from = (d.stores.find(x => x.id !== to && x.active) || {}).id; const tr = { id: tid, fromStoreId: from, toStoreId: to, status: 'conflict', type: 'standard', items: [{ productId: pid, sentQty: 10, receivedQty: 5, status: 'accepted' }], _conflict: { kind: 'qty_disagreement', generation: 0, attempts: [{ attemptId: 'ra1', deviceId: 'D1', lines: [{ productId: pid, receivedQty: 5 }] }, { attemptId: 'ra2', deviceId: 'D2', lines: [{ productId: pid, receivedQty: 3 }] }] } }; d.transfers = d.transfers || []; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); const res = await Transfer.resolveConflict(tid, { [pid]: 3 }); await new Promise(r => setTimeout(r, 200)); const adj = (DB.get().transactions || []).filter(t => t.transferId === tid && (t.type === 'adjustment_out' || t.type === 'adjustment_in')); const step = (DB.get().recordSteps || []).find(x => x.recordId === tid && x.stepType === 'resolve'); const t2 = DB.get().transfers.find(x => x.id === tid); return { ok: res.ok, adjType: adj[0] && adj[0].type, adjQty: adj[0] && adj[0].qty, gen: step ? step.payload.generation : 0, names: step ? (step.payload.resolvesAttemptIds || []).length : 0, status: t2 && t2.status }; }, s);
      rec('S-181', 'resolveConflict applies ONLY the delta adjustment + bumped-generation resolve naming attempts', r.ok && r.adjType === 'adjustment_out' && r.adjQty === 2 && r.gen === 1 && r.names === 2 && r.status === 'completed', `ok=${r.ok} adj=${r.adjType}/${r.adjQty} gen=${r.gen} names=${r.names} status=${r.status} (clean: ok/adjustment_out/2/1/2/completed)`); await ctx.close(); }

    // S-182 (Chunk 4 / D4-E ledger dedup): receiving a transfer TAGS the initial transfer_in ledger row with the
    // deterministic per-product receive key, and _toSharePoint carries it as IdempotencyKey; a non-receive row
    // falls back to its TransactionId. (Two offline devices compute the SAME key → the server's Enforce-Unique 409s
    // the 2nd → stock can't double.) Drives LIVE Transfer.receive + Sync._toSharePoint.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir; const to = s.storeId; const from = (d.stores.find(x => x.id !== to && x.active) || {}).id; const tid = 'r182_' + Date.now(); const tr = { id: tid, date: new Date().toISOString(), createdAt: new Date().toISOString(), fromStoreId: from, toStoreId: to, createdBy: Auth.actor(), createdByName: 't', status: 'in_transit', type: 'standard', items: [{ productId: s.productId, sentQty: 5, receivedQty: null, status: 'pending', flagNote: '' }], receivedBy: null, notes: '' }; d.transfers = d.transfers || []; d.transfers.push(tr); await DB.updateTransferDurable(tr, null); await Transfer.receive(tid, [{ productId: s.productId, receivedQty: 5 }]); const rin = (DB.get().transactions || []).find(t => t.transferId === tid && t.type === 'transfer_in'); const sp = Sync._toSharePoint(rin); const otherSp = Sync._toSharePoint({ id: 'oo182', type: 'in', qty: 1, storeId: to, productId: s.productId, date: '2026-07-01', createdAt: new Date().toISOString() }); const expected = 'transfer:' + tid + ':receive:' + to + ':' + s.productId; return { tagged: rin ? rin.idempotencyKey : '', spKey: sp.IdempotencyKey, expected, otherKey: otherSp.IdempotencyKey }; }, s);
      rec('S-182', 'receive tags the ledger row + _toSharePoint carries the per-product receive idempotency key (else TransactionId)', r.tagged === r.expected && r.spKey === r.expected && r.otherKey === 'oo182', `tagged=${r.tagged === r.expected} spKey=${r.spKey === r.expected} otherKey=${r.otherKey} (clean: true/true/oo182)`); await ctx.close(); }

    // S-183 (GPT Chunk-4 BLOCK #1 / R1): the FOLD must not present a clean completed receive whose stock hasn't
    // landed — a receive step with a missing ledger key folds to status 'stock_pending', a rejected one to
    // 'stock_mismatch' (NOT 'completed'). A confirmed receive stays 'completed'. Pure Records logic.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const d = DB.get(); d.transactions.push({ id: 'r183_ok', type: 'transfer_in', qty: 5, storeId: 'b', productId: 'p1', date: '2026-07-02', createdAt: new Date().toISOString(), _synced: true }); d.transactions.push({ id: 'r183_rej', type: 'transfer_in', qty: 5, storeId: 'b', productId: 'p1', date: '2026-07-02', createdAt: new Date().toISOString(), _synced: false, _rejected: true });
        const mk = keys => { const submit = { stepId: 'tr:x:submit', recordType: 'transfer', recordId: 'x', stepType: 'submit', seq: 10, fromStoreId: 'a', toStoreId: 'b', status: 'in_transit', timestamp: 1000, payload: { fromStoreId: 'a', toStoreId: 'b', items: [{ productId: 'p1', sentQty: 5 }], expectedLedgerKeys: [] } }; const receive = { stepId: 'tr:x:receive:b:ra1', recordType: 'transfer', recordId: 'x', stepType: 'receive', seq: 20, fromStoreId: 'a', toStoreId: 'b', status: 'completed', timestamp: 2000, deviceId: 'D1', payload: { receiveAttemptId: 'ra1', lines: [{ productId: 'p1', receivedQty: 5, flagged: false }], completed: true, expectedLedgerKeys: keys } }; return Records.foldRecord([submit, receive]); };
        return { confirmed: mk(['r183_ok']).status, pending: mk(['r183_missing']).status, mismatch: mk(['r183_ok', 'r183_rej']).status };
      });
      rec('S-183', 'R1: receive without landed stock folds to stock_pending / stock_mismatch, not clean completed', r.confirmed === 'completed' && r.pending === 'stock_pending' && r.mismatch === 'stock_mismatch', `confirmed=${r.confirmed} pending=${r.pending} mismatch=${r.mismatch} (clean: completed/stock_pending/stock_mismatch)`); await ctx.close(); }

    // S-184 (GPT Chunk-4 BLOCK #2): a resolve step that covers all conflicting receive attempts CLEARS the
    // conflict — the record folds to completed, not back to 'conflict'. A late uncovered receive reopens it.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const submit = { stepId: 'tr:c:submit', recordType: 'transfer', recordId: 'c', stepType: 'submit', seq: 10, fromStoreId: 'a', toStoreId: 'b', status: 'in_transit', timestamp: 1000, payload: { fromStoreId: 'a', toStoreId: 'b', items: [{ productId: 'p1', sentQty: 10 }], expectedLedgerKeys: [] } };
        const recv = (att, qty, ts) => ({ stepId: 'tr:c:receive:b:' + att, recordType: 'transfer', recordId: 'c', stepType: 'receive', seq: 20, fromStoreId: 'a', toStoreId: 'b', status: 'received', timestamp: ts, deviceId: att, payload: { receiveAttemptId: att, lines: [{ productId: 'p1', receivedQty: qty, flagged: false }], completed: true, expectedLedgerKeys: [] } });
        const resolve = { stepId: 'tr:c:resolve:1:h', recordType: 'transfer', recordId: 'c', stepType: 'resolve', seq: 40, fromStoreId: 'a', toStoreId: 'b', status: 'completed', timestamp: 3000, payload: { generation: 1, resolvesAttemptIds: ['ra1', 'ra2'], resolutions: [{ productId: 'p1', action: 'conflict_resolved', qty: 5 }], expectedLedgerKeys: [] } };
        const unresolved = Records.foldRecord([submit, recv('ra1', 5, 2000), recv('ra2', 3, 2100)]).status;
        const resolved = Records.foldRecord([submit, recv('ra1', 5, 2000), recv('ra2', 3, 2100), resolve]).status;
        const reopened = Records.foldRecord([submit, recv('ra1', 5, 2000), recv('ra2', 3, 2100), resolve, recv('ra3', 7, 4000)]).status;
        return { unresolved, resolved, reopened };
      });
      rec('S-184', 'resolve covering all attempts clears the conflict (folds completed); a late receive reopens it', r.unresolved === 'conflict' && r.resolved === 'completed' && r.reopened === 'conflict', `unresolved=${r.unresolved} resolved=${r.resolved} reopened=${r.reopened} (clean: conflict/completed/conflict)`); await ctx.close(); }

    // S-185 (GPT Chunk-4 BLOCK #3 / D4-I): two backfill snapshots for one record with DIFFERENT content hashes
    // fold to 'conflict' (backfill_divergence) — not a silent last-writer-wins. Same hash → not a conflict.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const bf = (hash, status) => ({ stepId: 'tr:z:backfill:' + hash, recordType: 'transfer', recordId: 'z', stepType: 'backfill', seq: 5, fromStoreId: 'a', toStoreId: 'b', status: status, timestamp: 1000, payload: { snapshot: { id: 'z', fromStoreId: 'a', toStoreId: 'b', status: status, items: [{ productId: 'p1', sentQty: 5 }] }, hash: hash } });
        const diverge = Records.foldRecord([bf('aaa1', 'completed'), bf('bbb2', 'cancelled')]);
        const same = Records.foldRecord([bf('aaa1', 'completed'), bf('aaa1', 'completed')]);
        return { divergeStatus: diverge && diverge.status, divergeKind: diverge && diverge._conflict && diverge._conflict.kind, sameStatus: same && same.status };
      });
      rec('S-185', 'divergent backfill snapshots (different content hash) fold to conflict, not silent first-writer-wins', r.divergeStatus === 'conflict' && r.divergeKind === 'backfill_divergence' && r.sameStatus !== 'conflict', `diverge=${r.divergeStatus}/${r.divergeKind} same=${r.sameStatus} (clean: conflict/backfill_divergence/not-conflict)`); await ctx.close(); }

    // S-186 (Chunk 5 / D2d): Sync._withAuth attaches the auth envelope from the device keys — and with NO
    // keys stored the request body is byte-identical to pre-Chunk-5 (D6 phase-1 compatibility).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        localStorage.setItem('bob_auth_store_id', 'karrinyup'); localStorage.setItem('bob_auth_store_key', 'bsk_t186'); localStorage.setItem('bob_auth_director_key', 'bdk_t186');
        Sync._deviceId = 'dev186';
        const withKeys = Sync._withAuth({ data: { x: 1 } });
        localStorage.removeItem('bob_auth_store_id'); localStorage.removeItem('bob_auth_store_key'); localStorage.removeItem('bob_auth_director_key');
        const without = Sync._withAuth({ data: { x: 1 } });
        return { a: withKeys.auth && withKeys.auth.storeId === 'karrinyup' && withKeys.auth.storeKey === 'bsk_t186' && withKeys.auth.directorKey === 'bdk_t186' && withKeys.auth.deviceId === 'dev186' && withKeys.data.x === 1, b: !('auth' in without) && without.data.x === 1 };
      });
      rec('S-186', 'Chunk 5: _withAuth attaches the auth envelope from device keys; NO keys = unchanged pre-Chunk-5 body', r.a && r.b, `withKeys=${r.a} without=${r.b} (clean: true/true)`); await ctx.close(); }

    // S-187 (Chunk 5 / D6): a 401 on push is TERMINAL for the cycle — unauthorized state set, cached config
    // cleared, batch left pending, and NO retry timer (never a retry-loop against an auth wall).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"status":"unauthorized","authRequired":true}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => {
        localStorage.setItem('bob_auth_store_id', s.storeId); localStorage.setItem('bob_auth_store_key', 'bsk_wrong187');
        sessionStorage.setItem('bob_sync_config', JSON.stringify({ pushUrl: 'https://prod-00.westus.logic.azure.com/p', pullUrl: 'https://prod-00.westus.logic.azure.com/q' }));
        Sync._loadConfig();
        await DB.addTransactionDurable({ id: 't187_' + Date.now(), type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2026-07-04', createdAt: new Date().toISOString(), _synced: false });
        await Sync.push();
        const out = { unauth: Sync._unauthorized === true, cfgCleared: sessionStorage.getItem('bob_sync_config') === null, noRetry: !Sync._syncRetryTimer, pending: Sync._getPending() === true };
        localStorage.removeItem('bob_auth_store_id'); localStorage.removeItem('bob_auth_store_key');
        return out;
      }, s);
      rec('S-187', 'Chunk 5: push 401 -> unauthorized state + config cache cleared + pending kept + NO retry-loop', r.unauth && r.cfgCleared && r.noRetry && r.pending, `unauth=${r.unauth} cfgCleared=${r.cfgCleared} noRetry=${r.noRetry} pending=${r.pending} (clean: all true)`); await ctx.close(); }

    // S-188 (Chunk 5 / D6): while unauthorized the sync cycle is PAUSED (no fetch storm from the 30s poll);
    // saving keys clears the pause and re-bootstraps config.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', items: [{ ConfigType: 'sync_config', ConfigData: JSON.stringify({ pushUrl: 'https://prod-00.westus.logic.azure.com/p', pullUrl: 'https://prod-00.westus.logic.azure.com/q' }) }] }) })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        Sync._unauthorized = true;
        let pushed = false; const origPush = Sync.push; Sync.push = async () => { pushed = true; };
        const res = await Sync._runSyncCycle();
        Sync.push = origPush;
        const paused = res && res.unauthorized === true && !pushed;
        Sync.CONFIG_URL = 'https://prod-00.westus.logic.azure.com/cfg';
        const ok = await Sync.saveAuthKeys('karrinyup', 'bsk_t188', '');
        const cleared = Sync._unauthorized === false;
        localStorage.removeItem('bob_auth_store_id'); localStorage.removeItem('bob_auth_store_key'); localStorage.removeItem('bob_auth_director_key');
        return { paused, ok: !!ok, cleared };
      });
      rec('S-188', 'Chunk 5: unauthorized pauses the sync cycle; saveAuthKeys clears the pause + re-bootstraps config', r.paused && r.ok && r.cleared, `paused=${r.paused} rebootstrap=${r.ok} cleared=${r.cleared} (clean: all true)`); await ctx.close(); }

    // S-189 (Chunk 5 / D2d + L36): sync keys NEVER survive into a backup — the scrubber strips auth/storeKey/
    // directorKey (and steps URLs) wherever they appear, so a backup can never carry a device credential.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const hostile = { settings: { auth: { storeKey: 'bsk_leak189', directorKey: 'bdk_leak189' }, storeKey: 'bsk_leak189b' }, nested: [{ directorKey: 'bdk_leak189c', stepsPushUrl: 'https://x/leak' }] };
        const clean = Pages._scrubBackupSecrets(JSON.parse(JSON.stringify(hostile)));
        const s = JSON.stringify(clean);
        return { noKeys: !s.includes('bsk_leak189') && !s.includes('bdk_leak189') && !s.includes('https://x/leak') };
      });
      rec('S-189', 'Chunk 5: backup scrubber strips sync keys + steps URLs everywhere (backup can never carry a credential)', r.noKeys, `noKeys=${r.noKeys} (clean: true)`); await ctx.close(); }

    // S-190 (Chunk 5 / C5 canary): a sync key logged into diagnostics is REDACTED in the export.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        Diag.clear(); Diag.log('auth', 'boom key bsk_deadbeefcafe1234 and bdk_deadbeefcafe5678 leaked');
        const t = Diag.text(); Diag.clear();
        return { redacted: t.includes('[synckey-redacted]') && !t.includes('bsk_deadbeef') && !t.includes('bdk_deadbeef') };
      });
      rec('S-190', 'Chunk 5: Diag redacts bsk_/bdk_ sync keys (canary — a leaked key never reaches the export)', r.redacted, `redacted=${r.redacted} (clean: true)`); await ctx.close(); }

    // S-191 (Chunk 5 / D2): sync-key entry is Director-gated — a staff/manager session cannot write keys.
    // The DOM inputs are INJECTED with a valid store + key so the ONLY thing between a staff session and a
    // written key is the Director gate: clean code blocks (key stays null); ungated code would write it.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        localStorage.removeItem('bob_auth_store_key'); localStorage.removeItem('bob_auth_store_id');
        const mk = (id, val) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e); } e.value = val; };
        mk('auth-store-id', 'karrinyup'); mk('auth-store-key', 'bsk_staff191'); mk('auth-director-key', '');
        const origDS = Pages.dirSettings; Pages.dirSettings = () => {};   // avoid a re-render into the bare test DOM
        const d = DB.get(); const staff = (d.users || []).find(u => u.role === 'staff') || (d.users || []).find(u => u.role === 'store_manager');
        if (staff) Auth._user = staff;
        try { await Pages._saveAuthKeys(); } catch (e) {}
        const blocked = localStorage.getItem('bob_auth_store_key') === null;   // clean: gate blocked the write
        Pages.dirSettings = origDS;
        ['auth-store-id', 'auth-store-key', 'auth-director-key'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
        const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir;
        localStorage.removeItem('bob_auth_store_key'); localStorage.removeItem('bob_auth_store_id');
        return { blocked, hadStaff: !!staff };
      });
      rec('S-191', 'Chunk 5: sync-key entry is Director-gated (staff/manager session cannot write keys)', r.blocked && r.hadStaff, `blocked=${r.blocked} hadStaff=${r.hadStaff} (clean: true/true)`); await ctx.close(); }

    // ── Chunk 6: catalogue publish (up) + gated corporate-cost split ──
    // S-192 (delta + cost split): _buildCataloguePayload sends ONLY dirty rows, each with its _rv as baseRv,
    // costPrice STRIPPED from the public change; a dirty cost goes to costChanges (never the public path).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const d = DB.get(); d.products = [{ id: 'P_A', name: 'A', catId: 'c', price: 10, costPrice: 5, _rv: 3, _costRv: 2 }, { id: 'P_B', name: 'B', catId: 'c', price: 20, _rv: 1 }];
        try { localStorage.removeItem('bob_catalogue_dirty'); } catch (e) {}
        Sync._markCatalogueDirty('products', 'P_A'); Sync._markCatalogueDirty('cost', 'P_A');
        const p = Sync._buildCataloguePayload();
        const ch = p.changes.find(c => c.row.id === 'P_A');
        const cc = p.costChanges.find(c => c.productId === 'P_A');
        return { onlyDirty: p.changes.length === 1 && p.changes[0].row.id === 'P_A', baseRv: ch && ch.baseRv, costStripped: ch && !('costPrice' in ch.row), costToCostChanges: !!cc && cc.costPrice === 5 && cc.baseRv === 2 };
      });
      rec('S-192', 'Chunk 6: publish payload = only-dirty rows + _rv baseRv, cost stripped from public + routed to costChanges', r.onlyDirty && r.baseRv === 3 && r.costStripped && r.costToCostChanges, `onlyDirty=${r.onlyDirty} baseRv=${r.baseRv} costStripped=${r.costStripped} costToCostChanges=${r.costToCostChanges} (clean: true/3/true/true)`); await ctx.close(); }

    // S-193 (public never carries cost): _applyMasterData must NOT apply costPrice from the public blob even
    // if a (malicious/misconfigured) master_data includes one — the device keeps its local cost.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); d.products = [{ id: 'P_C', name: 'C', catId: 'c', price: 10, costPrice: 99, active: true }];
        try { localStorage.setItem('bob_catalogue_version', '0'); } catch (e) {}
        await Sync._applyMasterData({ version: 5, products: [{ id: 'P_C', name: 'C2', catId: 'c', price: 15, costPrice: 1 }], stores: [], categories: [], productTypes: [] });
        const p = DB.get().products.find(x => x.id === 'P_C');
        return { name: p.name, price: p.price, cost: p.costPrice };
      });
      rec('S-193', 'Chunk 6: _applyMasterData applies public fields (name/price) but NEVER costPrice from the public blob', r.name === 'C2' && r.price === 15 && r.cost === 99, `name=${r.name} price=${r.price} cost=${r.cost} (clean: C2/15/99 — cost unchanged)`); await ctx.close(); }

    // S-194 (device tier): _isCorporateDevice — Director device = corporate; a franchise store device = NOT.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const d = DB.get(); d.stores = [{ id: 'corp1', name: 'Corp', isFranchise: false }, { id: 'fr1', name: 'Fr', isFranchise: true }];
        const set = (sid, dk) => { try { localStorage.setItem('bob_auth_store_id', sid); localStorage.setItem('bob_auth_director_key', dk); localStorage.setItem('bob_auth_store_key', sid ? 'bsk_x' : ''); } catch (e) {} };
        set('', 'bdk_x'); const director = Sync._isCorporateDevice();
        set('corp1', ''); const corp = Sync._isCorporateDevice();
        set('fr1', ''); const fr = Sync._isCorporateDevice();
        localStorage.removeItem('bob_auth_store_id'); localStorage.removeItem('bob_auth_director_key'); localStorage.removeItem('bob_auth_store_key');
        return { director, corp, fr };
      });
      rec('S-194', 'Chunk 6: _isCorporateDevice — Director + corporate store = true, franchise store = false', r.director === true && r.corp === true && r.fr === false, `director=${r.director} corp=${r.corp} franchise=${r.fr} (clean: true/true/false)`); await ctx.close(); }

    // S-195 (cost applies on corporate only): _fetchCorporateCosts applies cost on a corporate device; a
    // franchise device short-circuits (never fetches) and keeps its own local cost.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', corporate_costs: { version: 2, costs: [{ productId: 'P_D', costPrice: 12, _rv: 1 }] } }) })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); d.products = [{ id: 'P_D', name: 'D', catId: 'c', price: 10, costPrice: 7, active: true }]; d.stores = [{ id: 'fr1', name: 'Fr', isFranchise: true }];
        Sync._corpCostsUrl = 'https://prod-00.westus.logic.azure.com/cc';
        try { localStorage.setItem('bob_auth_store_id', 'fr1'); localStorage.setItem('bob_auth_store_key', 'bsk_x'); localStorage.removeItem('bob_auth_director_key'); } catch (e) {}
        await Sync._fetchCorporateCosts(); const franchiseCost = DB.get().products.find(x => x.id === 'P_D').costPrice;
        try { localStorage.removeItem('bob_auth_store_id'); localStorage.setItem('bob_auth_director_key', 'bdk_x'); } catch (e) {}
        await Sync._fetchCorporateCosts(); const corpCost = DB.get().products.find(x => x.id === 'P_D').costPrice;
        localStorage.removeItem('bob_auth_director_key'); localStorage.removeItem('bob_auth_store_key');
        return { franchiseCost, corpCost };
      });
      rec('S-195', 'Chunk 6: corporate cost applies on a corporate/Director device; a franchise device keeps its own local cost', r.franchiseCost === 7 && r.corpCost === 12, `franchiseKept=${r.franchiseCost} corpApplied=${r.corpCost} (clean: 7/12)`); await ctx.close(); }

    // S-196 (honest clear): publishCatalogue clears ONLY accepted keys from dirty; rejected/conflicted stay
    // dirty; a 401 pauses (unauthorized) and clears nothing.
    { const { ctx, page } = await newPage(b);
      let mode = 'ok';
      await page.route('**logic.azure.com**', r => { if (mode === '401') return r.fulfill({ status: 401, contentType: 'application/json', body: '{"status":"unauthorized"}' }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', accepted: ['P_A'], rejected: [{ id: 'P_B', reason: 'BAD' }], conflicts: [], masterVersion: 7 }) }); });
      await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); d.products = [{ id: 'P_A', name: 'A', catId: 'c', price: 1, _rv: 1 }, { id: 'P_B', name: 'B', catId: 'c', price: 2, _rv: 1 }];
        Sync._catalogueWriteUrl = 'https://prod-00.westus.logic.azure.com/cw';
        try { localStorage.removeItem('bob_catalogue_dirty'); localStorage.setItem('bob_auth_director_key', 'bdk_x'); } catch (e) {}
        Sync._markCatalogueDirty('products', 'P_A'); Sync._markCatalogueDirty('products', 'P_B');
        await Sync.publishCatalogue();
        const dirtyAfter = Sync._catalogueDirty();
        const lp = Sync.lastPublished();
        localStorage.removeItem('bob_auth_director_key');
        return { clearedAccepted: !dirtyAfter.includes('products:P_A'), keptRejected: dirtyAfter.includes('products:P_B'), lpVersion: lp && lp.version };
      });
      rec('S-196', 'Chunk 6: publish clears only ACCEPTED rows from dirty; rejected stay dirty; last-published recorded', r.clearedAccepted && r.keptRejected && r.lpVersion === 7, `clearedAccepted=${r.clearedAccepted} keptRejected=${r.keptRejected} lpVersion=${r.lpVersion} (clean: true/true/7)`); await ctx.close(); }

    // S-197 (Director-gated publish): a non-Director session cannot trigger a publish.
    { const { ctx, page } = await newPage(b);
      let called = false;
      await page.route('**logic.azure.com**', r => { called = true; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","accepted":["P_A"],"rejected":[],"conflicts":[],"masterVersion":9}' }); });
      await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const origDS = Pages.dirSettings; Pages.dirSettings = () => {};   // avoid a full settings re-render into the bare test DOM
        const d = DB.get(); const staff = (d.users || []).find(u => u.role === 'staff') || (d.users || []).find(u => u.role === 'store_manager'); if (staff) Auth._user = staff;
        d.products = [{ id: 'P_A', name: 'A', catId: 'c', price: 1, _rv: 1 }];
        Sync._catalogueWriteUrl = 'https://prod-00.westus.logic.azure.com/cw';
        try { localStorage.removeItem('bob_catalogue_dirty'); } catch (e) {} Sync._markCatalogueDirty('products', 'P_A');
        try { await Pages._doPublishCatalogue(); } catch (e) {}
        Pages.dirSettings = origDS;
        const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir;
        return { stillDirty: Sync._catalogueDirty().includes('products:P_A'), hadStaff: !!staff };
      });
      rec('S-197', 'Chunk 6: publish is Director-gated — a staff/manager session cannot publish (dirty unchanged)', r.stillDirty && r.hadStaff, `stillDirty=${r.stillDirty} hadStaff=${r.hadStaff} (clean: true/true)`); await ctx.close(); }

    // S-198 (GPT-C6-1): a 'write_failed' publish response (server couldn't durably persist) must NOT clear any
    // dirty rows — even if the (stale) accepted array is populated. The Director retries; nothing is lost.
    { const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'write_failed', accepted: ['P_A'], rejected: [], conflicts: [], masterVersion: 9 }) }));
      await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); d.products = [{ id: 'P_A', name: 'A', catId: 'c', price: 1, _rv: 1 }];
        Sync._catalogueWriteUrl = 'https://prod-00.westus.logic.azure.com/cw';
        try { localStorage.removeItem('bob_catalogue_dirty'); localStorage.removeItem('bob_catalogue_last_published'); localStorage.setItem('bob_auth_director_key', 'bdk_x'); } catch (e) {}
        Sync._markCatalogueDirty('products', 'P_A');
        const res = await Sync.publishCatalogue();
        const out = { stillDirty: Sync._catalogueDirty().includes('products:P_A'), notOk: res.ok === false, retry: res.retry === true, noLastPub: Sync.lastPublished() === null };
        localStorage.removeItem('bob_auth_director_key');
        return out;
      });
      rec('S-198', 'Chunk 6: a write_failed publish keeps rows dirty (nothing cleared despite a stale accepted[]) + signals retry', r.stillDirty && r.notOk && r.retry && r.noLastPub, `stillDirty=${r.stillDirty} notOk=${r.notOk} retry=${r.retry} noLastPub=${r.noLastPub} (clean: all true)`); await ctx.close(); }

    // ── Chunk 7: hardening ──
    // S-199 (C2 deletion propagation): "removing" an UNUSED category DEACTIVATES it (active:false) + marks it
    // dirty for publish — it does NOT hard-delete the row (which never propagated to other devices).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const origDS = Pages.dirSettings, origRS = Pages._refreshSettings, origC = UI.confirm;
        let cbPromise = Promise.resolve();
        Pages.dirSettings = () => {}; Pages._refreshSettings = () => {}; UI.confirm = (t, m, cb) => { cbPromise = Promise.resolve(cb()); };  // auto-confirm; capture the async callback
        const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir;
        d.categories = [{ id: 'cat_z', name: 'Zed', ptId: 'pt_retail', active: true }]; d.products = (d.products || []).filter(p => p.catId !== 'cat_z');
        try { localStorage.removeItem('bob_catalogue_dirty'); } catch (e) {}
        await Pages._deleteCat('cat_z');
        await cbPromise;  // _deleteCat runs its work inside the (un-awaited) confirm callback — wait for commit + markDirty
        const cat = DB.get().categories.find(c => c.id === 'cat_z');
        const out = { stillExists: !!cat, deactivated: cat && cat.active === false, dirty: Sync._catalogueDirty().includes('categories:cat_z') };
        Pages.dirSettings = origDS; Pages._refreshSettings = origRS; UI.confirm = origC;
        return out;
      });
      rec('S-199', 'Chunk 7 C2: removing an unused category DEACTIVATES (active:false) + marks dirty, does NOT hard-delete', r.stillExists && r.deactivated && r.dirty, `stillExists=${r.stillExists} deactivated=${r.deactivated} dirty=${r.dirty} (clean: all true)`); await ctx.close(); }

    // S-200 (C2 inactive semantics): an INACTIVE category is HIDDEN from the new-product category selector,
    // but its row persists (label preserved for historical display).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const d = DB.get(); const dir = (d.users || []).find(u => u.role === 'director'); if (dir) Auth._user = dir;
        d.categories = [{ id: 'cat_on', name: 'On', ptId: 'pt_retail', active: true }, { id: 'cat_off', name: 'Off', ptId: 'pt_retail', active: false }];
        UI.modal = (title, bodyHtml) => { window.__np = bodyHtml; };  // capture the add-product modal HTML
        Pages._addProductModal();
        const html = window.__np || '';
        const sel = html.slice(html.indexOf('id="np-cat"'), html.indexOf('id="np-cat"') + 400);
        return { activeShown: sel.includes('cat_on'), inactiveHidden: !sel.includes('cat_off'), rowPersists: !!DB.get().categories.find(c => c.id === 'cat_off') };
      });
      rec('S-200', 'Chunk 7 C2: inactive category hidden from the new-product selector; its row persists (label kept)', r.activeShown && r.inactiveHidden && r.rowPersists, `activeShown=${r.activeShown} inactiveHidden=${r.inactiveHidden} rowPersists=${r.rowPersists} (clean: all true)`); await ctx.close(); }

    // S-201 (A self-host): the loaded document must carry NO third-party origin (jsdelivr / googleapis /
    // gstatic) in its <script>/<link> tags — vendor JS + fonts are self-hosted.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const ext = [...document.querySelectorAll('script[src],link[href]')].map(e => e.src || e.href).filter(u => /cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));
        return { noExternal: ext.length === 0, dexieLocal: typeof Dexie !== 'undefined', chartLocal: typeof Chart !== 'undefined', extFound: ext.join(',') };
      });
      rec('S-201', 'Chunk 7 A: no third-party origin in the DOM (Dexie/Chart/fonts self-hosted, loaded locally)', r.noExternal && r.dexieLocal && r.chartLocal, `noExternal=${r.noExternal} dexie=${r.dexieLocal} chart=${r.chartLocal} extFound=[${r.extFound}] (clean: true/true/true)`); await ctx.close(); }

    // ── Chunk 8 (ledger archival) ──────────────────────────────────────────────────────────────────────
    // S-202: pull persists the monotonic SharePoint id as _spId (needed for the archival fold); a row with no
    // usable ID stores _spId=null (never 0 — 0 would falsely read as "<= any cutoff").
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const withId = Sync._fromSharePoint({ TransactionId: 'sp202', Type: 'in', StoreId: s.storeId, ProductId: s.productId, Date: '2026-06-10', Qty: 3, ID: 1234 }); const noId = Sync._fromSharePoint({ TransactionId: 'sp202b', Type: 'in', StoreId: s.storeId, ProductId: s.productId, Date: '2026-06-10', Qty: 3 }); return { spId: withId && withId._spId, nullId: noId ? noId._spId : 'ROWNULL' }; }, s);
      rec('S-202', 'Chunk 8: pull persists _spId (SharePoint id); missing id -> null (never 0)', r.spId === 1234 && r.nullId === null, `spId=${r.spId} nullId=${r.nullId} (clean: 1234/null)`); await ctx.close(); }

    // S-203: _adoptSnapshot + _buildCache fold — seed opening balance, SKIP covered rows (_spId<=cutoff), apply
    // post-cutoff + unsynced (_spId==null) rows on top. Snapshot+recent == full total, with the covered row NOT
    // double-counted. Also: v0 clears any snapshot (no-archival sentinel).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { Sync._lastSyncId = 1000; const now = new Date().toISOString(); const d = DB.get(); d.transactions.push({ id: 's203cov', storeId: 'S8', productId: 'P', type: 'in', qty: 99, _spId: 10, _synced: false, date: '2026-01-01', createdAt: now }, { id: 's203post', storeId: 'S8', productId: 'P', type: 'out', qty: 2, _spId: 60, _synced: true, date: '2026-06-10', createdAt: now }, { id: 's203new', storeId: 'S8', productId: 'P', type: 'in', qty: 5, _spId: null, _synced: false, date: '2026-06-11', createdAt: now }); Stock._adoptSnapshot(JSON.stringify({ version: 1, cutoffId: 47, stepCutoffTs: 3000, balances: [{ storeId: 'S8', productId: 'P', balance: 12 }] })); const folded = Stock.qty('P', 'S8'); const active = Stock._snapshotActive(); Stock._adoptSnapshot(JSON.stringify({ version: 0, cutoffId: 0, stepCutoffTs: 0, balances: [] })); const clearedActive = Stock._snapshotActive(); const fullSum = Stock.qty('P', 'S8'); return { folded, active, clearedActive, fullSum }; });
      // cov row is _synced:false so the async prune leaves it (isolates the FOLD from the PRUNE — prune is S-206).
      rec('S-203', 'Chunk 8: fold seeds snapshot + skips covered + applies post-cutoff/unsynced (no double-count); v0 clears', r.folded === 15 && r.active === true && r.clearedActive === false && r.fullSum === 102, `folded=${r.folded} active=${r.active} clearedActive=${r.clearedActive} fullSumAfterClear=${r.fullSum} (clean: 15/true/false/102)`); await ctx.close(); }

    // S-204: activation gate — a snapshot whose cutoffId is AHEAD of this device's pull frontier (_lastSyncId)
    // is NOT used; the fold falls back to full-sum (always correct) until the device catches up.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { const now = new Date().toISOString(); const d = DB.get(); d.transactions.push({ id: 's204cov', storeId: 'S8b', productId: 'P', type: 'in', qty: 99, _spId: 10, _synced: true, date: '2026-01-01', createdAt: now }, { id: 's204post', storeId: 'S8b', productId: 'P', type: 'out', qty: 2, _spId: 60, _synced: true, date: '2026-06-10', createdAt: now }); Sync._lastSyncId = 10; Stock._adoptSnapshot(JSON.stringify({ version: 2, cutoffId: 47, stepCutoffTs: 3000, balances: [{ storeId: 'S8b', productId: 'P', balance: 12 }] })); return { active: Stock._snapshotActive(), qty: Stock.qty('P', 'S8b') }; });
      rec('S-204', 'Chunk 8: activation gate — cutoff ahead of sync frontier -> snapshot unused, full-sum fallback', r.active === false && r.qty === 97, `active=${r.active} qty=${r.qty} (clean: false/97 = 99-2, no seed)`); await ctx.close(); }

    // S-205: archived-key resolver (GPT P1 per-key proof) — a missing key is CONFIRMED only if it is a KNOWN
    // archived key (in DB's archived-step-key index); a NEVER-LANDED key (not in the index) stays PENDING; a
    // present+rejected key is mismatch. No date heuristic — a never-landed pre-cutoff step must not read completed.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { DB.recordArchivedStepKeys(['s205arch']); DB.get().transactions.push({ id: 's205rej', type: 'in', qty: 1, storeId: 'x', productId: 'p', _rejected: true, _synced: false, date: '2026-01-01', createdAt: new Date().toISOString() }); const archivedConfirmed = Records.stockStateFor(['s205arch'], 1500); const neverLandedPending = Records.stockStateFor(['s205never'], 1500); const rejMismatch = Records.stockStateFor(['s205rej'], 1500); return { archivedConfirmed, neverLandedPending, rejMismatch, isArch: DB.hasArchivedStepKey('s205arch'), notArch: DB.hasArchivedStepKey('s205never') }; });
      rec('S-205', 'Chunk 8: resolver — known-archived key=confirmed, never-landed key=pending, rejected=mismatch (per-key proof)', r.archivedConfirmed === 'confirmed' && r.neverLandedPending === 'pending' && r.rejMismatch === 'mismatch' && r.isArch === true && r.notArch === false, `archived=${r.archivedConfirmed} neverLanded=${r.neverLandedPending} rejected=${r.rejMismatch} idx(arch=${r.isArch},never=${r.notArch}) (clean: confirmed/pending/mismatch/true/false)`); await ctx.close(); }

    // S-206: prune shrinks the working set SAFELY — removes only DURABLY-SYNCED rows with _spId<=cutoff; keeps
    // post-cutoff rows, unsynced rows, and _spId==null rows (never lose stock that may not be in the cloud yet).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { const now = new Date().toISOString(); const rows = [ { id: 's206syncedOld', storeId: 'S8c', productId: 'P', type: 'in', qty: 1, _spId: 10, _synced: true, date: '2026-01-01', createdAt: now }, { id: 's206syncedPost', storeId: 'S8c', productId: 'P', type: 'in', qty: 1, _spId: 60, _synced: true, date: '2026-06-10', createdAt: now }, { id: 's206unsyncedOld', storeId: 'S8c', productId: 'P', type: 'in', qty: 1, _spId: 5, _synced: false, date: '2026-01-02', createdAt: now }, { id: 's206null', storeId: 'S8c', productId: 'P', type: 'in', qty: 1, _spId: null, _synced: false, date: '2026-06-11', createdAt: now } ]; await bobDB.transactions.bulkPut(rows); await DB.refresh(); const n = await DB.pruneArchivedLedger(47); const ids = new Set(DB.get().transactions.map(t => t.id)); return { n, removedOldSynced: !ids.has('s206syncedOld'), keptPost: ids.has('s206syncedPost'), keptUnsyncedOld: ids.has('s206unsyncedOld'), keptNull: ids.has('s206null') }; });
      rec('S-206', 'Chunk 8: prune removes ONLY synced rows <=cutoff; keeps post-cutoff, unsynced, and _spId==null', r.n === 1 && r.removedOldSynced && r.keptPost && r.keptUnsyncedOld && r.keptNull, `n=${r.n} removedOldSynced=${r.removedOldSynced} keptPost=${r.keptPost} keptUnsyncedOld=${r.keptUnsyncedOld} keptNull=${r.keptNull} (clean: 1 + all true)`); await ctx.close(); }

    // S-207: reports fail-closed archive-awareness — a range extending before the archive boundary is flagged
    // (touchesArchive); a range fully after it is not; no snapshot -> never flagged. Overlay merges into the
    // report set (Director-loaded archived movements become visible to date-range reports).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { Sync._lastSyncId = 1000; const ts = new Date('2026-06-01T00:00:00Z').getTime(); Stock._adoptSnapshot(JSON.stringify({ version: 1, cutoffId: 47, stepCutoffTs: ts, balances: [] })); const before = Stock._reportTouchesArchive('2026-01-01'); const after = Stock._reportTouchesArchive('2030-01-01'); DB.get().transactions.push({ id: 'ov207', storeId: 'x', productId: 'p', type: 'in', qty: 1, date: '2025-01-01', _archived: true, _spId: 5, _synced: true, createdAt: new Date().toISOString() }); const included = Pages._reportBaseTxns(DB.get()).some(t => t.id === 'ov207'); await DB.pruneArchivedLedger(47); const survivesPrune = DB.get().transactions.some(t => t.id === 'ov207'); Stock._adoptSnapshot(JSON.stringify({ version: 0, cutoffId: 0, stepCutoffTs: 0, balances: [] })); const noSnap = Stock._reportTouchesArchive('2000-01-01'); return { before, after, included, survivesPrune, noSnap }; });
      rec('S-207', 'Chunk 8: reports fail-closed banner + spliced overlay visible to reports + prune skips _archived', r.before === true && r.after === false && r.included === true && r.survivesPrune === true && r.noSnap === false, `before=${r.before} after=${r.after} included=${r.included} survivesPrune=${r.survivesPrune} noSnap=${r.noSnap} (clean: true/false/true/true/false)`); await ctx.close(); }

    // S-208: _verifyCacheIntegrity stays snapshot-aware — with an active snapshot + covered rows still present,
    // the cache (seed + non-covered) equals the snapshot-aware scan (no false drift).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { Sync._lastSyncId = 1000; const now = new Date().toISOString(); const d = DB.get(); d.transactions.push({ id: 's208cov', storeId: s.storeId, productId: s.productId, type: 'in', qty: 50, _spId: 10, _synced: true, date: '2026-01-01', createdAt: now }, { id: 's208post', storeId: s.storeId, productId: s.productId, type: 'in', qty: 3, _spId: 60, _synced: true, date: '2026-06-10', createdAt: now }); Stock._adoptSnapshot(JSON.stringify({ version: 1, cutoffId: 47, stepCutoffTs: 3000, balances: [{ storeId: s.storeId, productId: s.productId, balance: 50 }] })); const clean = Stock._verifyCacheIntegrity(); return { clean }; }, s);
      rec('S-208', 'Chunk 8: _verifyCacheIntegrity is snapshot-aware (seed + non-covered scan == cache, no false drift)', r.clean === true, `clean=${r.clean} (clean: true)`); await ctx.close(); }

    // S-209: (AGY P1) the pull-time _spId backfill is DURABLY persisted — commit() never writes the transactions
    // table, so DB.persistTransactionRows must bulkPut or the _spId is lost on reload (rows revert to null and
    // double-count). Proof: pre-store the row WITHOUT _spId, persist WITH _spId, refresh from Dexie, expect it kept.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { const row = { id: 's209', storeId: s.storeId, productId: s.productId, type: 'in', qty: 1, _synced: true, date: '2026-01-01', createdAt: new Date().toISOString() }; await bobDB.transactions.put({ ...row, _spId: null }); DB.get().transactions.push({ ...row, _spId: 777 }); await DB.persistTransactionRows([{ ...row, _spId: 777 }]); await DB.refresh(); const reloaded = (DB.get().transactions || []).find(t => t.id === 's209'); return { spId: reloaded ? reloaded._spId : 'GONE' }; }, s);
      rec('S-209', 'Chunk 8 (AGY P1): _spId backfill is durably persisted (survives reload — no double-count regression)', r.spId === 777, `reloaded _spId=${r.spId} (clean: 777)`); await ctx.close(); }

    // S-210: (AGY P2) deleting an ARCHIVED (snapshot-covered) movement is BLOCKED — no tombstone is written for a
    // row already folded into a published snapshot (phantom-delete guard). Drives the LIVE Pages._confirmDelete.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => { document.body.insertAdjacentHTML('beforeend', '<input id="del-name" value="Tester"><select id="del-reason"><option value="Damaged" selected>Damaged</option></select><input id="del-other" value="">'); Sync._lastSyncId = 1000; Stock._adoptSnapshot(JSON.stringify({ version: 1, cutoffId: 47, stepCutoffTs: 3000, balances: [] })); await new Promise(r => setTimeout(r, 150)); /* let the adopt-time prune finish first */ DB.get().transactions.push({ id: 's210cov', storeId: s.storeId, productId: s.productId, type: 'in', qty: 3, _spId: 10, _synced: true, date: '2026-01-01', createdAt: new Date().toISOString(), editLog: [] }); const covered = Stock._coveredBySnapshot(DB.get().transactions.find(t => t.id === 's210cov')); try { await Pages._confirmDelete('s210cov'); } catch (e) {} await new Promise(r => setTimeout(r, 100)); const survives = (DB.get().transactions || []).some(t => t.id === 's210cov'); const notTombstoned = !(DB.get().deletedTransactions || []).some(x => x.id === 's210cov'); return { covered, survives, notTombstoned }; }, s);
      rec('S-210', 'Chunk 8 (AGY P2): deleting an archived (snapshot-covered) movement is blocked (no phantom tombstone)', r.covered === true && r.survives === true && r.notTombstoned === true, `covered=${r.covered} survives=${r.survives} notTombstoned=${r.notTombstoned} (clean: true/true/true)`); await ctx.close(); }

    // S-211: (AGY P1) the archival snapshot is PERSISTED and reloaded at boot, so an OFFLINE boot (config fetch
    // fails) still seeds it — otherwise _buildCache sums only the un-pruned rows and UNDER-COUNTS. Also proves the
    // activation gate works offline (reads the persisted cursor when Sync._lastSyncId isn't set yet).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { Sync._lastSyncId = 1000; Stock._adoptSnapshot(JSON.stringify({ version: 1, cutoffId: 47, stepCutoffTs: 3000, balances: [{ storeId: 'S8x', productId: 'P', balance: 12 }] })); const persisted = !!localStorage.getItem('bob_stock_snapshot'); Stock._snapshot = null; /* simulate a reload wiping memory */ Stock._loadSnapshot(); const restored = !!(Stock._snapshot && Stock._snapshot.version === 1 && Stock._snapshot.cutoffId === 47); localStorage.setItem('bob_last_sp_id', '1000'); const save = Sync._lastSyncId; Sync._lastSyncId = undefined; const activeOffline = Stock._snapshotActive(); Sync._lastSyncId = save; return { persisted, restored, activeOffline }; });
      rec('S-211', 'Chunk 8 (AGY P1): snapshot persisted + reloaded at boot + gate works offline (no offline-boot under-count)', r.persisted === true && r.restored === true && r.activeOffline === true, `persisted=${r.persisted} restored=${r.restored} activeOffline=${r.activeOffline} (clean: true×3)`); await ctx.close(); }

    // S-212: (AGY MED) a 401 from pullArchive triggers the SAME central unauthorized pause as push/pull/config —
    // a rotated key must stop the sync cycle, not just flash a local toast and keep polling.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"status":"unauthorized"}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { Sync._archivePullUrl = 'https://x.logic.azure.com/archive-pull'; Sync._unauthorized = false; sessionStorage.setItem('bob_sync_config', JSON.stringify({ pushUrl: 'https://x.logic.azure.com/p' })); const rows = await Sync.pullArchive('2026-01-01', '2026-12-31'); return { paused: Sync._unauthorized === true, nullRows: rows === null }; });
      rec('S-212', 'Chunk 8 (AGY MED): pullArchive 401 triggers the central unauthorized pause (not just a toast)', r.paused === true && r.nullRows === true, `paused=${r.paused} nullRows=${r.nullRows} (clean: true/true)`); await ctx.close(); }

    // S-213: (AGY LOW) _verifyCacheIntegrity treats a DEACTIVATED-but-existing product as legitimate (its stock is
    // real; deactivate-not-delete keeps it, _buildCache builds it) — it must NOT flag it stale, delete it, and
    // return false. Only a genuinely-gone (deleted) id is orphaned.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate((s) => { const d = DB.get(); d.products.push({ id: 'S213p', name: 'Deact', active: false, catId: (d.products[0] || {}).catId }); d.transactions.push({ id: 'S213t', storeId: s.storeId, productId: 'S213p', type: 'in', qty: 5, date: '2026-06-01', createdAt: new Date().toISOString() }); Stock._buildCache(); const built = (Stock._qtyCache[s.storeId] || {})['S213p']; const clean = Stock._verifyCacheIntegrity(); const survives = (Stock._qtyCache[s.storeId] || {})['S213p']; return { built, clean, survives }; }, s);
      rec('S-213', 'Chunk 8 (AGY LOW): _verifyCacheIntegrity keeps a deactivated-but-existing product (clean=true, not pruned)', r.built === 5 && r.clean === true && r.survives === 5, `built=${r.built} clean=${r.clean} survives=${r.survives} (clean: 5/true/5)`); await ctx.close(); }

    // ── Chunk 9 (per-account server-side auth) — client sentinels ───────────────────────────────────────
    // S-214: the offline PBKDF2 verifier round-trips (right pw verifies, wrong rejected) and is stored in
    // localStorage (NOT Dexie → excluded from backups by construction). Drives LIVE Auth._cacheLocalVerifier/_checkLocalVerifier.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { await Auth._cacheLocalVerifier('s214', 'secret-pw-8'); const good = await Auth._checkLocalVerifier('s214', 'secret-pw-8'); const bad = await Auth._checkLocalVerifier('s214', 'wrong'); const inLS = !!localStorage.getItem('bob_lverify_s214'); const v = JSON.parse(localStorage.getItem('bob_lverify_s214') || '{}'); const claimIters = v.iters >= 100000 && /^[0-9a-f]{64}$/.test(v.hash) && !!v.salt;
        // Independently re-derive with WebCrypto at the CLAIMED iteration count; the STORED hash must match — so
        // a sabotage that lowers the ACTUAL derivation work (while leaving v.iters unchanged) is caught (the
        // stored hash then corresponds to fewer iterations and won't equal a real claimIters-iteration derive).
        let workMatches = false; try { const enc = new TextEncoder(); const salt = Uint8Array.from(v.salt.match(/.{2}/g).map(x => parseInt(x, 16))); const key = await crypto.subtle.importKey('raw', enc.encode('secret-pw-8'), 'PBKDF2', false, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: v.iters, hash: 'SHA-256' }, key, 256); const hex = Array.from(new Uint8Array(bits)).map(x => x.toString(16).padStart(2, '0')).join(''); workMatches = (hex === v.hash); } catch (e) {}
        return { good, bad, inLS, claimIters, workMatches }; });
      rec('S-214', 'Chunk 9: offline PBKDF2 verifier round-trips + stored hash matches a real >=100k-iter derivation (no iter-count tampering)', r.good === true && r.bad === false && r.inLS && r.claimIters && r.workMatches, `good=${r.good} bad=${r.bad} inLS=${r.inLS} claimIters=${r.claimIters} workMatches=${r.workMatches} (clean: all true)`); await ctx.close(); }

    // S-215: Auth.login FAILS CLOSED — when the server is reachable and says the password is wrong, login returns
    // false and does NOT fall through to a (valid) cached offline verifier. Drives LIVE Auth.login.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { Auth._user = null; const d = DB.get(); d.users.push({ id: 'u_s215', username: 's215', name: 'S', role: 'staff', storeIds: [] }); await Auth._cacheLocalVerifier('s215', 'right-pw-8'); Sync._userVerifyUrl = 'https://x.logic.azure.com/uv'; Sync.personLogin = async () => ({ ok: false, reason: 'invalid' }); const attempt = await Auth.login('s215', 'right-pw-8'); const noSession = !Auth.user(); Sync.personLogin = async () => ({ ok: true, role: 'director' }); const okLogin = await Auth.login('s215', 'right-pw-8'); const roleAdopted = Auth.user() && Auth.user().role === 'director'; return { attempt, noSession, okLogin, roleAdopted }; });
      rec('S-215', 'Chunk 9: login fails closed on server-reject (no offline fallthrough); server role adopted on success', r.attempt === false && r.noSession && r.okLogin === true && r.roleAdopted, `serverReject=${r.attempt} noSession=${r.noSession} okLogin=${r.okLogin} roleAdopted=${r.roleAdopted} (clean: false/true/true/true)`); await ctx.close(); }

    // S-216: logout wipes the in-memory session proof (Sync.clearPersonProofs) — a person credential never
    // survives a logout. Drives LIVE Auth.logout -> Sync.clearPersonProofs.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { Sync._sessionProof = { proof: 'p', username: 'x', expiresAt: Date.now() + 1e6 }; Auth.logout(); return { wiped: Sync._sessionProof === null }; });
      rec('S-216', 'Chunk 9: logout wipes the in-memory session proof', r.wiped === true, `wiped=${r.wiped} (clean: true)`); await ctx.close(); }

    // S-217: publishCatalogue is FAIL-CLOSED on a missing sudo proof when person-auth is active — it returns
    // needSudo and NEVER fetches. Drives LIVE Sync.publishCatalogue.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","accepted":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { let fetched = false; const _f = window.fetch; window.fetch = (...a) => { if (String(a[0]).includes('cat-write')) fetched = true; return _f(...a); }; Sync._userVerifyUrl = 'https://x.logic.azure.com/uv'; Sync._catalogueWriteUrl = 'https://x.logic.azure.com/cat-write'; Sync._buildCataloguePayload = () => ({ changes: [{ id: 'p1' }], costChanges: [], keys: ['p1'] }); const res = await Sync.publishCatalogue(); window.fetch = _f; return { needSudo: res.needSudo === true, notOk: res.ok === false, noFetch: fetched === false }; });
      rec('S-217', 'Chunk 9: publish is fail-closed without a sudo proof (needSudo, no network call)', r.needSudo && r.notOk && r.noFetch, `needSudo=${r.needSudo} notOk=${r.notOk} noFetch=${r.noFetch} (clean: all true)`); await ctx.close(); }

    // S-218: _withPerson attaches the session proof + actorUsername; Sync.sudo prefers the LOGGED-IN user over a
    // stale _sessionProof username (a sudo action always targets the person at the keyboard). Drives LIVE code.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { const d = DB.get(); const u = { id: 'u_kb', username: 'atkeyboard', name: 'K', role: 'director', storeIds: [] }; d.users.push(u); Auth._user = u; Sync._sessionProof = { proof: 'sp', username: 'staleuser', expiresAt: Date.now() + 1e6 }; const body = Sync._withPerson({ x: 1 }); const hasProof = body.proof === 'sp'; const hasActor = body.actorUsername === 'staleuser'; /* _withPerson uses session username */ let sentUser = null; Sync._userVerifyUrl = 'https://x.logic.azure.com/uv'; const _f = window.fetch; window.fetch = async (url, opts) => { try { sentUser = JSON.parse(opts.body).user.username; } catch (e) {} return { ok: true, json: async () => ({ status: 'ok', proof: 'z' }) }; }; await Sync.sudo('publish', 'pw'); window.fetch = _f; return { hasProof, hasActor, sudoTargetsKeyboard: sentUser === 'atkeyboard' }; });
      rec('S-218', 'Chunk 9: _withPerson attaches proof+actor; sudo targets the logged-in user (not a stale session)', r.hasProof && r.hasActor && r.sudoTargetsKeyboard, `proof=${r.hasProof} actor=${r.hasActor} sudoKeyboard=${r.sudoTargetsKeyboard} (clean: all true)`); await ctx.close(); }

    // S-219: the backup scrubber strips legacy password/pin hashes + any proof (D-039 ends), and the PBKDF2
    // verifier (localStorage) never appears in the Dexie backup. Drives LIVE Pages._scrubBackupSecrets.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => { const d = DB.get(); d.users.push({ id: 'u_s219', username: 's219', password: 'HASH', pin: 'PINHASH', proof: 'x', role: 'staff' }); const bk = Pages._scrubBackupSecrets(JSON.parse(JSON.stringify(d))); const u = (bk.users || []).find(x => x.username === 's219') || {}; return { noPw: !('password' in u), noPin: !('pin' in u), noProof: !('proof' in u), noVerifier: JSON.stringify(bk).indexOf('lverify') === -1 }; });
      rec('S-219', 'Chunk 9: backup scrubs password/pin/proof (D-039 ends); PBKDF2 verifier never in the backup', r.noPw && r.noPin && r.noProof && r.noVerifier, `noPw=${r.noPw} noPin=${r.noPin} noProof=${r.noProof} noVerifier=${r.noVerifier} (clean: all true)`); await ctx.close(); }

    // S-220: user management ROUTES THROUGH THE SERVER when person-auth is active — create calls Sync.userAdmin
    // with a sudo proof, and the local mirror carries NO password hash (server owns the credential). Drives LIVE
    // Pages._saveNewUser.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => { Sync._userVerifyUrl = 'https://x.logic.azure.com/uv'; Sync._userAdminUrl = 'https://x.logic.azure.com/ua'; const calls = []; Sync.userAdmin = async (op, data, proof) => { calls.push({ op, proof }); return { status: 'ok', users: [] }; }; Pages._sudoPrompt = async () => 'SUDO-PROOF'; document.body.insertAdjacentHTML('beforeend', '<input id="nu-name" value="New Person"><input id="nu-user" value="s220"><input id="nu-pass" value="pw-8chars"><input id="nu-pin" value="1234"><select id="nu-role"><option value="staff" selected>staff</option></select>'); const d = DB.get(); const u = { id: 'u_dir', username: 'dir', role: 'director', name: 'D', storeIds: [] }; d.users.push(u); Auth._user = u; await Pages._saveNewUser(); await new Promise(r => setTimeout(r, 150)); const createCall = calls.find(c => c.op === 'create'); const mirror = d.users.find(x => x.username === 's220') || {}; return { createOp: !!createCall, usedProof: createCall && createCall.proof === 'SUDO-PROOF', mirrorNoHash: !mirror.password, mirrorExists: !!mirror.username }; }, s);
      rec('S-220', 'Chunk 9: user create routes through the server (sudo proof) with NO local password hash', r.createOp === true && r.usedProof && r.mirrorExists && r.mirrorNoHash, `createOp=${r.createOp} proof=${r.usedProof} mirror=${r.mirrorExists} noHash=${r.mirrorNoHash} (clean: all true)`); await ctx.close(); }

    // S-221: (deep-audit Codex MEDIUM) a fresh login must NOT inherit a prior account's in-memory session proof.
    // Set a stale proof for user A, then log in (offline verifier path) as user B; _sessionProof must be cleared.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => { Auth._user = null; const d = DB.get(); d.users.push({ id: 'u_b221', username: 'userB221', name: 'B', role: 'staff', storeIds: [] }); await Auth._cacheLocalVerifier('userB221', 'b-pass-88'); Sync._userVerifyUrl = null; Sync._sessionProof = { proof: 'STALE-A', username: 'userA221', expiresAt: Date.now() + 1e6 }; const ok = await Auth.login('userB221', 'b-pass-88'); return { ok, cleared: Sync._sessionProof === null, actor: Sync._actorUsername() }; });
      rec('S-221', 'Chunk 9 (deep-audit): a fresh login clears any prior account session proof (no cross-account leak)', r.ok === true && r.cleared === true && r.actor === 'userB221', `loginOk=${r.ok} proofCleared=${r.cleared} actor=${r.actor} (clean: true/true/userB221)`); await ctx.close(); }

    // ─── Chunk 10 — store isolation (client fold) ───────────────────────────────
    // S-222: DB.purgeToScope drops out-of-scope ledger rows, keeps in-scope rows AND either-end transfers
    // (a transfer touching an in-scope store on any end survives). Drives the LIVE durable purge.
    { const { ctx, page } = await newPage(b); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get();
        // OS-W3: the purge now reads DISK inside one atomic transaction (W3-SR-2) — seed durably, as SYNCED
        // history (an unsynced seed would correctly REFUSE the purge; that case is S-258's job).
        d.transactions = [ { id:'t1', storeId:'karrinyup', productId:'P1', type:'in', qty:1, _synced:true }, { id:'t2', storeId:'whitford', productId:'P1', type:'in', qty:1, _synced:true }, { id:'t3', storeId:'ardross', productId:'P1', type:'in', qty:1, _synced:true } ];
        d.transfers = [ { id:'tr1', fromStoreId:'karrinyup', toStoreId:'ardross' }, { id:'tr2', fromStoreId:'whitford', toStoreId:'ardross' } ];
        await bobDB.transactions.clear(); await bobDB.transactions.bulkPut(d.transactions);
        await bobDB.transfers.clear(); await bobDB.transfers.bulkPut(d.transfers);
        const ok = await DB.purgeToScope(['karrinyup']);
        const dd = DB.get();
        return { ok, stores: dd.transactions.map(t => t.storeId).sort(), transfers: dd.transfers.map(t => t.id).sort() };
      });
      rec('S-222', 'Chunk 10: purgeToScope drops out-of-scope ledger, keeps in-scope + either-end transfer', r.ok === true && JSON.stringify(r.stores) === JSON.stringify(['karrinyup']) && JSON.stringify(r.transfers) === JSON.stringify(['tr1']), `stores=${JSON.stringify(r.stores)} transfers=${JSON.stringify(r.transfers)} (clean: [karrinyup]/[tr1])`); await ctx.close(); }

    // S-223: Sync._reconcileScope purges + resets BOTH cursors + records the sig on a scope change; no-ops when
    // the scope is unchanged; treats '*' as a change with NO purge (widening to all-access).
    { const { ctx, page } = await newPage(b); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.setItem('bob_scope_sig', JSON.stringify(['karrinyup', 'whitford'])); } catch(e){}
        // OS-W3: seed DURABLY as synced history — the atomic purge reads disk (W3-SR-2)
        const d = DB.get(); d.transactions = [ { id:'a', storeId:'karrinyup', productId:'P1', type:'in', qty:1, _synced:true }, { id:'b', storeId:'whitford', productId:'P1', type:'in', qty:1, _synced:true } ];
        await bobDB.transactions.clear(); await bobDB.transactions.bulkPut(d.transactions);
        Sync._lastSyncId = 500; Sync._lastStepSyncId = 300;
        const changed = await Sync._reconcileScope(['karrinyup']);
        const purged = DB.get().transactions.length === 1 && DB.get().transactions.every(t => t.storeId === 'karrinyup');   // OS-W3: assert the KEPT row is present (not vacuous)
        const unchanged = await Sync._reconcileScope(['karrinyup']);
        const star = await Sync._reconcileScope(['*']);
        let sig = null; try { sig = localStorage.getItem('bob_scope_sig'); } catch(e){}
        return { changed, purged, reset: Sync._lastSyncId === 0 && Sync._lastStepSyncId === 0, unchanged, star, sigIsStar: sig === JSON.stringify(['*']) };
      });
      rec('S-223', 'Chunk 10: _reconcileScope purges + resets cursors on change, no-ops when unchanged, star=change/no-purge', r.changed === true && r.purged === true && r.reset === true && r.unchanged === false && r.star === true && r.sigIsStar === true, `changed=${r.changed} purged=${r.purged} reset=${r.reset} unchanged=${r.unchanged} star=${r.star} sigStar=${r.sigIsStar}`); await ctx.close(); }

    // S-224: Stock._adoptSnapshot seeds ONLY in-scope stores' opening balances (config path can't leak another
    // store's balance into the local snapshot — AGY CRIT #7).
    { const { ctx, page } = await newPage(b); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.setItem('bob_scope_sig', JSON.stringify(['karrinyup'])); } catch(e){}
        Stock._adoptSnapshot(JSON.stringify({ version: 2, cutoffId: 100, stepCutoffTs: 0, balances: [ { storeId:'karrinyup', productId:'P1', balance:5 }, { storeId:'whitford', productId:'P1', balance:9 } ] }));
        const bal = Stock._snapshot && Stock._snapshot.bal;
        return { hasKar: !!(bal && bal.karrinyup), hasWht: !!(bal && bal.whitford) };
      });
      rec('S-224', 'Chunk 10: _adoptSnapshot seeds only in-scope stores opening balances', r.hasKar === true && r.hasWht === false, `hasKar=${r.hasKar} hasWht=${r.hasWht} (clean: true/false)`); await ctx.close(); }

    // S-225: Stock._scopeSnapshot strips out-of-scope stores from an already-adopted snapshot on a scope change.
    { const { ctx, page } = await newPage(b); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        Stock._snapshot = { version: 1, cutoffId: 1, stepCutoffTs: 0, bal: { karrinyup: { P1: 1 }, whitford: { P1: 2 }, ardross: { P1: 3 } } };
        Stock._scopeSnapshot(['karrinyup', 'ardross']);
        return { keys: Object.keys(Stock._snapshot.bal).sort() };
      });
      rec('S-225', 'Chunk 10: _scopeSnapshot strips out-of-scope stores from the adopted snapshot', JSON.stringify(r.keys) === JSON.stringify(['ardross', 'karrinyup']), `keys=${JSON.stringify(r.keys)} (clean: [ardross,karrinyup])`); await ctx.close(); }

    // S-226: Pages._scrubBackupScope strips out-of-scope rows from an imported backup (either-end for transfers)
    // so a full-ledger backup can't reintroduce another store's data (D10 §5b-9).
    { const { ctx, page } = await newPage(b); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.setItem('bob_scope_sig', JSON.stringify(['karrinyup'])); } catch(e){}
        const data = { transactions: [ { id:'x', storeId:'karrinyup' }, { id:'y', storeId:'whitford' } ], transfers: [ { id:'t1', fromStoreId:'whitford', toStoreId:'karrinyup' }, { id:'t2', fromStoreId:'whitford', toStoreId:'ardross' } ], recordSteps: [ { id:'s1', ownerStoreId:'whitford', toStoreId:'karrinyup' }, { id:'s2', ownerStoreId:'ardross' } ] };
        Pages._scrubBackupScope(data);
        return { txn: data.transactions.map(t => t.storeId), transfers: data.transfers.map(t => t.id), steps: data.recordSteps.map(s => s.id) };
      });
      rec('S-226', 'Chunk 10: _scrubBackupScope strips out-of-scope backup rows (either-end kept)', JSON.stringify(r.txn) === JSON.stringify(['karrinyup']) && JSON.stringify(r.transfers) === JSON.stringify(['t1']) && JSON.stringify(r.steps) === JSON.stringify(['s1']), `txn=${JSON.stringify(r.txn)} transfers=${JSON.stringify(r.transfers)} steps=${JSON.stringify(r.steps)}`); await ctx.close(); }

    // S-227: (audit GPT#3 / AGY-10-C1) with NO echoed scope, _scopeAllows must FAIL CLOSED for an unknown viewer
    // and fall back to the LOGGED-IN ACCOUNT's own stores — never fail open. Director/HO = all.
    { const { ctx, page } = await newPage(b); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.removeItem('bob_scope_sig'); } catch (e) {}
        Auth._user = null;
        const noUser = Stock._scopeAllows('karrinyup');                 // unknown -> false (fail closed)
        Auth._user = { id: 'u', username: 'k', role: 'staff', storeIds: ['karrinyup'] };
        const own = Stock._scopeAllows('karrinyup'), other = Stock._scopeAllows('whitford');
        Auth._user = { id: 'd', username: 'dir', role: 'director', storeIds: [] };
        const dir = Stock._scopeAllows('whitford');
        return { noUser, own, other, dir };
      });
      rec('S-227', 'Chunk 10 (audit): no-scope fails CLOSED; _scopeAllows falls back to the account stores', r.noUser === false && r.own === true && r.other === false && r.dir === true, `noUser=${r.noUser} own=${r.own} other=${r.other} dir=${r.dir} (clean: false/true/false/true)`); await ctx.close(); }

    // S-228: (audit GPT#4) backup EXPORT is blocked while a scope purge is pending — must return BEFORE the sudo
    // prompt (no whole-DB export can leak out-of-scope rows the failed purge left behind).
    { const { ctx, page } = await newPage(b); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.setItem('bob_scope_purge_pending', '1'); } catch (e) {}
        let sudoCalled = false; Pages._sudoPrompt = async () => { sudoCalled = true; return 'x'; };
        let toasted = ''; const _t = UI.toast; UI.toast = (m) => { toasted = m; };
        await Pages._exportBackup();
        UI.toast = _t;
        return { sudoCalled, blocked: /paused|scope update/i.test(toasted) };
      });
      rec('S-228', 'Chunk 10 (audit): backup export blocked while a scope purge is pending', r.sudoCalled === false && r.blocked === true, `sudoReached=${r.sudoCalled} blockedToast=${r.blocked} (clean: false/true)`); await ctx.close(); }

    // ═══ Account Access chunk (AA-W6): S-229..S-240 ═══════════════════════════════════════════════════

    // S-229: SR-7 resolver order in the LIVE Auth.can — explicit per-account override is FINAL (beats the
    // PIN grant); PIN lifts ONLY stockTakeCount/transferReceive; role default is the floor.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        Auth._user = { id: 'u_boor', username: 'boor', role: 'staff', storeIds: ['booragoon'] };
        Auth.adoptPolicy({ version: 1, roles: { staff: { transferReceive: false, stockTakeCount: false, recordDelivery: false }, director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        Auth._tempStockTake = null;
        const deniedNoPin = Auth.can('transferReceive');
        Auth._tempStockTake = new Date(Date.now() + 3600000).toISOString();
        const pinLifts = Auth.can('transferReceive') && Auth.can('stockTakeCount');
        const pinNoLiftOther = Auth.can('recordDelivery');
        Auth._policy.overrides = { boor: { transferReceive: false, recordDelivery: true } };  // AA-01: keyed by USERNAME
        const ovDenyBeatsPin = Auth.can('transferReceive');
        const ovAllowBeatsRole = Auth.can('recordDelivery');
        const ovByIdIgnored = (() => { Auth._policy.overrides = { u_boor: { recordDelivery: true } }; return Auth.can('recordDelivery'); })();  // AA-01: an id-keyed override must NOT bind (this is the exact bug)
        Auth._policy = null; Auth._tempStockTake = null;
        return { deniedNoPin, pinLifts, pinNoLiftOther, ovDenyBeatsPin, ovAllowBeatsRole, ovByIdIgnored };
      });
      rec('S-229', 'AA: SR-7 order — override(by username) FINAL beats PIN; id-keyed override ignored (AA-01)', r.deniedNoPin === false && r.pinLifts === true && r.pinNoLiftOther === false && r.ovDenyBeatsPin === false && r.ovAllowBeatsRole === true && r.ovByIdIgnored === false, `noPin=${r.deniedNoPin} pin=${r.pinLifts} other=${r.pinNoLiftOther} ovDeny=${r.ovDenyBeatsPin} ovAllow=${r.ovAllowBeatsRole} idIgnored=${r.ovByIdIgnored} (clean: f/t/f/f/t/f)`); await ctx.close(); }

    // S-230: PRE-ACTIVATION PARITY — with NO adopted policy the legacy seed governs exactly (staff receive
    // freely, staff stock-take blocked w/o grant, director sees cost, staff sees selling price).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        Auth._policy = null; Auth._tempStockTake = null;
        Auth._user = { id: 'u_s', username: 's', role: 'staff', storeIds: ['booragoon'] };
        const staffReceive = Auth.can('transferReceive'), staffTake = Auth.can('stockTakeCount'), staffSell = Auth.can('seeSellingPrice'), staffCost = Auth.can('seeCost');
        Auth._user = { id: 'u_d', username: 'd', role: 'director', storeIds: [] };
        const dirCost = Auth.can('seeCost'), dirPolicy = Auth.can('editAccessPolicy');
        return { staffReceive, staffTake, staffSell, staffCost, dirCost, dirPolicy };
      });
      rec('S-230', 'AA: pre-activation parity — legacy seed governs with no policy', r.staffReceive === true && r.staffTake === false && r.staffSell === true && r.staffCost === false && r.dirCost === true && r.dirPolicy === true, `recv=${r.staffReceive} take=${r.staffTake} sell=${r.staffSell} sCost=${r.staffCost} dCost=${r.dirCost} dPol=${r.dirPolicy} (clean: t/f/t/f/t/t)`); await ctx.close(); }

    // S-231: THE PIN-to-receive covering sentinel (Kunal 2026-07-07 default) — ACTIVATING the default
    // policy flips the basic store account to PIN-gated receive; the PIN grant lifts it.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        Auth._user = { id: 'u_s', username: 's', role: 'staff', storeIds: ['booragoon'] };
        Auth._policy = null; Auth._tempStockTake = null;
        const before = Auth.can('transferReceive');
        Auth.adoptPolicy({ ...Auth.defaultPolicyBlob(), version: 1 });
        const after = Auth.can('transferReceive');
        Auth._tempStockTake = new Date(Date.now() + 3600000).toISOString();
        const withPin = Auth.can('transferReceive');
        Auth._policy = null; Auth._tempStockTake = null;
        return { before, after, withPin };
      });
      rec('S-231', 'AA: activation makes store-account receive PIN-gated (default blob), PIN lifts', r.before === true && r.after === false && r.withPin === true, `before=${r.before} after=${r.after} withPin=${r.withPin} (clean: true/false/true)`); await ctx.close(); }

    // S-232: SR-4 narrowing purge — a policy bump that revokes seeCost/seeArchive scrubs the merged
    // corporate-cost payload (costPrice+_costRv) durably and drops the archive overlay from the working set.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => {
        const d = DB.get();
        d.accessPolicy = null; Auth._policy = null;
        await Sync._applyAccessPolicy({ version: 1, roles: { director: { seeCost: true, seeArchive: true, editAccessPolicy: true } }, overrides: {}, sudo: {} });
        const p = d.products.find(x => x.id === s.productId); p.costPrice = 42.5; p._costRv = 'rv1';
        d.transactions.push({ id: 'aa_arch_1', type: 'in', qty: 1, storeId: s.storeId, productId: s.productId, date: '2024-01-01', createdAt: '2024-01-01', _archived: true });
        Stock._archiveOverlay = [{ id: 'aa_arch_1' }];
        await Sync._applyAccessPolicy({ version: 2, roles: { director: { seeCost: false, seeArchive: false, editAccessPolicy: true } }, overrides: {}, sudo: {} });
        const p2 = DB.get().products.find(x => x.id === s.productId);
        return { cost: p2.costPrice, rv: p2._costRv, overlay: Stock._archiveOverlay, archRow: DB.get().transactions.some(t => t && t._archived), ver: Auth._policy && Auth._policy.version };
      }, s);
      rec('S-232', 'AA: SR-4 narrowing purge — revoke scrubs corp cost + archive overlay', r.cost === null && r.rv === undefined && r.overlay === null && r.archRow === false && r.ver === 2, `cost=${r.cost} rv=${r.rv} overlay=${r.overlay} archRow=${r.archRow} v=${r.ver} (clean: null/undef/null/false/2)`); await ctx.close(); }

    // S-233: adoption is VERSION-MONOTONIC — a replayed/rolled-back LOWER version is ignored (an attacker
    // can't restore themselves a more permissive old policy).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); d.accessPolicy = null; Auth._policy = null;
        await Sync._applyAccessPolicy({ version: 5, roles: { director: { seeCost: false, editAccessPolicy: true } }, overrides: {}, sudo: {} });
        await Sync._applyAccessPolicy({ version: 3, roles: { director: { seeCost: true, editAccessPolicy: true } }, overrides: {}, sudo: {} });
        return { ver: Auth._policy && Auth._policy.version, cost: Auth.can('seeCost') };
      });
      rec('S-233', 'AA: policy adoption is version-monotonic (rollback ignored)', r.ver === 5 && r.cost === false, `v=${r.ver} seeCost=${r.cost} (clean: 5/false)`); await ctx.close(); }

    // S-234: FAIL CLOSED under an adopted policy — a capability the blob doesn't mention is DENIED, even
    // for a director (no silent fallback to the legacy seed once a policy governs).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        Auth._user = { id: 'u_d', username: 'd', role: 'director', storeIds: [] };
        Auth.adoptPolicy({ version: 1, roles: { director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        const unknownCap = Auth.can('recordDelivery');           // not in the blob -> deny
        Auth._user = { id: 'u_x', username: 'x', role: 'made_up_role', storeIds: [] };
        const unknownRole = Auth.can('editAccessPolicy');
        Auth._policy = null;
        return { unknownCap, unknownRole };
      });
      rec('S-234', 'AA: fail closed under policy — unmentioned cap/role denied (no seed fallback)', r.unknownCap === false && r.unknownRole === false, `cap=${r.unknownCap} role=${r.unknownRole} (clean: false/false)`); await ctx.close(); }

    // S-235: publishAccessPolicy is FAIL-CLOSED without a sudo proof — needSudo, NO network call (SR-1;
    // mirrors the S-217 publish pattern).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        Sync._userVerifyUrl = 'https://x.logic.azure.com/verify'; Sync._accessPolicyWriteUrl = 'https://x.logic.azure.com/appolicy';
        let fetches = 0; const _f = window.fetch; window.fetch = (...a) => { fetches++; return _f(...a); };
        const r1 = await Sync.publishAccessPolicy({ roles: { director: { editAccessPolicy: true } }, overrides: {}, sudo: {} }, null);
        const r2 = await Sync.publishAccessPolicy({ roles: { director: { editAccessPolicy: true } }, overrides: {}, sudo: {} }, '__no_person_auth__');
        window.fetch = _f;
        return { r1: r1.reason, r2: r2.reason, fetches };
      });
      rec('S-235', 'AA: publishAccessPolicy fail-closed without sudo proof (no network call)', r.r1 === 'needSudo' && r.r2 === 'needSudo' && r.fetches === 0, `r1=${r.r1} r2=${r.r2} fetches=${r.fetches} (clean: needSudo/needSudo/0)`); await ctx.close(); }

    // S-236: backup export blocked while a POLICY purge is pending (SR-4 privacy lock — mirrors S-228).
    { const { ctx, page } = await newPage(b); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.removeItem('bob_scope_purge_pending'); localStorage.setItem('bob_policy_purge_pending', '1'); } catch (e) {}
        Sync._scopePurgePending = false;
        let sudoCalled = false; Pages._sudoPrompt = async () => { sudoCalled = true; return 'x'; };
        let toasted = ''; const _t = UI.toast; UI.toast = (m) => { toasted = m; };
        await Pages._exportBackup();
        UI.toast = _t; try { localStorage.removeItem('bob_policy_purge_pending'); } catch (e) {}
        return { sudoCalled, blocked: /paused|scope update/i.test(toasted) };
      });
      rec('S-236', 'AA: backup export blocked while a policy purge is pending', r.sudoCalled === false && r.blocked === true, `sudoReached=${r.sudoCalled} blockedToast=${r.blocked} (clean: false/true)`); await ctx.close(); }

    // S-237: _withIngestProofs attaches session+pin+action proofs; expired ones are dropped; logout wipes.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        Sync._sessionProof = { proof: 'SESS', username: 'd', expiresAt: Date.now() + 3600000 };
        Sync._pinGrantProof = { proof: 'PIN', expiresAt: Date.now() + 3600000 };
        Sync.holdActionProof('approve', 'APPR');
        Sync._actionProofs['resolve'] = { proof: 'STALE', at: Date.now() - 6 * 60 * 1000 };
        const b1 = Sync._withIngestProofs({});
        Sync._pinGrantProof = { proof: 'PIN', expiresAt: Date.now() - 1000 };
        const b2 = Sync._withIngestProofs({});
        Sync.clearPersonProofs();
        const b3 = Sync._withIngestProofs({});
        return { proof: b1.proof, pin: b1.pinProof, appr: b1.sudoProofs && b1.sudoProofs.approve, stale: b1.sudoProofs && b1.sudoProofs.resolve, expiredPin: b2.pinProof, wiped: !b3.proof && !b3.pinProof && !b3.sudoProofs };
      });
      rec('S-237', 'AA: ingest proofs attached (session/pin/action), stale dropped, logout wipes', r.proof === 'SESS' && r.pin === 'PIN' && r.appr === 'APPR' && r.stale === undefined && r.expiredPin === undefined && r.wiped === true, `proof=${r.proof} pin=${r.pin} appr=${r.appr} stale=${r.stale} expPin=${r.expiredPin} wiped=${r.wiped}`); await ctx.close(); }

    // S-238: the Account Access screen — Director gets the tab content with the FLOOR rows locked (🔒, no
    // checkbox) and the activation button pre-activation.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        Auth._policy = null; Pages._apDraft = null;
        const host = document.getElementById('page-dir-settings');
        if (!host) return { html: '' };
        Pages.dirSettings('access');
        const html = document.getElementById('ds-tab-content') ? document.getElementById('ds-tab-content').innerHTML : '';
        Pages._apDraft = null;
        return { hasActivate: /Activate access policy/.test(html), hasLock: /🔒 Always/.test(html), hasMatrix: /Receive transfers/.test(html), hasOverrides: /Per-account exceptions/.test(html) };
      });
      rec('S-238', 'AA: Account Access screen renders matrix + locked floor + activate', r.hasActivate === true && r.hasLock === true && r.hasMatrix === true && r.hasOverrides === true, `activate=${r.hasActivate} lock=${r.hasLock} matrix=${r.hasMatrix} ov=${r.hasOverrides} (clean: all true)`); await ctx.close(); }

    // S-239: under an ACTIVE policy, PIN verification goes SERVER-side (live _verifyPinValue -> Sync.pinUnlock
    // -> pin-grant proof held); a denied server answer does NOT unlock.
    { const { ctx, page } = await newPage(b); let pinCalls = 0, answer = { ok: true };
      await page.route('**logic.azure.com**', r => { const body = r.request().postData() || ''; if (body.includes('"op":"pin"')) { pinCalls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer.ok ? { ok: true, proof: 'PG.1', expiresAt: Date.now() + 3600000 } : { ok: false }) }); } return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }); });
      await waitBoot(page, repo); await setup(page);
      const r1 = await page.evaluate(async () => {
        Auth._user = { id: 'u_s', username: 's', role: 'staff', storeIds: ['booragoon'] };
        Auth.adoptPolicy({ version: 1, roles: { staff: {} , director: { editAccessPolicy: true } }, overrides: {}, sudo: {}, pin: { expiresAt: new Date(Date.now() + 3600000).toISOString() } });
        Sync._userVerifyUrl = 'https://x.logic.azure.com/verify'; Auth._tempStockTake = null; Sync._pinGrantProof = null;
        const v = await Pages._verifyPinValue('1234');
        return { ok: v.ok, grant: Sync._pinGrantProof && Sync._pinGrantProof.proof, temp: !!Auth._tempStockTake };
      });
      answer.ok = false;
      const r2 = await page.evaluate(async () => { Auth._tempStockTake = null; Sync._pinGrantProof = null; const v = await Pages._verifyPinValue('9999'); const out = { ok: v.ok, temp: !!Auth._tempStockTake }; Auth._policy = null; return out; });
      rec('S-239', 'AA: PIN verify is server-side under policy; denial does not unlock', pinCalls === 2 && r1.ok === true && r1.grant === 'PG.1' && r1.temp === true && r2.ok === false && r2.temp === false, `calls=${pinCalls} ok1=${r1.ok} grant=${r1.grant} temp1=${r1.temp} ok2=${r2.ok} temp2=${r2.temp}`); await ctx.close(); }

    // S-240: _actionSudo is INERT pre-activation (no prompt, behaviour unchanged); under a policy the sudo
    // map governs — 'session' skips the prompt, 'password' prompts and holds the proof for the push.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try {
        let prompts = 0; Pages._sudoPrompt = async () => { prompts++; return 'PROOF9'; };
        Auth._policy = null;
        const pre = await Pages._actionSudo('approve', 'x');
        const preNoPrompt = prompts === 0;
        Auth.adoptPolicy({ version: 1, roles: { director: { editAccessPolicy: true } }, overrides: {}, sudo: { approve: 'session', resolve: 'password' } });
        const sess = await Pages._actionSudo('approve', 'x');
        const sessNoPrompt = prompts === 0;
        Sync._actionProofs = {};
        const pw = await Pages._actionSudo('resolve', 'x');
        const held = Sync._actionProofs.resolve && Sync._actionProofs.resolve.proof;
        Auth._policy = null;
        return { pre, preNoPrompt, sess, sessNoPrompt, pw, prompts, held };
        } catch (e) { Auth._policy = null; return { threw: String(e && e.message) }; }   // a mutated guard throws on null policy — fail the sentinel, don't abort the suite
      });
      rec('S-240', 'AA: _actionSudo inert pre-activation; sudo map governs under policy; proof held', r.pre === '__no_person_auth__' && r.preNoPrompt === true && r.sess === '__session_ok__' && r.sessNoPrompt === true && r.pw === 'PROOF9' && r.prompts === 1 && r.held === 'PROOF9', `pre=${r.pre} sess=${r.sess} pw=${r.pw} prompts=${r.prompts} held=${r.held}`); await ctx.close(); }

    // ═══ Account Access FIX round (AA-FIX): S-241..S-246 ══════════════════════════════════════════════

    // S-241 (AA-04): adopting a narrowing policy while LOGGED OUT purges the device's cost payload (the normal
    // morning-boot case) — the corp-cost blob must not survive on disk when nobody's logged in.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => {
        const d = DB.get(); d.accessPolicy = null; Auth._policy = null; Auth._user = null;   // LOGGED OUT
        const p = d.products.find(x => x.id === s.productId); p.costPrice = 12.5; p._costRv = 'rv1';
        await Sync._applyAccessPolicy({ version: 1, roles: { director: { seeCost: true, editAccessPolicy: true } }, overrides: {}, sudo: {} });
        const p2 = DB.get().products.find(x => x.id === s.productId);
        return { cost: p2.costPrice, rv: p2._costRv };
      }, s);
      rec('S-241', 'AA-04: logged-out policy adoption purges the cost payload (device-level)', r.cost === null && r.rv === undefined, `cost=${r.cost} rv=${r.rv} (clean: null/undef)`); await ctx.close(); }

    // S-242 (AA-05): the version-independent reconciler retries a STUCK cost purge (bob_policy_purge_pending)
    // regardless of policy version — the monotonic adopt guard can't re-trigger it.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async (s) => {
        try { localStorage.setItem('bob_policy_purge_pending', '1'); } catch (e) {}
        const d = DB.get(); const p = d.products.find(x => x.id === s.productId); p.costPrice = 7; p._costRv = 'rv2';
        await Sync._reconcilePolicyPurge();
        const p2 = DB.get().products.find(x => x.id === s.productId);
        let pend = '1'; try { pend = localStorage.getItem('bob_policy_purge_pending'); } catch (e) {}
        return { cost: p2.costPrice, rv: p2._costRv, pend };
      }, s);
      rec('S-242', 'AA-05: version-independent reconciler clears a stuck cost purge', r.cost === null && r.rv === undefined && r.pend === null, `cost=${r.cost} rv=${r.rv} pend=${r.pend} (clean: null/undef/null)`); await ctx.close(); }

    // S-243 (AA-28): the backup scrub strips a top-level accessPolicy — a crafted restore can't push a device
    // into an unpublished policy or version-pin it.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const scrubbed = Pages._scrubBackupSecrets({ accessPolicy: { version: 99, roles: { staff: { seeCost: true } }, overrides: {}, sudo: {} }, products: [] });
        return { hasPolicy: Object.prototype.hasOwnProperty.call(scrubbed, 'accessPolicy') };
      });
      rec('S-243', 'AA-28: backup scrub strips a smuggled accessPolicy blob', r.hasPolicy === false, `hasPolicy=${r.hasPolicy} (clean: false)`); await ctx.close(); }

    // S-244 (AA-25): the idle/manual lock clears the client PIN-unlock grant — else the UI shows unlocked while
    // every push is rejected proof-less (clearPersonProofs already wiped the server pin-grant).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        Auth._user = { id: 'u', username: 'x', role: 'staff', storeIds: ['karrinyup'] };
        Auth._tempStockTake = new Date(Date.now() + 3600000).toISOString();
        try { PIN.lock(); } catch (e) {}
        const cleared = Auth._tempStockTake === null;
        try { document.getElementById('pin-overlay').classList.remove('show'); } catch (e) {}
        return { cleared };
      });
      rec('S-244', 'AA-25: idle lock clears the client PIN-unlock grant (_tempStockTake)', r.cleared === true, `cleared=${r.cleared} (clean: true)`); await ctx.close(); }

    // S-245 (AA-02): seeCharts is GONE from _caps (dropped as unenforceable), and a seeSellingPrice deny is
    // honoured by Auth.can (the products table hides the Sell Price column off this).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const hasCharts = Object.prototype.hasOwnProperty.call(Auth._caps, 'seeCharts');
        Auth._user = { id: 'u', username: 'x', role: 'director', storeIds: [] };
        Auth.adoptPolicy({ version: 1, roles: { staff: { seeSellingPrice: false }, director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        const reservedDenied = Auth.can('__proto__');   // AA-11: client RESERVED guard denies reserved cap names
        Auth._user = { id: 'u2', username: 'y', role: 'staff', storeIds: [] };
        const sellDenied = Auth.can('seeSellingPrice');
        Auth._policy = null;
        return { hasCharts, reservedDenied, sellDenied };
      });
      rec('S-245', 'AA-02/AA-11: seeCharts dropped; reserved-cap denied; seeSellingPrice deny honoured', r.hasCharts === false && r.reservedDenied === false && r.sellDenied === false, `hasCharts=${r.hasCharts} reservedDenied=${r.reservedDenied} sellDenied=${r.sellDenied} (clean: false/false/false)`); await ctx.close(); }

    // S-246 (AA-02): the store-comparison PAGE has a top-of-page seeComparativeCharts guard (was nav-emission
    // only) — a denied account is redirected, not shown cross-store data.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        let navdTo = ''; const _n = window.navigateTo; window.navigateTo = (x) => { navdTo = x; };
        Auth._user = { id: 'u', username: 'x', role: 'staff', storeIds: ['karrinyup'] };
        Auth.adoptPolicy({ version: 1, roles: { staff: { seeComparativeCharts: false }, director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        try { Pages.hoComparison(); } catch (e) {}
        window.navigateTo = _n; Auth._policy = null;
        return { redirected: navdTo === 'log-movement' };
      });
      rec('S-246', 'AA-02: store-comparison page guarded by seeComparativeCharts (redirects when denied)', r.redirected === true, `redirected=${r.redirected} (clean: true)`); await ctx.close(); }

    // S-247 (AA-12): CLIENT/SERVER PARITY — the same fixtures resolved by the live server resolveCapability
    // (Node) and the client Auth.can (booted app) must AGREE. A one-sided edit to either resolver (the exact
    // AA-11/AA-14 drift class) diverges and flips this. Overrides keyed by USERNAME (AA-01) on both sides.
    { const POL = { version: 1, roles: { staff: { transferReceive: false, stockTakeCount: false, seeSellingPrice: true, recordDelivery: false }, director: { editCost: true, recordDelivery: true, editAccessPolicy: true } }, overrides: { boor: { transferReceive: false, recordDelivery: true } }, sudo: {} };
      const CASES = [
        { u: 'kunal', role: 'director', cap: 'editCost', pin: false }, { u: 'kunal', role: 'director', cap: 'launchMissiles', pin: false },
        { u: 's', role: 'staff', cap: 'transferReceive', pin: false }, { u: 's', role: 'staff', cap: 'transferReceive', pin: true },
        { u: 's', role: 'staff', cap: 'stockTakeCount', pin: true }, { u: 's', role: 'staff', cap: 'recordDelivery', pin: true },
        { u: 'boor', role: 'staff', cap: 'transferReceive', pin: true }, { u: 'boor', role: 'staff', cap: 'recordDelivery', pin: false },
        { u: 'x', role: 'unknownrole', cap: 'editCost', pin: false }, { u: 's', role: 'staff', cap: '__proto__', pin: false },
      ];
      const server = AP_PARITY ? CASES.map(c => AP_PARITY.resolveCapability(POL, c.cap, c.u, c.role, c.pin).ok === true) : [];
      const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const client = await page.evaluate((args) => {
        const { POL, CASES } = args;
        return CASES.map(c => {
          Auth._user = { id: 'id_' + c.u, username: c.u, role: c.role, storeIds: [] };
          Auth.adoptPolicy(JSON.parse(JSON.stringify(POL)));
          Auth._tempStockTake = c.pin ? new Date(Date.now() + 3600000).toISOString() : null;
          const v = Auth.can(c.cap) === true;
          Auth._policy = null; Auth._tempStockTake = null;
          return v;
        });
      }, { POL, CASES });
      const agree = AP_PARITY && server.length === client.length && server.every((s, i) => s === client[i]);
      rec('S-247', 'AA-12: client Auth.can == server resolveCapability across fixtures', !!agree, `server=[${server}] client=[${client}]`); await ctx.close(); }

    // S-248 (AA-EXT-1, AGY external): the stock + products CSV exports honour the seeSellingPrice gate — a
    // denied role's CSV must NOT carry a Sell Price column (was the on-screen table only). Drives the LIVE
    // export via a captured _downloadCSV. Client-only view consistency (price is public catalogue data, P-13).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        let hdrs = null; const _dl = Pages._downloadCSV; Pages._downloadCSV = (fn, headers) => { hdrs = headers.slice(); };
        Auth._user = { id: 'u', username: 'sm', role: 'store_manager', storeIds: ['karrinyup'] };
        // DENIED: no Sell Price column in either export
        Auth.adoptPolicy({ version: 1, roles: { store_manager: { seeSellingPrice: false }, director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        Pages._exportStockCSV(); const stockDenied = !hdrs.includes('Sell Price');
        Pages._exportProductsCSV(); const prodDenied = !hdrs.includes('Sell Price');
        // ALLOWED: column present
        Auth.adoptPolicy({ version: 2, roles: { store_manager: { seeSellingPrice: true }, director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        Pages._exportStockCSV(); const stockAllowed = hdrs.includes('Sell Price');
        Pages._downloadCSV = _dl; Auth._policy = null;
        return { stockDenied, prodDenied, stockAllowed };
      });
      rec('S-248', 'AA-EXT-1: CSV exports honour seeSellingPrice (no price column when denied)', r.stockDenied === true && r.prodDenied === true && r.stockAllowed === true, `stockDenied=${r.stockDenied} prodDenied=${r.prodDenied} stockAllowed=${r.stockAllowed} (clean: all true)`); await ctx.close(); }

    // S-249 (AA-20): adopting a policy whose pinEpoch advanced (Director cleared/changed the PIN) drops this
    // device's local PIN unlock immediately — the UI can't show unlocked while the server rejects the grant.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get(); d.accessPolicy = null; Auth._policy = null;
        Auth._user = { id: 'u', username: 'sm', role: 'staff', storeIds: ['karrinyup'] };
        await Sync._applyAccessPolicy({ version: 1, pinEpoch: 3, roles: { staff: {}, director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        // simulate a live local PIN unlock
        Auth._tempStockTake = new Date(Date.now() + 3600000).toISOString();
        Sync._pinGrantProof = { proof: 'PG', expiresAt: Date.now() + 3600000 };
        const before = !!Auth._tempStockTake && !!Sync._pinGrantProof;
        // Director clears the PIN -> pinEpoch bumps to 4; device adopts
        await Sync._applyAccessPolicy({ version: 2, pinEpoch: 4, roles: { staff: {}, director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        const afterTemp = Auth._tempStockTake, afterGrant = Sync._pinGrantProof;
        // an UNRELATED edit (same pinEpoch) must NOT drop a fresh unlock
        Auth._tempStockTake = new Date(Date.now() + 3600000).toISOString(); Sync._pinGrantProof = { proof: 'PG2', expiresAt: Date.now() + 3600000 };
        await Sync._applyAccessPolicy({ version: 3, pinEpoch: 4, roles: { staff: { seeCharts: true }, director: { editAccessPolicy: true } }, overrides: {}, sudo: {} });
        const survives = !!Auth._tempStockTake && !!Sync._pinGrantProof;
        Auth._policy = null; Auth._tempStockTake = null; Sync._pinGrantProof = null;
        return { before, clearedTemp: afterTemp === null, clearedGrant: afterGrant === null, survives };
      }, s);
      rec('S-249', 'AA-20: PIN epoch bump drops the local unlock; unrelated edit keeps it', r.before === true && r.clearedTemp === true && r.clearedGrant === true && r.survives === true, `before=${r.before} clearedTemp=${r.clearedTemp} clearedGrant=${r.clearedGrant} survives=${r.survives} (clean: all true)`); await ctx.close(); }

    // ═══ OS-W3 sentinels (S-250..S-259 = S-W3-1..10): offline flush-before-purge + era re-bootstrap + hold ═══
    // Each block uses its own context (fresh IndexedDB/localStorage). Endpoints use distinct hostnames so the
    // Node-side route handlers can capture per-endpoint traffic (push bodies, steps-pull hits) for ordering
    // assertions. A generic logic.azure.com catch-all absorbs boot-time calls (registered FIRST = matched LAST).

    // S-250 (S-W3-1): pending offline row for an out-of-scope store SURVIVES a scope change on the REAL poll
    // path (pull holds _syncLock) — pushed via the lock-aware drain, THEN purged. The old code lost it.
    { const { ctx, page } = await newPage(b); const pushBodies = [];
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
      await page.route('**sw3push.test**', r => { const b2 = JSON.parse(r.request().postData() || '{}'); pushBodies.push(b2); const ids = ((b2.data && b2.data.transactions) || []).map(t => t.TransactionId); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ids, duplicates: [], rejected: [], failed: [] }) }); });
      await page.route('**sw3pull.test**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 5, scope: ['karrinyup'] }) }));
      await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        // NB: the departing store must EXIST in the shared catalogue (a real store leaving THIS DEVICE's
        // scope) — a fictional id would be egress-invalid and durably rejected, which is a DIFFERENT case (S-252).
        const txn = { id: 'sw3_pending_1', date: UI.todayLocal(), storeId: 'whitford', productId: DB.get().products[0].id, type: 'out', qty: 1, staffName: 'T', _synced: false };
        await DB.addTransactionDurable(txn);                                   // seeded BEFORE the sig is recorded
        localStorage.setItem('bob_scope_sig', JSON.stringify(['whitford', 'karrinyup'].sort()));
        localStorage.removeItem('bob_scope_purge_pending');
        Sync._isLeader = true; Sync._unauthorized = false; Sync._topologyHold = false; Sync._syncLock = false;
        Sync._pullUrl = 'https://sw3pull.test/x'; Sync._pushUrl = 'https://sw3push.test/x'; Sync._stepsPullUrl = null; Sync._stepsPushUrl = null;
        Sync._lastSyncId = 5;
        await Sync.poll();
        const gone = !DB.get().transactions.some(t => t.id === 'sw3_pending_1');
        return { gone, sig: localStorage.getItem('bob_scope_sig'), cursor: localStorage.getItem('bob_last_sp_id'), pendingLock: localStorage.getItem('bob_scope_purge_pending') };
      }, s);
      const pushedIt = pushBodies.some(b2 => ((b2.data && b2.data.transactions) || []).some(t => t.TransactionId === 'sw3_pending_1'));
      rec('S-250', 'W3-1: offline row for a departing store is PUSHED (locked drain) then purged on the poll path', pushedIt === true && r.gone === true && r.sig === JSON.stringify(['karrinyup']) && r.cursor === '0' && r.pendingLock !== '1', `pushed=${pushedIt} purged=${r.gone} sig=${r.sig} cursor=${r.cursor} lock=${r.pendingLock} (clean: pushed+purged, sig=[karrinyup], cursor=0, no lock)`); await ctx.close(); }

    // S-251 (S-W3-2): the ATOMIC purge never annihilates a concurrent follower Dexie write — it serialises
    // strictly before (purge refuses: unsynced drop) or after (row survives the commit). Then the re-arm
    // detector catches a surviving out-of-scope row (the signature is a cache, never a guarantee).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        localStorage.setItem('bob_scope_sig', JSON.stringify(['karrinyup']));
        const late = { id: 'sw3_follower_1', date: UI.todayLocal(), storeId: 'gonestore', productId: 'x', type: 'out', qty: 1, _synced: false };
        // race the atomic purge against a follower-style DIRECT Dexie write (bypasses cache + guards)
        const [purged] = await Promise.all([
          DB.purgeToScopeAtomic(['karrinyup'], {}),
          (async () => { await new Promise(res => setTimeout(res, 0)); try { await bobDB.transactions.put(late); } catch (e) {} })(),
        ]);
        const onDisk = !!(await bobDB.transactions.get('sw3_follower_1'));
        await DB.refresh();
        const rearmed = onDisk ? DB.reArmScopeIfOutOfScope() : true;   // if it landed, detection must re-arm
        return { purged, onDisk, rearmed, lock: localStorage.getItem('bob_scope_purge_pending') };
      }, s);
      rec('S-251', 'W3-2: atomic purge serialises a concurrent follower write (never annihilated) + re-arm detects a survivor', r.onDisk === true && r.rearmed === true && r.lock === '1', `onDisk=${r.onDisk} rearmed=${r.rearmed} lock=${r.lock} (clean: row survived on disk, re-armed, lock raised)`); await ctx.close(); }

    // S-252 (S-W3-3): a failed flush (offline push) means NO purge, privacy lock raised, signature NOT
    // advanced — and an egress-INVALID pending row is durably _rejected so it cannot livelock the guard.
    { const { ctx, page } = await newPage(b); let pushMode = 'fail';
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
      await page.route('**sw3push.test**', r => { if (pushMode === 'fail') return r.abort(); const b2 = JSON.parse(r.request().postData() || '{}'); const ids = ((b2.data && b2.data.transactions) || []).map(t => t.TransactionId); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ids, duplicates: [], rejected: [], failed: [] }) }); });
      await page.route('**sw3pull.test**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 5, scope: ['karrinyup'] }) }));
      await waitBoot(page, repo); const s = await setup(page);
      const r1 = await page.evaluate(async () => {
        const good = { id: 'sw3_good_1', date: UI.todayLocal(), storeId: 'whitford', productId: DB.get().products[0].id, type: 'out', qty: 1, staffName: 'T', _synced: false };
        const bad  = { id: 'sw3_bad_1',  date: UI.todayLocal(), storeId: 'whitford', productId: 'no_such_product', type: 'out', qty: 1, staffName: 'T', _synced: false };  // egress-invalid: unknown product
        await DB.addTransactionDurable(good); await DB.addTransactionDurable(bad);
        localStorage.setItem('bob_scope_sig', JSON.stringify(['whitford', 'karrinyup'].sort()));
        localStorage.removeItem('bob_scope_purge_pending');
        Sync._isLeader = true; Sync._unauthorized = false; Sync._topologyHold = false; Sync._syncLock = false;
        Sync._pullUrl = 'https://sw3pull.test/x'; Sync._pushUrl = 'https://sw3push.test/x'; Sync._stepsPullUrl = null; Sync._stepsPushUrl = null; Sync._lastSyncId = 5;
        await Sync.poll();   // flush FAILS → purge must refuse
        return { stillThere: DB.get().transactions.some(t => t.id === 'sw3_good_1'), lock: localStorage.getItem('bob_scope_purge_pending'), sig: localStorage.getItem('bob_scope_sig') };
      }, s);
      pushMode = 'ok';
      const r2 = await page.evaluate(async () => {
        // "later, once online": the poll's pending-drain push scheduled a retry that still HOLDS the lock —
        // fast-forward past it deterministically (the timer releases it within seconds in real life)
        if (Sync._syncRetryTimer) { clearTimeout(Sync._syncRetryTimer); Sync._syncRetryTimer = null; }
        Sync._syncLock = false; Sync._skipLockRelease = false; Sync._retryCount = 0; Sync._syncing = false;
        await Sync.poll();   // flush works now: good row accepted; bad row durably _rejected; purge proceeds
        const t = DB.get().transactions;
        return { goodGone: !t.some(x => x.id === 'sw3_good_1'), badGone: !t.some(x => x.id === 'sw3_bad_1'), lock: localStorage.getItem('bob_scope_purge_pending'), sig: localStorage.getItem('bob_scope_sig') };
      }, s);
      rec('S-252', 'W3-3: failed flush = no purge + lock + sig frozen; egress-invalid row is durably rejected (no livelock)', r1.stillThere === true && r1.lock === '1' && r1.sig === JSON.stringify(['whitford', 'karrinyup'].sort()) && r2.goodGone === true && r2.badGone === true && r2.lock !== '1' && r2.sig === JSON.stringify(['karrinyup']), `offline: kept=${r1.stillThere} lock=${r1.lock} | online: goodGone=${r2.goodGone} badGone=${r2.badGone} lock=${r2.lock} sig=${r2.sig}`); await ctx.close(); }

    // S-253 (S-W3-4 + S-W3-8): a per-store topologyVersion bump with UNCHANGED StoreIds wipes exactly the
    // bumped store's rows from Dexie (old-era leak) — including the lower-version store of a multi-store map
    // (a scalar/max implementation would miss it).
    { const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
      await page.route('**sw3pull.test**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 5, scope: ['storeA', 'storeB'], topologyVersions: { storeA: 10, storeB: 3 } }) }));
      await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        await DB.addTransactionDurable({ id: 'sw3_eraA', date: UI.todayLocal(), storeId: 'storeA', productId: 'x', type: 'out', qty: 1, _synced: true });
        await DB.addTransactionDurable({ id: 'sw3_eraB', date: UI.todayLocal(), storeId: 'storeB', productId: 'x', type: 'out', qty: 1, _synced: true });
        localStorage.setItem('bob_scope_sig', JSON.stringify(['storeA', 'storeB'].sort()));
        localStorage.setItem('bob_topo_vers', JSON.stringify({ storeA: 10, storeB: 2 }));   // B bumps 2→3; max (10) unchanged
        localStorage.removeItem('bob_scope_purge_pending');
        Sync._isLeader = true; Sync._unauthorized = false; Sync._topologyHold = false; Sync._syncLock = false;
        Sync._pullUrl = 'https://sw3pull.test/x'; Sync._pushUrl = null; Sync._stepsPullUrl = null; Sync._stepsPushUrl = null; Sync._lastSyncId = 5;
        await Sync.poll();
        const t = DB.get().transactions;
        return { aKept: t.some(x => x.id === 'sw3_eraA'), bGone: !t.some(x => x.id === 'sw3_eraB'), vers: localStorage.getItem('bob_topo_vers'), cursor: localStorage.getItem('bob_last_sp_id') };
      }, s);
      rec('S-253', 'W3-4/8: per-store era bump (unchanged StoreIds, max unchanged) wipes EXACTLY the bumped store from Dexie', r.aKept === true && r.bGone === true && r.vers === JSON.stringify({ storeA: 10, storeB: 3 }) && r.cursor === '0', `aKept=${r.aKept} bGone=${r.bGone} vers=${r.vers} cursor=${r.cursor} (clean: A kept, B wiped, map updated, cursor reset)`); await ctx.close(); }

    // S-254 (S-W3-5 + hold lifecycle): the pinned hold envelope leaves EVERY cursor untouched (even a
    // defence-in-depth maxId in the body must not advance it), suppresses pullSteps, keeps pushes flowing —
    // and a later NORMAL pull clears the hold so steps RESUME.
    { const { ctx, page } = await newPage(b); let holdMode = 'hold200'; let stepsPullHits = 0;
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
      await page.route('**sw3pull.test**', r => {
        if (holdMode === 'hold200') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ topologyPending: true, items: [], policyVersion: 1, maxId: 9000 }) });
        if (holdMode === 'hold423') return r.fulfill({ status: 423, contentType: 'application/json', body: JSON.stringify({ topologyPending: true, items: [], policyVersion: 1, maxId: 9001, scope: ['legacy-forbidden'] }) });
        if (holdMode === 'auth401') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ topologyPending: true, items: [], policyVersion: 12, maxId: 9001, scope: ['forbidden'] }) });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 7, scope: ['karrinyup'] }) });
      });
      await page.route('**sw3spull.test**', r => { stepsPullHits++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 0 }) }); });
      await waitBoot(page, repo); const s = await setup(page);
      const r1 = await page.evaluate(async () => {
        localStorage.setItem('bob_scope_sig', JSON.stringify(['karrinyup'])); localStorage.removeItem('bob_scope_purge_pending');
        Sync._isLeader = true; Sync._unauthorized = false; Sync._topologyHold = false; Sync._syncLock = false;
        Sync._pullUrl = 'https://sw3pull.test/x'; Sync._pushUrl = null; Sync._stepsPullUrl = 'https://sw3spull.test/x'; Sync._stepsPushUrl = null;
        Sync._lastSyncId = 7; Sync._lastStepSyncId = 4; localStorage.setItem('bob_last_sp_id', '7'); localStorage.setItem('bob_last_step_sp_id', '4');
        await Sync.poll();
        return { hold: Sync._topologyHold === true, cursor: Sync._lastSyncId, stepCursor: localStorage.getItem('bob_last_step_sp_id') };
      }, s);
      const hitsDuringHold = stepsPullHits;
      // W3-SR-8 belt-and-braces (build-audit R1, BOTH auditors): a NON-2xx body carrying the flag is ALSO a hold
      holdMode = 'hold423';
      const r1b = await page.evaluate(async () => { Sync._topologyHold = false; await Sync.poll(); return { hold: Sync._topologyHold === true, cursor: Sync._lastSyncId, stepCursor: localStorage.getItem('bob_last_step_sp_id'), sig: localStorage.getItem('bob_scope_sig') }; }, s);
      const hitsDuring423 = stepsPullHits;
      // build-audit R2 (Codex): a ledger 401 pauses the WHOLE cycle — the hold flag on a 401 body is IGNORED
      // (auth precedence), and pullSteps must NOT run / advance its cursor while unauthorized.
      holdMode = 'auth401';
      const r1c = await page.evaluate(async () => { Sync._topologyHold = false; await Sync.poll(); const out = { unauth: Sync._unauthorized === true, hold: Sync._topologyHold === false, cursor: Sync._lastSyncId, stepCursor: localStorage.getItem('bob_last_step_sp_id') }; Sync._unauthorized = false; return out; }, s);
      const hitsDuring401 = stepsPullHits;
      holdMode = 'normal';
      // TWO polls: the first may legitimately reconcile-abort (the thresholds-aware detector spots the SEED's
      // other-store thresholds as out-of-scope vs this fixture's sig and re-arms — fail-closed keeps the hold
      // one extra cycle, per W3-SR-15); the steady-state second poll clears the hold and resumes steps.
      const r2 = await page.evaluate(async () => { await Sync.poll(); await Sync.poll(); return { hold: Sync._topologyHold, cursor: Sync._lastSyncId }; }, s);
      rec('S-254', 'W3-5: hold envelope (200 AND non-2xx body) freezes cursors + suppresses steps; 401 pauses the WHOLE cycle; normal pull resumes', r1.hold === true && r1.cursor === 7 && r1.stepCursor === '4' && hitsDuringHold === 0 && r1b.hold === true && r1b.cursor === 7 && r1b.stepCursor === '4' && r1b.sig === JSON.stringify(['karrinyup']) && hitsDuring423 === 0 && r1c.unauth === true && r1c.hold === true && r1c.stepCursor === '4' && hitsDuring401 === hitsDuring423 && r2.hold === false && stepsPullHits > hitsDuring401, `200: hold=${r1.hold} cursor=${r1.cursor} | 423: hold=${r1b.hold} cursor=${r1b.cursor} sig=${r1b.sig} stepsHits=${hitsDuring423} | 401: unauth=${r1c.unauth} holdIgnored=${r1c.hold} stepCursor=${r1c.stepCursor} stepsHits=${hitsDuring401 - hitsDuring423} | resumed=${stepsPullHits > hitsDuring401} (clean: held at 7/4, sig untouched, 0 hits during hold+401, resumes)`); await ctx.close(); }

    // S-255 (S-W3-10/15): a NON-hold pull that ABORTS on scope-purge failure keeps pullSteps suppressed via
    // the purge-pending arm of the entry guard (the hold flag alone is not the invariant).
    { const { ctx, page } = await newPage(b); let stepsPullHits = 0;
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
      await page.route('**sw3push.test**', r => r.abort());   // flush cannot succeed
      await page.route('**sw3pull.test**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 5, scope: ['karrinyup'] }) }));
      await page.route('**sw3spull.test**', r => { stepsPullHits++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 0 }) }); });
      await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        await DB.addTransactionDurable({ id: 'sw3_blocker', date: UI.todayLocal(), storeId: 'whitford', productId: DB.get().products[0].id, type: 'out', qty: 1, staffName: 'T', _synced: false });
        localStorage.setItem('bob_scope_sig', JSON.stringify(['whitford', 'karrinyup'].sort())); localStorage.removeItem('bob_scope_purge_pending');
        Sync._isLeader = true; Sync._unauthorized = false; Sync._topologyHold = false; Sync._syncLock = false;
        Sync._pullUrl = 'https://sw3pull.test/x'; Sync._pushUrl = 'https://sw3push.test/x'; Sync._stepsPullUrl = 'https://sw3spull.test/x'; Sync._stepsPushUrl = null; Sync._lastSyncId = 5;
        await Sync.poll();   // non-hold pull → reconcile aborts (flush fails, purge refuses)
        return { lock: localStorage.getItem('bob_scope_purge_pending'), hold: Sync._topologyHold, stepCursor: Sync._lastStepSyncId };
      }, s);
      rec('S-255', 'W3-10/15: a non-hold pull aborting on purge failure still suppresses pullSteps (purge-pending arm)', r.lock === '1' && stepsPullHits === 0, `lock=${r.lock} stepsHits=${stepsPullHits} hold=${r.hold} (clean: lock=1, 0 steps hits)`); await ctx.close(); }

    // S-256 (S-W3-7): NO STARVATION — the AA policy checks fire on a HOLD envelope carrying a policyVersion
    // bump, AND while the scope purge is stuck (page-1 order: policy first, unconditional).
    { const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
      await page.route('**sw3pull.test**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ topologyPending: true, items: [], policyVersion: 99 }) }));
      await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        let cfgFetched = 0, purgeRan = 0;
        Sync._fetchRemoteConfig = async () => { cfgFetched++; };
        Sync._reconcilePolicyPurge = async () => { purgeRan++; };
        localStorage.setItem('bob_scope_purge_pending', '1');   // stuck scope purge must NOT starve policy
        Sync._scopePurgePending = true;
        Sync._isLeader = true; Sync._unauthorized = false; Sync._topologyHold = false; Sync._syncLock = false;
        Sync._pullUrl = 'https://sw3pull.test/x'; Sync._pushUrl = null; Sync._stepsPullUrl = null; Sync._stepsPushUrl = null; Sync._lastSyncId = 5;
        const d = DB.get(); d.accessPolicy = { version: 1 };
        await Sync.poll();   // hold envelope + stuck purge — BOTH must still run the policy path
        return { cfgFetched, purgeRan, hold: Sync._topologyHold };
      }, s);
      rec('S-256', 'W3-7: policyVersion bump on a HOLD envelope + stuck scope purge still adopts policy + runs cost purge', r.cfgFetched >= 1 && r.purgeRan >= 1 && r.hold === true, `cfgFetched=${r.cfgFetched} purgeRan=${r.purgeRan} hold=${r.hold} (clean: both >=1 during hold)`); await ctx.close(); }

    // S-257 (S-W3-2 leader-arm + S-W3-16): a leader-originated late write — including the DRAFT-TRANSFER
    // writers that bypass scheduleSync — is locked AT the write by the DB-layer guard.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const armed = [];
        const reset = () => { localStorage.setItem('bob_scope_sig', JSON.stringify(['karrinyup'])); localStorage.removeItem('bob_scope_purge_pending'); };
        reset(); await DB.addTransferDurable({ id: 'sw3_draft1', fromStoreId: 'gonestore', toStoreId: 'alsogone', status: 'draft', items: [] });
        armed.push(localStorage.getItem('bob_scope_purge_pending') === '1' && !localStorage.getItem('bob_scope_sig'));
        reset(); await DB.updateTransferDurable({ id: 'sw3_draft1', fromStoreId: 'gonestore', toStoreId: 'alsogone', status: 'draft', items: [{ productId: 'x', qty: 1 }] });
        armed.push(localStorage.getItem('bob_scope_purge_pending') === '1');
        reset(); await DB.addTransactionDurable({ id: 'sw3_leader1', date: UI.todayLocal(), storeId: 'gonestore', productId: 'x', type: 'out', qty: 1, _synced: false });
        armed.push(localStorage.getItem('bob_scope_purge_pending') === '1');
        reset(); await DB.addTransferDurable({ id: 'sw3_draft2', fromStoreId: 'karrinyup', toStoreId: 'gonestore', status: 'draft', items: [] });   // either-end IN scope → must NOT arm
        armed.push(localStorage.getItem('bob_scope_purge_pending') !== '1');
        // build-audit R1 (Codex): thresholds are purged, so the DETECTOR must scan them too — an out-of-scope
        // threshold row (written via the ref-data commit path, no per-row guard) re-arms via reArmScopeIfOutOfScope
        reset(); DB.get().thresholds.push({ storeId: 'gonestore', productId: 'BDW_1', minQty: 5 });
        armed.push(DB.reArmScopeIfOutOfScope() === true && localStorage.getItem('bob_scope_purge_pending') === '1');
        DB.get().thresholds = DB.get().thresholds.filter(t => t.storeId !== 'gonestore');
        return armed;
      }, s);
      rec('S-257', 'W3-16: DB-layer guard locks at the write (draft add/update + txn); in-scope no-arm; thresholds detected', r.every(Boolean), `[draftAdd,draftUpdate,txn,inScopeNoArm,thresholdDetected]=${JSON.stringify(r)} (clean: all true)`); await ctx.close(); }

    // S-260 (W3-SR-1, build-audit R1 — AGY P0): the NESTED drain never schedules the retry timer, even on the
    // partial/ambiguous SUCCESS paths (legacy ack without processedCount; v2 failed rows) — and never touches
    // the caller's lock.
    { const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
      await page.route('**sw3pushamb.test**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));   // legacy-ambiguous: 200 with NO buckets, NO processedCount
      await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        await DB.addTransactionDurable({ id: 'sw3_amb_1', date: UI.todayLocal(), storeId: 'karrinyup', productId: DB.get().products[0].id, type: 'out', qty: 1, staffName: 'T', _synced: false });
        Sync._unauthorized = false; Sync._pushUrl = 'https://sw3pushamb.test/x'; Sync._stepsPushUrl = null;
        Sync._syncLock = true;                                  // simulate being inside pull's held lock
        // NB (saboteur round-2 BLIND fix): _scheduleSyncRetry sets _markRetryTimer, NOT _syncRetryTimer —
        // the first version of this sentinel watched the wrong variable and proved nothing.
        if (Sync._markRetryTimer) { clearTimeout(Sync._markRetryTimer); Sync._markRetryTimer = null; }
        Sync._syncRetryTimer = null; Sync._retryCount = 0; Sync._markRetryCount = 0;
        await Sync._drainPendingLocked();                        // ambiguous ack → the guarded branch
        const out = { timer: Sync._markRetryTimer == null && Sync._syncRetryTimer == null, lockHeld: Sync._syncLock === true, rowKept: DB.get().transactions.some(t => t.id === 'sw3_amb_1' && !t._synced) };   // == null: the timer field starts UNDEFINED until first use
        if (Sync._markRetryTimer) { clearTimeout(Sync._markRetryTimer); Sync._markRetryTimer = null; }
        Sync._syncLock = false;
        return out;
      }, s);
      rec('S-260', 'W3-1: nested drain on an AMBIGUOUS ack schedules NO retry timer and leaves the caller lock held', r.timer === true && r.lockHeld === true && r.rowKept === true, `noTimer=${r.timer} lockHeld=${r.lockHeld} rowKept=${r.rowKept} (clean: all true)`); await ctx.close(); }

    // S-258 (S-W3-9): per-table pending predicates — synced-only legacy metadata (delivery/stockTake/transfer)
    // purges fine; a single unsynced out-of-scope recordStep REFUSES the purge.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        const d = DB.get();
        (d.stockTakes = d.stockTakes || []).push({ id: 'sw3_take', storeId: 'gonestore', date: UI.todayLocal(), items: [] });
        (d.deliveries = d.deliveries || []).push({ id: 'sw3_deliv', storeId: 'gonestore', date: UI.todayLocal(), items: [] });
        (d.transfers = d.transfers || []).push({ id: 'sw3_tr', fromStoreId: 'gonestore', toStoreId: 'gonestore2', status: 'received' });
        await bobDB.stockTakes.bulkPut(d.stockTakes); await bobDB.deliveries.bulkPut(d.deliveries); await bobDB.transfers.bulkPut(d.transfers);
        const ok1 = await DB.purgeToScopeAtomic(['karrinyup'], {});   // no flagged pending rows → proceeds
        const legacyGone = !(await bobDB.stockTakes.get('sw3_take')) && !(await bobDB.deliveries.get('sw3_deliv')) && !(await bobDB.transfers.get('sw3_tr'));
        await DB.addStepDurable({ stepId: 'sw3_step1', ownerStoreId: 'gonestore', kind: 'stocktake', _synced: false });
        const ok2 = await DB.purgeToScopeAtomic(['karrinyup'], {});   // unsynced step would drop → REFUSE
        const stepKept = !!(await bobDB.recordSteps.get('sw3_step1'));
        return { ok1, legacyGone, ok2, stepKept };
      }, s);
      rec('S-258', 'W3-9: synced legacy metadata purges; an unsynced out-of-scope recordStep refuses the purge', r.ok1 === true && r.legacyGone === true && r.ok2 === false && r.stepKept === true, `ok1=${r.ok1} legacyGone=${r.legacyGone} ok2=${r.ok2} stepKept=${r.stepKept} (clean: true,true,false,true)`); await ctx.close(); }

    // S-259 (S-W3-6, regression): a NORMAL scope change with nothing pending behaves exactly as before —
    // one purge, cursor reset, signature recorded, no privacy lock.
    { const { ctx, page } = await newPage(b);
      await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
      await page.route('**sw3pull.test**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 5, scope: ['karrinyup'] }) }));
      await waitBoot(page, repo); const s = await setup(page);
      const r = await page.evaluate(async () => {
        await DB.addTransactionDurable({ id: 'sw3_synced1', date: UI.todayLocal(), storeId: 'gonestore', productId: 'x', type: 'out', qty: 1, _synced: true });
        localStorage.setItem('bob_scope_sig', JSON.stringify(['gonestore', 'karrinyup'].sort())); localStorage.removeItem('bob_scope_purge_pending');
        Sync._isLeader = true; Sync._unauthorized = false; Sync._topologyHold = false; Sync._syncLock = false;
        Sync._pullUrl = 'https://sw3pull.test/x'; Sync._pushUrl = null; Sync._stepsPullUrl = null; Sync._stepsPushUrl = null; Sync._lastSyncId = 5;
        await Sync.poll();
        return { gone: !DB.get().transactions.some(t => t.id === 'sw3_synced1'), sig: localStorage.getItem('bob_scope_sig'), cursor: localStorage.getItem('bob_last_sp_id'), lock: localStorage.getItem('bob_scope_purge_pending') };
      }, s);
      rec('S-259', 'W3-6 regression: normal scope change (nothing pending) purges + resets exactly as before', r.gone === true && r.sig === JSON.stringify(['karrinyup']) && r.cursor === '0' && r.lock !== '1', `gone=${r.gone} sig=${r.sig} cursor=${r.cursor} lock=${r.lock} (clean: purged, sig recorded, cursor 0, no lock)`); await ctx.close(); }

    // ═══ OS-W4.2 sentinels (S-261..S-270 = S-W4-1/2/3/4/6/9/11/16/17/18): the era-aware pricing lens ═══
    // Spec: AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md (LOCKED). Common fixture idiom: the lens state is
    // localStorage flags + DB.get().pricingConfig (in-memory; each sentinel runs in a FRESH context).

    // S-261 (S-W4-1): CLIENT/SERVER PARITY — the lens chain resolved by the booted app must agree with a
    // composition of the REAL server primitives (validPricingSeries + resolvePricingRate per tier) across
    // override/global/default/gap/malformed/boundary fixtures. Closes the client-drift class by construction.
    { const IV = (rate, from, to) => ({ rate, from: from + 'T00:00:00Z', to: to ? to + 'T00:00:00Z' : null });
      const PFX = [
        { n: 'override-wins', sm: { '*': [IV(25, '2024-01-01', null)], PX: [IV(10, '2024-01-01', null)] }, g: { PX: [IV(40, '2024-01-01', null)] }, pid: 'PX', d: '2025-01-01' },
        { n: 'global-mid', sm: { '*': [IV(25, '2024-01-01', null)] }, g: { PX: [IV(40, '2024-01-01', null)] }, pid: 'PX', d: '2025-01-01' },
        { n: 'store-default', sm: { '*': [IV(25, '2024-01-01', null)] }, g: {}, pid: 'QX', d: '2025-01-01' },
        { n: 'valid-gap-falls-through', sm: { '*': [IV(25, '2024-01-01', null)], PX: [IV(10, '2024-01-01', '2024-06-01')] }, g: {}, pid: 'PX', d: '2025-01-01' },
        { n: 'malformed-override', sm: { '*': [IV(25, '2024-01-01', null)], PX: [IV(999, '2024-01-01', null)] }, g: {}, pid: 'PX', d: '2025-01-01' },
        { n: 'malformed-unrelated-sibling', sm: { '*': [IV(25, '2024-01-01', null)], XX: [IV(-1, '2024-01-01', null)] }, g: {}, pid: 'PX', d: '2025-01-01' },
        { n: 'boundary-at-from', sm: { '*': [IV(25, '2024-01-01', '2024-06-01'), IV(30, '2024-06-01', null)] }, g: {}, pid: null, d: '2024-06-01' },
        { n: 'boundary-to-exclusive-not-set', sm: { '*': [IV(25, '2024-01-01', '2024-06-01')] }, g: {}, pid: null, d: '2024-06-01' },
      ];
      const server = TOPO ? PFX.map(fx => {
        const all = [].concat(Object.keys(fx.sm).map(k => fx.sm[k]), Object.keys(fx.g).map(k => fx.g[k]));
        if (!all.every(x => TOPO.validPricingSeries(x))) return 'ERR';
        const dMs = Date.parse(fx.d + 'T00:00:00Z');
        let r = null;
        if (fx.pid && Object.prototype.hasOwnProperty.call(fx.sm, fx.pid)) r = TOPO.resolvePricingRate(fx.sm[fx.pid], dMs);
        if (r == null && fx.pid && Object.prototype.hasOwnProperty.call(fx.g, fx.pid)) r = TOPO.resolvePricingRate(fx.g[fx.pid], dMs);
        if (r == null && Object.prototype.hasOwnProperty.call(fx.sm, '*')) r = TOPO.resolvePricingRate(fx.sm['*'], dMs);
        return r == null ? 'NOTSET' : r;
      }) : [];
      const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const client = await page.evaluate((PFX) => {
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        const out = PFX.map(fx => {
          DB.get().pricingConfig = { version: 1, global: fx.g, stores: { sfix: fx.sm } };
          const r = Pricing.rateAsOf('sfix', fx.pid, Date.parse(fx.d + 'T00:00:00Z'));
          return r.error ? 'ERR' : (r.notSet ? 'NOTSET' : r.rate);
        });
        delete DB.get().pricingConfig; try { localStorage.removeItem('bob_pricing_activated'); } catch (e) {}
        return out;
      }, PFX);
      const agree = TOPO && server.length === client.length && server.every((v, i) => String(v) === String(client[i]));
      rec('S-261', 'W4-1: client Pricing lens == the REAL server primitives across the fixture matrix', !!agree, `server=[${server}] client=[${client}]`); await ctx.close(); }

    // S-262 (S-W4-2, discount half — the dollar half lands with the W4.3 stamps): RETRO-IMMUNITY — a
    // discount change today opens a NEW interval; a rebuilt PAST invoice keeps its own dates' rates.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        const dFix = { stores: DB.get().stores, deletedTransactions: [], products: [{ id: 'PS1', name: 'Serum', price: 100, franchiseDiscount: null, catId: 'c', active: true }],
          transactions: [
            { id: 'tA', storeId: 'cockburn_office', productId: 'PS1', type: 'transfer_in', qty: 2, date: '2024-06-10', stockFrom: 'HO Warehouse — Head Office (Warehouse)' },
            { id: 'tB', storeId: 'cockburn_office', productId: 'PS1', type: 'transfer_in', qty: 1, date: '2025-08-10', stockFrom: 'HO Warehouse — Head Office (Warehouse)' },
          ] };
        DB.get().pricingConfig = { version: 1, global: {}, stores: { cockburn_office: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: null }] } } };
        const before = Pages._franchiseInvoiceData(dFix, '2024-01-01', '2024-12-31')[0].lines[0].prodDisc;
        // the Director changes the default TODAY (v2 appends: close 25 at 2025-06-01, open 30)
        DB.get().pricingConfig = { version: 2, global: {}, stores: { cockburn_office: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' }, { rate: 30, from: '2025-06-01T00:00:00Z', to: null }] } } };
        const pastAfter = Pages._franchiseInvoiceData(dFix, '2024-01-01', '2024-12-31')[0].lines[0].prodDisc;
        const newLine = Pages._franchiseInvoiceData(dFix, '2025-07-01', '2025-12-31')[0].lines[0].prodDisc;
        delete DB.get().pricingConfig; try { localStorage.removeItem('bob_pricing_activated'); } catch (e) {}
        return { before, pastAfter, newLine };
      });
      rec('S-262', 'W4-2: past invoice lines are IMMUNE to a rate change (own-date resolution); new lines use the new rate', r.before === 25 && r.pastAfter === 25 && r.newLine === 30, `before=${r.before} pastAfter=${r.pastAfter} newLine=${r.newLine} (clean: 25/25/30)`); await ctx.close(); }

    // S-263 (S-W4-3): FALLBACK REGRESSION — with NO config ever served the invoice numbers are EXACTLY
    // today's computation (office default + product override + zero-means-inherit + discMissing surfacing).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        try { localStorage.removeItem('bob_pricing_activated'); localStorage.removeItem('bob_pricing_unresolved'); } catch (e) {}
        delete DB.get().pricingConfig;
        const mkT = (id, pid) => ({ id, storeId: 'cockburn_office', productId: pid, type: 'transfer_in', qty: 1, date: '2025-03-10', stockFrom: 'HO Warehouse — Head Office (Warehouse)' });
        const dFix = { stores: DB.get().stores, deletedTransactions: [], products: [
            { id: 'PA', name: 'A', price: 100, franchiseDiscount: 10, catId: 'c', active: true },
            { id: 'PB', name: 'B', price: 100, franchiseDiscount: 0, catId: 'c', active: true },     // legacy 0 = inherit
            { id: 'PC', name: 'C', price: 100, franchiseDiscount: null, catId: 'c', active: true },
          ], transactions: [mkT('t1', 'PA'), mkT('t2', 'PB'), mkT('t3', 'PC')] };
        const sd = Pages._franchiseInvoiceData(dFix, '2025-01-01', '2025-12-31')[0];
        const by = {}; sd.lines.forEach(l => by[l.product.id] = l.prodDisc);
        return { lensOn: sd.lensOn, a: by.PA, b: by.PB, c: by.PC, owedA: sd.lines.find(l => l.product.id === 'PA').owed };
      });
      rec('S-263', 'W4-3: no config ⇒ the LEGACY computation exactly (override 10 / zero-inherit 25 / default 25; lens off)', r.lensOn === false && r.a === 10 && r.b === 25 && r.c === 25 && r.owedA === 90, `lensOn=${r.lensOn} a=${r.a} b=${r.b} c=${r.c} owedA=${r.owedA} (clean: false/10/25/25/90)`); await ctx.close(); }

    // S-264 (S-W4-4): BOUNDARY — [from,to) exclusive; an uncovered date is NOT-SET, never a neighbour's rate.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        DB.get().pricingConfig = { version: 1, global: {}, stores: { sfix: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: '2024-06-01T00:00:00Z' }, { rate: 30, from: '2024-06-01T00:00:00Z', to: null }] }, closedOnly: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: '2024-06-01T00:00:00Z' }] } } };
        const atBoundary = Pricing.rateAsOf('sfix', null, Date.parse('2024-06-01T00:00:00Z'));
        const beforeBoundary = Pricing.rateAsOf('sfix', null, Date.parse('2024-05-31T23:59:59Z'));
        const pastClosed = Pricing.rateAsOf('closedOnly', null, Date.parse('2024-06-01T00:00:00Z'));
        delete DB.get().pricingConfig; try { localStorage.removeItem('bob_pricing_activated'); } catch (e) {}
        return { atB: atBoundary.rate, befB: beforeBoundary.rate, past: pastClosed.notSet === true };
      });
      rec('S-264', 'W4-4: [from,to) exclusive at the boundary; an uncovered date is honestly NOT-SET', r.atB === 30 && r.befB === 25 && r.past === true, `atBoundary=${r.atB} before=${r.befB} pastClosedNotSet=${r.past} (clean: 30/25/true)`); await ctx.close(); }

    // S-265 (S-W4-6): MALFORMED-SERVED-CONFIG — fails CLOSED (0% + surfaced error), NEVER the scalar (the
    // office scalar in the seed is 25 — a fallback would print 25).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        DB.get().pricingConfig = { version: 1, global: {}, stores: { cockburn_office: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: null }], BADP: [{ rate: 999, from: '2024-01-01T00:00:00Z', to: null }] } } };
        const dFix = { stores: DB.get().stores, deletedTransactions: [], products: [{ id: 'PS1', name: 'S', price: 100, franchiseDiscount: null, catId: 'c', active: true }],
          transactions: [{ id: 't1', storeId: 'cockburn_office', productId: 'PS1', type: 'transfer_in', qty: 1, date: '2025-03-10', stockFrom: 'HO Warehouse — Head Office (Warehouse)' }] };
        const sd = Pages._franchiseInvoiceData(dFix, '2025-01-01', '2025-12-31')[0];
        delete DB.get().pricingConfig; try { localStorage.removeItem('bob_pricing_activated'); } catch (e) {}
        return { disc: sd.lines[0].prodDisc, err: sd.lines[0].lineErr, anyErr: sd.anyLineErr };
      });
      rec('S-265', 'W4-6: a malformed series ANYWHERE in the config fails the line CLOSED (0% + PRICING_DATA_ERROR), never the 25% scalar', r.disc === 0 && r.err === 'PRICING_DATA_ERROR' && r.anyErr === true, `disc=${r.disc} err=${r.err} anyErr=${r.anyErr} (clean: 0/PRICING_DATA_ERROR/true)`); await ctx.close(); }

    // S-266 (S-W4-9, SR-82): COHERENCE — a master_data whose pricingVersion LEADS the adopted config has
    // its franchise-discount scalars HELD; an equal-publication master_data applies them.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        const d = DB.get();
        d.products.push({ id: 'PMD1', name: 'MD Probe', price: 10, franchiseDiscount: 5, catId: 'c', active: true });
        d.pricingConfig = { version: 3, global: {}, stores: {} };
        let v0 = 0; try { v0 = parseInt(localStorage.getItem('bob_catalogue_version') || '0', 10) || 0; } catch (e) {}
        await Sync._applyMasterData({ version: v0 + 1, pricingVersion: 4, products: [{ id: 'PMD1', name: 'MD Probe', franchiseDiscount: 99 }] });
        const held = d.products.find(p => p.id === 'PMD1').franchiseDiscount;
        await Sync._applyMasterData({ version: v0 + 2, pricingVersion: 3, products: [{ id: 'PMD1', name: 'MD Probe', franchiseDiscount: 50 }] });
        const applied = d.products.find(p => p.id === 'PMD1').franchiseDiscount;
        d.products = d.products.filter(p => p.id !== 'PMD1'); delete d.pricingConfig;
        try { localStorage.removeItem('bob_pricing_activated'); localStorage.setItem('bob_catalogue_version', String(v0)); } catch (e) {}
        return { held, applied };
      });
      rec('S-266', 'W4-9: a LEADING master_data pricingVersion holds the franchise-discount scalars; same-publication applies', r.held === 5 && r.applied === 50, `held=${r.held} applied=${r.applied} (clean: 5/50)`); await ctx.close(); }

    // S-267 (S-W4-11, SR-10): once ANY config exists, an UNCOVERED FRANCHISE key fails CLOSED; an
    // uncovered non-franchise key is an honest NOT-SET.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        DB.get().pricingConfig = { version: 1, global: {}, stores: { somewhere: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: null }] } } };
        const fr = Pricing.rateAsOf('cockburn', null, Date.now());     // franchise store in the seed, NOT covered
        const nf = Pricing.rateAsOf('karrinyup', null, Date.now());    // non-franchise store, NOT covered
        delete DB.get().pricingConfig; try { localStorage.removeItem('bob_pricing_activated'); } catch (e) {}
        return { fr: fr.error, nf: nf.notSet === true };
      });
      rec('S-267', 'W4-11: an uncovered FRANCHISE billing key with a served config fails closed; non-franchise = NOT-SET', r.fr === 'PRICING_DATA_ERROR' && r.nf === true, `franchise=${r.fr} nonFranchise=${r.nf} (clean: PRICING_DATA_ERROR/true)`); await ctx.close(); }

    // S-268 (S-W4-16, SR-49/81/103): the DORMANT-DEVICE gate — no fresh settled observation ⇒ an
    // HO→franchise submit HOLDS (end-to-end through the REAL submitDraft); a fresh pre-activation
    // observation legitimises the scalar path; stale holds; non-franchise destinations untouched.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.removeItem('bob_pricing_activated'); localStorage.removeItem('bob_pricing_stale'); localStorage.removeItem('bob_pricing_unresolved'); } catch (e) {}
        delete DB.get().pricingConfig;
        Auth._user = { id: 'dir', username: 'dir', role: 'director', storeIds: [] };
        Sync._pricingFresh = false;
        const c1 = await Transfer.create('head_office', 'cockburn', [{ productId: DB.get().products[0].id, qty: 1 }], { isDraft: true });
        const heldSubmit = await Transfer.submitDraft(c1.transferId);                      // dormant ⇒ HOLD (e2e)
        const g1 = Transfer._pricingSubmitGate('head_office', 'cockburn');                 // direct verdicts
        Sync._pricingFresh = true;
        const g2 = Transfer._pricingSubmitGate('head_office', 'cockburn');                 // fresh + pre-activation ⇒ ok (scalar)
        try { localStorage.setItem('bob_pricing_activated', '1'); localStorage.setItem('bob_pricing_stale', '1'); } catch (e) {}
        DB.get().pricingConfig = { version: 1, global: {}, stores: { cockburn: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: null }] } } };
        const g3 = Transfer._pricingSubmitGate('head_office', 'cockburn');                 // stale ⇒ hold
        const g4 = Transfer._pricingSubmitGate('head_office', 'karrinyup');                // non-franchise ⇒ untouched
        try { localStorage.removeItem('bob_pricing_activated'); localStorage.removeItem('bob_pricing_stale'); } catch (e) {}
        delete DB.get().pricingConfig; Sync._pricingFresh = false;
        DB.get().transfers = (DB.get().transfers || []).filter(t => t.id !== c1.transferId);
        return { heldOk: heldSubmit.ok, heldMsg: String(heldSubmit.error || ''), g1: g1.hold, g2: g2.ok, g3: g3.hold, g4: g4.ok };
      });
      rec('S-268', 'W4-16: dormant ⇒ HO→franchise submit HOLDS (e2e); fresh pre-activation ⇒ scalar ok; stale ⇒ hold; non-franchise untouched', r.heldOk === false && r.heldMsg.indexOf('fresh sync') >= 0 && r.g1 === 'NO_FRESH_OBSERVATION' && r.g2 === true && r.g3 === 'PRICING_STALE' && r.g4 === true, `heldOk=${r.heldOk} g1=${r.g1} g2=${r.g2} g3=${r.g3} g4=${r.g4}`); await ctx.close(); }

    // S-269 (S-W4-17, SR-50/63): the FROZEN-LEGACY baseline — a backdated seed resolves pre-activation
    // dates; a legacy franchiseDiscount:0 product was NOT seeded into global (0 = inherit) and bills the
    // store default, identically pre/post activation.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        const dFix = { stores: DB.get().stores, deletedTransactions: [], products: [{ id: 'PZ', name: 'Zero', price: 100, franchiseDiscount: 0, catId: 'c', active: true }],
          transactions: [{ id: 't1', storeId: 'cockburn_office', productId: 'PZ', type: 'transfer_in', qty: 1, date: '2023-05-10', stockFrom: 'HO Warehouse — Head Office (Warehouse)' }] };
        try { localStorage.removeItem('bob_pricing_activated'); } catch (e) {} delete DB.get().pricingConfig;
        const preAct = Pages._franchiseInvoiceData(dFix, '2023-01-01', '2023-12-31')[0].lines[0].prodDisc;
        // the runbook seed: backdated to the era start, at the activation-time scalar; PZ (legacy 0) NOT in global
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        DB.get().pricingConfig = { version: 1, global: {}, stores: { cockburn_office: { '*': [{ rate: 25, from: '2020-01-01T00:00:00Z', to: null }] } } };
        const postAct = Pages._franchiseInvoiceData(dFix, '2023-01-01', '2023-12-31')[0].lines[0].prodDisc;
        // SR-29's other half: ACTIVATED + config lost ⇒ FAIL CLOSED (never a silent scalar revert) — the
        // activation flag alone must keep the lens governing (saboteur R1: the first mutation was BLIND
        // because no assertion exercised activated-without-config).
        delete DB.get().pricingConfig;
        const lostCfg = Pricing.rateAsOf('cockburn_office', null, Date.parse('2023-05-10T00:00:00Z'));
        const lostLine = Pages._franchiseInvoiceData(dFix, '2023-01-01', '2023-12-31')[0].lines[0];
        try { localStorage.removeItem('bob_pricing_activated'); } catch (e) {}
        return { preAct, postAct, lostErr: lostCfg.error, lostDisc: lostLine.prodDisc, lostLineErr: lostLine.lineErr };
      });
      rec('S-269', 'W4-17: the backdated seed resolves pre-activation dates; legacy-0 bills the default pre/post; activated+config-LOST fails CLOSED (no scalar revert)', r.preAct === 25 && r.postAct === 25 && r.lostErr === 'PRICING_DATA_ERROR' && r.lostDisc === 0 && r.lostLineErr === 'PRICING_DATA_ERROR', `preAct=${r.preAct} postAct=${r.postAct} lostErr=${r.lostErr} lostDisc=${r.lostDisc} (clean: 25/25/PRICING_DATA_ERROR/0)`); await ctx.close(); }

    // S-270 (S-W4-18, SR-74/80/81): the STALE HORIZON — under pricing_stale only row instants STRICTLY
    // before the settled-echo server instant resolve; an unsettled echo advances nothing; a settled echo
    // for the adopted version advances the horizon (server instant, never the device clock) + clears stale.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        try { localStorage.setItem('bob_pricing_activated', '1'); localStorage.setItem('bob_pricing_stale', '1'); localStorage.setItem('bob_pricing_conf_at', '2025-06-01T00:00:00Z'); } catch (e) {}
        DB.get().pricingConfig = { version: 7, global: {}, stores: { sfix: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: null }] } } };
        const before = Pricing.rateAsOf('sfix', null, Date.parse('2025-05-31T00:00:00Z'));
        const atH = Pricing.rateAsOf('sfix', null, Date.parse('2025-06-01T00:00:00Z'));
        Sync._notePricingEcho({ pricingSettled: false, pricingInstant: '2025-07-01T00:00:00Z', pricingVersion: 7 });
        let confAfterUnsettled = null; try { confAfterUnsettled = localStorage.getItem('bob_pricing_conf_at'); } catch (e) {}
        Sync._notePricingEcho({ pricingSettled: true, pricingInstant: '2025-07-01T00:00:00Z', pricingVersion: 7 });
        let confAfterSettled = null, staleAfter = null; try { confAfterSettled = localStorage.getItem('bob_pricing_conf_at'); staleAfter = localStorage.getItem('bob_pricing_stale'); } catch (e) {}
        delete DB.get().pricingConfig; try { localStorage.removeItem('bob_pricing_activated'); localStorage.removeItem('bob_pricing_stale'); localStorage.removeItem('bob_pricing_conf_at'); } catch (e) {}
        Sync._pricingFresh = false;
        return { before: before.rate, atH: atH.error, u: confAfterUnsettled, s: confAfterSettled, staleAfter };
      });
      rec('S-270', 'W4-18: stale horizon = strictly-before the settled server instant; unsettled echoes advance NOTHING; a settled echo advances + clears stale', r.before === 25 && r.atH === 'PRICING_STALE' && r.u === '2025-06-01T00:00:00Z' && r.s === '2025-07-01T00:00:00Z' && r.staleAfter === null, `before=${r.before} atHorizon=${r.atH} afterUnsettled=${r.u} afterSettled=${r.s} stale=${r.staleAfter}`); await ctx.close(); }

    // S-271 (OS-W42-AUDIT R1, Codex C1): OFFLINE kills the pricing-commitment path — losing the connection
    // invalidates the freshness fact (the 'offline' event), and the commit gate INDEPENDENTLY requires a
    // currently-healthy connection (a fresh flag from before the drop is not enough).
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      await page.evaluate(() => { try { localStorage.removeItem('bob_pricing_activated'); localStorage.removeItem('bob_pricing_stale'); localStorage.removeItem('bob_pricing_unresolved'); } catch (e) {} delete DB.get().pricingConfig; Sync._pricingFresh = true; });
      await ctx.setOffline(true); await new Promise(r2 => setTimeout(r2, 150));
      const r1 = await page.evaluate(() => ({ freshAfterDrop: Sync._pricingFresh, onLine: navigator.onLine }));
      const r2 = await page.evaluate(() => { Sync._pricingFresh = true; const g = Pricing.commitGate('cockburn'); return { hold: g.hold || null }; });   // even a (stale-world) fresh flag can't commit offline
      await ctx.setOffline(false); await new Promise(r3 => setTimeout(r3, 150));
      const r3 = await page.evaluate(() => { Sync._pricingFresh = true; const g = Pricing.commitGate('cockburn'); Sync._pricingFresh = false; return { ok: g.ok === true }; });
      rec('S-271', 'W42-C1: going OFFLINE invalidates pricing freshness; the commit gate requires a healthy connection; back online + fresh => ok', r1.freshAfterDrop === false && r1.onLine === false && r2.hold === 'NO_FRESH_OBSERVATION' && r3.ok === true, `freshAfterDrop=${r1.freshAfterDrop} onLine=${r1.onLine} offlineHold=${r2.hold} onlineOk=${r3.ok}`); await ctx.close(); }

    // S-272 (OS-W42-AUDIT R1, Codex C2+C3): VERSION-STRICT trust — settled echoes with a missing/empty/
    // null/zero/mismatched version confirm NOTHING (no horizon advance, stale retained, not fresh); a
    // served ROLLBACK config and a post-activation ABSENT item also confirm nothing (and keep a restore
    // hold); only the exact adopted-version match advances + clears + freshens.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(async () => {
        try { localStorage.setItem('bob_pricing_activated', '1'); localStorage.setItem('bob_pricing_stale', '1'); localStorage.setItem('bob_pricing_conf_at', '2025-06-01T00:00:00Z'); } catch (e) {}
        DB.get().pricingConfig = { version: 7, global: {}, stores: {} };
        const bads = ['MISSING', 0, '', null, 6];
        const badResults = [];
        for (const v of bads) {
          Sync._pricingFresh = false;
          const body = { pricingSettled: true, pricingInstant: '2025-07-01T00:00:00Z' };
          if (v !== 'MISSING') body.pricingVersion = v;
          Sync._notePricingEcho(body);
          let conf = null, stale = null; try { conf = localStorage.getItem('bob_pricing_conf_at'); stale = localStorage.getItem('bob_pricing_stale'); } catch (e) {}
          badResults.push(conf === '2025-06-01T00:00:00Z' && stale === '1' && Sync._pricingFresh === false);
        }
        Sync._pricingFresh = false;
        await Sync._applyPricingConfig({ version: 6, global: {}, stores: {} });          // C3a: a served ROLLBACK confirms nothing
        const rollbackFresh = Sync._pricingFresh;
        const keptV = Number(DB.get().pricingConfig.version);
        Sync._pricingFresh = false;
        try { localStorage.setItem('bob_pricing_unresolved', '1'); } catch (e) {}
        await Sync._applyPricingConfig(null);                                            // C3b: post-activation ABSENT confirms nothing
        const absentFresh = Sync._pricingFresh;
        let unres = null; try { unres = localStorage.getItem('bob_pricing_unresolved'); } catch (e) {}
        Sync._notePricingEcho({ pricingSettled: true, pricingInstant: '2025-07-02T00:00:00Z', pricingVersion: 7 });   // control: exact match
        let confOk = null; try { confOk = localStorage.getItem('bob_pricing_conf_at'); } catch (e) {}
        const matchFresh = Sync._pricingFresh;
        // R2-C2 matrix: type-coerced ''/null confirm nothing even PRE-activation (adopted 0); a NUMERIC 0
        // is the server's honest pre-activation statement (the ONLY zero that passes); numeric 0 against
        // an ACTIVATED device confirms nothing.
        delete DB.get().pricingConfig;
        try { ['bob_pricing_activated','bob_pricing_stale','bob_pricing_conf_at','bob_pricing_unresolved'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
        Sync._pricingFresh = false;
        Sync._notePricingEcho({ pricingSettled: true, pricingInstant: '2025-07-03T00:00:00Z', pricingVersion: '' });
        const preEmpty = Sync._pricingFresh;
        Sync._notePricingEcho({ pricingSettled: true, pricingInstant: '2025-07-03T00:00:00Z', pricingVersion: null });
        const preNull = Sync._pricingFresh;
        Sync._notePricingEcho({ pricingSettled: true, pricingInstant: '2025-07-03T00:00:00Z', pricingVersion: 0 });
        const preZero = Sync._pricingFresh;
        Sync._pricingFresh = false;
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        Sync._notePricingEcho({ pricingSettled: true, pricingInstant: '2025-07-03T00:00:00Z', pricingVersion: 0 });
        const actZero = Sync._pricingFresh;
        delete DB.get().pricingConfig; Sync._pricingFresh = false;
        try { ['bob_pricing_activated','bob_pricing_stale','bob_pricing_conf_at','bob_pricing_unresolved','bob_pricing_ver'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
        return { allBadInert: badResults.every(x => x), rollbackFresh, keptV, absentFresh, unres, confOk, matchFresh, preEmpty, preNull, preZero, actZero };
      });
      rec('S-272', 'W42-C2/C3(+R2): version trust is TYPE-strict pre AND post activation; rollback/absent configs confirm NOTHING; numeric 0 passes only genuinely pre-activation', r.allBadInert === true && r.rollbackFresh === false && r.keptV === 7 && r.absentFresh === false && r.unres === '1' && r.confOk === '2025-07-02T00:00:00Z' && r.matchFresh === true && r.preEmpty === false && r.preNull === false && r.preZero === true && r.actZero === false, `allBadInert=${r.allBadInert} rollbackFresh=${r.rollbackFresh} keptV=${r.keptV} absentFresh=${r.absentFresh} unres=${r.unres} confOk=${r.confOk} matchFresh=${r.matchFresh} preEmpty=${r.preEmpty} preNull=${r.preNull} preZero=${r.preZero} actZero=${r.actZero}`); await ctx.close(); }

    // S-273 (OS-W42-AUDIT R1, Codex C4+C5): the WRITER CONTRACT — success requires the echoed publication
    // ADOPTED (no echo => fail, config untouched); a FAILED durable commit claims no freshness, and the
    // next IDENTICAL fetch retries persistence to the P4 bob_pricing_ver marker.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      await page.route('**pricing-echo-none**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      await page.route('**pricing-echo-good**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: { version: 8, global: {}, stores: {} } }) }));
      await page.route('**pricing-echo-old**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: { version: 6, global: {}, stores: {} } }) }));
      await page.route('**pricing-echo-v10**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: { version: 10, global: {}, stores: {} } }) }));
      const r = await page.evaluate(async () => {
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        DB.get().pricingConfig = { version: 7, global: {}, stores: {} };
        Auth._user = { id: 'dir', username: 'dir', role: 'director', storeIds: [] };
        Sync._pricingChangeUrl = 'https://x.logic.azure.com/pricing-echo-none';
        const noEcho = await Sync.publishPricingChange({ kind: 'global-product', productId: 'PX', rate: 20 });
        const vAfterNoEcho = Number(DB.get().pricingConfig.version);
        Sync._pricingChangeUrl = 'https://x.logic.azure.com/pricing-echo-good';
        const good = await Sync.publishPricingChange({ kind: 'global-product', productId: 'PX', rate: 20 });
        const vAfterGood = Number(DB.get().pricingConfig.version);
        let marker8 = null; try { marker8 = localStorage.getItem('bob_pricing_ver'); } catch (e) {}
        const realCommit = DB.commitDurable;
        DB.commitDurable = async () => false;
        Sync._pricingFresh = false;
        await Sync._applyPricingConfig({ version: 9, global: {}, stores: {} });          // C5: persist FAILS
        const freshAfterFail = Sync._pricingFresh; const vMem = Number(DB.get().pricingConfig.version);
        let markerAfterFail = null; try { markerAfterFail = localStorage.getItem('bob_pricing_ver'); } catch (e) {}
        DB.commitDurable = async () => true;
        await Sync._applyPricingConfig({ version: 9, global: {}, stores: {} });          // the IDENTICAL next fetch RETRIES
        const freshAfterRetry = Sync._pricingFresh;
        let markerAfterRetry = null; try { markerAfterRetry = localStorage.getItem('bob_pricing_ver'); } catch (e) {}
        // R2-C3: a ROLLBACK echo (older than what we hold) is NOT writer success (holding v9/marker 9)
        Sync._pricingChangeUrl = 'https://x.logic.azure.com/pricing-echo-old';
        const rollbackW = await Sync.publishPricingChange({ kind: 'global-product', productId: 'PX', rate: 20 });
        // R2-C3: a valid NEWER echo whose durable commit fails is NOT writer success either
        DB.commitDurable = async () => false;
        Sync._pricingChangeUrl = 'https://x.logic.azure.com/pricing-echo-v10';
        const nonDurableW = await Sync.publishPricingChange({ kind: 'global-product', productId: 'PX', rate: 20 });
        DB.commitDurable = realCommit;
        delete DB.get().pricingConfig; Sync._pricingFresh = false; Sync._pricingChangeUrl = null;
        try { ['bob_pricing_activated','bob_pricing_ver'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
        return { noEchoOk: noEcho.ok, noEchoReason: noEcho.reason, vAfterNoEcho, goodOk: good.ok, vAfterGood, marker8, freshAfterFail, vMem, markerAfterFail, freshAfterRetry, markerAfterRetry, rollbackWOk: rollbackW.ok, nonDurableWOk: nonDurableW.ok };
      });
      rec('S-273', 'W42-C4/C5(+R2-C3): writer success = the echoed publication adopted EXACTLY + DURABLY; rollback/non-durable echoes fail; a failed persist retries on the next identical fetch', r.noEchoOk === false && r.noEchoReason === 'no-echo' && r.vAfterNoEcho === 7 && r.goodOk === true && r.vAfterGood === 8 && r.marker8 === '8' && r.freshAfterFail === false && r.vMem === 9 && r.markerAfterFail === '8' && r.freshAfterRetry === true && r.markerAfterRetry === '9' && r.rollbackWOk === false && r.nonDurableWOk === false, `noEcho=${r.noEchoOk}/${r.noEchoReason} v=${r.vAfterNoEcho} good=${r.goodOk}/${r.vAfterGood} marker=${r.marker8} failFresh=${r.freshAfterFail} vMem=${r.vMem} mFail=${r.markerAfterFail} retryFresh=${r.freshAfterRetry} mRetry=${r.markerAfterRetry} rollbackW=${r.rollbackWOk} nonDurableW=${r.nonDurableWOk}`); await ctx.close(); }

    // S-274 (OS-W42-AUDIT R1, Codex C6 + AGY-2 + AGY-3): VALIDATING a backup never arms the restore
    // pricing hold (only the restore WRITE does, via _armRestorePricingHold, which also drops the durable
    // marker); the SR-10 franchise check honours the CALLER's topology; a billed sender
    // (stockFromStoreId 'head_office') is gated even when its store row is missing.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        try { localStorage.removeItem('bob_pricing_unresolved'); localStorage.setItem('bob_pricing_ver', '7'); } catch (e) {}
        const bk = { _meta: { app: 'bob-stock', backupFormat: Pages._BACKUP_FORMAT }, products: [{ id: 'p', name: 'P' }], stores: [{ id: 's', name: 'S' }], categories: [{ id: 'c', name: 'C' }], users: [], transactions: [] };
        const val = Pages._validateAndScrubBackup(bk);
        let unresAfterValidate = null; try { unresAfterValidate = localStorage.getItem('bob_pricing_unresolved'); } catch (e) {}
        Pages._armRestorePricingHold();
        let unresAfterArm = null, verAfterArm = 'x'; try { unresAfterArm = localStorage.getItem('bob_pricing_unresolved'); verAfterArm = localStorage.getItem('bob_pricing_ver'); } catch (e) {}
        try { localStorage.removeItem('bob_pricing_unresolved'); } catch (e) {}
        // R2-C4: a FAILED restore WRITE rolls back BOTH markers (the real _applyRestoreData, write forced to throw)
        try { localStorage.setItem('bob_pricing_ver', '7'); } catch (e) {}
        const _origSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function(k, v) { if (k === DB.KEY) throw new Error('quota'); return _origSet.apply(this, arguments); };
        let applied = null; try { applied = Pages._applyRestoreData({ data: { products: [], stores: [], transactions: [], users: [], categories: [] } }); } finally { Storage.prototype.setItem = _origSet; }
        let unresAfterFail = 'x', verAfterFail = null; try { unresAfterFail = localStorage.getItem('bob_pricing_unresolved'); verAfterFail = localStorage.getItem('bob_pricing_ver'); } catch (e) {}
        try { localStorage.setItem('bob_pricing_activated', '1'); } catch (e) {}
        DB.get().pricingConfig = { version: 1, global: {}, stores: { somewhere: { '*': [{ rate: 25, from: '2024-01-01T00:00:00Z', to: null }] } } };
        const fixStores = [{ id: 'ghost_office', name: 'Ghost', isFranchise: true, isFranchiseOffice: true, active: true }];
        const viaFixture = Pricing.rateAsOf('ghost_office', null, Date.now(), fixStores);   // AGY-2: the fixture topology governs SR-10
        const viaLive = Pricing.rateAsOf('ghost_office', null, Date.now());
        const d = DB.get(); const savedStores = d.stores;
        d.stores = savedStores.filter(s => s.id !== 'head_office');                          // AGY-3: billed sender, row MISSING
        Sync._pricingFresh = false;
        const g = Transfer._pricingSubmitGate('head_office', 'cockburn');
        d.stores = savedStores;
        delete DB.get().pricingConfig;
        try { localStorage.removeItem('bob_pricing_activated'); localStorage.removeItem('bob_pricing_ver'); } catch (e) {}
        return { valOk: val.ok === true, unresAfterValidate, unresAfterArm, verAfterArm, applied, unresAfterFail, verAfterFail, fixErr: viaFixture.error, liveNotSet: viaLive.notSet === true, gateHold: g.hold || null, gateOk: g.ok === true };
      });
      rec('S-274', 'W42-C6/AGY-2/AGY-3(+R2-C4): validate never arms the hold; a FAILED restore write rolls back BOTH markers; SR-10 honours the caller topology; a billed head_office sender is gated with its row missing', r.valOk && r.unresAfterValidate === null && r.unresAfterArm === '1' && r.verAfterArm === null && r.applied === false && r.unresAfterFail === null && r.verAfterFail === '7' && r.fixErr === 'PRICING_DATA_ERROR' && r.liveNotSet === true && r.gateOk === false && r.gateHold === 'NO_FRESH_OBSERVATION', `valOk=${r.valOk} unresVal=${r.unresAfterValidate} unresArm=${r.unresAfterArm} verArm=${r.verAfterArm} applied=${r.applied} unresFail=${r.unresAfterFail} verFail=${r.verAfterFail} fix=${r.fixErr} live=${r.liveNotSet} gateHold=${r.gateHold}`); await ctx.close(); }

    // S-275 (OS-W42-AUDIT R2, Codex C1): LEADERSHIP LOSS invalidates pricing freshness — both real
    // production branches (the newer-leader heartbeat DEMOTION and the leader-exists STAND-DOWN). A
    // demoted tab stops pulling; its freshness fact must not outlive its leadership.
    { const { ctx, page } = await newPage(b); await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' })); await waitBoot(page, repo); await setup(page);
      const r = await page.evaluate(() => {
        try { localStorage.removeItem('bob_pricing_activated'); localStorage.removeItem('bob_pricing_stale'); localStorage.removeItem('bob_pricing_unresolved'); } catch (e) {}
        delete DB.get().pricingConfig;
        if (!Sync._bc) Sync._initLeaderElection();   // the harness boot skips election — create the REAL channel + handler
        Sync._isLeader = true; Sync._tabStartedAt = 1000; Sync._pricingFresh = true;
        Sync._bc.onmessage({ data: { type: 'heartbeat', tabId: 'zz_newer', startedAt: 999999999999999 } });   // the real MFL-011 demotion branch
        const demotedLeader = Sync._isLeader, demotedFresh = Sync._pricingFresh;
        const g1 = Pricing.commitGate('cockburn');
        Sync._pricingFresh = true; Sync._isLeader = false;
        Sync._bc.onmessage({ data: { type: 'leader-exists', tabId: 'other' } });                              // the stand-down branch
        const standDownFresh = Sync._pricingFresh;
        Sync._pricingFresh = false;
        return { demotedLeader, demotedFresh, g1hold: g1.hold || null, standDownFresh };
      });
      rec('S-275', 'W42-R2-C1: heartbeat demotion + leader-exists stand-down both invalidate freshness; the demoted tab holds HO->franchise commits', r.demotedLeader === false && r.demotedFresh === false && r.g1hold === 'NO_FRESH_OBSERVATION' && r.standDownFresh === false, `demotedLeader=${r.demotedLeader} demotedFresh=${r.demotedFresh} g1hold=${r.g1hold} standDownFresh=${r.standDownFresh}`); await ctx.close(); }




    } catch (e) { console.log(`  [SUITE-ABORT] a sentinel crashed the remainder of the run (expected under clean-boot mutations — results above are still valid): ${e && e.message}`); }
  } finally { await b.close(); }
  return out;
}

if (require.main === module) {
  const repo = process.argv[2] || DEFAULT_REPO;
  runSmoke(repo).then(out => {
    const ok = out.filter(o => o.cleanPass).length;
    console.log(`\n==== ${ok}/${out.length} sentinels PASS on clean code ====`);
    process.exit(ok === out.length ? 0 : 1);
  }).catch(e => { console.error('SMOKE ERROR:', e); process.exit(2); });
}

module.exports = { runSmoke };
