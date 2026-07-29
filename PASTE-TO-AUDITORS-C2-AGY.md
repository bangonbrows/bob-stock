# REVIEW BRIEF — Stock App · Contract 2 · Round 12 · TWO QUESTIONS

**Context.** Routine internal pre-release quality review of our own stock-management application
(Bang on Brows, a small retail business in Perth). Reviewer and engineer both work for the owner;
this is our own first-party code, read before we switch a feature on. Nothing is deployed and this
application is not in use. This is ordinary specification-conformance and test-design work.

**You have two questions, Q1 and Q2. Answer them in order, one pass each.** Another reviewer is
covering separate questions on the same wave; please form your own view rather than looking for
agreement with anyone else's.

---

## Background you need

The feature is a **correction route**: a director fixes a mistake in a stock record. It is
implemented as an Azure Logic App whose definition is produced by a generator script, so the
reviewable artifact is the generator plus the JSON it emits.

**The one fact that frames both questions.** Until recently this feature was switched off in
practice — it rejected every request at an input-validation step before its first database write.
No code past that step has ever run, in any environment. That validation defect has now been fixed,
which means every later step becomes reachable at once. **Treat every step below that point as
untested code, because it is.** "It has always worked this way" is not available as evidence.

---

## Q1 — Record lifecycle completeness

This is a state-machine reading exercise. Please build the picture from the definition yourself.

The route creates a row in a registry list at a step named `Reserve`, with `State: 'pending'`. A
later step named `Registry_terminal` updates that row to a final state.

Reading `audit-artifacts/gen-correction-def.js`, trace the execution order and produce **the complete
lifecycle of that row**:

1. where it is created, and where it reaches each final state;
2. **every route through the definition that ends the run while the row is still `pending`**;
3. for each route in (2), whether ending there matches the documented intent.

The documented intent is: **the row should exist only from the point the snapshot publish has
committed onward**, because a follow-up process needs it in order to finish the remaining work.
Before that point, the intended state is that no row exists at all.

**Context for judging (2) and (3):** the registry's `TargetTransactionId` column has a uniqueness
setting, and this definition contains no delete operation for that list. A row left behind by an
earlier run therefore changes what a later run for the same transaction is able to do.

**A design trade-off I would like a second opinion on.** A uniqueness clash is now discovered
*after* a control row has been written to the ledger, rather than before. So an unsuccessful run
leaves an unreferenced control row instead of a registry row. **Is that the better of the two
orderings, and is the scope-level error handler still positioned correctly given the reordering?**

---

## Q2 — Specification-versus-implementation coverage comparison

Two build-time checks were recently added to `audit-artifacts/check-correction-def.js`. Each was
written to enforce a stated requirement.

**What I want is a coverage comparison.** For each check: characterise the set of definitions it
*accepts*, compare that to the set its requirement *describes*, and report the difference.

| Check | The requirement it was written to enforce |
|---|---|
| `REQUIRED_GATE_TERMS` | Each conditional step named in the table still refers to the data it is meant to be judging, so that both of its branches remain meaningful |
| the constant-condition walker | No conditional step has a condition whose value is already determined at build time, which would leave one of its two branches unreachable |

So you can see the shape without hunting: `REQUIRED_GATE_TERMS` is implemented as a substring search
over the serialized condition, and the walker reports comparisons where *every* operand is a
literal.

I expect both checks accept more than their requirement allows. **What I want is the precise
difference** — expressed as the set of definition shapes that the requirement excludes but the check
still accepts. Each shape you identify becomes a new case in our rule-coverage suite, which is how we
confirm a check still reports a problem when one exists. If you conclude a check exactly matches its
requirement, say so and show the reasoning.

---

## What to read

Branch `azure-phase-5-8-server`. **Work from your own fresh copy.** Clone the branch tip; the code
under review is unchanged since commit `b96d90f` — every commit after it adds reviewer briefs only,
no code. Print the commit you are reading before reporting anything as missing.

| For | File |
|---|---|
| Q1 | `audit-artifacts/gen-correction-def.js` — the `Reserve` / `Publish_control_row` / `Commit` ordering |
| Q1 | `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` §B — the documented intent |
| Q2 | `audit-artifacts/check-correction-def.js` — the two new rules |

**Setup note:** both `test/node_modules` and `azure-functions/node_modules` are gitignored, so copy
**both** into your working copy if you intend to run anything. A previous reviewer's copy was missing
`@azure/functions` and could not start the proof suites.

---

## Verdict format

PASS / PASS-with-notes / BLOCK, with numbered findings and a concrete sequence of steps for each.
**Findings only — please do not edit anything.** The engineer verifies every finding by running it
and makes all changes.

## Session hygiene — read first

1. Cite `file:line`. Summarise in your own words; read the code rather than my comments where you can.
2. State findings plainly — "this rule does not hold when X happens".
3. This is a reading review. If you run anything, use only the suites in `test/`.
   **Two hard limits: do NOT run `audit-artifacts/check-gates-mutation.js`** — it starts around 90
   Node processes and looks like a hang; it is the engineer's local check and its result is
   42/42 with 0 survivors. And `test/smoke-test.js` takes several minutes — skipping it and saying
   so is the right choice.
4. **Do not describe a file you have not opened.** If something does not exist, say so — that is a
   legitimate finding, not something to infer around.
5. Where a question asks you to derive something independently, do that **before** reading my
   framing of it.
6. If a claim depends on platform behaviour (Azure permissions, SharePoint OData round-tripping),
   say so and treat it as not verifiable by reading.
7. If interrupted, note where you stopped so the next session can resume from there.
8. **Two questions only, in order.** If you are still working after about 90 minutes, stop and report
   what you have — a partial answer at a checkpoint is worth more than a complete one tomorrow.
