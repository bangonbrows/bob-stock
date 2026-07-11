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

## Round 7 (2026-07-11): AGY PASS; Codex BLOCK — but against a STALE commit (already fixed)
AGY → **PASS** ("cleared for Wave 3"; confirmed the round-4 envelope guard). Codex → BLOCK with 2 P1s — **but
the report header says "Audited detached commit 6c016d2"**, which is the round-4 commit, TWO commits behind HEAD
(`8a49c65` = round-6 fix, `06017df` = pack refresh). Codex's 2 P1s (missing collections default to empty +
malformed credential rows; pricing validated only at the touched series) are the EXACT findings round 6 already
closed. Ground-truthed by replaying Codex's own 7 repros against current HEAD via `planTopologyChange` (the
`topologyPlan` route passes `b.state` through unchanged): **7/7 CLOSED** — creds-omitted→BAD_STATE, StoreIds-
string→BAD_CREDENTIAL, no-id→BAD_CREDENTIAL, primitive-cred→BAD_CREDENTIAL, pricing-omitted→BAD_STATE,
serum-not-a-series→MALFORMED_PRICING, orphan-history→STORE_ERA_MISMATCH. No code change needed; re-sent to Codex
pinned to the correct commit.

## Round 8 (2026-07-11): AGY PASS (definitive); Codex found 2 deeper P1s on the CORRECT tree — fixed
Re-run on the right commit (`8a49c65`). AGY → **PASS** (round-6 envelope confirmed, "cleared for Wave 3"). Codex
confirmed H1–H4 CLOSED, then dug one level deeper and found 2 real P1s the row/envelope validation didn't reach:

| # | Codex | Sev | Finding | Fix |
|---|---|---|---|---|
| **I1** | rnd8-1 | P1 | credential validation covered container/row TYPES but not the FANOUT-DRIVING fields or key invariants: `isStorePOS`/`isFranchiseOffice` are read by TRUTHINESS in `deriveFanout`, so a non-boolean (`'false'` is truthy) flipped a personal staff cred into the store POS (kept the converted store) or minted a bogus office; duplicate cred ids emitted conflicting actions; and nothing asserted the store-POS or target-office creds actually EXIST | row validator now requires `isStorePOS`/`isFranchiseOffice` be strict booleans + `franchiseeId` a well-formed id (`BAD_CREDENTIAL`); duplicate id rejected (`DUPLICATE_CREDENTIAL`); existing store must carry its POS cred (`NO_STORE_POS`); convert/add/create-franchise must find the target owner's office cred (`NO_TARGET_OFFICE`) |
| **I2** | rnd8-2 | P1 | ownership/franchisee-entity/active-pricing were not cross-validated: a live franchise era owned by a `fr_ghost` with no `franchisees` entity could be bought back (exporting for a ghost); and a franchise store with `pricing:{}`, `{'*':[]}`, or only a past-closed default was bought back closing NO active franchise rate | for any open non-HO era the planner now asserts the owner has a stable franchisee entity (`ORPHAN_ERA_OWNER`) AND an OPEN default `'*'` pricing interval exists (`NO_ACTIVE_PRICING`) |

Ground-truthed by replaying Codex's own 10 repros against HEAD: **10/10 CLOSED**. Suite now **109 PASS / 0 FAIL**
(+11 probes OS-A-I1..I2 incl. a well-formed-buyback happy-path regression). Root-cause note: rounds 3–8 have
progressively hardened the SAME axis — trust in the server-supplied state — from era geometry (R3) → rate
payloads (R3) → container types (R4) → completeness + rows (R6) → **fanout-field semantics + cross-collection
consistency (R8)**. The state boundary is now validated at every level: envelope, row, field-semantics, and
cross-collection invariant.

## Round 9 (2026-07-11): AGY PASS (again); Codex found 3 deeper semantic/cross-collection gaps — fixed
AGY → **PASS** (round-8 confirmed). Codex (on the correct tree `a8e617d`) confirmed R8 CLOSED, then found 3
adjacent gaps the type/row checks didn't reach. All ground-truthed REAL (8/8 repros reproduced ok:true, then
8/8 CLOSED after the fix). Suite now **121 PASS / 0 FAIL** (+12 probes OS-A-J1..J3 incl. a legitimate-HO-gap
happy-path regression).

| # | Codex | Sev | Finding | Fix |
|---|---|---|---|---|
| **J1** | rnd9-1 | P1 | fanout flags were type-checked but not ROLE-consistent: a `store_manager` with `isStorePOS` posed as the POS (dodged cancellation), a `staff` with `isFranchiseOffice` posed as an office (gained scope), and a cred with BOTH flags was accepted (POS branch won) | row validator now enforces: `isStorePOS ⟹ Role==='staff'`; `isFranchiseOffice ⟹ Role==='franchisee' && franchiseeId`; the two flags are mutually exclusive (`BAD_CREDENTIAL`) |
| **J2** | rnd9-2 | P1 | buyback didn't require the EX-owner's office credential to exist and hold the store, so the scope-removal was silently skipped and the departed franchisee kept the now-HO store | buyback asserts an office cred for the current owner exists AND contains `storeId` (`NO_EXOFFICE`) — mirror of `NO_TARGET_OFFICE` |
| **J3** | rnd9-3 | P1 | pricing wasn't checked for coverage ALIGNMENT with the eras: a franchise era with pricing starting late (uncovered month), a mid-series gap, or an HO store carrying open franchise pricing all passed → buyback would export a wrong/partial billing window | new `pricingAlignsWithEras`: no pricing interval (default OR override) may overlap an HO era, and every franchise era must be fully+contiguously covered by the `'*'` series (`PRICING_ERA_MISALIGNED`); permits legitimate HO-era gaps |

Root-cause note: rounds 3–9 have hardened the SAME axis (trust in server state) at deepening levels — era
geometry → rate payloads → container types → completeness/rows → fanout-field semantics → **role/flag
consistency + cross-collection billing-coverage invariants**. The engine now rejects a franchise state that is
structurally valid but semantically impossible.

## Round 10 (2026-07-11): Codex BLOCK — 1 root P1 (role enum) + 3 hardening notes — all fixed
Codex (on the correct tree `c807928`) → BLOCK with 1 P1 blocker + 3 weaker notes in its probe artifact. All
ground-truthed REAL and fixed (fix-everything). Suite now **129 PASS / 0 FAIL** (+8 probes OS-A-K).

| # | Codex | Sev | Finding | Fix |
|---|---|---|---|---|
| **K1** | rnd10-P1 | P1 | validation accepted ANY string `Role`, but `deriveFanout` only removes the KNOWN personal roles — so a credential with an unknown/legacy role (`legacy_manager`) holding the store survived BOTH convert and buyback with no fanout action, keeping live scope after ownership change (the same leak class prior rounds hardened) | row validator now requires `Role ∈ KNOWN_ROLES` (`staff`/`store_manager`/`territory_manager`/`franchisee`/`director`/`head_office` — matches the client); any other role fails closed (`BAD_CREDENTIAL`), as accessPolicy already does for unknown roles |
| **K2** | rnd10-n1 | P2 | a topology change silently REACTIVATED a Director-deactivated target office (fanout set it active) | convert/add/create-franchise reject an inactive target office (`INACTIVE_TARGET_OFFICE`); office deactivation stays Director-controlled |
| **K3** | rnd10-n2 | P2 | two office creds for one franchisee were both accepted and both gained the store (double scope) | at most one office credential per franchiseeId (`DUPLICATE_OFFICE`) |
| **K4** | rnd10-n3 | P3 | onboard's `createAccounts` franchisee entry carried no StoreIds → applied literally, the new office is born with no scope for its first store | the minted franchisee account now carries `StoreIds:[storeId]` |

Ground-truthed by replaying Codex's own probe artifact against HEAD: unknown-role→BAD_CREDENTIAL (convert+buyback),
inactive-office→INACTIVE_TARGET_OFFICE, duplicate-office→DUPLICATE_OFFICE, onboard account now scoped. A happy-path
regression proves a valid convert with director/head_office creds present still succeeds (they are correctly NOT
removed on ownership change).

## Round 11 (2026-07-11): AGY PASS; Codex found 3 P2s adjacent to the R10 fixes — fixed
AGY → **PASS** (R10 confirmed). Codex (on `4e85d10`) → BLOCK with 3 P2s, each an adjacent corner the R10 fixes
didn't cover. All ground-truthed REAL and fixed. Suite now **136 PASS / 0 FAIL** (+7 probes OS-A-L).

| # | Codex | Sev | Finding | Fix |
|---|---|---|---|---|
| **L1** | rnd11-1 | P2 | `Active` wasn't row-validated; `isActiveCred` only treats `0`/`false` as inactive, so `Active:'false'` (a truthy string) defeated the R10 inactive-office guard and the office gained scope | row validator now requires `Active` be boolean or `0`/`1` (SharePoint) — a string fails closed (`BAD_CREDENTIAL`); same truthiness class as the R9 `isStorePOS:'false'` bug |
| **L2** | rnd11-2 | P2 | R10 fixed the TARGET office on convert/add, but BUYBACK's ex-office branch emitted `active:true`, REACTIVATING a Director-deactivated ex-office | the ex-office fanout now preserves state (`active: isActiveCred(c)`) — stays active if active (D-OS-4), stays deactivated if deactivated |
| **L3** | rnd11-3 | P2 | `franchisees` was only checked `Array.isArray`; `franchiseeExists` used `some()`, so two entity rows could claim one stable `franchiseeId` (ambiguous server truth, violates OS-SR-8) | every franchisee row must be an object with a valid `franchiseeId` (`BAD_FRANCHISEE`) and the id must be unique (`DUPLICATE_FRANCHISEE`) |

Ground-truthed by replaying Codex's probe artifact against HEAD: string-Active→BAD_CREDENTIAL, inactive-ex-office
kept `active:false`, duplicate-entity→DUPLICATE_FRANCHISEE; happy-path convert with director/head_office rows
still succeeds. Root-cause note: L1/L2 extend the R9 truthiness + R10 activation-preservation work to the last two
spots (the `Active` field type + the buyback ex-office); L3 extends row-validation from `creds` to `franchisees`.

## PROACTIVE SCHEMA SWEEP (2026-07-11, Kunal-approved) — close the whole "untrusted field" class at once
Rather than keep taking Codex's adjacent-corner findings one round at a time (rounds 6–11 were all the same
class: type/validate/uniquify each server-supplied field), a single proactive pass hardened EVERY remaining
field the planner reads. No Codex finding prompted these — they pre-empt the class. Suite now **147 PASS / 0
FAIL** (+11 probes OS-A-M). All ground-truthed against production data shapes (store ids, product ids like
`EXT_1`/`MKU_12`, `head_office` all remain `reqId`-valid — no legitimate state rejected).

| Field / invariant | Before | After |
|---|---|---|
| credential `StoreIds` entries | any string | every entry a WELL-FORMED id (`reqId`) — reject reserved/injected/malformed scope (`BAD_CREDENTIAL`) |
| credential `username`/`Username` aliases | unvalidated (fed uniqueness) | must be strings (`BAD_CREDENTIAL`) |
| franchisee `officeUsername` / `officeStoreId` | unvalidated | well-formed ids if present (`BAD_FRANCHISEE`) |
| franchisee `displayName` | unvalidated | string if present (`BAD_FRANCHISEE`) |
| login namespace | per-collection dupes only | cred ids + franchisee office usernames are ONE namespace — no cross-collision (`DUPLICATE_LOGIN`); within-account aliases (id==own username) still allowed |
| pricing-map KEYS | unvalidated (only values) | `'*'` or a well-formed productId — blocks an injected/reserved key incl. a JSON.parse-created `__proto__` (`MALFORMED_PRICING`) |
| onboard `newFranchisee.displayName` | unvalidated | string (`BAD_NEW_FRANCHISEE`); new franchiseeId also checked against the login namespace (`USERNAME_TAKEN`) |

Note the `__proto__` pricing-key probe is built via `JSON.parse` (an object LITERAL `{'__proto__':…}` sets the
prototype, not a key) — that matches the real ingress (`request.json()`), where `__proto__` becomes a genuine
own key; the guard rejects it before any `{ ...pricing }` spread, so no prototype pollution.

## Next
Codex round-12 re-check on the swept HEAD → then OS-W3. AGY PASS ×7 (rounds 2–10). Per
[[feedback_audit_both_clean]] keep looping until Codex also returns a clean PASS. The sweep should sharply reduce
the remaining adjacent-corner surface.
