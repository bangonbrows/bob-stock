# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 20 (paper review) — Codex + AGY

**You are reviewing W4.4 EXPORT + two scoped W4.3 amendments.** R19's four findings folded as
**W4-SR-156..159** — the architecture round: your converged catch that historical catalogue prices were
UNRESOLVABLE (the exact gap stamps were invented for) is fixed by a NEW server deliverable, the immutable
catalogue publication archive. Codex's per-line amendment objection is ADOPTED over the step-level form AGY
had OK'd — the W4.3 amendment is revised accordingly (five-tuple per stamped line).

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` (P6 tier-1 authority + SR-154/158 backfill block + the R19 fold
record) · `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 · `AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` **status block
only** (the TWO scoped amendments). (Frozen otherwise: W4.1/W4.2/W4.3.)

## What R19 changed
- **SR-156 (your converged catch):** the immutable catalogue publication archive — append-only, keyed by
  version, prices + publication intervals; claimed versions must exist AND be valid for the minting
  instant; unknown/forged/expired ⇒ a distinct fail-closed outcome, never current-price fallback;
  retention ≥ the max offline/grace horizon with a pinned recovery path. (This also closes the original
  W4-5 "price has no history" limitation at the root.)
- **SR-157:** row-level five-tuple columns on every transport surface + the ACCEPTANCE ECHO — the pull's
  known-row merge installs server-owned attestation/version fields on rows the device already holds
  (sync.js:1802 previously skipped them), so the originator's own invoice sees the real marker; local
  markers never render as attested.
- **SR-158:** backfill-only rows value from server-resolved history BOTH halves (discount + archived
  price) as-of date; W4.3 amendment 2: backfill-only item stamps are UNTRUSTED client-side — invoice ==
  settlement for restored transfers.
- **SR-159:** the version tuple is PER-LINE (`{sellAtSupply, discAtSupply, basis, pricingVersion,
  catalogueVersion}`, all-or-none), per your objection; canonical projection updated; same canonical-form
  version (nothing shipped).

## Attack surface (final checks)
- SR-156 retention: what is the pinned max offline/grace horizon, and is the post-expiry recovery path
  concrete enough to build (Director re-attestation? PROVISIONAL-only)? Can the archive itself be
  poisoned (who writes it — is publication the ONLY writer, journaled like every other publication)?
- SR-157's acceptance echo vs the strict-ingest posture: installing server fields on known rows is a
  MERGE into existing local rows — confirm it cannot be abused to overwrite client-authoritative fields
  (scope it to the server-owned column set only).
- SR-159 five-tuple vs frozen W4.3's both-or-neither sentinels and the canonicalizer fixtures — confirm
  the amendment text covers the fold/reconstruct/backfill surfaces consistently.
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One W4.4 verdict (`PASS | PASS-with-notes | BLOCK`) + explicit OK/objection on EACH of the two scoped
W4.3 amendments. Claude ground-truths and folds; when BOTH of you PASS all items, the W4 scope review
CLOSES.
