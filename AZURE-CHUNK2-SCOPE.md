# Azure Chunk 2 — Ingest validation + quarantine on push-v2 (SCOPE)

**Status:** scoping for review. Build on staging only; live untouched (batched for the end-of-phase 6-way audit + single cutover). No design decision blocks the *core*, but there are 6 choices below to confirm before build.

## Current state (from `audit-artifacts/azure-pushv2-def.json`)
push-v2: `Check_empty` → else `For_each` txn (concurrency 50): `Check_existing` (GET `$filter TransactionId eq`, $top 1) → `Check_duplicate` (if 0 matches → POST insert; else skip) → `Response_ok`.

Three real gaps:
1. **No validation whatsoever.** Any device can write any `Qty`/`Type`/`StoreId`/`ProductId`/id, including hostile chars or reserved keys (`__proto__`), straight into the ledger.
2. **`processedCount` is a lie** — it returns `length(input transactions)`, NOT what actually inserted. A row that fails insert (or that we'd reject) is still reported `ok` → the client marks it `_synced` → **silent data loss**. This is the most dangerous gap and must be fixed alongside validation.
3. **Dedup is a GET-then-insert race** (TOCTOU) and does a per-row GET at concurrency 50 → 429 throttle risk at scale (AGY Chunk-1 finding).

## Goals
- Server-side **backstop validation** of every pushed StockTransactions row (mirror the client `Validate`/`Stock._isSafeLedgerId` rules — the cloud must not trust the device; framework P-13).
- **Quarantine, never silently drop:** rejected rows are recorded (id + device + timestamp + reason) and reported back so the client can flag, not lose, them.
- **Honest response contract:** report exactly which rows were accepted vs rejected, so the client marks only accepted rows `_synced`.
- Fold in the **dedup hardening** (enforce-unique-values on TransactionId + direct insert + handle 409) — removes the TOCTOU race and the per-row GET throttle. *(Overlaps Chunk 3's idempotency — see Q3.)*

## Validation rules (per row; server backstop mirroring the client)
- **TransactionId**: present, string, safe ledger-id charset, not a reserved key (`__proto__`/`constructor`/`prototype`), length-bounded.
- **Type**: in the whitelist (the `Txn.classify` set — in/out/move_in/move_out/transfer_in/transfer_out/adjustment_in/adjustment_out/deleted, etc.; exact list pulled from code at build).
- **Qty**: integer, `Number.isSafeInteger`-equivalent, `>= 0`, `<=` magnitude cap (e.g. 10,000,000).
- **Date**: present + parseable.
- **StoreId / ProductId**: present, safe charset; **known in the catalogue** (see Q2) — except where N/A for a row type.
- **TransferId / TargetTransactionId**: if present, safe charset + not reserved.
- **Timestamp**: sane number. **SyncTimestamp** is server-set (already is) — never trust a client-supplied one.
- **No reserved keys** anywhere in the row.
- **Note:** StockTransactions carries NO money fields, so "non-finite money" validation is out of scope here — it belongs to the delivery/cost lists in Chunk 4.

## Implementation approach (Logic App)
- Fetch the catalogue **once per batch** (AppConfig `master_data`) → build the valid Store/Product sets → validate rows against it (NOT a per-row lookup).
- Per row in `For_each`: a `Validate` Compose/Condition computing pass/fail + reason; on pass → **direct insert** (no GET); rely on **"Enforce unique values" on TransactionId** so a duplicate insert returns **409**, which we catch as "already present" (idempotent) rather than an error.
- Collect rejects (and 409s separately) into arrays; write rejects to the **quarantine sink** (Q1).
- `Response_ok` returns the honest contract (Q5).

## Client side (sync.js push) — REQUIRED, gets sentinels
- Read the new response: mark **only accepted** TransactionIds `_synced`; leave rejected rows un-synced + flag them (local quarantine / admin-visible "rejected by server: <reason>"), do NOT silently retry-forever or mark synced.
- Treat 409 (duplicate) as accepted (idempotent).
- New sentinels (focused audit): (a) a server-rejected row is NOT marked synced + is surfaced; (b) a 409 duplicate is treated as synced; (c) accepted rows still mark synced normally.

## Test / probe plan (staging clone `push-v2-validate-staging`)
- Good row → inserted, reported accepted.
- One bad row of each class (bad Qty, bad Type, unknown Store, unknown Product, reserved key, hostile id char, unparseable Date) → rejected + quarantined + reported, **good rows in the same batch still inserted** (per-row, not whole-batch).
- Duplicate TransactionId (concurrent if practical) → exactly one row (409 path), reported as dup/accepted.
- A forced insert failure → reported rejected, NOT acked (the silent-data-loss guard).
- Client sentinels above (Playwright harness).

## OPEN DECISIONS (confirm before build)
- **Q1 — Quarantine storage:** (a) new SharePoint list `StockTransactions_Quarantine` (durable, admin-reviewable), (b) return-to-client only (client logs/flags), or (c) both. *Recommend (c): cloud list for audit + return so the client flags.*
- **Q2 — Catalogue source for Store/Product validity:** AppConfig `master_data` (the only catalogue that exists server-side — there are no Products/Stores lists). Confirm. And if `master_data` is missing/unreadable: **fail-open** (accept, skip catalogue check) vs **fail-closed** (reject)? *Recommend fail-open on catalogue only (don't block the whole ledger if AppConfig hiccups), still apply all shape checks.*
- **Q3 — Fold the dedup hardening (enforce-unique + direct insert + 409) into Chunk 2, or keep in Chunk 3?** *Recommend fold here — it's the same push path and removes the throttle/TOCTOU now.*
- **Q4 — Reject granularity:** per-row reject (good rows in a batch still land) vs whole-batch reject on any bad row. *Recommend per-row.*
- **Q5 — Response contract:** propose `{ status, accepted:[ids], rejected:[{TransactionId, reason}], duplicates:[ids], serverTimestamp }`. Confirm shape (drives the client change).
- **Q6 — Scope boundary:** Chunk 2 = data-shape validation only; **actor/role/store-scope authorization stays in Chunk 5.** Confirm we're NOT doing authz here.

## Auditor flow
Scope (this doc) → GPT+AGY **spec review** (the 6 decisions + rules) → build on staging → **focused** audit (server probes + the new client sentinels only, per the credit-saving rule) → hold for the end-of-phase 6-way.

---

## SPEC REVIEW RESOLVED (2026-06-24) — GPT-Codex + AGY both APPROVE-WITH-CHANGES, converged. This section is the build-ready spec.

**Top priority confirmed by both:** the `processedCount` silent-data-loss gap MUST be fixed in the same change — validation cannot ship on the old ack model (client marks the batch synced when count matches input, `sync.js:775-813`).

### Decisions (final)
- **Q1 = both.** Cloud list `StockTransactions_Quarantine` (NO unique constraint) + return payload to client. Quarantine row fields (GPT): `TransactionId, DeviceId, reasonCode, reason, rawRowJson, receivedAt, workflowRunId`.
- **Q2 = fail-open ONLY when `master_data` is unreadable.** If `master_data` loads and the Store/Product is unknown → **REJECT** (don't fail-open on a real unknown). When the check is skipped, set `catalogueCheck:"skipped"` in the response and log loudly (a config outage must not silently disable the control). Otherwise `catalogueCheck:"applied"`.
- **Q3 = fold dedup into Chunk 2.** Direct insert + "Enforce unique values" on TransactionId + treat 409 as acked-duplicate. **Preflight:** clean existing duplicate/blank TransactionId on staging, and verify the LIVE list has zero duplicates/blanks, BEFORE enabling the unique constraint.
- **Q4 = per-row**, AND split outcomes: **permanent validation reject** vs **retryable insert/workflow failure** (see Q5).
- **Q5 = richer contract (GPT):**
  `{ status, inputCount, accepted:[ids], duplicates:[ids], rejected:[{index,TransactionId,reasonCode,reason}], failed:[{index,TransactionId,reason,retryable:true}], serverTimestamp, catalogueCheck }`
  Client marks **only `accepted` + `duplicates`** as `_synced`; `rejected` (permanent) stays unsynced + surfaced to admin; `failed` (retryable: 429/5xx/transient) stays unsynced for normal retry (NOT quarantined forever).
- **Q6 = authz stays out** (Chunk 5). Chunk 2 = data-shape/catalogue only; do NOT describe it as stopping hostile *authorized-device* writes.

### Validation rules — corrected
- **Type whitelist = the EXACT `Txn.classify` set** (verify at `index.html:952-965` at build): `in, return_in, transfer_in, out, move_out, transfer_out, wastage, adjustment_in, adjustment_out, deleted`. (My draft wrongly omitted `return_in` and `wastage`.)
- **Tombstone special case (`Type === 'deleted'`):** require safe `TransactionId` + safe **non-empty** `TargetTransactionId` + `Qty === 0`; `StoreId`/`ProductId` may be blank/stale → **bypass the catalogue check** for these (matches egress `sync.js:716-729`, tombstone build `db.js:548-572`).
- **Audit/free-text fields (`StaffName`, `Reason`, `DeleteReason`):** do NOT apply the ledger-id charset (they legitimately contain spaces/punctuation). Only enforce **length bounds** (≤256, DeleteReason ≤500) + not-a-reserved-key.
- **Strict ledger-id charset** (`Stock._isSafeLedgerId`, `index.html:1040-1048`) applies to `TransactionId/TargetTransactionId/TransferId` only; **Qty** per `Validate.qty` (`index.html:1261-1273`); valid `Date`; sane integer `Timestamp`; **ignore client `SyncTimestamp`** (workflow sets it, `azure-pushv2-def.json:40`).
- **Do NOT trust the Request trigger schema** for domain validation — it's stale/mismatched (declares a top-level array + `TransferId` required, but the workflow reads `triggerBody().data.transactions`). Validate the actual payload path explicitly.

### Logic App design — concurrency-safe (both)
- Do NOT append to a shared array variable inside the `For_each` (conc 50) — that races. Instead each iteration **returns a per-row result object** `{outcome:'accepted'|'duplicate'|'rejected'|'failed', index, TransactionId, reasonCode?, reason?}`; after the loop, build the response buckets with **Filter Array** over the loop outputs. (Acceptable fallback for the first correct version: concurrency = 1.)
- **Terminal invariant, machine-checked before `Response_ok`:** `inputCount === accepted + duplicates + rejected + failed`. If it doesn't hold → return **non-2xx and ack NOTHING** (client retries the whole batch; never a row lost between the cracks).
- **Insert outcomes:** 409/duplicate → `duplicates` (acked); 429/5xx/transient create failure → `failed` (retryable, client retries) — never mislabel a transient failure as a permanent reject.

### Build sequence
Preflight dup-clean staging → build `push-v2-validate-staging` (validation + per-row result + Filter-Array buckets + unique-constraint + honest response) → client `sync.js` push reject-handling (accepted/duplicates synced; rejected surfaced; failed retried) + new sentinels → focused audit (server probes for each reject class + the silent-loss/invariant guard + client sentinels). Hold for the end-of-phase 6-way + single cutover.

---

## MID-BUILD FORK RESOLVED (2026-06-25) — Logic Apps have NO regex. GPT + AGY both = **Option A+ (pure Logic App, allowlist-EQUIVALENT blocklist).** No Azure Function in Chunk 2.

**Why A+ not narrow-A:** a narrow blocklist (only `< > " ' \ ;`) would ACCEPT ids like `abc.def` / `abc:def` that the live client pull QUARANTINES (`sync.js:1024-1030`, client rule `^[A-Za-z0-9_-]+$` len 1-128 not-reserved, `index.html:1040-1048`) → server/client divergence = a different silent-loss. The server must reject every id the client would. If A+ can't be done cleanly in WDL, switch to B.

**The no-regex technique (derived + matches both auditors' intent) — `safeId(id)` is SAFE iff ALL true:**
- `not(empty(id))` and `lessOrEquals(length(id),128)`
- `equals(length(uriComponent(id)), length(id))` — `encodeURIComponent` escapes space/control/non-ASCII/`%` and most punctuation → any of those make the lengths differ = rejected.
- BUT `encodeURIComponent` does NOT escape these 7: `. ! ~ * ' ( )` — so add explicit `not(contains(id,'<each>'))` for `.`, `!`, `~`, `*`, `'`, `(`, `)`. (WDL literal single-quote = `''''`.)
- `not(equals(id,'__proto__'))`, `not(equals(id,'constructor'))`, `not(equals(id,'prototype'))`.
- Net effect = the allowlist `[A-Za-z0-9_-]`, 1-128, not-reserved — **without regex.** Applies to `TransactionId` always; `TargetTransactionId`/`TransferId` when present.

**Other WDL techniques (both auditors):**
- **Qty:** `and(equals(Qty,int(Qty)), Qty>=0, Qty<=10000000)`. Don't call `int()` unguarded on arbitrary input — isolate Qty/Date conversions in a **per-row Scope** with a `runAfter:[Failed]` path → that row goes to `rejected`/`failed` (GPT invariant: no row may fail validation *execution* without landing in rejected or failed).
- **Date:** no try/catch in WDL → either enforce `YYYY-MM-DD` via substring/range checks, OR parse inside the per-row Scope and route a parse failure to `rejected{reasonCode:"BAD_DATE"}`.
- **Catalogue:** GET AppConfig `ConfigType eq 'products'`/`'stores'` ONCE before the loop → `Select` map to `productIds`/`storeIds` arrays → in-loop `contains(productIds, ProductId)`. 16KB parse = zero perf risk. Fetch/parse fail → `catalogueCheck:"skipped"` + fail-open on membership only (all other checks still apply).
- **Collection:** concurrency = 1 (auditor-sanctioned for the first correct version) + append to 4 array vars (accepted/duplicates/rejected/failed) — safe at conc 1.

**ACCEPTANCE BAR (spec delta, GPT) — these "not-XSS-but-client-unsafe" ids MUST all reject** (proves A+ ≈ allowlist): `abc.def`, `abc:def`, `abc/def`, `abc\def`, `abc%2f`, `abc[1]`, a newline/tab, and `é` (non-ASCII). Add these to the server probe set alongside the per-class reject probes + the dup/409 + terminal-invariant probe.

**STATUS:** infra done (list + indexed/unique TransactionId). Design fully locked. NEXT = author `push-v2-validate-staging` per the above → test (good/each-reject-class/the 8 acceptance ids/dup/invariant) → client `sync.js` reject-handling + sentinels → focused audit.

---

## BUILT + AUDITED (2026-06-28/29)

**Client half (sync.js push reject-handling) — DONE + proven.** Honest contract handled: accepted+duplicates → _synced; rejected → durable local quarantine (DB.markTransactionsRejected) + surfaced + excluded from re-push; failed → retried; a contradictory response (id in two buckets) → no durable change + retry whole batch (fail-closed); unaccounted/persist-fail → retry. Sentinels S-163..170 (+ S-67 re-pointed). Harness: smoke 161/161, full saboteur sweep 178 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA. Review: AZURE-CHUNK2-CLIENT-REVIEW.md.

**Q1 quarantine sink (server, "=both") — DONE + proven (2026-06-29).** Created SharePoint list `StockTransactions_Quarantine` (TransactionId, DeviceId, reasonCode, reason, rawRowJson, receivedAt, workflowRunId) + added a best-effort `Quarantine_loop` to `bob-stock-push-v2-validate-staging` that writes each `body('Rejected')` row (runs after Rejected; Respond/Invariant sequenced after it as Succeeded|Failed so a quarantine hiccup never blocks the ack). End-to-end proven: pushed BAD_TXNID + BAD_QTY → both rejected in the response (invariant held) AND both written to the cloud list (reason codes + raw JSON), read back independently via the read-only auditor Graph credential. (This closed AGY's round-2 BLOCK — the server half had only the return-payload, not the durable cloud list.)

**Audit status:** R2 — GPT BLOCK (client conflict) FIXED, AGY BLOCK (quarantine sink) FIXED. R3 — AGY PASS all surfaces; GPT BLOCK (3 SERVER bugs: flat-reject response-shape mismatch [client/server wouldn't interoperate; all mocked client tests passed anyway], Qty int()/empty() 502 poison-pill, Date/Timestamp eternal-retry-not-reject) — all FIXED on staging + proven E2E. **R4 — BOTH AUDITORS CLEAN PASS.** GPT fed the real server response through the live client (reject surfaced/quarantined, no re-push loop); both confirmed via SharePoint Graph that good rows land in Validate, dups dedup, every reject (BAD_QTY/BAD_DATE/BAD_TIMESTAMP/BAD_TXNID) is absent from Validate + present in Quarantine. **CHUNK 2 COMPLETE (client + server) — both auditors converged PASS with independent cloud verification.** Held for the end-of-phase 6-way + single live cutover. Live untouched; server changes on STAGING only; client code uncommitted on branch main. LESSON banked: a mocked client harness proves client logic, NOT client/server interop — only real-cloud E2E catches a server-contract drift ([[feedback_mock_must_match_server]]).
