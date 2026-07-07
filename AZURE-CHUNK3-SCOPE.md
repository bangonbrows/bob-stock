# Azure Chunk 3 — Transfer-receive idempotency (SCOPE)

> **DECISION (2026-06-30, Kunal): NO standalone Chunk 3 — FOLDED INTO CHUNK 4.**
> Rationale: the double-receive bug only manifests when **two devices at one store are both OFFLINE** and both receive the same transfer before syncing (online, the existing guard + 30s poll already block it; stores are ~98% wifi) → low probability, but silent + permanent if it occurs. Kunal chose that a genuine double-receive must go to the **Director to decide which receive to keep**, NOT a silent first-sync-wins. That "Director chooses" flow needs cross-device record visibility + a resolution screen — which is exactly Chunk 4's machinery. So the receive-idempotency + conflict-resolution are built **together, on the Chunk-4 record-sync layer**, not standalone now.
>
> **Conflict model (locked):** a 2nd receive of the same `(TransferId, StoreId, ProductId)` with the **SAME quantity** → silent idempotent dedupe (harmless duplicate, no Director). A 2nd receive with a **DIFFERENT quantity** → flag as a **conflict → Director resolves which count is correct** (same spirit as the existing stock-take-discrepancy / transfer-flag resolution flows). Carry these into the Chunk-4 build (D1).
>
> The rest of this doc is the original receive-idempotency design — retained as the technical basis for the Chunk-4 receive-step idempotency (the per-product key Q1, the receive-vs-resolution discriminator Q2, etc. still apply).

**Status:** SUPERSEDED — folded into Chunk 4 (see decision above). Original scoping retained below for the Chunk-4 build. Build on staging only; live untouched; hold for the end-of-phase 6-way.

## The bug (Gemini blind-audit CRIT-03, runtime-proven)
A transfer `T` (qty n) is `in_transit` to store `S`. Two devices at `S` are both offline and both "receive" it:
- Device A mints `transfer_in` row `{TransactionId: idA, TransferId: T, Type: transfer_in, StoreId: S, ProductId: P, Qty: n}` → local stock +n.
- Device B mints `{TransactionId: idB, TransferId: T, Type: transfer_in, StoreId: S, ProductId: P, Qty: n}` → local stock +n.
Both sync. The server dedups by **TransactionId** only → `idA ≠ idB` → **both insert** → stock at S = **2n, permanently**. (Stock = Σ movements; you can't un-count it.)

**Why the existing guards miss it:**
- Client guard `phase2.js:225` (`_already` = any local `transfer_in` for this `transferId`) only sees the receive **on its own device** — A and B can't see each other's while offline. It only fires *after* a sync already brought the other's row in (too late).
- Server dedup is TransactionId-only — two independently-minted ids look like two distinct rows.
- **The server is the only real fix** (framework P-13). Plus a client reconcile so the 2nd receiver doesn't double-count on the subsequent pull (see below).

## The fix — two parts

### Part 1 (server) — idempotency on the *semantic* receive, not the TransactionId
Compute a deterministic **IdempotencyKey** per row in the validate workflow and enforce it unique on the list:
- For a receive row: `transfer:{TransferId}:receive:{StoreId}:{ProductId}` (per-product — see Q1).
- For everything else: fall back to `TransactionId` (already unique).
Add an `IdempotencyKey` column to `StockTransactions(_Validate)` with **Enforce unique values**. The validate workflow sets it on Insert; a 2nd receive of the same (transfer, store, product) → **unique-violation 409** → which the Chunk-2 `Outcome` branch already classifies as **`duplicate`** → acked, **not double-inserted**. (Reuses the existing 409→duplicate path; no new failure mode. TOCTOU-safe because the uniqueness is enforced atomically by SharePoint, not a GET-then-insert.)

### Part 2 (client) — reconcile so the 2nd receiver doesn't double-count on pull
Even with Part 1, device B still double-counts locally: B keeps its optimistic `idB` (+n) **and** later pulls the server-canonical `idA` (+n, different TransactionId) → +2n on B. So the client must **dedupe `transfer_in` on pull-merge by the semantic receive identity** `(TransferId, Type, StoreId, ProductId)`: when a canonical row arrives that matches a local optimistic one with a different TransactionId, keep ONE (server-canonical) and drop/replace the other. Net credit = n. (Partner to Part 1; needs its own sentinel.)

## OPEN DESIGN QUESTIONS (for GPT + AGY spec review + Kunal)
- **Q1 — Key granularity (per-product is mandatory).** A transfer of 3 products creates 3 `transfer_in` rows sharing `(TransferId, transfer_in, StoreId)`. So the key MUST include `ProductId` or the 2nd/3rd product would falsely 409 against the 1st. Confirm `transfer:{TransferId}:receive:{StoreId}:{ProductId}`. Is `(TransferId, StoreId, ProductId)` always unique per legitimate receive? (Believed yes — one receive per product per transfer per store.)
- **Q2 — Receive vs resolution-adjustment rows.** `phase2.js` resolution adds MORE `transfer_in` rows for the same transfer (flag top-up `:257/270`, accept-as-is `:327`, adjust `:333`, shortfall/reject return to the *from* store `:329/336/339`). These are **distinct operations** on the same transfer and must NOT collide with the receive key (or with each other). Options: (a) include a step/reason discriminator in the key; (b) only apply the idempotency key to the **initial receive** rows and leave resolution rows keyed by TransactionId. *Lean: (b) — scope idempotency to the first receive only; resolution is Director-driven on one device (low double-risk).* Confirm.
- **Q3 — Conflicting received quantities (business decision, Kunal).** If A receives qty 5 and B receives qty 3 for the same line, only one row wins (first-to-sync). Is "first-sync wins, the other is dropped" acceptable, or must a quantity conflict be **flagged** for Director review? *Lean: first-sync-wins for alpha + surface a Diag/admin note; flag-for-review is a bigger feature.* Kunal's call.
- **Q4 — Which ops get an idempotency key.** Just `transfer_in` receive (the proven bug)? Also `transfer_out` submit (the sender device — lower risk, single-device `_txState` guard already blocks double-submit, cross-device blocked by status checks)? *Lean: receive only for Chunk 3; revisit others under D1/Chunk 4.*
- **Q5 — Existing data / backfill.** The live ledger may already contain historical double-receives. Detect + report them (read-only) before enabling the constraint, or prevent-going-forward only? *Lean: a read-only detection probe on staging + live (no auto-fix); fix forward.* (Mirrors Chunk-2's preflight dup-clean before enabling the unique constraint.)
- **Q6 — Scope boundary.** Chunk 3 = receive idempotency only. Multi-table record sync (transfers as records) = Chunk 4 (D1 resolved: append-only record-steps list). Authz = Chunk 5. Confirm we're NOT doing those here.

## Build sequence (after spec review)
Preflight: detect existing (TransferId,StoreId,ProductId) receive-duplicates on staging + live (read-only). → Add `IdempotencyKey` column + unique constraint to `StockTransactions_Validate` (staging). → Extend the validate workflow: compute IdempotencyKey per row, include in Insert (409→duplicate already handled). → Client: pull-merge dedupe `transfer_in` by `(TransferId,Type,StoreId,ProductId)` + sentinels (server 409-dedups a 2nd receive; client doesn't double-count on pull; multi-product receive NOT falsely deduped). → focused audit (server probes: 2nd receive 409→duplicate, multi-product receive all land, resolution rows unaffected; + client sentinels) → hold for the 6-way.

## Execution path
az CLI is authenticated on this machine (used throughout Chunk 2) → Claude applies the staging Azure/SharePoint changes directly. Live untouched until the milestone cutover.

## Auditor flow
Scope (this doc) → GPT + AGY **spec review** (Q1–Q6 + the two-part design) → build on staging → focused audit (server probes + client sentinels) → hold for the end-of-phase 6-way.
