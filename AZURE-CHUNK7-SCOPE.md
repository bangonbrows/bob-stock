# AZURE CHUNK 7 — Hardening / cleanup (SCOPE)

**Date:** 2026-07-05 · **Status:** SCOPING — no build started. Chunks 4+5+6 on HOLD.
**Sources:** `SERVER-SIDE-REQUIREMENTS.md` items 7 (SAS rotation) + 10 (self-host vendor), `AZURE-PHASE-SCOPE.md`
Chunk 7, carried-forward from the C5/C6 audits, `REMAINING-WORK.md`, current-code discovery (2026-07-05).
**Process:** `AZURE-CHUNK-PROCESS.md` — this doc → Kunal's decisions → GPT+AGY spec review → build.

---

## 1. What Chunk 7 is
Not a feature — the pre-broader-use security cleanup: remove external dependencies, tighten the browser
security policy, and rotate/relocate secrets before the app leaves the trusted single-owner alpha. Plus a few
small code items the C5/C6 audits parked here.

## 2. Current state (discovered 2026-07-05)
- **Vendor JS:** Chart.js 4.4.0 + Dexie 3.2.7 from `cdn.jsdelivr.net` (both have SRI, Wave A); precached in sw.js.
- **Fonts:** Playfair Display / Inter / Dancing Script from `fonts.googleapis.com` + `fonts.gstatic.com` (no SRI).
- **CSP** (staticwebapp.config.json, Wave C) still ALLOWS jsdelivr (script-src) + Google font origins
  (style-src/font-src) + `*.logic.azure.com` (connect-src). Self-hosting lets us drop the first two → near-`'self'`.
- **SWA deploy token:** committed in PLAINTEXT in `.github/workflows/*.yml` (a raw token, not a `${{ secrets.* }}`
  ref). Repo is private, so exposure is limited to collaborators — but it's a real standing secret in git.
- **Function secrets:** `BOB_AUTH_PEPPER` + the validateKeys/validateMoney/catalogueMerge function keys live in
  `bob-stock-money-fn` App Settings (readable by anyone with portal/az access = Kunal only today).
- **Logic App SAS:** the callback URLs (push/pull/steps/config/email/catalogue-write/corp-costs) carry SAS
  signatures; some LIVE ones are in git history (commits 2c78faf/ad6e3b4 — do NOT reprint).

## 3. The work — grouped, with a proposed NOW-vs-pre-cutover split

### Group A — Client hardening (repo, buildable + committable NOW; Claude's lean: DO NOW)
- **A1 Self-host Dexie + Chart.js** — vendor the two files into the repo, load locally, drop jsdelivr from
  index.html + sw.js (SRI becomes moot for same-origin).
- **A2 Self-host Google Fonts** — download the woff2 files, serve from the repo, drop googleapis/gstatic.
- **A3 Tighten CSP** — once A1+A2 land, REMOVE the third-party origins (jsdelivr from script-src; googleapis
  from style-src; gstatic from font-src) so script/style/font-src become `'self'` + the existing inline
  allowances. **KEEP `'unsafe-inline'` on script-src AND style-src** (spec-audit round 1, BOTH auditors
  COUNTER): the app uses inline `<script>`, inline `onclick=` handlers, and inline `style="…"` / `el.style.x`
  throughout — a strict `'self'` would break rendering. A nonce/hash CSP is a SEPARATE future refactor, not
  Chunk 7. connect-src keeps `*.logic.azure.com`; img-src keeps `data:`; manifest/worker allowances unchanged.
  Net Chunk-7 change = **drop the 3 external origins, retain inline**.
- **A4 emailUrl confirm** — verify `emailUrl` is only ever served via AppConfig (no hardcoded fallback).
- These are pure repo changes, testable by the harness + a boot/render check; they ship with the phase commit.

### Group B — Secret rotation / relocation (infra; Claude's lean: DEFER to a pre-cutover security pass)
- **B1 Rotate + relocate the SWA deploy token** — regenerate it, move to a GitHub Actions Secret, scrub the
  workflow. (Standing git exposure → arguably do sooner; see D7-2.)
- **B2 Function secrets → Key Vault / Managed Identity** — move `BOB_AUTH_PEPPER` + function keys to Key Vault
  references, or use Managed Identity for the Logic App→Function calls instead of function-key-in-URL.
- **B3 SAS rotation policy** — rotate all Logic App callback SAS (incl. the ones in git history) and document a
  rotation cadence.
- **Rationale for defer:** you rotate a secret AT the boundary you're protecting against — i.e. right before
  the app leaves single-owner alpha (beta / real staff / franchisees). Everything is on STAGING and NOT
  committed yet; rotating now just means rotating AGAIN at cutover. Kunal already accepted SAS/KV at
  alpha-level (sole viewer) with "rotate-before-beta." So B = a documented **pre-cutover checklist**, executed
  as the last step before the single live deploy, not built months early. EXCEPTION candidate: B1 (see D7-2).

### Group C — Carried code items (small; from the C5/C6 audits)
- **C1 Per-step-type ledger allowlist (from C5)** — on transfer stock-effecting steps, also require each
  referenced ledger row's TYPE to be allowed for that step. **FULL map (spec-audit round 1, both auditors —
  my shorthand "resolve→adjustment_* only" was WRONG; a legit resolve also emits transfer_in for flagged
  settlements/returns, verified phase2.js:397/471; cancel emits transfer_in, phase2.js:551):**
    - `submit`  → `transfer_out`  (at FromStoreId)
    - `receive` → `transfer_in`   (at ToStoreId)
    - `cancel`  → `transfer_in`    (at FromStoreId — return to origin; a DRAFT cancel emits no cross-device step)
    - `resolve` → `adjustment_in` / `adjustment_out` (conflict corrections at destination) **AND** `transfer_in`
      (flagged settlement/return top-ups at destination/origin)
    Plus: the referenced row's product must belong to the transfer + TransferId must match (already enforced by
    the C6 ledger-context check — C1 ADDS the type constraint on top). Small server (WDL/Function) add.
- **C2 Deletion propagation (from C6)** — category/product-type HARD deletes don't propagate (upsert-only).
  DECISION: **(a) block hard-delete → force deactivate (active:false, which publishes).** Both auditors AGREE.
  **Inactive semantics to build (GPT MED, adopted):** an inactive category/product-type must (1) be HIDDEN from
  the new-product / new-category add + edit SELECTORS, but (2) keep its label visible for historical/reference
  display (existing rows that point at it still render its name); (3) the server (catalogueMerge) must REJECT a
  new/edited product whose catId — or category whose ptId — points at an INACTIVE ref (no attaching to a
  deactivated ref unless it's reactivated). Hard-delete of an IN-USE cat/PT is already blocked; this converts
  the unused-hard-delete path to deactivate.
- **C3 Partial-writeback (from C6)** — the catalogue writeback self-heals via the Until-retry loop (already
  built); full multi-blob atomicity is more work for a rare edge. *Lean: leave as-is (self-healing is
  sufficient for alpha); document.*

## 4. Decisions — RESOLVED (Kunal, 2026-07-05)
| # | Question | Decision |
|---|---|---|
| D7-1 | Split: build Group A (client) + Group C (code) NOW; defer Group B (secrets) to cutover? | **YES** — A+C now; B = cutover checklist |
| D7-2 | Rotate the SWA deploy token now, or with the rest at go-live? | **WAIT for go-live** (Kunal) — ALL of Group B, incl. the deploy token, goes in the cutover security pass. One pass at the end; token stays in the private repo until then. |
| D7-3 | Self-host vendor JS + fonts now (A1–A3)? | **YES** (lean) |
| D7-4 | C2 deletion propagation: block hard-delete (force deactivate) vs removal-publish? | **block hard-delete / force deactivate** (lean) |
| D7-5 | C3 partial-writeback: leave self-healing vs full atomicity? | **leave as-is** (lean), documented |

**So Chunk 7 BUILD scope = Group A (A1–A4) + Group C (C1, C2; C3 doc-only).** Group B (B1 deploy token, B2
Function secrets→Key Vault/MI, B3 SAS rotation) → `AZURE-CUTOVER-SECURITY-CHECKLIST.md`, executed as the last
step before the single live deploy.

## 5. Build shape (once decisions land)
A1–A4 + C1–C2 on the client/staging (Mode A) → sentinels + saboteurs + boot/render check + (C1) staging cloud
probe → full sweep → wave review → GPT+AGY code audit → converge → HOLD. Group B written as
`AZURE-CUTOVER-SECURITY-CHECKLIST.md` (executed at the single live cutover), with B1 optionally done now.
