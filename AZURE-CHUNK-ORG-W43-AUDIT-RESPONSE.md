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
