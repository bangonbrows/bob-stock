# OS-W4.3 BUILD (commit-time money stamps · transport · pricing bases) — wave record + audit response log

## BUILD SHIPPED 2026-07-19 (per the FULLY LOCKED `AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md`, incl. both approved amendments)

**What the wave does (plain English):** every franchise supply line now gets its money — the sell price
AND the discount — permanently stamped onto it the moment the stock is sent. The lens (W4.2) froze the
discount per date; the stamps freeze BOTH numbers on the row forever, so even a future catalogue PRICE
edit can no longer rewrite an old invoice's dollars. Belt and braces, per the frozen spec.

### Built pieces
| Piece | Where | Spec pin |
|---|---|---|
| **Stamp capture at SUBMIT** — non-draft create + submitDraft, gated on the same billing predicate as the pricing gate; lens rate as-of NOW (post-activation) or the byte-identical legacy computation (pre-activation); a pricing error or out-of-policy pair REJECTS the commit; basis `submit-stamped`; both-or-neither by construction | phase2.js `_stampItems` + the two submit sites | P1 (SR-3/7/12/21) |
| **Direct-log HO-supply path** — a manually logged delivery/transfer-category movement from head_office into a franchise store is its own pricing-commitment moment: the same gate holds it, the same stamps freeze at its commit | index.html `_logSubmit` path | P1 |
| **Stamp-at-receive** — a stampless (pre-W4/in-transit-at-cutover) submit received on a W4 build mints stamps: discount as-of the SUBMIT instant, sell = the current catalogue price; failure ⇒ both-or-neither ⇒ durably `legacy-lens` | phase2.js `_stampAtReceive` | P4 (SR-59/60) |
| **Inheritance** — the receive row, the discrepancy top-up, the remainder-return, conflict corrections, AND the in-transit cancel's return rows all inherit the item's canonical stamps | phase2.js `_stampTxns` at every batch write | P2 (SR-67/84/88) |
| **Transport** — per-line stamps + `basis` ride the submit/receive/resolve step payloads; the fold maps them explicitly with BASIS PRECEDENCE (`submit-stamped` is permanent; a basis-less receive downgrades ONLY a stampless submit); the resolve payload publishes the PINNED stamps into item state | phase2.js payloads + records.js fold | P3/P5 (SR-13/85/86/87/97) |
| **Money-aware conflict identity** — equal quantities with DIFFERING stamps are a conflict (absence is not a differing claim); the resolve settles it cross-device | records.js `_receiveSummary`/`_detectReceiveConflict` | P5 (SR-66) |
| **Row sync + archive** — `SellAtSupply`/`DiscAtSupply` + the export inputs (`UnitPriceAtTime`, `StockFromStoreId`/`StockToStoreId`, the bounded `StockFrom`/`StockTo` labels) in `_toSharePoint`/`_fromSharePoint`/`_fromArchive`, with the ONE canonical ingest pin: JSON number type, finite, sell ≤ 1M, disc 0-100, both ≤ 2dp, both-or-neither — violation REJECTS the row | sync.js | P3/P6 (SR-39/62/89) |
| **Valuation precedence** — the invoice values a transfer-linked row: row stamps → the transfer ITEM's canonical stamps (transferId lookup) → the lens; a one-sided row stamp is a fail-closed line | index.html `_franchiseInvoiceData` | SR-97/114 |
| **The canonical deep hash** — a recursive sorted-key serializer replaces the old replacer trick (⚠ which had a PRE-EXISTING Chunk-4 bug: nested item fields were invisible to the divergence hash since D4-I — two transfers differing only inside `items[]` hashed identically and silently first-writer-won; flagged Kunal-visible, fixed with its own regression test); divergence is decided by RECOMPUTING a **version-normalized semantic canonical form** (v4: legacy absence → the exact W4 defaults; explicit-null ≡ absent; STRICT schema projection strips future-version fields) — so the hash-algorithm migration and future schema changes can never false-diverge, while genuine stamp/item differences still conflict; `resolvesBackfillHashes` on a resolve SETTLES a divergence (it used to re-flag forever — also pre-existing, also fixed) | records.js | P3 (SR-105/106/113/121/128) |

### Sentinels S-276..S-282 (each with matching mutation cases; parity 273 ↔ 273)
S-276 commit-time stamps end-to-end (draft→submit→receive→invoice; the submit-day dollars survive both a
price and a rate change) · S-277 round-trip bit-exact + every ingest-reject class on live AND archive
shapes · S-278 inheritance (flagged receive + top-up + cancel-return) · S-279 stamp-at-receive (submit-day
rate, receive-day price, bit-stable after edits) · S-280 money conflicts + resolve publication · S-281
basis precedence + tier-2 valuation · S-282 deep hash (item-level distinctness, cross-version
same-reality identity, future-field stripping, divergence convergence). Mutation cases: S-276, S-277,
S-278/b, S-279, S-280, S-281/b, S-282/b/c — **11 new (309 total)**; 5 pre-existing cases re-anchored
(S-262, S-150b, S-70, S-174, S-185) after their target lines moved.

## GATES (clean code, 2026-07-19)
smoke **273/273** · topology **256/256** (no server change this wave) · static PASS · CSP PASS · dupes
grep clean · anchor scan **309/309** · scoped saboteur (11 new + 5 re-anchored): **16/16 CAUGHT, 0 BLIND,
0 skipped, 0 INFRA** (single clean detached run, baseline 273/273) · **FULL SWEEP: 309 CAUGHT, 0 BLIND,
0 skipped, 0 INFRA-FAIL of 309 (single clean detached run)** — every mutation in the harness, the whole
app plus the complete W4.3 set, detected.

## ROUND 1 (2026-07-19): AGY BLOCK ×4 (+1 note upheld) · Codex BLOCK ×4 — ALL EIGHT REAL, all fixed @ c6918ea/0810de4

| # | Finding | Ground truth | Fix |
|---|---|---|---|
| Codex-1 (P1) | the FOUR authority fields (`pricingVersion`/`catalogueVersion`) absent throughout — amendment 1 rev-3 requires all four per stamped line | **REAL — a genuine spec-implementation miss by the engineer** (only the two money fields were built) | full tuple end-to-end: capture (`_writeStamp` + `_authorityVersions`), payloads, fold (all-four-or-none via `_fullTuple`), rows + ingest (`_readRowStamps` tuple form), archive, conflict identity, canonical item form |
| Codex-2 (P1) | backfill-only stamps trusted by the invoice instead of server-resolved valuation / "valuation pending sync" (amendment 2) | **REAL** — the untrusted marking was never built client-side | genesis backfill stamps → `_stampsUntrusted`; any STEP-sourced tuple (receive/resolve) clears it; invoice tier-2: untrusted ⇒ server-resolved row fields (`_rvSell`/`_rvDisc`, mapped at ingest w/ the same policy, malformed pair DROPPED not row-rejected) or a loud `VALUATION_PENDING` line — never the untrusted stamps, never live pricing |
| Codex-3 (P1) | a missing/non-numeric catalogue price commits a genuine $0 stamp | **REAL** — silent data loss for RETAIL products; a consumable's honest billing value IS 0 | retail-no-price REJECTS the submit (Director must set the price); at receive it drops to durable legacy-lens; consumables stamp the honest 0 |
| Codex-4 ≡ AGY-3 (P1) | delivery/stocktake canonicalization preserved unknown fields — violating SR-128's strict projection | **REAL** — the generic branch wrapped the raw snapshot | real v4 canonical forms for both types (field-enumerated from the creation shapes incl. legacy `customs`), unknown keys stripped |
| AGY-1 (P2) | a franchise store NAMED like "Head Office …" regex-matches store↔store transfers into the invoice | **REAL** (the free-text fallback is reachable by transfer rows) | a TRANSFER-LINKED row derives its origin from the transfer RECORD (fixture-pure via the passed `d`); the text fallbacks now serve only rows with no transfer record |
| AGY-2 (P2) | the stamped NOT-SET 0% renders silently (the loud surfacing was lost) | **REAL** | a stamped 0% line surfaces `NOT_SET` loudly (a genuine 0% stamp cannot arise otherwise — 0=inherit has no UI option; an unset office default was already the loud-0 case) |
| AGY-4 (P2) | the canonicalizer collapsed basis-UNSET ("awaiting") and CHOSEN `legacy-lens` to one hash — the fleet can't surface that disagreement | **REAL** | stampless canonical basis = `o.basis || null` — unset ≡ pre-W4 absence (same-reality identity preserved), chosen legacy hashes differently |
| AGY-5 | `_stableHash` flat-input equivalence claim | **UPHELD by AGY** (true — arrays/primitives ignore a replacer array; historical stepIds unaffected) | no change |

**Coverage:** every fix sentinel-asserted (S-276..S-282 strengthened: full-tuple fixtures, partial-tuple
rejects, server-resolved mapping w/ drop-not-reject, priceless-retail reject, version-only conflicts,
untrusted-pending/server-resolved tiers, loud stamped-0, the named-store exclusion, version/basis-state/
delivery/stocktake hash cases) + 7 new mutations (S-276b, S-278c, S-280b, S-281c/d/e, S-282d — **316
total**, parity 273 ↔ 273) + 6 re-anchors (S-108, S-277, S-278b, S-280, S-281 + the earlier set), all
caught by the anchor scan before they could silently skip.

**Round-1-fix gates (2026-07-19):** smoke **273/273** · scoped saboteur (18 W4.3 + 6 re-anchored):
**24/24 CAUGHT, 0 BLIND, 0 skipped, 0 INFRA** (single clean detached run, baseline 273/273) · anchor
scan **316/316** · topology 256/256 · full sweep (316) recorded below.

## ROUND 2 (2026-07-19): AGY PASS (all eight R1 fixes verified) · Codex BLOCK ×3 — all REAL residuals, all fixed @ 5d48ea7/14f962d

| # | Finding | Ground truth | Fix |
|---|---|---|---|
| Codex R2-1 (P1) | the DIRECT-LOG path copies only the money fields; sync then FABRICATES versions 0/0; the invoice treats the malformed row as valid | **REAL — a Codex-1 residual** (the direct-log copy line predated the tuple work) | the copy carries all four; egress requires ALL FOUR or ships the row unstamped (never fabricates); the invoice row tier fails a PARTIAL tuple closed (`STAMP_ERROR`) |
| Codex R2-2 (P1) | a transfer-linked row whose record hasn't arrived (rows pull BEFORE steps) falls through to the reason regex — reopening AGY-1 in that window | **REAL** | `transferId` present ⇒ origin derives SOLELY from the record; absent record ⇒ fail closed (not billed this fold — self-heals when the record arrives) |
| Codex R2-3 (P1) | stamp-at-receive reads `createdAt` (DRAFT creation), violating P4's submit-instant rule for stale drafts submitted across a rate change | **REAL** | explicit `submittedAt` recorded at both submit moments + carried in the submit payload + folded (a pre-W4 step's own timestamp backfills it; EXCLUDED from the canonical form as derived metadata); `_stampAtReceive` prefers `submittedAt || date || createdAt` |

**Coverage:** S-277 no-fabrication egress · S-281 ghost-record exclusion + partial-row fail-closed ·
S-279 reworked to Codex's exact stale-draft repro with THREE distinct rate eras (creation 25% / submit
30% / receive-day 45%) — the era split matters: the first re-run caught MY OWN weakened fixture (the
receive-day mutation went BLIND while submit-era == receive-era; fixed, re-run clean). Mutations:
S-279b (creation-day revert) added; S-279/S-281d re-anchored. **317 total, parity 273 ↔ 273.**

**Round-2-fix gates (2026-07-19):** smoke **273/273** · scoped saboteur (19 W4.3 + 6 re-anchored):
**25/25 CAUGHT, 0 BLIND, 0 skipped, 0 INFRA** (single clean detached run after the fixture fix) · anchor
scan **317/317** · topology 256/256.

**Ops note:** Codex's R2 scoped run was blocked by the engineer's own full sweep holding the runner lock —
process rule updated: the FULL sweep now runs ONLY at wave close (post-convergence), never during audit
rounds; scoped runs are the in-loop gate.

## ROUND 3 (2026-07-19): AGY PASS (all three R2 fixes verified) · Codex BLOCK ×1 — REAL, fixed @ b9396df

| # | Finding | Ground truth | Fix |
|---|---|---|---|
| Codex R3-1 (P1) | a PARTIAL transfer-ITEM tuple (money without versions) still bills as "transfer-stamped", and FOUR helper sites default the missing versions to 0 (fabrication one layer above R2's row fix) | **REAL — the R2 fix closed rows but not items** | ONE shared `_fullTuple` predicate at EVERY consumer: `_stampTxns`, both step-payload builders, `_enrichResolutions`, the direct-log copy — full tuple copied LITERALLY or nothing (no defaults anywhere); the invoice tier-2 fails a partial item CLOSED (`STAMP_ERROR`, never "transfer-stamped", never the lens); `_stampAtReceive` treats a partial as malformed — clears it and mints honestly |

**Coverage:** S-281 partial-ITEM fixture (money-only item → `STAMP_ERROR` line) + mutation S-281g;
S-278b re-anchored. **318 mutations, parity 273 ↔ 273.**

**Round-3-fix gates (2026-07-19):** smoke **273/273** · scoped saboteur (20 W4.3 + 6 re-anchored):
**26/26 CAUGHT, 0 BLIND, 0 skipped, 0 INFRA** (single clean detached run) · anchor scan **318/318** ·
topology 256/256.

## Engineer's honest notes (attack these first)
1. **Stamping scope = the billing predicate** (warehouse-typed non-franchise sender OR `head_office` → a
   franchise store) — non-billing store↔store transfers are deliberately un-stamped (their rows never hit
   the invoice). Judge whether any billed path escapes the predicate.
2. **The submit-time discount honours the honest NOT-SET as 0%** (exactly what the invoice would bill,
   frozen loudly) — an error REJECTS but not-set stamps 0. Judge the seam.
3. **`_stampAtReceive` treats an explicit `basis: 'legacy-lens'` as durable** (never re-mints) — pinned by
   SR-86's chosen-vs-awaiting distinction; the "awaiting" state is basis-UNSET. Judge the fold's
   normalization boundaries.
4. **The non-transfer record types (delivery/stocktake) canonicalize as strict-projected whole snapshots**
   (`_canonicalSnapshotV4` generic branch) — their divergence semantics are whole-content; only transfers
   get the field-level v4 form. Judge whether that under-normalizes a legacy delivery/stocktake backfill
   (a pre-W4 vs W4 snapshot of the same delivery could still false-diverge if any W4 code adds fields to
   those records — none does today).
5. **`_stableHash` retains** (recursive serializer now) for the two flat-input callers (packaging-edit
   disc, resolve stepId product list) — flat arrays/strings serialize identically to the old algorithm, so
   historical stepIds are unaffected. Judge the equivalence claim.

## Interfaces honoured
W4.2's lens supplies submit/receive values + the reject rule (untouched); W4.4 will consume the stamped
rows + `steps` (SR-114's shared-precedence projection is specced there); cutover needs NO migration (P4
covers in-transit transfers at their receive).
