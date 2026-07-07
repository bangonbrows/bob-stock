# Azure Staging Environment (Chunk 0) — built + verified 2026-06-23

**Purpose:** a write-isolated sandbox to develop + test server-side changes (push-v2 ingest validation, transfer-receive idempotency, multi-table record sync) against the REAL Logic-App + SharePoint plumbing, WITHOUT touching live data. No audit to date has exercised the live cloud path — this is the prerequisite for that.

## Resources (resource group `bob-stock-sync`, australiaeast; SharePoint site `https://bangonbrows.sharepoint.com`)

| Resource | What it is | Differs from live how |
|---|---|---|
| **`StockTransactions_Staging`** (SharePoint list, id `f290fb76-93b0-43aa-96eb-b35b1ee83b38`) | Isolated copy of the ledger list | Columns mirror live StockTransactions exactly (matching internal names: TransactionId, Date, StoreId, ProductId, Type, Qty, StaffName, Reason, DeviceId, Timestamp, TransferId, TargetTransactionId, SyncTimestamp, DeletedBy, DeletedAt, DeleteReason). Currently EMPTY. |
| **`bob-stock-push-v2-staging`** (Logic App) | Clone of `bob-stock-push-v2` | Only change: the 2 table refs point at `StockTransactions_Staging`. Reuses the SAME `sharepointonline` API connection. Trigger: `When_an_HTTP_request_is_received`. |
| **`bob-stock-pull-v2-staging`** (Logic App) | Clone of `bob-stock-pull-v2` | Only change: the table ref points at `StockTransactions_Staging`. Same connection. Same trigger. |

Trigger callback URLs (contain SAS — NOT committed): `audit-artifacts/.staging-pushv2-url.txt`, `audit-artifacts/.staging-pullv2-url.txt` (local only).

## How it was built (headless, no browser/manual)
1. SharePoint list created via Microsoft Graph using an app-only credential (app `BOB-Stock-SP-Automation`, Graph `Sites.FullControl.All`, admin-consented).
2. Logic Apps cloned via `az resource create`: exported each live definition (`audit-artifacts/azure-pushv2-def.json`, `azure-pullv2-def.json`), string-replaced `'StockTransactions'`→`'StockTransactions_Staging'`, reattached the existing `sharepointonline` connection (props: `audit-artifacts/staging-pushv2-props.json`, `staging-pullv2-props.json`).

## Verification (2026-06-23) — PASSED
- **Push:** POST `{data:{transactions:[…]}}` → `{processedCount:1, status:ok}`; row landed in `StockTransactions_Staging`, NOT in live `StockTransactions`.
- **Pull:** POST `{since:0}` → returned the staged row + `serverTimestamp`. Field mapping + `SyncTimestamp` filter behave like live.
- **Isolation:** confirmed live ledger untouched. Staging list cleaned back to 0 items after the test.

## How to use for later chunks
- Point probe/test traffic at the staging push/pull URLs (above). The staging list is the isolated target.
- To test a server-logic change (e.g. ingest validation in Chunk 2), edit `bob-stock-push-v2-staging`'s definition (NOT live), redeploy, run probes, then port the proven change to live `bob-stock-push-v2`.
- `config` was NOT cloned (probes hit the push/pull URLs directly; a `config-staging` can be added later if we want to test the full client bootstrap path).

## Auditor review (read-only, no live access, no secret)
Artifacts to review: this doc + `audit-artifacts/azure-pushv2-def.json` / `azure-pullv2-def.json` (live definitions) + `staging-pushv2-props.json` / `staging-pullv2-props.json` (what was deployed to staging). The diff is solely the table name.

## Security / cleanup
- The automation app `BOB-Stock-SP-Automation` (appId `8a412900-4684-4c47-897d-6e58aa52c997`) holds a full-control SharePoint secret. **Rotate or delete it (or tighten to Sites.Selected) once the Azure phase build is complete.**
- The two v1 Logic Apps (`bob-stock-push`, `bob-stock-pull`) are dead leftovers — candidates for deletion during cleanup.
