# Org-Structure chunk — TOPOLOGY-CHANGE CONTRACT + ENFORCEMENT MATRIX (OS-W1 artifact)

**Status:** AUTHORED 2026-07-10 (Wave OS-W1: discovery + contract). Ground-truthed against the live tree
(branch `azure-phase-5-8-server`) by two full code sweeps. This GOVERNS OS-W2..W5. Companion specs:
`AZURE-CHUNK-ORG-STRUCTURE.md` (D-OS-1..8 + OS-SR-1..12), `AZURE-CHUNK10-SCOPE.md`,
`AZURE-CHUNK-AA-ENFORCEMENT-MATRIX.md` (the `store_eras` seed + SR-6 era enforcement this extends).

## 0. Discovery findings that shape the build (OS-W1, cited)

- **D-OS-F1 — the store model has NO ownership field today.** Store = `{id,name,type,active,isFranchise,
  franchiseDiscount,isFranchiseOffice?}` (index.html:602-612). Ownership is IMPLICIT: it lives in the
  franchisee ACCOUNT's `storeIds` (e.g. `fran_cockburn.storeIds=['cockburn_office','cockburn']`,
  index.html:618) + the store's `isFranchise`/`isFranchiseOffice` flags. NO `ownerHistory`, no `franchiseeId`,
  no owner link. The whole era/owner model is NET-NEW.
- **D-OS-F2 — no convert/onboard/buy-back flow exists.** Add-store (`_saveNewStore`, index.html:3449) types
  the id, sets `isFranchise = type==='franchise'`, never sets `isFranchiseOffice`/`franchiseDiscount`. Edit
  (`_updateStore`, :3451) only touches name+type. All topology ops are new.
- **D-OS-F3 — franchiseDiscount is a single scalar, no history (CONFIRMED).** Read for money at: products
  table franchise-price col (index.html:3336-3338), log-movement transfer-pricing banner (1949-1962, display
  only, NOT stored on the txn), products CSV (3766), and the FRANCHISE INVOICE `_franchiseInvoiceData`
  (4757-4781) — office.franchiseDiscount, product override, `owed = full − full*disc%`. A rate change today
  retroactively rewrites past invoices (latent bug OS-SR-11 fixes).
- **D-OS-F4 — the franchise invoice keys on OFFICES.** `_franchiseInvoiceData` bills each `isFranchiseOffice`
  store for HO→office supply (`_isHOSupply`, index.html:4745-4752). Office↔store linkage is ONLY the
  franchisee account's storeIds + supply-derived join — not a store field. The era/franchiseeId model must
  carry this linkage explicitly.
- **D-OS-F5 — PURGE-BEFORE-PUSH data loss CONFIRMED + reachable.** `_reconcileScope` (sync.js:1889) calls
  `DB.purgeToScope` with NO prior push; `purgeToScope` drops rows by storeId ignoring `_synced` (db.js:394);
  the background `poll()` pulls-then-purges (sync.js:2197) BEFORE draining pending (2204). ⇒ unsynced offline
  writes for a store leaving scope are lost. OS-SR-5 fix lands here.
- **D-OS-F6 — the client re-bootstrap keys on the StoreIds SIGNATURE, not scopeVersion (CONFIRMED).**
  `_reconcileScope` compares `JSON.stringify([...scopeArr].sort())` to `bob_scope_sig` (sync.js:1883-1885);
  `scopeVersion`/`scopeHash` are UNIMPLEMENTED client-side (no matches). ⇒ **an ownership/ERA change that
  leaves a device's StoreId set unchanged fires NO purge/re-bootstrap** — exactly the CONVERT case (the store
  POS keeps `[thatStore]` but its era moves). **NEW BUILD REQUIREMENT:** the client must detect era/version
  changes, not just StoreId changes (OS-W3, alongside OS-SR-5). Reuse the spec'd scopeVersion/scopeHash echo.
- **D-OS-F7 — enabling primitives to REUSE (don't reinvent):** Chunk-8 snapshot/`cutoffId`/`_spId` fold
  (`_adoptSnapshot`/`_buildCache`/`_scopeSnapshot`, index.html:1211-1378) = the opening-balance mechanism a
  takeover rides (D10-9); `_scopeAllows`/`_effectiveScope` (1289-1306); the scope-purge privacy-lock plumbing
  (sync.js:1894-1906, index.html:3798-3800) = the pattern for a topology-pending lock.

## 1. NET-NEW data model (server-owned AppConfig items + store fields)

- **`ownerHistory` per store** (on the store record OR a dedicated `store_eras` AppConfig item — reuse the AA
  `store_eras` shape): `[{ owner, from:<ISO>, to:<ISO|null> }]`. `owner` = **stable `franchiseeId`** (OS-SR-8)
  or `'HO'`. The open era (`to:null`) is current. Governs VISIBILITY (which rows an account sees) + the
  takeover cutoff (D10-9).
- **`franchisees` entity list (NET-NEW, OS-SR-8):** `{ franchiseeId (stable), displayName, officeStoreId,
  status }`. Credentials (the office account) MAP to `franchiseeId` — the account is mutable, the id is not.
- **`pricing_history` (NET-NEW, OS-SR-11/12):** per (store | franchise arrangement) a dated APPEND-ONLY
  series `[{ rate, from:<ISO>, to:<ISO|null> }]`. Governs the NUMBER (which franchise rate applies to a row's
  date). Immutable once invoiced against; a change opens a NEW interval; corrections = a Director-audited
  ADJUSTMENT record, never a mutation (OS-SR-12).
- **`topology_change` record (NET-NEW, OS-SR-1):** the 2-phase-commit journal —
  `{ id, store, from, to, ts, fanout:[...], snapshot?, status:'pending'|'complete', steps:{...} }`. Server
  writes it `pending`, applies steps idempotently, marks `complete`; a reconcile sweep resumes a crashed one.
- **`scopeVersion` on the credential (make the spec'd field LIVE client-side, D-OS-F6):** bumped on every
  topology change to a credential; the client re-bootstraps on a version change EVEN IF StoreIds are unchanged.

## 2. THE OPERATIONS MATRIX — each op → server truth (all via the `topology-change` LA, Director-key + sudo-floored, atomic per OS-SR-1)

| Op | Era effect | Pricing effect | Credential fanout (server-DERIVED, OS-SR-2) | Snapshot | Fail-closed |
|---|---|---|---|---|---|
| **Create HO store** | open HO era `[now,null]` | — | new store POS cred (scope=[store]); no franchisee | — | reserved-id / dup-id reject |
| **Create born-franchise store** (existing franchisee) | open era `[now,null]` owner=franchiseeId | open pricing interval `[now,null]` @ chosen rate | new store POS cred; ADD store to franchisee office cred scope + bump its scopeVersion | — | franchisee must exist |
| **Onboard NEW franchisee** (+ first store) | open era owner=NEW franchiseeId | open pricing interval | create `franchiseeId` entity + office/HO account (caps from data-driven role matrix, D-AA-3) + store POS cred | — | office-account username unique |
| **Add store to EXISTING franchisee** | open era owner=franchiseeId | open pricing interval | new/moved store POS cred; ADD to franchisee office scope + bump; (if converting, see below) | takeover snapshot if from HO | franchisee must exist |
| **Convert HO store → franchise** | CLOSE HO era `to=now`; OPEN franchise era `[now,null]` (= D10-9 takeover cutoff) | open franchise pricing interval `[now,null]` | **store POS cred STAYS** (re-owned; scope unchanged BUT scopeVersion BUMPED — D-OS-F6); ADD store to franchisee office scope + bump; **REMOVE store from every personal staff/mgr/TM cred scope, DEACTIVATE any left with ZERO stores** (D-OS-2 + TM multi-store nuance) | **server-side atomic opening-balance snapshot @ cutoff, QUIESCE first, provisional until old-era queues drain (OS-SR-7 + OS-SR-5/7 amend)** | pre-boundary late rows QUARANTINE `stale_era` (OS-SR-5/7) |
| **Buy-back franchise → HO** | CLOSE franchise era `to=now`; OPEN HO era `[now,null]` | close franchise pricing interval `to=now` | store POS cred re-owned to HO (scopeVersion bump); REMOVE store from ex-franchisee office scope + bump (**ex-franchisee scope ENDS → devices purge, Chunk 10**); office account LEFT ACTIVE for manual deactivation (D-OS-4/OS-SR-9: zero-store ⇒ no live data) | server-side opening snapshot for HO era | ex-owner old-era writes only via one-shot server-authorized flush (OS-SR-10) |
| **(fran→fran)** | — NOT a direct op (D-OS-3): buy-back→HO then add-to-new-franchisee (two ops; the HO era between = clean boundary) | — | — | — | — |

## 3. Reads / enforcement (server, P-13 — the LA is the gate, the wizard is preview only)

- **Visibility (who sees which rows):** governed by `ownerHistory` eras. A franchisee/HO account sees a
  store's rows only within its owner's era window(s); **device-bound roles (store POS, store_manager) see the
  CURRENT era ONLY** (OS-SR-6) — they have no franchiseeId, they follow current ownership. Extends Chunk-10
  StoreIds scoping + the AA `store_eras` SR-6 cutoff floor (fail-closed w/o an era record).
- **Money (which rate):** the era-aware lens reads the franchise rate from `pricing_history` AS-OF each row's
  date (OS-SR-3/11), NOT the live `store.franchiseDiscount`. Reports + the buy-back export use the as-of-date
  interval; past invoices stay immutable (OS-SR-12).
- **Buy-back export (OS-SR-4/D-OS-6):** SERVER-generated from server-owned ownerHistory, filtered to the
  ex-franchisee's CLOSED era `[from,to)` (BOTH bounds); content = per-product usage + cost + retail-sales
  profitability for that interval. Never client-filtered, never lower-bound-only.
- **Atomicity / recovery (OS-SR-1):** the client sends ONE intent payload; the LA journals `topology_change`
  pending → applies fanout+era+pricing+snapshot idempotently → marks complete; **reads FAIL CLOSED for a store
  with a pending topology change**; a reconcile sweep resumes a crash.
- **Anti-backdating (OS-SR-10):** an ex-owner's old-era flush (push-before-purge) is authorized by a one-shot,
  expiring, server-issued grace tied to the prior scopeVersion — never client-timestamp alone.

## 4. CLIENT-side companion work (OS-W3, on the shipped Chunk 10)

1. **Push BEFORE purge** in `_reconcileScope` / the poll ordering (D-OS-F5 / OS-SR-5) — flush pending
   ledger + steps before `purgeToScope`; the poll must not pull-then-purge ahead of the drain.
2. **Re-bootstrap on scopeVersion/era change, not just StoreIds** (D-OS-F6) — consume the server
   `scopeVersion` echo; a version bump with unchanged StoreIds still re-bootstraps + re-reads under the new era.
3. Both are BEHAVIOUR CHANGES to shipped Chunk 10 ⇒ covering sentinels FIRST (discover-before-touch, P-12).

## 5. OUT of scope (unchanged posture)
- Aggregate/roll-up cross-franchise reporting endpoints.
- The full staff-onboarding UX for the incoming franchisee's OWN people (they use the standard user-admin once
  their office account exists).
- validateMoney stays fail-open (documented exception).
