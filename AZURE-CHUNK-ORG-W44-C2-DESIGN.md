# OS-W4.4 Contract 2 — Director correction-approval route: CONCRETE DESIGN

**Status: 🔍 SCOPE REVIEW R5 (R4 verdicts: BOTH BLOCK — AGY×3 + Codex×7, 8 distinct REAL findings
(2 CONVERGED pairs: the two archived-row ID-coordinate mistakes) + 1 engineer family find
(archive-time balance coherence for controlled live rows). All folded below — the AGY-1/Codex-4
pair resolved by the NORMALIZATION LAW, which DELETES the registry TargetInSnapshot flag rather
than patching it. R3: AGY PASS · Codex×5 REAL, folded. R2: 10 REAL folded. R1: 12 REAL folded.
Nothing built, nothing deployed. D-C2-1..3 LOCKED by Kunal 2026-07-23 — §12).**
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
| N7 | Control columns | ADD to BOTH ledger lists: `ControlId`, `ControlType`, `ControlRevision`, `BornPublicationVersion`, `TargetLine` (JSON text), `OriginalEventAt` (ISO text), `ControlState` (device-tombstone staged visibility, §8 — C2-R3-2), `CommitSig` (the ctlcommit-v1 visibility AUTHORITY — C2-R4-5). Control rows are SEALED (`EconSig`, ctl-v1 frame — §7a) |
| N8 | `'correction'` sudo purpose | ADD to `SUDO_PURPOSES` + client prompt map (client half rides the next client wave) |
| N9 | push-v2-validate amendment | The SR-143-conformant tombstone claim + quarantine divert (§8) |
| N10 | Archive-LA scoped amendments | Carry `controlManifest`+`fence` forward on publish; refuse while a correction journal is non-terminal; state-vocabulary v2; CONDITIONAL releases (C2-R1-2); record each run's INPUT-HORIZON marker (max live-list item id of the input universe — the C2-R3-3 adoption-delta decider); ARCHIVE EXCLUSION PIN (C2-R4-E1): runs EXCLUDE control rows and every row named in `controlHeads` (any state) — controlled live rows stay live PERMANENTLY, so balances never re-absorb a corrected-away effect and snapshotCompute stays head-unaware; ACCEPTANCE ITEM: the §3 staleness-exit invariant proven for ALL five states at the staging crash drill (C2-R3-N2) — ⚠ amendments to Chunk-8-audited surfaces, flagged for the return re-audit |
| N11 | attestRows new frames | EXTEND the C1 route with THREE canonicals: `ctl-v1` (control seals, §7a), `ctlcommit-v1` (tombstone commit seals, §8/C2-R4-5), `epoch-v1` (the seal-epoch artifact, N16/C2-R4-7) — ⚠ scoped amendment to the C1-audited function, flagged |
| N12 | Proof suite `test/correction-proof.js` + runner scripts | Pure-function probes + Kunal-executed staging apply/E2E (C1 pattern) |
| N13 | pull-v2-validate amendment | `ControlId eq null` filter — control rows never delivered to devices (C2-R1-13) — PLUS excludes `ControlState='pending'` tombstones (staged visibility, §8/C2-R3-2; OData null/`ne` semantics = a build-proof item) — PLUS delivers `Type='deleted'` rows only after BATCH-VERIFYING their `CommitSig` via attestRows (invalid/absent ⇒ withheld + surfaced; legacy lane: provenance < `tombstoneCommitEpochId` delivers seal-free — C2-R4-5) — ⚠ flagged scoped amendment |
| N14 | buybackExport.js additive export | `foldProjection` exported (exports-only change to the frozen engine file, `reqId` precedent) — ⚠ flagged for the return re-audit |
| N15 | LA-CHANGES §1 amendment note | Topology snapshot writes join the coordination discipline (C2-R1-7) — ⚠ flagged scoped spec amendment |
| N16 | Seal-epoch artifact | ONE `AppConfig_Staging` item `ConfigType='seal_epoch'` `{epochId, tombstoneCommitEpochId, recordedAt, EpochSig}` (C2-R3-4 revised by C2-R4-3/-5/-7): `epochId` = the LIVE list's first-sealed item id (the ONLY epoch — all provenance is live-coordinate; the R3 `archiveEpochId` is deleted); `tombstoneCommitEpochId` recorded at the N9 apply (the CommitSig legacy boundary); `EpochSig` = an `epoch-v1` attestRows seal over the values, verified on EVERY read (fail ⇒ `EPOCH_TAMPERED`). Derivation: PRODUCTION — recorded exactly at the D-C2-2 cutover (fresh lists, epoch = first item id); STAGING — backfill runner derives best-effort, recorded with method + Kunal attestation (H11) |

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
State        'pending' | 'committed' | 'pending_supersede'
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

- Claim = item CREATE (Enforce-Unique makes the race atomic); transitions = ETag CAS.
- Director lifecycle (SR-143/147/149) unchanged from R1 design: `pending → committed` at publication;
  initial-create rollback deletes; supersede via `pending_supersede(PriorCommitted)` whose rollback
  RESTORES the prior lock; expected-revision CAS re-read after acquiring the state.
- **Device lifecycle (C2-R1-5 + C2-R2-4/-5/-6, SR-143-conformant):** see §8 — `pending(
  owner=deviceId, opId=tombstoneId, ttl)` → row durable → `committed(ControlId=tombstoneId,
  Revision: 0, PublicationVersion: null, OpId retained)`. A conflict with an item whose `OpId` OR
  `ControlId` equals this tombstone's TransactionId is the device's OWN claim ⇒ idempotent re-entry
  (finish the insert / the commit CAS), never quarantine. Orphan scrubs are TWO-WAY (C2-R2-4):
  pending past TTL with NO ledger row ⇒ deleted; pending past TTL WITH a durable ledger row ⇒
  ROLLED FORWARD (the scrub executes the `pending → committed` CAS itself — the same idempotent
  transition the crashed route would have made). Adoption (§5b) later CAS-fills
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
    `− effect(previousEffective) + effect(originalTarget)`. `prevOutput` is read from the
    `PriorCommitted` head's control row, SEAL-VERIFIED before use. (The R1 text's
    `− effect(target)` applied to supersede would back the original out TWICE — AGY R2-2's worked
    example: +10 target replaced by +8 then superseded to +5 must land at 95, not 93.) Unaffected
    pairs bit-unchanged. **THE NORMALIZATION LAW (C2-R3-3 revised by C2-R4-1/-6):** the
    in-snapshot decision applies ONLY at the FIRST publication on an archived ensemble — it gates
    the single question "does the target's effect need backing out of balances": Director creates
    ⇒ always yes (reaching create proves no prior tombstone, so an archived target is in
    balances); adoption ⇒ decided by the horizon rule (§5b), and an already-excluded target's
    `− effect(target)` term is 0. The first publication NORMALIZES the ensemble — after it, the
    represented value ALWAYS equals the effective value — so EVERY subsequent chain cell applies
    the plain six-cell table UNGATED (each cell is exactly E_new − E_old; the R3 wording that
    gated later terms by current representation dropped the withdraw restore term — AGY R4-1's
    +10-excluded/adopt/withdraw repro must end at +10, and now does in both branches).
    Live-target ensembles adjust NO balances in ANY cell (manifest-only publications; live rows
    are never in balances, and the N10 archive-exclusion pin keeps controlled rows live forever —
    C2-R4-E1). The per-target adoption decisions are journaled pre-P6 (`AdoptionDecisions`, P4/P5.1
    — crash-reproducible for the P6 candidate) and consulted by NOTHING after publication.
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
target ⇒ decided by the archive-run INPUT-HORIZON marker (N10): the tombstone's **LIVE-LIST
provenance id** (live row ⇒ `_spId`, archived row ⇒ `SourceId` — NEVER an archive-list item id, the
coordinate both R4 reviewers caught; absent ⇒ undecidable) ≤ the target's run horizon ⇒
snapshotCompute already excluded the target ⇒ 0; > horizon (the snapshotCompute.js:87-89 residual)
⇒ the target is in balances ⇒ `− effect(target)`; target's run predates the marker ⇒
`ADOPTION_DELTA_UNDECIDABLE` fail-closed (surfaced manual lane; vanishes at the D-C2-2 go-live
wipe). The per-target decisions are stored in the journal's `AdoptionDecisions` (P5.1) so the P6
candidate is crash-reproducible; after publication the NORMALIZATION LAW (§5 P4) makes every later
chain cell independent of them. **`retire_claim` (C2-R4-8):** Director-sudo mode on the same
journal/idempotency/exclusive-state machinery; legal ONLY against a committed-unadopted registry
claim whose tombstone row FAILS seal validation AND has live-coordinate provenance < `epochId`
(genuine pre-C1 legacy); it QUARANTINES the unsealed tombstone row and retires the registry claim
(journaled evidence), leaving the target unclaimed. **Zero eligible tombstones ⇒ terminal no-op
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
- Orphan scrubs (TWO-WAY for device claims, C2-R2-4 + C2-R3-2): registry pendings past TTL with no
  live journal (Director) ⇒ released/restored per lifecycle; device pendings past TTL with NO
  ledger row ⇒ deleted, WITH a durable ledger row ⇒ rolled FORWARD (the scrub executes the commit
  CAS + the CommitSig mint + the `ControlState` visibility MERGE, §8); a committed registry item
  whose row is still `pending`-marked or CommitSig-less ⇒ complete the mint + MERGE; a durable
  tombstone row whose target's registry
  item is committed to a DIFFERENT ControlId ⇒ the row is quarantined — it lost the race (C2-R2-5
  belt); a durable `pending`-marked tombstone with NO registry item (the scrub-then-insert crash)
  ⇒ run its claim lifecycle: target unclaimed ⇒ register to committed + visibility MERGE, target
  foreign ⇒ quarantine (C2-R3-2); stale no-journal states per §3a (OpId-keyed, C2-R2-9).

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

### 7b. The export assembly contract (pinned HERE, built later — C2-R1-6/-8/-13)
Under its lease, the export route: (1) queries BOTH lists for control-typed rows + `deleted` rows
targeting supplied identities (completeness-attested); (2) supplies to the engine ONLY the control
matching each ACTIVE manifest head (Director controls: the head revision's row; device tombstones:
a synthesized `{controlId: tombstoneId, type:'deletion', targetTransactionId, revision: 0,
bornPublicationVersion: head.bornPublicationVersion}` from the manifest + the seal-verified
tombstone row (C2-R3-1: the head already carries the engine's exact field names — the assembly
copies, never renames) — historical revisions and withdrawn targets' rows are NEVER supplied; (3)
EXCLUDES rows carrying `ControlId` from the `rows` arrays (a control's row reaches the engine only
inside its ctl); (4) surfaces ANY durable tombstone or published control row LACKING a manifest
head — registry-committed, registry-pending, or unregistered alike (C2-R3-2: a pending/unregistered
tombstone is exactly a deletion question not yet adjudicated) — as the fail-closed PROVISIONAL
blocker `TOMBSTONE_PENDING_ADOPTION` (Director remedy: `mode:'adopt'`), **UNLESS the row's TARGET
already has an ACTIVE head (C2-R3-N1) — an adjudicated target's stale headless rows are COVERED,
never permanent blockers (the seal-skipped pre-C1 case reaches adjudication via
`mode:'retire_claim'` → then create/adopt, C2-R4-8)**; (5) verifies
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
read the item — `OpId` OR `ControlId` equal to this tombstone's id ⇒ OWN claim (C2-R2-6 belt:
committed items retain OpId, §4), re-enter: if still pending, proceed; **if already committed, the
re-entry FIRST verifies the ledger row exists with `ControlState='committed'` + a valid
`CommitSig`, completing the visibility MERGE + seal mint itself if the prior attempt crashed
mid-way (C2-R4-4 — the retry is the primary healer, the scrub is the belt), and only then answers
via the normal dedup path**; foreign ⇒ divert the row to `StockTransactions_Quarantine`
(`CONTROL_TARGET_RESERVED`, surfaced in the push response, never silently dropped). (2) **Pre-insert ownership fence (C2-R2-5):** IMMEDIATELY before attest+insert,
re-read the registry item, assert it is still THIS tombstone's own live pending claim (own OpId,
unexpired), and RE-STAMP `TtlAt` (ETag CAS — a fresh TTL so the scrub cannot expire the claim
under a normally-paced insert). Absent / foreign / expired ⇒ quarantine divert, never insert. Then
the row is inserted through the normal attest pipeline **WITH `ControlState='pending'` — INVISIBLE
to devices (the N13 pull filter excludes pending rows) and fail-closed for exports (§7b(4): a
headless durable tombstone blocks settlement, never mis-counts).** (3) After the row is durable,
CAS the registry `pending → committed(ControlId=row id, Revision 0, PublicationVersion null, OpId
retained)` — **this CAS is the COMMIT POINT** — then mint the row's `ctlcommit-v1` COMMIT SEAL via
attestRows (`CommitSig` over `{TransactionId, TargetTransactionId, 'committed'}`, C2-R4-5) and
MERGE the row `{ControlState:'committed', CommitSig}` (now pull-visible — N13 delivers tombstones
only after batch-verifying CommitSigs; a bare `ControlState` flip by a SharePoint-direct edit is
withheld + surfaced, never delivered). **The commit CAS lands on a FOREIGN state ⇒ COMPENSATE (C2-R2-5/C2-R3-2): the
still-`pending`-marked row — which NO device has ever received — moves to Quarantine + surfaced;
there is nothing to un-deliver, so a losing tombstone can never delete the original on peer
devices.** Crash recovery: retry (idempotent re-entry at any step); the TWO-WAY reconcile scrub
(C2-R2-4: registry pending past TTL with no ledger row ⇒ deleted; WITH a durable ledger row ⇒ the
scrub executes the commit CAS + the CommitSig mint + the visibility MERGE itself — roll-forward,
idempotent; a committed registry item whose row is still `pending`-marked or CommitSig-less ⇒
complete the mint + MERGE); the
§6 belts (durable tombstone vs FOREIGN-committed registry ⇒ row quarantined; durable
`pending`-marked tombstone with NO registry item — the scrub-then-insert crash, C2-R3-2 — ⇒
reconcile RUNS the claim lifecycle for it: target unclaimed ⇒ register to committed + visibility
MERGE; target foreign ⇒ quarantine). Registry unreachable ⇒ that tombstone (only) fails
retryable — the C1 fail-closed posture. Non-tombstone rows: pipeline untouched. ⚠ Scoped
amendments: the C1-audited push LA (N9) + the pull filter (N13 — OData null/`ne` semantics on
`ControlState` are a BUILD-PROOF item: prove the filter delivers legacy null-state rows and
committed tombstones, excludes pending, on the real staging list). Devices receive peer deletions
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
⇒ retire → create/adopt succeeds; post-epoch unsealed ⇒ refused locked, C2-R4-8); and the
ARCHIVE-EXCLUSION probe (a controlled live row + its control row are never selected by a run;
balances unchanged across an archive cycle containing them, C2-R4-E1).

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
- **H10 (Kunal-visible, C2-R3-2):** a device deletion now reaches OTHER devices only after the
  server commits its claim — in practice one push round-trip later than today (seconds-to-minutes;
  the deleting device itself sees it instantly). The delay is what guarantees a deletion that
  LOSES a race against a Director correction can never reach peer devices at all — before this
  fix, a losing deletion could permanently remove the original on every peer with no way back.
- **H11 (C2-R4-7):** the STAGING seal-epoch value is a best-effort derivation recorded with its
  method and Kunal's attestation — trustworthy only under the assumption that staging wasn't
  already tampered at backfill time. Acceptable because staging holds trial data (D-C2-2); the
  PRODUCTION epoch is exact by construction (recorded at cutover on fresh lists).
- **H12 (C2-R4-E1):** Director-corrected live rows and their control rows never archive — they
  stay in the live list permanently (rare rows, negligible cost). This is what keeps snapshot
  balances and settlements coherent without teaching the archiver about control heads.

## 14. Review questions (R5)

- **Q1v5 (normalization law):** §5 P4 v3 — verify the induction yourself: does EVERY
  first-publication mode leave the archived ensemble's represented value equal to its effective
  value, and does every subsequent plain-table cell then preserve it? Include the AGY R4-1 repro
  both ways, supersede-of-adopted-deletion in both in-snapshot branches, and a
  retire_claim → create chain. Any cell that still needs a representation gate?
- **Q2v5 (commit seals):** the CommitSig authority chain (§8/N13/N16) — can an uncommitted or
  losing tombstone reach a device under ANY combination of SharePoint-direct edits (ControlState,
  CommitSig transplant from another tombstone, TargetTransactionId swap)? Is the covered tuple
  `{TransactionId, TargetTransactionId, 'committed'}` sufficient, and is the legacy
  `tombstoneCommitEpochId` lane sound (no post-epoch tombstone can ride it)?
- **Q3v5 (retire_claim):** the C2-R4-8 lane — is it reachable EXACTLY when intended (pre-epoch
  unsealed claimed tombstone) and unreachable otherwise? Walk its crash matrix on the shared
  journal machinery (quarantine-then-crash, retire-then-crash, replay). Can it ever retire a claim
  whose tombstone is legitimate, or race a concurrent adopt folding the same claim?
- **Q4v5 (archive exclusion):** the C2-R4-E1 pin (N10) — does excluding control rows +
  head-named rows from archive selection preserve EVERY Chunk-8 invariant (neutrality, fidelity
  hashes, cutoff continuity, retain-window pairing)? Any consumer that assumes all old rows
  eventually archive? Is "any state incl. null/historical heads" the right exclusion breadth?
- **Q5v5 (ID coordinates):** sweep the revised doc for ANY remaining comparison mixing list-ID
  coordinates (live `_spId` / archive item id / `SourceId` / `epochId` / horizon markers /
  `tombstoneCommitEpochId`). The R4 round found two; is the count now zero?
- **Q6v5 (whole-design re-check):** with all R1-R4 folds in place, re-answer the standing
  closure question: any remaining path to a silently uncounted deletion, a mis-billed control, a
  permanently locked target, a stranded coordination state, an invisible-forever legitimate
  deletion, or a balances/settlement divergence?

## 15. Sequencing after convergence

Fix→re-route until BOTH reviewers pass → Kunal go → build N2/N11/N12/N14 (pure function + seal frame
+ proofs, gated locally) → staging apply N3-N10/N13 via Kunal-executed runners → credentialled E2E
(create / supersede / withdraw / adopt / crash-drill incl. a real seize+fence exercise /
tombstone-race / archive-interplay, driven as `srvaudit_director`) → BUILD audit (both reviewers
drive the deployed route) → SR-155 stamp validation (rides AA §3-4) → the return engine+server
re-audit (Kunal's firm marker: engine predicate change + sealed-pre-epoch rule + engine control-seal
enforcement + the R5-R7 reproductions failing at ingest/verify + the ⚠-flagged N9/N10/N11/N14/N15
amendments).
