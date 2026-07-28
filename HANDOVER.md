# HANDOVER — BOB Stock App

**Written 2026-07-28. Branch `azure-phase-5-8-server`, HEAD `aecde76` (pushed).**
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
- **Working branch:** `azure-phase-5-8-server` — **262 commits ahead of `main`, undeployed**
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
| W4.4 **Contract 2** (correction route) | **← YOU ARE HERE** |

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
- `index.html` is a ~4,750-line monolith with **duplicate method definitions (last wins)** — after
  editing a method, grep for duplicates and fix the live one.

**Permanent rule P-13:** client-side authorization is **not** security enforcement. Never describe a
browser-side role check as secure. That is why the entire server phase exists.
