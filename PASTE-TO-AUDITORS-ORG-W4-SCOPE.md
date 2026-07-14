# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 16 (paper review) — Codex + AGY

**You are reviewing ONE part: W4.4 EXPORT — the last open seam.** R15's four findings (one converged pair)
folded as **W4-SR-143..146**. You both explicitly cleared the publication-pointer mechanics, three-way
fairness, delta-exactness arithmetic, and (Codex) the crashed-request lifecycle — those are settled. The
open surface is the R15 folds below. When W4.4 freezes, the W4 scope review CLOSES.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` (P2 + the R15 fold record) · `AZURE-CHUNK-ORG-LA-CHANGES.md` §6.
(Frozen, reference only: W4.1/W4.2/W4.3. History: the frozen ledger.)

## What R15 changed
- **SR-143:** reservations gain a LIFECYCLE — `pending(owner, opId, journalId, ttl) →
  committed(controlId, publicationVersion)`; only a PUBLISHED control commits; pre-publication rollback
  releases; orphaned pendings TTL+journal-reconciled (the SR-117 claims pattern). A failed approval can no
  longer permanently lock an uncontrolled target.
- **SR-144 (your converged catch):** ONE *ACTIVE* control per target, not one forever — a
  Director-sudo-gated SUPERSEDE/WITHDRAW runs through the same correction route under the SAME reservation,
  atomically swapping the active pointer; immutable versioned revision history; the export sees exactly the
  published-effective control (chain-ambiguity stays a corruption detector); supersede delta =
  −previousEffective + newEffective; withdraw restores the target's effect. A typo is now a supersede away
  from fixed.
- **SR-145:** cross-identity valuation — target/item stamps mint replacement stamps only when product (and
  store/classification) identity matches; product-changing replacements derive from the replacement
  product's own sources.
- **SR-146:** the stale three-state LA §6 export paragraph replaced (the doc now carries ONE coordination
  contract).

## Attack surface (narrow)
- The supersede chain under crash/interleave: a supersede that reaches publication while its predecessor's
  revision is the one devices adopted mid-crash — does the SR-139 roll-forward rule compose with revision
  swaps? Can two superseding Directors race on one target (the reservation should serialize — verify)?
- Withdraw semantics vs the drain evidence: a grace-committed row whose control is WITHDRAWN — present
  again, covered no longer — does the SR-94/107 terminal-outcome set still close?
- SR-145's "genuinely transfer-linked to that product" — is there any real path where a replacement's new
  product has item stamps at all (the original transfer shipped the OLD product)? If not, is
  original-event-lens-for-that-product the only honest tier, and is THAT pinned clearly enough to build?

## Verdict
One verdict (`W4.4: PASS | PASS-with-notes | BLOCK`), numbered findings with concrete scenarios. Claude
ground-truths and folds; when BOTH of you PASS, W4.4 freezes and the W4 scope review closes.
