# OS-W4.4 Contract 2 — CONCRETE STAGING ARTIFACTS (LA definitions + apply inventory)

**Status: 🔍 W-B2r2 INTERIM LA REVIEW — ROUND 3. R1: AGY×2 + Codex×11 = 13 REAL, folded @
`bb1987e` (fold record §F). R2: AGY PASS + Codex BLOCK×6 — all six REAL, zero refuted, folded
(fold record §H, questions §I); suite 127 → 144/144. Cadence option 2: paper review of these
definitions by BOTH reviewers BEFORE the Kunal-executed staging apply; the full build audit vs the
DEPLOYED system follows the E2E per §15.** Parent: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` (SPEC
CONVERGED 2026-07-25 — Codex R25 PASS "No findings" + AGY PASS confirmed on the same revision).
This document is the IMPLEMENTATION-level companion: it maps every converged design rule onto
concrete Logic-App actions, SharePoint REST calls, and `correctionCompute`/`attestRows` ops, so
the LA carries NO decision logic (N2 computes; the LA executes). Cited fold ids refer to the
design doc's R1-R24 fold records.

**House patterns (from the deployed archive/push LAs — archive-def-current.json):** SharePoint I/O
via the `sharepointonline` connection's `httpRequest` passthru; CAS = `X-HTTP-Method: MERGE` with
`IF-MATCH: <captured odata.etag>`; Function calls = HTTP POST to
`bob-stock-money-fn.azurewebsites.net/api/<route>?code=<fn key>` (key injected at apply, NEVER
committed); every branch ends in a `Response` action (no dangling runs).

---

## A. NEW LISTS + COLUMNS (created by `apply-c2-staging.js` — §D)

| List | Key columns |
|---|---|
| `ControlRegistry_Staging` (N3) | `TargetTransactionId` Text **Enforce-Unique + indexed**; `State` Text (pending/committed/pending_supersede/collision); `Owner`, `OpId`, `JournalId` Text; `TtlAt` Text ISO; `ControlId` Text (empty = the withdrawn null); `Revision`, `PublicationVersion` Number (empty PublicationVersion = committed-unadopted); `PriorCommitted` Note(JSON); `Origin` Text |
| `CorrectionJournal_Staging` (N4) | `OpId` Text **Enforce-Unique + indexed**; `JournalId`, `Mode`, `Target`, `ActorUsername`, `State`, `Digest`, `StepSetDigest` Text; `CandidateVersion` Number; `CandidateHeads`, `AdoptionDecisions`, `Payload`, `StoredResult` Note(JSON); `HeartbeatAt` Text ISO |
| `ArchiveRunRecords_Staging` (N17) | `RunId` Text **Enforce-Unique + indexed**; `SnapshotVersion` Number; `InputDigest` Text; `TombstoneIds`, `ArchiveMemberSourceIds` Note(JSON arrays); `Published` **Boolean (SP Yes/No, explicit default FALSE — per the frozen N17 schema, Codex C2-LA finding 11; OData filters use `Published eq 1`; the runrec-pub-v1 seal signs the CONSTANT not the boolean, so signing is unaffected)**; `PublishedSig`, `RecordSig` Text |
| `StockControlPending_Staging` (N18) | `TransactionId` Text **Enforce-Unique + indexed**; the FULL econ-v1 row column set (as StockTransactions_Staging) + `TargetTransactionId`; `OwnerDeviceId` Text |
| BOTH ledger lists gain (N7) | `ControlId`, `ControlType`, `TargetLine` (Note JSON), `OriginalEventAt`, `ControlState`, `CommitSig` Text; `ControlRevision`, `BornPublicationVersion` Number |
| `AppConfig_Staging` items | `archive_state` ConfigData TRANSFORMED to the v2 five-state shape (§3 — existing content preserved, `v:2` + request-flag fields added); NEW `seal_epoch` item `{epochId, tombstoneCommitEpochId, archiveC2EpochId, recordedAt, EpochSig}` (N16, epoch-v1-signed); `stock_snapshot` ConfigData gains `controlManifest:{version,controlHeads:{}}` + `fence:0` on first correction-era publish (carried forward by N10) |

## B. NEW LA `bob-stock-correction-staging` (N1) — phase-by-phase

**Trigger:** HTTP request (manual), body = the §5 request contract
`{auth:{deviceId,storeId,directorKey}, actorUsername, proof, intent:{mode, opId,
targetTransactionId?, expected?, control?}}`. Every terminal path returns via `Response`
(`{ok:true, controlId, revision, publicationVersion, deviceConvergencePending?, affectedTarget?}`
| `{ok:false, reason, detail?}`).

**P0 — triple gate (mirrors the archive LA verbatim, purpose swapped):**
1. `Gate_keys`: POST fn `validateKeys` {deviceId, storeId, directorKey} → non-2xx/invalid ⇒ 401 Response.
2. `Gate_proof`: POST fn `verifyProof` {actorUsername, proof, purpose:'correction'} (N8 — the purpose
   is in SUDO_PURPOSES as of W-B1) → invalid ⇒ 401.
3. `Gate_role`: SP GET the CURRENT user row (`UserCredentials_Staging`, Username eq actorUsername,
   Active eq 1) → role must be `director`, TokenVersion must match the proof ⇒ else 403.

**P1 — idempotency BEFORE any CAS:**
4. `Digest`: POST fn `correctionCompute` op:`digest` over the intent+actor.
5. `Journal_lookup`: SP GET CorrectionJournal by OpId (Enforce-Unique ⇒ ≤1 row).
   - Terminal (`State in complete|rolled_back|needs_manual`) + Digest match ⇒ Response = StoredResult
     (the C2-R8-1 convergence fields REPLAY from StoredResult).
   - Terminal + Digest MISMATCH ⇒ `OPID_REUSED`.
   - Non-terminal OWN ⇒ jump to the RECONCILE sub-flow (§B-R) and Response its outcome.

**P2 — acquire + capture:**
6. `Reconcile_prepass`: SP GET non-terminal journals; any FRESH (HeartbeatAt within T-1=10min)
   foreign ⇒ 409 busy Response. STALE ⇒ run §B-R first (seize).
7. `Acquire`: SP GET `archive_state` (capture ETag) → CAS MERGE `idle →
   correction_active{opId, owner:<workflow run id>, heartbeatAt:utcNow}` honoring live request
   flags (C2-R2-9: opId stamped AT ACQUIRE). CAS fail ⇒ 409 Response.
8. `Capture_snapshot`: SP GET `stock_snapshot` item — **store BOTH the ETag and ConfigData into
   workflow variables NOW; P6 uses ONLY these (never a re-read — C2-R1-1)**.

**P3 — authoritative state:**
9. `Target_both_lists`: SP GET by TransactionId from Live AND Archive (SOURCE-FIRST Live→Archive,
   C2-R17-2). Absent both ⇒ `TARGET_NOT_FOUND`; in both ⇒ `TARGET_DUPLICATED`; carries a
   ControlId/head ⇒ `TARGET_IS_CONTROL` (adopted-head supersede lane only).
10. `Seal_threeway`: POST fn `attestRows` op:'verify' (econ-v1) on the target; SP GET the
    `seal_epoch` item + POST fn `attestRows` frame:'epoch-v1' verify; POST fn `correctionCompute`
    op:`targetSeal` {econSigPresent, verifyOk, provenanceId (live Id | archived SourceId), epoch}
    → `TARGET_SEAL_BROKEN`/`EPOCH_UNDEFINED`/`EPOCH_TAMPERED` ⇒ rollback-release + Response.
11. `Steps_enumerate` (target.TransferId only): paged SP GET RecordSteps_Staging by RecordId
    (`$top=200`, `Id gt lastId` walk until short page + one continuity re-read) → POST fn
    op:`stepSetDigest` → journaled later.
12. `Mode_gate` (C2-LA-1b): SP GET the registry item for the target (AFTER acquire) + the BELT
    query (both ledger lists for existing tombstones/controls on the target) → **POST fn
    op:`modeGate` {mode, expected, registryItem, beltTombstone, retireEvidence}** — the compute op
    returns `{ok}` or the refusal (`TARGET_RESERVED` / `TOMBSTONE_PENDING_ADOPTION` /
    `EXPECTED_MISMATCH` / `ALREADY_WITHDRAWN` / `LAZY_ADOPTION_REQUIRED` [⇒ the LA registers the
    tombstone then re-runs the gate] / `RETIRE_NOT_APPLICABLE` / `RETIRE_EVIDENCE_INSUFFICIENT`).
    NO legality condition trees live in the LA.

**P4 — compute (ALL decisions via `correctionCompute`):**
13. op:`targetLine` (real foldProjection authority; `TARGET_PRE_EPOCH`/`ROW_NOT_IN_TRANSFER_LEDGER`
    refusals) → op:`stamps` (replacement modes; `STAMPS_UNRESOLVABLE` ⇒ rollback-release+Response)
    → op:`membership` (adopt/retire) → op:`delta` (`*_DELTA_UNDECIDABLE` ⇒ rollback-release) →
    op:`candidate` (heads + AdoptionDecisions + ids; `NO_PENDING_ADOPTIONS` ⇒ terminal no-op
    Response BEFORE any write, C2-R3-5). Deterministic-id collision check: SP GET both lists for
    `corr:`/`ctl:` ids.
13a. **op:`membership` INPUT MAPPING — PINNED (R2 finding 4).** The LA SP-GETs the run record from
    `ArchiveRunRecords_Staging` by the TARGET ROW's `ArchiveRunId`, verifies it with attestRows
    frame:'runrec-v1', and posts EXACTLY:
    `{ targetLocation, tombstoneTransactionId, target: { archiveRunId: <target row ArchiveRunId>,
    snapshotVersion: <target row SnapshotVersion> }, runRecord: { RunId, SnapshotVersion,
    TombstoneIds, recordSigValid } }`. **Both target bindings are MANDATORY** — the op treats a
    missing/blank binding on EITHER side as `undecidable` and never as a match (the bind test used
    to compare two `undefined`s and pass, deciding membership on nothing). The op also reads raw
    SharePoint casing (`ArchiveRunId`/`SnapshotVersion`) as a belt, so a normalization gap cannot
    turn every legitimate archived adoption permanently undecidable.

**P5 — journal + candidate (publish-nothing; §3a boundary re-stamps after EVERY numbered step —
an ETag-CAS `heartbeatAt` MERGE on archive_state; failure ⇒ ABORT, self-rollback):**
14. `Journal_create`: SP CREATE journal (OpId unique; CandidateHeads + AdoptionDecisions +
    StepSetDigest + Digest + CandidateVersion = capturedSnapshot.version+1). Conflict ⇒ outcome-
    by-read.
15. `Reserve`: registry claim per mode (CREATE pending / CAS committed→pending_supersede saving
    PriorCommitted — top-level OpId/ControlId RETAINED for device-origin, C2-R9-3). Conflict ⇒
    rollback journal, release, `TARGET_RESERVED`.
16. `Candidate_row` (create/supersede only): SP CREATE the control row INTO THE TARGET'S OWN LIST
    (SR-135) with N7 columns + minted stamps + TargetLine + OriginalEventAt → POST fn attestRows
    frame:'ctl-v1' sign → MERGE EconSig onto the row.
17. `Verify` (C2-LA finding 10): the ctl-v1 seal is minted FROM THE INTENDED PRE-WRITE OBJECT
    (the P4 candidate assembly output), and the SP re-read row is verified AGAINST THAT INTENT via
    **POST fn op:`ctlRowsEqual` {a: intendedObject, b: reReadRow}** (the ctl-v1 canonical covers
    the control fields the econ-v1 canonical ignores — a SharePoint-dropped ControlId/Revision
    fails equality) + ctl-v1 verify on the re-read row; re-enumerate steps → op:`stepSetDigest`
    compare (`STEPS_CHANGED_RETRY` ⇒ rollback); registry/journal coherence re-read. Any failure ⇒
    FULL ROLLBACK (delete candidate, release/restore reservation per mode, journal `rolled_back`,
    conditional release) + Response. retire_claim additionally: P5 MERGE the tombstone row
    `ControlState='retiring'` (REVERSIBLE — rollback restores; the N13 filter stops delivering it,
    C2-R6-1a).

**P6 — THE PUBLISH (irrevocable):**
18. `Final_restamp` (§3a) → `Assemble` (C2-LA-1a): **POST fn op:`assembleSnapshot`
    {snapshotConfigData: <the P2-captured content>, candidateVersion, deltas: <op:delta output>,
    candidateHeads}** — the compute op returns the EXACT serialized ConfigData (version bumped,
    balances arithmetic done, fence UNCHANGED, controlManifest = full prior heads merged with this
    publication's entries incl. explicit-nulls; NO map/array arithmetic in the LA) → `Publish`:
    ONE SP MERGE of that string with **`IF-MATCH: <the P2-captured ETag>`** — never a re-read ETag
    (C2-R1-1).
19. `Outcome_by_read` (C2-R1-10): re-read the snapshot; per-entry CandidateHeads test via POST fn
    op:`recoveryDecision` — present ⇒ COMMITTED ⇒ P7; positively-absent + version unchanged +
    still-owner ⇒ retry P6 or rollback; else leave the journal pending (state HELD) for reconcile.

**P7 — terminal:**
20. Registry per mode: create/supersede ⇒ committed(new head fields); withdraw/retire ⇒ THE
    WITHDRAWN FORM (`ControlId:''`, Revision+1, PublicationVersion=CandidateVersion, OpId
    retained); adoptions (any mode) ⇒ CAS-fill each adopted target's `PublicationVersion`
    (idempotent — recovery re-runs, C2-R2-6).
21. retire_claim: QUARANTINE the tombstone row (copy to StockTransactions_Quarantine_Staging then
    delete source — write-before-delete; identity+list journaled; idempotent, C2-R5-3).
22. `Journal_complete`: StoredResult = the full Response body **incl. `deviceConvergencePending:
    true` + `affectedTarget` for EVERY non-adopt mode (C2-R9-4)**; State=complete.
23. `Conditional_release`: ETag + content-conditional MERGE `→ idle` asserting the state is still
    OURS (`IF-MATCH` + owner match — `IF-MATCH: *` is retired, C2-R1-2) → Response.

**B-R — the RECONCILE sub-flow (mode:'reconcile' + P1/P2 pre-passes + archive-LA refusals):**
seize per §3a (stale `correction_active` ⇒ CAS to `correction_recovering{journalId, recoverer}`;
stale `correction_recovering` ⇒ RE-SEIZE, C2-R2-1); FENCE-FIRST (content-preserving
`stock_snapshot` MERGE bumping `fence` — new ETag kills the displaced owner's P6, C2-R1-1);
no-journal states keyed by **OpId** (C2-R2-9); decision = POST fn op:`recoveryDecision` on the
journal's CandidateHeads vs the active manifest ⇒ roll_forward (idempotent P7) | roll_back |
INVARIANT_BROKEN (journal `needs_manual`, release, archives/exports refused GLOBALLY, H9);
orphan scrubs per the §6 full matrix — device cells delegate to op:`claimDispatch` with the
gathered `{registry × N18 × main}` state; N18-promote re-verifies EXACT identity and on mismatch
ONLY releases the stranded claim (NEVER deletes the winner's N18 row, C2-R15-2).

## C. AMENDMENTS to existing LAs (transform-at-apply, like the C1 push transform)

**N9 — `bob-stock-push-v2-validate-staging`:**
1. GLOBAL IDEMPOTENCY for ALL rows (C2-R21-3/C2-R22-2): before the existing pipeline, SP GET by
   TransactionId from Live then Archive (SOURCE-FIRST, complete reads). Live hit ⇒ existing dedup;
   Archive hit ⇒ POST fn op:`pushIdempotency` (canonical compare) ⇒ exact ⇒ ACK without insert;
   differing ⇒ quarantine + surface.
2. THE TOMBSTONE LANE (§8, C2-R11-1..C2-R16-3): for `Type='deleted'` rows — registry CREATE
   pending claim (conflict ⇒ op:`claimDispatch` on the read state); pre-insert ownership fence +
   TtlAt re-stamp; N18 INSERT (Enforce-Unique; 409 ⇒ canonical-equality check, mismatch ⇒ reject +
   conditionally release own pending, C2-R14-5/-6); PRE-COMMIT two-list collision check
   (Live→Archive, C2-R16-2/C2-R17-2); commit CAS ⇒ COMMIT POINT; attestRows frame:'ctlcommit-v1'
   sign ⇒ MAIN-ledger INSERT (`ControlState='committed'`+CommitSig — the re-mint; insert-409 ⇒
   collision adjudication per op:`claimDispatch`, C2-R13-5a/C2-R15-3) ⇒ DELETE the N18 item.
   Foreign commit-CAS ⇒ delete N18 + surface (compensation). Registry unreachable ⇒ retryable.
3. `tombstoneCommitEpochId` ordering ACCEPTANCE: the epoch artifact is written by the apply runner
   BEFORE this amendment goes live (Codex Q2v5 pin).

**N10 — `bob-stock-archive-staging`:** runIds SERVER-MINTED at `idle→run_active` (GUID, C2-R10-2);
N17 record (RunId create-if-absent + InputDigest + TombstoneIds + ArchiveMemberSourceIds +
RecordSig via frame:'runrec-v1') written + durable BEFORE Copy_loop (C2-R15-1/C2-R22-1/C2-R23-1);
UNIT-MOVE selection (target-keyed full predicate; control/tombstone rows ride the same run,
C2-R6-3 — implemented INSIDE snapshotCompute's partition, W-B2r; **gated on the C2 discriminator —
`controlHeads` PROPERTY PRESENCE, not emptiness — so a legacy caller keeps the exact pre-C2
partition, R2 finding 5**) with the SELECT/copy/re-read/
fidelity canonical carrying the FULL N7 control form + typed values (C2-R6-4/C2-R7-5 — **shipped in
`hashRows` at W-B2r2: `ControlId`, `ControlType`, `ControlRevision`, `BornPublicationVersion`,
`TargetLine`, `OriginalEventAt`, `ControlState`, `CommitSig` joined the canon; R2 finding 2 caught
the claim running ahead of the code, so a copy that DROPPED ControlId hashed identical to its
source and the live-delete then destroyed the only complete control row**);
**`Call_compute` PASSES the active `controlManifest.controlHeads` (from the captured
stock_snapshot) into snapshotCompute, which now folds EFFECTIVE values (Codex C2-LA finding 3 —
the ⚠ flagged C8-surface amendment, shipped W-B2r: active-headed targets excluded, active-head
control rows folded raw, historical control rows excluded, null-head targets normal; absent
controlHeads ⇒ byte-identical pre-C2 behaviour, archive-carry-proof regression-gated)**; the TOMBSTONE AUTHORITY GATE allowlist pre-compute (C2-R7-4/C2-R8-3);
`Published`+PublishedSig (frame:'runrec-pub-v1') stamped right after the snapshot-CAS; startup =
snapshot-named-run RECONCILE COMPLETION on the run's EXACT archived SourceId set (verified vs the
signed ArchiveMemberSourceIds, C2-R20-1/C2-R21-1/-2) THEN the SWEEP via POST fn op:`sweepClassify`
(the LA gathers rows/records/complete-Live-ids and EXECUTES the returned delete/spare/halt — any
halt ⇒ surface + stop, C2-R16-1..C2-R24-1); state releases become ETag+content-conditional
(C2-R1-2); refuse while a correction journal is non-terminal; carry `controlManifest`+`fence`
forward on publish (C2-R1-7).
**Codex load-bearing build proofs bound here:** COMPLETE Live-ID enumeration; indeterminate reads
⇒ RETRY never "absent"; reconcile ordered BEFORE the sweep.

**N13 — `bob-stock-pull-v2-validate-staging`:** rows filter gains `ControlId eq null` (C2-R1-13);
`Type='deleted'` delivery = the ALLOWLIST (C2-R7-1): legacy-null (provenance <
`tombstoneCommitEpochId`) OR `ControlState eq 'committed'` WITH a batch attestRows
frame:'ctlcommit-v1' verify (invalid/absent ⇒ withheld + surfaced); pending/retiring/unknown
excluded BY CONSTRUCTION. Real-list OData null semantics = a staging-apply probe.

## D. THE APPLY RUNNER `audit-artifacts/apply-c2-staging.js` (Kunal-executed; idempotent)

Steps (C1 runner pattern — temp passthru LA, prints no secrets; ORDER REVISED per the interim
review — R1: AGY C2-LA-2 + Codex 1/2; R2: Codex 6 moved the `archive_state` transform inside the
quiesced window):
(1) lists+columns per §A (create-if-missing; Enforce-Unique via field XML
    `EnforceUniqueValues="TRUE" Indexed="TRUE"`);
(2) *(nothing — `archive_state` is NOT touched here; see step (4). **R2 finding 6:** the transform
    used to run at this point, while the legacy archive LA was still ENABLED. That LA rebuilds the
    whole ConfigData from a fresh `json('{}')` carrying only status/runId/lockAt on BOTH acquire
    and release (archive-def-current.json:31 and :355 — the release even writes `IF-MATCH: *`, so
    it cannot be ETag-fenced). A single legacy run starting between steps (2) and (4) therefore
    ERASED `state`, `v:2` and the request flags, and step (5) would then deploy N10/N1 against an
    old-shape coordination record. The writer must be disabled AND idle before the shape changes.)*;
(3) **REDEPLOY THE FUNCTION APP FIRST** (correctionCompute + the attestRows frames +
    validateUser 'correction') — the epoch seal in step (4) NEEDS frame:'epoch-v1' live
    (AGY C2-LA-2: signing before deploy = 400 mid-quiescence). SAFE to deploy this early: the
    amended `snapshotCompute` is byte-identical to pre-C2 for any caller that does not send the
    `controlHeads` property, and the legacy archive LA never sends it (R2 finding 5 — the C2
    partition keys on PROPERTY PRESENCE, so deploying does not change live archive behaviour
    during the step (3)→(6) window);
(4) the QUIESCENT CUTOVER (C2-R18-3/C2-R19-3/C2-R20-4): DISABLE the legacy archive LA + FENCE
    push (disable the push LA for the bounded interval) → wait idle → **`archive_state` v2
    TRANSFORM (preserve content, add v:2 fields) — HERE, now that the only writer of that item is
    disabled and idle (R2 finding 6)** → complete any published
    legacy run's Live-delete by its exact set → SourceId residue cleanup (legacy AUTH BYPASS
    documented, C2-R22-1) → seal `{epochId, tombstoneCommitEpochId, archiveC2EpochId}` + EpochSig.
    **EPOCH RERUN RULE (Codex 2): strictly create-if-absent — an EXISTING seal_epoch item with a
    VALID EpochSig is REUSED byte-for-byte (never re-sampled); a rerun whose freshly-observed
    boundary DIFFERS from a valid existing seal ⇒ HALT + surface (the boundary is one-shot, never
    a refreshable maximum).** Writers STAY DISABLED at the end of this step;
(5) deploy the N1 LA from the reviewed definition + TRANSFORM N9/N10/N13 per §C;
(6) **RE-ENABLE push + enable the C2 archive LA ONLY NOW** — after every C2 writer/transform is
    live (Codex 1: re-enabling the LEGACY writers post-seal would mint above-epoch rows with no
    N17 provenance / post-epoch tombstones with no CommitSig ⇒ sweep/allowlist halts);
(7) PROBES on the real cloud (sign/verify each new frame; a correction dry-run against a probe
    row; the sweep in REPORT-ONLY mode first);
(8) cleanup (probe rows deleted, temp LA deleted).
PRODUCTION-cutover variant: VERIFIES the archive list is EMPTY before sealing (C2-R23-N1) — else
HALT + Kunal decision. EVERY step is idempotent (create-if-missing / reuse-if-valid / halt-on-
divergence) — a partial-failure re-run is safe at ANY boundary, including a step-(4) network
timeout after push was fenced (the fence state is re-asserted, the seal reused, never re-sampled).

## E. Review questions for the INTERIM LA REVIEW (both reviewers)

- **QL1:** Does §B implement the converged §5 P0-P7 + §B-R faithfully — especially the P2
  ETag capture/P6 single-MERGE/fence discipline (C2-R1-1/-2/-10), the §3a boundary re-stamps, and
  the outcome-by-read? Any decision left IN the LA that belongs in `correctionCompute`?
- **QL2:** Do the §C transforms preserve every EXISTING behaviour of the three audited LAs except
  the specified amendments (the C1 attest pipeline, dedup, paging, fail-closed postures)?
- **QL3:** Is the §D cutover ordering airtight against the design's quiescence + fencing pins, and
  is the runner idempotent at every step (partial-failure re-run safe)?
- **QL4:** Are the §A schemas exactly the converged N3/N4/N7/N17/N18 shapes (Enforce-Unique keys,
  empty-vs-null encodings for ControlId/PublicationVersion)?

---

## F. INTERIM LA REVIEW — ROUND 1 FOLD RECORD (`bb1987e`)

**R1 verdicts: AGY BLOCK×2 + Codex BLOCK×11 = 13 findings, ALL ground-truthed REAL, ALL folded.**
Both reviewers confirmed the DESIGN itself is frozen-sound; every finding was implementation
fidelity (the concrete artifacts drifting from the converged spec). Proof suite 108 → **127/127**.

| # | Finding (reviewer) | Fold | Where | Probe |
|---|---|---|---|---|
| **F1** | **AGY-1** — the LA still carried DECISION LOGIC: P6 assembled the snapshot payload (version bump, balance arithmetic, manifest merge) with LA expressions, and the per-mode legality trees were LA conditions. Violates the N2-computes/LA-executes boundary. | Two NEW compute ops. `op:assembleSnapshot` returns the EXACT serialized ConfigData (version bumped, deltas applied, fence untouched, controlManifest merged incl. explicit-nulls) — the LA does one MERGE of that string. `op:modeGate` returns `{ok}` or the typed refusal for every mode. **Zero arithmetic and zero legality conditions remain in the LA.** | §B step 12 (`Mode_gate`), §B step 18 (`Assemble`); `correctionCompute.js:401` `assembleSnapshot`, `:431` `modeGate` | F1a ×2, F1b ×5 |
| **F2** | **AGY-2 + Codex-1 + Codex-2** (three findings, one ordering fix) — (a) the epoch seal was signed BEFORE the Function App redeploy, so `frame:'epoch-v1'` was not live ⇒ 400 mid-quiescence; (b) the legacy writers were re-enabled straight after the seal, before the C2 transforms went live ⇒ above-epoch rows with no N17 provenance and post-epoch tombstones with no CommitSig ⇒ permanent sweep/allowlist halts; (c) a rerun of the apply runner would RE-SAMPLE the epoch boundary. | §D resequenced: **(3) Function App deploys FIRST**, (4) quiescent cutover + seal, (5) N1 LA + N9/N10/N13 transforms, **(6) writers re-enabled ONLY THEN**. **EPOCH RERUN RULE:** strictly create-if-absent — an existing seal with a valid EpochSig is reused BYTE-FOR-BYTE; a freshly-observed boundary that DIFFERS ⇒ HALT + surface. The boundary is one-shot, never a refreshable maximum. | §D steps 1-8 | (deployment-sequence item; §D re-review) |
| **F3** | **Codex-3** — the converged design requires the archive fold to be CONTROL-AWARE; the shipped `snapshotCompute` was not (it folded raw values, so a corrected-away effect would fold back into balances). | `snapshotCompute` now takes optional `body.controlHeads` and folds EFFECTIVE values: active-headed targets excluded, active control rows folded raw, historical control rows excluded, null-head targets normal; the unit-move partition rides the target's run. **Absent `controlHeads` ⇒ byte-identical pre-C2 behaviour**, regression-gated by archive-carry 28/28. ⚠ This is a flagged amendment to the audited Chunk-8 surface — carry it to the return re-audit. | `snapshotCompute.js`; §C N10 `Call_compute` | F3 ×3 (incl. the byte-identical regression guard) |
| **F4** | **Codex-4** — `computeDelta` accepted malformed rows (negative/fractional/NaN qty), so a corrupt row could publish a corrupt balance. | `validEconRow` + `addDelta` gate EVERY delta cell; any invalid row ⇒ `INVALID_ROW` refusal before publication. | `correctionCompute.js:138`, `:148` | F4 ×2 |
| **F5** | **Codex-5** — `membershipDecision` consumed an N17 run record without checking the record actually BELONGS to the target's run (a foreign/stale record could decide membership). | The record must BIND: `RunId` + `SnapshotVersion` must match the target's `ArchiveRunId`/snapshot; mismatch ⇒ `ADOPTION_DELTA_UNDECIDABLE` (manual lane). | `correctionCompute.js:250` | F5 ×2 |
| **F6** | **Codex-6** — `pushIdempotency` compared against the LIVE row shape, but real archive rows carry the archive column aliases (`TxnType`/`TxnDate`/`TxnTimestamp`) ⇒ an exact replay of an archived row would never match ⇒ phantom re-insert. | `normalizeArchiveRow` normalizes the archive aliases before the canonical compare. | `correctionCompute.js:355`, `:366` | F6 ×1 |
| **F7** | **Codex-7** — the published-run full-set check used `Set()` equality, which LOSES duplicates: `[101,101,102]` compared equal to the signed `[101,102]` ⇒ a duplicated archived member escaped the HALT. | MULTISET (sorted-list) equality. Duplicate SourceIds now HALT. | `correctionCompute.js:301` | F7 ×1 |
| **F8** | **Codex-8** — a device retry against a WITHDRAWN claim with a leftover N18 row had no terminal cell: it neither re-minted nor cleaned up ⇒ the N18 row stranded forever. | `claimDispatch` returns `delete_n18_then_ack_terminal` / `superseded_by_adjudication` — deletes the residue, never re-mints an aborted deletion. | `correctionCompute.js:332` | F8 ×1 |
| **F9** | **Codex-9** — `opDigest` hashed `JSON.stringify` output, so the SAME operation submitted with different key ORDER produced a different digest ⇒ idempotency broken on retry from a different client serializer. | `stableClone` (recursively key-sorted) before hashing ⇒ key-order-canonical digest. | `correctionCompute.js:54`, `:61` | F9 ×1 |
| **F10** | **Codex-10** — P5 verified the re-read row with the econ-v1 canonical, which IGNORES the control fields; a SharePoint-dropped `ControlId`/`ControlRevision` would pass verification. Also the seal was minted from the re-read row rather than the intent. | New `op:ctlRowsEqual` (full ctl-v1 field set) compares the re-read row against the INTENDED pre-write object, and the seal is minted **from the intent**, pinned in §B step 17. | `correctionCompute.js:390`; §B step 17 | F10 ×1 |
| **F11** | **Codex-11** — §A typed N17 `Published` as Text, diverging from the frozen schema. | `Published` is an SP **Boolean** (Yes/No, explicit default FALSE); OData filters use `Published eq 1`; the `runrec-pub-v1` seal signs the CONSTANT not the boolean, so signing is unaffected. | §A N17 row | (schema item) |

**Gates after the fold (all re-run at `bb1987e`):** correction 127/127 · attest 58/58 · archive-carry
28/28 · buyback-export 170/170 · topology 256/256 · access-policy 67/67 · smoke 277/277 · static +
CSP PASS. Zero client files touched.

## G. Review questions for ROUND 2 (confirm-folds)

- **QG1:** Does each F1-F11 fold ACTUALLY close the finding it claims to close — and did any fold
  introduce a new defect or contradict a converged design rule? (Findings F1/F3/F10 changed
  behaviour, not just wording.)
- **QG2:** F1 claims the LA now carries ZERO decision logic. Read §B end-to-end: is there any
  remaining condition, arithmetic, map/array manipulation, or legality choice that belongs in
  `correctionCompute`?
- **QG3:** F2 is the deployment-order fix. Walk §D as a state machine including CRASHES between
  every pair of steps and a full re-run from step (1): is any interleaving able to leave writers
  live without their transforms, or re-sample the epoch boundary?
- **QG4:** F3 amends the audited Chunk-8 `snapshotCompute`. Is the control-aware fold + unit-move
  partition exactly the converged §5b/N10 behaviour, and is the absent-`controlHeads` path really
  byte-identical to pre-C2?
- **QG5:** Anything in the R1 round you raised that you consider NOT closed, or any remaining
  implementation-fidelity gap you did not report in R1.

---

## H. INTERIM LA REVIEW — ROUND 2 FOLD RECORD (`W-B2r2`)

**R2 verdicts: AGY PASS (all four QL questions) · Codex BLOCK×6.** Every Codex finding was
reproduced against the real modules before any fix, and **all six were REAL — zero refuted.** AGY
passed QL1/QL2/QL3 on three surfaces Codex proved broken; the repros below are the ground truth.
Codex confirmed F1, F2's epoch/re-enable ordering, and F6-F11 closed as claimed, and rated F3/F4/F5
only PARTIALLY closed — correctly. Proof suite 127 → **144/144**.

| # | Finding | Repro (run before the fix) | Fold |
|---|---|---|---|
| **G1** | The **null-head lane was dead**. `snapshotCompute` built the `tombstoned` set unconditionally from every `Type='deleted'` row and excluded those targets BEFORE the manifest was consulted — so a device tombstone that was adopted and then WITHDRAWN/RETIRED (`controlHeads[T] === null`, meaning T is present again) still suppressed T. Contradicted §C:172 and design:134. | T=+10 with a withdrawn tombstone folded `balances: []` instead of `+10`. **Server balances lost every restored target at archive time.** | The set is now built AFTER the manifest and a tombstone suppresses its target only while it is the ACTIVE authority: explicit-null head ⇒ suppresses nothing; a control tombstone that is not the active head ⇒ suppresses nothing; no head recorded (every legacy call) ⇒ unchanged Chunk-8 rule. `snapshotCompute.js` |
| **G2** | The **archive fidelity hash ignored the entire N7 control form** — `hashRows` still carried only the C1 field set, while §C:169 claimed the full typed N7 set (design:153). | `hashRows(source) === hashRows(copyWithoutControlId)` returned **true**. A copy mapping that dropped `ControlId` passed the gate, and the run then deleted the complete live control row — leaving an archived control that can never be tied to its manifest head. | `ControlId`, `ControlType`, `ControlRevision`, `BornPublicationVersion`, `TargetLine`, `OriginalEventAt`, `ControlState`, `CommitSig` joined the canon, typed. The hash is per-run TRANSIENT (source vs archive re-read, same code both sides; no stored hash field exists anywhere), and legacy rows carry none of these columns ⇒ `''` on both sides ⇒ legacy equality semantics unchanged. `snapshotCompute.js` |
| **G3** | **F4 was only half-built.** (a) `computeDelta` short-circuited on `targetLocation:'live'` BEFORE any validation. (b) `validEconRow` accepted any non-empty type, while the frozen engine classifies `deleted` and every unknown type as direction **none** — `effectOf` scored them OUTBOUND. | (a) A live-target replacement with `qty:-5` returned `{ok:true, suppressed:'live-ensemble'}` and was sealable/publishable as the active control. (b) On an archived +10 target, replacement type `deleted` **or** `unknown_type` both returned delta **−15**, which the engine would never agree with ⇒ snapshot arithmetic and settlement diverge permanently. | (a) The cell arithmetic ALWAYS runs so the consumed rows are always validated; the live suppression is applied to the RESULT. (b) `hasEconDirection` consults the frozen engine's own `classify`; a directionless row is malformed by construction and refuses `INVALID_ROW`. `correctionCompute.js` |
| **G4** | The **membership bind test passed when both sides were missing** (`undefined !== undefined` is false), and §B never pinned the input mapping. | With both bindings omitted a `recordSigValid:true` record returned `excluded` — deciding membership on nothing. Under raw SharePoint casing (`ArchiveRunId`) a legitimate archived adoption instead became permanently `undecidable`. | Presence is now REQUIRED on both sides (missing ⇒ `undecidable`, never a decision); the reader also accepts raw SP casing as a belt so a normalization gap cannot brick every adoption; **§B step 13a pins the exact input mapping.** `correctionCompute.js` |
| **G5** | The **"absent `controlHeads` is byte-identical" claim was false** — the unit-move keyed on `Type='deleted'` independently of whether `controlHeads` was supplied. The R1 regression probe used only an ordinary row, so it never covered this. | Legacy input (target Id 10, tombstone Id 200, cutoff 100, **no `controlHeads` property**): old compute archives `[10]`, amended compute archived `[10,200]`. **Merely deploying the function at §D step (3) would have changed live archive behaviour before the legacy writer was disabled at step (4).** | Explicit **C2 discriminator**: `Object.prototype.hasOwnProperty.call(body,'controlHeads')`. Property ABSENT ⇒ pre-C2 partition; explicitly supplied (even `{}`) ⇒ C2 partition. §C and §D step (3) now state this, which is also what makes the early Function deploy safe. `snapshotCompute.js` |
| **G6** | **`archive_state` was transformed to v2 at §D step (2) while the legacy archive LA was still ENABLED** (disabled only at step 4). That LA rebuilds ConfigData from a fresh `json('{}')` holding only status/runId/lockAt on BOTH acquire and release (`archive-def-current.json:31`, `:355` — the release writes `IF-MATCH: *`, so it cannot even be ETag-fenced). | A single legacy run starting between steps (2) and (4) erases `state`, `v:2` and the request flags; step (5) then deploys N10/N1 against an old-shape coordination record. | The transform MOVED inside the quiesced window — §D step (4), after the legacy archive LA is disabled and idle. Step (2) is now explicitly a no-op with the reasoning recorded. |

**Two probe defects this round exposed in my own suite** (both fixed, both were masking the bugs):
the R1 null-head probe used a *replacement* control row and never a `Type='deleted'` tombstone, so
G1 slipped through; and the outbound-sign probe asserted on type `'usage'` — **a type that exists
nowhere in this app** and that the engine folds as nothing — so it was asserting the very defect in
G3b. Repinned to the real `'out'` type. Three membership probes that had been passing without target
bindings are now bound (the unbound cases get their own explicit probes).

**Gates after the fold:** correction **144/144** · attest 58/58 · archive-carry 28/28 ·
buyback-export 170/170 · topology 256/256 · access-policy 67/67 · smoke 277/277 · static + CSP PASS.
Zero client files touched.

## I. Review questions for ROUND 3

- **QI1:** Does each G1-G6 fold close its finding, and did any of them introduce a new defect?
  G1 and G3 changed evaluation ORDER; G2 widened a hash that gates a destructive delete.
- **QI2:** G2 makes the fidelity hash a real gate on the archive copy mapping. Is any field in the
  new canon legitimately mutable BETWEEN the source read and the archive re-read inside one run
  (`ControlState` especially, given the authority gate)? A false HALT there stalls archival.
- **QI3:** G5's discriminator is property presence. Enumerate the callers: is there any path — the
  C2 archive LA, a retry, a probe, a future caller — that could omit `controlHeads` and silently
  get the pre-C2 partition when it needed the C2 one?
- **QI4:** G1 changed which tombstones suppress. Are there tombstone/head combinations where the new
  rule under- or over-suppresses versus the converged §5b semantics?
- **QI5:** With §D now transforming `archive_state` inside the quiesced window, re-walk the runner
  as a state machine with crashes between every pair of steps and a full re-run from step (1).
