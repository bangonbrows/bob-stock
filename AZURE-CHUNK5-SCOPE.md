# AZURE CHUNK 5 — Authorization at the cloud boundary (SCOPE, REV 2)

**Date:** 2026-07-04 (REV 2; REV 1 was 2026-07-03) · **Status:** awaiting SPEC-AUDIT ROUND 2 — no build started.
**Why REV 2:** after spec-audit round 1 (both auditors converged; refinements adopted, §8) Kunal changed the
design — a third credential class (the DIRECTOR key) and two new pre-beta chunks (9: per-user auth; 10:
row-level read scoping). Changed spec → re-audit before build (Kunal, 2026-07-04). §9 lists exactly what
changed since round 1.
**Sources:** `SERVER-SIDE-REQUIREMENTS.md` item 4 (GPT M-02 / P-13), `AZURE-PHASE-SCOPE.md` §2 Chunk 5 + D2,
`REMAINING-WORK.md` Bucket A item 5, R10 expert review (OWASP API1-6 posture), Chunk-4 envelope fields,
spec-audit round 1 reports (GPT APPROVE-WITH-CHANGES + AGY AGREE, 2026-07-03).
**Process:** per `AZURE-CHUNK-PROCESS.md` — this doc → GPT+AGY spec audit round 2 → Kunal final OK → build on staging.

---

## 1. The problem (why this chunk exists)

Today the ONLY thing protecting the cloud is possession of a SAS URL. Anyone who extracts a URL
(DevTools on any store device, the git history pre-rotation, a shoulder-surfed backup) can:

- **push** — forge, inflate or zero any store's stock; push Director-only `adjustment_*` rows;
  fabricate transfers/deliveries/stock-takes via record steps (Chunk 4 endpoints).
- **pull** — scrape the ENTIRE company ledger (every store's movements, supplier/invoice refs).
- **config** — fetch `sync_config`, which hands out ALL the other SAS URLs. One leaked URL escalates to all.
- **email** — trigger notification spam from the company address.

The client's `Auth.can` matrix is UX + regression control only (P-13, permanent rule). Chunk 5 makes the
server enforce identity/scope BEFORE accepting a request. This is the #1 pre-beta security blocker.

## 2. Credential model: THREE key classes (REV 2) + honest posture

**Three secrets, one mechanism.** All are generated high-entropy strings (never human-chosen), all stored
server-side as salted+peppered hashes in one `StoreCredentials` list, all rotated the same way:

| Key class | Held by | Unlocks |
|---|---|---|
| **Store key** (one per store) | that store's devices (Director enters it once per device) | ordinary ledger rows + transfer submit/receive + record steps FOR THAT STORE; pull; config |
| **HO store key** | head-office/warehouse devices | same as a store key, for the head_office store |
| **DIRECTOR key** | Kunal + Shahin only (shared — explicitly accepted), on their FOUR PERSONAL devices: Kunal's computer (separate from HO), Kunal's phone, Shahin's laptop, Shahin's phone (Kunal, 2026-07-04) | Director-only operations (§4-D2c) + **ANY-store scope, STANDALONE** — a Director device holds no store key; the Director key alone authenticates (matches the app's director role, which already spans all stores) |

**What is enforceable now vs later (auditors hold us to this):**
- **Key-class identity — ENFORCEABLE this chunk.** "This request comes from a device of store X" and
  "this request was made with the Director key present." HO staff can NOT perform Director actions
  (the REV-1 'HO device class ≈ Director' approximation is GONE — Kunal rejected it: Director ≠ HO).
- **Per-USER identity — NOT this chunk.** Whoever holds a key is that class; actor fields stay
  client-asserted. Real per-person auth = **Chunk 9** (pre-beta blocker): app-managed users exactly as
  today — HARD CONSTRAINT: no M365 accounts, no licences, no added cost — passwords salted + verified
  server-side on the existing Function/Logic-App/SharePoint plumbing, with server-side lockout.
- **Read privacy between stores — NOT this chunk.** = **Chunk 10** (pre-beta blocker; franchisees exist
  BEFORE launch): server sends each store only its own rows + transfers touching it; HO/Director get all.
- **ROLLOUT GATE (Kunal 2026-07-04):** no store device — including franchisee stores — receives the app
  until ALL chunks (5–10) are done and audited. The UI already scopes what users SEE (Wave B matrix,
  unchanged); Chunks 5/9/10 move enforcement server-side.

## 3. Surfaces to gate (inventory — verified against code)

| Endpoint | Risk today | Chunk-5 gate |
|---|---|---|
| `push-v2` (ledger) | forge/delete any store's stock | store key + StoreId match; `adjustment_*` + delivery-intake rows additionally need the DIRECTOR key |
| `pull-v2` (ledger) | whole-company scrape | store key OR Director key (Director devices hold no store key → the Director key grants whole-ledger read; row-scoping = Chunk 10, which must keep an explicit Director read context — GPT MED-3) |
| `recordsteps-push` (Chunk 4) | fabricate lifecycle steps | store key + Owner/From/To consistency; Director-only step types need the DIRECTOR key (§4-D2c) |
| `recordsteps-pull` (Chunk 4) | scrape all records | store key (read-scope = Chunk 10) |
| `config` | hands out ALL SAS URLs | store key (bootstrap — see D2b) |
| `email` | notification spam | store key. NOTE: called DIRECTLY from index.html:2164 (stock-take email), not only via Sync — that caller must attach the header too |
| `Pages._testSync` "Test Connection" (index.html:3539) | n/a (client) | must send the header + surface 401 honestly |
| `bob-stock-money-fn` (money + new verify route) | anonymous (accepted for staging) | function key from day 1 (managed identity later) |
| Chunk-6 catalogue-write (future) | — | born gated (store key + DIRECTOR key) |

## 4. Design decisions

**D2 — model: per-STORE shared secret now (Option A); per-DEVICE registration (B) = documented later
upgrade on the same wire format; MSAL/Entra (C) rejected for this app generation (cost + shared store
logins + offline-first).** Both auditors AGREED in round 1. REV 2 adds the third key class on the same
mechanism — not a new model, a finer split of "who holds which secret."

- **D2a — server storage (round-1 COUNTER adopted):** one `StoreCredentials` list:
  `StoreId, Salt, SecretHash, Version, Active, GraceUntil`. The Director key is simply the row
  `StoreId='__director'`. Hash = `HMAC-SHA-256(pepper, storeId + "\0" + salt + "\0" + secret)`;
  per-row random salt; the pepper lives ONLY in the Function App settings (Key Vault later) — never in
  SharePoint, the client, or the repo.
- **D2b — bootstrap:** the config endpoint requires a valid key (store key for store devices, Director
  key for Director devices); the config URL stays baked into the client build. The ONE thing entered on
  a new device = its single key. Client on 401: clear cached config, stop (no retry-loop), prompt.
- **D2c — DIRECTOR-key operations (REV 2 — replaces the HO-device-class approximation).** Requests for
  these carry the DIRECTOR key, which authenticates **standalone with any-store scope** (Director
  devices are personal devices, NOT store devices — Kunal's requirement 2026-07-04; store-field
  consistency checks don't bind a Director-key request to one store, mirroring the app's director
  role). A device holding only a store key can NOT perform these:
  - `adjustment_*` ledger rows (incl. stock-take-approval adjustments)
  - delivery `record` / `packaging_edit` steps **+ their linked ledger rows via `expectedLedgerKeys`**
    (R2 amendment, GPT MED-2: gate STRUCTURALLY through the step linkage — plain ledger rows carry no
    deliveryId, so NEVER infer "delivery intake" from free-text reason strings)
  - stock-take `approve` / `reject` steps
  - transfer conflict `resolve` steps + `cancel` — **with transfer-context binding** (R2 amendment,
    GPT HIGH-1): resolution/cancel writes may touch both stores ONLY when they are the two sides of
    THAT transfer (probes: A↔B allowed; arbitrary C↔D rejected). Any-store scope ≠ any-row anarchy —
    privileged writes must stay consistent with the record they act on.
  - cost-change paths (Director cost screen writes)
  Everything else needs only the store key. Kept OFF the list (GPT concurs): ordinary `deleteMovement`.
  Future cloud writes born Director-gated when they exist: catalogue publish/write (Chunk 6),
  user-management (Chunk 9), supplier admin, pricing.
- **D2d — client storage:** store key + (on Director devices) Director key in localStorage/IndexedDB
  (device possession = the credential). NEVER in backups (scrubber + sentinel) and NEVER in the Diag
  export (deny-list extension).
- **D4 — pull read-scope:** whole-ledger pull for AUTHENTICATED stores THIS chunk; real row-level
  scoping = Chunk 10 (scheduled pre-beta, not "someday"). Written caveat stands: until Chunk 10, one
  compromised store key can read the whole ledger.
- **D5 — rate limiting:** defer real rate limiting to Chunk 7; keep batch caps; log every auth reject
  (store/device/time — NEVER the presented secret).
- **Auth-context log shape (R2, GPT Q5 — build it future-proof NOW so Chunks 9/10 don't rework it):**
  every gated request logs `{credentialClassesPresent, authStoreId, targetStoreIds, operationType,
  deviceId, timestamp}` (+ `actorUserId` reserved for Chunk 9). Reject logs use the same shape.
- **D6 — rollout (round-1 COUNTER adopted — the bootstrap paradox):** two-phase. Phase 1: config stays
  open but advertises `authRequired` per endpoint; clients ship header support; keys get entered.
  Phase 2 (at the phase cutover): enforcement flips server-side. Forever after, every 401 body is
  `{status:'unauthorized', authRequired:true}` so even a stale/SW-cached client learns why.

## 5. Verification design (adopted round-1 requirements)

- **Verify-not-hash, BATCHED, FAIL CLOSED (R2 amendment — both auditors):** the Function route is
  `verify` and takes an ARRAY of credentials in ONE call — `{checks:[{storeId, presentedSecret, salt,
  storedHash}, …]}` → returns per-credential booleans (+ versions). One round-trip even when a request
  presents store key + Director key (two sequential calls = double latency/cost + awkward partial-failure
  handling). It never emits hash material. Route gated by a function key from day 1 (no anonymous
  dictionary oracle). **Any required credential false OR verify unavailable ⇒ 401 (FAIL CLOSED)** —
  deliberately opposite to the money check's fail-open: money has a client backstop, auth IS the wall.
- **No header leakage:** secure inputs/outputs on Logic App triggers/actions (secret never readable in
  run history); reject logs exclude the header; client Diag deny-list covers the keys.
- **Rotation, dual-accept from day 1:** rotation mints a new Version row; the old row stays accepted
  until `GraceUntil` (offline devices + unsynced rows survive), then flips inactive. Applies to the
  Director key row identically.

## 6. What Chunk 5 does NOT do (scope boundary)

- No per-user auth (Chunk 9 — scheduled pre-beta blocker, no-new-cost constraint locked).
- No row-level read scoping (Chunk 10 — scheduled pre-beta blocker).
- No SAS rotation / self-host / deploy-token work (Chunk 7).
- No master-data/catalogue write endpoint (Chunk 6 — born gated when built).
- No changes to live until the end-of-phase cutover; everything on staging.

## 7. Build shape (once round-2 audit converges + Kunal's final OK)

1. Setup: wire `stepsPushUrl`/`stepsPullUrl` into staging AppConfig `sync_config` (carry-forward from
   Chunk 4; Kunal supplies SAS values — Claude never materialises them).
2. `StoreCredentials` list (staging) + `verify` route on money-fn (function-keyed) + seed staging keys
   (Kunal mints; incl. a staging `__director` row).
3. Gate each staging endpoint: store-key check → Director-key check where D2c requires → consistency
   checks → 401 envelope; auth-reject log (no secrets).
4. Client: key entry UI (Director settings; store key + Director key fields), header attach in `Sync`
   AND the direct callers (stock-take email index.html:2164, `Pages._testSync`), honest 401 handling
   (clear config cache, "device not authorised", no retry-loop), backup-scrub + Diag deny-list extension.
5. Sentinels + saboteurs per change (client) + staging probes (cloud): wrong key → 401; right store key,
   wrong store on row/step → rejected; Director-only op with a store key alone → rejected; with the
   Director key → accepted (any store's fields); config without key → 401; verify-route down → 401 (fail closed); rotation
   grace window honoured; old-client (no header) against a non-enforcing endpoint → still works (D6
   phase 1).
6. Full sweep (Claude) → wave review → GPT+AGY code audit (scoped saboteurs + real staging probes,
   anti-clash rules per `AZURE-CHUNK-PROCESS.md`) → fix-everything → converge → HOLD.

## 8. Spec-audit ROUND 1 (2026-07-03) — CONVERGED; all refinements adopted (now integrated above)

GPT = APPROVE-WITH-CHANGES (2 HIGH, 3 MED, 1 LOW/MED); AGY = AGREE-all with recommendations; no
contradictions. Adopted: verify-not-hash + function-key + FAIL CLOSED (§5); HMAC+salt+pepper scheme
(§4-D2a); dual-accept rotation day 1 (§5); two-phase rollout + self-explaining 401 (§4-D6); no header
leakage (§5); endpoint-inventory additions verified against code (§3); high-entropy generated secrets;
written caveats (per-user auth and read privacy NOT this chunk — now SCHEDULED as Chunks 9/10 rather
than open-ended).

## 9. What changed in REV 2 (2026-07-04) — the round-2 audit targets

1. **DIRECTOR key added** (third credential class; §2, §4-D2c). Kunal rejected the round-1 "HO device
   class ≈ Director" approximation: HO staff must NOT perform Director actions. Kunal + Shahin share the
   key (accepted), held on their FOUR PERSONAL devices (Kunal's computer [separate from HO], Kunal's
   phone, Shahin's laptop, Shahin's phone). Same list/hash/rotation mechanics (`StoreId='__director'`).
   **STANDALONE with any-store scope** — Director devices hold no store key; the Director key alone
   authenticates and is not store-bound (matches the app's director role). Consequence to audit: a
   leaked Director key = full write control of every store until rotated.
2. **Chunk 9 scheduled** (per-user server-side auth, pre-beta blocker) with the no-new-cost / no-M365-
   accounts hard constraint.
3. **Chunk 10 scheduled** (row-level read scoping, pre-beta blocker) — franchisees exist before launch,
   so this moved from "franchise-phase someday" to a launch gate.
4. **Rollout gate:** nobody (incl. franchisee stores) gets the app until ALL chunks 5–10 are done+audited.

## 10. Spec-audit ROUND 2 (2026-07-04) — CONVERGED; amendments ADOPTED (integrated above)

GPT = COUNTER on D2c as written → AGREE after two amendments (both adopted); AGY = AGREE-all with the
same batched-verify requirement; no contradictions. AGY's D2c counter (Director must manage any store)
was already satisfied by the mid-review standalone-Director-key change.
- **Adopted:** transfer-context binding on resolve/cancel (GPT HIGH-1, §4-D2c); delivery gating via the
  step linkage, never free-text (GPT MED-2, §4-D2c); BATCHED verify, one round-trip for two credentials
  (GPT LOW/MED-4 + AGY MED-1, §5); pull accepts the Director key + Chunk 10 keeps an explicit Director
  read context (GPT MED-3, §3); auth-context log shape now, `actorUserId` reserved (GPT Q5, §4);
  future writes born Director-gated: catalogue (Chunk 6), user-management (Chunk 9), supplier, pricing.
- **Banked for Chunk 9 (both auditors confirm feasible under the no-M365/no-cost constraint):** real
  password KDF (not bare SHA-256), server-side lockout state, SHORT-LIVED SIGNED SESSION TOKENS from the
  Function (never the password on every sync); user-management writes Director-key gated from birth.
- **Standalone Director key accepted by both** (GPT: "do not restrict to HO devices; that would fight
  the real workflow"). Written caveat stands: a device holding both keys can perform Director actions
  for the allowed target scope until Chunk 9 adds per-user proof; replay stays acceptable at this stage
  because idempotency absorbs duplicate privileged writes.

## 11. Decisions summary

| # | Question | Position | Round 1 | Round 2 |
|---|---|---|---|---|
| D2 | Auth model | per-store secret now; per-device later; Entra never | BOTH AGREE | re-confirm w/ 3 key classes |
| D2a | Server storage | StoreCredentials list, HMAC+salt+pepper, hashes only | adopted (GPT counter) | re-confirm w/ `__director` row |
| D2b | Bootstrap | config requires store key; 401 self-explains | AGREE | unchanged |
| D2c | Director-only ops | **DIRECTOR key (REV 2)** — list in §4-D2c | was HO-class: superseded | COUNTER → AMENDED (§10) → AGREED |
| D2d | Client storage | local only; never backup/Diag | AGREE | + Director key handling |
| D4 | Pull read scope | whole-ledger this chunk; Chunk 10 = real scoping | ACCEPT w/ caveat | caveat now scheduled |
| D5 | Rate limiting | defer to Chunk 7; batch caps; reject logging | AGREE | unchanged |
| D6 | Rollout | two-phase + self-explaining 401 | adopted (GPT counter) | unchanged |
