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

## Re-audit checklist — ⚠ RE-SCOPED 2026-07-30 (Contract 2 is PARKED)

**This is carried obligation 1 of the C2 parking decision (`HANDOVER.md` §5a). It is now done.**
The re-audit covers **the engine + Contract 1 ONLY.** The control/correction lane is **deliberately
excluded** and audited at a **zero-control, empty-manifest baseline**. Say so in the auditor pack, or
a reviewer flags the absent correction route as a gap and a whole round is burnt.

1. **Land Contract 1** → change the engine's `unverifiableQty` predicate to "no valid economic
   signature", with `ECON_SIG_INVALID` as a fail-closed hold (never a silent exclusion).
   ⚠ **DO NOT SHIP THIS ALONE — verbatim it is a net safety REGRESSION.** Applied on its own it turned
   a deleted-movement case from PROVISIONAL/held into **FINAL owed 675**, silently billing it. The
   compensating tombstone guard ships in the SAME batch (`HANDOVER.md` §5a obligation 3).
2. **Land the sealed-row-pre-epoch contradiction rule**, using the already-deployed
   `coverage.stepsEpochId`. (It does not need C2's `seal_epoch` artifact — verified.)
3. **BUILD THE `EconSig` PROBE FAMILY FIRST.** The engine's 170-probe suite has **zero** EconSig
   coverage — it still runs on the legacy `_attested` marker and `buybackExport.js` does not reference
   `EconSig` at all. The R5/R6/R7 repros must be made to fail **at verify**, not at the manual-review
   hold. A gate never seen to fail is not a gate (`HANDOVER.md` §5a obligation 4).
4. Re-run the FULL parallel audit (Codex + AGY) over engine + Contract 1 — **not** engine+C2.
5. Confirm `meta.unverifiableQty` is EMPTY for a fully-signed real dataset → settlements auto-FINAL.
6. **Write the verdict so it cannot be over-read:** the engine is being certified for a ZERO-CONTROL
   world. State that the control lane was NOT certified, or a later reader takes "engine re-audited,
   clean" as covering corrections (`HANDOVER.md` §5a obligation 5).
7. W4.4 is shippable **for everything except the correction route**, which ships as its own later
   separately-audited deploy → 6-way milestone blind audit → cutover.

**MOVED OUT of this checklist and onto Contract 2's own list** (obligation 2), because narrowing the
re-audit without re-homing it would leave it owned by nobody:
- **Engine-side control-seal enforcement.** RUN-demonstrated money hole: the manifest head binds only
  `{controlId, revision, bornPublicationVersion}`, so a SharePoint-direct edit of a published control
  row's qty or stamps passes the head check and settles **FINAL at owed 3.75 instead of 375**.
- The **colon-id defect** (mint colon-free ids; do **not** widen `reqId`) and the **device-tombstone
  over-bill**. Both in `HANDOVER.md` §5a.
- What Contract 2 was originally listed here to deliver — the correction route writing `targetLine` +
  `originalEventAt`. The **engine half of that is already built and proven**: it refuses a control
  with no `targetLine` today. Only the route half is parked.
