# HANDOVER — BOB Stock App

**Written 2026-07-28, last revised 2026-07-30. Branch `azure-phase-5-8-server`.**
*(No HEAD hash pinned here on purpose — it went stale on the next commit and misled a session. Run
`git log --oneline -1` for HEAD and `git rev-list --count main..HEAD` for the distance from `main`.)*
**Read this file first, then `AZURE-CHUNK-PROCESS.md`.**

Kunal Joshi is the owner. He is **not a developer** — explain findings in plain English before any
code detail, and never assume he can read a diff. He routes audits, makes the gating decisions and
personally runs every cloud apply. Claude is the **sole engineer**: nobody else writes code.

---

## 0. THE FIRST THING YOU MUST DO, EVERY SUBSTANTIAL TASK

**State which effort mode fits, in one line, before starting. Unprompted. Every time.**
Full protocol: `CLAUDE.md` §0. Short version:

| Signal | Mode |
|---|---|
| Serial work in one or two files, and a gate already checks each step | **HIGH** |
| Applying an already-decided list of edits | **HIGH** |
| Auditor messages, commits, documentation, conversation | **HIGH** |
| Genuinely independent parts investigable at once; sweeps; "find every X" | **ULTRACODE** |
| A claim needs several independent attempts to **refute** it | **ULTRACODE** |
| Rival designs to compare before committing | **ULTRACODE** |

**The override that beats all of it:** on this project the wins have never come from more thinking.
They came from **mechanical gates** and **external adversarial review**. If you are about to propose
a workflow where a check would do the job, **build the check instead**. A gate you have never seen
fail is not a gate.

**Also flag when relevant:** the user-level `settings.json` pins `opus[1m]` + `effortLevel: high`, so
a session restart silently reverts both mid-task.

---

## 1. WHAT THIS APP IS, AND WHERE IT LIVES

Stock tracking for Bang on Brows, a Perth beauty-salon chain (Karrinyup, Whitford, Ardross + a Head
Office warehouse). Staff log movements, managers run stock takes and transfers, directors see
analytics. Devices are **Windows PCs, iPhones, Android — never iPads.**

Offline-first PWA → IndexedDB on device → Azure Logic Apps → SharePoint Online lists. Stock levels
are never stored; they are computed from an append-only movement ledger.

- **Live (old):** `https://gray-island-05e673800.7.azurestaticapps.net/` — deploys from `main`
- **Working branch:** `azure-phase-5-8-server` — **far ahead of `main` (270+ commits), undeployed**
- Repo `bangonbrows/bob-stock` (private)

**Nothing in the server phase is live. The app is not in use and will not be until it is all done.**

---

## 2. THE PROCESS (governing doc: `AZURE-CHUNK-PROCESS.md`, ratified 2026-07-03)

Roles are fixed: **Claude = sole engineer. GPT/Codex + Antigravity (AGY) = external auditors, report
only, never edit. Kunal = owner**, routes audits, decides gates, authorises deploy.

**Per chunk, in order:**

| # | Stage | Note |
|---|---|---|
| 1 | **Scope** | `AZURE-CHUNK{N}-SCOPE.md` |
| 2 | **Spec audit** | auditors review the spec **before any code exists** |
| 3 | **Discover before touch (P-12)** | map existing behaviour; no behaviour change without a covering sentinel |
| 4 | **Build (Mode A)** | whole wave autonomously, staging only, nothing committed; Kunal reviews once at wave end |
| 5 | **Prove locally** | sentinel + saboteur mutation + smoke + real-cloud probes |
| 6 | **Full saboteur sweep** | Claude's local gate — **never hand this to an auditor** |
| 7 | **Wave review + code audit** | `-WAVE-REVIEW.md` + a paste pack |
| 8 | **Triage** | ground-truth every finding by running it |
| 9 | **Fix everything** | batch, don't cherry-pick; then re-verify pack |
| 10 | **Convergence** | keep looping until **BOTH** auditors pass the SAME revision → chunk on HOLD |

**End of phase, once all chunks are on HOLD:** 6-way blind audit on a de-primed tree → cleanup
(delete test rows, delete the auditor credential, rotate secrets) → **ONE single commit/cutover, only
with Kunal's explicit OK.**

**Vocabulary:** `PHASE → CHUNK → WAVE (nests: W4 → W4.4 → Contract C2 → W-B3 → W-B3i) → ROUND (Rn)`.
"Slice" is commit vocabulary only — it means *small increment + a mechanical gate after each*, and it
is the single most valuable habit on this project.

⚠ **`CLAUDE.md` §7 describes a DIFFERENT, OBSOLETE process** (Gemini as auditor, per-fix auto-deploy).
It now carries a supersession banner. Do not follow it.

---

## 3. THE AUDIT PROCESS

**Auditors:** Codex/GPT and Antigravity (AGY). **Gemini is retired** — it fabricated a CVE and two
"criticals". Quality tiers: **Codex** high-signal, self-corrects, finds real bugs every round.
**AGY** mid — good on harness questions, thin on product reasoning.
**Ground-truth every finding by running it, regardless of source.**

**Hand-off rule:** the message to an auditor is a **short cover note pointing at a repo pack file**
(`PASTE-TO-AUDITORS-*.md`). Never dump the pack into chat. This is the default — don't make Kunal ask.

**DECIDED 2026-07-31 — BOTH auditors get the SAME COMPLETE brief. Never split questions between
them.** Proposed splitting by strength (AGY on platform semantics, Codex on document discipline) to
cut AGY's turnaround, which runs 3-5× Codex's. **Kunal overruled it, and the same day's evidence
proves him right.** On the item 5 round, Codex was given Q1, examined it, and reported "no
capture-grounded Stage-1 counterexample was found". AGY — asked the same question — **found one**, and
it was the only genuine counter-example to the property the whole design rests on. Under the split,
Q1 would have belonged to Codex alone and that defect would have shipped.

Redundancy works *because* it is redundant. Splitting optimises turnaround by removing the second pair
of eyes from precisely the question where the first pair was wrong. **The cost of AGY's slower
turnaround is convergence latency only** — they already run in parallel — and that is cheap next to a
missed counter-example. Use the waiting time for work that does not depend on the verdict.

⚠ **Also revise the quality tiering below.** "AGY mid, thin on product reasoning" did not hold this
round: AGY found the Q1 counter-example AND that a correction would produce a cross-scope `runAfter`
Azure refuses to save, while Codex found the document defects, the gates checking nothing, and the
unreproducible package. Not better and worse — **differently shaped**: AGY sharper on what Azure
actually does, Codex sharper on whether the paperwork holds together. One round, but enough to stop
treating AGY as the junior.

**Pack anatomy:** context → what changed → what to read (branch + **pushed** commit) → numbered
bounded questions → standing items that cannot be closed on paper → verdict format → session hygiene.

**Hygiene rules, and the incident that produced each:**

| Rule | Came from |
|---|---|
| Cite a **pushed** commit, always | AGY hunted an unpushed commit all night |
| Auditors work from their **own fresh copy**, with `node_modules` copied in | they trampled an uncommitted sentinel; and gitignored deps meant nothing could run |
| **Never** hand over the full saboteur sweep or the mutation suite | GPT churned 12h+, AGY errored out; ~90 processes reads as a hang |
| **One or two questions per brief**, in order, with a time box | four jobs in one brief stalled AGY for a whole night |
| Round 2+ needs a fresh copy + printed staleness proof | "the fix is missing" BLOCKs were stale snapshots |
| Neutral QA language, no offensive-security wording | OpenAI's filter blocks audits mid-run |
| Don't describe a file you haven't opened | AGY fabricated an ARM expression from a non-existent file |
| Paper/local audits go to both auditors **together**; only shared-cloud audits are serialised | — |

**Stopping rule:** iterate fix → re-audit until **both** auditors pass. Not just the gate. Every
Codex round has found something real.

---

## 4. THE GATES — run these, don't reason instead of them

From `C:\Users\joshi\repos\bob-stock`:

```
node test\correction-proof.js          200/200   the C2 decision core
node test\attest-proof.js               58/58    signatures/canonicals
node test\archive-carry-proof.js        28/28    archive field carry
node test\buyback-export-proof.js      170/170   the FROZEN money engine
node audit-artifacts\check-fn-contracts.js  audit-artifacts\correction-def-generated.json
node audit-artifacts\check-correction-def.js audit-artifacts\correction-def-generated.json
node audit-artifacts\check-expressions.js    audit-artifacts\correction-def-generated.json
```
All three validators must print `0 problems`. Then the meta-gate:
```
node audit-artifacts\check-gates-mutation.js      42/42 caught, 0 survived  (~2 min, LOCAL ONLY)
```
**Fresh clone needs `npm install` in BOTH `test/` and `azure-functions/`** (both `node_modules` are
gitignored).

### Gates added 2026-07-29/30 — run these too, they are fast and they have all bitten

Each exists because something real got past careful people. Every one has a `--self-test` that proves
it FAILS on a deliberately broken input; run that first if you ever doubt a green result.

```
node audit-artifacts\check-docs.js               ~1s   catches a DOCUMENT that lies
node audit-artifacts\capture-all-staging-defs.js  ~30s  fresh Logic App captures (needs az login)
node audit-artifacts\check-name-collisions.js    ~1s   an action name an edit ADDS is already taken
node audit-artifacts\check-edit-premise.js       ~1s   an edit's picture of the graph is not the real graph
node audit-artifacts\check-expr-safety.js        ~1s   wrong function for the type; client input into a filter
```

- **`check-docs.js`** — ~100 markdown files read as current truth but are mostly moment-records. Eight
  stale-record failures were found over two days, every one BY ACCIDENT. Catches stale git pins, a
  decision OPEN in one file and DECIDED in another, a citation to a section that does not exist, a
  standing marker with two copies, and a load-bearing fact living only in gitignored analysis. Reports
  known-open obligations separately so they never fail the run — a permanently red gate gets ignored.
- **`capture-all-staging-defs.js`** — ⚠ **run this BEFORE any Logic App edit.** The captures are the
  entire rollback story. ⚠ The files it writes **embed live function keys**; `audit-artifacts/` is
  gitignored wholesale and must stay that way.
- **`check-name-collisions.js`** — Logic App actions are keyed by name, so adding a name that exists
  OVERWRITES. This is the check whose absence would have jammed the stock sync write path.
- **`check-edit-premise.js`** — an edit instruction is a CLAIM about the deployed graph. Verifies the
  reader set, that the key being edited exists on that action type, and that a `runAfter` restatement
  is complete (a partial one deletes the rest).
- **`check-expr-safety.js`** — `concat()` on arrays (needs `union()`), and client input reaching an
  OData `$filter` without the quote-stripper. Three pre-existing archive findings are listed as
  BASELINE and do not fail the run, so red always means a NEW regression.

⚠ **A tool listing something as "nothing planned yet" or "declared unchecked" means NOT CHECKED, not
clear.** That distinction is why these exist: the item-5 defect shipped because "nobody looked" was
indistinguishable from "looked and fine."

**Saboteur sweep — dangerous, read this:** run it in the **FOREGROUND only**. It spawns child Node
processes that survive kill/pkill and mutate the live tree. Recover from `.sabotage-bak`, never
`git checkout -- dist/`. Normalise line endings before matching — on Windows CRLF produces false
"STALE" results (one full sweep was 24/24 healthy; only the matcher was broken).

---

## 5. WHERE EVERYTHING STANDS

| Workstream | Status |
|---|---|
| Chunks 0–8 | built, dual-audited, applied to staging, **on HOLD** |
| Chunk 9 (per-account auth) | converged, on HOLD |
| Chunk 10 (store isolation) | **converged** — was the last pre-alpha data-isolation blocker |
| Account Access | code-complete, **triple-audited clean**; staging-apply phase remains |
| Org-Structure | spec converged + build-ready, **NOT built**. Real deadline: new franchisee ~Sep–Oct 2026 |
| Org W1–W4.3 | converged |
| W4.4 **Contract 1** (row EconSig) | **COMPLETE** — staging-applied, archive-carry proven |
| W4.4 **Contract 2** (correction route) | 🅿 **PARKED 2026-07-29** — split out of the cutover, see §5a |

**← YOU ARE HERE: the Account Access staging-apply**, then the permissions end-to-end proof. Verify
that is genuinely the next blocker before committing an evening to it — it comes from a roadmap sweep
whose own critic found items the sweep had missed.

---

## 5a. CONTRACT 2 IS PARKED — read this before touching it

**Decided by Kunal 2026-07-29.** C2 ships as its **own later, separately-audited deploy**, like the
franchise wizard. Rationale: it is the least-finished thing in the project (17 confirmed defects +
7 blocking gaps on its delivery path, never deployed, never run), while everything else is built and
audited. **Parking is safe**: the coupling inventory came back empty — nothing already applied to
staging depends on the correction route existing, and there is no correction screen in the client, so
no user loses a capability they had.

**Kunal's direction for when it IS built: OPTION A — corrections must reach the shop floor.** Not
books-only. That makes C2 bigger, not smaller, which is a further reason not to build it under time
pressure.

**THE COST OF PARKING, stated plainly:** it also parks the ability to produce ANY buy-back settlement
(the export route is unbuilt and depends on C2's control/tombstone assembly contract). Irrelevant for
alpha. **Relevant for the ~Sep–Oct 2026 franchisee** — C2 + the export route need a slot before then.

### The six carried obligations — parking is only safe if these are honoured

1. **RE-SCOPE THE RETURN RE-AUDIT IN WRITING BEFORE IT STARTS.**
   `AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md:63-69` still lists "Land Contract 2" as step 2. Amend it:
   the re-audit covers **engine + Contract 1 only**; the control/correction lane is deliberately
   excluded and audited at a zero-control, empty-manifest baseline. Without this an auditor flags the
   missing route as a gap and a whole round is burned.
2. **RE-HOME "ENGINE CONTROL-SEAL ENFORCEMENT" ONTO C2's LIST. ⚠ DO NOT LOSE THIS ONE.**
   It is currently banked against the return re-audit (`AZURE-CHUNK-ORG-W44-C2-DESIGN.md:554-555`,
   C2-R1-3, `:1537`). Narrow the re-audit without re-homing it and it falls through the gap between
   the two. **It is a RUN-demonstrated money hole:** the manifest head binds only
   `{controlId, revision, bornPublicationVersion}`, so a SharePoint-direct edit of a published control
   row's qty or stamps passes the head check and enters settlement — reproduced against the real
   frozen engine, settling **FINAL at owed 3.75 instead of 375**.
3. **DO NOT SHIP C1's PREDICATE CHANGE ALONE — it is a net safety REGRESSION without a guard.**
   Applying `AZURE-CHUNK-ORG-W44-C1-DESIGN.md` §4 item 1 verbatim turned a deleted-movement case from
   PROVISIONAL/held into **FINAL owed 675**, silently billing it. A compensating tombstone guard was
   built and RUN and works; it must ship in the same batch.
4. **BUILD THE EconSig PROBE FAMILY BEFORE THE RE-AUDIT.** The engine's 170-probe suite has **ZERO**
   EconSig coverage — it still runs on the legacy `_attested` marker and `buybackExport.js` contains
   no reference to EconSig at all. Per P-?: a gate never seen to fail is not a gate. The R5–R7 repros
   must be made to fail **at verify**, not at the manual-review hold.
5. **WRITE THE RE-AUDIT VERDICT SO IT CANNOT BE OVER-READ.** The engine is being certified for a
   **zero-control world**. The verdict must say the control lane was NOT certified, or a later reader
   takes "engine re-audited, clean" as covering corrections.
6. **RECONCILE THE MARKER TEXT.** It currently says three different things in three places: §6 below
   ("required once the server contracts land", no contents), the memory marker (three items), and
   `AZURE-CHUNK-ORG-W44-C2-DESIGN.md:1537` (five items: predicate + sealed-pre-epoch + engine
   control-seal + R5–R7 repros + the flagged N9/N10/N11/N14/N15 amendments). Until it is ONE list the
   next session re-litigates it.

**Also banked onto C2's file (do not fix elsewhere):**
- **The colon id defect.** `correctionCompute.js:286` mints `'ctl:'+opId`, `:311` mints
  `'corr:'+opId+':'+rev`; `topology.js:31` `ID_RE` bans colons, so `buybackExport.js` aborts the whole
  store export with `MALFORMED_CONTROL`. **Fix at C2's end by minting colon-free ids — do NOT widen
  `reqId`**, which loosens a validator the whole server phase depends on.
- **The device-tombstone over-bill** (deleted target still billed 375, FINAL, unsurfaced) — ships with
  C2 §7c adoption and the §6 export route.
- **Option A delivery** — the seven blocking propagation gaps in
  `audit-artifacts/C2-PROPAGATION-ANSWER.md`.

Full analysis: `audit-artifacts/C2-PARKING-DECISION.md`, `-PROPAGATION-ANSWER.md`,
`-CONSOLIDATED-FIX-PLAN.md`, `-GROUNDTRUTH-RESULTS.md`, `-ADOPT-VERIFICATION.md`,
`-R12-CODEX-VERDICTS-RECOVERED.md` (all gitignored — local only).

---

### Contract 2, exactly where it is

The route lets a director correct a mistake in a stock record. Design converged over 25 rounds; the
Logic App artifacts converged over 11 more.

**The fact that frames everything:** until commit `990ae7e` the route was **inert** — every request
refused before the first durable write, so no downstream path had ever executed anywhere. The wave
just applied fixes the request contract, which **arms every path at once**.

Applied in `990ae7e`: the 46-edit Option-A wave (fix only what is reported broken) **plus four
criticals raised against it before it shipped** —

1. Arming the route armed a trap: `Reserve` created a row on an Enforce-Unique column with five
   refusal lanes below it and no delete anywhere, so a refused correction would make its target
   **permanently uncorrectable**. Moved `Reserve` to the last pre-commit instant; pinned by a
   reachability rule.
2. The `ctl-v1` seal could not survive its own storage (SharePoint cannot represent absence), so
   deletion controls could never verify. `null ≡ absent`, **`ctl-v1` only**. This **narrows converged
   rule C2-R7-5** — flagged to auditors as a rule change.
3. Nothing policed what a gate *tests* — added `REQUIRED_GATE_TERMS` + a no-tautologies rule.
4. The new Terminate-hook rule was status-blind.

**Next actions, in order:**
1. Auditor Round 12 is out — pack `PASTE-TO-AUDITORS-C2-LA.md` @ `aecde76`. Codex has QZ1–QZ4;
   AGY has **QZ2 and QZ4 only**. Ground-truth every finding, fold, re-audit until both pass.
2. Build `audit-artifacts/apply-c2-staging.js` (the cutover runner; substitutes `@@FN_KEY@@` in
   process — **a real key must never be written to a file**).
3. **Kunal** runs the staging apply. Then credentialled E2E + crash drill (~10 scenarios).
4. Build audit against the deployed system.

---

## 6. OPEN — DO NOT LOSE THESE

**DECIDED 2026-07-29 — the wizard is NOT in the cutover.** Kunal split the **franchise wizard** out
of the single end-of-phase cutover. It ships as its **own smaller, separately-audited deploy
afterwards**. Reasoning: it is a director-only screen no staff member ever touches, and the
one-cutover rule exists to avoid a string of risky deploys — not to hold the whole launch behind a
screen nobody using the app will open. **The one-cutover rule still governs everything else.**
Consequence: the ~Sep–Oct 2026 franchisee no longer gates launch; if the wizard is not ready, the
documented scripted onboarding runbook (OS-SR-9) covers that franchisee and the wizard serves the
next one.

**DECIDED 2026-07-29 — `rolled_back` becomes a genuine journal state.** Two consumers already filter
on it (`gen-correction-def.js:250` duplicate-request classifier, `:261` Reconcile_prepass) and
nothing has ever written it, so an abandoned correction is indistinguishable from one still in
flight and the recovery sweep re-picks dead work forever. Kunal's ruling: **abandoned means settled**
— a fresh attempt takes a new opId. Scoped into the rollback batch. ⚠ The dangerous half: a lane
where the publish MAY have landed must NOT be marked `rolled_back`, or recovery will never pick it up.

**DIRECTION APPROVED, PENDING VERIFICATION 2026-07-29 — adopt joins the CAS-update lane.** Working
hypothesis: adopt's target already holds a registry row (written by `Lazy_register` at
`gen-correction-def.js:425` as committed-UNADOPTED), so adopt should UPDATE it, not create one —
making MC-4 a fourth instance of MC-1 rather than a separate design question. **Kunal explicitly
required this be PROVEN by running before anything is built on it.** Do not treat as settled until
that verification is recorded here.

⚠ **THE APP IS NOT IN USE. Nobody is logging transactions and none will be until launch.** Do not
apply growth/time-decay reasoning to the live ledger — it is NOT filling up. A 2026-07-29 roadmap
sweep projected a "late October SharePoint 5,000-row outage" from a 25–30 rows/day growth rate
measured in June; **that projection is void.** The 5,000-row limit is real but is a **cutover-time**
concern (set indexes while lists are small; enable the `IdempotencyKey` unique index before the
ledger grows past 5,000 *after* launch — roughly four months of runway from ~1,788 rows). The
**pull-hardening upgrade** (built June, proven on 20,048 rows, dual-audited, runbook written,
**never applied**) belongs in the cutover, not ahead of it.

🅿 **ITEM 5 PARKED 2026-08-01 (Kunal). Sessions 1-6 proceed without it.**
THREE audit rounds, three BLOCKs, both auditors every time. Item 5 is applied LAST (sessions 7-9) and
sessions 1-6 do not need it, so it is not worth being the bottleneck. **Do not resume until ALL the
preconditions below are met** — resuming early is what produced three rounds.

**ROUND 3 FINDINGS — all verified real. Worse than the round-3 brief claimed:**
- 🛑 **The "authoritative" `item5-edits.json` BREAKS INERTNESS.** `AA_enforce` is
  `@if(not(equals(actions('AA_flag')?['status'],'Succeeded')),'off','on')` — it tests only whether the
  read SUCCEEDED. Reading an empty list IS a success, so with **no switch row enforcement turns ON**,
  the exact inverse of the safety property. **All four checks passed it.**
- 🛑 **`item5-edits.json` is a FIXTURE, not authoritative.** 12 of 58 actions, placeholders
  (`host:{}`, `path:"/x"`, `inputs:"x"`), empty gate children, no generator. Applying it literally is
  impossible. **Declaring it authoritative was the same error as the previous round's false coverage
  claim about `check-name-collisions.js` — repeated ONE ROUND after being caught doing it.**
- Validator blind spots, all real: the cycle and status rules **ignore `existingEdits` entirely**; the
  status rule accepts *either* `Failed` or `TimedOut` while claiming both; `readersOf` misses
  `actions('X')` — which is how `AA_enforce` reads `AA_flag`; `check-expr-safety` misses `item()`,
  the deployed loop pattern.
- `existingEdits` stores only `{target, key}` and **not the replacement value**, so it cannot detect
  partial-`runAfter` deletion — the central Q2 requirement — and that is the root of both blind spots.
- The push-v2 gate in the JSON **drops the `ToInsert` dependency** the prose had.
- Probe assertion A5 still cannot pass the switch-outage case it exists to test.

**PRECONDITIONS BEFORE ITEM 5 RESUMES — all of them, no partial credit:**
1. `item5-edits.json` complete: **58 of 58** actions with REAL definitions, no placeholders, plus the
   replacement VALUES for every existing-action edit.
2. The four validator holes closed, each with a self-test case observed to FIRE.
3. **State coverage as a measured number, never an adjective.** "Covers 58/58" — not "authoritative".
4. `AA_enforce` re-derived so an ABSENT switch row means OFF.

⚠ **THE LESSON THAT GENERALISES BEYOND ITEM 5:** the recurring defect was never a missing check — it
was **claiming something was covered / authoritative / done before it was**. Two consecutive rounds
were lost to exactly that. Say what is measured; never assert coverage as an adjective.

**ITEM 5 ROUND 2 (2026-07-31): BOTH auditors BLOCK AGAIN — same class, third time. Root cause removed.**
Rounds 1 and 2 both found corrections stated at the top of the spec that never reached the edits
below, plus action shapes Azure cannot apply. **Hand-patching the prose introduced NEW defects both
times** — round 2's own C1 correction created a dependency cycle (`AA_actor → AA_ready → AA_actor`),
and the C6 correction was stated twice and applied never.

**Every one of those is a mechanically checkable property that was written in English.** So the
machine-checkable half is no longer prose:
- **`audit-artifacts/item5-edits.json`** holds the action definitions as DATA and is **AUTHORITATIVE**.
  Where the prose and the JSON disagree, **the JSON wins**. Fix defects there, never in the document.
- **`node audit-artifacts/check-item5-edits.js`** validates shape, sibling-only `runAfter`, cycles,
  unhandled-failure paths, and that edited keys exist on the deployed action. Seeded with the defects
  exactly as round 2 stated them it caught **all four** auditor findings plus a fifth nobody flagged.
- ⚠ It covers the 12 contentious new actions + 11 existing-action edits. **Anything else is DECLARED
  UNCHECKED, not verified.** Extending it to the full edit set is outstanding.
- **`node audit-artifacts/check-auditor-pack.js`** verifies a hand-off before it is sent. One brief
  went out wrong THREE times (a commit that never existed; a commit whose spec still carried wording
  an auditor had refused twice; files named as ground truth that were gitignored and absent from the
  commit). It checks the COMMIT, not the working tree — the tree was right all three times.

🛑 **INCIDENT 2026-07-31 — DETACHED HEAD, and `git push` said "Everything up-to-date".** Three commits
of real work sat on a detached HEAD while the branch stayed put, so every push was a no-op that
reported success, and the branch's own newer commits made the brief look like it had "reverted".
Caught only because `check-auditor-pack.js` verifies the cited commit is **on the remote** and it
wasn't. Resolved by tagging the floating work as a rescue branch, re-attaching, and merging (both
sides had unique commits — it was a DIVERGENCE, not a fast-forward).
**Before any hand-off: `git symbolic-ref -q HEAD` (empty = detached) and compare
`git ls-remote origin <branch>` with `git rev-parse HEAD`. A quiet push proves nothing.**

**ITEM 5 SPEC AUDIT, ROUND 1 (2026-07-31): BOTH auditors BLOCK — folded, spec corrected.**
Spec: `AZURE-CHUNK-AA-ITEM5-RESPEC.md` (supersedes `AZURE-CHUNK-AA-LA-CHANGES.md` §3/§4).
Nine findings, **eight confirmed by running them, one refuted with evidence.**
- **They found DIFFERENT things.** Codex passed Q1 ("no counter-example"); AGY found one. Codex found
  four document defects and the reproducibility failure; AGY found two platform-shape errors. The
  both-auditors rule earned itself here — internal adversarial agents had already passed this spec.
- **Root cause of four Codex findings: a corrections block that never propagated into the body.** The
  header said "corrected" while the body still said the wrong thing — including probe assertion A5
  demanding `AA_gate == Skipped`, so a CORRECT deployment could not pass its own mandatory test.
- **AGY Q2-1 was a defect my own correction introduced.** C1 said "copy verbatim, no edits at all";
  the copied `runAfter` names an action outside the scope it is being placed into, and Azure forbids
  that (verified: zero cross-scope edges in ~270 deployed actions). "Verbatim" was right about the
  query text and wrong about the wiring.
- **AGY Q1 half-refuted:** `first([])` does NOT throw — `user-admin` uses that exact shape 17× on a
  lookup that returns `[]` for unknown users, unguarded. But the second half STANDS: an unhandled
  action failure marks the run `Failed` even with a byte-identical response, which breaks the stated
  inertness property. Fix = the gate must tolerate `Failed`/`TimedOut` from the switch action.
- **Codex F4 — the three gates were checking NOTHING on this spec.** They held only historical claims,
  so all the shape errors sat outside them and they reported clean. Now populated; on the first run
  the premise gate independently reproduced AGY Q2-2 in one second.
- **Codex F5 — the audit package was not reproducible:** the brief named the captures as ground truth
  while `audit-artifacts/` is gitignored, so `git ls-tree` showed zero. Fixed: nine `-REDACTED-`
  captures are now COMMITTED (22 function keys stripped, output re-scanned, aborts on any residual).
  The `-PRE-` originals stay ignored and remain the rollback source.

**DECIDED 2026-07-30 — Account Access activation (full text: `AZURE-CHUNK-AA-LA-CHANGES.md` §D-AA-A/B):**
- **ONE master enforcement switch for the whole chunk.** Every gated LA reads a single
  `access_policy_enforce` AppConfig row and stays inert while it is absent — **including after a policy
  is published.** Publishing and enforcing are two separate acts, which buys a rehearsal: publish,
  confirm every door reads it, then flip. Undo = flip back, the policy survives. This CORRECTS a spec
  inconsistency (corp-costs and archive-pull previously armed on publish).
  ⚠ `§7`/`§8`/`§10` (user-admin, catalogue-write, Chunk-8 archive) specify **no activation branch at
  all**, and `evaluateAccess` is fail-CLOSED (`NO_POLICY`) — applied literally each would break its own
  working Director door on landing. All three need the guard.
- **Cost visibility at activation = director ONLY. Head Office added later by EDITING THE POLICY**, not
  by redeploying — written as an acceptance criterion, so if it needs a code change the design has
  failed its purpose. ⚠ Companion client defect, must be fixed BEFORE activation:
  `_fetchCorporateCosts()` runs at boot before login (`sync.js:815`), swallows the refusal silently, so
  Director devices would sit on stale costs forever once the person check is live.

**Also cleared 2026-07-30:** the staging test director `srvaudit_director` was minted 2026-07-23 — AA
items 5-11 are **not** blocked on credentials, they are simply not done
(`AZURE-CHUNK-AA-STAGING-LEDGER.md`). And the Azure identity teardown is deferred to before beta, with
the live-verified detail (two auditor secrets not one; a tenant-wide grant valid to 2028) in
`AZURE-CUTOVER-SECURITY-CHECKLIST.md`.

**Banked 2026-07-29 — contract requirements for code that is not written yet:**
- **The correction screen must mint a FRESH opId per attempt.** The client half of the correction
  route does not exist (zero references in `index.html`/`sync.js`/`phase2.js`/`db.js`). Once the
  `rolled_back` work lands, re-sending the same opId returns a permanent settled `{ok:false}` and
  never re-attempts — so a "try again" button that reuses the id gives the director a dead end with
  no way forward. Decide it here, before the screen is built.
- **`sync.js:588` — the pricing route's opId contradicts its own comment.** The comment at `:580-581`
  says it sends "a stable opId (digest-bound idempotent replay server-side)"; the code mints a NEW
  id on every call (`'pop_' + Date.now() + random`). **Ground-truthed 2026-07-29: harmless today
  because the server route does not exist** — `topology.js` exposes only `topologyPlan` and
  `topologyResolve`, there is no `pricingChange` route, and the client fails closed on a missing
  endpoint. But when that route IS built, server-side replay protection can never engage. Either
  make the client id stable across retries of one logical edit, or drop the idempotency claim from
  the comment and rely on the `expectedVersion` CAS (which is what actually prevents double-apply
  today). ⚠ Independent confirmation, from a second direction, that the franchise server work is
  UNBUILT rather than merely un-applied.

**Money-critical / never skip:**
- **The return-engine re-audit.** The buy-back settlement engine was **frozen, not finished** —
  auditors were still finding real bugs at the freeze and three classes (R5–R7) are only *held* as
  manual-review. Kunal's firm marker. Required once the server contracts land.
- **Pricing rate history absent** — a franchise-discount change still retroactively rewrites past
  invoices. Latent, pre-existing.
- **`runrec-v1` may share the `ctl-v1` seal defect** — same storage, same re-read verification, but
  it is **already applied to staging**, and changing a canonical invalidates stored signatures.
  Deliberately untouched. Asked as QZ1; needs an auditor verdict + a migration, not a unilateral fix.

**Data-loss-critical:**
- **Offline writes lost on scope change** — `_reconcileScope` in `sync.js` purges local data *before*
  flushing pending offline writes. Ground-truthed real. The blocking server work has landed.

**Owner decisions waiting:**
- **AA-20** — "Clear PIN": instant revoke, or let grants expire on TTL? ⚠ The repo doc records this as
  **decided 2026-07-10**; memory still lists it open. Resolve which is right.
- D-OS-2 territory-manager nuance; ex-franchisee office account.

**Security, at cutover:** the SWA **deployment token is committed in plaintext** in
`.github/workflows/deploy-swa.yml`. Private repo, so not leaking — rotate it with the other secrets.
The internal folders are now 404'd from the public site (`staticwebapp.config.json`), so a merge to
`main` no longer publishes the server source.

Full lists: `project_c2_post_launch_list` (memory), `REMAINING-WORK.md`,
`AZURE-CUTOVER-SECURITY-CHECKLIST.md`. ⚠ Six cutover items live in three different ledgers and are
missing from the checklist — fold them in.

---

## 7. HOW KUNAL WANTS TO WORK

- **Plain English first**, always. Chat tone: relaxed, not an audit report. He is a business owner.
- **Tell him the effort mode unprompted**, every task (§0).
- **Show changes before applying**; confirm before committing or deploying.
- **Batch fixes** — when an audit returns findings he wants them all fixed, not cherry-picked.
- **Bank ideas, don't build them.** A feature idea goes to a backlog file the same day. Build only
  when he explicitly says so.
- **Nothing deploys without his explicit OK. He runs every cloud apply personally.**
- Challenge weak ideas; don't just agree. He defers technical calls but wants the reasoning.
- **Stability is his top priority.** Audit churn makes him anxious — reassure proactively and
  distinguish "hardening an isolated new file" from "touching the live app".
- Append a row to the project log after every shipped change.
- `index.html` is a ~6,600-line monolith with **duplicate method definitions (last wins)** — after
  editing a method, grep for duplicates and fix the live one.

**Permanent rule P-13:** client-side authorization is **not** security enforcement. Never describe a
browser-side role check as secure. That is why the entire server phase exists.
