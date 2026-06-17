# Wave K (Tier 4) — Build Status (overnight 2026-06-17)

**Branch:** `fix/cli-tri-audit-2026-05` · **Wave J committed** `30d6d6e` · **This wave: NOT committed** (in progress, for Kunal's review).
**Locked plan:** `audit-artifacts/WAVE-K-TIER4-SCOPE.md` → "★ CONSOLIDATED FINAL PLAN" (both auditors approved).

## What I built tonight (deliberately scoped — safe, additive, proven)

I built the **foundation** the whole tier depends on, plus the **one money-report fix that's low-risk and unambiguous**. I intentionally **stopped before the report repoints that change live money numbers or need your eyes / new UI** — those are safer to land with you awake and are documented as the next step (rationale below).

### 1. Foundation (additive — changes NO existing behaviour, no money number moves)
- **`Txn.category(t)`** (index.html, in the `Txn` object) — derives the TRUE category (`sale`/`wastage`/`transfer`/`internal`/`delivery`/`return`/`adjustment`/`other_out`) from `type` + `stockTo`/`reason`. `classify()`/`direction` (the `Stock.qty` driver) is **untouched**. A row with no `stockTo` falls to `other_out`, never silently `sale` (forward-only, auditor-confirmed). Helpers: `isSale`/`isConsumption`/`isWastage`.
- **`Stock.stockTypeOf(p)`** + `isRetailProduct`/`isConsumableProduct` — Retail vs Consumable. Explicit `product.stockType` wins; else derived from the existing `internalUse` flag (`true` → consumable) per GPT's migration rule.

### 2. Wastage fix (#9, the clearest audit money-bug — low risk)
- New single definition **`Pages._wastageTxns(d)` = `category==='wastage'`**, used by the wastage **report** (`dirWastage`), the **CSV** (`_exportWastageCSV`), and the **dashboard** stat — so they can't drift. Replaces the old "any OUT carrying a wastage-ish reason" string-match, which wrongly counted a `transfer_out`/sale that happened to carry such a reason.

### Harness
- New sentinels **S-92** (Txn.category per-category labels + stock-math invariance), **S-93** (stockTypeOf derivation), **S-94** (wastage = category only; excludes a transfer carrying a wastage reason).
- **Smoke: 94/94 PASS.** Targeted saboteur S-92/93/94 + full 94-mutation sweep: see the bottom of this file / `audit-artifacts/WAVE-K-FULL-SWEEP.log`.

## Deliberately deferred to your review (plan-approved; each changes live money or needs your call / new UI)
1. **Profit removal → Gross Sales + Total Cost (A on-hand + B period-used).** Removing the broken profit column on the store-comparison screen and replacing it with the two figures — a visible UI + money-number change.
2. **Sell-through (#13)** — exclude consumables + count only `category==='sale'`; per-store denominator = transfers-in, company-wide = deliveries-into-HO. The denominator semantics depend on which view directors actually use — worth confirming live.
3. **Franchise billing retarget (#10)** — bill HO→franchise-**office** wholesale + credit for mistake-returns. Entangled with modelling franchise units as locations (franchise/Azure phase).
4. **Price-at-time snapshot** (GPT change #1) — stamp sale price on sale txns at log time. Touches the **daily log-submit path**; additive but safer to land with you available.
5. **Sync `stockTo`/store-ID metadata** (GPT change #2) — for cross-device category correctness; pairs with the Azure sync work.
6. **CSV (#12)**, **reconciliation baseline (#11)**, **currency capture (#4, needs new form fields)**, **explicit stockType field + product-edit UI**, **"definitions changed" labels**.

**Why stop here:** the foundation + wastage are additive/low-risk and fully sentinel-proven, so they're safe to leave overnight. Everything in the deferred list either changes a number a director reads, adds UI, or needs a small decision from you — exactly the kind of thing the framework says to land with a human checkpoint, not unattended. The auditors have already blessed the *plan* for all of it; this just sequences the *build* sensibly.

## Next steps (your morning)
1. Review this + the built diff.
2. Send the prepared GPT/Gemini code-audit briefs (below / in chat) for the foundation + wastage.
3. Greenlight the deferred repoints (I'll build them with you available), then full sweep → commit Wave K.

---

## Prepared audit briefs (foundation + wastage code review) — matched, report-only

### Paste to GPT
> BOB Stock App — Wave K Tier 4 PARTIAL build (foundation + wastage). AUDIT ONLY — do not edit any files; written report. This reviews the BUILT code; the rest of Tier 4 is plan-approved and intentionally deferred (see WAVE-K-BUILD-STATUS.md).
> Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05` (Wave J committed 30d6d6e; this build uncommitted). Read `WAVE-K-BUILD-STATUS.md` and the locked plan `audit-artifacts/WAVE-K-TIER4-SCOPE.md` (★ CONSOLIDATED FINAL PLAN). Built: `Txn.category(t)` + `isSale/isConsumption/isWastage` (index.html, in `Txn`), `Stock.stockTypeOf`/`isRetailProduct`/`isConsumableProduct` (index.html, in `Stock`), `Pages._wastageTxns(d)` + its use in `dirWastage`/`_exportWastageCSV`/dashboard. Sentinels S-92/93/94; smoke 94/94; full 94-mutation sweep result in `audit-artifacts/WAVE-K-FULL-SWEEP.log`.
> Verify: (1) `Txn.category` is correct for every type+stockTo, and a no-`stockTo` 'out' falls to `other_out` (never silently `sale`); (2) it is genuinely reporting-only — `classify()`/`direction`/`Stock.qty` are untouched (stock-math invariance); (3) `stockTypeOf` migration (`internalUse`→consumable, explicit wins) is sound and won't false-classify; (4) `_wastageTxns` correctly counts category==='wastage' and EXCLUDES a transfer_out/sale carrying a stray wastage reason, and all three call sites are consistently repointed; (5) any regression in the touched reports; (6) are S-92/93/94 genuinely catching (not blind/over-determined)? Verdict: PASS / sound-with-changes / BLOCK, file:line.

### Paste to Gemini (CLI)
> BOB Stock App — Wave K Tier 4 PARTIAL build (foundation + wastage). AUDIT ONLY — read and report; do NOT edit, write, or modify any files; written report only. Reviews the BUILT code; the rest of Tier 4 is plan-approved and intentionally deferred (see WAVE-K-BUILD-STATUS.md).
> Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05` (Wave J committed 30d6d6e; this build uncommitted). Read `WAVE-K-BUILD-STATUS.md` and the locked plan `audit-artifacts/WAVE-K-TIER4-SCOPE.md` (★ CONSOLIDATED FINAL PLAN). Built: `Txn.category(t)` + `isSale/isConsumption/isWastage`, `Stock.stockTypeOf`/`isRetailProduct`/`isConsumableProduct`, `Pages._wastageTxns(d)` + its use in `dirWastage`/`_exportWastageCSV`/dashboard. Sentinels S-92/93/94; smoke 94/94; full sweep in `audit-artifacts/WAVE-K-FULL-SWEEP.log`.
> Verify: (1) `Txn.category` correct for every type+stockTo, no-`stockTo` 'out' -> `other_out` never silently `sale`; (2) reporting-only — `classify()`/`direction`/`Stock.qty` untouched (stock-math invariance); (3) `stockTypeOf` migration sound; (4) `_wastageTxns` counts category==='wastage' only and excludes a transfer/sale carrying a wastage reason, all three sites repointed; (5) any regression; (6) S-92/93/94 genuinely catching. Verdict: approve / approve-with-changes / block, file:line.

## Round-1 audit + fixes (2026-06-17)
- **GPT: BLOCK** (2 real bugs + a framing gap + sentinel-strength notes). **Gemini: APPROVE** — but Gemini *praised* the very `isWasteReason` logic GPT flagged as a bug. **Adjudicated in GPT's favour** (it matches the locked plan: destination/`stockTo` is authoritative). Classic two-auditor value.
- **Fixed:** (1) `Txn.category` — `stockTo` is now authoritative; a `reason:'Wastage'` no longer overrides a transfer/in-house/sale destination, and a no-`stockTo` out stays `other_out` (dropped the `isWasteReason` override). (2) `Stock.stockTypeOf` — an invalid explicit `stockType` now returns `'unknown'` (surfaced, never silently retail).
- **Sentinels strengthened/added:** S-92 (+reason-override edge cases), S-94 (+log-screen `out`+Store-Transfer encoding), **S-95** (invalid stockType → unknown). Smoke **95/95**; targeted saboteur **S-92/93/94/95 = 4 CAUGHT / 0 BLIND**.
- **Wastage valuation = EXPLICITLY DEFERRED** (corrects the earlier framing). The report/CSV/dashboard still value wastage at current retail `p.price`; the plan calls for **cost-at-time** (`costAtDate`). That's a live money-meaning change → deferred to the Kunal-present batch with the other report repoints. Both auditors agreed deferral is fine.

## Re-audit brief (GPT — clear the BLOCK) + Gemini
### Paste to GPT
> BOB Stock App — Wave K Tier 4 partial re-audit (your round-1 BLOCK). AUDIT ONLY, report only. Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05`. Your 2 findings are fixed: (1) `Txn.category` (index.html, in `Txn`) now makes `stockTo` authoritative — a `reason:'Wastage'` no longer overrides a transfer/in-house/sale destination, no-`stockTo` out → `other_out`; (2) `Stock.stockTypeOf` returns `'unknown'` for an invalid explicit `stockType` (never silently retail). Sentinels strengthened: S-92 (reason-override cases), S-94 (out+Store-Transfer wastage-reason), S-95 (invalid stockType). Wastage cost-at-time valuation is EXPLICITLY DEFERRED (see WAVE-K-BUILD-STATUS.md). Smoke 95/95; S-92/93/94/95 mutation-proven. Verify both fixes are complete and the sentinels genuinely catch; confirm BLOCK cleared. Verdict: PASS / sound-with-changes / BLOCK, file:line.

### Paste to Gemini (CLI)
> BOB Stock App — Wave K Tier 4 partial re-audit. AUDIT ONLY — read/report, no edits. Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05`. Since your APPROVE, GPT found (and I fixed) two things: `Txn.category` now treats `stockTo` (destination) as authoritative — a stray `reason:'Wastage'` no longer reclassifies a transfer/in-house movement as wastage (this matches the locked plan; the earlier `isWasteReason` override you praised was actually a plan-violation); and `Stock.stockTypeOf` surfaces an invalid explicit stockType as `'unknown'`. Sentinels S-92/94 strengthened, S-95 added; smoke 95/95. Please re-verify these two changes are correct and don't regress, and confirm you concur that destination-authoritative is right. Verdict: approve / approve-with-changes / block, file:line.

## Round-1 RE-AUDIT + harness hardening (2026-06-17)
**Part A (code fixes): BOTH PASS** — GPT explicitly cleared its round-1 BLOCK; Gemini APPROVE. Foundation + wastage code is blessed.

**Part B (harness parallelism): Gemini APPROVE, GPT BLOCK-as-commit-gate** — 2 real issues, both fixed:
- **P2 collision:** `bob-sab-<id>` temp dirs were unique only within one process → overlapping/leftover saboteur runs could clobber each other (GPT found live dirs while auditing). **Fixed:** a run-unique root via `fs.mkdtempSync('bob-sab-run-')`, each mutation under `<root>/<id>`.
- **P2 infra-failure:** partial/crashed/timed-out child runs could pass as a clean baseline or be miscounted as CAUGHT/BLIND. **Fixed:** `parseSmoke` now detects the smoke's completion summary line; baseline requires a COMPLETE run (summary present, `total === EXPECTED_SENTINELS`, all green); a mutation run that didn't complete (no summary) or whose target sentinel never ran is **`[INFRA-FAIL]`** (not CAUGHT/BLIND) and fails the gate. Output now reports `… N INFRA-FAIL …`.
- **GPT note (adopted):** added a dedicated reason-override mutation **S-96** (`sentinel: 'S-92'`) that *reintroduces* the `reason`-promotes-to-wastage bug, proving S-92 catches the destination-authoritative regression head-on (not just the missing-wastage-branch case). The runner gained `sentinel:` support (a mutation may target another mutation's sentinel; default = its own id).

**Validated:** hardened runner on S-92/S-95/S-96 = 3 CAUGHT / 0 BLIND / 0 INFRA-FAIL; S-96 correctly flipped **S-92**. Full hardened sweep (96 mutations, concurrency 6) running → `audit-artifacts/WAVE-K-SWEEP-hardened.log`.

## Round-2 harness re-audit (GPT BLOCK #2 → resolved 2026-06-17)
GPT BLOCK'd again: the collision fix was confirmed, but the infra-completeness fix was incomplete — a mutation could flip its target then the suite could abort before all 95 sentinels ran, and still count. GPT required `total === EXPECTED_SENTINELS` for every result. **But a diagnostic showed that's too strict:** S-37 (and other broad mutations) are *designed* to flip their sentinel EARLY and then abort the rest of the suite (the mutation breaks clean boot), so a full run is impossible by design — yet S-37 is a legitimate CAUGHT (verified in the last Wave-J sweep). A blanket "require all 95" wrongly flags S-37 as INFRA-FAIL (diagnostic: `[INFRA-FAIL] S-37 :: 1/95`).
**Correct fix (implemented):** trust a COMPLETE run outright; trust a PARTIAL run only if the target's verdict is **deterministic — identical across the original + a retry** (a real broad mutation flips the same way every time; flaky contention varies → INFRA-FAIL). Validated: S-37 → CAUGHT (deterministic-partial path), S-92 → CAUGHT (complete), 0 INFRA-FAIL.

**GPT PASS (2026-06-17):** accepts the determinism-across-retry rule; both Part-B P2s cleared, S-96 mapping correct, exit gate fails on any infra. **HARNESS CERTIFIED — both auditors PASS Part A (code) AND Part B (harness).** Only the completed full-sweep artifact remained (sweep was mid-run when GPT read it).

### Harness re-audit brief v2 (GPT — clear Part-B BLOCK)
> BOB Stock App — saboteur-runner.js harness re-audit v2. AUDIT ONLY, report only. Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05`. Your BLOCK#2 (partial runs still admissible) is addressed, but NOT by your literal "require total === EXPECTED_SENTINELS" — that rule is too strict for this harness: some mutations (e.g. **S-37**) are *intentionally caught by an EARLY sentinel that flips RED and THEN aborts the rest of the suite* (the mutation breaks clean boot, so a full 95-sentinel run is impossible by design; S-37 is a legitimate CAUGHT — see the last Wave-J sweep). A blanket full-count requirement wrongly flags S-37 INFRA-FAIL (diagnostic confirmed: `1/95`). **Implemented instead (test/saboteur-runner.js, processMutation):** a COMPLETE run (`summary && total === EXPECTED_SENTINELS`) is trusted outright; a PARTIAL run is trusted ONLY if the target sentinel's verdict is **deterministic — identical across the original run AND a retry** (real broad mutation = same verdict every time; flaky/contention = varies → `[INFRA-FAIL]`). Target absent, or verdicts disagree → INFRA-FAIL (fails the gate). Validated: S-37 → CAUGHT via the deterministic-partial path, S-92 → CAUGHT via a complete run, 0 INFRA-FAIL; full sweep in `audit-artifacts/WAVE-K-SWEEP-hardened.log`. Do you accept the determinism-across-retry rule as a sound substitute for blanket full-count (it rejects flaky partials but admits deterministic broad-mutation partials)? Verdict: PASS / sound-with-changes / BLOCK, file:line.

### (superseded) Harness re-audit brief v1 (GPT — clear Part-B BLOCK)
> BOB Stock App — saboteur-runner.js harness re-audit (your Part-B BLOCK). AUDIT ONLY, report only. Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05`. Both your harness P2s are fixed in `test/saboteur-runner.js`: (1) run-unique temp root via `fs.mkdtempSync('bob-sab-run-')` + per-mutation `<root>/<id>` (collision-free across overlapping runs); (2) `parseSmoke` detects the smoke completion-summary line — baseline now requires a complete run (summary present, total === EXPECTED_SENTINELS, all green), and a mutation run with no summary / missing target sentinel is classified `[INFRA-FAIL]` (not CAUGHT/BLIND) and fails the gate. Also added mutation S-96 (`sentinel:'S-92'`) reintroducing the reason-override for stronger proof; runner now supports a mutation targeting another sentinel via `sentinel:`. Validated: hardened run = 3 CAUGHT/0 BLIND/0 INFRA-FAIL; full sweep in `audit-artifacts/WAVE-K-SWEEP-hardened.log`. Confirm the two P2s are resolved and the runner is now safe as a commit gate. Verdict: PASS / sound-with-changes / BLOCK, file:line.

*(Full hardened-sweep result will be appended when it lands.)*
