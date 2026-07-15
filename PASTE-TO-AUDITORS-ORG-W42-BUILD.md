# AUDIT PACK — Org-Structure chunk, W4.2 BUILD (the pricing lens) — Codex + AGY

**You are auditing the OS-W4.2 BUILD** — the client-side era-aware pricing lens, implementing the spec YOU
froze (`AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md`, locked at R13). This is the wave that kills the
retroactive-invoice bug (GAP-1). Branch `azure-phase-5-8-server`; audit the LATEST commit. Both auditors in
parallel; isolate your own worktree; report-only. **RUN it, don't just read it.**

## Non-negotiables (framework rules)
- `cd test && node smoke-test.js` → **261/261** (10 new sentinels S-261..S-270 = S-W4-1/2/3/4/6/9/11/16/
  17/18). `node topology-proof.js` (from the repo root: `node test/topology-proof.js`) → **256/256**.
- Scoped saboteur: `SABOTEUR_ONLY=S-261,S-262,S-263,S-264,S-265,S-266,S-267,S-268,S-269,S-270
  SABOTEUR_CONCURRENCY=5 node test/saboteur-runner.js` — 10/10 CAUGHT expected. (Scoped ONLY — the full
  sweep is Claude's local gate.)
- Report ONLY; numbered findings (P0-P3 + concrete repro). Claude ground-truths every finding.
- The frozen spec is the requirement; anything needing a SPEC change reopens W4.2's review — say so.

## What was built
| Piece | Where | Spec pin |
|---|---|---|
| `Pricing` module: mirrored validators, SR-42 exact-schema `validConfig`, the three-tier `rateAsOf` chain (whole-config validation FIRST; stale horizon; SR-10 uncovered-franchise fail-close; honest NOT-SET), `commitGate` | index.html (before `const Stock`) | P1-P5 |
| Invoice + CSV + report rewire (per-line own-date resolution; lens-sourced %/source columns post-activation; byte-identical legacy path pre-activation) | index.html `_franchiseInvoiceData` / `_exportFICSV` / `franchiseInvoice` | P6/SR-1/2 |
| Writers: `_setProductFranDisc` + `_doAddProduct` route through `Sync.publishPricingChange` post-activation (CAS expectedVersion + opId; server-echo adoption; fail-closed w/o endpoint) | index.html + sync.js | P8/SR-6/16/33 |
| Adoption: `_applyPricingConfig` (activation-on-observation SR-29; monotonic; stale-on-unadoptable SR-31; absent-item = the server's pre-activation statement), `_notePricingEcho` (SETTLED-only horizon advance, server instant, forward-only, version-match), config-hook ORDERED BEFORE master_data | sync.js | P4/SR-80/81/102/112 |
| SR-82 coherence: master_data `pricingVersion` leading the adopted config ⇒ franchise-discount scalars HELD | sync.js `_applyMasterData` | P6/SR-52/82 |
| Freshness: event-scoped `_pricingFresh` (invalidated on visibility-resume / online / `_becomeLeader`; set only by processed pricing observations) | sync.js | P5/SR-81/103 |
| The HO→franchise submit gate (`_pricingSubmitGate` in BOTH `create` non-draft and `submitDraft`, pre-mutation) | phase2.js | P3/P5/SR-21/49 |
| Backup: `pricingConfig` scrubbed from export; RESTORE sets `bob_pricing_unresolved` (held until the next config fetch resolves) | index.html | P5b/SR-104 |

## Engineer's honest notes (attack these first)
1. **The invoice's as-of instant = `Date.parse(t.date + 'T00:00:00.000Z')`** (the line's Perth calendar day
   at UTC midnight) — deterministic + pinned (invoice = calendar-day granularity, SR-25), but judge whether
   the UTC-midnight anchoring interacts badly with any boundary case you can construct.
2. **No office-default EDITOR exists in today's UI** (ground truth: the store editor edits name/type only;
   office scalars are seed data). The route supports the office-default kind; its UI lands with W5. The
   writer inventory in the old ledger implied otherwise — verify nothing else writes store scalars.
3. **The submit gate ships ACTIVE pre-activation for the freshness half** (SR-49 pinned it on the W4
   build): an offline/dormant HO device now HOLDS HO→franchise submits until a fresh server observation.
   That is a REAL behaviour change at cutover (deliberate, spec-pinned). Confirm the predicate (from
   non-franchise warehouse → franchise store) catches exactly the billing events and nothing else.
4. **`_applyPricingConfig` persist-failure** logs and keeps the in-memory copy for the session (no pending
   flag) — judge whether a durable-commit failure needs the AA-05-style pending flag instead.
5. **The dollar half of S-W4-2 (price freezing) lands with W4.3 stamps** — S-262 proves the DISCOUNT half
   only, per the W4.2/W4.3 seam.

## Attack surface
- The chain vs the frozen spec: tier order, hasOwnProperty discipline (a `__proto__`-keyed config), the
  franchise-store lookup for SR-10 (DB.get().stores vs the passed fixture d — mixed sources).
- Adoption lifecycle: observation-before-validation ordering; monotonicity vs a served rollback; the
  stale flag's set/clear sites; unresolved resolution on item-absent vs fetch-failure (a FAILED fetch must
  NOT resolve).
- The echo: version-mismatch handling (pv > adopted triggers re-fetch, no advance; pv < adopted?);
  forward-only conf_at; the pull-page hook placement.
- The gate: every entry path to an HO→franchise commit (create non-draft, submitDraft — anything else?);
  gate-vs-avail ordering; the direct-logging path is W4.3's (flagged) — agree or contest.
- Sentinel/saboteur quality: does each mutation flip ONLY via real behaviour (no tautologies)?

## Gates already green (verify, don't trust)
smoke **261/261** · topology **256/256** · scoped saboteur 10/10 CAUGHT (result in the wave doc) · static
PASS · CSP PASS · dupes grep clean. The FULL sweep runs as Claude's local gate before convergence.

## Verdict
PASS / PASS-with-notes / BLOCK, numbered findings with concrete repros.
