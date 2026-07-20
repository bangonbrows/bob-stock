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
| `node test/buyback-export-proof.js` | **126/126 PASS** (122 at build + 4 from Codex R1) |
| `node test/topology-proof.js` | **256/256 PASS** (unchanged) |
| `cd test && node smoke-test.js` | **277/277 PASS** (S-283..S-286 new, all CLEAN-PASS first run) |
| Scoped saboteur `S-283,S-284,S-285,S-286` | **4 CAUGHT / 0 BLIND / 0 skipped / 0 INFRA** (single clean run; baseline 277/277 — log `audit-artifacts/scoped-w44-r0.log`) |
| `node test/anchor-scan.js` | **322/322 anchors intact** |
| `test/static-check.js` / `test/csp-check.js` | PASS / PASS (no client-file changes) |
| Full saboteur sweep | wave-close only (process rule) — after audit convergence |

## Audit rounds
| Round | Verdicts | Findings → fixes |
|---|---|---|
| R1 (Codex, partial) | Codex ×2 — BOTH ground-truthed REAL (reproduced against the real engine before fixing). Codex's session tripped OpenAI's cyber filter mid-report (the settlement-behaviour-check ran and printed two probe result lines, then the filter cut off the written findings) — the two probe names + FINAL outputs were enough to reconstruct, reproduce, and fix both. | **C1 (drain manifest, SR-171):** a `committed` grace record with NO presented manifest (or missing `writtenIds`) reached FINAL — absence was read as "presented nothing" instead of "incomplete attestation", the exact SR-171 escape. Fixed: a committed record MUST carry `presentedIds` AND `writtenIds` as arrays; a missing manifest blocks FINAL (`DRAIN_MANIFEST_MISSING`); an EMPTY array stays legitimate. **C2 (replacement instant binding, SR-130/134/142):** a replacement could remove an in-window original (worth 375) while carrying an out-of-window `originalEventAt`, so its own line wasn't billed — silent −375 under-bill, still FINAL, breaking SR-142 delta exactness (my own proof test had blessed it). Fixed: when the target row is SUPPLIED, the replacement's `originalEventAt` MUST equal the target's economic instant, else refuse (`CONTROL_INSTANT_MISMATCH`); a target not in the supplied set is trusted per SR-134's server-side authoritative fetch. Both fixed @ (this commit); proof suite 122→126 (2 new drain probes, 1 corrected + 1 new replacement-instant probe, 1 empty-manifest-legit probe); smoke 277/277, topology 256/256 unchanged. |
