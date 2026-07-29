# Account Access chunk — staging LOGIC APP changes (AA-W2 spec; apply to staging before AA-W6 proof)

**Status:** SPECIFIED 2026-07-09 (AA-W2). The LAs live on staging (not in-repo); this doc is the
authoritative change record, same pattern as Chunks 5–10. Function-side counterparts are IN-REPO and
logic-proven (`azure-functions/src/functions/accessPolicy.js`, 51-probe suite
`test/access-policy-proof.js`). Enforcement matrix: `AZURE-CHUNK-AA-ENFORCEMENT-MATRIX.md`.

**Shared rules (apply to every change below):**
- Policy + user rows are read by the LA from SharePoint and forwarded to `evaluateAccess` — NEVER taken
  from the request (SR-2). Any read failure / missing blob ⇒ the Function's fail-closed answer stands.
- Reject responses use the existing quarantine/rejected[] pattern with per-row reasons — never silently
  drop a batch.
- **Activation:** the `access_policy` blob is SEEDED (Director publishes the client-generated default,
  which reproduces today's behaviour exactly) BEFORE enforcement flips. Enforcement is staged via a
  `_policyRequired` advertisement flag in `sync_config` (same staged-rollout pattern as Chunk 5's
  `_authRequired`). Pre-activation queued rows: the flip is flag-day on staging with test data; on PROD
  cutover the seeding happens in the same maintenance window as secret rotation (no live devices mid-flip).

---

## ⚠ OWNER DECISIONS 2026-07-30 — these OVERRIDE the per-section text below

**D-AA-A — ONE MASTER ENFORCEMENT SWITCH FOR THE WHOLE CHUNK. (Kunal: "B".)**

Every gated LA reads a single `access_policy_enforce` AppConfig row and stays fully inert while it is
absent or `0` — **including after a policy blob has been published.** Publishing the policy and
switching on enforcement are now two deliberate, separate acts.

**This CORRECTS an inconsistency in the sections below.** As specified, §5 (corp-costs) and §6
(archive-pull) arm the instant the first policy blob is published, while §3/§4 (ingest) arm on a
staged flag. That means publishing the policy — which the Activation rule above treats as the *safe
seeding step that happens BEFORE enforcement* — would itself be a flag day for two doors. Harmonise
all of them onto the single row.

Rationale (Kunal's call, and the reason it is worth the cost): it buys a **rehearsal**. Publish the
policy, confirm every door reads it correctly, let it settle, then flip one switch. If anything
misbehaves the undo is flipping that switch back — the published policy survives. Under the
publish-arms-everything model the only undo is deleting the policy you just wrote.

Cost: one extra small AppConfig read per call on each gated LA. Negligible on corp-costs (a handful
of calls a day) and archive-pull (on demand). Accepted.

⚠ Items §7 (user-admin), §8 (catalogue-write) and §10 (Chunk-8 archive) currently specify **no
activation branch at all**. `evaluateAccess` is fail-CLOSED and returns `NO_POLICY` when none exists,
so applied literally each of those three would break its own working Director door the moment it
landed, before any policy exists. All three need this guard. This was NOT caught by the AA audits —
they reviewed the design, not the deployed graphs.

**D-AA-B — COST VISIBILITY AT ACTIVATION: DIRECTORS ONLY. Head Office LATER. (Kunal 2026-07-30.)**

The seeded default policy grants `seeCost` to **director only**. Today an unauthenticated Head Office
device receives the full cost list; after activation it will not.

**Head Office is to be added later by EDITING THE POLICY — not by redeploying anything.** Treat that
as an acceptance criterion for the default-policy generator, not an aspiration: if adding `seeCost`
to head_office later requires a code or LA change, the design has failed its own purpose and that is a
defect to raise before activation.

⚠ Companion client defect that must be fixed BEFORE activation, or Director devices silently stop
receiving central cost updates: `_fetchCorporateCosts()` is called from exactly one place —
`sync.js:815`, inside `_fetchRemoteConfig`, at boot, fire-and-forget, **before anyone has logged in**.
Nothing re-calls it after login and session proofs are memory-only, so once the person-level check is
live that boot call carries no proof and is refused every time. The fetch swallows a bad response, so
the failure is silent and the device keeps showing stale costs. This is a CLIENT change with its own
sentinel and its own audit — not part of any staging apply.

Full apply plan (nine sessions, ordering, probes, rollbacks):
`audit-artifacts/AA-STAGING-APPLY-PLAN.md` (gitignored — local only).

---

## 1. NEW LA: `access-policy-write-staging`
Trigger `POST {auth:{deviceId,storeId,storeKey,directorKey}, proof, proposed, pinPlain?, pinClear?}`.
1. `validateKeys` — Director key REQUIRED (store key alone → 401, like catalogue-write).
2. Read UserCredentials rows + current `access_policy` AppConfig row.
3. `evaluateAccess {proof, action:'access-policy', capability:'editAccessPolicy', deviceContext,
   policy:current, rows}` — the FLOOR makes this always demand a fresh `access-policy` sudo proof, AND the
   capability check pins WHO may edit (any account can mint a proof with its own password; the capability is
   what stops a non-director using one here). **FIRST-EVER write (no `access_policy` row exists):** the
   capability check has no policy to read — the LA instead requires the verified proof's `role === 'director'`
   (evaluateAccess returns the current row's role). Subsequent writes: capability check + keep the role
   assertion as defence-in-depth. 403 on any failure.
4. `policyMerge {current, proposed, pinPlain?, pinClear?}` — reject reasons pass through to the client.
5. If-Match write of the returned blob to AppConfig `access_policy` (retry loop, catalogue-write pattern);
   non-converge ⇒ `write_failed`, nothing changed.
6. Response: `{ok, version}` ONLY — never echo the blob (it contains pin hash) or pinPlain.

## 2. Policy DELIVERY (config LA + pull-v2)
- config LA: serve `access_policy` **minus `pin.hash` and `pin.salt`** (verification is server-side now; no
  client ever needs hash material — `pin.expiresAt` is kept as the client's countdown/has-PIN hint) to
  device-authenticated callers, alongside master_data. Keep the `ConfigType ne 'corporate_costs'` filter;
  add nothing to the anonymous path.
- pull-v2: echo `policyVersion` (the blob's `version`) on every page, exactly like the Chunk-10 scope echo —
  the client's bump detector (SR-4 purge lifecycle) keys off it.

## 🛑 STOP — §3 AND §4 CANNOT BE APPLIED AS WRITTEN (verified against the live cloud 2026-07-30)

**§3 + §4 are ONE item (staging-ledger item 5) and they are the only thing in this chunk that sits on
the `sharepointonline` connection SHARED WITH THE LIVE LOGIC APPS, gating the sync WRITE path.**
Adversarial review of the apply plan found **three separate breaks of the inertness property** — i.e.
they misbehave with NO policy published and NO enforcement flag set, on everyday traffic. Confirmed by
reading the DEPLOYED definitions with `az`, not by reasoning from this document.

**BREAK 1 — A NAME COLLISION THAT SILENTLY DELETES AN EXISTING SAFETY FILTER.**
The plan adds an action named **`ToInsert2`** to `bob-stock-recordsteps-push-staging`. **That name is
already taken on the deployed LA** (64 actions). The live one is the Chunk-9/10 context hold-back
filter:
`{"from":"@body('ToInsert')","where":"@not(contains(body('Ctx_ids'),item()?['row']?['StepId']))"}`,
and `Insert_loop.foreach` already reads `@body('ToInsert2')` with
`Insert_loop.runAfter = [Map_rejected, ToInsert2]`. A Logic App's actions are a JSON object keyed by
name — **adding a second `ToInsert2` does not sit alongside the first, it OVERWRITES it.**
Consequence with zero policy and zero flag: a stock-take/transfer step whose ledger row has not landed
is written to SharePoint anyway; it is still counted in `Ctx_pendings`; the deployed `Invariant`
(`inputCount == accepted+duplicates+Rejected+Ctx_rejects+failed+Ctx_pendings`) evaluates FALSE; the LA
returns **HTTP 500 and acks nothing**; and the device **retries forever against a record already
durably in the list.**

**BREAK 2 — EDIT 13's PREMISE ABOUT THE LIVE GRAPH IS FALSE.** It says to re-parent both `Attest_rows`
and `Attest_failed_map` from `body('ToInsert')`. On the live push-v2, **exactly one** action references
`body('ToInsert')` — `Attest_rows`. `Attest_failed_map.inputs.from` is `@body('Attest_rows')`.
Following EDIT 13 changes that action's item shape so every `ATTEST_UNAVAILABLE` entry returns
`TransactionId: null` — a behaviour change on any attestation blip, no policy involved.

**BREAK 3 — `concat()` ON ARRAYS.** EDITs 15 and 18 merge the quarantine list and the response's
`rejected[]` with `concat(<array>,<array>)` on the unconditional path. Logic Apps' `concat()` is for
strings and integers; the live recordsteps LA already merges arrays with **`union()`** in two places
(`Response_ok.failed`, `Response_ok.rejected`).

**AND THE PROBE WOULD NOT HAVE CAUGHT ANY OF IT.** The proposed recordsteps fixture is one
transfer/backfill step plus one stocktake/approve step. The live `Context_steps.where` is
`@and(RecordType=='transfer', or(StepType=='resolve', StepType=='cancel'))` — neither fixture step
matches, so `Ctx_ids` stays empty and the overwritten filter is indistinguishable from the original.
Green probe, live-broken change.

**REQUIRED BEFORE §3/§4 IS TOUCHED:**
1. **Re-spec both against freshly captured live definitions.** The in-repo captures are stale and
   unusable as a baseline: `pushv2-def-current.json` is 2026-07-22 (predates the 23 July attestation
   rewire) and `recordsteps-push-staging-props.json` is 2026-07-02 (predates device auth AND store
   isolation).
2. **Build a name-collision gate** — every action name an edit ADDS must be asserted absent from the
   deployed definition first. This is the check whose absence caused BREAK 1, and it is cheap.
3. Apply §3/§4 **LAST** in the batch, never first, so the apply/rollback mechanics have been rehearsed
   on the six low-risk items before anything touches the shared connection.

*(Root cause worth recording: this chunk was triple-audited clean. The audits reviewed the DESIGN. The
edits were written against a picture of the deployed graphs that was a day out of date. Auditing a
plan is not the same as checking the plan still matches the machine.)*

## 3. push-v2 ingest validation (matrix rows 1/5/7/9/15 + D9-8 closure)
Request gains optional `{proof, pinProof, sudoProofs}` — the client (AA-W5 `Sync._withIngestProofs`) attaches
the 12h session proof as `proof`, any live pin-grant as `pinProof`, and action-time sudo proofs as a
`sudoProofs: {purpose: proof}` map (a batch can carry rows from several actions). For a row type whose sudo
map says 'password', validate `sudoProofs[<purpose>]`; 'session' accepts `proof`. Row classification →
required check:
| Row type in batch | evaluateAccess call |
|---|---|
| `in` (delivery intake) | `{action:'delivery', capability:'recordDelivery'}` |
| `adjustment_in`/`adjustment_out` | `{action:'approve' OR 'resolve' per step context, capability:'stockTakeApprove' OR 'resolveDiscrepancy'}` — the paired record-step's type decides; standalone adjustments use `adjustment` |
| `deleted` tombstone | `{capability:'deleteMovement'}` (session proof OK) |
| `transfer_in` | `{capability:'transferReceive', pinProof}` — the PIN path only bites for staff-role accounts (resolver order handles it) |
| everything else | device auth + Chunk-10 scope only (unchanged) |
Failures reject THOSE rows (`ACCESS_DENIED:<reason>`); in-scope unprivileged rows in the same batch still land.

**AA-07/AA-08 — proof ABSENCE is RETRYABLE, proof REJECTION is permanent.** Distinguish two cases so a
legitimate action isn't quarantined by a timing accident:
- **Proof present but INVALID** (bad signature, wrong purpose, wrong device, tokenVersion bumped, account
  denied) ⇒ permanent `ACCESS_DENIED` reject/quarantine (the real gate did its job).
- **Proof ABSENT or EXPIRED** (the row lagged past the 5-min sudo TTL — connectivity drop, 5xx retry, the
  Chunk-5 401 sync-pause, or a follower-tab relay that hadn't landed) ⇒ respond so the CLIENT keeps the row
  PENDING and re-pushes (a `RETRY_PROOF` reason, treated like a soft/transient failure — NOT `rejected[]`).
  The client re-mints on the next privileged interaction / re-prompt. A row must never be permanently lost
  because its proof timed out in transit. (AA-07 relay + AA-08 TTL edge both land here.)

## 4. recordsteps-push ingest validation (matrix rows 4/6/7/8/9)
Same shape. Step type → check: stock-take count/submit steps `{capability:'stockTakeCount', pinProof}`;
approve step `{action:'approve', capability:'stockTakeApprove'}`; resolve `{action:'resolve',
capability:'resolveDiscrepancy'}`; delivery steps `{action:'delivery', capability:'recordDelivery'}`;
transfer create `{capability:'transferCreate'}`; receive `{capability:'transferReceive', pinProof}`;
cancel `{action:'cancel', capability:'transferCancel'}`. Chunk-10 Owner/From/To scope checks unchanged and
still first. `validateMoney` unchanged (documented fail-open exception).

## 5. corp-costs: policy check replaces pure flag-gating (matrix row 16, SR-10)
Current gate (Director key OR corporate store key; franchise ⇒ 403) becomes: device gate unchanged as
defence-in-depth, THEN `evaluateAccess {proof, capability:'seeCost'}` with the session proof — 403 unless
the POLICY grants seeCost. Missing/unreadable policy ⇒ 403 (fail-private). Response unchanged.

## 6. archive-pull: policy + D10-5 scoping + era cutoff floor (matrix row 18, SR-6/R2-1)
Replace the Director/HO-only gate with:
1. `evaluateAccess {proof, capability:'seeArchive'}` — 403 on deny.
2. Chunk-10 StoreIds scope clause ACTIVATES for non-`['*']` accounts (it's pre-wired) — D10-5 delivered.
3. **Era cutoff floor:** read AppConfig `store_eras`. For each requested store, for a FRANCHISE-scoped
   account (credential StoreIds ≠ `['*']` and the store's current owner per eras ≠ 'HO'): no era record for
   that store ⇒ serve NOTHING for it (fail closed); else add `Timestamp ge <era.from>` for the requesting
   owner's era window. HO/Director (`['*']`) callers: no era filter (Kunal's lens rule — HO sees all history).
   StoreId values in the clause go through the same 3dbc3c5 charset allowlist.

**⚠ TWO THINGS VERIFIED ABOUT §6 ON 2026-07-30 — read before applying it.**

- **`store_eras` HAS NEVER EXISTED.** Zero hits across every `.js`, `.html` and `.json` in the repo
  (including gitignored `audit-artifacts/`); it appears only in spec markdown. The deployed
  `bob-stock-archive-pull-staging` has 8 actions (`Get_creds`, `Call_verify`,
  `Authorized{Match_cred, Scope_bare, Read_archive, Respond_ok}`, `Respond_401`) and **no era logic at
  all.** So this section creates a piece of business data that has never been written — the ownership
  dates must be seeded, and confirmed store-by-store by Kunal, before the item can even be tested.
  The fail-closed rule above (no era record ⇒ serve NOTHING) is the safety property: the deployed LA
  treats an empty scope clause as "no filter", so a literal implementation that skipped the floor
  would hand a new franchisee **the previous owner's entire trading history.** That is the exact
  disclosure this whole chunk exists to prevent — prove the zero-rows case explicitly, do not infer it.
- **There is a live client/server contract mismatch on this endpoint, independent of this change.**
  The deployed LA reads `triggerBody()?['data']?['from']` and `['to']` (12 occurrences each), while
  `Sync.pullArchive` (`sync.js:1443`) sends `this._withPerson({ from, to })` — i.e. at the TOP level,
  not nested under `data`. So the requested date range is **silently ignored today.** Fixing it is
  correct but it IS a behaviour change: it gets its own line in the record and its own re-proof, not a
  free ride inside this item.
- Note `Pages._loadArchiveForReports` (`index.html:3283`) splices archive rows into
  `DB.get().transactions` and calls `Stock._buildCache()`. **This is not a report-only surface** — it
  feeds the on-screen stock number, which a stock take reads as its system count.

## 7. user-admin LA
Add `evaluateAccess {proof, action:'user-admin', capability:'manageUsers'}` after the existing Director-key
+ sudo gate (defence-in-depth; the floor keeps `user-admin` on password regardless of the blob).

## 8. catalogue-write LA
After the existing Director-key + publish-sudo gate: batch the distinct capabilities the changes need —
products/categories/productTypes/stores/thresholds rows ⇒ `editRefData`; `costChanges` ⇒ `editCost`;
changes touching `franchiseDiscount`/`price` ⇒ `editPricing`; supplier fields ⇒ `editSuppliers` — one
`evaluateAccess {proof, action:'publish', capability:<cap>}` per distinct cap (≤4 calls); a failed cap
rejects ITS rows via the existing `rejected[]`, the rest merge.

## AA-20 (Kunal 2026-07-10): "Clear PIN" is an INSTANT kill-switch
The policy blob carries `pinEpoch`. `policyMerge` bumps it ONLY when the PIN is cleared (`pinClear`) or
(re)set (`pinPlain`) — NOT on unrelated permission edits. `validatePin` stamps each grant with the epoch it
was minted under (`pe`); `evaluateAccess` rejects a grant whose `pe` ≠ the current policy's `pinEpoch`. So a
"Clear PIN" (which bumps the epoch) invalidates every outstanding grant immediately, while the grant ALSO
still self-expires ≤24h. **LA impact:** the `access-policy-write` LA already carries the full blob through
`policyMerge` (pinEpoch computed server-side, written into `access_policy_secure` + the client copy); the
`user-verify` `pin` op must pass the CURRENT `access_policy` (which now includes `pinEpoch`) to `validatePin`
so the grant is stamped correctly; the ingest LAs (§3-4) pass the current policy to `evaluateAccess` (already
required for the capability check) so the epoch check runs. No new fields on the wire beyond the blob's
`pinEpoch`.

## 9. user-verify LA: new `pin` op
`POST {auth, op:'pin', pin, actorUsername}` → device key gate → read UserCredentials rows + `access_policy`
→ `validatePin {pin, actorUsername, deviceContext:<LA-derived>, policy, rows}` → `{ok, proof, expiresAt}`.
**AA-09 (contract):** the client (`Sync.pinUnlock`) sends `actorUsername` (NOT `username`) — the field name
must match, or `validatePin` finds no row and every correct PIN fails closed. **AA-09 (security):**
`deviceContext` is NOT a client field — the LA derives it from the VALIDATED device keys (`__director` for a
Director key, else the verified `storeId`), exactly as the other gated LAs do; a client-asserted `dc` would
let a grant be minted against a different device. Wrong PIN counts toward the existing per-account
failed-attempt counters (same If-Match pattern) so the 4-12-digit PIN can't be brute-forced.

## 10. Chunk-8 archive LA (Director-gated run)
No structural change; its sudo gate now honours the sudo map via `evaluateAccess {action:'archive'}`
(password by default; Kunal could relax to session — floor does NOT cover it by design, D-AA-5).
