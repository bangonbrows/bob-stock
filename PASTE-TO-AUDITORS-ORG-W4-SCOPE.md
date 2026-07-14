# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 21 (paper review) — Codex + AGY

**You are reviewing W4.4 EXPORT + the two REVISED W4.3 amendments.** R20's four findings folded as
**W4-SR-160..163** — the R19 archive is now buildable. Key design decision this round: retention is
**INDEFINITE** (the archive is never pruned — publications are tiny and rare while settlements legitimately
reach years back, so pruning semantics can never be correct), which ELIMINATES the expiry state machine
entirely; the only failure class is unknown/forged version (BAD_VERSION → Director re-attestation queue →
PROVISIONAL). AGY approved both amendments pre-revision; Codex's objections drove the revisions — both need
re-OK on the revised text.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` (P6 SR-156/160/161 archive block + SR-158/163 backfill block + the
R20 fold record) · `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 · `AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` **status
block only** (the two REVISED amendments). (Frozen otherwise: W4.1/W4.2/W4.3.)

## What R20 changed
- **SR-160:** ONE server-only journaled catalogue PUBLISHER (candidate = snapshot + archive record +
  interval → verify → pointer-switch LAST → terminal; roll-forward iff switched; archive
  non-client-writable under version CAS; ALL catalogue writers — Chunk-6 publish, pricing-route scalar
  dual-writes — route through it). Neither crash order can strand honest devices or legitimize a
  never-active version.
- **SR-161:** INDEFINITE retention — no pruning, no expiry states; unknown/forged version = the single
  failure class, with the pinned BAD_VERSION → re-attestation-queue → PROVISIONAL path.
- **SR-162 (amendment 1 revised):** five-field fixture coverage — all-present / all-absent-legacy / every
  partial-tuple class (incl. stripped-catalogueVersion-only) / version-only differences preserved as
  meaningful canonical differences / across submit, receive, resolve, row, backfill/fold, archive,
  reconstruction — each with its saboteur.
- **SR-163 (amendment 2 revised):** the RESOLVE-VALUATION transport — gated route returning digest-bound
  `{resolvedSell, resolvedDisc, pricingVersion, catalogueVersion}`; cached as durable server-owned mapped
  fields (the SR-157 allowlist pattern); invoice renders only those or a surfaced "valuation pending sync"
  state — never local live pricing, never untrusted stamps.

## Attack surface (final checks)
- SR-160's "ALL catalogue writers route through the publisher": enumerate them — Chunk-6 Publish,
  the pricing route's scalar dual-write, add-product, the correction-approval op — does each compose with
  its OWN journal (a pricing publication triggering a catalogue publication: one nested transaction or two
  fenced ones)?
- SR-161's PROVISIONAL-until-cleared: can a BAD_VERSION queue entry be cleared by anything other than
  Director re-attestation (e.g., withdraw/tombstone of the offending row)? Is the queue itself durable +
  surfaced?
- SR-163's digest binding: replay/substitution of a resolve-valuation response across rows with identical
  (productId, storeId, asOfInstant)?
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One W4.4 verdict (`PASS | PASS-with-notes | BLOCK`) + explicit OK/objection on EACH revised W4.3
amendment. Claude ground-truths and folds; when BOTH of you PASS all items, the W4 scope review CLOSES.
