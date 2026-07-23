# OS-W4.4 Contract 2 — Director correction-approval route: CONCRETE DESIGN

**Status: 🔍 SCOPE REVIEW R1 IN FLIGHT (nothing built, nothing deployed; D-C2-1..3 LOCKED by Kunal
2026-07-23 — see §12).** Parent contracts:
`AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md` (Contract 2) and `AZURE-CHUNK-ORG-LA-CHANGES.md` §6
(correction-approval bullet). Frozen behavioural spec: `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2
(SR-124/130/134/135/137/138/139/141/142/143/144/145/147/148/149/151). The parent spec is CONVERGED but
is the INPUT here, not a substitute — Contract 1's spec review found 3 real design flaws in a converged
parent, so this doc makes every physical decision explicit and attackable. The engine is FROZEN @
`131ccec`; its correction-control contract is the fixed target this route must satisfy
(`buybackExport.js` header CONTROLS FORM + lines 500-601, 783-800).

**What this contract delivers (plain summary):** the server-side operation a Director uses to correct a
ledger row after the fact — replace a wrong row (or remove one) with full financial integrity: the
server fetches the authoritative target, mints the replacement's price stamps itself, records the
server-known `targetLine {transferId, productId, qty}` and the server-captured `originalEventAt`
instant on the control (the two W4.4-R5 additions this contract exists for), and publishes the change
atomically so exports, archives, and devices can never see a half-applied correction.

---

## 0. Scope boundary

IN: the correction-approval Logic App + its pure Function helper; the four-state coordination record
(extending Chunk-8's two-state `archive_state`); the control-target reservation registry; the
correction journal + reconcile; control-row storage + the published control-head manifest; the SR-141
push-tombstone reservation claim; new sudo purpose; staging columns/lists.

OUT (explicitly NOT this contract): the buy-back export route itself (it will later READ the manifest
this route publishes); the SR-153..167 catalogue publication archive + semantic stamp validation
(separate deliverable — see §6 honest note H2); the BAD_VERSION queue (SR-168 makes control-op coverage
a DERIVED VIEW — this route writes nothing there, by design); the engine predicate change (return
re-audit, Kunal's standing marker); the pricing-change route; all client UI (a Director screen is a
later wave — this phase proves the route with credentialled runner scripts, as C1 did).

## 1. What exists today (ground truth the design builds on)

- **Coordination record:** ONE `AppConfig_Staging` item, `ConfigType='archive_state'`, JSON in
  `ConfigData`, currently two-state `{status:'idle'|'running', runId, lockAt}`; acquired by the archive
  LA via ETag-conditional MERGE (CAS), released `IF-MATCH: *` (`archive-def-current.json:10-35`).
- **Snapshot:** ONE `AppConfig_Staging` item `ConfigType='stock_snapshot'`,
  `ConfigData={version, cutoffId, stepCutoffTs, runId, balances:[{storeId,productId,balance}]}`,
  published LAST after verify (`archive-def-current.json:311-335`); balances math + fidelity hashes in
  `snapshotCompute.js` (tombstone-aware, publish-nothing on any gate failure).
- **Ledger lists:** `StockTransactions_Validate` (live) + `StockTransactions_Archive` (archive; rows
  carry `SourceId`, `ArchiveRunId`, `SnapshotVersion`, and since C1 the full carried economic set incl.
  `EconSig`). `StockTransactions_Quarantine` = the push reject sink.
- **Steps:** `RecordSteps_Staging` (StepId Enforce-Unique) with its own push/pull LAs; receive/resolve
  steps carry `payload.expectedLedgerKeys` (phase2.js:542) and receive rows carry the
  `transfer:<id>:receive:<store>:<product>` IdempotencyKey (phase2.js:64, Enforce-Unique).
- **Tombstones:** a device deletion is an ordinary `Type='deleted'` ledger row with
  `TargetTransactionId` (db.js:888-911), pushed through push-v2 like any row and C1-sealed
  (TargetTransactionId is a covered field, attestRows.js:63).
- **Auth:** the archive LA's triple gate — device/Director key via `validateKeys`, sudo proof via
  `verifyProof` (purpose-pinned, 5-min TTL, TokenVersion-bound), role `director` from the CURRENT user
  row (`archive-def-current.json:703-770`). `SUDO_PURPOSES` today has no correction purpose
  (validateUser.js:30).
- **Journal pattern to mirror:** the §1 topology LA discipline — pending journal + idempotent steps
  keyed on a change id, claims with owner/TTL/lease, reconcile sweep, digest-bound opId with the
  idempotency lookup BEFORE CAS (LA-CHANGES §1/§6 pricing bullet).
- **Idempotent replay:** C1 proved the deterministic-outputs style (same runId ⇒ no duplicates); this
  route adopts deterministic server-minted ids (§5) for the same reason.

## 2. Deliverable inventory (NEW, this contract)

| # | Artifact | Kind |
|---|----------|------|
| N1 | LA `bob-stock-correction-staging` | NEW Logic App (all SharePoint I/O, gates, CAS, journal execution; modes create / supersede / withdraw / reconcile) |
| N2 | Function route `correctionCompute` | NEW pure route in `azure-functions` (canonical digest, stamp minting precedence, targetLine/originalEventAt capture rules, delta-exactness verify, candidate assembly, recovery decision) — same division of labour as archive LA ↔ `snapshotCompute` |
| N3 | List `ControlRegistry_Staging` | NEW — the SR-141 control-target reservation registry (one item per target, `TargetTransactionId` Enforce-Unique) |
| N4 | List `CorrectionJournal_Staging` | NEW — correction journals; doubles as the idempotency store (`OpId` Enforce-Unique) |
| N5 | Coordination record v2 | EXTEND `archive_state` to the four-state machine + request flags (§3) |
| N6 | Snapshot payload v2 | EXTEND `stock_snapshot.ConfigData` with `controlManifest` (§7) — the SR-148 "revision rides the publication" |
| N7 | Control columns | ADD to BOTH ledger lists: `ControlId`, `ControlType`, `ControlRevision`, `BornPublicationVersion`, `TargetLine` (JSON text), `OriginalEventAt` (ISO text) |
| N8 | `'correction'` sudo purpose | ADD to `SUDO_PURPOSES` + the client sudo prompt map (client half rides the next client wave; runner scripts mint it directly meanwhile) |
| N9 | push-v2-validate amendment | The SR-141 tombstone reservation claim + quarantine divert (§8) |
| N10 | Archive-LA scoped amendments | Carry `controlManifest` forward on publish; refuse while a correction journal is non-terminal; state-vocabulary v2 (§3/§7) — ⚠ amendments to Chunk-8-audited surfaces, flagged for the return re-audit like the C1 carry amendments |
| N11 | Proof suite `test/correction-proof.js` | Pure-function probes (attack surface for this review — see §11) |
| N12 | Staging runner scripts in `audit-artifacts/` | Kunal-executed apply + credentialled E2E probes (the established C1 pattern) |

## 3. The coordination record — four-state machine (SR-137/140)

`archive_state.ConfigData` becomes:

```
{ state: 'idle' | 'run_active' | 'export_lease' | 'correction_active',
  // state payloads
  runId?, heartbeatAt?,                       // run_active (archive)
  leaseId?, ttlAt?,                           // export_lease (future export route)
  journalId?, opId?, owner?,                  // correction_active (+ heartbeatAt)
  // fairness request flags (SR-140) — each {owner, storeTimestamp, ttlAt} | null
  run_requested, export_requested, correction_requested,
  v: 2 }
```

- EVERY transition is an ETag-conditional MERGE on the one item (CAS — no check-then-act), exactly the
  Chunk-8 acquire mechanics, extended vocabulary.
- Mutual exclusion: only `idle` is acquirable. `correction_active` excludes runs/exports/other
  corrections. (It deliberately does NOT exclude a device tombstone riding an ordinary push — that race
  is closed by the reservation registry, §4/§8, per SR-141.)
- Fairness: an acquirer that loses sets its request flag (same CAS write); every acquirer, before
  acquiring, honors any LIVE unexpired competing flag by yielding; expired flags are cleared in
  passing. The archive LA gains the same behaviour at N10 (today it just 409s).
- Heartbeat: the correction LA re-stamps `heartbeatAt` between phases (§5). Stale =
  `now - heartbeatAt > 10 min` (T-1, §10). A stale `correction_active` is recoverable ONLY via the
  reconcile path (§6) — never blind-released.
- Compatibility: the archive LA's `Lock_check`/`Acquire_lock`/`Release_*` move to the v2 vocabulary
  (`running` → `run_active`); a one-time staging migration rewrites the stored record. The archive LA
  additionally REFUSES (409 `correction_pending`) while any correction journal is non-terminal — the
  SR-139 "recovery runs BEFORE any archive run" pin (§6).

## 4. The control-target reservation registry (SR-138/141/143/144/147)

`ControlRegistry_Staging` — ONE item per target, spanning BOTH ledger lists by construction (the
target's TransactionId is list-agnostic). Columns:

```
TargetTransactionId (Text, Enforce-Unique + indexed)   ← the atomic claim primitive
State        'pending' | 'committed' | 'pending_supersede'
Owner, OpId, JournalId, TtlAt                          ← pending-phase fields
ControlId, Revision (int), PublicationVersion (int)    ← committed-phase fields
PriorCommitted (JSON text)                             ← pending_supersede: the saved committed lock
Origin       'director' | 'device'
```

- **Claim = item CREATE** (SharePoint Enforce-Unique makes the race atomic: second creator gets a
  conflict — the same primitive the receive-key relies on). Transitions on an existing item = ETag CAS.
- **Lifecycle (SR-143):** `pending(owner, opId, journalId, ttl)` → `committed(controlId,
  publicationVersion)` at publication (§5 step P6). An initial-create rollback DELETES the pending item
  (releases to empty). Orphaned pendings (crash between claim and publish) are TTL+journal-reconciled
  (§6) on BOTH writer paths.
- **Supersede/withdraw (SR-147/149):** claims by CAS `committed → pending_supersede` with the prior
  committed lock saved in `PriorCommitted`; a pre-publication rollback RESTORES it verbatim — never
  releases to empty (a racing device tombstone would otherwise claim the vacated slot). The mode gate
  re-reads the item AFTER acquiring `correction_active` and rejects unless the committed
  `{ControlId, Revision, PublicationVersion}` EXACTLY equals the intent's observed
  `expected {activeControlId, revision, publicationVersion}` (the AA-03 pattern).
- **Device tombstones claim too (SR-141, §8):** the push path creates
  `{State:'committed', Origin:'device', ControlId:<tombstone TransactionId>, Revision:0,
  PublicationVersion:<current>}` at insert time — a tombstone IS an immediately-effective deletion
  control, so it commits without a journal. A conflict on create ⇒ the tombstone is quarantined.
- One ACTIVE effective control per target (SR-144) = one registry item per target, whose committed
  head always names the currently-effective revision; history stays in the append-only control rows.

## 5. The route — request contract and order of operations

### Request (LA `bob-stock-correction-staging`)

```
{ auth: { deviceId, storeId, directorKey },          // validateKeys, as archive LA
  actorUsername, proof,                              // sudo proof, purpose 'correction'
  intent: {
    mode: 'create' | 'supersede' | 'withdraw',
    opId,                                            // client-minted stable id (idempotency)
    targetTransactionId,
    expected?: { activeControlId, revision, publicationVersion },   // REQUIRED for supersede/withdraw
    control: { type: 'deletion' }
           | { type: 'replacement',
               row: { productId, qty, type, reason?, stockFrom?, stockTo?,
                      stockFromStoreId?, stockToStoreId? } }        // ECONOMIC identity only —
  } }                                                               // stamps/instants NEVER accepted
```

Response: `{ ok:true, controlId, revision, publicationVersion }` |
`{ ok:false, reason, detail? }`. A replay of a terminal opId returns the SAME stored result; a reused
opId with a DIFFERENT canonical digest is rejected `OPID_REUSED` (digest = JSON-array-framed canonical
of mode + target + expected + control payload + actorUsername — the attestRows `canonical()` style;
computed by `correctionCompute`).

### Order of operations (mode create; supersede/withdraw differences in §5b)

- **P0 gates.** Triple gate identical to the archive LA (`directorOk` + `proof ok, purpose
  'correction', deviceContext-bound` + current-row role `director`). Fail → 401/403 split as there.
- **P1 idempotency lookup — BEFORE any CAS** (the §6 pricing-route pin): read
  `CorrectionJournal_Staging` by OpId. Terminal journal → return its stored result. Non-terminal
  journal for THIS opId → run reconcile (§6) and return its outcome. Digest mismatch → `OPID_REUSED`.
- **P2 acquire.** Reconcile pre-pass: any OTHER non-terminal correction journal, or a stale
  `correction_active`, is driven terminal first (§6). Then CAS `idle → correction_active(journalId
  minted, opId, owner, heartbeatAt)`, honoring live request flags (§3). Busy → 409 (+ set
  `correction_requested`).
- **P3 fetch authoritative state (all server-side reads).**
  1. Target row: query BOTH ledger lists by TransactionId. Not found ⇒ `TARGET_NOT_FOUND`. Found in
     both ⇒ the CHUNK8 dual-identity conflict — `TARGET_DUPLICATED`, fail closed, surfaced. Target is
     itself a control row or tombstone (`ControlId` set or `Type='deleted'`) ⇒ `TARGET_IS_CONTROL`.
  2. Target seal: `attestRows op:'verify'` on the fetched row. A SEALED target failing verification ⇒
     `TARGET_SEAL_BROKEN` (fail closed — the stored row can't be trusted as the authority the control
     is derived from; that row is itself correction-worthy, but through Director review of the
     underlying record, not silently). Unsealed (pre-C1) targets: see the targetLine rules below.
  3. Steps: if the target has a `TransferId`, page `RecordSteps_Staging` for
     `RecordId eq <transferId>` until exhausted (the enumeration proof = completed page walk with a
     continuity re-read of the last page, recorded in the journal). Fold via the same projection rules
     the engine uses (receive/resolve authority).
  4. Mode gate (registry re-read AFTER acquiring the state — §4). Create additionally runs the BELT
     query: no existing row in EITHER list with `TargetTransactionId == target` or a `ControlId` head
     for it (pre-registry tombstones predate N3 — the registry alone can't prove absence; Q3).
- **P4 compute (pure — `correctionCompute`).** Validates the intent row (whole-number qty, known
  productId from the supplied catalogue read, bounded labels); then mints:
  - **`targetLine` (R5 AGY-1 — the reason this contract exists):** for a transfer-linked target,
    `{transferId, productId, qty}` captured from the SERVER step authority — the receive/resolve
    step's receivedQty (else sentQty), NEVER the stored row's editable fields; the row's membership in
    `expectedLedgerKeys` is asserted first (`ROW_NOT_IN_TRANSFER_LEDGER` else). For a transferless
    target: targetLine from the row ONLY if C1-sealed (server-attested values); unsealed transferless
    ⇒ omitted (the engine only REQUIRES targetLine for transfer-linked targets).
    A transfer-linked target with NO steps (pre-epoch legacy) ⇒ `TARGET_PRE_EPOCH` — this route
    cannot mint a server-anchored targetLine for it, and the engine would refuse the control as
    malformed; those corrections stay in the existing manual lane (H3, Kunal-visible).
  - **`originalEventAt` (R5 Codex-3):** transfer-linked ⇒ the SUBMIT step's instant (the engine
    equality-checks exactly this, buybackExport.js:552-553); transferless ⇒ the target row's stored
    UTC instant (the engine's fallback, :554). Always a validated ISO-UTC instant (SR-130).
  - **Replacement stamps (SR-134/145, server-minted, both-or-neither):** precedence
    (a) the TARGET ROW's stored four-tuple, only if valid AND product identity matches the
    replacement's; (b) the transfer's ITEM stamps for the REPLACEMENT product (a product-changing
    replacement derives from ITS OWN product's sources — SR-145); (c) NO lens tier in this phase —
    server-side pricing history does not exist yet (the pricing route + activation seed are unbuilt),
    so a correction whose stamps cannot be minted from (a)/(b) is REJECTED `STAMPS_UNRESOLVABLE`
    (fail closed; regenerable once the pricing deliverables ship). → D-C2-1.
  - **Delta exactness (SR-142):** per affected `(storeId, productId)`:
    `newBalance = oldBalance − effect(target) + effect(replacement)`; every unaffected pair
    bit-unchanged. Deletion: `− effect(target)` only. Withdraw: `− effect(previousEffective) +
    effect(originalTarget)` — i.e. supersede-to-nothing (SR-144). Live-target corrections adjust NO
    balances (live rows are not in the snapshot) — manifest-only publication.
  - **Deterministic ids:** `controlId = 'ctl:' + opId` (+ `':' + revision` beyond rev 0); replacement
    output row `TransactionId = 'corr:' + opId + ':' + revision`. Deterministic ⇒ a crashed-and-rerun
    journal recreates identical rows (idempotent, the C1 runId lesson); collision against BOTH lists
    checked at P5 (the engine independently refuses collisions — CONTROL_OUTPUT_COLLISION).
- **P5 journal + candidate (publish-nothing until P6).**
  1. CREATE journal item `{OpId (unique), JournalId, Digest, Mode, Target, ActorUsername,
     State:'pending', CandidateVersion: activeVersion+1, Payload (the full computed candidate),
     heartbeat}`.
  2. Claim the reservation (§4) — create pending / CAS to pending_supersede. Conflict ⇒ rollback
     journal (`rolled_back`), release, `TARGET_RESERVED`.
  3. Write the candidate control row INTO THE TARGET'S OWN list (SR-135: archived target ⇒ archive
     list, live ⇒ live list) with the N7 columns + the minted stamps + `TargetLine` +
     `OriginalEventAt`. Candidate rows are INERT until published: nothing reads a control row except
     via the manifest head (SR-148), and the manifest doesn't name it yet.
  4. VERIFY: re-read the written row (field-for-field vs the candidate), recompute delta exactness
     from re-read inputs, check id collisions, registry/journal coherence. Any failure ⇒ roll back
     (delete candidate row, release/restore reservation, journal `rolled_back`, release state) —
     nothing was published.
- **P6 PUBLISH — the irrevocable commit (SR-139/148).** ONE ETag-CAS MERGE of
  `stock_snapshot.ConfigData` to `{version: CandidateVersion, balances: adjusted-or-unchanged,
  ...existing snapshot fields, controlManifest: {version: CandidateVersion, controlHeads: updated}}`
  (§7). CAS failure (someone published meanwhile — impossible under the state machine, belt anyway) ⇒
  full rollback as P5.4. Success ⇒ forward-only.
- **P7 terminal.** Registry → `committed(controlId, publicationVersion)` (supersede: overwrite with
  the new head; withdraw: `committed` with `Revision` advanced and the manifest head set to explicit
  null). Journal → `complete` + stored result. Release the coordination record → `idle`. Respond.

### 5b. Supersede / withdraw differences
Mode gate per §4 (expected-revision CAS). The candidate for a supersede is a NEW REVISION control row
(append-only — the prior revision's row is never edited or deleted); delta = `− effect(prevEffective)
+ effect(newEffective)`. Withdraw writes NO new control row — its publication flips the manifest head
to explicit `null` and restores the target's effect in the balances; the append-only original row
simply evaluates PRESENT again for drain (SR-144). Rollback of either RESTORES `PriorCommitted`
(SR-147).

## 6. Reconcile / crash recovery (SR-139/143)

One reconcile procedure, invoked from three places: the route's P2 pre-pass, an explicit
`mode:'reconcile'` invocation (Kunal-runnable), and the archive LA's acquire guard (which only REFUSES
and points at reconcile — it never reconciles corrections itself). For each non-terminal correction
journal, `correctionCompute` makes the DECISION and the LA executes it:

- Read the ACTIVE publication pointer (`stock_snapshot.version`) FIRST.
- `version == journal.CandidateVersion` ⇒ the publish landed pre-crash ⇒ **ROLL FORWARD only**:
  re-apply P7 idempotently (registry commit, journal complete, release). Never delete published rows.
- `version < journal.CandidateVersion` ⇒ pre-publish crash ⇒ roll BACK: delete the candidate control
  row if present (deterministic id makes it findable), release pending / restore `PriorCommitted`,
  journal `rolled_back`, release the state record.
- Orphaned registry pendings with no live journal (or a terminal one) past TTL ⇒ scrub (delete /
  restore) — the SR-117 claims pattern, both writer paths.
- Recovery runs BEFORE any archive run or export may acquire (§3 guard).

## 7. Control storage + the published manifest (SR-148/151)

- Control rows live IN the ledger lists (target's list), carrying the N7 columns. They are ordinary
  list rows to Chunk-8 (the archive LA does not treat them specially) — but visibility is manifest-only.
- `stock_snapshot.ConfigData.controlManifest = { version, controlHeads: { <targetTransactionId>:
  {controlId, revision, bornPublicationVersion} | null } }` — the COMPLETE per-target head map (not a
  delta), updated ONLY inside a publication (correction P6, and — carried forward unchanged — by the
  archive run's Publish, N10). There is NO other pointer; roll-forward/rollback selects the exact
  matching revision because manifest and version are one write (SR-148). The future export route reads
  `controlHeads` for its SR-151 per-target FINAL comparison; `bornPublicationVersion <=
  activeManifest.version` holds because heads are only born at their own publication.
- Device tombstones do NOT get manifest heads — they remain plain same-list rows (the engine's
  rows-level tombstone semantics), registered in §4 only for uniqueness.
- Control rows are NOT EconSig-sealed (they never pass push ingest); their authority chain is the
  manifest head binding (SR-152) — flagged as an explicit review question (Q2).
- Archive interplay: an archive RUN may later move a live control row to the archive list like any row
  — its head is unchanged (heads are list-agnostic by TransactionId). The engine's cross-list rule
  stays a pure corruption detector (SR-70).

## 8. push-v2-validate amendment — the SR-141 tombstone claim

After validation (and before the attest/insert pipeline), rows with `Type='deleted'`:
1. Attempt the registry claim (§4 device form). Success ⇒ proceed to insert as today.
2. Claim conflict (any existing registry item for that target) ⇒ divert the row to
   `StockTransactions_Quarantine` with reason `CONTROL_TARGET_RESERVED` and report it in the push
   response's failed set (`retryable:false`, surfaced — never silently dropped, never a second
   control). The device's local delete stands; the Director resolves the divergence through this
   route's lane.
3. Non-tombstone rows: untouched pipeline (C1 wiring unchanged).
Failure posture: registry unreachable ⇒ that tombstone (only) fails retryable — fail closed,
mirroring the C1 `ATTEST_UNAVAILABLE` posture. ⚠ Scoped amendment to the C1-audited push LA — flagged
for the return re-audit (N10 list).

## 9. Auth additions

`'correction'` joins `SUDO_PURPOSES` (validateUser.js:30) — 5-min TTL like every sudo purpose; the
client prompt map entry rides the next client wave (runner scripts mint proofs directly meanwhile,
exactly like the archive probes). The LA's gate composition is byte-for-byte the archive LA's triple
gate with the purpose swapped.

## 10. Pinned parameters (T-values — auditors: challenge these)

| Pin | Value | Rationale |
|-----|-------|-----------|
| T-1 correction heartbeat stale | 10 min | ≫ any phase duration; ≪ operational patience |
| T-2 reservation pending TTL | 15 min | > T-1 + reconcile time |
| T-3 request-flag TTL | 2 min | just enough to hand the next turn over |
| T-4 steps page size | 200 | matches existing pull paging |
| T-5 journal Payload cap | 60 KB | mirrors MAX_PAYLOAD_BYTES (records.js:73) |

## 11. Draft artifacts (attack surface for this review — NOT built yet)

Per the C1 pattern, after R1 questions land (or alongside them if the reviewers prefer concrete code),
the engineer will draft `correctionCompute` + `test/correction-proof.js` in-repo as a labelled attack
surface. The proof suite will cover, minimum: digest/idempotency matrix (replay, digest mismatch,
cross-mode reuse), the mode gate (create-on-reserved, supersede-on-stale-expected, withdraw races),
targetLine capture rules (step authority vs sealed row vs pre-epoch refusal), originalEventAt
equality with the engine's check, stamp precedence incl. SR-145 cross-product and the
STAMPS_UNRESOLVABLE fail-close, delta exactness (create/supersede/withdraw × live/archive), recovery
decisions (publish-boundary crash matrix, both roll directions, PriorCommitted restore), and
ENGINE-COUPLING probes: every control this route can mint must pass the FROZEN engine's control
validation (`buybackExport.js` MALFORMED_CONTROL / CONTROL_INSTANT_MISMATCH / CONTROL_CHAIN /
CONTROL_OUTPUT_COLLISION / head checks) — the route and engine are proven against each other, not
against copies.

## 12. Kunal decisions — LOCKED 2026-07-23

- **D-C2-1 (business-visible): APPROVED.** Until the server-side pricing history ships, a correction
  whose replacement stamps cannot be minted from the target row or the transfer's own item stamps is
  REJECTED (`STAMPS_UNRESOLVABLE`) rather than approved with lens-derived or client-suggested values.
  Fail closed; such corrections wait.
- **D-C2-2 (business-visible): APPROVED, with an owner ground-truth that de-risks the lane.** Kunal:
  all data predating the server phase is TRIAL data, not real — at go-live the app starts with fresh
  real data. So `TARGET_PRE_EPOCH` rejections are a correctness formality: production will contain no
  pre-epoch rows. The fail-closed design stands unchanged (the engine's conservative pre-epoch
  handling too); reviewers may treat the pre-epoch lane as defence-in-depth, not a live business path.
- **D-C2-3: APPROVED.** Deletion-type controls run through this route (the archived-target/cross-list
  arm) — same machinery, closes the CHUNK8 item-5 gap in one build.

## 13. Honest notes (engineer-flagged, for reviewers)

- **H1:** the four-state machine ships with `export_lease` DEFINED but with no acquirer until the
  export route builds — dead-state risk is nil (nothing can enter it), and defining it now avoids a
  second migration of a Chunk-8-audited record.
- **H2:** until SR-153/155 semantic validation ships, a target row's stamps are tamper-evident (C1
  seal) but not semantically validated — stamps minted from them inherit that trust level. The seal +
  step-authority rules bound what a correction can launder; the residual closes at the SR-155
  deliverable and is re-examined at the return re-audit.
- **H3 (Kunal-visible):** pre-epoch and stamp-unresolvable corrections are REJECTED fail-closed by
  this phase (D-C2-1/2) — the Director sees a clear reason, nothing is silently approved.
- **H4:** the registry cannot retroactively cover tombstones that predate it; the P3.4 belt query is
  the compensating control (both lists checked at approval time). Backfill of registry items for
  existing tombstones is deliberately NOT done (append-only history; the belt is sufficient) — Q3.
- **H5:** `correction_active` heartbeats are LA-clock timestamps used ONLY for staleness detection —
  no economic boundary derives from them (the W4 LA-clock prohibition applies to horizons/boundaries,
  not liveness).

## 14. Review questions (R1)

- **Q1:** the P2/P6 CAS pair — is there any interleaving of two concurrent approvals (or approval vs
  archive run) that reaches P6 twice for one CandidateVersion, or publishes against a moved snapshot?
- **Q2:** control rows are unsealed (no EconSig) — is manifest-head binding alone sufficient
  authority against a SharePoint-direct writer editing a PUBLISHED control row's fields (qty,
  stamps)? Should published control rows additionally be sealed via a server-side attest call at P5.3?
- **Q3:** is the P3.4 belt query (both-list absence check) an acceptable substitute for registry
  backfill of pre-existing tombstones, given both run under `correction_active` exclusivity?
- **Q4:** the SR-141 push claim (§8) — any race between a device tombstone's registry CREATE and an
  approval's pending claim that yields two effective controls, or quarantines a legitimate tombstone
  without surfacing it?
- **Q5:** withdraw publishes NO row and flips a head to null — walk the drain/PRESENT-again semantics
  (SR-144) against the frozen engine: any state where a withdrawn target is neither PRESENT nor
  COVERED?
- **Q6:** reconcile's roll-forward test is `version == CandidateVersion` — is equality sufficient,
  or can an archive run interleave between crash and reconcile such that the pointer moved PAST the
  candidate (version > candidate with the candidate published)? (The §3 archive guard should make
  this unreachable — verify.)

## 15. Sequencing after convergence

Fix→re-route this spec until BOTH reviewers pass → Kunal go → build N2/N11 (pure function + proofs,
gated locally) → staging apply N3-N10 via Kunal-executed runners → credentialled E2E probes (create /
supersede / withdraw / crash-drill / tombstone-race / archive-interplay, driven as
`srvaudit_director`) → BUILD audit (both reviewers drive the deployed route with scoped credentials)
→ then SR-155 stamp validation (rides AA §3-4) → the return engine+server re-audit (Kunal's firm
marker: engine predicate change + sealed-pre-epoch rule + the R5-R7 reproductions failing at
ingest/verify).
