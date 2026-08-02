const { chromium } = require('playwright');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appUrl = 'file://' + path.join(root, 'index.html').replace(/\\/g, '/');

async function bootPage(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('PAGEERROR', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('CONSOLE', msg.text());
  });

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('sw3pull423.test')) {
      return route.fulfill({
        status: 423,
        contentType: 'application/json',
        body: JSON.stringify({
          topologyPending: true,
          items: [],
          policyVersion: 12,
          maxId: 9001,
          scope: ['legacy-forbidden']
        })
      });
    }
    if (url.includes('sw3steps.test')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], maxId: 4444 })
      });
    }
    if (url.includes('logic.azure.com')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: [], maxId: 0 })
      });
    }
    return route.continue();
  });

  await page.goto(appUrl, { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof DB !== 'undefined' && typeof Sync !== 'undefined' && typeof window.TransferUI !== 'undefined' && !!DB.get(),
    { timeout: 20000 }
  );
  return page;
}

async function probeNonOkHoldSuppressesSteps(browser) {
  const page = await bootPage(browser);
  let stepHits = 0;
  page.on('request', (req) => {
    if (req.url().includes('sw3steps.test')) stepHits += 1;
  });

  const result = await page.evaluate(async () => {
    localStorage.clear();
    Sync._pullUrl = 'https://sw3pull423.test/pull';
    Sync._stepsPullUrl = 'https://sw3steps.test/steps';
    Sync._pushUrl = 'https://logic.azure.com/push';
    Sync._stepsPushUrl = 'https://logic.azure.com/stepsPush';
    Sync._isLeader = true;
    Sync._syncLock = false;
    Sync._stepSyncLock = false;
    Sync._topologyHold = false;
    Sync._scopePurgePending = false;
    Sync._lastSyncId = 17;
    Sync._lastStepSyncId = 33;
    localStorage.setItem('bob_last_sync_id', '17');
    localStorage.setItem('bob_last_step_sp_id', '33');

    await Sync.poll();

    return {
      topologyHold: Sync._topologyHold,
      lastStepSyncId: Sync._lastStepSyncId,
      storedStepSyncId: localStorage.getItem('bob_last_step_sp_id'),
      status: document.getElementById('status')?.textContent || ''
    };
  });

  await page.close();
  return { name: 'non_ok_hold_suppresses_steps', stepHits, result };
}

async function probeThresholdDurableWriteRearmsScope(browser) {
  const page = await bootPage(browser);

  const result = await page.evaluate(async () => {
    localStorage.clear();
    const d = DB.get();
    const inScope = 'karrinyup';
    const outScope = 'whitford';
    const productId = (d.products && d.products[0] && d.products[0].id) || 'prod-audit';

    d.transactions = [];
    d.deletedTransactions = [];
    d.stockTakes = [];
    d.deliveries = [];
    d.thresholds = [];
    d.transfers = [];
    d.recordSteps = [];
    await DB.commitDurable();

    localStorage.setItem('bob_scope_sig', JSON.stringify([inScope]));
    localStorage.removeItem('bob_scope_purge_pending');
    Sync._scopePurgePending = false;
    Sync._isLeader = true;
    Sync._pushUrl = 'https://logic.azure.com/push';
    Sync._stepsPushUrl = 'https://logic.azure.com/stepsPush';

    d.thresholds.push({
      storeId: outScope,
      productId,
      minQty: 5,
      maxQty: 9,
      leadDays: 2
    });

    const ok = await DB.commitDurable();
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      ok,
      scopeSig: localStorage.getItem('bob_scope_sig'),
      purgePending: localStorage.getItem('bob_scope_purge_pending'),
      syncPurgePending: Sync._scopePurgePending === true,
      hasOutOfScopeRows: DB.hasOutOfScopeRows([inScope]) === true,
      thresholds: DB.get().thresholds.map((t) => ({
        storeId: t.storeId,
        productId: t.productId,
        minQty: t.minQty
      }))
    };
  });

  await page.close();
  return { name: 'threshold_durable_write_rearms_scope', result };
}

async function main() {
  const browser = await chromium.launch();
  try {
    const probes = [];
    probes.push(await probeNonOkHoldSuppressesSteps(browser));
    probes.push(await probeThresholdDurableWriteRearmsScope(browser));
    console.log(JSON.stringify({ probes }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
