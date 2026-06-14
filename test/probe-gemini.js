const { chromium } = require('playwright');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const url = 'file:///' + repo.replace(/\\/g, '/') + '/index.html';

async function run() {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
  
  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'load' });
  
  console.log('Waiting for boot...');
  await page.waitForFunction(() => typeof DB !== 'undefined' && typeof Sync !== 'undefined' && typeof window.TransferUI !== 'undefined', { timeout: 20000 });
  await page.waitForTimeout(1200);
  
  console.log('Boot successful, setting up...');
  const s = await page.evaluate(() => {
    const d = DB.get(); 
    const u = (d.users || []).find(x => x.role === 'director') || d.users[0]; 
    if (u) Auth._user = u; 
    const store = d.stores.find(s => s.active && s.type !== 'warehouse'); 
    const prod = d.products.find(p => p.active); 
    if (!store || !prod) throw new Error('SETUP-INVARIANT VIOLATED'); 
    return { storeId: store.id, productId: prod.id }; 
  });

  console.log('Running probe logic...');
  const result = await page.evaluate(async (s) => {
    const log = [];
    try {
      // 1. Staff 1 transfers 5 units to Store 2
      const d = DB.get();
      const staff1 = d.users.find(u => u.storeId === s.storeId && u.role === 'staff') || d.users[0];
      const store2 = d.stores.find(st => st.active && st.id !== s.storeId && st.type !== 'warehouse') || d.stores[0];
      const staff2 = d.users.find(u => u.storeId === store2.id && u.role === 'staff') || d.users[0];
      const dir = d.users.find(u => u.role === 'director') || d.users[0];

      // seed stock
      Auth._user = dir;
      await DB.addTransactionDurable({ id: 'seed1_' + Date.now(), type: 'in', qty: 10, storeId: s.storeId, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString() });
      await DB.addTransactionDurable({ id: 'seed2_' + Date.now(), type: 'in', qty: 10, storeId: store2.id, productId: s.productId, date: '2026-06-03', createdAt: new Date().toISOString() });
      await new Promise(r => setTimeout(r, 100)); // wait for cache

      let s1 = Stock.qty(s.productId, s.storeId);
      let s2 = Stock.qty(s.productId, store2.id);
      log.push(`Initial stock: S1=${s1}, S2=${s2}`);

      Auth._user = staff1;
      window._txState.createFrom = s.storeId;
      window._txState.createTo = store2.id;
      window._txState.createType = 'normal';
      window._txState.createItems = { [s.productId]: 5 };
      
      UI.confirm = (a, b, c) => { const cb = (typeof b === 'function') ? b : (typeof c === 'function' ? c : null); if (cb) return cb(); };
      await TransferUI.submitCreate();
      await new Promise(r => setTimeout(r, 400));

      s1 = Stock.qty(s.productId, s.storeId);
      log.push(`After transfer out (5 sent): S1=${s1}`);

      const transfers = await bobDB.transfers.toArray();
      const t = transfers[transfers.length - 1];
      if (!t) throw new Error('Transfer not created!');

      // Submit Draft (submitCreate usually creates a draft that needs to be submitted)
      if (t.status === 'draft') {
        TransferUI.openDetail(t.id);
        window._txState.draftConfirmed[s.productId] = true;
        await TransferUI.submitDraft(t.id);
        await new Promise(r => setTimeout(r, 400));
        const t2 = await bobDB.transfers.get(t.id);
        log.push(`Transfer submitted from draft to: ${t2.status}`);
      }

      // 2. Staff 2 receives 3
      Auth._user = staff2;
      Auth.storeIds = () => [store2.id];
      TransferUI.openDetail(t.id);
      window._txState.receiveQtys[s.productId] = 3;
      TransferUI.toggleMatch(t.id, s.productId);
      
      UI.confirm = (a, b, c) => { const cb = (typeof b === 'function') ? b : (typeof c === 'function' ? c : null); if (cb) return cb(); };
      await TransferUI.submitReceive(t.id);
      await new Promise(r => setTimeout(r, 400));

      s2 = Stock.qty(s.productId, store2.id);
      log.push(`After receiving 3 (flagged): S2=${s2} (Expected ${10 + 3})`);
      
      const updatedT = await bobDB.transfers.get(t.id);
      log.push(`Transfer status after receive: ${updatedT.status}`);

      // 3. Director resolves the discrepancy
      Auth._user = dir;
      TransferUI.openDetail(t.id);
      TransferUI.setFlagAction(t.id, s.productId, 'accept_as_is');
      await TransferUI.completeFlags(t.id);
      await new Promise(r => setTimeout(r, 400));

      s1 = Stock.qty(s.productId, s.storeId);
      s2 = Stock.qty(s.productId, store2.id);
      log.push(`After director resolution: S1=${s1}, S2=${s2}`);

      const finalT = await bobDB.transfers.get(t.id);
      log.push(`Transfer final status: ${finalT.status}`);

      return { success: true, log };
    } catch (err) {
      return { success: false, error: err.message, log };
    }
  }, s);

  console.log('Result:', result);
  console.log('Errors:', errors);
  await b.close();
}

run().catch(console.error);