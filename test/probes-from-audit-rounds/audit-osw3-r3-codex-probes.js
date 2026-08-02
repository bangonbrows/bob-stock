const { chromium } = require('playwright');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appUrl = 'file://' + path.join(root, 'index.html').replace(/\\/g, '/');

async function boot(browser, mode) {
  const page = await browser.newPage();
  const hits = { config: 0, pull: 0, push: 0, stepsPull: 0, stepsPush: 0 };

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('r3config.test')) {
      hits.config++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            ConfigType: 'sync_config',
            ConfigData: {
              pushUrl: 'https://r3push.test/push',
              pullUrl: 'https://r3pull.test/pull',
              stepsPushUrl: 'https://r3stepspush.test/push',
              stepsPullUrl: 'https://r3stepspull.test/pull'
            }
          }]
        })
      });
    }
    if (url.includes('r3pull.test')) {
      hits.pull++;
      if (mode === 'ledger401') {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ topologyPending: true, policyVersion: 12, maxId: 9001, scope: ['forbidden'] })
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 17 }) });
    }
    if (url.includes('r3stepspull.test')) {
      hits.stepsPull++;
      if (mode === 'stepsPull401') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"status":"unauthorized"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], maxId: 4444 }) });
    }
    if (url.includes('r3push.test')) {
      hits.push++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', processedCount: 1 }) });
    }
    if (url.includes('r3stepspush.test')) {
      hits.stepsPush++;
      if (mode === 'stepsPush401') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"status":"unauthorized"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ['r3step'], rejected: [], failed: [] }) });
    }
    if (url.includes('logic.azure.com')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], maxId: 0 }) });
    }
    return route.continue();
  });

  await page.goto(appUrl, { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof DB !== 'undefined' && typeof Sync !== 'undefined' && typeof Records !== 'undefined' && !!DB.get(),
    { timeout: 20000 }
  );
  return { page, hits };
}

async function reset(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    Sync.CONFIG_URL = 'https://r3config.test/config';
    Sync._pushUrl = 'https://r3push.test/push';
    Sync._pullUrl = 'https://r3pull.test/pull';
    Sync._stepsPushUrl = 'https://r3stepspush.test/push';
    Sync._stepsPullUrl = 'https://r3stepspull.test/pull';
    Sync._isLeader = true;
    Sync._syncLock = false;
    Sync._syncing = false;
    Sync._syncQueued = false;
    Sync._unauthorized = false;
    Sync._topologyHold = false;
    Sync._scopePurgePending = false;
    Sync._lastSyncId = 17;
    Sync._lastStepSyncId = 33;
    localStorage.setItem('bob_last_sp_id', '17');
    localStorage.setItem('bob_last_step_sp_id', '33');
    Sync._setPending(false);
    Sync._setStepPending(false);
  });
}

async function seedLedgerAndStep(page) {
  return page.evaluate(async () => {
    const d = DB.get();
    const store = d.stores.find(s => s.active && s.type !== 'warehouse') || d.stores[0];
    const product = d.products.find(p => p.active) || d.products[0];
    const txnId = 'r3txn_' + Date.now();
    await DB.addTransactionDurable({
      id: txnId,
      storeId: store.id,
      productId: product.id,
      type: 'in',
      qty: 1,
      date: '2026-07-13',
      createdAt: new Date().toISOString(),
      _synced: false
    });
    await DB.markTransactionsSynced(new Set([txnId]));
    const step = {
      stepId: 'r3step',
      recordType: 'stocktake',
      recordId: 'r3rec',
      stepType: 'approve',
      seq: 10,
      ownerStoreId: store.id,
      status: 'approved',
      timestamp: Date.now(),
      payload: { expectedLedgerKeys: [txnId] },
      _synced: false
    };
    await DB.addStepDurable(step);
    Sync._setPending(true);
    Sync._setStepPending(true);
    return { txnId, stepId: step.stepId };
  });
}

async function probeLedger401PollGatesEverything(browser) {
  const { page, hits } = await boot(browser, 'ledger401');
  await reset(page);
  await seedLedgerAndStep(page);
  const result = await page.evaluate(async () => {
    await Sync.poll();
    return {
      unauthorized: Sync._unauthorized,
      hold: Sync._topologyHold,
      ledgerCursor: Sync._lastSyncId,
      stepCursor: Sync._lastStepSyncId,
      storedStep: localStorage.getItem('bob_last_step_sp_id'),
      pending: Sync._getPending(),
      stepPending: Sync._getStepPending()
    };
  });
  await page.close();
  return { name: 'ledger_401_poll_gates_steps_and_pending_drains', hits, result };
}

async function probePrePausedPollNoFetch(browser) {
  const { page, hits } = await boot(browser, 'normal');
  await reset(page);
  await seedLedgerAndStep(page);
  const result = await page.evaluate(async () => {
    Sync._unauthorized = true;
    await Sync.poll();
    return {
      unauthorized: Sync._unauthorized,
      ledgerCursor: Sync._lastSyncId,
      stepCursor: Sync._lastStepSyncId,
      pending: Sync._getPending(),
      stepPending: Sync._getStepPending()
    };
  });
  await page.close();
  return { name: 'prepaused_poll_makes_no_network_progress', hits, result };
}

async function probeStepPull401BlocksLaterDrains(browser) {
  const { page, hits } = await boot(browser, 'stepsPull401');
  await reset(page);
  await seedLedgerAndStep(page);
  const result = await page.evaluate(async () => {
    await Sync.poll();
    return {
      unauthorized: Sync._unauthorized,
      ledgerCursor: Sync._lastSyncId,
      stepCursor: Sync._lastStepSyncId,
      storedStep: localStorage.getItem('bob_last_step_sp_id'),
      pending: Sync._getPending(),
      stepPending: Sync._getStepPending()
    };
  });
  await page.close();
  return { name: 'steps_pull_401_blocks_poll_drains', hits, result };
}

async function probeStepPush401ThenPausedPoll(browser) {
  const { page, hits } = await boot(browser, 'stepsPush401');
  await reset(page);
  await seedLedgerAndStep(page);
  const result = await page.evaluate(async () => {
    Sync._setPending(false);
    Sync._setStepPending(true);
    await Sync.pushSteps();
    const afterPushSteps = {
      unauthorized: Sync._unauthorized,
      stepPending: Sync._getStepPending(),
      stepCursor: Sync._lastStepSyncId
    };
    await Sync.poll();
    return {
      afterPushSteps,
      afterPoll: {
        unauthorized: Sync._unauthorized,
        stepCursor: Sync._lastStepSyncId,
        stepPending: Sync._getStepPending()
      }
    };
  });
  await page.close();
  return { name: 'steps_push_401_pauses_then_poll_stays_paused', hits, result };
}

async function probeReauthResumesOrdering(browser) {
  const { page, hits } = await boot(browser, 'normal');
  await reset(page);
  await seedLedgerAndStep(page);
  const result = await page.evaluate(async () => {
    Sync.DEBOUNCE_MS = 10;
    Sync._unauthorized = true;
    const blocked = await Sync._runSyncCycle();
    const before = {
      blocked,
      unauthorized: Sync._unauthorized,
      pending: Sync._getPending(),
      stepPending: Sync._getStepPending()
    };
    const ok = await Sync.saveAuthKeys('karrinyup', 'bsk_r3', 'bdk_r3');
    await new Promise(resolve => setTimeout(resolve, 250));
    const step = DB.get().recordSteps.find(s => s.stepId === 'r3step');
    return {
      before,
      ok,
      unauthorized: Sync._unauthorized,
      pending: Sync._getPending(),
      stepPending: Sync._getStepPending(),
      stepSynced: step ? step._synced === true : false,
      ledgerCursor: Sync._lastSyncId,
      stepCursor: Sync._lastStepSyncId
    };
  });
  await page.close();
  return { name: 'reauth_clears_pause_and_resumes_ordered_drain', hits, result };
}

async function main() {
  const browser = await chromium.launch();
  try {
    const probes = [];
    probes.push(await probeLedger401PollGatesEverything(browser));
    probes.push(await probePrePausedPollNoFetch(browser));
    probes.push(await probeStepPull401BlocksLaterDrains(browser));
    probes.push(await probeStepPush401ThenPausedPoll(browser));
    probes.push(await probeReauthResumesOrdering(browser));
    console.log(JSON.stringify({ probes }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
