# OS-W4.4 Contract 1 — row-level economic attestation: CONCRETE DESIGN

**Status: R1 SPEC REVIEW FOLDED 2026-07-22 — awaiting R2 re-verify from BOTH auditors before any
staging deploy.** R1 verdicts: AGY BLOCK×2 + Codex BLOCK×1 (one CONVERGED pair) — **all ground-truthed
REAL and folded** (table below). Parent contract: `AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md`
(Contract 1). The pure engine is FROZEN @ `131ccec`; this is the server-side deliverable that clears
its `MANUAL_REVIEW_UNVERIFIABLE_QTY` holds. DRAFT implementation in-repo (§6); Logic App half and all
staging deploys NOT started.

## R1 fold record (2026-07-22)
| # | Finding | Verdict | Resolution |
|---|---------|---------|------------|
| R1-1 (AGY-1) | Pricing-tuple splice: EconSig excluded the four SellAtSupply/DiscAtSupply/PricingVersion/CatalogueVersion fields, so a SharePoint-direct writer could transplant a validated tuple from another row under a still-valid seal | REAL (design gap; ground truth: a plain `_attested` row marker is forgeable by the same threat actor anyway, so the seal is the ONLY workable binding) | The tuple JOINED the covered set. For ROWS, the SR-155 plan is AMENDED: semantic validation (values recomputed against history) gates SIGNING at ingest; the seal itself IS the row-level attestation — the planned plain marker column is SUBSUMED (a sealed row's tuple is both validated and bound). Permanent splice repro in the proof suite. |
| R1-2 (AGY-2 ≡ Codex-1, CONVERGED) | `Reason` uncovered but the engine's LAST-RESORT HO-source classifier for a direct-log row with blank structured source fields is `/head\s*office|from ho\b/i.test(t.reason)` (buybackExport.js isHOSupply) — classification flips under a valid seal | REAL (confirmed at buybackExport.js:190) | `Reason` JOINED the covered set. Permanent repro (blank-source row + Reason edit) in the proof suite. |
| — | Whole-family inventory (banked rule: inventory the family before handing back) | — | Enumerated EVERY row field the engine reads vs the covered set. Result: no further gaps. `_spId` = server-assigned immutable item id; `UnitPriceAtTime` informational (D-C1-3, both auditors accepted); `t.items`/`r.*` = steps/controls (separate server authority chain); archive-only `SourceId` is server-set at archive-move and outside an ingest seal — but a row carrying a VALID seal claiming PRE-epoch provenance is a CONTRADICTION (seal presence proves post-contract ingest); pinned as an engine re-audit note (§4). |

**Q&A adjudications:** **Q1** both agree — NO blanket backfill (locked; pre-contract rows keep the
manual-review / Director re-attestation path). **Q2** SPLIT (AGY: require batch+zip; Codex: per-row
acceptable this phase) — **ADJUDICATED FOR AGY**: batch is strictly better (a Monday offline flush can
be hundreds of rows; per-action LA overhead × N is real cost/latency/throttle risk) and the response is
already index-aligned; adopted with a per-row TransactionId cross-check belt (§2). **Q3** both
suggested the same simplification — ADOPTED: key-id (kid) in the seal + multi-pepper verify (§1);
mass re-sign reserved for active compromise. **Q4** resolved by R1-1 (the seal is the binding).
**Q5** resolved by R1-2 + the family inventory.

## Kunal decisions locked 2026-07-22
- **D-C1-1:** cover MORE than the contract's minimum tuple — approved (R1 widened it further).
- **D-C1-2:** ingest failure posture = FAIL CLOSED / RETRYABLE (a row is never stored unsigned) — approved.
- **D-C1-3:** sale prices (`UnitPriceAtTime`) NOT covered; retailProfit stays
  clientRecordedSalePrices+informationalOnly (R6 Codex-2) — approved; both auditors accepted at R1.

## 1. The signature
`EconSig = 'v1:<kid>:' + HMAC-SHA-256(pepper[kid], JSON.stringify(['econ-v1', ...covered values in
fixed order]))` (hex). Computed SERVER-side at push-v2 ingest; stored in a new `EconSig` column;
client-supplied values for that column are ignored/overwritten.

**KEY RING (R1 Q3):** `<kid>` (lowercase alphanum ≤16) names the minting pepper. Signing always uses
the ACTIVE kid (Function setting `BOB_ROW_ATTEST_ACTIVE`); verification honours any kid whose pepper
is still configured (`BOB_ROW_ATTEST_PEPPER_<KID>`, each ≥32 chars). Rotation = add the new pepper
setting + flip ACTIVE — old seals keep verifying; deleting a retired pepper invalidates its seals
(fail closed). A Director re-sign run (verify-under-old, re-sign-under-new, never sign unverifiable)
is reserved for active-compromise. Peppers live ONLY in Function settings — never SharePoint / client /
repo; SEPARATE from `BOB_AUTH_PEPPER` (key separation).

**Covered fields (canonical order):** `TransactionId, StoreId, Date, Timestamp, ProductId, Type, Qty,
Reason, TransferId, IdempotencyKey, StockFromStoreId, StockToStoreId, StockFrom, StockTo,
TargetTransactionId, SellAtSupply, DiscAtSupply, PricingVersion, CatalogueVersion`.

**Rationale per field-group:**
- `Date`/`Timestamp`/`StoreId` — window membership, as-of franchise rate, settlement owner for
  direct-log rows (R6 AGY-4 anchored step-backed rows only).
- `Reason` — R1-2: the engine's last-resort HO-source classifier input on blank-source direct-log rows.
- `StockFrom`/`StockTo` labels — W4-SR-58: THE sale-vs-wastage classifier inputs; ids sealed alongside.
- `IdempotencyKey` — receive-key binds (transfer,store,product) (R7); canonicalisation mirrors the LA's
  `coalesce(row.IdempotencyKey, row.TransactionId)`.
- `TargetTransactionId` — a tombstone is a CONTROL; an edited target redirects the deletion.
- `SellAtSupply/DiscAtSupply/PricingVersion/CatalogueVersion` — R1-1: the pricing authority tuple must
  be cryptographically bound to the row identity (splice-proof). Unstamped rows sign with the four
  values absent (≡ ''); both-or-neither egress is unchanged.

**Deliberately NOT covered:** `UnitPriceAtTime` (D-C1-3), `StaffName`/`DeviceId` (non-economic).
Archive-only `SourceId`: outside an ingest seal by construction — covered instead by the §4
sealed-row-pre-epoch contradiction rule.

**Canonicalisation:** absent ≡ null ≡ '' (SharePoint empty round-trip is not an "edit"); everything
else `String(v)` (25 ≡ '25' — number-column round-trip safe); JSON array framing kills field-boundary
injection (probed).

**SR-155 composition (AMENDED at R1-1):** for ledger ROWS the seal subsumes the planned plain
attestation marker. Order at ingest: validate (incl. the SR-155 semantic stamp recomputation when that
ships) → THEN sign. A valid seal therefore attests both identity AND that the row passed ingest
validation as-stored. Steps keep their own SR-153 attestation chain (separate surface, unchanged).

## 2. Ingest wiring (push-v2-validate-staging) — R1 Q2: BATCH + ZIP
ONE `Call_attest` HTTP action (op:'sign') over the FULL validated row set (`ToInsert` output), placed
after validation and BEFORE the insert loop. The response is index-aligned; the loop consumes a zipped
{row, EconSig, echoedTransactionId} array (Select over `range(0, length(ToInsert))`). BELT: before
each insert, the echoed TransactionId must equal the row's — mismatch ⇒ that row goes to `failed[]`
(retryable), never inserted with a foreign seal. FAIL CLOSED (D-C1-2): if `Call_attest` fails or is
unreachable, the ENTIRE batch returns as `failed[]` retryable and NOTHING is inserted — the exact
opposite of `Call_money`'s fail-open (which has a client backstop; a seal has none). Devices already
queue + retry; TransactionId/IdempotencyKey dedup absorbs the replay.
- Rejected/quarantined rows are not signed (they are never inserted).
- Live `push-v2` untouched — staging only, single end-of-phase cutover as always.

## 3. Storage + transport
- New `EconSig` text column on `StockTransactions_Validate` AND the archive list; the Chunk-8
  archive-move LA must CARRY it (an archived row keeps its seal — ID-based archival, no re-signing).
- Pull delivery: EconSig is non-secret (HMAC output; unforgeable without a pepper). Devices don't need
  it; serving it is harmless. Default: pull maps unchanged.
- The seal proves "these values are what the server observed (and validated) at ingest" — it does NOT
  protect uncovered fields, and it is not a substitute for ingest validation.

## 4. Verification at settlement time
The export route (LA-CHANGES §6), while holding the export lease, calls `attestRows op:'verify'` over
the assembled row set (live + archive) and supplies the per-row boolean to the ENGINE alongside the
rows (attested-inputs pattern). ENGINE CHANGES (deferred to the return re-audit per the parent
contract):
1. `unverifiableQty` predicate becomes "row lacks a VALID economic signature" — a signed stepless row
   values + finalizes; an INVALID seal ⇒ fail-closed hold (`ECON_SIG_INVALID`), never silent exclusion.
2. NEW (R1 family-inventory note): a row with a VALID seal whose provenance id claims PRE-epoch is a
   CONTRADICTION (sealed ⇒ post-contract ingest ⇒ post-epoch) ⇒ fail closed — closes archive
   `SourceId` editing as a pre-epoch masquerade (today's engine already conservatively HOLDS pre-epoch
   peers, so the interim fails safe).

## 5. Design questions — all resolved at R1
- **Q1 backfill:** RESOLVED (both agree) — no blanket backfill; pre-contract rows keep the
  manual-review / Director re-attestation path.
- **Q2 per-row vs batch:** RESOLVED — batch+zip adopted (AGY position; Codex accepted per-row but did
  not oppose batch), with the TransactionId cross-check belt.
- **Q3 rotation:** RESOLVED — kid-in-seal + multi-pepper verify (both auditors' suggestion, merged).
- **Q4 composition:** RESOLVED — the seal binds the tuple to the row identity; the row marker concept
  is subsumed (R1-1).
- **Q5 covered-set completeness:** RESOLVED — Reason folded (R1-2); full engine read-set inventory
  found no further gaps (fold record above).

## 6. Draft artifacts in-repo (attack these)
- `azure-functions/src/functions/attestRows.js` — the route (sign/verify, key ring, authLevel
  function, fail-closed 500 on unconfigured keyring, MAX 500 rows, boolean-only verify).
- `test/attest-proof.js` — **57 probes** (was 42; +15 at R1), RUN it (`node test/attest-proof.js`):
  whole-population tamper matrix over every covered field (now 19), BOTH R1 auditor repros as
  permanent probes (Reason classifier flip; pricing-tuple splice), key-ring lifecycle (rotation /
  retired kid / unknown kid / env parsing), uncovered-field boundary, canonicalisation edges,
  malformed-seal set (incl. the pre-R1 kid-less format), route contract.

## 7. Sequencing after convergence
Deploy Function (+keyring settings) → LA change (batch+zip) → EconSig columns → credentialled staging
probes (sign-at-ingest, SharePoint-direct edit detected, dup dedup intact, fail-closed path) →
Contract 2 (correction route — already spec-converged in LA-CHANGES §6 + R5 AGY-1/Codex-3; needs the
throwaway test director) → return re-audit of engine+server together (the R5–R7 repros must fail at
ingest/verify, not at the manual-review hold; `meta.unverifiableQty` empty on a fully-signed dataset).
