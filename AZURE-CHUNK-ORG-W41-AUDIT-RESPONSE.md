# OS-W4.1 BUILD AUDIT — response log

## Round 1 (2026-07-15): Codex BLOCK×6 + AGY BLOCK×1 — ALL 7 REAL, all fixed @ this commit
| # | Finding | Fix | Probe |
|---|---|---|---|
| W41-A-C1 | Codex-1 (P1): fanout `expect` captured only the WRITTEN fields (StoreIds/Active), not the DECISION fields — an admin re-pointing a credential's franchiseeId between replan and apply passed the precondition and granted the store to the wrong franchisee; createAccounts had NO absence precondition | `expect` gains Role/franchiseeId/isStorePOS/isFranchiseOffice (as-read echoes); every createAccounts entry carries `expect.absent: true` | C1a/C1b ×3 |
| W41-A-C2 | Codex-2 (P1, real-module repro): officeStoreId colliding with an EXISTING franchiseeId passed — usernameTaken never included entity ids, though the frozen spec names "franchisee ids" in the cross-namespace suite | `usernameTaken(osid) \|\| franchiseeExists(osid)` ⇒ USERNAME_TAKEN | C2 (Codex's exact repro) |
| W41-A-C3 | Codex-3 (P1, real-module repro): the entity could name the TARGET store as its own office — one physical row aliased into two representations, pricingKeys ['boor','boor'] | provenOffice rejects `officeStoreId === storeId` ⇒ OFFICE_STATE_MISMATCH | C3 (exact repro) |
| W41-A-C4 | Codex-4 (P1, ×2 repros): (a) a 2030-dated open office era/rate was accepted as "current" and cloned into a 2025 era; (b) a ghost-owned office bundle validated clean (ORPHAN_ERA_OWNER not mirrored) | (a) provenOffice requires era.from ≤ now AND openRate.from ≤ now; (b) the office bundle validation applies ORPHAN_ERA_OWNER to an open non-HO owner with no entity | C4a/C4b (exact repros) |
| W41-A-C5 | Codex-5 (P1): an EMPTY office read carried no queried identity — the planner couldn't bind the absence-read to intent.officeStoreId (⚠ required a SCOPED ENVELOPE AMENDMENT to the frozen spec) | `state.office.forId` required; `store.id === forId` (OFFICE_ID_MISMATCH); onboard binds forId === officeStoreId; consulted ops bind forId === entity officeStoreId (leg 0) | C5 ×2 (exact repro) |
| W41-A-C6 | Codex-6 (P2): NO_OFFICE_PRICING unreachable for the missing-default case (both auditors AGREE with the reachability analysis) — the frozen diagnostic contract disagreed with the code | ⚠ SCOPED SPEC AMENDMENT: PRICING_ERA_MISALIGNED is the pinned surfaced reason for a missing office default; NO_OFFICE_PRICING = defense-in-depth (now also guards the future-dated-rate case); sentinel asserts the actual reason | existing SR-47 probe (asserts PRICING_ERA_MISALIGNED) |
| W41-A-A1 | AGY-1 (P1, real-module repro): `nf.franchiseeId === storeId` passed — two minted accounts sharing one identifier (usernameTaken sees only existing state) | four-way pairwise distinctness across the minted ids: fid≠storeId, fid≠officeUsername ⇒ BAD_NEW_FRANCHISEE (osid pairs already BAD_OFFICE_STORE_ID; officeUsername≠storeId already USERNAME_TAKEN) | A1 ×2 (AGY's exact repro) |

**Fixture adjustments forced by the fixes (documented):** OFFICE_A/B/EMPTY_OFFICE gain `forId`; the leg-d
probe split into leg-d/0 (consistent-wrong-office ⇒ OFFICE_STATE_MISMATCH) + an envelope probe
(inconsistent bundle ⇒ OFFICE_ID_MISMATCH); the leg-e probe's foreign owner now EXISTS as an entity (else
the new office-surface ORPHAN fires first); three probes gained forId/entity rows their new guards demand.

**GATES after round 1:** topology **256/256** (244 → 256, 12 new audit probes) · smoke **251/251** ·
static PASS · CSP PASS. Zero client files touched.

## Round 2 (2026-07-15): ✅ CONVERGED — BOTH AUDITORS PASS, BOTH AMENDMENTS APPROVED
AGY PASS ("the W4.1 logic core is rock solid") + Codex PASS ("no findings", detached-commit audit, clean
worktree). Both EXPLICITLY approved scoped amendments 1 (state.office.forId) and 2 (the NO_OFFICE_PRICING
diagnostic re-pin). Verified by both with real-module probes: forId airtightness (no caller-controlled
relabelling path), effectiveness boundaries (from === now succeeds; now+1ms fails; closed-future geometry
cannot bypass), expect completeness (the credential id is the CAS key; aliases feed only intent
uniqueness), all SIX minted-id pairs (each with its pinned diagnostic), and all four gates re-run.
**W4.1 BUILD = CONVERGED @ 8d1a377. The W4.1 spec incl. both amendments is FULLY LOCKED. Next: W4.2.**
