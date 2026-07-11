# AUDIT PACK — Org-Structure chunk, WAVES 1–2 (server foundation) — Codex + AGY

**You are auditing the FIRST build checkpoint of the org-structure chunk** — the store/franchise topology
tools (a Director wizard that changes which stores exist and who owns them). This checkpoint = **OS-W1**
(discovery + the topology-change CONTRACT) and **OS-W2** (the server topology ENGINE + its logic proof). The
Director-wizard UI (OS-W5), the client sync-hardening (OS-W3), and the era-aware report lens (OS-W4) are NOT
in this checkpoint — do not fault their absence; review what's here. Branch: `azure-phase-5-8-server`.
Both auditors run **in parallel** (paper + LOCAL logic; the Logic Apps are NOT applied to staging yet).

> **RE-CHECK CONTEXT (round 15, 2026-07-11):** this checkpoint has been through 12 fix rounds. AGY PASSed rounds
> 2–9; Codex has kept finding deeper corners, all ground-truthed REAL and fixed. The full round history + every
> finding→fix is in `AZURE-CHUNK-ORG-W1W2-AUDIT-RESPONSE.md` — **read it first**, then try to break the CURRENT
> code. Round 11 (just fixed) closed 3 P2 corners adjacent to the R10 fixes: `Active` is now type-checked
> (a truthy string `'false'` defeated the inactive-office guard) → `BAD_CREDENTIAL`; BUYBACK now preserves the
> ex-office's active state instead of reactivating a Director-deactivated office; and franchisee ENTITY rows are
> validated + unique (`BAD_FRANCHISEE` / `DUPLICATE_FRANCHISEE`, OS-SR-8). **Then a Kunal-approved PROACTIVE
> SCHEMA SWEEP** (see the response doc's "PROACTIVE SCHEMA SWEEP" section) hardened EVERY remaining server-supplied
> field the planner reads — `StoreIds` entries must be well-formed ids, login-alias/office fields typed, credential
> ids + franchisee office usernames de-duped across ONE login namespace (`DUPLICATE_LOGIN`), pricing-map KEYS
> constrained to `'*'`/productId (blocks a JSON.parse `__proto__` key). The suite is now **153 probes**
> (`node test/topology-proof.js`). Do not re-report anything already listed as fixed in the response doc unless
> you can show it still repros on the current tree (commit `06a4d47`).

## Non-negotiables (framework rules)
- **RUN it, don't just read it.** `azure-functions/src/functions/topology.js` is PURE — it takes the intent +
  server-owned rows (creds, eras, pricing, franchisees) IN THE REQUEST BODY, so you can drive the real
  decision engine directly (same as `accessPolicy.js`). Run `node test/topology-proof.js` (153 probes) AND
  write your OWN adversarial probes against the real module — do not trust the suite.
- **Report ONLY.** Numbered findings (P0/P1/P2/P3 + concrete repro). Claude is sole engineer and ground-truths
  every finding.
- **Isolate your worktree.** Your own copy, never a shared tree.
- **Ground-truth the design claims.** The converged spec is `AZURE-CHUNK-ORG-STRUCTURE.md` (D-OS-1..8 +
  OS-SR-1..12, which passed a 4-round Codex+AGY spec review). Verify the CONTRACT + CODE faithfully implement
  it — treat the spec as the requirement, the code as the thing to falsify.

## Read these (the map)
| Doc / file | What it is |
|---|---|
| `AZURE-CHUNK-ORG-STRUCTURE.md` | The CONVERGED design: D-OS-1..8 (Kunal's decisions) + OS-SR-1..12 (spec-review folds) |
| `AZURE-CHUNK-ORG-ENFORCEMENT-MATRIX.md` | OS-W1 CONTRACT: each topology op → server truth; discovery findings D-OS-F1..F7 |
| `AZURE-CHUNK-ORG-LA-CHANGES.md` | OS-W2 staging Logic App orchestration spec (pending/2-phase/reconcile) — NOT applied yet |
| `azure-functions/src/functions/topology.js` | OS-W2 CODE: the pure topology engine (`planTopologyChange` + era/pricing/fanout helpers) |
| `test/topology-proof.js` | OS-W2 logic proof — **153 probes, all pass on clean code** (43 original + 55 audit-fix regressions) |
| `AZURE-CHUNK-ORG-W1W2-AUDIT-RESPONSE.md` | The full round 1–12 finding + proactive sweep→fix history — read before re-reporting |

## What the engine does (so you calibrate)
`planTopologyChange(intent, state, nowMs)` takes ONE Director intent (create / onboard-new-franchisee /
add-store-to-existing / convert HO→franchise / buyback→HO) and DERIVES the whole change set from server-owned
rows (OS-SR-2 — never a client fanout): the ownership-ERA close/open, the append-only PRICING history change
(per-store default `'*'` AND per-PRODUCT overrides — Kunal 2026-07-10), the CREDENTIAL fanout, the opening
snapshot request, and the buy-back export window. The gated `topology-change` LA (spec in LA-CHANGES) journals
this plan `pending`, applies it idempotently, marks `complete`, and a reconcile sweep resumes a crash.

## Attack these (don't limit yourself)
1. **Era resolution (`resolveEra`/`eraWindowsFor`, OS-SR-6):** are `[from,to)` boundaries exact (to exclusive)?
   Does a store that changed hands 2+ times never let a later owner resolve into an earlier owner's era? Do
   device-bound roles (store POS / store_manager) really see the CURRENT era only, and franchisee/HO only
   their own? Any date that resolves to the WRONG owner or leaks across a boundary is a finding.
2. **Pricing (`resolvePricingRate`/`resolvePricingForProduct`/`appendPricingForKey`/`closeAllPricing`,
   OS-SR-3/11/12):** is a per-product rate read as-of the row's date (not the live scalar)? Is the history
   APPEND-ONLY — can any path mutate a closed interval and retroactively rewrite a past invoice? Product
   override vs store-default `'*'` fallback correct? Backdating rejected? A rate change that rewrites history
   is a P1.
3. **Credential fanout (`deriveFanout`, OS-SR-2 + D-OS-2):** is it derived ONLY from server rows? On CONVERT:
   store POS stays (bump only), new office gains the store, and personal store_manager/territory_manager lose
   it — a single-store manager DEACTIVATES, a multi-store TM keeps its other stores. On BUYBACK: ex-office
   loses the store but STAYS ACTIVE (D-OS-4). Any account wrongly kept-in-scope, wrongly cancelled, or missed
   from the fanout is a finding. Try to make the fanout omit or over-include an account.
4. **Buy-back export (OS-SR-4):** bound to the ex-franchisee's CLOSED era `[from,to)` (both bounds)? Could HO's
   post-buyback rows leak into it?
5. **Atomicity / recovery (OS-SR-1, the LA SPEC):** does the plan output actually enable an IDEMPOTENT,
   RESUMABLE apply? Is there any operation ordering that could leave split state if the LA crashes mid-apply?
   Does the spec's quiesce + `stale_era` quarantine + reads-fail-closed-while-pending actually prevent the
   ghost-stock race (OS-SR-5/7) and the backdating path (OS-SR-10)? Flag spec gaps.
6. **Guards / injection:** reserved/bad store ids, unknown ops, `__proto__` keys, non-finite dates, malformed
   state — all fail closed?
7. **Contract vs spec faithfulness:** does `AZURE-CHUNK-ORG-ENFORCEMENT-MATRIX.md` + the LA spec correctly and
   completely implement OS-SR-1..12? Anything a wave downstream (W3/W4/W5) will need that the contract omits?

## Verdict
PASS / PASS-with-notes / BLOCK, numbered findings each with a concrete repro (an intent+state that produces
the wrong plan, or a spec gap with the scenario it breaks).
