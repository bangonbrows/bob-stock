# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 10

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25 and has not been in question since. This is the interim paper review of
the CONCRETE staging artifacts — in practice, of the CUTOVER RUNBOOK.

**Round 9 outcome: AGY PASS · Codex BLOCK×4. All four real, all fixed.**

**The phase matrix is now proven DISJOINT (round 8) and COMPLETE (round 9), by both of you
independently and mechanically.** The structural work on the state model is done. Every round-9
finding was in the runbook *around* the table rather than in it — which is a meaningfully different
class of problem, and worth naming.

The four:
1. **Stale prose contradicting the new table.** I rewrote the matrix but left the numbered step (6)
   describing the OLD order, a bullet still saying the marker is stamped when (6b) *completes*, a
   reference to a deleted row, and a rule calling the new HANDOVER state a "contradiction". An
   implementer following the numbered steps would have rebuilt the exact gap round 8 closed.
2. **Ordering alone doesn't give the latch.** "Marker absent ⇒ no boundary writer was ever enabled"
   is a claim about *history*; writer state is only observable *now*. A writer enabled, run, and
   disabled again returns the tuple to row 5 with the marker absent.
3. **The retained high-water was not a real artifact** — no schema, no location, no frame, and the
   frame I named is the archive-run one. My claim that deletion is "caught on the next pass" was
   therefore false.
4. **The bootstrap approved whatever was deployed.** It read the live digest, signed *that*, then
   "verified" it against the same observation. Observation had become approval — the `build` fact
   would be true for unreviewed code, destroying the authority chain the artifact exists to provide.

Fixes: the order is corrected everywhere; the latch is now *enforced* by three controls (the
boundary is re-observed immediately before the stamp — observable state rather than trust;
durable-before-proceed with fail-stop on ambiguous writes; an Azure resource lock on the Logic Apps
during the window, with the owner-level residual named); `build_high_water` is a concrete signed
artifact with a new `buildhw-v1` frame, and **my over-strong P-13 claim is withdrawn in the doc**;
and (3c) now requires the live digest to equal an independently pinned reviewed digest before
signing anything, with no auto-advance.

Fold record: **§V**. Suite 171 → **173/173**; all regression gates green.

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — **§V is the R9 fold record; §W is this round's questions
   QW1-QW5.** §D carries the corrected order, the three latch controls, the high-water artifact and
   the reviewed-digest gate.
2. The amended code (173/173 local probes): `azure-functions/src/functions/attestRows.js` (new
   `buildhw-v1` frame) · `snapshotCompute.js` · `test/correction-proof.js` (sections 14-20).
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` · `audit-artifacts/archive-def-current.json`.

**What I want this round:**
- **QW2 — a runbook/table COHERENCE sweep.** Finding 1 was purely stale prose contradicting a proven
  table. Read §B, §C and §D in order, **as an implementer who follows the numbered steps and never
  looks at the table**, and name EVERY remaining sentence that contradicts the 8-row model, the
  (6b-i/ii/iii) order, or the three build artifacts.
- **QW3 — attack the re-observation defence.** It converts "was a writer ever enabled" into "did the
  boundary move". Where does that substitution fail — an intruding writer that archives nothing, a
  boundary that can move without a boundary writer, a re-observation not atomic with the stamp?
- **QW4** — is the high-water artifact plus the *narrowed* P-13 claim now accurate rather than
  over-stated, and is the (3c) reviewed-digest gate sound including rerun and revision advancement?

**Standing item neither of you can close on paper:** the real live-vs-archive SharePoint echo for the
eight N7 columns (absent vs null vs `''`). Staging probe before the first live archive run.

**Judge:** do N1-N4 close their findings without introducing a new defect? Findings only — the
engineer ground-truths and applies all changes. Verdict format: PASS / PASS-with-notes / BLOCK with
numbered findings + concrete failure sequences.

## Reviewer session hygiene (read FIRST)
Ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
1. Name any scripts/notes you make in neutral QA terms — never words like unauthorized/exploit/
   attack in filenames or variables.
2. Cite `file:line` and summarise in your own neutral words; read code comment-free where possible.
3. Findings in plain engineering terms — "the gate does not hold when X".
4. Paper review — if you run anything, only the local proof suites, and only in your own copy.
   `smoke-test.js` takes several minutes; it is fine to skip it and say so rather than time out.
5. Work from a FRESH copy at the latest commit; if you report that a fix is missing, print the
   commit you are reading first.
6. **Do not describe the contents of a file you have not opened.** If a needed artifact does not
   exist yet, say that — it is a legitimate finding, not something to infer around.
7. **When a question asks you to re-derive something, derive it independently BEFORE reading my
   version.** Confirming a table is not the same as building one. If your derivation agrees with
   mine, say what you did to test it, not just that it agrees.
8. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
