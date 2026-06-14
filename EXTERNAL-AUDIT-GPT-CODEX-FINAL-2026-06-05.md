# BOB Stock App - External Audit Report - GPT Codex

Date: 2026-06-05
Auditor: GPT Codex CLI
Target: `C:\Users\joshi\repos\bob-stock`
Branch/base observed: `fix/cli-tri-audit-2026-05` over `005caee T3-M3r1: Dead code removal + 4 audit fixes + 3 revision fixes`
Mode: read-only product audit; no app code changed

## Pre-Audit Read Confirmation

Read in order:

- `Stock Audit Framework v1/PASTE-TO-GPT-v2.txt`
- `Stock Audit Framework v1/EXTERNAL-AUDIT-BRIEF-v2.md`
- `Stock Audit Framework v1/STOCK-AUDIT-FRAMEWORK.md`
- `Stock Audit Framework v1/CANONICAL-INVARIANTS.md`
- `Stock Audit Framework v1/LENS-CATALOGUE.md`
- `Stock Audit Framework v1/AUDIT-DECISION-LOG.md`
- `Stock Audit Framework v1/GOLDEN-PATH-SMOKE.md`
- `Stock Audit Framework v1/WAVE-DONE-CHECKLIST.md`
- `MERGED-AUDIT-FIX-LIST.md`
- `Stock Audit Framework v1/RECENTLY-FIXED-CITATIONS.md`
- `Stock Audit Framework v1/SABOTEUR-MUTATION-LIST.md`

Authority note: `RECENTLY-FIXED-CITATIONS.md` is stale relative to `AUDIT-DECISION-LOG.md` D-031. I treated the v2 brief and decision log as current.

## Mental Model

The ledger is the source of truth for stock. `Stock._qtyCache` is only a materialized view over `transactions`; local durable truth is IndexedDB via Dexie; cloud truth is SharePoint through `sync.js` push/pull. The highest-risk joins are: UI success vs Dexie durability, local write vs push ack, and user/config strings moving between backup/import/sync/render boundaries.

Actor identity now has two shapes: safe actor snapshots in transfers/emails via `Auth.actor()`, and unsafe full user records still present in some transaction builders. The latter is the biggest security miss in the fixed tree.

## Baseline Commands

Run from `C:\Users\joshi\repos\bob-stock\test`.

- `npm.cmd install`: PASS after escalation. Plain `npm` was blocked by PowerShell execution policy; sandboxed `npm.cmd install` hit npm cache EPERM, then escalated install succeeded.
- `npm.cmd run smoke`: PASS, 14/14 clean sentinels.
- `npm.cmd run saboteur`: PASS, 11 CAUGHT / 0 BLIND / 0 skipped of 11. First 180s run timed out mid-run; rerun with a 600s timeout completed.
- `node verify-app.js --quiet`: 56 PASS / 1 FAIL / 1 EXPECTED-FAIL / 1 WARN. The fail is stale size scaffold: `index.html (889968)` outside expected `120000-320000`; per brief, `verify-app.js` scaffold drift is not raised as a product defect.

## Findings

### GPT-EXT-001

1. Finding ID: GPT-EXT-001
2. Severity: P1
3. Affected surface: `phase2.js` transfer transaction builder; `index.html` delivery transaction builder; IndexedDB transaction rows; backup JSON
4. Repro steps:
   - In real Playwright Chromium, boot `index.html` with Logic Apps routed to a mock.
   - Set the authenticated director user to include marker fields: `passwordHash`, `pinHash`, `currentSession`, and `password`.
   - Drive `TransferUI.submitCreate()` through the real UI closure path.
   - Read the generated `transfer_out` transaction from `bobDB.transactions`.
   - Repeat via `Pages._saveDelivery()` for delivery stock-in transactions.
5. Chromium evidence:
```json
{
  "transferActorKeys": ["id", "name", "role", "username"],
  "transferHasMarkers": false,
  "newTxnCount": 1,
  "txnSamples": [{
    "type": "transfer_out",
    "byKeys": ["currentSession", "id", "name", "password", "passwordHash", "pin", "pinHash", "role", "storeIds", "username"],
    "by": {
      "password": "PLAINTEXT_MARKER",
      "passwordHash": "PWHASH_MARKER_123",
      "pinHash": "PINHASH_MARKER_456",
      "currentSession": "SESSION_MARKER_789"
    }
  }],
  "txnHasMarkers": true,
  "emailHasMarkers": false
}
```
Durable readback:
```json
{
  "createdId": "txn_1780622672627_6345c6a9",
  "cacheHasMarkers": true,
  "dexieHasMarkers": true,
  "refreshedHasMarkers": true,
  "dexieByKeys": ["currentSession", "id", "name", "password", "passwordHash", "pin", "pinHash", "role", "storeIds", "username"]
}
```
Delivery path:
```json
{
  "createdId": "tx_1780622704092_8b005c99",
  "cacheHasMarkers": true,
  "dexieHasMarkers": true,
  "byKeys": ["currentSession", "id", "name", "password", "passwordHash", "pin", "pinHash", "role", "storeIds", "username"]
}
```
6. Screenshot/video: not needed; the defect is in durable stored JSON and intercepted email JSON.
7. Code location: `phase2.js:50-52`; callers at `phase2.js:96`, `phase2.js:158`, `phase2.js:194`, `phase2.js:228`, `phase2.js:235`, `phase2.js:241`; delivery sibling at `index.html:3984`; backup export serializes the polluted cache at `index.html:2893-2895`.
8. Root cause + invariant id: no existing invariant exactly names "no credential-bearing actor object in records". Add proposed `I-84`: credential-bearing user objects must never be embedded in transaction, transfer, notification, DOM, backup, import, or sync payloads. The code fixed `Transfer.createdBy` and email payloads but left transaction `by` fields using full `Auth.user()`.
9. Business impact: a backup file or local IndexedDB copy now contains password/PIN hashes and active session markers for staff. Anyone with access to the browser profile, a backup JSON, or malware/XSS that reads IndexedDB gets offline-crackable PIN/password material.
10. Fix recommendation: replace `by: u` and `by: Auth.user()` with `by: Auth.actor()` or remove `by` entirely and keep only `staffName`. Add a defensive scrub in `DB.addTransaction*`, `DB.addTransactions*`, `atomicTransferWrite*`, `atomicDeliveryWrite`, backup export, and import to strip legacy credential fields from any transaction actor payload.
11. Regression sentinel: add `S-15`: create a transfer and delivery with marker user fields, read back Dexie rows, assert no `password`, `passwordHash`, `pin`, `pinHash`, or `currentSession` anywhere in transactions or backup JSON.
12. Post-fix verification: not run; no code changes made.
13. Deploy-blocking status: BLOCKS.

### GPT-EXT-002

1. Finding ID: GPT-EXT-002
2. Severity: P1
3. Affected surface: ref-data/settings write paths still using non-durable `DB.commit()` before success UI
4. Repro steps:
   - In real Chromium, boot app and authenticate as director.
   - Persist a known supplier value with `DB.commitDurable()`.
   - Stub `bobDB.products.bulkPut` to reject.
   - Call the real supplier save path `Pages._saveSupplier(productId)`.
   - Capture toast/fatal timing, cache value, and Dexie value.
5. Chromium evidence:
```json
{
  "productId": "BDW_1",
  "beforeDexie": "BEFORE_SUPPLIER",
  "immediateCache": "AFTER_SUPPLIER",
  "afterDexie": "BEFORE_SUPPLIER",
  "events": [
    {"kind": "toast", "msg": "Supplier info saved", "type": "success", "ms": 0},
    {"kind": "fatal", "msg": "A save to this device failed (Commit (ref data)). Your last change may not have been saved - contact your administrator.", "ms": 3534}
  ]
}
```
6. Screenshot/video: not needed; event timing and Dexie/cache values prove the false-success path.
7. Code location: `index.html:3056-3061`; root write helper `db.js:338-350`. Sibling `DB.commit()` success paths include `index.html:2595`, `index.html:2784`, `index.html:2819`, `index.html:2827`, `index.html:3061`, `index.html:3770-3772`, `index.html:3802`, `index.html:4108-4110`, `index.html:4188`, `index.html:4193`, and `phase2.js:1514-1515`.
8. Root cause + invariant id: violates `I-20` and `I-21`. The UI still reports success before durable IndexedDB persistence, and cache is not rolled back when the background ref-data persist fails.
9. Business impact: salon staff/director can see "saved" settings, supplier, user, PIN, cost, or threshold edits that disappear on reload. A later fatal overlay helps, but it arrives after the false success and leaves the in-memory screen in the wrong state.
10. Fix recommendation: convert each user-facing ref-data mutation to an async durable path that snapshots old state, awaits `DB.commitDurable()`, rolls back/refreshes on failure, and only then shows success. Where a shared helper exists (`Pages._commitSettings()`), route every settings/ref-data path through it.
11. Regression sentinel: add `S-16`: force `bobDB.products.bulkPut`/`bobDB.users.bulkPut` failure, drive supplier/user/PIN save, assert zero success toast, fatal shown, cache rolled back, Dexie unchanged.
12. Post-fix verification: not run; no code changes made.
13. Deploy-blocking status: BLOCKS.

### GPT-EXT-003

1. Finding ID: GPT-EXT-003
2. Severity: P1
3. Affected surface: backup/localStorage migration and load-from-Dexie boundaries into raw HTML templates
4. Repro steps:
   - In real Chromium, pre-seed `localStorage['bob_stock_v4']` with a backup-shaped dataset whose product name is `<img src=x onerror="window.__xssImport=1">`.
   - Load `index.html`, allowing `_migrateFromLocalStorage()` and `initDB()` to import it.
   - Authenticate locally and render `Pages.storeStock()`.
5. Chromium evidence:
```json
{
  "storedName": "<img src=x onerror=\"window.__xssImport=1\">",
  "renderedContainsImgTag": true,
  "xssFired": true,
  "htmlSample": "<span style=\"color:#6b7280;font-size:.8rem;margin-left:8px\"><img src=\"x\" onerror=\"window.__xssImport=1\"></span>"
}
```
6. Screenshot/video: not needed; the probe shows script execution through `window.__xssImport`.
7. Code location: sanitizer only runs on `save`/`commit`/`commitDurable` at `db.js:299-312`, `db.js:315-318`, `db.js:338-340`, `db.js:598-600`; `DB.refresh()` loads without sanitizing at `db.js:749-751`; localStorage migration persists raw data at `db.js:779-786`; app init loads raw data at `db.js:850-852`; raw render sinks include `index.html:1714`, `index.html:1720`, `index.html:1739`, and many sibling `p.name`/`s.name` templates.
8. Root cause + invariant id: violates `I-80` and `I-83`. The fixed code relies on persistence-time sanitization, but import/migration/load boundaries bypass it and existing raw HTML templates then execute the dirty data.
9. Business impact: restoring a backup or migrating legacy localStorage can execute arbitrary JavaScript in the director/staff browser. That script can read local IndexedDB, including the credential-bearing transaction rows from GPT-EXT-001.
10. Fix recommendation: call `_sanitizeNames()` immediately after `_loadFromDexie()` in `initDB()` and `DB.refresh()`, before any render; sanitize before `_persistAllToDexie(old)` in `_migrateFromLocalStorage()` and before backup restore persistence. Also escape high-risk raw sinks instead of relying solely on mutation of stored data.
11. Regression sentinel: add `S-17`: seed backup/localStorage with product/store/category/productType names and ids containing an `<img onerror>` payload, boot and render store stock/HO stock/settings, assert no execution and no raw tag in DOM.
12. Post-fix verification: not run; no code changes made.
13. Deploy-blocking status: BLOCKS.

## INFO Confirmations

- `npm.cmd run smoke` was green: 14/14 clean sentinels passed.
- `npm.cmd run saboteur` was green after longer timeout: 11 CAUGHT / 0 BLIND / 0 skipped.
- S-04 watermark clamp was behavioral, not a source-string check, and passed under Perth, Sydney, and UTC: `5000 -> 5000`, merged true in all three.
- Transfer records and transfer emails used safe actor snapshots for `createdBy`: actor keys were only `id,name,role,username`.
- Transfer email did not contain credential markers in the transfer create probe.
- The no-email-on-failed-write sentinel held: S-03 clean path reported `emailCalls=0`.
- Bulk intra-batch dedupe sentinel held: S-12 clean path reported `count=1 delta=8`.
- Safe integer input sentinel held: S-13 rejected huge, fractional, and negative values.
- Cross-store receive sentinel held: S-10 left transfer `in_transit` and created no receive transaction.
- `sync.js` SharePoint transaction egress (`_toSharePoint`) does not include the local transaction `by` object; GPT-EXT-001 is confirmed local/backup exposure unless another export path is added.
- Deferred email design call: current code emails after local durable write, not after SharePoint push ack. I do not raise this as a new P1 because D-023 explicitly defers it. My ruling: acceptable for alpha only if emails clearly indicate sync may still be pending; before beta, prefer an idempotent side-effect outbox that sends after push ack or as part of a server-side push/email workflow.

## Probe Table

| Area | Runtime evidence |
|---|---|
| Harness clean | 14/14 smoke PASS |
| Harness mutation | 11 CAUGHT / 0 BLIND / 0 skipped |
| Verify scaffold | 56 PASS / 1 stale size FAIL / 1 expected APP_VERSION fail |
| Credential leak | 2 Chromium probes: transfer and delivery rows read from Dexie with marker hashes/session |
| Ref-data false success | 1 Chromium probe: success toast at 0 ms, fatal at 3534 ms, Dexie unchanged |
| Import/migration XSS | 1 Chromium probe: raw backup product name executed on store stock render |
| Timezone cursor | Perth/Sydney/UTC live pull clamp all PASS |

This is not a complete clean-signoff pass under the framework's 950-probe floor. It is a blocking audit: confirmed issues are sufficient to reject ship readiness.

## Lens x Surface Summary

| Lens | Result |
|---|---|
| L3 Boundary symmetry | FAIL: sanitizer exists at commit boundary but not load/migration/restore boundary. |
| L8 XSS/content injection | FAIL: backup/localStorage product name reaches raw `innerHTML` sinks. |
| L13 Saved-before-saved | FAIL: ref-data `DB.commit()` paths still show success before durable persistence. |
| L14 IndexedDB transaction semantics | PASS for smoke-covered append/atomic paths; FAIL for ref-data fire-and-forget rollback. |
| L15 Append-only ledger | PASS for dedupe sentinels; FAIL for unsafe actor payload embedded in ledger rows. |
| L19 Email ordering/security | PASS for no email on failed transfer write; DEFER for push-ack timing per D-023. |

## Honesty Notes

1. I stopped at a blocking report; I did not complete the full seven-pass 950-probe clean-signoff floor.
2. I did not edit app code or attempt fixes.
3. I did not inspect Gemini/peer external findings; the run was independent.
4. I did read internal phase summaries only to locate the fixed repo path and current W16 state.
5. I did not hit any real Logic App; all Chromium probes routed `**logic.azure.com**` to mocks.
6. I did not run real two-OS-device sync; concurrency confidence is from shipped smoke/saboteur and targeted code/probe review.
7. I did not prove SharePoint ever receives the transaction `by` credential object; `_toSharePoint` appears to exclude it.
8. I did prove backup/local IndexedDB exposure for the credential object.
9. I did not brute-force a PIN hash; offline crackability is a security inference from the stored hash exposure.
10. I did not enumerate every raw `p.name`/`s.name` sink dynamically; the import XSS probe proves the class, and static grep shows many siblings.
11. I did not clear `node_modules`/`package-lock.json` created by the mandated `npm install`; they are test setup artifacts.
12. I treated `verify-app.js` size failure as scaffold drift per the v2 brief, not as a product defect.

## False-Negative Top 10

1. Other full-user object copies in non-transaction tables such as `stockTakes`, `costHistory`, or future audit logs.
2. Backup export leaking additional secrets beyond transaction `by` fields.
3. XSS through store/category/productType raw template sinks not exercised by the single product-name probe.
4. Import restore bypassing more invariants than qty sanitization and names, especially ids and prototype keys.
5. Ref-data `DB.commit()` paths with different failure modes than `products.bulkPut` rejection.
6. Email side-effect duplication when local durable save succeeds but push repeatedly fails and user retries manually.
7. Multi-tab leader demotion edge cases under real mobile browser background throttling.
8. Push/pull idempotency when Logic App returns partial success with malformed `processedCount`.
9. Stock-take email HTML injection via product names in the generated summary at `index.html:1890-1892`.
10. Legacy dirty Dexie state from pre-W16 installs that never passes through a new commit before render.

## Verdict

BLOCK.

Severity counts from this external pass: P1 = 3, P0 = 0, P2 = 0, P3 = 0, INFO = 11.

The fixed code is not ready for alpha/beta deploy. The harness itself is in much better shape than earlier internal reports, but the app still has confirmed ship-blocking issues:

- credential-bearing user objects are durably stored in transaction rows;
- ref-data write paths still show success before durable persistence and do not rollback cache;
- backup/localStorage migration can execute stored XSS before sanitization.

Recommended next wave:

1. Slim/scrub every actor payload in transaction rows and backup/import paths.
2. Convert all user-facing `DB.commit()` ref-data saves to awaited durable writes with rollback.
3. Sanitize on every load/import/migration boundary and escape the remaining raw name/id sinks.
4. Add sentinels S-15/S-16/S-17 and mutation tests for each.
5. Rerun smoke, saboteur, targeted external probes, then the full seven-pass framework before shipping.
