# OS-W4.3 — COMMIT-TIME MONEY STAMPS · TRANSPORT · PRICING BASES

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 stamps/transport seam (split from the frozen
ledger `AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-3, 7, 12,
13, 18, 19→67, 20, 38, 39, 40, 58, 59, 60, 62→73, 66, 67 + R7 folds SR-84..89.
**Review status:** R7 FOLDED (AGY BLOCK×1 → already covered, clarified; Codex BLOCK×5 → all REAL, folded).
R8 PENDING.

## What stamps are for
The lens (W4.2) freezes the DISCOUNT per date; nothing freezes the PRICE (`p.price` is live — a price edit
still rewrites old invoices' dollars). Stamps freeze BOTH numbers on the row forever: `sellAtSupply` +
`discAtSupply`, written at COMMIT time (Kunal-confirmed W4-D1). Belt and braces with the lens.

## Pinned design

**P1 — capture (SR-3/7/12/21).** Stamps are captured at SUBMIT (the pricing-commitment moment — the durable
submit/dispatch transition, never draft creation) onto the transfer's item lines; direct delivery-category
HO-supply entries stamp at their own commit. A PRICING DATA ERROR at submit REJECTS the commit (null is
never stamped). The invoice PREFERS stamps; lens for legacy rows.

**P2 — one item, one basis (SR-67/84/88, amends SR-19).** The folded transfer ITEM carries a durable
canonical `basis`: `submit-stamped` (post-W4 submits) | `receive-stamped` (P4 below) | `legacy-lens`
(receive under pricing error/stale, or a receive step written by a pre-W4 build — see P3). EVERY
`transfer_in`-creating path — receive(), the discrepancy top-up, the remainder-return row, conflict
corrections, AND the in-transit CANCEL's return rows (SR-88; phase2.js:556) — inherits the ITEM's canonical
basis + stamps. **The PRIMARY receive step's stamps ARE the item stamps; every later unit of that item
inherits them regardless of when it lands (SR-84** — receive is once-per-transfer, F2-CRIT02; the
"remaining units" path is the resolve top-up, which inherits; duplicate receives are the P5 conflict
surface**).** One supply is never split across pricing bases. A conflicting later stamp = a P5 conflict,
never a silent switch.

**P3 — transport: stamps + basis ride EVERY channel (SR-13/18/20/38/40/58/86/87).**
- Step payloads: `Payload.items[].sellAtSupply/discAtSupply` **+ per-line `basis` (SR-86)** in submit +
  receive + resolve steps (phase2.js `_submitPayload`, records.js fold reconstruct). There are NO Transfers
  columns (deleted scaffold). **A receive step LACKING the basis field = written by a pre-W4 build ⇒ the
  item's basis is `legacy-lens`, durably and deterministically on every device** — stamp-at-receive applies
  only when the receiving device writes the field (kills the "awaiting stamps vs legacy already chosen"
  ambiguity).
- **BACKFILL + FOLD ENUMERATION (SR-87):** the backfill snapshot already embeds the whole record; the FOLD
  reconstruct's item enumeration (records.js:321) and `_applyReceive`/`_applyResolve` map stamps + basis
  explicitly (today they drop unlisted fields); the backfill content hash covers them, so divergent-stamp
  backfills surface via the existing hash-in-id divergence conflict.
- Row sync both directions: `SellAtSupply`/`DiscAtSupply` in `_toSharePoint`/`_fromSharePoint` + ingest
  validation; SharePoint columns on StockTransactions AND StockTransactions_Archive; `_fromArchive` maps
  them (archived rows round-trip stamps bit-exact).
- ALSO carried (the export's inputs): `UnitPriceAtTime` (K4), `StockFromStoreId`/`StockToStoreId`, and the
  `StockFrom`/`StockTo` TEXT labels (bounded strings — the ACTUAL sale-vs-wastage classification inputs;
  store-id fields are null for manual movements, index.html:2090-2093).

**P4 — stamp-at-receive for stampless submits (SR-59/60; replaces the DELETED SR-41 migration).** A W4-build
receive of a transfer whose submit step carries NO stamps mints them at receive: `discAtSupply` = lens as-of
the transfer's SUBMIT timestamp (pre-activation dates ⇒ the frozen baseline — deterministic);
`sellAtSupply` = the current catalogue price at receive (exactly what today's system would bill, then frozen).
Published via the receive step (immutable steps — no step is ever mutated or replayed; any future stamp
repair must be a NEW audited step type). Lens failure ⇒ both-or-neither ⇒ the item's basis = `legacy-lens`,
durably. Covers the whole class: in-transit at cutover AND stampless submits from stale PWA builds after.

**P5 — conflict identity includes money, and the RESOLVE carries the pinned stamps (SR-66/85).** The
receive-step summary + `_detectReceiveConflict` identity extend beyond `receivedQty` to the financial
payload (per-line stamps + basis): equal quantities with DIFFERING stamps ⇒ a D4-F CONFLICT — billing is
never sync-order-dependent. **The resolve step's `resolutions[]` gains per-line `{sellAtSupply,
discAtSupply, basis}` (SR-85** — the current payload, phase2.js:497, carries only qty/attempts/keys**);
`_applyResolve` writes the chosen stamps into item state, so the pinned outcome actually PUBLISHES
cross-device; the conflict-resolution UI presents stamp disagreement exactly like qty disagreement.**

**P6 — validation (SR-39/62/73/89).** BOTH-OR-NEITHER at ingest AND in the engine/invoice (one stamp without
the other = malformed row: rejected at ingest, fail-closed line client-side; legacy = neither). Money
policy, ONE canonical pin at EVERY surface: JSON NUMBER type (strings rejected — no `Number()` coercion),
finite, ≥ 0, ≤ 1,000,000 (the client `Validate.MONEY_MAX`), ≤ 2dp (reject). **`DiscAtSupply` = number,
0–100, AND ≤ 2dp at every surface (SR-89** — `validRate` alone accepts 12.345; the STAMP field gets the 2dp
cap; the W2 pricing-series validator is untouched — series writers are integer-option editors**).** Shared
parity fixture matrix proves client/ingest/engine verdict-identical. (The pre-existing
`badMoney`↔`Validate.money` divergence on Chunk-4 delivery costs is out of scope, flagged in LA §6.)

## Interfaces to other seams
- W4.2 supplies lens values at submit/receive and the submit-reject rule; the invoice's stamp-preference
  order is pinned there (stamps → lens → fail-closed surfacing).
- W4.4 consumes stamped rows + `UnitPriceAtTime` + the text labels; its both-or-neither + money validation
  must be THIS doc's rules (shared fixtures).
- Cutover: NO migration exists. The pricing-change route may enable immediately at activation; stampless
  in-transit transfers are handled by P4 at their receive.

## R7 fold record (2026-07-14)
| # | Finding | Ground truth → fold |
|---|---|---|
| **W4-SR-84** | AGY R7-1 (P1): two partial receives at different prices fracture the item basis | **ALREADY COVERED** — receive is once-per-transfer (double-receive guard F2-CRIT02); the "remaining units" arrive via the resolve top-up, which SR-67 already pins to inherit the item basis; genuine duplicate receives are the SR-66 conflict. Fold: P2 text tightened ("the PRIMARY receive step's stamps ARE the item stamps") + AGY's exact repro added as a sentinel |
| **W4-SR-85** | Codex R7-1 (P1): the resolve payload (phase2.js:497) carries no stamps — a resolved conflict can't publish its pinned outcome; billing stays device-order-dependent after "resolution". REAL | P5: `resolutions[]` gains per-line `{sellAtSupply, discAtSupply, basis}`; `_applyResolve` writes them into item state; UI surfaces stamp disagreement |
| **W4-SR-86** | Codex R7-2 (P1): the basis marker had no transport contract — "legacy-lens chosen" vs "awaiting stamp-at-receive" indistinguishable cross-device. REAL | P3: per-line `basis` field in submit/receive/resolve payloads + fold mapping; a receive step WITHOUT the field ⇒ basis = `legacy-lens` durably (deterministic everywhere) |
| **W4-SR-87** | Codex R7-3 (P1): backfill/fold enumeration drops stamps (snapshot embeds the record but the fold's item enumeration, records.js:321, rebuilds without them). REAL | P3: fold reconstruct + `_applyReceive`/`_applyResolve` map stamps+basis; backfill hash covers them (divergence surfaces via hash-in-id) |
| **W4-SR-88** | Codex R7-4 (P2): the in-transit CANCEL creates `transfer_in` return rows (phase2.js:556) outside the "every path" list. REAL | P2: cancel-return rows inherit the item's canonical basis/stamps (they reverse the submit deduction at the same value; the cancelling device derives them from folded item state) |
| **W4-SR-89** | Codex R7-5 (P1): `validRate` accepts 12.345 — ingest vs canonical-fixture verdicts diverge on DiscAtSupply precision. REAL | P6: DiscAtSupply = 0–100 AND ≤2dp at every surface; LA §6 aligned; W2 series validator untouched |

## Sentinels (stamps seam)
S-W4-7 draft-before/commit-after (stamp = commit-day; uses Codex's submit→change→receive repro; received
row carries submit-day stamps) · S-W4-12 sync round-trip bit-exact · S-W4-10(part) archived-shape round-trip
· top-up/remainder/correction/CANCEL-return rows inherit the item basis (legacy receive→top-up shares
receive stamps; error-basis receive→top-up stays legacy on both; AGY's partial-receive-then-price-change
repro, SR-84) · S-W4-20 stamp-at-receive (later price/discount edit leaves the received line bit-stable) ·
equal-qty different-stamp receives ⇒ conflict AND the resolve publishes the pinned stamps cross-device
(SR-85) · basis-less receive step folds as legacy-lens on every device (SR-86) · backfill round-trip
preserves stamps+basis (SR-87) · both-or-neither + money-policy rejects (1e308, string '1e3', 3dp incl.
DiscAtSupply 12.345, >1M). Each with its saboteur mutation.
