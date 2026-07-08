# Azure Chunk 10 — Row-level store data isolation (franchise privacy)

**Status:** SCOPE DRAFT (2026-07-08) — for Kunal's decisions, then the Codex+AGY spec review, then build.
**Phase-scope mandate (2026-07-04, PRE-BETA BLOCKER):** the server sends each store device ONLY its own rows +
transfers touching it; HO/Director get everything. Needed because franchisees exist BEFORE launch — a franchise
device must never even RECEIVE another store's data (today the UI hides it, but the FULL ledger syncs to every
device by design). Last real build blocker before alpha.

---

## 1. The problem (discovery, 2026-07-08 — live code)

`sync.js` pull() → the pull-v2 Logic App uses an **ID-cursor only** filter: `ID gt lastId AND ID le maxId`,
ordered by ID. **There is NO store filter.** So EVERY device pulls EVERY StockTransactions row (the whole
company ledger) into its local IndexedDB; `Auth`/`Stock` then HIDE other stores at render time. Same for
record-steps (Chunk 4) and the catalogue. This is framework P-13 in its rawest form: a franchisee with DevTools
(or just a backup export) reads every store's movements, quantities, and — combined — cost/margin.

Chunk 5 already AUTHENTICATES the device (store key / Director key) and Chunk 6 strips corporate COST from the
public catalogue. Chunk 10 is the missing piece: **AUTHORISE which ROWS each device may receive**, server-side,
so out-of-scope data never leaves SharePoint for that device.

## 2. What is / isn't scoped

- **SCOPED (per store):** `StockTransactions` (the ledger) + `RecordSteps` (transfer/delivery/stocktake steps) +
  the ledger archive (Chunk 8 archive-pull). These carry a `StoreId` and are the sensitive per-store data.
- **NOT scoped (shared by everyone):** the CATALOGUE (products/stores/categories/productTypes via master_data) —
  every device needs the full product + store directory to function. Cost stays handled by Chunk 6 (gated).
- **The scope set** = the stores a device/account may see:
  - store account → its 1 store; store-manager account → its 1 store;
  - territory manager → their N stores; franchisee → their stores + their franchise office;
  - HO / Director → ALL stores (no filter).

## 3. The crux — transfers span TWO stores

A transfer produces ledger rows in BOTH stores: `transfer_out` (StoreId = FROM store) and `transfer_in`
(StoreId = TO store). A store must RECEIVE an incoming transfer (see the sender's submit + the transfer_in row)
even though the other end is out of its scope. So the filter is NOT simply `StoreId ∈ myStores`:
- A store needs rows where **StoreId ∈ myStores** (its own movements + its transfer_in), AND
- the transfer/record-step CONTEXT for transfers where **either end touches myStores** (so it can act on an
  incoming transfer). The genesis `submit` step carries FromStoreId/ToStoreId; the ledger `transfer_out` row of
  the sender is the sender's data (out of scope) — the receiver only needs its own `transfer_in` + the transfer
  metadata (submit step) to receive. **This split (ledger by StoreId; steps by either-end) is the design crux
  the auditors must attack.**

## 3b. ACCOUNT MODEL — KUNAL CLARIFICATION (2026-07-08) — GOVERNS the scope source
Accounts are FIXED identities tied to a location/role — there is NO cross-login (nobody logs into another
account "inside" a store account). A store account IS the store (shared by whoever is working, so staff don't
log in/out all day). A territory manager has their OWN account on their OWN device that sees their stores — they
never log into a store's device as territory manager. Same for franchisee / HO / director. **Therefore the
scope is simply the AUTHENTICATED ACCOUNT's fixed store set — no device-vs-account intersection (D10-1 collapses).**

## 4. The model (proposal — updated per §3b)

- **Scope source:** the allowed store set = the authenticated account's fixed StoreIds. RESOLVED design (confirm
  at spec review): carry the scope on the DEVICE-layer credential, not a person proof — extend the Chunk-5
  `StoreCredentials` row with a `StoreIds` scope field so each account/device key encodes its stores (store key
  → [its store]; territory key → [their stores]; franchisee key → [their stores + office]; Director → ALL).
  The pull-v2 / recordsteps-pull LAs read the authenticated key's StoreIds and filter. This keeps READS device-
  scoped (Chunk 9's decision — no person-proof coupling on the background pull) AND gives multi-store scope for
  territory/franchisee accounts. (Alternative: scope from the Chunk-9 person account via the session proof —
  heavier coupling; noted for the auditors to weigh.)
- **pull-v2:** add `AND (StoreId ∈ scopeSet)` to the ID-cursor filter (indexed OData `StoreId eq 'x' or ...`).
  The ID-cursor pagination is unchanged (still `ID gt lastId AND ID le maxId`, ordered by ID) — just a sparser
  matched set. Needs a SharePoint index on StoreId (like SyncTimestamp/ID) so the scoped query stays
  threshold-safe at scale. HO/Director → no StoreId clause.
- **recordsteps-pull:** scope steps to records whose store context touches scopeSet (OwnerStoreId ∈ scope OR
  FromStoreId ∈ scope OR ToStoreId ∈ scope) so incoming transfers are visible; deliveries/stocktakes by
  OwnerStoreId.
- **archive-pull (Chunk 8):** already Director/HO-gated; extend so a scoped account only pulls its stores'
  archived rows (or keep Director/HO-only — D10-5).
- **CLIENT purge on scope-narrowing (D10-3):** a device that already holds the whole ledger (pre-Chunk-10) must
  DROP out-of-scope rows locally when scoping activates, so old data doesn't linger on a franchise device.
- **Fail-closed:** if the scope can't be determined, send NOTHING (never default to "all").

## 5. Decisions — KUNAL DECIDED 2026-07-08 (these govern the build)

- **D10-0 — build now: YES** (pre-beta blocker).
- **D10-1 — scope source: the ACCOUNT's fixed StoreIds, NO device/account intersection** (§3b — accounts are
  fixed identities, no cross-login). Store account → its store; territory → their stores; franchisee → their
  stores + office; HO/Director → all. Design: carry the scope on the device-layer credential (StoreCredentials +
  StoreIds) so the background pull stays person-proof-free — CONFIRM at spec review.
- **D10-2 — territory/franchisee see INDIVIDUAL movements + more** (full detail for their stores). CONFIRMED.
- **D10-3 — purge out-of-scope local data when scoping turns on: YES.** One-time client prune keyed on the new
  scope; a franchise device must not retain other stores' history.
- **D10-4 — cross-store comparison reports are HO/Director/territory-only, EXCEPT a MULTI-STORE FRANCHISEE can
  compare AMONG THEIR OWN stores** (Kunal). So report scoping = "compare within your scope set": a single-store
  account has nothing to compare; a multi-store franchisee/territory/HO/Director compares across the stores IN
  THEIR SCOPE (never beyond it).
- **D10-5 — scoped archive: YES** — a scoped account may pull ITS stores' archived data (not Director/HO-only).
- **D10-6 — transfer either-end minimal disclosure: CONFIRMED** — a receiving store sees the incoming transfer's
  metadata (who sent, what, when) but NOT the sender's other movements.
- **D10-7 — HO warehouse: CONFIRMED** — a store sees HO→store transfer rows (its transfer_in) but NOT HO's full
  stock; follows from the StoreId + either-end rules.

## 5b. ADOPTED SPEC-REVIEW CHANGES (R1 — Codex AGREE-WITH-CHANGES + AGY CONVERGE, folded 2026-07-08)
Both converged on the model; these conditions GOVERN the build. They GROW the chunk beyond "just the pull
filter" — it now also covers write-scoping, snapshot/config scoping, and scope-version lifecycle.

1. **Scope-AWARE transfer fold (Codex HIGH-1).** The Chunk-4 record-steps fold validates expectedLedgerKeys; a
   receiver won't hold the sender's transfer_out row → it must NOT be treated as a missing/pending key. Fix:
   `stockStateFor` validates ONLY keys whose StoreId is in the authenticated scope (out-of-scope counterpart
   keys are treated as confirmed-elsewhere, not pending). A scoped device's incoming transfer folds to
   completed without the sender's row.
2. **Scope-VERSION + re-bootstrap on scope change (Codex HIGH-2, AGY purge-versioning).** A server-owned
   `scopeVersion`/`scopeHash` on the credential. When scope WIDENS (franchisee gains a store) the ID-cursor has
   already advanced past that store's old rows → they'd never pull. On any scope change: RESET the scoped pull
   (bootstrap from 0 for the new scope) across ledger + record-steps + archive + snapshot, before the device
   claims complete data. Store the scopeHash locally; a mismatch on boot forces a re-bootstrap + purge.
3. **StoreId INDEX + threshold-proof (Codex HIGH-3, AGY-10-3 CRIT).** `... AND (StoreId eq A or B ...)` must
   stay under the SharePoint 5k view threshold — REQUIRES an indexed StoreId column on StockTransactions (+
   RecordSteps/Archive). Prove it; if an OR-filter won't use the index, fall back to per-store indexed cursors
   or a RenderListDataAsStream/CAML pattern that provably uses the StoreId+ID indexes.
4. **Minimal transfer VIEW, not raw payload (Codex MED-4).** Either-end record-steps return a curated transfer
   view — explicit allowed fields ONLY: transferId, from/to store id+name, products, sent qty, status,
   timestamps, needed notes. NEVER the sender's stock balances, unrelated expectedLedgerKeys, cost, device
   diagnostics, or unrelated actor detail.
5. **Transactional, fail-closed, all-table PURGE (Codex MED-5, AGY purge-atomic + AGY-10-5).** Single atomic
   Dexie transaction; scope-versioned; block reports/exports/sync-display until purge completes AND the cache
   rebuilds (`Stock._buildCache()` right after commit). Covers: ledger, recordSteps, archive overlays,
   snapshots, rejected/quarantine rows, tombstones, cached stock, local report caches. A failed purge must
   NEVER leave a device showing "scoped and complete".
6. **WRITE-side scoping (Codex MED-6/7, AGY-10-1 CRIT).** push-v2 ingest must reject any row whose StoreId is
   outside the credential's scope; transfer submit only if FromStoreId ∈ scope, receive only if ToStoreId ∈
   scope (Director/HO exceptions as designed). Add tests: forged cross-store movement, submit-from-out-of-scope,
   receive-for-non-ToStore, recordstep payload/store-field mismatch. (Chunk 10 is now read AND write scoping.)
7. **SNAPSHOT / config scoping (AGY-10-2 CRIT).** The Chunk-8 `stock_snapshot` in AppConfig carries ALL stores'
   balances; the config/snapshot delivery must STRIP out-of-scope store balances before returning — else a
   scoped account reads other stores' exact inventory. Scope the snapshot + archive exactly like the live ledger.
8. **UI store-list scoping (Codex #5, AGY-10-4 MED).** Comparison dropdowns / report matrices / store selectors
   filter to the scope set — never render (even empty) out-of-scope stores, which would reveal their existence.
9. **Backup import under scope (Codex/AGY).** Importing an OLD full-ledger backup after scoping activates must
   be rejected or scrubbed to the current scope (can't reintroduce out-of-scope rows).
10. **Scope reads ONLY from the VERIFIED credential row (both), never client-submitted scope.** Old/grace
    credentials must carry the CURRENT scope or be invalidated on scope narrowing.

### D10-8 — KUNAL DECIDED 2026-07-08: KEEP THE FULL STORE LIST
Franchise devices may see all store NAMES/existence (low-sensitivity in a franchise chain); only DATA is
scoped. No store-directory scoping. (Original question retained below for context.)

### D10-9 — FRANCHISE TAKEOVER = OPENING-BALANCE CUTOFF (Kunal 2026-07-08, LOCKED)
Kunal: *"the franchisee's costs and our costs are different — I don't want the older data showing to a
franchisee when they take over a store and see the costing of HO."* So a scope-WIDENING via a franchise
TAKEOVER is NOT a full-history re-pull: the franchisee starts at an OPENING BALANCE as of the takeover date and
gets the store's data ONLY from that point forward, under THEIR OWN costing. The pre-takeover HO-era history
(esp. cost-bearing rows: deliveries with landed cost, cost-history, HO-cost-valued movements) STAYS WITH HO and
is NEVER synced to the franchisee.
- Chunk 6 already blocks HO's CURRENT corporate cost from franchise devices (gated, 403). D10-9 additionally
  blocks the pre-takeover HISTORICAL cost-bearing rows from the takeover re-pull.
- Mechanism (rides Chunk 8): at takeover, snapshot the store's stock (opening balance, no cost history) →
  archive the HO-era detail on OUR side → the franchisee's scoped pull for that store starts at the takeover
  cutoff (never below it). BUILD MUST verify no delivery/cost-history/HO-cost row for the pre-takeover period
  reaches the franchisee device.
- The full takeover FLOW (snapshot + archive + hand-off + scope grant) is detailed in the store-conversion step
  of the Account Access Model chunk; Chunk 10's scope-widening re-pull MUST honour the per-store takeover cutoff.
- NOTE the asymmetry: a normal scope-widening (a franchisee who ALREADY operates a store gaining visibility, or
  HO/Director) still full-re-pulls; only a franchise TAKEOVER of a previously-HO store applies the cutoff.

### D10-8 (original question — for context)
The shared CATALOGUE (master_data) currently includes the FULL store directory — so a scoped franchise device
would still hold the NAMES/LIST of every company + other-franchise store (not their data, just that they exist).
Both auditors: acceptable ONLY IF Kunal accepts store-directory visibility as non-sensitive; otherwise the store
directory must ALSO be scoped (a device gets only its own stores + HO). QUESTION: is the list of all store
names/locations OK for a franchisee to see, or should the store directory be scoped too? (Cost stays gated by
Chunk 6 either way; this is only about store NAMES/existence.)

## 6. Interactions / out of scope
- **Account Access Model** (separate chunk) will EDIT the scopes (org structure: franchisee owns N stores,
  convert store→franchise, territory = subset). Chunk 10 enforces whatever StoreIds the account has; the Access
  Model is the management UI on top. Chunk 10 uses the existing StoreIds — does NOT need the Access Model built.
- **Chunk 6 cost privacy** stays as-is (cost is gated separately); Chunk 10 is about which stores' ROWS.
- **Chunk 8 archival** — the client fold/snapshot is per-(store,product); scoping just limits which stores'
  archive a device pulls.
- Not in scope: aggregate/roll-up reporting endpoints, the configurable access UI.

## 7. Audit plan
Scope → Kunal's D10 decisions → Codex+AGY SPEC review (attack the model, esp. the transfer either-end split, the
scope-source D10-1, the purge, and any row a franchise device could still receive) → build on staging (Mode A) →
sentinels/saboteurs (a franchise device receives ONLY its rows; an incoming transfer is still receivable;
purge works; HO/Director unaffected) → full sweep → wave review → Codex+AGY code audit → converge → HOLD.
