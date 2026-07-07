# Azure Chunk 1 — Indexed columns (StockTransactions) — done + verified 2026-06-23

**Goal:** ensure the columns the sync depends on are indexed on the `StockTransactions` SharePoint list BEFORE it crosses the ~5,000-item view threshold, or `pull-v2` queries start failing. The two critical columns:
- **`SyncTimestamp`** — the pull cursor. `pull-v2` query filters `SyncTimestamp gt {since} [and le {watermark}]` and `$orderby SyncTimestamp asc, ID asc`.
- **`TransactionId`** — the dedup lookup. `push-v2` does `GET …/items?$filter=TransactionId eq '…'` before each insert.

## Finding (discovered, read-only)
**Live `StockTransactions` is ALREADY indexed** on the needed columns — no live change required:
- Indexed columns (read via Graph `columnDefinition.indexed`): **TransactionId, SyncTimestamp, StoreId, DeviceId, Timestamp, TargetTransactionId**.
- So both the pull-cursor filter (SyncTimestamp) and the dedup filter (TransactionId) are index-backed already.

## Change made
- Indexed the **staging** list `StockTransactions_Staging` to MATCH live (same 6 columns), so staging is a faithful test gate. Method: Microsoft Graph `PATCH /sites/{site}/lists/{list}/columns/{col}` with `{ "indexed": true }` — confirmed this works (no SharePoint-REST/portal needed). Verified by re-reading: staging indexed columns now = TransactionId, StoreId, DeviceId, TargetTransactionId, Timestamp, SyncTimestamp.
- **No change to live** (already correct).

## Verification
- Live: read confirms TransactionId=indexed, SyncTimestamp=indexed (+4 others).
- Staging: PATCH succeeded on all 6; re-read confirms all 6 indexed.

## Questions for the auditors
1. **Sufficiency:** for the `pull-v2` query (`$filter SyncTimestamp gt/le` + `$orderby SyncTimestamp asc, ID asc`), is a **single-column index on `SyncTimestamp`** enough to stay under the 5k list-view threshold, or does the `orderby SyncTimestamp, ID` (or the `and le watermark` range) warrant anything more (SharePoint has no true compound indexes; ID is the implicit tiebreaker)?
2. **dedup at scale:** `push-v2` filters `TransactionId eq` per row — the TransactionId index covers this; any concern at 10k+ rows or with the per-row GET pattern?
3. **Coverage:** any OTHER list needing indexes before growth — e.g. the future append-only record-sync list (Chunk 4), which will be filtered by SyncTimestamp + RecordType/RecordId?
4. **Limits/risk:** SharePoint's ~20-indexed-column cap and the fact that indexing an already-large list can be throttled — any caution for the live list as it grows (currently indexing was pre-existing, so not an issue today)?

Report a verdict (APPROVE / APPROVE-WITH-CHANGES / REJECT) + any gaps. This is infrastructure/config (no app code change). ATTACH: this file.
