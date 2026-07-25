# OS-W4.4 Contract 2 — CONCRETE STAGING ARTIFACTS (LA definitions + apply inventory)

**Status: 🔍 W-B2 INTERIM LA REVIEW (Kunal chose cadence option 2: one paper review of these
definitions by BOTH reviewers BEFORE the Kunal-executed staging apply; the full build audit vs the
DEPLOYED system follows the E2E per §15).** Parent: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` (SPEC
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
| `ArchiveRunRecords_Staging` (N17) | `RunId` Text **Enforce-Unique + indexed**; `SnapshotVersion` Number; `InputDigest` Text; `TombstoneIds`, `ArchiveMemberSourceIds` Note(JSON arrays); `Published` Text ('true'/''); `PublishedSig`, `RecordSig` Text |
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
12. `Mode_gate`: SP GET the registry item for the target (AFTER acquire) + the BELT query (both
    ledger lists for existing tombstones/controls on the target). Mode legality per §4/§5b:
    create ⇒ no item (unregistered existing tombstone ⇒ LAZY ADOPTION: CREATE committed
    device-adopted, conflict ⇒ re-read); supersede/withdraw ⇒ committed + `expected` CAS
    (explicit-null baseline for the withdrawn form, C2-R6-2); committed-UNADOPTED (empty
    PublicationVersion) ⇒ `TOMBSTONE_PENDING_ADOPTION`; retire_claim ⇒ the C2-R5 gate (evidence:
    seal-fails+pre-epoch, or the ABSENT-ROW enumeration under the N18→L→A→Q contract, C2-R9-2).

**P4 — compute (ALL decisions via `correctionCompute`):**
13. op:`targetLine` (real foldProjection authority; `TARGET_PRE_EPOCH`/`ROW_NOT_IN_TRANSFER_LEDGER`
    refusals) → op:`stamps` (replacement modes; `STAMPS_UNRESOLVABLE` ⇒ rollback-release+Response)
    → op:`membership` (adopt/retire: SP GET the target's ArchiveRunRecords row + attestRows
    runrec-v1 verify feed the input) → op:`delta` (`*_DELTA_UNDECIDABLE` ⇒ rollback-release) →
    op:`candidate` (heads + AdoptionDecisions + ids; `NO_PENDING_ADOPTIONS` ⇒ terminal no-op
    Response BEFORE any write, C2-R3-5). Deterministic-id collision check: SP GET both lists for
    `corr:`/`ctl:` ids.

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
17. `Verify`: SP re-read the candidate row field-for-field + op:`rowsEqual`-style compare +
    ctl-v1 verify; re-enumerate steps → op:`stepSetDigest` compare (`STEPS_CHANGED_RETRY` ⇒
    rollback); registry/journal coherence re-read. Any failure ⇒ FULL ROLLBACK (delete candidate,
    release/restore reservation per mode, journal `rolled_back`, conditional release) + Response.
    retire_claim additionally: P5 MERGE the tombstone row `ControlState='retiring'` (REVERSIBLE —
    rollback restores; the N13 filter stops delivering it, C2-R6-1a).

**P6 — THE PUBLISH (irrevocable):**
18. `Final_restamp` (§3a) → `Publish`: ONE SP MERGE of `stock_snapshot.ConfigData` =
    captured-content + `version: CandidateVersion` + balances adjusted per op:`delta` + `fence`
    UNCHANGED + `controlManifest: {version: CandidateVersion, controlHeads: <full new map>}` with
    **`IF-MATCH: <the P2-captured ETag>`** — never a re-read ETag (C2-R1-1).
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
C2-R6-3) with the SELECT/copy/re-read/fidelity canonical carrying the FULL N7 control form + typed
values (C2-R6-4/C2-R7-5); the TOMBSTONE AUTHORITY GATE allowlist pre-compute (C2-R7-4/C2-R8-3);
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

Steps (C1 runner pattern — temp passthru LA, prints no secrets): (1) lists+columns per §A
(create-if-missing; Enforce-Unique via field XML `EnforceUniqueValues="TRUE" Indexed="TRUE"`);
(2) `archive_state` v2 TRANSFORM (preserve content, add v:2 fields); (3) the QUIESCENT CUTOVER
(C2-R18-3/C2-R19-3/C2-R20-4): disable the archive LA + FENCE push (disable push LA for the bounded
interval) → wait idle → complete any published legacy run's Live-delete by its exact set →
SourceId residue cleanup (legacy AUTH BYPASS documented, C2-R22-1) → seal
`{epochId, tombstoneCommitEpochId, archiveC2EpochId}` + EpochSig → re-enable; (4) deploy the N1
LA from the reviewed definition + transform N9/N10/N13 per §C; (5) redeploy the Function App
(correctionCompute + attestRows frames + validateUser 'correction'); (6) PROBES on the real cloud
(sign/verify each new frame; a correction dry-run against a probe row; the sweep in report-only
mode first); (7) cleanup (probe rows deleted, temp LA deleted). PRODUCTION-cutover variant:
VERIFIES the archive list is EMPTY before sealing (C2-R23-N1) — else HALT + Kunal decision.

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
