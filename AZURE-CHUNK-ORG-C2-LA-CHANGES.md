# OS-W4.4 Contract 2 — CONCRETE STAGING ARTIFACTS (LA definitions + apply inventory)

**Status: 🔍 W-B2r5 INTERIM LA REVIEW — ROUND 6. R1: AGY×2 + Codex×11 = 13 REAL @ `bb1987e` (§F).
R2: AGY PASS + Codex×6 @ `aa1527a` (§H). R3: AGY PASS (⚠ FABRICATED QI3 — §J) + Codex×3 @
`0046224` (§J). R4: AGY PASS + Codex×3 @ `a403d5c` (§L). R5: AGY PASS + Codex×3 @ `e60151c` (§N). R6: AGY PASS + Codex×4 @ `bcdb1be` (§P).
R7: BOTH BLOCK — AGY×1 + Codex×5 @ `8ab03b2` (§R). R8: **BOTH BLOCK** — AGY×1 + Codex×4 = 4
distinct, 1 CONVERGED — all REAL, folded (fold record §T, questions §U). **🔔 DISJOINTNESS IS NOW
PROVEN BY BOTH REVIEWERS INDEPENDENTLY AND MECHANICALLY (AGY 36 pairs, Codex 72 ordered pairs) — the
rows-1/2 defect that survived two rounds is DEAD, and the block moved from OVERLAP to COMPLETENESS.**
Suite 127 → 144 → 154 → 158 → 161 → 164 → 169 → 171/171. NINE consecutive blocked rounds
(13 → 6 → 3 → 3 → 3 → 4 → 5 → 4), every finding real, zero refuted. **The design and the money
arithmetic have been settled since R2; every round since has been the CUTOVER RUNBOOK.**
Cadence option 2: paper review of these
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
| `BuildApprovals_Staging` (N19) | `Revision` Number **Enforce-Unique + indexed**; `PackageDigest`, `ApprovedAt`, `BuildSig` Text. **APPEND-ONLY** — authority is the HIGHEST `Revision` with a verifying `BuildSig`; never edited, never overwritten (R8 finding 3) |
| `StockControlPending_Staging` (N18) | `TransactionId` Text **Enforce-Unique + indexed**; the FULL econ-v1 row column set (as StockTransactions_Staging) + `TargetTransactionId`; `OwnerDeviceId` Text |
| BOTH ledger lists gain (N7) | `ControlId`, `ControlType`, `TargetLine` (Note JSON), `OriginalEventAt`, `ControlState`, `CommitSig` Text; `ControlRevision`, `BornPublicationVersion` Number |
| `AppConfig_Staging` items | `archive_state` ConfigData TRANSFORMED to the v2 five-state shape (§3 — existing content preserved, `v:2` + request-flag fields added); NEW `seal_epoch` item `{epochId, tombstoneCommitEpochId, archiveC2EpochId, recordedAt, **cutoverPackageDigest**, EpochSig}` (N16, epoch-v1-signed — the package digest is IN the signed canonical, R7 finding 3; it is the CUTOVER-TIME package, historical evidence only); **N19 is a LIST, not an AppConfig item** — see `BuildApprovals_Staging` in the table above (R8 finding 3: an overwriteable singleton is replayable); `stock_snapshot` ConfigData gains `controlManifest:{version,controlHeads:{}}` + `fence:0` on first correction-era publish (carried forward by N10) |

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
**`Call_compute` BODY — PINNED (R4 finding 2).** The N10 generator MUST emit, and the apply runner
MUST verify, exactly: `{ rows, cutoffId, retainAfterTs, snapshotVersion, runId, stepCutoffTs,
controlHeads: <the captured stock_snapshot's controlManifest.controlHeads, {} when empty>,
`**`controlProtocol: 2`**` }`. The LA then **ASSERTS `body('Call_compute')?['partitionMode']`
equals `'c2'` and FAILS the run otherwise.** Without BOTH halves the helper's protection was
unreachable from the real caller: `controlProtocol` appeared nowhere in §C, so a generator following
§C alone could omit it AND `controlHeads` and receive a SUCCESSFUL LEGACY result — folding an active
correction under the wrong partition, the very defect R2 finding 5 closed. `snapshotCompute` also
REFUSES `UNSUPPORTED_CONTROL_PROTOCOL` for any explicit protocol value other than 2, so a
contradictory or future value can never silently select a partition. `Verify_content_hash` takes
`rows` only (no partition selection) but MUST reach the same Function deployment as its paired
`Call_compute` — see §D step (3).

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
(3) **ENTER QUIESCENCE FIRST, THEN REDEPLOY THE FUNCTION APP** (correctionCompute + the attestRows
    frames + validateUser 'correction'). Order within this step is fixed:
    **(3a) DISABLE the legacy archive LA + FENCE push (disable the push LA for the bounded
    interval) → WAIT until `archive_state` is idle; (3b) only then redeploy the Function App.**
    The seal in step (4) needs frame:'epoch-v1' live (AGY C2-LA-2: signing before deploy = 400
    mid-quiescence), so the deploy must precede the seal — but it must NOT precede quiescence.
    **R4 finding 1:** the deploy was previously ahead of quiescence on the argument that the
    amended `snapshotCompute` is byte-identical for callers that omit `controlHeads`. That claim
    was true of the PARTITION but NOT of the HASH: the canonical is version-tagged
    (`archcanon-v2`), so its BYTES changed for every row. The legacy archive LA hashes the source
    in `Call_compute` BEFORE the copy loop and the re-read in `Verify_content_hash` AFTER it, then
    compares the two (`archive-def-current.json:78`, `:245`, `:467`) — two separate Function
    invocations straddling the copy. Redeploying between them makes a FAITHFUL copy mismatch and
    the run fails its fidelity gate purely because it straddled the deployment. Quiescing first
    closes the window entirely: no archive run can be in flight when the canonical changes.
    (The `controlHeads` property-presence discriminator still holds and is still what keeps the
    PARTITION pre-C2 for legacy callers — R2 finding 5 — it simply was never a statement about
    hash bytes.);
(3c) **BOOTSTRAP THE N19 AUTHORITY RECORD — a numbered action, R8 finding 4.** Without it the
    runbook DEADLOCKED on a virgin run: the matrix's `build` fact is defined as "live Azure package
    digest == the digest in the current signed approval", so with no approval record the fact can
    never be true; the runner would sit in row 4 redeploying the same package forever. It cannot be
    signed before (3b) either, because `buildrec-v1` is not live until that deployment. So, AFTER
    (3b) and BEFORE the seal: read the LIVE package digest from Azure deployment/slot metadata →
    sign the complete `buildrec-v1` tuple `{packageDigest, revision: 1, approvedAt}` → CREATE-IF-
    ABSENT into `BuildApprovals_Staging` (Enforce-Unique `Revision` makes a double-run a 409) →
    READ BACK → VERIFY the signature AND that the digest equals the live package. **Rerun handling:**
    an existing revision-1 row whose signature verifies and whose digest matches the live package is
    REUSED as-is; a verifying row whose digest DIFFERS from the live package means the deployment
    changed after approval ⇒ advance to revision 2 (never edit revision 1); a row that does not
    verify ⇒ HALT + surface;
(4) the QUIESCENT CUTOVER (C2-R18-3/C2-R19-3/C2-R20-4), continuing under the fence established in
    (3a): **`archive_state` v2
    TRANSFORM (preserve content, add v:2 fields) — safe here, the only writer of that item is
    disabled and idle (R2 finding 6)** → complete any published
    legacy run's Live-delete by its exact set → SourceId residue cleanup (legacy AUTH BYPASS
    documented, C2-R22-1) → seal `{epochId, tombstoneCommitEpochId, archiveC2EpochId}` + EpochSig.
    **EPOCH RERUN RULE (Codex 2): strictly create-if-absent — an EXISTING seal_epoch item with a
    VALID EpochSig is REUSED byte-for-byte (never re-sampled); a rerun whose freshly-observed
    boundary DIFFERS from a valid existing seal ⇒ HALT + surface (the boundary is one-shot, never
    a refreshable maximum).** Writers STAY DISABLED at the end of this step;
(5) deploy the N1 LA from the reviewed definition **CREATED DISABLED (R5 finding 2)** + TRANSFORM
    N9/N10/N13 per §C. N1 is a LEDGER WRITER — §B step 16 SP-CREATEs the control row into the
    TARGET'S OWN LIST, i.e. DIRECT-TO-ARCHIVE for an archived target (SR-135). Deployed enabled
    here it could, before N13 is transformed, write a control row into Live that the OLD pull LA
    (no `ControlId eq null` filter) would deliver to devices as a PHANTOM STOCK MOVEMENT; and its
    direct-to-archive writes can advance the archive boundary. It stays disabled until (6b);
(6) **RE-ENABLE the writers ONLY NOW** — after every C2 writer/transform is live (Codex 1:
    re-enabling the LEGACY writers post-seal would mint above-epoch rows with no N17 provenance /
    post-epoch tombstones with no CommitSig ⇒ sweep/allowlist halts). **PINNED ORDER (R4 finding 3,
    corrected R5 finding 2): (6a) re-enable push; (6b) enable BOTH boundary-advancing writers —
    the C2 archive LA AND the N1 correction LA — LAST.** Push cannot advance the archive boundary,
    so after (6a) the seal is still exact (MID-ENABLE). Enabling the boundary-advancing pair last
    means the boundary cannot move while the runner is in an intermediate state. A crash INSIDE
    (6b) with only one of the pair enabled resolves to POST-CUTOVER, whose first action is to
    ensure both are enabled. The legacy archive LA is NEVER re-enabled;
(7) PROBES on the real cloud (sign/verify each new frame; a correction dry-run against a probe
    row; the sweep in REPORT-ONLY mode first);
(8) cleanup (probe rows deleted, temp LA deleted).
**PHASE-AWARE RERUN (R3 finding 3).** The epoch rerun rule (re-observe the boundary, HALT on
divergence) is only meaningful while the writers are quiesced. After step (6) legitimate C2 activity
NECESSARILY advances the archive boundary, so a full rerun — say the runner crashed during step (7)
— would re-observe item 101 against a sealed 100 and HALT under the mandatory rule, blocking its own
probes and cleanup with no way to distinguish legitimate post-cutover growth from an unsafe
pre-cutover change. The runner therefore establishes PHASE FIRST, and the authority is OBSERVED
WRITER STATE, not a deletable marker (the same principle as C2-R19-1/C2-R24-1):
**CLOSED-WORLD PHASE MATRIX (R4 finding 3; CORRECTED at R5 findings 1-3).** The R4 matrix was not
actually closed — it **excluded the ordinary starting state**. A virgin system reads (push enabled,
legacy archive enabled, C2 archive disabled, transforms absent), which matched no row and therefore
fell to INCONSISTENT ⇒ a fresh runner HALTED before it could begin; a crash partway through (3a)
(legacy disabled, push not yet fenced) did the same, permanently, instead of finishing quiescence.
**Governing rule (R5 finding 1): `INCONSISTENT` is reserved for states that CANNOT arise from a
legitimate prefix of this runbook. Every state that can arise from a legitimate prefix has a forward
action.** Two further corrections: the **correction LA (N1) is a LEDGER WRITER** — §B step 16 SP-
CREATEs the control row into the TARGET'S OWN LIST, which for an archived target is a DIRECT-TO-
ARCHIVE write (SR-135), so N1 can advance the archive boundary and can mint control rows into Live;
it must be fenced, observed, and enabled in a pinned position (R5 finding 2). And **phase authority
must include the FUNCTION BUILD**, because writer state cannot see which build the LAs are calling
(R5 finding 3).

**R6 CORRECTION — THE ROWS WERE NOT DISJOINT.** The R5 table claimed "every combination has exactly
one outcome" and did not deliver it: PRE-QUIESCENCE accepted `any/any/C2-off/N1-off/any`, of which
PRE-CUTOVER was a strict SUBSET, so the ordinary post-(5) state (push fenced, legacy off, C2 off, N1
off, transforms verified) matched BOTH rows — "repeat (3a)" and "proceed (3b)→(5)" — two competing
actions. The POST row was also column-shifted and never encoded the two half-(6b) tuples. The table
below is a **disjoint partition**, made so by adding the two PROGRESS facts the R5 version lacked
(valid seal? reviewed build deployed?) and by writing the half-(6b) tuples explicitly.

The runner observes EIGHT facts: push fenced? · legacy archive LA enabled? · C2 archive LA enabled? ·
N1 correction LA enabled? · N9/N10/N13 transforms verified? · **valid sealed epoch present?** ·
**reviewed Function build deployed?** · `cutoverCompletedAt` present?
Boundary-advancing PRODUCTION writers = **{C2 archive LA, N1}**; see the OPERATIONAL WRITER
INVENTORY below for the non-production paths that must also be quiet.

**R7 CORRECTIONS.** Three structural defects, all found by BOTH reviewers or by Codex's mechanical
pairwise proof: (a) rows 1 and 2 STILL overlapped — adding the seal fact separated rows 1-2 from
3-10 but left row 2 a strict subset of row 1, so the ordinary post-(3a) state matched both, exactly
the defect R6 claimed to fix; the cause was structural, not missing facts — **row 1 used wildcards
that subsume its successor**, and it now carries an explicit NOT-QUIESCED predicate; (b)
`cutoverCompletedAt` was declared one of the eight facts but had **no column**, so rows 3/10 and
4/10 were separated only by prose — it is a column now; (c) the build-repair path was several
non-atomic remote toggles with only its endpoints represented, so a crash mid-repair mapped to
NO row (disable both writers then crash before fencing push; or fence push then crash before
disabling them). Repair is now **ONE PREDICATE** whose first action idempotently re-asserts all
three quiescence operations, so every partial repair state is inside it by construction.

`C` = `cutoverCompletedAt`. Boundary-advancing writers = {C2 archive LA, N1}.

**R8 ROOT FIX — `C` IS NOW A PRE-ENABLE LATCH, NOT A TRAILING MARKER.** Both R8 completeness
failures had ONE cause: `cutoverCompletedAt` was stamped AFTER the boundary writers went live, so
there was always a window in which the writers' state and the marker disagreed, and I kept trying to
paper over it with more rows. **The stamp now happens BEFORE the boundary-advancing writers are
enabled** — (6b-i) stamp `C`, then (6b-ii) enable the C2 archive LA, then (6b-iii) enable N1. That
makes `C` a monotonic latch with an exact meaning:

> **`C` absent ⇒ no boundary-advancing writer has EVER been enabled ⇒ the sealed boundary is still
> exact. `C` present ⇒ a boundary writer may be or may have been live ⇒ NEVER re-observe.**

With that ordering, "writers on while `C` absent" becomes genuinely unreachable, one row absorbs
every partial-enable state, and the post-repair-deploy state has a forward path by construction
rather than by another special case. 8 rows.

| # | push | legacy arch | C2 arch | N1 | transforms | seal | build | C | phase | action |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | \[NOT(push fenced AND legacy off)\] | | off | off | any | absent | any | absent | **PRE-QUIESCENCE** (bootstrap + partial (3a)) | (re-)assert (3a): disable the legacy archive LA, fence push, WAIT IDLE. Idempotent, re-entrant from the virgin state and any partial (3a) |
| 2 | fenced | off | off | off | any | absent | any | absent | **QUIESCED-PRESEAL** | (3b) deploy the reviewed build if not already → **(3c) BOOTSTRAP the N19 authority record (below)** → (4) transform `archive_state`, complete the published run's Live-delete, residue cleanup, OBSERVE the boundary, write the seal |
| 3 | fenced | off | off | off | any | **valid** | reviewed | absent | **QUIESCED-SEALED** | re-observe the boundary, HALT on divergence (the anomaly gate — nothing may mint rows while the window is quiet); proceed (5) |
| 4 | fenced | off | off | off | any | valid | **not reviewed** | absent | **QUIESCED-REBUILD** | writers already quiet ⇒ forward-deploy the reviewed build (and bootstrap/advance N19 if that is what is missing) ⇒ re-enter row 3 |
| 5 | enabled | off | off | off | **verified** | valid | reviewed | absent | **MID-ENABLE** | (6a) is done. NO boundary writer has ever been live ⇒ the seal is still exact. **Next: (6b-i) STAMP `C`**, then (6b-ii)/(6b-iii) |
| 6 | any | off | \[NOT(C2 on AND N1 on)\] | | verified | valid | reviewed | **present** | **HANDOVER** — absorbs every partial enable AND every post-repair-deploy state | ensure push enabled, ensure the C2 archive LA enabled, ensure N1 enabled — idempotently, in that order. Then row 7. Does NOT re-observe the boundary (`C` is latched) |
| 7 | enabled | off | on | on | verified | valid | reviewed | present | **POST-CUTOVER** | skip re-observation, reuse the sealed values byte-for-byte, resume at (7)/(8). Boundary growth here is expected, not evidence |
| 8 | any | off | any | any | verified | valid | **not reviewed** | present | **REPAIR** | ONE predicate, ONE entry point, and it OWNS the whole repair regardless of writer state. **First action, always, idempotently: disable the C2 archive LA, disable N1, fence push, WAIT IDLE.** Then forward-deploy the reviewed build (advancing N19 if the approval is what changed). The deploy flips `build` to reviewed ⇒ the state falls into **row 6**, which drives the re-enable to completion. Does NOT re-observe the boundary |
| — | **anything else** | | | | | | | | **INCONSISTENT** | **HALT + surface, no automatic recovery** — states no legitimate prefix produces: the legacy archive LA enabled after (3a); **any boundary writer on while `C` is absent** (unreachable now that the stamp PRECEDES the enable); any writer enabled with transforms missing/half-applied; `C` present with no valid seal |

**Why this is complete where R7 was not.** R7 finding 1: after a repair's forward-deploy, `build`
flips to reviewed while the writers are still down — R7's repair row required `not reviewed` and
dropped the state. Here that state is `C` present + build reviewed + writers not all on = **row 6**,
whose whole job is to finish the enable. R7 finding 2: both writers enabled but the stamp write
timed out — impossible now, because the stamp is written BEFORE either writer is enabled; the
equivalent interruption (stamp written, writers not yet up) is again **row 6**.

**Disjointness sketch** (QS2's mechanical proof is the reviewers' job): 1↔2 by the quiescence
predicate; 1,2 ↔ 3-8 by `seal`; 3,4,5 ↔ 6,7,8 by `C`; 3↔4 by `build`; 3,4 ↔ 5 by `push`; 6↔7 by the
NOT(both writers on) predicate; 6,7 ↔ 8 by `build`.

**FUNCTION BUILD (R5 finding 3; authority corrected R6 finding 4; binding + advancement corrected
R7 findings 3-5).** THREE artifacts with three different jobs — conflating them was the R6 defect:

1. **CURRENT AUTHORITY = the APPEND-ONLY BUILD-APPROVAL LOG (N19)** — **`BuildApprovals_Staging`**,
   a LIST (not an AppConfig singleton) with `Revision` Number **Enforce-Unique + indexed**,
   `PackageDigest`, `ApprovedAt`, `BuildSig` Text; each row signed with the NEW attestRows frame
   **`buildrec-v1`**. **Authority = the HIGHEST `Revision` whose `BuildSig` verifies.**
   **R8 finding 3 — a monotonic revision inside an OVERWRITEABLE SINGLETON is not replay-safe.** The
   signature covers the revision, so an old record's revision cannot be *edited* without re-signing —
   but nothing stopped restoring the COMPLETE, still-valid revision-1 tuple *and its signature* over
   revision 2. `verifyFrame` succeeds, and with the singleton overwritten there is no retained
   high-water to reject it — so an obsolete package silently becomes "current" and the runner would
   quiesce production to redeploy it. (I had also mis-probed this: my "replay" probe edited a revision
   while keeping the old signature, which is ordinary tamper detection, not replay.) Append-only +
   Enforce-Unique revision + highest-valid selection removes the overwrite. Two further guards:
   - **RETAINED HIGH-WATER OUTSIDE THE LOG:** the runner persists the highest revision it has ever
     observed in its own signed run record, and REFUSES any selection lower than that — the
     protection Codex asked for by name, and the same non-forgeable-state-over-markers principle as
     C2-R19-1/C2-R24-1.
   - **P-13 BOUNDARY, STATED HONESTLY:** a SharePoint-direct actor who DELETES the newest approval
     rows can still regress the log. That is the project's existing documented trust boundary (the
     same one that covers direct list access generally), it is caught by the retained high-water on
     the next runner pass, and it is banked for server-side enforcement — not claimed as closed.
   **R7 finding 4:** the R6 design made the
   one-shot epoch the permanent current-build authority, which is wrong by construction — the epoch is
   create-once and reused byte-for-byte, so the next legitimately-reviewed package (say a
   `correctionCompute` fix with no archive-compatibility change) would be misclassified as a rollback
   FOREVER, leaving the runner to halt, redeploy an obsolete build, or ignore its own rule. Approving a
   new build = writing a new `approved_build` revision; that is the ONLY advancement lane.
2. **HISTORICAL EVIDENCE = `cutoverPackageDigest` inside the one-shot signed epoch (N16)** — the
   package that performed the cutover, frozen with the epoch. **R7 finding 3:** §D previously CLAIMED
   this was "bound into the signed epoch artifact" while the `epoch-v1` canonical did not cover it —
   attestRows ignores fields outside a frame's list, so the digest could be stored, then CHANGED, and
   the original EpochSig would still verify. It is now in the `epoch-v1` field list, in the N16 schema
   (§A), and in the tamper probes.
3. **PER-CALL BELT = the response `buildStamp`** — DERIVED from the bytes of `attestRows.js`,
   `correctionCompute.js`, `snapshotCompute.js` (never a hand-maintained constant), returned on
   **every** response including every error return. The archive LA compares the stamp from
   `Call_compute` against the one from `Verify_content_hash`; unequal ⇒ the deployment changed
   mid-run ⇒ abort `BUILD_STRADDLE` (transient, retryable) instead of a bogus fidelity failure on a
   faithful copy. **R7 finding 5 — REJECT BEFORE COMPARING:** an unreadable-sources failure used to
   return one constant literal, so two instances that BOTH failed compared EQUAL and the belt saw
   nothing. Consumers (LA and runner) MUST reject any stamp not matching `^c2-[0-9a-f]{64}$` before
   any comparison; a malformed or unresolved stamp is a fail-closed abort, never an equality input.
   The digest is the full SHA-256, no longer truncated to 64 bits.

- The matrix's `build` fact = "the live Azure package digest (control-plane metadata) equals the
  digest in the current signed `approved_build` record". Not the epoch's, and not a self-report.
- **Any Function App change — forward deploy OR ROLLBACK — obeys the (3a) quiesce-first discipline.**

**OPERATIONAL WRITER INVENTORY (R6 finding 3).** `{C2 archive LA, N1}` is the complete set of
*production* writers that can mint an archive-list id, but it is NOT the complete set of paths in
this environment. Also capable of creating archive rows: the **legacy archive LA** (before (3a));
**`audit-artifacts/diag-c1-insert.js`** (POSTs an item straight into the archive list); and
**`audit-artifacts/probe-c1-archive-run.js`** (inserts a pre-flight archive row AND drives a
temporary archive workflow). A crashed C1 probe after sealing leaves an above-epoch row with neither
N17 provenance nor a valid direct-control seal, and the next sweep HALTS — while writer-state facts
look untouched. **RULE: direct SharePoint/archive diagnostics and temporary archive workflows are
PROHIBITED from step (3a) onward. The runner verifies none are running before it fences, and the
operator confirms it. Any such tool used during the window must delete its rows before the sweep.**

- The seal item also records `cutoverCompletedAt`, stamped when step (6b) completes. It cannot flip
  the phase on its own — the observed writer state decides — but it IS the discriminator that
  separates REPAIR-QUIESCED (row 10) from the pre-cutover quiesced rows 3/4, which are otherwise
  identical in writer state. **R6 finding 2:** the R5 rule "`cutoverCompletedAt` present in any phase
  other than POST-CUTOVER ⇒ CONTRADICTION ⇒ HALT" made the build-recovery lane deadlock itself — the
  recovery's own first action (disable C2 + N1, fence push) moves the state OUT of POST while the
  marker remains stamped, so the runner halted permanently before it could forward-redeploy. The
  marker is now EXPECTED in row 10. It remains a contradiction — HALT + surface — when it is present
  with a valid seal and the writers were never enabled at all.

PRODUCTION-cutover variant: VERIFIES the archive list is EMPTY before sealing (C2-R23-N1) — else
HALT + Kunal decision. EVERY step is idempotent (create-if-missing / reuse-if-valid / halt-on-
divergence) — a partial-failure re-run is safe at ANY boundary, including a step-(4) network
timeout after push was fenced (the fence state is re-asserted, the seal reused, never re-sampled)
and a step-(7) crash after the writers are live (phase-aware rerun, above).

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

---

## J. INTERIM LA REVIEW — ROUND 3 FOLD RECORD (`W-B2r3`)

**R3 verdicts: AGY PASS ("100% approved") · Codex BLOCK×3.** All three Codex findings REAL and
reproduced; folded. Codex confirmed G1, G3, G4 and the G6 race closed, and QI4 (the tombstone/head
matrix) PASS. Proof suite 144 → **154/154**.

**⚠ AGY's R3 verdict must be discounted — its QI3 "PASS" is FABRICATED.** It answered the
controlHeads-omission question by quoting a specific N10 Logic App definition, including the ARM
expression `@coalesce(variables('capturedSnapshot')?['controlManifest']?['controlHeads'],
json('{}'))`. **No Logic App JSON exists in this repo.** `gen-correction-def.js` and
`apply-c2-staging.js` are unwritten — they are the NEXT deliverable, deliberately deferred until
this spec review converges (§15 sequencing). Verified: zero matches for `capturedSnapshot` in any
JSON, zero matches for `controlHeads` in `audit-artifacts/*.json`, both files absent. AGY invented
the artifact it claimed to have read, and used it to pass the exact question Codex blocked on.
That is the third round running where AGY passed a surface Codex proved broken; treat its verdicts
as advisory only until it cites something that verifiably exists.

| # | Finding | Repro | Fold |
|---|---|---|---|
| **H1** | The G2 canonical **was not TYPED**. `optNum()` maps null, `''` and absent to the same byte; `String(v \|\| '')` does the same for text. The frozen design binds the fidelity canonical by name: "the fidelity-hash canonical EXTENDED to the FULL N7 control form (versioned, JSON-framed with TYPED values — `0`, `null`, and field-absent are three distinct encodings, C2-R7-5)" (design N10). | `ControlRevision:null` vs absent hashed IDENTICALLY. A source row with `ControlState:null` and a copy that OMITTED `ControlState` passed the fidelity gate — so Live could be destructively deleted against an incomplete archive copy. | Typed cells (`[0]` absent / `[1,value]` present, null and `''` and `0` all distinct) + a `CANON_VERSION` tag. **SCOPE (load-bearing):** the typed rule applies to the eight N7 control fields ONLY — the design types the EXTENSION, not the pre-existing C1 set, which carries the OPPOSITE converged rule (`absent ≡ ''` for optional numeric stamps, `0` a value). Typing the C1 stamps HALTED archive-carry immediately (28→27) because SharePoint renders an unstamped column as absent in one list read and `''` in the other; a blanket application would have bricked every run containing an unstamped row. Both rules now hold simultaneously and are probed. |
| **H2** | G5's discriminator **failed open**. `controlHeads: null \| [] \| "bad" \| 7` was coerced to `{}` while `c2Mode` stayed true, and omission was indistinguishable from a deliberate legacy call. | With a +10 target under an active +8 replacement head, a malformed manifest returned **+10, not +8** — a silently WRONG published balance rather than a refusal. | A present manifest must be a valid plain object or the request is REJECTED (`BAD_CONTROL_MANIFEST`). A caller asserting `controlProtocol: 2` that omits the manifest is REJECTED (`CONTROL_MANIFEST_REQUIRED`), so accidental omission cannot masquerade as legacy. The chosen partition is echoed as `partitionMode` for caller assertion. **Also found while probing:** the legacy path was not a complete no-op — `controlSuppressed` still suppressed `ControlId`-bearing rows with no manifest, so "byte-identical pre-C2" was untrue for such input. Legacy now short-circuits to `false`. |
| **H3** | The apply runner **could not restart after step (6)**. The epoch rerun rule (re-observe boundary, HALT on divergence) is mandatory, but once C2 writers are live the boundary legitimately advances. | Seal records archive epoch 100 → step (6) enables writers → a legitimate run creates item 101 → runner crashes in step (7) → a full rerun observes 101 vs sealed 100 and HALTS, blocking its own probes and cleanup, with no way to tell legitimate growth from an unsafe pre-cutover change. | **PHASE-AWARE RERUN** (§D): phase is established FIRST, and the authority is OBSERVED WRITER STATE, not a deletable marker (the C2-R19-1/C2-R24-1 principle). Writers disabled ⇒ pre-cutover ⇒ the divergence HALT applies in full. C2 writers live ⇒ post-cutover ⇒ skip re-observation, reuse the seal byte-for-byte, resume at step (7). `cutoverCompletedAt` is a fast-path HINT only; present while writers are disabled ⇒ contradiction ⇒ HALT. |

**Gates:** correction **154/154** · archive-carry 28/28 · attest 58/58 · buyback-export 170/170 ·
topology 256/256 · access-policy 67/67 · smoke 277/277 · static + CSP PASS. Zero client files.

## K. Review questions for ROUND 4

- **QK1:** Does each H1-H3 fold close its finding without introducing a new defect?
- **QK2:** **H1's scope split is the load-bearing judgement of this round.** The N7 control fields
  are typed (absent ≠ null ≠ `''` ≠ 0); the C1 fields keep `absent ≡ ''` for optional stamps. Is
  that the correct reading of the design clause, and is there any control field whose live-vs-archive
  SharePoint representation could differ benignly and now HALT a run? Name it precisely — a false
  HALT here stalls all archival.
- **QK3:** H2 rejects a malformed manifest and adds `controlProtocol`/`partitionMode`. Any caller
  shape that still selects the wrong partition silently?
- **QK4:** H3 derives phase from observed writer state. Enumerate the partial states (push enabled
  but archive LA disabled, transforms half-applied) — does any of them resolve to the wrong phase?
- **QK5:** Anything not closed, or newly noticed. If you cannot verify a claim against a file that
  exists in the repo, say so explicitly rather than inferring the artifact.

---

## L. INTERIM LA REVIEW — ROUND 4 FOLD RECORD (`W-B2r4`)

**R4 verdicts: AGY PASS · Codex BLOCK×3.** All three REAL, all folded. Codex confirmed the **H1
scope split is correct** (QK2 — it re-derived the design clause independently and found no N7 field
with a permitted benign live/archive difference), and it complied with the new pack rule: it opened
`archive-def-current.json` before relying on it and stated plainly which artifacts do not yet exist.
**AGY also complied this round** — it explicitly confirmed the absent LA JSONs rather than inventing
them, which is the correction the R3 pack asked for. Suite 154 → **158/158**.

| # | Finding | Fold |
|---|---|---|
| **I1** | **The canonical version tag created a mixed-canonical window at step (3).** `CANON_VERSION` is prepended unconditionally, so the hash BYTES changed for every row — including legacy ones. The R2/R3 claim that an absent `controlHeads` is "byte-identical pre-C2" was true of the PARTITION but never of the HASH. The legacy archive LA hashes the source in `Call_compute` BEFORE the copy and the re-read in `Verify_content_hash` AFTER it, then compares them (`archive-def-current.json:78`, `:245`, `:467`) — **two Function invocations straddling the copy loop.** Redeploying between them makes a FAITHFUL copy mismatch, and the in-flight run fails its fidelity gate purely because it straddled the deploy. | §D step (3) SPLIT and resequenced: **(3a) disable the legacy archive LA + fence push, wait idle; (3b) only then redeploy the Function App.** The window is closed structurally — no archive run can be in flight when the canonical changes. The false "byte-identical hash" claim is deleted and replaced with the precise statement (the discriminator governs the PARTITION, not hash bytes). Rejected the alternative of making the version tag conditional on control-field presence: that would make the canonical data-dependent and would itself false-HALT if SharePoint's two list reads disagree on absent-vs-null for a legacy row. |
| **I2** | **The omission protection was unreachable from the real caller.** The helper only rejects omission when `controlProtocol: 2` is supplied, but §C never required it — a generator following §C alone could omit both it and `controlHeads` and get a SUCCESSFUL LEGACY result. Also: any explicit protocol other than 2 fell through to legacy silently, and a valid manifest selected C2 even under a contradictory protocol value. | §C now **PINS the exact `Call_compute` body** (including `controlProtocol: 2`) and requires the LA to **ASSERT `partitionMode === 'c2'`** and fail the run otherwise. `snapshotCompute` REFUSES `UNSUPPORTED_CONTROL_PROTOCOL` for any explicit protocol ≠ 2 — checked BEFORE the manifest, so protocol wins and a contradiction can never resolve to a partition. |
| **I3** | **The phase predicates were not closed-world.** PRE did not require the C2 archive LA disabled; POST did not require the LEGACY archive LA disabled; other mixed states had no outcome. So a crash after enabling the C2 archive but before re-enabling push classified **PRE with a C2 writer live**, and a legacy LA accidentally left enabled alongside the C2 one still passed **POST and skipped the boundary observation**. | Step (6) gains a **PINNED ORDER: (6a) push, then (6b) the C2 archive LA LAST** — the only writer that can advance the boundary goes live last, so the PRE→POST transition is a single observable action and the boundary cannot move mid-sequence. §D now carries a **CLOSED-WORLD MATRIX** over four observed facts: PRE (push fenced, legacy disabled, C2 disabled), MID-ENABLE (push enabled, both archives disabled, transforms verified ⇒ resume at 6b — no archive writer live ⇒ the seal is still exact), POST (push enabled, legacy disabled, C2 enabled, transforms verified), and **every other combination ⇒ HALT + surface**, naming the three Codex called out. `cutoverCompletedAt` present in any phase but POST ⇒ contradiction ⇒ HALT. |

**Gates:** correction **158/158** · archive-carry 28/28 · attest 58/58 · buyback-export 170/170 ·
topology 256/256 · access-policy 67/67 · smoke 277/277 · static + CSP PASS. Zero client files.

**Standing acceptance item carried to the staging apply** (both reviewers, QK2/QI2): the real
live-vs-archive SharePoint echo for the eight N7 columns — absent vs null vs `''` — cannot be
verified on paper because the transformed N10 definition does not exist yet. If the two list reads
disagree on representation for any N7 field, the typed canonical will HALT. **Probe it on the real
cloud before the first live archive run**, and normalise at the read shape (never by loosening the
canonical) if they differ.

## M. Review questions for ROUND 5

- **QM1:** Do I1-I3 close their findings without introducing a new defect? I1 changed the cutover
  ORDER; I3 changed both the enable order and the phase classification.
- **QM2:** I1 rejects the conditional-version-tag alternative on the grounds that a data-dependent
  canonical would false-HALT on live/archive representation drift. Is that reasoning right, and is
  quiesce-before-deploy sufficient on its own — including for a rollback of the Function App?
- **QM3:** Walk the closed-world matrix in §D against a crash at EVERY point in (3a),(3b),(4),(5),
  (6a),(6b),(7),(8), plus a full re-run from step (1) at each. Any state that resolves to the wrong
  phase, or that HALTs with no forward path?
- **QM4:** §C now pins the `Call_compute` body and a caller-side `partitionMode` assertion. Is the
  pinned body complete and correct against what `snapshotCompute` actually reads?
- **QM5:** Anything not closed, or newly noticed. Same rule as R4: verify against files that exist,
  and say so plainly when an artifact does not.

---

## N. INTERIM LA REVIEW — ROUND 5 FOLD RECORD (`W-B2r5`)

**R5 verdicts: AGY PASS · Codex BLOCK×3.** All three REAL, all folded. Codex confirmed I2 closed,
confirmed the conditional-canonical rejection was correct reasoning (QM2), and confirmed the pinned
`Call_compute` body matches what the code actually reads (QM4). Suite 158 → **161/161**.

**All three findings were in MY OWN R4 fold** — the "closed-world" matrix I introduced was neither
closed nor complete, and its central justification was factually wrong. Recorded plainly because the
pattern matters: a fix that adds a state machine needs the same adversarial walk as the bug it
replaces. AGY's QM3 walkthrough declared the same matrix "airtight against arbitrary crashes"; it
walked only the states the table listed and never asked what the system looks like BEFORE step (1).

| # | Finding | Fold |
|---|---|---|
| **J1** | **The matrix excluded the ordinary starting state.** A virgin system reads (push enabled, legacy archive enabled, C2 archive disabled, transforms absent) — matching no row, so it fell to `INCONSISTENT` and **a fresh runner HALTED before it could begin**. A crash partway through (3a) (legacy disabled, push not yet fenced) did the same, permanently, instead of simply finishing quiescence. | New **PRE-QUIESCENCE** row covering BOOTSTRAP and any partial (3a): no C2 writer exists and no seal is relied upon ⇒ (re-)assert "disable legacy + fence push, wait idle", idempotently. **Governing rule adopted (Codex's words): `INCONSISTENT` is reserved for states that CANNOT arise from a legitimate prefix of the runbook; every state that can, has a forward action.** |
| **J2** | **The correction LA (N1) was missing from the fence and the matrix.** §B step 16 SP-CREATEs the control row into the TARGET'S OWN LIST — direct-to-archive for an archived target (SR-135) — so **N1 is a ledger writer**. Step (5) deployed it without pinning it disabled, and step (6) enabled only push and the C2 archive LA. Two consequences: N1 live before N13 is transformed can write a control row into Live that the OLD pull LA (no `ControlId eq null` filter) delivers to devices as a **phantom stock movement**; and N1's direct-to-archive writes can advance the archive boundary, **disproving the MID-ENABLE justification that only the archive LA can advance it**. | N1 is **CREATED DISABLED** at step (5) and is now an observed fact in the matrix. Boundary-advancing writers = **{C2 archive LA, N1}**. Step (6b) enables BOTH, last; a crash with only one enabled resolves to POST-CUTOVER, whose first action is to ensure both are enabled. |
| **J3** | **Function rollback was invisible to phase authority.** Phase was decided from writer/transform state alone, which cannot see WHICH build the LAs call. After (6b) a rollback still resolved **POST**, so a rerun skipped deployment while the LAs talked to an incompatible build — reopening the mixed-canonical straddle and potentially losing compute/attestation ops. Quiescing only the FORWARD deploy was never sufficient. | Every `snapshotCompute` response carries a `buildStamp` (both compute and hash modes). The runner PINS the reviewed value; **POST + mismatched stamp ⇒ `FUNCTION_BUILD_MISMATCH`**, a specified recovery lane (quiesce the boundary-advancing writers + fence push → wait idle → forward-redeploy the reviewed build → re-enter (6a)/(6b)) — not "still POST", not a bare halt. **Any Function change, forward OR rollback, now obeys the (3a) quiesce-first discipline.** Belt: the archive LA compares the stamp from `Call_compute` against the one from `Verify_content_hash` — unequal ⇒ abort as `BUILD_STRADDLE` (transient, retryable), so a straddle can never present as a bogus fidelity failure on a faithful copy. |

**Gates:** correction **161/161** · archive-carry 28/28 · attest 58/58 · buyback-export 170/170 ·
topology 256/256 · access-policy 67/67 · smoke 277/277 · static + CSP PASS. Zero client files.

**Staging crash drill — REQUIRED CASES** (grown by this round, carried to the E2E): a run from the
VIRGIN state; a crash partway through (3a); a crash inside (6b) with only one of the two
boundary-advancing writers enabled; a Function rollback while writers are live.

## O. Review questions for ROUND 6

- **QO1:** Do J1-J3 close their findings without introducing a new defect?
- **QO2:** **Re-derive the matrix from scratch rather than checking my rows.** Enumerate the
  reachable states of {push, legacy archive, C2 archive, N1, transforms, buildStamp} that a
  legitimate prefix of §D can produce, and confirm each maps to exactly one row with a forward
  action — and that everything mapping to `INCONSISTENT` is genuinely unreachable legitimately.
- **QO3:** Is `{C2 archive LA, N1}` the COMPLETE set of boundary-advancing writers? Name any other
  writer, LA, or path that can create a row in the archive list or mint an above-epoch id.
- **QO4:** J3 makes phase depend on a self-reported `buildStamp`. Is a self-reported stamp adequate
  authority here, given the project's own principle of preferring non-forgeable ledger state over
  markers (C2-R19-1/C2-R24-1)? If not, what observable would be?
- **QO5:** Anything not closed, or newly noticed. Same artifact rule: verify against files that
  exist, and say so plainly when one does not.

---

## P. INTERIM LA REVIEW — ROUND 6 FOLD RECORD (`W-B2r6`)

**R6 verdicts: AGY PASS · Codex BLOCK×4** (the count went UP). All four REAL, all folded. Suite
161 → **164/164**. **Third consecutive round in which the findings were in MY OWN previous fold.**

**AGY's PASS was wrong on the two questions that mattered.** Asked to re-derive the matrix
independently (QO2), it produced a five-state derivation and pronounced the partition "mathematically
airtight" — while rows 1 and 2 of that very table overlap, which Codex demonstrated with the ordinary
post-(5) state. Asked whether a self-reported stamp is adequate authority (QO4), it answered YES on
the reasoning that "a legacy rollback build cannot emit `buildStamp: 'c2-b4'`" — true of a *pre-C2*
rollback, and irrelevant to the actual failure mode: a hand-maintained constant that nobody
remembered to bump. Both answers confirmed my work rather than testing it.

| # | Finding | Fold |
|---|---|---|
| **K1** | **The matrix was still not a disjoint partition** — the thing R5 explicitly claimed to fix. PRE-QUIESCENCE accepted `any/any/C2-off/N1-off/any`, of which PRE-CUTOVER was a strict SUBSET, so the ordinary post-(5) state matched BOTH rows and the runner had two competing actions ("repeat (3a)" vs "proceed (3b)→(5)"). The POST row was also column-shifted and never encoded the half-(6b) tuples. | Rebuilt as a **10-row disjoint partition** over EIGHT facts — the two missing PROGRESS facts (**valid seal?**, **reviewed build deployed?**) are what make the quiesced rows separable, and the half-(6b) tuples (C2-only, N1-only) are now explicit rows with their own forward actions. |
| **K2** | **The build-recovery lane deadlocked itself.** POST + mismatched build correctly begins recovery by disabling C2/N1 and fencing push — which moves the state OUT of POST while `cutoverCompletedAt` is still stamped. The R5 marker rule ("present in any phase other than POST ⇒ CONTRADICTION ⇒ HALT") then fired, and the runner halted permanently BEFORE forward-redeploying. My own recovery walked into my own contradiction rule. | New **REPAIR-QUIESCED** row (10), distinguished from the pre-cutover quiesced rows by `cutoverCompletedAt` being PRESENT — which is exactly the evidence that a legitimate cutover already happened. It verifies/forward-deploys the reviewed build and re-enters (6a)/(6b), and does NOT re-observe the boundary (that growth was legitimate). The marker stays a contradiction only where no legitimate prefix produces it. |
| **K3** | **`{C2 archive LA, N1}` is the complete PRODUCTION set but not the complete ENVIRONMENT set.** Also able to create archive rows: the legacy archive LA (before (3a)), **`audit-artifacts/diag-c1-insert.js`** (POSTs straight into the archive list), and **`audit-artifacts/probe-c1-archive-run.js`** (pre-flight archive insert + drives a temporary archive workflow). A crashed C1 probe after sealing leaves an above-epoch row with neither N17 provenance nor a valid control seal ⇒ the next sweep HALTS — while every writer-state fact looks untouched. | §D gains an **OPERATIONAL WRITER INVENTORY** naming all three paths, and a RULE: direct SharePoint/archive diagnostics and temporary archive workflows are PROHIBITED from (3a) onward; the runner verifies none are running before it fences; anything used in the window deletes its rows before the sweep. |
| **K4** | **A hand-maintained self-reported stamp is not adequate phase AUTHORITY.** `BUILD_STAMP = 'c2-b4'` shipped with a "remember to bump it" comment — so an incompatible build could carry the expected value — and it attests only what `snapshotCompute` reports, not which package Azure deployed (`correctionCompute`/`attestRows` could change beneath it). Also, §D claimed "every response carries `buildStamp`" while **five error returns omitted it**. | **AUTHORITY moved out-of-band**: the SHA-256 of the exact reviewed Function package, verified through Azure deployment/slot metadata and **bound into the signed epoch artifact** at seal time. The response stamp is demoted to the **per-call straddle BELT** — and is now **DERIVED** (a digest over the bytes of `attestRows.js` + `correctionCompute.js` + `snapshotCompute.js`), so any change to any of the three moves it automatically with nothing to remember; unreadable sources ⇒ `UNRESOLVED` ⇒ matches no pinned value ⇒ fails closed. It now rides **every** return, errors included. |

**Gates:** correction **164/164** · archive-carry 28/28 · attest 58/58 · buyback-export 170/170 ·
topology 256/256 · access-policy 67/67 · smoke 277/277 · static + CSP PASS. Zero client files.

**Staging crash drill — REQUIRED CASES** (grown again): virgin-state run · crash partway through
(3a) · crash inside (6b) with only one of the pair enabled · **post-cutover Function rollback driven
through REPAIR-QUIESCED back to POST** · **confirmation that no direct-write diagnostic is running
before the fence**.

## Q. Review questions for ROUND 7

- **QQ1:** Do K1-K4 close their findings without introducing a new defect?
- **QQ2:** **Re-derive the 10-row partition independently and prove DISJOINTNESS mechanically** —
  for every ordered pair of rows, name a fact whose value differs, or show they overlap. This has
  now been wrong twice; please do not check my rows, build your own and diff.
- **QQ3:** Is the partition COMPLETE over reachable states? Name any state a legitimate prefix of §D
  can produce that maps to no row, and any row that no legitimate prefix can produce.
- **QQ4:** K4 moves authority to an out-of-band package digest bound into the signed epoch artifact.
  Is that the right instrument, and is binding it at SEAL time correct given the build can change
  after the seal? Is the derived response digest sound as a straddle belt?
- **QQ5:** Anything not closed, or newly noticed. Same artifact rule.

---

## R. INTERIM LA REVIEW — ROUND 7 FOLD RECORD (`W-B2r7`)

**R7 verdicts: BOTH BLOCK.** AGY×1 + Codex×5 = **5 distinct, 1 CONVERGED** — all REAL, all folded.
Suite 164 → **169/169**. **First round AGY has blocked**, and it blocked on the right thing: asked
for a mechanical pairwise proof rather than an opinion, it derived its own table and found the
rows 1/2 overlap independently — the same defect Codex found. The pack rule change ("derive before
you compare; if you agree, say what you did to test it") produced a real finding on its first
outing. Codex confirmed K3 closed.

| # | Finding | Fold |
|---|---|---|
| **L1** | **[CONVERGED AGY-L1 ≡ Codex-1] Rows 1 and 2 STILL overlapped** — the exact defect R6 claimed to fix. Adding the `seal` fact separated rows 1-2 from 3-10 but left row 2 a strict SUBSET of row 1, so the ordinary post-(3a) state matched both: "repeat (3a)" and "deploy/seal". First-match-wins ⇒ the runner loops on (3a) forever; strict-partition ⇒ ambiguity halt. **My R6 fix addressed the symptom (missing facts) and not the cause: row 1 used wildcards that subsume its successor.** Codex additionally showed `cutoverCompletedAt` was declared one of eight facts but had NO COLUMN, so rows 3/10 and 4/10 were separated only by prose outside the table. | Row 1 carries an explicit **NOT-QUIESCED predicate** — `NOT(push fenced AND legacy off)` — which is mutually exclusive with row 2 by construction. `C` is now a real column. Both reviewers proposed the same fix. |
| **L2** | **Partial build-repair states mapped to NO row.** Repair is several non-atomic remote toggles but only its endpoints were represented: disable C2+N1 then crash before fencing push (push enabled, writers off, build not-reviewed, `C` present) matched nothing; fence push then crash before disabling the writers matched nothing either. | Repair collapsed into **ONE PREDICATE, ONE ENTRY POINT** (row 9), whose FIRST ACTION always idempotently re-asserts all three quiescence operations regardless of which are already done — so every partial-repair crash state is inside the row by construction rather than needing its own row. |
| **L3** | **The package digest was NOT actually bound into `epoch-v1`.** §D claimed it was "bound into the signed epoch artifact", but the canonical is `['epochId','tombstoneCommitEpochId','archiveC2EpochId','recordedAt']` — attestRows ignores fields outside a frame's list, so a runner could pass `cutoverPackageDigest` for signing, have it stored, and it could later CHANGE while the original EpochSig kept verifying. | `cutoverPackageDigest` added to the `epoch-v1` field list, to the N16 schema (§A), and to the tamper probes. |
| **L4** | **A one-shot epoch cannot be the permanent current-build authority.** The epoch is create-once and reused byte-for-byte, so once a later legitimately-reviewed package deploys (e.g. a `correctionCompute` fix with no archive-compatibility change), Azure reports B2 while the immutable epoch demands B1 — forever. The runner must misclassify B2 as a rollback, redeploy an obsolete build, or halt. **No approved-build advancement lane existed.** | THREE artifacts, three jobs, no longer conflated: **current authority** = new signed, UPDATEABLE `approved_build` record (**N19**, new frame `buildrec-v1`, MONOTONIC `revision` so an old record cannot be replayed over a newer one); **historical evidence** = `cutoverPackageDigest` frozen in the one-shot epoch; **per-call belt** = the response stamp. The matrix's `build` fact now means "live Azure package digest == the digest in the current signed `approved_build`". |
| **L5** | **The derived response digest did not fail closed.** An unreadable-sources failure returned the single literal `c2-UNRESOLVED`, so two instances that BOTH failed compared EQUAL and the straddle belt detected nothing. The digest was also truncated to 64 bits for no reason. | Full SHA-256; the failure value is now distinguishable; and the normative rule is **REJECT BEFORE COMPARING** — consumers must reject any stamp not matching `^c2-[0-9a-f]{64}$` before any equality test, so a malformed/unresolved stamp is a fail-closed abort, never an equality input. |

**Gates:** correction **169/169** · attest 58/58 · archive-carry 28/28 · buyback-export 170/170 ·
topology 256/256 · access-policy 67/67 · smoke 277/277 · static + CSP PASS. Zero client files.
(One probe of my own needed updating: the R6 stamp probe pinned the truncated 16-hex format.)

**Staging crash drill — REQUIRED CASES** (grown again): virgin-state run · crash partway through
(3a) · crash inside (6b) with one of the pair enabled · post-cutover Function rollback driven
through REPAIR back to POST · **a crash at EACH of the three repair toggles** · **an
`approved_build` revision advance, and a replay of an older revision (must be rejected)** ·
confirmation that no direct-write diagnostic is running before the fence.

## S. Review questions for ROUND 8

- **QS1:** Do L1-L5 close their findings without introducing a new defect?
- **QS2:** **Pairwise disjointness again, mechanically, on the corrected 9-row table** — for every
  ordered pair name a separating fact or show the overlap. Rows 1/2 have now been wrong TWICE; the
  fix is a negated predicate rather than a value list, so check it as such.
- **QS3:** Completeness: name any state a legitimate prefix can reach that maps to no row — with
  particular attention to row 9, which now claims to absorb every partial-repair state.
- **QS4:** The three build artifacts (N19 current authority · epoch historical evidence · response
  belt). Are the boundaries right, is `buildrec-v1`'s monotonic revision sufficient against replay,
  and does anything still treat the epoch digest as current?
- **QS5:** Anything not closed, or newly noticed. Same artifact rule.

---

## T. INTERIM LA REVIEW — ROUND 8 FOLD RECORD (`W-B2r8`)

**R8 verdicts: BOTH BLOCK.** AGY×1 + Codex×4 = **4 distinct, 1 CONVERGED** — all REAL, all folded.
Suite 169 → **171/171**. **DISJOINTNESS IS NOW PROVEN by both reviewers independently** (AGY 36
pairs, Codex 72 ordered pairs, both mechanical, both PASS) — L1 is closed and the rows-1/2 defect
that survived two rounds is dead. **The block moved from overlap to COMPLETENESS**, which is
progress of a specific kind: the table is now well-formed, and what remains is which states it
forgets. Codex confirmed L3 and L5 closed.

| # | Finding | Fold |
|---|---|---|
| **M1** | **[CONVERGED AGY-M1 ≡ Codex-1] The repair row stopped owning repair the moment its own deploy succeeded.** Row 9 required `build = not reviewed`, but its action forward-deploys the reviewed build — which flips `build` to reviewed BEFORE any writer is restored. State: writers all down, build reviewed, `C` present ⇒ matched NO row ⇒ INCONSISTENT ⇒ **permanent halt immediately after successfully deploying the correct package**, production stranded fully quiesced. | Root-caused rather than patched — see below. `C` becomes a PRE-ENABLE LATCH, and the post-deploy state falls into the new HANDOVER row whose entire job is to finish the enable. |
| **M2** | **[Codex-2] The first cutover had an unmapped both-enabled/pre-stamp state.** Enabling the second boundary writer and writing `cutoverCompletedAt` were separate remote mutations; if the stamp write timed out, every POST fact held except `C`. Rows 5-7 needed a writer off, row 8 needed `C` present ⇒ INCONSISTENT on an ORDINARY prefix of (6b). | Same root fix: **the stamp is now written BEFORE either boundary writer is enabled** (6b-i stamp → 6b-ii C2 → 6b-iii N1), so this interruption cannot occur; the equivalent state (stamped, writers not yet up) is HANDOVER. |
| **M3** | **[Codex-3] A monotonic revision inside an OVERWRITEABLE SINGLETON is not replay-safe.** The signature covers the revision, so an old record's revision cannot be EDITED — but restoring the COMPLETE, still-valid revision-1 tuple AND its signature over revision 2 verifies perfectly. With the singleton overwritten there is no retained high-water to reject it ⇒ an obsolete package becomes "current" and the runner would quiesce production to redeploy it. **Codex also caught that my "replay" probe was not one** — it edited a revision while keeping the old signature, which is ordinary tamper detection. | N19 stops being an AppConfig singleton and becomes the **APPEND-ONLY `BuildApprovals_Staging` list** (Enforce-Unique `Revision`), authority = highest revision with a verifying signature, plus a **retained high-water outside the log** (the runner refuses any selection below the highest revision it has ever observed). The P-13 residual — a SharePoint-direct actor DELETING the newest rows — is stated honestly, caught by the high-water on the next pass, and banked for server enforcement rather than claimed closed. Probes corrected: one now demonstrates that whole-record replay VERIFIES (signatures cannot stop it), the other models the structural defence. |
| **M4** | **[Codex-4] The N19 bootstrap was missing entirely — a virgin-run DEADLOCK.** The `build` fact is defined as "live digest == the digest in the current signed approval", so with no approval record it can never be true; a virgin run would reach row 4 and redeploy the same package forever. It also cannot be signed before (3b), since `buildrec-v1` is not live until that deploy. | New numbered action **(3c)**, after (3b) and before the seal: read the live package digest from Azure metadata → sign the complete tuple at revision 1 → create-if-absent (Enforce-Unique makes a double-run a 409) → read back → verify signature AND digest-equals-live. Rerun handling pinned: verifying+matching ⇒ reuse; verifying but digest differs ⇒ advance to revision 2 (never edit revision 1); not verifying ⇒ HALT. |

**THE ROOT FIX (M1+M2).** Both completeness failures had ONE cause: `cutoverCompletedAt` was stamped
AFTER the boundary writers went live, so writer-state and marker always disagreed for a window, and
I kept adding rows to cover the symptoms. Stamping it FIRST makes it a monotonic latch with an exact
meaning — **`C` absent ⇒ no boundary writer has EVER been enabled ⇒ the sealed boundary is exact;
`C` present ⇒ never re-observe** — which makes "a writer on while `C` is absent" genuinely
unreachable, collapses every partial-enable and post-repair-deploy state into ONE row, and takes the
table from 9 rows to 8. Also fixed: stale commentary in `snapshotCompute.js` still describing
authority as bound into the epoch (Codex's note).

**Gates:** correction **171/171** · attest 58/58 · archive-carry 28/28 · buyback-export 170/170 ·
topology 256/256 · access-policy 67/67 · smoke 277/277 · static + CSP PASS. Zero client files.
(Codex noted its own 90s timeout on `smoke-test.js` and correctly declined to count it either way;
it runs to completion locally.)

## U. Review questions for ROUND 9

- **QU1:** Do M1-M4 close their findings without introducing a new defect?
- **QU2:** **Completeness again, mechanically, on the 8-row table.** Disjointness is proven; this is
  now the only open structural question. Walk every legitimate prefix INCLUDING a crash between each
  of (6b-i)/(6b-ii)/(6b-iii) and each of the three repair toggles, and name any state that maps to
  no row — or any row no legitimate prefix reaches.
- **QU3:** **Attack the latch premise directly.** The whole fix rests on "`C` absent ⇒ no
  boundary-advancing writer has ever been enabled". Is that invariant actually guaranteed by the
  pinned order, and is there any path — a manual enable, a failed stamp write that partially
  succeeded, an LA enabled outside the runner — that breaks it?
- **QU4:** Is the append-only N19 + highest-valid + retained high-water sufficient, and is the
  bootstrap (3c) correct and re-runnable? Is the stated P-13 residual the right boundary to accept?
- **QU5:** Anything not closed, or newly noticed. Same artifact rule.
