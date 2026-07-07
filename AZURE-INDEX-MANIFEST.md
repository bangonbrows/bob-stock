# Azure / SharePoint — Index Manifest

**Purpose (per Chunk-1 audit, GPT FU3 + AGY #3):** deliberately track which columns are indexed on each SharePoint list, so we (a) stay within SharePoint's ~20-indexed-column budget per list, (b) only index commonly-filtered columns, and (c) **provision indexes AT LIST CREATION** — SharePoint blocks adding an index once a list passes ~5,000 items.

**Rule of thumb:** index only columns used in a server-side `$filter`/`$orderby`. Every index adds write overhead; don't burn columns casually.

## StockTransactions (live + StockTransactions_Staging) — 6 indexed
| Column | Indexed | Why |
|---|---|---|
| `SyncTimestamp` | ✅ | pull cursor: `$filter SyncTimestamp gt/le`, `$orderby SyncTimestamp asc` |
| `TransactionId` | ✅ | push dedup lookup: `$filter TransactionId eq` (note: index ≠ uniqueness — see Chunk 3) |
| `StoreId` | ✅ | store-scoped queries / reports |
| `DeviceId` | ✅ | per-device filtering |
| `Timestamp` | ✅ | business-event-time ordering |
| `TargetTransactionId` | ✅ | tombstone → original lookup |
Status: live = pre-existing genuine index. Budget used 6/20.

> ⚠ **CORRECTION (2026-06-23, both auditors):** an earlier claim that "staging was indexed to match via Graph PATCH" was WRONG — **Graph `PATCH columns/{id} {indexed:true}` sets a cosmetic flag, it does NOT create a real query-usable SharePoint index.** Proven: a `SyncTimestamp`-filtered/ordered query on a Graph-flagged list still throttles past 5k, while a list whose index was built via **SharePoint REST `MERGE` (`Field.Indexed=true`) WHILE EMPTY** does NOT (selective queries return ordered). A real index can only be built **via SP REST/CSOM/UI, and only while the list is <5k.** See `AZURE-CONTRACT-PROBES.md` → "RESOLUTION (2026-06-23)".
>
> **BIGGER POINT for Chunk 4:** even a REAL index does NOT let a query whose matched set is >5k page across the threshold (RowLimit Paged doesn't rescue a non-primary Where/OrderBy). The only paging that crosses 5k at any scale is an **ID-cursor** (`Where ID gt {lastId}` + `OrderBy ID` + `RowLimit Paged`), which uses the primary key and needs NO custom index. So the ledger pull is moving to an ID-cursor (`AZURE-PULL-HARDENING-SPEC.md`); design Chunk-4 record pulls the same way. Indexes below remain useful for *selective* server-side filters (store-scope, single-record fetch), just not for crossing-5k pagination.

## AppConfig — no index needed
Tiny list (rows: `sync_config`, `master_data`), queried by `ConfigType`; well under threshold, no index required.

## Transfers / StockTakes (existing, EMPTY, to be redesigned in Chunk 4)
Currently scaffolded with a mutable-blob shape, unused. Will be **replaced/repurposed** for the append-only record-sync model (D1). Index plan below applies when (re)created.

## PLANNED — Chunk 4 append-only record-sync list (provision indexes AT CREATION)
Minimum index set (GPT FU3):
| Column | Why |
|---|---|
| `SyncTimestamp` | pull cursor (same pattern as the ledger) |
| `RecordId` | fetch/merge a specific record's steps |
| `RecordType` | filter by transfer/delivery/stocktake |
| `OwnerStoreId` | server-side store-scope (authz/pull filter, Chunk 5) |
| `FromStoreId` | transfer scope (origin) |
| `ToStoreId` | transfer scope (destination) |
That's 6/20 — leaves headroom. Add `Status` / `Seq` only if a server-side filter actually needs them.

## PLANNED — receive-idempotency (Chunk 3), IF a separate operation/idempotency list is used
| Column | Why |
|---|---|
| `OpId` or `ReceiveKey` | dedup an irreversible op (e.g. `transfer:{id}:receive:{toStoreId}`) |
| `TransferId` | tie to the transfer |
(Alternatively, AGY's approach: enable **"Enforce unique values"** on the dedup key column so SharePoint enforces uniqueness natively — requires the column indexed + list <5k at enable time.)

## Caution log
- Cannot add an index to a list already >5k items → always create indexes when the list is small/new.
- ~20 indexed columns max per list.
- "Enforce unique values" requires the column to be indexed and is itself easier to enable while the list is small.
