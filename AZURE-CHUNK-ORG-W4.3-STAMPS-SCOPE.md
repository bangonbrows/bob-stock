# OS-W4.3 — COMMIT-TIME MONEY STAMPS · TRANSPORT · PRICING BASES

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 stamps/transport seam (split from the frozen
ledger `AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-3, 7, 12,
13, 18, 19→67, 20, 38, 39, 40, 58, 59, 60, 62→73, 66, 67. **Review status:** R7 PENDING.

## What stamps are for
The lens (W4.2) freezes the DISCOUNT per date; nothing freezes the PRICE (`p.price` is live — a price edit
still rewrites old invoices' dollars). Stamps freeze BOTH numbers on the row forever: `sellAtSupply` +
`discAtSupply`, written at COMMIT time (Kunal-confirmed W4-D1). Belt and braces with the lens.

## Pinned design

**P1 — capture (SR-3/7/12/21).** Stamps are captured at SUBMIT (the pricing-commitment moment — the durable
submit/dispatch transition, never draft creation) onto the transfer's item lines; direct delivery-category
HO-supply entries stamp at their own commit. A PRICING DATA ERROR at submit REJECTS the commit (null is
never stamped). The invoice PREFERS stamps; lens for legacy rows.

**P2 — one item, one basis (SR-67, amends SR-19).** The folded transfer ITEM carries a durable canonical
`basis`: `submit-stamped` (post-W4 submits) | `receive-stamped` (P4 below) | `legacy-lens` (receive under
pricing error/stale). EVERY `transfer_in`-creating path — receive(), the discrepancy top-up, the
remainder-return row, conflict corrections — inherits the ITEM's canonical basis + stamps. One supply is
never split across pricing bases. A conflicting later stamp = a P5 conflict, never a silent switch.

**P3 — transport: stamps ride EVERY channel (SR-13/18/20/38/40/58).**
- Step payloads: `Payload.items[].sellAtSupply/discAtSupply` in submit + receive steps (phase2.js
  `_submitPayload`, records.js fold reconstruct). There are NO Transfers columns (deleted scaffold).
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

**P5 — conflict identity includes money (SR-66).** The receive-step summary + `_detectReceiveConflict`
identity extend beyond `receivedQty` to the financial payload (per-line stamps + the basis marker): equal
quantities with DIFFERING stamps ⇒ a D4-F CONFLICT (the resolve pins the canonical stamps) — billing is
never sync-order-dependent.

**P6 — validation (SR-39/62/73).** BOTH-OR-NEITHER at ingest AND in the engine/invoice (one stamp without
the other = malformed row: rejected at ingest, fail-closed line client-side; legacy = neither). Money
policy, ONE canonical pin at EVERY surface: JSON NUMBER type (strings rejected — no `Number()` coercion),
finite, ≥ 0, ≤ 1,000,000 (the client `Validate.MONEY_MAX`), ≤ 2dp (reject). `DiscAtSupply` additionally
0–100. Shared parity fixture matrix proves client/ingest/engine verdict-identical. (The pre-existing
`badMoney`↔`Validate.money` divergence on Chunk-4 delivery costs is out of scope, flagged in LA §6.)

## Interfaces to other seams
- W4.2 supplies lens values at submit/receive and the submit-reject rule; the invoice's stamp-preference
  order is pinned there (stamps → lens → fail-closed surfacing).
- W4.4 consumes stamped rows + `UnitPriceAtTime` + the text labels; its both-or-neither + money validation
  must be THIS doc's rules (shared fixtures).
- Cutover: NO migration exists. The pricing-change route may enable immediately at activation; stampless
  in-transit transfers are handled by P4 at their receive.

## Sentinels (stamps seam)
S-W4-7 draft-before/commit-after (stamp = commit-day; uses Codex's submit→change→receive repro; received
row carries submit-day stamps) · S-W4-12 sync round-trip bit-exact · S-W4-10(part) archived-shape round-trip
· top-up/remainder/correction rows inherit the item basis (legacy receive→top-up shares receive stamps;
error-basis receive→top-up stays legacy on both) · S-W4-20 stamp-at-receive (later price/discount edit
leaves the received line bit-stable) · equal-qty different-stamp receives ⇒ conflict · both-or-neither +
money-policy rejects (1e308, string '1e3', 3dp, >1M). Each with its saboteur mutation.
