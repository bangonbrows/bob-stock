# Azure Cutover Security Checklist (execute at the SINGLE live deploy, before staff/beta)

**Status:** DEFERRED from Chunk 7 (Kunal, 2026-07-05) — rotate secrets AT the boundary we're protecting
against (leaving single-owner alpha), not months early. Everything below is a LAST-STEP action at the live
cutover, run in order, before any non-owner uses the app.

Rule of thumb: rotate every secret that has ever touched git history or a shared file, and relocate the ones
that sit in plaintext config, at the moment the trust boundary widens.

> ⚠ **THIS FILE IS INCOMPLETE — do not treat it as the whole cutover list (flagged 2026-07-29).**
> The body below (§B1–B3 and the sections after) was written 2026-07-05 and predates the Account Access
> chunk, the org/franchise work, and both July server contracts. Two known symptoms: §B2 speaks of "the"
> pepper and three function keys when there are now **three secrets and ~fourteen keys**; and several
> cutover obligations still live only in `HANDOVER.md` §6 / §5a, `REMAINING-WORK.md` and the memory
> ledger rather than here. **Before cutover, reconcile all four sources into this file**, then follow
> only this one. The two sections added 2026-07-29 below (identity teardown, Logic App cleanup) ARE
> current and were verified against the live tenant.

## B1 — SWA deploy token
- [ ] Regenerate the Static Web App deployment token in Azure.
- [ ] Store it as a GitHub Actions **Secret** (e.g. `AZURE_STATIC_WEB_APPS_API_TOKEN`); reference it via
      `${{ secrets.* }}` in the workflow.
- [ ] Remove the plaintext token from `.github/workflows/*.yml`. (Note: it remains in git HISTORY — the
      regeneration is what neutralises it; optionally history-scrub if required.)

## B2 — Function secrets → Key Vault / Managed Identity
- [ ] **Generate a BRAND-NEW production `BOB_AUTH_PEPPER`** and store it in Key Vault — do NOT carry the staging
      pepper into prod (the staging value has been in audit transcripts + git; spec-audit round 1, AGY COUNTER).
      Because the pepper is baked into every StoreCredentials hash, a fresh pepper REQUIRES re-seeding all
      StoreCredentials with freshly-minted store/Director keys (which we do at cutover anyway — production keys
      are new). So: mint fresh prod store keys + Director key → hash them under the NEW pepper → seed the LIVE
      StoreCredentials list. (GPT's nuance: relocating a pepper unchanged is fine for a pure move, but since we
      want a clean prod hashing chain free of staging secrets, mint fresh — this is a deliberate rotation.)
- [ ] Move the validateKeys / validateMoney / catalogueMerge **function keys** to Key Vault references, OR
      switch the Logic App→Function calls to **Managed Identity** (drop the `?code=` key-in-URL entirely).
- [ ] Verify each gated Logic App still verifies/validates after the move (re-run the harness cloud probes).

## B3 — Logic App SAS rotation
- [ ] Regenerate the callback SAS for every gated Logic App: push-v2-validate, pull-v2 (dual+idcursor),
      recordsteps-push, recordsteps-pull, config, email, catalogue-write, corp-costs, + the set/util apps.
- [ ] Re-publish the new callback URLs into the LIVE AppConfig `sync_config` (the client reads them from there).
- [ ] The OLD SAS in git history (commits 2c78faf / ad6e3b4) are neutralised by regeneration.
- [ ] Document a rotation cadence (e.g. rotate on staff turnover / suspected exposure / annually).

## Font subset (from the Chunk 7 audit)
- [ ] The self-hosted fonts (`fonts/`) are LATIN-ONLY (Chunk 7 A2). If any non-Latin staff/store/product name
      ever needs to render (accented/CJK/etc.), regenerate the subset to include the needed unicode-range
      blocks before launch. Fine as-is for the current WA/English data (both auditors confirmed).

## Audit-access teardown (after the phase 5-8 integration audit; hard requirement at cutover)
- [ ] Delete the scoped reset Logic App `bob-stock-archtest-reset-staging` (audit-only write path).
- [ ] Delete `StockTransactions_ArchTest` + any leftover `StockTransactions_Archive` test rows; reset
      `stock_snapshot`→v0 / `archive_state`→idle (or just drop the staging lists).
- [ ] Treat `AUDITOR-ACCESS-BUNDLE.txt` secrets as EXPOSED (shared with external AI auditors): the staging
      Director key + all store keys, the config/archive/archive-pull/reset callback SAS, and the validateKeys +
      snapshotCompute function keys are all rotated/replaced by the steps below — confirm none carry into prod.

## Verify at cutover (from the phase 5-8 integration audit — Codex coverage boundaries)
- [ ] Inspect the DEPLOYED Static Web App RESPONSE headers and confirm the CSP is served exactly as
      `staticwebapp.config.json` specifies (the audit validated the config header locally, not the live SWA
      response — a proxy/SWA quirk could drop or alter it).

## Identity & permission teardown (VERIFIED against live Azure 2026-07-29 — deferred by Kunal to cutover)

Kunal's decision 2026-07-29: leave these in place for now (the app is not in use, and the auditor
credential is still earning its keep for the pending engine re-audit) and do them **before beta**.
Everything below was read from the live tenant with `az`, not inferred from documents.

- [ ] **`BOB-Stock-Auditor-ReadOnly` — delete BOTH secrets, not one.** App ID
      `0ccf2a39-f6ac-42cd-ba04-8039c827f8ec`. ⚠ **It has TWO secrets and the notes only ever mentioned
      one:** `auditor-readonly-temp` (expired 2026-07-29) and **`auditor-readonly-2026-10`, valid
      until 2027-01-22**. Letting it "lapse" therefore leaves external-auditor access live for another
      six months. Permission is `Sites.Selected` (correctly scoped to one site) — the scope is fine,
      the lifetime is the problem. Delete the app or both secrets; mint a fresh one if an audit needs it.
- [ ] **`BOB Stock App` — remove the tenant-wide SharePoint grants.** App ID
      `acb7e793-3882-41d6-9c6d-c7a2ee78b4c6`, created 2026-03-24. **GRANTED and admin-consented**
      (verified via `servicePrincipals/.../appRoleAssignments`, not merely requested):
      `Sites.FullControl.All` on Office 365 SharePoint Online (`fbcd29d2-…`) **and**
      `Sites.ReadWrite.All` on Microsoft Graph (`9492366f-…`). Secret valid until **2028-03-23**.
      **Blast radius is the whole tenant — HR, finance, contracts — not just stock.** It is referenced
      NOWHERE: not in this repo, not in `bob-stock-money-fn` app settings; a 30-day sign-in query
      returned zero records (suggestive, not proof — the tenant may not retain SP sign-in logs).
      **Prefer removing the two roles over deleting the app** — reversible, and anything that depended
      on it fails loudly and immediately.
      ⚠ Do not confuse this with **`BOB-Stock-SP-Automation`** (`8a412900-…`), which WAS successfully
      scoped down to `Sites.Selected` in June per `audit-artifacts/COWORK-BRIEF-3-scope-down-app.md`.
      That job fixed the June app and never touched the March one.

## Dormant Logic App cleanup — ⚠ READ BEFORE DELETING ANYTHING

36 Logic Apps exist in `bob-stock-sync`. Roughly 16 look like probes. **At least six of those are NOT
debris** and deleting them by name-matching would destroy work that is still needed:

- **`bob-stock-pull-v2-idcursor-staging`, `-paged`, `-dual-staging` = the UN-APPLIED PULL UPGRADE.**
  Built June, proven on a 20,048-row list, dual-audited, runbook written, never applied. The shipping
  client already speaks the ID-cursor contract (`sync.js:1885` sends `{lastId, $top}`). These are the
  deliverable, not leftovers.
- **`bob-stock-set-syncts-index`, `set-idxtest-index`, `set-validate-unique`, `set-recordsteps-unique`,
  `set-validate-idem-unique` = CUTOVER TOOLING.** They create indexes and uniqueness constraints, and
  SharePoint will not add either to a list past ~5,000 rows — so this is exactly the equipment needed
  when the LIVE lists are created. Keep until that work is done.

Genuinely safe-looking candidates (still verify individually, do not bulk-delete):
`bob-stock-push` / `bob-stock-pull` (v1, superseded by v2), `bob-stock-pull-probe-odata`,
`-pull-probe-idxtest`, `-render-probe-idxtest`, `-render-orderonly`, `-idcursor-probe`,
`-items-idcursor-probe`, `bob-stock-tmp-c9`, `bob-stock-archtest-reset-staging` (already listed above),
and the `bobstockfnval2607` Function App.

- [ ] Walk the 36 apps one at a time against what cutover still needs. **No bulk deletion by name pattern.**

## Also at cutover (from the broader backlog)
- [ ] ~~Delete the read-only auditor Graph credential(s) if any remain.~~ → superseded by the precise
      entry under *Identity & permission teardown* above (there are TWO secrets, not one).
- [ ] Remove ALL staging test rows/fixtures ONLY IF live and staging share a site (they do — same SharePoint;
      staging uses *_Staging lists, so live lists are unaffected, but delete leftover test rows in shared lists
      like StockTransactions_Quarantine).
- [ ] Confirm `emailUrl` served only via config (Chunk 7 A4 verifies this in the client).
