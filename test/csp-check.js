// CSP runtime check — serves the app over http WITH the real CSP header (read from
// staticwebapp.config.json) and asserts it boots in Chromium with ZERO CSP violations.
// The file:// sentinel harness cannot test SWA headers, so this is the runtime proof.
//   node test/csp-check.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'staticwebapp.config.json'), 'utf8'));
const HEADERS = cfg.globalHeaders || {};
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };
const PORT = 8771;

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(REPO, p);
  fs.readFile(fp, (err, buf) => {
    const h = Object.assign({}, HEADERS);
    if (err) { res.writeHead(404, h); res.end('not found'); return; }
    h['Content-Type'] = TYPES[path.extname(fp)] || 'application/octet-stream';
    res.writeHead(200, h); res.end(buf);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext(); const page = await ctx.newPage();
  const violations = [];
  page.on('console', m => { const t = m.text(); if (/content security policy|refused to (load|execute|connect|apply|create)/i.test(t)) violations.push(t); });
  page.on('pageerror', e => { if (/content security policy/i.test(String(e))) violations.push('pageerror: ' + e); });
  let booted = false;
  try {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load', timeout: 25000 });
    await page.waitForFunction(() => typeof DB !== 'undefined' && typeof Sync !== 'undefined' && typeof window.TransferUI !== 'undefined', { timeout: 15000 });
    booted = true;
  } catch (e) { violations.push('BOOT-FAIL: ' + e.message); }
  await page.waitForTimeout(1000);
  console.log('CSP header present :', !!HEADERS['Content-Security-Policy']);
  console.log('Booted under CSP  :', booted);
  console.log('CSP violations    :', violations.length);
  violations.slice(0, 25).forEach(v => console.log('  - ' + String(v).slice(0, 170)));
  await b.close(); server.close();
  const ok = booted && violations.length === 0;
  console.log(ok ? '\nCSP-CHECK PASS' : '\nCSP-CHECK FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR', e); try { server.close(); } catch (x) {} process.exit(2); });
