# Review request — OS-W4.4 Contract 1 design (data-integrity checksum for ledger rows)

Please READ the repo file `AZURE-CHUNK-ORG-W44-C1-DESIGN.md` and review the design. This is a PAPER /
DESIGN review of a proposed server-side data-integrity mechanism (a server-computed row checksum
applied at sync ingest), plus a small DRAFT code module you can run locally. Nothing is deployed;
no cloud access is needed for this round.

Scope of this review:
1. The design doc (all sections), especially the five numbered review questions in §5.
2. The draft module `azure-functions/src/functions/attestRows.js` and its runnable check suite —
   run `node test/attest-proof.js` (42 checks, pure local, no network, finishes in seconds).
3. Context if needed: `AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md` (the parent requirement) and the
   engine header in `azure-functions/src/functions/buybackExport.js` (input forms).

Verdict format: PASS / PASS-with-notes / BLOCK with numbered findings, each with the concrete
scenario that motivates it. Q1–Q5 answers requested explicitly.

House rules (unchanged): report findings only — do not edit files; use your OWN copy of the repo,
never the live working tree; name any scripts/artifacts you create NEUTRALLY (plain QA wording);
do NOT run the full mutation sweep (scoped/local checks only); this note is a pointer — the
authoritative content is the repo files above.
