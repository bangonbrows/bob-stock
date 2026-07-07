# Account Access Model — configurable permissions (SCOPE STUB — design WITH Kunal before building)

**Status:** CAPTURED 2026-07-07 (Kunal). NOT yet designed/built. Kunal: *"I would like to discuss the account
accesses when the time comes."* This is its own unit (a new chunk), to be designed together before any build —
do NOT hard-code pieces of it early (avoids the churn "discover-before-touch" warns against).

## What Kunal wants
A **screen where the Director edits account access levels** — a UI over the permission matrix — with:

1. **Per-account-TYPE capabilities.** Edit what each account type (store account / store manager / territory
   manager / franchisee / HO / director) is allowed to do. E.g. toggle whether the basic *store account* can do
   stock takes at all.
2. **Per-STORE overrides.** Grant/revoke a capability for a SPECIFIC store, independent of the type default.
   Kunal's example: *"if I think stores can handle stock take on their own, I should be able to just tick one
   box for the store account and choose Booragoon, and Booragoon can take stock at all times without the PIN."*
   So: a per-(store, capability) override that exempts a store from the default (e.g. Booragoon store account
   can stock-take / receive without the 24h PIN).

## The confirmed DEFAULT this system encodes (Kunal 2026-07-07)
- The basic **store account** requires the **24-hour PIN** to (a) do a stock take AND (b) **receive HO
  transfers**. *(Point (b) is a behaviour CHANGE from today — currently `staff` can receive transfers freely;
  needs a covering sentinel when built.)*
- The per-store override lets Kunal turn OFF the PIN requirement for a chosen store (e.g. Booragoon) so it can
  stock-take / receive at all times.

## FULL vision (Kunal 2026-07-07, expanded) — the screen must do ALL of this

### A. Granular capability toggles (long, EXTENSIBLE list) — give/take per account (type or specific account)
A long list of individually toggleable permissions, e.g. (not exhaustive — must be easy to ADD more):
- Do stock take
- Receive stock (HO transfers)
- See **cost** price
- See **selling** price
- See **older / archived** data (ties to Chunk 8 archive-pull, currently Director/HO-only)
- See charts
- See **comparative** charts (store-comparison reports)
- Edit products
- Edit other reference data (categories, product types, stores, thresholds, suppliers, pricing…)
- …etc. — essentially every gate in `Auth._caps` PLUS view-level toggles (cost/price/reports/charts) becomes a
  switch. The list must be extensible without a code change where possible.

### B. Create NEW account TYPES (custom roles)
Not limited to the fixed staff / store-manager / territory / franchisee / HO / director set — the Director can
DEFINE a new account type with its own capability set. So roles become DATA-DRIVEN, not hard-coded.

### C. Org-structure management (the account/store topology)
- **Convert a store → franchise store** (flip a company store to a franchise; the existing `isFranchise` /
  `isFranchiseOffice` store flags are the seed).
- **Add a new franchisee + create their HO/office account** (onboard a franchisee: their store(s) + their
  franchise HO account).
- **Existing franchisee acquires ANOTHER store** → that store is added to the SAME franchisee's scope under the
  SAME franchise HO (franchisee scope = a growing set of stores, one HO).

### Interactions (why this is big + must be designed carefully)
- **Subsumes Chunk 6 cost-privacy:** "see cost" / "see selling price" become toggles — generalising the
  hard-coded franchise→no-corporate-cost rule. Server cost-strip must honour the toggle, not just role.
- **Subsumes parts of Chunk 8:** "see older/archived data" becomes a toggle over the archive-pull gate.
- **Leans on Chunk 10:** store-scoping (which rows a device receives) is enforced by the account's StoreIds;
  franchise conversion + multi-store franchisee change those scopes.
- **P-13:** client toggles are UX; every capability that WRITES or reveals sensitive data (cost, archive) must
  be enforced SERVER-SIDE too (the gated LAs / scoping), not just hidden in the UI.

## Design shape (sketch — confirm at design time)
- Persist an editable capability matrix + per-store overrides in AppConfig (master_data-style) OR a dedicated
  `AccessPolicy` config item, published like the catalogue (Director-gated write, converges to devices).
- The existing `Auth._caps` becomes the DEFAULT seed; the screen edits an overlay; `Auth.can(cap, storeId)`
  consults type-default → per-store override → 24h-PIN grant.
- CLIENT enforcement is UX/convenience (P-13); the SERVER (Chunk 10 scoping + the gated LAs) is the real gate —
  so any capability that writes sensitive rows must ALSO be enforced server-side, not just in the editable UI.
- Interacts with Chunk 10 (row-level store scoping by the account's StoreIds).

## Sequencing (recommendation)
Do AFTER Chunk 9's audit gate converges. Design this WITH Kunal (his request), then build + audit as its own
chunk. The 24h-PIN-to-receive default lands as part of THIS unit (not hard-coded earlier).
