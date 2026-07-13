# OS-W4 SCOPE — Era-aware pricing lens + [from,to) buy-back export

**Status:** MAP COMPLETE (2026-07-13) — awaiting Kunal read → Codex+AGY parallel scope review → build.
**Touches:** `index.html` (the billing report + its CSV + the pricing editors — monolith rules apply),
NEW pure Function `azure-functions/src/functions/buybackExport.js`, small `sync.js` config-adoption glue.
Branch `azure-phase-5-8-server`; nothing deploys until cutover.
**Spec anchors (converged):** OS-SR-3 (lens reads the rate from history, no baked costs), OS-SR-4 (export
bound to the CLOSED era `[from,to)`, server-generated), OS-SR-11 (pricing history DECOUPLED from ownership
eras; per-store `{'*': default, <productId>: override}` dated series), OS-SR-12 (append-only / immutable once
used; corrections = audited adjustments). LA counterparts spec'd in `AZURE-CHUNK-ORG-LA-CHANGES.md`
(§`pricing_history` served via config; §3 Director-gated export route) — staging-apply items; **W4 builds the
client lens + the pure export engine**, both inert/fallback-safe until the server side is applied.

## The mapped ground truth (file:line, verified 2026-07-13)

**GAP-1 — the latent retroactive-invoice bug (the spec's ground-truthed motivator).**
`Pages._franchiseInvoiceData` (index.html:4758) computes every franchise invoice line — for ANY historical
date range — from the LIVE scalars: `office.franchiseDiscount` (4761), per-product `p.franchiseDiscount`
(4775, with the GPTa-41 zero-means-inherit rule), and `p.price` (4774). `_exportFICSV` (4784+) exports the
same numbers. Consequence: a Director changing a discount (or price) TODAY silently rewrites every PAST
invoice the next time it's viewed/exported. No history exists anywhere client-side.

**GAP-2 — the pricing history has no client delivery or read path.**
The W2 topology engine maintains `pricing_history` inside plans (server-owned), and LA-CHANGES specs serving
it via the config pull — but the client has no adoption, storage, or resolver for it. The ONLY pricing the
client knows is the mutable scalar pair.

**GAP-3 — the buy-back settlement export does not exist.**
D-OS pins the deliverable (ex-franchisee usage / cost / retail-profit); OS-SR-4 pins the window semantics
(`[era.from, era.to)`, BOTH bounds, server-generated — HO's post-buy-back rows must not leak). Nothing is
built.

**Reader/writer inventory (all sites, from the grep sweep):**
| Site | What it does | W4 action |
|---|---|---|
| index.html:4758-4782 `_franchiseInvoiceData` + 4784+ `_exportFICSV` | THE invoice computation (report + CSV) | rewire to the lens (rate as-of each line's `t.date`) |
| index.html:1950-1954 (HO-out logging preview banner) | shows transfer pricing at WRITE time — inherently "as-of now", correct | source from the lens for consistency; behaviour unchanged |
| index.html:3337-3348 `_setProductFranDisc` + the store editor's office default | Director pricing WRITES (mutate the scalar) | pre-activation: unchanged; post-activation: append a new interval effective NOW via the server route (client never mutates history — OS-SR-12) |
| index.html:3766 (products CSV) | lists the CURRENT scalar — a reference listing, not dated billing | unchanged |
| catalogueMerge.js:56 | server ingest validation of the scalar | unchanged (scalar remains the pre-activation source + the "current rate" cache) |

## The design

**W4-1 THE CLIENT LENS — a `Pricing` module (index.html).**
- `Pricing.rateAsOf(officeOrStoreId, productId, dateISO)` resolving from `d.pricingHistory`
  (`{ storeId: { '*': [{rate,from,to}], productId: [...] } }`) adopted from the config pull when the server
  serves it (LA-CHANGES §config; version-echoed like accessPolicy).
- **The algorithm IS the server's** (`resolvePricingForProduct` semantics: strict series validation, override
  → default fallback, fail-closed null on malformed, `[from,to)` exclusive) — enforced by a PARITY SENTINEL
  that requires the REAL `azure-functions/src/functions/topology.js` in the harness and compares verdicts
  across a fixture matrix (the S-247 pattern; closes the client-drift class by construction).
- **Fail-safe fallback (the AA "inert pre-activation" pattern):** no history served, or no series for that
  store → EXACTLY today's behaviour (office scalar default + per-product override + zero-means-inherit).
  Zero behaviour change until the server publishes histories. A malformed SERVED series fails closed to the
  fallback WITH a surfaced warning (never silently resolves a bad history).

**W4-2 REWIRE THE INVOICE (report + CSV).**
- Each line's rate = `Pricing.rateAsOf(office.id → falling back per current override semantics, t.productId,
  t.date)`. Same filters, same structure — only the RATE source changes.
- `discMissing` becomes per-line-date (a line whose date no interval covers surfaces as `0% (NOT SET)` —
  today's honest-surfacing behaviour, never silent).
- Result: a discount change today creates a NEW interval; past invoice lines keep resolving their own dates'
  intervals — **retroactive rewriting is dead** (for the discount; see the honest limitation below).

**W4-3 THE WRITE PATH (Director pricing edits).**
- Pre-activation: scalar edits exactly as today.
- Post-activation (history present for that store): the edit calls the server pricing-change route (LA §2 —
  `appendPricingForKey` server-side, effective NOW), then adopts the echoed new history. The client NEVER
  writes history locally. The scalar remains as a display cache of the current rate. Editor gains an
  "effective from today — past invoices unaffected" note.
- Corrections of a closed/used interval are NOT in the editor (OS-SR-12: Director-audited adjustment path —
  deferred to the wizard/W5 or the runbook; pinned here so no one "just adds" a mutate button).

**W4-4 THE BUY-BACK EXPORT ENGINE (new pure Function, `buybackExport.js`).**
- Pure + body-driven like `topology.js` (auditors can attack it directly):
  `buildBuybackExport({ rows, pricingHistory, window:{from,to}, products })` → the settlement dataset:
  usage rows, HO-supply cost lines (rate as-of each row's date), retail-profit summary (D-OS).
- WINDOW: `[from,to)` BOTH bounds enforced inside the engine (OS-SR-4) — a row at exactly `to` is excluded;
  HO's post-buy-back rows can never appear. Malformed history/rows/window ⇒ fail closed (reuse the W2
  primitives: `validPricingSeries`, `isIsoUtc` — import from topology.js, no re-derivation).
- The Director-gated HTTP route + LA wiring = staging-apply (LA-CHANGES §3); the ENGINE + its proof suite are
  W4 deliverables, so the logic is audited long before it touches staging.

**W4-5 (PROPOSED — Kunal call, non-blocking) write-time price/discount stamps.**
The converged spec fixes the DISCOUNT history; the invoice still reads the LIVE `p.price` for past lines —
a sell-price change today still drifts old invoices' dollar amounts (pre-existing, outside the org spec).
Proposal: from W4 onward, stamp `sellAtSupply` + `discAtSupply` on HO→franchise supply rows AT WRITE TIME
(the invoice prefers stamps when present, lens for legacy rows). Freezes both numbers per row forever,
belt-and-braces with the lens. Default = DO IT (cheap, append-only, no migration); say no and we log it as a
known limitation instead.

**Explicitly OUT of W4:** the Director wizard UI (W5); applying any LA (staging-apply); the audited
adjustment path for closed intervals (pinned above); ownership-era VISIBILITY (delivered by W3 scope/purge +
the server read LAs).

## Change-safety plan
- index.html is the >4k-line monolith: heredoc/split-merge edit rules apply; grep for duplicate method
  definitions after every edit (framework rule).
- **New sentinels:**
  - S-W4-1 PARITY: client `Pricing` vs the REAL server resolver across the fixture matrix (override/default/
    gap/malformed/boundary) — verdict-identical.
  - S-W4-2 RETRO-IMMUNITY: build an invoice for a past period, change the discount today (new interval),
    rebuild — past lines UNCHANGED; a new-period line uses the new rate.
  - S-W4-3 FALLBACK REGRESSION: no history served → invoice numbers BYTE-IDENTICAL to today's computation
    (office default + product override + zero-means-inherit + discMissing surfacing).
  - S-W4-4 BOUNDARY: a line dated exactly on an interval boundary resolves `[from,to)` exclusively; a line
    no interval covers surfaces as NOT-SET, never silently 0 or the neighbouring rate.
  - S-W4-5 EXPORT WINDOW: a row at exactly `window.to` is EXCLUDED; post-buy-back HO rows excluded; rates
    as-of row dates; malformed history ⇒ fail-closed refusal.
  - S-W4-6 MALFORMED-SERVED-HISTORY: a bad series in the adopted map → fallback + surfaced warning, never a
    silent resolve.
  - (+ stamps sentinel if W4-5 approved: stamped rows prefer stamps; legacy rows use the lens.)
- Each sentinel gets its saboteur mutation (parity rule). Full local gate before hand-off: smoke, topology
  191, new export-engine proof suite, full saboteur sweep, static gates, dupes grep.
- Mock-must-match-server: the config `pricing_history` echo + the export route are proven against the REAL
  LAs at staging-apply E2E (staging-ledger items).

## Risk register
- R1: lens/server drift → killed by construction (parity sentinel requires the real module).
- R2: fallback drift (the "no history" path diverging from today's numbers) → S-W4-3 byte-identical check.
- R3: monolith edit risk → split-merge rules + dupes grep + the 251-sentinel smoke gate.
- R4: seeding — opening intervals from current scalars at ACTIVATION (cutover/staging runbook item, listed
  there; W4 itself ships inert).

## Kunal decisions needed
- **W4-D1:** approve the write-time `sellAtSupply`/`discAtSupply` stamps (W4-5)? Default = yes.
