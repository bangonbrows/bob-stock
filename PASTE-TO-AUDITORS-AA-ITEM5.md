# REVIEW BRIEF — Stock App · Account Access item 5 · SPECIFICATION REVIEW (before build)

**Context.** Routine internal pre-release quality review of our own stock-management application
(Bang on Brows, a small retail business in Perth). Reviewer and engineer both work for the owner;
this is our own first-party code, checked before we build. **Nothing here has been built yet — this
is a design document, reviewed before any code exists.** Nothing is deployed and the application is
not in use.

**You have two questions, Q1 and Q2. Answer them in order, one pass each, and stop at about 90
minutes with whatever you have.** A partial answer at a checkpoint is worth more than a complete one
tomorrow.

---

## What this is

The app records stock movements. They reach the cloud through two Azure Logic App workflows — one for
stock rows, one for "record steps" (stock takes, transfers, deliveries). Today those workflows accept
a write because the **device** is trusted; they never check **which person** did it. Item 5 teaches
both to also check the person against a permission list.

**Two facts that shape the whole review:**

1. **These two workflows carry every stock movement, and they run on the same SharePoint connection
   as the currently-live application.** They are the highest-consequence change in the project.
2. **The specification you are reading is a REWRITE.** Its predecessor was reviewed clean three times
   and was still wrong in three ways, because the reviews checked the *design* while the edits had
   been written against a day-old picture of the actual deployed workflows. All three mistakes would
   have changed behaviour on ordinary everyday traffic with no permission list published at all.

## The property the whole design rests on

**Stage 1 must be completely inert.** With no permission list published and no enforcement switch
set, every device — none of which sends any proof today — must behave **exactly** as it does now:
identical response bodies, identical rows written, identical run outcome.

Stage 2 (flipping the switch) is a separate, later act and is **out of scope for this review.**

## What to read

Branch `azure-phase-5-8-server`, commit **`d2a5c5a`**. Work from your own fresh copy.

| Priority | File |
|---|---|
| **1** | `AZURE-CHUNK-AA-ITEM5-RESPEC.md` — the specification under review. Read the four corrections at the top first. |
| 2 | `AZURE-CHUNK-AA-LA-CHANGES.md` — §3/§4 are the OLD version this supersedes, plus the owner decisions at §D-AA-A/B |
| 3 | `audit-artifacts/*-PRE-2026-07-30.json` — the deployed definitions, captured from the live cloud. **These are ground truth. The specification is not.** |

**Setup:** `test/node_modules` and `azure-functions/node_modules` are gitignored — copy both in if you
intend to run anything.

---

## Q1 — Is Stage 1 genuinely inert?

Take the specification's Stage-1 edits, apply them **on paper** to the captured definitions, and try
to find any input where the edited workflow behaves differently from the deployed one, given **no
permission list and no enforcement switch**.

Please look particularly at:

- **What happens when the new switch-read fails or times out.** SharePoint throttling is ordinary, not
  exotic. Our own note says this is the one case our probe does not yet cover.
- **The counting invariant.** Both workflows assert that inputs equal the sum of several outcome
  buckets, and return an error if that fails. The spec adds a term to it. Does the arithmetic still
  hold on every path, including paths where the new actions were skipped?
- **The response bodies.** The spec claims they stay byte-identical, not merely equivalent. Is that
  true for the empty-array cases?
- **Anything the spec asserts about the deployed workflows that the captures do not support.** The
  previous version's central defect was exactly this, and one instance of it survived into this
  version and had to be struck (correction C3). We expect there may be others.

**One counter-example is a finding.** If Stage 1 is not inert, this cannot be applied at all.

## Q2 — Does the specification describe the real workflows?

This is a document-versus-machine comparison, and it is the failure mode that has bitten us twice.

For each edit that touches an **existing** action, verify against the captures that:

- the action named exists, at the path stated;
- the key being modified exists on that action **type** (a Foreach carries `foreach` and has no
  `inputs`; a condition carries a top-level `expression`);
- where the edit restates a `runAfter` map, the restatement is **complete** — a partial one silently
  deletes the dependencies it omits;
- where the edit claims some set of actions reads another action's output, that set is exactly right.

We have built three checks for this class
(`audit-artifacts/check-name-collisions.js`, `check-edit-premise.js`, `check-expr-safety.js`, each
with a `--self-test`). **Please treat them as part of what you are reviewing, not as evidence.** If
you find a defect of this class that all three miss, that gap is more valuable to us than the defect.

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
**Findings only — please do not edit anything.** The engineer verifies every finding by running it
and makes all changes.

## Session hygiene — read first

1. Cite `file:line`. Summarise in your own words; prefer the captured definitions over our prose.
2. State findings plainly — "this does not hold when X happens".
3. **The captures are ground truth; the specification is the thing under suspicion.** Where they
   disagree, the capture wins and that disagreement is the finding.
4. **Do not describe a file you have not opened.** If something is missing, say so — that is a
   legitimate finding, not something to infer around.
5. If a claim depends on platform behaviour, say so and treat it as not verifiable by reading (see
   the standing items above).
6. Do **not** run `audit-artifacts/check-gates-mutation.js` — it starts around 90 Node processes and
   looks like a hang. It is the engineer's local check.
7. If interrupted, note where you stopped so the next session resumes from there.
