# Probe scripts salvaged from the audit working copies

**Salvaged 2026-08-02, immediately before deleting 115 audit working copies (2.5 GB).**

## What this is

Between June and July 2026 every audit round got its own full clone of the repository — 115 of
them, spread across `audit-work/`, `audit-copies/`, `qa-copies/` and about thirty loose folders in
the home directory. None were ever cleaned up, and it had become impossible to tell which folder
was current.

Before deleting them, every copy was checked: **all 115 had a HEAD commit already present in the
main repository**, so no committed work was at risk. The only thing that existed nowhere else was
a handful of **uncommitted** files — reviewer probe scripts written during a round to test one
specific behaviour, plus their output logs.

The logs were discarded. The scripts are here. This folder is the whole of what those 115 copies
contained that git did not already have.

## What is safe to assume about these

**Nothing.** They are point-in-time reviewer scratch work, not maintained tests:

- They were written against the tree as it stood in June or July 2026 and have not been run since.
- Several target behaviour that has changed, or that was the subject of the very defect the round
  found and later fixed.
- They are **not** part of any gate, are not run by `test/smoke-test.js`, and nothing depends on
  them.

Treat one as a starting point for a similar investigation, never as a passing check. If you want
one to become a real check, rewrite it as a sentinel with a mutation test proving it fails when the
behaviour it covers is broken.

## Contents

| File | What round it came from |
|---|---|
| `audit-probes.js`, `audit-probes-2.js` | org structure waves 1-2 |
| `session-refresh-check.js` | org wave 4.2, round 4 |
| `stamp-behaviour-check.js`, `stamp-behaviour-round4-check.js` | org wave 4.3, price/discount stamping |
| `w43-round2-behaviour-check.js` | org wave 4.3, round 2 |
| `settlement-check.js`, `-behaviour-`, `-followup-`, `-r3-` … `-r6-` | the buy-back settlement engine, rounds 3-6 |
| `scoped-mutation-check.ps1`, `scoped-mutation-round4-check.ps1` | Windows runners for scoped mutation passes |

## One file here is not a probe

**`phase2_clean.js`** is a 1,758-line copy of `phase2.js` from some point in the past; the live
file is 2,170 lines. It is an abandoned working copy left in a reviewer's folder, not a test. It is
kept only because it was untracked and therefore existed in no git history anywhere, and deleting
the one copy of something is not a decision to make silently. **It is almost certainly stale and
should not be used.** Delete it once someone confirms it holds nothing of interest.
