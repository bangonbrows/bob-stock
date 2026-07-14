# OS-W4.4 — BUY-BACK EXPORT ENGINE (`buybackExport.js`) + GATED ROUTE CONTRACT

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 export seam (split from the frozen ledger
`AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-9, 14→61, 17, 24,
25, 26, 36, 37→57/69, 38, 55→70, 56→68/75, 58(engine side), 61, 62→73 + R7 folds SR-90..96. Route/LA
detail: `AZURE-CHUNK-ORG-LA-CHANGES.md` §3 + §6.
**Review status:** R7 FOLDED (AGY BLOCK×2 + Codex BLOCK×7, two converged pairs = 7 distinct, ALL REAL).
R8 PENDING.

## The deliverable (D-OS / OS-SR-4)
The ex-franchisee settlement for a bought-back store's CLOSED era `[from,to)`: usage rows, HO-supply cost
lines, retail-profit summary. Server-generated, Director-gated; HO's post-buy-back rows must never leak in.
The ENGINE (pure, body-driven like topology.js) + its proof suite are the W4 build; the HTTP route + LA
wiring are staging-apply.

## Pinned design

**P1 — signature (SR-61/90/91, supersedes SR-14/17).**
`buildBuybackExport({ storeId, rows: { live, archive }, pricing: { storeMap, globalMap }, window, products,
coverage, graceClosed, drain })`. Row PROVENANCE is explicit (SR-90): two separate arrays matching the two
attestations — a flat set cannot implement per-list tombstone semantics. `drain` (SR-91) = the grace-record
terminal evidence + visibility watermark (P5) — the pure engine must be ABLE to refuse a FINAL, so the
evidence is an input, not a route-side promise. `storeMap` = the bought-back store's OWN validated map
(route pre-selects; a multi-store `stores` object or franchisee-keyed map is REFUSED as malformed). The
engine runs the SAME chain as the client (`storeMap[productId] → globalMap[productId] → storeMap['*']`),
WHOLE-CONFIG validation first — shared fixtures prove engine == lens. Validators imported from topology.js
(`validPricingSeries`, `isIsoUtc` — added to its exports; no re-derivation).

**P2 — window + binding (SR-24/25).** `[from,to)` BOTH bounds enforced INSIDE the engine; boundary evaluated
on the row's UTC INSTANT (createdAt/Timestamp, validated ISO — never the Perth calendar-day string); a
window-adjacent row lacking a valid instant ⇒ refusal. Every supplied row must belong to `storeId`
(route pre-filters; engine re-checks).

**P3 — union semantics (SR-36/55/70/90/96).** Input rows = LIVE full-window + ARCHIVE full-window (Chunk-8
archives by monotonic ID — no date-partition seam), supplied as SEPARATE `rows.live`/`rows.archive` arrays
(SR-90). Tombstones apply WITHIN a list; a tombstone whose target sits in the OTHER list ⇒ FAIL-CLOSED
CONFLICT surfaced for the Chunk-8 Director-correction path (aligns with CHUNK8 item 5 — never silently
applied, keeping settlement and the stock snapshot in agreement). Dedup runs on BOTH identities (SR-96,
per CHUNK8 item 5): same TransactionId ⇒ bit-identical collapse / differing fields FAIL CLOSED; DIFFERENT
TransactionIds sharing an IdempotencyKey ⇒ FAIL CLOSED (one economic operation duplicated — corrupt state
the server's Enforce-Unique should have prevented).

**P4 — coverage = explicit evidence, under ATOMIC coordination (SR-26/36/56/68/75/92/93/95).** `coverage` is
QUERY-COMPLETION EVIDENCE from the route, never inferred from rows: full-window enumeration attestations for
BOTH lists, each carrying the COMPLETED archive-run version + the EXPORT LEASE id. Coordination is ONE
SHARED STATE RECORD (SR-92) with CAS/ETag conditional transitions — states `idle | run_active(heartbeat) |
export_lease(ttl)`; BOTH the archiver's run acquisition AND the export's lease acquisition are CAS
transitions on it (no check-then-act window; losers retry). LEASE CONTINUITY (SR-93): the route renews the
lease during long queries and, AFTER the second query, re-reads the record and asserts the SAME lease id was
held continuously (unexpired, no intervening run) — else discard + retry; the attestation carries this
post-check. CRASHED-ARCHIVER LIVENESS (SR-95): `run_active` carries a heartbeat; a run whose heartbeat is
stale is surfaced + driven to a TERMINAL state by the reconcile sweep (complete or roll back per Chunk-8's
publish-nothing discipline); the export refuses only heartbeat-FRESH runs — no indefinite lock-out in either
direction. The engine validates the attested union == `[from,to)` and the run/lease pair is consistent —
else refusal, never a silently short settlement.

**P5 — PROVISIONAL vs FINAL (SR-37/57/69/94).** Without `graceClosed`, the settlement is marked PROVISIONAL
(regenerable). FINAL requires ALL of: (a) graceClosed — the store's old-era flush grace consumed/expired;
(b) DRAINED ingest — every OS-SR-10 grace record for the store TERMINAL under the pinned lifecycle
`issued → consumed (durably set BEFORE any row write in the same run) → committed (after the last row
write)`; `consumed`-but-not-`committed` ⇒ NOT drained (surfaced to reconcile); and (c) VISIBILITY (SR-94):
`committed` durably records the WRITTEN ROW IDENTITIES (TransactionIds/item ids) of the grace-admitted
rows, and the engine asserts every one is PRESENT in the supplied row set — terminal state alone does not
prove the query saw the rows (read-index lag). `drain` carries (b)+(c) into the engine (P1).

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

## R7 fold record (2026-07-14) — 7 distinct, all REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-90** | Codex R7-1 (P1): a flat `rows` array cannot distinguish same-list from cross-list tombstones | P1/P3: signature takes `rows: { live, archive }` — provenance explicit, matching the two attestations |
| **W4-SR-91** | Codex R7-2 (P1): the pure engine had no drained-ingest INPUT — it could not reject a FINAL the proof plan requires it to reject | P1/P5: signature gains `drain` (grace terminal evidence + visibility watermark); FINAL validated inside the engine |
| **W4-SR-92** | Codex R7-3 (P1): "refuse while running, then take a lease" is check-then-act — both sides can believe they hold authority | P4: ONE shared coordination record, CAS/ETag transitions `idle \| run_active(heartbeat) \| export_lease(ttl)` — acquisition is atomic on both sides |
| **W4-SR-93** | Codex R7-4 (P1): lease expiry mid-query silently reopens the omitted-row race | P4: lease renewal + post-query continuity check (same lease id, unexpired, no intervening run — else discard + retry), carried in the attestation |
| **W4-SR-94** | AGY R7-3 + Codex R7-5 (CONVERGED, P1): `committed` proves the write happened, not that the export's QUERY saw it (read-index/replication lag) — FINAL could silently drop a grace-admitted row | P5: `committed` records the written row identities; the engine asserts each is PRESENT in the supplied row set (point-read/containment proof), as part of `drain` |
| **W4-SR-95** | AGY R7-4 + Codex R7-7 (CONVERGED, P2): a crashed archiver leaves `IN PROGRESS` forever — settlements locked out until engineering intervenes | P4: `run_active` heartbeat + reconcile-driven terminal recovery (complete or roll back per Chunk-8 publish-nothing); export refuses only heartbeat-fresh runs |
| **W4-SR-96** | Codex R7-6 (P1): TransactionId-only dedup contradicts CHUNK8 item 5 (TransactionId + IdempotencyKey across both lists) | P3: dual-identity dedup — distinct TransactionIds sharing an IdempotencyKey ⇒ FAIL CLOSED (duplicated economic operation = corrupt state) |

## Proof plan (engine suite, the W4 deliverable)
Window boundary rows (at `to`, at `from`, invalid instant) · wrong-store rows refused · wrong-shape pricing
refused · gappy/unattested row sets refused · run/lease mismatch + broken lease continuity refused ·
cross-list tombstone ⇒ conflict · differing same-ID copies ⇒ fail closed · shared-IdempotencyKey distinct-ID
copies ⇒ fail closed · flat/unmarked row set refused (provenance required) · stamped/legacy/malformed
valuation lines · classification fixtures incl. unclassifiable · PROVISIONAL vs FINAL (grace record
non-terminal blocks FINAL; a committed grace whose written ids are ABSENT from the row set blocks FINAL) ·
money-policy rejects · S-W4-5/10 as pinned in the ledger. Each with saboteur parity.
