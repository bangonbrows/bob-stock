# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 5

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25. This is the interim paper review of the CONCRETE staging artifacts
BEFORE the owner applies them to staging.

**Round 4 outcome: Codex BLOCK×3 — all three real and fixed. AGY PASS.** Both reviewers complied
with the artifact rule this round (Codex opened the legacy archive JSON before relying on it; AGY
explicitly confirmed which artifacts do not yet exist rather than inventing them) — thank you, that
is exactly what makes a verdict usable. **Codex also independently confirmed the R3 H1 scope split**
(typed rule scoped to the eight N7 control fields, C1 stamps keep `absent ≡ ''`).

The three:
1. **The canonical version tag created a mixed-canonical window.** The archive LA hashes the source
   before the copy and the re-read after it, in two separate Function calls. Redeploying between
   them made a FAITHFUL copy mismatch — an in-flight run failing its fidelity gate purely for
   straddling the deploy. Fixed structurally: the runner now quiesces BEFORE it redeploys.
2. **The manifest-omission protection was unreachable from the real caller** — it only triggers on
   `controlProtocol: 2`, which §C never required. Fixed by pinning the exact `Call_compute` body and
   a caller-side `partitionMode === 'c2'` assertion, plus refusing any protocol value ≠ 2.
3. **The phase predicates were not closed-world** — a crash between the two enable actions
   classified PRE with a C2 writer live, and a stray legacy LA still passed POST. Fixed with a
   pinned enable order (archive LA last) and a closed-world matrix where every other combination
   HALTs.

Fold record + repros: **§L**. Suite 154 → **158/158**; all regression gates green.

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — THE document under review.
   - **§L is the R4 fold record**; **§M is this round's questions QM1-QM5** — answer each explicitly.
   - §D carries the resequenced step (3a)/(3b), the pinned (6a)/(6b) enable order, and the
     closed-world phase matrix. §C carries the pinned `Call_compute` body.
   - §F / §H / §J are the R1-R3 fold records.
2. The amended code (158/158 local probes): `azure-functions/src/functions/snapshotCompute.js`
   (⚠ still a flagged amendment to the audited Chunk-8 surface) ·
   `azure-functions/src/functions/correctionCompute.js` · `test/correction-proof.js` (sections
   14-17 hold the F/G/H/I fold probes) · `test/archive-carry-proof.js`.
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` · `audit-artifacts/archive-def-current.json`.

**Two things I want attacked specifically:**
- **QM2** — I rejected the alternative fix for finding 1 (making the version tag conditional on
  control-field presence) because a data-dependent canonical would itself false-HALT if the two
  SharePoint list reads disagree on absent-vs-null. Is that reasoning right, and is
  quiesce-before-deploy sufficient alone — including for a Function App ROLLBACK?
- **QM3** — the closed-world matrix, walked against a crash at every point and a full re-run from
  step (1) at each. I care more about a state that HALTs with no forward path than about one that
  HALTs unnecessarily.

**Standing item neither of you can close on paper** (recorded in §L): the real live-vs-archive
SharePoint echo for the eight N7 columns — absent vs null vs `''`. If the two list reads disagree
for any of them, the typed canonical HALTs. It is a staging probe, to be run before the first live
archive run, and the fix if they differ is to normalise at the read shape, never to loosen the
canonical. Flag it if you think that plan is wrong.

**Judge:** do I1-I3 close their findings without introducing a new defect? Findings only — the
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
7. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
