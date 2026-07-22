# Review request — OS-W4.4 Contract 1 design (data-integrity checksum for ledger rows)

## ⚡ R2 RE-VERIFY (2026-07-22) — read THIS section + the R1 fold record, then verify
R1 verdicts (AGY BLOCK×2, Codex BLOCK×1, one converged pair) were ALL ground-truthed REAL and folded.
For R2, read ONLY: the **R1 fold record + §1/§2/§5** of `AZURE-CHUNK-ORG-W44-C1-DESIGN.md`, then
re-verify against the updated draft:
- `Reason` + the four pricing-tuple fields joined the covered set (your two findings — both repros are
  now permanent probes in `test/attest-proof.js`, which is 42→**57** checks; run it).
- Seal format now `v1:<kid>:<hex>` with multi-pepper verify (your converged Q3 suggestion).
- §2 ingest wiring adopted BATCH + index-zip + per-row TransactionId cross-check (Q2 adjudicated for
  the batch position).
- Composition amended: for rows, semantic validation gates signing and the seal subsumes the plain
  marker (Q4 resolution — please confirm).
Verdict: PASS or BLOCK with numbered findings. Still paper/local only — nothing is deployed.

---
(Original R1 request below, for context.)

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
