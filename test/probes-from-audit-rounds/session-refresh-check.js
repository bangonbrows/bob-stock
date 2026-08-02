const { chromium } = require('playwright');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const appUrl = 'file:///' + repo.replace(/\\/g, '/') + '/index.html';
const pullUrl = 'https://x.logic.azure.com/session-refresh-pull';

async function runCase(browser, mode) {
  const context = await browser.newContext({ timezoneId: 'Australia/Perth' });
  const page = await context.newPage();
  await page.route('**logic.azure.com**', async route => {
    if (route.request().url().includes('session-refresh-pull')) {
      await new Promise(resolve => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          maxId: '0',
          count: 0,
          status: 'ok',
          pricingSettled: true,
          pricingInstant: '2026-07-18T00:00:00Z',
          pricingVersion: 7
        })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[]}' });
  });
  await page.goto(appUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof DB !== 'undefined' && typeof Sync !== 'undefined', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const result = await page.evaluate(async ({ mode, pullUrl }) => {
    try {
      localStorage.setItem('bob_pricing_activated', '1');
      localStorage.setItem('bob_pricing_ver', '7');
      localStorage.removeItem('bob_pricing_stale');
      localStorage.removeItem('bob_pricing_unresolved');
    } catch (e) {}
    DB.get().pricingConfig = { version: 7, global: {}, stores: {} };
    Sync._unauthorized = false;
    Sync._pullUrl = pullUrl;
    Sync._syncLock = false;
    Sync._lastSyncId = 0;
    Sync._pricingFresh = true;
    const epochStart = Sync._pricingEpoch || 0;
    const pending = Sync.pull();
    await new Promise(resolve => setTimeout(resolve, 35));
    if (mode === 'offline') window.dispatchEvent(new Event('offline'));
    if (mode === 'unauthorized') Sync._handleUnauthorized('session-refresh-check');
    if (mode === 'stop') Sync.stop();
    await pending;
    return {
      mode,
      epochStart,
      epochEnd: Sync._pricingEpoch || 0,
      fresh: Sync._pricingFresh === true
    };
  }, { mode, pullUrl });
  await context.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const results = [];
    for (const mode of ['control', 'offline', 'unauthorized', 'stop']) results.push(await runCase(browser, mode));
    const control = results[0];
    const invalidated = results.slice(1);
    const pass = control.fresh === true && control.epochEnd === control.epochStart && invalidated.every(x => x.fresh === false && x.epochEnd > x.epochStart);
    console.log(`RESULT session freshness pull race: ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(results)}`);
    process.exit(pass ? 0 : 1);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.log(`RESULT session freshness pull race: ERROR ${error && error.message}`);
  process.exit(2);
});
