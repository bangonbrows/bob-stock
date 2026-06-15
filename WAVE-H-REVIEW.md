# Wave H Review Pack — Blind-Audit Tier 1 (my own regressions)

**Date:** 2026-06-14 · **Branch:** `fix/cli-tri-audit-2026-05` (commit base `61a0da1`; Wave H NOT committed)
**Source:** `BLIND-AUDIT-CONSOLIDATED-REPORT.md` Tier 1 — the 6 incomplete-sweep misses in my own earlier fixes. Pre-scoped (all confirmed still-real) in `audit-artifacts/WAVE-H-SCOPE.md` before any edit.

---

## Plain-English summary (for Kunal)

1. **Offline deletes sync again (the big one).** This was the P1 four separate auditors found independently. When someone deleted a stock entry while offline, the delete was getting silently blocked from ever reaching the other stores' devices — so the item kept showing as "ghost" stock everywhere else. Fixed: deletes now go through. One precise line; the rest of the delete plumbing already handled it.
2. **The catalogue can't silently desync.** A product/price update from Head Office marks itself "applied" with a version number. That number was being bumped *before* confirming the save actually stuck — so a failed save would mark it done and the device would never retry, missing the update forever. Now the version only advances after the save is confirmed.
3. **No more false "Synced ✓".** If the cloud accepted your data but the device then failed to record that locally, the app used to flash "Synced ✓" and move on — a lie. Now it honestly shows "will retry", keeps the item pending, and retries.
4. **Backups can't quietly break product categories.** A crafted/corrupt backup could detach products from their categories on restore (they'd vanish from category-filtered views). The import now validates category and product-type IDs and checks all the references line up before accepting.
5. **Transfer resolution is all-or-nothing + over-receipts handled.** When a manager resolves several flagged transfer lines at once, it now commits as one unit — if one fails, none are half-applied (no stuck transfers). And if someone records receiving *more* than was sent, it's rejected with a clear message instead of silently dropping the extra units.
6. **Head Office can't set franchise pricing on new products.** Franchise discount is Director-only pricing; the "Add Product" form was letting Head Office set it. Now it's stripped unless you have pricing rights — matching the rule already enforced on the edit screen.

## Deliberately deferred to Tier 2 (delete/tombstone holistic rework)
The delete path has 4 more lower-stakes issues (missing audit metadata on offline deletes, a no-URL drop edge case, tombstone ack-verification, old-tombstone cleanup). These want a proper one-piece rework, not piecemeal patches. Tracked in `WAVE-H-SCOPE.md` (H1 siblings). Wave H fixes the P1 (deletes sync); the rest is its own wave.

---

## Technical changelog

| # | Finding | File · location | Change |
|---|---|---|---|
| H1 | Tombstone-egress black hole (G1-22, ×4, P1) | sync.js `_egressOk` | Whitelist well-formed `type:'deleted'` rows (must carry `targetTransactionId`) so offline deletes egress. `_toSharePoint` already serialises them correctly. Malformed tombstones (no target) still excluded. |
| H2 | Master-data version durability (G1-12, ×2) | sync.js `_applyMasterData` (now async) + caller awaits | `await DB.commitDurable()`; advance `bob_catalogue_version` ONLY if the durable persist succeeded. Was `DB.commit()` (fire-and-forget) + unconditional version write. |
| H3 | False "Synced ✓" after markSynced fails (GPTa-31, +GPTa-32) | sync.js push success block | On `!_marked`: keep pending, show "Saving… will retry", schedule a bounded proactive retry (`_scheduleSyncRetry`) — do NOT clear pending / show Synced / notify followers. Same retry now also covers the ambiguous-ack branch. |
| H4 | Backup detaches categories/product-types (GPTC-D) | index.html `_validateAndScrubBackup` | Extend the reserved-id + forbidden-char checks to all four sanitised id collections (products, stores, categories, productTypes); add referential-integrity (product.catId → category, category.ptId → productType must resolve). |
| H5 | completeFlags partial resolution + over-receipt (GPT-15/GCLI-7, GPTc-4) | phase2.js | Extracted settlement maths into shared `_computeFlagResolution` (no drift); new `resolveAllFlags` does ONE atomic write for all flagged lines; `completeFlags` calls it (was a per-line loop = half-resolved on mid-loop failure). `receive` rejects over-receipt (received>sent) at the boundary instead of silently losing the excess. |
| H6 | Add-Product pricing bypass (GPTa-40) | index.html `_doAddProduct` | Strip `franchiseDiscount` unless `Auth.can('editPricing')` — matches the inline `_setProductFranDisc` gate. (Confirmed the only two product-discount write sites; no other sibling.) |

## Harness
- 6 new sentinels **S-65..S-70** + 6 saboteur mutations.
- Regression: existing 64 sentinels still **64/64** after the fixes (no behaviour break).
- Results: see `WAVE-H-HARNESS-RESULTS.md` (filled after the runs).

## Risk notes for auditors
- H1: the egress whitelist requires `targetTransactionId` — a hostile row claiming `type:'deleted'` with no target is still rejected; server-side remains the authoritative gate (P-13).
- H2: `_applyMasterData` is now async; its only caller (`_fetchRemoteConfig`) awaits it. `commitDurable` runs the same `_sanitizeNames` as `commit`.
- H5: `resolveFlag` (single-item) and `resolveAllFlags` (batch) now share `_computeFlagResolution` — identical maths, no drift. `resolveFlag` retained (API stability) though `completeFlags` now uses the batch path. F2-HIGH02 credited-at-receive maths preserved exactly.
- H6: base `price` is still set under `editRefData` (product definition); only `franchiseDiscount` (the franchise pricing lever) is gated on `editPricing`, matching the canonical control.

## Follow-up round 1 (2026-06-14) — GPT BLOCK resolved (H2 cache-rollback sibling)

**GPT = BLOCK** (one P2); **Gemini = pending**. GPT ran the harness (70/70, 6 CAUGHT/0 BLIND) + independent runtime probes — H1–H6 all passed — but found a real **incomplete sweep of my own H2 fix**:

> `_applyMasterData` mutates the live cache (the upserts) BEFORE `await DB.commitDurable()`. H2 correctly holds the *version* on a failed persist, but the **in-memory catalogue was not rolled back** → a cache-only product/price survives in memory; a movement saved against a cache-only product then persists durably while the product vanishes on the next refresh = orphaned ledger row. (Runtime-proven: forced persist failure → version held + Dexie price unchanged ✓, but live cache price = 123.45 and a new product existed in cache only; a transaction saved against it survived a refresh that dropped the product.)

**Fix:** snapshot the four mutated collections (products/stores/categories/productTypes) before the upserts; on `commitDurable()` failure, restore them + `Stock._buildCache()` + `_rerender()`. Same snapshot-rollback pattern as the transfer writes. So a failed master-data persist now holds the version AND leaves the cache exactly as it was — no cache-only catalogue.

New sentinel **S-71** + saboteur mutation. Harness now **71 sentinels / 71 mutations**.

## Follow-up round 2 (2026-06-15) — Gemini BLOCK resolved (fatal-gate hardening + reference-drift)

**Gemini = BLOCK** (two P2; H1–H6 all PASS, 71/71 + 68 CAUGHT). Both findings are sound on the merits and adopted:

1. **Fatal-save overlay was dismissible** (index.html:1240). The app-wide "stop-on-durable-failure" gate had a *Dismiss* button → a user could dismiss after a confirmed durable write failure and keep working in a transient cache-only state (several save paths leave cache-only mutations on failure). **Fix:** replaced *Dismiss* with **Reload App** (`location.reload()`) — forces recovery to the durable state. (Pre-existing element hardened; both auditors requested it.)
2. **Master-data failure: missing fatal gate + reference-drift in the rollback** (sync.js). (a) Unlike every other durable-write path, a master-data persist failure showed no fatal overlay → silent device-DB failure. **Fix:** trip `UI.fatalSaveError` on `!_ok` (a `commitDurable()` failure means the device can't persist; the next user save would fail too). (b) The Wave-H-follow-up-1 rollback did `d.products = _mdSnap.products` (array swap) — but `copyFields` had mutated the *existing* row objects in place, so any module holding a captured product reference still saw the mutated values. **Fix:** IN-PLACE rollback — restore each surviving row's fields and drop rows the failed merge inserted, keeping array + object identity stable.

Harness: **S-71 upgraded** (now captures a live product ref and asserts in-place restore — array-swap would fail it) + **S-72** (reload button) + **S-73** (master-data fatal gate) + 3 saboteur mutations. Harness now **73 sentinels / 73 mutations**.

## Sign-off checklist
- [x] Kunal reviews this pack (Wave H sent to externals)
- [x] GPT audit → BLOCK (H2 cache-rollback) → fixed (S-71)
- [x] Gemini audit → BLOCK (fatal-gate dismissible + master-data fatal/ref-drift) → fixed (S-71 upgraded, S-72, S-73)
- [x] Gemini + GPT re-audit (report-mode) → **BOTH PASS** (2026-06-15). GPT independently Playwright-probed: version held, in-place rollback w/ object identity preserved, reload button, generic+specific fatals fire in order; confirmed 2a false-positive at db.js:185. Gemini: "Proceed with commit."
- [ ] Full 73-mutation saboteur sweep (pre-commit gate) — running
- [ ] Kunal authorises commit
- NOTE process: in an earlier round Gemini ran in an agentic mode and *edited* index.html + sync.js — those edits were REVERTED, then re-implemented deliberately here with sentinels. Future rounds: give Gemini the brief in report-only mode (banked: feedback_auditors_report_only).
