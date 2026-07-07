# AZURE CHUNK 5 — Cloud-boundary authorization — WAVE REVIEW

**Date:** 2026-07-04 · **Status:** BUILT + self-proven on staging; client NOT committed, live UNTOUCHED.
**Spec:** `AZURE-CHUNK5-SCOPE.md` REV 2 (two spec-audit rounds converged; Kunal decisions locked).
**Process:** `AZURE-CHUNK-PROCESS.md`. This is the wave pack for the GPT+AGY code audit.

---

## What shipped

**Server (staging only — live Logic Apps untouched):**
- **`validateKeys` verify route** on `bob-stock-money-fn` (Windows consumption). Batched, boolean-only
  (`{storeOk, directorOk}`), never emits hash material. HMAC-SHA-256(pepper, storeId+"\0"+salt+"\0"+secret);
  pepper in the Function App setting `BOB_AUTH_PEPPER` only. `authLevel:'function'` from day 1. Grace-window
  (dual-accept rotation) filtering done in the Function. `validateMoney` retro-gated to `authLevel:'function'`.
- **`StoreCredentials_Staging`** SharePoint list (StoreId[indexed], Salt, SecretHash, Version, Active,
  GraceUntil). Seeded 4 store rows + `__director`. Server stores only salted+peppered HASHES.
- **Gated endpoints** (all on staging): `recordsteps-push-staging`, `recordsteps-pull-staging`,
  `push-v2-validate-staging`, `pull-v2-dual-staging`, `pull-v2-idcursor-staging`, new
  `bob-stock-config-staging` (born gated, reads `AppConfig_Staging`), new `bob-stock-email-staging`
  (gated stub — enforces the key, returns 200, SENDS NOTHING so probes don't spam).
- **`AppConfig_Staging`** created + `sync_config` item written with all 5 staging URLs + `authRequired` flags.

**Auth model enforced server-side (per D2c):**
- No valid key → **401 `{status:'unauthorized', authRequired:true}`** + an auth-reject row logged
  (store/device/time, NEVER the secret).
- Store key present → its store's ordinary rows/steps accepted; **rows/steps for another store → rejected
  `STORE_MISMATCH`**.
- Director-only ops (adjustment_* ledger rows; delivery record/packaging_edit steps; stock-take
  approve/reject; transfer resolve/cancel; cost writes) with only a store key → **rejected
  `DIRECTOR_REQUIRED`**; with the Director key → **accepted, any store** (`authClass:director`).
- **Transfer-context binding (GPT R2 HIGH-1):** a resolve/cancel is accepted only when its store fields
  match the transfer's genesis submit (in-batch OR on-list). Mismatch → permanent reject
  `BAD_TRANSFER_CONTEXT` (+quarantine). Genesis not yet visible → retryable `TRANSFER_CONTEXT_PENDING`
  (client retries; never quarantined).
- **Fail-closed:** verify route unreachable/misconfigured → 401 (proven by pulling the pepper live).

**Client (`sync.js`, `index.html`, `sw.js` v12 — NOT committed):**
- Keys entered once per device in Director settings (store selector + store-key + Director-key fields;
  Director-gated via `Auth.can('manageUsers')`). Stored in localStorage (D2d).
- `Sync._withAuth` attaches an `auth` envelope to push/pull/pushSteps/pullSteps/config + the two direct
  callers (stock-take email `index.html`, `Pages._testSync`). **No keys stored → body byte-identical to
  pre-Chunk-5** (D6 phase-1 compatibility).
- 401 handling (D6): clear cached config, set `_unauthorized`, surface "device not authorised", **pause
  the cycle — NO retry-loop**. `saveAuthKeys` clears the pause and re-bootstraps.
- Config advertises `authRequired`; a keyless device on an auth-advertising server is warned before flag day.
- Keys excluded from backups (`_REUSABLE_AUTH_KEYS` + import scrub) and from Diag (bsk_/bdk_ redaction).

## Build deviations from the spec (auditors: please scrutinise)
1. **Keys travel in the request BODY (`auth` envelope), not an HTTP header.** Custom headers trigger a CORS
   preflight whose Logic App handling is a deploy risk; body fields are CORS-neutral and the whole trigger
   body is hidden via `secureData`. Functionally identical gate; flagged because the spec said "header".
2. **Verify contract is v2 (`{claimedStoreId, storeKey, directorKey, rows[]}` → `{storeOk, directorOk}`),
   not the round-1 sketch's per-credential `checks[]`.** Reason: Logic Apps consumption CANNOT apply
   `secureData` to Compose/Select/Query, so building a checks array in WDL would leak the presented secrets
   into run history. The Function now does the pairing + grace-filtering + verification; the Logic App only
   forwards its (secured) inputs. Still ONE round-trip, still boolean-only out.

## Harness
- **Smoke: 182/182 PASS** (added S-186..191: _withAuth envelope + phase-1 compat, push-401 terminal/no-loop,
  unauthorized-pauses-cycle + saveAuthKeys-clears, backup scrub, Diag redaction, Director-gated entry).
- **Scoped saboteur S-186..191: 6 CAUGHT / 0 BLIND / 0 SKIPPED** (baseline 182/182). NOTE: S-191 was
  initially BLIND — the headless test hit `_saveAuthKeys`'s no-keys early-return before reaching the
  Director gate, so it proved nothing (P-17 in action). Rewritten to INJECT valid key inputs so the gate
  is the only blocker → now CAUGHT. Underlying gate was always real; the test was hollow.
- **Full sweep (Claude's gate): 200 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA-FAIL of 200** (2026-07-04, all
  mutations S-01..S-191 + b-variants; baseline 182/182; log scratchpad/fullsweep-chunk5.out).

## Real staging cloud probes (self-run, claude5-namespaced — auditors re-run gpt_/agy_)
P1 no-auth→401 · P2 own-store submit→accepted · P3 cross-store→STORE_MISMATCH · P4 stocktake-approve w/
store key→DIRECTOR_REQUIRED · P5 Director standalone approve any store→accepted(director) · P6 wrong key→401 ·
P7 Director resolve, genesis in batch, stores match→accepted · P8 same record C-D stores→BAD_TRANSFER_CONTEXT ·
P9 no genesis→TRANSFER_CONTEXT_PENDING(retryable) · P10 genesis on list→accepted · P11 neg unitCost→BAD_MONEY
(money fn still wired) · P12 pepper pulled→verify 500→push 401 (FAIL CLOSED)→restored→200 · ledger L1-L7 +
config C1-C2 + email E1-E2 all as expected. All ✓.

## Code-audit round 1 (2026-07-04) — AGY full PASS; GPT BLOCK (1 P1, ground-truthed + FIXED)
Both re-ran the harness (182/182, scoped 6/0). AGY passed all A–G cloud probes. **GPT found 1 real BLOCKER
AGY missed** (the recurring pattern — why GPT is the gate):
- **P1 BAD_LEDGER_CONTEXT hole:** the transfer-context binding validated a resolve/cancel step's OWN store
  fields against the genesis, but NOT the ledger rows it references via `expectedLedgerKeys`. GPT smuggled a
  whitford adjustment (tagged with an ardross→karrinyup TransferId) in as that transfer's "resolution" and it
  was accepted. **Ground-truthed by Claude on staging — reproduced exactly.** Note: the exploit requires the
  DIRECTOR key (already all-store-trusted), so it's a reconciliation-integrity gap, not a privilege
  escalation — but we committed to rejecting it, and it matters more once Chunk 9 narrows the Director key.
- **FIX (server-side, deployed + proven):** recordsteps-push now runs a store-context invariant — for every
  transfer stock-effecting step (submit/receive/resolve/cancel), it queries `StockTransactions_Validate` for
  rows tagged with that TransferId and **rejects the step (`BAD_LEDGER_CONTEXT`, quarantined) if ANY such row
  has a StoreId outside {From, To}**. A transient lookup failure → retryable `LEDGER_CONTEXT_PENDING` (never
  silently accepted). Chose the invariant over parsing each step's key list = no fragile Payload-JSON handling
  in WDL, and it catches foreign rows even if unreferenced. Deduped against the genesis loop (no double-count).
  **Proven on staging:** GPT's exact smuggle → now `BAD_LEDGER_CONTEXT`; a legit resolve (adjustment at To) →
  still accepted; full regression battery (no-auth 401 / store-key own-store / DIRECTOR_REQUIRED / clean
  transfer) all green on the patched stack.
- **GPT D2 caveat (Active) addressed:** `validateKeys` now enforces `row.Active === false → unusable`
  (defence in depth; was relying solely on the Logic App OData filter). `Active` added to the credential
  `$select` in all 7 gated Logic Apps so the Function receives it. Unit-tested (inactive rejected, active ok,
  missing Active = trust query).
- **Harness impact: NONE** — the fix is server-side (WDL + Function); no client/test code changed, so smoke
  182/182 + full sweep 200/200 stand. Client-side correctness (resolve emits adjustments at To) is already
  covered by S-181. Server enforcement proven by cloud probes (same model as Chunk 2/4 server validation).
- **AGY verdict: full PASS** (harness + all A–G) — signed off. **Both build deviations D1/D2 ACCEPTED by both.**

### Round 1b (2026-07-04) — GPT re-verify: BLOCK REMAINS (2nd hole, same family), ground-truthed + FIXED
GPT re-drove the fix: the exact tagged smuggle now rejects, but GPT found the SAME fix family still open via an
**UNTAGGED** referenced row: push a foreign (whitford) adjustment with NO TransferId, then a resolve whose
`expectedLedgerKeys` point at it — accepted, because the store-context INVARIANT only inspected rows *tagged*
with the transfer id, not rows *referenced* by the step. **Reproduced exactly on staging.** GPT's design
answer: the invariant should stay but is not sufficient — per-referenced-row validation is required.
- **FIX round 2 (server-side, deployed):** genuine per-key validation. For every transfer stock-effecting
  step, the gate now (a) parses `expectedLedgerKeys` from the Payload (fail-soft: a JSON throw → treated as
  no keys, never a silent confirm), (b) looks up each referenced key in `StockTransactions_Validate`, and
  requires each present row to have `TransferId == RecordId` AND `StoreId ∈ {From,To}`. Present-but-wrong-
  context → **reject `BAD_LEDGER_CONTEXT`**; genuinely-missing → **retryable `LEDGER_CONTEXT_PENDING`**
  (never silently accepted). The tagged-foreign invariant is KEPT (catches unreferenced foreign tagged rows).
  Key count capped at 200/step (giant-filter guard). Deduped vs the genesis loop.
- **PROVEN on staging (6-case battery):** T1 untagged foreign ref → BAD_LEDGER_CONTEXT ✓; T2 tagged foreign
  ref → BAD_LEDGER_CONTEXT ✓; T3 legit ref at To → accepted ✓; T4 missing ref → LEDGER_CONTEXT_PENDING ✓;
  T5 no-auth → 401 ✓; T6 cross-store → STORE_MISMATCH ✓.
- **Perf note (Chunk 7):** each transfer stock-effecting step now does 2 SharePoint GETs (tagged-rows + by-key
  lookup); fine for functional/alpha record-step batch sizes, revisit if volume grows.
- Harness still unchanged (server-only fix): smoke 182/182, scoped 6/0, full sweep 200/200.

### Round 1b re-verify (2026-07-04) — BOTH PASS → CONVERGED → HOLD
GPT (the auditor that re-blocked twice on this fix family) and AGY independently re-drove T1–T6 + the genesis
wrong-side check, all clean and matching. GPT added an extra probe — a referenced row at an endpoint store but
tagged to a DIFFERENT transfer id → correctly rejected BAD_LEDGER_CONTEXT (per-key validation covers
wrong-store, wrong-transfer, and missing). **Both explicitly agree the per-step-type allowlist is NOT a HOLD
blocker** — GPT logs it as a beta/Chunk-7 hardening nice-to-have (would block "semantically wrong but
context-bound" rows). Recorded to the Chunk-7 backlog. **Chunk 5 = CONVERGED. Both build deviations (D1 body
auth envelope, D2 Function-side verify) accepted by both across the whole review. → HOLD for the end-of-phase
6-way.**

### Chunk-7 backlog item (from this review)
- Per-step-type ledger row allowlist on transfer stock-effecting steps (e.g. resolve → adjustment_* only,
  receive → transfer_in, submit → transfer_out): rejects a context-bound but semantically-wrong row type.
  Deferred by both auditors; add during Chunk 7 hardening or if beta security work reopens this WDL.

## Scope boundary / carry-forwards
- No per-user auth (Chunk 9), no row-level read scoping (Chunk 10) — both scheduled pre-beta blockers.
- Prod hardening (Chunk 7): move pepper + function keys to Key Vault / managed identity; rotate; the
  auth-reject quarantine currently rides the StockTransactions_Quarantine list.
- **Cleanup DONE (2026-07-04):** deleted `bob-stock-tmp-sp-passthru` (build-only SP proxy — security) +
  `bob-stock-create-storecreds` (one-shot); removed all claude5_* rows (RecordSteps_Staging,
  StockTransactions_Validate) + the probe-generated auth_reject rows (StockTransactions_Quarantine, 12).
  StoreCredentials_Staging seed rows KEPT (staging creds the auditors will use — Kunal supplies the
  plaintext keys + the 6 callback URLs to them; both are out of the repo).
