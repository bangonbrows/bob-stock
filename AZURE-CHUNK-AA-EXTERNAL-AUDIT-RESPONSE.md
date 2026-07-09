# Account Access — EXTERNAL AUDIT RESPONSE (Codex + AGY, 2026-07-10)

Both external auditors reviewed the chunk on branch `azure-phase-5-8-server`. Every finding ground-truthed by
Claude (standing rule — verify all findings, and NEVER take AGY/Gemini severity at face value). Net: **one
new legitimate low-severity consistency fix (AA-EXT-1), correctly re-rated from AGY's "P1" to P3, now fixed +
sentinel'd. No blocking security finding. The chunk holds.**

## Codex — PASS-with-notes (ran the full harness on an isolated worktree)
Codex cloned an isolated worktree (`bob-stock-aa-codex-audit` @ 3e7784d) and RAN everything:
`access-policy-proof.js` 61/61, `smoke-test.js` 238/238, `verify-app` 57 PASS, `verify-release` PASS,
`static-check` clean, `csp-check` PASS; Azure **read-only** inspection confirmed the deployed
`access-policy-write-staging` gate chain + write ordering (no cloud load tests).
- **Its only finding = the already-tracked SRV-P3** (partial-write soft-lock: secure→client→version ordering
  can leave a STALE_VERSION soft-lock after a mid-sequence LA failure; fails safe; no bypass/leak). Codex
  independently reproduced it via `policyMerge` (current v8 / baseVersion 7 → STALE_VERSION; baseVersion 8 →
  v9). **Already logged in `AZURE-CHUNK-AA-STAGING-LEDGER.md` as SRV-P3 for staging-apply.** No new action.
- Confirmed R1/internal P1/P2 closures held under runtime probing: username-keyed overrides, reserved-key
  rejection, sudo floor, server-side PIN scope, client/server resolver parity, logged-out/pending purge,
  policy tamper fail-closed.
- Note: Codex could not run scoped saboteurs because Claude's own full sweep held the runner lock
  (PID 60208) — correct behaviour (it did not kill/bypass a parallel run). Not a finding.

## AGY (Antigravity) — BLOCK, on a finding that is REAL but MIS-RATED
AGY's environment had **no `node`**, so it did STATIC analysis only — it could not run the harness (violates
the "audits must RUN" rule; treat its runtime claims cautiously). It confirmed AA-01/03/04/06/09/10/25 fixed
by reading the code.

**AGY finding [claimed P1]: "CSV export bypasses seeSellingPrice."** GROUND-TRUTHED — **REAL as a
consistency gap, but NOT a P1 data leak.**
- **True part:** the AA-02 `seeSellingPrice` gate was wired to the on-screen products table only. The stock
  CSV (`_exportStockCSV`) and products CSV (`_exportProductsCSV`) still emitted a Sell Price column
  unconditionally; a store-level role denied `seeSellingPrice` could export it. So the toggle was
  inconsistent — the same "the toggle lies" class as AA-02.
- **Why AGY's P1 severity is WRONG:** selling price is **PUBLIC catalogue data shipped to EVERY device** in
  `master_data` — it is already on the device regardless of the toggle. `seeSellingPrice` is a **documented
  client-only view hint** (disclosed residual #1; P-13 — client-side view controls are convenience, never
  server enforcement). There is **no privilege escalation and no server-enforceable secret** here: a
  technical user could always read price from local data. Correct severity: **P3 (view consistency)**, not P1.
- **FIX (done anyway — cheap + makes the toggle honest, AA-EXT-1):** both CSV exports now gate the Sell Price
  column on `Auth.can('seeSellingPrice')`, matching the table. Sentinel + saboteur **S-248** drives the real
  exports and asserts no price column when denied. `seeSellingPrice` remains labelled client-only in the
  residuals — price is still computable from local data by a determined user (unchanged posture).
- **AGY's second item** ("test harness needs node") is an AGY-environment problem, not a repo defect — Codex
  ran the identical harness fine with node present. Recorded, no action.

**AGY's BLOCK verdict is not upheld** as a blocker: its sole blocking finding is a client-only view-hint
consistency issue (now fixed), not a security block. This matches the auditor-tier expectation (AGY mid-tier,
static-only here; Codex high-signal, ran everything).

## Resulting state
- AA-EXT-1 fixed; smoke now **239/239**; S-248 added (+ S-238/S-245 harness anchors re-confirmed CAUGHT after
  the sweep flagged them). Final full saboteur sweep result appended to `AZURE-CHUNK-AA-WAVE-REVIEW.md`.
- SRV-P3 (Codex + internal) stays tracked for staging-apply — no code change now (fails safe).
- No finding requires re-opening the server audit; no finding touches the deployed cloud enforcement.

## Next
Final sweep confirms 0-blind → the chunk is externally cleared (Codex PASS, AGY's block resolved). Then:
staging-apply (with the SRV-P3 write-ordering fix + a throwaway `srvaudit_` test director for the positive
E2E) → the chunk goes on HOLD → org-structure chunk → 6-way milestone blind audit → cutover.
