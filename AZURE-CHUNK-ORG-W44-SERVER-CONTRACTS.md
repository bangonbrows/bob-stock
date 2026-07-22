# OS-W4.4 — SERVER-SIDE CONTRACTS the buy-back engine depends on (STAGING-APPLY)

**Status:** the pure engine (`buybackExport.js`) is FROZEN 2026-07-22 after 7 parallel audit rounds
(29 real bugs fixed). The remaining un-closable-in-engine class is the subject of this doc. **Do these
server-side, THEN return for a full engine+server re-audit** (Kunal's explicit return marker).

## Why these exist (the banked root cause)
The export route hands the engine ledger ROWS that were pushed by store devices via push-v2. Those rows
are **client-editable** — a franchisee with device/SharePoint access can alter a row's `qty`, `productId`,
`stockFromStoreId` (source), `type`, `transferId`, and `date`. The engine has hardened every field it can
bind to server-owned RecordSteps, but a **stepless / direct-log** row (and any field the steps don't
cover) has **no server-owned anchor**. Rounds R5→R7 each closed one binding and the next round found an
adjacent unbound field. The engine now **fails closed** (holds the settlement PROVISIONAL +
`meta.unverifiableQty`) on everything it cannot verify; these contracts turn those held rows into
verifiable, auto-FINAL ones.

## CONTRACT 1 — push-v2 ROW-LEVEL attestation signature (the big one)
**What:** at push-v2 ingest, the SERVER computes and stores a tamper-evident signature/marker over each
ledger row's ECONOMIC IDENTITY, keyed to the row's server-assigned TransactionId. Minimum covered fields:
`{ TransactionId, qty, productId, stockFromStoreId (source), type, transferId }`.
The signature MUST be server-set and NOT client-writable (like the existing `_attested` stamp marker,
but covering the economic fields, not just the price stamps).

**Why (which findings it closes — all currently held PROVISIONAL by the engine):**
- **Direct-log qty/source (R5 AGY-2/3, R7 finding 3):** a transferless HO row's quantity and source are
  unverifiable → the signature makes them authoritative → the engine's `MANUAL_REVIEW_UNVERIFIABLE_QTY`
  hold clears for signed rows.
- **Product swap / identity (R6 AGY-1, R7 findings 1-2):** the signature binds `productId`+`qty` to the
  row id independent of the step's `expectedLedgerKeys`, closing the pooled-key gap directly.
- **Type / relabel (R3 AGY-2, R7 finding 3):** signing `type`+`stockFromStoreId` stops a relabel/retype
  from re-classifying a row out of billing.

**Engine side (already built — DO NOT rebuild):** the engine surfaces every unverifiable row in
`settlement.meta.unverifiableQty` and holds FINAL. When the signature ships, the engine's
`unverifiableQty` predicate becomes "row lacks a valid server economic-signature" (instead of "row is
stepless"); a **signed** stepless row then values + finalizes normally. This is the ONE engine change to
make at re-audit time — everything else already consumes server truth.

**Sale prices (R6 Codex-2, informational):** sales have no server step; `unitPriceAtTime` is
client-recorded. `retailProfit` is already flagged `clientRecordedSalePrices`+`informationalOnly` and does
NOT affect the PAYABLE (`totals.owed` = server-anchored HO supply cost). If a signed sale price is wanted,
extend Contract 1 to sales; otherwise retailProfit stays informational (acceptable — it's not the payable).

## CONTRACT 2 — correction route populates `control.targetLine`
**What:** the Director correction-approval route (LA-CHANGES §6) must, at approval time, capture the
AUTHORITATIVE target row's `{transferId, productId, qty}` from the server-fetched target (SR-134 already
fetches it) and write it onto the control as `targetLine`. It must ALSO carry the server-captured
`originalEventAt` = the target transfer's submit instant.

**Why:** the engine's reconciliation OFFSET and the replacement window-instant both read `control.targetLine`
/ the server submit instant (R5 AGY-1, R5 Codex-3) — NOT the client row — so a mutated target row can't
redirect the offset or shift the window. The engine already REQUIRES `targetLine` for transfer-linked
targets (`MALFORMED_CONTROL` if absent) and binds the replacement instant to the submit step. The route
just needs to WRITE these server-captured values.

## Engine input forms the route must produce (already documented in `buybackExport.js` header)
- `steps[].payload.expectedLedgerKeys` — MUST be present + complete on every receive/resolve step (R7
  finding 1: the engine now fails closed `UNBOUND_TRANSFER_CLAIM` if a SUBMIT-origin transfer reaches
  billing without them). phase2.js already emits them (`:542`); the route/LA must not strip them.
- The four-state coordination record, coverage attestations, drain manifest, badVersionEvidence queue —
  per LA-CHANGES §6 and the engine header (unchanged by R5-R7).

## Re-audit checklist (when we return)
1. Land Contract 1 → change the engine's `unverifiableQty` predicate to "no valid economic signature".
2. Land Contract 2 → the correction route writes `targetLine` + `originalEventAt`.
3. Re-run the FULL parallel audit (Codex + AGY) over engine+server together — the R5/R6/R7 repros should
   now all fail closed WITHOUT reaching the manual-review hold (they become server-rejected at ingest).
4. Confirm `meta.unverifiableQty` is EMPTY for a fully-signed real dataset → settlements auto-FINAL.
5. Then W4.4 is shippable → 6-way milestone blind audit → cutover.
