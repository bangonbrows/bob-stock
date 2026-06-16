# Wave J (Tier 3 — stored-XSS class kill) — Harness Results

**Branch:** `fix/cli-tri-audit-2026-05`  ·  **Date:** 2026-06-15  ·  **Status:** built, regression-clean, mutation-proven, NOT committed

## Smoke (clean code)
```
==== 85/85 sentinels PASS on clean code ====
```
- 81 pre-existing sentinels: all PASS (zero regression from the render rewiring + ingest changes).
- 4 new Wave J sentinels (S-82..S-85): all PASS clean.

## Saboteur (mutation) — targeted S-82..S-85
```
[baseline] 85/85 green on clean code
[CAUGHT]  S-82  backup ingest reject
[CAUGHT]  S-83  sync-pull ingest reject (incl. tombstone path)
[CAUGHT]  S-84  load-time quarantine
[CAUGHT]  S-85  render Safe-Inline (no execute on click)
==== mutation results: 4 CAUGHT, 0 BLIND, 0 skipped of 85 ====
```
Every new sentinel was proven to flip RED when its matching fix is reverted — no blind tests.

## New sentinels
| ID | Layer | Proves |
|----|-------|--------|
| S-82 | 1 (ingest) | `_validateAndScrubBackup` rejects a backup whose transaction/transfer/stock-take/cost/delivery id carries a breakout char; a clean backup still imports. |
| S-83 | 1 (ingest) | Sync `pull()` quarantines a hostile `TransactionId`/`TargetTransactionId`/`TransferId` **before** the tombstone split (the path that bypasses `_fromSharePoint`); a poisoned cloud row never merges. |
| S-84 | 1 (backstop) | `DB.quarantineUnsafeLedgerIds()` drops an already-stored hostile-id row from the active cache at load (covers devices contaminated before the fix). Disk untouched. |
| S-85 | 2 (render) | **Headline.** A transaction whose id is an XSS payload does **not** execute when its delete button is clicked — `xssFired=0`. The blind audit proved `executed:true` on the old inline interpolation; this proves `executed:false`. |

## Change-safety sweep (P-12)
- Swept all `*.html`/`*.js` for `onclick="fn('${...id}')"` raw inline-interpolation of an id.
- Every remaining hit is a **master-data** id (product, product-type, category, store, supplier, user, threshold, internal tab) — governed by `_isSafeKey` at master-data ingest and internally generated; out of the ledger-id class per the locked scope (`audit-artifacts/WAVE-J-TIER3-SCOPE.md`).
- **Zero** ledger-id render sinks remain with raw inline interpolation. Master-data flows untouched.

## Re-run after design-review punch-list (allowlist validator + recovery-mode quarantine + log wording)
```
==== 85/85 sentinels PASS on clean code ====
==== mutation results: 4 CAUGHT, 0 BLIND, 0 skipped of 85 ====
```
No regression from the GPT/Gemini-driven changes. See `WAVE-J-REVIEW.md` for the full punch-list resolution.

## CODE re-audit round (GPT sound-with-changes, Gemini APPROVE)
Gemini: clean APPROVE. GPT: 3 findings, all addressed:
- **F1 (real gap):** `DB.refresh()` (runs after every sync pull) re-hydrated the cache from Dexie without re-quarantining — non-destructive quarantine means a pre-fix hostile on-disk row re-entered the active cache after any sync. FIXED (`db.js refresh()`). New sentinel **S-86**.
- **F2:** product-id creation used a denylist, so a product id with a dot/space/slash was accepted and its derived cost-history ledger id (`ch_<ms>_<productId>`) would then fail the allowlist and be quarantined. FIXED — product-id creation now enforces the same allowlist (`index.html _doAddProduct`). New sentinel **S-87**.
- **F3:** S-83's label over-promised. Strengthened to add a benign-`TransactionId`/hostile-`TransferId` row (independently exercises the multi-field gate) and to assert against **disk (Dexie)** not a post-`refresh()` cache read.

New sentinels **S-86, S-87**; **S-83** strengthened (+ retargeted to disk read).
```
==== 87/87 sentinels PASS on clean code ====
==== targeted mutation results: S-82..S-87 → 6 CAUGHT, 0 BLIND, 0 skipped ====
```
**Saboteur self-catch (banked):** S-83 first went BLIND on the targeted run — the F1 fix (quarantining `refresh()`) masked the sync-gate effect when the test read `DB.get()` after a `refresh()` (the S-70 lesson). Retargeted S-83 to read Dexie directly → CAUGHT.

## Full pre-commit sweep (gate) — round 1
```
==== mutation results: 87 CAUGHT, 0 BLIND, 0 skipped of 87 ====
```
Every sentinel S-01..S-87 mutation-proven against the whole codebase. Log: `audit-artifacts/WAVE-J-FULL-SWEEP.log`.

## Round 2 — GPT F2-followup (Gemini PASS, GPT sound-with-changes)
GPT found F2 was closed only on the UI add path; **backup restore** and **SharePoint master_data sync** still used the old denylist for product ids → a loose product id mints a quarantined cost-history ledger id. Fixed both doors (backup allowlist + master_data `badId` allowlist). New sentinels **S-88** (backup), **S-89** (master_data). GPT's S-83/TargetTransactionId note accepted as a reasoned, documented coverage limit (structurally unobservable — see `WAVE-J-REVIEW.md`).
```
==== 89/89 sentinels PASS on clean code ====
```
S-88/S-89 mutation-proven.

## Round 3 — FINAL deep audit (Gemini PASS, GPT BLOCK → fixed)
Adversarial "try to defeat it" briefs over the whole Wave J surface (not a re-confirm). Gemini PASS (no XSS path; confirmed render hardening, all ingress gates, egress purification). GPT BLOCK — real **P2 length-coupling**: product-id ingress checks charset but not length, and cost-history ids embedded the product id (`ch_<ms>_<productId>`), so a >111-char product id minted a >128-char ledger id that `_isSafeLedgerId` quarantines (on disk, hidden from cache). **Fixed at root:** delivery cost-history ids are now opaque (`ch_<ms>_<hex>`), decoupled from the product id. New sentinel **S-90** (drives a real 121-char-product delivery → cost row survives refresh quarantine). Gemini's 2 INFO notes logged (push-egress lifecycle dependency; harmless double-escape in `UI.productName` call sites).
```
==== 90/90 sentinels PASS on clean code ====
```
S-90 mutation-proven.

## Round 4 — BOTH PASS; harness symmetry + doc tidy
GPT PASS + Gemini PASS on the opaque-id fix (both runtime-verified delivery / packaging-edit / legacy cases). Addressed GPT's 2 INFO (test+doc only): added **S-91** (packaging-edit path 4510 opaque-id proof, symmetric with S-90's 4366); reworded the stale "embedded into cost-history" backup message + comments (allowlist retained as catalogue hygiene); switched S-88's saboteur find to message-agnostic. Bumped saboteur per-child timeout 360s→600s (90+ sentinels brushed the old ceiling → a baseline truncated at ~88).
```
==== 91/91 sentinels PASS on clean code ====
```
Final 91-mutation pre-commit sweep: gate 0 BLIND + 0 SKIPPED (running).

## Diff footprint
```
 db.js                   | 30 +
 index.html              | 39 +-
 phase2.js               | 22 +-
 sync.js                 |  9 +
 test/saboteur-runner.js | 16 +
 test/smoke-test.js      | 29 +
 6 files changed, 125 insertions(+), 20 deletions(-)
```
