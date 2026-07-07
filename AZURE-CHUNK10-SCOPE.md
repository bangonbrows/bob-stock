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
