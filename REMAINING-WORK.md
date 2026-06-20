# BOB Stock App — Remaining Work (reconciled 2026-06-20; Bucket-B re-verified against live code 2026-06-21)

**Purpose:** the authoritative "what's actually left" list, reconciled from the real docs (not memory) so we can chunk the next phase and run each chunk past GPT + Antigravity before building.

**2026-06-21 re-verify:** every Bucket-B `NEEDS-VERIFY` item was read against the current code on branch `fix/cli-tri-audit-2026-05`. Each now carries a verified tag — **[OPEN✓]** (confirmed still broken, real work), **[DONE✓]** (already fixed in waves G–L, do not re-touch), or **[PARTIAL✓]** (half-done). Evidence is `file:line` in the live code. Section 0 backend/build facts were also confirmed.

**How this was built:** cross-referenced (a) `BLIND-AUDIT-CONSOLIDATED-REPORT.md` + `BLIND-AUDIT-TRACKING.md` = the *full* ~75-finding plan; (b) `WAVE-G…L` build records = what was actually *fixed*; (c) `SERVER-SIDE-REQUIREMENTS.md` = the Azure punch list; (d) a code-reconstructed inventory of the *existing* backend. The blind-audit docs are a PLAN (they record no fixes), so "done" comes only from the wave records. Where the two disagree, the item is marked **NEEDS-VERIFY** (check current code before scheduling).

**Status legend:** DONE (committed Waves G–L) · OPEN-CLIENT (browser-fixable now, no Azure) · NEEDS-AZURE (server/Logic-App/SharePoint) · ACCEPTED (owned decision, mostly beta-gated) · NEEDS-VERIFY (confirm against current code).

---

## 0. What ALREADY EXISTS in the backend (build additively on this)
- **Azure Static Web App** `bob-stock` (Free tier) → `https://gray-island-05e673800.7.azurestaticapps.net/`, GitHub-auto-deploy on push to `main`. RG `bob-stock-sync`, sub `BOB-Stock-App`.
- **4 Logic Apps** (all `*.logic.azure.com`, wired + working): `config` (bootstrap: serves sync URLs + versioned `master_data` catalogue), `push-v2` (writes StockTransactions, server dedup by TransactionId, returns `{status, processedCount, serverTimestamp}`), `pull-v2` (paginated reads filtered by `SyncTimestamp`), `email` (transfer + stock-take notifications).
- **4 SharePoint lists:** StockTransactions (append-only ledger; full column set incl. tombstone fields — code-verified), Products, Stores, AppConfig (`ConfigType`/`ConfigData`; values `sync_config`, `master_data`).
- **Auth/secrets:** SAS-in-URL. Only `CONFIG_URL` ships in the build; config hands back push/pull/email URLs (SAS-bearing) into `sessionStorage` only. **No server-side auth exists.**
- **The gap is NOT "no backend" — it's that the backend does no VALIDATION/AUTH/IDEMPOTENCY and doesn't sync the transfer/delivery/stocktake RECORDS.** That's what the Azure phase adds.
- ⚠ Cleanup flags (2026-06-21 **CONFIRMED**): index.html loads `sync.js` at line 377 — `sync-v2.js` is never loaded (dead; `test/verify-app.js:87` even asserts its absence). The SWA deploy token **is** committed in plaintext in `.github/workflows/deploy-swa.yml` (not a `${{ secrets.* }}` ref) — **rotate it + move to a GitHub Secret.** `migrate-v2.js` is a dead manual one-off (nothing loads it).

---

## BUCKET A — NEEDS AZURE / SERVER (cannot be done in the browser)
This is the core of the next phase. Sources: SERVER-SIDE-REQUIREMENTS.md (10 items) + Tier-6 blind-audit cluster + items the waves explicitly banked to Azure.

### A-P0 — before any multi-store / beta use
1. **Multi-table record sync (#13 / C1 / G1-15)** — transfers, deliveries, stock-takes (and catalogue edits) currently DO NOT sync across devices; the whole multi-store feature is single-device. **×4 auditor convergence — the #1 blocker.** Needs: new SharePoint lists (or extended schema) + push/pull endpoints for these record types + client `sync.js` envelopes. *Also unblocks the K2/K4 deferrals below.*
2. **Transfer-receive idempotency (#9 / GPTa-21 / Gemini CRIT-02)** — server must reject a duplicate `(TransferId, Type='transfer_in', StoreId)` from a 2nd device. Client has only an interim local guard. Logic App: push-v2.
3. **Ingest validation on push-v2 (GPT H-01/M-02, Gemini CRIT-04)** — server must reject bad Qty/money, unknown Store/Product, reserved keys, hostile id chars, bad Date, invalid Type → quarantine list (don't silently drop). Logic App: push-v2.
4. **Master-data publish path + catalogue WRITE endpoint (Gemini CRIT-01 upstream)** — the pull/merge half exists; the upstream publish (keep AppConfig `master_data` current + bump version) and a NEW catalogue-write Logic App (so Directors can push new products/prices up) do not. *Decision needed: auto-on-list-change vs manual "publish" flow.*
5. **Authorization at the cloud boundary (P-13 / GPT M-02)** — Logic Apps must check actor/role/store-scope server-side before accepting writes. *Decision needed: per-store shared secret vs per-device registration.*
6. **Unknown-product / cursor-advance data loss (H-2 / GPT-8 / Ca-H3)** — movements for a not-yet-synced product get dropped while the cursor advances past them = permanent loss. Partly mitigable client-side (Ca-H3: only skip own-device row if `localIds.has(id)`); full fix needs the catalogue-sync above.

### A-P1 — before scale
7. **SharePoint 5,000-item threshold** — add indexed columns `SyncTimestamp` + `TransactionId` on StockTransactions BEFORE the ledger crosses ~5k rows, or pull-v2 starts failing. (G1-18/G1-31.)
8. **Staging environment (GPT M-03)** — disposable SharePoint site + Logic Apps so we can test the real cloud path with write isolation. **This is effectively chunk #1 — everything else tests against it.**
9. **SAS rotation / expiry policy (GPT M-02)** — document + automate Logic App key rotation. (Also: real SAS values are in old git history — rotate before beta.)

### A-P2 — hardening / config
10. **Email URLs fully via config** — confirm no hardcoded fallback (MFL-010 mostly done).
11. **Self-host Dexie/Chart.js + Google Fonts** — vendor into the SWA so first load doesn't depend on CDNs (build/deploy change).
12. **Cross-device category metadata in sync payload** (K2 banked) — `stockTo`/`stockFrom`/store-id not in the push payload; needs server columns + schema (rides on #1).
13. **Price-at-time snapshot cross-device** (K4 banked) — `unitPriceAtTime` stamped + used locally but not pushed; needs Azure schema (rides on #1).
14. **iOS 7-day eviction** — mitigation is the client "last synced" indicator (done) + weekly-open guidance; nothing server beyond reliable pull.

### Accepted-for-alpha that MUST move server-side before beta (overlaps Bucket C)
- Server-side auth/authz/store-enforcement, PIN/password redesign + server lockout, append-only audit log, observability/alerting. (P-13 / D-039 family.)

---

## BUCKET B — STILL-OPEN CLIENT-SIDE (browser-fixable now, no Azure)
You're right that not all bugs are done — there's a real client tail beyond Azure. None of these need the backend.

### B1 — Tier 5.5 Accessibility (runtime-verified open; not touched in G–L)
- **W3-10 [OPEN✓]** core flows keyboard-inaccessible — sidebar `<a onclick>` no href/role/tabindex (index.html:5091); filter chips are `<span onclick>` (1725/1940/1941/2064). Mobile bottom-bar uses real `<button>` so it's OK; desktop sidebar + chips are not. A keyboard/screen-reader user can't do the 2 daily tasks on desktop.
- **W3-11 [PARTIAL✓]** modal now sets `role=dialog`/`aria-modal`/`aria-labelledby` (1323) so it announces itself — but still NO focus trap (zero keydown/Tab handling) and the PIN-lock overlay (1382) has no role and no focus management at all.
- A11y low cluster: placeholder-only labels, no aria-live on toasts, no heading hierarchy, broken skip-link, colour-only status.

### B2 — Tier 7 Performance (open; not touched in G–L)
- **Ca-P1 [PARTIAL✓]** the `qty()` side is now O(1) (precomputed `_qtyCache`, db build 1064-1073), so the ×txns factor is gone — BUT `Stock.currentCost()` (1219) still re-filters+re-sorts the whole cost-history on every call, run once per product per store in the analytics loop (2831). Still unmemoized → slows as price history grows.
- **Ca-P2 [OPEN✓]** both views hard-cap 500 rows silently — All Movements (2530) and Reports→Transaction Log (2868) both `slice(0,500)` with no pagination and no "showing 500 of N" indicator.
- (G1-19 in-memory full-ledger OOM ceiling = known scaling limit, monolith-split territory — borderline Bucket C.)

### B3 — Thresholds / reorder (Tier 5 stragglers — RE-VERIFIED 2026-06-21)
- **W3-5 [DONE✓]** no "Save All" / separate optimum-levels page exists anymore (grep zero hits); only per-row `_saveThr` (3113) which guards against negatives and stores a blank as `null` not `0`. The catalogue-wide-zero bug cannot occur. **Drop from list.**
- **W3-7 [OPEN✓]** Reorder List still ignores `optimumQty` — `reorderQty=Math.max(thr.minQty*2-qty,thr.minQty)` (3796); `optimumQty` is saved + displayed but never read by the reorder math.
- **W3-6 [DONE✓]** unified — one editor `settingsThresholds()` (3076) with min/optimum/lead-days in one table, single `_saveThr` save path; no rival editor exists. **Drop from list.**

### B4 — Financial / reports leftovers (Tier 4 deferred in K1; RE-VERIFIED 2026-06-21)
- **#11 [OPEN✓ PARTIAL]** reconciliation baseline has two real flaws: (a) `if(!(t.date>td))continue` (4032) drops **same-day** movements (a sale logged the day of the count vanishes → phantom discrepancy); (b) no active/void filter, so cancelled movements still skew the baseline.
- **#12 [DONE✓ / non-issue]** all exports present and wired (`_exportCSV`/Stock/Movements/Products/Wastage/Reorder/FI); no missing or orphaned "analytics CSV". **Drop from list.**
- **GPTC-C [DONE✓]** "All Transactions CSV" DOES honour on-screen store + date filters (`_getRepFilters`, 2926-2935). Minor: it doesn't carry the category/product-type filter into the file (small follow-up, not the flagged bug).
- **GPTC-A/GPTa-33 [OPEN✓]** "Test Connection" pull test is a bare `fetch(pullUrl)` GET (3512); real contract is POST `{since}` — a green tick proves nothing. Setup-guide text (3486-3490) still describes legacy Power Automate flows.
- **cost-ratchet [OPEN✓ PARTIAL]** ratchet holds ONLY on the delivery path (4636); the lookup engine `currentCost` (1219) and the manual cost editor `_saveCostEntry` (4356) do NOT ratchet — a director can type a lower cost and it sticks. Same-day cost entries have **no tiebreaker** (date-string sort only) → "current cost" can flip nondeterministically. Rounding is per-line (correct/acceptable).

### B5 — Tier-5 client correctness (RE-VERIFIED 2026-06-21 against live code — 12 OPEN, 2 DONE)
- **GPTa-36 [OPEN✓]** user EDIT path (`_updateUser` 3206) has no duplicate-username check and no last-Director guard (the ADD path has the dupe check at 3176, edit doesn't); `_deleteUser` (3222) can delete the last Director → lockout.
- **GPTa-37 [OPEN✓]** `_deleteLog`/`_confirmDelete` (1856/1875) have NO `Auth.can` role gate — only a typed name + reason; Delete button shown to every user (1852).
- **GPTa-41 [DONE✓]** `_setProductFranDisc` (2971) stores `null` (not `0`) when cleared; invoice logic uses `!= null` to fall through to store default. **Drop from list.**
- **GPTa-42 [OPEN✓]** `_approveStockTake` (2181) only guards `status==='approved'`, never `'rejected'` — a rejected take can still be approved.
- **GPTa-43 [OPEN✓]** `_deleteCat`/`_deletePT` (3061/3056) just filter the array, no check for products referencing it → orphans.
- **GPTa-45 [OPEN✓]** multi-store non-franchisee gets no store picker; `hasMultiLoc` (1467) excludes them → silently logged to `storeIds[0]`.
- **GPTa-38 [OPEN✓ PARTIAL]** duplicate product lines in one delivery: cost calc reads pre-loop `prevCost` per line and overwrites `prod.costPrice` per line (last wins, 4636-4643). Stock **quantities are correct**; only the saved cost price is clobbered.
- **GPTa-24 [OPEN✓]** boot loads seed then renders UI before the first pull (5315-5321) — fresh device usable on stale seed numbers.
- **GPT-9 [OPEN✓ PARTIAL]** `_prerestore` copy is written (3393) but NOTHING ever reads it — no rollback is actually possible. Hollow safety copy.
- **GPT-10 [OPEN✓]** backup checksum computed on export (3309) but never recomputed/compared on import (3316-3379).
- **GPT-13 [DONE✓]** `commit()` clear+rewrite now wrapped in a single atomic Dexie `rw` transaction (db.js:53/56, 98/101) — no race window. **Drop from list.**
- **GCLI-2 [OPEN✓]** session token written to IndexedDB users table via `DB.commit()` (868-869), not sessionStorage-only — extractable with device access.
- **Ca-M15 [OPEN✓]** backup import checks `users` is an array but validates no per-user role/username/password (3322-3323) → crafted backup can inject a Director.
- **Ca-M17 [OPEN✓]** `staticwebapp.config.json` navigationFallback has no `exclude` array → a mis-deployed `.js` is served HTML under its URL.
- **W5 [OPEN✓]** `Sync.pull` merge (sync.js:982-1020) has no `storeId` filter — every device stores the whole company ledger incl. other stores' movements + supplier/invoice refs; scoping is screen-only. *(Egress/scope part is client-fixable; full enforcement is P-13/Bucket-A.)*
- minor (NOT re-verified this pass): neg-stock amber-vs-red, date-preset month-end overflow, device-id key mismatch, GPT-16 quarantine-label, GPT-18 Math.random ids, GPT-5b/5c SW icon path + brittle addAll, GPTC-2 backup import asymmetry.

### B6 — Write-path hygiene pass (auditor-sanctioned defer; ~16 handlers)
- Idempotent-upsert + fresh-id duplicate guards on the remaining ref-data handlers (`_updateUser/_updateCat/_updatePT/_updateStore/_setProductFranDisc/_saveThr/_removeThr/_setStockTakePin/_clearStockTakePin/_rejectStockTake/_deleteUser`, `_saveNewUser/_doAddProduct/_saveNewStore`, `_saveCat`/`_savePT`).

### B7 — Dead-code cleanup (cosmetic — all CONFIRMED dead 2026-06-21)
- `generateDemoTransactions` (index.html:647-842, ~195 lines, zero callers), `Sync._mergeTransactions` (sync.js:1131, zero callers), `sync-v2.js` (never loaded; absence asserted by `test/verify-app.js:87`), `migrate-v2.js` (manual one-off, unreferenced). NOTE: `DB._migrate` (db.js:285) is a confirmed no-op stub — but do NOT confuse it with `DB.pruneSyncedTombstones()` (db.js:403, called at 1039) which is LIVE. (The `_downloadCSV`/`_exportStockCSV` dupes were already removed in L3r2.)

---

## BUCKET C — ACCEPTED-FOR-ALPHA (owned decisions; most must harden before beta)
Not bugs to "fix" now — recorded decisions. Listed so nothing's forgotten.
- **P-13** client-side auth/route-gating is convenience, not security → server-side before beta (Bucket A-5).
- **D-039** unsalted SHA-256 password/PIN, no lockout, hashes in backup, default PIN "1234" → harden before beta (server).
- **SAS-in-URL** extractable with DevTools → accepted-alpha (Bucket A-9).
- **MED-01** float penny-drift (cents-model) — accepted by Kunal.
- **D-037 / G1-35** CDN dependency + CSP `unsafe-inline` — tied to the monolith split (Bucket A-11 covers vendoring).
- **G1-38** background-sync handler is a no-op stub — deferred.
- name-sanitization tradeoff (`L'Oreal 5" Brush`) — reconsider.

---

## Suggested sequence for the Azure phase (smallest-risk-first; each chunk: spec → GPT+AGY review → your OK → Cowork/CLI executes → contract test → your OK)
1. **Staging environment** (A-8) — stand up a test SharePoint site + Logic Apps. Nothing else can be safely tested without it.
2. **Indexed columns** (A-7) — cheap, additive, removes the 5k time-bomb.
3. **Ingest validation + quarantine** (A-3) — additive to push-v2, big safety win, no schema change.
4. **Transfer-receive idempotency** (A-2) — additive to push-v2.
5. **Multi-table record sync** (A-1) — the big one; new lists + endpoints + client envelopes. Pulls in A-6, A-12, A-13.
6. **Cloud authorization** (A-5) + **master-data publish/write** (A-4) — needs your design decisions first.
7. **SAS rotation** (A-9), **self-host assets** (A-11), config tidy (A-10).

Then: the client tail (Bucket B) can be done in parallel browser waves anytime — independent of Azure.
Then: **one final full blind audit** over the complete app → merge to `main` → deploy → live smoke. (No full audit before this, per Kunal — it would only re-flag the still-open items.)
