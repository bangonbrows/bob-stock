# BOB Stock App — Consolidated Blind-Audit Report

**Date:** 2026-06-12 · **Inputs:** 6 independent unprimed AI audits (Gemini app, Gemini CLI, GPT app ×3 passes, GPT CLI ×multiple, Claude app ×2, Claude CLI) of the de-primed working tree. Every finding triaged by Claude against the live code; convergence counted; false/known separated. Full evidence: `BLIND-AUDIT-TRACKING.md`.

## Executive summary

**The app's core is sound; its cross-device sync layer and several half-finished fixes are not.** Six blind auditors independently confirmed that the things deliberately hardened — the `Validate.qty/money` trust-boundary policy, durable-write rollback, prototype-pollution guard, name/ID sanitisation, CSP, and the stock-take→adjustment math — genuinely hold. The ~63 genuine new issues concentrate in: (1) cross-device sync, (2) the delete/tombstone path, (3) the transfer subsystem, (4) push-retry reliability, (5) financial-report correctness, (6) boundary-symmetry/field-drift siblings + one proven XSS class.

**Not production-safe for multi-store use as-is** — but the blockers are specific and fixable, and most root in two places: *transfers/records don't sync* and *the client is the only trust boundary* (the latter already accepted-for-alpha, with the Azure punch list as the real gate).

**7 of the genuine bugs are incomplete-sweep misses in my own recent fixes** — caught precisely because blind auditors had no "already fixed" blinder. Those are the cleanest, highest-confidence fixes.

---

## FIX-PRIORITY ORDER

### Tier 0 — Quick wins (high value, low effort, no backend needed)
1. **Delivery "Shipping Cost" silently dropped** (×4, runtime-proven) — `del-shipping` is read nowhere; calc/save read non-existent `del-customs`. One-line field-name fix. **Corrupts live margins/costs right now.** [H-1/GPTC-3/GPTa-30/Claude-H6]
2. **Migration/restore doesn't check persist success** — `_migrateFromLocalStorage` ignores `_persistAllToDexie`'s `false` return then deletes the source → silent empty-app on a failed restore. ~3-line fix. [CaC-H4]

### Tier 0.5 — Shared-device hygiene (cheap, high-value; the device model is shared store tablets)
- **Logout doesn't clear draft state → cross-user bleed** (runtime-verified) — wire `Transfer.resetState()` (currently dead code) + a `_resetDrafts()` into `App.logout`. [W8]
- **No double-submit guard on movement logging + delivery recording** — touchscreen double-tap duplicates the movement/delivery. Add a re-entrancy flag (the pattern exists elsewhere: `_stApproving`, `_txState._creating`). [W6/W7]

### Tier 1 — MY OWN regressions (clean, high-confidence; finish the sweeps)
3. **Tombstone-egress black hole** (×4, runtime-proven, P1) — my F-followup-2 `_egressOk` rejects `type:'deleted'` → offline deletes never sync. *Whole delete path needs rework* (see Tier 2). [G1-22]
4. **Master-data version advances before durable save** (×2) — `_applyMasterData` fire-and-forget `DB.commit()` + version write → device permanently misses catalogue on a failed persist. Use `commitDurable()` + version in the same Dexie meta txn. [G1-12/GPTa-39]
5. **"Synced ✓" + pending cleared after `markTransactionsSynced` fails** — false confidence; no retry scheduled. [GPTa-31]
6. **Backup import detaches categories/product-types** — F2-CRIT04 charset-reject covers products/stores only; sanitiser mutates cat/PT ids too. Extend to all sanitised collections. [GPTC-D]
7. **completeFlags partial resolution** (×2) + **over-receipt loses excess** — HIGH-02/H-02 siblings: make multi-line flag resolution one atomic write; record over-receipts. [GPT-15/GCLI-7/GPTc-4]
8. **Add-Product pricing bypass** — gated `editRefData` not `editPricing`; HO can set franchise discounts. Wave-B gating sibling. [GPTa-40]

### Tier 2 — Delete/tombstone path (rework holistically, don't patch ×5)
The weakest subsystem — 5 distinct bugs. Rework: **always write a durable `deletedTransactions` outbox atomically with the delete; the leader drains it; egress whitelists `type:'deleted'`; tombstone push verifies `processedCount` like the main push; carry DeletedBy/At/Reason; clean up acked tombstones.** [G1-22, G1-11, GCLI-10/GPTC-E, GPTa-20, GCLI-14, GPTa-44, M1]

### Tier 3 — Stored XSS (proven; kill the class)
**Transaction/stock-take/cost-history/delivery ids render raw into inline `onclick` handlers and aren't sanitised; reachable via backup import.** GPT-CLI + Gemini-CLI runtime-proved execution. Fix the class: `data-id` + `addEventListener` (no inline-handler string interpolation) + reject unsafe ids at every ingest boundary. [GCLI-1b/GPTC-F]

### Tier 4 — Financial-report correctness (real money bugs)
> **SINGLE ROOT CAUSE (Claude-CLI):** financial reports key off `isIn`/`isOut` **direction** when they should use transaction **category** (sale vs transfer vs adjustment vs wastage). One root fix — "count/bill on category, not direction" — corrects 9, 10, and 13 at once.
9. **Wastage/damage counted as sales + profit** (×1, runtime-proven) — `out`→`sale`; wastage logged as `out`. [GPTC-B]
10. **Franchise invoice over-bills returns + adjustments** (×2: GPTC-H + Claude-CLI-H5, runtime-proven) — uses coarse `isIn` → bills `return_in` + `adjustment_in` as HO supply. [GPTC-H/CaC-H5]
11. **Reconciliation report uses pending/rejected takes as baseline + ignores same-day movements** — VERIFIED (no status filter at 3779; same-day excluded at 3788). Claude-CLI validated the net-movement *math* (sound) but not the baseline selection. [GPTa-34/35]
12. CSV export ignores category/type filters; two unlabeled stock-value numbers; null-price products valued $0. [GPTC-C, M7/M8]
13. **Sell-through % counts transfers/moves/wastage as "sold"** — `isOut` not `category==='sale'` (index.html:3714). Inflates the performance metric directors use. [CaC-M6]
14. **Margins overstated** (cascade) — Margin Report math is correct but reads `currentCost`, which omits the dropped shipping (Tier-0 #1). Fixing #1 fixes margins. [CaC cascade]
> Claude-CLI honest coverage gap: Reorder List + Dead Stock not yet read line-by-line (drive purchasing; likely carry the same direction-vs-category risk) — worth a follow-up read if remediating this tier.

### Tier 5 — Transfer subsystem + correctness (client-side, medium)
Negative stock reachable (no source check in Transfer.create/receive); stale-cancel double-count; receive accepts raw qty; return transfers lose `type`; multi-store users logged to wrong store (×2 sites); rejected stock-take approvable; delete-category orphans products; clear-discount→full-price; duplicate delivery lines overwrite cost history; first-launch acts on seed before first pull; negative-stock floor/alert. [GPTa-21/22/23/27/45/42/43/41/38/24, GPTc-4, M-1]

### Tier 6 — ARCHITECTURE / SERVER-SIDE (the real multi-store gate — Azure work)
- **Transfers/deliveries/stock-takes/catalogue records don't sync** (×4) — the multi-store feature is single-device-only. Sync the record envelopes; server-side idempotency on (TransferId, Type); upstream catalogue-write endpoint. [C1 + SERVER-SIDE-REQUIREMENTS.md]
- Unknown-product movements dropped + cursor advances (data loss until catalogue syncs).
- Sync-cursor: device-clock fallback, 10s lookback, $skip pagination.
- All in `SERVER-SIDE-REQUIREMENTS.md` (already authored): server auth/authz/store-scope, push ingest validation, append-only audit, observability.

### Tier 7 — Scale/perf (README claims 100K+; the analytics don't)
- **Director analytics are O(stores×txns×products)** and re-sort cost-history per call → main-thread freeze at scale. Precompute a productId→sorted-costHistory index/render, memoize `currentCost`, use a productId→product Map. [Ca-P1]
- **Transaction views hard-cap at 500 rows, no pagination/indicator** → old movements unreachable. [Ca-P2]
- In-memory full ledger (`_loadFromDexie().toArray()`) is the OOM ceiling on mobile at 50K+ [G1-19]; on-demand cursors + rollup tables are the real fix.

---

## ADDENDUM — Claude-app WAVE 3 (gap closure, triaged 2026-06-12)

Claude-app delivered a final wave on its admitted thin areas. **All load-bearing claims re-verified against the repo — zero false positives in the Medium set.** Adds ~11 Medium + a Low cluster (total genuine now **~75**). Slot into the tiers as:

- **→ Tier 0 (quick wins):** register the `login-audit` route (W3-1, 1-line — the whole Login Audit feature is currently unreachable); preserve `leadDays` in `saveOptimumLevels` (W3-4, real silent data-loss of reorder lead times).
- **→ Tier 4 (financial):** delivery Currency selector is decorative (W3-8) — USD/EUR costs silently booked as AUD; store+convert or remove.
- **→ Tier 5 (client correctness):** Optimum-Levels "Save All" writes `minQty:0` thresholds catalogue-wide (W3-5, alert spam); unify the two contradictory threshold editors (W3-6); Reorder List ignores `optimumQty`, suggests `minQty*2` (W3-7); login-audit sync-or-relabel decision (W3-2/3); date-preset month-end overflow; unify the two device-ID keys; negative-stock shows "LOW" not "OUT".
- **→ NEW Tier 5.5 — Accessibility (runtime-verified):** desktop sidebar + Log-Movement/Stock-Take chips & cards are keyboard-inaccessible (W3-10 — a keyboard/screen-reader staff member cannot do the two core daily tasks on desktop); modals/PIN-lock don't trap focus and the PIN lock is operable-behind for AT users (W3-11); plus the Low a11y cluster (labels, aria-live, headings, skip-link, colour-only status).
- **→ Tier 8 (cleanup):** dead code — `generateDemoTransactions` (~195 lines), `Sync._mergeTransactions`, `Transfer.resetState`, dead `_migrate` prune, duplicate `_downloadCSV`; the dual fire-and-forget-vs-Durable API hazard (= the convergent GPT-12/GCLI-4 family) is the root maintenance risk.

Claude-app declares the client-side audit **complete** after wave 3; its one remaining blind spot is the backend (Logic Apps/SharePoint definitions weren't in the bundle) — that's the existing Tier 6/Azure phase.

## KNOWN / ACCEPTED-FOR-ALPHA (do NOT re-litigate — already decided)
Client-side auth model & route gating (P-13) · password/PIN unsalted SHA-256 + no lockout + hashes in backup (D-039) · SAS URLs in browser (Azure) · float penny-drift (MED-01) · CDN-dependency/self-host (D-037 backlog) · background-sync handler stub · in-memory-ledger scaling ceiling. The blind auditors re-reported all of these loudly (they couldn't see the decision log); they are real but already owned on the Azure roadmap.

## FALSE / ARTIFACT / REFUTED (settled against code — ignore)
- **Packaging artifacts:** "missing icons" (I didn't copy `icons/` into the blind bundle; they exist) · "sync disabled / %%CONFIG_URL%%" (CI-replaced deploy placeholder).
- **Gemini-app:** "no storage.persist" (we call it) · "no skipWaiting/clients.claim" (sw.js has both) · "stored XSS in ledger" (esc'd) · "RxDB rewrite" (opinion).
- **Gemini-CLI-11** restore-broken (works via boot migration) · **Gemini-CLI-13** cost-sort non-deterministic (V8 sort stable) · **GPTa-28** prune-deletes-history (prune is dead → bloat, not deletion) · **CaC-M2** stock-take stale-delta (frozen-delta math is correct).

## VALIDATED SOLID (independent confirmation our hardening works)
`Validate.qty/money` rejects (not coerces) `5e2`/hex/fractional/neg/Infinity at all boundaries · durable-write rollback real · prototype-pollution guard holds · stock-take→adjustment math + idempotency sound · CSP object-src/framing · leader-election tie-breaks · Dexie/Chart pinned+SRI. **Two blind Claudes + GPT-CLI independently confirmed these.**

## Meta-lesson (banked as framework P-17)
Primed auditors confirm what they're told is fixed; only blind auditors attack it. The single most-confirmed bug (tombstone egress, ×4) lived in code GPT had called "clean," which every subsequent *primed* round confirmed instead of re-attacking. **Periodically audit blind** — it's the only way to catch the siblings a primed sweep misses and to get an honest read on what's genuinely solid.
