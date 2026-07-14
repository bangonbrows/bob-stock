# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 9 (paper review, PER-PART) — Codex + AGY

**You are reviewing the OS-W4 spec, round 9.** R8's 15 findings were ground-truthed: 13 REAL and folded as
**W4-SR-97..109** (fold records inside each sub-doc), 2 refuted with code evidence:
- AGY's W4.1 PASS reasoning on concurrent onboards was WRONG (Codex R8-1 proved the reservation doesn't
  bump the version) — the fold fixed the real gap with claim-based reservations; AGY please re-review W4.1
  on the new text, not the prior reasoning.
- AGY's W4.4 partial-receive key collision: NOT REAL — the receive IdempotencyKey rides ONLY initial receive
  rows (phase2.js:319/332; receive is once-per-transfer, F2-CRIT02); partial fulfilment is the top-up path
  with unique TransactionId-fallback keys (phase2.js:62, now pinned normative). The adjacent REAL gap
  (blank legacy keys) is folded as SR-109.

**Bonus ground truth:** Codex R8-2's hash probe exposed a LATENT PRE-EXISTING Chunk-4 bug — `_stableHash`'s
replacer drops nested fields at every level, so backfill divergence detection has been blind to item-level
differences since D4-I. W4.3 fixes it (canonical deep serializer) with its own sentinel; flagged
Kunal-visible.

Both auditors in parallel; paper review; report-only; verdict PER PART — parts BOTH of you PASS freeze.
AGY has now passed W4.2 twice and Codex's W4.2 findings are closed by SR-102..104 — W4.2 may be one clean
round from freezing; give it a genuine fresh look rather than a rubber stamp either way.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md` · `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md` ·
`AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` · `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §1/§2/§6. History: frozen ledger `AZURE-CHUNK-ORG-W4-SCOPE.md`.

## What R8 changed (headline per part)
- **W4.1:** reservation = atomic CLAIMS over every created/depended-on identifier + the specific pricing
  keys; conflict check scoped to claimed keys (unrelated publishes can't abort); abort only pre-mutation
  (clears topology_pending, voids snapshot), FORWARD-ONLY after; per-step conditional updates with worker
  claim tokens; office identity proof grown to SIX legs (+isFranchise, +active).
- **W4.2:** settled-echo ordering fixed (instant captured BEFORE the journal check; interval `from` =
  reservation instant); freshness invalidated on reload/visibility-resume/reconnect/tab-handoff; restore ⇒
  durable `pricing_unresolved` (adoption state scrubbed from backups, AA pattern).
- **W4.3:** basis PRECEDENCE (submit-stamped permanent; a pre-W4 receiver can no longer downgrade it) +
  VALUATION precedence (row stamps → item stamps → lens); canonical DEEP hash replaces the broken replacer
  trick; resolve gains `resolvesBackfillHashes` so divergences actually converge.
- **W4.4:** drain outcomes = present OR covered-by-same-list-tombstone (legit deletions don't block FINAL
  forever); `run_requested` turn-taking fairness; IdempotencyKey identity = validated non-empty keys only,
  blanks fall back to TransactionId + surfaced.

## Attack per part (fresh surface only)
- **W4.1:** the claims model itself — claim granularity (can two plans with genuinely disjoint intents
  share a pricing key, e.g. two ADDs under one office, and should they serialize?); abort-pre-mutation vs
  the quiesce flag (is clearing topology_pending on abort safe for devices already holding?); forward-only
  + a permanently failing step.
- **W4.2:** the reservation-instant pin (can any writer journal an interval whose `from` predates its
  reservation — reconcile re-publishes, clock skew between LA runs?); `pricing_unresolved` vs the
  activation flag interplay on a restored device that was pre-activation.
- **W4.3:** valuation precedence vs the export engine (does W4.4 implement the same row→item→lens order? is
  the transferId lookup available server-side?); deep-hash migration (old backfill steps hashed with the
  broken function — do historical stepIds collide with re-hashed content?).
- **W4.4:** drain "covered" semantics (can a same-list tombstone + a NEW replacement row double-count?);
  turn-taking under a crashed requester (run_requested set, archiver dies — does it block exports?).

## Verdict
Four verdicts (`W4.x: PASS | PASS-with-notes | BLOCK`), numbered findings per part with concrete scenarios.
Claude ground-truths and folds; parts BOTH auditors PASS freeze.
