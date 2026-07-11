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

## Convergence round 2 (2026-07-11): AGY PASS; Codex found 4 ADJACENT paths — hardened the primitives
AGY re-audited → **PASS** (all confirmed closed). Codex (82 probes) → BLOCK with 4 more, each an ADJACENT path
the earlier per-spot fixes didn't cover. Rather than patch 4 more spots, the fix CONSOLIDATES the validation
so the whole class is closed. Suite now **72 PASS / 0 FAIL** (+10 probes OS-A-D1..D4).

| # | Codex | Sev | Finding | Fix (consolidated) |
|---|---|---|---|---|
| **D1** | conv2-1 | P1 | `validEras` accepted an EMPTY/malformed owner ('' resolved into a live window + blank export) | `validEras` now requires every owner = `HO` or `reqId`; `transitionEras` also rejects a bad `newOwner` (`BAD_OWNER`) |
| **D2** | conv2-2 | P1 | the existing-store guard excluded ALL `create`; a future-dated CLOSED era read as "current" | planner "current owner" = the OPEN era only (`openEraOwner`); `create` branches reject a pre-existing store (`STORE_EXISTS`); `transitionEras` validates its OUTPUT so an append can't overlap a closed-future era |
| **D3** | conv2-3 | P1 | the malformed-pricing guard was only on `append`; `closePricing`/`resolvePricingRate`/`closeAllPricing` didn't validate | one shared `validIntervals` now fail-closes EVERY pricing path (resolve returns null, close/append error `MALFORMED_PRICING`) — same definition as eras |
| **D4** | conv2-4 | P2 | uniqueness covered only the office username, not the store-POS login (= storeId) | every create-POS op checks `usernameTaken(storeId)` (`STORE_LOGIN_TAKEN`); onboard's office username must also differ from the store's POS login |

Root-cause note: the earlier rounds fixed SPOTS; this round fixed the SHARED PRIMITIVES (`validIntervals` for
both eras+pricing, `validEras` owner check, `openEraOwner` for the planner, `transitionEras` output check), so
the adjacent-path class is closed, not just the 4 instances.

## Convergence round 3 (2026-07-11): AGY PASS (definitive); Codex found 2 deeper invariant gaps — fixed
AGY → **PASS** ("definitively cleared"). Codex → BLOCK with 2 root findings (validators checked one dimension
but not another). Fixed by strengthening the shared primitives again. Suite now **82 PASS / 0 FAIL** (+10
probes OS-A-E1..E2, incl. 2 earlier probes re-pointed to the correct reason codes).

| # | Codex | Sev | Finding | Fix |
|---|---|---|---|---|
| **E1** | conv3-1 | P1 | store-row existence and era-HISTORY existence weren't validated TOGETHER (a storeId whose authoritative history exists could be re-created; `add` could fabricate a store around an orphan era) | planner asserts `(!!st.store) === (eras.length>0)` up front (`STORE_ERA_MISMATCH`) — real store = both, new store = neither |
| **E2** | conv3-2 | P1 | `validIntervals` checked interval GEOMETRY but not the rate PAYLOADS: stored -1/101/NaN/Infinity resolved; a malformed override silently fell back to default; a non-array series became `[]`; a future-ended closed interval left a franchise rate live past buy-back | new `validPricingSeries` = `validIntervals` + every rate `validRate`; wired into resolve/append/close; resolve validates the RAW input; a malformed product override fails closed (no fallback); `closePricing` rejects a future-dated closed interval |

## Status: AGY PASS ×3; Codex closing each successive deep corner — findings now down to shared-primitive
strengthenings (rate payloads, store/era consistency). One more Codex re-check expected.

## Convergence round 4 (2026-07-11): Codex found 1 root P1 (untrusted state envelope) — fixed
Codex → BLOCK with 1 root P1 (9 probes): the planner SILENTLY COERCED a malformed/mismatched server-state
envelope to defaults instead of failing closed — `creds:'not-an-array'` → `[]` → an EMPTY fanout on a convert,
silently skipping the personal-account cancellations (the data-leak fix); and the state bundle's `store.id`
was never checked against the intent's storeId. Fixed: the planner now VALIDATES the envelope
(`BAD_STATE`/`STORE_ID_MISMATCH`) and the exported map helpers reject a non-map. Suite now **90 PASS / 0 FAIL**
(+8 probes OS-A-G1, incl. a happy-path regression proving a valid convert still cancels personal accts + bumps
the POS). Per Kunal's rule ([[feedback_audit_both_clean]]): keep iterating until BOTH auditors PASS.

## Convergence round 6 (2026-07-11): Codex found 2 root P1s (envelope completeness) — fixed
Codex → BLOCK with 2 root P1s: the round-4 envelope guard validated container TYPES but still (a) permitted a
whole collection to be MISSING (coerced to a default → the same empty-fanout data-leak class) and accepted a
malformed credential ROW (e.g. `StoreIds` as a bare string, a row with no id, a primitive entry); and (b)
validated pricing only at the TOUCHED series, so an untouched malformed product override elsewhere in the map
slipped through. Fixed: the planner now requires ALL collections present (`creds`/`franchisees`/`eras`/`pricing`)
and fails closed on any missing one; validates EVERY credential row (`BAD_CREDENTIAL`); validates the WHOLE
pricing map (`MALFORMED_PRICING`); and catches orphan pricing history on a store with no era
(`STORE_ERA_MISMATCH`). Suite now **98 PASS / 0 FAIL** (+8 probes OS-A-H1..H4).

| # | Codex | Sev | Finding | Fix |
|---|---|---|---|---|
| **H (env-1)** | rnd6-1 | P1 | envelope validated container types but permitted a MISSING collection (coerced to default) and a malformed credential row | planner requires all four collections present (`BAD_STATE` on any omission); every cred row validated for `id`/`Role`/`StoreIds`-array (`BAD_CREDENTIAL`) |
| **H (env-2)** | rnd6-2 | P1 | authoritative pricing validated only at the touched series, not as a complete store state | whole `pricing` map validated up front (`MALFORMED_PRICING`); orphan pricing history with no era caught (`STORE_ERA_MISMATCH`) |

Root-cause note: rounds 3-6 progressively tightened the SAME primitive — server-state trust. R3 tied store↔era,
R4 rejected malformed containers, R6 now rejects incomplete containers + malformed rows + whole-map pricing. The
"untrusted envelope" class is now closed at the container, row, and cross-collection levels.

## Next
Codex re-check (round 7) → then OS-W3. AGY has PASSed rounds 2-5; re-confirm AGY on the round-6 state envelope.
Nothing to externals beyond the two auditors engaged.
