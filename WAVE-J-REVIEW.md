# Wave J — Tier 3: Stored-XSS Class Kill — Code Review Pack

**Branch:** `fix/cli-tri-audit-2026-05`  ·  **Date:** 2026-06-15  ·  **Engineer:** Claude (sole engineer)
**Scope (locked, both auditors reviewed):** `audit-artifacts/WAVE-J-TIER3-SCOPE.md`
**Harness:** `WAVE-J-HARNESS-RESULTS.md` — 85/85 clean, 4 CAUGHT / 0 BLIND.

## The class being killed
The blind audit proved a **stored XSS**: a ledger id (transaction / transfer / stock-take / cost / delivery id)
carrying a JS-string breakout payload, when interpolated raw into an inline `onclick="fn('${id}')"`,
**executed on click** (`executed:true`). Ledger ids flow in from **two untrusted ingress points** —
SharePoint sync `pull()` and backup-file restore — neither of which the user types, so the value is
attacker-influenceable on a shared cloud / hostile backup. HTML-escaping alone is **insufficient** here:
the browser HTML-decodes the attribute before the JS string is parsed, so an escaped quote still breaks out.

## Two-layer fix
**Layer 1 — reject at ingest (don't mutate keys).** Mutating a ledger id to "clean" it would orphan every
reference to it (the F2-CRIT04 detach class). So we **reject the whole record at the boundary** instead.
- New validator `Stock._isSafeLedgerId(id)` (index.html ~997): string, 1..128 chars, no
  `< > " ' \` ` \\ \x00-\x1f`, and passes `_isSafeKey`.
- **Backup restore** (`_validateAndScrubBackup`, index.html ~3214): rejects the file if any
  transaction/deletedTransaction/transfer/stockTake/costHistory/delivery id (incl. `targetTransactionId`,
  `transferId`, `deliveryId`) is unsafe. → **S-82**
- **Sync pull** (sync.js ~972): validates `TransactionId`/`TargetTransactionId`/`TransferId` on the **raw**
  SharePoint row **before** the tombstone split — important because the tombstone branch bypasses
  `_fromSharePoint`. Unsafe row → quarantined, skipped. → **S-83**
- **Load-time backstop** (`DB.quarantineUnsafeLedgerIds()`, db.js ~420; called in `initDB`): non-mutating
  cache filter that drops any already-stored hostile-id row for devices contaminated **before** this fix
  shipped. Disk untouched; rebuilds `Stock` cache. → **S-84**

**Layer 2 — harden the render ("Safe Inline").** Every ledger-id render sink converted from
`onclick="fn('${id}')"` to `onclick="fn(this.dataset.id)" data-id="${UI.esc(id)}"`. The id now rides in a
data-attribute (HTML-escaped, can't break the attribute) and the handler reads it back as a **string** via
`this.dataset.id` — never parsed as JS. 21 sinks converted: 9 in index.html, 12 in phase2.js (transfers).
Proven by **S-85** (hostile id, real click, `xssFired=0`).

## Why these boundaries (auditor-confirmed in scope review)
- Reject, don't strip — stripping/mutating ids = orphaned references (detach bug).
- Validate the **raw** sync row pre-split — the tombstone path skips the normal mapper.
- `UI.esc` in `data-id` is correct (attribute context); `this.dataset.id` decode is plain string (no JS parse).
- Master-data ids (product/category/store/user/supplier/threshold/tab) are **out of scope**: internally
  generated + `_isSafeKey`-guarded at master-data ingest. Confirmed by the P-12 sweep (see harness doc).

## Files changed
| File | What |
|------|------|
| index.html | `_isSafeLedgerId` validator; backup-restore reject block; 9 render sinks → Safe Inline. |
| sync.js | pull-loop ledger-id quarantine (pre-tombstone-split). |
| db.js | `quarantineUnsafeLedgerIds()` + `initDB` call. |
| phase2.js | 12 transfer render sinks → Safe Inline (data-tid/data-pid). |
| test/smoke-test.js | S-82..S-85. |
| test/saboteur-runner.js | S-82..S-85 mutations. |

## Auditor punch-list resolution (GPT + Gemini, both "sound-with-changes")
Both auditors reviewed the **design** and returned a punch-list. Several items were already closed in the
build (they reviewed the scope doc, not the final code); the rest are now fixed. Status of every item:

| # | Auditor | Finding | Resolution |
|---|---------|---------|------------|
| G1 | GPT | `UI.esc` is HTML-context, not JS-string — escaped quote still breaks out of `fn('${UI.esc(id)}')` | **Closed (design).** We never use `fn('${esc}')`; we use Safe Inline `fn(this.dataset.id)` + `data-id="${UI.esc(id)}"` — id read as a string, never JS-parsed. Gemini endorsed Safe Inline over `addEventListener` for this innerHTML-template codebase. (Future CSP → delegation, logged.) |
| G2 | GPT | Don't strip/repair ledger ids (would detach references) | **Confirmed.** We reject/quarantine at boundaries, never mutate a key. |
| G3 | GPT | Delivery-edit **modal footer** Save (`index.html:4444`) reintroduces the raw id | **Already closed in build** — `index.html:4465` Save uses `_saveDeliveryPackaging(this.dataset.id)` + `data-id`. Verified. |
| G4 | GPT | Sync validation must run **before** the tombstone split (tombstones skip `_fromSharePoint`) | **Already closed** — `sync.js:971-974` validates the raw row before the `Type==='deleted'` split (977) and before any raw `TargetTransactionId` use. Verified. |
| G5 | GPT | Persisted-legacy ingress: localStorage→Dexie migration + **recovery mode** hydrate raw data | **Migration path already covered** (migrate→`_loadFromDexie`→`quarantineUnsafeLedgerIds` at `db.js:1024`). **Recovery-mode path was a real residual gap → FIXED:** added `quarantineUnsafeLedgerIds()` in the disaster-recovery `catch` (`db.js`, after raw `JSON.parse`) so a contaminated local archive can't feed hostile ids to render. |
| G6 | GPT | Transfer-sync wording: no path imports SP rows into `DB.transfers[]`; transfer UI reachable via backup/legacy | **Clarified.** `TransferId` is validated on the raw transaction row at ingest; transfer records reach the cache via backup-restore + legacy storage, both covered by backup-reject + load-time quarantine. No behaviour change needed. |
| Grec | GPT | Prefer a strict **allowlist** over a breakout-char denylist | **Adopted.** `_isSafeLedgerId` now uses `^[A-Za-z0-9_-]+$` + `_isSafeKey` + length. Every machine-gen ledger id (`txn_`/`tr_`/`del_`/`st_`/`ct_`+`<ms>`+hex, `ct_<productId>` e.g. `ct_MKU_1`) passes — zero false-reject; strictly safer + CSP-friendly. |
| M1 | Gemini | `_updateSTRow` (`index.html:1963`) `oninput` interpolates `${p.id}` | **Already closed in build** — `index.html:1970` uses `this.dataset.pid` + `data-pid`. Verified. (p.id is master-data, but converted for consistency/defence-in-depth.) |
| M2 | Gemini | Sync must also reject hostile `TransferId` (mapped `sync.js:615`, used in ~10 phase2 sinks) | **Closed** — `TransferId` is in the 3-field ingest check (`sync.js:972`) and `S-83` proves it. |
| M3 | Gemini | Standardise on Safe Inline, not `addEventListener` | **Adopted** — Safe Inline throughout. |

Net new code from this re-audit pass: recovery-mode quarantine (`db.js`), allowlist validator (`index.html`),
quarantine log wording (`sync.js`). Harness re-run after the changes: **85/85 clean, 4 CAUGHT / 0 BLIND.**

## CODE re-audit round (GPT sound-with-changes, Gemini APPROVE) — resolution
Gemini APPROVE (clean). GPT 3 findings, all closed:

| # | Finding | Resolution |
|---|---------|------------|
| F1 | **Real gap.** `quarantineUnsafeLedgerIds` ran at boot + recovery, but `DB.refresh()` (after every sync pull) re-hydrates `_cache` from Dexie and only `_sanitizeNames`+`_buildCache` — so a pre-fix hostile on-disk row (quarantine is non-destructive) re-enters the active cache after any sync. | **FIXED** — `refresh()` now calls `quarantineUnsafeLedgerIds()` after `_sanitizeNames`, before `_buildCache`. Sentinel **S-86** (write hostile row to Dexie → refresh → gone from cache, still on disk). |
| F2 | Grec "no false-reject" not fully proven: product-id creation (`_doAddProduct`) used a denylist, so a product id with `.`/space/`/` is accepted; that id is embedded raw into cost-history ledger ids (`ch_<ms>_<productId>`), which would then fail the allowlist and be quarantined. | **FIXED** — `_doAddProduct` now enforces the same allowlist `^[A-Za-z0-9_-]+$`, so every derived ledger id is clean by construction. Sentinel **S-87**. |
| F3 | Harness overstates coverage: S-83 only asserted the hostile regular txn didn't merge; label claimed tombstone/multi-field coverage. | **STRENGTHENED** — S-83 now also sends a benign-`TransactionId`/hostile-`TransferId` row (independently exercises the multi-field gate) and asserts against **disk (Dexie)** instead of a post-`refresh()` cache read. |

GPT confirmed closed in code: G3 (modal footer `dataset.id`), G4 (sync validates all 3 ids before the tombstone split), render-sink conversion complete, no third foreign ingress. Gemini confirmed all of the above + quarantine non-destructive.

**Saboteur self-catch (banked lesson):** strengthened S-83 first went BLIND on the targeted run — the F1 fix (quarantining `refresh()`) masked the sync-gate effect when the assertion read `DB.get()` after `refresh()` (the S-70 class: a guard sentinel must observe the effect the fix controls, not a downstream-filtered view). Retargeted to read Dexie directly → CAUGHT. Harness then **87/87 clean; S-82..S-87 = 6 CAUGHT / 0 BLIND**; full 87-mutation sweep = 87 CAUGHT / 0 BLIND / 0 SKIPPED.

## Round 2 — Gemini PASS, GPT sound-with-changes (F2-followup) — resolution
After the fixes above: **Gemini PASS** (clean). **GPT sound-with-changes**, 2 findings:

| # | Finding | Resolution |
|---|---------|------------|
| F2-followup | **Real — same class, other doors.** F2 fixed the UI add path (`_doAddProduct`), but **backup restore** (`index.html` ~3205) and **SharePoint master_data sync** (`sync.js` ~186) still used the old denylist for product ids — so a `MKU.1` from backup/sync mints `ch_<ms>_MKU.1`, which `_isSafeLedgerId` then quarantines (same false-reject/data-availability divergence). | **FIXED both doors:** backup now rejects a product id outside `^[A-Za-z0-9_-]+$`; master_data `badId` tightened from the `<>"'`+backtick denylist to the same allowlist (all real catalogue ids — `pt_`/`cat_`/`MKU_1` — pass, so zero false-reject; a loose synced row is skipped). New sentinels **S-88** (backup) + **S-89** (master_data). |
| S-83 TargetTransactionId | GPT: S-83 still doesn't *independently* mutation-prove the `TargetTransactionId` field — removing only that field from the gate would likely still pass, because a hostile tombstone target matches no local row and creates no disk row either way. GPT flagged it as "not a product-code blocker." | **Accepted as a reasoned coverage limit (documented, not silently capped).** It is *structurally* unobservable: a hostile `TargetTransactionId` cannot reference any stored row — the referenced row would carry the same hostile id and be independently quarantined by the `TransactionId` gate + load-time quarantine — so an un-gated hostile tombstone is inert (no delete, no stored audit row, no render). `TargetTransactionId` in the gate is belt-and-suspenders; its practical exposure is nil. Static code (`sync.js:972`) and Gemini both confirm the field is gated. We do **not** fabricate a fragile sentinel for an effect that cannot be observed. |

Net new code (round 2): backup product-id allowlist (`index.html`), master_data `badId` allowlist (`sync.js`). Harness now **89/89 clean**; S-88/S-89 mutation-proven.

## Round 3 — FINAL pre-commit deep audit (Gemini PASS, GPT BLOCK → fixed)
Both auditors were given an adversarial "try to defeat it" brief over the whole Wave J surface (not a re-confirm).
- **Gemini: PASS** — no stored-XSS path; confirmed render hardening, all 4 ingress gates, egress purification (push/backup use the quarantined cache, so a contaminated disk can't poison cloud/exports), embed divergence closed. 2 INFO notes (below).
- **GPT: BLOCK** — found a real **P2 length-coupling** bug (no XSS bypass found):

| Finding | Detail | Resolution |
|---------|--------|------------|
| **P2 — cost-history length coupling** | `_isSafeLedgerId` caps length at 128, but product-id ingress checks **charset only**, not length. Cost-history ids embedded the product id (`ch_<ms>_<productId>`), so a valid-charset product id >111 chars mints a >128-char ledger id → quarantined (on disk, hidden from cache). GPT runtime-proved it (productIdLen 120 → costIdLen 137 → ledgerSafe false → cacheHasCost false, diskHasCost true). Also a legacy variant: a pre-existing `LEG.1`-style product id mints `ch_<ms>_LEG.1`. | **FIXED at root (GPT's preferred option):** the two delivery cost-history pushes (`index.html` ~4366, ~4510) now use an **opaque** suffix `ch_<ms>_<hex>` (crypto random), decoupling the ledger id from the product id entirely. No product-id length/charset/legacy weirdness can ever mint a bad ledger id again — subsumes the charset gate AND the legacy variant a length-cap would miss. Nothing parses `ch_` ids (cost lookups use the `productId` field; delete uses the id directly), so this is migration-safe. The manual cost path (~4142) was already opaque. New sentinel **S-90** (drives a real delivery with a 121-char product id → cost row survives refresh quarantine). |

**Gemini INFO (noted, no code change):** (1) `Sync.push` gates ids via the quarantined cache (relies on the `refresh()` lifecycle) rather than a local `_isSafeLedgerId` check — safe, a defensible dependency. (2) `UI.productName` now self-escapes, so a couple of call sites (e.g. `_undoMovement`) double-escape (`&`→`&amp;amp;`) — harmless/safer-than-missing display nit, outside the ledger-id class; logged for a future cosmetic pass.

Net new code (round 3): opaque cost-history id at the 2 delivery paths (`index.html`). Harness now **90/90 clean**; S-90 mutation-proven.

## Round 4 — BOTH PASS (GPT + Gemini) on the P2 fix
Adversarial briefs on the opaque-id fix. **GPT PASS** (zero P0–P3; runtime-proved all three cases — delivery, packaging-edit, legacy `LEG.1` — produce opaque, safe, surviving ids; confirmed no other ledger id embeds a master-data id and nothing depends on the old `ch_<productId>` format). **Gemini PASS** (same conclusions; confirmed exhaustive ID-pattern sweep). The external gate is met.

GPT's 2 INFO-only items (non-blocking) addressed as **test + documentation hardening (no app-logic change)**:
- **Harness symmetry** — S-90 mutation-proved only the *new-delivery* cost-history path (4366); added **S-91** + a matching saboteur mutation for the *packaging-edit* path (4510), so both opaque-id writes are independently proven.
- **Stale wording** — the backup rejection *message* and the comments at `index.html:2885`/`:3206` and `sync.js:186` still said product ids are "embedded into cost-history ids." Reworded: the embed was removed (opaque ids); the product-id allowlist is **retained as catalogue hygiene / defence-in-depth**, not for the (now-gone) embed. The S-88 saboteur find was switched to a message-agnostic code-only match so message wording can't orphan it.
- GPT's earlier 2 INFO (push-egress lifecycle dependency; `UI.productName` double-escape) reaffirmed non-blocking; logged for a future cosmetic pass.

These changes touch only test files + comments + one user-facing string (identical reject behaviour), so they do **not** alter audited logic. Harness now **91/91 clean**; S-91 mutation-proven. Final **91-mutation** pre-commit sweep is the last gate (0 BLIND + 0 SKIPPED). Also bumped the saboteur per-child timeout 360s→600s — the 90+ -sentinel suite (~266s in-repo, slower in the copied temp dir) was brushing the old ceiling and truncating a baseline at ~88.

## What I want the auditors to check (code re-audit, if a second pass is run)
1. **Completeness of the ledger-id sink population** — did I miss a render sink that interpolates a
   transaction/transfer/stock-take/cost/delivery id raw? (Master-data ids are deliberately excluded.)
2. **Ingest coverage** — any third path a ledger id can enter from (besides sync pull + backup restore)
   that I didn't gate?
3. **The tombstone-split ordering** in sync.js — is the validation genuinely before every branch that
   consumes the id?
4. **No behaviour regression** — Safe Inline passes the id as a string arg; any handler that relied on
   the old `'${id}'` literal quoting (e.g. expecting a number, or doing its own parsing)?
5. **Load-time quarantine** — non-mutating + disk-safe? Any ordering issue vs. `_buildCache` / first render?
