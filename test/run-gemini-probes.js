const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const repo = path.resolve(__dirname, '..');
const url = 'file:///' + repo.replace(/\\/g, '/') + '/index.html';
const outDir = path.join(repo, 'audit-artifacts', '2026-06-10-Gemini-WaveF4');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function waitBoot(page) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof DB !== 'undefined' && typeof Sync !== 'undefined' && typeof window.TransferUI !== 'undefined', { timeout: 20000 });
  await page.waitForTimeout(1200);
}

async function setup(page) {
  return page.evaluate(() => {
    const d = DB.get();
    const u = (d.users || []).find(x => x.role === 'director') || d.users[0];
    if (u) Auth._user = u;
    const store = d.stores.find(s => s.active && s.type !== 'warehouse');
    const prod = d.products.find(p => p.active);
    if (!store || !prod) throw new Error('SETUP-INVARIANT VIOLATED');
    return { storeId: store.id, productId: prod.id };
  });
}

async function runProbes() {
  const b = await chromium.launch({ headless: true });
  
  // ==========================================
  // PROBE 1: Receive Discrepancy & Resolution
  // ==========================================
  console.log("Running Probe 1: Receive Discrepancy & Resolution");
  const ctx1 = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page1 = await ctx1.newPage();
  await page1.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
  await waitBoot(page1);
  const s1 = await setup(page1);
  const result1 = await page1.evaluate(async (s) => {
    const d = DB.get();
    const staff1 = d.users.find(u => u.storeId === s.storeId && u.role === 'staff') || d.users[0];
    const store2 = d.stores.find(st => st.active && st.id !== s.storeId && st.type !== 'warehouse') || d.stores[0];
    const staff2 = d.users.find(u => u.storeId === store2.id && u.role === 'staff') || d.users[0];
    const dir = d.users.find(u => u.role === 'director') || d.users[0];

    // Seed stock
    Auth._user = dir;
    await DB.addTransactionDurable({ id: 'p1_1', type: 'in', qty: 20, storeId: s.storeId, productId: s.productId, date: '2026-06-10', createdAt: new Date().toISOString() });
    await new Promise(r => setTimeout(r, 100));

    // Create Transfer
    Auth._user = staff1;
    window._txState.createFrom = s.storeId;
    window._txState.createTo = store2.id;
    window._txState.createType = 'normal';
    window._txState.createItems = { [s.productId]: 10 };
    UI.confirm = (a, b, c) => { const cb = typeof b === 'function' ? b : (typeof c === 'function' ? c : null); if(cb) cb(); };
    await TransferUI.submitCreate();
    await new Promise(r => setTimeout(r, 200));

    const transfers = await bobDB.transfers.toArray();
    const t = transfers[transfers.length - 1];

    if (t.status === 'draft') {
      TransferUI.openDetail(t.id);
      window._txState.draftConfirmed[s.productId] = true;
      await TransferUI.submitDraft(t.id);
      await new Promise(r => setTimeout(r, 200));
    }

    // Receive partial
    Auth._user = staff2;
    Auth.storeIds = () => [store2.id];
    TransferUI.openDetail(t.id);
    window._txState.receiveQtys[s.productId] = 7;
    TransferUI.toggleMatch(t.id, s.productId);
    await TransferUI.submitReceive(t.id);
    await new Promise(r => setTimeout(r, 300));
    const stockAfterRecv = Stock.qty(s.productId, store2.id);

    // Resolve flags (adjust)
    Auth._user = dir;
    TransferUI.openDetail(t.id);
    TransferUI.setFlagAction(t.id, s.productId, 'adjust');
    window._txState.flagActions[s.productId].qty = 9;
    await TransferUI.completeFlags(t.id);
    await new Promise(r => setTimeout(r, 300));

    return {
      test: 'Receive workflow with discrepancy and adjust',
      receivedCredit: stockAfterRecv, 
      finalSenderStock: Stock.qty(s.productId, s.storeId), 
      finalReceiverStock: Stock.qty(s.productId, store2.id),
      finalTransferStatus: (await bobDB.transfers.get(t.id)).status
    };
  }, s1);
  fs.writeFileSync(path.join(outDir, 'probe-01-receive-discrepancy.json'), JSON.stringify(result1, null, 2));
  await ctx1.close();

  // ==========================================
  // PROBE 2: Legacy Transit Void backwards-compatibility
  // ==========================================
  console.log("Running Probe 2: Legacy Transfer Compatibility");
  const ctx2 = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page2 = await ctx2.newPage();
  await page2.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
  await waitBoot(page2);
  const s2 = await setup(page2);
  const result2 = await page2.evaluate(async (s) => {
    const d = DB.get();
    const store2 = d.stores.find(st => st.active && st.id !== s.storeId && st.type !== 'warehouse') || d.stores[0];
    const dir = d.users.find(u => u.role === 'director') || d.users[0];

    // Seed stock & manually construct a legacy flagged transfer (no creditedAtReceive)
    Auth._user = dir;
    await DB.addTransactionDurable({ id: 'p2_1', type: 'in', qty: 10, storeId: s.storeId, productId: s.productId, date: '2026-06-10', createdAt: new Date().toISOString() });
    
    const tId = 'legacy_' + Date.now();
    const legacyTransfer = {
      id: tId, status: 'received', fromStoreId: s.storeId, toStoreId: store2.id,
      items: [{ productId: s.productId, sentQty: 5, receivedQty: 2, status: 'flagged' }],
      createdAt: new Date().toISOString(), type: 'normal'
    };
    await bobDB.transfers.put(legacyTransfer);
    d.transfers.push(legacyTransfer);
    await new Promise(r => setTimeout(r, 100));

    // Resolve as accept_as_is
    TransferUI.openDetail(tId);
    TransferUI.setFlagAction(tId, s.productId, 'accept_as_is');
    UI.confirm = (a, b, c) => { const cb = typeof b === 'function' ? b : (typeof c === 'function' ? c : null); if(cb) cb(); };
    await TransferUI.completeFlags(tId);
    await new Promise(r => setTimeout(r, 300));

    return {
      test: 'Legacy transfer resolve backwards compatibility',
      senderStock: Stock.qty(s.productId, s.storeId), 
      receiverStock: Stock.qty(s.productId, store2.id),
      expectedSender: 10 - 5 + 3, // Sender gets 3 back
      expectedReceiver: 2 // Receiver gets the 2 credited now
    };
  }, s2);
  fs.writeFileSync(path.join(outDir, 'probe-02-legacy-transfer.json'), JSON.stringify(result2, null, 2));
  await ctx2.close();

  // ==========================================
  // PROBE 3: Master Data prototypes & merge
  // ==========================================
  console.log("Running Probe 3: Master Data Pollution & Validation");
  const ctx3 = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page3 = await ctx3.newPage();
  
  await page3.route('**logic.azure.com**', r => {
    const isPush = (r.request().postData() || '').includes('"transactions"');
    if (isPush) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    
    // Config Pull
    const rawMasterData = '{"version":999,"products":[{"id":"p_proto_test","name":"Pollutor","catId":"cat_trd","price":10.999,"active":true,"__proto__":{"polluted":true}}]}';
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        {
          ConfigType: "sync_config",
          ConfigData: { pushUrl: "https://x.logic.azure.com/push", pullUrl: "https://x.logic.azure.com/pull" }
        },
        {
          ConfigType: "master_data",
          ConfigData: rawMasterData
        }
      ]
    }) });
  });

  await waitBoot(page3);
  const result3 = await page3.evaluate(async () => {
    Sync._configUrl = 'https://x.logic.azure.com/config';
    await Sync._fetchRemoteConfig();
    await new Promise(r => setTimeout(r, 200));

    const dbProducts = await bobDB.products.toArray();
    const testProduct = dbProducts.find(p => p.id === 'p_proto_test');
    
    return {
      test: 'Master data proto-pollution and price normalization',
      productAdded: !!testProduct,
      normalizedPrice: testProduct ? testProduct.price : null,
      pollutedObj: typeof ({}).polluted,
      hasProtoKey: testProduct && Object.keys(testProduct).includes('__proto__')
    };
  });
  fs.writeFileSync(path.join(outDir, 'probe-03-master-data-proto.json'), JSON.stringify(result3, null, 2));
  await ctx3.close();

  // ==========================================
  // PROBE 4: Offline -> Online Sync Idempotency 
  // ==========================================
  console.log("Running Probe 4: Offline -> Online Sync Idempotency");
  const ctx4 = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page4 = await ctx4.newPage();
  
  let pushCounter = 0;
  await page4.route('**logic.azure.com**', r => {
    const isPush = (r.request().postData() || '').includes('"transactions"');
    if (isPush) {
      pushCounter++;
      if (pushCounter === 1) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}'}); // First fails
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","processedCount":1}'}); // Second succeeds
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' });
  });
  
  await waitBoot(page4);
  const s4 = await setup(page4);
  const result4 = await page4.evaluate(async (s) => {
    Sync._pushUrl = 'https://x.logic.azure.com/push';
    Sync._syncLock = false;
    
    const id = 'p4_' + Date.now();
    await DB.addTransactionDurable({ id, type: 'in', qty: 5, storeId: s.storeId, productId: s.productId, date: '2026-06-10', createdAt: new Date().toISOString() });
    
    // First push (fails)
    await Sync.push();
    const tAfterFail = DB.get().transactions.find(x => x.id === id);
    const syncedAfterFail = tAfterFail ? tAfterFail._synced : null;

    // Second push (succeeds)
    await Sync.push();
    const tAfterSuccess = DB.get().transactions.find(x => x.id === id);
    const syncedAfterSuccess = tAfterSuccess ? tAfterSuccess._synced : null;

    return {
      test: 'Offline/Online Sync Retry',
      syncedAfterFail,
      syncedAfterSuccess,
    };
  }, s4);
  result4.pushCounter = pushCounter;
  fs.writeFileSync(path.join(outDir, 'probe-04-offline-recovery.json'), JSON.stringify(result4, null, 2));
  await ctx4.close();

  console.log("All probes completed!");
  await b.close();
}

runProbes().catch(e => {
  console.error(e);
  process.exit(1);
});