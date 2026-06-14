const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const repo = path.resolve(__dirname, '..');
const url = 'file:///' + repo.replace(/\\/g, '/') + '/index.html';
const outDir = path.join(repo, 'audit-artifacts', '2026-06-11-Gemini-WaveF5');

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

  // ----------------------------------------------------
  // PROBE 1: Legacy Transfer Discrepancy & Credit-at-Receive
  // ----------------------------------------------------
  console.log("Running Probe 1: Workflow - Legacy + Credit-at-Receive Discrepancy");
  const ctx1 = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page1 = await ctx1.newPage();
  await page1.route('**logic.azure.com**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
  await waitBoot(page1);
  const s1 = await setup(page1);
  const result1 = await page1.evaluate(async (s) => {
    const dir = DB.get().users.find(u => u.role === 'director') || DB.get().users[0];
    const store2 = DB.get().stores.find(st => st.active && st.id !== s.storeId && st.type !== 'warehouse') || DB.get().stores[0];
    
    // Seed
    Auth._user = dir;
    await DB.addTransactionDurable({ id: 'p1_seed1', type: 'in', qty: 50, storeId: s.storeId, productId: s.productId, date: new Date().toISOString(), createdAt: new Date().toISOString() });
    
    const initialStore1 = Stock.qty(s.productId, s.storeId);
    const initialStore2 = Stock.qty(s.productId, store2.id);

    // Create a legacy flagged transfer (no creditedAtReceive field) directly into DB
    const legacyTId = 'legacy_' + Date.now();
    const legacyTransfer = {
      id: legacyTId, status: 'received', fromStoreId: s.storeId, toStoreId: store2.id,
      items: [{ productId: s.productId, sentQty: 10, receivedQty: 6, status: 'flagged' }],
      createdAt: new Date().toISOString(), type: 'normal'
    };
    await bobDB.transfers.put(legacyTransfer);
    DB.get().transfers.push(legacyTransfer);
    
    // Resolve legacy transfer
    TransferUI.openDetail(legacyTId);
    TransferUI.setFlagAction(legacyTId, s.productId, 'accept_as_is');
    UI.confirm = (a, b, c) => { const cb = typeof b === 'function' ? b : (typeof c === 'function' ? c : null); if(cb) cb(); };
    await TransferUI.completeFlags(legacyTId);
    await new Promise(r => setTimeout(r, 400));
    
    const postLegacyStore1 = Stock.qty(s.productId, s.storeId);
    const postLegacyStore2 = Stock.qty(s.productId, store2.id);

    return {
      test: 'Legacy transfer resolve backwards compatibility',
      initialStore1, initialStore2,
      postLegacyStore1, postLegacyStore2,
      expectedStore1Drop: 10 - 4, // sent 10, but 4 accepted as lost, so effectively dropped by 10 then got 4 returned? Wait, sent 10, received 6. The 4 are returned to sender. So drop is 10-4=6.
      expectedStore2Rise: 6 // 6 were received and legacy resolution applies them
    };
  }, s1);
  fs.writeFileSync(path.join(outDir, 'probe-01-legacy-transfer.json'), JSON.stringify(result1, null, 2));
  await ctx1.close();

  // ----------------------------------------------------
  // PROBE 2: Push Egress Hostile Row Skip (S-52 logic)
  // ----------------------------------------------------
  console.log("Running Probe 2: Push Egress Hostile Row Skip");
  const ctx2 = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page2 = await ctx2.newPage();
  
  let pushedTransactions = [];
  await page2.route('**logic.azure.com/push**', async r => {
    try {
      const data = JSON.parse(r.request().postData() || '{}');
      if (data.transactions) pushedTransactions = pushedTransactions.concat(data.transactions);
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","processedCount":1}' });
    } catch(e) {
      await r.fulfill({ status: 500 });
    }
  });
  await page2.route('**logic.azure.com/pull**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
  await page2.route('**logic.azure.com/config**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","items":[]}' }));

  await waitBoot(page2);
  const s2 = await setup(page2);
  const result2 = await page2.evaluate(async (s) => {
    // Inject a hostile transaction directly into IndexedDB, bypassing DB.addTransactionDurable
    const hostileId = 'hostile_1';
    const hostileTxn = {
      id: hostileId, type: 'in', qty: '5e2', storeId: s.storeId, productId: s.productId, date: new Date().toISOString(), createdAt: new Date().toISOString(), _synced: false
    };
    const validId = 'valid_1';
    const validTxn = {
      id: validId, type: 'in', qty: 5, storeId: s.storeId, productId: s.productId, date: new Date().toISOString(), createdAt: new Date().toISOString(), _synced: false
    };
    
    await bobDB.transactions.bulkPut([hostileTxn, validTxn]);
    await DB.refresh(); // Load them into memory
    
    Sync._pushUrl = 'https://x.logic.azure.com/push';
    Sync._syncLock = false;
    await Sync.push();
    await new Promise(r => setTimeout(r, 400));
    
    return {
      test: 'Push Egress Hostile Row Skip',
      hostileInDB: !!DB.get().transactions.find(x => x.id === hostileId),
      validInDB: !!DB.get().transactions.find(x => x.id === validId),
      hostileSyncedStatus: (await bobDB.transactions.get(hostileId))._synced,
      validSyncedStatus: (await bobDB.transactions.get(validId))._synced
    };
  }, s2);
  result2.pushedTransactionsSent = pushedTransactions.map(t => ({ id: t.TransactionId, qty: t.Qty }));
  fs.writeFileSync(path.join(outDir, 'probe-02-push-egress.json'), JSON.stringify(result2, null, 2));
  await ctx2.close();

  // ----------------------------------------------------
  // PROBE 3: Quarantined Invalid Rows from Pull (S-51 logic)
  // ----------------------------------------------------
  console.log("Running Probe 3: Quarantine Invalid Rows Pull");
  const ctx3 = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page3 = await ctx3.newPage();
  
  await page3.route('**logic.azure.com/pull**', r => {
    const rawPullItems = [
      { TransactionId: 'pull_valid', StoreId: '1', ProductId: 'p1', Type: 'in', Qty: 10, Date: new Date().toISOString(), CreatedAt: new Date().toISOString() },
      { TransactionId: 'pull_hostile1', StoreId: '1', ProductId: 'p1', Type: 'in', Qty: "0x10", Date: new Date().toISOString(), CreatedAt: new Date().toISOString() },
      { TransactionId: 'pull_hostile2', StoreId: '1', ProductId: 'p1', Type: 'in', Qty: "5e2", Date: new Date().toISOString(), CreatedAt: new Date().toISOString() }
    ];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok:true, items: rawPullItems, serverTimestamp: 8888 }) });
  });
  await page3.route('**logic.azure.com/push**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","processedCount":0}' }));
  await page3.route('**logic.azure.com/config**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","items":[]}' }));

  await waitBoot(page3);
  const result3 = await page3.evaluate(async () => {
    Sync._pullUrl = 'https://x.logic.azure.com/pull';
    Sync._syncLock = false;
    await Sync.pull();
    await new Promise(r => setTimeout(r, 400));
    
    const txns = DB.get().transactions;

    return {
      test: 'Quarantine Hostile Pull Rows',
      validPulled: !!txns.find(t => t.id === 'pull_valid'),
      hostile1InTxns: !!txns.find(t => t.id === 'pull_hostile1'),
      hostile2InTxns: !!txns.find(t => t.id === 'pull_hostile2')
    };
  });
  fs.writeFileSync(path.join(outDir, 'probe-03-pull-quarantine.json'), JSON.stringify(result3, null, 2));
  await ctx3.close();

  // ----------------------------------------------------
  // PROBE 4: Master Data Mid-Shift Push & Proto-Pollution check
  // ----------------------------------------------------
  console.log("Running Probe 4: Master Data Mid-Shift");
  const ctx4 = await b.newContext({ timezoneId: 'Australia/Perth' });
  const page4 = await ctx4.newPage();

  await page4.route('**logic.azure.com**', r => {
    const rawMasterData = '{"version":999,"products":[{"id":"p_proto_test","name":"Pollutor","catId":"cat_trd","price":10.999,"active":true,"__proto__":{"polluted":true}}]}';
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { ConfigType: "sync_config", ConfigData: { pushUrl: "https://x.logic.azure.com/push", pullUrl: "https://x.logic.azure.com/pull" } },
        { ConfigType: "master_data", ConfigData: rawMasterData }
      ]
    }) });
  });

  await waitBoot(page4);
  const result4 = await page4.evaluate(async () => {
    Sync._configUrl = 'https://x.logic.azure.com/config';
    await Sync._fetchRemoteConfig();
    await new Promise(r => setTimeout(r, 400));

    const dbProducts = await bobDB.products.toArray();
    const testProduct = dbProducts.find(p => p.id === 'p_proto_test');

    return {
      test: 'Master data proto-pollution and mid-shift update',
      productAdded: !!testProduct,
      normalizedPrice: testProduct ? testProduct.price : null,
      pollutedObj: typeof ({}).polluted,
      hasProtoKey: testProduct && Object.keys(testProduct).includes('__proto__')
    };
  });
  fs.writeFileSync(path.join(outDir, 'probe-04-master-data.json'), JSON.stringify(result4, null, 2));
  await ctx4.close();

  console.log("All probes completed!");
  await b.close();
}

runProbes().catch(e => {
  console.error(e);
  process.exit(1);
});