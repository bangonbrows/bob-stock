# OS-W4.2 BUILD (the era-aware pricing lens) — wave record + audit response log

## BUILD SHIPPED 2026-07-15 (per the LOCKED `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md`)
- **index.html:** the `Pricing` module (mirrored validators · SR-42 exact-schema `validConfig` · the
  three-tier `rateAsOf` chain w/ whole-config-validation-first, SR-74 stale horizon, SR-10
  uncovered-franchise fail-close, honest NOT-SET · the P5 `commitGate`); invoice/CSV/report rewire
  (per-line own-date resolution post-activation; byte-identical legacy path pre-activation); writers routed
  through the server post-activation; backup scrub + restore-unresolved marker.
- **sync.js:** `_applyPricingConfig` (SR-29 activation-on-observation · monotonic · SR-31
  stale-on-unadoptable · absent-item = the server's pre-activation statement, resolves a restore);
  `_notePricingEcho` (SETTLED-only, server-instant, forward-only, version-matched horizon advance; config +
  pull hooks); the SR-82 leading-master_data scalar hold; event-scoped `_pricingFresh`
  (visibility/online/leader-handoff invalidation); `publishPricingChange` (CAS + opId + echo adoption).
- **phase2.js:** `_pricingSubmitGate` — the P3/P5 HO→franchise pricing-commitment gate in BOTH submit
  paths, pre-mutation.
- **Sentinels S-261..S-270** (= S-W4-1/2/3/4/6/9/11/16/17/18), incl. the S-261 parity sentinel binding the
  REAL `topology.js` primitives (the S-247 mechanism). **Saboteur mutations S-261..S-270** (parity rule:
  one per sentinel; the runner's structural check enforces 261 ↔ 261).

## GATES (clean code)
smoke **261/261** · topology **256/256** · static PASS · CSP PASS · dupes grep clean ·
scoped saboteur (the 10 new mutations): **10/10 CAUGHT** (after two gate-driven fixes: S-269 STRENGTHENED — the first mutation was BLIND because no assertion exercised activated-without-config, the sentinel now asserts that fail-close directly; and the S-266 INFRA root-caused to a comment-splice from the build patch anchor, repaired @ dd64f9c) · **FULL SWEEP: 280/280 accounted — 279 CAUGHT + S-150b re-anchored (its target line moved into the legacy-fallback branch) and verified CAUGHT via a deterministic mutated-copy run — 0 BLIND, 0 unexplained skips.**

## Engineer's flagged notes (also in the PASTE pack)
UTC-midnight as-of anchoring for invoice dates (pinned calendar-day granularity) · no office-default
editor exists in today's UI (route support ships now; UI = W5) · the freshness half of the submit gate is
ACTIVE from the W4 build per SR-49 (deliberate cutover behaviour change: dormant HO devices hold
HO→franchise submits) · `_applyPricingConfig` persist-failure = log + in-memory session copy (no AA-05
pending flag — judged acceptable because the durable copy stays at the PRIOR version and re-adopts next
fetch; auditors to judge) · S-262 proves the discount half of S-W4-2 (dollars land with the W4.3 stamps).
