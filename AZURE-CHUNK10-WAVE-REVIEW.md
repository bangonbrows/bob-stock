# Chunk 10 — Wave Review: row-level store isolation

Branch `azure-phase-5-8-server`. Status: **server-side core isolation + client fold BUILT + PROVEN on staging;
217/217 sentinels PASS (incl. 5 new Chunk-10), saboteurs S-222..S-226 caught.** External code audit (GPT + AGY)
still to come. Nothing deployed to `main`.

## What Chunk 10 fixes (plain English)
Before: every store device downloaded the WHOLE company ledger and the UI just hid other stores — a franchisee
with DevTools or a backup export could read every store's movements, quantities and (with cost) margins
(framework P-13). After: the server sends each device ONLY the rows for the stores that device's account is
allowed to see, and REJECTS any attempt to write rows for a store outside that scope. Enforcement is server-side,
so out-of-scope data never leaves SharePoint.

## Scope source
The allowed store set is carried on the **device/account credential** (Chunk-5 `StoreCredentials` row) via a new
`StoreIds` field (JSON array of store slugs). Store account → its 1 store; franchisee/territory → their N stores;
`['*']` or Director → all. The pull/push LAs read the StoreIds from the **verified** credential row only
(`Match_cred` filters `Get_creds` to the row whose StoreId == the authenticated claimedStoreId), never from the
request body. Fail-closed: empty/missing scope matches nothing.

## The 5 data paths — all scoped + proven
| Path | LA (staging) | Rule | Proof |
|---|---|---|---|
| Ledger READ | `pull-v2-dual` | `StoreId ∈ scope` appended to the id-cursor + legacy filters | 7/7 — each cred sees only its stores; wrong key 401 |
| Record-steps READ | `recordsteps-pull` | **either-end**: `OwnerStoreId ∈ scope OR ToStoreId ∈ scope OR FromStoreId ∈ scope` | 5/5 — whitford RECEIVES a transfer OWNED by karrinyup; ardross sees none of it |
| Archive READ | `archive-pull` | `StoreId ∈ scope` (gate unchanged: Director/HO only per Chunk-8, so stores already blocked = fail-closed) | Director + HO scoped-all proven; stores correctly 401 |
| Ledger WRITE | `push-v2-validate` | reject rows whose `StoreId ∉ scope` (`OUT_OF_SCOPE_STORE`) | 6/6 — own accepted, cross-store blocked, multi-store franchisee accepted, director any |
| Record-steps WRITE | `recordsteps-push` | reject steps whose `OwnerStoreId ∉ scope` | 5/5 — same shape |

## Two design simplifications discovered during build (worth noting to auditors)
1. **Transfer either-end collapses on the READ side to plain StoreId scoping for the ledger.** The ledger has
   only `StoreId` (no From/To columns): a transfer is stored as TWO legs, each row owned by one store
   (`transfer_out`@sender, `transfer_in`@receiver). So StoreId scoping already delivers each store its own leg —
   the receiver gets its `transfer_in` because that row's StoreId IS the receiver. Either-end logic is only needed
   for **RecordSteps** (which DO carry Owner/From/To) so a receiver sees the sender's submit-step context.
2. **The single-store `STORE_MISMATCH` write rule was generalised to scope-membership.** Both push LAs already
   rejected any row whose store field ≠ the ONE authenticated storeId (a Chunk-5 anti-spoof). That HARD-BLOCKS a
   multi-store franchisee/territory account (its rows are owned by member stores, not by the account slug). Chunk
   10 replaces `store == claimedStoreId` with `store ∈ scope` (Director/`*` bypass). Single-store accounts are
   unaffected (their scope is exactly their one store).

## WDL implementation notes (for the code audit)
- No `select`/`map` in Logic Apps expression language → the OData OR-clause is built by **string replacement** on
  the stored JSON array (`["a","b"]` → `StoreId eq 'a' or StoreId eq 'b'`). Safe because StoreIds are
  director-set store slugs (no quotes/spaces); still fail-closed on empty via a `__no_scope__` sentinel.
- `StockTransactions_Staging.StoreId` is already **Indexed=True** → the scoped OR-filter stays threshold-safe.
- Write-side scope test parses the array with `json()` and tests membership with `contains()`.

## CLIENT FOLD — BUILT + PROVEN (2026-07-08)
The server enforces scope, but a device that synced under a wider scope (or before enforcement) still holds
out-of-scope rows locally. The client fold makes the app self-heal to its scope. The pull LA now **echoes the
device's effective scope** (`scope: ["karrinyup"]` / `["*"]`) on every page; the client keys off it:

1. **Scope-change purge + re-bootstrap (D10-3)** — `Sync._reconcileScope(scope)` (sync.js): on page 1 of each
   pull, compares the echoed scope to a stored signature (`bob_scope_sig`). On change it calls
   `DB.purgeToScope(scope)` (db.js — drops every out-of-scope ledger/stocktake/delivery/threshold row; transfers
   + record-steps kept by **either-end**), resets BOTH cursors (`bob_last_sp_id`, `bob_last_step_sp_id`) to 0, and
   aborts the cycle so the in-scope set re-pulls clean. `['*']` = no purge. Fail-closed: a failed durable purge
   does NOT record the new sig (retries). Sentinels S-222, S-223.
2. **Snapshot scoping (AGY CRIT #7)** — `Stock._adoptSnapshot` skips out-of-scope stores at ingest
   (`_scopeAllows`), and `Stock._scopeSnapshot(scope)` strips them from an already-adopted snapshot on a scope
   change. So the Chunk-8 `stock_snapshot` (published via config, unscoped) can never seed another store's
   opening balance locally. Sentinels S-224, S-225.
3. **Backup-import scrub (D10 §5b-9)** — `Pages._scrubBackupScope(data)` runs inside `_validateAndScrubBackup`,
   stripping out-of-scope rows (either-end for transfers/steps) so a restored full-ledger backup can't smuggle
   another store's data back in. Sentinel S-226.
4. **UI store-list** stays FULL per D10-8 (store names are low-sensitivity; only DATA is scoped) — no change.

Fail-open where scope is unknown (fresh device, never synced) — the next server-scoped pull + `_reconcileScope`
purge is the backstop, and the server never sends out-of-scope rows regardless.

## KNOWN GAPS — deferred to the Account Access / takeover chunk — NOT silently skipped
- **Scoped archive to stores (D10-5)** — archive-pull stays Director/HO-only (Chunk-8 gate); the StoreId scope
  clause is pre-wired for when it opens to stores.
- **Franchise-takeover opening-balance cutoff (D10-9)** — a franchisee taking over an HO store must not see the
  pre-takeover HO-era cost history; rides the Chunk-8 snapshot/archive cutoff, wired in the takeover conversion.
- **recordsteps-push either-end WRITE nuance** — currently a device may author steps it OWNS (OwnerStoreId ∈
  scope); a cross-store receive-step whose owner is the receiver is fine, but if a future flow needs a device to
  write a step it does NOT own on either in-scope end, revisit.

## Test artifacts (scratchpad, not committed)
`c10-isolation-test.mjs` (ledger read 7/7), `c10-rs-test.mjs` (steps read 5/5), `c10-arch-test.mjs` (archive),
`c10-push-test.mjs` (ledger write 6/6), `c10-rspush-test.mjs` (steps write 5/5). Transformers: `c10_scope_lib.py`,
`c10-scope-pull.py`, `c10-scope-rs.py`, `c10-scope-archive.py`, `c10-scope-push.py`. Controlled seed rows
(`c10_*`, Ids 20054-20059) + 6 credential scopes on StoreCredentials_Staging.
