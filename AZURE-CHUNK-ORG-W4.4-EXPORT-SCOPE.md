# OS-W4.4 — BUY-BACK EXPORT ENGINE (`buybackExport.js`) + GATED ROUTE CONTRACT

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 export seam (split from the frozen ledger
`AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-9, 14→61, 17, 24,
25, 26, 36, 37→57/69, 38, 55→70, 56→68/75, 58(engine side), 61, 62→73 + R7 folds SR-90..96. Route/LA
detail: `AZURE-CHUNK-ORG-LA-CHANGES.md` §3 + §6.
**Review status:** R17 FOLDED (AGY BLOCK×2 + Codex BLOCK×2 — BOTH pairs fully CONVERGED = 2 distinct, both
REAL, both defects in MY R16 fold wording — folded as SR-151/152; CLEARED: supersede restore-on-rollback,
expected-revision CAS, manifest-riding revision, cross-product lens selection). R18 PENDING — the LAST open
part, surface ≈ these two folds.

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
**ARCHIVED-TARGET CORRECTIONS ARE SAME-LIST BY CONSTRUCTION (SR-135/137):** a replacement approved for an
ARCHIVED target is WRITTEN INTO THE ARCHIVE LIST by the same server op (the CHUNK8 item-5
"snapshot/archive correction" arm, which W4 previously named as a remedy but never defined). **PUBLICATION
PROTOCOL (SR-137/139/142 — "atomic" made realizable):** the shared coordination record gains a
`correction_active(heartbeat, journalId)` state, CAS-acquired and MUTUALLY EXCLUSIVE with `run_active` and
`export_lease`. The op follows the Chunk-8 publish-nothing discipline: journal (persisting the CANDIDATE
VERSION id) → write the candidate correction row + prepare the adjusted snapshot → VERIFY → PUBLISH the new
snapshot/archive version LAST → terminal-complete the journal → release the state.
**PUBLICATION IS THE IRREVOCABLE COMMIT POINT (SR-139):** the reconcile sweep, on finding a non-terminal
correction journal, READS THE ACTIVE PUBLICATION POINTER first — if it matches the journal's persisted
candidate version, the publish succeeded pre-crash and the sweep MUST ROLL FORWARD (terminal-complete +
release), NEVER roll back (a rollback would delete rows/adjustments an already-published version points at,
corrupting Chunk-8 archive integrity and splitting devices across versions); only a PRE-publish journal may
complete or roll back. The prior version is intact after a crash at any point BEFORE publication; after it,
forward is the only direction. Recovery runs BEFORE any archive run or export may acquire the record.
**THE VERIFY INVARIANT (SR-142 — replaces "neutrality", which is the wrong test for a
balance-CHANGING-by-design correction):** per affected `(storeId, productId)`:
`newSnapshot = oldSnapshot − effect(target) + effect(replacement)`, EVERY unaffected pair bit-unchanged,
and the published snapshot + live rows must equal the corrected archive/control fold (delta EXACTNESS —
rejects both a Chunk-8-style old==new test that would refuse the legitimate 10→8 correction AND a sign
error that would drift the snapshot to 12). Content hashes prove integrity, never economics.
Live targets → live list (no snapshot interplay; same journal discipline).
**CONTROL-TARGET RESERVATION with LIFECYCLE (SR-138/141/143):** control uniqueness is enforced by a DURABLE
RESERVATION on the target identity (a server-enforced unique control-target index / CAS registry spanning
BOTH lists) that EVERY control writer must claim before its control lands — the correction-approval op AND
the ordinary push ingest's tombstone path (SR-141: `correction_active` excludes runs/exports/other
corrections but NOT a store device's deletion tombstone riding the normal ledger push — an absence QUERY
cannot be made atomic against an independent writer; only a shared reservation can). A second claim on an
actively-reserved target is REJECTED (the push path quarantines the tombstone for Director review, never
silently drops it). **RESERVATION LIFECYCLE (SR-143):** `pending(owner, opId, journalId, ttl)` →
`committed(controlId, publicationVersion)` — ONLY a successfully PUBLISHED control commits the reservation;
a pre-publication rollback RELEASES/VOIDS the pending entry, and orphaned pendings (crash between reserve
and publish, on either writer path) are reconciled idempotently via TTL + journal cross-check (the SR-117
claims pattern) — a failed approval can never permanently lock a target that has NO control.
**ONE *ACTIVE* CONTROL PER TARGET — SUPERSEDE, NOT FOREVER (SR-144/147/148/149):** the invariant is one
ACTIVE EFFECTIVE control per original target, not one immutable decision for all time (a Director typo in a
replacement was otherwise permanently uncorrectable — no chain, no second claim, no path). A
Director-sudo-gated **SUPERSEDE / WITHDRAW** operation runs through the SAME correction-approval route
(correction_active state, journal, verify, publish-LAST) UNDER THE SAME original-target reservation, with
history preserved as immutable, append-only VERSIONED REVISIONS and exactly ONE published-effective control
per target at any time. Three composition pins:
- **SUPERSEDE RESERVATION STATE (SR-147):** a supersede claims via `pending_supersede(priorCommitted)` —
  a pre-publication rollback RESTORES the prior `committed` lock, never voids it (blindly applying SR-143's
  release would strip the published predecessor's protection and let a racing device tombstone claim the
  empty reservation, minting the exact ambiguity the engine bricks on). Only an INITIAL create's rollback
  releases to empty.
- **THE REVISION RIDES THE PUBLICATION MANIFEST (SR-148/151):** there is NO separate mutable active-control
  pointer — the effective-control revision is PART of the candidate snapshot/archive version, and the
  active PUBLICATION pointer (SR-139) is the SOLE visibility switch. Roll-forward/rollback therefore
  automatically selects the exact revision matching the published version (all three crash splits close:
  pointer-vs-snapshot can never disagree because they are one publication). **THE FINAL COMPARISON IS
  PER-TARGET-HEAD, NOT GLOBAL EQUALITY (SR-151** — the R16 `publicationVersion == activeVersion` test was
  wrong: the version is GLOBAL, so any unrelated later correction advances it and an unchanged control
  fails forever; `<=` alone re-admits an obsolete superseded revision**):** the export verifies that
  `activeManifest.controlHeads[targetId]` names EXACTLY the supplied effective control —
  `{controlId, revision, bornPublicationVersion}` all match, with `bornPublicationVersion <=
  activeManifest.version`; a WITHDRAWN target carries an explicit null/withdraw head (never mere absence);
  if manifests are deltas rather than complete maps, the route walks the chain to the latest per-target
  revision before FINAL.
- **EXPECTED-REVISION CAS (SR-149):** every SUPERSEDE/WITHDRAW intent carries the observed
  `{activeControlId, revision, publicationVersion}`; after acquiring `correction_active` the server
  re-reads the committed reservation and REJECTS on mismatch before preparing any candidate (the AA-03
  pattern — serialization alone cannot detect an intent prepared against a stale revision; without this,
  a queued withdraw silently discards a newer supersede: immutable history, lost financial update). The
  route contract is SPLIT: initial-create requires NO committed reservation/control on the target;
  supersede/withdraw requires a committed reservation whose active revision EXACTLY matches the intent's.
Delta exactness for a supersede: `newSnapshot = old − effect(previousEffective) + effect(newEffective)`;
WITHDRAW = supersede-to-nothing (restores the original target's effect — and the append-only original row
simply evaluates PRESENT again for drain purposes, so SR-94/107 close without needing COVERED). The
engine's chain-ambiguity and SR-70 cross-list rules never fire on legitimate operations (corruption
detectors only).
**CROSS-IDENTITY VALUATION RULE (SR-145):** target-row/item stamps are usable for a replacement's minted
stamps ONLY when the identity they belong to matches the replacement's (same productId — and the same rule
for store/classification): a replacement that changes the PRODUCT must derive its stamps from the
REPLACEMENT product's own authoritative sources (its item stamps where genuinely transfer-linked to that
product, else the original-event lens FOR THAT PRODUCT) — copying the original product's stamps onto a
different product mis-values the line even though the stock delta is correct. Identity =
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
SHARED STATE RECORD (SR-92/140) with CAS/ETag conditional transitions — the FULL FOUR-STATE machine:
`idle | run_active(heartbeat) | export_lease(ttl) | correction_active(heartbeat, journalId)`; every
acquisition (archiver run, export lease, correction approval) is a CAS transition on it (no check-then-act
window; losers retry). LEASE CONTINUITY (SR-93): the route renews the
lease during long queries and, AFTER the second query, re-reads the record and asserts the SAME lease id was
held continuously (unexpired, no intervening run) — else discard + retry; the attestation carries this
post-check. CRASHED-ARCHIVER LIVENESS (SR-95): `run_active` carries a heartbeat; a run whose heartbeat is
stale is surfaced + driven to a TERMINAL state by the reconcile sweep (complete or roll back per Chunk-8's
publish-nothing discipline); the export refuses only heartbeat-FRESH runs — no indefinite lock-out in either
direction. FAIRNESS with LIVE REQUESTS ONLY, THREE-WAY (SR-108/116/140): the coordination record carries request
flags for ALL THREE actors (`run_requested` / `export_requested` / `correction_requested`), each
`{owner, storeTimestamp, ttl}`, CASed by a losing acquirer; while ANY competing request is LIVE, a
releasing holder's side may not immediately re-acquire — EVERY acquirer honors ALL live competing requests
(bounded consecutive acquisitions in every direction; a steady export stream can starve neither the
archiver NOR a Director's correction, and repeated corrections cannot starve an export). An EXPIRED request
is bypassed by acquirers and cleared by the reconcile sweep — a requester that crashed after raising its
flag can never lock the others out. Same lifecycle for all three. The engine validates the attested union == `[from,to)` and the run/lease pair is
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
same row IDENTICALLY (both-or-neither enforced at every tier; fail-closed on malformed). **ORIGIN + TIER-1 AUTHORITY
(SR-122/150/152):** tier-1 (row stamps) is trusted BY PROVENANCE, never by mere presence (SR-152 — the R16
narrowing exempted ALL row-stamped rows from origin proof, but ordinary ledger ingest validates only shape/
range/both-or-neither, not AUTHORITY: an authenticated-but-hostile device could push forged in-range stamps
and be paid on them). Pinned tier-1 rule:
- **Server-minted CONTROL rows** bypass origin proof — bound to their published control revision + the
  sudo-gated correction journal (SR-151's per-target head check IS the provenance).
- **Ordinary transfer-linked rows'** stamps must be CORROBORATED against the attested `steps` input the
  engine already holds (SR-114): the row's stamps must equal the stamps of the VALIDATED step that created
  that row per the item's basis chain (submit-propagated / receive-minted / resolve-pinned / top-up- or
  cancel-inherited) — binding to the step that minted THOSE stamps, not merely today's folded projection
  (legitimate conflict history can differ from the current head). Uncorroborated stamps ⇒ FAIL CLOSED for
  FINAL (forged or corrupt — never silently paid). The client invoice applies the same corroboration from
  its local fold.
- **UNSTAMPED transfer-linked rows** (the fallback tiers) keep the origin assertion unchanged: a valid
  ORIGIN (submit or backfill step) must project from `steps`; steps present but no origin ⇒ fail closed;
  NO steps at all ⇒ legacy only if the row PREDATES the Chunk-4 steps epoch, else fail closed (a
  lost/uningested step is indistinguishable from legacy — ledger + steps push through SEPARATE endpoints,
  ledger first, so the gap is real). A validated cross-product replacement still never faces the origin
  assertion (it is a control row — first bullet). **EPOCH PROVENANCE (SR-129):** the
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

## R17 fold record (2026-07-15) — 2 distinct (BOTH fully converged), both defects in my R16 folds
| # | Finding | Fold |
|---|---|---|
| **W4-SR-151** | AGY R17-1 + Codex R17-1 (CONVERGED, P1): my R16 `publicationVersion == activeVersion` FINAL check compared a PER-CONTROL birth version against a GLOBAL counter — any unrelated later correction advances it, so a store with more than one correction EVER can never reach FINAL (`<=` alone re-admits obsolete superseded revisions) | P2: per-target-head comparison — `activeManifest.controlHeads[targetId]` must name exactly the supplied `{controlId, revision, bornPublicationVersion}`, born ≤ active; withdrawn targets carry explicit null heads; delta-manifests walked to the per-target latest |
| **W4-SR-152** | AGY R17-2 + Codex R17-2 (CONVERGED, P1): my R16 origin narrowing exempted ALL row-stamped rows — but ingest validates shape, not AUTHORITY: a hostile authenticated device pushes forged in-range stamps ($1/99% vs the attested $100/25%) and the settlement pays them at tier 1 | P6: tier-1 authority BY PROVENANCE — control rows bind to their published revision (SR-151 check); ordinary rows' stamps must be CORROBORATED against the validated minting step in the attested `steps` input (already an engine input — no new machinery); uncorroborated ⇒ fail closed, never paid |

## R16 fold record (2026-07-15) — 4 distinct, all REAL (all supersede-composition edges)
| # | Finding | Fold |
|---|---|---|
| **W4-SR-147** | AGY R16-1 (P1): SR-143's release-on-rollback, blindly applied to a SUPERSEDE, voids the PUBLISHED predecessor's reservation — a racing device tombstone then claims the empty slot and mints the ambiguity the engine bricks on | P2: `pending_supersede(priorCommitted)` state; supersede rollback RESTORES the prior committed lock; only initial-create rollback releases to empty |
| **W4-SR-148** | Codex R16-1 (P1): the active-control pointer wasn't bound to the SR-139 publication commit — three crash splits (pointer-then-rollback without restore; publish-then-crash without the pointer step; withdraw's same split) desync snapshot and served control | P2: the effective revision RIDES the publication manifest; the publication pointer is the SOLE visibility switch (they cannot disagree); export verifies effectiveControl.publicationVersion == active version before FINAL |
| **W4-SR-149** | Codex R16-2 (P1): serialization ≠ staleness detection — a queued withdraw prepared against R1 silently discards a newer R2 (lost financial update); AND LA §6's "reject any covered target" guard contradicted supersede entirely | P2: expected-revision CAS on every supersede/withdraw (observed {controlId, revision, publicationVersion}, re-read + reject on mismatch); the route contract SPLIT (initial-create: no reservation; supersede/withdraw: exact revision match). LA §6 fixed |
| **W4-SR-150** | AGY R16-2 (P1): a validated cross-product replacement bricked on the SR-122 origin assertion (transferId present, no origin step for the NEW product ⇒ fail closed at read — a legal correction permanently jamming the settlement) | P6: the origin assertion is NARROWED to its purpose — it gates the item/lens FALLBACK for UNSTAMPED rows only; row-stamped rows (incl. every server-minted control) value at tier 1 and need no origin proof |

## R15 fold record (2026-07-14) — 4 distinct (one converged pair), all REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-143** | Codex R15-1 (P1): "reservations are terminal" with no lifecycle — an approval that reserves then FAILS verification leaves a dead terminal reservation on a target with NO control; every future control for it rejected forever (same crash window on the tombstone path) | P2: `pending → committed` lifecycle; only a PUBLISHED control commits; rollback releases; orphaned pendings TTL+journal-reconciled |
| **W4-SR-144** | AGY R15-1 + Codex R15-2 (CONVERGED, P1): one-control-FOREVER has no path to fix a Director typo or delete a corrected movement — no chain (engine rejects), no second claim (reservation terminal): a single human error permanently corrupts the settlement | P2: one ACTIVE effective control per target; Director-sudo SUPERSEDE/WITHDRAW through the same route under the same reservation; immutable versioned revision history; export sees exactly the published-effective control; supersede delta = −previousEffective +newEffective |
| **W4-SR-145** | Codex R15-3 (P1): cross-product replacements had correct STOCK arithmetic but copied the ORIGINAL product's stamps onto the NEW product (Shampoo's $20 minted onto Conditioner worth $35) | P2: identity rule — target/item stamps usable only when product (and store/classification) identity matches; else derive from the replacement product's own sources |
| **W4-SR-146** | Codex R15-4 (P2): LA §6's EXPORT paragraph still carried the superseded three-state/two-flag machine while the correction paragraph had four/three — two operative contracts, a literal implementer starves corrections | LA §6 stale paragraph replaced (doc bug) |

## R14 fold record (2026-07-14) — 4 distinct (two converged pairs), all REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-139** | AGY R14-1 + Codex R14-4 (CONVERGED, P1): a crash BETWEEN publish and terminal-complete left a non-terminal journal whose "completion or rollback" recovery could ROLL BACK an already-published version — deleting rows the live publication pointer references (archive corruption, devices split across versions) | P2: publication = the IRREVOCABLE commit point; the journal persists its candidate version; reconcile reads the ACTIVE publication pointer first — match ⇒ ROLL FORWARD only; pre-publish ⇒ complete or roll back |
| **W4-SR-140** | AGY R14-2 + Codex R14-2 (CONVERGED, P2): `correction_active` was bolted on without joining the state machine — P4/LA still said three states + two request flags (doc self-contradiction), and a correction had no way to wait in line (starvable by cooperating runs/exports; symmetrically, corrections could ignore an export request) | P4: full FOUR-state machine + THREE request flags `{owner, storeTimestamp, ttl}`; every acquirer honors ALL live competing requests; same expiry/scrub lifecycle |
| **W4-SR-141** | Codex R14-1 (P1): the SR-138 uniqueness guard excluded runs/exports/corrections but NOT an ordinary store device's deletion tombstone riding the normal ledger push (db.js:1135) — D and R could both land, minting the exact deletion+replacement ambiguity the engine permanently rejects | P2: a DURABLE UNIQUE control-target reservation spanning both lists that EVERY control writer claims (approval op AND the push ingest's tombstone path); second claim rejected + quarantined for Director review; reservations terminal |
| **W4-SR-142** | Codex R14-3 (P1): "neutrality" is undefined — and wrong — for a correction whose PURPOSE is to change a balance (Chunk-8's old==new test rejects the legitimate 10→8 fix; omitting it admits a sign error to 12; hashes prove content, not economics) | P2: the verify invariant is DELTA EXACTNESS per (storeId, productId): `newSnapshot = oldSnapshot − effect(target) + effect(replacement)`, unaffected pairs bit-unchanged, published snapshot + live rows == the corrected fold |

## R13 fold record (2026-07-14) — 2 distinct (one converged pair), both REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-137** | Codex R13-2 (P1): "atomic snapshot adjustment in the same journaled op" named no realizable protocol — two durable writes with no correction state on the coordination record, no publication ordering, no crash lifecycle; four concrete partial-state scenarios incl. a stale published archive-run version | P2: `correction_active(heartbeat, journalId)` CAS state mutually exclusive with runs/exports; candidate → verify → publish-LAST → terminal → release; reconcile drives crashed corrections terminal before runs/exports resume (the Chunk-8 publish-nothing discipline applied to corrections) |
| **W4-SR-138** | AGY R13-2 + Codex R13-3 (CONVERGED, P1): the approval op never checked EXISTING controls — a mistaken approval on an already-corrected/tombstoned target mints an immutable chain/ambiguity the engine then permanently fails closed on (the fail-closed detector becomes a bricking machine) | P2: approval-time uniqueness — query both lists by target identity under `correction_active`; reject covered targets and control-row targets; one control per original target, server-side + race-safe; the engine rule demotes to corruption detector |

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
