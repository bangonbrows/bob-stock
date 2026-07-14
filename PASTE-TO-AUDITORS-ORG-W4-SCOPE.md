# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 17 (paper review) — Codex + AGY

**You are reviewing ONE part: W4.4 EXPORT — the last open seam.** R16's four findings (all
supersede-composition edges) folded as **W4-SR-147..150**. Cleared and settled from R16: withdraw/drain
composition (AGY's append-only PRESENT analysis), cross-product valuation selection, pending-reservation
recovery. When W4.4 freezes, the W4 scope review CLOSES.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` (P2 supersede pins + P6 origin narrowing + the R16 fold record) ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (route contract split). (Frozen: W4.1/W4.2/W4.3.)

## What R16 changed
- **SR-147 (AGY):** a supersede claims via `pending_supersede(priorCommitted)` — its rollback RESTORES the
  prior committed lock (never voids a published predecessor's protection). Only initial-create rollback
  releases to empty.
- **SR-148 (Codex):** there is NO separate active-control pointer — the effective revision RIDES the
  publication manifest; the SR-139 publication pointer is the sole visibility switch (snapshot and served
  control cannot desync across any crash split); the export verifies the effective control's
  publicationVersion equals the active version before FINAL.
- **SR-149 (Codex):** expected-revision CAS on every supersede/withdraw (observed {controlId, revision,
  publicationVersion}; re-read + reject on mismatch after acquiring the state) — a stale intent cannot
  silently discard a newer revision. The LA route contract is SPLIT (initial-create: no reservation;
  supersede/withdraw: exact revision match) — the "reject any covered target" contradiction is gone.
- **SR-150 (AGY):** the origin assertion is NARROWED to its purpose — it gates the item/lens FALLBACK for
  UNSTAMPED rows only; row-stamped rows (including every server-minted control) value at tier 1 and need no
  origin proof. A validated cross-product replacement no longer bricks at read time.

## Attack surface (very narrow now)
- SR-148's manifest binding vs the ORIGINAL (pre-supersede) publication: the initial control's
  publicationVersion vs later snapshot versions published by UNRELATED corrections on other targets — does
  "effective control's publicationVersion == active version" hold, or does it need "≤ active AND still the
  latest revision for its target in the manifest chain"? Pin the exact comparison.
- SR-150's tier-1 trust: a forged/hostile row with syntactically valid stamps now bypasses origin proof
  entirely — confirm the ingest validation + server-mint paths make row stamps unforgeable-enough (stamps
  land only via validated submit/receive/steps ingest or the sudo-gated correction route).
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One verdict (`W4.4: PASS | PASS-with-notes | BLOCK`), numbered findings with concrete scenarios. Claude
ground-truths and folds; when BOTH of you PASS, W4.4 freezes and the W4 scope review closes.
