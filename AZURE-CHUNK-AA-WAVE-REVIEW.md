# Account Access chunk — WAVE REVIEW (running record)

**Chunk:** Account Access Model (configurable permissions) — spec `AZURE-CHUNK-ACCOUNT-ACCESS-SCOPE.md`
(D-AA-1..5 + SR-1..11 + R2, spec CONVERGED 2026-07-09 R2: Codex PASS-with-notes + AGY all-closed).
**Build:** 2026-07-09, waves AA-W1..W6 on branch `azure-phase-5-8-server`. Enforcement matrix (SR-3
artifact): `AZURE-CHUNK-AA-ENFORCEMENT-MATRIX.md`. Staging LA change spec: `AZURE-CHUNK-AA-LA-CHANGES.md`.

## Wave summary

| Wave | Delivered | Proof |
|---|---|---|
| W1 | Discovery (2 full code sweeps) + the SR-3 enforcement matrix (20 caps + meta-actions → server truth). Findings D1–D7 (cap drift 6/15, view toggles barely exist, selling price UNGATED, D9-8 residual, PIN client-only, sync-v2.js fossil, Chunk-10 lifecycle = template). | matrix doc @ 5fe0ca6 |
| W2 | `accessPolicy.js` Function: SR-7 resolver, `evaluateAccess` (single authz decision point, fail-closed), `policyMerge` (schema + SR-1 floor REJECTED-not-corrected + DIRECTOR_LOCKOUT + server-side version bump + server-side PIN hashing), `validatePin` (pin-grant minting). validateUser: +`cancel`/`access-policy` purposes; `pin-grant` verifiable but NOT password-mintable. | `test/access-policy-proof.js` **54/54** |
| W3 | Client adoption: `Sync._applyAccessPolicy` (version-MONOTONIC + SR-4 narrowing purge + `bob_policy_purge_pending` privacy lock into the backup-export gate), `policyVersion` pull echo → immediate config re-fetch. `Auth.can` = policy overlay resolver (override FINAL → PIN lift [2 caps] → role default; FAIL CLOSED) with legacy `_caps` seed fallback pre-activation. **D1 drift CLOSED**: all 6 hard-coded gates (transfer create/receive/cancel, resolve, stock-take approve/reject, thresholds) → `Auth.can`. 5 view-toggle caps seeded to today's exact behaviour. `d.accessPolicy` persisted via db.js meta. | 219/219 sentinels after refactor (behaviour-preserving) |
| W4 | Account Access screen (Settings → 🔑): data-driven role-matrix editor (custom roles in the blob render automatically), per-account exceptions (D-AA-2, FINAL semantics stated in-UI), sudo checklist with 🔒 floor rows, Activate/Publish via `access-policy` sudo. `Sync.publishAccessPolicy` (fail-closed needSudo, no local version mint). **Hole closed pre-emptively:** `editAccessPolicy` capability — any account can mint an `access-policy` proof with its own password; the capability (+ DIRECTOR_LOCKOUT merge invariant + first-write role assertion) is what pins WHO may use one. | proof suite 54/54; 219/219 |
| W5 | Server-side PIN: `Sync.pinUnlock` mints the pin-grant (policy-blob PIN, hash server-side only; delivery keeps `expiresAt` as UX hint); `_verifyPinValue` routes server-side under an active policy (needs internet at PIN entry — the accepted D9-8 trade-off); PIN set/clear becomes a policy write under activation. **PIN-to-receive**: `submitReceive` offers the PIN unlock to a blocked store account (inert pre-activation). Action-time sudo `_actionSudo` (approve/resolve×3/delivery; STRICTLY inert pre-activation; sudo-map 'session' skips the prompt). `_withIngestProofs` attaches session + pin-grant + action proofs to push/steps-push (ignored by pre-AA LAs → inert). | 219/219 + 54/54 |
| W6 | Sentinels **S-229..S-240** (12) + 12 matching saboteur mutations: SR-7 order incl. override-beats-PIN, pre-activation parity, THE activation covering sentinel (S-231, Kunal's PIN-to-receive default), SR-4 purge, version-monotonic, fail-closed-under-policy, publish fail-closed, policy privacy lock, ingest proofs, screen floor lock, server-side PIN routing, `_actionSudo` inertness. Suite now **231 sentinels**. | 231/231 clean; scoped saboteur run: see below |

## Honest residuals / disclosed conservatisms (for auditors + the internal deep audit)
1. **`seeSellingPrice` is CLIENT-ONLY** (labelled). Sell price ships in public master_data to every device;
   server-withholding would need per-account catalogue delivery — out of scope, Kunal accepted "just hide it"
   (2026-07-09).
2. **`costHistory` rows are NOT purged on seeCost revoke** — they're the device's OWN recorded data; the
   purge targets the merged corp-costs payload (`_costRv`-marked). Server 403s all further cost reads (SR-10).
3. **seeCost visibility coupling:** granting seeCost also reveals the franchise-discount/price COLUMNS in the
   products table (edit actions stay behind editPricing).
4. **Existing publish/user-admin/backup prompts remain always-prompt** even if the sudo map is relaxed to
   'session' for them (conservative v1; only the NEW approve/resolve/delivery prompts honour 'session').
5. **Stock-take REJECT is not sudo-prompted** (approve is). Reject makes no stock adjustment.
6. **PIN entry under an active policy requires internet at that moment** (server-side verify + grant mint) —
   the same D9-8 trade-off Kunal accepted for Director actions. Offline PIN = wait for connectivity.
7. **Device-level corp-cost caching remains Chunk-6 design** (corporate DEVICE fetches cost); the SR-4 purge
   fires on revoke EVENTS for the logged-in account, not on every login of a lesser account on a shared device.
8. **Scope helpers (`isHO`/`isMgmt`/`isStoreLevel`/`isAtLeast`) remain role-NAME-based** — they drive Chunk-10
   UI scoping, not capability gates. A custom role gets capability gating from the blob; its scope stays its
   credential StoreIds; unknown role names fail toward least privilege in these helpers.
9. **The LA changes are SPECIFIED, not yet applied to staging** (`AZURE-CHUNK-AA-LA-CHANGES.md`). Until they
   are: everything client-side is inert pre-activation, the Functions are deployed with the repo, and NO policy
   can be published (no endpoint) — so the app behaves exactly as pre-chunk. Staging application + live cloud
   proof is the remaining W6 gate before the external audit.

## Activation model (single flag-day, no drift window)
Pre-activation = legacy seed everywhere (proven: S-230, S-240; 219 pre-existing sentinels). Activation =
Director publishes the default blob (S-231 proves the ONE behaviour change: store-account receive becomes
PIN-gated). Server enforcement flips with the LA application + `_policyRequired` advertisement — staged like
Chunk 5's `_authRequired`.

## FINAL GATE + AUDITS (2026-07-10)
- **Smoke: 239/239 sentinels clean.** Function logic proof: **61/61.** Static gates green.
- **Full saboteur sweep: 257 CAUGHT / 0 BLIND / 0 skipped / 0 INFRA-FAIL** (single clean run). An earlier full
  run flagged 1 blind (client RESERVED-cap guard was a broken object-literal `{__proto__}` that never matched
  the string — FIXED to an array test mirroring the server Set) + 1 skip (S-238 anchor drifted on the AA-10
  dataset change — re-anchored); both re-confirmed CAUGHT.
- **Internal deep audits:** client (3 P1 + 11 P2 + 13 P3 → all fixed/accepted, re-verified) + server
  (independent, driven against the DEPLOYED functions with real crypto → 0 P0/P1/P2, one P3 SRV soft-lock
  tracked). See `audit-artifacts/AA-INTERNAL-AUDIT-*` + the staging ledger.
- **External audits:** **Codex PASS-with-notes** (ran the full harness on an isolated worktree + Azure
  read-only; only the tracked SRV-P3). **AGY BLOCK** ground-truthed — its P1 CSV finding was REAL but
  mis-rated (client-only view hint; price is public catalogue data, P-13) → corrected to P3 + fixed as
  **AA-EXT-1** (sentinel S-248). See `AZURE-CHUNK-AA-EXTERNAL-AUDIT-RESPONSE.md`. No blocking finding stands.
- **Tracked for staging-apply (not code-fixed now, both fail safe):** SRV-P3 (non-atomic 3-item policy write
  soft-lock) + the positive-path E2E (needs a throwaway `srvaudit_` test director).

## Saboteur proof (2026-07-09)
Scoped run S-229..S-240: **12 CAUGHT / 0 BLIND / 0 INFRA-FAIL** (S-240's first sabotage variant crashed the
suite at sentinel 18 — a mutated `_actionSudo` threw on null policy in unrelated approve flows; replaced with
a non-crashing variant that routes to the prompt, same conceptual bug, only S-240 flips). Suite total:
**231 sentinels / 240+ mutations**, clean baseline 231/231.

## Next gates
1. ~~Scoped saboteur proof of S-229..S-240~~ DONE — 12/12 CAUGHT, 0 BLIND.
2. Apply `AZURE-CHUNK-AA-LA-CHANGES.md` to staging + real-cloud E2E proof (mock-must-match-server rule).
3. **Internal fresh-session DEEP AUDIT (Kunal 2026-07-09)** — whole-app regression audit by a clean Claude
   session per `AUDIT-BRIEF-AA-INTERNAL.md`, BEFORE any external ask.
4. External per-wave audit (Codex + AGY) with this doc + the matrix + LA spec as the pack.
