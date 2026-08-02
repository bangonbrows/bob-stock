const { chromium } = require('playwright');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appUrl = 'file://' + path.join(root, 'index.html').replace(/\\/g, '/');

async function newPage(browser, mode) {
  const page = await browser.newPage();
  let requests = { steps: 0, pull: 0, push: 0 };

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('r2steps.test')) requests.steps += 1;
    if (url.includes('r2pull.test')) requests.pull += 1;
    if (url.includes('r2push.test')) requests.push += 1;
  });

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('r2pull.test')) {
      if (mode === 'hold423') {
        return route.fulfill({
          status: 423,
          contentType: 'application/json',
          body: JSON.stringify({ topologyPending: true, items: [], policyVersion: 12, maxId: 9001, scope: ['forbidden'] })
        });
      }
      if (mode === 'bad503') {
        return route.fulfill({ status: 503, contentType: 'text/plain', body: '{not-json' });
      }
      if (mode === 'hold401') {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ topologyPending: true, items: [], policyVersion: 12, maxId: 9001, scope: ['forbidden'] })
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 0 }) });
    }
    if (url.includes('r2steps.test')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 4444 }) });
    }
    if (url.includes('r2push.test')) {
      if (mode === 'ambiguousPush') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', processedCount: 1 }) });
    }
    if (url.includes('logic.azure.com')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], maxId: 0 }) });
    }
    return route.continue();
  });

  await page.goto(appUrl, { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof DB !== 'undefined' && typeof Sync !== 'undefined' && typeof window.TransferUI !== 'undefined' && !!DB.get(),
    { timeout: 20000 }
  );
  return { page, requests };
}

async function resetSync(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    Sync._pullUrl = 'https://r2pull.test/pull';
    Sync._stepsPullUrl = 'https://r2steps.test/steps';
    Sync._pushUrl = 'https://r2push.test/push';
    Sync._stepsPushUrl = 'https://r2push.test/stepsPush';
    Sync._isLeader = true;
    Sync._syncLock = false;
    Sync._stepSyncLock = false;
    Sync._skipLockRelease = false;
    Sync._topologyHold = false;
    Sync._scopePurgePending = false;
    Sync._unauthorized = false;
    Sync._markRetryTimer = null;
    Sync._syncRetryTimer = null;
    Sync._lastSyncId = 17;
    Sync._lastStepSyncId = 33;
    localStorage.setItem('bob_last_sp_id', '17');
    localStorage.setItem('bob_last_step_sp_id', '33');
  });
}

async function probeNon2xxHold(browser) {
  const { page, requests } = await newPage(browser, 'hold423');
  await resetSync(page);
  const result = await page.evaluate(async () => {
    await Sync.poll();
    return {
      hold: Sync._topologyHold,
      unauthorized: Sync._unauthorized,
      ledgerCursor: Sync._lastSyncId,
      storedLedger: localStorage.getItem('bob_last_sp_id'),
      stepCursor: Sync._lastStepSyncId,
      storedStep: localStorage.getItem('bob_last_step_sp_id'),
      status: document.getElementById('status')?.textContent || ''
    };
  });
  await page.close();
  return { name: 'non2xx_hold_freezes_cursors_and_steps', requests, result };
}

async function probeMalformedNon2xx(browser) {
  const { page, requests } = await newPage(browser, 'bad503');
  await resetSync(page);
  const result = await page.evaluate(async () => {
    await Sync.poll();
    return {
      hold: Sync._topologyHold,
      unauthorized: Sync._unauthorized,
      ledgerCursor: Sync._lastSyncId,
      stepCursor: Sync._lastStepSyncId,
      storedStep: localStorage.getItem('bob_last_step_sp_id'),
      status: document.getElementById('status')?.textContent || ''
    };
  });
  await page.close();
  return { name: 'malformed_non2xx_body_does_not_throw_or_hold', requests, result };
}

async function probe401HoldBody(browser) {
  const { page, requests } = await newPage(browser, 'hold401');
  await resetSync(page);
  const result = await page.evaluate(async () => {
    await Sync.poll();
    return {
      hold: Sync._topologyHold,
      unauthorized: Sync._unauthorized,
      ledgerCursor: Sync._lastSyncId,
      stepCursor: Sync._lastStepSyncId,
      storedStep: localStorage.getItem('bob_last_step_sp_id'),
      status: document.getElementById('status')?.textContent || ''
    };
  });
  await page.close();
  return { name: '401_hold_body_auth_takes_precedence', requests, result };
}

async function probeNestedAmbiguous(browser) {
  const { page, requests } = await newPage(browser, 'ambiguousPush');
  await resetSync(page);
  const result = await page.evaluate(async () => {
    const d = DB.get();
    const store = d.stores.find(s => s.active && s.type !== 'warehouse') || d.stores[0];
    const product = d.products.find(p => p.active) || d.products[0];
    const id = 'r2amb_' + Date.now();
    await DB.addTransactionDurable({
      id,
      storeId: store.id,
      productId: product.id,
      type: 'in',
      qty: 1,
      date: '2026-07-13',
      createdAt: new Date().toISOString(),
      _synced: false
    });
    Sync._markRetryTimer = null;
    Sync._syncRetryTimer = null;
    Sync._syncLock = true;
    await Sync.push(false, true);
    const row = DB.get().transactions.find(t => t.id === id);
    return {
      lockHeld: Sync._syncLock === true,
      noMarkRetryTimer: !Sync._markRetryTimer,
      noSyncRetryTimer: !Sync._syncRetryTimer,
      rowKeptPending: !!row && row._synced !== true,
      pendingFlag: localStorage.getItem('bob_sync_pending')
    };
  });
  await page.close();
  return { name: 'nested_ambiguous_push_no_timer_lock_untouched', requests, result };
}

async function probeThresholdRearm(browser) {
  const { page, requests } = await newPage(browser, 'normal');
  await resetSync(page);
  const result = await page.evaluate(async () => {
    const d = DB.get();
    const productId = (d.products && d.products[0] && d.products[0].id) || 'BDW_1';
    d.transactions = [];
    d.deletedTransactions = [];
    d.stockTakes = [];
    d.deliveries = [];
    d.transfers = [];
    d.recordSteps = [];
    d.thresholds = [];
    await DB.commitDurable();
    localStorage.setItem('bob_scope_sig', JSON.stringify(['karrinyup']));
    localStorage.removeItem('bob_scope_purge_pending');
    Sync._scopePurgePending = false;
    d.thresholds.push({ storeId: 'whitford', productId, minQty: 5 });
    const ok = await DB.commitDurable();
    await new Promise(resolve => setTimeout(resolve, 50));
    return {
      ok,
      sig: localStorage.getItem('bob_scope_sig'),
      lock: localStorage.getItem('bob_scope_purge_pending'),
      syncPending: Sync._scopePurgePending,
      detector: DB.hasOutOfScopeRows(['karrinyup']),
      thresholdStores: DB.get().thresholds.map(t => t.storeId)
    };
  });
  await page.close();
  return { name: 'threshold_commit_rearms_scope', requests, result };
}

async function main() {
  const browser = await chromium.launch();
  try {
    const probes = [];
    probes.push(await probeNon2xxHold(browser));
    probes.push(await probeMalformedNon2xx(browser));
    probes.push(await probe401HoldBody(browser));
    probes.push(await probeNestedAmbiguous(browser));
    probes.push(await probeThresholdRearm(browser));
    console.log(JSON.stringify({ probes }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
