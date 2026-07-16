# OS-W4.2 BUILD (the era-aware pricing lens) — wave record + audit response log

## BUILD SHIPPED 2026-07-15 (per the LOCKED `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md`)
- **index.html:** the `Pricing` module (mirrored validators · SR-42 exact-schema `validConfig` · the
  three-tier `rateAsOf` chain w/ whole-config-validation-first, SR-74 stale horizon, SR-10
  uncovered-franchise fail-close, honest NOT-SET · the P5 `commitGate`); invoice/CSV/report rewire
  (per-line own-date resolution post-activation; byte-identical legacy path pre-activation); writers routed
  through the server post-activation; backup scrub + restore-unresolved marker.
- **sync.js:** `_applyPricingConfig` (SR-29 activation-on-observation · monotonic · SR-31
  stale-on-unadoptable · absent-item = the server's pre-activation statement, resolves a restore);
  `_notePricingEcho` (SETTLED-only, server-instant, forward-only, version-matched horizon advance; config +
  pull hooks); the SR-82 leading-master_data scalar hold; event-scoped `_pricingFresh`
  (visibility/online/leader-handoff invalidation); `publishPricingChange` (CAS + opId + echo adoption).
- **phase2.js:** `_pricingSubmitGate` — the P3/P5 HO→franchise pricing-commitment gate in BOTH submit
  paths, pre-mutation.
- **Sentinels S-261..S-270** (= S-W4-1/2/3/4/6/9/11/16/17/18), incl. the S-261 parity sentinel binding the
  REAL `topology.js` primitives (the S-247 mechanism). **Saboteur mutations S-261..S-270** (parity rule:
  one per sentinel; the runner's structural check enforces 261 ↔ 261).

## GATES (clean code)
smoke **261/261** · topology **256/256** · static PASS · CSP PASS · dupes grep clean ·
scoped saboteur (the 10 new mutations): **10/10 CAUGHT** (after two gate-driven fixes: S-269 STRENGTHENED — the first mutation was BLIND because no assertion exercised activated-without-config, the sentinel now asserts that fail-close directly; and the S-266 INFRA root-caused to a comment-splice from the build patch anchor, repaired @ dd64f9c) · **FULL SWEEP: 280/280 accounted — 279 CAUGHT + S-150b re-anchored (its target line moved into the legacy-fallback branch) and verified CAUGHT via a deterministic mutated-copy run — 0 BLIND, 0 unexplained skips.**

## ROUND 1 (2026-07-16): Codex BLOCK ×6 (all runtime-proven) · AGY BLOCK ×3 — all ground-truthed

**Verdict ledger (every finding checked against code + the frozen spec before any edit):**

| # | Finding | Ground truth | Action |
|---|---|---|---|
| Codex C1 (P1) | offline after a settled observation keeps freshness; a real HO→franchise transfer commits offline | **REAL — spec-pinned** (P5: "the commit path additionally requires the sync layer's connection state to be currently healthy"); I registered `online` but never `offline`, and `commitGate` never checked the connection | `offline` listener invalidates `_pricingFresh`; `commitGate` independently holds on `navigator.onLine === false` |
| Codex C2 (P1) | settled echoes with missing/0/''/null `pricingVersion` clear stale + advance the horizon + open the gate | **REAL** — the guard only enforced the mismatch when the version was finite-positive | version-strict: a missing version (NaN) confirms nothing; 0 matches ONLY a genuinely pre-activation device (adopted 0) |
| Codex C3 (P1) | a served rollback or post-activation absent item counts as a fresh observation | **REAL** — `raw == null` and `newV <= curV` both called `fresh()` unconditionally | post-activation absence = fail closed (not fresh, restore hold kept); `newV < curV` rollback confirms nothing; only the EXACT match (`newV === curV`) freshens |
| Codex C4 (P1) | pricing writers report success without an echoed/adopted config | **REAL** — `j.config` was optional | the echoed publication is REQUIRED + must be adopted (`no-echo` / `bad-echo` / `echo-not-adopted` failures); writer toasts now say honestly "the server may have committed — sync before retrying" |
| Codex C5 (P2) | failed durable commit never retried; the P4-pinned `bob_pricing_ver` marker absent | **REAL — the spec pin was simply not built** (engineer's note 4 was wrong; Codex proved the "next fetch retries" claim false) | `bob_pricing_ver` = last DURABLY committed version; a failed persist claims NO freshness + clears NO durable flags; the next identical fetch (newV === curV, marker trails) RETRIES persistence |
| Codex C6 (P2) | backup VALIDATION arms `bob_pricing_unresolved`; a cancelled/failed restore strands a healthy device in HOLD | **REAL** | marker moved out of `_validateAndScrubBackup` into `_armRestorePricingHold()`, armed by `_importBackup` at the restore WRITE, rolled back if the write throws (also drops the stale `bob_pricing_ver`) |
| AGY-1 | UTC-midnight as-of anchoring = arbitrary intra-day boundary for Perth | **REFUTED** — SR-25 pins CALENDAR-DAY granularity with a deterministic instant (the same date string = the same number on every device); a local-timezone anchor would break exactly that. Codex independently reproduced the behaviour and RETAINED it as the deliberate W4.2/W4.3 seam (exact instants land with the W4.3 stamps) | no change; adjudication recorded |
| AGY-2 | `rateAsOf` reads live `DB.get().stores` while the invoice runs on a fixture `d` (mixed sources) | **REAL as a latent trap** (every live caller passes `DB.get()` today, but a snapshot caller would get live-topology SR-10 verdicts) | `rateAsOf(storeId, productId, dateMs, storesOpt)` — the SR-10 franchise check honours the caller's topology; the invoice passes `d.stores` |
| AGY-3 | gate predicate (`type === 'warehouse'`) diverges from `_isHOSupply` (`stockFromStoreId === 'head_office'`) | **PARTIALLY REAL** — the dangerous direction (billed-but-ungated) exists in one edge: a missing/retyped `head_office` store row passed the gate; the second-warehouse divergence is gated-but-unbilled (fail-safe). Codex judged the spec predicate correct; the fix is the UNION (a superset gate, still spec-conformant) | gate = (warehouse-typed non-franchise sender) OR (`fromStoreId === 'head_office'`) → franchise |

**New coverage:** sentinels **S-271..S-274** (offline gate · version-strict echo/config trust · writer echo
contract + persist retry · restore-hold timing + caller topology + gate union) with four matching saboteur
mutations (parity 265 ↔ 265); **S-262's mutation re-anchored** (the invoice line gained `d.stores`).
Anchor-integrity scan (the runner's own MUTATIONS array eval'd, all finds checked CRLF-normalized):
**284/284 match**.

**Round-1-fix gates (2026-07-16):** smoke **265/265** (S-271..S-274 pass first run, incl. the real
Playwright offline emulation) · topology **256/256** · static PASS · CSP PASS · dupes grep clean ·
anchor-integrity scan **284/284** · scoped saboteur S-261..S-274: **14/14 CAUGHT, 0 BLIND, 0 skipped,
0 INFRA** (single clean run, detached process). The FULL sweep (all 284) relaunched detached as the local
gate; its result is recorded here when it completes — the anchor scan already proves no mutation lost its
target.

**Business note for a future decision (not W4.2):** if HO ever operates a SECOND warehouse, its supplies to
franchises would be gated by pricing but NOT billed by the invoice (`_isHOSupply` is pinned to
`head_office` per Kunal's "bill only stock WE supplied"). Flagged, deliberately unchanged.

## ROUND 2 (2026-07-16): AGY PASS · Codex BLOCK ×4 (runtime-proven, from the recovered fresh-chat session) — all ground-truthed REAL

| # | Finding | Ground truth | Action |
|---|---|---|---|
| W42-R2-C1 (P1) | leadership DEMOTION (newer-leader heartbeat) and the leader-exists stand-down keep `_pricingFresh` — a demoted tab stops pulling, so its freshness fact grows stale forever | **REAL** — R1 only invalidated on PROMOTION (`_becomeLeader`); both loss branches (`sync.js` heartbeat demotion + leader-exists) confirmed bare | `_pricingFresh = false` on BOTH leadership-loss branches |
| W42-R2-C2 (P1) | `Number(body.pricingVersion)` coerces `''`/`null` → 0, which passes as the pre-activation statement; numeric 0 also freshened an activated/config-lost device | **REAL** — my R1 fix was value-strict but not TYPE-strict, and judged zero only against the in-memory adopted version | TYPE-strict: only a numeric non-negative integer counts; version 0 passes ONLY when never activated AND nothing adopted |
| W42-R2-C3 (P1) | writers report success for a ROLLBACK echo (older than held) or a NON-DURABLE adoption (`adoptedV < echoedV` was the only check) | **REAL** — the R1 check proved presence, not durable exact adoption; the R1-C4/C5 family survived in this corner | success = adopted version `===` echoed version AND `bob_pricing_ver === echoed` AND freshness confirmed by the adoption; otherwise the honest `echo-not-adopted` path (the "server may have committed" UI) |
| W42-R2-C4 (P2) | a failed restore write rolls back the unresolved hold but NOT the removed `bob_pricing_ver` | **REAL** (minor: it self-healed via one redundant durable commit, but it is state loss) | the restore core extracted to `_applyRestoreData` with a two-marker snapshot/rollback — and the failed-WRITE path is now directly sentinel-provable |

**New coverage:** sentinel **S-275** (both leadership-loss branches, driven through the real `onmessage`
handler); **S-272/S-273/S-274 strengthened** with Codex's exact matrices (pre/post-activation version
types; rollback + non-durable writer echoes; the real failed restore write via a throwing `DB.KEY` write).
**Mutations:** S-272 redesigned (type-coercion revert), plus S-272b/S-273b/S-274b/S-275/S-275b —
**289 total, parity 266 ↔ 266**, anchor scan 289/289.

**Round-2-fix gates (2026-07-16):** smoke **266/266** (S-275 drives the REAL leader-election handler —
one harness fix: the sentinel initializes `_initLeaderElection()` since the harness boot skips it) ·
scoped saboteur S-261..S-275 incl. b-variants: **19/19 CAUGHT, 0 BLIND, 0 skipped, 0 INFRA** (single
clean detached run, baseline 266/266) · anchor scan **289/289** · static/CSP/dupes clean (unchanged
surfaces) · topology 256/256 (no server change).

**Ops note:** the R1 full sweep was killed mid-run (250/284 caught, no failures, process terminated) —
collateral of auditor cleanup on the shared machine; relaunched after the R2 fix gates.

## Engineer's flagged notes (also in the PASTE pack)
UTC-midnight as-of anchoring for invoice dates (pinned calendar-day granularity) · no office-default
editor exists in today's UI (route support ships now; UI = W5) · the freshness half of the submit gate is
ACTIVE from the W4 build per SR-49 (deliberate cutover behaviour change: dormant HO devices hold
HO→franchise submits) · `_applyPricingConfig` persist-failure = log + in-memory session copy (no AA-05
pending flag — judged acceptable because the durable copy stays at the PRIOR version and re-adopts next
fetch; auditors to judge) · S-262 proves the discount half of S-W4-2 (dollars land with the W4.3 stamps).
