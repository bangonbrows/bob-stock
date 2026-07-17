# REVIEW PACK — Org-Structure chunk, W4.2 build — ROUND 4 verification review

> ## ROUND 4 — re-review after the round-3 fix
> Round-3 verdicts: AGY PASS · Codex ×1 (W42-R3-C1: the election-TIEBREAK loser kept its pricing
> freshness — the third member of the R2-C1 stale-follower family). Fixed — and an engineer inventory of
> EVERY leadership-loss/absence path found two more bare siblings, fixed in the same commit: a claim
> ABANDONED to a live leader's mid-claim heartbeat, and `stop()` teardown. Regression test S-275 now
> drives ALL FIVE paths through the real election machinery (heartbeat demotion · leader-exists
> stand-down · tiebreak loss · abandoned claim · stop), with three new mutation-testing cases
> (S-275c/d/e). The scoped mutation command below now lists 22 cases → **22/22 detected** expected.
> Ground-truth ledger: `AZURE-CHUNK-ORG-W42-AUDIT-RESPONSE.md` (Round 3 table). Focus: the freshness
> lifecycle across every way a tab can gain, lose, or fail to gain the sync-leader role — is there ANY
> remaining path where a tab that stops pulling keeps a freshness fact?

> ## ROUND 3 — re-review after the round-2 fixes
> Round-2 verdicts: AGY PASS · Codex ×4 findings (W42-R2-C1..C4) — all confirmed real, all fixed:
> (C1) BOTH leadership-loss branches (newer-leader heartbeat demotion + leader-exists stand-down) now
> invalidate pricing freshness; (C2) echo versions are TYPE-strict — only a numeric non-negative integer
> counts, and version 0 passes only on a genuinely pre-activation device; (C3) writer success now requires
> the echoed publication adopted EXACTLY and DURABLY (`bob_pricing_ver` equal, freshness confirmed) —
> rollback and non-durable echoes reach the honest "server may have committed" path; (C4) the restore core
> is extracted to `_applyRestoreData` with a two-marker snapshot/rollback, provable on the real failed
> write. New regression test **S-275**; **S-272/S-273/S-274 strengthened** with the exact round-2 matrices;
> six mutation-testing updates (parity 266 ↔ 266). Ground-truth ledger: `AZURE-CHUNK-ORG-W42-AUDIT-RESPONSE.md`
> (Round 2 table). Numbers below updated: smoke **266/266**; the scoped mutation set now includes the
> b-variants (command updated below).

**Context.** You are re-reviewing the OS-W4.2 build — the client-side era-aware pricing lens for our own
internal stock-management app (Bang on Brows, Perth; the reviewers and the engineer all work for the
owner). It implements the specification you approved and froze (`AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md`,
locked at R13). This is a routine quality-assurance re-review after a round of fixes: your round-1 report
raised findings, all of them were investigated and resolved, and this round verifies the fixes.

Branch `azure-phase-5-8-server`; review the LATEST commit. Work in your own copy of the repository;
report findings only — the engineer applies any changes.

## What changed since round 1 (all detail in `AZURE-CHUNK-ORG-W42-AUDIT-RESPONSE.md`, Round 1 table)
- Round-1 verdicts: Codex ×6 findings (W42-A-C1..C6) — all confirmed real, all fixed. AGY ×3 — two fixed;
  the UTC-midnight anchoring finding was adjudicated NOT a defect (the frozen SR-25 calendar-day pin
  requires a deterministic shared instant; Codex independently reviewed the same behaviour and retained it
  as the deliberate W4.2/W4.3 seam).
- Fixes shipped: `sync.js` `_applyPricingConfig` (freshness only on an exact version match; the P4
  `bob_pricing_ver` durable marker + persistence retry on the next identical fetch; an older or absent
  served config is treated as confirming nothing), `_notePricingEcho` (version-strict),
  `publishPricingChange` (the echoed publication is required and must be adopted before success), plus an
  `offline` listener; `index.html` `commitGate` (holds while the connection is down),
  `rateAsOf(..., storesOpt)` (the SR-10 lookup honours the caller's topology), honest writer messages when
  the server accepted a change the device could not confirm, and the restore hold marker moved from backup
  VALIDATION to the restore WRITE (`_armRestorePricingHold`, rolled back if the write fails);
  `phase2.js` submit-check predicate widened to the union of "warehouse-typed non-franchise sender" and
  the invoice's structured billing key (`fromStoreId === 'head_office'`).
- New regression tests **S-271..S-274** cover each fix, with four matching mutation-testing cases
  (mutation-coverage parity 265 ↔ 265); the S-262 mutation case was re-anchored for the updated invoice
  line.

## Required checks (run them, don't just read)
- `cd test && node smoke-test.js` → **266/266** expected.
- `node test/topology-proof.js` (repo root) → **256/256** expected.
- Scoped mutation testing:
  `SABOTEUR_ONLY=S-261,S-262,S-263,S-264,S-265,S-266,S-267,S-268,S-269,S-270,S-271,S-272,S-272b,S-273,S-273b,S-274,S-274b,S-275,S-275b,S-275c,S-275d,S-275e
  SABOTEUR_CONCURRENCY=5 node test/saboteur-runner.js` → **22/22 detected** expected. (Scoped only — the
  full mutation sweep is the engineer's local gate.)
- `cd test && node static-check.js` and `node csp-check.js` → PASS.

## Focus for round 2
- Verify each round-1 fix against its finding (the response doc maps finding → fix → test).
- The frozen spec is unchanged — every fix implements an existing pin. If you believe anything still
  deviates from the spec, or a fix introduced a regression you can demonstrate at runtime, report it.
- Edge cases worth a second look: freshness lifecycle across connection changes and tab handoff; the
  version-match rules for echoes and served configs (including the pre-activation version-0 case); writer
  failure messages vs actual server state; restore/import flows and the hold marker's arm/rollback timing.

## Verdict format
PASS / PASS-with-notes / BLOCK, numbered findings with concrete reproductions. The engineer ground-truths
every finding before acting on it.
