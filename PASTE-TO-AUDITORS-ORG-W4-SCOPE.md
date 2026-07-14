# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 11 (paper review, PER-PART) — Codex + AGY

**You are reviewing the OS-W4 spec, round 11.** R10: 8 distinct findings (3 converged pairs), ALL REAL,
folded as **W4-SR-117..124**. Codex PASSED W4.2 (verifying planner time-shift invariance and correcting the
proof relation to `boundary >= T`, folded); AGY then found the settled-vs-active-claims hole in the same
part — both were right, W4.2 now requires NO ACTIVE CLAIMS for `settled`. Codex's granularity and
epoch/ingest analyses were exceptional this round.

Both auditors in parallel; paper review; report-only; verdict PER PART — parts BOTH of you PASS freeze.
The remaining surface is narrow: R10's folds completed the claims lifecycle, the settled proof, the
canonicalizer, and the export's steps/controls contracts. If a part looks done, PASS it — the loop only
converges when clean parts are declared clean.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md` · `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md` ·
`AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` · `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §1/§2/§6. History: frozen ledger `AZURE-CHUNK-ORG-W4-SCOPE.md`.

## What R10 changed
- **W4.1 (SR-117/119/120):** claims carry owner + TTL/heartbeat with reconcile orphan-scrub (both crash
  windows closed); APPLY-TOP REPLAN from fresh state covers the full planner read-set (adopt a
  different-but-valid fresh plan under held claims); complete state machine — `pending | needs_replan |
  blocked_manual | aborted | complete`, reconcile scans pending+needs_replan, post-mutation fresh-reject ⇒
  blocked_manual (claims held = fail-closed-safe, surfaced), LA §1's "leave pending" contradiction fixed.
- **W4.2 (SR-118):** `settled` requires NO ACTIVE CLAIMS (a stalled claim's boundary = its claim timestamp,
  earlier than the registry's last-modified); claim TTLs bound the unsettled window; proof relation
  corrected to `>= T` (safe: horizon admits strictly-before-T).
- **W4.3 (SR-121):** the divergence hash runs over a VERSIONED SEMANTIC CANONICAL FORM (legacy absence ↦
  exact W4 defaults via the same fold rules; meaningful stamp/basis differences preserved).
- **W4.3+W4.4 (SR-122):** ORIGIN ASSERTION — lens valuation for a transfer-linked row only when PROVABLY
  legacy (valid submit/backfill origin required; no-steps rows legacy only if pre-Chunk-4-epoch by server
  id; grace records bind expected stepIds so drain proves STEP ingest).
- **W4.4 (SR-123/124):** `controls: {live, archive}` + per-list full-target-set completion attestations in
  the same lease; TYPED controls — deletion removes, replacement substitutes (original-date metadata governs
  window membership, CHUNK8 item 2), no delta type, ambiguity fails closed.

## Attack per part (fresh surface only)
- **W4.1:** the TTL/scrub vs a SLOW-but-alive holder (can a legitimate long drain outlive its claim TTL and
  get scrubbed mid-flight? what renews the heartbeat and what happens if scrub races a live worker's
  conditional step?); blocked_manual claims held indefinitely (Director never acts — is the fail-closed
  store acceptable forever, or does it need escalation surfacing?).
- **W4.2:** the no-active-claims settled rule vs claim churn (busy periods where claims are almost always
  live — does the horizon still advance often enough to keep pricing_stale usable?).
- **W4.3:** the canonicalizer's default-mapping vs FUTURE schema versions (is the canonical form pinned as
  version-N-materialized, and who owns updating fixtures when W5 adds fields?); canonicalizer parity between
  client fold and any server-side consumer.
- **W4.4:** the steps-epoch rule (is the cutover id knowable per-list, incl. archived rows? can an archived
  pre-epoch row be mistaken for post-epoch?); replacement-correction valuation when the correction row
  itself is stamped vs unstamped; completion attestations for controls under pagination.

## Verdict
Four verdicts (`W4.x: PASS | PASS-with-notes | BLOCK`), numbered findings per part with concrete scenarios.
Claude ground-truths and folds; parts BOTH auditors PASS freeze.
