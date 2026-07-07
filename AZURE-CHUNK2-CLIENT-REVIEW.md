# Azure Chunk 2 — Client half (sync.js push reject-handling) — Wave Review

**Date:** 2026-06-28 · **Status:** built + self-proven; NOT committed, NOT deployed. Held for the end-of-phase 6-way blind audit + single live cutover. For Kunal review → focused GPT + AGY code audit (auditors run the harness themselves) → hold.

Server half (`bob-stock-push-v2-validate-staging`) is DONE + proven on staging and spec-approved by both auditors (see `AZURE-CHUNK2-SCOPE.md`). This wave is the **client half**: making `sync.js` push honour the new honest accept/reject response contract, plus the durable quarantine + sentinels.

## The bug this closes (the dangerous one)
The old push ack trusted `processedCount === batchSize` and marked the **whole batch** `_synced` on a count match (`sync.js` legacy path). A row the server rejects (or that silently failed to insert) was still reported `ok` → marked synced → **gone from the unsynced set forever = silent data loss**. The new contract reports exactly which rows landed; the client now marks **only** those.

## The new response contract (Chunk 2)
```
{ status, inputCount,
  accepted:   [TransactionId, ...],
  duplicates: [TransactionId, ...],
  rejected:   [{index, TransactionId, reasonCode, reason}],
  failed:     [{index, TransactionId, reason, retryable}],
  serverTimestamp, catalogueCheck }
```
The server enforces a **terminal invariant** (`inputCount === accepted+duplicates+rejected+failed`) and returns **non-2xx + acks nothing** if it can't hold — so a 2xx carrying these buckets is trustworthy.

## What changed (client)

### `sync.js` — `push()` ack rewrite
- **Contract detection (`_isV2`):** presence of any of the four outcome arrays. Legacy push-v2 (only `processedCount`) falls through to the **retained legacy ack path** (now the `else` branch) — a safe rollback / mixed-endpoint window. No behaviour change for the legacy contract.
- **Client policy under the v2 contract:**
  - `accepted` + `duplicates` → marked `_synced` (a duplicate/409 means the server already has it — idempotent, must clear).
  - `rejected` (permanent) → **durable quarantine flag** + surfaced (console + `Diag` + status); **never** `_synced`, **never** re-pushed.
  - `failed` (retryable: 429/5xx/transient) → left **unsynced** for a normal retry (`_setPending(true)` + `_scheduleSyncRetry()`); **never** quarantined.
- **Defence in depth (P-13):** every bucket is intersected with `batchIds` — the client only ever acts on ids it actually sent this batch; a server id outside the batch is ignored.
- **No silent loss on partial buckets:** any row we sent that appears in *no* bucket simply stays unsynced and re-pushes next cycle (fail-safe) — the client trusts a 2xx but never marks a row it wasn't told landed.
- **markSynced persist-fail (Wave H/H3 preserved):** if the local `_synced` write fails, keep pending + retry, never show "Synced ✓".
- **Push filter:** `_allUnsynced` now also excludes `!t._rejected`, so a quarantined row is not re-pushed every cycle (closes the silent retry-forever).

### `db.js` — `markTransactionsRejected(Map<TransactionId,{code,reason}>)`
Mirrors `markTransactionsSynced`: durable, targeted bulkPut of `_rejected/_rejectedAt/_rejectCode/_rejectReason`; reverts the cache on a failed write (cache never claims a flag disk didn't confirm). On a failed write the row stays un-flagged and simply re-pushes → re-rejected → re-flagged next cycle (no data loss, just a delayed flag).

## Surfacing (not silently dropped)
A rejected row is recorded three ways: a durable per-row flag + reason (admin-visible, survives reload), a `console.warn` listing ids+reasonCodes, and a scrubbed `Diag.log('sync', ...)` entry. The status line shows `Synced ✓ — N rejected by server`. (A dedicated admin "rejected rows" screen is a small follow-up; the data + surfacing are in place now.)

## Scope boundary
Client-side data-shape handling only. **No authz** (Chunk 5). This does not stop a hostile *authorized* device — the server is the gate (framework P-13); the client simply honours the server's honest verdict instead of lying to itself.

## Harness
- New sentinels (all drive the **live** `Sync.push()` against a mocked v2 response):
  - **S-163** server-rejected row is NOT synced + is flagged/surfaced (the silent-loss guard).
  - **S-164** a `duplicates` (409 idempotent) id is treated as synced.
  - **S-165** an `accepted` id is marked synced (and not flagged rejected).
  - **S-166** a `failed` (retryable) row is left unsynced + not quarantined + pending retry.
- Matching saboteur mutations S-163..166 (single-line, ASCII, unique; CRLF-safe), each flips exactly its sentinel red.
- **Smoke: 161/161 PASS on clean code, zero regressions** (existing push sentinels use the legacy contract → unchanged `else` path).
- New sentinels S-163..170 (+ S-67 re-pointed): rejected-not-synced/surfaced (163), duplicate=synced (164),
  accepted=synced (165), failed-retried-not-quarantined (166), v2 markSynced-fail no-lie (167),
  no-bucket row retried (168), failed-quarantine-write retried (169), conflicting-bucket fail-closed (170).
- **Full sweep: baseline 161/161, 178 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA-FAIL of 178** (authoritative gate met).

## Round 3 audit (2026-06-29/30) — AGY PASS (all surfaces); GPT BLOCK (3 server bugs), all FIXED + proven
GPT fed the REAL cloud response into the client and caught 3 server bugs the mocked client tests + AGY missed —
all SERVER-side (the client is correct to the agreed spec; the deployed workflow wasn't). Fixed on staging:
- **P1 (critical) — reject response shape mismatch.** Deployed `Respond` returned the raw internal shape
  `{ reason, row:{TransactionId} }` instead of the documented flat `{ TransactionId, reasonCode, reason }` (Q5).
  The client (built to spec) couldn't read it → rejects never surfaced/quarantined, retried forever. As-is, client
  and server would NOT interoperate at cutover, but every mocked client sentinel passed (they mocked the spec
  shape). FIXED: added a `Map_rejected` Select that flattens `body('Rejected')` to the documented contract; `Respond`
  now returns it. **LESSON (banked): the client harness mocks the contract — a server that doesn't emit that exact
  contract passes the harness but breaks in reality; only the real-cloud E2E catches it. Keep the mock shape == the
  deployed response.**
- **P2 — Qty poison-pill.** `int(Qty)` (and then `empty(Qty)`) threw on `"abc"`/`1.5` → whole batch 502'd, one bad
  row blocked all of a device's syncing. FIXED: int()-free, empty()-free Qty validation (digits-only via nested
  `replace` + length/bound, all on `string(Qty)`) → deterministic `BAD_QTY` reject + quarantine, no crash.
- **P2 — Date/Timestamp.** Garbage Date/Timestamp slipped validation → failed at insert as retryable → retried
  forever. FIXED: real `YYYY-MM-DD` shape check (padded substrings, never throws) + a Timestamp digits check →
  deterministic `BAD_DATE`/`BAD_TIMESTAMP` rejects + quarantine.
PROVEN end-to-end 2026-06-30 on staging: pushed `"abc"`/`1.5`/`not-a-date`/`not-a-number`/hostile-id + a good row →
response was 200 (no 502), `rejected[]` FLAT, BAD_QTY/BAD_DATE/BAD_TIMESTAMP/BAD_TXNID all correct, good row accepted,
and every reject independently read back in `StockTransactions_Quarantine` via the auditor credential. No client
change needed (server now emits exactly what the client + sentinels expect). Fixed def re-exported to
`audit-artifacts/push-v2-validate-staging-DEFINITION-2026-06-29.json`. NEXT: GPT round-4 re-verify; AGY already PASS.

## Round 2 audit (2026-06-29) — GPT BLOCK (client) + AGY BLOCK (server), both fixed
- **GPT (client) — conflict path:** a contradictory response (same id in a landed bucket AND rejected/failed)
  was quarantining the conflict id, which removed it from the retry set → the "retry" sent nothing and cleared
  pending. FIXED: a conflict now makes **NO durable change** (not synced, not quarantined) and retries the whole
  batch (fail-closed). S-170 strengthened to assert the conflict id is neither synced nor quarantined.
  Re-proven: smoke 161/161, scoped 9 CAUGHT/0 BLIND, full sweep **178 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA**.
- **AGY (server) — quarantine sink:** AGY used the new read credential and found Q1 ("=both") was only half-built —
  the validate Logic App returned rejects in the response but never wrote them to a durable cloud list, and
  `StockTransactions_Quarantine` didn't exist. FIXED on staging: created the list (TransactionId, DeviceId,
  reasonCode, reason, rawRowJson, receivedAt, workflowRunId) + added a best-effort `Quarantine_loop` to
  `bob-stock-push-v2-validate-staging` that writes each rejected row (sequenced before Respond as Succeeded|Failed
  so a quarantine hiccup never blocks the ack). PROVEN end-to-end 2026-06-29: pushed BAD_TXNID + BAD_QTY rows →
  response rejected both (invariant held) → both landed in the cloud list with reason codes, read back independently
  via the auditor Graph credential.

## Round 2 — GPT P2 fixes (2026-06-28)
GPT-Codex BLOCK'd round 1 with 3 real P2s (it ran the harness: 158/158, 6 CAUGHT/0 BLIND). All fixed at root by
replacing the ad-hoc ack branch with a single **`_clean` invariant** (`accepted/dup synced; reject quarantined;
fail/unaccounted/conflict → keep pending + retry`):
- **P2-1 no-bucket rows** (a sent row in no bucket cleared pending + showed "Synced"): now counted (`_unaccounted`) → forces retry. (S-168)
- **P2-2 quarantine-write failure ignored** (`markTransactionsRejected` return unchecked): now checked (`_rejMarked`) → forces retry. (S-169)
- **P2-3 conflicting buckets not fail-closed** (same id in accepted+rejected got synced): now the sync set excludes any id also in rejected/failed (fail-closed) → never synced. (S-170)
AGY round 1 still pending.

## Files
- `sync.js` (uncommitted) — `push()` ack + `_allUnsynced` filter.
- `db.js` (uncommitted) — `markTransactionsRejected`.
- `test/smoke-test.js`, `test/saboteur-runner.js` (uncommitted) — S-163..166 + mutations.

## NOT done / open
1. Focused code audit (GPT + AGY) — they run the harness themselves (standing rule).
2. Hold for the end-of-phase 6-way + single cutover (server endpoint swap to `push-v2-validate` ships together with this client change).
3. (Optional follow-up) a small admin view listing quarantined `_rejected` rows + reasons.
