# OS-W4.4 — BUY-BACK EXPORT ENGINE (`buybackExport.js`) + GATED ROUTE CONTRACT

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 export seam (split from the frozen ledger
`AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-9, 14→61, 17, 24,
25, 26, 36, 37→57/69, 38, 55→70, 56→68/75, 58(engine side), 61, 62→73 + R7 folds SR-90..96. Route/LA
detail: `AZURE-CHUNK-ORG-LA-CHANGES.md` §3 + §6.
**Review status:** R12 FOLDED (AGY BLOCK×1 + Codex BLOCK×2, one converged pair = 2 distinct, both REAL —
folded as SR-134/135; Codex cleared the SourceId-trust attack). R13 PENDING.

## The deliverable (D-OS / OS-SR-4)
The ex-franchisee settlement for a bought-back store's CLOSED era `[from,to)`: usage rows, HO-supply cost
lines, retail-profit summary. Server-generated, Director-gated; HO's post-buy-back rows must never leak in.
The ENGINE (pure, body-driven like topology.js) + its proof suite are the W4 build; the HTTP route + LA
wiring are staging-apply.

## Pinned design

**P1 — signature (SR-61/90/91/114/115, supersedes SR-14/17).**
`buildBuybackExport({ storeId, rows: { live, archive }, steps, controls, pricing: { storeMap, globalMap },
window, products, coverage, graceClosed, drain })`. Row PROVENANCE is explicit (SR-90): two separate arrays
matching the two attestations — a flat set cannot implement per-list tombstone semantics. `steps` (SR-114) =
the RecordSteps rows for every transferId appearing in the row set (enumeration-attested in `coverage`) —
the engine derives the transfer-item stamp projection from them (below). `controls` (SR-115/123) = tombstone/
correction rows queried BY TARGET IDENTITY (targets within the supplied row/drain identities), explicitly
NOT window-bounded (a post-buyback deletion's own instant sits past `to`) — supplied as
`controls: { live, archive }` (SR-123: same-list vs cross-list is undecidable from a flat set) with
PER-LIST FULL-TARGET-SET completion attestations: for EVERY supplied economic/drain identity, BOTH lists
were queried for controls targeting it, inside the SAME continuous lease (an omitted tombstone would
otherwise silently count a deleted row). `drain` (SR-91) = the grace-record terminal evidence + visibility watermark (P5) — the pure
engine must be ABLE to refuse a FINAL, so the evidence is an input, not a route-side promise. `storeMap` = the bought-back store's OWN validated map
(route pre-selects; a multi-store `stores` object or franchisee-keyed map is REFUSED as malformed). The
engine runs the SAME chain as the client (`storeMap[productId] → globalMap[productId] → storeMap['*']`),
WHOLE-CONFIG validation first — shared fixtures prove engine == lens. Validators imported from topology.js
(`validPricingSeries`, `isIsoUtc` — added to its exports; no re-derivation).

**P2 — window + binding (SR-24/25/115).** `[from,to)` BOTH bounds enforced INSIDE the engine for ECONOMIC
rows; boundary evaluated on the row's UTC INSTANT (createdAt/Timestamp, validated ISO — never the Perth
calendar-day string); a window-adjacent row lacking a valid instant ⇒ refusal. Every supplied row must
belong to `storeId` (route pre-filters; engine re-checks). CONTROL rows (`controls`, SR-115/123/124) are exempt
from the window by construction — they are bounded by TARGET IDENTITY instead (every control must target a
supplied row/drain identity; an untargeted control is refused), so a legitimately-deleted grace row can
prove "covered" without its post-window tombstone being either excluded or miscounted.
**TYPED CONTROL SEMANTICS (SR-124/130):** exactly TWO control types exist, each with pinned transformation
semantics — `deletion` (a tombstone: the target is REMOVED from the settlement) and `replacement` (the
Chunk-8 Director-approved current-dated correction, CHUNK8 item 2: the target is EXCLUDED and the
correction row is SUBSTITUTED, with window membership judged on its ORIGINAL-EVENT metadata — which is a
validated UTC INSTANT per SR-25, never a bare calendar date, else a boundary-adjacent replacement cannot be
assigned to `[from,to)`). **REPLACEMENT VALUATION — SERVER-MINTED (SR-130/134, corrects the R10 text):** a replacement is a POST-W4
row minted through the correction path — it has NO legacy origin by construction, so lens-at-read is NEVER
its valuation. It MUST carry both-or-neither stamps CAPTURED AT APPROVAL — and **approval is a
Director-sudo-gated SERVER operation (SR-134):** the route fetches the AUTHORITATIVE target (live or
archive), obtains the COMPLETE RecordSteps set for its transfer (with enumeration proof — a client device
cannot be trusted to hold archived steps; an approving device mid-sync would silently freeze the WRONG
tier), runs the canonical P6 precedence server-side (target row stamps → item stamps → lens-as-of the
ORIGINAL event), binds the original-event instant + the pricing publication version, and MINTS the
immutable stamps itself. Client-supplied stamp values are NEVER authoritative. An unstamped replacement is
a MALFORMED control ⇒ fail closed.
**ARCHIVED-TARGET CORRECTIONS ARE SAME-LIST BY CONSTRUCTION (SR-135):** a replacement approved for an
ARCHIVED target is WRITTEN INTO THE ARCHIVE LIST by the same server op (the CHUNK8 item-5
"snapshot/archive correction" arm, which W4 previously named as a remedy but never defined), under the
archive coordination lease, with the corresponding SNAPSHOT ADJUSTMENT applied atomically in the same
journaled operation when the correction changes a pre-cutoff balance (Chunk-8 snapshot integrity). Live
targets → live list. The SR-70 cross-list conflict rule therefore never fires on a legitimate correction —
it remains what it was always meant to be: a corruption detector. Identity =
targetTransactionId; dedup by control id. NO delta type exists (Chunk-8 defines none). Ambiguity —
multiple controls on one target, a replacement whose target is also deleted, a replacement chain — ⇒ FAIL
CLOSED, surfaced. Cross-list controls remain conflicts (SR-70).

**P3 — union semantics (SR-36/55/70/90/96).** Input rows = LIVE full-window + ARCHIVE full-window (Chunk-8
archives by monotonic ID — no date-partition seam), supplied as SEPARATE `rows.live`/`rows.archive` arrays
(SR-90). Tombstones apply WITHIN a list; a tombstone whose target sits in the OTHER list ⇒ FAIL-CLOSED
CONFLICT surfaced for the Chunk-8 Director-correction path (aligns with CHUNK8 item 5 — never silently
applied, keeping settlement and the stock snapshot in agreement). Dedup runs on BOTH identities (SR-96/109,
per CHUNK8 item 5): same TransactionId ⇒ bit-identical collapse / differing fields FAIL CLOSED. The
IdempotencyKey identity applies to VALIDATED NON-EMPTY keys only (SR-109): distinct TransactionIds sharing a
non-empty key ⇒ FAIL CLOSED (one economic operation duplicated — corrupt state the server's Enforce-Unique
should have prevented); a BLANK/absent key ⇒ that row's identity falls back to TransactionId alone and the
settlement metadata surfaces a legacy-keyed row count (pre-Chunk-4 rows predate the column) — blanks are
NEVER grouped as a shared key. NOTE (ground truth, kills the false-positive class): legitimate partial
fulfilment can never share a key — the receive key rides ONLY the initial receive rows (phase2.js:319/332;
receive is once-per-transfer, F2-CRIT02); top-up/return/resolution rows fall back to their unique
TransactionId (phase2.js:62, pinned NORMATIVE).

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
direction. FAIRNESS with LIVE REQUESTS ONLY (SR-108/116): the coordination record carries request flags
(`run_requested` / `export_requested`) a losing acquirer CASes; while a request is LIVE, the other side may
not immediately re-acquire (the requester gets the next turn) — bounded consecutive acquisitions in both
directions. EVERY request carries owner + data-store timestamp + a short TTL (SR-116): an EXPIRED request
is bypassed by acquirers and cleared by the reconcile sweep — a requester that crashed after raising its
flag can never lock the other side out. Symmetric in both directions, same lifecycle. The engine validates the attested union == `[from,to)` and the run/lease pair is
consistent — else refusal, never a silently short settlement.

**P5 — PROVISIONAL vs FINAL (SR-37/57/69/94).** Without `graceClosed`, the settlement is marked PROVISIONAL
(regenerable). FINAL requires ALL of: (a) graceClosed — the store's old-era flush grace consumed/expired;
(b) DRAINED ingest — every OS-SR-10 grace record for the store TERMINAL under the pinned lifecycle
`issued → consumed (durably set BEFORE any row write in the same run) → committed (after the last row
write)`; `consumed`-but-not-`committed` ⇒ NOT drained (surfaced to reconcile); and (c) VISIBILITY with TERMINAL OUTCOMES (SR-94/107):
`committed` durably records the WRITTEN ROW IDENTITIES (TransactionIds/item ids) of the grace-admitted
rows, and the engine asserts every one reached a TERMINAL, ACCOUNTED state in the supplied row set: PRESENT,
or COVERED by a validated SAME-LIST tombstone/correction (a Director may legitimately delete a
grace-admitted row later — literal presence alone would block FINAL forever). A recorded identity that is
neither present nor covered ⇒ refuse FINAL (read-index lag or loss); a CROSS-list tombstone on it stays a
conflict (P3). `drain` carries (b)+(c) into the engine (P1).

**P6 — line valuation (SR-38/114/122 + W4.3).** Transfer-linked rows follow the FULL W4.3 valuation
precedence: row stamps → the transfer ITEM's canonical stamps → lens. The middle tier is computed from the
`steps` input: the engine derives an item-stamp projection keyed `(transferId, productId)` using the SAME
fold precedence as the client (submit stamps permanent; receive-minted for stampless submits; resolve
overrides) — shared fixtures prove client fold == engine projection, so invoice and settlement value the
same row IDENTICALLY (both-or-neither enforced at every tier; fail-closed on malformed). **ORIGIN ASSERTION
(SR-122):** the lens tier is reachable for a transfer-linked row ONLY when the row is PROVABLY legacy —
every transferId in the economic rows must project a valid ORIGIN (a submit or backfill step) from `steps`;
steps present but no origin ⇒ fail closed; NO steps at all ⇒ legacy only if the row PREDATES the Chunk-4
steps epoch, else fail closed (a lost/uningested step is indistinguishable from legacy — and ledger + steps
push through SEPARATE endpoints, ledger first, so the gap is real). **EPOCH PROVENANCE (SR-129):** the
epoch comparison uses the row's ORIGINAL live-list id — live rows: their item ID; ARCHIVED rows: the
preserved `SourceId` (CHUNK8: the archive item's own ID is newly minted and NEVER epoch-comparable);
absent/invalid provenance id ⇒ refuse. Residual corner, pinned FAIL-CLOSED + surfaced: an ancient row
resurrected via backup restore and pushed by a modern device gets a post-epoch id with no steps — remedies
are the restoring device's backfill (if the record exists locally) or a Director `replacement` correction;
the settlement stays PROVISIONAL meanwhile. (A pre-Chunk-4 BUILD pushing directly is impossible post-Chunk-5
device auth — AGY's R11 scenario as stated cannot occur.) Grace records BIND the flushing device's expected
stepIds so drain proves STEP ingest, not just row ingest. Retail-profit reads the
frozen `UnitPriceAtTime` (K4); legacy rows fall back per K4's own rule (surfaced). Sale-vs-wastage
classification uses the carried `StockFrom`/`StockTo` TEXT labels via a SHARED fixture-tested classifier
(parity with client `Txn.category`/`_isHOSupply`); unclassifiable rows land in a SURFACED `unclassified`
bucket.

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

## R12 fold record (2026-07-14) — 2 distinct (one converged pair), both REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-134** | AGY R12-3 + Codex R12-4 (CONVERGED, P1): approval-time stamp capture had no data-acquisition contract — a Director device approving an ARCHIVED target (or one mid-sync) lacks the transfer steps, silently freezes the WRONG tier, and the syntactically-valid stamp pair defeats later validation | P2: replacement approval = a Director-sudo-gated SERVER op — fetches the authoritative target + complete steps (enumeration-proved), runs the canonical precedence server-side, binds instant + pricing version, MINTS the stamps; client values never authoritative |
| **W4-SR-135** | Codex R12-3 (P1): an archived target had NO legal replacement path — a live current-dated replacement targeting an archived row trips MY OWN SR-70 cross-list rule, so the SR-129 "Director replacement" remedy could never produce a FINAL (self-contradiction between my folds) | P2: the server op writes an archived-target replacement INTO THE ARCHIVE list (the CHUNK8 item-5 correction arm, now actually defined), under the archive lease, with the atomic snapshot adjustment; SR-70 stays a pure corruption detector |

## R11 fold record (2026-07-14) — 2 distinct (both converged pairs), both REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-129** | AGY R11-4 + Codex R11-1 (CONVERGED, P1): the epoch rule compared the WRONG id for archived rows (the archive item's own ID is newly minted; CHUNK8 preserves the original as `SourceId`) — a genuine pre-Chunk-4 archived row reads post-epoch and blocks FINAL. AGY's late-syncing legacy-DEVICE variant is IMPOSSIBLE post-Chunk-5 (device auth rejects pre-Chunk-4 builds), but the backup-resurrection corner is real | P6: epoch provenance = live item ID / archived `SourceId`; absent ⇒ refuse; the resurrection corner stays fail-closed + surfaced with pinned remedies (backfill / Director replacement / PROVISIONAL meanwhile) |
| **W4-SR-130** | AGY R11-5 + Codex R11-2 (CONVERGED, P1): my R10 replacement-valuation text ("own stamps/lens-as-of-original-date") let an UNSTAMPED replacement of a stamped transfer drop to the lens — wrong dollars vs the original; and `originalDate` as a calendar day can't be window-assigned at the boundary | P2: replacements MUST carry both-or-neither stamps captured AT APPROVAL via the full P6 precedence (unstamped = malformed, fail closed); original-event metadata = validated UTC INSTANT |

## R10 fold record (2026-07-14) — 3 distinct, all REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-122** | AGY R10-4 + Codex W4.3-R10-2 (CONVERGED, P1, shared with W4.3): a missing origin step silently drops valuation to the lens while the client (holding the step locally) bills submit stamps — and step ingest is NOT proven by row ingest (separate endpoints) | P6: origin assertion + Chunk-4 steps-epoch rule + grace records bind expected stepIds |
| **W4-SR-123** | Codex R10-1 (P1): `controls` was FLAT (same/cross-list undecidable — my R9 fold was inconsistent with the very provenance rationale that split `rows`) and had no completeness proof (an omitted tombstone counts a deleted row) | P1/P2: `controls: {live, archive}` + per-list full-target-set completion attestations inside the same lease |
| **W4-SR-124** | Codex R10-2 (P1): "tombstone/correction" conflated two operations with different arithmetic — a replacement-for-8 covering a row-of-10 could count 0, 18, or a delta depending on reading | P2: TYPED controls — `deletion` removes; `replacement` substitutes (window membership by original-date metadata per CHUNK8 item 2, valuation on the correction row); no delta type exists; ambiguity fails closed |

## R9 fold record (2026-07-14) — 3 distinct (two converged pairs), all REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-114** | AGY R9-3 + Codex W4.3-R9-1 cross-ref (P1): the engine physically lacked the transfer items that W4.3's valuation precedence requires — client invoice and server settlement would bill the same unstamped row DIFFERENTLY (an R8 fold of mine broke this interface) | P1/P6: `steps` input (enumeration-attested) + engine-side item-stamp projection with shared-precedence parity fixtures |
| **W4-SR-115** | Codex R9-1 (P1): SR-107's "covered by a later tombstone" is unsatisfiable — the control row's own instant sits past `to`, so the window excludes it (or the window rule rejects it if supplied) | P1/P2: `controls` input queried by TARGET IDENTITY, own provenance attestation, exempt from the window, must target a supplied identity |
| **W4-SR-116** | AGY R9-4 + Codex R9-2 (CONVERGED, P1): `run_requested` had no owner/TTL — an archiver crashing after raising it locks exports out forever (my R8 fairness fold; both auditors hit the attack target I listed) | P4: requests carry owner + store timestamp + short TTL; expired requests bypassed + reconciled; symmetric `export_requested` with the same lifecycle |

## R8 fold record (2026-07-14)
| # | Finding | Ground truth → fold |
|---|---|---|
| **W4-SR-107** | Codex R8-1 (P1): drain demanded LITERAL presence of every committed-recorded row — a legitimately tombstoned grace row blocks FINAL forever. REAL | P5: terminal outcomes — present OR covered by a validated same-list tombstone/correction; neither ⇒ refuse; cross-list ⇒ conflict |
| **W4-SR-108** | Codex R8-2 (P2): CAS gives safety, not progress — an export-retry stream can starve the archiver (or vice versa). REAL | P4: `run_requested` turn-taking on the coordination record — bounded consecutive acquisitions in both directions |
| **W4-SR-109** | Codex R8-3 (P1): blank legacy IdempotencyKeys had no pinned semantics (grouping blanks = false duplicates; ignoring blanks unvalidated = bypass). REAL. **AGY R8-2's partial-receive collision premise: NOT REAL** — the receive key rides ONLY initial receive rows (phase2.js:319/332, receive once-per-transfer F2-CRIT02); top-ups/returns use unique TransactionId fallback (phase2.js:62). Legitimate rows can never share a key | P3: non-empty validated keys participate in the second identity; blanks fall back to TransactionId + surfaced legacy count, never grouped; phase2.js:62 pinned normative |

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
valuation lines · the item-stamp projection parity matrix (client fold == engine projection; unstamped
stale-receiver row values at submit stamps in BOTH) · untargeted control refused; a targeted post-window
tombstone proves "covered" · expired request flags bypassed (no crashed-requester lockout) · classification
fixtures incl. unclassifiable · PROVISIONAL vs FINAL (grace record non-terminal blocks FINAL; a committed
grace whose written ids are neither present nor covered blocks FINAL) · money-policy rejects · S-W4-5/10 as
pinned in the ledger. Each with saboteur parity.
