# REVIEW BRIEF — Stock App · Account Access item 5 · SPECIFICATION REVIEW · **ROUND 3**

**Context.** Routine internal pre-release quality review of our own stock-management application
(Bang on Brows, a small retail business in Perth). Reviewer and engineer both work for the owner;
this is our own first-party code, checked before we build. **Nothing here has been built yet — this
is a design document, reviewed before any code exists.** Nothing is deployed and the application is
not in use.

**Two questions, in order, one pass each. Stop at about 90 minutes with whatever you have** — a
partial answer at a checkpoint is worth more than a complete one tomorrow.

---

## What changed since round 2, and the one thing that changed structurally

Both reviewers returned BLOCK on round 2 and **found different things**. Every finding was verified by
running it; **one was refuted with evidence** and the rest are fixed.

| Finding | Outcome |
|---|---|
| corrections stated at the top of the spec that never reached the edits below (rounds 1 **and** 2) | **root cause removed — see below** |
| `AA_gate` accepting only `["Succeeded"]` from a failable action, so an unhandled failure marks the run `Failed` | fixed |
| a correction that produced a dependency **cycle** (`AA_actor → AA_ready → AA_actor`) | fixed |
| an initializer still carrying an invalid shape, one line from the sibling that was fixed | fixed |
| `Response_ok.body.*` — a path that does not exist on a Response action | fixed to `inputs.body.*` |
| the three checks contained only historical claims, so the live edits sat outside them | fixed |
| the package was not reproducible: captures gitignored, `git ls-tree` showed zero | fixed — see below |
| `first([])` throws, so the switch fails on every run | **REFUTED**: `first()` is used 58× across the nine live workflows, and `user-admin` uses this exact shape 17× on a `$filter` lookup that returns `[]` for unknown users, with no `empty()` guard. It stays on the standing list for a cloud experiment. |

**THE STRUCTURAL CHANGE, and the part most worth your scepticism.** The same class of defect survived
two rounds of hand-correction, and patching the prose introduced *new* defects both times. So the
machine-checkable half of the spec is no longer prose:

- **`audit-artifacts/item5-edits.json`** now holds the action definitions as data and is
  **authoritative**. Where the prose and the JSON disagree, the JSON wins.
- **`node audit-artifacts/check-item5-edits.js`** validates shape, sibling-only `runAfter`, cycles,
  unhandled-failure paths, and that edited keys exist on the deployed action. Seeded with the defects
  exactly as round 2 stated them, it caught **all four** of your findings plus a fifth nobody flagged.

⚠ **It covers the 12 contentious new actions and 11 existing-action edits — the ones your rounds
touched. Anything outside that is DECLARED UNCHECKED, not verified.** Please treat that boundary as
part of what you are reviewing.

## What to read

Branch `azure-phase-5-8-server`, commit **`9b15c44`**. Work from your own fresh copy.

| Priority | File |
|---|---|
| **1** | `AZURE-CHUNK-AA-ITEM5-RESPEC.md` — the specification. Read the corrections block at the top first. |
| **2** | `audit-artifacts/item5-edits.json` — the AUTHORITATIVE action definitions |
| 3 | `audit-artifacts/check-item5-edits.js` — the validator. **Part of what you are reviewing, not evidence.** |
| 4 | `audit-artifacts/*-REDACTED-2026-07-31.json` — the deployed definitions, captured from the live cloud and **committed**, so they are present at this commit. **These are ground truth. The specification is not.** Only function keys are stripped; every action, `runAfter`, condition and expression is intact. |
| 5 | `AZURE-CHUNK-AA-LA-CHANGES.md` — §3/§4 are the superseded version, plus the owner decisions at §D-AA-A/B |

**Setup:** `test/node_modules` and `azure-functions/node_modules` are gitignored — copy both in if you
intend to run anything.

## The property the whole design rests on

**Stage 1 must be completely inert.** With no permission list published and no enforcement switch set,
every device — none of which sends any proof today — must behave **exactly** as it does now: identical
response bodies, identical rows written, **and an identical run outcome**. That last clause is not
decoration: an unhandled action failure marks the whole run `Failed` even when the response is
byte-identical, and round 2 found exactly that.

Stage 2 (flipping the switch) is a separate, later act and is **out of scope**.

---

## Q1 — Is Stage 1 genuinely inert?

Apply the Stage-1 edits **on paper** to the captured definitions and try to find any input where the
edited workflow behaves differently from the deployed one, given no permission list and no switch.

Worth particular attention:

- **The switch read failing or timing out.** SharePoint throttling is ordinary. Round 2's only
  genuine counter-example lived here.
- **Whether `if()` evaluates its arguments eagerly.** One reviewer held that it does, which would make
  the switch expression raise an error whenever the read failed regardless of the guard around it. We
  could not settle this from the captures and it is on the standing list — but if you can settle it
  from deployed precedent, that is decisive.
- **The counting invariant.** Both workflows assert inputs equal the sum of several outcome buckets
  and error if not. The spec adds a term. Does it hold on every path, including those where the new
  actions were skipped?
- **The response bodies** — the spec claims byte-identical, not merely equivalent. True for the
  empty-array cases?

**One counter-example is a finding.** Round 2's Q1 was passed by one reviewer and broken by the other,
so please do not treat any previous pass as settled.

## Q2 — Does the specification describe the real workflows?

A document-versus-machine comparison. For each edit touching an **existing** action, verify against
the captures that the action exists at the path stated; that the key being modified exists on that
action **type**; that any restated `runAfter` is **complete** (a partial one silently deletes the rest);
and that any claim about which actions read another's output is exactly right.

**And please audit the checks themselves.** Four now exist — `check-item5-edits.js`,
`check-name-collisions.js`, `check-edit-premise.js`, `check-expr-safety.js`, each with a
`--self-test`. Round 2 found that they contained only historical claims and so were reporting clean on
a spec with three shape errors in it. **A defect all four miss is worth more to us than a defect.**

---

## Standing items — cannot be settled by reading, listed so they are not re-reported

1. Whether Azure evaluates both branches of an `if()`, and what a skipped or failed action's output
   reads as. Needs a real cloud experiment; scheduled.
2. Asking an action for its own status has no precedent elsewhere in our estate. Believed fine,
   unproven here.
3. Whether the SharePoint connector wraps this particular read in an extra envelope.
4. Throughput on the shared connection under real load.
5. Positive tests — proving a refusal actually refuses — need a test account that does not exist yet.
   Only inertness can be proven at this stage.

## Verdict format

PASS / PASS-with-notes / BLOCK, with numbered findings and a concrete sequence of steps for each.
**Findings only — please do not edit anything.** The engineer verifies every finding by running it and
makes all changes.

## Session hygiene — read first

1. Cite `file:line`. Summarise in your own words; prefer the captured definitions over our prose.
2. State findings plainly — "this does not hold when X happens".
3. **The captures are ground truth; the specification is the thing under suspicion.** Where they
   disagree, the capture wins and that disagreement is the finding.
4. **Do not describe a file you have not opened.** If something is missing, say so — that is a
   legitimate finding, not something to infer around.
5. If a claim depends on platform behaviour, say so and treat it as not verifiable by reading.
6. Do **not** run `audit-artifacts/check-gates-mutation.js` — it starts around 90 Node processes and
   looks like a hang. It is the engineer's local check.
7. If interrupted, note where you stopped so the next session resumes from there.
