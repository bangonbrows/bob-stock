# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 6 (paper review) — Codex + AGY

**You are reviewing the OS-W4 SPEC, round 6.** Your R5 verdicts (AGY BLOCK×3 + Codex BLOCK×16) were all
ground-truthed REAL and are now FOLDED as **W4-SR-45..62** plus **MODEL REVISION 2**. This round: verify the
R5 folds actually close your findings, and attack the new design surface they created. Paper review — no
harness run needed. Both auditors in parallel. Branch `azure-phase-5-8-server`.

## Read these, in order
1. `AZURE-CHUNK-ORG-W4-SCOPE.md` — the whole doc; the R5 material is the **MODEL REVISION 2** block + the
   **R5 fold table (W4-SR-45..62)** directly under the R4 table. R1-R4 folds (SR-1..44) are unchanged.
2. `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 — the amended server contracts (fan-out, CAS/opId digest,
   pricingVersion binding, archive_run binding, drained-ingest watermark, validateMoney, text labels).
   Also §1 step 3 (`state.office` added to the planner state read).
3. For ground truth if needed: `azure-functions/src/functions/topology.js` (the planner your SR-47/48 folds
   extend), `azure-functions/src/functions/validateMoney.js` (the shared money policy SR-62 adopts).

## What changed in the fold (headline)
- **Write FAN-OUT (SR-45):** office-default edits append server-side to office + all active franchise-era
  retail stores of that franchisee, one version bump, all-or-nothing journal.
- **Seed coverage + frozen-legacy baseline (SR-46/50):** seed covers office '*' + every retail '*' +
  global[productId]; all BACKDATED to era starts at the activation-time scalar value — pinned as "freezing
  today's behaviour", with pre-activation scalar edits explicitly accepted as unrecoverable.
- **Planner cloning + office stores (SR-47/48):** ADD/CONVERT/CREATE-franchise DROP intent.rate (planner
  clones the office's open '*' interval; fail closed without one); ONBOARD creates the office STORE row +
  era + series in-plan. This is a real W2 planner extension (state.office, POS-exemption for office stores,
  invariants extended) — it gets its OWN build sub-wave + re-audit against the grown topology-proof suite.
- **Migration DELETED (SR-59/60):** replaced by STAMP-AT-RECEIVE for any stampless submit (legacy +
  stale-PWA class): discAtSupply = lens as-of SUBMIT date, sellAtSupply = current price at receive, stamps
  published via the receive step (immutable steps, no replay).
- **Dormant-device gate (SR-49):** pricing-sensitive commits need a fresh server pricing-state observation;
  local absence alone never selects the scalar path (hold otherwise).
- **pricing_stale per-resolution (SR-51), pricingVersion rides master_data (SR-52), add-product CAS +
  digest-bound opId before CAS (SR-53/54), cross-list tombstones + same-ID conflict fail-closed (SR-55),
  archive_run-bound double query (SR-56), FINAL needs drained-ingest watermark (SR-57), StockFrom/StockTo
  text labels carried + shared classifier (SR-58), engine signature re-pinned {storeMap, globalMap} (SR-61),
  validateMoney everywhere (SR-62).**

## Attack these
1. **The fan-out (SR-45):** race a fan-out against a concurrent topology change (add/buyback mid-fan-out) —
   can a store join or leave the franchisee between target-set derivation and publish? Is the CAS version the
   right lock? What does a reconcile resume do to a half-fanned set?
2. **The frozen baseline (SR-50):** find a date/row combination where backdating to era start still yields
   NOT SET or a wrong rate (era gaps, HO interludes, stores whose franchise era predates the office era,
   products added mid-era).
3. **Clone semantics (SR-47):** clone copies the CURRENT open interval only — is any scenario billed from the
   office's HISTORY before the store existed (it shouldn't be — the store's rows can't predate it; prove or
   break that).
4. **The planner extension (SR-48):** does state.office break any existing W2 invariant (alignment,
   STORE_ERA_MISMATCH, storePOS existence, username collisions with officeStoreId)? Is the office-store
   POS exemption sound everywhere the POS invariant is consulted?
5. **Stamp-at-receive (SR-59):** cross-device folds — device C folds A's stampless submit + B's stamped
   receive; conflict re-resolution / discrepancy top-ups on a legacy transfer; a receive under pricing_stale
   or PRICING DATA ERROR (both-or-neither must hold).
6. **The stale horizon (SR-51):** construct a resolution that is unsafe but passes the closed-interval rule
   (or vice versa — a safe one it needlessly blocks that matters operationally).
7. **Union semantics (SR-55/56/57):** tombstone in one list targeting the other; archive_run bumping between
   retries forever (liveness); a FINAL emitted where a grace-admitted row still lands after the watermark.
8. **Anything R1-R4 the revision re-breaks** — that's how R5 caught the R4 revision.

## Verdict
PASS / PASS-with-notes / BLOCK, numbered findings with concrete scenarios (state + sequence → wrong money,
wrong coverage, or a spec contradiction). Report only — Claude ground-truths and folds.
