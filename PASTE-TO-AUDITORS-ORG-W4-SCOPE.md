# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 8 (paper review, PER-PART) — Codex + AGY

**You are reviewing the OS-W4 spec, round 8.** R7's 21 findings were all ground-truthed: 19 REAL and folded
as **W4-SR-76..96** (fold records live INSIDE each sub-doc now), 1 already-covered (AGY W4.3 partial-receive
— receive is once-per-transfer; the remainder path is the top-up, which inherits the item basis; the repro
is banked as a sentinel anyway), and 1 NOT REAL (AGY W4.1 `pricingAlignsWithEras` — the validator is a
contiguous-coverage cursor walk, topology.js:311-322, not a 1:1 era-interval mapping; a permanent probe now
pins that). Both auditors in parallel; paper review; report-only; verdict PER PART — parts that BOTH of you
PASS are FROZEN.

## Read (branch `azure-phase-5-8-server`)
The four sub-docs (each now carries its own R7 fold record + amended pins) + the shared contracts:
`AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md` · `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md` ·
`AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` · `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §1/§2/§6. History: the frozen ledger `AZURE-CHUNK-ORG-W4-SCOPE.md`.

## What R7 changed (headline per part)
- **W4.1:** office-store-row read at officeStoreId (OFFICE_STORE_ID_TAKEN); CAS-AT-RESERVATION with a
  durable `aborted` terminal state excluded by reconcile; four-leg office identity proof
  (OFFICE_STATE_MISMATCH); franchisee entity gains `officeStoreId`.
- **W4.2:** the stale horizon advances ONLY on SETTLED echoes (no pending journal at serve time) and stores
  the SERVER-issued instant; dormant-gate freshness is session-scoped (no device-clock arithmetic);
  master_data/config coherence is exact-equality BOTH directions (leading scalar fields held + config fetch).
- **W4.3:** per-line `basis` field pinned in submit/receive/resolve payloads (absence ⇒ legacy-lens,
  durably); the resolve payload carries the pinned stamps; backfill/fold enumeration maps stamps+basis;
  cancel-return rows join the every-path inheritance list; DiscAtSupply ≤2dp everywhere.
- **W4.4:** signature re-pinned `{storeId, rows:{live,archive}, pricing, window, products, coverage,
  graceClosed, drain}`; dual-identity dedup (TransactionId + IdempotencyKey); ONE CAS coordination record
  (idle | run_active(heartbeat) | export_lease(ttl)) with lease renewal + post-query continuity check +
  stale-run reconcile recovery; `committed` records written row identities and the engine asserts their
  PRESENCE in the row set before FINAL.

## Attack per part (fresh surface only — the folds above)
- **W4.1:** the `aborted` journal lifecycle (can an abort race its own reconcile? can a re-plan reuse a
  changeId?); the four identity legs (a state bundle that passes all four yet still binds the wrong office);
  OFFICE_STORE_ID_TAKEN vs concurrent onboard of the same officeStoreId.
- **W4.2:** the settled flag (a serve-time race where pending is created between the check and the echo);
  session-scoped freshness across tab handoffs/reloads; held leading-scalar fields interacting with backup
  export/restore.
- **W4.3:** the basis field's absence rule vs a MIXED fold (W4 submit + pre-W4 receive and vice versa);
  resolve-carried stamps vs the backfill hash (does a resolve after backfill converge?); cancel-return
  inheritance when the cancel races the receive (the existing cancel_vs_receive conflict).
- **W4.4:** the coordination record as a single point of contention (CAS starvation under retry storms);
  drain visibility proof vs tombstoned grace-admitted rows (written id recorded, row legitimately absent);
  dual-identity dedup vs the per-product receive IdempotencyKey pattern (phase2.js `_receiveKey` — can two
  LEGITIMATE rows share a key?).

## Verdict
Four verdicts (`W4.x: PASS | PASS-with-notes | BLOCK`), numbered findings per part with concrete scenarios.
Claude ground-truths and folds; parts that BOTH auditors PASS freeze.
