# Blind Audit Tracking — 2026-06-11

Running ledger of the 6 unprimed AI audits (3 CLIs + 3 apps), given the app with
NO framework / NO "already-fixed" list / NO context. Each finding triaged against
the real code + our decision log. Goal: surface anything GENUINELY NEW that our
4 primed rounds missed. NO FIXING until all 6 audits are in.

Triage codes: **NEW** = genuine, not in our log, verified real · **NEW?** = plausible, needs deeper repro · **KNOWN** = already in decision log / punch list (accepted/deferred) · **FALSE** = verifiably wrong (we have it / doesn't apply).

---

## AUDIT 1 — Gemini app (standard) — ~41 findings

### 🔴 GENUINE NEW — BANKED (verified real against code)

| # | Finding | Verdict | Evidence | Sev |
|---|---|---|---|---|
| G1-22 | **Tombstone egress black hole** — offline delete is queued as a `type:'deleted'` row (`sync.js` pushTombstone catch → `DB.addTransaction(localTombstone)`); next `push()` runs it through my F-followup-2 `_egressOk`, which rejects any direction not in/out → **`'deleted'` is rejected → offline deletes NEVER sync → ghost stock on every other device.** | **NEW — my regression** | `_egressOk` rejects `_dir!=='in'&&!=='out'`; tombstone dir='none'. Confirmed by reading both paths. | **P1** |
| G1-7 | **Ghost resurrection (pull ordering)** — `pull()` processes tombstones (line ~944, gated on `localIds.has(originalId)`) BEFORE merging `newTransactions` (line ~970). A create+delete arriving in the same pull batch: the tombstone's target isn't in `localIds` yet → tombstone dropped → txn then added → never deleted. | **NEW** | sync.js:890/944/970 — order confirmed. | **P1** |
| G1-15 | **Multi-table sync gap** — only the `transactions` table syncs. `transfers`, `deliveries`, `stockTakes` RECORDS never push/pull (grep: zero sync refs). Store B sees the stock movement but never the transfer record to "receive" it. (Partial overlap with the original Gemini CRIT-01 "islands" — we fixed catalogue via master_data, NOT these workflow records.) | **NEW (architectural; partially-known family)** | no transfers/deliveries/stockTakes in sync push/pull. | **P1 / Azure** |
| G1-12 | **Master-data version durability** — my F3 `_applyMasterData` bumps `localStorage 'bob_catalogue_version'` (sync.js:242) right after a fire-and-forget `DB.commit()` (241), not `commitDurable()`. If the background persist fails (quota/tab-close), the version advances anyway → next launch `version<=lastApplied` skips → **catalogue desyncs forever, never retries.** | **NEW — my code** | sync.js:241-242. | **P2** |
| G1-11 | **Offline-tombstone audit metadata loss** — the offline `localTombstone` object omits `DeletedBy`/`DeletedAt`/`DeleteReason`; on later egress the deletion audit trail is empty. | **NEW** | sync.js localTombstone fields (read). | **P2** |
| G1-5 | **Zero-value delivery drops header costs** — `_updateDeliveryCalc`/`_saveDelivery`: when `totalLineVal===0` (all $0 items) AND no weights, both `freightCustomsShare` and `taxShare` fall back to 0 → freight/tax/customs evaporate from landed cost. | **NEW (edge case)** | index.html:4233-4235, 4294-4296. | **P3** |
| G1-2 | **Aggressive name sanitization corrupts legit data** — `_sanitizeNames` strips `<>"'\`` from names on save, so `L'Oreal 5" Brush` is permanently stored as `LOreal 5 Brush`. Real UX/data tradeoff (we chose strip-at-source + esc-at-render; the apostrophe/quote stripping is the cost). | **NEW (design tradeoff to reconsider)** | db.js _sanitizeNames. | **Med** |
| G1-35 | **CSP `unsafe-inline`** — `staticwebapp.config.json` allows `'unsafe-inline'` in script-src + style-src (monolith forces it). Weakens XSS defense; proper fix = nonces/hashes (tied to monolith split). | **NEW (real, known-tradeoff)** | config has unsafe-inline ×2. | **P2** |

### 🟡 NEW? — plausible, needs deeper reproduction (not yet banked)

| # | Finding | Note |
|---|---|---|
| G1-3 / G1-14 / G1-39 | **`refresh()` overwrites `_cache` wholesale** — could wipe a cache-only in-flight write during the await; also undebounced IPC could fire many refreshes. Recurring theme across 3 findings; plausible race. Needs a real probe to confirm a losing window exists. | verify |
| G1-9 / G1-17 | **Follower-tab races** — 400ms leader-refresh window vs slow mobile flush; `_becomeLeader` may not drain the pending queue. Needs the actual leader/follower timing code checked. | verify |
| G1-16 | **`commitDurable` rollback** — does it restore `_cache` arrays or only `_v`? If a caller pushes a product into `_cache` then commitDurable fails, a phantom may persist. (Note: product-add path calls `_commitSettings` which does `refresh()` on failure — likely mitigated; verify.) | verify |
| G1-29 | **Dead 30-day transfer prune** — `DB._migrate` is a no-op (db.js:285); phase2 patches it but if `_migrate` is never invoked, pruning never runs → transfers bloat. Need to confirm invocation. | verify |
| G1-36 | **Non-atomic bulkPut** — some paths wrap bulkPut in `bobDB.transaction` (atomicTransferWriteDurable, _persistAllToDexie), some may not (addTransactionsDurable). Mid-array quota error → partial write. Verify which paths are unwrapped. | verify |
| G1-13 / G1-25 | **Clock-skew cursor / tombstone-not-serialized-with-push** — pull cursor fallback + pushTombstone ignoring `_syncLock`. Partly server-side; verify the client cursor fallback. | verify |
| G1-8 | **Egress-quarantine "Synced ✓" while a bad local row still affects local stock** — a refinement of my F-followup-2 egress filter (exclude+log, but don't reverse the local delta or alert). Valid UX/consistency point. | refine |

### ⚪ KNOWN — already in our decision log / Azure punch list (accepted/deferred)

- G1-1, G1-26, G1-34: server-side auth / unauthenticated config / trusted client timestamp → **P-13 + SERVER-SIDE-REQUIREMENTS.md** (Azure P0/P1). Accepted-alpha.
- G1-6, G1-27, G1-28: client-side PIN/audit "bypass", server edits ignored → **P-13** (client-side is convenience only; append-only by design).
- G1-18, G1-31: OData `$skip` pagination / Logic-App throttling → **SharePoint 5k + server dedup** (server dedup by TransactionId already exists; throttling = Azure-phase).
- G1-19: in-memory ledger OOM at 50k+ → known scaling ceiling of the sync-cache shim (my deep audit: clean at 12k; mobile 50k+ is the real limit). Monolith-split / on-demand-query backlog.
- G1-38: background-sync handler is a no-op delegating to DOM → **KNOWN** (CLAUDE.md: "SW registers sync but no handler exists yet").
- G1-40: float penny-drift → **MED-01** (cents-model deferred, Kunal-accepted).
- G1-20, G1-21: localStorage migration quota / seed-resurrection on count===0 → legacy-migration + edge cases (products deactivate not delete, so count rarely 0). Low real-world; note.

### ❌ FALSE — verifiably wrong (Gemini app couldn't see our fixes)

- G1-30: "completely fails to invoke Persistent Storage API" → **FALSE.** We call `navigator.storage.persist()` (index.html:4953, Wave A / D-034).
- G1-32: "lacks `skipWaiting`/`clients.claim`" → **FALSE.** sw.js HAS both (lines 35, 52) + an updatefound update-toast (index.html:5137).
- G1-24: "stored XSS executes in the ledger view" → **FALSE.** Every ledger sink escapes `staffName`/`reason` via `UI.esc()` (1521/1564/1732/1868). (Note: re-confirm the stock-take EMAIL HTML path separately — different sink.)
- G1-23: "atomic dedup discards transaction UPDATES" → **FALSE (likely).** Ledger is append-only — transfers/resolutions create NEW transactions, never update an existing id; the dedup is correct. Verify no update-by-id path exists.
- G1-33: "phase2 monkey-patch crashes on null `_cache`" → **FALSE (likely).** App boots cleanly + 52/52; init awaits `initDB` before use. Verify init order, but demonstrably works.

### Architect's "rewrite everything / use RxDB" conclusion
**Opinion, not a finding.** Noted. The real signal is the specific bugs above, not the wholesale-rewrite recommendation (which ignores the working, tri-audited core + the accepted alpha constraints).

---

---

## AUDIT 2 — GPT app — 18 findings + positive notes (higher signal, fewer false positives)

**Notable:** GPT explicitly CONFIRMED our fixes are present & good (watermark pagination, strict push-ack `processedCount`, ingress rejection-not-coercion, crypto transfer IDs, backup import rejects invalid qty/money). Independent blind confirmation that F1/F-followup hold.

### 🔴🔴 CONVERGENCE — GPT + Gemini independently found the SAME (high confidence)
- **Transfers/deliveries/stockTakes don't sync** (GPT#7 = G1-15) → **HIGH CONFIDENCE P1/architectural.** Two blind auditors, independently. The transfer *record* (draft/in-transit/received/flagged/resolved state) never propagates; only the ledger rows do. The receiving store can't see the transfer to receive it.
- **Egress "Synced ✓" lie** (GPT#11 = G1-8) → **HIGH CONFIDENCE.** My F-followup-2 egress filter excludes+logs a bad local row but (a) still lets it affect LOCAL stock and (b) shows "Synced ✓" when only bad rows remain. Needs: blocking quarantine + reverse the local delta + admin-repair UI, not silent exclude.
- **CSP unsafe-inline** (GPT#17 = G1-35) → confirmed both.

### 🔴 GENUINE NEW — BANKED (verified against code)
| # | Finding | Evidence | Sev |
|---|---|---|---|
| GPT-9 | **Backup restore "safety copy" is hollow** — restore reads `localStorage.getItem(DB.KEY)` for rollback, but Phase-3 data is in IndexedDB and DB.KEY was removed at migration → `_prerestore` is empty → the "safety copy saved first" promise is false; a restore overwrites live data with NO real rollback. | index.html:3206 | **High** |
| GPT-15 | **completeFlags partial resolution** — loops `resolveFlag` per flagged line; if a later line fails after an earlier one commits durably, the transfer is left half-resolved. **Sibling of the H-02 packaging all-or-nothing fix — same class, missed here.** | phase2.js:1531-1552 | **Med** |
| GPT-10 | **Backup checksum generated but never verified** — export writes `_meta.checksum`; import validates shape but never recomputes/compares it → corrupted/tampered backup passes. | index.html:3152/3161-3192 | **Med** |
| GPT-13 | **commit() clear-and-rewrite race** — `_persistRefDataToDexie` clears+bulkPuts ref tables async, returns immediately; two rapid commits can overlap, older finishing last → overwrites newer ref data. | db.js:98-130/358-370 | **Med** |
| GPT-12 | **Fire-and-forget still on some success paths** — `confirmDraftItem` uses non-durable `DB.updateTransfer(t); DB.commit()` then shows success. (Most critical paths were made durable in MFL-002; these are residual instances.) | phase2.js:122-129 | **Med** |
| GPT-14 | **Transfer.create coerces invalid qty to 0** — `Math.max(0, UI.safeInt(i.qty)||0)` → blank/invalid becomes a 0-unit transfer line + 0-qty ledger row, instead of rejecting. | phase2.js:79-80/146-160 | **Low-Med** |
| GPT-5b | **SW notification icon path wrong** — sw.js uses `./icon-192.png` (root) for notification icon/badge; file is at `./icons/icon-192.png` → 404. | sw.js:116-117 | **Low** |
| GPT-5c | **SW install brittle** — `cache.addAll(PRECACHE_URLS)` rejects the WHOLE install if any one URL 404s; precache list includes CDN Dexie/Chart (can fail). | sw.js:30-35 | **Low-Med** |
| GPT-16 | **Quarantine label inaccurate** — all reject reasons (unknown product/store/type, fractional, NaN, neg) are logged as generic "negative qty"; should carry structured reason. | sync.js Diag log | **Low** |
| GPT-18 | **Math.random() for device/tab/tombstone IDs** — weaker than crypto (txn IDs already use crypto.getRandomValues). | sync.js:292/322/1045 | **Low** |
| GPT-3 | **%%CONFIG_URL%% build guard (PROCESS)** — raw source ships `CONFIG_URL:'%%CONFIG_URL%%'` (replaced by CI at deploy). Add a build/release gate that FAILS if the placeholder survives into a deployed artifact. | sync.js:54 | **Process** |

### ⚪ KNOWN / ❌ ARTIFACT
- GPT-1,2,6,8: server auth / shipped hashes / sync URLs / catalogue-publish → **P-13 + Azure punch list** (accepted).
- GPT-4: CDN dependency for Dexie/Chart → **self-host backlog** (D-037 partial: pinned+SRI, self-host deferred). Real PWA-offline gap, known.
- GPT-5a "missing icon FILES": **ARTIFACT of my blind packaging** — I copied 7 files but not `icons/` (which DOES exist in repo). Discount across all 6 audits.
- GPT-3 "sync disabled": **expected pre-deploy** — the `%%CONFIG_URL%%` placeholder is CI-replaced. Discount the "sync broken" framing across all 6 audits (the build-guard idea is the keeper).

---

## RUNNING TALLY (after Audit 2 of 6)
- **Genuine NEW banked:** ~19 (Gemini 8 + GPT 11, minus convergent overlaps counted once)
- **High-confidence (≥2 auditors converged):** transfers-don't-sync, egress-"Synced"-lie, CSP unsafe-inline
- **In MY recent code (Wave F/F-followup):** G1-22 tombstone egress (P1), G1-12 master-data version (P2), egress-"Synced"-lie (P2), GPT-15 completeFlags H-02-sibling (Med)
- **Known/accepted:** ~14 · **False/artifact:** ~7
- **Two cross-audit ARTIFACTS to discount everywhere:** (1) "missing icons" = my packaging gap (icons exist); (2) "cloud sync disabled / %%CONFIG_URL%%" = pre-deploy placeholder, CI-replaced.
- **Headline holds:** the blind experiment is finding real bugs the primed rounds missed — most importantly a **P1 in my own F-followup-2 code (tombstone egress)** and a confirmed **architectural gap (transfer records don't sync)** that TWO blind auditors hit independently.

---

## AUDIT 3 — Gemini CLI — 7 findings (cleaner than Gemini-app; real Chromium probing)

### 🔴🔴 CONVERGENCE (now ≥2 auditors → high confidence)
- **completeFlags partial resolution** (GCLI#7 = GPT-15) → **HIGH CONFIDENCE Med.** Multi-line flag resolution is non-atomic (per-line `atomicTransferWriteDurable`); mid-loop failure = half-resolved transfer. **Sibling of the H-02 packaging all-or-nothing fix.**
- **Fire-and-forget silent data loss** (GCLI#4 = GPT-12) → convergent; `addTransaction` mutates cache + `_applyDelta`, background `_appendRecord`, no rollback on failure. (Durable APIs exist for critical paths; residual non-durable usages remain.)
- **O(N) buildCache / ledger-in-RAM** (GCLI#6 = Gemini-app G1-19) → convergent known scaling ceiling (clean at 12k in my deep audit; mobile 50k+ is the limit).

### 🔴 GENUINE NEW — BANKED
| # | Finding | Evidence | Sev |
|---|---|---|---|
| GCLI-1b | **⬆ UPGRADED to HIGH — RUNTIME-PROVEN stored XSS via unsanitized IDs in inline handlers (CONVERGENCE ×2: GCLI-1b + GPTC-F)** — `transactions`/`stockTakes`/`costHistory`/`deliveries`/`transfers` ids are NOT in `_sanitizeNames` (only products/stores/categories/productTypes/users), and a txn id renders RAW into `onclick="Pages._deleteLog('${t.id}')"` (index.html:1736-1737). **GPT-CLI runtime-PROVED execution:** injected id `audit_txn_xss');window.__auditInlineIdXss=1;//` → rendered → clicked Delete → `executed:true`. **Reachable via BACKUP IMPORT** (backup validates qty not `t.id`, index.html:3161-3184) — a shared malicious backup executes XSS with full app authority (sync URLs, director funcs) — AND via sync ingress (`_fromSharePoint` maps TransactionId raw, sync.js:537). Broad sink class (stock-take/user/cost-history/delivery ids = same root). Fix: reject unsafe ids at EVERY ingest boundary + replace inline-handler strings with `data-id`+addEventListener (escape-at-render). | index.html:1736-1737/3161-3184; sync.js:537; _sanitizeNames coll list | **High (runtime-proven)** |
| GCLI-2 | **Session token persisted to disk (ephemeral design defeated)** — `Auth.login` sets `u.currentSession=token` which is persisted into the IndexedDB users table; `Auth.restore` validates against it. The "ephemeral sessionStorage" intent is defeated — the token survives tab-close on disk, extractable with device access. (Backup export already scrubs `currentSession` via `_REUSABLE_AUTH_KEYS`, but it's still in the live DB.) | index.html:867/882/3144 | **Med (device-access)** |
| GCLI-5 | **Split-brain leader election fallback** — `_initLeaderElection`: if `BroadcastChannel===undefined`, EVERY tab sets `_isLeader=true` → all tabs push → duplicate ledger rows. Rare on modern iOS (BroadcastChannel supported since Safari 15.4) and mitigated by server-side dedup-by-TransactionId, but a real latent multi-tab bug on old browsers. | sync.js:314-317 | **Low-Med (mitigated)** |

### ⚪ KNOWN
- GCLI-1a, GCLI-3: incoming-sync not re-sanitized / SAS URLs in sessionStorage → P-13 + Azure punch list (SAS exposure accepted-alpha). The XSS *render* sinks for reason/staffName are esc'd (see G1-24 FALSE); the txn-id onclick sink (GCLI-1b) is the real residual.

---

### AUDIT 3 (cont.) — Gemini CLI deeper-dive findings 8-10
- **GCLI-8** unsalted SHA-256 PIN/password + no lockout → **KNOWN** (D-039 + Round-10 L31; accepted-alpha, harden-before-beta).
- **GCLI-9** transfers table not synced → **CONVERGENCE ×3** (= GPT-7 = G1-15 = GCLI-9). Strongest signal of the whole experiment. HIGH-CONFIDENCE P1/architectural.
- **GCLI-10** **NEW — tombstone dropped on missing push URL** — `pushTombstone`: `if(!this._pushUrl){ return; }` returns BEFORE the local-queue fallback (which lives in the fetch catch block). The comment even says "queued locally only" while doing the opposite. A delete made before sync config loads is permanently lost → cross-device divergence. **Third independent bug in the delete/tombstone path.** sync.js:1039-1042. **High.**

### 🔴 TOMBSTONE / DELETE PATH = cluster of 3 (the weakest subsystem)
1. **G1-22** offline tombstone queued as `type:'deleted'` → my F-followup-2 `_egressOk` rejects it → never syncs. **(P1, my regression — CONVERGENCE ×4: G1-22 + GPTa-19 + Claude-H2 + GPTC-G, the LAST runtime-PROVED it: forced tombstone POST fail → queued → next push sent only normal rows → tombstone stillUnsynced:1.) The single most-confirmed bug of the experiment, and it's in my own code.**
2. **G1-11** offline tombstone omits `DeletedBy/DeletedAt/DeleteReason` audit metadata. (P2)
3. **GCLI-10** no-pushUrl → tombstone dropped entirely, not queued (comment lies). (High)
→ When fixing: rework the whole delete path holistically — always durably queue the tombstone first (with full metadata), then push; and the egress filter must whitelist `type:'deleted'`.

### AUDIT 3 (cont.) — Gemini CLI findings 11-12
- **GCLI-11 "Total backup restore failure" → ❌ FALSE POSITIVE.** Claimed the restore writes to localStorage and is silently ignored (DB unchanged). **Traced the boot path: it WORKS.** `_importBackup` writes `localStorage[DB.KEY]` → reload → `initDB()` calls `_migrateFromLocalStorage()` FIRST (db.js:890), which reads it and `_persistAllToDexie()` into Dexie. The restore lands correctly. (Contrast GPT-9, which correctly found the *separate, real* bug: the `_prerestore` ROLLBACK safety-copy is hollow because it reads the absent localStorage key. Same code, GPT right / Gemini-CLI overstated.)
- **GCLI-12 → DUPLICATE of GCLI-7** (completeFlags partial resolution). No new info.

---

## AUDIT 4 — GPT CLI — 8 findings (security/architecture lens; real Edge/CDP probe)

**Signal: found NOTHING new beyond our documented known items.** A strong security-focused auditor converged entirely on the accepted P-13 / D-039 / Azure-punch-list model → our security posture is fully mapped, no hidden surprises. Also INDEPENDENTLY CONFIRMED my egress filter (tried negative-qty poisoning → rejected → explicitly declined to report it).

- GPT-CLI-1 client auth/RBAC bypassable → **KNOWN P-13** (convergent ×all).
- GPT-CLI-3 SAS URLs in browser → **KNOWN** (Azure punch list).
- GPT-CLI-4 backups export pw/PIN hashes → **KNOWN D-039**.
- GPT-CLI-5 no brute-force protection (login/PIN) → **KNOWN D-039/L31**.
- GPT-CLI-6 CSP inline-script → **banked** (CSP unsafe-inline, now ×3: G1-35, GPT-app-17, GPT-CLI-6).
- GPT-CLI-8 SW install depends on CDN → **banked** (self-host backlog; convergent ×3).
- GPT-CLI-2 SW failed to activate (state redundant/inactive) → **runtime-confirms** the `cache.addAll` brittleness (GPT-app-5c). The icon 404 itself = MY blind-folder packaging gap (icons exist in repo).
- **GPT-CLI-7 route-authorization not centralized** → **NEW-minor (P-13-adjacent).** Some settings pages self-gate (e.g. manageUsers redirect, index.html:2969), but it's per-page not centralized in `navigateTo`; a lower role could RENDER (view) some settings surfaces via manual route call. All state-CHANGING actions remain gated (Wave-B Auth.can matrix), so no mutation is possible — info-disclosure only, within accepted P-13. Cleanup: declare a required capability per route + refuse render in `navigateTo`. **Med (mostly-known).**

### AUDIT 4 (cont.) — GPT CLI "6 more" + Gemini-CLI #12 (runtime-probed)
**GPT-CLI independently CONFIRMED my GCLI-11=FALSE call** — explicitly rejected "restore writes to localStorage is broken" because initDB migrates DB.KEY into Dexie on reload (db.js:887-902). Two auditors + me now agree the restore works.

🔴 GENUINE NEW — BANKED:
- **GPTC-2 backup import asymmetry** — `_validateAndScrubBackup` checks qty/money/reserved-id but NOT known-product/store/type; sync ingress (`_fromSharePoint`) rejects those. Runtime-proven: `productId:"audit_missing_product"` + `type:"not_a_real_type"` returned ok:true. **Boundary-symmetry gap (backup weaker than pull).** index.html:3179-3192 vs sync.js:537-558. **Med.**
- **GPTC-3 delivery shipping cost field-drift (H-03 SIBLING)** — modal creates `del-shipping` (4142) but save/calc read `del-freight`/`del-tax`/`del-customs` (4207-4209/4269-4271). User-entered SHIPPING is silently dropped; `del-customs` is phantom (no UI field → always 0). Runtime: $100 shipping ignored, landed stayed 5 not 15. **Real accounting bug — understates landed cost/margin.** **Med.**
- **GPTC-4 over-received transfers lose the excess** — receive stepper allows up to 9999 (phase2:1112); receive + resolve clamp credit to sentQty (phase2:214/253). Runtime: sent 10, received 12 → item stores receivedQty:12 but ledger credits only 10; the extra 2 vanish. Edge of MY HIGH-02 credit-at-receive. Should reject `received>sent` or book the overage as a director adjustment_in. **Med.**

⚪ CONVERGENT/KNOWN:
- GPTC-1 %%CONFIG_URL%% → artifact (=GPT-app-3; discount, keep the build-guard idea).
- GPTC-5 zero-qty draft submit → convergent =GPT-app-14 (banked).
- GPTC-6 dead 30-day prune (phase2 patches `_migrate`; db.js:284 `load()` no-op; only `DB.load()` called → `_migrate` never invoked) → CONVERGENT ×2 (=G1-29). Confirmed dead code.
- Gemini-CLI-12 client-only business-rule enforcement (store-scoping, transfer-exists checks) → KNOWN P-13/Azure server-validation.

---

## AUDIT 2 (cont.) — GPT app findings 19-28 (transfer/sync deep-dive)

### 🔴 TRANSFER SUBSYSTEM (phase2.js) = the 2nd major weak area (cluster)
| # | Finding | Verdict | Sev |
|---|---|---|---|
| GPTa-21 | **Stale transfer cancel double-counts stock** — `Transfer.cancel` reverses in-transit stock to origin when local status is in_transit, with NO check that another device already received it. Device B receives (credits dest) + stale device cancels (returns to origin) → phantom stock. Needs server-authoritative transfer state; interim: reject cancel if any `transfer_in` ledger row exists for the transferId + require a successful sync first. | **NEW** | **High** |
| GPTa-22 | **Transfer.create can drive origin stock negative** — `create`/`submitDraft` write `transfer_out` rows without checking `Stock.qty(productId, fromStoreId)`. UI limits it; the domain method doesn't (console/stale-state/regression can go negative). | **NEW** | **Med** |
| GPTa-23 | **Receive accepts unvalidated raw receivedQty** — `Transfer.receive` stores `item.receivedQty = rQty` before any validation; the credit clamps but the stored value (used by audit/flags/resolution) can be string/fraction/negative/huge. Should run `Validate.qty` at the boundary. | **NEW** | **Med** |
| GPTa-26 | **Franchisee multi-store visibility** — `Transfer.list` filters with `Auth.storeId()` (first store only) while other hub rendering uses `Auth.storeIds()` (all) → a franchisee misses transfers for their 2nd+ store. (Specific evidence given; confirm exact line at fix.) | **NEW** | **Med** |
| GPTa-27 | **Return transfers lose their type** — create passes `returnReason` (phase2:1428) but never `type:'return'`; hub shows `t.type==='return'?'Return':'Standard'` → returns display as Standard. Misreports history/reporting. | **NEW (confirmed)** | **Med** |
| GPTc-4 (earlier) | over-received transfers lose the excess | NEW | Med |
| GPT-15 / GCLI-7 | completeFlags partial resolution | NEW ×2 | Med |
| GPTa-14 / GPTc-5 | zero-qty draft/line accepted | NEW ×2 | Low |

### 🔴 DELETE/TOMBSTONE cluster grows to 4
| # | Finding | Verdict | Sev |
|---|---|---|---|
| GPTa-19 | tombstone egress black hole — **CONVERGENCE = G1-22** (×2, high confidence) | NEW (my regression) | **P1** |
| GPTa-20 | **tombstone push skips processedCount verification** — `pushTombstone` only checks `resp.ok` (sync:1071), unlike main push's strict `processedCount===batch` ack → false "deleted-propagated" on a 200 that processed 0. | **NEW** | **Med** |
| G1-11 | offline tombstone omits DeletedBy/At/Reason | NEW | P2 |
| GCLI-10 | tombstone dropped on missing pushUrl (comment lies) | NEW | High |

### 🔴 NEW (other)
- **GPTa-24 first-launch acts on seed/stale data before first pull** — UI launches before sync; stale-pull gated on `_lastSyncAt>0`, so a brand-new device shows seed + can record stock before the first cloud pull converges. Should do a blocking initial pull when `_lastSyncAt===0` + read-only until it succeeds. **Med.**

### ⚪ CONVERGENT / RESOLVED
- **GPTa-25 background-sync illusion** → CONVERGENCE =G1-38 (×2). Known (CLAUDE.md "no handler yet").
- **GPTa-28 "prune deletes transfer history" → ❌ CONTRADICTED & RESOLVED.** GPT-app says the 30-day prune DELETES history (data loss); G1-29 + GPTc-6 say it's DEAD code. **Verified: it's DEAD** (`_migrate` patched by phase2 but never invoked; only `DB.load()` no-op is called). So no data loss occurs — the REAL issue is transfer-table BLOAT (=G1-29). Two auditors contradicted; the code settles it.

---

## AUDITS 3+4 FINAL BATCHES — Gemini-CLI 13-14 + GPT-CLI final 3 (REPORTING/MATH lens)

### 🔴 NEW — BANKED
| # | Finding | Verdict | Sev |
|---|---|---|---|
| GPTC-B | **Wastage/damage counted as SALES + PROFIT** — `Txn.classify('out')→category:'sale'` (955); the UI logs wastage as `type:'out'`+reason (not the existing `'wastage'` type, 958). Director comparison (2532) + profit (2559) sum every `isOut` as sale-value → wastage inflates revenue & profit, AND the wastage report counts the same rows again. Probe: 3-unit wastage → $300 "retail" + $240 "profit". **Real financial misreporting.** | **NEW** | **Med (financial)** |
| GPTC-C | **"All Transactions CSV" ignores category/product-type filters** — `_exportCSV` (2769-2774) applies store+date only; the rendered report applies cat+pt too → exported spreadsheet ≠ on-screen view (wrong data / over-disclosure). Fix: shared `getFilteredReportTransactions()`. | **NEW** | **Med** |
| GPTC-A | **"Test Connection" validates wrong pull contract** — `_testSync` tests pull via bare `fetch(_pullUrl)` (GET); real `Sync.pull` uses POST+JSON body (sync:850). Setup guide also says restore=GET. The test can pass/fail opposite to real sync. | **NEW** | **Med** |
| GCLI-13 | **Non-deterministic cost-history sort** — `costAtDate`/`currentCost` do `history.sort(b.date.localeCompare(a.date))` with NO tie-break; same-day deliveries (YYYY-MM-DD, no time) tie → browser-dependent "latest cost" → valuation flickers. Fix: `… || b.id.localeCompare(a.id)`. | **NEW** | **Low** |
| GCLI-14 | **Local tombstone accumulation (bloat)** — pushed local tombstones are marked `_synced:true` but never deleted from Dexie → dead `type:'deleted'` rows accumulate forever, degrading the O(N) cache loops. (Adds to the tombstone cluster + the ledger-bloat theme.) | **NEW** | **Low** |

(GPT-CLI also correctly DISMISSED the duplicate `_downloadCSV`/`_exportStockCSV` defs — later object-literal defs override; not a functional defect. Matches our earlier note.)

---

## AUDIT 5 — Claude app — KEYSTONE (8-agent adversarial; 1C/6H/18M/24L; 4 candidates self-refuted)

Highest-quality audit: runtime-verified Criticals (cracked PINs, drove stock to −9,995), refuted its own weak candidates, AND independently CONFIRMED my hardening holds.

### 🔴🔴🔴 CONVERGENCE peaks
- **C1 transfers-don't-sync → ×4** (Gemini-app, GPT-app, Gemini-CLI, Claude-app). Highest-confidence finding of the experiment.
- **H2 tombstone-egress-black-hole → ×3** (G1-22, GPTa-19, Claude-H2). My F-followup-2 regression. Confirmed three ways.
- **H1 ghost-resurrection → ×2** · **H5 hollow restore safety-copy → ×2** · **H6 delivery field-drift → ×2** · **M18 name-corruption → ×2** · **M6 over-receipt-loss → ×2** · transfer-over-commit/negative → ×2 · CSP unsafe-inline → ×4 · checksum-cosmetic → ×2.

### 🔴 GENUINE NEW (Claude-app additions, verified)
| # | Finding | Sev |
|---|---|---|
| Ca-H3 | **Pull skips own-device server rows unconditionally** (sync.js:917 `if(spItem.DeviceId===this._deviceId) continue;`) → after iOS IndexedDB eviction, own rows on the server are never re-imported, cursor advances past → permanent loss + understated stock. Fix: only skip if `localIds.has(id)`. | **High** |
| Ca-M15 | **Backup import doesn't validate the `users` array** — validates products/stores/transactions but NOT users → a crafted backup injects a director account with attacker-known hash (full replace). | **Med-High** |
| Ca-role | **`isAtLeast` role-ordering bug (LIVE)** — `_canViewHistory` (phase2.js:48) uses `isAtLeast('store_manager')`; franchisee ranks BELOW store_manager → a franchisee is denied transfer history their own store-manager employee can see. **Exactly the framework's banked `isAtLeast` trap** — should be explicit role SETS. | **Med** |
| Ca-M10 | **Negative stock reachable, never floored/flagged** — runtime-drove a product to −9,995 via the data path; UI movement form blocks over-out but transfers (no source check) + sync-pulled rows bypass it. Floor display at 0 + alert. | **Med** |
| Ca-M7/M8 | **Reporting value bugs** — portfolio value treats null-sell-price products as $0 (undercounts); Stock Overview values at SELL price while Reports value at COST, two unlabeled headline numbers for the same inventory. | **Med** |
| Ca-M3 | **10s pull-lookback may under-cover SharePoint indexing latency** → a row indexed >10s after ingest can fall below the next `safeSince` and be skipped forever. | **Med** |
| Ca-M17 | **navigationFallback has no exclude list** — a mis-deployed `db.js`/`sync.js` gets rewritten to index.html (200); network-first SW caches HTML under the JS URL → sticky offline breakage. Add `exclude` for static assets. | **Med** |
| Ca-Low | error-handler + connection-test inject raw `e.message`/`e.stack` into innerHTML (XSS sink); manual cost-entry id `ch_+Date.now()` can collide (same-ms → bulkPut overwrite, silent drop); `_submitLog` (core stock write) has NO store-scope check (any user logs movements for any store); delete-flow records self-typed name not authenticated identity. | **Low-Med** |

### ✓ REFUTED / CONFIRMED-SOLID (independent validation of MY fixes)
- **Prototype-pollution via `_applyMasterData` → HELD** (sent `__proto__`/`constructor` own-keys; RESERVED guard held, Object.prototype clean, `5e2` rejected). **= my CL-01 fix independently confirmed.**
- **Money/qty validation centralized + REJECTS (not coerces) 5e2/hex/fractional/neg/Infinity across UI+ingest+egress+backup** → **confirms F1/F-followup/F-followup-2.** Dexie/Chart pinned+SRI; durable-write rollback real.
- **GCLI-13 cost-sort "non-deterministic" → REFUTED** — V8 Array.sort is STABLE + costHistory loads in PK (`ch_<ms>`) chronological order → deterministic. Downgrade GCLI-13 to mostly-refuted (minor same-day-winner nuance only).
- Stored-XSS via user.name (strip mitigates), threshold ':*' fallback (live, not dead), reverse-delta-on-delete (math correct all 9 types) → all refuted/solid.

### AUDIT 4 (cont.) — GPT-CLI two more
- **GPTC-D 🔴 NEW — backup import detaches categories/product-types (CRIT-04 SIBLING in MY fix)** — `_validateAndScrubBackup` rejects hostile-char IDs for products+stores ONLY (index.html:3172), but `_sanitizeNames` strips IDs from categories+productTypes too. Probe: `category.id="cat_bad\"q"` accepted → sanitized to `cat_badq` while `product.catId` stays `cat_bad"q` → product detached from category; same for productType → category detached from type. **My F2-CRIT04 covered 2 of the 4 sanitized collections; this is the missing 2.** Fix: extend the charset reject + referential-integrity check to categories/productTypes (and validate every catId/ptId/threshold/txn/stockTake reference resolves). **Med.**
- **GPTC-E — tombstone dropped on no-pushUrl → CONVERGENCE = GCLI-10 (×2, runtime-probed both).** Already banked (delete cluster). High.
- (GPT-CLI correctly dismissed: duplicate CSV helper = dead-method smell not breaking the active path; modal-title XSS mitigated by textContent. Matches our notes.)

---

## AUDIT 2 (cont.) — GPT app THIRD pass (findings 29-38) — sync-reliability + reconciliation + admin

### 🔴 PUSH/SYNC RELIABILITY cluster (NEW) — incl. another in MY code
| # | Finding | Sev |
|---|---|---|
| GPTa-29 | **Atomic writes don't schedule sync** — `atomicTransferWriteDurable` (db.js:707) + `atomicDeliveryWrite` (744) write durably but DON'T call `Sync.scheduleSync()` (only `addTransactionDurable` does, 656). Transfer/delivery movements sit unsynced until an unrelated commit → stranded stock. Fix: shared `_afterLedgerWrite` hook on ALL durable writes. **High.** |
| GPTa-31 | **"Synced ✓" + pending cleared after markSynced FAILS (MY F2-CRIT03 code)** — sync.js:740-751: if `markTransactionsSynced` returns false, it logs a warning but still `_setPending(false)` + shows "Synced ✓" + resets retry. Rows self-heal (stay `_synced=false`, re-push next cycle) but UI lies + no immediate retry. Fix: on `!_marked` → setPending(true) + schedule retry + "will retry" status, do NOT show Synced. **High (mine).** |
| GPTa-32 | **Ambiguous/partial push ack not actively retried** — the ambiguous branch (sync.js:762) sets pending(true) but schedules NO retry timer (only the catch branch does); `poll()` only pulls (1151). So ambiguous pushes wait until restart/next write. Fix: extract retry scheduling + `poll()` should drain pending push first. **Med.** |

### 🔴 RECONCILIATION + ADMIN (NEW)
| # | Finding | Sev |
|---|---|---|
| GPTa-34 | **Reconciliation uses pending/rejected stock-takes as baseline** — `stockReconciliation` picks latest take by date with NO status filter (index.html:3776) → an unapproved/rejected take becomes "expected stock". Fix: only `status==='approved'||'clean'`. **Med.** |
| GPTa-35 | **Reconciliation ignores same-day post-take movements** — compares date STRINGS (`t.date > take.date`), so a sale at 14:00 after a 10:00 take (same YYYY-MM-DD) is excluded → false discrepancies. Fix: store `completedAt`, compare `createdAt`. **Med.** |
| GPTa-36 | **User-edit can duplicate usernames + delete the last Director** — `_updateUser` doesn't check username uniqueness; `_deleteUser` doesn't block last-director/self deletion → lockout + ambiguous login (login matches by username). **Med.** |
| GPTa-37 | **Delete-movement has NO role/capability gate** — the Delete button renders for today's movements for everyone; `_confirmDelete` checks only typed name/reason, no `Auth.can` (index.html:1713/1760). Wave-B gating missed this path. Fix: `deleteMovement` capability; staff limited to own-movement undo. **Med.** |
| GPTa-38 | **Duplicate product lines in one delivery overwrite cost history** — cost-history id `ch_+Date.now()+productId`; same-product same-ms lines collide (bulkPut overwrite) + `prod.costPrice` = last line wins. Fix: reject/aggregate duplicate productIds; `crypto.randomUUID()` ids. **Med.** (relates Claude-app cost-id-collision Low) |

### ⚪ CONVERGENCE
- GPTa-30 delivery shipping ignored → **×3** (GPTC-3, Claude-H6, GPTa-30). HIGH CONFIDENCE.
- GPTa-33 Test-Connection wrong contract → **×2** (GPTC-A).

### AUDIT 5 (cont.) — Claude app stock-take deep-dive
- ✓ **DISMISSED non-bug:** 4× boot logs = preview harness reloading, not a re-init race (`initDB` runs once, index.html:4949). No data race.
- ✓ **VALIDATED SOUND:** stock-take → adjustment core math. `_submitStockTake` freezes `difference=physical−system` (1970); `_approveStockTake` applies `adjustment_in/out` of `abs(difference)` (2057); frozen-delta design is correct (movements between submit+approval shift shelf AND system equally). Idempotency solid (`_stApproving` flag + already-ledger check by stockTakeId, 2051); clean takes auto-finalize; signs correct. **The namesake feature's core is correct.**
- **IMPORTANT distinction:** this is the APPROVAL/adjustment flow (`_approveStockTake`) — SOUND. GPTa-34/35 are about the separate reconciliation REPORT (`stockReconciliation`, 3776) — those bugs stand. Different functions; no contradiction.
- 🟡 **Ca-stk1 NEW Low — count-vs-submit timing skew:** `systemCount` captured at SUBMIT, but staff count earlier; sales during the open count make the variance stale. Inherent to non-freezing takes. Mitigate: snapshot at count-start or warn on movements during an open count.
- ⚪ **Ca-stk2 stockTakes don't sync → CONVERGENT** with the multi-table-sync gap (C1 family). Lower impact: the adjustment txns it produces DO sync through the ledger.

---

## AUDIT 6 — Claude CLI (FINAL) — Node-probed 4 load-bearing findings; strong negative-space

### 🔴 NEW — BANKED
- **CaC-H4 🔴 NEW High — failed restore/migration silently shows EMPTY data** — `_migrateFromLocalStorage` (db.js:832) does `await _persistAllToDexie(old)` IGNORING its boolean return, then `localStorage.removeItem(DB.KEY)` (836) runs regardless. `_persistAllToDexie` swallows its error → returns false (doesn't throw) → the catch-path recovery never fires. A failed restore/migration (e.g. quota on a big backup) deletes the source + shows empty app, no error. **Compounds GPT-9 (hollow safety-copy) → the restore/migration path has NO real safety net.** Fix: `const ok=await _persistAllToDexie(old); if(!ok) throw …`. **High.**
- **CaC-L4b Low — stock-take PIN printed in plaintext in a success toast** (index.html:4524). Minor info-leak. **Low.**

### ⚪ CONVERGENCE (already banked — Claude-CLI re-confirms, several Node-proven)
- **H-1 shipping dropped → ×4** (GPTC-3, Claude-H6, GPTa-30, CaC-H1). Claude-CLI: "highest-value fix by far — one-line field-name mismatch corrupting financial data now." Node-proven ($10 vs $15/unit).
- H-2 unknown-product movements dropped + cursor advances → multi-auditor (Claude-app H3, GPT-8, CaC-H2). Node-proven. **Elevates my "documented tradeoff" framing → multiple auditors call it real data-loss.**
- M-1 negative stock → ×3 (Node-proven: transfer_out 8 vs 5 → −3). M-3 double-receive. L-1 id collisions. L-3 test-connection (×3). value-undercount.
- H-3/M-4/M-5 client-auth/hashes/throttle → KNOWN (P-13/D-039).

### ⚠ CROSS-CHECKS (the two Claudes / two auditors disagree — code settles it)
- **CaC-M2 "stock-take applies a STALE delta" → REFUTED by Claude-app's careful trace.** Claude-app proved the frozen-delta design is CORRECT (movements between submit+approval shift shelf AND system equally; applying D reconciles). Claude-CLI's "counted 8, sale between → lands on 5 not 8" expects the count to CLOBBER a real subsequent sale — which would be WRONG; landing on 7 (8−1 real sale) is correct. **Math sound; only the dialog wording "matches the count" is imprecise (Low/cosmetic).** Real residual = the COUNT→SUBMIT skew (Ca-stk1 Low), not the submit→approval delta.
- **CaC "No working stored-XSS" → INCOMPLETE, do NOT downgrade the XSS.** Claude-CLI traced reason/staffName (escaped) but MISSED the txn-`id`-in-onclick sink that **GPT-CLI runtime-PROVED executes** (GCLI-1b/GPTC-F, executed:true). Negative space is only as good as the sinks checked. XSS stands (High).

### ✓ STRONG VALIDATION (independent confirmation of MY hardening — convergent with Claude-app)
Claude-CLI: "genuinely well-hardened — `Validate.qty/money` trust-boundary validation, durable-write rollback, name/ID sanitisation, CSP (object-src 'none', framing), leader-election tie-breaks, strict sync ingest/egress validation are all real, thoughtful work." **= F1/F-followup/F-followup-2 + earlier waves independently confirmed solid by a 2nd blind Claude.**

---

---

## AUDIT 2 (cont.) — GPT app FINAL set (39-45) — permissions/pricing/state-machine

### 🔴 NEW — BANKED
| # | Finding | Verdict | Sev |
|---|---|---|---|
| GPTa-42 | **Rejected stock-take can still be approved** — `_approveStockTake` (index.html:2043) guards "not found" + "already approved" + idempotency, but NOT `status==='pending'` → a REJECTED take can be approved and emit adjustment ledger rows. (`_rejectStockTake` correctly requires pending.) Complementary to Claude-app's double-approve validation. | **NEW (confirmed)** | **Med** |
| GPTa-40 | **HO can set pricing via Add-Product (gating bypass)** — `_doAddProduct` gates on `editRefData` (head_office+director, line 931) but saves `franchiseDiscount`; pricing is supposed to be `editPricing` (Director-only). HO sets pricing on new products. **Sibling of my Wave-B gating — gated the discount EDITOR (`_setProductFranDisc`) but not the add-product FIELD.** | **NEW (confirmed, mine)** | **Med** |
| GPTa-41 | **Clearing a franchise discount stores 0%, suppresses store-default fallback** — `discPct = p.franchiseDiscount ?? store ?? null` only falls back on null; `_setProductFranDisc` coerces blank→0 → a franchise product silently goes FULL PRICE instead of the store discount (e.g. Cockburn 25%). | **NEW (confirmed)** | **Med** |
| GPTa-43 | **Deleting a category/product-type orphans products** — `_deletePT`/`_deleteCat` filter the row out with NO reference check → products stay active but lose category/type classification in tables/filters/exports/reports (stock vanishes from those workflows). Block delete while referenced + offer reassign. | **NEW** | **Med** |
| GPTa-45 | **Multi-store non-franchisee users forced to storeIds[0] in Log Movement** — `logMovement` sets `hasMultiLoc` only for HO or franchisee-with-multi; a store-manager/staff assigned to multiple stores gets no picker → movement recorded against the WRONG store. **Sibling of GPTa-26 (storeId vs storeIds inconsistency).** Fix: `hasMultiLoc = isHO || Auth.storeIds().length>1`. | **NEW** | **Med** |

### ⚪ CONVERGENCE
- **GPTa-39 master-data version marked before durable save → ×2 (=G1-12, MINE).** `_applyMasterData` calls fire-and-forget `DB.commit()` then writes `bob_catalogue_version` → version advances even if persist fails → device permanently missing catalogue. Fix: `commitDurable()` + store version in the SAME Dexie meta transaction.
- **GPTa-44 tombstone delegation drops deletes (follower/no-config)** → delete-cluster (=GCLI-10/GPTC-E + the no-await + follower-BroadcastChannel angle). Fix: durable `deletedTransactions` outbox written atomically with the delete; leader drains it.

**GPT app FINAL CALL:** done with client-bundle findings; recommends backend (Logic App/SharePoint schema/dedup/auth) verification as the mandatory next audit step. → **All 6 auditors now complete.**

### GPT-CLI FINAL finding
- **GPTC-H 🔴 NEW High — franchise invoice over-bills non-chargeable inbound** — invoice lines filter on `Txn.isIn(t)` (index.html:3849/3869), which includes `return_in` (customer returns) + `adjustment_in` (stock-take surplus) alongside `transfer_in` (real HO supply). Franchisees billed for returns + corrections as if supplied. Probe: return_in($150) + adjustment_in($225) → totalOwed $375 (both wrong). **Financial sibling of GPTC-B (wastage-as-sale): reports use coarse `isIn/isOut` instead of specific category → bill/profit corruption.** Fix: a dedicated chargeable-supply type/flag. **High (franchise billing).** GPT-CLI then signed off — no further high-confidence findings.

---

## AUDIT 5 — Claude app WAVE 2 (deep dig: money math) — ~70 total both waves, 2 self-refuted

### 🔴 FINANCIAL / COST-INTEGRITY cluster (the money the business acts on)
| # | Finding | Verdict | Sev |
|---|---|---|---|
| W1 | Franchise invoice over-bills (returns/adjustments/reversals billed as HO supply) | **CONVERGENCE ×3** (GPTC-H, CaC-H5, Ca-W1) | **High** |
| W2 | Director "Est. Profit"/Store-Comparison counts transfer_out/wastage/shrinkage as SALES at full margin → **destroying stock raises reported profit** (perverse). `calcProfit` sums `isOut` not `category==='sale'` (2559). Runtime-verified. | **NEW** | **Med** |
| W3 | Editing delivery packaging silently RE-ALLOCATES header costs (save uses weight+value rules; `_saveDeliveryPackaging` uses value-only, 4430) → cost price jumps from the RULE change not the edit (worked ex: ~41% jump on a $5 edit). Factor allocation into one shared helper. | **NEW** | **Med** |
| W4 | Free/$0 line items DROPPED from a delivery — `validLines` filters on `unitCost` truthiness (4266) → $0 line books NO stock-in + its freight redistributes onto paid lines. Filter `unitCost!=null && >=0`. | **NEW** | **Med** |
| cost-ratchet | Cost price only RATCHETS UP — `willUpdate = prevCost===null || landed>prevCost` (4300) → a cheaper restock is discarded, margins stay inflated after a price drop. Use latest/moving-avg not max(). | **NEW** | **Med** |
| same-day-cost | **CORRECTS GCLI-13 refutation:** deterministic (stable sort) BUT picks the EARLIEST-inserted same-day entry, not the latest → wrong (older) cost among same-day deliveries. Determinism ≠ correctness. Secondary sort id/createdAt desc. | **NEW (corrected)** | **Low-Med** |
| rounding | Header-cost + franchise-invoice round-each-line vs round-the-sum → allocations don't foot the invoice total → franchisee penny disputes. Largest-remainder; round once. | **NEW** | **Low** |

### 🔴 SHARED-DEVICE HYGIENE cluster (NEW — matters: documented shared-store-tablet model)
| # | Finding | Verdict | Sev |
|---|---|---|---|
| W8 | **Logout doesn't clear draft state → cross-user bleed** — `App.logout` (4861) clears only Auth/view/_stTakeUnlocked, NOT `_logData`/`_stData`/`_delLines`/`_txState`. `Transfer.resetState()` is DEAD CODE (never called). User B inherits + can submit User A's drafts under B's identity. Runtime-verified. | **NEW** | **Med-High** |
| W6 | No double-submit guard on `_submitLog` (1685) → touchscreen double-tap records the movement TWICE (distinct crypto ids defeat dedup). Guards exist elsewhere (`_stApproving`, `_txState._creating`). | **NEW** | **Med** |
| W7 | No double-submit guard on `_saveDelivery` (4259) → double-tap doubles stock-in + (if clock ticks) duplicate cost-history. | **NEW** | **Med** |
| PIN-lock | Idle lock weak (mousemove/scroll reset, no debounce; lock re-prompts SAME user not logout → no between-user protection). | **NEW** | **Low** |

### 🟡 OTHER NEW
- **W5 sync pull has NO store-scope filter** — every device persists the ENTIRE multi-store ledger incl supplier names + invoice numbers (in delivery `Reason`) + all stores' staff names → readable on any store device. Partially P-13 (client has all data) but concrete privacy/egress. Fix: store-scope filter on pull + keep supplier/invoice OUT of synced Reason. **Med.**
- Email egress: stock-take/transfer emails carry staff name+username+role + full per-product counts (bypasses `_slimActorsDeep`). **Low** (trusted-recipient).
- Reporting: store-comparison uses retail price for franchise stores (wholesale conflation); unweighted avg-margin %; two stock-value numbers. **Low** (extends M7/M8).

### ✓ REFUTED (Claude-app Wave-2, adversarial bar)
- **Sync channel egress CLEAN** — push/pull/config/tombstone request BODIES carry no costs/prices/hashes/tokens/SAS (SAS in operator URL path only). Confirmed safe.
- CSV export not broken (duplicate `_downloadCSV` — live later defs work); stock-take email HTML-injection neutralised by the strip.

### AUDIT 6 — Claude CLI FINAL pass
- **CaC-H6 profit-counts-wastage → CONVERGENCE ×2** (= Claude-app W2). Both Claude sessions independently found it AND independently named the same root cause: reports key off `isIn/isOut` direction, not transaction CATEGORY → wrong franchise-invoice + sell-through + profit. **One report-layer fix clears all three.** (financial cluster, banked)
- **CaC-M7 default PIN "1234" + no password-strength rule** → KNOWN (D-039 PIN/password weakness, accepted-alpha; prior audit flagged the 1234 default too).
- ✅ **COVERAGE-GAP CLOSED — read-only screens CLEAN:** Reorder List, Audit Log, Dead Stock, Dashboard, All Movements, user create/edit all read line-by-line → correct + properly escaped. **No hidden bug in Reorder (the purchasing driver) — a valuable negative result.** Only cosmetic trivia (OUT-filter matches true sales only; Dashboard recent sorts by insertion).

### AUDIT 5 — Claude app PERF additions
- **Ca-P1 NEW Med/ARCH — director analytics are O(stores×txns×products) and re-sort cost-history per call.** `currentCost`/`costAtDate` (index.html:1131/1139) re-`filter`+`sort` the whole `costHistory` on EVERY call; called inside `calcProfit` (per out-txn × 2 periods × stores), `franchiseInvoice` (+`.some()` over deletedTransactions per row), `totalVal` (products×stores×currentCost). At README's claimed 100K records → tens-to-hundreds of millions of main-thread ops → analytics freeze. **The README claims 100K+ scale; the analytics don't.** Fix: precompute productId→sorted-costHistory index once/render; memoize currentCost; productId→product Map not `.find` in loops. Joins the scaling cluster (G1-19 in-memory-OOM, GCLI O(N) buildCache). **Med/ARCH.**
- **Ca-P2 NEW Low-Med — transaction views hard-cap at 500 rows, no pagination** (index.html:2378/2710 `.slice(0,500)`) → anything older than the last 500 movements is unreachable in the UI with NO indication rows were hidden. Fix: real pagination or "showing 500 of N — narrow the date range" notice. **Low-Med.**
- (note: `_verifyCacheIntegrity` is O(S×P×T) — fine ONLY because console-only; never wire to a startup health check.)

## AUDIT 5 — Claude app WAVE 3 (gap closure: the areas it admitted leaving thin) — triaged 2026-06-12

Claude-app's final wave covering login-audit, optimum-levels/reorder, currency, accessibility, dates/alerts/device-id, dead code. **Every load-bearing claim re-verified by Claude against the repo code — all checked claims CONFIRMED, zero false positives in the Medium set.**

### 🔴 LOGIN-AUDIT cluster (NEW) — the security feature doesn't work at all
| # | Finding | Verdict | Evidence | Sev |
|---|---|---|---|---|
| W3-1 | **Login Audit page is a dead route** — sidebar link emits `navigateTo('login-audit')` (index.html:4700) but the routes map (4802-4834) has NO `login-audit` entry → missing-route guard (4837) swallows it. `Pages.loginAudit` (5068) is orphaned. Directors can never open it. | **NEW — VERIFIED (route map read, no entry)** | index.html:4700/4802-4834/4837/5068 | **Med** |
| W3-2 | **Login audit is per-device localStorage only, never synced** — `bob_login_audit_v4` exists ONLY in index.html (4998); zero refs in sync.js → a director can never see store-tablet logins from their own device. | **NEW — VERIFIED (grep: no sync refs)** | index.html:4998 | **Med** |
| W3-3 | **"New device" detection toasts the person logging in**, not a director; clear-localStorage bypass. | **NEW (same feature family; evidence cited 5041-5049)** | index.html:5041-5049 | **Med** |
→ Fix decision needed: register the route (1 line) is the floor; then either sync login events or relabel the feature "this device only".

### 🔴 OPTIMUM-LEVELS / REORDER cluster (NEW) — real data loss + the reorder engine ignores its own config
| # | Finding | Verdict | Evidence | Sev |
|---|---|---|---|---|
| W3-4 | **`saveOptimumLevels` wipes `leadDays` to null on every save** — entry literal has `leadDays:null` (phase2.js:1578) and `Object.assign` (1579) clobbers the existing value that Settings `_saveThr` saves (index.html:2963). Silent loss of reorder lead times. | **NEW — VERIFIED (both write paths read)** | phase2.js:1578-1579 vs index.html:2963 | **Med (data loss)** |
| W3-5 | **"Save All" persists a `minQty:0` threshold for EVERY active product** — render pre-fills `optEdits` for every product with `{min:0,optimum:0}` (phase2.js:1257-1268), so the save loop's `if(!ed) continue` never skips → catalogue-wide 0/0 threshold rows → out-of-stock alert spam + spurious rows feeding W3-7. | **NEW — VERIFIED (prefill + loop read)** | phase2.js:1257-1268/1567-1580 | **Med** |
| W3-6 | **Two threshold editors, two rule-sets** — Settings `_saveThr` validates (min required, optimum≥min, leadDays kept); Optimum Levels coerces 0s and drops leadDays. Same `d.thresholds` data. Wave-D added partial validation parity but not full. | **NEW — VERIFIED** | index.html:2963 vs phase2.js:1572-1578 | **Med** |
| W3-7 | **Reorder List ignores `optimumQty`** — suggests `Math.max(minQty*2−qty, minQty)` (index.html:3551); the configured optimum is never used (and W3-5's 0-rows suggest 0). Should be `optimumQty − onHand`. | **NEW — VERIFIED (line read)** | index.html:3551 | **Med** |

### 🔴 OTHER NEW (Medium)
- **W3-8 Currency selector is decorative** — `del-currency` (AUD/USD/EUR/GBP, index.html:4141) is read NOWHERE (grep: only the markup); all costs booked as AUD, `UI.fmt` hardcodes $. A USD delivery is silently mis-booked. **VERIFIED.** Fix: store+convert, or remove the selector. **Med (financial).**
- **W3-10 Core flows keyboard-inaccessible (runtime-verified by auditor; markup confirmed by me)** — `sideLink` emits `<a class="nav-item" onclick=…>` with no href/role/tabindex (4733-4735) → desktop sidebar unfocusable; filter chips/product cards in Log-Movement + Stock-Take are span/div-onclick. Mobile bottom-nav uses real buttons (fine). **Med (a11y).**
- **W3-11 Modals/PIN-lock don't manage focus** — no focus move/trap/Escape/restore; PIN lock leaves the page behind operable for AT users. Runtime-verified by auditor. **Med (a11y).**
- (W3-9 shipping-cost re-found = duplicate of Tier-0 #1, cross-confirmation ×5 now.)

### ⚪ LOW (new, condensed — spot-verified)
- **Date preset month-overflow** — `new Date(y, month−N, getDate())` (index.html:2480/2483/2486/2489) overflows on the 29th-31st → window start shifts 1-3 days. **VERIFIED** (raw `new Date(...)` arithmetic read).
- **Two divergent device-ID systems** — sync uses `bob_device_id` (sync.js:294; Cloud Sync page shows it, index.html:3262); Login Audit records `bob_device_id_v4` (4966) → they never match. **VERIFIED.** Fingerprint is reversible `btoa()` not a hash; failed logins never recorded (success-only).
- Negative on-hand shows amber "LOW" not red OUT; warehouse-in-storeIds leaks into per-store alerts; dead `.nav-badge` style.
- Modals: no Escape/backdrop dismiss, background scrolls on touch; offline banner covers the mobile hamburger; locale hardcoded en-AU/$.
- A11y Lows (auditor runtime-verified): placeholder-only labels, no aria-live on toasts, no heading hierarchy, skip-link targets non-existent `#main-content`, colour-only status, no aria-expanded.
- **Dead code sweep — VERIFIED:** `generateDemoTransactions` (~195 lines, index.html:646, never called) · `Sync._mergeTransactions` (sync.js:1106, never called) · `Transfer.resetState` (already banked, W8) · `DB._migrate` prune (already banked ×2, G1-29/GPTc-6) · duplicate `_downloadCSV` (already noted). Plus the standing dual fire-and-forget vs Durable API hazard (= GPT-12/GCLI-4 convergent family). **`sync-v2.js` stale file = already guarded** — test/verify-app.js:87 asserts it's never loaded.

### ❌ REFUTED by the auditor itself (no padding): online-store reorder alerts (real channel) · createFromStockTake negative (dead code) · null-vs-* threshold rows (PK forbids null) · monthlySummary-tz + packaging-edit = wave-1/2 duplicates.

### Coverage note
Claude-app declares the **client-side audit complete** after wave 3 (correctness, data-loss, security, races, offline/sync, business logic, UX+a11y+responsive, complexity). Remaining blind spot = the backend (Logic Apps/SharePoint) — couldn't see them from the bundle; that's the Azure phase (`SERVER-SIDE-REQUIREMENTS.md` exists in the repo, just wasn't in the blind package).

---

## ✅ ALL 6 BLIND AUDITS COMPLETE — FINAL TALLY
(Gemini app · Gemini CLI · GPT app ×3 passes · GPT CLI ×multiple · Claude app ×2 · Claude CLI)

- **~57 genuine NEW issues banked** (de-duplicated across 6 auditors).
- **Convergence leaders (signal strength):** transfers-don't-sync **×4** · tombstone-egress-black-hole **×4 (MINE, runtime-proven)** · delivery-shipping-dropped **×4 (Node-proven)** · CSP unsafe-inline ×4 · negative-stock-reachable ×3 · test-connection-wrong ×3.
- **6 issue CLUSTERS:** (1) multi-table sync gap [transfers/deliveries/stockTakes/catalogue don't sync] · (2) delete/tombstone path [≥4 distinct bugs] · (3) transfer subsystem/phase2 [~8 bugs] · (4) sync-reliability/push-retry [atomic-no-schedule, Synced-lie, no-retry] · (5) reporting correctness [wastage-as-sale, CSV-filter, value-labels, reconciliation-report] · (6) boundary-symmetry/field-drift siblings [backup-vs-sync, shipping=H-03-sibling, cat/pt-detach=CRIT-04-sibling] + a real proven XSS class.
- **5 of the ~57 are incomplete-sweep misses in MY OWN recent fixes:** tombstone-egress (×4), master-data-version-durability, completeFlags+over-receive (HIGH-02 edges), category/product-type detach (CRIT-04 sibling), Synced-after-markSynced-fail (CRIT-03).
- **FALSE/artifact/refuted ~14:** the 2 packaging artifacts (missing-icons, %%CONFIG_URL%%) · Gemini-app's 5 (storage.persist, skipWaiting, ledger-XSS, etc.) · Gemini-CLI-11 (restore-broken) · Gemini-CLI-13 (cost-sort non-determinism) · CaC-M2 (stock-take stale-delta) · GPTa-28 (prune-deletes-history) — all settled against the code.
- **KNOWN/accepted-alpha ~20:** P-13 client-auth model, D-039 hashes/PIN, Azure server-side punch list, MED-01 float, self-host backlog.
- **META-LESSON:** the blind auditors' superpower was catching the SIBLINGS my primed fixes missed (no "already fixed" blinder) — AND independently CONFIRMING the parts I hardened are solid. The single most-confirmed bug of all (tombstone egress ×4) is in code GPT had called "clean," which every PRIMED auditor then confirmed instead of attacking. Bank as framework principle P-17.
- **Genuine NEW banked:** ~22 (dedup'd across auditors)
- **High-confidence convergent (≥2 blind auditors):** transfers-don't-sync (×2) · egress-"Synced"-lie (×2) · CSP unsafe-inline (×2) · **completeFlags partial-resolution (×2)** · fire-and-forget residuals (×2) · O(N) ledger-in-RAM (×2)
- **In MY recent Wave-F code:** tombstone-egress P1 · master-data-version P2 · egress-"Synced"-lie P2 · completeFlags-sibling Med
- **Known/accepted:** ~16 · **False/artifact:** ~7 (incl. the 2 packaging artifacts: missing-icons, %%CONFIG_URL%%)
- **3 of 6 audits done.** Pattern is stabilising: the genuine NEW themes are (1) **transfer/delivery/stocktake records don't sync** [architectural], (2) **partial-commit siblings of H-02** [completeFlags], (3) **my F-followup egress filter rejects tombstones + lies "Synced"** [my regressions], (4) **backup restore has no real rollback**, (5) **residual fire-and-forget + commit races**, (6) **defense-in-depth: txn ids not sanitized**. Remaining 3 audits (Claude app + Claude CLI + GPT CLI) will mostly confirm/extend these.
