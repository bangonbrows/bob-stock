const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const errors = [];
  page.on('pageerror', err => errors.push('PageError: ' + err.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push('ConsoleError: ' + msg.text());
  });

  const uri = 'file://' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  await page.goto(uri);
  
  // Extract all onclick attributes
  const onclicks = await page.evaluate(() => {
    const els = document.querySelectorAll('[onclick]');
    return Array.from(els).map(el => el.getAttribute('onclick'));
  });

  console.log('Found ' + onclicks.length + ' onclick handlers in DOM initially.');
  
  const missing = [];
  for (const oc of onclicks) {
    const match = oc.match(/([a-zA-Z0-9_\.]+)\s*\(/);
    if (match) {
      const funcPath = match[1];
      // Skip generic things or things we can't easily check
      if (funcPath.startsWith('document.') || funcPath.startsWith('this.')) continue;
      
      const exists = await page.evaluate((fp) => {
        try {
          const parts = fp.split('.');
          let obj = window;
          for (const p of parts) {
            obj = obj[p];
            if (obj === undefined) return false;
          }
          return typeof obj === 'function';
        } catch(e) { return false; }
      }, funcPath);
      
      if (!exists && !missing.includes(funcPath)) {
        missing.push(funcPath);
        console.log('Undefined function: ' + funcPath + ' in onclick: ' + oc);
      }
    }
  }

  await browser.close();
  if (errors.length) {
    console.log('Errors during load:');
    console.log(errors);
  }
})();
