# OS-W4 SCOPE — Era-aware pricing lens + [from,to) buy-back export

**Status:** R5 RECEIVED (2026-07-14) — AGY×3 + Codex×16 BANKED, FOLD PENDING (next session; see the R5 section
at the end). R1→SR-1..8 (+Kunal SR-9); R2→SR-10..16; R3→SR-17..28; R4→SR-29..44 + model revision.

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
| **W4-SR-10** | Codex R2-1 | the fallback trigger was loose: a served config whose RESOLVER MAP omits one billing key (e.g. `cockburn_office`) would read as "no series for that store" → scalar fallback → the drift bug reopens through a config gap | PINNED TRIGGER: the scalar fallback applies ONLY when NO pricing config was served at all (pre-activation). Once ANY pricing config is present, a FRANCHISE billing key (isFranchise office/store) that the resolver map does not cover = present-but-bad config = FAIL CLOSED (NOT SET / PRICING DATA ERROR), never scalar. Sentinel S-W4-11 |
| **W4-SR-11** | Codex R2-2 | the S-W4-6 sentinel text still described the ABANDONED behaviour ("fallback + surfaced warning") — it would encode the wrong assertion or force a parity special-case | S-W4-6 text corrected to the W4-SR-5 pin: present-but-malformed ⇒ fail closed (NOT SET / error surfaced), NEVER scalar; parity with the server resolver needs no special case |
| **W4-SR-12** | Codex R2-3 | the invoice bills the RECEIVE-created `transfer_in` rows (phase2.js:312-332), not the submit-created dispatch rows — stamps only at submit/dispatch leave the invoice-eligible row unstamped (submit Monday @100, price→150, receive Wednesday ⇒ unstamped Wednesday row) | stamps are CAPTURED at SUBMIT (the pricing-commitment moment, W4-SR-3) onto the transfer's item lines, and PROPAGATED onto the `transfer_in` rows the receive creates (a copy, not a recompute). Direct delivery-category HO-supply entries stamp at their own commit. Sentinel S-W4-7 uses Codex's exact submit→price-change→receive repro (stamp = submit-day values on the RECEIVED row) |
| **W4-SR-13** | Codex R2-4 | stamps would be DROPPED by sync: `_toSharePoint`/`_fromSharePoint` enumerate fields (sync.js:1074-1168) — a second device pulling the row gets no stamps and recomputes (S-W4-2 could pass locally while cross-device invoices still rewrite) | the touch list adds sync.js field mapping (`SellAtSupply`/`DiscAtSupply` both directions) + the ingest-validation schema (LA-CHANGES item) + the SharePoint columns on `StockTransactions` AND `StockTransactions_Archive` (staging-apply runbook). Sentinel S-W4-12: a `_toSharePoint`→`_fromSharePoint` round-trip preserves the stamps bit-exact |
| **W4-SR-14** | Codex R2-5 | the export-engine signature predated the franchiseeId re-keying — passing the natural config shape (`{fr_a:…, fr_b:…}`) into a resolver expecting one product map reads as malformed keys; the preselection contract was unpinned | pinned signature: `buildBuybackExport({ franchiseeId, rows, pricingMap, window, products })` where `pricingMap` is the PRESELECTED single-franchisee `{'*'|productId → series}` map; the engine validates the shape with the real validators and REFUSES a franchisee-keyed map (malformed). Sentinel: the wrong-shape map fails closed |
| **W4-SR-15** | AGY R2-1 (P1) | my W4-SR-1(a) was IMPOSSIBLE as written: the Products CSV / global catalogue editor have NO franchisee context — `rateAsOf(billingKey,…)` cannot be called there | W4-SR-1(a) AMENDED: generic global views (products CSV, catalogue editor) keep displaying the GLOBAL scalar — coherent because W4-SR-1(b)'s server dual-write maintains it; the lens is the "current" source only where a franchisee context exists (office/store screens, the invoice). S-W4-9 asserts coherence via the dual-written scalar for global views + lens for contextual views |
| **W4-SR-16** | AGY R2-2 (P1) | the GLOBAL product discount editor vs franchiseeId-keyed history had no bridge — a global edit has no franchiseeId to append under | AGY option 1 adopted + today's semantics preserved: the served pricing config = `{ global: { productId: series }, franchisees: { fid: { '*': series, productId?: series } } }`. PINNED RESOLUTION CHAIN (most specific first, mirroring today's product-override→office-default): **franchisee[productId] → global[productId] → franchisee['*']** — each tier resolved by the SAME server algorithm (three parity-checked calls, composition covered by fixture matrix). Writers: global product editor appends to `global[productId]`; office-default editor to `franchisees[fid]['*']`; the topology wizard's per-product conversion rates (D-OS) land in `franchisees[fid][productId]` (already how W2 plans write). Sentinel S-W4-13: the chain order + each tier's [from,to) as-of resolution |
| **W4-SR-17** | AGY R3-1 + Codex R3-7 (CONVERGED) | the export engine received only the preselected franchisee map — mathematically blind to the `global[productId]` tier (client resolves 20% global, export resolves 10% default) | signature amended: `buildBuybackExport({ franchiseeId, storeId, rows, pricing: { franchiseeMap, globalMap }, window, products, coverage })` — the engine executes the SAME three-tier chain as the client (shared fixture matrix proves engine==lens) |
| **W4-SR-18** | AGY R3-2 + Codex R3-1/R3-12 (CONVERGED) | stamp TRANSPORT gaps: the transfer step payload serializes only `productId`+`sentQty` (phase2.js:81) and records.js:321 reconstructs no stamps; the Transfers list mapping was omitted; the touch list omitted phase2.js/records.js entirely | stamps ride the transfer item lines through EVERY channel: the step payload (phase2.js `_submitPayload` + records.js reconstruct), the Transfers SharePoint columns + sync mapping, and local Dexie. Touch list adds **phase2.js + records.js**. Cross-DEVICE sentinel: submit on A → price change → pull + receive on B ⇒ B's `transfer_in` carries A's submit-day stamps |
| **W4-SR-19** | Codex R3-2 | the DISCREPANCY-RESOLUTION top-up (phase2.js:410, used by resolveFlag/resolveAllFlags) creates invoice-eligible `transfer_in` rows outside receive() — unstamped (submit 10, receive 5, adjust to 8 ⇒ 3 unstamped billed units) | ALL `transfer_in`-creating paths propagate the transfer's submit stamps: receive(), the adjusted-qty top-up, AND the remainder-return row. Sentinel replays Codex's exact 10→5→8 repro asserting stamps on the top-up line |
| **W4-SR-20** | Codex R3-3 | archived stamp TRANSPORT unpinned: `_fromArchive` (sync.js:1173) reconstructs an enumerated field set — archive columns alone don't survive the pull (an archived stamped row comes back stampless, reopening live-price calc) | `_fromArchive` maps the stamp fields (+ the archive-write path preserves them); sentinel S-W4-10 extended: an archived-shape row round-trips stamps bit-exact |
| **W4-SR-21** | Codex R3-4 | fail-closed pricing × commit-time stamping undefined: stamping null-as-0 turns a config error into an authoritative 0% discount; not stamping lets a later config repair retroactively change the line | PINNED: at submit, a PRICING DATA ERROR (present-but-malformed config) REJECTS the HO→franchise commit — the Director fixes pricing first; pre-activation (no config) stamps from today's scalar chain as normal. Null is NEVER stamped; no durable unresolved-billing rows exist |
| **W4-SR-22** | AGY R3-3 + Codex R3-5 (CONVERGED) | the three-tier chain can't distinguish MALFORMED from UNCOVERED (`resolvePricingForProduct` returns null for both) — a corrupted high tier silently falls through to a valid lower tier | PINNED ORDER OF OPERATIONS: WHOLE-CONFIG VALIDATION FIRST (every series in BOTH maps via `validPricingSeries` — the W2 whole-map discipline), THEN tier resolution. Any malformed series anywhere in the consulted config ⇒ the WHOLE resolution fails closed (PRICING DATA ERROR) before any tier is consulted; after validation, a tier's null = genuinely uncovered ⇒ fall through; all uncovered ⇒ NOT SET. Sentinels: malformed high tier (no fall-through), valid gap (falls through), malformed UNRELATED sibling series (fails closed) |
| **W4-SR-23** | Codex R3-6 | the scope CLAIMED the wizard already writes `franchisee[productId]` — FALSE: the planner appends only `'*'` (topology.js:461/480/498); the most-specific tier has NO writer | claim corrected: the tier stays in the chain (forward-compatible, validated, parity-tested) but is ALWAYS UNCOVERED until its writer lands — pinned as a **W5 deliverable** (the wizard's per-product conversion rates, D-OS: `intent.productRates` appended per-product by the planner). No W4 code pretends otherwise |
| **W4-SR-24** | Codex R3-8 | the export wasn't bound to the bought-back STORE (franchisee owns A+B, only A bought back ⇒ B's rows inflate A's settlement) | `storeId` added to the signature (matches the buyback plan's export window, topology.js:517); the engine VERIFIES every supplied row belongs to that store and REFUSES otherwise (the route pre-filters; the engine re-checks — belt and braces) |
| **W4-SR-25** | Codex R3-9 | `[from,to)` exactness is IMPOSSIBLE on `t.date` (a Perth CALENDAR day) vs era endpoints (UTC instants): 03:59Z and 04:01Z rows share one date string | the settlement boundary field = the row's UTC INSTANT (`createdAt` / SharePoint `Timestamp`, validated ISO after normalization); a window-adjacent row lacking a valid instant ⇒ manifest failure (refuse, never guess from the calendar day). The INVOICE report keeps calendar-day filtering (display granularity); the SETTLEMENT uses instants |
| **W4-SR-26** | Codex R3-10 | the coverage manifest can't be INFERRED from the rows (an omitted interior row leaves the span unchanged; a legit quiet month looks like a failed query) | `coverage` becomes explicit QUERY-COMPLETION EVIDENCE produced by the gated route: attestations that (a) the ARCHIVE query fully enumerated `[from, min(to, archiveCutoff))`, (b) the LIVE query fully enumerated `[max(from, archiveCutoff), to)`, (c) the `archiveCutoff` is supplied and consistent. The engine validates the attested union == `[from,to)` and refuses otherwise |
| **W4-SR-27** | Codex R3-11 | the ACTIVATION fact wasn't durable: malformed v2 or an offline restart either silently prices from stale history or re-enables the forbidden scalar fallback | pricing-config adoption mirrors accessPolicy: MONOTONIC version + DURABLE persistence (Dexie + `bob_pricing_ver`). Once any valid config is adopted the fact is permanent: a malformed/older v2 is REJECTED and v1 KEPT (append-only history stays true for every date it covers — surfaced as a staleness warning, never a scalar revert); offline restarts load the durable copy |
| **W4-SR-28** | Codex R3-12 | the authoritative LA doc carried NO pricing-change route, dual-write, stamp validation, or archive stamp columns — the three post-activation writers had no implementable server contract | `AZURE-CHUNK-ORG-LA-CHANGES.md` gains §4-W4: the authenticated pricing-change route (Director `editPricing` sudo → `appendPricingForKey` server-side → ATOMIC history+scalar dual-write via the catalogue path → version bump + echo), stamp ingest validation, stamp columns on `StockTransactions`/`_Archive`/`Transfers`, and the export route's coverage attestations |

## ⚠ MODEL REVISION (R4) — pricing re-keyed BACK to PER-STORE; the franchiseeId indirection is DROPPED
Codex R4-4 exposed an architecture clash: the R2 franchiseeId-keyed shared map violates the W2 planner's
per-store pricing⟺era ALIGNMENT invariant (franchisee owns A since Jan, acquires B in July ⇒ the shared
Jan-rooted map overlaps B's Jan–July HO era ⇒ `pricingAlignsWithEras` fails, correctly). The fix keeps the
LAYERS distinct and drops the indirection entirely:
- **Canonical pricing key = the STORE id — including OFFICE store rows.** The W2 planner stays untouched
  (per-store maps, per-store alignment). The invoice bills OFFICE-keyed rows, so the OFFICE carries its own
  `'*'` series (the franchisee's negotiated rate — exactly where `office.franchiseDiscount` lives today).
- **The resolver map is DELETED.** The three-tier chain becomes
  `billingStore[productId] → global[productId] → billingStore['*']` where billingStore = the row's own
  storeId. No indirection = W4-SR-10's map-gap class and AGY R4-2's referential-integrity class VANISH.
- **Series lifecycle:** ONBOARD seeds the new office's `'*'` series in the same plan that creates the office;
  CONVERT/ADD under an existing office are rate-inherited (the office already carries the series); existing
  offices (cockburn_office) get their opening series from the activation seed (runbook). Retail-store series
  continue to exist for planner/era coherence + any future direct supply.
- Writers: global product editor → `global[productId]`; office-default editor → `office['*']`;
  W5 wizard per-product rates → `store/office[productId]` (still writer-less in W4, per W4-SR-23).

## SCOPE REVIEW R4 (2026-07-14): AGY BLOCK×2 + Codex BLOCK×14 — all folded (W4-SR-29..44)

| # | Auditor | Finding | Fold |
|---|---|---|---|
| **W4-SR-29** | AGY R4-1 | a malformed FIRST config (v1) is rejected at adoption, storage stays empty, and W4-SR-10 reads that as "never served" → scalar fallback bypasses fail-closed at the worst moment (activation) | a durable `bob_pricing_activated` flag is written the FIRST time the pricing key is ever OBSERVED (before/regardless of validation); activated + no valid adopted config ⇒ FAIL CLOSED (PRICING DATA ERROR), never scalar |
| **W4-SR-30** | AGY R4-2 | resolverMap referential integrity (a fid pointing nowhere → silent fall-through to global) | MOOT — the resolver map is deleted by the R4 model revision; the class no longer exists |
| **W4-SR-31** | Codex R4-1 | keeping valid v1 after rejecting v2 is NOT historically safe: v2 may CLOSE v1's open interval (10%→20%); stale v1 prices every post-change row at 10% | once a NEWER version is OBSERVED but not adoptable, a durable `pricing_stale` state fails CLOSED for pricing-sensitive reads + HO→franchise submits BEYOND the last CONFIRMED closed boundary (rows before it stay priceable from v1's closed intervals); cleared only by adopting a valid config |
| **W4-SR-32** | Codex R4-2 | the history→scalar dual-write isn't atomic TO READERS (crash between = lens shows new, global views show old) | LA §6 amended: the pricing-change route journals `pricing_pending`, writes history + scalar, then PUBLISHES both under ONE version bump (readers adopt version-consistent snapshots only); reconcile resumes a crash — the standard pending/2-phase discipline |
| **W4-SR-33** | Codex R4-3 | no CAS / idempotency on pricing changes (two tabs from base v7 → lost interval; a lost-response retry double-appends) | the route requires `expectedVersion` (CAS, the AA-03 baseVersion pattern) + a client-minted stable `opId` (idempotent replay returns the prior result); folded into LA §6 |
| **W4-SR-34** | Codex R4-4 | franchisee-keyed config vs the per-store planner state (the architecture clash) | RESOLVED by the R4 MODEL REVISION above — pricing stays per-store; W2 invariants untouched |
| **W4-SR-35** | Codex R4-5 | resolverMap had no lifecycle owner (convert commits, map never updated → every read/submit for that store fails closed) | map deleted (model revision); the remaining lifecycle (office-series seeding at onboard + activation seed for existing offices) is pinned there |
| **W4-SR-36** | Codex R4-6 | coverage partitioned on an event-date archiveCutoff, but Chunk-8 archives by MONOTONIC ID (AZURE-CHUNK8-SCOPE.md:87) — a June offline row uploaded in July has a live ID; date-partitioned attestations truthfully miss it | attestations reworked: the LIVE query enumerates the FULL event window AND the ARCHIVE query enumerates the FULL event window; the engine UNIONS + DEDUPES by TransactionId; attestations assert full-window enumeration of BOTH lists (no partition seam) |
| **W4-SR-37** | Codex R4-7 | the OS-SR-10 grace window can admit a valid pre-buyback row AFTER an immediately-generated export (settlement silently incomplete) | the export input gains a `graceClosed` attestation (the store's old-era flush authorization consumed/expired); WITHOUT it the engine emits the settlement marked **PROVISIONAL** (regenerable); FINAL requires graceClosed — never silent incompleteness |
| **W4-SR-38** | Codex R4-8 | the export needs usage/retail-profit but server rows lack `unitPriceAtTime` + `stockFrom/stockTo` (sync.js:1087 drops them; sale vs wastage indistinguishable server-side; catalogue price changes rewrite retail revenue) — the K4 pattern ALREADY stamps unitPriceAtTime locally (index.html:2126) | sync mapping + ingest validation extended to carry `UnitPriceAtTime` + `StockFromStoreId`/`StockToStoreId` (existing local fields, currently client-only); the export engine's retail-profit reads the K4 stamp (frozen), legacy rows fall back per K4's own rule (surfaced) |
| **W4-SR-39** | Codex R4-9 | stamps validated independently — SellAtSupply without DiscAtSupply accepted → frozen price mixed with a LIVE discount (still mutable) | BOTH-OR-NEITHER invariant at ingest AND in the engine/invoice: one stamp without the other = malformed row (rejected at ingest; fail-closed line client-side). Legacy = neither (lens path) |
| **W4-SR-40** | Codex R4-10 (P2) | §6 named SharePoint columns on `Transfers` — that list is an EMPTY never-wired scaffold deleted at phase cleanup (AZURE-CHUNK4-SCOPE.md:118); transfer items actually ride `RecordSteps.Payload` JSON | §6 corrected: the server-side stamp transport for transfer items = `Payload.items[].sellAtSupply/discAtSupply` inside the steps ingest validation (both-or-neither per item); no Transfers columns exist or are created |
| **W4-SR-41** | Codex R4-11 | in-transit transfers submitted PRE-W4 have no stamps and no history to reconstruct them; receiving post-activation can't copy submit-time values | pinned cutover order (runbook): at ACTIVATION — before the pricing-change route is enabled — a one-time migration stamps all in-transit HO→franchise transfer items from the CURRENT values (provably correct: no pricing change can have occurred between their submit and the migration, because the change route doesn't exist yet); only then is the route enabled |
| **W4-SR-42** | Codex R4-12 | "whole-config validation" validated series VALUES but not the SCHEMA (exact root keys, safe ids, `global['*']` would smuggle an unauthorized global-default tier) | a full config-schema validator is pinned: exact root fields (`version`, `global`, `stores`), reqId-safe keys everywhere, `global` = product keys ONLY (no `'*'` — no global default tier exists), per-store maps = `'*'`/productId, every series `validPricingSeries`. Any deviation ⇒ the config rejected whole (adoption keeps prior per W4-SR-31) |
| **W4-SR-43** | Codex R4-13 | `_doAddProduct` needs product-create + initial global history ATOMICALLY (orphan history or discount-less product on partial failure) | the add-product-with-discount server op = ONE idempotent journaled operation (pending → catalogue create + `global[productId]` opening interval + scalar dual-write → publish under one version); client sends one opId |
| **W4-SR-44** | Codex R4-14 (P2) | the `editPricing` sudo purpose isn't in `validateUser.js` SUDO_PURPOSES nor the client sudo prompt map — proof minting would reject the new route | build surface extended: `validateUser.js` gains `editPricing`; the client sudo map gains the prompt key; both in the touch list + LA §6 |

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
  - S-W4-6 MALFORMED-SERVED-HISTORY: a bad series in the adopted map → FAIL CLOSED (NOT SET / PRICING DATA
    ERROR, loudly surfaced) — NEVER the scalar (W4-SR-5/11).
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

## ⚠ R5 RECEIVED (2026-07-14): AGY BLOCK×3 + Codex BLOCK×16 — FOLD PENDING (next session)
R5 attacked the R4 model revision itself and broke parts of it. The 19 findings are banked VERBATIM in
`audit-artifacts/w4-scope-r5-verdicts.md` (gitignored raw) + summarized here; folding them is the FIRST task
of the next session (fresh context — several folds reshape W2-planner scope and need careful design, not
tail-of-session patching).

**The R5 headline findings (all to be ground-truthed + folded as W4-SR-45..63):**
1. AGY-1: office-default edits must FAN OUT to the office AND all active retail stores of that franchisee
   (else invoice and buy-back price from diverging series).
2. AGY-2: the activation seed must provision '*' series for offices AND every active retail store.
3. AGY-3 + Codex-2: "rate inheritance" is impossible for the pure engine (no map, no DB) — ADD/CONVERT must
   CLONE the office's current series into the new store's map, planner-side, and the planner must derive or
   validate the rate against the office (client-supplied intent.rate alone contradicts the model).
4. Codex-1: ONBOARD does NOT currently create an office store/era/pricing in the plan — "W2 untouched" is
   FALSE; the planner needs a real extension (office store row + era + '*' series in one plan).
5. Codex-3: a dormant device that never observed activation bypasses the activation flag — needs a
   config-handshake/build-marker gate on pricing-sensitive writes post-W4.
6. Codex-4: the activation seed needs an explicit HISTORICAL BASELINE policy (backdate to era start vs
   activation-from — either invents or orphans history without a pinned frozen-legacy rule + sentinel).
7. Codex-5: pricing_stale needs a PER-RESOLUTION safe horizon (per store/product across all consulted tiers),
   not one config-level boundary.
8. Codex-6: the scalar's publication version must ride the master_data snapshot so clients can prove
   scalar+history came from the same publication.
9. Codex-7/8: add-product needs the SAME CAS contract as pricing edits (it mutates global); opId replay must
   bind to canonical payload+actor+target and be checked BEFORE CAS.
10. Codex-9: the live+archive union needs tombstone application across lists + fail-closed on non-identical
    same-ID duplicates (sync.js:1208 precedent).
11. Codex-10: an archive MOVE between the two queries loses a row though both attest full enumeration — bind
    both reads to one archive run/version or hold the archive maintenance lock.
12. Codex-11: graceClosed ≠ admitted writes COMMITTED — FINAL needs a drained-ingest watermark attestation.
13. Codex-12: sale-vs-wastage classification rides TEXT labels (stockFrom/stockTo), not the store-ID fields
    (both null for manual movements, index.html:2090) — persist the labels or a validated movement category.
14. Codex-13: the migration premise is FALSE — price/discount edits exist TODAY (index.html:3400/3342);
    unstamped in-transit transfers need manual reconciliation or a genuinely historical source.
15. Codex-14: migrated stamps need a cross-device publication path (an immutable stamp-migration step/fold
    rule — the original submit steps are already synced and can't be replayed).
16. Codex-15: the engine signature (SR-17) must be re-pinned post-revision ({storeMap, globalMap}).
17. Codex-16: SellAtSupply/UnitPriceAtTime must use the shared money cap/precision policy (finite 1e308
    passes "finite non-negative" and overflows totals).

**Session hand-off note:** the fold of R1-R4 (44 folds) stands; R5 shows the R4 revision needs one more
design iteration (write FAN-OUT + planner-side seeding/cloning + activation baseline policy) and suggests
evaluating DECOMPOSITION of W4 into sub-waves (lens/invoice · stamps/transport · export engine · server
write contracts) if R6 does not converge.
