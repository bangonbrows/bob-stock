# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 22 (paper review) — Codex + AGY

**You are reviewing W4.4 EXPORT + the two re-revised W4.3 amendments.** R21's four findings (two fully
converged W4.4 blockers + Codex's two amendment objections) folded as **W4-SR-164..167**. One adjudication:
AGY's "replay harmless" on the resolve-valuation route was superseded by Codex's row-existence-laundering
argument (identical unit values, different quantity ⇒ wrong invoice total) — `rowId` is now mandatory.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` (P6: SR-164 composition + SR-165 queue + SR-166 binding + the R21
fold record) · `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 · `AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` **status block
only** (amendment 1 rev-3: FOUR authority fields + basis separate; amendment 2 rev-2: rowId-bound
transport). (Frozen otherwise: W4.1/W4.2/W4.3.)

## What R21 changed
- **SR-164 (converged):** cross-domain operations (pricing dual-write, add-product) use ONE COMPOSITE
  PARENT JOURNAL — the child catalogue publication prepares but cannot commit; the parent's single fenced
  commit is the sole visibility switch for BOTH domains (no split-brain in either crash order).
  Catalogue-only publishes invoke the publisher directly; the correction op is a READER of the archive.
- **SR-165 (converged):** the BAD_VERSION queue is a durable, surfaced, idempotent state machine (row/line
  identity + offending digest; terminal states corrected-and-reattested / covered-by-active-control /
  rejected / withdrawn); ledger control ops AUTO-clear their targets' entries (no ghost blocks);
  re-attestation MINTS a server-owned tuple from the histories active at the minting instant.
- **SR-166 (amendment 2 rev-2):** `rowId` mandatory on resolve-valuation; response bound to immutable
  row/line identity + canonical input digest; install-time compare; control ops invalidate caches.
- **SR-167 (amendment 1 rev-3):** the atomic tuple is the FOUR authority fields `{sellAtSupply,
  discAtSupply, pricingVersion, catalogueVersion}`; `basis` is validated separately (stamped bases ⇒ all
  four required; legacy-lens ⇒ none) — resolving the contradiction with frozen W4.3's durable legacy-lens
  basis. Fixture coverage extended with the basis×authority cross-classes.

## Attack surface (final checks)
- SR-164's composite parent vs the SR-92/140 coordination record: does a composite publication acquire
  correction_active/run exclusion correctly (it writes the archive), or does it need its own state?
- SR-165's auto-clear vs SR-141's reservation: a tombstone that auto-clears a BAD_VERSION entry also
  claims the control-target reservation — confirm the two registries can't deadlock or desync.
- SR-167's basis×authority cross-classes vs the SR-97 valuation precedence (a submit-stamped item whose
  ROW lost its authority fields in transit — malformed row, but the ITEM tier still values it — confirm).
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One W4.4 verdict (`PASS | PASS-with-notes | BLOCK`) + explicit OK/objection on EACH re-revised W4.3
amendment. Claude ground-truths and folds; when BOTH of you PASS all items, the W4 scope review CLOSES.
