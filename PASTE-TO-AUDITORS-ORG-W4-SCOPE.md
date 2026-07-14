# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 18 (paper review) — Codex + AGY

**You are reviewing ONE part: W4.4 EXPORT — the last open seam.** R17's two findings — both fully
CONVERGED between you, both defects in the R16 fold wording — folded as **W4-SR-151/152**. Everything else
you cleared (supersede restore, expected-revision CAS, manifest-riding revision, cross-product lens
selection) is settled. The open surface is exactly these two folds. When W4.4 freezes, the W4 scope review
CLOSES.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` (P2 SR-151 + P6 SR-152 + the R17 fold record) ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §6. (Frozen: W4.1/W4.2/W4.3.)

## What R17 changed
- **SR-151 (your converged catch):** the FINAL check is the PER-TARGET-HEAD comparison —
  `activeManifest.controlHeads[targetId]` must name exactly the supplied `{controlId, revision,
  bornPublicationVersion}`, with born ≤ active; withdrawn targets carry explicit null heads (never mere
  absence); delta-manifests are walked to the per-target latest. The naive global equality (and bare `<=`)
  are both explicitly rejected in the pin.
- **SR-152 (your converged catch):** tier-1 stamp authority BY PROVENANCE — server-minted control rows bind
  via the SR-151 head check; ordinary transfer-linked rows' stamps must be CORROBORATED against the
  validated minting step in the attested `steps` input the engine already holds (binding to the step that
  minted THOSE stamps per the item's basis chain, not today's folded head); uncorroborated stamps FAIL
  CLOSED for FINAL. The client invoice applies the same corroboration from its local fold. Unstamped rows
  keep the unchanged origin assertion; cross-product replacements still never face it.

## Attack surface (final checks)
- SR-152 corroboration completeness: enumerate the basis chain — submit-propagated receive rows, top-up
  rows, remainder returns, cancel returns, resolve-pinned rows, receive-minted (stamp-at-receive) rows —
  does EVERY legitimate stamped row have a validated minting step to corroborate against in `steps`?
  (Backfill-only transfers: the backfill snapshot carries item stamps — is that a valid corroboration
  source?) A legitimate row that CANNOT corroborate would fail closed — is any such row reachable?
- SR-151 head-check vs the withdraw-null head: does the drain terminal-outcome set (SR-94/107) read a
  null head correctly (row PRESENT again, not "covered")?
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One verdict (`W4.4: PASS | PASS-with-notes | BLOCK`), numbered findings with concrete scenarios. Claude
ground-truths and folds; when BOTH of you PASS, W4.4 freezes and the W4 scope review closes.
