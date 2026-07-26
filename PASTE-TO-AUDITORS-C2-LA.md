# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 7

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25 and has not been in question since. This is the interim paper review of
the CONCRETE staging artifacts — in practice, of the CUTOVER RUNBOOK — before the owner applies them.

**Round 6 outcome: Codex BLOCK×4 (the count went UP). All four real, all fixed. AGY PASS.**

**Third consecutive round where every finding was in my own previous fix.** The R5 fold claimed to
deliver a disjoint phase partition and did not: two rows overlapped on the ordinary post-step-5
state, giving the runner two competing actions. The build-recovery lane I added deadlocked itself —
its own first action moved the state out of POST while the completion marker was still stamped,
tripping my own contradiction rule. My "complete set of boundary-advancing writers" was complete for
production but ignored two C1 diagnostic scripts in this repo that POST straight into the archive
list. And the build stamp was a hand-maintained constant with a "remember to bump it" comment, which
is not authority — and five error returns omitted it while the spec claimed "every response".

Fold record: **§P**. Suite 161 → **164/164**; all regression gates green.

**On the two questions I asked last round:** AGY answered both in a way that confirmed my work
rather than testing it — it declared the overlapping partition "mathematically airtight", and
defended the self-reported stamp on reasoning that addressed a *pre-C2 rollback* rather than the
actual failure mode. Codex re-derived independently and found both. **Please derive before you
compare.**

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — **§P is the R6 fold record; §Q is this round's questions
   QQ1-QQ5.** §D carries the rebuilt 10-row partition, the REPAIR-QUIESCED lane, the operational
   writer inventory, and the package-identity authority. §F/§H/§J/§L/§N are the earlier folds.
2. The amended code (164/164 local probes): `azure-functions/src/functions/snapshotCompute.js`
   (⚠ still a flagged amendment to the audited Chunk-8 surface) ·
   `azure-functions/src/functions/correctionCompute.js` · `test/correction-proof.js` (sections
   14-19) · `test/archive-carry-proof.js`.
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` · `audit-artifacts/archive-def-current.json` ·
   `audit-artifacts/diag-c1-insert.js` and `audit-artifacts/probe-c1-archive-run.js` (the direct
   archive writers that drove K3).

**What I want from this round — three mechanical checks, not impressions:**
- **QQ2 — prove DISJOINTNESS pairwise.** For every ordered pair of the 10 rows, name a fact whose
  value differs, or show they overlap. This has been wrong twice; build your own table and diff it
  against mine rather than reading mine.
- **QQ3 — prove COMPLETENESS over reachable states.** Name any state a legitimate prefix of §D can
  produce that maps to no row, and any row no legitimate prefix can produce.
- **QQ4 — is the out-of-band package digest the right authority**, and is binding it into the signed
  epoch artifact at SEAL time correct, given the build can change after the seal? Is the derived
  response digest sound as a straddle belt?

**Standing item neither of you can close on paper:** the real live-vs-archive SharePoint echo for the
eight N7 columns (absent vs null vs `''`). Staging probe before the first live archive run; if they
differ, normalise at the read shape, never loosen the canonical.

**Judge:** do K1-K4 close their findings without introducing a new defect? Findings only — the
engineer ground-truths and applies all changes. Verdict format: PASS / PASS-with-notes / BLOCK with
numbered findings + concrete failure sequences.

## Reviewer session hygiene (read FIRST)
Ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
1. Name any scripts/notes you make in neutral QA terms — never words like unauthorized/exploit/
   attack in filenames or variables.
2. Cite `file:line` and summarise in your own neutral words; read code comment-free where possible.
3. Findings in plain engineering terms — "the gate does not hold when X".
4. Paper review — if you run anything, only the local proof suites, and only in your own copy.
5. Work from a FRESH copy at the latest commit; if you report that a fix is missing, print the
   commit you are reading first.
6. **Do not describe the contents of a file you have not opened.** If a needed artifact does not
   exist yet, say that — it is a legitimate finding, not something to infer around.
7. **When a question asks you to re-derive something, derive it independently BEFORE reading my
   version.** Confirming a table is not the same as building one. If your derivation agrees with
   mine, say what you did to test it, not just that it agrees.
8. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
