# OS-W4.4 Contract 2 — Director correction-approval route: CONCRETE DESIGN

**Status: 🔍 SCOPE REVIEW R2 (R1 verdicts: BOTH BLOCK — AGY F1-F6 + Codex 1-7, 12 distinct findings,
2 converged pairs, ALL ground-truthed REAL, zero refuted; all folded below + 1 engineer
family-inventory find. Nothing built, nothing deployed. D-C2-1..3 LOCKED by Kunal 2026-07-23 — §12).**
Parent contracts: `AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md` (Contract 2) and
`AZURE-CHUNK-ORG-LA-CHANGES.md` §6. Frozen behavioural spec: `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2
(SR-124/130/134/135/137/138/139/141/142/143/144/145/147/148/149/151). The engine is FROZEN @
`131ccec`; its correction-control contract is the fixed target (`buybackExport.js` header CONTROLS
FORM + lines ~500-601, 783-800).

**What this contract delivers (plain summary):** the server-side operation a Director uses to correct a
ledger row after the fact — replace a wrong row (or remove one) with full financial integrity: the
server fetches the authoritative target, mints the replacement's price stamps itself, records the
server-known `targetLine {transferId, productId, qty}` and the server-captured `originalEventAt`
instant on the control (the two W4.4-R5 additions this contract exists for), and publishes the change
atomically so exports, archives, and devices can never see a half-applied correction.

---

## R1 fold record (2026-07-24) — all findings REAL, all folded

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R1-1 | Stalled worker awakens after reconcile rolled it back and its stock_snapshot ETag CAS still SUCCEEDS (rollback never touched the snapshot) → manifest published pointing at a deleted row (AGY F1; same class as Codex 4b) | REAL — an ETag can encode "snapshot unmoved" but never "I still own the state" | THE PUBLISH FENCE + SEIZE protocol (§3a/§6): recovery SEIZES ownership via a new CAS state `correction_recovering` and its FIRST mutating act is a fence write to stock_snapshot (content-preserving `fence++`, new ETag); P6 uses the ETag captured AT ACQUIRE and NEVER re-reads; ownership re-asserted (ETag-conditional state re-stamp) at every phase boundary incl. immediately before P6 |
| C2-R1-2 | `IF-MATCH: *` releases let a stalled worker's P7 clobber a live successor's lock (AGY F1b) | REAL — inherited Chunk-8 release pattern, unsafe with >1 writer class | ALL releases (P7, rollback, and the archive LA's — N10) become ETag + state-content conditional: release only a state that is still MINE |
| C2-R1-3 | Manifest head binds only {controlId, revision, born} — a SharePoint-direct edit of a PUBLISHED control row's qty/stamps passes the head check and enters settlement (AGY F2 ≡ Codex 3, CONVERGED) | REAL — confirmed at buybackExport.js:517-519 (identity-only compare) + :535-545 (shape/range only) | CONTROL SEAL (§7a): attestRows gains a `ctl-v1` frame; every control row is server-sealed at P5.3 over its FULL immutable field set (incl. TargetLine, OriginalEventAt, Revision, stamps, qty); the export route verifies seals and refuses unverified controls (route-enforced now; engine-side requirement banked for the return re-audit) |
| C2-R1-4 | Pre-registry tombstones are permanently uncorrectable: supersede finds no committed reservation, create hits the belt query (AGY F3; Codex Q3 endorses belt+claim) | REAL design gap (near-hypothetical in production per D-C2-2 trial-data ground truth, but the lane must be correct) | LAZY REGISTRY ADOPTION (§4): the belt query finding an unregistered existing tombstone REGISTERS it (committed, Origin `device-adopted`) and the mode gate proceeds against the adopted head |
| C2-R1-5 | Device claim commits BEFORE the tombstone row is durable; a transient insert failure orphans a committed claim and the device's retry is quarantined by its OWN claim — contradicts frozen SR-143 (AGY F4 ≡ Codex 2, CONVERGED) | REAL — SR-143: only a landed control commits | SR-143-CONFORMANT DEVICE CLAIM (§8): `pending(owner=deviceId, opId=tombstoneId, ttl)` → attest+insert → CAS `pending→committed`; retry conflict with an item whose opId == this tombstone's id = OWN claim ⇒ idempotent re-entry; orphaned device pendings TTL-scrubbed; quarantine only on a FOREIGN claim |
| C2-R1-6 | A withdrawn/superseded target's obsolete control rows, if supplied, hit the engine's unconditional null-head/mismatch refusal — any export permanently refused (AGY F5) | REAL — buybackExport.js:518 | EXPORT ASSEMBLY CONTRACT (§7b): the export route supplies ONLY the control matching each ACTIVE head; historical revisions and withdrawn targets' rows are never supplied (withdrawn = null head + no control = target evaluates PRESENT, exactly SR-144) |
| C2-R1-7 | Reconcile's `version == CandidateVersion` equality breaks the moment ANY other writer bumps stock_snapshot — LA-CHANGES §1:73-74 names the (unbuilt) topology LA as exactly such a writer; a published correction gets rolled back (AGY F6; Codex Q6 same invariant) | REAL — §1 ground-truthed: topology stamps `stock_snapshot` | RECOVERY DECIDES BY MANIFEST CONTENT (§6): the journal stores the candidate HEAD; head present in the active manifest ⇒ roll FORWARD; absent AND version < candidate ⇒ roll back; absent AND version ≥ candidate ⇒ `INVARIANT_BROKEN` fail-closed, surfaced, manual — never a silent rollback. PLUS a flagged scoped amendment to LA-CHANGES §1: topology snapshot writes must acquire the shared coordination record, refuse while a non-terminal correction journal exists, preserve `controlManifest`+`fence`, and bump the shared version |
| C2-R1-8 | The frozen engine NEVER applies plain `Type='deleted'` rows: targets are removed only via manifest-headed controls (classify → direction 'none' → skip, buybackExport.js:140/627; removal only via controlByTarget :589-593; supplied controls require a non-null head :517-518). Device tombstones as designed (no heads) either leave their target ECONOMIC or brick the export (Codex 1) | REAL — the design's §7 "no heads for device tombstones" contradicted the frozen engine | TOMBSTONE HEAD ADOPTION (§7c): device tombstones get manifest heads via ADOPT publications — every correction publication opportunistically folds registry-committed unheaded tombstones into `controlHeads` ({controlId: tombstoneId, revision 0, born: this publication}), and a lightweight journaled `mode:'adopt'` (manifest-only, zero balance delta) exists for on-demand adoption; until adopted, the export route surfaces `TOMBSTONE_PENDING_ADOPTION` as a fail-closed PROVISIONAL blocker (never silently uncounted, never a brick) |
| C2-R1-9 | A crash between acquiring `correction_active` and creating the journal leaves a stale state NO reconcile rule can drive terminal — archives blocked forever (Codex 4a) | REAL — §6 keyed recovery off journals only | Seize rule (§6): stale `correction_active` whose journalId has NO journal item ⇒ seize → verify absence → scrub any reservation naming that journalId (belt; none can exist by ordering) → release to idle |
| C2-R1-10 | An indeterminate P6 response (MERGE applied, response lost) triggers full rollback of an actually-published correction (Codex 5) | REAL — classic lost-ack | OUTCOME-BY-READ (§5 P6): after ANY publish attempt the decision comes from re-reading the snapshot/manifest, never the HTTP result; rollback only after a POSITIVE read proving not-published; CAS-failure retry permitted ONLY while still owner (fence makes a post-seize retry impossible); ambiguous/unreadable ⇒ journal stays pending for reconcile |
| C2-R1-11 | Tier (a) stamp minting checked product identity only; frozen SR-145 requires product AND store/classification identity — a source/classification-changing replacement would inherit authority minted for a different classification (Codex 6) | REAL — spec conformance miss | §5 P4: tier (a) requires product + store + classification identity between target and replacement; otherwise tier (b) or `STAMPS_UNRESOLVABLE` |
| C2-R1-12 | targetLine rule ("receivedQty else sentQty") diverges from the engine's actual authority (a resolve's `resolutions[].qty` takes FINAL precedence, buybackExport.js:~330-335), and steps enumerated at P3 can be superseded before P6 (Codex 7) | REAL — both halves confirmed in code | §5 P4: `correctionCompute` consumes the ENGINE'S OWN `foldProjection` (additive export from the frozen buybackExport.js — exports only, zero behaviour change, flagged like topology's `reqId` precedent); P3 captures a canonical STEP-SET DIGEST, P5.4 verify re-enumerates and compares — mismatch ⇒ rollback `STEPS_CHANGED_RETRY`. Post-publication step changes surface at settlement as fail-closed reconciliation, remedied by supersede (honest note H6) |
| C2-R1-13 | (Engineer family inventory, banked rule) Control rows live in the ledger lists ⇒ they would ALSO surface (a) in the export's `rows` queries — the engine then sees the replacement row twice and refuses `CONTROL_OUTPUT_COLLISION` (:581) — and (b) in pull-v2 to DEVICES, where a replacement row would ingest as a phantom client-side stock movement | REAL both halves | §7b: the export's rows queries EXCLUDE rows carrying `ControlId` (a control's row reaches the engine only inside its ctl). N13: pull-v2-validate gains a `ControlId eq null` filter (+ client-side belt later); device-side visibility of corrections is a banked future lane (H7) |

**Q1-Q6 R1 outcomes:** Q1 NO (→ C2-R1-1/-9/-10 folds); Q2 NO (→ C2-R1-3); Q3 conditionally-yes
(→ C2-R1-4 lazy adoption); Q4 exposed C2-R1-5/-8; Q5 confirmed active-head-only supply (→ C2-R1-6);
Q6 equality insufficient (→ C2-R1-7, `version > candidate` without a published head = explicit
`INVARIANT_BROKEN`).

---

## 0. Scope boundary

IN: the correction-approval Logic App + its pure Function helper; the FIVE-state coordination record
(extending Chunk-8's two-state `archive_state`); the control-target reservation registry; the
correction journal + reconcile/seize; control-row storage + seals + the published control-head
manifest incl. tombstone adoption; the SR-141 push-tombstone reservation claim; the pull control-row
filter (N13); new sudo purpose; staging columns/lists.

OUT (explicitly NOT this contract): the buy-back export route itself (its ASSEMBLY CONTRACT is pinned
in §7b because this design defines what it must read, but the route builds later); the SR-153..167
catalogue publication archive + semantic stamp validation; the BAD_VERSION queue (SR-168: control-op
coverage is a DERIVED VIEW — this route writes nothing there); the engine predicate change and the
engine-side control-seal requirement (both banked for the return re-audit); the pricing-change route;
all client UI (runner scripts prove the route, as C1 did).

## 1. What exists today (ground truth the design builds on)

- **Coordination record:** ONE `AppConfig_Staging` item, `ConfigType='archive_state'`, JSON in
  `ConfigData`, currently two-state `{status:'idle'|'running', runId, lockAt}`; acquired by the archive
  LA via ETag-conditional MERGE (CAS), released `IF-MATCH: *` (`archive-def-current.json:10-35`) — the
  unconditional release is retired by C2-R1-2.
- **Snapshot:** ONE `AppConfig_Staging` item `ConfigType='stock_snapshot'`,
  `ConfigData={version, cutoffId, stepCutoffTs, runId, balances:[{storeId,productId,balance}]}`,
  published LAST after verify (`archive-def-current.json:311-335`); balances math + fidelity hashes in
  `snapshotCompute.js` (tombstone-aware, publish-nothing on any gate failure).
- **Ledger lists:** `StockTransactions_Validate` (live) + `StockTransactions_Archive` (archive; rows
  carry `SourceId`, `ArchiveRunId`, `SnapshotVersion`, and since C1 the full carried economic set incl.
  `EconSig`). `StockTransactions_Quarantine` = the push reject sink.
- **Steps:** `RecordSteps_Staging` (StepId Enforce-Unique) with its own push/pull LAs; receive/resolve
  steps carry `payload.expectedLedgerKeys` (phase2.js:542); receive rows carry the
  `transfer:<id>:receive:<store>:<product>` IdempotencyKey (phase2.js:64, Enforce-Unique). Step-qty
  authority in the frozen engine: resolve-pinned qty > receivedQty > sentQty (buybackExport.js
  foldProjection — the SOLE definition this design consumes, C2-R1-12).
- **Tombstones:** a device deletion is an ordinary `Type='deleted'` ledger row with
  `TargetTransactionId` (db.js:888-911), pushed through push-v2 like any row and C1-sealed
  (TargetTransactionId is a covered field, attestRows.js:63). The frozen ENGINE applies deletions ONLY
  via manifest-headed typed controls (C2-R1-8 ground truth).
- **Auth:** the archive LA's triple gate — device/Director key via `validateKeys`, sudo proof via
  `verifyProof` (purpose-pinned, 5-min TTL, TokenVersion-bound), role `director` from the CURRENT user
  row (`archive-def-current.json:703-770`). `SUDO_PURPOSES` today has no correction purpose
  (validateUser.js:30).
- **Journal pattern to mirror:** the §1 topology LA discipline — pending journal + idempotent steps
  keyed on a change id, claims with owner/TTL/lease, reconcile sweep, digest-bound opId with the
  idempotency lookup BEFORE CAS (LA-CHANGES §1/§6 pricing bullet).

## 2. Deliverable inventory (NEW, this contract)

| # | Artifact | Kind |
|---|----------|------|
| N1 | LA `bob-stock-correction-staging` | NEW Logic App (all SharePoint I/O, gates, CAS, journal execution; modes create / supersede / withdraw / adopt / reconcile) |
| N2 | Function route `correctionCompute` | NEW pure route (canonical digest, stamp minting via the engine's exported `foldProjection`, targetLine/originalEventAt capture, delta-exactness verify, candidate + manifest assembly, recovery DECISIONS incl. the manifest-content test) |
| N3 | List `ControlRegistry_Staging` | NEW — the SR-141 control-target reservation registry (`TargetTransactionId` Enforce-Unique) |
| N4 | List `CorrectionJournal_Staging` | NEW — correction journals; doubles as the idempotency store (`OpId` Enforce-Unique); carries heartbeat + the candidate HEAD |
| N5 | Coordination record v2 | EXTEND `archive_state` to the FIVE-state machine + request flags (§3) |
| N6 | Snapshot payload v2 | EXTEND `stock_snapshot.ConfigData` with `controlManifest` + `fence` (§7) |
| N7 | Control columns | ADD to BOTH ledger lists: `ControlId`, `ControlType`, `ControlRevision`, `BornPublicationVersion`, `TargetLine` (JSON text), `OriginalEventAt` (ISO text). Control rows are SEALED (`EconSig`, ctl-v1 frame — §7a) |
| N8 | `'correction'` sudo purpose | ADD to `SUDO_PURPOSES` + client prompt map (client half rides the next client wave) |
| N9 | push-v2-validate amendment | The SR-143-conformant tombstone claim + quarantine divert (§8) |
| N10 | Archive-LA scoped amendments | Carry `controlManifest`+`fence` forward on publish; refuse while a correction journal is non-terminal; state-vocabulary v2; CONDITIONAL releases (C2-R1-2) — ⚠ amendments to Chunk-8-audited surfaces, flagged for the return re-audit |
| N11 | attestRows `ctl-v1` frame | EXTEND the C1 route with the control-seal canonical (§7a) — ⚠ scoped amendment to the C1-audited function, flagged |
| N12 | Proof suite `test/correction-proof.js` + runner scripts | Pure-function probes + Kunal-executed staging apply/E2E (C1 pattern) |
| N13 | pull-v2-validate amendment | `ControlId eq null` filter — control rows never delivered to devices (C2-R1-13) — ⚠ flagged scoped amendment |
| N14 | buybackExport.js additive export | `foldProjection` exported (exports-only change to the frozen engine file, `reqId` precedent) — ⚠ flagged for the return re-audit |
| N15 | LA-CHANGES §1 amendment note | Topology snapshot writes join the coordination discipline (C2-R1-7) — ⚠ flagged scoped spec amendment |

## 3. The coordination record — five-state machine (SR-137/140 + C2-R1-1/-9)

`archive_state.ConfigData` becomes:

```
{ state: 'idle' | 'run_active' | 'export_lease' | 'correction_active' | 'correction_recovering',
  runId?, heartbeatAt?,                       // run_active
  leaseId?, ttlAt?,                           // export_lease (future export route)
  journalId?, opId?, owner?,                  // correction_active (+ heartbeatAt)
  recovering?: { journalId, recoverer },      // correction_recovering (+ heartbeatAt)
  run_requested, export_requested, correction_requested,   // each {owner, storeTimestamp, ttlAt} | null
  v: 2 }
```

- EVERY transition is an ETag-conditional MERGE (CAS). Only `idle` is acquirable for work;
  `correction_recovering` is acquirable ONLY by the seize rules below.
- Mutual exclusion as before; `correction_active` still does NOT exclude device tombstone pushes
  (closed by the registry, §4/§8).
- Fairness request flags as R1 design; expired flags cleared in passing.

### 3a. Ownership, seize, and the publish fence (C2-R1-1/-2/-9/-10)
- **Boundary re-assertion:** the owning worker re-stamps `heartbeatAt` via ETag-CAS at EVERY phase
  boundary (after journal create, after reservation claim, after candidate write, after verify, and
  IMMEDIATELY before P6). A failed re-stamp (state no longer mine) ⇒ the worker ABORTS (its journal
  is/was being recovered — it must not touch anything further).
- **Seize:** recovery NEVER acts on a fresh owner. Stale (`now - heartbeatAt > T-1`)
  `correction_active` ⇒ a recoverer CAS-transitions it to `correction_recovering(journalId,
  recoverer)`. The original worker's next boundary re-stamp then fails and it aborts.
- **The fence:** `stock_snapshot.ConfigData` gains `fence` (int). The recoverer's FIRST mutating act
  after seizing — BEFORE touching candidate rows, reservations, or journals — is a content-preserving
  snapshot MERGE bumping `fence` (new ETag). The owning worker's P6 publish uses the snapshot ETag
  captured AT ACQUIRE TIME (P2) and NEVER re-reads it; after a fence its CAS can never succeed. On a
  P6 CAS failure the worker may retry ONLY after re-asserting it still owns the state (a seized
  worker cannot); outcome decisions come from reads, never HTTP results (C2-R1-10, §5 P6).
- **Releases:** every release (P7, rollback, recovery completion — and the archive LA's, N10) is an
  ETag + content-conditional MERGE asserting the state is still the releaser's own. `IF-MATCH: *` is
  retired everywhere.
- **No-journal stale state (C2-R1-9):** seized `correction_active` whose journalId has no journal
  item ⇒ verify absence, scrub any reservation naming that journalId (belt), release to idle.

## 4. The control-target reservation registry (SR-138/141/143/144/147 + C2-R1-4/-5)

`ControlRegistry_Staging` — ONE item per target, spanning BOTH ledger lists. Columns:

```
TargetTransactionId (Text, Enforce-Unique + indexed)   ← the atomic claim primitive
State        'pending' | 'committed' | 'pending_supersede'
Owner, OpId, JournalId, TtlAt                          ← pending-phase fields
ControlId, Revision (int), PublicationVersion (int)    ← committed-phase fields
PriorCommitted (JSON text)                             ← pending_supersede: the saved committed lock
Origin       'director' | 'device' | 'device-adopted'
```

- Claim = item CREATE (Enforce-Unique makes the race atomic); transitions = ETag CAS.
- Director lifecycle (SR-143/147/149) unchanged from R1 design: `pending → committed` at publication;
  initial-create rollback deletes; supersede via `pending_supersede(PriorCommitted)` whose rollback
  RESTORES the prior lock; expected-revision CAS re-read after acquiring the state.
- **Device lifecycle (C2-R1-5, SR-143-conformant):** see §8 — `pending(owner=deviceId,
  opId=tombstoneId, ttl)` → row durable → `committed`. A conflict with an item whose `OpId` equals
  this tombstone's TransactionId is the device's OWN claim ⇒ idempotent re-entry (finish the insert /
  the commit CAS), never quarantine. Orphaned device pendings past TTL with no ledger row ⇒ scrubbed.
- **Lazy adoption (C2-R1-4):** the approval op's belt query (§5 P3.4) finding an EXISTING tombstone
  with no registry item REGISTERS it: create `committed(ControlId=tombstoneId, Revision 0,
  Origin='device-adopted')` (conflict ⇒ re-read — someone else registered). Supersede/withdraw then
  proceed against the adopted head. Create-mode still rejects (target already controlled).
- One ACTIVE effective control per target (SR-144) = one registry item; history lives in the
  append-only control rows.

## 5. The route — request contract and order of operations

### Request (LA `bob-stock-correction-staging`)

```
{ auth: { deviceId, storeId, directorKey },
  actorUsername, proof,                              // sudo purpose 'correction'
  intent: {
    mode: 'create' | 'supersede' | 'withdraw' | 'adopt' | 'reconcile',
    opId,                                            // client-minted stable id (idempotency)
    targetTransactionId?,                            // absent for adopt/reconcile
    expected?: { activeControlId, revision, publicationVersion },   // supersede/withdraw
    control?: { type: 'deletion' }
            | { type: 'replacement',
                row: { productId, qty, type, reason?, stockFrom?, stockTo?,
                       stockFromStoreId?, stockToStoreId? } }       // ECONOMIC identity only —
  } }                                                               // stamps/instants NEVER accepted
```

Response: `{ ok:true, controlId, revision, publicationVersion }` | `{ ok:false, reason, detail? }`.
Terminal-opId replay returns the stored result; digest mismatch under a reused opId ⇒ `OPID_REUSED`
(digest = JSON-array-framed canonical of mode + target + expected + control payload + actorUsername).

### Order of operations (mode create)

- **P0 gates.** Archive-LA triple gate with purpose `'correction'`.
- **P1 idempotency lookup — BEFORE any CAS.** Journal by OpId: terminal ⇒ stored result;
  non-terminal own ⇒ reconcile it (§6) and return the outcome; digest mismatch ⇒ `OPID_REUSED`.
- **P2 acquire.** Reconcile pre-pass: a non-terminal FOREIGN journal that is FRESH (journal
  heartbeat within T-1) ⇒ 409 busy; STALE ⇒ seize + recover first (§6). Then CAS
  `idle → correction_active`, honoring live request flags. **Capture the stock_snapshot ETag +
  content NOW** — this ETag is the ONLY one P6 may use (§3a).
- **P3 fetch authoritative state.**
  1. Target row: query BOTH ledger lists. Absent ⇒ `TARGET_NOT_FOUND`; in both ⇒
     `TARGET_DUPLICATED` (fail closed); target is a control row or tombstone with `ControlId` head ⇒
     `TARGET_IS_CONTROL` (a tombstone target is legal only via the adopted-head supersede lane, §4).
  2. Target seal: `attestRows op:'verify'`. Sealed-but-failing ⇒ `TARGET_SEAL_BROKEN` (fail closed).
  3. Steps: if the target has a `TransferId`, page `RecordSteps_Staging` for that RecordId until
     exhausted (enumeration proof = completed walk + last-page continuity re-read, recorded in the
     journal) and compute the canonical STEP-SET DIGEST (C2-R1-12).
  4. Mode gate (§4 registry re-read after acquiring) + the BELT query (both lists for existing
     tombstones/controls on the target; unregistered existing tombstone ⇒ lazy adoption, §4).
- **P4 compute (pure — `correctionCompute`).**
  - **`targetLine`:** transfer-linked target ⇒ `{transferId, productId, qty}` with qty from the
    ENGINE'S OWN `foldProjection` authority (resolve-pinned > received > sent, N14) and the target's
    membership in `expectedLedgerKeys` asserted (`ROW_NOT_IN_TRANSFER_LEDGER` else). Transferless
    target ⇒ from the row ONLY if C1-sealed; unsealed transferless ⇒ omitted (engine requires
    targetLine only for transfer-linked targets). Transfer-linked with NO steps (pre-epoch) ⇒
    `TARGET_PRE_EPOCH` (D-C2-2; manual lane).
  - **`originalEventAt`:** transfer-linked ⇒ the SUBMIT step's instant (the engine equality-checks
    exactly this, buybackExport.js:552-553); transferless ⇒ the target row's stored UTC instant
    (:554). Always validated ISO-UTC (SR-130).
  - **Replacement stamps (SR-134/145 + C2-R1-11, server-minted, both-or-neither):** tier (a) the
    target row's stored four-tuple ONLY if valid AND product AND store AND classification identity
    all match the replacement's; tier (b) the transfer's ITEM stamps for the REPLACEMENT product (via
    the same foldProjection); else ⇒ `STAMPS_UNRESOLVABLE` (D-C2-1 — no lens tier until the pricing
    deliverables ship).
  - **Delta exactness (SR-142):** per affected `(storeId, productId)`:
    `newBalance = oldBalance − effect(target) + effect(replacement)`; unaffected pairs bit-unchanged.
    Deletion: `− effect(target)`. Withdraw: `− effect(previousEffective) + effect(originalTarget)`.
    Live-target corrections adjust NO balances (manifest-only publication).
  - **Deterministic ids:** `controlId = 'ctl:' + opId (+ ':' + revision beyond 0)`; replacement
    output `TransactionId = 'corr:' + opId + ':' + revision`; collisions checked against BOTH lists.
  - Assembles the CANDIDATE HEAD `{target, controlId, revision, bornPublicationVersion:
    candidateVersion}` — stored in the journal (the recovery decision key, C2-R1-7) — plus the new
    full `controlHeads` map (incl. any opportunistic tombstone adoptions, §7c).
- **P5 journal + candidate (publish-nothing until P6; boundary re-stamps per §3a throughout).**
  1. CREATE journal `{OpId (unique), JournalId, Digest, Mode, Target, ActorUsername,
     State:'pending', CandidateVersion, CandidateHead, StepSetDigest, Payload, HeartbeatAt}`.
     Then re-assert state ownership (§3a) — failure ⇒ self-rollback of the just-created journal.
  2. Claim the reservation (§4). Conflict ⇒ rollback journal, release, `TARGET_RESERVED`.
  3. Write the candidate control row INTO THE TARGET'S OWN list (SR-135) with the N7 columns + minted
     stamps + `TargetLine` + `OriginalEventAt`, then SEAL it: `attestRows op:'sign'` (ctl-v1 frame,
     §7a) and store `EconSig`. Candidate rows are INERT until the manifest names them.
  4. VERIFY: re-read the written row field-for-field, verify its seal, recompute delta exactness
     from re-read inputs, re-enumerate the step set and compare digests (`STEPS_CHANGED_RETRY` on
     mismatch ⇒ rollback), check id collisions and registry/journal coherence. Any failure ⇒ roll
     back (delete candidate row, release/restore reservation, journal `rolled_back`, conditional
     release) — nothing was published.
- **P6 PUBLISH — the irrevocable commit (SR-139/148 + C2-R1-1/-10).** Final ownership re-stamp
  (§3a), then ONE MERGE of `stock_snapshot.ConfigData` to `{version: CandidateVersion, balances:
  adjusted-or-unchanged, fence: unchanged, ...existing fields, controlManifest: {version:
  CandidateVersion, controlHeads: new map}}` with `IF-MATCH: <the P2-captured ETag>` — NEVER a
  re-read ETag. Outcome BY READ: after any attempt (success, failure, timeout), re-read the
  snapshot; candidate head present ⇒ COMMITTED ⇒ P7; positively absent + version unchanged + still
  owner ⇒ retry or roll back; anything else ⇒ leave the journal pending (state held) for reconcile.
- **P7 terminal.** Registry → committed (supersede: new head; withdraw: `Revision` advanced,
  manifest head explicit null). Journal → `complete` + stored result. CONDITIONAL release → idle.

### 5b. Supersede / withdraw / adopt
Supersede/withdraw as R1 design (expected-revision CAS; append-only revisions; withdraw = no new row,
head → null, balances restore the target's effect; rollback restores `PriorCommitted`). **Adopt
(C2-R1-8):** Director-gated like every mode; no target, no reservation interplay; P4 builds a
manifest-only candidate folding ALL registry-committed unheaded device tombstones into heads
`{controlId: tombstoneId, revision: 0, born: CandidateVersion}` after verifying each tombstone row
exists in-list with a VALID seal (an unsealed/broken claimed tombstone is surfaced + skipped, fail
closed); zero balance delta; same journal/fence/publish-LAST discipline. Every OTHER mode's P4 folds
pending adoptions opportunistically, so adopt is rarely needed explicitly (it exists so a settlement
blocked on `TOMBSTONE_PENDING_ADOPTION` has a Director remedy).

## 6. Reconcile / recovery (SR-139/143 + C2-R1-1/-7/-9/-10)

Invoked from: the route's P1/P2 pre-passes, explicit `mode:'reconcile'`, and REFUSAL guards in the
archive LA (which never recovers corrections itself — it 409s `correction_pending`). Procedure per
non-terminal journal (all under a SEIZED `correction_recovering` state, §3a; recoverer's first
mutating act = the FENCE write):

- **Decision (C2-R1-7, by manifest CONTENT — `correctionCompute` decides, the LA executes):** read
  the active `controlManifest`. Journal's `CandidateHead` present (exact match) ⇒ published pre-crash
  ⇒ **ROLL FORWARD only** (idempotent P7). Absent AND `version < CandidateVersion` ⇒ pre-publish ⇒
  roll back (delete candidate row, release/restore reservation, journal `rolled_back`). Absent AND
  `version >= CandidateVersion` ⇒ **`INVARIANT_BROKEN`** — fail closed: journal parked in a surfaced
  `needs_manual` state, coordination released, archives/exports stay refused for this store until a
  Director resolves (this state is unreachable while all snapshot writers honor the coordination
  discipline — N10/N15; the explicit state exists so a violation is LOUD, never a silent rollback).
- Freshness: recovery only ever engages STALE owners (§3a seize); fresh ⇒ 409 busy.
- Orphan scrubs: registry pendings past TTL with no live journal (Director) or no ledger row
  (device, §8) ⇒ released/restored per lifecycle; stale no-journal states per §3a.

## 7. Control storage, seals, manifest, and the export assembly contract

### 7a. Control seals (C2-R1-3, ctl-v1)
`attestRows` gains a `ctl-v1` canonical frame (same keyring/pepper machinery, N11): covered fields =
`ControlId, ControlType, TargetTransactionId, ControlRevision, BornPublicationVersion, TargetLine
(canonical JSON), OriginalEventAt`, plus for replacements the output row's full economic identity
(`TransactionId, StoreId, ProductId, Type, Qty, Date, Timestamp, Reason, StockFrom/To + ids,
SellAtSupply, DiscAtSupply, PricingVersion, CatalogueVersion`). Signed server-side at P5.3; verified
at P5.4 and by the export route at assembly. A published control row failing verification ⇒ the
export refuses to supply it ⇒ fail-closed conflict surfaced (`CONTROL_SEAL_BROKEN`). Engine-side
seal enforcement is banked for the return re-audit (the engine is frozen; route-side enforcement +
the head check hold the line meanwhile).

### 7b. The export assembly contract (pinned HERE, built later — C2-R1-6/-8/-13)
Under its lease, the export route: (1) queries BOTH lists for control-typed rows + `deleted` rows
targeting supplied identities (completeness-attested); (2) supplies to the engine ONLY the control
matching each ACTIVE manifest head (Director controls: the head revision's row; device tombstones:
a synthesized `{controlId: tombstoneId, type:'deletion', targetTransactionId, revision: 0,
bornPublicationVersion: head.born}` from the manifest + the seal-verified tombstone row) — historical
revisions and withdrawn targets' rows are NEVER supplied; (3) EXCLUDES rows carrying `ControlId` from
the `rows` arrays (a control's row reaches the engine only inside its ctl); (4) surfaces any
registry-committed tombstone or published control LACKING a manifest head as the fail-closed
PROVISIONAL blocker `TOMBSTONE_PENDING_ADOPTION` (Director remedy: `mode:'adopt'`); (5) verifies
every supplied control's ctl-v1 seal.

### 7c. Manifest + tombstone heads (C2-R1-8)
`stock_snapshot.ConfigData.controlManifest = {version, controlHeads}` (complete map, never a delta) +
`fence` — written ONLY inside publications: correction/adopt P6, and the archive run's Publish which
CARRIES both forward unchanged while bumping `version` (N10). Device tombstones get heads at
adoption (§5b); until then exports fail closed, never silently uncounted. Archive moves don't touch
heads (list-agnostic by TransactionId). NOTE (pre-existing Chunk-8 behaviour, unchanged): the
archiver's ID-cutoff can transiently split a tombstone from its target across lists — the engine's
SR-70 cross-list rule surfaces it; economics stay correct via snapshotCompute's tombstone-aware
balances (D8-7).

## 8. push-v2-validate amendment — the SR-143-conformant tombstone claim (C2-R1-5)

For each validated `Type='deleted'` row: (1) registry CREATE `pending(owner=deviceId,
opId=<tombstone TransactionId>, TtlAt)`; on conflict, read the item — `OpId` equal to this
tombstone's id ⇒ OWN claim, re-enter (proceed; if already committed, the row is a duplicate push and
the normal dedup path answers); different `OpId` ⇒ divert the row to `StockTransactions_Quarantine`
(`CONTROL_TARGET_RESERVED`, surfaced in the push response, never silently dropped). (2) The row
proceeds through the normal attest+insert pipeline. (3) After the row is durable, CAS the registry
`pending → committed(ControlId=row id)`. A crash at any point is recovered by: retry (idempotent
re-entry), or the reconcile TTL scrub (pending past TTL with no ledger row ⇒ deleted). Registry
unreachable ⇒ that tombstone (only) fails retryable — the C1 fail-closed posture. Non-tombstone rows:
pipeline untouched. ⚠ Scoped amendment to the C1-audited push LA (N9), flagged.

## 9. Auth additions

`'correction'` joins `SUDO_PURPOSES` — 5-min TTL; client prompt-map entry rides the next client wave
(runner scripts mint proofs directly meanwhile). Gate composition = the archive LA's triple gate with
the purpose swapped.

## 10. Pinned parameters (T-values — challenge these)

| Pin | Value | Rationale |
|-----|-------|-----------|
| T-1 heartbeat stale (state + journal) | 10 min | ≫ any phase duration; ≪ operational patience |
| T-2 reservation pending TTL (both origins) | 15 min | > T-1 + recovery time |
| T-3 request-flag TTL | 2 min | hand the next turn over |
| T-4 steps page size | 200 | matches existing pull paging |
| T-5 journal Payload cap | 60 KB | mirrors MAX_PAYLOAD_BYTES (records.js:73) |

## 11. Draft artifacts (attack surface — build after R2 convergence unless reviewers ask sooner)

`correctionCompute` + `test/correction-proof.js` covering, minimum: digest/idempotency matrix; mode
gates incl. lazy adoption; targetLine via the REAL exported foldProjection (resolve-pinned case
explicitly); originalEventAt engine-equality; stamp precedence incl. C2-R1-11 identity and
STAMPS_UNRESOLVABLE; delta exactness (create/supersede/withdraw × live/archive); ctl-v1 seal matrix
(tamper every covered field); the FENCE/SEIZE crash matrix (every phase boundary × {owner stalls,
recoverer runs, owner resumes}, incl. the C2-R1-1 repro verbatim and the C2-R1-10 lost-ack repro);
recovery decisions incl. INVARIANT_BROKEN; the §8 device-claim crash/retry matrix (C2-R1-5 repro);
and ENGINE-COUPLING probes: every mintable control and every §7b assembly output must pass the FROZEN
engine's validation (incl. the C2-R1-8 device-tombstone path: adopted head ⇒ target removed;
unadopted ⇒ blocked PROVISIONAL, never mis-billed).

## 12. Kunal decisions — LOCKED 2026-07-23

- **D-C2-1 (business-visible): APPROVED.** No lens-tier minting until server pricing history ships —
  `STAMPS_UNRESOLVABLE` corrections are rejected with a clear reason and wait. Fail closed.
- **D-C2-2 (business-visible): APPROVED, with an owner ground-truth that de-risks the lane.** All
  pre-server data is TRIAL data — at go-live the app starts with fresh real data. `TARGET_PRE_EPOCH`
  (and the C2-R1-4 pre-registry lane) are defence-in-depth, not live business paths.
- **D-C2-3: APPROVED.** Deletion-type controls run through this route.

## 13. Honest notes (engineer-flagged)

- **H1:** `export_lease` ships defined but acquirer-less until the export route builds.
- **H2:** until SR-153/155 semantic validation ships, a target row's stamps are tamper-evident but
  not semantically validated — minted stamps inherit that trust level; closes at the SR-155
  deliverable, re-examined at the return re-audit.
- **H3 (Kunal-visible):** pre-epoch and stamp-unresolvable corrections are rejected fail-closed with
  clear reasons (D-C2-1/2).
- **H4:** registry backfill is deliberately not done; the belt query + lazy adoption (C2-R1-4) is
  the compensating control.
- **H5:** heartbeats/fences are LA-clock liveness devices only — no economic boundary derives from
  them.
- **H6 (C2-R1-12):** a resolve step landing AFTER a correction publishes changes the transfer's
  authoritative qty — the settlement then fails closed at reconciliation (`HO_LINE_QTY_MISMATCH`),
  surfaced, remedied by Director supersede. Never silent.
- **H7 (C2-R1-13):** devices never receive control rows (N13 filter); device-side visibility of
  corrections (a Director "corrections applied" view / pull re-delivery) is a banked future lane —
  settlements and server truth are correct meanwhile.
- **H8:** the four Chunk-8/C1-audited surfaces this contract amends (archive LA, push LA, attestRows,
  buybackExport exports) are all ⚠-flagged (N9/N10/N11/N14) for the return re-audit.

## 14. Review questions (R2)

- **Q1v2:** the fence+seize protocol (§3a): enumerate the crash matrix — owner stalls at each phase
  boundary, recoverer seizes, owner resumes at each later point. Is there ANY interleaving where a
  rolled-back candidate becomes visible, a published control is destroyed, or the P2-captured-ETag
  rule is insufficient? Pay attention to the fence-FIRST ordering in recovery and the
  retry-only-if-owner rule.
- **Q2v2:** the ctl-v1 covered set (§7a): is any engine-read control field missing? Is route-side
  seal enforcement (given the frozen engine) an acceptable interim, with engine enforcement at the
  return re-audit?
- **Q3v2:** tombstone head adoption (§7c/§5b-adopt): any window where a device deletion is silently
  UNCOUNTED (target billed despite a committed tombstone) rather than fail-closed-blocked? Any way an
  invalid/forged tombstone gains a head?
- **Q4v2:** the §8 device-claim lifecycle: full crash/retry matrix — any path that quarantines a
  legitimate tombstone, double-commits, or leaves a target locked with no tombstone landed?
- **Q5v2:** the §7b assembly contract vs the frozen engine, line by line — does every legal state
  (active head, superseded history, withdrawn, unadopted tombstone, seal-broken control) map to the
  intended engine outcome (apply / ignore-history / PRESENT-again / PROVISIONAL-blocked / refuse)?
- **Q6v2:** recovery's three-way manifest-content decision (§6): is `INVARIANT_BROKEN` genuinely
  unreachable while N10/N15 hold, and is parking it `needs_manual` (store-scoped refusal) the right
  blast radius?

## 15. Sequencing after convergence

Fix→re-route until BOTH reviewers pass → Kunal go → build N2/N11/N12/N14 (pure function + seal frame
+ proofs, gated locally) → staging apply N3-N10/N13 via Kunal-executed runners → credentialled E2E
(create / supersede / withdraw / adopt / crash-drill incl. a real seize+fence exercise /
tombstone-race / archive-interplay, driven as `srvaudit_director`) → BUILD audit (both reviewers
drive the deployed route) → SR-155 stamp validation (rides AA §3-4) → the return engine+server
re-audit (Kunal's firm marker: engine predicate change + sealed-pre-epoch rule + engine control-seal
enforcement + the R5-R7 reproductions failing at ingest/verify + the ⚠-flagged N9/N10/N11/N14/N15
amendments).
