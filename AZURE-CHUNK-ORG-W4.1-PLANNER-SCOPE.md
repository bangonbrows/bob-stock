# OS-W4.1 — TOPOLOGY PLANNER EXTENSION (office stores · cloning · guards)

**Authority:** this doc is the CONSOLIDATED, AUTHORITATIVE spec for the W4 planner seam (split from the
frozen fold ledger `AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries:
W4-SR-8, 23, 47, 48, 64(planner side), 71, 72 + R7 folds SR-76..79. Server-LA counterpart:
`AZURE-CHUNK-ORG-LA-CHANGES.md` §1.
**Review status:** R8 FOLDED (AGY PASS — but its concurrent-onboard reasoning was REFUTED by Codex R8-1, so
the pass does not stand on that point; Codex BLOCK×4 → all REAL, folded as SR-98..101). R9 PENDING — needs
BOTH auditors PASS to freeze.

## Why this seam exists
The R4/R5 model keys pricing PER STORE, with the franchisee's negotiated default living on the OFFICE store
and cloned into retail stores. The planner (`azure-functions/src/functions/topology.js`, converged W1-W2,
191-probe suite) currently: takes caller `intent.rate` on every franchise op, appends only the target
store's `'*'`, creates office CREDENTIALS but no office STORE, and receives single-store state. All four
facts must change. This is a REAL extension of a converged engine — it gets its own audit and the 191/191
gate re-runs green before anything else builds on it.

## Pinned design

**P1 — state extension (SR-48).** `planTopologyChange(intent, state, nowMs)` state gains
`state.office = { store, eras, pricing }` for the TARGET franchisee's office (null when N/A — e.g. create-HO,
onboard before the office exists). The LA reads these rows in the same state fetch (LA §1 step 3).

**P2 — ONBOARD creates the office store in-plan (SR-48).** The onboard plan creates: the office STORE row
(`isFranchise` + `isFranchiseOffice`), an OPEN era owned by the new franchiseeId, and the office `'*'`
series opened at `intent.rate` — PLUS the retail store's `'*'` at the same rate (the first clone). The
office account's StoreIds = `[officeStoreId, storeId]`.

**P3 — clone-on-add/convert (SR-47).** ADD, CONVERT, and CREATE-born-franchise DROP `intent.rate` entirely.
The planner clones the office's current OPEN `'*'` interval (rate, from=now) into the new/converted store's
`'*'`. No open office interval ⇒ fail closed `NO_OFFICE_PRICING`. `intent.rate` survives ONLY on ONBOARD.
By construction, a client can never smuggle a rate that disagrees with the office.

**P4 — office-store guards (SR-71/72/77).**
- Any op whose TARGET store row is a franchise office ⇒ `OFFICE_STORE_OP_FORBIDDEN`. Office lifecycle =
  onboard (creation) + MANUAL deactivation, exclusively. Buy-back of a retail store leaves the office era +
  series OPEN.
- ONBOARD: `officeStoreId ≠ storeId` ⇒ else `BAD_OFFICE_STORE_ID`; `officeStoreId` runs the FULL
  cross-namespace uniqueness suite (store rows, credential logins incl. the new POS login = storeId,
  franchisee ids, office usernames).
- **STORE-ROW existence is checked the same way as the target store's (SR-77):** the LA ALWAYS reads the
  store row AT `officeStoreId` (if any) into `state.office.store` — even when the franchisee doesn't exist
  yet (onboard). ONBOARD requires it to be null ⇒ else `OFFICE_STORE_ID_TAKEN`. (The planner never needs a
  store-id universe; per-id reads cover both the retail and office keys — the same pattern as `st.store`.)

**P5 — invariant extensions (SR-48/79/101).** The store-POS-existence check EXEMPTS office stores (no POS is
ever minted for an office). `pricingAlignsWithEras`, `STORE_ERA_MISMATCH`, `ORPHAN_ERA_OWNER`,
`NO_ACTIVE_PRICING` apply to office eras/series exactly as to retail.
**Cross-collection OFFICE IDENTITY — SIX legs (SR-79/101):** the franchisee ENTITY gains `officeStoreId`
(written at onboard); whenever `state.office` is consulted the planner PROVES, fail-closed
(`OFFICE_STATE_MISMATCH`): (a) `state.office.store.isFranchiseOffice === true`; (b) **`isFranchise ===
true`**; (c) **`active === true`** (the invoice selects offices by ALL THREE flags, index.html:4758 — an
office failing any of them cannot produce its invoice); (d) `state.office.store.id ===
franchisee.officeStoreId`; (e) the office store's OPEN era owner === the target franchiseeId; (f) the office
CREDENTIAL's StoreIds contains that officeStoreId. No clone/seed ever reads an unproven office.

**P6 — concurrency fence, planner side (SR-64/78/98/99/100).**
- **RESERVATION = CLAIMS (SR-98):** the CONDITIONAL creation of the `topology_change: pending` journal is
  the FIRST side effect and atomically CLAIMS every identifier the plan will create or depend on —
  storeId, officeStoreId, new usernames, and the SPECIFIC pricing keys it reads/writes (the office map +
  target store map). The creation fails if any ACTIVE pending journal's claims overlap (two concurrent
  onboards of the same officeStoreId cannot both reserve — note the pricing-version check alone does NOT
  catch this, since reservations don't bump the version).
- **SCOPED conflict check (SR-99):** the plan's conflict test compares the CLAIMED pricing keys' state
  (content/sub-version), not the global publication counter — an unrelated `global[productId]` publish
  during the drain never aborts a reserved plan. (The global version remains the publication/adoption
  counter; the §6 pricing route still 409s writes touching a claimed franchisee/store while pending.)
- **ABORT ONLY BEFORE MUTATION (SR-99):** the claimed-keys assertion re-runs at the TOP of the apply phase,
  BEFORE any mutating step (quiesce is a flag, reversible; era/pricing/fanout writes are not). With the
  scoped fence, a post-reservation conflict on claimed keys is impossible by construction — the assertion is
  belt-and-braces. On abort: the journal transitions to durable **`aborted`**, `topology_pending` is
  CLEARED, the provisional snapshot is VOIDED. Once the first mutating step applies, the plan is
  FORWARD-ONLY (reconcile completes it; no abort path exists past that point).
- **WORKER CLAIM (SR-100):** every step application is a CONDITIONAL update requiring `status: pending` AND
  the worker's claim token (ETag) — a reconciler that claimed the journal before an abort (or vice versa)
  fails its next conditional step instead of continuing from a stale read. `aborted` exclusion is enforced
  per-step, not only at scan time.
The planner stays pure; the plan CARRIES the claims + key state so the LA can enforce all of this.

**P7 — export additions (SR-8).** `validPricingSeries` + `isIsoUtc` are ADDED to `module.exports`
(additive; W4.4 imports the real primitives — no re-derivation).

## Interfaces to other seams
- Produces the per-store pricing maps that the config echo serves (shape in LA §6) — offices carry `'*'`;
  the per-product store tier stays WRITER-LESS until W5 (SR-23: in the chain, always uncovered; no W4 code
  pretends otherwise).
- The activation SEED (LA §6, W4.2's adoption consumes it) is a RUNBOOK write, not a planner op — but its
  output must satisfy P5's validators (notably per-era coverage, ledger SR-65).

## R7 fold record (2026-07-14)
| # | Auditor | Ground truth | Fold |
|---|---|---|---|
| **W4-SR-76** | AGY R7-1 (P1) | **NOT REAL.** Claimed `pricingAlignsWithEras` asserts a 1:1 era-to-interval mapping and would brick topology ops after any pricing change. The code (topology.js:311-322) is a sorted-interval CURSOR WALK asserting CONTIGUOUS COVERAGE of each franchise era — multiple `'*'` intervals within one era PASS (and `appendPricingForKey` guarantees contiguity by closing the prior interval at the new `from`) | no spec change. A PERMANENT probe is added (multi-interval era passes alignment; gapped one fails) so this cannot be re-litigated |
| **W4-SR-77** | Codex R7-1 (P1) | REAL — LA §1 supplied no row at officeStoreId when the franchisee is new; a collision with ANY existing store row was invisible to the planner | folded into P4: the LA always reads the row at `officeStoreId` into `state.office.store`; ONBOARD requires null ⇒ `OFFICE_STORE_ID_TAKEN` |
| **W4-SR-78** | Codex R7-2 (P1) | REAL — CAS ordered after the pending journal + possibly other side effects; a stale journal stayed eligible for reconcile | folded into P6: CAS AT RESERVATION (conditional pending-creation is the first side effect), re-check at the pricing write, durable `aborted` terminal state excluded by reconcile |
| **W4-SR-79** | Codex R7-3 (P1) | REAL — no pinned identity proof binding state.office to the franchisee (wrong-office cloning possible) | folded into P5: franchisee entity gains `officeStoreId`; four-way identity proof, fail-closed `OFFICE_STATE_MISMATCH` |

## R8 fold record (2026-07-14) — Codex×4 all REAL (AGY PASS reasoning on R8-1 refuted)
| # | Finding | Fold |
|---|---|---|
| **W4-SR-98** | Codex R8-1 (P1): concurrent ONBOARDs of the same officeStoreId both pass the version CAS (reservations don't bump it) and race to create the same store. REAL — AGY's pass reasoning assumed the reservation bumps; it doesn't | P6: the reservation atomically CLAIMS every created/depended-on identifier; overlapping active claims fail the conditional creation |
| **W4-SR-99** | Codex R8-2 (P1): a GLOBAL version CAS lets an unrelated add-product abort a quiesced plan, with no compensation contract — permanently half-quiesced store. REAL | P6: conflict check scoped to CLAIMED keys (unrelated publishes never abort); abort possible ONLY pre-mutation (assertion at apply-top); abort clears topology_pending + voids the snapshot; after first mutation the plan is FORWARD-ONLY |
| **W4-SR-100** | Codex R8-3 (P1): a reconciler that read `pending` before an abort continues applying from its stale read. REAL | P6: per-step CONDITIONAL updates (status=pending + worker claim token/ETag) — a stale worker fails its next step; exclusion enforced per-step |
| **W4-SR-101** | Codex R8-4 (P1): the four-leg proof admits `isFranchise:false`/`active:false` office rows the invoice cannot select (index.html:4758 filters on all three flags). REAL | P5: the proof grows to SIX legs (+`isFranchise === true`, +`active === true`) |

## Proof plan
- `test/topology-proof.js` grows: office-state fixtures for every op; clone correctness; NO_OFFICE_PRICING;
  OFFICE_STORE_OP_FORBIDDEN × every op; BAD_OFFICE_STORE_ID + OFFICE_STORE_ID_TAKEN + cross-namespace
  collisions; OFFICE_STATE_MISMATCH (each of the SIX identity legs); POS exemption; multi-interval-era
  alignment (SR-76 permanent probe); every EXISTING probe re-run (191/191 must stay green).
- LA-side probes (staging-apply): overlapping-claims reservation rejection (concurrent onboard, same
  officeStoreId); scoped conflict check ignores an unrelated global publish; abort clears pending + voids
  the snapshot; stale-claim worker fails its conditional step; aborted-journal exclusion from reconcile.
- Saboteur mutations per new guard (parity rule).
