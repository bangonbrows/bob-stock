# Wave G Review Pack — Blind-Audit Fixes, Round 1 (Tier 0 + Tier 0.5)

**Date:** 2026-06-12 · **Branch:** `fix/cli-tri-audit-2026-05` (NOT committed, NOT deployed)
**Source:** `audit-artifacts/BLIND-AUDIT-2026-06-11/CONSOLIDATED-REPORT.md` (6 blind auditors, ~75 confirmed issues)
**Scope:** the 6 highest-value/lowest-risk fixes — quick wins + shared-device hygiene. No behaviour redesigns, no schema migrations, no sync changes.

---

## Plain-English summary (for Kunal)

1. **Shipping costs now count.** The delivery form's "Shipping Cost" box was typed into and thrown away — the code read a "Customs" field that doesn't exist in the form. Five separate auditors proved this corrupts product costs and margins. Shipping is now included in landed cost (split across products by weight, same as freight), saved on the delivery record, and shown in delivery history. Old deliveries that have a customs value still display it.
2. **A failed restore can no longer silently empty the app.** If moving your data into the device database fails (e.g. storage full), the app used to delete the source anyway and boot up empty, with no error. Now it keeps the source untouched and shows the existing "recovery mode" warning instead. Same fix applied to first-run seed loading.
3. **The Login Audit page now opens.** The sidebar link existed but the page was never wired up — directors could never open it. It's now registered, director-only (same pattern as Audit Log), and honestly labelled: it currently shows logins on *this device only* (making it multi-device is a later, bigger decision).
4. **"Save All" on Optimum Levels no longer wipes lead times.** Every save used to silently null out the reorder lead-days set in Settings → Thresholds. Existing lead times are now preserved.
5. **Logging out clears all drafts.** On a shared store tablet, the next user used to inherit the previous user's half-finished movement / stock take / delivery / transfer — and could submit it under their own name. Logout now clears every draft holder. (The transfer reset function existed but was never called — classic dead code; it was also itself missing 6 fields, now completed.)
6. **Double-taps can't double-record.** Tapping "Confirm" or "Record Delivery" twice quickly used to record the movement/delivery twice (each tap got a unique ID, so duplicate-detection couldn't catch it). Both now use the same re-entrancy guard pattern as the rest of the app.

## What was deliberately NOT touched this wave
- The decorative Currency selector (Tier 4 — needs a store-or-convert decision)
- The minQty:0 catalogue-wide threshold spam + Reorder List using min×2 (Tier 5 — same screen, but a behaviour-design question)
- Tombstone/delete path, sync, XSS class, financial-report category fixes (Tiers 1–4, next waves)

---

## Technical changelog

| # | Finding (blind-audit IDs) | File(s) | Change |
|---|---|---|---|
| G1 | Shipping dropped — GPTC-3 / Claude-H6 / GPTa-30 / CaC-H1 / W3-9 (×5, runtime-proven) | index.html | `_updateDeliveryCalc` + `_saveDelivery` read `del-shipping` (the phantom `del-customs` reads removed); allocation group renamed `freightCustoms`→`freightShip` (freight+shipping by weight, tax by value); `headerCosts:{freight,tax,shipping}` stored; history row + detail modal display Shipping (legacy Customs shown only when present); cost-history note text updated |
| G2 | Silent-empty restore — CaC-H4 | db.js | `_migrateFromLocalStorage`: corrupt-JSON still falls through to seed, but a persist returning `false` now THROWS before the archive+delete step → `initDB`'s catch serves localStorage in recovery mode with the blocking warning. Sibling sweep: `_loadSeedData` also throws on failed persist → boot shows the fatal contact-admin screen (all `_persistAllToDexie` callers now check the return) |
| G3 | Dead login-audit route — W3-1 | index.html | `'login-audit'` registered in the routes map; `Pages.loginAudit` gains the same director gate as `auditLog`; banner relabelled "on this device" (W3-2 sync-or-relabel: relabel now, sync decision later) |
| G4 | leadDays wiped — W3-4 | phase2.js | `saveOptimumLevels` preserves the existing `leadDays` on update instead of hard-coding `null` |
| G5 | Logout draft bleed — W8 (runtime-verified) | index.html, phase2.js | `App.logout` clears `_logData`/`_logStep`/`_stData`/`_delLines` + calls `TransferUI.resetState()` (was dead code). `resetState` completed: was missing `createType/From/To/ReturnReason/ReturnNotes` + `optEdits` (the P-12 incomplete-sweep trap, inside the reset function itself) |
| G6 | Double-tap duplicates — W6/W7 | index.html | `_submitLog` guarded by `_logSubmitting`, `_saveDelivery` by `_delSaving` — entry check + `finally` release, same pattern as `_stApproving`/`_txState._creating` |

## Harness
- **6 new sentinels S-53..S-58** in `test/smoke-test.js`, each driving the LIVE code path in Chromium:
  - S-53: $100 shipping on 10×$5 units → landed $15 + `headerCosts.shipping:100` stored (bug: $5 + 0)
  - S-54: forced persist failure during migration → throws + localStorage source kept (bug: silent success + source deleted)
  - S-55: staff blocked from login-audit; director sees it render (bug: nobody sees it — dead route)
  - S-56: threshold with leadDays 14 survives a Save All (bug: nulled)
  - S-57: logout clears movement/stock-take/delivery/transfer/optimum drafts (bug: GHOST draft survives)
  - S-58: double-fired `_submitLog` → 1 movement; double-fired `_saveDelivery` → 1 stock-in (bug: 2+2)
- **6 matching saboteur mutations** in `test/saboteur-runner.js` (each reverts one fix; its sentinel must flip red)
- Results: see `WAVE-G-HARNESS-RESULTS.md` (written after the runs below)

## Risk notes for auditors
- G1 changes the stored delivery schema for NEW records (`shipping` key instead of `customs`). All readers were swept: history/detail displays handle both; `_saveDeliveryPackaging` and the two `totalHeader` computations use `Object.values()` so they're key-agnostic. No migration needed for old records.
- G2 changes failure-path behaviour only (a failed persist could previously NEVER surface — now it lands in the two existing, already-tested failure UIs).
- G5's `resetState` completion also resets `createType:'standard'` etc. — checked: these are re-initialised by the create-transfer screen on render; no flow depends on them surviving logout.
- G6 guards are entry-check + `finally` release; an exception inside either function still releases the flag (no lock-out).

## Wave G follow-up (2026-06-14) — auditor BLOCK findings resolved

External round on Wave G: **GPT = BLOCK**, **Gemini = PASS-with-findings**. Both ran the live harness (58/58) and converged on one real bug; each also found a different incomplete-sweep sibling. All three fixed:

| Finding | Auditors | Fix |
|---|---|---|
| **P2 — `_saveDeliveryPackaging` used value-based allocation of the lumped header** (G1 incomplete sweep): editing packaging on a weight-allocated delivery re-flattened the freight/shipping share to value-based → landed cost corrupted on edit. Runtime-proven (2 lines, weights 100/900, $100 shipping: line-0 header jumped $10→$50, landed $20→$65 on a $1 packaging edit). | **GPT P2 + Gemini P2 (convergence ×2)** | index.html: header share is INVARIANT under a packaging edit (value/weight/freight/tax/shipping all unchanged), so reuse the stored weight-allocated `headerCostShare` instead of re-deriving. Removes the divergent rule entirely + closes blind-audit W3 (packaging-realloc). |
| **P3 — `saveOptimumLevels` ("Save All") had no double-tap guard** (G6 incomplete sweep): a double-tap fired overlapping `commitDurable()`. | **Gemini P3** | phase2.js: `_optSaving` re-entrancy guard (entry check + finally), same pattern as `_submitLog`/`_saveDelivery`. |
| **P3 — S-58 asserted the delivery double-tap but the saboteur only mutated `_logSubmitting`** (the `_delSaving` half was tested but not mutation-proven). | **GPT P3** | test: added S-59 (delivery double-tap, isolated) with a `_delSaving` saboteur mutation. |

New sentinels **S-59 / S-60 / S-61** + 3 saboteur mutations. Harness now **61 sentinels / 61 mutations**. Re-proof results appended to `WAVE-G-HARNESS-RESULTS.md`.

## Wave G follow-up round 2 (2026-06-14) — re-audit findings resolved (double-tap write-path family)

Re-audit: **GPT = PASS-with-findings** (BLOCK cleared), **Gemini = PASS-with-findings**. Both confirmed the P2/P3 fixes and converged on the SAME residual: the double-tap guard belongs to a *family* of write paths, and siblings were still unguarded.

I ran a full discovery sweep (read-only) of every user-triggered save/commit handler and classified by duplicate-risk. Guarded the 4 that can create DUPLICATE records on a double-tap:

| Handler | Flagged by | Risk | Guard |
|---|---|---|---|
| `_saveDeliveryPackaging` | GPT (proven: 2nd commit fail → false "could not be saved" fatal after a successful save) | appends `ch_+Date.now()` cost rows on a cost update | `_pkgSaving` |
| `_saveCostEntry` | Gemini | appends `ch_+Date.now()` cost rows | `_costSaving` |
| `_submitStockTake` (clean-take path) | Gemini | appends `st_+Date.now()` stockTakes record (discrepancy path already had `_stSubmitting`) | `_stCountSubmitting` |
| `TransferUI.submitDraft` | **my sweep** | investigated → already idempotent (two synchronous status checks); speculative guard REVERTED as dead code (see below) | none (no guard needed) |

New sentinels **S-62 / S-63 / S-64** + 3 saboteur mutations. Harness now **64 sentinels / 64 mutations**.

### Self-caught harness honesty correction (the saboteur did its job)
The first cut of these sentinels counted *surviving rows* on a double-tap — but two synchronously-fired calls mint the **same `Date.now()` id**, so the DB de-dupes them and the sentinel stays green even with the guard removed. The saboteur flagged **S-62/S-63 BLIND** (S-64 passed only by timing luck). Rewrote all three to count **commit invocations** (`_commitSettings` / `DB.commitDurable`) — the guard's true, timing-independent effect (guard → 1 commit; bug → 2). A real ms-apart double-tap produces 2 commits = 2 rows; the count proxy captures that without depending on id timing.

**`submitDraft` guard REVERTED (not kept):** my sweep flagged it as "the one transfer handler missing the `_creating` guard," but on inspection `submitDraft` is **already idempotent via two synchronous status checks** (UI handler returns early if `status!=='draft'`; `Transfer.submitDraft` flips status to `in_transit` synchronously before its await). A guard there is dead code no sentinel can mutation-prove (confirmed: removing it changes nothing). Removed the speculative guard + its S-65 sentinel rather than ship unprovable code. My earlier claim of a "duplicate transfer_out" bug here was wrong — corrected.

### Deliberately deferred (auditor-sanctioned "future hygiene pass") — documented, NOT missed
The rest of the write-path family is genuinely lower-risk and is tracked for a later hygiene wave:
- **Idempotent upserts (double-tap rewrites the SAME keyed row → no duplicate possible):** `_updateUser`, `_updateCat`, `_updatePT`, `_updateStore`, `_setProductFranDisc`, `_saveThr`, `_removeThr`, `_setStockTakePin`, `_clearStockTakePin`, `_rejectStockTake`, `_deleteUser`.
- **Fresh-id ref-data adds, but mitigated:** `_saveNewUser` (already disables the button + username-uniqueness check), `_doAddProduct`/`_saveNewStore` (user-entered id + Dexie key-dedupe + uniqueness check). `_saveCat`/`_savePT` (`cat_`/`pt_+Date.now()`) carry a small cross-ms duplicate window — lowest severity, queued for the hygiene wave.
Gemini explicitly scoped these to "a future hygiene pass"; listing them here so the boundary is a decision, not an oversight.

## Sign-off checklist
- [x] Kunal reviews this pack (said "go")
- [x] Gemini audit → PASS-with-findings (P2, P3-optimum) → fixed
- [x] GPT audit → BLOCK (P2, P3-harness) → fixed
- [x] Gemini + GPT re-audit (round 2) → both PASS-with-findings (write-path family) → 3 guards added (+ 1 reverted as redundant)
- [x] Saboteur caught 3 blind sentinels → rewrote to commit-count measure; submitDraft guard reverted
- [x] **Gemini + GPT re-audit (round 3) → BOTH PASS, zero actionable findings** (2026-06-14). Both ran the harness (64/64) + independent Chromium probes (each guard: commits=1; submitDraft idempotent: atomicCalls=1, status in_transit). Gemini: 2× INFO confirming the submitDraft-revert + the commit-count harness correction. GPT: "No new blocking or P3 findings… did not find another missed high-confidence record-creating handler." First fully-clean external round.
- [ ] Full 64-mutation saboteur sweep (pre-commit gate) — RUNNING detached (~3-4h); need 0 BLIND
- [ ] Kunal decision: require one more confirming external round (true 2-consecutive-clean convergence) OR proceed to commit on this clean pass + a 0-BLIND full sweep
- [ ] Kunal authorises commit
