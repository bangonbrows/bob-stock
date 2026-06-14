// verify-release.js — STATIC release gate (no browser). Fails the release if a
// known-good hardening invariant has regressed. Companion to the runtime checks
// (smoke-test.js, saboteur-runner.js, csp-check.js). Framework P-11. Banked: D-047.
//   node test/verify-release.js
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..');
const read = f => { try { return fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (e) { return null; } };
const results = []; const add = (name, status, detail) => results.push({ name, status, detail: detail || '' });

const html = read('index.html') || '', sw = read('sw.js') || '', swaRaw = read('staticwebapp.config.json'), inv = read('DEPENDENCY-INVENTORY.md'), gi = read('.gitignore');

// 1. No dev CDN
add('No Tailwind dev CDN', html.indexOf('cdn.tailwindcss.com') === -1 ? 'PASS' : 'FAIL', 'cdn.tailwindcss.com must not appear in index.html');

// 2. External scripts pinned + SRI + crossorigin
const scriptTags = [...html.matchAll(/<script[^>]*\ssrc="(https:\/\/[^"]+)"[^>]*>/gi)];
const extScriptUrls = scriptTags.map(m => m[1]);
let sBad = [];
for (const m of scriptTags) { const tag = m[0], url = m[1]; const sri = /integrity="sha\d+-/.test(tag) && /crossorigin=/.test(tag); const pinned = /@\d+\.\d+\.\d+/.test(url); if (!sri || !pinned) sBad.push(url + (sri ? '' : ' [no SRI]') + (pinned ? '' : ' [unpinned]')); }
add('External scripts pinned + SRI', sBad.length === 0 ? 'PASS' : 'FAIL', sBad.join('; ') || `${extScriptUrls.length} external scripts OK`);

// 3. SW precache matches page external scripts
const swUrls = [...sw.matchAll(/'(https:\/\/[^']+)'/g)].map(m => m[1]);
const missInSw = extScriptUrls.filter(u => !swUrls.includes(u));
const extraInSw = swUrls.filter(u => !extScriptUrls.includes(u));
add('SW precache matches page scripts', (missInSw.length === 0 && extraInSw.length === 0) ? 'PASS' : 'FAIL', [missInSw.length ? 'missing in sw: ' + missInSw.join(',') : '', extraInSw.length ? 'extra in sw: ' + extraInSw.join(',') : ''].filter(Boolean).join('; ') || 'aligned');

// 4 & 5 & 6. headers + CSP
let swa = null; try { swa = JSON.parse(swaRaw); } catch (e) {}
const gh = (swa && swa.globalHeaders) || {};
const reqH = ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security'];
const missH = reqH.filter(h => !gh[h]);
add('Security headers present', missH.length === 0 ? 'PASS' : 'FAIL', missH.length ? 'missing: ' + missH.join(',') : 'all present');
const csp = gh['Content-Security-Policy'] || '';
const cspNeeds = ['connect-src', "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"];
const cspMiss = cspNeeds.filter(d => csp.indexOf(d) === -1);
const connLogic = /connect-src[^;]*logic\.azure\.com/.test(csp);
add('CSP directives complete', (cspMiss.length === 0 && connLogic) ? 'PASS' : 'FAIL', [cspMiss.length ? 'missing: ' + cspMiss.join(',') : '', connLogic ? '' : 'connect-src missing logic.azure.com'].filter(Boolean).join('; ') || 'ok');
const cspBad = csp.indexOf('unsafe-eval') !== -1 || csp.indexOf('cdn.tailwindcss.com') !== -1;
add('CSP free of unsafe-eval / dev-CDN', cspBad ? 'FAIL' : 'PASS', cspBad ? 'CSP contains unsafe-eval or cdn.tailwindcss.com' : 'clean');

// 7. dependency inventory
const invOk = inv && /dexie/i.test(inv) && /chart\.js/i.test(inv) && /playwright/i.test(inv);
add('Dependency inventory present', invOk ? 'PASS' : 'FAIL', invOk ? 'covers dexie/chart.js/playwright' : 'DEPENDENCY-INVENTORY.md missing or incomplete');

// 8. lockfile + gitignore hygiene
const lock = read('test/package-lock.json') !== null;
const giNM = gi && /node_modules/.test(gi);
const giKeepsLock = gi && !/package-lock/.test(gi);
add('Lockfile present + not git-ignored', (lock && giNM && giKeepsLock) ? 'PASS' : 'FAIL', !lock ? 'no lockfile' : !giNM ? '.gitignore must exclude node_modules' : !giKeepsLock ? '.gitignore must NOT exclude lockfile' : 'ok');

// 9. anti-regression: C1 backup scrub + Wave-B permission map still present
const scrubN = (html.match(/_scrubBackupSecrets/g) || []).length;
add('Backup scrub present (C1)', scrubN >= 3 ? 'PASS' : 'FAIL', `${scrubN} _scrubBackupSecrets refs (def + export + import = 3+ expected)`);
add('Central permission map present (Wave B)', (html.indexOf('_caps') !== -1 && html.indexOf('can(cap)') !== -1) ? 'PASS' : 'FAIL', 'Auth._caps + Auth.can(cap)');

// 10. external stylesheets without SRI -> WARN (documented exception)
const linkNoSri = [...html.matchAll(/<link[^>]*href="https:\/\/[^"]+"[^>]*>/gi)].map(m => m[0]).filter(t => /stylesheet/.test(t) && !/integrity=/.test(t));
if (linkNoSri.length) add('External stylesheet without SRI', 'WARN', `${linkNoSri.length} (Google Fonts — documented exception; self-host pre-beta)`);

let fail = 0, warn = 0;
console.log('\n=== verify-release (static gate) ===');
for (const r of results) { if (r.status === 'FAIL') fail++; if (r.status === 'WARN') warn++; console.log(`  [${r.status}] ${r.name}${r.detail ? ' :: ' + r.detail : ''}`); }
console.log(`\n${fail === 0 ? 'RELEASE-GATE PASS' : 'RELEASE-GATE FAIL (' + fail + ' blocking)'}${warn ? ' · ' + warn + ' warning(s)' : ''}`);
process.exit(fail === 0 ? 0 : 1);
