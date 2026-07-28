# REVIEW PACK — Contract 2 · ROUND 12 · THE BUILD WAVE (not the runbook)

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on Brows,
Perth; reviewers and engineer all work for the owner). Rounds 1-11 reviewed the Contract 2 correction
route on paper and converged. **This round is different: the code was actually applied.** Nothing is
deployed. Branch `azure-phase-5-8-server`, commit **`9f9fc1a`** (pushed — cite it).

## THE ONE FACT THAT FRAMES EVERYTHING BELOW

**Before this wave the correction route was INERT.** Every request refused at `op:candidate` with
`BAD_REPLACEMENT_ROW` — before `Journal_create`, which is the first durable write. The route has never
written anything, and no path past that point has ever executed in any environment.

**This wave fixes the request contract. The route is now ARMED.** Every downstream path becomes
reachable for the first time. So the question is not "did the edits apply cleanly" — they did, and the
gates prove it. The question is **what those newly-live paths do**, and reviewers should treat every
one of them as unexercised code, because it is.

## What went in

The 46-edit Option-A wave (fix what is reported broken; defer new machinery), plus **four CRITICAL
findings raised against that plan before it was applied** — the first of which is why the plan could
not ship as written:

1. **Arming the route armed a trap.** With the contract fixed, execution reaches `Reserve`, an
   unconditional create on the registry's **Enforce-Unique `TargetTransactionId`** — with five refusal
   lanes below it and **no registry delete anywhere in the route**. One refused correction leaves a row
   nothing removes, and that transaction becomes **permanently uncorrectable by anyone, forever**.
   Fixed by moving `Reserve` down to the last pre-commit instant (after `Assemble_ok`) rather than by
   adding compensating deletes. Pinned by a new *reachability* rule, not by remembered position.
2. **The `ctl-v1` seal could not survive its own storage.** A deletion control row is built with the 12
   engine-row fields ABSENT; the SharePoint round trip returns them present-and-null; the typed
   canonical calls those different states. P5.4 would reject every deletion — **and no future verifier
   of the stored row could reproduce the signed canonical either.** `null` now collapses into absent,
   **for `ctl-v1` only**. This NARROWS converged rule C2-R7-5 (see QZ1 — treat it as a rule change, not
   a fold).
3. **Nothing policed what a gate TESTS.** Every prior rule checked gate *shape*. `Compute_gate`'s
   condition could be replaced with `equals(true,true)` and all three gates stayed green while every
   refusal published. Added `REQUIRED_GATE_TERMS` (15 gates × the evidence each must consult) and a
   general no-tautologies rule.
4. **The new Terminate-hook rule was status-blind.** `runAfter: {Respond_x:['Skipped']}` names the
   Response and passed, but can never fire. Same presence-vs-value defect as the ETag rule fixed 300
   lines away in the same wave. Now requires `Succeeded`.

Two defects **in those four fixes** were caught by the gates rather than by me, and are already fixed:
moving `Reserve` silently broke the `Commit` scope's join (`Do_registry_terminal` would have read a
null item id — caught by the non-ancestor rule), and the first no-tautologies rule read `and`/`or`
connectives as comparisons and reported three healthy gates.

**Local result (run, not asserted):** gates 0/0/0 · mutation suite **42/42 caught, 0 survived** (4 new
mutations, one per new rule) · correction 200/200 · attest 58/58 · archive-carry 28/28 · buyback
170/170 · generator/artifact byte-equivalent.

## Read (fresh copy at `9f9fc1a`)

1. `azure-functions/src/functions/attestRows.js` — `FRAME_NULL_IS_ABSENT`, `canonicalFrame`
2. `azure-functions/src/functions/correctionCompute.js` — `buildControlRow`, `ctlRowsEqual`
3. `audit-artifacts/gen-correction-def.js` — `Reserve` / `Publish_control_row` / `Commit` join
4. `audit-artifacts/check-correction-def.js` — the three new rules
5. `test/correction-proof.js` — F30-F32 and the narrowed C2-R7-5 pair
6. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — the deliberate-gap list (Option A defers real capability;
   **if that list is incomplete, say so — an omission there is an accidental lie to the next reader**)

## What I want this round — four bounded questions

**QZ1 — the C2-R7-5 narrowing, and whether I scoped it correctly. Derive this independently before
reading my argument.** For a subject stored as a SharePoint list item, is there any tamper that strict
`absent ≠ null` detects and `null ≡ absent` does not? **Then the part I am least sure of:** I scoped
the collapse to `ctl-v1` alone and wrote a proof (F32) asserting the other frames keep the strict
distinction. But `runrec-v1`'s subject is `ArchiveRunRecords_Staging` — **also a SharePoint list**, also
verified by re-reading the stored row (`AZURE-CHUNK-ORG-C2-LA-CHANGES.md:109-112`). **Does `runrec-v1`
have the identical latent defect?** It is C1 work and already applied to staging, so I have deliberately
not touched it — changing a canonical invalidates signatures already stored. Tell me whether it bites
(can any of its five covered fields ever be unwritten at sign time?), and if so what the safe migration
is. Same question for `epoch-v1` and `buildrec-v1`.

**QZ2 — the `Reserve` move. Re-derive the lane set yourself.** Enumerate every path that can refuse or
abort after `Reserve` and before the publish commits. I claim the remainder are all post-commit, where a
pending registry row is what §B step 19 wants for reconcile. I also accepted a trade: a unique-key clash
is now discovered *after* the control row is written to the ledger, so a failure leaves an inert
unpublished control row instead of a blocking registry row. **Is that trade actually sound, and is the
abort handler correct at the new position?**

**QZ3 — walk the newly-live paths as unexercised code.** Take one successful `create` correction and one
that fails at each gate below `Journal_create`, and state **what permanent residue each leaves** in the
journal, the registry, the ledger and the snapshot. This is the first wave where any of that is
reachable, so treat "it has always been this way" as no evidence at all.

**QZ4 — attack the two new validator rules.** `REQUIRED_GATE_TERMS` is a substring test over the
serialized expression, and no-tautologies only catches literal-vs-literal comparisons. Write a
corruption that defeats a gate's purpose while satisfying both. If you find one, that is the finding —
I will add it to the mutation suite.

## Standing items that cannot be closed on paper

1. The live-vs-archive SharePoint echo for the eight N7 columns.
2. The RBAC deny assignment empirically refusing enable/run/trigger/resubmit for a non-runner
   principal, plus the "no in-flight runs" quiescence check.
3. **New this round — SharePoint column round-trip fidelity for the sealed `ctl-v1` fields.**
   `null`-vs-absent is now handled, but type/format drift is not provable on paper: a DateTime column
   may return a re-normalised ISO string, a Number column may return `5.0` for `5`. Any such drift
   fails `ctlRowsEqual` and makes the stored signature permanently unverifiable. The staging E2E must
   publish one replacement control and one deletion control and re-verify both seals from a fresh read.

**Judge:** do the four fixes close their findings without introducing a new defect, and is the route
safe to arm? Findings only — the engineer ground-truths and applies all changes. Verdict format:
PASS / PASS-with-notes / BLOCK with numbered findings + concrete failure sequences.

## Reviewer session hygiene (read FIRST)
Ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
1. Name any scripts/notes you make in neutral QA terms — never words like unauthorized/exploit/
   attack in filenames or variables.
2. Cite `file:line` and summarise in your own neutral words; read code comment-free where possible.
3. Findings in plain engineering terms — "the gate does not hold when X".
4. Paper review. If you run anything, only the local proof suites, in your own copy, and
   **`node_modules` is already copied in for you**. Two hard limits:
   **do NOT run `audit-artifacts/check-gates-mutation.js`** (it spawns ~90 Node processes and looks
   like a hang — it is my local gate and its result is quoted above), and `test/smoke-test.js` takes
   several minutes; skipping it and saying so is the correct choice.
5. Work from a FRESH copy at `9f9fc1a`; if you report that a fix is missing, print the commit you are
   reading first.
6. **Do not describe the contents of a file you have not opened.** If a needed artifact does not exist,
   say so — that is a legitimate finding, not something to infer around.
7. **When a question asks you to re-derive something, derive it independently BEFORE reading my
   version.** Confirming a table is not the same as building one.
8. **If a claim depends on external platform behaviour** (Azure permissions, SharePoint OData
   semantics), say so explicitly and treat it as unverifiable-on-paper rather than asserting it.
9. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
10. **Four questions, in order, one pass each.** If you are still working after ~90 minutes, stop and
    report what you have — a partial answer at a checkpoint is worth more than a complete one tomorrow.
