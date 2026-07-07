# Azure — Staging contract probes (>5k scale) — run 2026-06-23

**Why:** Chunk-1 auditors (GPT FU1/FU2) required proving the sync contract at SCALE before trusting staging as a gate. Setup: `StockTransactions_Staging` seeded to **5,500 rows** (via Graph $batch, indexed columns matching live, SyncTimestamp = 1000001…1005500).

## FU1 — pull pagination past the 5k threshold → ❌ FAIL (real finding)
Probed `pull-v2-staging` (POST `{since, $top, $skip}`):
| since | matching rows | result |
|---|---|---|
| 1005000 | 500 (<5k) | ✅ OK, 500 items |
| 1004000 | 1500 (<5k) | ✅ OK, returns the $top=1000 page |
| 1000000 / 0 | 5500 (>5k) | ❌ **502 Bad Gateway** (consistent, not transient) |

**Diagnosis:** a pull whose `SyncTimestamp gt {since}` filter matches **more than ~5,000 rows** hits SharePoint's list-view threshold and the Logic App fails (502). Indexing lets the FILTER run, but the connector's `$orderby + $top + $skip(offset)` can't *return/page* a >5k matching set. Under-5k pulls are fine.

**Production impact (real, time-boxed):** this breaks the catch-up pull for:
- a **new device** (cursor `since=0`) — its first sync matches the whole ledger;
- a **long-offline device** — if >5k rows arrived while it was away.
Once live `StockTransactions` exceeds ~5,000 rows, those devices **can't sync / can't onboard**. Live is at **1,788 rows growing ~25–30/day → ~4 months of runway**. So this must be fixed before the ledger crosses 5k (and before multi-store beta onboards new devices).

**Fix (proposed — next work item, develop+prove on staging which now has 5,500 rows):** harden `pull-v2` to page a large result set with **continuation-token pagination** (SharePoint skiptoken / `@odata.nextLink`, RowLimit-based) on the indexed `SyncTimestamp` order — instead of `$skip` offset which can't cross the threshold. Alternative/complement: client requests **windowed `SyncTimestamp` ranges** (each <5k) and advances the window. Must be auditor-reviewed.

## FU2 — duplicate-TransactionId dedup → ✅ PASS
Pushed the same `TransactionId` twice to `push-v2-staging`: both returned `{processedCount:1, status:ok}` but only **1 row** persisted (the per-row GET-by-TransactionId skip worked). Functional dedup confirmed.
**Caveat (AGY, for Chunk 2/3):** the GET-then-insert is not atomic (TOCTOU race under concurrent duplicate pushes) and the per-row GET is throttling-prone at scale → harden via SharePoint "Enforce unique values" + direct-insert/handle-409. Not a Chunk-0/1 blocker.

## SPIKE (2026-06-23) — settles the GPT-vs-AGY fix split with evidence
After both auditors confirmed the diagnosis but split on the fix (GPT = server-side continuation paging; AGY = client-side time-windows), a staging spike resolved it:
- **SyncTimestamp density:** push-v2 sets `SyncTimestamp = div(sub(ticks(utcNow()),621355968000000000),10000)` = **utcNow in ms**. Normal traffic spreads rows ms apart, BUT a bulk push/import can put **many rows in the same millisecond** → a time-window slice could itself exceed 5k and is indivisible. So **AGY's client-windowing has a real (bulk-load) failure mode**; GPT's concern confirmed.
- **Continuation paging works on >5k:** paged the full 5,500-row filtered+ordered result via `@odata.nextLink` (skiptoken) in **6 pages, total 5,500, NO error, correctly ordered (1000001→1005500)**. The threshold failure is purely the connector's **`$skip` offset** — continuation/skiptoken paging crosses it cleanly.

**DECISION: GPT's server-side continuation/skiptoken pagination** (evidence-backed: proven to page >5k; density-proof). Implementation: replace pull-v2's `$skip`-offset SharePoint "Get items" with continuation paging — likely **"Send HTTP request to SharePoint"** against REST (RenderListDataAsStream / `$skiptoken`, reusing the existing connection) returning ONE page + an opaque `nextToken`; client (sync.js) loops on `nextToken` instead of incrementing `$skip`. Keep the `le watermark` snapshot-freeze; advance the client cursor only after the final page; re-pull idempotent (merge by TransactionId). Build + prove on staging (incl. GPT's required probes: 20k+ rows, page sizes 100/1000/small, concurrent inserts mid-page, mid-pull fail/retry) → audit impl → port to live.

## BUILD ATTEMPT + DEEPER FINDING (2026-06-23) — staging index was not real
While building the continuation-paging fix on staging, repeated 502s led to the exact error (from Logic App run history): **`Microsoft.SharePoint.SPQueryThrottledException — exceeds the list view threshold`**. Narrowing tests:
- OData `/items?$filter=SyncTimestamp gt 0&$orderby=SyncTimestamp asc,ID asc&$top=1000` → **throttled**.
- `RenderListDataAsStream` with `<Where SyncTimestamp gt 0>` + `<OrderBy SyncTimestamp>` + `<RowLimit Paged>` → **also throttled**.
- `RenderListDataAsStream` with **NO Where, `<OrderBy ID>`, `<RowLimit Paged>`** → **✅ WORKS** (1000 rows + `NextHref`).

**Decisive conclusion: the staging `SyncTimestamp` index is NOT effective.** It was set via Graph `PATCH columns/{id} {indexed:true}` (Chunk 1) — **that Graph flag does NOT create a real, query-usable SharePoint column index.** So every SyncTimestamp-filtered/ordered query on staging behaves as UN-indexed → throttles past 5k. (The earlier Graph spike "worked" only because it sent `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly` — a risky threshold BYPASS, not a real fix.)

**Implications (important):**
1. The "pull breaks at 5k" verdict was tested against a FAKE index → it is NOT a clean read on the LIVE system. The **live `StockTransactions` has a genuine pre-existing `SyncTimestamp` index** (it predates us), so the live ordered pull may actually survive past 5k where staging didn't.
2. To test properly, staging needs a REAL `SyncTimestamp` index — Graph PATCH is insufficient; create it via SharePoint REST (works through the Logic App "Send HTTP request to SharePoint", which we proved), OR PnP.
3. `RenderListDataAsStream` returns DISPLAY-formatted field values (Date "1/1/2026 12:00 AM", numbers with commas) — not directly client-usable; if used, need raw-value handling or a different RenderOption.

**Revised next steps (before resuming the fix):** (a) create a REAL SyncTimestamp index on staging (SP REST via Logic App) + re-run the >5k pull tests — the problem may largely vanish with a real index; (b) re-confirm the live index is genuinely effective; (c) re-engage auditors with these sharper findings (index-effectiveness changes the diagnosis); (d) THEN decide the paging mechanism (plain RowLimit paging is threshold-safe; combine with real index for SyncTimestamp order). **Also re-check Chunk-1's index manifest claim — "staging indexed to match" was a Graph-flag, not a real index.**
Staging resources left in place: lists `StockTransactions_Staging` (5,500 rows), workflows `bob-stock-push-v2-staging`, `bob-stock-pull-v2-staging` (baseline), `bob-stock-pull-v2-paged` (experiment). Build artifacts in audit-artifacts/.

## RESOLUTION (2026-06-23) — real index built while empty; root cause + fix proven with evidence
The prior section left two questions: is the throttle caused by the FAKE index, and would a REAL index fix it? Resolved with a clean experiment.

**Setup.** Built a fresh list `StockTransactions_IdxTest` (cols `TransactionId` text + `SyncTimestamp` number). Set `SyncTimestamp` `Indexed=true` via **SharePoint REST `MERGE`** (through a single-purpose Logic App "Send HTTP request to SharePoint" — `POST .../fields/getbytitle('SyncTimestamp')`, header `X-HTTP-Method: MERGE`, body `{"__metadata":{"type":"SP.FieldNumber"},"Indexed":true}` → 204) **WHILE THE LIST WAS EMPTY**, then seeded to **6,000 rows** (Graph $batch). This mirrors LIVE's situation: index built when small, list grown past 5k.

**Findings (each a Logic App run against the 6,000-row real-indexed list):**
| Query | Matched set | Result |
|---|---|---|
| OData `$filter=SyncTimestamp gt 0 & $orderby=SyncTimestamp & $top=1000` | 6000 (>5k) | ❌ 502 throttle |
| `RenderListDataAsStream` `<Where SyncTimestamp gt 0><OrderBy SyncTimestamp><RowLimit Paged 1000>` | 6000 (>5k) | ❌ 502 throttle |
| `RenderListDataAsStream` `<OrderBy SyncTimestamp><RowLimit Paged 1000>` (no Where) | 6000 (>5k) | ❌ 502 throttle |
| `RenderListDataAsStream` `<Where SyncTimestamp gt 1005000><OrderBy SyncTimestamp><RowLimit Paged 1000>` | **1000 (<5k)** | ✅ **200, 1000 rows, correctly ordered (firstSync=1,005,001)** |
| **`RenderListDataAsStream` `<Where ID gt {lastId}><OrderBy ID><RowLimit Paged 1000>` (ID-cursor)** | walked 0→6000 | ✅ **200 every page — 6 pages × 1000 = 6000, crossed 5k cleanly** |

**Root cause (corrected & sharper):**
1. **The `SyncTimestamp` index built-while-empty IS real and usable** — proven by the selective `Gt 1005000` query returning 1000 ordered rows with no throttle (a fake/un-indexed column would scan all 6000 to evaluate that filter → throttle).
2. **The throttle is purely about the MATCHED-SET size exceeding 5,000** — NOT about indexing, and **`RowLimit Paged` does NOT rescue a Where/OrderBy whose matched set is >5k on a non-primary column.** Even a real index + paging throttles when `SyncTimestamp gt {since}` matches >5k rows (e.g. `since=0`). So the earlier "real index will fix it" hope is **wrong** for the backfill case.
3. **An ID-cursor (`Where ID gt {lastId}` + `OrderBy ID` + `RowLimit Paged`) pages cleanly at ANY scale**, because ID is the list's primary/native paging key — SharePoint applies the row limit via the ID B-tree without materialising the full matched set. It does NOT depend on the SyncTimestamp index at all.

**Therefore the throttle is narrowly the BIG sync, not "pull breaks at 5k":**
- **Incremental steady-state** (small delta since last cursor) → `SyncTimestamp gt {since}` matches ≤5k → **works fine today with the live real index.**
- **Backfill / onboarding** (`since=0`, or >5k rows arrived while offline) → matched set >5k → throttles, even with index + paging.

**DECISION (supersedes the skiptoken-on-SyncTimestamp plan): switch the pull to an ID-cursor.**
- Pull query = `RenderListDataAsStream` `<Where><Gt><FieldRef Name='ID'/><Value Type='Counter'>{lastId}</Value></Gt></Where><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy><RowLimit Paged='TRUE'>1000</RowLimit>`; client cursor = `lastId` (max ID seen), loop until a short/empty page.
- Works for onboarding (`lastId=0`) and incremental at any list size; **independent of whether SyncTimestamp is indexed**, so it also sidesteps the live-index-reality unknown.
- Ledger is append-only + ID is monotonic with insert → ID order = insert order = SyncTimestamp order; dedup by TransactionId keeps re-pull idempotent.
- **Caveat to confirm in impl/audit:** an ID-cursor never revisits LOW-ID rows, so any in-place EDIT/tombstone of an already-pulled row would be missed. Must confirm tombstones/edits are **appended as new rows** (new ID) — they are in the append-only model, but verify against sync.js + push-v2 before porting. `RenderListDataAsStream` also returns DISPLAY-formatted values → use raw-value handling (or fetch fields via a follow-up) when porting.

**Still to validate before porting to live (GPT's required probes):** seed 20k+, page sizes 100/1000/small, concurrent inserts mid-walk, mid-pull fail/retry. These are impl-validation, not decision-blocking.

**Live posture:** live `StockTransactions` is 1,788 rows (<5k) so **every query on live works today regardless of index**; the throttle cannot occur until live crosses 5k (~4 months). Live's SyncTimestamp-index reality is UNVERIFIABLE while <5k (a <5k list never throttles) — another reason to adopt the ID-cursor, which doesn't rely on it.

**Test resources created this session (all isolated; live untouched; delete at phase cleanup):** list `StockTransactions_IdxTest` (6,000 rows); workflows `bob-stock-set-syncts-index`, `bob-stock-set-idxtest-index`, `bob-stock-pull-probe-odata`, `bob-stock-pull-probe-idxtest`, `bob-stock-render-probe-idxtest`, `bob-stock-render-orderonly`, `bob-stock-idcursor-probe`. Props JSON in audit-artifacts/.

## Net
Staging is a faithful large-list gate (it reproduced the real threshold behaviour). **One blocker found (FU1 pull pagination), now diagnosed precisely:** the throttle is matched-set-size >5k, not indexing; it bites only the BIG/onboarding sync; **fix = ID-cursor paging (proven to cross 5k cleanly).** Dedup works. Recommend the ID-cursor pull-hardening AHEAD of Chunk 2. Test list (6,000 rows) + probe workflows left in place to develop/prove the impl; clean before final sign-off.
