// BOB Stock App — saboteur mutation runner (the "file-mutation loop").
//
// For each mutation: copy the app's source files to a temp dir, apply a TRUE
// source-level mutation (re-introduce a real bug), boot that mutated copy in
// Chromium, run the matching sentinel, and assert it flips to CLEAN-FAIL.
// A sentinel that stays green on its own saboteur is BLIND and proves nothing.
//
//   node test/saboteur-runner.js
//
// Coverage note (honest, no silent cap): this runner ships 4 representative
// mutations — including S-04 and S-06, the two sentinels a 2026-06 audit found
// were "blind" (they asserted re-derived logic, not live code). They now drive
// the live pull-clamp and the live CSV export respectively. The full mutation
// catalogue lives in ../SABOTEUR-MUTATION-LIST.md; extend MUTATIONS below as new
// invariants are added.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const SMOKE = path.join(__dirname, 'smoke-test.js');

const REPO = path.resolve(__dirname, '..');
const SRC_FILES = ['index.html', 'db.js', 'sync.js', 'phase2.js', 'sw.js'];
// Per-child budget. Bumped from 600s: under parallel CPU contention a single smoke run (~266s
// in-repo) slows down, so give generous headroom to avoid a contention timeout reading as a false BLIND.
const SMOKE_TIMEOUT = 1200000;
const MAXBUF = 64 * 1024 * 1024;
// Mutations run in a bounded pool of fresh child processes (each still fully isolated in its own temp
// copy — the isolation that fixed the teardown flakiness is preserved; we just run several at once).
// Speedup ≈ concurrency. Tune with SABOTEUR_CONCURRENCY; default modest to keep per-child contention low.
const CONCURRENCY = Math.max(1, parseInt(process.env.SABOTEUR_CONCURRENCY || '0', 10) || Math.min(6, Math.max(2, os.cpus().length - 1)));

const MUTATIONS = [
  { id: 'S-01', file: 'db.js',
    find: "const ok = await _appendRecord('transactions', txn);",
    repl: "const ok = true; await _appendRecord('transactions', txn);",
    note: 'durable write returns true even when the Dexie put failed -> "Saved!" before saved' },
  { id: 'S-02', file: 'sync.js',
    find: 'ackVerified = false;\n        }\n      } else if (!serverStatus',
    repl: 'ackVerified = true;\n        }\n      } else if (!serverStatus',
    note: 'mark batch synced on an ambiguous (ok-but-no-count) ack -> silent data loss' },
  { id: 'S-03', file: 'phase2.js',
    find: 'const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, snapshot);',
    repl: 'const _ok = (DB.atomicTransferWriteDurable(batchTxns, t, snapshot), true);',
    note: 'transfer email fires before the durable write is confirmed -> notify before saved' },
  { id: 'S-12', file: 'db.js',
    find: 'txns = txns.filter(t => { if (!t || _seen.has(t.id)) return false; _seen.add(t.id); return true; });',
    repl: 'txns = txns.filter(t => t && !_seen.has(t.id));',
    note: 'bulk add stops deduping within a batch -> paginated pull double-counts stock (DA-1)' },
  { id: 'S-07', file: 'index.html',
    find: "if(e.data&&e.data.type==='sync-push'&&Sync._isLeader)Sync.push();",
    repl: "if(e.data&&e.data.type==='sync-push')Sync.push();",
    note: 'remove the SW leader gate -> a follower tab pushes on the sync-push message (I-60)' },
  { id: 'S-13', file: 'index.html',
    find: 'const n = parseInt(x, 10); return Number.isSafeInteger(n) ? n : NaN;',
    repl: 'return parseInt(x, 10);',
    note: 'safeInt drops the safe-integer magnitude cap -> 16+ digit qty poisons reports' },
  { id: 'S-14', file: 'index.html',
    find: 'Recorded by: ${UI.esc(del.createdBy)}</div>',
    repl: 'Recorded by: ${del.createdBy}</div>',
    note: 'delivery createdBy rendered unescaped -> stored XSS in the detail modal' },
  { id: 'S-15', file: 'phase2.js',
    find: 'by: Auth.actor(), editLog: []',
    repl: 'by: u, editLog: []',
    note: 'transaction actor reverts to full user object -> password/PIN hashes leak into every ledger row + backup' },
  { id: 'S-16', file: 'index.html',
    find: "if(!(await this._commitSettings('Supplier info could not be saved.')))return;UI.toast('Supplier info saved','success');",
    repl: "DB.commit();UI.toast('Supplier info saved','success');",
    note: 'supplier save reverts to fire-and-forget -> success toast before durable persist (false success)' },
  { id: 'S-17', file: 'db.js',
    find: "this._sanitizeNames();  // GPT-003: sanitize on load (import/migrate/restore bypass commit-time sanitize)",
    repl: "",
    note: 'refresh() stops sanitising on load -> a poisoned backup/import name executes before any commit' },
  { id: 'S-18', file: 'index.html',
    find: 'if(batch.length && !(await DB.addTransactionsDurable(batch)))',
    repl: 'if(false && !(await DB.addTransactionsDurable(batch)))',
    note: 'stock-take approval stops creating adjustment entries -> approved take does NOT reconcile stock (M-4)' },
  { id: 'S-19', file: 'index.html',
    find: "todayLocal() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date()); },",
    repl: "todayLocal() { return new Date().toISOString().slice(0,10); },",
    note: 'dates revert to UTC slice -> early-AM Perth actions dated to the previous day (I-86)' },
  { id: 'S-20', file: 'sync.js',
    find: "        if (watermark) { const wmTs = typeof watermark === 'number' ? watermark : new Date(watermark).getTime(); if (!isNaN(wmTs) && wmTs > 0) { this._lastSyncAt = Math.max(this._lastSyncAt, wmTs); try { localStorage.setItem('bob_last_sync', String(this._lastSyncAt)); } catch(e) {} } }",
    repl: "",
    note: 'empty pull stops advancing the cursor -> quiet systems re-query the same range forever (I-89)' },
  { id: 'S-21', file: 'index.html',
    find: "else walk(v[k]);",
    repl: "",
    note: 'deep actor-slim loses recursion -> nested flaggedItems[].resolvedBy credential hashes leak (SA-I-F1)' },
  { id: 'S-08', file: 'db.js',
    find: "original.type === 'move_out' ? 'in' :  // MFL-006: reverse out -> add back",
    repl: "original.type === 'move_out' ? 'out' :  // MFL-006: reverse out -> add back",
    note: 'removeTransaction reverses move_out the wrong way -> deleting a move_out double-subtracts (I-13)' },
  { id: 'S-10', file: 'phase2.js',
    find: "if (!(Auth.isHO() || Auth.is('director') || (Auth.storeIds && Auth.storeIds().includes(t.toStoreId)))) {",
    repl: "if (false) {",
    note: 'receive store-ownership guard removed -> any role receives any store\'s transfer (I-91)' },
  { id: 'S-11', file: 'db.js',
    find: "this._cache.transactions = this._cache.transactions.filter(t => t !== txn);",
    repl: "/* S-11 saboteur: rollback removed */",
    note: 'addTransactionDurable stops rolling back on a quota throw -> torn half-saved state (I-21/I-131)' },
  { id: 'S-04', file: 'sync.js',
    find: 'this._lastSyncAt = Math.max(this._lastSyncAt, wmTs);\n        } else {',
    repl: 'this._lastSyncAt = wmTs;\n        } else {',
    note: 'remove the main watermark clamp (post-merge) -> a stale older server watermark rewinds the cursor' },
  { id: 'S-05', file: 'index.html',
    find: ".replace(/</g,'&lt;')",
    repl: '',
    note: 'UI.esc stops escaping "<" -> stored XSS executes' },
  { id: 'S-06', file: 'index.html',
    find: 'const esc=v=>{let s=String(v==null?\'\':v);if(/^[=+\\-@\\t\\r]/.test(s)&&isNaN(Number(s)))s="\'"+s;',
    repl: 'const esc=v=>{let s=String(v==null?\'\':v);',
    note: 'remove the LIVE CSV formula guard -> =HYPERLINK/=SUM cells execute in Excel' },
  { id: 'S-09', file: 'db.js',
    find: 'if (txn && this._cache.transactions.some(t => t.id === txn.id)) return true;',
    repl: '',
    note: 'remove addTransaction dedupe -> duplicate ledger rows double-count stock' },
  { id: 'S-22', file: 'index.html',
    find: "if(!Sync._isLeader && typeof Sync._becomeLeader==='function') Sync._becomeLeader();",
    repl: '',
    note: 'force-push stops claiming leadership -> a follower tab becomes an ungated push entry-door (SA-C-R9-F1)' },
  { id: 'S-23', file: 'index.html',
    find: "if(!Auth.can('recordDelivery')){UI.toast('Only a Director can record deliveries','error');return;}",
    repl: '',
    note: 'remove the delivery role gate -> a staff DevTools user records deliveries + overwrites cost prices (M-3 / D-044)' },
  { id: 'S-24', file: 'phase2.js',
    find: "_canCancel() { return Auth.is('director'); },",
    repl: "_canCancel() { return ['franchisee','territory_manager','head_office','director'].includes(Auth.user()?.role); },",
    note: 'cancel reverts to franchisee&above -> a franchisee cancels a transfer that is now Director-only (D-044)' },
  { id: 'S-25', file: 'index.html',
    find: '_stTakeUnlocked=true; Auth._tempStockTake=pinCfg.expiresAt;',
    repl: '_stTakeUnlocked=true;',
    note: 'PIN unlock stops wiring the temp grant -> a store computer with a valid 24h PIN is still blocked from stock-take (D-044)' },
  { id: 'S-26', file: 'phase2.js',
    find: "if (Auth.is('director')) {  // D-044: resolving is Director-only",
    repl: "if (true) {  // D-044: resolving is Director-only",
    note: 'flagged-transfer detail shown to everyone -> a non-director gets the dead Director-only resolve screen (D-044 dead-UI)' },
  { id: 'S-27', file: 'index.html',
    find: 'const clean=this._scrubBackupSecrets(Auth._slimActorsDeep(JSON.parse(JSON.stringify(DB.get()))));',
    repl: 'const clean=Auth._slimActorsDeep(JSON.parse(JSON.stringify(DB.get())));',
    note: 'backup export stops scrubbing -> live session tokens + SAS/URLs ship in the backup file (Wave C / C1)' },
  { id: 'S-28', file: 'index.html',
    find: 'this._scrubBackupSecrets(data);',
    repl: '',
    note: 'backup import stops scrubbing -> a crafted backup injects a live session token = restored active login (Wave C / C1)' },
  { id: 'S-29', file: 'index.html',
    find: 'msg: this._scrub(msg)',
    repl: 'msg: String(msg)',
    note: 'diagnostic log stops scrubbing -> secrets/auth material (hashes, session tokens, Logic App URLs) leak into the exportable diag log (Wave C / C5)' },
  { id: 'S-30', file: 'index.html',
    find: "_isSafeKey(k){ return typeof k==='string' && k!=='__proto__' && k!=='constructor' && k!=='prototype'; }",
    repl: "_isSafeKey(k){ return typeof k==='string'; }",
    note: 'cache key guard removed -> a __proto__/constructor-keyed tampered txn pollutes the stock cache (L35 / I-02)' },
  { id: 'S-31', file: 'index.html',
    find: '_safeQty(v) { const n = Number(v); return (Number.isSafeInteger(n) && n >= 0) ? n : null; }',
    repl: '_safeQty(v) { const n = Number(v); return Number.isSafeInteger(n) ? n : null; }',
    note: 'load-path qty guard drops the non-negative check -> a tampered negative qty poisons stock totals on load (L35 / C6)' },
  { id: 'S-32', file: 'index.html',
    find: '<button class="btn btn-secondary" onclick="Pages._exportReorderCSV()">⬇ Export CSV</button>',
    repl: '<button class="btn btn-secondary" onclick="(${exportReorder.toString()})()">⬇ Export CSV</button>',
    note: 'reorder CSV button reverts to a stringified closure -> dead button (ReferenceError on items) (Wave D / Gemini)' },
  { id: 'S-33', file: 'index.html',
    find: "if(typeof Stock!=='undefined'&&Stock._isSafeKey&&_idColls.some(coll=>!coll.every(o=>o&&Stock._isSafeKey(o.id)))) return {ok:false,error:'Backup contains a reserved/invalid product, store, category or product-type ID.'};",
    repl: '',
    note: 'backup import stops rejecting reserved IDs -> a store id like `constructor` imports, then its stock silently vanishes from the cache (Wave D / GPT-ABC-001). Retargeted after Wave H H4 reworked the check to _idColls.' },
  { id: 'S-34', file: 'index.html',
    find: "if(validLines.some(ln=>!(Number.isFinite(ln.unitCost)&&ln.unitCost>=0)||!(Number.isFinite(ln.packaging||0)&&(ln.packaging||0)>=0)||!(Number.isFinite(ln.labelling||0)&&(ln.labelling||0)>=0)||!(Number.isFinite(ln.weightGrams||0)&&(ln.weightGrams||0)>=0))){UI.toast('Unit cost, packaging, labelling and weight cannot be negative','error');return;}",
    repl: '',
    note: 'delivery stops rejecting negative line costs -> negative landed/product cost corrupts valuation (Wave D / GPT-ABC-002)' },
  { id: 'S-35', file: 'phase2.js',
    find: "const targetStoreId = scope === 'global' ? '*' : storeId;",
    repl: "const targetStoreId = scope === 'global' ? null : storeId;",
    note: 'optimum global save reverts to a null compound key -> the durable save aborts (global optimum cannot be saved) (Wave D / GPT-ABC-003)' },
  { id: 'S-36', file: 'index.html',
    find: 'from:UI.dateLocal(md),to:UI.dateLocal(new Date(md.getFullYear(),md.getMonth()+1,0))',
    repl: "from:md.toISOString().slice(0,7)+'-01',to:new Date(md.getFullYear(),md.getMonth()+1,0).toISOString().slice(0,10)",
    note: 'store-comparison reverts to UTC slices -> monthly report drifts across Perth month boundaries (Wave D / GPT-ABC-004)' },
  { id: 'S-37', file: 'db.js',
    find: "(rows || []).forEach(o => { if (o && typeof o === 'object') o.active = o.active !== false; });",
    repl: ';',
    note: 'shared active-flag primitive gutted (both seed + load paths) -> fresh install hides the entire 192-product catalogue (F1-C01 / GPT FINAL C-01). Round-1 lesson: the original two independent defenses made any single-point mutation survivable (BLIND) — refactored to one provable primitive.' },
  { id: 'S-38', file: 'index.html',
    find: "const _cost=UI.money(document.getElementById('nc-cost')?.value);  // F1-C02: central validator (finite + non-negative + capped)",
    repl: "const _cost=(function(){const c=parseFloat(document.getElementById('nc-cost')?.value);return {ok:!(isNaN(c)||c<0),value:c};})();",
    note: 'cost entry reverts to ad-hoc parseFloat -> 1e309 saves a $Infinity cost row (F1-C02 / GPT FINAL C-02)' },
  { id: 'S-39', file: 'index.html',
    find: "if (!Number.isSafeInteger(n)) return { ok: false, error: 'magnitude too large' };\n    if (n < 0) return { ok: false, error: 'cannot be negative' };",
    repl: "if (!Number.isSafeInteger(n)) return { ok: false, error: 'magnitude too large' };",
    note: 'shared Validate.qty stops rejecting negative qty -> backup import (+ sync pull) accept negative ledger rows: ledger/cache disagree after restore (F1-H01 / GPT FINAL H-01). Retargeted at the shared validator after the F-followup replaced the inline backup check (find-string was orphaned -> SKIPPED in run #1).' },
  { id: 'S-40', file: 'index.html',
    find: "if(!_p.ok||!_l.ok){UI.toast('Line '+(i+1)",
    repl: "if(!_p.ok&&!_l.ok){UI.toast('Line '+(i+1)",
    note: 'packaging validation only aborts when BOTH fields invalid -> partial commit + success toast after error (F1-H02 / GPT FINAL H-02)' },
  { id: 'S-41', file: 'index.html',
    find: 'const margin=currCost!==null&&p.price?((p.price-currCost)/p.price*100).toFixed(1):null;  // F1-H03: field-name drift — catalogue stores `price`, sellPrice never exists',
    repl: 'const margin=currCost!==null&&p.sellPrice?((p.sellPrice-currCost)/p.sellPrice*100).toFixed(1):null;',
    note: 'cost table reverts to the phantom sellPrice field -> Director margins render as dashes (F1-H03 / GPT FINAL H-03). Round-1 lesson: the v1 find-string was a PREFIX of the line — the replace left dangling comment text = parse error, not the bug (BLIND). Mutations must match the WHOLE statement.' },
  { id: 'S-42', file: 'sync.js',
    find: 'const _marked = await DB.markTransactionsSynced(batchIds);',
    repl: 'const freshData = DB.get(); freshData.transactions.forEach(t => { if (batchIds.has(t.id)) { t._synced = true; } }); DB.save(freshData); const _marked = true;',
    note: 'push ack reverts to DB.save -> clear+rewrite of ALL 12 tables per push (F2-CRIT03 / Gemini CRIT-03 freeze time-bomb)' },
  { id: 'S-43', file: 'index.html',
    find: "if(_idColls.some(coll=>coll.some(o=>/[<>\"'`]/.test(String(o&&o.id))))) return {ok:false,error:'Backup contains a product/store/category/product-type ID with forbidden characters",
    repl: "if(false) return {ok:false,error:'Backup contains a product/store/category/product-type ID with forbidden characters",
    note: 'import stops rejecting sanitizer-stripped id chars -> restored product detaches from its ledger history on next load (F2-CRIT04 / Gemini CRIT-04). Retargeted after Wave H H4 reworked the check to _idColls.' },
  { id: 'S-44', file: 'phase2.js',
    find: "const _already = (_d.transactions || []).some(x => x && x.transferId === transferId && x.type === 'transfer_in');",
    repl: 'const _already = false;',
    note: 'double-receive ledger guard removed -> two devices receiving the same transfer doubles stock (F2-CRIT02 / Gemini CRIT-02)' },
  { id: 'S-45', file: 'phase2.js',
    find: 'const credit = Math.max(0, Math.min(item.sentQty, Math.trunc(Number(rQty)) || 0));\n        item.creditedAtReceive = credit;',
    repl: 'const credit = 0;\n        item.creditedAtReceive = credit;',
    note: 'flagged receipt reverts to zero credit -> physically-arrived stock invisible until Director resolves (F2-HIGH02 / Gemini HIGH-02 transit void)' },
  { id: 'S-46', file: 'sync.js',
    find: 'if (mdItem && mdItem.ConfigData) await this._applyMasterData(mdItem.ConfigData);',
    repl: 'if (false && mdItem && mdItem.ConfigData) await this._applyMasterData(mdItem.ConfigData);',
    note: 'master-data merge disabled -> catalogue islands return: Director price/product changes never reach other devices (F3-CRIT01 / Gemini CRIT-01). Retargeted after Wave H H2 made _applyMasterData awaited.' },
  { id: 'S-47', file: 'sync.js',
    find: 'const _q = (typeof Validate !== \'undefined\') ? Validate.qty(item.Qty) : { ok: Number.isSafeInteger(Math.trunc(Number(item.Qty))) && Math.trunc(Number(item.Qty)) >= 0 && Number.isInteger(Number(item.Qty)), value: Number(item.Qty) };',
    repl: 'const _q = { ok: true, value: (function(v){ var n = Math.trunc(Number(v)); return Number.isSafeInteger(n) ? n : 0; })(item.Qty) };',
    note: 'sync pull reverts to coercing ingest (trunc fractional, zero NaN/huge, accept any) -> bad remote row becomes durable wrong stock (F-followup / GPT-WF-01)' },
  { id: 'S-48', file: 'index.html',
    find: 'const _q=Validate.qty(t.qty);',
    repl: 'const _q={ok:Number.isSafeInteger(Math.trunc(Number(t.qty)))&&Math.trunc(Number(t.qty))>=0,value:Math.trunc(Number(t.qty))};',
    note: 'backup import reverts to truncating fractional qty (1.5->1) -> restored ledger silently wrong (F-followup / GPT-WF-02)' },
  { id: 'S-49', file: 'sync.js',
    find: 'const badMoney = v => v != null && !_money(v).ok;',
    repl: 'const badMoney = v => v != null && (!Number.isFinite(Number(v)) || Number(v) < 0);',
    note: 'master_data money check reverts to finite+non-negative only -> 1000000.01 / 3-decimal prices pushed to every device (F-followup / GPT-WF-03)' },
  { id: 'S-50', file: 'sync.js',
    find: 'if (RESERVED[k]) return;\n        if (keepLocalCost && k === \'costPrice\' && row.costPrice == null) return;',
    repl: 'if (k === \'id\') return;\n        if (keepLocalCost && k === \'costPrice\' && row.costPrice == null) return;',
    note: 'master_data upsert stops skipping reserved keys -> a __proto__ field in a remote row swaps the merged object prototype (F-followup / CL-01, I-02). Round-1 lesson: the shared copyFields helper means ONE mutation breaks both insert+update branches; the v1 mutation hit only the update branch while the sentinel tested a new product (insert) -> BLIND.' },
  { id: 'S-51', file: 'index.html',
    find: "if (!this._QTY_RE.test(s)) return { ok: false, error: 'must be a whole number' };",
    repl: ';',
    note: 'shared Validate.qty drops the lexical gate -> exponent/hex strings coerce (5e2->500, 0x10->16) at backup + pull = phantom stock (F-followup-2 / GPT-FF-01)' },
  { id: 'S-52', file: 'sync.js',
    find: 'const unsynced = _allUnsynced.filter(_egressOk);',
    repl: 'const unsynced = _allUnsynced;',
    note: 'push egress stops filtering -> hostile/legacy local rows (5.9->5, NaN->0, unknown type/product/store) forwarded to the cloud to poison every device (F-followup-2 / GPT-FF-02)' },
  { id: 'S-53', file: 'index.html',
    find: "const _sh=UI.money(document.getElementById('del-shipping')?.value,{optional:true});",
    repl: 'const _sh={ok:true,value:null};',
    note: 'delivery save stops reading the Shipping field -> user-entered shipping silently dropped from landed cost again (Wave G / blind x5)' },
  { id: 'S-54', file: 'db.js',
    find: "if (!ok) throw new Error('Migration persist to IndexedDB failed — localStorage source kept intact');",
    repl: ';',
    note: 'migration reverts to ignoring the persist result -> failed restore archives+deletes the source and boots an EMPTY app (Wave G / CaC-H4)' },
  { id: 'S-55', file: 'index.html',
    find: "    'login-audit':        {id:'page-login-audit',    fn:()=>Pages.loginAudit()},  // Wave G (blind W3-1): sidebar link existed but the route was never registered — the whole feature was unreachable",
    repl: '',
    note: 'login-audit route deregistered -> the sidebar link dead-ends and the whole feature is unreachable again (Wave G / blind W3-1)' },
  { id: 'S-56', file: 'phase2.js',
    find: 'const _existingLead = idx >= 0 ? (d.thresholds[idx].leadDays != null ? d.thresholds[idx].leadDays : null) : null;',
    repl: 'const _existingLead = null;',
    note: 'optimum Save All reverts to hard-coding leadDays:null -> every save silently wipes reorder lead times (Wave G / blind W3-4)' },
  { id: 'S-57', file: 'index.html',
    find: '      Pages._logData={}; Pages._logStep=1;        // movement wizard draft',
    repl: '',
    note: 'logout stops clearing the movement draft -> next user on a shared device inherits the previous user\'s half-finished movement (Wave G / blind W8)' },
  { id: 'S-58', file: 'index.html',
    find: 'if(this._logSubmitting)return; this._logSubmitting=true;',
    repl: 'this._logSubmitting=true;',
    note: 'movement double-submit guard removed -> a touchscreen double-tap records the movement TWICE (distinct crypto ids defeat dedup) (Wave G / blind W6)' },
  { id: 'S-59', file: 'index.html',
    find: 'if(this._delSaving)return; this._delSaving=true;',
    repl: 'this._delSaving=true;',
    note: 'delivery double-submit guard removed -> a touchscreen double-tap doubles the delivery stock-in (Wave G follow-up / GPT BLOCK P3 — proves the _delSaving half S-58 only asserted)' },
  { id: 'S-60', file: 'index.html',
    find: 'const headerShare=ln.headerCostShare||0;',
    repl: 'const headerShare=(ln.unitCost*ln.quantity/del.lines.reduce((a,l)=>a+l.unitCost*l.quantity,0))*Object.values(del.headerCosts).reduce((a,v)=>a+v,0);',
    note: 'packaging edit reverts to value-based allocation of the lumped header -> a weight-allocated delivery has its freight/shipping share re-flattened on edit, corrupting landed cost (Wave G follow-up / GPT+Gemini BLOCK P2, convergence x2)' },
  { id: 'S-61', file: 'phase2.js',
    find: 'if (this._optSaving) return; this._optSaving = true;',
    repl: 'this._optSaving = true;',
    note: 'optimum-levels Save All double-tap guard removed -> overlapping commitDurable calls (redundant sync + spurious save-failed UI) (Wave G follow-up / Gemini BLOCK P3 — G6 sweep)' },
  { id: 'S-62', file: 'index.html',
    find: 'if(this._pkgSaving)return; this._pkgSaving=true;',
    repl: 'this._pkgSaving=true;',
    note: 'packaging-edit double-tap guard removed -> a 2nd commit can show the fatal "could not be saved" overlay after a successful save + append duplicate cost-history rows (Wave G follow-up / GPT re-audit P3)' },
  { id: 'S-63', file: 'index.html',
    find: 'if(this._costSaving)return; this._costSaving=true;',
    repl: 'this._costSaving=true;',
    note: 'cost-entry double-tap guard removed -> duplicate ch_+Date.now() cost-history rows (Wave G follow-up / Gemini write-path family)' },
  { id: 'S-64', file: 'index.html',
    find: 'if(this._stCountSubmitting)return; this._stCountSubmitting=true;',
    repl: 'this._stCountSubmitting=true;',
    note: 'clean stock-take double-tap guard removed -> a second commit (= duplicate st_+Date.now() record on a real ms-apart double-tap) (Wave G follow-up / Gemini write-path family)' },
  // NOTE: no S-65 double-tap. The submitDraft _txState._creating guard was reverted — the handler is
  // already idempotent via two synchronous status checks. (S-65 below is the Wave H tombstone egress.)
  { id: 'S-65', file: 'sync.js',
    find: "if (String(t.type || '') === 'deleted') return !!t.targetTransactionId;",
    repl: "if (String(t.type || '') === 'deleted') return false;",
    note: 'egress filter reverts to dropping ALL tombstones -> an offline delete (type:deleted) never egresses = ghost stock on every other device (Wave H / H1, blind G1-22 ×4, P1)' },
  { id: 'S-66', file: 'sync.js',
    find: 'const _ok = await DB.commitDurable();  // runs _sanitizeNames + ref-data persist; returns false on failure',
    repl: 'DB.commit(); const _ok = true;  // saboteur: ignore durability',
    note: 'master_data reverts to fire-and-forget commit + unconditional version bump -> a failed persist still advances the catalogue version = catalogue desyncs forever (Wave H / H2, blind G1-12 ×2)' },
  { id: 'S-67', file: 'sync.js',
    find: "this._showStatus('Saving sync state… will retry', 'warning');",
    repl: "this._showStatus('Synced ✓', 'success');",
    note: 'markSynced-fail path reverts to showing "Synced ✓" -> the UI lies that the batch is saved when the local _synced write failed (Wave H / H3, GPTa-31)' },
  { id: 'S-68', file: 'index.html',
    find: 'const _idColls = [data.products, data.stores, data.categories, data.productTypes || []];',
    repl: 'const _idColls = [data.products, data.stores];',
    note: 'backup id-charset check reverts to products+stores only -> a category/product-type id with forbidden chars imports, then the on-load sanitiser mutates it and orphans the products pointing at it (Wave H / H4, GPTC-D)' },
  { id: 'S-69', file: 'phase2.js',
    find: 'if (_rq > _it.sentQty) {',
    repl: 'if (false) {',
    note: 'receive() stops rejecting over-receipt -> received>sent is accepted but credit clamps to sentQty, so the excess units silently vanish from the ledger (Wave H / H5, GPTc-4)' },
  { id: 'S-70', file: 'phase2.js',
    find: "if (allDone) { t.status = 'completed'; t.completedDate = new Date().toISOString(); }\n    const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, snapshot);",
    repl: "if (allDone) { t.status = 'completed'; t.completedDate = new Date().toISOString(); }\n    const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, null);",
    note: 'resolveAllFlags drops the rollback snapshot -> a failed multi-line resolve leaves the transfer marked completed in cache with no ledger rows = half-resolved torn state (Wave H / H5, GPT-15/GCLI-7)' },
  { id: 'S-71', file: 'sync.js',
    find: "['products', 'stores', 'categories', 'productTypes'].forEach(_restoreColl);",
    repl: '/* saboteur: cache rollback removed */',
    note: 'master_data failure stops rolling the cache back -> a cache-only product/price (and a mutated, captured product object) survives after a failed durable persist; a movement saved against it orphans on refresh (Wave H follow-up / GPT+Gemini BLOCK P2)' },
  { id: 'S-72', file: 'index.html',
    find: 'onclick="location.reload()" style="margin-top:26px',
    repl: 'onclick="void 0" style="margin-top:26px',
    note: 'fatal-save overlay button stops forcing a reload -> the durable-failure gate becomes dismissible/inert and the user can keep working in a transient cache-only state (Wave H follow-up / GPT+Gemini BLOCK P2)' },
  { id: 'S-73', file: 'sync.js',
    find: "if (typeof UI !== 'undefined' && UI.fatalSaveError) UI.fatalSaveError('A catalogue update could not be saved to this device. Your data is unchanged — please reload, and contact your administrator if this keeps happening.');",
    repl: '/* saboteur: master-data fatal gate removed */',
    note: 'master_data durable failure stops tripping the fatal gate -> a device that cannot persist its DB gives no warning on the catalogue path, unlike every other write path (Wave H follow-up / Gemini BLOCK P2)' },
  { id: 'S-74', file: 'db.js',
    find: 'if (ts) this._cache.transactions = this._cache.transactions.filter(t => t !== ts);  // durable: drop optimistic tombstone',
    repl: '/* saboteur: durable tombstone rollback removed */',
    note: 'durable delete failure stops rolling back the optimistic tombstone -> a failed delete leaves an orphan tombstone in cache while the original is restored = torn state (Wave I / I-6). Find made UNIQUE (the S-81 fix added an identical line in removeTransaction earlier in the file → the bare find collided → S-74 BLIND in the full sweep).' },
  { id: 'S-75', file: 'db.js',
    find: '_makeTombstone(original, txnId, options) {',
    repl: '_makeTombstone(original, txnId, options) { return null;',
    note: 'tombstone builder returns null -> a delete (incl. offline/no-URL) writes NO durable tombstone = ghost stock on every other device (Wave I / I-1). SINGLE-LINE ASCII find: db.js is CRLF after a git checkout, so a multi-line \\n find SKIPS; the ") {" distinguishes the def from its call sites.' },
  { id: 'S-76', file: 'sync.js',
    find: 'const _okDel = await DB.removeTransactionDurable(originalId, { skipTombstone: true });',
    repl: 'const _okDel = true;',
    note: 'pull stops actually applying tombstones -> a synced delete never removes the row; a same-batch create+delete leaves the row resurrected (Wave I / I-5)' },
  { id: 'S-77', file: 'db.js',
    find: ".filter(t => t && t.type === 'deleted' && t._synced && stamp(t) < cutoff)",
    repl: '.filter(t => false)',
    note: 'TTL prune stops selecting stale tombstones -> synced tombstones accumulate forever, degrading every O(N) cache/ledger loop (Wave I / I-4)' },
  { id: 'S-81', file: 'db.js',
    find: 'if (!ok && this._cache) {',
    repl: 'if (false && this._cache) {',
    note: 'non-durable removeTransaction stops rolling back on a failed background write -> cache/disk tear (cache shows deleted+tombstoned, disk unchanged) (Wave I follow-up / GPT+Gemini parity finding)' },
  { id: 'S-78', file: 'sync.js',
    find: "sp.DeletedBy = t.deletedBy || '';\n      sp.DeletedAt = t.deletedAt || '';\n      sp.DeleteReason = t.deleteReason || '';",
    repl: '/* saboteur: tombstone metadata mapping removed */',
    note: 'egress stops mapping tombstone audit metadata -> other devices learn a row was deleted but not who/when/why (Wave I / I-2)' },
  { id: 'S-79', file: 'sync.js',
    find: 'if (this._isLeader && this._getPending && this._getPending()) {',
    repl: 'if (false && this._isLeader && this._getPending && this._getPending()) {',
    note: 'leader poll stops draining pending -> a tombstone whose local-write signal was missed (backgrounded follower) sits unsent until the next user write (Wave I, GPT poll-push)' },
  { id: 'S-80', file: 'index.html',
    find: "case 'deleted':        return { direction: 'none', category: 'deleted' };",
    repl: "case 'deleted':        return { direction: 'out', category: 'deleted' };",
    note: 'tombstone stops being inert -> a type:deleted row is treated as an active OUT movement and can leak into reports/sums (Wave I, GPT inertness)' },
  { id: 'S-82', file: 'index.html',
    find: 'const _ledgerBad = (arr,fields)=>(arr||[]).some(o=>o&&fields.some(f=>o[f]!=null&&!Stock._isSafeLedgerId(String(o[f]))));',
    repl: 'const _ledgerBad = () => false;',
    note: 'backup import stops rejecting ledger ids with breakout chars -> a hostile transaction/transfer id enters the ledger via restore = Layer-1 ingest hole (Wave J / Tier 3 stored-XSS)' },
  { id: 'S-83', file: 'sync.js',
    find: "const _idBad = ['TransactionId', 'TargetTransactionId', 'TransferId'].some(f => spItem[f] != null && spItem[f] !== '' && !Stock._isSafeLedgerId(String(spItem[f])));",
    repl: 'const _idBad = false;',
    note: 'sync pull stops quarantining hostile TransactionId/TargetTransactionId/TransferId -> a poisoned cloud row merges into the local ledger (incl. the tombstone path that skips _fromSharePoint) = Layer-1 ingest hole (Wave J / Tier 3)' },
  { id: 'S-84', file: 'db.js',
    find: 'const bad = v => v != null && v !== \'\' && !Stock._isSafeLedgerId(String(v));',
    repl: 'const bad = () => false;',
    note: 'load-time quarantine stops dropping already-stored hostile-id rows -> a device contaminated before the fix keeps feeding poisoned ids to render sinks = Layer-1 backstop hole (Wave J / Tier 3)' },
  { id: 'S-85', file: 'index.html',
    find: 'onclick="Pages._deleteLog(this.dataset.id)" data-id="${UI.esc(t.id)}"',
    repl: 'onclick="Pages._deleteLog(\'${t.id}\')"',
    note: 'movement-row delete reverts to inline JS-string interpolation of the ledger id -> a hostile id executes on click (the blind audit proved executed:true here) = Layer-2 render hole (Wave J / Tier 3, headline)' },
  { id: 'S-86', file: 'db.js',
    find: 'this.quarantineUnsafeLedgerIds();',
    repl: 'void 0;  /* S-86 saboteur: refresh re-quarantine disabled */',
    note: 'refresh() (post-sync-pull cache rehydrate) stops re-quarantining -> a pre-fix hostile on-disk row re-enters the active cache after any sync, defeating the load-time backstop (Wave J / Tier 3, GPT code re-audit F1)' },
  { id: 'S-87', file: 'index.html',
    find: "if(!/^[A-Za-z0-9_-]+$/.test(id)){UI.toast('Product ID can use letters, numbers, _ and - only','error');return;}",
    repl: "if(false){UI.toast('Product ID can use letters, numbers, _ and - only','error');return;}",
    note: 'product-id creation stops enforcing the ledger allowlist -> a product id with a dot/space/slash is accepted, then its cost-history ledger id (ch_<ms>_<productId>) fails _isSafeLedgerId and gets quarantined = data-availability divergence (Wave J / Tier 3, GPT code re-audit F2)' },
  { id: 'S-88', file: 'index.html',
    find: "if((data.products||[]).some(p=>p&&!/^[A-Za-z0-9_-]+$/.test(String(p.id)))) return {ok:false,error:'",
    repl: "if(false) return {ok:false,error:'",
    note: 'backup import stops applying the product-id allowlist -> a backup product id outside [A-Za-z0-9_-] is accepted (catalogue-hygiene gate defeated) (Wave J / Tier 3, GPT code re-audit F2-followup; message-agnostic find)' },
  { id: 'S-89', file: 'sync.js',
    find: "const badId = v => typeof v !== 'string' || v === '' || !/^[A-Za-z0-9_-]+$/.test(v) ||",
    repl: "const badId = v => typeof v !== 'string' || v === '' || false ||",
    note: 'master_data sync stops applying the product-id allowlist -> a synced product row with a loose id is merged, minting a cost-history ledger id that _isSafeLedgerId quarantines = data-availability divergence via the sync door (Wave J / Tier 3, GPT code re-audit F2-followup)' },
  { id: 'S-90', file: 'index.html',
    find: "id:'ch_'+Date.now()+'_'+Array.from(crypto.getRandomValues(new Uint8Array(4)),b=>b.toString(16).padStart(2,'0')).join(''),productId:ln.productId,date,costPrice:Math.round(landedPerUnit*100)/100",
    repl: "id:'ch_'+Date.now()+'_'+ln.productId,productId:ln.productId,date,costPrice:Math.round(landedPerUnit*100)/100",
    note: 'delivery cost-history id (NEW delivery path) reverts to embedding the raw productId -> a long (>111 char) product id mints a >128-char ledger id that _isSafeLedgerId quarantines on refresh/load = data-availability divergence via the length-coupling (Wave J / Tier 3, GPT FINAL deep audit)' },
  { id: 'S-91', file: 'index.html',
    find: "id:'ch_'+Date.now()+'_'+Array.from(crypto.getRandomValues(new Uint8Array(4)),b=>b.toString(16).padStart(2,'0')).join(''),productId:ln.productId,date:del.date,costPrice:newLanded",
    repl: "id:'ch_'+Date.now()+'_'+ln.productId,productId:ln.productId,date:del.date,costPrice:newLanded",
    note: 'cost-history id on the PACKAGING-EDIT path (_saveDeliveryPackaging) reverts to embedding the raw productId -> same >128-char length-coupling on the second cost-history write (Wave J / Tier 3, GPT FINAL deep audit INFO: harness symmetry with S-90)' },
  { id: 'S-92', file: 'index.html',
    find: "if (to === 'Wastage/Damage')                                  return 'wastage';",
    repl: "if (false)                                  return 'wastage';",
    note: "Txn.category stops recognising the wastage destination -> a Wastage/Damage out is mis-categorised (falls to other_out), the root-fix that separates wastage from sales is defeated (Wave K / Tier 4 #9)" },
  { id: 'S-93', file: 'index.html',
    find: "return p.internalUse === true ? 'consumable' : 'retail';",
    repl: "return 'retail';",
    note: "Stock.stockTypeOf stops deriving consumable from internalUse -> consumables are treated as retail and would leak into sell-through/gross-sales (Wave K / Tier 4 stock-type)" },
  { id: 'S-94', file: 'index.html',
    find: "_wastageTxns(d){ return (d.transactions||[]).filter(t=>Txn.isWastage(t)); },",
    repl: "_wastageTxns(d){ return (d.transactions||[]).filter(t=>Txn.isOut(t)&&(t.reason==='Wastage'||t.reason==='Damaged/Expired'||t.stockTo==='Wastage/Damage')); },",
    note: "wastage definition reverts to the old 'any OUT with a wastage reason' string-match -> a transfer_out / out+Store-Transfer carrying a 'Wastage' reason is wrongly counted as wastage (Wave K / Tier 4 #9)" },
  { id: 'S-95', file: 'index.html',
    find: "if (p.stockType != null && p.stockType !== '') return 'unknown';",
    repl: "if (false) return 'unknown';",
    note: "stockTypeOf stops surfacing an invalid explicit stockType -> a typo'd/garbage stockType silently becomes retail and could leak a non-retail product into sell-through/gross-sales (Wave K / Tier 4, GPT P3)" },
  { id: 'S-96', sentinel: 'S-92', file: 'index.html',
    find: "if (to === 'Wastage/Damage')                                  return 'wastage';",
    repl: "if (to === 'Wastage/Damage' || t.reason === 'Wastage' || t.reason === 'Damaged/Expired')                                  return 'wastage';",
    note: "Txn.category REINTRODUCES the reason-override bug (a 'Wastage' reason promotes a transfer/in-house out to 'wastage') -> proves S-92 catches the destination-authoritative regression directly, not just the missing-wastage-branch case (Wave K / Tier 4, GPT re-audit harness note)" },
  { id: 'S-97', file: 'index.html',
    find: "const cat=Txn.category(t); if(cat!=='sale'&&cat!=='return')return a;",
    repl: "const cat=Txn.category(t); if(cat==='deleted')return a;",
    note: "Gross Sales stops restricting to sales+returns -> every outflow (wastage/transfer/in-house) counts toward the sales figure (revives blind-audit T4 #9d: wastage/transfers counted as revenue) (Wave K / Tier 4)" },
  { id: 'S-98', file: 'index.html',
    find: "const cat=Txn.category(t); if(cat!=='sale'&&cat!=='internal'&&cat!=='wastage')return a;",
    repl: "const cat=Txn.category(t); if(cat==='deleted')return a;",
    note: "Total Cost (used) stops restricting to consumed categories -> transfers + adjustments wrongly counted as a cost (Wave K / Tier 4)" },
  { id: 'S-99', file: 'index.html',
    find: "const isSold=cat==='sale';",
    repl: "const isSold=Txn.isOut(t);",
    note: "sell-through numerator reverts to ALL outflows -> wastage/transfers/in-house wrongly counted as 'sold', inflating the rate (revives blind-audit T4 #13) (Wave K / Tier 4)" },
  { id: 'S-100', file: 'index.html',
    find: "const c=Stock.currentCost(p.id); return c!=null?a+c*q:a;",
    repl: "const c=Stock.currentCost(p.id); return a;",
    note: "on-hand value stops summing stock×cost -> store stock-at-cost reads 0 (Wave K / Tier 4)" },
  { id: 'S-101', file: 'index.html',
    find: "if (from === 'HO Warehouse' || from === 'Another Store' || from === 'Franchise Office') return 'transfer';",
    repl: "if (false) return 'transfer';",
    note: "Txn.category stops treating a manual STOCK-IN from another location as a transfer -> transfer-ins mis-counted as supplier deliveries, understating per-store sell-through received (Wave K / Tier 4, GPT K2-P2)" },
  { id: 'S-105', sentinel: 'S-101', file: 'index.html',
    find: "const to = (t.stockTo || '').split(' — ')[0], from = (t.stockFrom || '').split(' — ')[0];",
    repl: "const to = t.stockTo, from = t.stockFrom;",
    note: "Txn.category stops stripping the store-name suffix -> the REAL UI labels ('Store Transfer — Booragoon', 'Another Store — Booragoon') miss the exact-match checks and mis-categorise (GPT K2-P2 round2: category drift on suffixed labels)" },
  { id: 'S-106', file: 'index.html',
    find: "&& (Txn.category(t) === 'delivery' || Txn.category(t) === 'transfer')",
    repl: "&& Txn.isIn(t)",
    note: "franchise billing stops restricting to genuine SUPPLY -> returns + adjustments to the office are billed again (revives blind-audit T4 #10 over-bill) (Wave K3 / Tier 4)" },
  { id: 'S-107', file: 'index.html',
    find: "const c=Stock.costAtDate(t.productId,t.date); if(c==null)missing++; else total+=c*(Stock._safeQty(t.qty)||0);",
    repl: "const c=(DB.get().products.find(pr=>pr.id===t.productId)||{}).price; if(c==null)missing++; else total+=c*(Stock._safeQty(t.qty)||0);",
    note: "wastage valuation reverts to RETAIL price instead of cost-at-time -> overstates the loss (Wave K3 / Tier 4)" },
  { id: 'S-108', sentinel: 'S-106', file: 'index.html',
    find: "&& Pages._isHOSupply(t)",
    repl: "&& true",
    note: "franchise billing stops restricting to genuine HO supply -> stock the franchise sourced elsewhere (non-HO) is wrongly billed to them (Wave K3 / Tier 4, Kunal option A)" },
  { id: 'S-102', sentinel: 'S-99', file: 'index.html',
    find: "const isReceived=companyWide ? (cat==='delivery') : (cat==='transfer'&&Txn.isIn(t));",
    repl: "const isReceived=companyWide ? (false) : (cat==='transfer'&&Txn.isIn(t));",
    note: "company-wide sell-through stops counting deliveries into HO as received -> denominator zero, sell-through null/broken company-wide (Wave K / Tier 4, GPT K2-P1)" },
  { id: 'S-103', sentinel: 'S-97', file: 'index.html',
    find: "const p=prods.find(pr=>pr.id===t.productId); if(!p||!Stock.isRetailProduct(p))return a;",
    repl: "const p=prods.find(pr=>pr.id===t.productId); if(!p)return a;",
    note: "Gross Sales stops enforcing retail-only -> a consumable 'sale' leaks into the sales figure (Wave K / Tier 4, GPT K2-P1)" },
  { id: 'S-104', sentinel: 'S-97', file: 'index.html',
    find: "if(cat==='return'&&t.stockFrom!=='Customer')return a;",
    repl: "if(false)return a;",
    note: "Gross Sales nets EVERY return (not just customer refunds) -> store/franchise/supplier returns wrongly reduce sales (Wave K / Tier 4, GPT K2-P1)" },
  { id: 'S-109', sentinel: 'S-106', file: 'index.html',
    find: "if (fromBase) return fromBase === 'HO Warehouse';",
    repl: "if (false) return fromBase === 'HO Warehouse';",
    note: "_isHOSupply stops trusting STRUCTURED source first -> a Supplier row carrying a 'from Head Office' free-text reason is mis-billed as HO supply (GPT K3 over-match) (Wave K3 / Tier 4)" },
];

function copyRepoTo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of SRC_FILES) {
    const src = path.join(REPO, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
}

// Run the sentinel suite in a FRESH child process per call — isolates each mutation's
// browser lifecycle so a Playwright teardown race can't crash the whole run (Round-10 harness note).
function parseSmoke(out) {
  const res = [];
  for (const m of out.matchAll(/\[CLEAN-(PASS|FAIL)!?\]\s+(S-\d+)/g)) res.push({ id: m[2], cleanPass: m[1] === 'PASS' });
  // GPT P2: the summary line prints ONLY if the smoke ran to completion (a timeout/hard-crash kills the
  // child before it). Its presence is our "the run actually finished" signal — absence = INFRA FAIL.
  const sm = out.match(/====\s+(\d+)\/(\d+)\s+sentinels PASS/);
  return { res, summary: sm ? { pass: +sm[1], total: +sm[2] } : null };
}
function runSmokeChild(dir) {  // SYNC — used once for the baseline
  let out = '';
  try { out = execFileSync('node', [SMOKE, dir], { encoding: 'utf8', timeout: SMOKE_TIMEOUT, maxBuffer: MAXBUF, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = (e.stdout || '') + '\n' + (e.stderr || ''); }
  return parseSmoke(out);
}
function runSmokeChildAsync(dir) {  // ASYNC — used by the parallel mutation pool
  return new Promise((resolve) => {
    execFile('node', [SMOKE, dir], { encoding: 'utf8', timeout: SMOKE_TIMEOUT, maxBuffer: MAXBUF }, (err, stdout, stderr) => {
      resolve(parseSmoke((stdout || '') + '\n' + (stderr || '')));  // err on timeout/non-zero: partial stdout still parsed; a missing target id triggers the retry
    });
  });
}

(async () => {
  console.log('=== BOB Stock saboteur mutation runner ===\n');

  // GPT P2: a RUN-UNIQUE temp root so two saboteur processes (overlapping/leftover runs) can NEVER
  // collide on temp dirs. Each mutation gets <RUN_ROOT>/<id>.
  const RUN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-sab-run-'));
  // The number of DISTINCT sentinels the catalogue covers (a mutation may target another mutation's
  // sentinel via `sentinel:`, so this is NOT just MUTATIONS.length). The clean baseline must run them all.
  const EXPECTED_SENTINELS = new Set(MUTATIONS.map(m => m.sentinel || m.id)).size;

  // 0) Baseline: every sentinel must be green on clean code, and the run must COMPLETE (no partial pass).
  console.log('[baseline] running sentinels against clean repo (isolated child process)...');
  let clean = runSmokeChild(REPO);
  if (!clean.summary) clean = runSmokeChild(REPO);  // retry once if the run didn't complete
  // GPT P2: a partial/crashed run must NOT pass as baseline — require completion (summary present),
  // ALL sentinels ran (total === full catalogue), and every one green.
  if (!clean.summary || clean.summary.total !== EXPECTED_SENTINELS || clean.summary.pass !== clean.summary.total) {
    console.error(`BASELINE FAIL/INFRA — clean run incomplete or a sentinel red (got ${clean.summary ? clean.summary.pass + '/' + clean.summary.total : 'NO SUMMARY'}, expected ${EXPECTED_SENTINELS}/${EXPECTED_SENTINELS}). Fix before mutation testing.`);
    try { fs.rmSync(RUN_ROOT, { recursive: true, force: true }); } catch (e) {}
    process.exit(1);
  }
  console.log(`[baseline] ${clean.summary.pass}/${clean.summary.total} green on clean code\n`);

  // 1) Each mutation must turn its sentinel red.
  // Targeted-first support: `SABOTEUR_ONLY=S-39,S-51 node saboteur-runner.js` runs
  // just those mutations (fast feedback after authoring/changing a sentinel, before
  // the full ~35min run). No env var = full suite.
  const _only = (process.env.SABOTEUR_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
  const _muts = _only.length ? MUTATIONS.filter(m => _only.includes(m.id)) : MUTATIONS;
  if (_only.length) console.log(`[targeted] running only: ${_only.join(', ')}`);
  console.log(`[parallel] ${_muts.length} mutations · concurrency ${CONCURRENCY} · ${SMOKE_TIMEOUT / 1000}s per-child budget`);
  let caught = 0, blind = 0, missingFind = 0, infra = 0;
  async function processMutation(m) {
    const sid = m.sentinel || m.id;  // the SENTINEL this mutation must flip (defaults to the mutation id)
    const dir = path.join(RUN_ROOT, m.id);  // run-unique root + mutation id -> collision-free across runs
    try {
      copyRepoTo(dir);
      const target = path.join(dir, m.file);
      const before = fs.readFileSync(target, 'utf8');
      if (before.indexOf(m.find) === -1) {
        missingFind++;
        console.log(`  [SKIP-NOFIND] ${m.id} :: source string not found in ${m.file} (mutation needs updating)`);
        return;
      }
      fs.writeFileSync(target, before.replace(m.find, m.repl), 'utf8');
      // GPT P2 (re-audit): never count a result from an UNRELIABLE run. A COMPLETE run (summary present
      // AND total === EXPECTED_SENTINELS) is trusted outright. A PARTIAL run is only trusted if the target's
      // verdict is DETERMINISTIC — identical across the original + a retry. This admits the intentionally-early
      // broad-mutation sentinels (e.g. S-37) that flip RED and THEN abort the rest of the suite (their mutation
      // breaks clean boot, so a full run is impossible by design — but their verdict is deterministic), while
      // rejecting flaky/contention partials whose verdict varies. Target absent, or verdicts disagree -> INFRA.
      const tgt = (pp) => pp.res.find(o => o.id === sid);
      const complete = (pp) => !!(pp.summary && pp.summary.total === EXPECTED_SENTINELS);
      let p = await runSmokeChildAsync(dir);
      let sentinel = null;
      if (complete(p) && tgt(p)) {
        sentinel = tgt(p);
      } else {
        const p2 = await runSmokeChildAsync(dir);  // retry
        if (complete(p2) && tgt(p2)) {
          sentinel = tgt(p2);
        } else {
          const t1 = tgt(p), t2 = tgt(p2);
          if (t1 && t2 && t1.cleanPass === t2.cleanPass) {
            sentinel = t1;  // partial both times but the target ran with the SAME verdict -> deterministic, trustworthy
            console.log(`  [note]    ${m.id} :: ${sid} verdict from a deterministic PARTIAL run (broad mutation aborts the suite by design)`);
          } else {
            infra++;
            console.log(`  [INFRA-FAIL] ${m.id} :: no complete run and ${sid} verdict not deterministic across retries (${p.summary ? p.summary.total : 'na'}/${p2.summary ? p2.summary.total : 'na'} of ${EXPECTED_SENTINELS}) — unreliable (re-run)`);
            return;
          }
        }
      }
      if (sentinel.cleanPass === false) { caught++; console.log(`  [CAUGHT]  ${m.id} flipped ${sid} RED on saboteur (${m.note})`); }
      else { blind++; console.log(`  [BLIND!]  ${m.id} left ${sid} GREEN with the bug applied — sentinel proves nothing (${m.note})`); }
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
  }
  let _qi = 0;
  const worker = async () => { while (_qi < _muts.length) { await processMutation(_muts[_qi++]); } };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, _muts.length) }, worker));

  console.log(`\n==== mutation results: ${caught} CAUGHT, ${blind} BLIND, ${missingFind} skipped, ${infra} INFRA-FAIL of ${_muts.length} ====`);
  try { fs.rmSync(RUN_ROOT, { recursive: true, force: true }); } catch (e) {}
  process.exit(blind === 0 && missingFind === 0 && infra === 0 ? 0 : 1);
})().catch(e => { console.error('RUNNER ERROR:', e); process.exit(2); });
