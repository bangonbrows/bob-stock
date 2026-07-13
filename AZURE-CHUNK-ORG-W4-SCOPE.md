# OS-W4 SCOPE — Era-aware pricing lens + [from,to) buy-back export

**Status:** SCOPE REVIEW R1 FOLDED (2026-07-13) — AGY PASS-with-notes×3 + Codex BLOCK×5, ALL ground-truthed
REAL and folded as **W4-SR-1..8** below. Awaiting R2 → build.

## SCOPE REVIEW R1 (2026-07-13): AGY×3 + Codex×5 — all folded

| # | Auditor | Finding | Fold |
|---|---|---|---|
| **W4-SR-1** | AGY-1 (P1) | scalar "display cache" divergence: post-activation edits append history but the Products CSV (3766) + editor UI keep reading the scalar — instant permanent drift the parity sentinel is blind to | BOTH belts: (a) post-activation, every "current rate" DISPLAY (products CSV, editor selects, store editor) reads `Pricing.rateAsOf(…, now)` — the lens is the single source of truth for "current"; (b) the server pricing-change route DUAL-WRITES the scalar into the catalogue (kept as a coherent legacy cache for anything unrewired). New sentinel S-W4-9 (cache coherence: after a post-activation edit, lens(now) == displayed scalar) |
| **W4-SR-2** | AGY-2 (P1) | `_exportFICSV` prints the TEXT of the live scalars (`l.product.franchiseDiscount`, `sd.baseDisc`) next to lens-computed dollars → a CSV whose printed % contradicts its own math | ALL display/text columns (report + CSV) print the lens-resolved per-line rate + its source (product-override vs default) — the live `p`/`office` objects are fully bypassed for historical lines |
| **W4-SR-3** | AGY-3 (P2) | stamps at DRAFT-creation are exploitable (create a draft, wait out a price hike, commit at the old stamp) | stamps are written at COMMIT time only — the durable status transition (submit/dispatch), never draft creation; sentinel S-W4-7 covers a draft created before a price change and committed after (stamp = commit-day values) |
| **W4-SR-4** | Codex-1 | KEYING: invoices bill rows keyed to the OFFICE id (`cockburn_office`) while topology plans key pricing by the RETAIL store id (`cockburn`) — a served history keyed one way misses rows keyed the other, silently reopening scalar fallback | the CANONICAL pricing key is the **stable `franchiseeId`** (OS-SR-8): the config echo serves `{franchiseeId → history}` + a resolver map `{storeOrOfficeId → franchiseeId}` covering the office AND every retail store; `Pricing.rateAsOf` resolves any billing key through the map. One franchisee = one rate set (matches today's office-default model + multi-store franchisees) |
| **W4-SR-5** | Codex-2 | the "malformed served history → scalar fallback" idea CONTRADICTS server parity (the server fails closed to null, never a fallback) and reopens scalar drift | PINNED: the scalar fallback applies ONLY when history is ABSENT for that franchisee (pre-activation). A PRESENT-but-malformed series fails CLOSED exactly like the server — the line surfaces `NOT SET / PRICING DATA ERROR` (0%, loudly) + a report-level banner; NEVER the scalar. Parity sentinel needs no special cases; S-W4-6 asserts the closed behaviour |
| **W4-SR-6** | Codex-3 | `_doAddProduct` (index.html:3379-3392) is an UNCOVERED pricing writer — a new product created with a discount publishes a scalar with no history append | the writer inventory now pins ALL THREE writers (`_setProductFranDisc`, the office-default editor, `_doAddProduct`); post-activation each routes through the server append path (add-product includes the initial override interval in the same call); sentinel S-W4-8 |
| **W4-SR-7** | Codex-4 (+AGY W4-D1 answer) | leaving the PRICE half optional leaves the headline bug half-alive (live `p.price` at 4774 still rewrites old dollar amounts); S-W4-2 must assert DOLLARS not percentages | **W4-5 PROMOTED TO CORE SCOPE** (decided by convergence: both auditors + engineer YES; Kunal veto open): `sellAtSupply` + `discAtSupply` stamped at COMMIT time on HO→franchise supply rows; the invoice PREFERS stamps, lens for legacy rows; S-W4-2 asserts the dollar columns of a past line are bit-stable across BOTH a discount change and a price change |
| **W4-SR-8** | Codex-5 | the scope orders "import `validPricingSeries`/`isIsoUtc` from topology.js — no re-derivation" but topology.js does NOT export them (module.exports line 535) — an implementer would re-derive, the exact drift W4 forbids | W4 build ADDS the two validators to topology.js's `module.exports` (additive, zero behaviour change; topology-proof 191 re-run to prove it) so `buybackExport.js` imports the real primitives |
| **W4-SR-9** | Kunal (2026-07-13) | ARCHIVAL interplay: Chunk-8 archival MOVES rows past the cutoff to `StockTransactions_Archive` (retained in full, never deleted) — devices drop them locally; the buy-back window and old-period invoices can reach INTO the archive | PINNED: (a) stamps survive archival BY CONSTRUCTION (they are row fields; archival moves whole rows); (b) the buy-back export engine takes rows from a LIVE+ARCHIVE union — the gated route (staging-apply) queries both lists for the window, and the ENGINE asserts the supplied rows COVER the window (a coverage manifest: refuses to emit a settlement if the row set's date span has a gap vs [from,to)) — fail closed, never a silently short settlement; (c) an old-period FRANCHISE INVOICE past the live window uses the existing Chunk-8 on-demand archive read (Director/HO gated) — a report whose range reaches past the local window SURFACES that older lines need the archive pull, never silently rendering a partial invoice; sentinel S-W4-10 (engine refuses a gappy row set; stamped archived-shape rows resolve identically) |

---
**Original map + design below, as amended by the folds above.**

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
- `Pricing.rateAsOf(billingKey, productId, dateISO)` — billingKey (office OR retail store id) resolves through the served `{storeOrOfficeId → franchiseeId}` map to the canonical **franchiseeId-keyed** history (W4-SR-4), then
  (`{ storeId: { '*': [{rate,from,to}], productId: [...] } }`) adopted from the config pull when the server
  serves it (LA-CHANGES §config; version-echoed like accessPolicy).
- **The algorithm IS the server's** (`resolvePricingForProduct` semantics: strict series validation, override
  → default fallback, fail-closed null on malformed, `[from,to)` exclusive) — enforced by a PARITY SENTINEL
  that requires the REAL `azure-functions/src/functions/topology.js` in the harness and compares verdicts
  across a fixture matrix (the S-247 pattern; closes the client-drift class by construction).
- **Fail-safe fallback (the AA "inert pre-activation" pattern):** no history served, or no series for that
  store → EXACTLY today's behaviour (office scalar default + per-product override + zero-means-inherit).
  Zero behaviour change until the server publishes histories. **W4-SR-5 pin:** the fallback applies ONLY when
  history is ABSENT for that franchisee; a PRESENT-but-malformed series fails CLOSED like the server (line =
  NOT SET / PRICING DATA ERROR, loudly) — NEVER the scalar.

**W4-2 REWIRE THE INVOICE (report + CSV).**
- Each line's rate = `Pricing.rateAsOf(office.id → falling back per current override semantics, t.productId,
  t.date)`. Same filters, same structure — only the RATE source changes.
- ALL text/% columns (report + CSV) print the lens-resolved per-line rate + source, bypassing the live
  `p`/`office` objects entirely (W4-SR-2).
- `discMissing` becomes per-line-date (a line whose date no interval covers surfaces as `0% (NOT SET)` —
  today's honest-surfacing behaviour, never silent).
- Result: a discount change today creates a NEW interval; past invoice lines keep resolving their own dates'
  intervals — **retroactive rewriting is dead** (for the discount; see the honest limitation below).

**W4-3 THE WRITE PATH (Director pricing edits).**
- Writers = ALL THREE: `_setProductFranDisc`, the office-default editor, AND `_doAddProduct` (W4-SR-6).
- Pre-activation: scalar edits exactly as today.
- Post-activation (history present for that store): the edit calls the server pricing-change route (LA §2 —
  `appendPricingForKey` server-side, effective NOW), then adopts the echoed new history. The client NEVER
  writes history locally. The server route DUAL-WRITES the scalar (coherent legacy cache) AND every "current
  rate" display (products CSV, editor selects) reads `Pricing.rateAsOf(…, now)` post-activation (W4-SR-1). Editor gains an
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

**W4-5 (CORE SCOPE per W4-SR-7; commit-time per W4-SR-3) write-time price/discount stamps.**
The converged spec fixes the DISCOUNT history; the invoice still reads the LIVE `p.price` for past lines —
a sell-price change today still drifts old invoices' dollar amounts (pre-existing, outside the org spec).
Proposal: from W4 onward, stamp `sellAtSupply` + `discAtSupply` on HO→franchise supply rows AT WRITE TIME
(the invoice prefers stamps when present, lens for legacy rows). Freezes both numbers per row forever,
belt-and-braces with the lens. Stamps are written at COMMIT time only (the durable submit/dispatch transition — never at draft creation,
W4-SR-3). Decided YES by convergence (both auditors + engineer); Kunal veto remains open.

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
  - S-W4-7 STAMPS: a draft created BEFORE a price change and committed AFTER stamps commit-day values
    (W4-SR-3); stamped rows prefer stamps; legacy rows use the lens.
  - S-W4-8 ADD-PRODUCT WRITER: post-activation `_doAddProduct` with a discount appends the initial override
    interval via the server route (no orphan scalar) (W4-SR-6).
  - S-W4-9 CACHE COHERENCE: after a post-activation edit, lens(now) == every displayed "current rate"
    (products CSV + editor) (W4-SR-1).
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
- **W4-D1: RESOLVED YES — Kunal CONFIRMED 2026-07-13** (plus by convergence: (Kunal asked for the layman explanation; engineer recommended yes;
  AGY "strongly recommend"; Codex "must not be optional"). Commit-time stamping per W4-SR-3.
