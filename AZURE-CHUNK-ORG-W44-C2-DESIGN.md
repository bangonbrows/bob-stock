# OS-W4.4 Contract 2 — Director correction-approval route: CONCRETE DESIGN

**Status: 🔍 SCOPE REVIEW R24 (R23 verdicts: BOTH BLOCK — ONE converged finding each (the SAME
one); Q2v23 [legacy bypass] + Q3v23 [normative global idempotency] PASS BOTH; Codex: "no other
high-confidence Contract-2 defect found". THE LAST FINDING: the full-set `ArchiveMembersHash`
equality treats a legitimate MID-COPY crash's partial set as tampering ⇒ permanent HALT-brick.
Fold: N17 stores the SIGNED EXACT MEMBER LIST `ArchiveMemberSourceIds` (RecordSig-covered, written
before copy) — a PUBLISHED run verifies FULL-SET equality against it; an UNPUBLISHED (crashed) run's
partial residue verifies PER-MEMBER (each queried row's SourceId ∈ the signed list ⇒ authenticated
residue ⇒ cleaned by in-Live; ∉ the list ⇒ tamper ⇒ HALT) — authenticated subsets, exactly Codex's
required correction, subsuming AGY's bypass with per-member authentication intact. Codex's
deployment reservation (enforce the fresh-production premise) added to the N16 cutover acceptance.
R22: 2 folded. R21-R1: 106 folded. Nothing built, nothing deployed. D-C2-1..3 LOCKED — §12).**
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

## R2 fold record (2026-07-23) — 10 REAL findings folded, 1 note folded, 1 note refuted

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R2-1 | A stalled RECOVERER has no takeover path — `correction_recovering` was seizable by nobody; recoverer crash ⇒ corrections/archives/exports blocked permanently (Codex 1) | REAL — §3a's only seize rule started from stale `correction_active` | §3a: stale `correction_recovering` (heartbeat past T-1) is seizable by a NEW recoverer (CAS `recovering → recovering(new recoverer, fresh heartbeat)`); recovery is re-entrant by construction (decision-by-read; the fence bump is content-preserving and repeatable). PLUS the pinned INVARIANT: **every non-idle state has a staleness exit** (run_active: Chunk-8 lock staleness; export_lease: ttlAt; correction_active: seize; correction_recovering: re-seize) |
| C2-R2-2 | The ctl-v1 seal omits engine-read replacement fields — `TransferId` (HO-source decision, isHOSupply buybackExport.js:180 reached from :659 for control rows) and `UnitPriceAtTime` (retail profit, :649) are unsealed; a SharePoint-direct edit changes billing/profit under a valid seal (Codex 2) | REAL — both reads confirmed in the frozen engine; control rows face isHOSupply "on their own carried fields" (:657-659) | §7a: the replacement-output covered set is now the FULL ENGINE ROW FORM (adds `TransferId`, `UnitPriceAtTime`, `IdempotencyKey`), plus the CLASS rule: the covered set is DERIVED from the engine's row-form field enumeration (buybackExport.js header contract) — any engine-read field is covered by construction, never hand-picked. Sealing an ABSENT field ('' canonical) is what prevents its later addition |
| C2-R2-3 | An adopted device tombstone can never satisfy §7b(5)'s blanket ctl-v1 verification — it carries a row-v1 seal minted at push, and could not have signed adoption-time fields (revision, born) that didn't exist yet; legitimate deletions refused forever (Codex 3) | REAL — §8 pipes tombstones through the NORMAL attest pipeline (row v1); §7b(5) demanded ctl-v1 on every control | §7b(5) split BY ORIGIN: Director control rows ⇒ ctl-v1 seal; synthesized device-tombstone controls ⇒ the tombstone ROW's C1 v1 seal (covers Type + TargetTransactionId — the deletion's whole economic content); adoption-time fields (revision 0, born) come from the server-owned manifest HEAD, which IS their authority — no row seal can or need attest them |
| C2-R2-4 | A device claim `pending` whose tombstone row IS durable is never promoted — the TTL scrub only handles "no ledger row"; route crash between insert and commit CAS + device offline ⇒ target locked forever, tombstone never adoptable (Codex 4a ≡ AGY 3, CONVERGED) | REAL — §6/§8 defined delete-only scrubbing | §6/§8: the reconcile scrub gains ROLL-FORWARD: registry pending past TTL WITH a durable ledger row ⇒ execute the `pending → committed` CAS itself (idempotent — same transition the route would have made) |
| C2-R2-5 | An EXPIRED device claim's writer can resume: scrub deletes the pending (no row yet) → a correction claims the target → the old worker resumes and inserts its tombstone with NO ownership re-check ⇒ two control decisions on one target (Codex 4b) | REAL — §8 had no pre-insert fence | §8: (i) IMMEDIATELY before attest+insert the route re-reads the registry item and re-asserts it is still THIS tombstone's own live pending claim (absent/foreign/expired ⇒ quarantine divert, never insert); (ii) if the post-insert `pending → committed` CAS fails on a FOREIGN state, the route COMPENSATES: the just-inserted row is moved to Quarantine (it was never acked) + surfaced; (iii) reconcile belt: a durable tombstone row whose target's registry item is committed to a DIFFERENT ControlId ⇒ quarantine the row (it lost the race) |
| C2-R2-6 | The registry's committed-phase schema breaks the device lanes: §4 drops `OpId` at committed (so §8's own-claim retry match `OpId == tombstoneId` fails ⇒ valid retries quarantined — AGY 4) and adoption never writes the committed item's `PublicationVersion` (so a later supersede/withdraw expected-gate reads a stale/absent version and permanently rejects — Codex 5) | REAL — one schema family, two members; §4's phase table governed and contradicted §8 | §4: device-origin committed items RETAIN `OpId` (= ControlId = tombstone id) and are written `committed(ControlId, Revision: 0, PublicationVersion: null)` — null = "committed, not yet adopted". §5b: adoption's P7 CAS-rolls each adopted target's registry `PublicationVersion` to the publication version (idempotent; recovery's roll-forward re-runs it). §8: the own-claim match is `OpId == tombstoneId OR ControlId == tombstoneId` (belt). Mode gate: supersede/withdraw against a committed-UNADOPTED tombstone (PublicationVersion null) ⇒ refuse `TOMBSTONE_PENDING_ADOPTION` (remedy: adopt, retry against the then-known head) — mirrors the export's fail-closed posture |
| C2-R2-7 | Recovery's manifest-content decision is undefined for adopt (MULTIPLE heads, no single CandidateHead) and ambiguous for withdraw (explicit-null head vs absent property) — a successful adoption gets parked `INVARIANT_BROKEN` (Codex 6) | REAL — P4/P5.1 stored ONE object-shaped head; §6 tested "exact match" | The journal stores the CANDIDATE HEAD-SET: `CandidateHeads = {target: head-or-null, ...}` — EXACTLY the entries this publication writes/changes (create/supersede: one; withdraw: one explicit null; adopt: one per folded tombstone; opportunistic adoptions ride the same map). §6 decision per-entry with hasOwnProperty semantics (the engine's own test, buybackExport.js:517): ALL entries present with deep-equal values (explicit null matches explicit null) ⇒ roll FORWARD; NONE present AND version < CandidateVersion ⇒ roll back; anything else (partial = impossible under the single-MERGE publish; version ≥ candidate with entries absent) ⇒ `INVARIANT_BROKEN` |
| C2-R2-8 | §6 claimed `needs_manual` blocks archives/exports "for this store" — but the coordination record and the N10 archive-refusal guard are GLOBAL; the store-scoped blast-radius claim was false (Codex 7) | REAL — one tenant-wide coordination record + one snapshot; the wording promised a scoping that doesn't exist | §6 wording corrected to the honest truth: a `needs_manual` journal refuses archives and exports GLOBALLY until a Director resolves it. Deliberate: `INVARIANT_BROKEN` means a snapshot writer violated the coordination discipline — a LOUD full stop is the correct posture, and the state is unreachable while N10/N15 hold. Kunal-visible honest note H9 |
| C2-R2-9 | Journal leak on a P5.1 crash: the state's `journalId` is only stamped at the post-create boundary re-stamp; crash in between ⇒ the recoverer sees no journalId, releases to idle, and the created journal is orphaned `pending` forever ⇒ N10 blocks archives permanently (AGY 1) | REAL — the journal's SharePoint item id cannot exist in the state before the journal is created; the no-journal seize rule keyed on exactly that id | §3a/§5 P2: acquire stamps `opId` + `owner` INTO the state at the P2 CAS (opId is client-minted and known pre-journal). The no-journal seize rule now queries `CorrectionJournal_Staging` by **OpId** (Enforce-Unique): found ⇒ a journal exists, recover it via §6; genuinely absent ⇒ scrub any reservation naming that OpId ⇒ release to idle. `journalId` in the state becomes a fast-path hint only — never the decision key |
| C2-R2-10 | The P4 delta formula `− effect(target) + effect(replacement)` is WRONG for supersede — the target's effect was already backed out by the first correction; applying it again corrupts balances permanently (worked example: +10 target, replaced +8, superseded +5 ⇒ spec formula yields 93, truth is 95) (AGY 2) | REAL — P4 defined create/deletion/withdraw and left supersede to a formula that double-counts | §5 P4: the general law is pinned — **delta = effect(new effective output) − effect(previous effective output)**, where a target not yet corrected has previous-effective = the target row itself and a deletion's output = nothing. Full mode table: create-replace `− effect(target) + effect(new)`; create-delete `− effect(target)`; supersede replace→replace `− effect(prevOutput) + effect(new)`; supersede replace→delete `− effect(prevOutput)`; supersede delete→replace `+ effect(new)`; withdraw `− effect(prevEffective) + effect(originalTarget)` (unchanged). `prevOutput` is read from the `PriorCommitted` head's control row, seal-verified |
| C2-R2-N1 | Export route between P5.3 and P6 would see candidate rows with ControlId but no manifest head ⇒ transient `TOMBSTONE_PENDING_ADOPTION` alerts every correction (AGY Note A) | **REFUTED** — §3 mutual exclusion: the export runs only under `export_lease`, acquirable only from `idle`; while a correction holds `correction_active`/`correction_recovering` no export can start, so no export ever reads a candidate row (rollback deletes candidates; a crashed correction HOLDS the state until reconcile drives it terminal). Adjudication recorded; spec sentence added in §7b so the reasoning is explicit — a spec change to the exclusion rules reopens this | — |
| C2-R2-N2 | `attestRows op:'verify'` returns booleans only — the route cannot distinguish "seal broken" from "never sealed"; worse, DELETING a stored EconSig would demote a sealed row into the softer unsealed lane (AGY Note B) | REAL as a spec-precision gap (verifyRow: absent sig ⇒ same `ok:false` as tampered) | §5 P3.2 pins the THREE-WAY caller-side contract: EconSig present + verify ok ⇒ sealed-valid; present + verify fail ⇒ `TARGET_SEAL_BROKEN`; ABSENT ⇒ unsealed lane **unless the row's provenance id (live `_spId` / archived `SourceId`) postdates the C1 seal epoch — post-C1 ingest ALWAYS seals, so a missing seal there is itself tampering ⇒ `TARGET_SEAL_BROKEN`** (the seal-strip attack closed; mirrors the C1 sealed-pre-epoch contradiction rule) |

**Q1v2-Q6v2 outcomes:** Q1v2 exposed the recoverer-stall gap (→ C2-R2-1); Q2v2 NO — two engine-read
fields missing (→ C2-R2-2; route-side interim enforcement accepted by both); Q3v2 exposed the seal
contract contradiction (→ C2-R2-3); Q4v2 exposed the promotion gap + the resumed-writer race + the
retry-match break (→ C2-R2-4/-5/-6); Q5v2 mapped correctly EXCEPT adopted/durable-pending tombstones
(→ C2-R2-3/-4/-6); Q6v2 sound for one non-null head only (→ C2-R2-7) and the store-scoped claim was
false (→ C2-R2-8).

---

## R3 fold record (2026-07-23) — AGY PASS · Codex BLOCK×5, all REAL, all folded

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R3-1 | Adopted heads named `born` but the frozen engine compares `head.bornPublicationVersion` (buybackExport.js:519, SR-151) — every adopted tombstone would refuse `CONTROL_HEAD_MISMATCH` (Codex 1) | REAL — engine field name confirmed at :517-519 | THE CANONICAL HEAD SHAPE is pinned ONCE: `{controlId, revision, bornPublicationVersion}` — every head everywhere (Director, adopted, CandidateHeads journal entries, §5b/§7b/§4) uses EXACTLY the engine's field names; a shape-parity probe in N12 asserts the published manifest heads satisfy the engine's own comparison verbatim |
| C2-R3-2 | The §8 pre-insert fence is check-then-act across two lists — a claim can be TTL-scrubbed + the target correction-claimed between the check and the insert; the losing tombstone then lands PULL-VISIBLE and peer devices durably delete the original (sync.js:2099) before compensation runs; a related crash leaves a durable row with NO registry item (Codex 2) | REAL — no cross-list atomicity exists; pull applies every visible `deleted` row as a durable removal | STAGED VISIBILITY (§8 v3): device tombstone rows are inserted with `ControlState='pending'` — INVISIBLE to devices (the N13 pull filter excludes pending) and fail-closed for exports (§7b(4) v2 below). The registry `pending → committed` CAS is the COMMIT POINT; only then does the route MERGE the row `ControlState='committed'` (visible). Foreign CAS ⇒ the never-visible row moves to Quarantine — nothing to un-deliver, the R3-repro's peer-device deletion cannot happen. Crash between CAS and the visibility MERGE ⇒ the two-way scrub completes the MERGE (roll-forward, idempotent). Durable row with NO registry item (scrub-then-insert crash) ⇒ reconcile REGISTERS it (target unclaimed: run the claim lifecycle to committed) or QUARANTINES it (target foreign-committed). The pre-insert fence also RE-STAMPS TtlAt (narrows the window; the staged visibility is what CLOSES it) |
| C2-R3-3 | Adoption's unconditional "zero balance delta" is arithmetically wrong for an ARCHIVED target whose effect is baked into `stock_snapshot.balances` (snapshotCompute.js:87-89 residual: a tombstone landing AFTER its target's archive run cannot retroactively adjust) — settlement excludes the target but device stock counts stay overstated, and supersede/withdraw chains compound the error (Codex 3) | REAL — the design already distinguished live/archived for Director modes (P4 "live-target corrections adjust NO balances") but pinned adoption at zero unconditionally | ADOPTION DELTA BY SNAPSHOT-REPRESENTATION (§5b): per adopted tombstone, query both lists for the target — LIVE target ⇒ delta 0 (it was never in balances); ARCHIVED target ⇒ the deciding question is whether the tombstone was in that archive run's input (if so, snapshotCompute already excluded the target). Decidable via a NEW ARCHIVE-RUN INPUT-HORIZON marker (N10 v2: each archive run records the max live-list item id of its input universe; tombstone `_spId` ≤ horizon(target's ArchiveRunId) ⇒ already excluded ⇒ delta 0; > horizon ⇒ target in balances ⇒ delta `− effect(target)`); runs predating the marker ⇒ `ADOPTION_DELTA_UNDECIDABLE` fail-closed manual lane (D-C2-2: trial-data wipe makes the legacy case vanish at go-live). The determination is RECORDED on the registry item (`TargetInSnapshot`, §4) at first publication; every later chain cell (supersede/withdraw of an adopted deletion) consults the RECORDED flag — history is decided once, never re-derived. Director create modes need NO flag: reaching create proves no tombstone existed, so an archived target is always in balances (the existing `− effect(target)` is unconditionally correct) |
| C2-R3-4 | The three-way seal rule referenced "the C1 seal epoch" — no artifact, column, or derivation defines it; the seal-strip closure was unenforceable as written (Codex 4) | REAL — engineer's R2 fold named a boundary that didn't exist | THE SEAL-EPOCH ARTIFACT (N16): ONE `AppConfig_Staging` item `ConfigType='seal_epoch'`, `{validateEpochId, archiveEpochId, recordedAt}` — the first-sealed item id per ledger list, written ONCE by the C1 apply runner (Director-gated; the C1 staging apply already happened, so the runner backfills it from the staging ledger's recorded ids), IMMUTABLE thereafter (the route treats any rewrite as tampering: fail closed). P3.2 v2: unsealed target + provenance id ≥ the list's epoch ⇒ `TARGET_SEAL_BROKEN`; unsealed + provenance < epoch ⇒ the legitimate pre-C1 lane; epoch item ABSENT ⇒ `EPOCH_UNDEFINED` — corrections on UNSEALED targets refuse until the artifact exists (sealed targets unaffected). Mirrors the engine's `coverage.stepsEpochId` precedent (buybackExport.js:738) |
| C2-R3-5 | An EMPTY `CandidateHeads` map makes recovery's first arm vacuously true — a zero-eligible adopt journal that crashes pre-P6 rolls FORWARD to a `complete` journal at CandidateVersion V+1 while the snapshot sits at V (Codex 5) | REAL — classic empty-set logic hole; "all discovered tombstones seal-skipped" reaches it too | ZERO ELIGIBLE HEADS = TERMINAL NO-OP BEFORE ANY WRITE (§5b): adopt (explicit or opportunistic fold contributing zero) with no eligible tombstones returns `ok: NO_PENDING_ADOPTIONS` (+ the surfaced skip list) — NO journal, NO reservation, NO publication, state released. A journal with empty `CandidateHeads` is INVALID BY CONSTRUCTION (P5.1 refuses to create one); recovery encountering one ⇒ `INVARIANT_BROKEN` (loud — it proves an out-of-protocol writer) |
| C2-R3-N1 | Pre-C1 unsealed tombstones are permanently seal-skipped by adoption ⇒ their headless rows would trip the export blocker forever (Codex Q5v3 note) | REAL residual under the R2 wording | §7b(4) v2 SCOPING: the fail-closed blocker is a durable tombstone/control row lacking a head **whose TARGET has no active head** — once the target is adjudicated by ANY active control (e.g. the Director remedy: a create-delete correction on the same target), the stale headless row is COVERED and stops blocking. Plus the widening from C2-R3-2: the blocker now catches ANY durable headless tombstone (registry-committed or not — a pending/unregistered one is exactly a deletion question not yet adjudicated) |
| C2-R3-N2 | N10 must carry the PARENT archive-run staleness rule into the build, not just the correction states' (Codex Q1v3 note) | Fair build-checklist pin | N10 line amended: the staleness-exit invariant (§3) is an N10 ACCEPTANCE ITEM — all five states' takeover rules proven at the staging E2E crash drill |

**Q1v3-Q7v3 outcomes:** Q1v3 YES both reviewers (seize/re-seize chain safe; → C2-R3-N2 build pin);
Q2v3 YES both (covered-set derivation complete; ignored-field sealing harmless); Q3v3 YES-with-fix
(per-origin split sound; → C2-R3-1 field name); Q4v3 NO (→ C2-R3-2 staged visibility); Q5v3 NO
(→ C2-R3-2 unmodelled state + C2-R3-N1); Q6v3 correct for non-empty sets (→ C2-R3-5); Q7v3 Director
cells correct, adoption chains broken (→ C2-R3-3). **R2 Note-A adjudication ACCEPTED by BOTH
reviewers independently — closed.**

---

## R4 fold record (2026-07-24) — BOTH BLOCK; 8 distinct REAL (2 converged pairs) + 1 engineer find

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R4-1 | The R3 snapshot-representation qualifier DROPPED the withdraw restore term when `TargetInSnapshot=false` — withdrawing an adopted deletion left the re-activated target's effect permanently out of balances (repro: +10 excluded at archive, adopt delta 0, withdraw delta 0, truth +10) (AGY 1) | REAL — the qualifier as written gated EVERY term by current representation, but withdraw must reflect the POST-operation representation | **THE NORMALIZATION LAW (§5 P4 v3):** the in-snapshot decision gates ONLY the FIRST publication on an archived ensemble (whether the target's effect needs backing out: in-snapshot ⇒ `− effect(target)` applies; already-excluded ⇒ that term is 0). The first publication NORMALIZES the ensemble — its represented value now equals its effective value — and EVERY subsequent chain cell applies the plain six-cell table UNGATED (each cell = E_new − E_old by construction; AGY's repro now yields withdraw +10 in both branches). Live-target ensembles stay fully suppressed as before. Proof obligation in N12: induction over all first-publication modes × subsequent chains |
| C2-R4-2 | The adoption-horizon comparison used the tombstone's CURRENT-list `_spId` — an archived tombstone's archive-list id is a different coordinate from the live-list horizon; comparison is apples-to-oranges ⇒ double-subtraction (AGY 2 ≡ Codex 3, CONVERGED) | REAL — the archive LA preserves the live id as `SourceId`; only that is comparable | §5b: the horizon comparison uses the tombstone's **LIVE-LIST provenance id** — live row ⇒ `_spId`, archived row ⇒ `SourceId` (absent ⇒ `ADOPTION_DELTA_UNDECIDABLE`); the same provenance-coordinate rule P3.2 already uses, now stated everywhere an id is compared to a live-list boundary |
| C2-R4-3 | The seal-epoch check compared an archived row's `SourceId` (a LIVE-list id) against `archiveEpochId` (an archive-list id) — legitimate pre-C1 rows falsely bricked, or stripped post-C1 rows waved through, depending on relative counters (AGY 3 ≡ Codex 5, CONVERGED) | REAL — same coordinate-mixing class as C2-R4-2 | N16 v2: ONE epoch — `epochId` = the LIVE list's first-sealed item id. ALL seal-epoch comparisons use live-coordinate provenance (`_spId` live / `SourceId` archived) against `epochId`. `archiveEpochId` is DELETED (no archive-coordinate provenance exists anywhere in the design) |
| C2-R4-4 | The §8 own-committed retry answered via "the normal dedup path" WITHOUT completing the visibility MERGE — a crash between the commit CAS and the MERGE plus a retry leaves a legitimate committed tombstone invisible until some future scrub happens to run (Codex 1) | REAL — the retry path short-circuited before the MERGE | §8: own-claim-already-committed re-entry MUST verify the ledger row exists AND `ControlState='committed'` — completing the visibility MERGE (and CommitSig mint, C2-R4-5) itself — BEFORE answering success. The scrub remains the belt; the retry is the primary healer |
| C2-R4-5 | `ControlState` — the device-visibility authority — is an unsealed mutable column: a SharePoint-direct edit flips `pending→committed` and N13 delivers a never-committed/losing tombstone to devices, which durably delete the target (Codex 2) | REAL — neither the C1 row seal nor ctl-v1 covers it (and adding it to the C1 frame would break every existing seal) | COMMIT SEALS (§8/N13): at the commit point the route mints a `ctlcommit-v1` seal via attestRows (N11) over `{TransactionId, TargetTransactionId, 'committed'}`, stored in a new `CommitSig` column (N7). The N13 pull LA delivers `Type='deleted'` rows ONLY after BATCH-VERIFYING their CommitSigs (one attestRows call, mirroring push's batch sign); invalid/absent ⇒ withheld + surfaced. `ControlState` remains the cheap OData pre-filter; `CommitSig` is the AUTHORITY. Legacy lane: tombstones with live-coordinate provenance < `tombstoneCommitEpochId` (recorded at N9 apply, rides the N16 artifact) predate the protocol and deliver seal-free — vanishes at the D-C2-2 go-live wipe |
| C2-R4-6 | `TargetInSnapshot` was "recorded at publication, never re-derived" but wasn't in the journal — a P6→P7 crash left it unrecoverable (null ⇒ later chains undefined; recompute ⇒ violates once-decided and drifts as rows change lists) (Codex 4) | REAL — and the C2-R4-1 normalization law removes the flag's post-publication purpose entirely | `TargetInSnapshot` is DELETED from the registry (§4). The per-target in-snapshot decisions live in the JOURNAL's candidate payload (P4 stores `AdoptionDecisions = {target: inSnapshot}` beside CandidateHeads — pre-P6, crash-safe); they exist solely to make the P6 candidate's balance delta reproducible at recovery. Post-publication, nothing consults them (normalization law) — the crash window Codex found has nothing left to lose |
| C2-R4-7 | N16's epoch was neither reproducibly derivable (the staging ledger doesn't record the first-sealed boundaries) nor detectably immutable (no seal/digest — a rewrite silently becomes the new authority) (Codex 6) | REAL — "immutable" was asserted, not enforced | N16 v3: (a) DERIVATION — PRODUCTION: recorded EXACTLY at the D-C2-2 cutover (fresh lists ⇒ epoch = first item id, everything ever pushed is sealed); STAGING: the backfill runner derives best-effort (recorded WITH its query method + Kunal attestation in the staging ledger) — acceptable because staging is trial data by D-C2-2, and the derivation-trust assumption is flagged honestly (H11). (b) IMMUTABILITY — attestRows gains an `epoch-v1` frame; the artifact stores `EpochSig` (HMAC over its values); the route verifies on EVERY read — verify-fail ⇒ **`EPOCH_TAMPERED`** (distinct from `EPOCH_UNDEFINED`), fail closed. A rewrite without the Function's pepper is impossible |
| C2-R4-8 | The stated Director remedy for a seal-skipped legacy tombstone was UNREACHABLE — create rejects (target controlled), supersede/withdraw refuse (unadopted), adopt skips (unsealed) ⇒ the target is permanently locked (Codex 7) | REAL — the R3 §7b(4) rescope cited a lane §4 itself blocks | NEW mode **`retire_claim`** (N1/§5b): Director-sudo, same journal/idempotency/exclusive-state machinery; legal ONLY against a committed-unadopted claim whose tombstone row FAILS seal validation AND has live-coordinate provenance < `epochId` (genuine pre-C1 legacy). It QUARANTINES the unsealed tombstone row, retires the registry claim (journaled evidence), leaving the target unclaimed — the normal create/adopt lanes then open. A POST-epoch unsealed claimed tombstone is tampering: stays locked, surfaced loudly (never retirable) |
| C2-R4-E1 | (Engineer family find — representation-coherence at list transitions, same family as C2-R4-2/-3) When a LIVE controlled row is later ARCHIVED, the archive run's snapshotCompute would fold the raw row effects into balances — re-introducing a deleted target's +10 (or a replaced target's original effect) that settlement correctly excludes; balances and settlement diverge at archive time | REAL by inspection — snapshotCompute is tombstone-aware (D8-7) but knows nothing of controlHeads | ARCHIVE EXCLUSION PIN (N10 v3): archive runs EXCLUDE from their input selection every row that (a) carries `ControlId` (is a control row) or (b) is named in `controlHeads` (any state, incl. null/historical) — such rows REMAIN LIVE PERMANENTLY (rare Director-corrected rows; negligible list cost; snapshotCompute stays head-unaware). The engine keeps reading them from the live list; balances never see them; the SR-70 cross-list rule never triggers for them. Archived-target corrections are unaffected (their control rows are written into the archive list and balances were adjusted at publication) |

**Q1v4-Q6v4 outcomes:** Q1v4 ordering CONFIRMED right by both, but → C2-R4-4/-5; Q2v4 horizon rule
matches snapshotCompute per both, but → C2-R4-2 (coordinate) + C2-R4-6 (recoverability); Q3v4 NO →
C2-R4-3/-7; Q4v4 YES both (empty-set unreachability CONFIRMED — closed); Q5v4 YES both (head-shape
parity CONFIRMED — closed); Q6v4 architecture sound, edge folds required. Codex re-affirmed the
transient-export adjudication and pinned N13 OData + the five-state crash drill as mandatory build
proofs (already N10/N13 acceptance items).

---

## R5 fold record (2026-07-24) — BOTH BLOCK; 4 distinct REAL (2 converged pairs), both R4 mechanisms redesigned

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R5-1 | `retire_claim` → create corrupts balances: retirement removed the tombstone WITHOUT normalizing — if that tombstone had excluded its archived target from snapshot balances, the later correction's "archived target is in balances" assumption is FALSE ⇒ double-subtraction (repro: excluded +10, retire, create-replace +8 ⇒ −2 instead of +8) (AGY 1 ≡ Codex 1, CONVERGED) | REAL — retirement changed ensemble state outside the publication discipline that the normalization law depends on | **`retire_claim` v2 = A TRUE PUBLICATION (§5b):** it publishes `CandidateHeads = {target: explicit null}` (the withdraw form — adjudicated, no active control, target PRESENT) with a NORMALIZING balance delta decided by the SAME horizon rule applied to the retired tombstone (journaled in `AdoptionDecisions`): archived target + tombstone-was-in-input ⇒ `+ effect(target)` (restore); else 0; live ⇒ 0; undecidable ⇒ `RETIRE_DELTA_UNDECIDABLE` fail-closed. Retirement IS a first publication under the §5 P4 law — the ensemble leaves it normalized; the AGY repro now runs 0 → retire(+10) → supersede-to-replacement(−10+8) ⇒ +8 ✓ |
| C2-R5-2 | `retire_claim` was incompatible with the journal machinery it claimed to ride: empty CandidateHeads (P5.1 refuses by construction), no recovery decision key, no commit point, no mutation order — every crash split unrecoverable or out-of-spec (AGY 2 ≡ Codex 2, CONVERGED) | REAL — the R4 design asserted "same machinery" without satisfying its invariants | v2 rides the machinery FOR REAL: non-empty CandidateHeads (the explicit-null entry) ⇒ P5.1 valid, §6's per-entry hasOwnProperty decision works unchanged; P6 (manifest null head + normalized balances, one MERGE) = THE COMMIT POINT; registry transition = the withdrawn form (Revision advanced, prior state saved for rollback restore); pre-P6 rollback touches NO ledger rows |
| C2-R5-3 | A crash mid-retirement destroyed its own gate evidence: quarantine-then-crash removed the row from the ledger lists, so the retry's mode gate could never re-validate `fails-seal AND pre-epoch` ⇒ claim stuck committed, target locked forever (AGY 3) | REAL — mutation-before-commit-point destroyed the predicate's input | v2 ORDERING: the tombstone row is quarantined ONLY in P7 — AFTER the P6 commit point — recorded in the journal (row identity + list) and completed by roll-forward recovery, idempotent. Every pre-P6 crash leaves the row in place: the retry's gate re-validates on intact evidence; post-P6 crashes never re-run the gate (P1 → reconcile → roll forward) |
| C2-R5-4 | The E1 permanent archive exclusion broke the CLIENT scalar-cutoff contract: clients treat every row with `_spId ≤ cutoffId` as snapshot-covered (skip at index.html:1427-1476, prune at db.js:721-734) — a permanently-live controlled row below an advanced cutoff is skipped client-side while EXCLUDED from balances ⇒ client stock diverges from settlement; also unbounded retention vs the 5000-row archive query, and null-head exclusion was broader than necessary (Codex 3) | REAL — the exclusion preserved server arithmetic in isolation but punched holes in the cutoff's covering invariant | **CONTROL-AWARE PAIRED ARCHIVAL (E1 v2, N10/snapshotCompute):** (a) snapshotCompute gains the active `controlManifest` as an input and folds EFFECTIVE values: a target with an ACTIVE head ⇒ excluded (like tombstoned); a control row ⇒ folded at raw effect IFF its head is active; historical/superseded control rows ⇒ excluded; null-head (withdrawn/retired) targets ⇒ folded normally (present). (b) PAIR-ATOMIC CUTOFF: a run's `cutoffId` is CLAMPED below any controlled ensemble whose members (target + all its control rows) are not all ≤ the natural cutoff — pairs archive TOGETHER in one run (SR-70 same-list preserved), and NO excluded row ever sits at-or-below a published cutoff ⇒ the client covering invariant (`_spId ≤ cutoffId` ⇒ effect in balances) holds EXACTLY again; pruning is safe; retention is BOUNDED (a pair archives once the natural cutoff passes its youngest member — roughly one archive cycle after the correction). Permanent exclusion is DELETED |

**Q1v5-Q6v5 outcomes:** Q1v5 induction CONFIRMED for all standard publications by both — fails only
at retire→create (→ C2-R5-1; retirement is now itself a normalizing first publication); Q2v5 YES
both (CommitSig chain closed; Codex build pin: `tombstoneCommitEpochId` must be installed BEFORE N9
accepts protocol rows — added to N9/N16 acceptance); Q3v5 NO (→ C2-R5-1/-2/-3, redesigned); Q4v5
split — AGY yes, Codex found the client contract break (→ C2-R5-4, redesigned); Q5v5 YES both
(ID-coordinate count ZERO — closed); Q6v5 all remaining paths confined to the two redesigned
mechanisms.

---

## R6 fold record (2026-07-24) — AGY PASS (+1 note refuted) · Codex BLOCK×5 all REAL + 1 note

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R6-1 | A retired LIVE tombstone stays pull-deliverable between P6 and P7 (legacy lane needs no CommitSig; pulls aren't excluded by correction states) — a device pulling in the crash window applies the deletion AFTER the server restored the target, permanently divergent; worse, devices that pulled it BEFORE retirement are divergent already (Codex 1) | REAL — and the pre-existing-application half is the deeper problem | TWO-PART FIX (§5b): (a) VISIBILITY WITHDRAWAL — a pre-P6 step MERGEs the tombstone `ControlState='retiring'` (excluded by the N13 filter; REVERSIBLE — rollback restores; the seal/provenance gate evidence is untouched, preserving C2-R5-3); (b) THE HEALING TOUCH — P7, post-commit, TOUCHES the restored TARGET row (a no-op Modified bump): pulls are modified-since cursors, so EVERY device re-receives the target on its next pull — devices that had applied the deletion (whenever) re-merge it (sync merges rows absent from local ids). Heals the crash-window device AND all pre-existing divergence. Idempotent, roll-forward-completed |
| C2-R6-2 | The null-head state retirement/withdraw mandates as the re-correction baseline has NO arithmetic cells (six-cell table lacks null→replace / null→delete), NO expected-tuple form (request requires `activeControlId`), and NO pinned registry representation — the +10→+8 result was asserted, not derivable (Codex 2) | REAL — the lane was named but not normatively defined | PINNED (§5 P4 + §5 request + §4): TWO new cells — null→replace `− effect(originalTarget) + effect(new)`; null→delete `− effect(originalTarget)` (a null head means the target is the current effective value — the table now derives the converged repro: retire restores +10, supersede-to-+8 = −10+8 ⇒ +8). Expected tuple for a null-head target: `{activeControlId: null, revision, publicationVersion}`. Registry WITHDRAWN FORM: `committed(ControlId: null, Revision: advanced, PublicationVersion: the withdrawing/retiring publication, OpId retained for device-origin)`; supersede-from-null = `pending_supersede(PriorCommitted = the null-head form)`, rollback restores it — identical mechanics for withdraw-then-recorrect and retire-then-correct |
| C2-R6-3 | Pair eligibility ignored `retainAfterTs` (snapshotCompute.js:108-115 requires Id ≤ cutoff AND Timestamp < retainAfterTs) — a fresh control row splits its ensemble across lists ⇒ `CROSS_LIST_CONTROL_CONFLICT` (Codex 3); AND the R5 cutoff clamp made retention UNBOUNDED under repeated corrections — every new revision resets the youngest member, the clamp pins the global cutoff below the target forever, backlog grows into the 5000-row guard (Codex 4) | BOTH REAL — one root cause: keying pair-atomicity on EVERY member's eligibility | **UNIT-MOVE PAIRED ARCHIVAL (E1 v3, N10):** an ensemble archives AS A UNIT keyed on the TARGET alone passing the FULL archive predicate (id ≤ cutoff AND retention — the exact snapshotCompute partition, C2-R6-3's demand); when the target qualifies, ALL its control/tombstone rows move IN THE SAME RUN regardless of their own ids/timestamps. Sound because those members are never client-covering-relevant: control rows are never delivered to devices (N13), and a tombstone's effect rides balances via input-presence (D8-7 — the unit-move guarantees it is in the run input, strictly stronger than the retain-window pairing it replaces). The R5 cutoff CLAMP IS DELETED — the global cutoff advances normally, so retention is bounded by the TARGET's own eligibility exactly like any uncorrected row (repeated supersedes only add same-run members, never defer the move). Corrections landing AFTER the unit-move use the SR-135 direct-to-archive lane as before. SR-70 same-list preserved by construction |
| C2-R6-4 | Control rows now archive, but the run's copy mapping, re-read compare, and fidelity-hash canonical don't carry the N7 control fields (archive-def:103-106/213-220; snapshotCompute:43-60) — an archive move could silently strip ControlId/Revision/Born/TargetLine/seals and the hash would still pass; the live delete then destroys the only complete copy ⇒ export refuses forever (Codex 5) | REAL — the C1 carry covered the economic set, not the new control form | N10: the archive SELECT/copy mapping, the re-read field-for-field compare, AND the fidelity-hash canonical are EXTENDED to the FULL N7 control form (`ControlId, ControlType, ControlRevision, BornPublicationVersion, TargetLine, OriginalEventAt, ControlState, CommitSig` + the ctl-v1 `EconSig` already carried) — versioned hash extension, JSON-framed, the C1 archive-carry precedent; a copy dropping ANY control field now breaks the hash BEFORE the live delete (fail-closed, run aborts, live ledger untouched) |
| C2-R6-N1 | Direct-to-archive control rows bypass snapshotCompute's incremental fidelity hashes, so P6 must commutatively update `stock_snapshot.fidelityHashes` (AGY note) | **REFUTED with evidence** — NO stored fidelity-hash field exists: `stock_snapshot.ConfigData` is `{version, cutoffId, stepCutoffTs, runId, balances}` (§1); hashes are PER-RUN TRANSIENT values (snapshotCompute.js:153 returns them; the archive LA compares re-read vs computed BEFORE publish/delete, archive-def:467-468) and are never persisted — a directly-written archive row is outside every run's moved set and cannot perturb any comparison. The REAL adjacent requirement is C2-R6-4's canonical extension, folded there | — |
| C2-R6-N2 | §5 P4 still contained the DELETED R4 permanent-exclusion sentence ("controlled rows live forever"), contradicting the N10 redesign (Codex note) | REAL — stale normative text | Sentence rewritten to the unit-move rule (§5 P4) |

**Q1v6-Q5v6 outcomes:** Q1v6 AGY yes / Codex no (→ C2-R6-1/-2); Q2v6 retirement's own arithmetic
CONFIRMED correct in all three branches by both — the induction gap was the missing null-head cells
(→ C2-R6-2); Q3v6 effective-fold cases CONFIRMED matching engine economics by both; pairing/
retention/round-trip → C2-R6-3/-4; mid-correction publication confirmed excluded by coordination;
direct-to-archive lane confirmed correct by both; Q4v6 → C2-R6-1 composition; adoption × export
exclusion otherwise sound; Q5v6 AGY explicit all-clear / Codex no (findings above). STANDING
CLOSED (both, multiple rounds): CommitSig chain, signed epoch, ID coordinates, head shape,
empty-set, retry healing, transient-export adjudication.

---

## R7 fold record (2026-07-24) — AGY PASS (explicit all-clear) · Codex BLOCK×4 all REAL + 1 build pin

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R7-1 | §5b ASSUMED the N13 filter excludes `retiring`, but N13's normative row excluded only `pending` — an implementation following its own inventory would keep delivering a retiring tombstone (valid CommitSig!) after P6 restored the target (Codex 1) | REAL — spec drift between §5b and N13 | N13 v3 = an explicit ALLOWLIST, not a blocklist: `Type='deleted'` rows are delivered ONLY when ControlState is null-legacy (AND live-coordinate provenance < `tombstoneCommitEpochId`) or `'committed'` (AND batch CommitSig verifies). `pending`, `retiring`, and EVERY unknown/future value are excluded BY CONSTRUCTION. Real-list OData null semantics + the full allowlist matrix = the N13 build proof |
| C2-R7-2 | The R6 HEALING TOUCH cannot work: pulls are an immutable SharePoint-ID cursor (`ID gt lastId` — sync.js:1823/1881, pull-v2 props :107), NOT modified-since — a Modified bump on an old-ID row is NEVER re-delivered; and an ARCHIVED restored target is outside the live-list pull entirely (Codex 2) | REAL — engineer's R6 premise refuted by the client code; verified sync.js:1823 | THE HEALING TOUCH IS DELETED. Honest scope pin (§5b + H13): retirement restores SERVER truth (settlement, balances, manifest — all correct and coherent); DEVICE-side restoration is explicitly DEFERRED to the banked H7 re-delivery lane — a device that had applied the retired deletion understates that product locally until that lane ships (or a fresh re-sync). The retirement response carries `deviceRestorationPending: true` + the affected target so the Director KNOWS. Consistent with D-C2-2: legacy tombstones are trial-data lanes; at go-live the case vanishes |
| C2-R7-3 | The withdrawn registry form breaks the §8 own-committed device retry: a lost-ack device retries its tombstone AFTER a Director retires it — the retained OpId classifies it as OWN, but ControlId is null and the row is quarantined, so the mandatory row-exists+CommitSig check can never pass ⇒ infinite retry (or worse, an implementation recreates the retired deletion) (Codex 3) | REAL — the R6 withdrawn form and the R4 retry-healer rule compose into a dead end | §8 gains the TERMINAL ADJUDICATED BRANCH: own-claim match (OpId) whose registry item is in the WITHDRAWN form (ControlId null) ⇒ the operation was adjudicated by a Director — answer the push TERMINALLY (`ok`, status `superseded_by_adjudication`, surfaced in the response); NEVER insert, recreate, or re-mark the tombstone. The device's queue drains; nothing resurfaces |
| C2-R7-4 | Unit-move can fold a LOSING/PROVISIONAL tombstone into balances: snapshotCompute's D8-7 treats EVERY `Type='deleted'` input row as effective regardless of ControlState — a stalled writer's pending tombstone (crashed before foreign-CAS compensation) in an archive run's input excludes its target from balances while the manifest says the target is PRESENT ⇒ permanent balances/settlement divergence after the scrub quarantines it (Codex 4) | REAL — snapshotCompute.js:79 collects tombstones with no authority check | THE TOMBSTONE AUTHORITY GATE (N10): the archive run REFUSES to proceed (409, retry later) while ANY tombstone in its input universe is in a NON-ADJUDICATED state (`pending`/`retiring`) — the TTL scrubs drive those terminal quickly, so the refusal is transient; `committed` tombstones are BATCH-VERIFIED via attestRows before compute (an invalid CommitSig ⇒ refuse + surface, tampering); legacy-null ones pass by the epoch rule. D8-7 economics therefore only ever see ADJUDICATED tombstones. Mirrors the existing refuse-while-journal-non-terminal posture |
| C2-R7-5 | (Codex Q4v7 build reservation) the extended hash canonical must distinguish numeric `ControlRevision: 0` from missing/null — JSON framing alone doesn't guarantee it | Fair — typed-encoding pin | N10/N11: the versioned canonical encodes TYPED values (JSON-typed number/null/absent distinct — `0`, `null`, and field-absent are three different canonical encodings); the N12 drop-each-field proof gains 0-vs-null-vs-absent cases |

**Q1v7-Q5v7 outcomes:** Q1v7 NO (→ C2-R7-1/-2); Q2v7 arithmetic + crash mechanics CONFIRMED
consistent by both — the device-retry consumer was the gap (→ C2-R7-3); Q3v7 target-keyed
retention + boundedness + SourceId>cutoff covering CONFIRMED sound by both (→ C2-R7-4 for the
provisional-tombstone economics); Q4v7 YES at design level (→ C2-R7-5 typed-canonical pin); Q5v7
AGY explicit NO-on-all-paths / Codex not yet (findings above). Codex re-affirmed the R6
fidelity-hash refutation.

---

## R8 fold record (2026-07-24) — AGY PASS (2nd consecutive all-clear) · Codex BLOCK×4 all REAL

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R8-1 | `deviceRestorationPending` was claimed by §5b/H13 but ABSENT from the normative response contract — an implementation following the schema returns plain success and the R7 divergence-surfacing intent is runtime-unsurfaced (Codex 1) | REAL — the response schema was never amended | The response contract (§5) gains the retirement fields: `deviceRestorationPending?: true, affectedTarget?: <targetTransactionId>` on retirement success — INCLUDING the journal's stored result, so terminal-opId REPLAY carries the same warning |
| C2-R8-2 | The §8 own-claim retry has an UNDEFINED branch while a Director withdraw/supersede holds the registry in `pending_supersede` — the retained OpId matches OWN but none of pending / committed-non-null / withdrawn-null applies: insert risks colliding with the Director reservation, foreign contradicts the own rule, looping until recovery is the default (Codex 2) | REAL — the R6 withdrawn form covered only the TERMINAL state of the Director op, not its in-flight interval | §8 gains the OWN-`pending_supersede` BRANCH: NEVER insert, quarantine, or heal-MERGE mid-Director-op; DECIDE BY READ — the device's original operation had already committed (pending_supersede only ever wraps a PriorCommitted device claim), so if the ledger row exists the retry answers via the normal dedup path (`ok`, already-applied — correct under BOTH outcomes: rollback restores PriorCommitted, roll-forward lands withdrawn where later retries hit the adjudicated branch); ledger row unexpectedly absent ⇒ transient retryable (the Director op resolves within its own machinery) |
| C2-R8-3 | The N10 authority gate was a BLOCKLIST (reject pending/retiring, verify committed) — an unknown/future ControlState value falls through to D8-7 and is treated as an effective deletion ⇒ balances/settlement divergence; weaker than N13's own allowlist rule (Codex 3) | REAL — the R7 gate didn't mirror the R7 allowlist lesson | N10's gate is now the SAME allowlist as N13: ONLY qualifying legacy-null (provenance < `tombstoneCommitEpochId`) or committed-with-valid-CommitSig tombstones ENTER compute; EVERY other value (pending, retiring, unknown, invalid-sig, post-epoch null) ⇒ refuse + surface. The §8 build-proof sentence is synchronized to the full N13 matrix (Codex's Q1v8 note) |
| C2-R8-4 | The max-input-ID horizon cannot PROVE a tombstone was in an archive run's input: SharePoint makes higher IDs visible before lower allocated IDs finish committing (recorded at sync.js:1837 — the reason pulls freeze maxId), so `id ≤ horizon` can conclude "present" for a row that was INVISIBLE at the read ⇒ adoption applies delta 0 while balances retain the target ⇒ permanent divergence (Codex 4) | REAL — a scalar max cannot prove prefix completeness; device tombstone pushes are deliberately NOT excluded by the coordination discipline (SR-141) so the race is live | THE INPUT TOMBSTONE-SET RECORD replaces the horizon marker (N10/§5b/P4): each archive run PERSISTS the exact set of tombstone live-coordinate ids present in its input universe (tombstones are rare — a small JSON set in the run record, carried under the run's existing integrity machinery). The adoption/retirement membership test = the tombstone's live-coordinate id **∈ the target's archiving run's recorded set** — direct membership proof, no inference, no ID-ordering assumption. Runs predating the record ⇒ the existing `ADOPTION_DELTA_UNDECIDABLE` / `RETIRE_DELTA_UNDECIDABLE` fail-closed manual lane |

**Q1v8-Q5v8 outcomes:** Q1v8 YES both (allowlist matrix confirmed; §8 sentence sync → C2-R8-3);
Q2v8 deferral posture CONFIRMED correct by both — the schema gap was the residue (→ C2-R8-1);
Q3v8 the terminal branch confirmed for all withdrawn-form orderings by both; pending_supersede
was the gap (→ C2-R8-2); Q4v8 pending/retiring capture + TTL-bounded refusal + no-deadlock
CONFIRMED by both; unknown states + late-visible IDs → C2-R8-3/-4; Q5v8 AGY explicit
NO-on-all-paths (2nd consecutive) / Codex not yet (findings above).

---

## R9 fold record (2026-07-24) — AGY PASS (3rd consecutive) · Codex BLOCK×4 all REAL

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R9-1 | The tombstone-set record was required conceptually but had NO durable artifact: no schema, no immutable run key, no digest, no write-ordering vs publication, no empty-vs-absent semantics — and the existing archive contract persists only a transient runId (Codex 1) | REAL — same class as the R4 seal-epoch finding: a named mechanism with no defined home | **N17 `archive_run_record`:** one `AppConfig_Staging` item PER archive run — `{ConfigType:'archive_run_record', RunId (immutable key), SnapshotVersion, TombstoneIds:[live-coordinate ids], RecordSig}`; `RecordSig` = a `runrec-v1` attestRows seal over the values (N11 frame #4), verified on every read (fail ⇒ the membership decision is `..._UNDECIDABLE`, fail-closed). CONSTRUCTION: built from the EXACT `rows` array passed to snapshotCompute — the same input the fold evaluated, never a re-read (the late-visibility gap Codex named cannot open). ORDERING: record written + durable BEFORE the snapshot publication (record-then-publish); a published snapshot whose run record is absent ⇒ membership UNDECIDABLE (fail-closed manual); a record for a run that never published is a harmless orphan (membership is keyed by the TARGET's `ArchiveRunId`, which only a published run's rows carry). `TombstoneIds: []` is a VALID empty set; an ABSENT record (pre-C2 runs) is UNDECIDABLE — never conflated. Retention indefinite (tiny, rare) |
| C2-R9-2 | `committed(non-null)` × ledger row ABSENT had no dispatch outcome — implementations could return false success, loop forever, or RECREATE a row whose disappearance was quarantine/tampering (Codex 2) | REAL — the one uncovered cell in the own-claim matrix | §8: own-committed with the ledger row absent from BOTH lists AND quarantine (full enumeration) ⇒ **`CONTROL_ROW_MISSING`** — fail-closed, TERMINAL for the device (stop retrying), loudly surfaced for Director investigation; NEVER reconstruct (no evidence a resurrection is legitimate). Reconcile gains the matching anomaly sweep (same surfacing). Director remedy: retire_claim's gate gains the ABSENT-ROW EVIDENCE LANE — legal against a committed claim whose row is provably absent everywhere (the journaled enumeration IS the evidence; the membership rule still decides the balance delta; undecidable ⇒ manual) |
| C2-R9-3 | The R8 own-pending_supersede branch may be UNREACHABLE: supersede stores the prior identity in `PriorCommitted`, and nothing required the top-level `OpId`/`ControlId` to survive — a legitimate retry could fail the own test and be QUARANTINED (Codex 3) | REAL — identity retention was assumed, not pinned | §4: during `pending_supersede` over a device-origin claim, the TOP-LEVEL `OpId` and `ControlId` RETAIN the prior committed identity (the Director op's identity lives in `Owner`/`JournalId`); §8's own matcher ALSO inspects `PriorCommitted.OpId/ControlId` (belt — reachability holds even against a nonconforming write) |
| C2-R9-4 | The divergence warning was retirement-only, but withdraw and supersede of an ADOPTED device deletion create the SAME unsurfaced divergence (server restores/replaces the target; devices keep the applied deletion) — and Director corrections generally change effective stock devices never see (Codex 4) | REAL — the R8 fix covered one member of the family | GENERALIZED (§5 response + H13): **`deviceConvergencePending: true` + `affectedTarget`** ride EVERY mode whose published effective result devices cannot locally reconstruct: retire_claim, withdraw-of-adopted-deletion, supersede-of-adopted-deletion, and ALL Director create/supersede corrections (H7: devices never receive control rows). Stored in the journal result, carried on terminal replay, set by any recovering worker. ADOPT alone is exempt WITH PINNED REASONING: the adopted tombstone was already device-delivered and applied — adoption changes no device-visible state and introduces no NEW divergence. `deviceRestorationPending` is renamed into this one field (one vocabulary, no per-mode drift) |

**Q1v9-Q5v9 outcomes:** Q1v9 retire-path warning CONFIRMED on all four delivery paths by both —
the mode-family generalization was the gap (→ C2-R9-4); Q2v9 → C2-R9-2/-3 (the two uncovered
cells); Q3v9 the set-membership CONCEPT confirmed correct by both (incl. all three repro variants)
— the artifact contract was the gap (→ C2-R9-1); Q4v9 YES both: N10/N13 allowlist parity
CONFIRMED, no blocklist consumers remain — closed; Q5v9 AGY explicit NO-on-all-paths (3rd
consecutive) / Codex not yet (findings above). Codex confirmed: the scalar-horizon replacement is
sound once the record is properly defined.

---

## R10 fold record (2026-07-24) — BOTH BLOCK; 4 distinct REAL (1 converged pair)

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R10-1 | Three separate list queries are NOT one atomic observation — a retry/reconcile enumerating during an archiver unit-move (or a quarantine move) can miss the row in BOTH places (source queried after its delete, destination before its write) ⇒ a healthy row triggers the terminal `CONTROL_ROW_MISSING` (AGY 1 ≡ Codex 3, CONVERGED) | REAL — cross-list moves are write-dest-then-delete-source, but nothing pinned the READER's order or stability | ENUMERATION CONTRACT (§8/§6): (a) STRICT SEQUENTIAL ORDER Live → Archive → Quarantine — every mover in the design writes its DESTINATION before deleting its SOURCE (unit-move L→A; quarantine L→Q and A→Q), and L→A→Q queries each destination AFTER its source, so a row mid-move is always seen in at least one list (AGY's proof); (b) BELT: absence is TERMINAL only when the coordination record reads `idle` with the SAME ETag before AND after the complete paged enumeration — any non-idle state or ETag change ⇒ transient retryable (Codex's stability interval); paging continuity pinned per list |
| C2-R10-2 | N17 had no RunId uniqueness/idempotency contract: the archiver accepts a CALLER-supplied runId and stamps rows pre-publication — a crashed attempt's retry could reuse the RunId over a DIFFERENT input (record says [], compute now sees tombstone T), or double-write/overwrite the record (Codex 1) | REAL — archive-def:31 takes runId from the request | N17 v2: its OWN LIST `ArchiveRunRecords_Staging` with `RunId` ENFORCE-UNIQUE; record CREATE (create-if-absent) + outcome-by-read on ambiguous writes; the record carries `InputDigest` (canonical digest of the exact compute input) — a retry whose digest MATCHES proceeds idempotently, a differing digest is REJECTED (recomputation requires a FRESH runId); N10: archive runIds are SERVER-MINTED per `idle → run_active` acquisition (a GUID; never caller-supplied); membership verifies BOTH the target's `ArchiveRunId` AND `SnapshotVersion` coherence |
| C2-R10-3 | The absent-row retirement lane LOST its membership coordinate: N17 stored live-coordinate numeric ids, but a vanished row's `_spId`/`SourceId` is unknowable — the supposedly recoverable target lands `RETIRE_DELTA_UNDECIDABLE` permanently (Codex 2) | REAL — nothing retained the numeric id after the row disappeared | `TombstoneIds` switch to STABLE **TransactionIds** (equally present in the same compute input array; stable across list moves AND absence; the registry already keys on them). Membership = the tombstone's TransactionId ∈ the set — the ENTIRE ID-coordinate class is deleted from the design (the Q5v5 sweep stays trivially zero), and the absent-row lane decides its delta with no extra machinery |
| C2-R10-4 | The R3 staged-visibility FLIP is incompatible with the immutable ID cursor: a tombstone inserted `pending` at id 1000 keeps id 1000 when MERGEd to `committed`; peers whose cursor passed 1000 (+100 lookback) NEVER receive it ⇒ an invisible-forever legitimate deletion; contradicts H10 and breaks the adopt exemption's "already delivered" premise (Codex 4) | REAL — verified against sync.js:1823/1851/1881 (the same cursor ground truth that killed the R6 healing touch); survived since R3 | **COMMIT-TIME RE-MINT (§8 v4):** at the commit point the route INSERTS a FRESH copy of the tombstone (same TransactionId, EconSig; `ControlState='committed'` + CommitSig) as a NEW item — its new high id is ahead of every cursor, delivered exactly like any ordinary row (lookback semantics identical) — and THEN deletes the pending item (write-before-delete, consistent with C2-R10-1's enumeration proof). The transient same-list TransactionId duplicate is pinned harmless (pulls deliver only the committed copy; the scrub completes either half: committed copy present ⇒ delete pending; registry committed + only pending present ⇒ re-mint first). H10's one-round-trip claim is TRUE again; the adopt exemption's premise is restored (every committed tombstone is cursor-deliverable — peers not yet synced are ordinary sync lag, not NEW divergence) |

**Q1v10-Q5v10 outcomes:** Q1v10 crash splits + ArchiveRunId keying + empty/absent semantics
CONFIRMED by AGY; the retry-identity contract was the gap (→ C2-R10-2); Q2v10 fail-closed posture
CONFIRMED right by both — the enumeration race + lost coordinate → C2-R10-1/-3; Q3v10 YES both
(identity retention CLOSED; the §8 matcher now echoes the §4 belt explicitly per Codex's
editorial note); Q4v10 warning family + replay/recovery delivery CONFIRMED sound by both — the
adopt exemption's premise → C2-R10-4 (restored by the re-mint); Q5v10 AGY conditionally-clear
(pending the enumeration fix) / Codex not yet (findings above).

---

## R11 fold record (2026-07-24) — BOTH BLOCK; 4 distinct REAL (2 converged pairs)

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R11-1 | The R10 commit-time re-mint physically CANNOT insert a fresh same-`TransactionId` copy — `StockTransactions_Validate.TransactionId` is Enforce-Unique (AZURE-CHUNK2-SCOPE.md:32/111), so the INSERT 409s exactly like normal push dedup; treating the 409 as success + deleting pending ⇒ NO ledger row; keeping pending ⇒ the old-id invisibility returns (Codex 1 — the deepest R11 catch) | REAL — verified the unique constraint; my re-mint assumed two same-id rows can coexist, which the ledger forbids | THE SEPARATE PENDING LIST (N18 `StockControlPending_Staging`): a device tombstone's pending copy stages HERE, NEVER the main ledger — so it is never pull-visible (N13 reads only the main ledger), never in economics (snapshotCompute/D8-7 read only the main ledger), and never occupies the ledger's unique key. At the COMMIT POINT the route INSERTS the tombstone into the main ledger for the FIRST time (unique key satisfied; committed + CommitSig; a fresh high id ⇒ cursor-deliverable, C2-R10-4's goal intact) then DELETES the pending-list item (write-before-delete across the two lists). `ControlState='pending'` is no longer a MAIN-LEDGER value (pending = "present in N18"); ledger tombstones are committed-or-retiring only — the N13 allowlist and the authority gate SIMPLIFY (they never see a pending main-ledger row) |
| C2-R11-2 | The §8 own-committed RETRY and the no-registry SCRUB text still said "complete the visibility MERGE" — the retired in-place flip; a crash-then-retry before the periodic scrub would flip the old-id row in place, resurrecting the R10-4 invisible-forever bug (AGY 2 ≡ Codex 2, CONVERGED) | REAL — R10 updated the success path + one scrub clause but not the retry text or the no-registry scrub | §8/§6: EVERY recovery consumer now reads: committed registry + a pending-LIST row but no main-ledger row ⇒ INSERT the fresh committed main-ledger row, THEN delete the pending-list item (the re-mint); NEVER flip an existing row. Success path, own-committed retry, TTL scrub, and the no-registry scrub all cite the ONE re-mint procedure |
| C2-R11-3 | §5b's membership CONSUMER still compared the target's numeric `_spId`/`SourceId` against the set — but R10 switched the set to TransactionIds; a numeric id ∈ a string-id set is always false ⇒ the target's effect is subtracted a SECOND time ⇒ silent balance understatement (AGY 1 ≡ Codex 4, CONVERGED) | REAL — the R10 schema moved, the §5b prose didn't | §5b: the membership test is the tombstone's stable **TransactionId** ∈ the run's recorded set (the registry-retained TransactionId when the row is absent, C2-R10-3); ALL numeric-coordinate language deleted from the membership rule (the ID-coordinate class is now genuinely zero design-wide) |
| C2-R11-4 | A changed-input archive retry leaves ORPHAN pre-publication copies: a crashed run stamps `ArchiveRunId=R` on copied rows before publishing; the fresh-id recompute (R10-2) re-copies under R2, so the archive holds the target under BOTH R and R2 (or the unique key blocks R2) ⇒ membership can't unambiguously pick the target's run/version (Codex 3) | REAL — existing archiver copies-before-publish + scopes existing-copy detection to the current runId (archive-def:103/189/324) | N10: an archive run's FIRST act after acquiring the lock is the ORPHAN SWEEP — delete every archive row whose `ArchiveRunId` names a run with NO published snapshot record (a crashed attempt's residue), under the held coordination lock, verified complete BEFORE the run copies anything. ⚠ Chunk-8-surface amendment, flagged for the return re-audit |

**Q1v11-Q5v11 outcomes:** Q1v11 fresh-row cursor delivery + transient-duplicate harmlessness
CONFIRMED by both — but the insert can't use the same id (→ C2-R11-1) and two retry paths still
flipped (→ C2-R11-2); Q2v11 the L→A→Q enumeration contract CONFIRMED sound for every named mover
by both (the N18 pending list joins the topology — insert-main-before-delete-pending — as a
BUILD-PROOF item); Q3v11 N17 identity CONFIRMED by AGY; the abandoned-copy lifecycle was the gap
(→ C2-R11-4); Q4v11 TransactionId stability CONFIRMED by both — the stale §5b consumer was the gap
(→ C2-R11-3); Q5v11 both not-yet (findings above; both note the architecture is structurally
complete once these propagation gaps close).

---

## R12 fold record (2026-07-24) — BOTH BLOCK; 7 distinct REAL (2 converged pairs), all N18-lifecycle

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R12-1 | A COMMITTED N18-crash-window tombstone is invisible to the export: §7b queried only Live+Archive, but a device commit CASes the registry BEFORE the main-ledger re-mint and does NOT hold the coordination state, so an export lease overlapping that window sees no row, doesn't block, and BILLS the committed deletion's target as present (AGY 1 ≡ Codex 1, CONVERGED) | REAL — the registry-committed-but-not-materialized window is real; export keyed on row-presence | §7b(1)/(4): the export ALSO reads `ControlRegistry_Staging` for COMMITTED claims over supplied identities; a committed claim whose control has neither a materialized main-ledger row nor an active head ⇒ the `TOMBSTONE_PENDING_ADOPTION` fail-closed blocker. The export does NOT read N18 (a PENDING claim isn't adjudicated — must never block). The registry, not row-presence, is the authority for "a deletion is committed" |
| C2-R12-2 | The pending+N18-durable-BEFORE-CAS crash (N18 insert durable, worker dies before the commit CAS, device offline, TTL fires) had NO scrub outcome — §6/§8 covered "pending, neither row" and "committed, only N18" but not this; §4 still described the retired "durable ledger row" version (Codex 2) | REAL — the exact post-N18-insert/pre-CAS crash was unmodelled | §6/§8: registry pending past TTL WITH a durable N18 row (and no main-ledger row) ⇒ PROMOTE — the scrub runs the commit CAS (pending→committed) THEN the re-mint (insert main-ledger row, delete N18); idempotent. §4's stale "durable ledger row" text rewritten to "durable N18 row" |
| C2-R12-3 | N18 had no Enforce-Unique/outcome-by-read contract: an own-pending retry "just proceeds" and re-inserts ⇒ two pending rows (delete-one leaves residue); or, if uniqueness is added at build, a 409 with no defined outcome-by-read stalls the commit (Codex 3) | REAL — N17 got this contract, N18 didn't | N18: `TransactionId` Enforce-Unique; the pending insert is create-if-absent + outcome-by-read (a 409 ⇒ read the item: own claim ⇒ proceed to the commit CAS, the row is already staged; foreign ⇒ impossible, the registry claim gates it first). One pending row per tombstone, ever |
| C2-R12-4 | The terminal enumeration stayed Live→Archive→Quarantine, but the new mover writes Live then deletes N18 — a reader must inspect the SOURCE (N18) before the destination (Live), else it checks Live (empty pre-insert), the mover inserts Live + deletes N18, the reader checks N18 (empty) ⇒ false `CONTROL_ROW_MISSING` (Codex 4) | REAL — the write-before-delete reader rule (C2-R10-1) wasn't extended to the N18→Live edge | §8/§6: the enumeration order is **N18 → Live → Archive → Quarantine** (source-before-destination for every move, incl. the re-mint's N18→Live). A committed claim whose row is found in N18 ⇒ PROMOTE (not missing); genuinely absent from all FOUR ⇒ `CONTROL_ROW_MISSING`. The idle-same-ETag belt still guards the archive/quarantine moves |
| C2-R12-5 | The device-retry both-copies state (main-ledger row AND N18 row both present, from a crash between insert and N18-delete) skipped the delete block — the retry verified the main row, answered ok, and ABANDONED the N18 residue until a background scrub (AGY 2) | REAL — the retry text only deleted "if only the pending-LIST copy exists" | §8: the own-committed retry, on finding BOTH the committed main-ledger row AND an N18 row, DELETES the N18 row before answering ok (completing the interrupted re-mint) — the retry is the primary healer, not the scrub |
| C2-R12-6 | The orphan-sweep predicate "delete archive rows whose ArchiveRunId has NO published snapshot record" is UNIMPLEMENTABLE: `stock_snapshot` holds only the LATEST runId (checking it deletes all legitimate history), and N17 is written PRE-publication (its existence doesn't prove publication, so a post-N17/pre-publish crash's residue is spared — the bug stays open) (AGY 3 ≡ Codex 5, CONVERGED) | REAL — neither artifact proves historical publication; my R11 predicate was hand-waved | N10: the sweep predicate is VERSION-based — delete every archive row whose `SnapshotVersion` > the CURRENT published `stock_snapshot.version` (pre-publication residue by construction: a published run's rows carry SnapshotVersion ≤ the published version; a crashed run's carry a higher, never-published version). Spares all history, catches every post-N17/pre-publish crash. (Both reviewers converged on exactly this) |
| C2-R12-7 | §11's proof suite still mandated RETIRED mechanisms — the loser "lands in Quarantine" (now delete-N18), numeric horizon/SourceId membership (now TransactionId), retry "mint+MERGE" (now re-mint) — an implementation meeting the suite could reintroduce the flipped bugs (Codex 6) | REAL — the acceptance suite is normative and lagged the folds | §11 purged: loser ⇒ N18 delete; membership ⇒ TransactionId set; visibility ⇒ re-mint (never flip). The R12 proof list (below) supersedes the stale clauses |

**Q1v12-Q5v12 outcomes:** Q1v12 N13 + economics exclusion of N18 CONFIRMED right by both — export
visibility/enumeration/§4/§11 were the unmigrated gaps (→ C2-R12-1/-2/-4/-7); Q2v12 the unique-key
blocker CONFIRMED resolved by both — the both-copies retry + pre-CAS crash + N18 uniqueness were
open (→ C2-R12-3/-5/-2); Q3v12 the §5b arithmetic consumer CONFIRMED on TransactionId by both — §11
was the residue (→ C2-R12-7; seal-epoch numeric provenance is a SEPARATE, legitimate use, not
membership); Q4v12 orphan-sweep predicate NO by both (→ C2-R12-6); Q5v12 both not-yet — both note
the CORE ALGORITHMIC ARCHITECTURE is fully formed; the residue is N18 lifecycle text + the sweep
predicate.

---

## R13 fold record (2026-07-24) — BOTH BLOCK; 5 distinct REAL (2 converged pairs)

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R13-1 | The WITHDRAWN form is `committed(ControlId:null)` — my R12 "committed claim" predicates caught it in TWO places: the EXPORT blocks it forever (a retired claim has an explicit-null head + quarantined row ⇒ perpetual `TOMBSTONE_PENDING_ADOPTION`, Codex 1) AND the SCRUB re-mints it (a committed/null claim with a leftover N18 row ⇒ resurrects an aborted deletion into the ledger, AGY 2) (CONVERGED root cause, two sites) | REAL — the withdrawn form's ControlId=null is exactly "committed" by state; neither predicate excluded it | BOTH predicates now require a NON-NULL ControlId: (a) §7b export blocks only a `committed`, NON-NULL-ControlId claim with no materialized row/active head (a null-ControlId withdrawn claim is ADJUDICATED — the explicit-null head means the target is PRESENT, never blocks); (b) §8/§6 scrub re-mints only `committed(non-null ControlId)`; a `committed(null)` claim with a leftover N18 row ⇒ simply DELETE the N18 residue (the deletion was aborted — never re-mint) |
| C2-R13-2 | The version-based orphan-sweep is SHIELDED: archive runs AND Director corrections advance the SAME `stock_snapshot.version`; a run that crashes at intended V+1, then a correction publishes V+1, makes `SnapshotVersion > version` FALSE for the residue ⇒ spared ⇒ target duplicated (AGY 1 ≡ Codex 6, CONVERGED; both: version alone can't prove THIS archive run published) | REAL — version is a shared sequence; only `runId` is archive-run-exclusive, and even that is mutable | DURABLE PER-RUN PUBLICATION MARKER (N17/N10): an archive run, immediately after its snapshot-CAS (still holding the lock), stamps its N17 record `Published:true` (outcome-by-read); a publish-then-crash-before-stamp is RECONCILED at the next run's startup (the snapshot's `runId` names an unmarked N17 record ⇒ stamp it — the snapshot IS proof it published) BEFORE the sweep. The sweep then deletes every archive row whose `ArchiveRunId`'s N17 record is UNMARKED (or absent) — a durable per-run authority, immune to any other writer advancing the shared version (exactly Codex's "durable per-run publication outcome") |
| C2-R13-3 | The export's registry read has no completeness/linearization order — reading the registry while a claim is pending, then Live before the device's re-mint, with no final registry re-read, bills a committed deletion as present (Codex 2) | REAL — adding the source didn't make the multi-read observation stable | §7b: the COMMITTED-registry read is COMPLETE (paginated + attested) and is the LAST observation before assembly finalizes — AFTER the full ledger walk. Any claim committed before that final read is caught; the registry read is the export's linearization point (a claim committing after it is outside this settlement's window — the next export catches it, and no row it would bill was mutated) |
| C2-R13-4 | The N18 409 wrongly assumed the colliding row is the SAME operation: the registry is Enforce-Unique by `TargetTransactionId`, N18 by `TransactionId` — different domains; a request reusing TransactionId X for a different target passes its registry claim but 409s N18 against the original, and the rule treats the original's row as this op's (Codex 3) | REAL — the two lists key on different columns; TransactionId is globally unique per movement, so a cross-target collision is malformed/hostile, not "own" | §8/N18: on an N18 409, READ the existing row and confirm EXACT identity — same `TransactionId` AND `TargetTransactionId` AND owner AND sealed content (`EconSig` verifies) — before treating it as an idempotent own-retry; any mismatch ⇒ reject + quarantine + surface (a reused TransactionId across targets is a forged/malformed push, never idempotent) |
| C2-R13-5 | The re-mint's main-ledger insert can 409 on an UNRELATED row that already holds TransactionId X (a collision), and the "a main row lacking CommitSig ⇒ mint it" healer would SIGN that foreign row — or loop forever (Codex 4); AND the foreign-compensation N18 delete can itself crash, leaving an N18 residue whose target is foreign-committed that no scrub cell covers (Codex 5) | REAL — the protocol mints CommitSig BEFORE the atomic insert, so a legit crash never yields a signed-less protocol row; a signature-less main row IS a collision/integrity signal, not a heal target | §8: (a) COLLISION ADJUDICATION — the re-mint's main insert 409 ⇒ read the colliding row; it must be THIS tombstone (same TransactionId + TargetTransactionId + verifying EconSig) — if so the prior attempt already inserted (finish: ensure CommitSig, delete N18); if it is a DIFFERENT row ⇒ `CONTROL_ID_COLLISION` fail-closed + surfaced (NEVER sign it); a signature-less protocol row is a collision/integrity anomaly, verified never auto-signed; (b) the scrub gains the FOREIGN-COMP cell: an N18 row whose target's registry item is committed to a DIFFERENT ControlId (or whose own claim is gone) ⇒ DELETE the N18 row (it lost the race / its compensation crashed) |

**Q1v13-Q5v13 outcomes:** Q1v13 the registry-read mechanism CONFIRMED closing the window by both —
the withdrawn-exclusion + linearization were the gaps (→ C2-R13-1/-3); Q2v13 8-of-9 cells CONFIRMED
by both — the withdrawn×N18 resurrection + foreign-comp residue were the misses (→ C2-R13-1/-5);
Q3v13 the N18→L→A→Q order CONFIRMED sound by both — the 409 identity adjudication was unsound
(→ C2-R13-4); Q4v13 the version predicate NO by both (→ C2-R13-2); Q5v13 both not-yet — both again
affirm the CORE ARCHITECTURE is solid; the residue is discriminator precision + the durable
publication marker.

---

## R14 fold record (2026-07-24) — BOTH BLOCK; 8 distinct REAL (1 converged pair). Q1v14 WITHDRAWN discriminator PASS both.

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R14-1 | The N17 orphan-sweep deletes ALL pre-Contract-2 archive history: N17 is a NEW C2 deliverable, so every legacy Chunk-8 archived row's ArchiveRunId has an ABSENT N17 record ⇒ the "unPublished-or-absent ⇒ delete" sweep wipes the entire archive on its first C2 run (AGY 1 ≡ Codex 2, CONVERGED) | REAL — absence conflates "legit pre-C2 publication" with "crashed run's missing record"; §5b/R9 already treat pre-record runs as UNDECIDABLE, not orphaned | N10: the sweep predicate gains the VERSION FLOOR — delete an archive row ONLY if `SnapshotVersion >= stock_snapshot.version` AND its ArchiveRunId's N17 record is not-`Published`/absent. Legacy rows carry `SnapshotVersion` STRICTLY BELOW the current published version ⇒ always spared; pre-publication residue carries `SnapshotVersion >= published` (a crashed run intended the next version, ≥ current even if a correction consumed it) ⇒ caught. Combines the durable per-run marker with the version signal (AGY's exact fix, Codex concurred) |
| C2-R14-2 | The obsolete R2 rule "a durable committed main-ledger tombstone whose target's registry is committed to a DIFFERENT ControlId ⇒ quarantine (lost the race)" is now a REAPER: since R11 device tombstones stage in N18 and a race LOSER never reaches the main ledger, the only main-ledger tombstone whose registry ControlId differs is a legitimately SUPERSEDED one (registry now holds the Director's ctl:opId) ⇒ the rule silently purges valid superseded history (AGY 2) | REAL — the rule was correct in R2 (pre-N18, losers entered the ledger); R11 made it purely harmful; violates "history lives in the append-only control rows" | §8/§6: the R2 main-ledger "race loser" quarantine rule is DELETED. In R11+ a main-ledger tombstone is ALWAYS a legitimate commit winner (losers never re-mint); the C2-R13-5b N18 foreign-comp cell fully handles actual race-loser cleanup |
| C2-R14-3 | N17.`Published` has no authenticated mutation protocol: if RecordSig covers it, stamping it invalidates the original sig; if not, a SharePoint-direct flip to `true` is undetectable and spares real residue (Codex 1) | REAL — the R13 marker had no signing semantics | N17: `RecordSig` ('runrec-v1') covers ONLY the immutable fields {RunId, SnapshotVersion, InputDigest, TombstoneIds}; `Published` is a SEPARATE column carrying its OWN `PublishedSig` ('runrec-pub-v1' over {RunId, 'published'}). The sweep/reconcile treat `Published` as authoritative ONLY if `PublishedSig` verifies (a bare flip without the pepper ⇒ ignored, treated as not-published, fail-closed) |
| C2-R14-4 | A paginated registry walk is NOT a single linearization point: the export passes target T's low-id item while pending, the device CASes it committed during later pages, the walk completes but never revisits T ⇒ T billed present despite a committed deletion (Codex 3) | REAL — completeness + last-page attestation don't detect an in-place change on an already-passed page | §7b: the committed-registry observation is a DOUBLE-COLLECT — the export re-reads (a targeted query over its supplied identities) until TWO CONSECUTIVE complete collects are IDENTICAL; a pending→committed transition mid-walk is caught on the next collect (converges fast — commits over one export's target set are rare/bounded); no stabilization within a small bound ⇒ fail-closed, retry the export under a fresh lease |
| C2-R14-5 | The N18 "exact identity" check proved AUTHENTICITY (the existing row's EconSig verifies) not EQUALITY: the same owner reuses TransactionId X against the same target but with different sealed content (StoreId/timestamp/transfer) — the existing row verifies, so the retry is accepted as idempotent and commits DIFFERENT content than submitted (Codex 4) | REAL — two different rows can each carry a valid seal; verifying one proves nothing about the other's equality | §8/N18: on an N18 409, RECOMPUTE the incoming row's canonical and require BYTE-EQUALITY with the existing row's canonical (both must also verify) — only an identical resubmission is an idempotent own-retry; ANY sealed-content difference ⇒ reject + quarantine + surface (a mutated resubmission under a reused id is malformed/hostile) |
| C2-R14-6 | A foreign N18 409 leaves a stranded pending registry claim, and the TTL PROMOTE cell doesn't re-check N18 identity: a malformed request reuses X→B, creates registry-pending(B), 409s N18 (which holds X→A), crashes before cleanup ⇒ the scrub sees pending(B)+N18(X) and promotes, associating the foreign row with the wrong claim (Codex 5) | REAL — the 409-reject path didn't release its own pending; the promote cell trusted N18-presence without a target match | §8: (a) the N18-409 reject path CONDITIONALLY RELEASES the pending registry claim it just created (own-ETag, before quarantine/surface); (b) the PROMOTE cell (§6/§8) re-verifies N18 EXACT IDENTITY — the N18 row's `TargetTransactionId` MUST equal the registry claim's target (and TransactionId/owner/canonical) before promoting; mismatch ⇒ do NOT promote, delete the mismatched N18 row + release the claim |
| C2-R14-7 | The own-committed retry (and a scrub clause) still said "a committed main-ledger row lacking its CommitSig ⇒ mint it" — directly contradicting the R13 collision adjudication ("a signature-less protocol row is an integrity anomaly, never auto-signed"); an implementation could sign a foreign/injected signature-less row into pull-visible deletion authority — the exact R13 failure supposedly retired (Codex 6) | REAL — my R13 fold left the contradictory "mint it" text in two spots | §8/§6: the "mint missing CommitSig" auto-sign is DELETED everywhere. A committed-registry claim whose main-ledger row lacks a CommitSig is a COLLISION/integrity anomaly ⇒ collision adjudication (verify it IS this tombstone by canonical equality; if foreign ⇒ CONTROL_ID_COLLISION; a genuine own row mid-mint missing only the sig is impossible because CommitSig is minted BEFORE the insert) — never auto-signed |
| C2-R14-8 | CONTROL_ID_COLLISION fires AFTER the irrevocable registry commit but has no terminal recovery: the registry commits X for target A, an unrelated row already owns X, so every re-mint/retry/scrub re-hits the 409 forever and the export blocks A indefinitely — a permanently locked target (Codex 7) | REAL — detection was fail-closed-correct but had no exit | §8: a committed claim whose re-mint permanently 409s a FOREIGN same-TransactionId row ⇒ terminal `CONTROL_ID_COLLISION` anomaly, surfaced (stop re-scheduling the re-mint). The retire_claim ABSENT-ROW EVIDENCE lane (§5b) is EXTENDED to cover "own exact row absent AND a foreign same-TransactionId row present" — the Director retires the claim (unlocks A; the membership rule still decides the balance delta) |

**Q1v14-Q5v14 outcomes:** Q1v14 WITHDRAWN discriminator PASS by BOTH (closed); Q2v14 the durable
marker sound for C2 runs but killed legacy history + lacked signing (→ C2-R14-1/-3); Q3v14 identity
adjudication incomplete (equality vs authenticity; auto-sign contradiction; collision lifecycle)
(→ C2-R14-5/-7/-8); Q4v14 foreign-comp residue CONFIRMED closed by AGY — the stranded-pending +
promote-identity edge remained (→ C2-R14-6); Q5v14 both not-yet — both again affirm the N18 protocol
+ coordination architecture is ROCK SOLID; the residue is the R13-fold completions + two stale-rule
deletions.

---

## R15 fold record (2026-07-24) — BOTH BLOCK; 4 distinct REAL (2 converged pairs). Q2v15/Q3v15 CONFIRMED closed both.

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R15-1 | The R14 version floor `SnapshotVersion >= published` is wrong BOTH ways: (a) the FIRST C2 run's `stock_snapshot.version` EQUALS the last legacy run's version, so its legacy rows (== published, absent N17) are DELETED — the most recent pre-upgrade history wiped; (b) a crashed C2 run's residue at V+1, then TWO later publications (corrections/runs) to V+2, makes residue V+1 < published V+2 ⇒ SPARED forever; and (c) an unreadable current-run N17 turns uncertainty into deletion (AGY 1 ≡ Codex 1/2/3, CONVERGED) | REAL — archive rows and the published snapshot carry the SAME supplied version (archive-def:106/327), so the latest legacy run is at == published; the floor's monotonic assumption holds for only ONE later publication | DROP THE VERSION FLOOR. N10: the archive run writes its N17 record (`Published:false`) BEFORE copying ANY rows (so EVERY C2 run's rows — published or residue — have an N17 record). The sweep predicate becomes PRECISE and version-free: an archive row whose ArchiveRunId's N17 record is PRESENT AND not-verifiably-`Published` ⇒ delete (residue); ABSENT N17 record ⇒ definitively LEGACY (pre-C2) ⇒ ALWAYS SPARED; N17 record present but UNREADABLE/RecordSig-fail on a run that `stock_snapshot.runId` names as current ⇒ HALT the sweep (reconcile first — never infer non-publication from unreadability, Codex 3). The reconcile (snapshot.runId names an unPublished record ⇒ stamp it) runs BEFORE the sweep as before |
| C2-R15-2 | The R14 N18-mismatch promote rule "target mismatch ⇒ DELETE the mismatched N18 row + release the claim" is REVERSED-DANGEROUS: a cross-target 409 does NOT leave a foreign row in N18 — it 409s BECAUSE the legitimate winner's row is already there. So the scrub processing a stranded foreign CLAIM(B) finds N18 row X (owned by the WINNER, target A), sees A≠B, and DELETES the winner's legitimate pending tombstone — an attacker forges X→B, abandons it, and silently deletes a peer's real X→A deletion (AGY 2 ≡ Codex 4, CONVERGED) | REAL — my R14-6b had the ownership exactly backwards: the N18 row belongs to the unique-key WINNER, the mismatched CLAIM is the stranded loser | §6/§8: on an N18 target mismatch during a PROMOTE, the scrub ONLY releases the stranded registry claim being examined — it NEVER touches the N18 row (the mismatch PROVES the N18 row belongs to the unique-key winner, who holds its own claim or has committed). The N18 row is cleaned solely by ITS OWN claim's lifecycle. (Reverses C2-R14-6b) |
| C2-R15-3 | The R14-8 CONTROL_ID_COLLISION recovery is incoherent: (a) no durable registry state, so every retry/scrub re-mints and re-hits the 409 forever (target export-blocked, Codex 5); (b) the "retire_claim extended to foreign-same-id evidence" lane was never actually written into §5b, and §5b's P5/P7 unconditionally MERGEs+quarantines a tombstone row that (in the collision) is ABSENT — it would fail or mutate the FOREIGN row (Codex 6); (c) collision-retirement's TransactionId-only membership is AMBIGUOUS — X is not globally unique in a collision (own X→A vs foreign X→B), so `X ∈ TombstoneIds` can restore +effect(A) wrongly ⇒ balance corruption (Codex 7) | REAL — the R14-8 lane was a sketch that didn't survive contact with the ABSENT-own-row + ambiguous-id reality | REDESIGNED around a PRE-COMMIT CHECK: before the commit CAS (pending→committed), the route queries the MAIN ledger for the tombstone's TransactionId; PRESENT ⇒ the id collides with an existing row ⇒ the tombstone is FORGED/malformed (legit ids are globally unique) ⇒ REJECT before the irrevocable commit (release the pending claim, quarantine the push, delete N18, target STAYS PRESENT — no committed-uninstantiable state ever forms). The R14-8 retire_claim extension is WITHDRAWN (§5b reverts). The astronomically-impossible post-commit race (a colliding id landing in the µs window after the check) ⇒ a durable registry `collision` state (§4) that STOPS all re-mint/retry/scrub re-attempts, surfaces, and SELF-RESOLVES to release the claim (a forged deletion never had economic effect ⇒ target present, NO membership lookup, NO balance delta — dissolving the Codex-7 corruption) |
| C2-R15-4 | The retry/collision completion checks CommitSig PRESENCE, not VERIFICATION: a crash leaves main+N18, then the main row's CommitSig is SharePoint-edited (EconSig + canonical still valid); the retry treats it as the prior successful insert, deletes N18, returns ok — but N13 permanently WITHHOLDS the row (CommitSig fails to verify) ⇒ invisible-forever legitimate deletion, no staged copy left (Codex 8) | REAL — R14-7 said the sig is "always present," never said "must verify" | §8: the retry/collision completion VERIFIES the committed main row's `CommitSig` (ctlcommit-v1). A row provably OURS (canonical byte-equal + EconSig verifies) but with an invalid/corrupt CommitSig ⇒ RE-MINT the CommitSig (safe — we own it, refines R14-7's "never auto-sign" which applies to FOREIGN/unverified rows only); N18 is NOT deleted until the committed main row FULLY verifies (canonical + EconSig + CommitSig). A non-ours row ⇒ CONTROL_ID_COLLISION (§8) |

**Q1v15-Q5v15 outcomes:** Q1v15 the version floor NO both ways by both (→ C2-R15-1; AGY gave the
N17-before-copy fix, Codex concurred); Q2v15 the R2/auto-sign deletions CONFIRMED closed by AGY —
CommitSig-verify + collision lifecycle were the residue (→ C2-R15-3/-4); Q3v15 PublishedSig
integrity CONFIRMED by AGY — the absent/unreadable-marker halt was Codex's refinement (→ C2-R15-1c);
Q4v15 double-collect + canonical-equality CONFIRMED sound by both — the foreign-promote was
destructive (→ C2-R15-2); Q5v15 both not-yet — both again affirm the core; the residue is the
version-floor replacement + the collision lifecycle.

---

## R16 fold record (2026-07-24) — BOTH BLOCK; 4 distinct REAL (3 converged pairs). Q2v16 promote CONFIRMED closed both.

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R16-1 | The R15 N17-marker sweep is unsafe BOTH ways: (a) a legit PUBLISHED old run whose `PublishedSig` is corrupted/stripped reads as "present + not-verifiably-Published" and — since the HALT only guards the CURRENT run — its ENTIRE archive history is silently PURGED (AGY 1 ≡ Codex 2); (b) a crashed run whose N17 record is DELETED reads as "absent ⇒ legacy" and its residue is SPARED forever (Codex 1). Any list-access actor can weaponize the sweep into a history-reaper | REAL — inferring residue-vs-legacy from a mutable/deletable per-run marker is unsafe in both directions; matches the P-13 threat (list-access tampering is NOT defended by convenience controls) | TWO-PART: (a) RESIDUE IS RENDERED INERT — ALL archive READERS (membership §5b, export §7b, snapshotCompute input, the unit-move copy) filter to rows whose ArchiveRunId's N17 is PRESENT with a VALID `Published`+`PublishedSig`; an unpublished/unverifiable run's rows are NEVER read/billed/re-copied (so unswept residue is harmless — closes Codex-1 without any deletion); (b) the SWEEP IS NON-DESTRUCTIVE-ON-AMBIGUITY — it deletes ONLY rows whose N17 shows `Published:false` with a VALID `RecordSig` AND the run is stale AND not-current; ABSENT record, unreadable `RecordSig`, or a present-but-unverifiable `PublishedSig` on rows-that-exist ⇒ HALT + surface a TAMPER ALARM, NEVER delete and NEVER silently exclude (a reader hitting the same ⇒ HALT too). Marker DELETION/corruption by a list-access actor = the P-13 threat class, banked for server-side enforcement; acceptable for the trusted alpha under D-C2-2 (trial data, wiped at go-live) — Kunal-visible H14 |
| C2-R16-2 | The R15 PRE-COMMIT collision check queries ONLY the MAIN ledger, but TransactionId identity is GLOBAL across Live+Archive (the Director's own P4 collision check queries BOTH, frozen EXPORT-SCOPE:149). An attacker reuses an ARCHIVED TransactionId: the main-only check passes, the tombstone commits + inserts into Live, and MONTHS later when it becomes archive-eligible the unit-move's copy 409s on the archive unique key ⇒ the archive LA fails-closed forever ⇒ a DELAYED ARCHIVE-BRICKING TIME-BOMB; also export sees differing X across lists ⇒ DUPLICATE_ID_CONFLICT (AGY 2 ≡ Codex 3, CONVERGED) | REAL — the check must mirror the global two-list identity domain | §8: the PRE-COMMIT collision check queries BOTH `StockTransactions_Validate` AND `StockTransactions_Archive` for the TransactionId (exactly the Director P4 mirror); PRESENT in EITHER ⇒ the tombstone is forged/malformed ⇒ REJECT before the commit CAS (release claim, delete N18, quarantine, target present) |
| C2-R16-3 | The `collision` state LEAKS the N18 row and has no crash-safe lifecycle: self-resolve "releases the claim" but never deletes N18 ⇒ the no-registry-N18 scrub cell re-registers it to committed and re-mints ⇒ 409 ⇒ collision ⇒ release ⇒ INFINITE LOOP; and a crash after CAS-to-collision-before-release leaves the target permanently reserved (no recovery actor/TTL/CAS/N18-ordering defined; the scrub matrix has no collision cell) (AGY 3 ≡ Codex 4, CONVERGED) | REAL — the R15 collision state was a terminal label without a lifecycle | §4/§6/§8: entering `collision` DELETES the N18 row FIRST (eradicate the forged tombstone), THEN releases/marks the claim — order pinned. The scrub matrix gains the `collision` cell: a `collision`-state registry item ⇒ ensure N18 deleted + release (idempotent; crash-safe — re-entrant); a `collision` claim past TTL ⇒ released to idle. The no-registry-N18 scrub cell gains a guard: an N18 row whose TransactionId collides with an existing Live/Archive row ⇒ DELETE the N18 (forged), NEVER re-register (closes the loop) |
| C2-R16-4 | The SCRUB matrix cells "committed + BOTH main-ledger row and N18 ⇒ delete N18" still delete N18 WITHOUT verifying the main row's CommitSig — the retry branch was fixed (R15-4) but the two scrub copies weren't; a crash leaving main+N18 then a corrupted main CommitSig ⇒ scrub deletes N18, N13 withholds the invalid row ⇒ invisible-forever deletion, no staged copy left (Codex 5) | REAL — R15-4 fixed the retry path only | §6/§8 scrub: the "BOTH main+N18 ⇒ delete N18" cells now VERIFY the main row's CommitSig FIRST (invalid on a provably-own row ⇒ RE-MINT before deleting N18; never delete N18 until the committed row fully verifies — canonical + EconSig + CommitSig), mirroring the retry branch (C2-R15-4) |
| C2-R16-N1 | §11 still describes the retired R14 "version floor" probe (Codex reservation) | Fair — stale probe text | §11: the version-floor probe wording is redirected to the R16 record-before-copy / reader-filter sweep probes |

**Q1v16-Q5v16 outcomes:** Q1v16 the record-before-copy direction was right but the marker-tamper +
deleted-record edges were open (→ C2-R16-1); Q2v16 promote-release-only CONFIRMED CLOSED by BOTH
(3rd sub-question closed); Q3v16 the pre-commit check + collision lifecycle → C2-R16-2/-3; Q4v16 the
retry branch's CommitSig verify CONFIRMED sound by both — the scrub cells lagged (→ C2-R16-4); Q5v16
both not-yet — both again affirm the core is solid; the residue is the sweep tamper-safety + the
collision lifecycle completion.

---

## R17 fold record (2026-07-25) — BOTH BLOCK; 4 distinct REAL (3 converged pairs) + proof cleanup

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R17-1 | The R16 sweep+reader-filter is internally CONTRADICTORY and can't handle pre-C2 legacy OR physically-stranded residue: "absent N17 ⇒ HALT" bricks on the first legacy row; the reader-filter "read only verifiably-Published runs" SILENTLY EXCLUDES legacy rows (no N17) from settlements; N17 still says "absent ⇒ definitively legacy" — three incompatible outcomes for the same row. AND `Published:false` is UNAUTHENTICATED (RecordSig excludes it, PublishedSig signs the constant {RunId,'published'} not the boolean), so a one-field flip to false leaves both sigs valid ⇒ the sweep deletes legit history. AND an "ignored" deleted-marker residue row still PHYSICALLY occupies the archive unique-key ⇒ bricks a later unit-move (AGY 1 + Codex 1/2, CONVERGED — Codex asked for a "cutover marker" back in R15) | REAL — legacy-vs-residue is UNDECIDABLE from a deletable per-run marker; the boolean isn't signed; a read-filter can't neutralize a storage-level unique-key collision | THE ARCHIVE-C2-EPOCH (rides N16, C2-R17-1): record `archiveC2EpochId` = the archive list's max item id at the C2 archive-LA deployment (in PRODUCTION the archive is FRESH per D-C2-2 ⇒ epoch = 0, NO legacy exists; STAGING trial legacy sits below it). A row with archive-item-id ≤ epoch ⇒ definitively pre-C2 LEGACY ⇒ ALWAYS read AND spared (no N17 expected); > epoch ⇒ a C2 row ⇒ requires a VALID `PublishedSig` (its EXISTENCE+validity IS the published proof — the mutable boolean is ADVISORY; `Published:false` WITH a valid PublishedSig = contradiction ⇒ HALT+alarm) to be read/spared, else RESIDUE ⇒ inert AND SWEPT (physically deleted, so no storage-collision). The reader-filter reads: item-id ≤ epoch OR valid-PublishedSig. No ambiguity-halt on legacy (legacy is below-epoch by construction) |
| C2-R17-2 | Querying BOTH lists is necessary but NOT stable: the device pre-commit check isn't atomic and has no read order, so a concurrent archiver Live→Archive move slips a row past it (query Archive [empty, pre-move], archiver moves X, query Live [empty, post-move] ⇒ commit ⇒ X ends in both lists ⇒ DUPLICATE_ID_CONFLICT + archive-brick) (AGY 2 ≡ Codex 3, CONVERGED) | REAL — same write-dest-before-delete-source race the enumeration contract (C2-R10-1) already solved for reads; the pre-commit check didn't adopt the order | §8: the two-list pre-commit check uses the SOURCE-FIRST order **Live → Archive** (the archiver writes Archive before deleting Live, so a Live-first reader sees a mid-move row in Live, and a fully-moved row in Archive — the C2-R10-1 enumeration logic); PRESENT in either ⇒ reject before commit. Closes the residual window |
| C2-R17-3 | The scrub BOTH-cell (committed + main row + N18) verifies CommitSig "on a provably-own row ⇒ re-mint" but does NOT handle a FOREIGN main row: it falls through to "then delete N18" ⇒ the legitimate device's N18 tombstone is SILENTLY DELETED while the registry stays committed pointing at a foreign row (AGY 3; Codex Q4v17 PASSED it — AGY correct, the cell only named the own-row case) | REAL — the BOTH-cell established CommitSig validity but never established OWNERSHIP first | §6/§8 scrub BOTH-cell: FIRST establish the main row is OURS by CANONICAL EQUALITY (+ EconSig); if OURS ⇒ (valid CommitSig ⇒ delete N18; invalid ⇒ re-mint then delete N18); if FOREIGN ⇒ `CONTROL_ID_COLLISION` — enter the collision state (delete-N18-first path is NOT taken; N18 is PRESERVED because the foreign row is the collision, our N18 is the legit staged copy) + surface; NEVER delete N18 against a foreign main row |
| C2-R17-4 | §4's `collision` state text says it "STOPS … scrub", but §6/§8 RELY on the scrub's collision cell to delete N18 + release after a crash ⇒ an implementation following §4 never dispatches a crashed `collision` item to the scrub ⇒ N18 + reservation stranded forever; also `TtlAt` is described as pending-phase-only though collision-TTL recovery is cited (Codex 4) | REAL — a normative contradiction between §4 and §6/§8 | §4: `collision` stops the RE-MINT/retry only, NOT the recovery scrub — the scrub's collision cell (delete N18 + release, TTL→idle) is EXPLICITLY the recovery actor; `TtlAt` applies to the `collision` state too (its TTL drives the crashed-collision recovery) |
| C2-R17-N1 | §11's proof suite still retains the retired version-floor + "absent ⇒ legacy" probes (Codex 2 tail) | Fair — stale probes | §11: those probes are redirected to the R17 archive-C2-epoch sweep/reader-filter probes |

**Q1v17-Q5v17 outcomes:** Q1v17 the sweep/reader-filter was incoherent for legacy + the boolean was
unsigned (→ C2-R17-1); Q2v17 both-list coverage right but not stable (→ C2-R17-2); Q3v17 the
delete-N18-first sequence CONFIRMED crash-safe by both — §4's scrub-stop text was the contradiction
(→ C2-R17-4); Q4v17 SPLIT — the scrub CommitSig-parity was right but the FOREIGN-main-row case
open (→ C2-R17-3); Q5v17 both not-yet — both again affirm the core; the residue is the archive-epoch
sweep model + three plumbing completions.

---

## R18 fold record (2026-07-25) — BOTH BLOCK; 5 distinct REAL. Q2v18 (pre-commit) + Q4v18 (collision recovery) PASS both. Epoch model CONFIRMED sound.

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R18-1 | The epoch sweep REINSTATES the history-reaper for C2 runs: because N17 is written BEFORE any row copy, natural residue ALWAYS has a valid-RecordSig N17 ⇒ an ABSENT/corrupt N17 on an above-epoch row is proof of TAMPERING, not a crash. But the R17 rule deletes above-epoch rows on "NO valid PublishedSig", which includes a DELETED/garbled N17 on an old PUBLISHED run ⇒ an attacker deletes/garbles an old run's marker ⇒ its history is SWEPT (AGY 1) | REAL — deleting on ABSENCE-of-proof (rather than POSITIVE proof of a crash) is exactly the R16 reaper in new clothes | N10: the sweep DELETES an above-epoch row ONLY on POSITIVE CRASH PROOF — a VALID `RecordSig` (the N17 record is authentic) AND NO valid `PublishedSig` (genuinely-not-published) AND stale AND non-current. An above-epoch row whose N17 is ABSENT or whose `RecordSig` is CORRUPT ⇒ HALT + tamper-alarm (NEVER delete — natural residue always has a valid RecordSig, so absence = tampering). Deletion now requires cryptographic proof of a crash |
| C2-R18-2 | Direct-to-archive SR-135 correction rows (an archived-target correction writes its control row DIRECTLY into the archive, OUTSIDE an archive run, phase2/§5 P5.3) have NO ArchiveRunId/N17 ⇒ the R17 reader/sweep rule "every above-epoch row needs a valid PublishedSig" EXCLUDES them from settlement AND can SWEEP them as residue ⇒ a committed correction whose control the export can't assemble (Codex 1) | REAL — I forgot the SR-135 direct-to-archive lane exists; those legit rows are above-epoch with no run marker | N10 reader/sweep: an above-epoch row is READ + SPARED if it is EITHER (a) under a run with a valid `PublishedSig`, OR (b) a CONTROL row with a valid `ctl-v1` seal AND a live manifest head (the correction's OWN publication proof — its P6 manifest publication IS its provenance; it needs no ArchiveRunId). The sweep NEVER deletes a validly-sealed control row with a manifest head. Direct-to-archive corrections are thus first-class, authenticated by their ctl-v1 seal + head |
| C2-R18-3 | The epoch capture is NOT ATOMIC against an old/in-flight archiver: N16 says "max archive id at C2 deployment" with no cutover sequence. Race (a): an old run copies rows unpublished, the cutover records a max INCLUDING them, the old run crashes ⇒ those copies are ≤epoch ⇒ spared forever as "legacy" while their live originals remain ⇒ divergence. Race (b): max captured first, an old run then writes legit rows ⇒ above-epoch, no N17 ⇒ excluded/swept/halt (Codex 2) | REAL — the boundary is only sound if captured under quiescence | N16: the epoch is captured by a QUIESCENT CUTOVER PROTOCOL — (1) DISABLE the legacy archive writer; (2) WAIT for `archive_state = idle` (no in-flight run) AND drive any crashed in-flight run terminal (its unpublished rows swept by the OLD path or the C2 sweep once the epoch is set); (3) record + `EpochSig`-seal `archiveC2EpochId` = the archive list's current max item id; (4) ONLY THEN enable the C2 archive-LA. No archive write straddles the boundary. Recorded with method + Kunal attestation (staging) / exact at production cutover (fresh, epoch 0) |
| C2-R18-4 | N17 STILL says "an ABSENT record definitively = pre-C2 legacy" — directly contradicting the epoch classifier (an absent record ABOVE the epoch = residue/tamper, NOT legacy); an implementation following N17 spares above-epoch residue ⇒ a physical unique-key collision bricks a later unit-move; following N10 sweeps it — no deterministic answer (Codex 3) | REAL — stale R15 sentence; the EPOCH is now the sole legacy classifier | N17: the "absent ⇒ legacy" sentence is DELETED. Legacy is classified SOLELY by `archive-item-id ≤ archiveC2EpochId` (N16); N17 presence/absence never classifies legacy-vs-C2. Propagated to membership (§5b), reader/sweep (N10), and the proof language |
| C2-R18-5 | The scrub BOTH-cell says a FOREIGN main row ⇒ "CONTROL_ID_COLLISION, PRESERVE our N18", but the very next `collision`-state cell says "ensure N18 DELETED" AND the no-registry loop-guard deletes a colliding N18 ⇒ "preserve N18" is UNIMPLEMENTABLE; the legit N18 is deleted anyway, contradictorily (AGY 2; Codex passed Q3) | REAL — and the resolution is that PRESERVE was wrong: a tombstone whose id is squatted by a foreign ledger row can NEVER materialize, so preserving it forever just strands it | §6/§8: the FOREIGN-main-row case ⇒ `CONTROL_ID_COLLISION`, DELETE N18 (the deletion cannot materialize — the id is taken), and SURFACE DISTINCTLY for Director review (vs the silent forged-tombstone case). The target STAYS PRESENT (the deletion never applied); the Director remedy = re-issue the deletion with a FRESH id. This makes the collision-state "delete N18" cell + the loop-guard CONSISTENT (no "preserve" contradiction). The distinction from the forged-own-tombstone case is only the SURFACING (loud Director anomaly vs quiet quarantine) |

**Q1v18-Q5v18 outcomes:** Q1v18 the epoch classifier CONFIRMED sound by both — the delete-predicate
(positive proof), the SR-135 direct rows, the cutover atomicity, and the stale N17 sentence were the
gaps (→ C2-R18-1/-2/-3/-4); Q2v18 source-first pre-commit PASS BOTH (closed); Q3v18 SPLIT — the
foreign-collision N18 contradiction (→ C2-R18-5); Q4v18 collision recovery PASS BOTH (closed); Q5v18
both not-yet — both affirm the core + the epoch model; the residue is the sweep completions.

---

## R19 fold record (2026-07-25) — BOTH BLOCK; 4 distinct REAL (2 converged pairs) + proof cleanup. Q4v19 foreign-collision PASS both.

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R19-1 | The R18 "positive crash proof" (valid RecordSig + NO valid PublishedSig + stale) is STILL forgeable-into-a-reaper: `PublishedSig` is a SEPARATE DELETABLE column (not covered by RecordSig), so an attacker DELETES an old PUBLISHED run's PublishedSig and its rows now match the crash profile exactly ⇒ reader excludes + sweep DELETES legit history. You cannot use the ABSENCE of a deletable signature as crash proof (AGY 1 ≡ Codex 1, CONVERGED — BOTH gave the same fix: query LIVE) | REAL — the converse of "record-before-copy ⇒ residue has a valid RecordSig" is FALSE: a valid record without a readable PublishedSig ≠ never-published | **USE ACTUAL LEDGER STATE, NOT A SIGNATURE (C2-R19-1):** the archive LA deletes from Live only AFTER publishing (Chunk-8; the N10 reconcile completes a published run's post-publish Live-delete BEFORE the sweep). So an above-epoch archive row is RESIDUE **iff its `TransactionId` is STILL PRESENT in the Live ledger** (a crashed-before-publish run never consumed its Live originals; a published run's originals are gone from Live). The sweep DELETES iff in-Live (a genuine duplicate — the Live original is the truth, nothing lost); SPARES everything NOT-in-Live (legit published history, direct-to-archive controls — all safe). This is NON-FORGEABLE (real ledger state; re-inserting a Live original requires a valid EconSig push + creates a caught duplicate) and DELETES the entire fragile signature-absence machinery. The engine's EXISTING dual-list dedup (TransactionId+IdempotencyKey, CHUNK8 item 5) already makes a transient in-both-lists duplicate economically inert — so residue is inert to readers WITHOUT the R17 signature reader-filter. PublishedSig/RecordSig retained only as the reader's advisory published-marker |
| C2-R19-2 | Direct-to-archive SR-135 control rows are spared only WHILE they have a LIVE manifest head — but control history is APPEND-ONLY, so a normal supersede/withdraw makes the former head non-live, and a crashed-before-publish direct correction never had a live head ⇒ a valid-sealed historical control row matches NONE of N10's accept clauses ⇒ hits the absent-N17 HALT ⇒ every supersede/withdraw/crash of a direct correction PERMANENTLY BRICKS the archive LA (AGY 2 ≡ Codex 2, CONVERGED) | REAL — head-liveness is the wrong test for SPARING (it's the right test for the EXPORT supplying an ACTIVE control, not for archive retention of append-only history) | RESOLVED BY C2-R19-1's Live-presence sweep: a direct-to-archive control row (born in the archive, no Live original) is NOT-in-Live ⇒ ALWAYS SPARED, regardless of head-liveness. Head state governs only whether the EXPORT supplies it as the ACTIVE control (the existing head check, §7b) — NEVER whether the sweep retains it. The R18 "valid seal + LIVE head" accept-clause is replaced by "not-in-Live ⇒ spared" (append-only history preserved) |
| C2-R19-3 | The quiescent cutover's "drive the crashed legacy run terminal" is CIRCULAR/undefined: it doesn't say how to identify+remove the crashed run's unpublished copies; if the epoch is sealed at a max INCLUDING them they become ≤epoch ⇒ spared forever as "legacy" while their Live originals remain ⇒ permanent duplicate/divergence (Codex 3; AGY passed Q3) | REAL — the post-epoch C2 sweep can't clean below-epoch rows (they're "legacy") | N16 cutover: step (2) is now EXPLICIT — before sealing, RUN THE LIVE-PRESENCE RESIDUE CLEANUP over the archive (delete every archive row whose TransactionId is still in Live — the crashed legacy run's unpublished copies) under the old path, VERIFY complete, THEN seal the max. No in-Live duplicate is ever sealed below the epoch. (The same Live-presence rule as C2-R19-1, applied once at cutover) |
| C2-R19-4 | §8's collision block STILL says the durable `collision` state "STOP all re-mint/retry/scrub re-attempts" — contradicting the R17-fixed §4 (stops re-mint/retry only; the scrub IS the recovery actor); an implementation following §8 never dispatches a crashed collision to the scrub ⇒ N18 + reservation stranded, target locked (Codex 4) | REAL — I fixed §4 at R17 but left §8's collision text saying "scrub" | §8: the collision block text is corrected to "STOP the RE-MINT/retry ONLY — the scrub's collision cell IS the recovery actor" (matching §4/C2-R17-4) |
| C2-R19-N1 | §11 retains historical references to the retired version-floor / absent⇒legacy / N18-preservation mechanisms (Codex reservation) | Fair — the supersession note prevents override but they should be repointed | §11: the retired-probe references are repointed to the current Live-presence sweep / not-in-Live-spare / foreign-collision-delete mechanisms |

**Q1v19-Q5v19 outcomes:** Q1v19 the signature-absence proof was forgeable → the Live-presence sweep
(→ C2-R19-1); Q2v19 active direct controls worked but superseded/withdrawn/crashed ones bricked →
Live-presence spares all not-in-Live (→ C2-R19-2); Q3v19 quiescence ordering right but legacy-run
terminalization undefined (→ C2-R19-3); Q4v19 foreign-collision resolution PASS BOTH (closed); Q5v19
both not-yet — both affirm the core + epoch + the (now Live-presence-based) sweep model; §8 text +
§11 cleanup remained.

---

## R20 fold record (2026-07-25) — BOTH BLOCK; 4 distinct REAL + note. Q4v20 (§4/§8 collision parity) PASS both. Live-presence DIRECTION confirmed.

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R20-1 | "in-Live" does NOT uniquely mean crashed-prepublish residue: a run that PUBLISHED then crashed MID-Live-delete (deleted row A, crashed before deleting row B) leaves B as PUBLISHED-legit archive history whose source is STILL in Live ⇒ the sweep deletes the legit archive B ⇒ the next run re-archives + re-folds B ⇒ DOUBLE-COUNT. The R19 note ASSUMED "reconcile completes the published run's Live-delete" but the normative reconcile only STAMPS an unpublished N17 — it never resumes Live-deletions (AGY 1 ≡ Codex 1, CONVERGED) | REAL — confirmed the archive workflow publishes BEFORE the Live-delete (archive-def:266), so a mid-delete crash is real; the reconcile didn't actually complete it | RECONCILE COMPLETION (N10): before the sweep, the reconcile — for the run named by `stock_snapshot.runId` (the last PUBLISHED run) — COMPLETES its post-publish Live-delete IDEMPOTENTLY: delete from Live every row ≤ the published snapshot's `cutoffId` (minus the retain-window) that is still present (this is resuming the archive LA's own delete phase; already-deleted rows are no-ops). After reconcile, a PUBLISHED run's source rows are GONE from Live, so a published archive row is reliably NOT-in-Live at sweep time. A crashed-PREPUBLISH run (never published) is untouched by reconcile ⇒ its sources remain in Live ⇒ correctly swept |
| C2-R20-2 | "same TransactionId in Live" is satisfied by a legitimate LATE REPLAY: a device resends an already-archived-and-Live-deleted transaction T; push succeeds (Live no longer has T) creating a NEW high-item-id Live row with T's TransactionId ⇒ the sweep sees T-in-Live ⇒ deletes the legit archive T ⇒ the replay is then folded on top of the snapshot that already has T ⇒ DOUBLE-COUNT (Codex 2) | REAL — TransactionId presence is not durable provenance; a replay mints a new item id under the same TransactionId | The sweep keys on the archive row's `SourceId` — its EXACT ORIGINAL Live item id, preserved immutably at archive time (Chunk-8) — NOT its TransactionId. Residue iff a Live row with item-id == the archive row's `SourceId` STILL EXISTS. A late replay mints a NEW item id ≠ the archive's SourceId ⇒ the original SourceId is gone from Live ⇒ the archive row is SPARED (the replay's new-id Live row is a separate dup that the engine's dual-list dedup handles). Durable provenance ties an archive row to its exact source, not a re-usable id |
| C2-R20-3 | N16 STILL says an above-epoch row "needs a valid Published N17 (or valid ctl-v1 + head)" — but N10 now retains EVERY not-in-Live row incl. superseded/withdrawn direct controls (which no longer own the active head); an implementation/cutover-validator following N16 rejects/blocks/excludes a valid superseded control ⇒ non-deterministic history preservation (Codex 3) | REAL — I updated N10's retention rule but left N16's inline parenthetical head-requirement | N16: the "needs Published N17 or ctl-v1+head" text is DELETED. N16 defines ONLY the epoch boundary (≤epoch = legacy). N10's not-in-Live-by-SourceId is the SOLE retention rule; head-liveness governs only the EXPORT's active-control selection (§7b), never archive retention. Propagated so N10, N16, §7b, and the cutover validator state ONE lifecycle |
| C2-R20-4 | The cutover cleanup is NOT fenced against ordinary Live pushes: Live presence can change while the cleanup classifies archive rows (a push re-inserts T right after the cleanup's not-in-Live check ⇒ the seal proceeds with both copies present ⇒ the next sweep hits C2-R20-2). AND the cutover has the same C2-R20-1 published-mid-delete gap for LEGACY runs (Codex 4; AGY 2 = the legacy-double-count variant) | REAL — the cutover classification window isn't isolated, and it inherits the same provenance/recovery gaps | N16 cutover: (a) key the residue-clean on `SourceId` (as C2-R20-2); (b) COMPLETE any published legacy run's Live-delete first (as C2-R20-1); (c) FENCE the push path (reject/queue Live mutations) for the classification+seal interval — the push LA is briefly paused, exactly like the archive writer, so no Live row appears/disappears mid-classification. The interval is short (a bounded scan) and one-time at cutover |
| C2-R20-N1 | H14 still carries stale marker-era "readers ignore ambiguous stray data" language though N10 now needs no reader-filter (Codex note) | Fair — stale prose | H14 rewritten to the Live-presence/SourceId model (no reader-filter; residue is inert via dual-list dedup + swept by SourceId) |

**Q1v20-Q5v20 outcomes:** Q1v20 the reconcile-completion gap + the TransactionId-vs-SourceId key
(→ C2-R20-1/-2); Q2v20 direct-control retention right at N10 but N16 contradicted it (→ C2-R20-3);
Q3v20 cutover fencing + published-legacy completion (→ C2-R20-4); Q4v20 §4/§8 collision parity PASS
BOTH (closed); Q5v20 both not-yet — both AFFIRM the Live-presence direction + the frozen premise; the
residue is the provenance key + the recovery completion.

---

## R21 fold record (2026-07-25) — BOTH BLOCK; 4 distinct REAL (1 converged pair). Q2v21 one-lifecycle confirmed.

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R21-1 | The reconcile/Live-delete uses a SCALAR `≤ cutoffId` predicate, but UNIT-MOVE archives a target's control/tombstone rows REGARDLESS of their own id/age — so a high-id paired tombstone T (archived with its old target) is LEFT in Live by the scalar delete (on EVERY successful run, no crash needed) ⇒ the SourceId sweep sees T's SourceId still in Live ⇒ DELETES the archive copy ⇒ when T later ages past cutoff the scalar delete finally removes it from Live too ⇒ T destroyed from BOTH lists ⇒ invisible-forever deletion + permanently locked target. Also Codex's over-deletion variant: a retain-window row below cutoff (not archived, not in the snapshot) gets Live-deleted by a later recompute with an advanced retain boundary (retainAfterTs not persisted) (AGY 1 ≡ Codex 2, CONVERGED) | REAL — the scalar cutoff cannot reproduce the run's EXACT archived set once unit-move moves off-cutoff rows; snapshotCompute.js:108 partitions on retainAfterTs (not persisted) | THE EXACT PER-RUN DELETION SET (N10): the Live-delete (and the reconcile completion) delete from Live ONLY the EXACT rows THIS run archived — identified by querying the archive for `ArchiveRunId == this runId` and extracting their `SourceId`s (the exact original Live item ids), deleting THOSE specific ids from Live. NO scalar cutoff/retain math. This deletes high-id unit-moved controls (they're in the run's archive set) and never over-deletes a retain-window row (it was never archived ⇒ not in the set). Idempotent (already-deleted = no-op) |
| C2-R21-2 | `SourceId` is NOT immutable/authenticated — it is a COPIED SharePoint COLUMN (archive-def:106), server-set at archive-move, NOT covered by the row's C1 `EconSig` (attestRows excludes it). A list edit changes an archive row's SourceId to point at an unrelated live item ⇒ the sweep deletes valid published history; or to a nonexistent id ⇒ residue spared forever. My "immutable" claim (and H14's "no hand-editable field") was FALSE (Codex 3) | REAL — SourceId is a data column, not the system item id, and unsealed | AUTHENTICATED PER-RUN MEMBERSHIP (N10/N17): the run's fidelity-hash (already extended to the full control form, C2-R6-4) is EXTENDED to COVER each copied row's `SourceId`, and the signed hash is the per-run membership authority. The Live-delete + sweep derive the exact SourceId set from the run's archive rows CROSS-CHECKED against the signed hash; a tampered SourceId breaks the hash ⇒ HALT + surface, NEVER delete. ⚠ archive-surface amendment (fidelity-hash canonical), flagged for the return re-audit |
| C2-R21-3 | The late REPLAY is spared in Archive (good) but STILL economically live: the new high-item-id Live row (id > cutoff) is applied by CLIENTS on top of the snapshot balance (index.html:1458 applies every row > cutoff) ⇒ CLIENT double-counts (server dedups Live-vs-Archive, clients don't) ⇒ silent client/server divergence; AND when that Live row later archives it COLLIDES with the archive's existing TransactionId ⇒ archive run fails repeatedly (Codex 1) | REAL — push-v2 dedups only against Live, not Archive; the replay-harmless assumption held for the engine, not clients | GLOBAL PUSH IDEMPOTENCY (N9/push-v2): push-v2 checks the TransactionId against Live AND Archive (global identity, mirroring the Director P4 domain). A push whose TransactionId matches an existing ARCHIVE row: exact canonical match ⇒ ACK without inserting a new Live row (the archived row is the truth); differing match ⇒ reject + quarantine + surface (a mutated replay under a reused id). No phantom Live replay row is ever created. ⚠ push-v2 amendment (N9), flagged |
| C2-R21-4 | §7b's headless-row blocker fires on a WITHDRAWN control: the withdrawn form is `controlHeads[target] = explicit null` (adjudicated — target PRESENT, SR-144), but the blocker "block a durable control lacking a head UNLESS the target has an ACTIVE head" treats explicit-null as not-active ⇒ blocks ⇒ `TOMBSTONE_PENDING_ADOPTION` on a fully-adjudicated withdrawal ⇒ settlement of T stuck (Codex 4) | REAL — an explicit-null entry IS adjudication, but the blocker checked for an ACTIVE head, not key-PRESENCE | §7b(4): the headless-row blocker applies ONLY when the target key is ABSENT from `controlHeads` (never adjudicated). A target with ANY manifest entry — including an explicit-null (withdrawn) head, detected via hasOwnProperty (the §6 engine test) — is ADJUDICATED history ⇒ NOT blocked (the export evaluates it PRESENT per SR-144). Aligns the blocker with the withdrawn-form semantics |

**Q1v21-Q4v21 outcomes:** Q1v21 the scalar-vs-unit-move deletion-set mismatch + the unauthenticated
SourceId (→ C2-R21-1/-2) + the replay economic residue (→ C2-R21-3); Q2v21 one-lifecycle CONFIRMED by
both (N16 head-req removed — closed); Q3v21 cutover fence right per AGY but inherits the deletion-set
+ SourceId gaps (→ C2-R21-1/-2, now shared with N10); §7b withdrawn-null blocker (→ C2-R21-4); Q4v21
both not-yet — both note the design is "extremely close"; the residue is the deletion-set precision +
provenance authentication + the two flagged push/§7b amendments.

---

## R22 fold record (2026-07-25) — BOTH BLOCK; 2 distinct REAL (both CONVERGED). Q1/Q3/Q4v22 confirmed. Both: design sound in C2 steady-state.

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R22-1 | The R21 "SourceId authenticated by the run's fidelity hash" has NO DURABLE ARTIFACT: the fidelity hash is a TRANSIENT pre-publication comparison (records.js:153, not persisted), and N17's `RecordSig` covers only {RunId, SnapshotVersion, InputDigest, TombstoneIds} — no archived-SourceId membership. So at reconcile/sweep time there is nothing signed to cross-check the queried `ArchiveRunId==R` set against ⇒ a tampered SourceId/ArchiveRunId is either trusted (mis-delete) or every mid-delete crash is unrecoverable. AND the LEGACY cutover demands "authenticated SourceId" for pre-C2 runs that NEVER sealed one / have no N17 ⇒ HALT-brick OR trust-unauthenticated paradox (AGY 1 ≡ Codex 1, CONVERGED) | REAL — I named an authentication authority (the fidelity hash) that isn't durably persisted or signed; and applied it to legacy rows that can't have it | (a) N17 gains `ArchiveMembersHash` — a signed hash over the run's EXACT archived-SourceID membership (the set of {SourceId} it copied), written BEFORE copying from the exact compute result, COVERED by `RecordSig` (durable authority, not the transient fidelity hash). The reconcile-delete AND the sweep VERIFY the complete `ArchiveRunId==R` queried set against `ArchiveMembersHash`; any mismatch (tampered SourceId/ArchiveRunId, missing/extra member) ⇒ HALT + surface, NEVER delete. (b) N16 LEGACY cutover: rows ≤ `archiveC2EpochId` have NO ArchiveMembersHash (pre-C2) ⇒ the cutover EXPLICITLY BYPASSES the authentication for legacy rows — accepting the unauthenticated legacy SourceIds as a DOCUMENTED, D-C2-2-bounded trial-data risk (production cuts over on a FRESH archive ⇒ NO legacy rows ⇒ the bypass is never exercised in production). H14 notes this |
| C2-R22-2 | Global push idempotency lives ONLY in the N9 deliverable table — the NORMATIVE push §8 still says "Non-tombstone rows: pipeline untouched" (so an implementation leaves ordinary rows checking Live only ⇒ the replay phantom returns) AND pins no read order (Archive-first then a concurrent Live→Archive move ⇒ both empty ⇒ phantom inserted anyway) (Codex 2) | REAL — the fold was in the deliverable summary but not wired into the normative sequence + missing the source-first order the tombstone check already has | §8 NORMATIVE: the GLOBAL IDEMPOTENCY check applies to ALL push rows (not just tombstones), in the SOURCE-FIRST order Live → Archive with COMPLETE reads (the same order + stability as the tombstone pre-commit check, C2-R17-2): a TransactionId matching an existing row — exact canonical match ⇒ ACK without a new Live row (idempotent); differing match ⇒ reject + quarantine + surface. Tombstone rows run this global check FIRST, then delegate to the §8 registry lifecycle (N18 claim → commit → re-mint). The "non-tombstone rows: pipeline untouched" text is replaced by "non-tombstone rows: global idempotency check, then the normal pipeline" |

**Q1v22-Q5v22 outcomes:** Q1v22 exact per-run deletion set CONFIRMED sound by both — the durable
authenticated membership was the gap (→ C2-R22-1); Q2v22 the SourceId authentication needed a durable
artifact + a legacy bypass (→ C2-R22-1); Q3v22 the global-idempotency CONCEPT confirmed by both — the
normative wiring + read order (→ C2-R22-2); Q4v22 withdrawn-head blocker PASS BOTH (closed); Q5v22
both not-yet — BOTH state the design is SOUND for all C2 STEADY-STATE ops; the residue is the durable
membership artifact + the normative push wiring (both "physical-design" completions).

---

## R23 fold record (2026-07-25) — BOTH BLOCK; ONE converged finding. Q2v23 + Q3v23 PASS both. Codex: "no other high-confidence defect found".

| # | Finding (source) | Ground truth | Fold |
|---|------------------|--------------|------|
| C2-R23-1 | The FULL-SET `ArchiveMembersHash` equality bricks on a legitimate MID-COPY crash: the hash covers the COMPLETE intended set (written before copying), rows copy INDIVIDUALLY (archive-def:99 Copy_loop), so a crash after 50-of-100 leaves a valid STRICT SUBSET under ArchiveRunId==R ⇒ H(partial) ≠ H(full) ⇒ the "mismatch ⇒ HALT, never delete" rule fires FOREVER — every mid-copy crash permanently bricks the sweep, and the stranded partial residue later collides a retry (AGY 1 ≡ Codex 1, CONVERGED — the FINAL finding; Codex: "no other high-confidence Contract-2 defect found") | REAL — a whole-set hash cannot authenticate a legitimate subset; both reviewers' fixes align (AGY: bypass unpublished; Codex: "authenticated subsets — such as a signed exact member list") | N17 stores the SIGNED EXACT MEMBER LIST **`ArchiveMemberSourceIds`** (the run's intended archived-SourceId list, written before copy, COVERED by RecordSig — replaces the bare hash; the hash added nothing the signed list doesn't). Verification is MODE-SPLIT: a PUBLISHED run (valid PublishedSig) ⇒ FULL-SET equality (its archive set is guaranteed complete — any deviation is tampering ⇒ HALT); an UNPUBLISHED run ⇒ PER-MEMBER subset verification — each queried `ArchiveRunId==R` row's SourceId must be **∈ the signed list** (∈ ⇒ authenticated crash residue ⇒ swept by the in-Live rule; ∉ ⇒ a tampered SourceId/planted row ⇒ HALT + surface). A legitimate partial copy always verifies (it IS a subset of its own signed intent); tampering never does. Subsumes AGY's bypass while keeping per-member authentication (a tampered residue SourceId still cannot misdirect a deletion). Reconcile-delete (published runs) unchanged: full-set equality |
| C2-R23-N1 | Deployment must ENFORCE the fresh-production premise (the legacy bypass + epoch-0 assume an empty archive at production cutover) (Codex Q2v23 reservation) | Fair — an acceptance pin | N16 cutover ACCEPTANCE: the PRODUCTION cutover runner VERIFIES the archive list is EMPTY (and the epoch therefore 0) before sealing — a non-empty production archive at cutover ⇒ HALT + Kunal decision (never silently proceed under the legacy bypass) |

**Q1v23-Q4v23 outcomes:** Q1v23 the durable authority CONFIRMED for published runs + mid-Live-delete
recovery — the mid-copy subset was the gap (→ C2-R23-1); Q2v23 legacy bypass PASS BOTH (closed; the
deployment premise → C2-R23-N1); Q3v23 normative global idempotency PASS BOTH (closed); Q4v23 both
not-yet — ONE converged finding stood between the design and the gate; Codex explicitly: "no other
high-confidence Contract-2 defect found."

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
| N1 | LA `bob-stock-correction-staging` | NEW Logic App (all SharePoint I/O, gates, CAS, journal execution; modes create / supersede / withdraw / adopt / retire_claim / reconcile) |
| N2 | Function route `correctionCompute` | NEW pure route (canonical digest, stamp minting via the engine's exported `foldProjection`, targetLine/originalEventAt capture, delta-exactness verify, candidate + manifest assembly, recovery DECISIONS incl. the manifest-content test) |
| N3 | List `ControlRegistry_Staging` | NEW — the SR-141 control-target reservation registry (`TargetTransactionId` Enforce-Unique) |
| N4 | List `CorrectionJournal_Staging` | NEW — correction journals; doubles as the idempotency store (`OpId` Enforce-Unique); carries heartbeat + the candidate HEAD |
| N5 | Coordination record v2 | EXTEND `archive_state` to the FIVE-state machine + request flags (§3) |
| N6 | Snapshot payload v2 | EXTEND `stock_snapshot.ConfigData` with `controlManifest` + `fence` (§7) |
| N7 | Control columns | ADD to BOTH ledger lists: `ControlId`, `ControlType`, `ControlRevision`, `BornPublicationVersion`, `TargetLine` (JSON text), `OriginalEventAt` (ISO text), `ControlState` (on a MAIN-LEDGER tombstone: `'committed'` or `'retiring'` only — `'pending'` is no longer a ledger value, it means "present in N18"; C2-R3-2 revised by C2-R11-1), `CommitSig` (the ctlcommit-v1 visibility AUTHORITY — C2-R4-5). Control rows are SEALED (`EconSig`, ctl-v1 frame — §7a); N18 pending rows carry the same columns but live off-ledger |
| N8 | `'correction'` sudo purpose | ADD to `SUDO_PURPOSES` + client prompt map (client half rides the next client wave) |
| N9 | push-v2-validate amendment | The SR-143-conformant tombstone claim + quarantine divert (§8); PLUS GLOBAL TransactionId IDEMPOTENCY (C2-R21-3): a push whose TransactionId matches an existing row in Live OR ARCHIVE — exact canonical archive match ⇒ ACK without a new Live row (the archived row is the truth), differing match ⇒ reject + quarantine + surface — so a late REPLAY of an archived+Live-deleted txn never creates a phantom high-id Live row (client double-count + later archive-collision). ⚠ flagged push-v2 amendment |
| N10 | Archive-LA scoped amendments | Carry `controlManifest`+`fence` forward on publish; refuse while a correction journal is non-terminal; state-vocabulary v2; CONDITIONAL releases (C2-R1-2); runIds SERVER-MINTED per `idle → run_active` acquisition (a GUID, never caller-supplied — C2-R10-2); STARTUP ORPHAN-SWEEP (C2-R11-4, predicate corrected by C2-R12-6 then C2-R13-2): a run publishes by stamping its N17 record `Published:true` immediately after the snapshot-CAS (outcome-by-read, still under the lock); the next run's FIRST acts after acquiring the lock are (a) RECONCILE a publish-then-crash — if `stock_snapshot.runId` names an N17 record that is not `Published`, stamp it (the live snapshot IS proof that run published) — then (b) run the ARCHIVE-C2-EPOCH sweep (C2-R17-1, resolving the R14-R16 legacy-vs-residue ambiguity at the ROOT — a per-run marker alone can NEVER distinguish "pre-C2 legacy [no N17]" from "crashed run whose N17 was deleted", so the CUTOVER BOUNDARY does it): classify each archive row by its immutable archive-item-id against `archiveC2EpochId` (N16). Item-id ≤ epoch ⇒ pre-C2 LEGACY ⇒ NEVER swept (spared unconditionally; no N17 expected). Item-id > epoch ⇒ a C2 row. **The sweep uses ACTUAL LEDGER STATE, not a deletable signature (C2-R19-1 — the R18 "valid RecordSig + no valid PublishedSig" proof was forgeable: PublishedSig is a separate deletable column, so deleting an old PUBLISHED run's PublishedSig made its history match the crash profile ⇒ reaper). The archive LA deletes from Live only AFTER publishing (Chunk-8, archive-def:266). TWO precise rules (C2-R20-1/-2): (A) **RECONCILE COMPLETION on the EXACT per-run set (C2-R21-1)** — before the sweep, the reconcile, for the run named by `stock_snapshot.runId` (the last PUBLISHED run), COMPLETES its post-publish Live-delete IDEMPOTENTLY by deleting from Live the EXACT `SourceId`s THIS run archived (query the archive for `ArchiveRunId == this runId` — this is a PUBLISHED run, so VERIFY the complete queried set by FULL-SET EQUALITY against the run's signed `ArchiveMemberSourceIds` (N17/C2-R22-1/C2-R23-1 — a published run's archive set is guaranteed complete; any deviation is tampering ⇒ HALT + surface, never delete), then delete those specific Live item ids). NO scalar `≤ cutoffId`/retain math (the unit-move archives high-id control/tombstone rows OFF the cutoff, so scalar delete would strand them; and retainAfterTs is not persisted, so scalar recompute over-deletes retain-window rows). Already-deleted = no-op. So a PUBLISHED run's archived source rows — INCLUDING high-id unit-moved controls — are reliably GONE from Live at sweep time. (B) **SWEEP KEYS ON THE AUTHENTICATED `SourceId`, NOT TransactionId (C2-R21-2)** — an above-epoch archive row is RESIDUE iff a Live row with item-id == the archive row's `SourceId` (its exact original Live item id) STILL EXISTS. `SourceId` is AUTHENTICATED by the run's DURABLE signed `ArchiveMemberSourceIds` list (N17/C2-R22-1/C2-R23-1) with MODE-SPLIT verification: a PUBLISHED run ⇒ full-set equality; an UNPUBLISHED (crashed) run ⇒ PER-MEMBER — each queried row's SourceId ∈ the signed list ⇒ authenticated crash residue (a legitimate mid-copy SUBSET always verifies — it is a subset of its own signed intent — so a routine mid-copy crash NEVER bricks the sweep), ∉ the list ⇒ a tampered/planted SourceId ⇒ HALT, never delete. A crashed-PREPUBLISH run's copies point at still-present Live originals ⇒ swept; a PUBLISHED run's ⇒ now-deleted ⇒ SPARED; a late REPLAY mints a NEW item id ≠ any archive `SourceId` ⇒ SPARED (and push-v2's global idempotency, N9/C2-R21-3, prevents the phantom Live replay row entirely). DELETES iff authenticated-SourceId-in-Live; SPARES everything else. Residue is economically INERT to readers via the engine's EXISTING dual-list dedup (TransactionId+IdempotencyKey, CHUNK8 item 5) — NO signature reader-filter needed. This DELETES the R17/R18 signature-absence machinery; PublishedSig/RecordSig remain only as the reader's advisory published-marker.** The reconcile (snapshot.runId names an unPublished record ⇒ stamp) runs BEFORE the sweep as before; persist each run's INPUT TOMBSTONE-SET RECORD to N17 (the EXACT set of tombstone TransactionIds present in the run's input universe — the adoption/retirement membership decider, C2-R3-3 revised by C2-R8-4 + C2-R10-3: the scalar max-id horizon could not prove prefix completeness under SharePoint's out-of-order ID visibility, sync.js:1837, and numeric coordinates are unknowable for absent rows); UNIT-MOVE PAIRED ARCHIVAL (C2-R4-E1 v3, revised by C2-R5-4 + C2-R6-3): snapshotCompute receives the active `controlManifest` and folds EFFECTIVE values (active-headed targets excluded; active-head control rows folded raw; historical control rows excluded; null-head targets folded normally); an ensemble archives AS A UNIT keyed on the TARGET alone passing the FULL archive predicate (id ≤ cutoff AND retention — the exact snapshotCompute partition); when the target qualifies, ALL its control/tombstone rows move IN THE SAME RUN regardless of their own ids/timestamps (control rows are never device-delivered; tombstone effects ride balances via guaranteed input-presence — strictly stronger than the retain-window pairing) — NO cutoff clamp, retention bounded by the target's own eligibility, SR-70 preserved by construction; the run's SELECT/copy mapping + re-read compare + fidelity-hash canonical EXTENDED to the FULL N7 control form (versioned, JSON-framed with TYPED values — `0`, `null`, and field-absent are three distinct encodings, C2-R7-5 — a copy dropping any control field breaks the hash BEFORE the live delete, C2-R6-4); the TOMBSTONE AUTHORITY GATE — an ALLOWLIST like N13 (C2-R7-4 + C2-R8-3): ONLY qualifying legacy-null (provenance < `tombstoneCommitEpochId`) or committed-with-valid-CommitSig tombstones ENTER compute (committed sigs batch-verified via attestRows pre-compute); EVERY other value — `pending`, `retiring`, unknown/future states, invalid sigs, post-epoch nulls — ⇒ the run REFUSES + surfaces (409, transient for pending/retiring — TTL scrubs drive them terminal; permanent + loud for tampering) — D8-7 economics only ever see ADJUDICATED tombstones; ACCEPTANCE ITEM: the §3 staleness-exit invariant proven for ALL five states at the staging crash drill (C2-R3-N2) — ⚠ amendments to Chunk-8-audited surfaces (incl. snapshotCompute), flagged for the return re-audit |
| N11 | attestRows new frames | EXTEND the C1 route with FIVE canonicals: `ctl-v1` (control seals, §7a), `ctlcommit-v1` (tombstone commit seals, §8/C2-R4-5), `epoch-v1` (the seal-epoch artifact, N16/C2-R4-7), `runrec-v1` (archive run records' immutable fields, N17/C2-R9-1), `runrec-pub-v1` (the N17 `Published` marker, N17/C2-R14-3) — ⚠ scoped amendment to the C1-audited function, flagged |
| N12 | Proof suite `test/correction-proof.js` + runner scripts | Pure-function probes + Kunal-executed staging apply/E2E (C1 pattern) |
| N13 | pull-v2-validate amendment | `ControlId eq null` filter — control rows never delivered to devices (C2-R1-13) — PLUS the tombstone ALLOWLIST (C2-R7-1, replacing the R3 pending-blocklist): `Type='deleted'` rows are delivered ONLY when ControlState is null-legacy (AND live-coordinate provenance < `tombstoneCommitEpochId`) or `'committed'` (AND CommitSig batch-verifies via attestRows); `pending`, `retiring`, and every unknown/future value are EXCLUDED BY CONSTRUCTION (invalid/absent sig ⇒ withheld + surfaced — C2-R4-5). Build proof: real-list OData null semantics + the full allowlist matrix — ⚠ flagged scoped amendment |
| N14 | buybackExport.js additive export | `foldProjection` exported (exports-only change to the frozen engine file, `reqId` precedent) — ⚠ flagged for the return re-audit |
| N15 | LA-CHANGES §1 amendment note | Topology snapshot writes join the coordination discipline (C2-R1-7) — ⚠ flagged scoped spec amendment |
| N18 | Device-tombstone pending list | NEW LIST `StockControlPending_Staging` (C2-R11-1): device tombstone PENDING copies stage here, NEVER the main ledger — invisible to pulls (N13 reads only the main ledger), absent from economics (snapshotCompute/D8-7 read only the main ledger), and NOT read by the export (§7b: a pending claim isn't adjudicated). `TransactionId` ENFORCE-UNIQUE; the pending insert is create-if-absent + outcome-by-read (a 409 ⇒ own claim already staged ⇒ proceed to the commit CAS — C2-R12-3). The commit-time re-mint inserts the tombstone into the MAIN ledger for the first time, then deletes the pending-list item (§8) |
| N17 | Archive run records | NEW LIST `ArchiveRunRecords_Staging` (C2-R9-1 hardened by C2-R10-2/-3 + C2-R13-2): one item per run — `{RunId (Enforce-Unique — create-if-absent + outcome-by-read on ambiguous writes), SnapshotVersion, InputDigest (canonical digest of the exact compute input; a matching-digest retry is idempotent, a differing digest is REJECTED — recomputation needs a fresh server-minted RunId), TombstoneIds (STABLE TransactionIds — [] = valid empty set), `ArchiveMemberSourceIds` (C2-R22-1 revised by C2-R23-1 — the SIGNED EXACT MEMBER LIST of the run's intended archived SourceIds, computed from the exact compute result and written BEFORE copying; COVERED by RecordSig — the DURABLE authority, replacing the R22 whole-set hash which could not authenticate a legitimate mid-copy SUBSET. Verification is MODE-SPLIT: PUBLISHED run ⇒ FULL-SET equality; UNPUBLISHED run ⇒ PER-MEMBER — each queried row's SourceId ∈ the list ⇒ authenticated crash residue, ∉ ⇒ tamper ⇒ HALT), `Published` (bool — stamped `true` right after the snapshot-CAS, outcome-by-read, under the lock; the DURABLE PER-RUN publication authority for the N10 orphan-sweep, C2-R13-2; a publish-then-crash is reconciled from `stock_snapshot.runId` at the next run's startup), `PublishedSig` ('runrec-pub-v1' over {RunId, 'published'} — C2-R14-3: `Published` is authoritative ONLY if PublishedSig verifies, so a SharePoint-direct flip without the pepper is ignored/fail-closed; a SEPARATE signature so stamping it doesn't invalidate RecordSig), RecordSig ('runrec-v1' — covers the immutable {RunId, SnapshotVersion, InputDigest, TombstoneIds, ArchiveMemberSourceIds} — C2-R22-1/C2-R23-1: the signed member list gives the sweep/reconcile a DURABLE authority that authenticates both full sets and legitimate subsets)}` — built from the EXACT snapshotCompute input array (never a re-read), **the record written + durable BEFORE the run copies ANY archive rows (C2-R15-1); legacy-vs-C2 is classified SOLELY by the archive-item-id epoch (N16/C2-R18-4 — N17 presence/absence NEVER classifies legacy), and the SWEEP's residue decision uses LIVE-PRESENCE not the N17 signatures (C2-R19-1); PublishedSig/RecordSig are the reader's advisory published-marker only**; `Published`+`PublishedSig` stamped AFTER the snapshot-CAS; verified on every read (RecordSig fail on a NON-current run / absent ⇒ membership UNDECIDABLE fail-closed; RecordSig-unreadable on the `stock_snapshot.runId`-current run ⇒ the sweep HALTS, never deletes), membership keys on the target's ArchiveRunId, retention indefinite |
| N16 | Seal-epoch artifact | ONE `AppConfig_Staging` item `ConfigType='seal_epoch'` `{epochId, tombstoneCommitEpochId, archiveC2EpochId, recordedAt, EpochSig}` — `archiveC2EpochId` (C2-R17-1) = the ARCHIVE list's max item id at the C2 archive-LA deployment: a row with archive-item-id ≤ this is pre-C2 LEGACY (read + spared unconditionally), > this is a C2 row (its RETENTION is governed SOLELY by N10's not-in-Live-by-`SourceId` rule — C2-R20-3: the R18/R19 "needs Published N17 or ctl-v1+head" text is DELETED here; head-liveness governs only the EXPORT's active-control selection, never archive retention). Captured by a QUIESCENT CUTOVER PROTOCOL (C2-R18-3 + C2-R19-3 + C2-R20-4, so no archive write straddles the boundary AND no residue duplicate is sealed): (1) DISABLE the legacy archive writer AND FENCE the push path (reject/queue Live mutations for the classification+seal interval — a bounded one-time pause, so no Live row appears/disappears mid-classification); (2) WAIT for `archive_state=idle`, COMPLETE any published legacy run's post-publish Live-delete via its EXACT archived set (N10 rule A — legacy Chunk-8 runs had no unit-move, so their set is the scalar ≤cutoff rows, but derive it from the run's archive rows for uniformity), THEN run the RESIDUE CLEANUP over the archive keyed on `SourceId` — delete every archive row whose `SourceId` still exists as a Live item id (a crashed legacy run's unpublished copies; the Live original is the truth). **LEGACY AUTHENTICATION BYPASS (C2-R22-1): pre-C2 legacy rows (≤ epoch) have NO `ArchiveMembersHash` (they never sealed one), so the cutover EXPLICITLY BYPASSES the membership-hash verification for them — accepting the unauthenticated legacy SourceIds as a DOCUMENTED, D-C2-2-bounded trial-data risk (PRODUCTION cuts over on a FRESH archive ⇒ zero legacy rows ⇒ the bypass is never exercised in production; only STAGING trial data is unauthenticated here).** VERIFY complete; (3) record + `EpochSig`-seal `archiveC2EpochId` = the current max archive item id; (4) ONLY THEN re-enable the push path and enable the C2 archive-LA. ACCEPTANCE (C2-R23-N1, Codex's deployment reservation): the PRODUCTION cutover runner VERIFIES the archive list is EMPTY (epoch therefore 0) before sealing — a non-empty production archive at cutover ⇒ HALT + Kunal decision, never a silent proceed under the legacy bypass. PRODUCTION cutover on a FRESH archive ⇒ archiveC2EpochId = 0 (no legacy), STAGING trial legacy sits below it (D-C2-2); covered by `EpochSig`; PLUS (C2-R3-4 revised by C2-R4-3/-5/-7): `epochId` = the LIVE list's first-sealed item id (the ONLY epoch — all provenance is live-coordinate; the R3 `archiveEpochId` is deleted); `tombstoneCommitEpochId` recorded at the N9 apply (the CommitSig legacy boundary); `EpochSig` = an `epoch-v1` attestRows seal over the values, verified on EVERY read (fail ⇒ `EPOCH_TAMPERED`). Derivation: PRODUCTION — recorded exactly at the D-C2-2 cutover (fresh lists, epoch = first item id); STAGING — backfill runner derives best-effort, recorded with method + Kunal attestation (H11). ACCEPTANCE (Codex Q2v5): `tombstoneCommitEpochId` must be INSTALLED BEFORE the N9 push amendment accepts its first protocol row — ordering build-proven |

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
- **Staleness-exit INVARIANT (C2-R2-1): every non-idle state has a defined takeover.** run_active:
  the Chunk-8 lock-staleness rule; export_lease: `ttlAt` expiry; correction_active: seize (§3a);
  correction_recovering: RE-SEIZE (§3a). No state can strand the machine on a crashed holder.

### 3a. Ownership, seize, and the publish fence (C2-R1-1/-2/-9/-10 + C2-R2-1/-9)
- **Acquire stamps identity (C2-R2-9):** the P2 CAS `idle → correction_active` writes `opId` (the
  client-minted id, known before any journal exists) + `owner` into the state. `journalId` is stamped
  at the post-create boundary re-stamp as before, but it is a FAST-PATH HINT only — never a recovery
  decision key.
- **Boundary re-assertion:** the owning worker re-stamps `heartbeatAt` via ETag-CAS at EVERY phase
  boundary (after journal create, after reservation claim, after candidate write, after verify, and
  IMMEDIATELY before P6). A failed re-stamp (state no longer mine) ⇒ the worker ABORTS (its journal
  is/was being recovered — it must not touch anything further).
- **Seize:** recovery NEVER acts on a fresh owner. Stale (`now - heartbeatAt > T-1`)
  `correction_active` ⇒ a recoverer CAS-transitions it to `correction_recovering(journalId,
  recoverer)`. The original worker's next boundary re-stamp then fails and it aborts.
- **Re-seize (C2-R2-1):** a stale `correction_recovering` (its `heartbeatAt` past T-1 — recoverers
  heartbeat at their own step boundaries) is seizable by a NEW recoverer: CAS
  `correction_recovering → correction_recovering(same journal scope, new recoverer, fresh
  heartbeat)`. Recovery is RE-ENTRANT by construction — every decision is by-read (§6), the fence
  bump is content-preserving and repeatable, and every terminalization step is idempotent — so a
  second recoverer redoing the first's partial work is always safe. The displaced recoverer's next
  own re-stamp fails and it aborts, exactly like a displaced worker.
- **The fence:** `stock_snapshot.ConfigData` gains `fence` (int). The recoverer's FIRST mutating act
  after seizing — BEFORE touching candidate rows, reservations, or journals — is a content-preserving
  snapshot MERGE bumping `fence` (new ETag). The owning worker's P6 publish uses the snapshot ETag
  captured AT ACQUIRE TIME (P2) and NEVER re-reads it; after a fence its CAS can never succeed. On a
  P6 CAS failure the worker may retry ONLY after re-asserting it still owns the state (a seized
  worker cannot); outcome decisions come from reads, never HTTP results (C2-R1-10, §5 P6).
- **Releases:** every release (P7, rollback, recovery completion — and the archive LA's, N10) is an
  ETag + content-conditional MERGE asserting the state is still the releaser's own. `IF-MATCH: *` is
  retired everywhere.
- **No-journal stale state (C2-R1-9, re-keyed by C2-R2-9):** after a seize, the recoverer queries
  `CorrectionJournal_Staging` by the state's **OpId** (Enforce-Unique — the id that provably exists
  at acquire). Journal found ⇒ recover it via §6 (regardless of whether the state's journalId hint
  was ever stamped). Genuinely absent ⇒ verify absence, scrub any reservation naming that OpId
  (belt; none can exist by ordering), release to idle. Keying on journalId alone would leak a
  journal created in the crash window before the post-create re-stamp (AGY R2-1's repro).

## 4. The control-target reservation registry (SR-138/141/143/144/147 + C2-R1-4/-5)

`ControlRegistry_Staging` — ONE item per target, spanning BOTH ledger lists. Columns:

```
TargetTransactionId (Text, Enforce-Unique + indexed)   ← the atomic claim primitive
State        'pending' | 'committed' | 'pending_supersede' | 'collision'   ← 'collision' (C2-R15-3
                                                       + C2-R17-4): a committed device claim whose
                                                       re-mint hit a FOREIGN same-TransactionId row
                                                       (post-commit, astronomically rare); STOPS the
                                                       RE-MINT/retry ONLY — NOT the recovery scrub
                                                       (the scrub's `collision` cell IS the recovery
                                                       actor: delete N18 + release; `TtlAt` applies
                                                       to this state, driving crashed-collision
                                                       recovery); resolves to target PRESENT, no delta
Owner, JournalId, TtlAt                                ← pending-phase fields
OpId                                                   ← pending-phase; RETAINED at committed for
                                                         device-origin items (C2-R2-6 — §8's retry
                                                         match needs it; it equals the tombstone id)
ControlId, Revision (int), PublicationVersion (int|null) ← committed-phase fields; null
                                                         PublicationVersion = "committed, NOT YET
                                                         ADOPTED" (device lane only)
PriorCommitted (JSON text)                             ← pending_supersede: the saved committed lock
Origin       'director' | 'device' | 'device-adopted'
```

(R4 note: the R3 `TargetInSnapshot` column is DELETED — C2-R4-1/-6: the normalization law makes
the in-snapshot decision a first-publication-only input, journaled in `AdoptionDecisions`, consulted
by nothing afterwards. A committed-unadopted claim whose tombstone row fails seal validation with
pre-epoch provenance is retirable via `mode:'retire_claim'` — C2-R4-8, §5b.)

**Identity retention during `pending_supersede` (C2-R9-3):** over a device-origin claim, the
TOP-LEVEL `OpId` and `ControlId` RETAIN the prior committed identity (the Director op's identity
lives in `Owner`/`JournalId`); §8's own matcher ALSO inspects `PriorCommitted.OpId/ControlId` as
a belt, so the own-pending_supersede branch is reachable even against a nonconforming write.

**The WITHDRAWN FORM (C2-R6-2)** — the registry state after withdraw OR retirement:
`committed(ControlId: null, Revision: advanced, PublicationVersion: the withdrawing/retiring
publication, OpId retained for device-origin)`. The manifest carries the explicit-null head; the
target is the current effective value. Re-correction = supersede with
`expected {activeControlId: null, revision, publicationVersion}`, transitioning through
`pending_supersede(PriorCommitted = the null-head form)` — rollback restores it. Identical
mechanics for withdraw-then-recorrect and retire-then-correct.

- Claim = item CREATE (Enforce-Unique makes the race atomic); transitions = ETag CAS.
- Director lifecycle (SR-143/147/149) unchanged from R1 design: `pending → committed` at publication;
  initial-create rollback deletes; supersede via `pending_supersede(PriorCommitted)` whose rollback
  RESTORES the prior lock; expected-revision CAS re-read after acquiring the state.
- **Device lifecycle (C2-R1-5 + C2-R2-4/-5/-6 + C2-R11-1 + C2-R12-2, SR-143-conformant):** see §8 —
  `pending(owner=deviceId, opId=tombstoneId, ttl)` → N18 row durable → commit CAS
  `committed(ControlId=tombstoneId, Revision: 0, PublicationVersion: null, OpId retained)` →
  re-mint (main-ledger insert + N18 delete). A conflict with an item whose `OpId` OR `ControlId`
  equals this tombstone's TransactionId is the device's OWN claim ⇒ idempotent re-entry (finish the
  staged step), never quarantine. Orphan scrubs cover the full matrix (C2-R2-4 + C2-R12-2):
  pending past TTL with NO N18 row and NO main-ledger row ⇒ deleted; pending past TTL WITH a durable
  N18 row ⇒ PROMOTE (run the `pending → committed` CAS then the re-mint — the transitions the
  crashed route would have made). Adoption (§5b) later CAS-fills
  `PublicationVersion`; until then, supersede/withdraw against the committed-unadopted claim ⇒
  refuse `TOMBSTONE_PENDING_ADOPTION` (remedy: `mode:'adopt'`, then retry against the then-known
  head — mirrors the export's fail-closed posture, C2-R2-6).
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
    mode: 'create' | 'supersede' | 'withdraw' | 'adopt' | 'retire_claim' | 'reconcile',
    opId,                                            // client-minted stable id (idempotency)
    targetTransactionId?,                            // absent for adopt/reconcile
    expected?: { activeControlId, revision, publicationVersion },   // supersede/withdraw;
                                                       // null-head baseline (post-withdraw/retire):
                                                       // activeControlId is EXPLICIT null (C2-R6-2)
    control?: { type: 'deletion' }
            | { type: 'replacement',
                row: { productId, qty, type, reason?, stockFrom?, stockTo?,
                       stockFromStoreId?, stockToStoreId? } }       // ECONOMIC identity only —
  } }                                                               // stamps/instants NEVER accepted
```

Response: `{ ok:true, controlId, revision, publicationVersion, deviceConvergencePending?: true,
affectedTarget?: <targetTransactionId> }` | `{ ok:false, reason, detail? }` — the convergence
fields (C2-R8-1, GENERALIZED by C2-R9-4) are set on EVERY mode whose published effective result
devices cannot locally reconstruct: retire_claim, withdraw-of-adopted-deletion,
supersede-of-adopted-deletion, and all Director create/supersede corrections (H7: devices never
receive control rows). ADOPT alone is exempt — the adopted tombstone was already device-delivered
and applied, so adoption changes no device-visible state. Stored in the journal's result, carried
by terminal-opId REPLAY, set identically by any recovering worker — the warning survives lost
responses and foreign-worker recovery.
Terminal-opId replay returns the stored result; digest mismatch under a reused opId ⇒ `OPID_REUSED`
(digest = JSON-array-framed canonical of mode + target + expected + control payload + actorUsername).

### Order of operations (mode create)

- **P0 gates.** Archive-LA triple gate with purpose `'correction'`.
- **P1 idempotency lookup — BEFORE any CAS.** Journal by OpId: terminal ⇒ stored result;
  non-terminal own ⇒ reconcile it (§6) and return the outcome; digest mismatch ⇒ `OPID_REUSED`.
- **P2 acquire.** Reconcile pre-pass: a non-terminal FOREIGN journal that is FRESH (journal
  heartbeat within T-1) ⇒ 409 busy; STALE ⇒ seize + recover first (§6). Then CAS
  `idle → correction_active(opId, owner)` — the acquire STAMPS the op identity (C2-R2-9, §3a),
  honoring live request flags. **Capture the stock_snapshot ETag + content NOW** — this ETag is the
  ONLY one P6 may use (§3a).
- **P3 fetch authoritative state.**
  1. Target row: query BOTH ledger lists. Absent ⇒ `TARGET_NOT_FOUND`; in both ⇒
     `TARGET_DUPLICATED` (fail closed); target is a control row or tombstone with `ControlId` head ⇒
     `TARGET_IS_CONTROL` (a tombstone target is legal only via the adopted-head supersede lane, §4).
  2. Target seal — the THREE-WAY caller-side contract (C2-R2-N2 + C2-R3-4 + C2-R4-3/-7;
     `verifyRow` returns booleans only, so the ROUTE makes the distinction): stored `EconSig`
     present + verify ok ⇒ sealed-valid; present + verify FAIL ⇒ `TARGET_SEAL_BROKEN` (fail
     closed); ABSENT ⇒ compare the row's **LIVE-LIST provenance id** (live `_spId` / archived
     `SourceId` — both are live-list coordinates; there is no archive-coordinate provenance
     anywhere in this design) against the SEAL-EPOCH ARTIFACT's single `epochId` (N16): ≥ epoch ⇒
     post-C1 ingest must have sealed it, so absence IS tampering (the seal-STRIP attack) ⇒
     `TARGET_SEAL_BROKEN`; < epoch ⇒ the legitimate pre-C1 unsealed lane. Artifact ABSENT ⇒
     `EPOCH_UNDEFINED`; artifact present but its `EpochSig` fails verification ⇒ `EPOCH_TAMPERED`
     — both refuse corrections on unsealed targets only (sealed targets unaffected). Mirrors the
     C1 sealed-pre-epoch contradiction rule and the engine's `coverage.stepsEpochId` precedent
     (buybackExport.js:738).
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
  - **Delta exactness (SR-142 + C2-R2-10):** per affected `(storeId, productId)`, the GENERAL LAW:
    **`delta = effect(new effective output) − effect(previous effective output)`**, where an
    uncorrected target's previous-effective is the target row itself and a deletion's output is
    nothing. Full mode table: create-replace `− effect(target) + effect(new)`; create-delete
    `− effect(target)`; supersede replace→replace `− effect(prevOutput) + effect(new)`; supersede
    replace→delete `− effect(prevOutput)`; supersede delete→replace `+ effect(new)`; withdraw
    `− effect(previousEffective) + effect(originalTarget)`; **null-head cells (C2-R6-2 — the
    re-correction baseline after withdraw OR retirement, where the TARGET ITSELF is the current
    effective value): null→replace `− effect(originalTarget) + effect(new)`; null→delete
    `− effect(originalTarget)`** (these derive the converged R5/R6 repro from the table: retire
    restores +10, supersede to +8 ⇒ −10+8 ⇒ +8 — no longer asserted, derived). `prevOutput` is
    read from the `PriorCommitted` head's control row, SEAL-VERIFIED before use. (The R1 text's
    `− effect(target)` applied to supersede would back the original out TWICE — AGY R2-2's worked
    example: +10 target replaced by +8 then superseded to +5 must land at 95, not 93.) Unaffected
    pairs bit-unchanged. **THE NORMALIZATION LAW (C2-R3-3 revised by C2-R4-1/-6):** the
    in-snapshot decision applies ONLY at the FIRST publication on an archived ensemble — it gates
    the single question "does the target's effect need backing out of (or restoring to) balances":
    Director creates ⇒ always yes (reaching create proves no prior tombstone AND no prior
    retirement — a retired target's registry item persists, so its lane is supersede — hence an
    archived create target is in balances); adoption ⇒ decided by the MEMBERSHIP rule (§5b), an
    already-excluded target's `− effect(target)` term is 0; retirement (`retire_claim` v2) ⇒ the
    membership rule on the RETIRED tombstone, restoring `+ effect(target)` where it had been
    excluded (C2-R5-1). The first publication NORMALIZES the ensemble — after it, the
    represented value ALWAYS equals the effective value — so EVERY subsequent chain cell applies
    the plain six-cell table UNGATED (each cell is exactly E_new − E_old; the R3 wording that
    gated later terms by current representation dropped the withdraw restore term — AGY R4-1's
    +10-excluded/adopt/withdraw repro must end at +10, and now does in both branches).
    Live-target ensembles adjust NO balances in ANY cell (manifest-only publications; live rows
    are never in balances, until the ensemble UNIT-MOVES to the archive — N10 v3 folds it at its
    EFFECTIVE value in that run, C2-R4-E1/C2-R6-3). The per-target adoption decisions are
    journaled pre-P6 (`AdoptionDecisions`, P4/P5.1 — crash-reproducible for the P6 candidate) and
    consulted by NOTHING after publication.
  - **Deterministic ids:** `controlId = 'ctl:' + opId (+ ':' + revision beyond 0)`; replacement
    output `TransactionId = 'corr:' + opId + ':' + revision`; collisions checked against BOTH lists.
  - Assembles the CANDIDATE HEAD-SET (C2-R1-7 + C2-R2-7): `CandidateHeads = {target: head-or-null,
    ...}` — EXACTLY the manifest entries this publication writes or changes (create/supersede: one
    head; withdraw: one EXPLICIT null; adopt: one head per folded tombstone; opportunistic
    adoptions ride the same map). Stored in the journal — THE recovery decision key — plus the new
    full `controlHeads` map (incl. any opportunistic tombstone adoptions, §7c).
- **P5 journal + candidate (publish-nothing until P6; boundary re-stamps per §3a throughout).**
  1. CREATE journal `{OpId (unique), JournalId, Digest, Mode, Target, ActorUsername,
     State:'pending', CandidateVersion, CandidateHeads (the head-SET, C2-R2-7), AdoptionDecisions
     (per-target in-snapshot map, C2-R4-6 — pre-P6, crash-reproducible), StepSetDigest, Payload,
     HeartbeatAt}`.
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
  manifest head explicit null; adopt + opportunistic adoptions: each adopted target's registry item
  CAS-filled `PublicationVersion = the publication version` — idempotent, re-run by recovery's
  roll-forward, C2-R2-6). Journal → `complete` + stored result. CONDITIONAL release → idle.

### 5b. Supersede / withdraw / adopt
Supersede/withdraw as R1 design (expected-revision CAS; append-only revisions; withdraw = no new row,
head → null, balances restore the target's effect; rollback restores `PriorCommitted`). **Adopt
(C2-R1-8 + C2-R3-1/-3/-5):** Director-gated like every mode; no target argument, no reservation
interplay; P4 builds a candidate folding ALL registry-committed unheaded device tombstones into
heads of THE CANONICAL SHAPE `{controlId: tombstoneId, revision: 0, bornPublicationVersion:
CandidateVersion}` (C2-R3-1 — the engine's exact field names, buybackExport.js:519; NO other head
shape exists anywhere in this design) after verifying each tombstone row exists in-list with a
VALID seal (an unsealed/broken claimed tombstone is surfaced + skipped, fail closed — a genuine
PRE-EPOCH one is retirable via `mode:'retire_claim'` below, after which the normal create/adopt
lanes open; a POST-epoch one is tampering and stays locked, loudly). **Balance delta PER TOMBSTONE
by snapshot-representation (C2-R3-3 + C2-R4-2/-6):** LIVE target ⇒ 0 (never in balances); ARCHIVED
target ⇒ decided by THE MEMBERSHIP RULE (the N17 `archive_run_record`, C2-R8-4/C2-R9-1/C2-R11-3):
the tombstone's stable **TransactionId** (from the ledger/archive row, or the registry-retained
TransactionId when the row is absent — NEVER a numeric `_spId`/`SourceId`, which R11 caught the
consumer still comparing against the string-id set, and which is unknowable for a vanished row)
**∈ the target's archiving run's recorded TombstoneIds set** ⇒ snapshotCompute already excluded
the target ⇒ 0; ∉ the set (the snapshotCompute.js:87-89 residual) ⇒ the target is in balances ⇒
`− effect(target)`; target's run predates the record ⇒ `ADOPTION_DELTA_UNDECIDABLE` fail-closed
(surfaced manual lane; vanishes at the D-C2-2 go-live wipe). Direct TransactionId membership —
the numeric ID-coordinate class is now absent design-wide. The per-target decisions are stored in the journal's `AdoptionDecisions` (P5.1) so the P6
candidate is crash-reproducible; after publication the NORMALIZATION LAW (§5 P4) makes every later
chain cell independent of them. **`retire_claim` v2 (C2-R4-8 redesigned by C2-R5-1/-2/-3 — A TRUE
PUBLICATION):** Director-sudo; legal ONLY against a committed-unadopted registry claim whose
tombstone row FAILS seal validation AND has live-coordinate provenance < `epochId` (genuine pre-C1
legacy; post-epoch unsealed = tampering, stays locked loudly). Mode gate + evidence validation at
P3 (NO mutation before P6, so every pre-commit crash leaves the gate's evidence intact — C2-R5-3).
The gate accepts TWO evidence forms: (a) the tombstone row FAILS seal validation with pre-epoch
provenance (the original lane); (b) the ABSENT-ROW EVIDENCE LANE (C2-R9-2) — a committed claim
whose row is provably absent from both lists AND quarantine (the journaled full enumeration IS
the evidence; the membership rule still decides the balance delta; undecidable ⇒ manual).
P4 builds `CandidateHeads = {target: explicit null}` (the withdraw form: adjudicated, no active
control, target PRESENT — non-empty, so P5.1 and the §6 per-entry recovery decision work
unchanged, C2-R5-2) plus the NORMALIZING delta via the same MEMBERSHIP rule applied to the RETIRED
tombstone (journaled in `AdoptionDecisions`): archived target whose tombstone is IN the archiving
run's recorded set ⇒ `+ effect(target)` (the exclusion is being adjudicated away — restore);
not-in-set or live ⇒ 0; undecidable ⇒ `RETIRE_DELTA_UNDECIDABLE` fail-closed manual (C2-R5-1). P5: journal +
registry → the WITHDRAWN form (§4; Revision advanced, prior state saved; rollback restores) +
**VISIBILITY WITHDRAWAL (C2-R6-1a): MERGE the tombstone row `ControlState='retiring'` — the N13
filter stops delivering it from this moment; REVERSIBLE (rollback restores the prior value) and
evidence-preserving (seal/provenance fields untouched — the C2-R5-3 property holds)**. P6
publishes manifest null head + normalized balances — THE COMMIT POINT. P7 QUARANTINES the
tombstone row (identity + list recorded in the journal; idempotent; completed by roll-forward)
and terminalizes. **Device-side scope (C2-R7-2 — the R6 "healing touch" is DELETED; its premise
was wrong: pulls are an immutable ID cursor, sync.js:1823, so no touch can re-deliver an old-ID
or archived row):** retirement restores SERVER truth — settlement, balances, and manifest are
correct and coherent; a device that had APPLIED the retired deletion locally understates that
product until the banked H7 re-delivery lane ships (or it re-syncs fresh). The retirement
response carries `deviceConvergencePending: true` + the affected target id so the Director knows
(H13). Per D-C2-2 this is a trial-data defence-in-depth lane; it vanishes at go-live. Retirement is a FIRST PUBLICATION under the §5 P4 law — the ensemble leaves it
normalized; the subsequent correction lane is SUPERSEDE against the null-head state
(expected-revision CAS, identical to re-correcting any withdrawn target — create still rejects on
the existing registry item). **Zero eligible tombstones ⇒ terminal no-op
BEFORE ANY WRITE (C2-R3-5):**
`ok: NO_PENDING_ADOPTIONS` + the surfaced skip list — no journal, no publication, state released;
a journal with empty `CandidateHeads` is invalid by construction (P5.1 refuses; recovery meeting
one ⇒ `INVARIANT_BROKEN`). Same journal/fence/publish-LAST discipline otherwise. Every OTHER
mode's P4 folds pending adoptions opportunistically (contributing zero ⇒ simply no adopted
entries — the host mode's own head still makes CandidateHeads non-empty), so adopt is rarely
needed explicitly (it exists so a settlement blocked on `TOMBSTONE_PENDING_ADOPTION` has a
Director remedy).

## 6. Reconcile / recovery (SR-139/143 + C2-R1-1/-7/-9/-10)

Invoked from: the route's P1/P2 pre-passes, explicit `mode:'reconcile'`, and REFUSAL guards in the
archive LA (which never recovers corrections itself — it 409s `correction_pending`). Procedure per
non-terminal journal (all under a SEIZED `correction_recovering` state, §3a; recoverer's first
mutating act = the FENCE write):

- **Decision (C2-R1-7 + C2-R2-7, by manifest CONTENT — `correctionCompute` decides, the LA
  executes):** read the active `controlManifest` and test the journal's `CandidateHeads` map
  PER-ENTRY with hasOwnProperty semantics (the engine's own test, buybackExport.js:517 — an
  explicit-null head matches only an explicitly-present null property; withdraw is distinguishable
  from never-written). ALL entries present with deep-equal values ⇒ published pre-crash ⇒ **ROLL
  FORWARD only** (idempotent P7, incl. the adopted targets' registry `PublicationVersion` fills).
  NONE present AND `version < CandidateVersion` ⇒ pre-publish ⇒ roll back (delete candidate row,
  release/restore reservation, journal `rolled_back`). Anything else — a partial match (impossible
  under the single-MERGE publish: its presence proves an out-of-protocol writer) or entries absent
  with `version >= CandidateVersion` ⇒ **`INVARIANT_BROKEN`** — fail closed: journal parked in a
  surfaced `needs_manual` state, coordination released, **archives/exports refused GLOBALLY**
  (C2-R2-8: one tenant-wide coordination record + one snapshot — the store-scoped wording of R1 was
  false; a LOUD full stop is the correct posture for a discipline violation) until a Director
  resolves. The state is unreachable while all snapshot writers honor the coordination discipline
  (N10/N15); the explicit state exists so a violation is LOUD, never a silent rollback.
- Freshness: recovery only ever engages STALE owners (§3a seize); fresh ⇒ 409 busy. A stale
  RECOVERER is itself re-seizable (§3a re-seize, C2-R2-1).
- Orphan scrubs (device claims, C2-R2-4 + C2-R3-2 + C2-R11-1/-2 + C2-R12-2 — the FULL
  `{registry × N18 × main-ledger}` matrix): registry pendings past TTL with no live journal
  (Director) ⇒ released/restored per lifecycle; registry PENDING past TTL with NO N18 row and NO
  main-ledger row ⇒ deleted; registry PENDING past TTL WITH a durable N18 row (device died after
  the N18 insert, before the commit CAS) ⇒ PROMOTE — but ONLY after re-verifying N18 EXACT IDENTITY
  (N18 target == the claim's target + txid/owner/canonical, C2-R14-6b; mismatch ⇒ ONLY release this
  stranded claim, NEVER delete the N18 row — it belongs to the unique-key winner, C2-R15-2); on a
  match ⇒ run the commit CAS then the re-mint (C2-R12-2); registry COMMITTED with a NON-NULL ControlId and only the N18 row ⇒ rolled FORWARD
  (the scrub RUNS THE RE-MINT: insert the committed main-ledger row at a fresh id, then delete the
  N18 item — §8; NEVER an in-place flip); with BOTH the committed ledger row and a leftover N18 row
  ⇒ FIRST establish the main row is OURS by CANONICAL EQUALITY + EconSig (C2-R17-3): OURS + valid
  CommitSig ⇒ delete N18; OURS + invalid CommitSig ⇒ RE-MINT then delete N18 (C2-R16-4); FOREIGN
  main row ⇒ CONTROL_ID_COLLISION (C2-R18-5): our tombstone can NEVER materialize (id squatted), so
  DELETE our N18 + SURFACE DISTINCTLY for Director (target PRESENT, remedy = re-issue with a fresh
  id) — consistent with the collision delete-cell + loop-guard; registry in the `collision` state ⇒
  ensure N18 DELETED then release, TTL ⇒ idle
  (C2-R16-3); the WITHDRAWN form `committed(ControlId:null)` with a leftover N18 row ⇒
  DELETE the N18 row, NEVER re-mint (resurrection guard, C2-R13-1); an N18 row whose target's
  registry is committed to a DIFFERENT ControlId or whose own claim is absent ⇒ DELETE the N18 row
  (lost race / crashed foreign-compensation, C2-R13-5b); an N18 row with NO registry item whose
  TransactionId COLLIDES with an existing Live/Archive row ⇒ DELETE the N18 (forged), NEVER
  re-register (loop guard, C2-R16-3); a committed main-ledger row lacking
  CommitSig ⇒ VERIFIED as a collision anomaly, never auto-signed (C2-R13-5a/C2-R14-7); **(the R2
  rule "a committed main-ledger tombstone whose registry ControlId DIFFERS ⇒ quarantine as a race
  loser" is DELETED — C2-R14-2: a main-ledger tombstone is always a legitimate commit winner since
  R11, and a differing ControlId means it was legitimately SUPERSEDED — quarantining it would purge
  append-only history);** a durable N18 row with NO registry item (the
  scrub-then-insert crash) ⇒ run its claim lifecycle: target unclaimed ⇒ register to committed +
  re-mint, target foreign ⇒ delete the N18 row (C2-R3-2); a committed-non-null registry item whose main-ledger row
  is absent under the enumeration contract (N18→L→A→Q, idle-stable — a row in N18 ⇒ PROMOTE not
  missing) ⇒ the `CONTROL_ROW_MISSING` anomaly — surfaced loudly, target stays locked (fail-closed)
  pending the Director's retire_claim absent-row lane (C2-R9-2); stale
  no-journal states per §3a (OpId-keyed, C2-R2-9).

## 7. Control storage, seals, manifest, and the export assembly contract

### 7a. Control seals (C2-R1-3 + C2-R2-2, ctl-v1)
`attestRows` gains a `ctl-v1` canonical frame (same keyring/pepper machinery, N11): covered fields =
`ControlId, ControlType, TargetTransactionId, ControlRevision, BornPublicationVersion, TargetLine
(canonical JSON), OriginalEventAt`, plus for replacements the output row's **FULL ENGINE ROW FORM**
(`TransactionId, StoreId, ProductId, Type, Qty, Date, Timestamp, Reason, StockFrom/To + ids,
TransferId, IdempotencyKey, UnitPriceAtTime, SellAtSupply, DiscAtSupply, PricingVersion,
CatalogueVersion`). **CLASS RULE (C2-R2-2): the replacement covered set is DERIVED from the
engine's row-form field enumeration (the buybackExport.js header contract) — every engine-read
field is covered by construction, never hand-picked.** The R2 audit proved the hand-picked set
missed `TransferId` (the HO-source decision, isHOSupply :180 reached from :659 for control rows)
and `UnitPriceAtTime` (retail profit, :649); sealing an ABSENT field ('' canonical) is exactly what
prevents its later addition. Signed server-side at P5.3; verified at P5.4 and by the export route
at assembly. A published control row failing verification ⇒ the export refuses to supply it ⇒
fail-closed conflict surfaced (`CONTROL_SEAL_BROKEN`). Engine-side seal enforcement is banked for
the return re-audit (the engine is frozen; route-side enforcement + the head check hold the line
meanwhile).

### 7b. The export assembly contract (pinned HERE, built later — C2-R1-6/-8/-13 + C2-R12-1)
Under its lease, the export route: (1) queries BOTH ledger lists for control-typed rows + `deleted`
rows targeting supplied identities (completeness-attested); THEN, as its FINAL observation, reads
`ControlRegistry_Staging` for COMMITTED claims over those identities via a **DOUBLE-COLLECT
(C2-R14-4 — a single paginated walk is NOT snapshot-isolated: a device could CAS a
low-id target to committed AFTER the walk passed it, and the walk would never revisit it): re-read
(a targeted query over the supplied identities) until TWO CONSECUTIVE complete collects are
IDENTICAL; a pending→committed transition mid-walk is caught on the next collect (converges fast —
commits over one export's target set are rare); no stabilization within a small bound ⇒ fail-closed,
retry the export under a fresh lease.** The registry, not row-presence, is the authority for "a
deletion is committed" (a device commit CASes the registry BEFORE its main-ledger re-mint and does
NOT hold the coordination state, so an export lease can overlap the crash window where the claim is
committed but no ledger row exists yet, C2-R12-1); a claim in the stable collect is CAUGHT, one
committing after is outside this settlement's window (the next export catches it). The
route does NOT read N18 (a PENDING registry claim is not adjudicated — it may lose a race and be
deleted — so it must never block an export); (2) supplies to the engine ONLY the control matching each ACTIVE manifest head (Director
controls: the head revision's row; device tombstones: a synthesized `{controlId: tombstoneId,
type:'deletion', targetTransactionId, revision: 0, bornPublicationVersion:
head.bornPublicationVersion}` from the manifest + the seal-verified tombstone row (C2-R3-1: the
head already carries the engine's exact field names — the assembly copies, never renames) —
historical revisions and withdrawn targets' rows are NEVER supplied; (3) EXCLUDES rows carrying
`ControlId` from the `rows` arrays (a control's row reaches the engine only inside its ctl); (4)
surfaces as the fail-closed PROVISIONAL blocker `TOMBSTONE_PENDING_ADOPTION` (Director remedy:
`mode:'adopt'`) ANY of: a durable tombstone/published control row LACKING a manifest head, OR a
committed registry claim with a NON-NULL ControlId (C2-R13-1: a `committed(ControlId:null)`
WITHDRAWN claim is ADJUDICATED — its explicit-null head means the target is PRESENT, so it must
NEVER block) over a supplied identity whose control has neither a materialized main-ledger row
nor an active head (the crash-window deletion, C2-R12-1: committed non-null ⇒ the deletion is
adjudicated-and-materializing ⇒ it MUST NOT bill as present mid-materialization), **UNLESS the
row's/claim's TARGET has ANY manifest entry — an ACTIVE head OR an EXPLICIT-NULL (withdrawn) head,
detected via hasOwnProperty (C2-R3-N1 + C2-R21-4: a withdrawn target is ADJUDICATED — target PRESENT
per SR-144 — so it must NOT block; the blocker fires ONLY when the target key is ABSENT from
controlHeads, i.e. never adjudicated) — an adjudicated target's stale headless rows are
COVERED, never permanent blockers (the seal-skipped pre-C1 case reaches adjudication via
`mode:'retire_claim'` — itself a null-head publication — then the supersede lane, C2-R4-8/C2-R5)**;
(5) verifies
every supplied control's seal **BY ORIGIN (C2-R2-3): a Director control row ⇒ its ctl-v1 seal; a
synthesized device-tombstone control ⇒ the tombstone ROW's C1 v1 seal (which covers Type +
TargetTransactionId — the deletion's whole economic content); the adoption-time fields (revision 0,
bornPublicationVersion) come from the server-owned manifest head, which IS their authority — no row
seal can or need attest fields that did not exist at push time.** Candidate-row visibility (C2-R2-N1 adjudication,
recorded): the export can NEVER observe a P5.3 candidate lacking its head — `export_lease` is
acquirable only from `idle`, so no export runs while a correction holds `correction_active`/
`correction_recovering`; rollback deletes candidates and a crashed correction HOLDS the state until
reconcile drives it terminal. A spec change to the §3 exclusion rules reopens this adjudication.

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

For each validated `Type='deleted'` row (STAGED VISIBILITY protocol, C2-R2-4/-5/-6 + C2-R3-2):
(1) registry CREATE `pending(owner=deviceId, opId=<tombstone TransactionId>, TtlAt)`; on conflict,
read the item — `OpId` OR `ControlId` equal to this tombstone's id, **OR the same match against
`PriorCommitted.OpId`/`PriorCommitted.ControlId` during `pending_supersede` (the §4 identity-
retention belt, echoed here per Codex R10-Q3v10)** ⇒ OWN claim (C2-R2-6 belt: committed items
retain OpId, §4), re-enter: if still pending, proceed; **if committed with a
non-null ControlId, the re-entry heals whatever the prior attempt left (C2-R4-4 + C2-R11-2 +
C2-R12-5 — NEVER an in-place flip; the retry is the primary healer, the scrub is the belt): only
the N18 copy exists ⇒ RUN THE RE-MINT (insert the committed main-ledger row at a fresh id — subject
to the COLLISION ADJUDICATION below if the insert 409s — then delete the N18 item); BOTH the
committed main-ledger row AND an N18 row exist (crash between insert and delete) ⇒ VERIFY the main
row's CommitSig then DELETE the N18 row (invalid CommitSig on this provably-own row ⇒ RE-MINT it
first, C2-R15-4); only the committed main-ledger row exists ⇒ VERIFY its CommitSig (valid ⇒ nothing
to heal; invalid on a provably-own row [canonical + EconSig verify] ⇒ re-mint the sig; a row that is
NOT ours ⇒ CONTROL_ID_COLLISION, never auto-signed — C2-R14-7/C2-R15-4); then answer via the normal
dedup path;
if the item is in the WITHDRAWN
form (ControlId NULL — a Director retired/withdrew this claim, §4) ⇒ the TERMINAL ADJUDICATED
BRANCH (C2-R7-3): answer `ok` with status `superseded_by_adjudication`, surfaced — NEVER insert,
recreate, or re-mark the tombstone; the device's queue drains; **own-committed with the ledger
row ABSENT under the ENUMERATION CONTRACT (C2-R9-2 + C2-R10-1 + C2-R12-4: STRICT SEQUENTIAL
**N18 → Live → Archive → Quarantine** — every mover writes its destination before deleting its
source [the re-mint N18→Live, unit-move Live→Archive, quarantine →Q], so a SOURCE-first walk
cannot miss a mid-move row — AND the coordination record reads `idle` with the SAME ETag before
and after the complete paged walk; any non-idle state or ETag change ⇒ transient retryable,
never terminal; a row found in N18 ⇒ PROMOTE, not missing) ⇒ `CONTROL_ROW_MISSING`: fail-closed,
TERMINAL for the device (stop retrying),
loudly surfaced for Director investigation — NEVER reconstruct (a resurrection has no evidence
of legitimacy); the Director remedy is retire_claim's ABSENT-ROW EVIDENCE LANE (§5b)**; if the
item is in
`pending_supersede` (a Director withdraw/supersede is IN FLIGHT over this claim) ⇒ the
OWN-PENDING_SUPERSEDE BRANCH (C2-R8-2): never insert, quarantine, or heal-MERGE mid-Director-op —
the device's operation had already committed (pending_supersede only wraps a PriorCommitted
claim), so if the ledger row exists answer via the normal dedup path (`ok`, already-applied —
correct under both the Director op's rollback and its roll-forward); row unexpectedly absent ⇒
transient retryable**; foreign ⇒ divert the row to
`StockTransactions_Quarantine` (`CONTROL_TARGET_RESERVED`, surfaced in the push response, never
silently dropped). (2) **Pre-insert ownership fence (C2-R2-5):** IMMEDIATELY before attest+insert,
re-read the registry item, assert it is still THIS tombstone's own live pending claim (own OpId,
unexpired), and RE-STAMP `TtlAt` (ETag CAS — a fresh TTL so the scrub cannot expire the claim
under a normally-paced insert). Absent / foreign / expired ⇒ quarantine divert, never insert. Then
the row is inserted **INTO THE PENDING LIST `StockControlPending_Staging` (N18/C2-R11-1) — NOT the
main ledger — so it is INVISIBLE to devices (N13 reads only the main ledger), absent from
economics (snapshotCompute/D8-7 read only the main ledger), and outside the ledger's Enforce-Unique
`TransactionId` key.** N18 is itself Enforce-Unique by `TransactionId`; **an N18 409 (C2-R13-4 — the
registry is unique by `TargetTransactionId`, N18 by `TransactionId`, DIFFERENT domains) is treated
as an own-retry ONLY after reading the existing row and confirming CANONICAL EQUALITY (C2-R14-5 —
verifying the existing row's `EconSig` proves only that IT was signed, NOT that it equals the
incoming row; two different rows can each carry a valid seal): recompute the incoming row's canonical
and require BYTE-EQUALITY with the existing row's (both must also verify). ANY difference — same
owner reusing `TransactionId` X against the same target but with changed StoreId/timestamp/transfer,
OR a different target entirely — ⇒ REJECT + CONDITIONALLY RELEASE the pending registry claim this
request just created (own-ETag, C2-R14-6a) + quarantine + surface; never idempotent, never leaves a
stranded claim.** (3) After the pending-list
row is durable, **PRE-COMMIT COLLISION CHECK (C2-R15-3 + C2-R16-2 + C2-R17-2): query BOTH lists for this tombstone's
TransactionId in the SOURCE-FIRST order `StockTransactions_Validate` (Live) → `StockTransactions_Archive`
(the GLOBAL two-list identity domain — the Director's P4 collision check, frozen EXPORT-SCOPE:149;
a MAIN-only check let an attacker reuse an ARCHIVED id and plant an archive-brick time-bomb). The
SOURCE-FIRST order makes the check STABLE against a concurrent archiver unit-move (which writes
Archive before deleting Live — C2-R10-1/C2-R17-2): a mid-move row is seen in Live, a fully-moved row
in Archive, so the check can never miss it. PRESENT in EITHER ⇒ the id collides ⇒ the tombstone is
FORGED/malformed (a legit device tombstone's TransactionId is globally unique per movement) ⇒ REJECT
BEFORE the irrevocable commit: release the pending claim, delete N18, quarantine the push + surface,
the target STAYS PRESENT (no committed-uninstantiable state ever forms).** Then CAS the registry
`pending → committed(ControlId=<tombstone TransactionId>, Revision 0, PublicationVersion null, OpId
retained)` — **this CAS is the COMMIT POINT** — then the **COMMIT-TIME RE-MINT (C2-R10-4 as
corrected by C2-R11-1 — the ledger's unique key forbids a same-id duplicate, so the tombstone
enters the main ledger EXACTLY ONCE, here):** mint the `ctlcommit-v1` COMMIT SEAL via attestRows
(`CommitSig` over `{TransactionId, TargetTransactionId, 'committed'}`, C2-R4-5), INSERT the
tombstone into the MAIN ledger for the FIRST time (`ControlState='committed'` + CommitSig — its
fresh high id sits ahead of every device cursor, so it is delivered exactly like any ordinary
row), THEN delete the pending-list item (write-before-delete across the two lists; a device
retry landing after the main insert but before the pending delete finds the committed ledger row
and just finishes the delete). **COLLISION ADJUDICATION (C2-R13-5a + C2-R14-7/-8): the main insert
is signed BEFORE it lands, so no legitimate crash yields a signature-less protocol row; if the
insert 409s (astronomically rare after the PRE-COMMIT check — only an id landing in the µs window),
read the colliding row — if it is THIS tombstone by CANONICAL EQUALITY (same TransactionId +
TargetTransactionId + byte-equal canonical + verifying EconSig) the prior attempt already inserted:
VERIFY its `CommitSig` (ctlcommit-v1, C2-R15-4) — valid ⇒ just delete N18; INVALID/corrupt on this
provably-own row ⇒ RE-MINT the CommitSig (safe: we own it) and only delete N18 once the committed
row FULLY verifies (canonical + EconSig + CommitSig); if the colliding row is a DIFFERENT row ⇒ the
durable registry `collision` state (C2-R15-3 + C2-R16-3 + C2-R19-4, §4): STOP the RE-MINT/retry ONLY
— NOT the recovery scrub (the scrub's collision cell IS the recovery actor, matching §4) — surface,
and SELF-RESOLVE in a PINNED ORDER — **DELETE the N18 row
FIRST (eradicate the forged tombstone so the no-registry-N18 scrub cannot re-register it into an
infinite loop), THEN release the claim** — a forged deletion never had economic effect, so the
target STAYS PRESENT (no membership lookup, no balance delta; the R14-8 retire_claim extension is
WITHDRAWN — §5b reverts). Crash-safe: a `collision`-state item is re-entrant (re-running the
delete-N18-then-release is idempotent); a `collision` claim past TTL ⇒ released to idle by the
scrub (§6 collision cell, C2-R16-3).** **The commit CAS lands on a FOREIGN state ⇒ COMPENSATE
(C2-R2-5/C2-R3-2): the pending-LIST row — which NO device has ever received (it was never in the
main ledger) — is deleted from N18 + surfaced; there is nothing to un-deliver, so a losing
tombstone can never delete the original on peer devices.** Crash recovery: retry (idempotent
re-entry at any step); the reconcile scrub (C2-R2-4 + C2-R11-2 + C2-R12-2 + C2-R13-1/-5 — the FULL
matrix by `{registry state × N18 row × main-ledger row}`): registry PENDING past TTL with no N18
row and no main-ledger row ⇒ deleted; registry PENDING past TTL WITH a durable N18 row (device
died after the N18 insert, before the commit CAS) ⇒ PROMOTE, but ONLY after re-verifying N18 EXACT
IDENTITY (the N18 row's `TargetTransactionId` == the registry claim's target, + TransactionId /
owner / byte-equal canonical, C2-R14-6b) — a mismatch ⇒ ONLY RELEASE this stranded registry claim,
**NEVER delete the N18 row (C2-R15-2 — the mismatch PROVES the N18 row belongs to the unique-key
WINNER for its own target; deleting it would destroy a legitimate peer tombstone, an attacker
cross-target deletion path); the N18 row is cleaned solely by ITS OWN claim's lifecycle**; on a
match ⇒ run the commit CAS `pending → committed` THEN the re-mint (C2-R12-2); registry COMMITTED with a NON-NULL
ControlId and only the N18 row ⇒ run the re-mint (insert the committed main-ledger row, then delete
the N18 item) — roll-forward, idempotent; registry COMMITTED (non-null) with BOTH the main-ledger
row and a leftover N18 row ⇒ FIRST establish the main row is OURS by CANONICAL EQUALITY + EconSig
(C2-R17-3): OURS + valid CommitSig ⇒ delete N18; OURS + invalid ⇒ RE-MINT then delete N18
(C2-R16-4); FOREIGN main row ⇒ CONTROL_ID_COLLISION (C2-R18-5): our tombstone can NEVER materialize
(id squatted), so DELETE our N18 + SURFACE DISTINCTLY for Director (target PRESENT, remedy = re-issue
with a fresh id) — consistent with the collision delete-cell + loop-guard; registry in the
`collision` state ⇒ ensure the
N18 row is DELETED then release the claim (idempotent), a `collision` claim past TTL ⇒ released to
idle (C2-R16-3); **registry in the WITHDRAWN form
`committed(ControlId:null)` [a Director retired/withdrew this claim] with a leftover N18 row ⇒
DELETE the N18 row — NEVER re-mint (re-minting would resurrect an aborted deletion, C2-R13-1); an
N18 row whose target's registry item is committed to a DIFFERENT ControlId, or whose own claim is
absent [a lost race or a crashed foreign-compensation delete] ⇒ DELETE the N18 row (C2-R13-5b);** a
committed main-ledger row lacking its CommitSig ⇒ a COLLISION/integrity anomaly, VERIFIED never
auto-signed (§8 collision adjudication, C2-R13-5a/C2-R14-7); the
§6 belts (a durable PENDING-LIST row with NO registry item — the scrub-then-insert crash,
C2-R3-2 — ⇒ reconcile RUNS the claim lifecycle for it: target unclaimed ⇒ [collision loop guard,
C2-R16-3: if the N18 TransactionId COLLIDES with an existing Live/Archive row ⇒ DELETE the N18,
NEVER re-register] else register to committed + re-mint; target foreign ⇒ delete the pending-list
row). **(The obsolete R2 rule "a committed
main-ledger tombstone whose registry ControlId DIFFERS ⇒ quarantine as a race loser" is DELETED —
C2-R14-2: since R11 a main-ledger tombstone is ALWAYS a legitimate commit winner [losers live only
in N18], and a differing registry ControlId now means the tombstone was legitimately SUPERSEDED;
quarantining it would purge valid append-only history.)** Registry unreachable ⇒ that tombstone (only) fails
retryable — the C1 fail-closed posture. **GLOBAL IDEMPOTENCY for ALL push rows (C2-R22-2, normative —
not just tombstones): BEFORE the normal pipeline, check the row's `TransactionId` against Live AND
Archive in the SOURCE-FIRST order Live → Archive with COMPLETE reads (the same order + stability as
the tombstone pre-commit check, C2-R17-2, so a concurrent unit-move can't slip a row past it) — an
exact-canonical match ⇒ ACK without inserting a new Live row (idempotent; kills the archived-txn
REPLAY phantom + its later archive-collision); a differing match under the same id ⇒ reject +
quarantine + surface. Tombstone rows run this global check FIRST, THEN delegate to the registry
lifecycle above (N18 claim → commit → re-mint); non-tombstone rows run it then the normal pipeline
(the R21 "pipeline untouched" is REPLACED).** ⚠ Scoped
amendments: the C1-audited push LA (N9) + the pull filter (N13 — the BUILD-PROOF item is the FULL
allowlist matrix on the real staging list incl. OData null semantics: legacy-null and
committed+valid delivered; pending, retiring, unknown values, invalid sigs, and post-epoch nulls
all withheld — synchronized with N13 v3, C2-R8-3). Devices receive peer deletions
only after commit — a visibility LATENCY of one push round-trip, never a correctness change (H10).

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

## 11. Draft artifacts (attack surface — build after convergence unless reviewers ask sooner)

**⚠ SUPERSESSION NOTE (C2-R12-7): the round-by-round additions below are a HISTORICAL log of what
each round's probes exercised. Where an early description names a mechanism later RETIRED, the
CURRENT normative form governs and the probe is re-pointed at it: (a) a losing/foreign device
tombstone ⇒ its N18 pending row is DELETED (never "lands in Quarantine" — it was never in the
ledger); (b) archive-run membership ⇒ TransactionId ∈ the N17 recorded set (never a numeric
`SourceId`/`_spId` "horizon" comparison — that class is gone); (c) device-tombstone visibility ⇒
the COMMIT-TIME RE-MINT into the main ledger (never an in-place `ControlState` MERGE/flip). An
implementation MUST meet the current forms; a probe still asserting a retired mechanism is itself
a defect (the R12 saboteur set re-anchors them).**

`correctionCompute` + `test/correction-proof.js` covering, minimum: digest/idempotency matrix; mode
gates incl. lazy adoption; targetLine via the REAL exported foldProjection (resolve-pinned case
explicitly); originalEventAt engine-equality; stamp precedence incl. C2-R1-11 identity and
STAMPS_UNRESOLVABLE; delta exactness (create/supersede/withdraw × live/archive); ctl-v1 seal matrix
(tamper every covered field); the FENCE/SEIZE crash matrix (every phase boundary × {owner stalls,
recoverer runs, owner resumes}, incl. the C2-R1-1 repro verbatim and the C2-R1-10 lost-ack repro);
recovery decisions incl. INVARIANT_BROKEN; the §8 device-claim crash/retry matrix (C2-R1-5 repro);
and ENGINE-COUPLING probes: every mintable control and every §7b assembly output must pass the FROZEN
engine's validation (incl. the C2-R1-8 device-tombstone path: adopted head ⇒ target removed;
unadopted ⇒ blocked PROVISIONAL, never mis-billed). R2 additions: the recoverer-stall re-seize
chain (owner dies → R1 dies → R2 completes, C2-R2-1); a COVERED-SET PARITY probe asserting ctl-v1's
replacement fields ⊇ the engine row-form enumeration (C2-R2-2's class, checked structurally so a
future engine field can't silently escape the seal); per-origin §7b(5) seal verification incl. an
adopted tombstone passing on its row-v1 seal (C2-R2-3); the two-way scrub + pre-insert fence +
foreign-CAS compensation matrix (C2-R2-4/-5); committed-item OpId retention + the
unadopted-supersede refusal (C2-R2-6); adopt/withdraw recovery via the head-SET incl. explicit-null
hasOwnProperty semantics (C2-R2-7); the AGY R2-2 supersede arithmetic repro verbatim (+10→+8→+5 ⇒
95, C2-R2-10); the P5.1-crash journal-by-OpId recovery repro (C2-R2-9); and the seal-strip probe
(EconSig deleted on a post-C1 row ⇒ TARGET_SEAL_BROKEN, C2-R2-N2). R3 additions: a HEAD-SHAPE
PARITY probe (published adopted heads pass the FROZEN engine's :517-519 comparison verbatim,
C2-R3-1); the Codex-R3-2 race repro against the staged-visibility protocol (stalled writer +
scrubbed claim + correction claim + resumed insert ⇒ the row stays invisible and lands in
Quarantine; plus the scrub-then-insert no-registry crash ⇒ registered-or-quarantined); the
adoption-delta matrix (live / archived-pre-horizon / archived-post-horizon / undecidable ×
subsequent supersede/withdraw chains, C2-R3-3 — the Codex B+10 repro verbatim); the seal-epoch
three-way + EPOCH_UNDEFINED refusal (C2-R3-4); and the empty-head-set no-op (explicit adopt with
zero eligible + the all-seal-skipped variant ⇒ NO journal exists, C2-R3-5). R4 additions: the
NORMALIZATION-LAW INDUCTION (every first-publication mode × every subsequent chain — the AGY R4-1
withdraw repro verbatim, both in-snapshot branches ⇒ +10); ID-COORDINATE probes (archived
tombstone `SourceId` vs horizon; archived target `SourceId` vs `epochId` — both R4 converged
repros verbatim); the crash-then-retry invisible-tombstone repro (commit CAS → crash → retry ⇒
retry completes mint+MERGE, C2-R4-4); the CommitSig matrix (SP-direct `ControlState` flip ⇒
withheld; valid commit ⇒ delivered; legacy pre-`tombstoneCommitEpochId` ⇒ delivered seal-free,
C2-R4-5); AdoptionDecisions crash-reproducibility (P6 candidate rebuilt from the journal alone,
C2-R4-6); EpochSig tamper ⇒ EPOCH_TAMPERED (C2-R4-7); the retire_claim matrix (pre-epoch unsealed
⇒ retire succeeds; post-epoch unsealed ⇒ refused locked, C2-R4-8). R5 additions: the FULL
retire-as-publication crash matrix (crash at every phase × retry/recovery — pre-P6 crashes leave
the gate evidence intact and roll back clean; post-P6 roll forward completes quarantine +
registry; the AGY R5-3 quarantine-evidence repro verbatim, C2-R5-3); the retire→supersede chain
arithmetic (the converged R5-1 repro verbatim: excluded +10 → retire(+10) → supersede(+8) ⇒ +8,
both horizon branches, C2-R5-1); paired-archival probes (a controlled ensemble is never split by
a cutoff; snapshotCompute's effective fold = the engine's assembly for every head state incl.
null-head/withdrawn; the client covering invariant `_spId ≤ cutoffId ⇒ effect in balances` holds
across archive cycles containing corrections — the Codex R5-3 client-divergence repro verbatim,
C2-R5-4); and the N9-ordering acceptance probe (tombstoneCommitEpochId installed before the first
protocol row). R6 additions: the visibility-withdrawal matrix (retiring tombstone excluded from
pull from P5 on; rollback restores delivery; the Codex R6-1 crash-window repro ⇒ no device can
apply a retired deletion post-P6, C2-R6-1a; the R6 healing-touch probe is DELETED with its
mechanism — C2-R7-2); null-head cell derivations (the R5/R6 converged repro DERIVED from the table; withdraw-
then-recorrect and retire-then-correct through the pinned expected tuple + pending_supersede
restore, C2-R6-2); unit-move probes (a fresh control row moves with its old target in one run —
the retainAfterTs split repro; REPEATED supersedes never defer the move — the unbounded-retention
repro; cutoff advances normally, C2-R6-3); and the archive round-trip control-form probe (every N7
field carried + re-read + hashed; a copy dropping any one ⇒ hash break BEFORE live delete,
C2-R6-4). R7 additions: the N13 ALLOWLIST matrix (null-legacy delivered; committed+valid-sig
delivered; pending/retiring/unknown/invalid-sig withheld — every cell, on the real staging list,
C2-R7-1); the lost-ack-then-retired device retry ⇒ terminal `superseded_by_adjudication`, no
insert/recreate (C2-R7-3); the AUTHORITY-GATE matrix (run refuses on pending/retiring input
tombstones; resumes after scrub; invalid committed sig ⇒ refuse+surface; the Codex R7-4
losing-tombstone repro verbatim ⇒ balances never diverge, C2-R7-4); and the typed-canonical
0-vs-null-vs-absent cases (C2-R7-5). R8 additions: retirement response fields present on success
AND on terminal replay (C2-R8-1); the own-pending_supersede retry × Director-op phase matrix
(retry before P6 / P6-P7 / after P7 × rollback / roll-forward ⇒ always one terminal answer,
never an insert, never a loop — the Codex R8-2 repro verbatim, C2-R8-2); the N10 allowlist matrix
mirroring N13's incl. an unknown-ControlState row ⇒ run refuses + surfaces (C2-R8-3); and
MEMBERSHIP-RECORD probes (the recorded set decides adoption/retirement deltas; the Codex R8-4
late-visible-lower-ID repro verbatim ⇒ the absent tombstone is ∉ the set and the delta is
correctly `− effect(target)`; pre-record runs ⇒ UNDECIDABLE, C2-R8-4). R9 additions: N17
round-trip probes (record built from the exact compute input; record-before-publish ordering
under crash at each side; empty-set vs absent-record distinguished; sig tamper ⇒ UNDECIDABLE,
C2-R9-1); the CONTROL_ROW_MISSING terminal + the retire_claim absent-row lane end-to-end
(C2-R9-2); own-identity retention through pending_supersede incl. the belt match against a
nonconforming top-level write (C2-R9-3); and deviceConvergencePending on EVERY non-adopt mode ×
fresh/replay/foreign-recovery delivery (C2-R9-4). R10 additions: the CURSOR-DELIVERY probe —
a peer whose cursor has advanced past a crash-delayed pending tombstone STILL receives the
committed re-mint (the Codex R10-4 invisible-forever repro verbatim, driven through the real
sync cursor + lookback semantics), plus the re-mint crash matrix (insert-then-crash ⇒ both copies
⇒ scrub deletes pending; commit-CAS-then-crash ⇒ scrub re-mints; duplicate-TransactionId
transient ⇒ N13 delivers exactly the committed copy, C2-R10-4); the ENUMERATION race probe (a
retry/reconcile running THROUGHOUT a unit-move and a quarantine move never concludes absence —
L→A→Q order + the idle-ETag stability interval; the converged R10-1 repro verbatim, C2-R10-1);
N17 identity probes (duplicate RunId rejected by Enforce-Unique; same-digest retry idempotent;
differing-digest retry REJECTED; server-minted ids only; SnapshotVersion coherence, C2-R10-2);
and TransactionId-membership probes incl. the absent-row retirement deciding its delta with the
row gone (C2-R10-3). R11 additions: the SEPARATE-PENDING-LIST protocol (a pending tombstone lives
in N18, never pull-visible, never in economics, never occupying the ledger unique key; commit
inserts into the MAIN ledger exactly once + deletes the N18 row; the Codex R11-1 unique-key repro
⇒ the insert never 409s because it is the tombstone's FIRST main-ledger appearance); the re-mint
crash matrix through N18 (commit-CAS-then-crash ⇒ retry AND scrub both RUN THE RE-MINT, never a
flip — the converged R11-2 repro that a peer past the old id still receives the committed row);
the §5b TransactionId-membership consumer (the converged R11-3 repro: a numeric id never matched
the string-id set ⇒ double-subtraction — now the TransactionId matches, delta 0); and the archive
ORPHAN-SWEEP (a crashed run's ArchiveRunId=R copies are deleted before the fresh run copies ⇒ no
target under two run ids, the Codex R11-4 repro). R12 additions: the EXPORT-vs-committed-N18-window
probe (export lease overlaps a device commit CAS whose main-ledger re-mint hasn't run ⇒ the
registry read surfaces `TOMBSTONE_PENDING_ADOPTION`, target never billed present, C2-R12-1); the
FULL `{registry × N18 × main-ledger}` scrub/retry matrix incl. the pending+N18-durable PROMOTE and
the both-copies N18-delete (C2-R12-2/-5); N18 Enforce-Unique + own-retry-409 outcome-by-read
(C2-R12-3); the N18→L→A→Q source-first enumeration repro (reader mid re-mint never false-missings,
C2-R12-4); and the version-based ORPHAN-SWEEP (post-N17/pre-publish crash residue
deleted, all history spared, C2-R12-6). R13 additions: the WITHDRAWN-form discriminator probe (a
`committed(ControlId:null)` claim with a leftover N18 row ⇒ N18 DELETED not re-minted [no
resurrection], and the export does NOT block it [not perpetual PENDING_ADOPTION] — the converged
C2-R13-1 repros, both sites); the DURABLE-PUBLICATION orphan-sweep (an archive run crashes at
intended V+1, a correction then publishes V+1 ⇒ the crashed run's N17 stays unPublished ⇒ its rows
swept; publish-then-crash-before-mark ⇒ reconciled from snapshot.runId — the converged C2-R13-2
repro); the export registry-read LINEARIZATION (final complete read after the ledger walk catches a
mid-export commit, C2-R13-3); the N18-409 cross-target identity repro (reused TransactionId for a
different target ⇒ rejected+quarantined not idempotent, C2-R13-4); and the main-ledger COLLISION
adjudication (a foreign row holding the TransactionId ⇒ `CONTROL_ID_COLLISION`, never signed) +
the foreign-compensation-crash N18 residue cleanup (C2-R13-5). R14 additions: the LEGACY-HISTORY
sweep-safety probe (a first C2 archive run over a Chunk-8 archive with absent N17 records deletes
NOTHING — version floor spares all `SnapshotVersion < published`, C2-R14-1); the SUPERSEDED-history
probe (a superseded device tombstone is NOT quarantined — the deleted R2 rule, C2-R14-2); the
Published-marker tamper probe (a SharePoint-direct `Published` flip without a valid `PublishedSig`
⇒ ignored/fail-closed, C2-R14-3); the double-collect linearization repro (a mid-walk
pending→committed transition on an already-passed target is caught by the second collect, C2-R14-4);
the N18-409 canonical-INEQUALITY repro (same id+target, changed sealed content ⇒ rejected, not
idempotent, C2-R14-5); the stranded-pending + foreign-promote repro (cross-target 409 crash ⇒ claim
released, promote refuses the mismatched N18, C2-R14-6); the auto-sign contradiction probe (no path
signs a signature-less main-ledger row, C2-R14-7); and the CONTROL_ID_COLLISION terminal-recovery
repro (a permanently-colliding committed claim ⇒ Director retire unlocks the target, C2-R14-8).
R15 additions: the LEGACY-vs-RESIDUE sweep probe (N17-written-before-copy ⇒ absent record = legacy
= spared on the FIRST C2 run at version==published; present-unPublished = residue = deleted even
when outpaced by 2 corrections; unreadable current-run record ⇒ HALT, C2-R15-1); the CROSS-TARGET
ATTACK repro (device stages X→A, attacker forges X→B + abandons ⇒ the scrub releases the stranded
B claim and A's legitimate X→A tombstone SURVIVES, C2-R15-2); the PRE-COMMIT collision reject (a
forged colliding id ⇒ rejected before the commit CAS, target present, C2-R15-3) + the impossible-
race `collision` state self-resolving to release; and the CommitSig-corruption repro (a
SharePoint-edited CommitSig on a provably-own committed row ⇒ RE-MINTED, N18 not deleted until the
row fully verifies, C2-R15-4). R16 additions: the SWEEP TAMPER-SAFETY matrix (an old published
run's PublishedSig corrupted ⇒ HALT+alarm NOT delete; a crashed run's N17 deleted ⇒ residue stays
INERT via the reader-filter, never billed; only a valid-RecordSig Published:false+stale+non-current
run's rows deleted — C2-R16-1); the ARCHIVED-ID pre-commit reject (a forged tombstone reusing an
ARCHIVED TransactionId ⇒ rejected by the two-list check, no archive-brick time-bomb, C2-R16-2); the
collision LOOP repro (post-commit collision ⇒ N18 deleted FIRST then claim released ⇒ the
no-registry scrub never re-registers ⇒ no infinite loop; crash-after-collision-CAS ⇒ scrub
collision cell completes it, C2-R16-3); and the SCRUB CommitSig-verify parity (the scrub's BOTH-cell
now re-mints a corrupt sig like the retry branch, C2-R16-4). R17 additions: the ARCHIVE-C2-EPOCH
sweep/reader probe (a below-epoch legacy row [no N17] is ALWAYS read AND spared — no brick, no
silent exclusion; an above-epoch residue row [no valid PublishedSig] is inert AND swept; a
`Published:false` flip WITH a valid PublishedSig ⇒ HALT contradiction; PRODUCTION fresh-archive
epoch=0 ⇒ no legacy, C2-R17-1); the SOURCE-FIRST pre-commit repro (a concurrent Live→Archive move
never slips an id past the Live→Archive check, C2-R17-2); the scrub FOREIGN-main-row repro (a
foreign row in the BOTH-cell ⇒ CONTROL_ID_COLLISION + N18 PRESERVED, never silently deleted,
C2-R17-3); and the §4 collision-scrub-recovery probe (a crashed `collision` item IS recovered by
the scrub cell + TTL, C2-R17-4). The retired version-floor/absent⇒legacy probes are REPLACED by
these (C2-R17-N1). R18 additions: the POSITIVE-CRASH-PROOF sweep probe (an old PUBLISHED run's N17
deleted/garbled ⇒ HALT+alarm, its history NOT swept — the reaper is closed; only valid-RecordSig +
no-PublishedSig + stale ⇒ delete, C2-R18-1); the DIRECT-TO-ARCHIVE SR-135 probe (a Director
correction's control row written straight to the archive [no ArchiveRunId] is READ + SPARED via its
ctl-v1 seal + manifest head, never swept, C2-R18-2); the QUIESCENT CUTOVER probe (both epoch-capture
races — an in-flight old run's unpublished rows, and a post-capture old-run write — are prevented by
disable→idle→seal→enable, C2-R18-3); and the FOREIGN-COLLISION resolution (a foreign-id-squat ⇒ N18
deleted + Director-surfaced, target present, re-issuable — no "preserve" contradiction, C2-R18-5).
R19 additions (these REPLACE the retired R17/R18 signature-absence sweep probes, C2-R19-N1): the
LIVE-PRESENCE sweep probe (a published run's PublishedSig DELETED ⇒ its rows are NOT-in-Live ⇒
SPARED, reaper dead; a crashed run's rows ARE in-Live ⇒ deleted; the Live original is the truth,
C2-R19-1); the DIRECT-CONTROL retention probe (a superseded/withdrawn/crashed direct-to-archive
control [not-in-Live, no live head] is SPARED as append-only history, never bricks the sweep,
C2-R19-2); the CUTOVER residue-clean probe (a crashed legacy run's in-Live archive copies are
deleted BEFORE the epoch is sealed, never sealed below it, C2-R19-3); and the §8 collision-scrub
recovery text-parity probe (C2-R19-4). R20 additions: the POST-PUBLISH-CRASH probe (a run publishes,
crashes mid-Live-delete ⇒ reconcile COMPLETES the Live-delete before the sweep ⇒ the published
archive rows are not-in-Live ⇒ SPARED, no double-count, C2-R20-1); the LATE-REPLAY probe (a device
resends an archived+Live-deleted txn ⇒ new item id ≠ the archive's SourceId ⇒ archive row SPARED,
the replay dup handled by dedup, C2-R20-2); the SUPERSEDED-DIRECT-CONTROL probe (retained by
not-in-Live regardless of head; N16/N10/§7b state ONE lifecycle, C2-R20-3); and the CUTOVER-FENCE
probe (a push during classification cannot change Live-presence mid-scan; published legacy runs'
Live-deletes completed first, C2-R20-4). R21 additions: the UNIT-MOVE DELETION-SET probe (a
high-id paired tombstone archived off-cutoff is Live-deleted via the run's EXACT SourceId set — not
scalar ≤cutoff — so the sweep never destroys it; and a retain-window row is never over-deleted,
C2-R21-1); the SOURCEID-TAMPER probe (an edited archive SourceId breaks the run's fidelity hash ⇒
HALT, never delete, C2-R21-2); the GLOBAL-IDEMPOTENCY replay probe (a resend of an
archived+Live-deleted txn is ACKed without a phantom Live row ⇒ no client double-count, no later
archive-collision, C2-R21-3); and the WITHDRAWN-HEAD export probe (an explicit-null head target is
NOT blocked by TOMBSTONE_PENDING_ADOPTION, C2-R21-4). R22 additions: the DURABLE-MEMBERSHIP probe
(a tampered archive SourceId/ArchiveRunId ⇒ mismatch vs the signed `ArchiveMembersHash` ⇒ HALT, and
a mid-delete crash recovers by verifying the queried set against it, C2-R22-1); the LEGACY-BYPASS
probe (a cutover over pre-C2 legacy rows with no ArchiveMembersHash proceeds under the documented
bypass, never HALT-bricks; production fresh-archive never hits it, C2-R22-1); and the NORMATIVE
GLOBAL-IDEMPOTENCY probe (an ORDINARY-row replay [not just a tombstone] is ACKed without a phantom
Live row, source-first Live→Archive, C2-R22-2). R23 additions: the MID-COPY-CRASH probe (a run
crashes after copying 50-of-100 ⇒ the partial set verifies PER-MEMBER against the signed
`ArchiveMemberSourceIds` ⇒ swept clean, NO halt, NO brick — the AGY/Codex converged repro verbatim;
a planted/tampered residue SourceId ∉ the list ⇒ HALT, C2-R23-1); the PUBLISHED full-set-equality
probe (a published run's deviated set ⇒ HALT); and the PRODUCTION-EMPTY cutover acceptance probe
(non-empty production archive ⇒ HALT + surfaced decision, C2-R23-N1).

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
- **H9 (Kunal-visible, C2-R2-8):** if the `INVARIANT_BROKEN` state is ever reached (it requires a
  snapshot writer to have violated the coordination discipline — a should-never-happen), archives
  and exports stop NETWORK-WIDE, not per-store, until a Director resolves it. One coordination
  record + one snapshot means the blast radius is global by construction; the loud full stop is
  deliberate — a quiet partial continuation over a broken invariant is how money silently goes
  wrong.
- **H10 (Kunal-visible, C2-R3-2; mechanism corrected by C2-R10-4):** a device deletion now reaches
  OTHER devices only after the server commits its claim — in practice one push round-trip later
  than today (seconds-to-minutes; the deleting device itself sees it instantly). The delay is what
  guarantees a deletion that LOSES a race against a Director correction can never reach peer
  devices at all — before this fix, a losing deletion could permanently remove the original on
  every peer with no way back. The committed deletion is published as a FRESH row (the commit-time
  re-mint), so it is delivered by the ordinary sync path exactly like any new movement — the
  earlier design flipped the original row's state in place, which devices whose sync had already
  passed that row would never have seen.
- **H11 (C2-R4-7):** the STAGING seal-epoch value is a best-effort derivation recorded with its
  method and Kunal's attestation — trustworthy only under the assumption that staging wasn't
  already tampered at backfill time. Acceptable because staging holds trial data (D-C2-2); the
  PRODUCTION epoch is exact by construction (recorded at cutover on fresh lists).
- **H14 (Kunal-visible, C2-R16-1 revised by C2-R20):** the archive-cleanup job decides what is
  leftover crash-junk by DURABLE LEDGER STATE, not a deletable marker: an archived row is junk only
  if its exact original still sits in the live data (a crashed run never removed it); anything whose
  original is gone is kept as real history. The identity it matches on is cryptographically
  sealed into each run's integrity hash, so a hand-edit of that field breaks the hash and STOPS the
  job (it never deletes on tampered evidence), and a genuinely-crashed run's duplicate is both
  harmless (the app dedups it automatically) and cleaned up. A person with direct database access
  could still forge rows by hand (the same class of risk as editing the raw database) — covered by
  the planned server-side enforcement, acceptable for the trusted-staff alpha, and moot pre-launch
  since it's all trial data (D-C2-2).
- **H12 (C2-R4-E1 v3, revised C2-R6-3):** a corrected row archives on exactly the same schedule
  as any other row (its own age decides) — its correction rows simply travel with it in the same
  run. Snapshot balances, client stock counts, and settlements can never disagree about a
  corrected row: the archiver folds the corrected (effective) value, and no row below a published
  cutoff is ever excluded from it.
- **H13 (Kunal-visible, C2-R6-1 revised by C2-R7-2 + C2-R9-4):** every Director correction is
  immediately correct on the SERVER (settlements, balances, exports) — but devices don't receive
  correction rows (H7), so their LOCAL view of an affected product lags until the banked
  re-delivery lane ships or they re-sync fresh; the sync protocol's ID-cursor cannot re-deliver
  old rows, so there is no honest quick fix. EVERY such operation's response now says so
  (`deviceConvergencePending` + the affected target) — retirement, withdrawing or superseding an
  adopted deletion, and ordinary Director corrections alike; the warning survives replays and
  crashes. Per D-C2-2 the legacy lanes are trial-data defence-in-depth and vanish at go-live.
  Separately, a device that never pulled a committed deletion before its target archived keeps a
  display-level ghost of the deleted row in old lists (stock totals and settlements are correct
  via the snapshot); the same H7 lane cleans this up.

## 14. Review questions (R24)

- **Q1v24 (mode-split membership verification):** C2-R23-1 — with the signed exact member list
  `ArchiveMemberSourceIds` and the mode-split (published ⇒ full-set equality; unpublished ⇒
  per-member ∈-check), walk every case: mid-copy crash (partial subset ⇒ verified + swept, no
  halt), published run (full equality), tampered residue SourceId (∉ list ⇒ HALT), planted row
  under a crashed run's ArchiveRunId (∉ list ⇒ HALT), a published run with a deviated set (HALT).
  Any remaining path where a routine crash bricks the sweep, or tampering escapes the HALT?
- **Q2v24 (whole-design closure — the convergence gate):** with all R1-R23 folds in place: any
  remaining path to a silently uncounted deletion, a mis-billed control, a permanently locked
  target, a stranded coordination state, an invisible-forever legitimate deletion, an UNSURFACED
  client/server stock divergence, or a balances/settlement divergence? If no on all, say so
  explicitly.

## 15. Sequencing after convergence

Fix→re-route until BOTH reviewers pass → Kunal go → build N2/N11/N12/N14 (pure function + seal frame
+ proofs, gated locally) → staging apply N3-N10/N13 via Kunal-executed runners → credentialled E2E
(create / supersede / withdraw / adopt / crash-drill incl. a real seize+fence exercise /
tombstone-race / archive-interplay, driven as `srvaudit_director`) → BUILD audit (both reviewers
drive the deployed route) → SR-155 stamp validation (rides AA §3-4) → the return engine+server
re-audit (Kunal's firm marker: engine predicate change + sealed-pre-epoch rule + engine control-seal
enforcement + the R5-R7 reproductions failing at ingest/verify + the ⚠-flagged N9/N10/N11/N14/N15
amendments).
