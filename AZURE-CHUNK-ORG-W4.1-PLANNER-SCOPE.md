# OS-W4.1 — TOPOLOGY PLANNER EXTENSION (office stores · cloning · guards)

**Authority:** this doc is the CONSOLIDATED, AUTHORITATIVE spec for the W4 planner seam (split from the
frozen fold ledger `AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries:
W4-SR-8, 23, 47, 48, 64(planner side), 71, 72. Server-LA counterpart: `AZURE-CHUNK-ORG-LA-CHANGES.md` §1.
**Review status:** R7 PENDING (this part reviews + converges separately).

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

**P4 — office-store guards (SR-71/72).**
- Any op whose TARGET store row is a franchise office ⇒ `OFFICE_STORE_OP_FORBIDDEN`. Office lifecycle =
  onboard (creation) + MANUAL deactivation, exclusively. Buy-back of a retail store leaves the office era +
  series OPEN.
- ONBOARD: `officeStoreId ≠ storeId` ⇒ else `BAD_OFFICE_STORE_ID`; `officeStoreId` runs the FULL
  cross-namespace uniqueness suite (store rows, credential logins incl. the new POS login = storeId,
  franchisee ids, office usernames).

**P5 — invariant extensions (SR-48).** The store-POS-existence check EXEMPTS office stores (no POS is ever
minted for an office). `pricingAlignsWithEras`, `STORE_ERA_MISMATCH`, `ORPHAN_ERA_OWNER`,
`NO_ACTIVE_PRICING` apply to office eras/series exactly as to retail. Every existing W2 invariant must hold
on the extended state — the R7 review should hunt for one that breaks.

**P6 — concurrency fence, planner side (SR-64).** The pricing publication version read with the state rides
the plan; the LA's write step CASes it (advanced ⇒ abort + re-plan; the 2-phase journal makes re-runs
idempotent). The planner itself stays pure — the fence is enforced at the LA, but the plan must CARRY the
version so the LA can.

**P7 — export additions (SR-8).** `validPricingSeries` + `isIsoUtc` are ADDED to `module.exports`
(additive; W4.4 imports the real primitives — no re-derivation).

## Interfaces to other seams
- Produces the per-store pricing maps that the config echo serves (shape in LA §6) — offices carry `'*'`;
  the per-product store tier stays WRITER-LESS until W5 (SR-23: in the chain, always uncovered; no W4 code
  pretends otherwise).
- The activation SEED (LA §6, W4.2's adoption consumes it) is a RUNBOOK write, not a planner op — but its
  output must satisfy P5's validators (notably per-era coverage, ledger SR-65).

## Proof plan
- `test/topology-proof.js` grows: office-state fixtures for every op; clone correctness; NO_OFFICE_PRICING;
  OFFICE_STORE_OP_FORBIDDEN × every op; BAD_OFFICE_STORE_ID + cross-namespace collisions; POS exemption;
  every EXISTING probe re-run (191/191 must stay green); alignment on multi-era + office states.
- Saboteur mutations per new guard (parity rule).
