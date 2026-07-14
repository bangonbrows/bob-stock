# OS-W4.4 — BUY-BACK EXPORT ENGINE (`buybackExport.js`) + GATED ROUTE CONTRACT

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 export seam (split from the frozen ledger
`AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-9, 14→61, 17, 24,
25, 26, 36, 37→57/69, 38, 55→70, 56→68/75, 58(engine side), 61, 62→73. Route/LA detail:
`AZURE-CHUNK-ORG-LA-CHANGES.md` §3 + §6. **Review status:** R7 PENDING.

## The deliverable (D-OS / OS-SR-4)
The ex-franchisee settlement for a bought-back store's CLOSED era `[from,to)`: usage rows, HO-supply cost
lines, retail-profit summary. Server-generated, Director-gated; HO's post-buy-back rows must never leak in.
The ENGINE (pure, body-driven like topology.js) + its proof suite are the W4 build; the HTTP route + LA
wiring are staging-apply.

## Pinned design

**P1 — signature (SR-61, supersedes SR-14/17).**
`buildBuybackExport({ storeId, rows, pricing: { storeMap, globalMap }, window, products, coverage,
graceClosed })`. `storeMap` = the bought-back store's OWN validated map (route pre-selects; a multi-store
`stores` object or franchisee-keyed map is REFUSED as malformed). The engine runs the SAME chain as the
client (`storeMap[productId] → globalMap[productId] → storeMap['*']`), WHOLE-CONFIG validation first —
shared fixtures prove engine == lens. Validators imported from topology.js (`validPricingSeries`,
`isIsoUtc` — added to its exports; no re-derivation).

**P2 — window + binding (SR-24/25).** `[from,to)` BOTH bounds enforced INSIDE the engine; boundary evaluated
on the row's UTC INSTANT (createdAt/Timestamp, validated ISO — never the Perth calendar-day string); a
window-adjacent row lacking a valid instant ⇒ refusal. Every supplied row must belong to `storeId`
(route pre-filters; engine re-checks).

**P3 — union semantics (SR-36/55/70).** Input rows = LIVE full-window + ARCHIVE full-window (Chunk-8
archives by monotonic ID — no date-partition seam), unioned + deduped by TransactionId. Same-list tombstones
apply. A CROSS-LIST tombstone (either direction) ⇒ FAIL-CLOSED CONFLICT surfaced for the Chunk-8
Director-correction path (aligns with CHUNK8 item 5 — never silently applied, keeping settlement and the
stock snapshot in agreement). Same-ID copies with differing financial/classification fields ⇒ FAIL CLOSED
(both surfaced); bit-identical copies collapse.

**P4 — coverage = explicit evidence (SR-26/36/56/68/75).** `coverage` is QUERY-COMPLETION EVIDENCE from the
route, never inferred from rows: full-window enumeration attestations for BOTH lists, each carrying the
COMPLETED archive-run version + the EXPORT LEASE id. Stability: the route refuses while an archive run is
IN PROGRESS and holds a bounded lease the archiver checks before starting a new run (lease has priority
over new runs; TTL-bounded — neither side starves; no scalar before/after compare). The engine validates the
attested union == `[from,to)` and the run/lease pair is consistent — else refusal, never a silently short
settlement.

**P5 — PROVISIONAL vs FINAL (SR-37/57/69).** Without `graceClosed`, the settlement is marked PROVISIONAL
(regenerable). FINAL requires BOTH: (a) graceClosed — the store's old-era flush grace consumed/expired; and
(b) DRAINED ingest — every OS-SR-10 grace record for the store TERMINAL under the pinned lifecycle
`issued → consumed (durably set BEFORE any row write in the same run) → committed (after the last row
write)`; `consumed`-but-not-`committed` ⇒ NOT drained (surfaced to reconcile). No sweep hand-waving.

**P6 — line valuation (SR-38 + W4.3).** HO-supply cost lines: stamps preferred (both-or-neither enforced),
lens for legacy rows, fail-closed on malformed. Retail-profit reads the frozen `UnitPriceAtTime` (K4);
legacy rows fall back per K4's own rule (surfaced). Sale-vs-wastage classification uses the carried
`StockFrom`/`StockTo` TEXT labels via a SHARED fixture-tested classifier (parity with client
`Txn.category`/`_isHOSupply`); unclassifiable rows land in a SURFACED `unclassified` bucket.

**P7 — money (SR-62/73).** All money fields validated under the canonical policy (JSON number, finite, ≥0,
≤1,000,000, ≤2dp; discount 0–100). Out-of-policy ⇒ malformed row ⇒ fail closed.

**P8 — archival interplay pins (SR-9, Kunal).** Stamps survive archival by construction (row fields);
an old-period franchise INVOICE reaching past the live window uses the existing Chunk-8 on-demand archive
read and SURFACES that older lines need the archive pull — never a silent partial render.

## Interfaces to other seams
- W4.2: the chain + validation semantics are THE SAME code-shape (shared fixture matrix).
- W4.3: stamp/label/money field carriage + both-or-neither are its pins; this engine consumes them.
- W4.1: exports the validators; the buyback plan's export window (`topology.js:517`) supplies
  `{franchiseeId, storeId, from, to}`.

## Proof plan (engine suite, the W4 deliverable)
Window boundary rows (at `to`, at `from`, invalid instant) · wrong-store rows refused · wrong-shape pricing
refused · gappy/unattested row sets refused · run/lease mismatch refused · cross-list tombstone ⇒ conflict ·
differing same-ID copies ⇒ fail closed · stamped/legacy/malformed valuation lines · classification fixtures
incl. unclassifiable · PROVISIONAL vs FINAL (grace record non-terminal blocks FINAL) · money-policy rejects ·
S-W4-5/10 as pinned in the ledger. Each with saboteur parity.
