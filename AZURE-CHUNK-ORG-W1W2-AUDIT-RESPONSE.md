# Org-Structure W1-W2 — EXTERNAL AUDIT RESPONSE (Codex + AGY, 2026-07-10)

Both auditors BLOCKED the server-foundation checkpoint after RUNNING adversarial probes against the real
`topology.js` engine. **All findings ground-truthed REAL and fixed** (fix-everything). Gate after fixes:
`node test/topology-proof.js` = **55 PASS / 0 FAIL** (43 original + 12 audit-fix probes, one per finding).
The auditors converged on the top data-leak (buy-back not cancelling ex-franchisee staff); Codex added 5 more,
AGY added the direct-transfer path. All were genuine planner bugs — the design (OS-SR-1..12) held; the code
didn't faithfully implement it in these 8 spots.

| # | Auditor | Sev | Finding | Fix |
|---|---|---|---|---|
| **OS-A-F1** | Codex-1 | P1 | CONVERT ignored a NON-POS `staff` login (PERSONAL_ROLES excluded 'staff') → it kept the store | `PERSONAL_ROLES` now includes `staff`; the shared store POS is still protected by the `isStorePOS` branch that runs first, so only a non-POS staff login is cancelled |
| **OS-A-F2** | Codex-2 + AGY-1 | P1 | BUYBACK hardcoded `cancelPersonal:false` → ex-franchisee manager/TM kept the now-HO store and pulled HO's live data | buyback now `cancelPersonal:true` — ownership change severs the prior owner's personal staff (deactivate if zero left) |
| **OS-A-F3** | Codex-3 | P1 | Malformed/missing franchise rate (`'nope'`→NaN, missing→null) accepted into authoritative pricing | `validRate` (finite, 0–100) required on every franchise op; `appendPricingInterval` also rejects `BAD_RATE` defensively |
| **OS-A-F4** | Codex-4 | P1 | Pricing append checked only the OPEN interval's start; with all intervals closed a backdated append overlapped a closed (invoiced) period | append now rejects if `nowMs` < the end of EVERY existing interval (`PRICING_BACKDATE`) |
| **OS-A-F5** | Codex-5 | P1 | Malformed multi-open-era state resolved/exported the wrong owner instead of failing closed | `resolveEra`/`transitionEras`/`planTopologyChange` fail closed on `>1` open era (`MALFORMED_STATE`/`MALFORMED_ERAS`) |
| **OS-A-F6** | Codex-6 | P2 | `safeId(String(undefined))` = the literal `'undefined'` passed validation → omitted ids silently accepted | new `reqId` requires a raw well-formed string; used for storeId / franchiseeId / officeUsername |
| **OS-A-F7** | Codex-7 | P2 | `topologyResolve` route called `resolvePricingRate` (no productId) → per-product overrides unresolved | route now calls `resolvePricingForProduct(pricing, productId, dateMs)`; the resolver tolerates a flat array too |
| **OS-A-F8** | AGY-2 | P2 | `add`/`onboard` didn't check the store wasn't already franchise-owned → a direct fran→fran transfer (violates D-OS-3), triggering the F2 leak + inheriting the prior owner's per-product overrides | `add`/`onboard` reject `DIRECT_TRANSFER_FORBIDDEN` when the store's current owner ≠ HO |

## Notes
- Both auditors praised the ARCHITECTURE (pending/2-phase LA, `[from,to)` resolution, append-only pricing) —
  the BLOCK was purely these 8 planner-logic gaps, now closed + regression-guarded.
- The 12 audit-fix probes are permanent (they'd catch any regression of these exact bugs). They join the
  suite that becomes the org chunk's sentinel set at OS-W6.

## Convergence round (2026-07-11): AGY PASS; Codex found 4 more (deeper probing) — all fixed
AGY re-audited → **PASS** (all 8 confirmed closed, cleared for W3). Codex re-audited with 82 probes → BLOCK
with 4 more, ALL ground-truthed REAL (2 = incomplete corners of the first fixes, 2 = newly-surfaced gaps).
Fixed; suite now **62 PASS / 0 FAIL** (+7 probes OS-A-C1..C4).

| # | Codex | Sev | Finding | Fix |
|---|---|---|---|---|
| **C1** | conv-1 | P1 | F5 incomplete: `eraWindowsFor` had no malformed guard, and an OVERLAPPING closed+open era pair (not just multi-open) still resolved | new `validEras` = parseable + non-overlapping + ≤1 open (last); wired into `resolveEra`/`eraWindowsFor`/`transitionEras`/planner — all fail closed on any malformed history |
| **C2** | conv-2 | P1 | an EXISTING store with no current era was treated as NEW (no prev-owner sever, no takeover snapshot) | planner fails closed `NO_ERA_RECORD` when `st.store` is set but `resolveEra` is null (only `create` may have no store) |
| **C3** | conv-3 | P1 | F4 bypasses: (a) the same-rate no-op ran BEFORE the backdate guard (gap over the change date); (b) a multi-open pricing series was accepted | backdate/overlap guard + `MALFORMED_PRICING` (≤1 open) now run BEFORE the same-rate short-circuit |
| **C4** | conv-4 | P2 | onboarding didn't enforce a UNIQUE office username (duplicate account requested) | planner rejects `USERNAME_TAKEN` when the office username collides with any existing credential or franchisee office |

## Next
Codex one-more convergence re-check (AGY already PASS) → then OS-W3 (client sync-hardening). Nothing to
externals beyond the two auditors engaged.
