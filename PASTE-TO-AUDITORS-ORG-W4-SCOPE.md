# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 19 (paper review) — Codex + AGY

**You are reviewing W4.4 EXPORT + one scoped W4.3 amendment.** R18's findings folded as **W4-SR-153..155**.
Codex R18-1 was the deepest catch of this review: the R17 corroboration rule was CIRCULAR (attacker authors
both sides of the proof) — the fix moves stamp authority to SERVER SEMANTIC ATTESTATION at ingest. One
ground-truth correction: AGY's "legacy rows carried legitimate item stamps" is impossible — the stamp
fields have NO pre-W4 writer (they exist only in spec docs today), so a stamped pre-epoch row is anomalous
by construction and fail-closed is correct; the backfill half of that finding was real and folded.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` (P6 tier-1 authority rewrite + the R18 fold record) ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §6 · `AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` **status block only** (the
flagged post-freeze amendment — scoped re-review: payload version fields joining both-or-neither; nothing
else in W4.3 changed). (Frozen otherwise: W4.1/W4.2/W4.3.)

## What R18 changed
- **SR-153:** stamp-bearing steps carry `{pricingVersion, catalogueVersion}`; the steps-ingest validator
  (the existing D4-K validateMoney pattern extended) RECOMPUTES expected stamps from server-owned pricing
  history + versioned master_data as-of the event instant, REJECTS mismatches (`BAD_STAMPS`), and sets a
  server-only attestation marker. Tier-1 = attested evidence only; client-vs-client equality is dead.
- **SR-154:** backfill snapshots are never tier-1 provenance — backfill-only rows value via the LENS as-of
  the row's date (correct-by-construction for restored historical rows); an optional Director-triggered
  server re-attestation route can restore stamp preference; FINAL is not blocked either way.
- **SR-155:** stamped TRANSFERLESS rows (direct HO-supply — real billable lines with no step) get the same
  semantic validation at push-v2 ROW ingest with a server-set attestation column; engine + invoice require
  it for their tier-1.

## Attack surface (final checks)
- SR-153's recompute inputs: is `catalogueVersion` → historical sell price genuinely resolvable
  server-side (versioned master_data items), including for offline devices pushing days late? What happens
  to a step whose carried versions the server no longer holds / never held (forged version id)?
- The attestation marker's trust chain: pull/echo must deliver it to CLIENT invoices unforgeably — pinned
  enough? Can a device fabricate the marker locally for its own invoice rendering (display-only risk vs
  settlement risk)?
- SR-154's lens valuation for backfill-only rows vs the invoice: do settlement and invoice agree on those
  rows by construction (both lens-as-of-date)? Confirm no split.
- The W4.3 amendment (scoped): version fields joining both-or-neither — any interaction with the frozen
  canonicalizer/strict-projection rules (SR-121/128)?
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One verdict for W4.4 (`PASS | PASS-with-notes | BLOCK`) + an explicit OK/objection on the scoped W4.3
amendment. Claude ground-truths and folds; when BOTH of you PASS both items, the W4 scope review CLOSES.
