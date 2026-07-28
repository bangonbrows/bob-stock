# REVIEW PACK — Contract 2 · ROUND 12 · QA LANGUAGE EDITION

**This is the same review as `PASTE-TO-AUDITORS-C2-LA.md`, reworded.** The original used informal
engineering shorthand ("attack the rules", "write a corruption") that reads as something it is not.
This edition asks for exactly the same work in plain QA terms. Nothing technical has changed.

**Context.** Routine internal pre-release QA on our own stock-management app (Bang on Brows, Perth).
Reviewers and engineer all work for the owner; this is our own first-party code, reviewed before we
turn a feature on. Nothing is deployed. Branch `azure-phase-5-8-server`, commit **`b96d90f`**.

## THE ONE FACT THAT FRAMES EVERYTHING

**Until last week this feature was switched off in practice.** The correction route (a director fixing
a mistake in a stock record) rejected every request at an input-validation step before its first
database write. So no code past that step has ever run, in any environment.

**That input-validation defect is now fixed, which means every later step becomes live at once.** The
review question is therefore not "did the edits apply cleanly" — the automated checks already confirm
that. It is **"what do the newly-reachable steps do"**, and every one should be treated as untested
code, because it is.

## What changed

A 46-edit wave (fix only what was reported broken; defer new capability), plus four issues found
against that plan before it was applied:

1. **A cleanup gap.** With input validation fixed, execution now reaches a step that creates a
   reservation record on a column with a uniqueness constraint. Several error-handling branches sit
   below that step, and nothing deletes the record on any of them. One rejected correction would leave
   a record behind that prevents that transaction from ever being corrected again. Fixed by moving the
   reservation to the last step before the commit point, so the remaining error branches are all
   post-commit (where keeping the record is the intended behaviour). A new rule checks this by tracing
   the actual execution paths rather than by remembering a line number.
2. **A data-integrity check that could never pass.** Records are signed on write and the signature is
   re-checked on read. A deletion-type control record is built with 12 fields left unset; SharePoint
   returns unset columns as null rather than as missing, and the signing routine treated those as
   different. So the check failed for every deletion — and the stored signature could never be
   re-validated later either. Null and missing are now treated as one state, **for this record type
   only**. This narrows a previously agreed rule (C2-R7-5); please treat it as a rule change.
3. **No check on what a decision gate examines.** Existing rules confirmed each gate existed and had
   the right shape, but none read its condition. A gate's condition could be replaced with a constant
   and every automated check would still report green while the rejection branch became dead code.
   Added a table of the evidence each of 15 gates must reference, plus a rule rejecting conditions
   built only from constants.
4. **A rule that checked a name instead of a value** — it confirmed a stop-action was referenced, not
   that the reference could ever trigger.

**Local results (run, not asserted):** three validators 0 problems each · rule-coverage suite 42/42 ·
correction 200/200 · signatures 58/58 · archive-carry 28/28 · export engine 170/170.

## Read (fresh copy at `b96d90f`)

1. `audit-artifacts/gen-correction-def.js` — the `Reserve` / `Publish_control_row` / `Commit` ordering
2. `audit-artifacts/check-correction-def.js` — the three new rules
3. `azure-functions/src/functions/attestRows.js` — `FRAME_NULL_IS_ABSENT`, `canonicalFrame`
4. `azure-functions/src/functions/correctionCompute.js` — `buildControlRow`, `ctlRowsEqual`
5. `test/correction-proof.js` — F30-F32 and the narrowed C2-R7-5 pair

## The four questions

**QA1 — the narrowed signing rule, and whether I scoped it correctly. Work it out independently before
reading my reasoning.** For a record stored as a SharePoint list item, does treating null and missing
as one state lose the ability to detect any real change to that record? **Then the part I am least
sure of:** I applied this to one record type only, and wrote a test asserting the others keep the
strict behaviour. But the archive run record (`runrec-v1`) is **also** a SharePoint list item and is
**also** validated by re-reading the stored row. **Does it have the same problem?** It is earlier work
already applied to our staging environment, so I have deliberately left it alone — changing how a
signature is computed would invalidate signatures already stored. Please tell me whether it is
actually affected (can any of its five signed fields ever be left unset at signing time?) and, if so,
what a safe migration looks like. Same question for `epoch-v1` and `buildrec-v1`.

**QA2 — cleanup on failure paths. Please derive the list yourself rather than checking mine.** List
every branch that can reject, fail or abort *after* the `Reserve` step and *before* the publish step
commits. For each, say what records it leaves behind. My claim is that all remaining ones are
post-commit, where leaving the record is correct and intended. I also accepted a trade-off: a
uniqueness clash is now detected *after* a control record has been written to the ledger rather than
before, so a failure leaves an unreferenced control record instead of a blocking reservation record.
**Is that trade-off sound, and is the generic error handler still correct at the new position?**

**QA3 — walk the newly-reachable steps as untested code.** Take one successful correction, and one
that fails at each gate below the first database write. For each, state exactly what is left behind in
the journal, the registry, the ledger and the snapshot once the run ends. "It has always worked this
way" is not evidence here — none of it has ever run.

**QA4 — coverage gaps in the two new validation rules.** `REQUIRED_GATE_TERMS` checks that a gate's
condition mentions certain names (a substring test over the serialized condition). The second rule
only flags conditions where every operand is a literal constant. **Both are therefore likely to have
false negatives: definitions they accept that a careful reviewer would reject.** Please construct one —
a workflow definition that satisfies both rules while a gate no longer does its job. This is ordinary
test-case design: I want the coverage gap so I can add it to the rule-coverage suite. If you conclude
there isn't one, say what reasoning gets you there.

## Items that cannot be settled by reading — for the staging test plan, not this review

1. The live-vs-archive SharePoint echo for the eight N7 columns.
2. Azure role-assignment behaviour for the workflow-runner account, and the "no in-flight runs" check.
3. **New — SharePoint column round-trip fidelity for the signed fields.** Null-vs-missing is handled
   now, but type and format changes are not provable by reading: a date column may return a
   re-normalised string, a number column may return `5.0` for `5`. Either would fail the read-back
   check and make the stored signature permanently un-revalidatable. The staging test must write one
   replacement record and one deletion record and re-validate both from a fresh read.

## Verdict format
PASS / PASS-with-notes / BLOCK, with numbered findings and a concrete sequence of steps for each.
**Findings only — please do not edit anything.** The engineer verifies each finding by running it and
makes all changes.

## Reviewer session hygiene (read FIRST)
1. Cite `file:line`. Summarise in your own words; read the code rather than my comments where possible.
2. State findings plainly — "this rule does not hold when X happens".
3. This is a reading review. If you run anything, use only the suites in `test/` in your own copy;
   `node_modules` is already there. **Two hard limits: do NOT run
   `audit-artifacts/check-gates-mutation.js`** (it starts ~90 Node processes and looks like a hang —
   it is the engineer's local check and its result is quoted above), and `test/smoke-test.js` takes
   several minutes — skipping it and saying so is the right choice.
4. Work from a fresh copy at `b96d90f`. If you report that something is missing, print the commit you
   are reading first.
5. **Do not describe a file you have not opened.** If something does not exist, say so — that is a
   legitimate finding, not something to infer around.
6. When a question says to derive something independently, do that **before** reading my version.
7. If a claim depends on platform behaviour (Azure permissions, SharePoint OData), say so and treat it
   as not verifiable by reading.
8. If interrupted, note where you stopped so the next session resumes from there.
9. **Answer only the questions you were assigned, in order, one pass each.** If you are still working
   after ~90 minutes, stop and report what you have — a partial answer at a checkpoint is worth more
   than a complete one tomorrow.
