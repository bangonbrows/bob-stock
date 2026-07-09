# EXTERNAL AUDIT PACK — Account Access chunk (Codex + AGY)

**You are auditing the Account Access Model chunk of the BOB Stock app** (configurable per-account
permissions: an editable capability matrix, per-account overrides, a data-driven role model, a server-side
24h PIN, and a Director "ask for my password again" sudo policy). Branch: **`azure-phase-5-8-server`**.
Both auditors run **in parallel** — this is a paper + LOCAL-harness review (no shared staging cloud E2E in
this round), so there is no one-at-a-time contention.

## Non-negotiables (framework rules)
- **RUN it, don't just read it.** Boot the real app in a browser / a Node vm and drive the flows; static-only
  review misses runtime-scope bugs. The harness is in `test/` (see below).
- **Report ONLY — you fix nothing.** Produce a findings list (P0/P1/P2/P3 + evidence + exact repro). Claude
  is the sole engineer and ground-truths every finding by running it.
- **Isolate your worktree.** Run on your OWN copy of the repo, never a shared/live tree. Commit/stash nothing
  into Claude's tree.
- **Scoped saboteurs only.** If you mutate, target only the fixes/areas you're reviewing —
  `SABOTEUR_CONCURRENCY=5 SABOTEUR_ONLY=S-2xx,... node test/saboteur-runner.js`. NEVER run the full sweep
  (that's Claude's local gate; it churns for hours on an external box).
- **No cloud load tests.** The staging Logic Apps share one SharePoint connection with LIVE sync. If you probe
  staging at all, functional single-shot only, and prefix every test id `gpt_` / `agy_`.
- **Ground-truth, don't defer to the internal reports.** Two internal deep audits already ran (client + server)
  — their reports are in `audit-artifacts/` as CONTEXT. Treat them as claims to falsify, not facts.

## What's already been done (so you calibrate, not so you trust it)
- Built across 6 waves; internal CLIENT deep audit found 3 P1 + 11 P2 + 13 P3 — **all fixed + re-verified**.
- Internal SERVER deep audit (independent session, driven against the DEPLOYED Azure Functions with real
  crypto + the deployed Logic App definitions) — **0 P0/P1/P2**, one P3 (non-atomic 3-item policy write,
  fails safe) tracked for staging-apply.
- **Local gate at hand-off:** smoke **238/238** sentinels clean; Function logic proof **61/61**; full saboteur
  sweep **__N__ CAUGHT / 0 BLIND** (Claude confirms this exact number in the cover note before sending);
  static gates (verify-app / verify-release / csp-check) green.
- The whole feature is **inert pre-activation** — nothing changes until a Director publishes a policy AND the
  staging Logic Apps are switched to enforce. The live app on `main` is untouched.

## Read these (the map)
| Doc | What it is |
|---|---|
| `AZURE-CHUNK-ACCOUNT-ACCESS-SCOPE.md` | Decisions D-AA-1..5 + spec-review SR-1..11 + R2 (govern the build) |
| `AZURE-CHUNK-AA-ENFORCEMENT-MATRIX.md` | The SR-3 contract: every capability → where the SERVER enforces it |
| `AZURE-CHUNK-AA-LA-CHANGES.md` | Logic App change spec (some applied, some pending — noted inline) |
| `AZURE-CHUNK-AA-WAVE-REVIEW.md` | Wave-by-wave build record + 9 disclosed residuals |
| `AZURE-CHUNK-AA-STAGING-LEDGER.md` | What's applied to staging + the tracked SRV-P3 |
| `audit-artifacts/AA-INTERNAL-AUDIT-REPORT.md` + `-RESPONSE.md` | client audit findings + resolutions (CONTEXT) |
| `audit-artifacts/AA-SERVER-AUDIT-REPORT.md` | server audit findings (CONTEXT) |

## Where the code lives
- **Client:** `index.html` — `Auth._caps` + `Auth.can` (the resolver, ~line 1039), the Account Access screen
  (`Pages._dirAccessPolicy` + `_ap*`), PIN flow (`_pinSource`/`_verifyPinValue`/`_pinUnlockModal`/`_actionSudo`),
  backup scrub (`_scrubBackupSecrets`/`_exportBackup`). `sync.js` — `_applyAccessPolicy` (adopt + SR-4 purge +
  reconciler), `publishAccessPolicy`, `pinUnlock`, `_withIngestProofs`, proof relay. `phase2.js` — transfer
  gates routed through `Auth.can`; `db.js` — `accessPolicy` persistence.
- **Server:** `azure-functions/src/functions/accessPolicy.js` (`resolveCapability`/`evaluateAccess`/
  `policyMerge`/`validatePin`) + `validateUser.js`. Logic Apps are deployed to staging (not in-repo) — the
  spec is `AZURE-CHUNK-AA-LA-CHANGES.md`; read the DEPLOYED WDL via `az resource show` if you have Azure access.

## The harness
- `node test/smoke-test.js` — 238 sentinels (drives the booted app). The AA ones are **S-229..S-247**
  (S-247 is the client/server resolver PARITY check).
- `node test/access-policy-proof.js` — 61 adversarial probes against the REAL `accessPolicy.js` module.
- `test/saboteur-runner.js` — mutation runner (scoped only, per the rule above).

## The highest-value things to attack (don't limit yourself to these)
1. **Regression / pre-activation parity** — with NO policy adopted, is the app byte-behaviourally identical to
   pre-chunk for every role (staff / store-manager / franchisee / TM / HO / director)? The 6 transfer/stock-take
   gates were re-routed through `Auth.can` — verify no role's behaviour drifted.
2. **The resolver (SR-7 order)** — override (allow AND deny) FINAL beats the PIN; PIN lifts only
   stockTakeCount/transferReceive; unknown cap/role/no-policy fail closed; RESERVED cap names denied;
   client `Auth.can` == server `resolveCapability` (attack the parity — S-247 claims they match).
3. **Identity (AA-01)** — overrides keyed by USERNAME on BOTH sides; confirm an id-keyed override does NOT bind
   and the server never consults UserId.
4. **The SR-4 cost-purge lifecycle** — revoking seeCost really removes cached cost from Dexie AND the backup,
   including the logged-OUT adoption path and a stuck-purge reconcile; the privacy lock blocks export.
5. **PIN (AA-09)** — the request contract (`actorUsername`), LA-derived deviceContext, server-side grant, the
   idle-lock clearing the client flag, the deny-override not looping.
6. **Sudo floor (SR-1)** — the matrix editor + sudo policy edits are always-password and can't be relaxed;
   `policyMerge` REJECTS a floor-violating / director-lockout blob rather than silently correcting; `baseVersion`
   CAS blocks a two-Director lost update.
7. **Backup / injection / XSS** — a crafted backup can't smuggle an accessPolicy blob or reintroduce denied
   cost; policy-blob keys can't break out of the screen; the OData scope filter fails closed on hostile chars.
8. **Proof plumbing** — proofs never touch disk/backup/Diag; the tab-to-tab relay stays in memory; expired
   proofs are dropped.

Verdict format: **PASS / PASS-with-notes / BLOCK**, numbered findings, each with a concrete repro.
