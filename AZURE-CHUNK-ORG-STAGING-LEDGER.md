# Org-Structure chunk — STAGING APPLICATION LEDGER

Tracks applying the org-chunk server contracts to the staging cloud (RG `bob-stock-sync`, sub
`BOB-Stock-App`). Started 2026-07-22 (W4.4 Contract 1). The LAs are not in-repo; this is the
authoritative record of what changed on staging — same role as `AZURE-CHUNK-AA-STAGING-LEDGER.md`.
The LIVE Logic Apps and the live app on `main` are untouched throughout.

## ✅ W4.4 CONTRACT 1 — row-level economic attestation: APPLIED + PROVEN 2026-07-23 (13/13)
Spec: `AZURE-CHUNK-ORG-W44-C1-DESIGN.md` (converged R2 both-PASS @ `bfb3469`). Apply runner:
`audit-artifacts/apply-c1-staging.js` (idempotent; Kunal-executed; secrets in-process only).

**Applied:**
1. **Function App `bob-stock-money-fn`** — zip-deployed `azure-functions/` (additive). NEW route
   `attestRows` (sign/verify, key ring, authLevel function, MAX 5000 rows — the client pushes its
   whole backlog unchunked, sync.js:1575, so a low cap would fail-closed forever). SIDE-EFFECT worth
   knowing: the app had been serving the 2026-07-09 package; this deploy also brought the in-repo
   `topologyPlan`/`topologyResolve`/`buybackExport` routes live (14 routes total). Deploys need
   `az resource invoke-action --action syncfunctiontriggers` before the new routes index.
2. **Attestation keyring** — Function settings `BOB_ROW_ATTEST_ACTIVE=k1` +
   `BOB_ROW_ATTEST_PEPPER_K1` (64-char, minted in-process, never in chat/repo; separate from
   BOB_AUTH_PEPPER by design).
3. **Columns** on `StockTransactions_Validate` AND `StockTransactions_Archive` (created via temp
   passthru `bob-stock-tmp-c1apply`, DELETED after): `EconSig` (Text 128) + the W4-SR-13 set the
   staging lists were missing — `SellAtSupply`/`DiscAtSupply`/`PricingVersion`/`CatalogueVersion`/
   `UnitPriceAtTime` (Number), `StockFromStoreId`/`StockToStoreId` (Text 64), `StockFrom`/`StockTo`
   (Note). **Ground truth: the deployed staging push LA predated W4.3 — it stored NONE of these; the
   W4-SR-13 stamp-column runbook item is now APPLIED as part of C1.**
4. **`bob-stock-push-v2-validate-staging`** rewired per design §2: `Attest_rows` (Select) →
   `Call_attest` (ONE batch HTTP sign call, secureData inputs) → `Zip` (index-aligned
   {reason,row,EconSig,SigTid}) → `Insert_loop` over the zip with a **Belt** If (echoed
   TransactionId must equal the row's, else `SIG_ZIP_MISMATCH` → failed[] retryable) → Insert body
   gains `EconSig` + the 9 W4-SR-13 field mappings. FAIL CLOSED: `Call_attest` failure →
   `Attest_failed_map`/`Set_failed_attest` put the WHOLE batch in `failed[]` as
   `ATTEST_UNAVAILABLE, retryable:true`, nothing inserted; Invariant/Respond reachable on that path
   (Insert_loop Skipped tolerated). Response contract unchanged.

**Proven on the real cloud (final run 13/13):**
- P1: stamped direct-log row → accepted, `EconSig v1:k1:…` stored, all stamp/label columns stored,
  `op:'verify'` true.
- P2: **SharePoint-direct Qty edit (MERGE) on the stored row → verify FALSE** (the contract's core).
- P3: duplicate push → `duplicates[]` (dedup intact under the new wiring).
- P4: unstamped row → sealed + verifies (absent ≡ '' canonicalisation).
- P5: **fail-closed outage drill** — keyring broken → push lands `failed[] ATTEST_UNAVAILABLE
  retryable:true` and the row is NOT inserted; keyring restored → identical retry accepted + sealed.
- Probe rows deleted; temp passthru deleted.

**Build findings folded along the way (all committed):**
- Date canonical normalisation (`5a818d7`): SharePoint's Date column echoes
  `YYYY-MM-DDT00:00:00Z` for the signed `YYYY-MM-DD` — verify-from-store failed until canonical()
  normalises Date to its day part (a DIFFERENT day still breaks; permanent probe). Proof 58/58.
- MAX_ROWS 500→5000 (`3c35f27`): unchunked client backlog + a low cap = permanent retry loop.
- The push LA trigger is named `When_an_HTTP_request_is_received` (not `manual`) for listCallbackUrl.

## ✅ C1 BUILD AUDIT CONVERGED 2026-07-23 — BOTH PASS FIRST ROUND (rare)
AGY PASS (58/58 local; real push `agy_probe_txn_1784746957800` sealed+verified; SP-direct Qty edit →
verify false via its read-only Graph credential; dup → duplicates[]; confirmed the 5 open items are
the right residual set) · Codex PASS ("Numbered findings: none"; probe item 140 sealed/verified/
tamper-detected/deduped, row deleted; audited DETACHED at the exact SHA `c30e8aa` — its method note
about origin tip `ba7c560` is EXPECTED: that is the last-pushed Chunk-9 commit, the server phase is
local-only until cutover, ground-truthed an ancestor of HEAD). Post-audit hygiene: the temporary
`auditors` function key DELETED (only `default` remains). NOTE: AGY's credential could not delete its
probe row — it pushed a `deleted`-type tombstone instead, so `StockTransactions_Validate` holds TWO
agy residue rows (the probe + its tombstone) — CLEAN at the next apply run (item 1 below). Auditor
read-only Graph credential (app 0ccf2a39) expires 2026-07-29 — let lapse, mint fresh at the return
re-audit.

## ✅ ARCHIVE-CARRY APPLIED 2026-07-23 (run-probe pending the test director)
The archive-move now preserves seals. Applied: (a) `bob-stock-archive-staging` Insert_archive mapping
+11 carried fields (EconSig, **IdempotencyKey — ground truth: it was NEVER carried to archive**, a gap
that would break archived receive-row seals AND the CHUNK8 item-5 dual-identity dedup; the 4 stamp
fields; UnitPriceAtTime; source/dest ids + labels) + BOTH `$select` reads extended (Read_live +
Reread_archive incl. TxnDate/Reason — the reread previously wouldn't fetch the new fields, which would
have false-failed the fidelity gate every run); (b) `snapshotCompute.hashRows` canon extended to the
full carried set (+Reason, +Date day-part via `dateOf`, field-name agnostic live↔archive) AND framing
switched join('|')→JSON.stringify (labels are free-ish text — the same field-boundary-injection class
the EconSig canonical closed; symmetric both sides so equality semantics preserved. ⚠ Scoped amendment
to Chunk-8-audited code — flag at the return re-audit); (c) Function App redeployed; new proof suite
`test/archive-carry-proof.js` **28/28** (rename-equivalence, whole-population copy-defect matrix,
injection dead); attest proof still 58/58. Finishing run `audit-artifacts/finish-c1-carry.js`
(Kunal-executed): IdempotencyKey column on the archive list + agy_ residue sweep.
**✅ LIVE ARCHIVE-RUN PROBE: 17/17 OK 2026-07-23** (`audit-artifacts/probe-c1-archive-run.js`,
Kunal-executed, driven as `srvaudit_director` w/ a real archive sudo proof + the Director device key,
against a DEDICATED probe source list `StockTransactions_ArchProbe` created+deleted by the run —
NOT the archiver's default `StockTransactions_Staging`, which holds the SEED_* pull-probe dataset the
run would have swept; the probe's empty-list guard caught that on attempt 1). Proven end-to-end:
3 sealed rows → real run 200 (counts 3/3/0; source and archive fidelity hashes IDENTICAL over the
extended canon) → all 3 archived rows re-verify `ok:true` after the TxnType/TxnDate/TxnTimestamp
remap (incl. the receive-key row) → tampering an ARCHIVED row breaks its seal → source rows deleted
post-publish → snapshot state restored, lock idle. **LATENT CHUNK-8 BUG found + fixed (KUNAL-VISIBLE):**
the archive list's `TxnTimestamp` column is TEXT while the source `Timestamp` is a NUMBER — the LA's
insert rejected every row (`Cannot convert a primitive value to Edm.String`, 502 + lock stuck
`running`); C8's proofs ran from a text-timestamp test list so it never showed, and a REAL archive run
from `StockTransactions_Validate` (Number Timestamp) would have hit it in production. Fix: the copy
mapping now `string()`-wraps TxnTimestamp (hash unaffected — `tsOf` stringifies both sides). Diag
trail: secured LA inputs → mapping replicated outside the LA (`audit-artifacts/diag-c1-insert.js`) →
archive column-type dump exposed the Text/Number mismatch. Residue note: the 11 C1 columns added to
`StockTransactions_Staging` on attempt 1 remain (empty, harmless, and needed if that list is ever a
real archive source). Flag for the return re-audit: archive LA changes = carry mapping + both
`$select` extensions + the TxnTimestamp `string()` wrap.
**Finish run 2026-07-23: 4/4 OK.** IdempotencyKey column already existed on the archive list. BONUS
CLEANUP: the agy_ sweep found **21** residue rows — not just the 2 from this build audit but 19 OLD
agy_ probe rows accumulated from the Chunk-4/5/9/10 audits (agy_3242/6819/7918/8455/txn_*) that were
never cleaned per house rules. All 21 deleted; TIDEM_* and franchtest fixtures untouched.
2. **Contract 2** — correction route writes `control.targetLine` + server `originalEventAt`
   (LA-CHANGES §6; route not yet built). Needs the throwaway `srvaudit_` test director (Kunal mints).
3. **Stamp semantic validation (SR-155 recompute)** rides the AA LA-CHANGES §3-4 ingest work — until
   it ships, a seal binds stamp VALUES to the row but does NOT vouch for their correctness; the
   engine's tier-1 stamp-authority rules are unchanged. (The seal clears IDENTITY holds only.)
4. **Engine predicate change** (`unverifiableQty` → "no valid economic signature" +
   `ECON_SIG_INVALID` + the sealed-row-pre-epoch contradiction rule) — deliberately deferred to the
   return re-audit per the parent contract.

## ✅ TEST DIRECTOR MINTED 2026-07-23 (10/10)
`srvaudit_director` (Role director, Active=1, TokenVersion 1) in `UserCredentials_Staging` item 25 —
exactly ONE row (dedupe swept clean). Minted via the DEPLOYED `mintUserCredential` route (server-side
salt+hash; runner `audit-artifacts/mint-test-director.js`, Kunal-executed). **Proven against the
deployed verifier:** real login mints an `archive` sudo proof → `verifyProof` accepts (ok + director);
wrong password rejected; proof rejected for any other purpose (single-purpose sudo). Password in the
gitignored local keys file only. Gotcha banked: `Active` is an SP NUMBER column — write 1, not `true`
(a boolean leaves the row unusable → anti-enumeration `userOk:false`). **⚠ CUTOVER CHECKLIST: DELETE
this account (and rotate the staging keys file) before go-live.** Unblocks: the archive-RUN probe +
Contract 2 + the AA credentialled E2E (AA ledger's blocker section now fully cleared).

## Safety notes
- All changes on `*-staging` resources + the shared Function App (additive routes). Live LAs and the
  live app untouched. Nothing on `main`.
- The staging device keys used by the probes are the 2026-07-22 regenerated set
  (`audit-artifacts/.staging-keys-2026-07-22.txt`, gitignored; rotate + delete at cutover).
