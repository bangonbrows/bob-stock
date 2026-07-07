# AZURE CHUNK 6 — Master-data publish + catalogue write — WAVE REVIEW

**Date:** 2026-07-05 · **Status:** BUILT + self-proven on staging; client NOT committed, live UNTOUCHED.
**Spec:** `AZURE-CHUNK6-SCOPE.md` (spec-audit round 1 converged; Kunal decisions locked incl. franchise-cost split).
**Process:** `AZURE-CHUNK-PROCESS.md`. This is the wave pack for the GPT+AGY code audit.

---

## What shipped

**Server (staging only — live untouched):**
- **`catalogueMerge` Function** (`bob-stock-money-fn`, function-key gated) — the pure merge/validation logic:
  per-row `_rv` conflict detection, catalogue-specific validation (safe id incl. the `__proto__`-literal trap
  fixed, name required, money policy, dangling catId/ptId refs, enums, franchiseDiscount 0–100, dup-in-request,
  reserved/proto guards), **strips costPrice from every public product row**, routes cost to `corporate_costs`,
  recomposes `master_data` + bumps `master_data.version` / `corporate_costs.version` server-side. Unit-tested.
- **`bob-stock-catalogue-write-staging`** Logic App — **Director-key gated** (D-HOAUTH: Director only for now;
  store key alone → 401). Reads the AppConfig blobs, calls `catalogueMerge`, writes back only changed blobs by
  item Id under **If-Match/ETag** (a concurrent publish that committed first → 412 → `write_failed` → client
  re-reads + retries). Honest Chunk-2 contract: `{accepted, rejected, conflicts, failed, masterVersion,
  costVersion}`. Unauthorized attempts logged.
- **`bob-stock-corp-costs-staging`** Logic App — the D-COST privacy enforcement. Serves `corporate_costs` ONLY
  to a Director key OR a CORPORATE store key (isFranchise=false). A **franchisee store key → 403** (never
  receives cost). No-auth → 403.
- **Staging data:** `AppConfig_Staging` seeded with products/stores/categories/productTypes blobs (per-row
  `_rv`), a `master_data` item (**no costPrice**), a `corporate_costs` item; a franchise test store
  (`franchtest`) + its StoreCredentials row; sync_config wired with `catalogueWriteUrl`/`corpCostsUrl`.

**Client (`sync.js`, `index.html`, `sw.js` v13 — NOT committed):**
- Dirty tracking: catalogue edits (products/stores/categories/productTypes add/edit/deactivate + cost) mark a
  localStorage dirty set. `publishCatalogue()` sends ONLY dirty rows as deltas, each with its `_rv` as
  `baseRv`; **costPrice stripped from the public change** and routed to `costChanges`.
- Director-gated **"Review & Publish"** UI (Cloud Sync settings): unpublished-changes count, last-published
  version+time, a preview/diff modal, hard success/failure toasts. Clears ONLY accepted rows from dirty
  (rejected/conflicted stay for the Director to fix); 401 → unauthorized pause.
- `_applyMasterData` **never applies costPrice** from the public blob (defensive; cost only via the gated path).
- `_fetchCorporateCosts()` on launch: **corporate/Director devices only** apply central cost; a franchise
  device short-circuits (never fetches) and keeps its own local cost.

## Design decisions realised (from the spec audit)
- **D3** manual publish + dirty/diff/last-published UX. ✓
- **D-SOURCE** AppConfig blobs + **delta rows** (only changed) + **per-row `_rv` conflict** + **If-Match/ETag**
  writeback. (Trigger `concurrency=1` was incompatible with a synchronous Response, so serialization is via
  ETag; combined with delta-only writes + per-row `_rv`, the lost-update + stale-snapshot vectors are closed —
  see the auditor note.)
- **D-COST** corporate cost NEVER in the public blob; served separately + gated; franchisee keeps own cost;
  central cost applied on corporate devices only. ✓ (server-enforced, not client-ignore.)
- **D-VERSION** server-owned monotonic bump; client never mints. ✓
- **D-HOAUTH** Director-key only (Kunal; reversible one-endpoint change later). ✓

## Harness
- **Smoke: 188/188 PASS** (S-192 delta+cost-split, S-193 public-never-carries-cost, S-194 device-tier,
  S-195 cost-applies-corporate-only, S-196 honest-clear-only-accepted, S-197 Director-gated publish).
- **Scoped saboteur S-192..197: 6 CAUGHT / 0 BLIND** (baseline 188/188). NOTE: S-197 was initially BLIND — the
  test's mock returned `accepted:[]`, so the dirty flag never cleared regardless of the gate (proved nothing,
  P-17 again). Fixed the mock to return the row as accepted (+ stubbed the settings re-render) so the Director
  gate is genuinely the only variable → now CAUGHT. The gate itself was always real; the test was hollow.
- **Full sweep (Claude's gate): 206 CAUGHT / 0 BLIND / 0 INFRA-FAIL** (2026-07-05). The sweep first reported
  205/206 with S-50 SKIP-NOFIND — a PRE-EXISTING mutation whose anchor was the exact `copyFields` line the
  D-COST fix changed (cost no longer from public master_data). Re-anchored S-50 to the current line + re-ran →
  CAUGHT. Net: every mutation S-01..S-197 (+b-variants) caught, baseline 188/188.

## Real staging cloud probes (self-run — auditors re-run gpt_/agy_)
W1 no-auth→401 · W2 store-key→401 (Director required) · W3 Director price+cost publish→accepted, master+cost
versions bump · W4 stale baseRv→conflict(STALE_ROW) · W5 dangling catId→DANGLING_CATID + reserved id→BAD_ID ·
W6 new cat+product same batch→both accepted · C1 Director→cost served · C2 corporate store→cost served ·
C3 **franchisee→403 (privacy)** · C4 no-auth→403. **E2E:** publish new product+price+cost → the config/master_data
a client pulls shows the product + price + **no cost**; Director reads cost=11; franchisee corp-cost read→403.

## Build deviations / notes for the auditors
1. **ETag instead of trigger concurrency=1.** Logic Apps reject `concurrency` on a Request trigger that has a
   synchronous Response. We use If-Match/ETag on the blob writeback (412 → client retry) which, together with
   **delta-only rows** (never a full stale snapshot) and **per-row `_rv` conflict detection**, closes the
   lost-update and stale-snapshot vectors both auditors raised. Question: agreed sufficient, or do you still
   want serialization (would require async Response + polling)?
2. **Partial-writeback window.** The blob writeback is a per-blob Foreach; if blob A commits and blob B 412s,
   the run returns `write_failed` and the client retries. `master_data` (what clients actually read) is derived,
   so a partial write self-heals on the next publish. Acceptable for alpha (manual publish, ≤2 editors)?
3. **Deletion propagation.** Products/stores deactivate via `active:false` (publishes fine). Hard category/
   product-type deletes are blocked while in use but their REMOVAL doesn't propagate (upsert-only). Noted as a
   Chunk-7 item.
4. **deactivate-with-stock** is enforced client-side (the UI blocks removing an in-use category/PT); a
   server-side stock check was NOT added (would need a ledger sum in WDL). Flagged — do you require it server-side?
5. **Per-step-type allowlist** carried from the Chunk-5 review as a Chunk-7 hardening item (not a blocker).

## Code-audit round 1 (2026-07-05) — AGY full PASS; GPT BLOCK (2 P1 + 1 P2, all ground-truthed + FIXED)
AGY passed everything. **GPT found 3 real issues AGY missed** (the pattern; GPT is the gate):
- **P1 GPT-C6-1 — concurrent-publish false-accept / lost update.** Reproduced on staging: two overlapping
  Director publishes → the second's If-Match correctly 412'd (write_failed, did NOT persist) BUT the response
  still listed `accepted:[that row]`, and the client trusted `accepted` → would clear it from dirty → silent
  loss. **FIX:** wrapped read→merge→writeback in an **Until-retry loop** — on a 412 it re-reads (sees the
  other publish's rows), re-merges (our deltas on top), retries; overlapping publishes for DIFFERENT rows now
  BOTH land, two edits to the SAME row make the loser an honest STALE_ROW conflict. The response reports
  `accepted` ONLY after the writeback actually persisted (converged); non-converge → `write_failed`,
  `accepted:[]`. **Client:** `publishCatalogue` now gates on `status==='ok'` — a write_failed clears NOTHING
  (keeps rows dirty, signals retry). **PROVEN:** overlapping A+B both survive; single publish attempts=1.
- **P1 GPT-C6-2 — config endpoint leaked corporate_costs.** Confirmed: `config-staging` returned the
  corporate_costs item to a FRANCHISE key (full cost blob), bypassing the gated endpoint. **FIX:** config now
  `$filter=ConfigType ne 'corporate_costs'`. **PROVEN:** franchise config → no corporate_costs (master_data
  still present).
- **P2 GPT-C6-3 — store-type enum too narrow.** The Function allowed only inline/warehouse; the UI offers
  inline/kiosk/franchise/online/warehouse → a valid `type:'franchise'` store was rejected BAD_STORETYPE.
  **FIX:** enum expanded to match the UI. **PROVEN:** type:'franchise' accepted; type:'spaceship' still BAD_STORETYPE.
- **GPT-C6-4 (deviation COUNTER) — deactivate-with-stock client-only.** DECISION (Kunal + Claude): this rule
  stays **client-side by design** — it's a data-TIDINESS rule, not security; the only bypasser is a trusted
  Director (devtools), the effect (hide stock) is reversible + non-data-loss, and server enforcement needs a
  per-publish ledger sum (permanent runtime burden on the shared connection for negligible benefit). Principle:
  security/privacy rules MUST be server-side (cost gating); a Director-only reversible tidiness rule is fine
  client-side. Revisit only if Chunk 9 per-user auth lets less-trusted roles deactivate. Owned, documented.
- Harness: added S-198 (write_failed keeps dirty) + saboteur. **Smoke 189/189; scoped saboteur S-192..198 =
  7 CAUGHT / 0 BLIND; full sweep = 207 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA-FAIL of 207** (2026-07-05).
- Cleanup: staging catalogue reset to seed (all test edits removed), quarantine cleaned, all build passthrus
  (tmp-c6 / tmp-c6fix) deleted. Kept: franchtest cred + AppConfig_Staging fixtures + config URL wiring.
- **Re-verify note:** `audit-artifacts/PASTE-TO-AUDITORS-CHUNK6-REVERIFY.txt`.

### Re-verify round (2026-07-05) — BOTH PASS → CONVERGED → HOLD
GPT (blocked C6 round 1; re-blocked twice on C5's fix family — the strict gate) and AGY independently
re-drove all three fixes on real staging, all Closed:
- **Fix 1:** two overlapping publishes for DIFFERENT products both status:ok + both persisted (GPT watched the
  Until-retry loop hit `attempts:2` on the collided item + re-merge succeed); SAME-product overlap → one
  accepted, other STALE_ROW conflict, `accepted:[]`, no silent overwrite.
- **Fix 2:** franchise config → corporate_costs ABSENT; master_data present; corp-cost endpoint still 403.
- **Fix 3:** type:'franchise' accepted; type:'spaceship' → BAD_STORETYPE.
Both harness re-runs matched (189/189, 7 CAUGHT/0 BLIND). **Both ACCEPT the GPT-C6-4 owned decision**
(deactivate-with-stock client-side for alpha; revisit at Chunk 9). No residual lost-update or cost-leak path.
**CHUNK 6 = CONVERGED → HOLD for the end-of-phase 6-way.** Carried to Chunk 7: per-step-type ledger allowlist,
deletion propagation, partial-writeback hardening (Key Vault/self-host/SAS rotation), and — only if Chunk 9
changes who can deactivate — a server-side deactivate-with-stock check.

## Scope boundary / cleanup owed before handoff
- No per-user auth (Chunk 9), no row-level read scoping (Chunk 10).
- **Cleanup owed:** delete `bob-stock-tmp-c6` (build-only SP passthru); remove E2E_* / c5*-style test rows +
  the catalogue test edits from staging (restore seed). StoreCredentials `franchtest` + the AppConfig_Staging
  catalogue items are KEPT (staging fixtures the auditors use).
