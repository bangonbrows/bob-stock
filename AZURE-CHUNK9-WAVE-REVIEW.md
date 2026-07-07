# Azure Chunk 9 — Wave Review (per-account server-side auth)

**Status:** BUILT on staging, sentinels green, on HOLD (person-auth DORMANT until the sync_config flip at
activation). Design review converged (Codex SOUND-WITH-CHANGES + AGY CONVERGE, 9 adopted changes in
AZURE-CHUNK9-SCOPE.md §6). This is the internal build record + deviations for the code audit.

## What shipped
| Layer | Artifact | Role |
|-------|----------|------|
| SharePoint | `UserCredentials_Staging` (15 cols, Username indexed+unique) | the cloud account directory (salt/hash never leave SP) |
| Function | `validateUser` | constant-time peppered password verify + mints purpose-bound signed proofs |
| Function | `verifyProof` | validates a proof (signature + exp + purpose + device-context + tokenVersion) |
| Function | `mintUserCredential` | server-side salt+HMAC for create/reset (enforces D9-4 lengths; hash never returned) |
| Logic App | `bob-stock-user-verify-staging` | login/sudo: device-gate-FIRST, person verify, server-side lockout + email |
| Logic App | `bob-stock-user-admin-staging` | Director-gated CRUD (create/setPassword/deactivate/activate/setRole/unlock/list) |
| Existing LAs | catalogue-write + archive | person-proof gate injected (device + person, 401 vs 403) |
| Client | sync.js | personLogin/sudo/_withPerson/userAdmin + proof plumbing |
| Client | index.html | Auth.login rework (server + offline PBKDF2 verifier + fail-closed); sudo UI; user-mgmt screens; backup scrub |
| Tests | smoke-test.js / saboteur-runner.js | S-214..S-220 (7 sentinels + 7 saboteurs) |

## Decisions realised (D9-1..8 + adopted changes)
- **Two-layer:** device key (Chunk 5) + person proof. Every Director WRITE verifies BOTH.
- **Auth proof, not password-per-request (Codex P1):** password transits only at login/sudo; a short-lived signed
  proof carries authorisation. Session 12h; sudo 5min purpose-bound (publish/archive/user-admin/backup/…).
  Device-context bound (no cross-device replay); tokenVersion bump on password reset kills outstanding proofs.
- **Converged lockout (AGY-9-1 + Codex):** device-gate-FIRST means a store key can never reach Director
  person-verification → lockout-as-DoS killed WITHOUT a Director bypass; Directors still lock (stolen device);
  5 wrong → 15/30/60/120min (If-Match retry); notify-once-per-transition email; break-glass runbook.
- **Offline verifier (both):** WebCrypto PBKDF2-HMAC-SHA-256, per-device salt, 210k iters; localStorage (never
  in the Dexie backup); no fallback on deleted verifier; server re-verifies regardless.
- **Kunal sets all passwords (D9-4):** no self-service/MustChange; min 8 (10 Director). Lockout VISIBLE to the
  Director (user-mgmt lock-state + email).
- **Sudo re-prompt (D9-6)** before publish/archive/user-admin/backup. **D9-7 deferred** (SERVER-SIDE-REQUIREMENTS
  4b) with the D9-8 ingest-proof intent noted. **PIN untouched (D9-5).**
- **Honest audit language (Codex P2):** "authenticated as account X from device/store Y", never "person X did it".

## Build deviations / notes for the audit
1. **`DisplayName` is RESERVED in SP REST `$select`** (400 "Value does not fall within the expected range") →
   the column is `FullName`.
2. **secureData unsupported on Compose/Response `outputs`** (Chunk-5 lesson) → secret-bearing rows are built
   inline in the SECURED ApiConnection action; Response actions secure `inputs` only.
3. **READS vs WRITES:** person-proof is ENFORCED server-side on the WRITES (catalogue-write, archive-run). The
   READS (corp-costs, archive-pull) stay device/role-scoped (already correct via Chunk 5/6/8); the client
   attaches a session proof (harmless, enforce-later) but the server does NOT require it (avoids boot-timing
   breakage). **Flag for the audit:** confirm this reads-device/writes-person split is acceptable.
4. **DORMANT until activation:** userVerifyUrl/userAdminUrl are NOT yet in sync_config, so the client uses the
   legacy local path and publish's _sudoPrompt returns '__no_person_auth__'. BUT the catalogue-write + archive
   LAs now REQUIRE a proof — so at activation the client + config MUST flip together (documented coordination).
5. **Account model (Kunal 2026-07-07):** per-account not per-person (§5b). A configurable Account Access Model
   (editable caps + per-store overrides + org-structure) is a SEPARATE future chunk — NOT built here.

## INTERNAL DEEP AUDIT (Claude, 2026-07-07, BEFORE external handoff — full detail: audit-artifacts/CHUNK9-DEEP-AUDIT-INTERNAL.md)
Ran 3 adversarial code-review subagents (Function / Logic Apps / client) + a LIVE attack suite
(scratchpad/c9-attack.mjs) that actually forges/replays/bypasses against the deployed endpoints. Found + FIXED
a cluster of REAL issues; re-proven (attack suite 17 blocked / 0 VULN):
- **[CRITICAL] Store key could lock the Director** — the device gate only checked "some valid key", then
  person-verified ANY account, so a store key spamming wrong passwords at a Director locked the admin out (the
  agreed device-gate-first was NOT implemented). FIX: `Account_bound` — a request may only person-verify +
  increment an account when the device is authorised for THAT account (director device, or the account's own
  store device); otherwise generic invalid_credentials with NO counter touch. Also kills cross-store lockout.
- **[HIGH] `LockedUntil` type-confusion → lockout bypass** (typeof-string gate skipped a numeric/Date lock).
  FIX: `toIso()` coercion, fail-closed on all types.
- **[HIGH] No last-Director guard** — deactivate/setRole could brick user-admin by removing the last Director.
  FIX: count active Directors → `409 last_director`.
- **[MED] Store credential hashes leaked into LA run history** (`Get_creds` not secured). FIX: secured in both LAs.
- **[MED] PIN idle-lock didn't wipe the session proof** (walk-away exposure). FIX: `PIN.lock()` clears proofs.
- **[MED] Lockout counter droppable under high concurrency** (3-try If-Match ceiling). FIX: raised to 10.
- **[LOW-fix] Publish/archive gate lacked a role check** (staff proof + Director device could publish). FIX:
  gate now also requires proof role == director.
- **[LOW-fix] `locked` enumeration-oracle field** removed from the Function (LA computes lock-state itself).
- **[LOW-fix] Edit-User modal stored-XSS** (`u.name` unescaped). FIX: `UI.esc`.
- **Accepted/documented (P-13 offline tradeoffs):** proof deviceContext binding is fine given the two-layer
  requirement (a stolen proof is useless without the device key); stale/poisonable offline verifier is
  offline-read-only and re-verified server-side on every write + online login.

## Proofs run (Claude's local gate)
- validateUser/verifyProof unit (14) + mintCredential length rules + LockedUntil numeric-coercion unit.
- Login/lockout/proof E2E (real LA): device-gate-first, lockout progression, oracle-safety, reset-on-success,
  sudo purpose-binding. User-admin lifecycle E2E (real LA): create/login/lock/unlock/deactivate — all pass.
- Publish + archive person-enforcement E2E (real LAs): 401 device / 403 person / 200 with valid sudo proof.
- Client login rework browser-proven (15/15). User-management UI browser-proven vs real cloud (create/unlock/
  deactivate). Sentinels 211/211 green; scoped saboteurs S-214..220 all CAUGHT (S-214 strengthened after it
  first went BLIND on stored-metadata). Post-fix attack suite: 17 blocked / 0 VULN.

## Cleanup owed before audit-handoff / cutover
Delete `bob-stock-tmp-c9` gated passthru; delete `UserCredentials_Staging` test rows (uitest, bootstrap kunal)
OR keep for the milestone audit; rotate the validateUser/verifyProof/mintUserCredential function key +
BOB_PROOF_SECRET at cutover; mint fresh production accounts under the prod pepper. Staging password in
scratchpad/.c9-user-passwords.txt (staging-only).
