# OS-W4.4 Contract 1 — row-level economic attestation: CONCRETE DESIGN (spec review round 1)

**Status: DRAFT — awaiting Codex + AGY spec review before any staging deploy.** Parent contract:
`AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md` (Contract 1). The pure engine is FROZEN @ `131ccec`; this is
the server-side deliverable that clears its `MANUAL_REVIEW_UNVERIFIABLE_QTY` holds. A DRAFT
implementation of the Function half exists in-repo (below) so the review can attack real code; the
Logic App half and all staging deploys are NOT started.

## Kunal decisions locked 2026-07-22
- **D-C1-1:** cover MORE than the contract's minimum tuple (extensions below) — approved.
- **D-C1-2:** ingest failure posture = FAIL CLOSED / RETRYABLE (a row is never stored unsigned) — approved.
- **D-C1-3:** sale prices (`UnitPriceAtTime`) NOT covered; retailProfit stays
  clientRecordedSalePrices+informationalOnly (R6 Codex-2) — approved.

## 1. The signature
`EconSig = 'v1:' + HMAC-SHA-256(pepper, JSON.stringify(['econ-v1', ...covered values in fixed order]))`
(hex). Computed SERVER-side at push-v2 ingest; stored in a new `EconSig` column; client-supplied values
for that column are ignored/overwritten. Pepper = new Function setting `BOB_ROW_ATTEST_PEPPER`
(≥32 chars), deliberately SEPARATE from `BOB_AUTH_PEPPER` (key separation: rotating device-auth must not
invalidate every stored row seal, and vice versa). Never in SharePoint / client / repo.

**Covered fields (canonical order):** `TransactionId, StoreId, Date, Timestamp, ProductId, Type, Qty,
TransferId, IdempotencyKey, StockFromStoreId, StockToStoreId, StockFrom, StockTo, TargetTransactionId`.

**Extensions beyond the contract minimum (D-C1-1 rationale):**
- `Date` + `Timestamp` + `StoreId` — for direct-log rows (no server step) these decide window
  membership, the as-of franchise rate, and whose settlement the row lands in. R6 AGY-4 pinned the
  authoritative instant for STEP-BACKED rows only; direct-log rows had no anchor.
- `StockFrom`/`StockTo` TEXT labels — per W4-SR-58 the labels ARE the sale-vs-wastage classifier
  inputs (R3 Codex-1: return netting keys on `baseLabel(stockFrom)==='Customer'`). Sealing only the ids
  would leave the classifier inputs editable.
- `IdempotencyKey` — the receive-key binds (transfer,store,product) (R7 finding 2); canonicalisation
  mirrors the LA's `coalesce(row.IdempotencyKey, row.TransactionId)` insert expression.
- `TargetTransactionId` — a tombstone is a CONTROL; an edited target would redirect a deletion onto a
  different row under a still-valid seal.

**Deliberately NOT covered:** `UnitPriceAtTime` (D-C1-3); `StaffName/Reason/DeviceId` (non-economic);
the `SellAtSupply/DiscAtSupply/PricingVersion/CatalogueVersion` authority tuple — that has its own
SR-153/155/157 SEMANTIC attestation contract (values RECOMPUTED against pricing/catalogue history +
its own server-set marker). The two attestations COMPOSE on a stamped direct-log row: EconSig proves
the row's identity fields are as-ingested; the SR-155 marker proves the stamp VALUES were valid.
(Review question Q4.)

**Canonicalisation:** absent ≡ null ≡ '' (SharePoint empty round-trip is not an "edit"); everything
else `String(v)` (25 ≡ '25' — number-column round-trip safe); JSON array framing kills field-boundary
injection (a separator-join would let two different rows canonicalise identically — probed).

## 2. Ingest wiring (push-v2-validate-staging)
Insertion point: INSIDE `Insert_loop`, per accepted row, a `Call_attest` HTTP action (op:'sign', the
row's post-projection stored values) BEFORE `Insert`; `Insert` gains `EconSig` from the response and
runs only after `Call_attest` Succeeded. On `Call_attest` failure the row is appended to `failed[]`
(retryable) and NEVER inserted — D-C1-2 fail-closed, the exact opposite of `Call_money`'s fail-open
(which has a client backstop; a seal has none). Devices already queue + retry; TransactionId /
IdempotencyKey dedup absorbs the replay.
- Per-row (not batch) call: WDL has no expression-level array lookup to zip a batch response back onto
  loop items without restructuring the loop; batches are small; precedent = recordsteps' 2 SP GETs per
  step. (Review question Q2.)
- Rejected/quarantined rows are not signed (they are never inserted).
- Live `push-v2` untouched — staging only, single end-of-phase cutover as always.

## 3. Storage + transport
- New `EconSig` text column on `StockTransactions_Validate` AND the archive list; the Chunk-8
  archive-move LA must CARRY it (an archived row keeps its seal — ID-based archival, no re-signing).
- Pull delivery: EconSig is non-secret (HMAC output; unforgeable without the pepper). Devices don't
  need it; serving it is harmless. Default: pull maps stay unchanged (column simply rides if `*`).
- The seal proves "these values are what the server observed at ingest" — it does NOT re-validate the
  values (validation/steps do that) and does NOT protect uncovered fields.

## 4. Verification at settlement time
The export route (LA-CHANGES §6 buy-back export), while holding the export lease, calls
`attestRows op:'verify'` over the assembled row set (live + archive) and supplies the per-row boolean
to the ENGINE alongside the rows (attested-inputs pattern). ENGINE CHANGE (deferred to the return
re-audit per the parent contract): `unverifiableQty` predicate becomes "row lacks a VALID economic
signature" — a signed stepless row then values + finalizes; an INVALID seal ⇒ fail-closed hold
(distinct reason, e.g. `ECON_SIG_INVALID`), never silent exclusion.

## 5. Open design questions for this review
- **Q1 (backfill):** rows ingested BEFORE Contract 1 have no seal. Lean: NO blanket backfill signing
  (it would notarise whatever the rows say TODAY — including any tampering that motivated this
  contract); pre-contract rows keep flowing to the existing manual-review / Director re-attestation
  path. Counter-position welcome.
- **Q2 (per-row vs batch call):** accept the per-row HTTP call, or require the batch+zip restructure?
- **Q3 (pepper rotation):** rotation invalidates every stored seal. Lean: `v1:` prefix + at rotation a
  Director-authorized re-sign run that VERIFIES under the old pepper and re-signs under the new
  (never signs an unverifiable row); dual-pepper verify during the run. Is a leaner scheme sound?
- **Q4 (composition):** confirm EconSig and the SR-155 five-tuple semantic attestation compose without
  gaps or double-authority on stamped direct-log rows.
- **Q5 (covered set):** is the covered field list COMPLETE against the engine's actual read set for
  direct-log rows (buybackExport.js)? Anything the engine classifies/values by that is still editable?

## 6. Draft artifacts in-repo (attack these)
- `azure-functions/src/functions/attestRows.js` — the route (sign/verify, authLevel function,
  fail-closed 500 on missing pepper, MAX 500 rows, boolean-only verify).
- `test/attest-proof.js` — 42 probes, RUN it (`node test/attest-proof.js`): whole-population tamper
  matrix over every covered field, uncovered-field boundary, canonicalisation edges (coalesce mirror,
  absent≡''≡null, injection, quote/backslash), malformed-seal set, route contract.

## 7. Sequencing after convergence
Deploy Function (+pepper) → LA change → EconSig columns → credentialled staging probes (sign-at-ingest,
SharePoint-direct edit detected, dup dedup intact, fail-closed path) → Contract 2 (correction route —
already spec-converged in LA-CHANGES §6 + R5 AGY-1/Codex-3; needs the throwaway test director) →
return re-audit of engine+server together (the R5–R7 repros must fail at ingest/verify, not at the
manual-review hold; `meta.unverifiableQty` empty on a fully-signed dataset).
