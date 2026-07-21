# OS-W4.4 BUILD — wave record + audit response ledger

**Wave:** OS-W4.4 — the buy-back settlement EXPORT ENGINE (`azure-functions/src/functions/buybackExport.js`).
**Spec:** `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` — FROZEN at R25 (W4-SR-1..171 closed; "the ledger is
mathematically sealed"). The engine + proof suite are the W4 build; the HTTP route + LA wiring are
staging-apply (LA-CHANGES §3/§6).
**Branch:** `azure-phase-5-8-server`. **Built:** 2026-07-20, one session.

## What was built
| Piece | File | Detail |
|---|---|---|
| The pure engine | `azure-functions/src/functions/buybackExport.js` (NEW) | `buildBuybackExport()` per P1–P8; clock-free; every input form documented in the header |
| Additive export | `azure-functions/src/functions/topology.js` | `reqId` joins the export list (N2); zero behaviour change |
| Proof suite | `test/buyback-export-proof.js` (NEW) | 122 probes over the required real module — the spec's full proof plan |
| Parity sentinels | `test/smoke-test.js` | S-283 tuple/money policy · S-284 fold==projection · S-285 invoice==settlement · S-286 lens chain |
| Mutations | `test/saboteur-runner.js` | S-283..S-286, each drifting the CLIENT half of a parity pair |
| Anchor scan | `test/anchor-scan.js` (NEW) | the previously ad-hoc eval-the-runner's-MUTATIONS scanner, now banked as a durable gate |

**NO client files changed this wave** — index.html / sync.js / records.js / phase2.js / db.js are
byte-identical to the W4.3 close (a8eb21c). The invoice/settlement parity is enforced by running the
REAL client code against the REAL engine module in the four new sentinels.

## Engineer's honest notes (the auditors' first targets)
- **N1 — signature packaging.** The frozen P1 signature pins the TOP-LEVEL keys only. Facts the spec
  requires but doesn't place were packed INSIDE pinned keys: the active publication manifest
  (`controls.activeManifest` — SR-148/151 needs it for the per-target-head comparison) and the
  Chunk-4 steps-epoch id (`coverage.stepsEpochId` — SR-129). Adding top-level args would have broken
  the pinned signature; auditors should judge the packaging.
- **N2 — `reqId` export.** Added to topology.js's export list so the engine re-derives NO validation
  primitive (the W4-SR-8 rationale). Additive; the topology suite is unchanged at 256/256.
- **N3 — item tier requires an ATTESTED minting step.** The spec pins server semantic attestation for
  TIER 1 (row stamps, SR-152/153). The engine ALSO refuses to pay TIER 2 (item stamps) from an
  unattested minting step — an unattested submit/receive/resolve step's stamps are the same forgery
  class, so paying them one tier down would reopen SR-152 sideways. This is an engineering extension,
  not a spec pin; proof: "tier 2 from an UNATTESTED mint never pays".
- **N4 — clock-free determinism.** The engine calls no clock and no RNG; identical inputs produce the
  identical settlement (regenerate/replay safe). Proven by the determinism probe.
- **N5 — the HTTP route.** A thin `authLevel:'function'` adapter is registered (house style, like
  topology.js) but NOT deployed until staging-apply. The engine's coverage checks defend against route
  BUGS (short queries, broken leases), not route malice — the LA is the trusted attestor, consistent
  with the spec's attested-inputs rule.
- **N6 — catalogue-price edge parity.** Client invoice: `sell = p?.price || 0`. Engine: finite NUMBER
  or 0. Verdicts differ only on a corrupt catalogue (string/NaN price) where the client would
  propagate garbage; the engine is the stricter side. S-285 pins clean-catalogue equality.
- **N7 — unstamped TRANSFERLESS rows and the epoch.** The spec's origin assertion + SR-129 epoch rule
  are scoped to TRANSFER-LINKED rows. An unstamped row with NO transferId (the legacy direct-log
  class) values via the lens with no epoch proof — exactly what the client invoice does. A stamped
  transferless row still requires the SR-155 row attestation. Flagged as a standing question: is the
  unstamped-transferless class exploitable-in-effect (lens pays current price at the store's rate), or
  acceptably bounded because stamping is compulsory at every post-W4.3 capture surface?
- **N8 — malformed-class divergence (deliberate).** A partial authority tuple: the client surfaces a
  per-line STAMP_ERROR; the engine REFUSES the whole export (SR-169 — engine input is post-ingest, so
  a malformed row proves the boundary was bypassed). The S-285 parity fixtures therefore cover the six
  VALID classes only.
- **N9 — aggregation formulas are engine-defined.** D-OS-6 pins the deliverable ("usage rows, HO-supply
  cost lines, retail-profit summary") without arithmetic. Engine: usage = per-product qty by the
  shared category classifier; cost lines = the invoice's exact line filter + precedence;
  retailProfit = `revenue(sales @ frozen UnitPriceAtTime, K4 fallback surfaced) − totalOwed`.
  KUNAL-VISIBLE: the retail-profit formula (revenue minus discounted supply cost) should be confirmed
  against what he wants an ex-franchisee statement to show.

## Gates at build close (2026-07-20)
| Gate | Result |
|---|---|
| `node test/buyback-export-proof.js` | **148/148 PASS** (122 build + 4 R1 + 7 R2 + 2 N9 + 7 R3 + 6 R4) |
| `node test/topology-proof.js` | **256/256 PASS** (unchanged) |
| `cd test && node smoke-test.js` | **277/277 PASS** (S-283..S-286 new, all CLEAN-PASS first run) |
| Scoped saboteur `S-283,S-284,S-285,S-286` | **4 CAUGHT / 0 BLIND** (build + re-run clean after R2 fixes — logs `audit-artifacts/scoped-w44-r0.log`, `-r2.log`; baseline 277/277 both times) |
| `node test/anchor-scan.js` | **322/322 anchors intact** |
| `test/static-check.js` / `test/csp-check.js` | PASS / PASS (no client-file changes) |
| Full saboteur sweep | wave-close only (process rule) — after audit convergence |

## Audit rounds
| Round | Verdicts | Findings → fixes |
|---|---|---|
| R4 (Codex BLOCK + AGY BLOCK — 2nd parallel round) | 4 distinct findings (both auditors converged on the same class), ALL ground-truthed REAL + fixed. Root cause: R3 bound the transfer's EXISTENCE to server truth, but the ledger row's ECONOMIC IDENTITY (qty, type/direction, which product-line, timing) was still trusted from the client-editable row. | **The row is now a POINTER; the server step is the authority.** New: foldProjection captures each line's authoritative quantity (receivedQty else sentQty) + the submit instant; the engine builds the authoritative HO-line set (every (transferId,productId) HO dispatched to this store) and RECONCILES after valuation — each line must be claimed by billed rows summing to EXACTLY its server quantity (netting out rows a Director control removed). This ONE mechanism closes: **Codex-2/AGY-2 qty** (edit qty→1 or →500 ⇒ HO_LINE_QTY_MISMATCH); **AGY-2a type** (flip a valid receipt's type out of the cost filter ⇒ line unclaimed ⇒ mismatch); **Codex-2a/3 product** (swap productId within the transfer ⇒ both lines mismatch); **transferId repoint** (⇒ wrong-qty/unclaimed); **window evasion** (shift createdAt out of window ⇒ line unclaimed). **Codex/AGY-4 timing:** a legacy-lens transfer row now values at the SUBMIT-step day (server truth), not the editable row date — shifting the date can't move the franchise rate. Residuals FLAGGED: pre-epoch legacy transfers carry no server-side qty/date (pre-Chunk-4; authenticity rests on the validated pre-epoch provenance id, SR-129); direct-log transferless rows' qty is HO's own attested entry (not franchisee-editable). Gates: proof 142→148, smoke 277/277 (parity intact), topology 256/256, anchors 322/322; scoped saboteur re-running. In-build fixes the proof suite caught: reconciliation initially tripped on legit deletions/replacements (netted out) and on pre-epoch rows (scoped to step-backed rows only). |
| R3 (Codex BLOCK + AGY BLOCK — FIRST parallel round, both fresh on the endpoint/bypass class) | 4 distinct findings (7 repros), ALL ground-truthed REAL + fixed. Root cause shared by Codex-2 & AGY-2: the engine trusted client-mutable row fields over the SERVER steps projection, and the integrity gate sat AFTER the classification skips. | **Codex-1 (return over-broad):** every `return_in` netted revenue; only a CUSTOMER return reverses a sale (store/franchise/supplier returns don't). Fixed: net only when `baseLabel(stockFrom)==='Customer'` (mirrors client `_grossSales` index.html:4423). **Codex-2 + AGY-2 (the big one — bind to server truth):** (a) a row whose product wasn't in its claimed transfer fell to the lens; (b/AGY-2b) a genuine HO transfer relabelled to a peer store was DROPPED (free stock) because `isHOSupply` read the client `stockFromStoreId` before the genesis; (c) a row claiming a transfer destined for another store was billed; (AGY-2a) a mutated `type` hit the classifier's `direction==='none'` continue BEFORE the integrity check. Fixed with ONE gate: `isHOSupply` now reads the genesis source FIRST for transfer-linked rows (client label only for transferless / proven-pre-epoch); a new `transferIntegrity()` gate runs at the TOP of the per-row loop (before any skip) and blocks a transfer-linked row whose transfer has no/late steps (POST_EPOCH_NO_STEPS/ORIGIN_UNPROVEN/PROVENANCE_ABSENT), doesn't involve this store (STORE_NOT_IN_TRANSFER), or doesn't contain the row's product (PRODUCT_NOT_IN_TRANSFER). **AGY-1 (corrected row omitted):** a `corrected-and-reattested` bad-version entry unblocked FINAL without checking the corrected row was actually present (a Director re-attestation makes no grace record, so it's absent from writtenIds). Fixed: the entry unblocks only when the row is a supplied ledger row or a control target, else CORRECTED_ROW_MISSING. Gates: proof 135→142, smoke 277/277, topology 256/256, anchors 322/322; scoped saboteur re-run **4 CAUGHT / 0 BLIND** (log `-r3.log`). **Regression caught in-build:** the first `isHOSupply` reorder broke pre-epoch legacy transfers (no projection ⇒ fell to false) — the proof suite flagged it immediately; fixed to fall back to the structured field ONLY for gate-proven pre-epoch rows. |
| R2 (Codex) | Codex — 3 correctness findings (ALL ground-truthed REAL + fixed) + 2 items that are the N9 business-definition question (NOT bugs — Kunal's call) + N7 resolved PASS-with-note. | **C1 (provenance bypass, SR-122/129):** the HO-supply cost-line filter's early `continue` jumped OVER the transfer-linked integrity checks — a `transfer_in` with a transferId but suppressed steps + stripped HO labels read as a peer transfer (`isHOSupply`→false), got skipped, and the settlement went FINAL never billing it AND never flagging the missing steps. Fixed: a non-billed transfer-linked row now still runs the origin/epoch integrity assertion (`POST_EPOCH_NO_STEPS`/`ORIGIN_UNPROVEN`/`PROVENANCE_ABSENT` hold FINAL); a proven-genesis or genuine pre-epoch peer transfer does NOT over-block. **C2 (missing expectedStepIds, SR-122):** a committed grace record with `presentedIds`+`writtenIds` but an ABSENT `expectedStepIds` accepted a suppressed minting step (the row fell to the lens instead of its attested stamp) — the R1-C1 "absence read as empty" class, one field short. Fixed: `expectedStepIds` joins the manifest-completeness requirement (missing ⇒ `DRAIN_MANIFEST_MISSING`; empty stays legit). **C3 (replacement chain, SR-146):** a control targeting another replacement's OUTPUT row double-charged (both replacement rows billed, FINAL). Fixed: replacement output ids are validated + must be disjoint from every control target (`CONTROL_CHAIN`), every other output (`CONTROL_OUTPUT_COLLISION`), and every supplied ledger row. Proof 126→133. **N9 (HO returns / customer refunds): RESOLVED by Kunal 2026-07-20.** (a) HO returns (transfer_out to HO) are NOT credited against the supply bill — his rule: returned supply is treated as a fresh HO arrival because it was already billed to the franchisee (rare case); stays usage-only, confirming the current behaviour (no change). (b) Customer refunds ARE netted — a return_in deducts from retail-profit revenue at the frozen price. BUILT: `revenue -= unitOf(t)*qty` for category 'return' + `refundQty` in the summary; probes added (proof 133→135). **N7:** Codex analysed the unstamped-transferless class and confirmed it is not exploitable for extraction (can only INCREASE the debt at the lens rate; cannot subtract or inflate revenue) — standing question resolved. Gates: proof 133/133, smoke 277/277, topology 256/256, anchors 322/322; scoped saboteur re-running. Codex's session again tripped the OpenAI cyber filter (per [[feedback_codex_safety_filter]]); its written findings came through this time before the cut-off. |
| R1 (Codex, partial) | Codex ×2 — BOTH ground-truthed REAL (reproduced against the real engine before fixing). Codex's session tripped OpenAI's cyber filter mid-report (the settlement-behaviour-check ran and printed two probe result lines, then the filter cut off the written findings) — the two probe names + FINAL outputs were enough to reconstruct, reproduce, and fix both. | **C1 (drain manifest, SR-171):** a `committed` grace record with NO presented manifest (or missing `writtenIds`) reached FINAL — absence was read as "presented nothing" instead of "incomplete attestation", the exact SR-171 escape. Fixed: a committed record MUST carry `presentedIds` AND `writtenIds` as arrays; a missing manifest blocks FINAL (`DRAIN_MANIFEST_MISSING`); an EMPTY array stays legitimate. **C2 (replacement instant binding, SR-130/134/142):** a replacement could remove an in-window original (worth 375) while carrying an out-of-window `originalEventAt`, so its own line wasn't billed — silent −375 under-bill, still FINAL, breaking SR-142 delta exactness (my own proof test had blessed it). Fixed: when the target row is SUPPLIED, the replacement's `originalEventAt` MUST equal the target's economic instant, else refuse (`CONTROL_INSTANT_MISMATCH`); a target not in the supplied set is trusted per SR-134's server-side authoritative fetch. Both fixed @ (this commit); proof suite 122→126 (2 new drain probes, 1 corrected + 1 new replacement-instant probe, 1 empty-manifest-legit probe); smoke 277/277, topology 256/256 unchanged. |
