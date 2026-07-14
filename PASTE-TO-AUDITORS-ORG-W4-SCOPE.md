# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 15 (paper review) — Codex + AGY

**You are reviewing ONE part: W4.4 EXPORT — the last open seam.** ✅ W4.1 PLANNER, W4.2 LENS, and W4.3
STAMPS are all FROZEN (both of you passed each; specs locked, out of scope). R14's four findings (two
converged pairs) folded as **W4-SR-139..142**. When W4.4 freezes, the W4 scope review CLOSES and the build
begins against locked specs.

Both auditors in parallel; paper review; report-only. The open surface is exactly the R14 folds below plus
anything they newly touch. If it's done, PASS it.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` · `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction-approval route +
export route). (Frozen, reference only: W4.1/W4.2/W4.3 docs. History: the frozen ledger.)

## What R14 changed (all in W4.4)
- **SR-139 (converged):** publication = the IRREVOCABLE commit point. The correction journal persists its
  candidate version; reconcile reads the ACTIVE publication pointer FIRST — a match means the publish
  landed pre-crash and recovery MUST roll forward (terminal-complete + release), never roll back; only
  pre-publish journals may roll back. No recovery path can delete rows a published version references.
- **SR-140 (converged, the finding you re-flagged):** the coordination machine is now the full FOUR states
  (`idle | run_active | export_lease | correction_active`) with THREE request flags
  (`run_requested`/`export_requested`/`correction_requested`, each `{owner, storeTimestamp, ttl}`); every
  acquirer honors ALL live competing requests — three-way bounded scheduling, no starvable actor; P4 and
  LA §6 now agree.
- **SR-141:** control-target uniqueness is a DURABLE RESERVATION (unique index/registry spanning both
  lists) claimed by EVERY control writer — including the ordinary push ingest's tombstone path, which
  `correction_active` cannot exclude; a device tombstone racing an approval is quarantined for Director
  review, never minted as a second control. Reservations are terminal.
- **SR-142:** the verify invariant is DELTA EXACTNESS per `(storeId, productId)`:
  `newSnapshot = oldSnapshot − effect(target) + effect(replacement)`, unaffected pairs bit-unchanged,
  published snapshot + live rows == the corrected fold. "Neutrality" is explicitly retired for corrections.

## Attack surface
- The publication-pointer read in recovery: can the pointer and the journal disagree in a way that makes
  BOTH branches (forward/back) wrong? Multiple corrections' candidates interleaving with one pointer?
- The reservation vs quarantine flow: a quarantined device tombstone whose target's replacement is LATER
  itself the subject of a legitimate deletion — does the reservation model allow the Director any path, or
  is one control per target forever too strict for real operations?
- The three-way fairness under a crashed `correction_requested` holder mid-queue.
- Delta exactness for a replacement that changes the PRODUCT (target productId ≠ replacement productId) —
  two affected pairs; does the invariant as written cover it?

## Verdict
One verdict (`W4.4: PASS | PASS-with-notes | BLOCK`), numbered findings with concrete scenarios. Claude
ground-truths and folds; when BOTH of you PASS, W4.4 freezes and the scope review closes.
