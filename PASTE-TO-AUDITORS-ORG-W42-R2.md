# REVIEW PACK — Org-Structure chunk, W4.2 build — ROUND 2 verification review

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
- `cd test && node smoke-test.js` → **265/265** expected.
- `node test/topology-proof.js` (repo root) → **256/256** expected.
- Scoped mutation testing:
  `SABOTEUR_ONLY=S-261,S-262,S-263,S-264,S-265,S-266,S-267,S-268,S-269,S-270,S-271,S-272,S-273,S-274
  SABOTEUR_CONCURRENCY=5 node test/saboteur-runner.js` → **14/14 detected** expected. (Scoped only — the
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
