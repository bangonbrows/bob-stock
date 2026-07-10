# Org-Structure Chunk — store/franchise topology tools (SCOPE STUB — design after Account Access chunk)

**Status:** DESIGN SESSION STARTED 2026-07-10 (Kunal) — decisions D-OS-1..5 below govern; a few detail opens
remain (flagged) before build. Split out of the Account Access chunk by **D-AA-4**. Build + audit as its own
unit, BEFORE the 6-way milestone blind audit. (Account Access chunk = ✅ DONE + triple-audited + AA-20 gated.)

## KUNAL DECISIONS (design session 2026-07-10)
- **D-OS-1 — the two REAL upcoming cases (both needed, equal priority):** (A) an EXISTING HO store becomes a
  franchise under a **NEW franchisee** (convert + onboard-new-franchisee in one flow); (B) a **brand-new store**
  joins an **EXISTING franchisee** (create store + assimilate into their scope). These are the concrete
  ≈Sep–Oct scenarios — build both robustly.
- **D-OS-2 — staff on CONVERSION (HO store → franchise):** the **store POS account STAYS** (same login; only
  ownership/scope changes to the franchisee). But the **personal accounts scoped to that store — staff,
  store-manager, territory-manager — are CANCELLED** (deactivated); the store becomes part of the franchisee's
  account and the franchisee sets up their own people. **OPEN NUANCE (settle at build):** a territory manager
  usually covers MULTIPLE stores — cancelling their whole account because ONE store converted would be wrong.
  Rule to confirm: on conversion, REMOVE the converting store from each personal account's scope; DEACTIVATE
  an account only if it is now left with ZERO stores (a single-store manager → deactivated; a multi-store TM →
  keeps their other stores, just loses this one). Flag single-store vs multi-store at build.
- **D-OS-3 — NO direct franchisee→franchisee sale path.** If a store moves between franchisees, the process is
  **two steps: buy back to HO first, THEN reassign HO → the new franchisee** (both existing wizard paths). No
  Tool 5. This also cleanly resets the ownership era (HO era between the two franchise eras) — the safest model.
- **D-OS-4 — empty franchisee office account: MANUAL deactivation, NOT automatic.** When a franchisee's last
  store leaves them (buy-back), there may still be **stock to transfer / settle**, so the wizard does NOT touch
  the office account — the Director deactivates it manually AFTER stock/transfers are sorted. So a store-removal
  leaves the office account active; cleanup is a separate manual step.
- **D-OS-5 (from 2026-07-09) — ex-franchisee gets a DATA EXPORT of their era at buy-back, not lingering
  live access** (their live scope ends; devices purge per Chunk 10). Export format/content = a design-open.

## Remaining design-opens (settle before/at build)
1. The TM multi-store cancel nuance (D-OS-2 above).
2. Buy-back EXPORT: format (CSV bundle? scoped backup JSON?), content (their era's movements/invoices/stock
   takes), and timing (auto at buy-back vs on-demand).
3. Store-detail fields in wizard step 1 (name, phone, address?, type) + store-ID generation (auto vs manual).
4. New-franchisee onboarding fields: the office/HO account (login username), the franchise discount/loading %,
   which store(s).
5. A **confirmation/preview step** before commit (RECOMMENDED): "This moves Booragoon from HO to Franchisee X.
   X sees data from today forward; HO keeps full history; the store till stays, the 2 manager logins are
   cancelled." — a plain-English summary of exactly what will change, before the atomic write. Strongly advise
   yes given how consequential these ops are.

**TIMELINE DRIVER (Kunal 2026-07-09):** a NEW FRANCHISEE is onboarding in ~2–3 months (≈Sep–Oct 2026). If the
build slips past that, fallback = Claude onboards them manually — but per **SR-9** (Account Access spec review
R1, Codex-8) the fallback is a CONTROLLED scripted runbook/admin path that updates StoreIds, scopeVersion,
access-policy defaults, and the D10-9 takeover cutoff ATOMICALLY. Direct ad-hoc SharePoint row edits are
FORBIDDEN — a hand edit that skips the scope-version bump leaves devices holding data they're no longer
entitled to. The tools then serve the next onboarding.

**NOTE (SR-6, folded 2026-07-09):** D10-9 cutoff ENFORCEMENT (archive/cost reads fail closed without a cutoff
record) ships in the ACCOUNT ACCESS chunk; THIS chunk ships only the tooling that SETS cutoffs on conversion.

## Scope (from the Account Access chunk's §C, Kunal 2026-07-07)
Director-facing tools that change the account/store TOPOLOGY (which stores exist, who owns them, which accounts
scope to them) — as opposed to the Account Access chunk, which changes what accounts CAN DO:

1. **Convert a store → franchise store** — flip a company store to a franchise; the existing `isFranchise` /
   `isFranchiseOffice` store flags are the seed.
2. **Onboard a NEW franchisee** — create their store(s) + their franchise HO/office account in one flow.
3. **Existing franchisee acquires ANOTHER store** — the store joins the SAME franchisee's scope under the SAME
   franchise HO (franchisee scope = a growing set of stores, one HO).

## KUNAL'S WIZARD DESIGN (2026-07-09) — UNIFIES tools 1–3 into ONE guided flow (this governs the UI shape)
One store-creation wizard, reused for conversion — instead of three separate tools:

- **Step 1 — store details:** name, phone number, other details as wanted, and TYPE: **HO-operated** or
  **franchise**.
- **Step 2 (franchise only) — new or existing franchisee?**
  - **NEW franchisee** → automatically creates their OFFICE + franchise HO account ALONG WITH the store, in the
    same flow (one go — no separate "make an office" step).
  - **EXISTING franchisee** → shows the list of existing franchisee accounts; picking one ASSIMILATES the store
    into that franchisee's existing office/scope (growing store set, same HO).
- **CONVERTING an existing store → franchise reuses the SAME screens** — enter the flow with the store's
  details pre-filled, flip the type to franchise, then step 2 as above.

Machinery underneath (invisible to the user, from the audited chunks):
- Conversion path SETS the D10-9 takeover cutoff automatically (= conversion date); enforcement of the cutoff
  already ships in the Account Access chunk (SR-6).
- New-franchisee path mints the office account with its capability set from the data-driven role matrix
  (Account Access chunk) — nothing hard-coded (SR from D-AA-3).
- Every topology change bumps the scopeVersion of **ALL affected credentials** (store POS account, store
  managers, franchise HO/office, ex-franchisee, any scoped account touched — not just the franchisee; R2
  Codex-2) → their devices purge/re-pull per Chunk 10.
- The whole wizard is Director-gated + sudo-floored (always-password, per SR-1/D-AA-5 floor) and all its writes
  are atomic per SR-9 (StoreIds + scopeVersion + policy defaults + cutoff together).
- **Directors/HO retain FULL pre-conversion history visibility** — the cutoff is a franchisee-side visibility
  curtain, NOT a deletion (Kunal confirmed understanding 2026-07-09).

## Tool 4 — REVERSE conversion: franchise store comes back under HO (buy-back)
**PROMOTED from parked edge to IN-SCOPE (Kunal 2026-07-09): this REALLY HAPPENED last year** (a franchised
store came back under HO), so it's a recurring real scenario, not a hypothetical. Design at this chunk's design
session (not now). Likely the same wizard entered from the other direction (flip type franchise → HO-operated).
Questions to settle at design:
- **Ex-franchisee's access — KUNAL DECIDED 2026-07-09: EXPORT, not live access.** At buy-back the
  ex-franchisee is handed a data EXPORT of THEIR era's records (tax/accounting) and their live access to the
  store ends (scopeVersion bump → devices purge per Chunk 10). No "historical-only window access" machinery
  needed — closes AGY's R2 Tool-4 gap the simple way. Design-session detail: export format/content (their
  era's movements, invoices, stock takes) + make it a step IN the wizard so it can't be forgotten.
  Still open: if it was their ONLY store, what happens to their office account — deactivate?
- **HO cost basis — RESOLVED by KUNAL'S LENS MODEL (2026-07-09, ground-truthed against code):** Kunal's
  insight, verified: the ledger stores ONLY quantities/movements; money is computed AT VIEW TIME (corporate
  costPrice on products; the franchise loading = `isFranchise` + `franchiseDiscount`% applied at
  invoice/report time — NEVER baked into stored rows). So buy-back = flip the store's franchise flags OFF and
  the loading simply stops applying — no data loss, no cost snapshot, no reset mechanism. Re-franchise = flip
  back on. AGY's "cost contamination" concern assumed baked-in franchise costing, which the app doesn't do —
  Tool 4 needs NO cost-boundary machinery. **ADOPTED as the Tool-4 costing approach.**
  - Caveat (design session): reports SPANNING an ownership change blend two business arrangements (franchise
    era: store sales = franchisee revenue, HO revenue = invoice margin; HO era: all HO). Numbers stay correct;
    just LABEL the era boundary in reports — no complex machinery.
  - The lens model does NOT replace the visibility curtain: era records still govern WHOSE history a
    franchisee may SEE (prior owner's trading data stays private). Lens = what numbers are shown; era =
    which rows are shown.
- **Cost/pricing flags:** the wizard's flag flip IS the mechanism; record the flip date (era boundary) for
  report labels + the visibility curtain.
- Same atomicity + sudo-floor rules as the forward direction (SR-9, SR-1).

## R2 SPEC-REVIEW INPUTS for this chunk's design session (Codex R2-3 + AGY, 2026-07-09)
- **OWNERSHIP-ERA model, not a single cutoff (Codex R2-3 — adopt as the working model).** A store carries an
  OWNERSHIP HISTORY (era records: owner + start/end dates) rather than one takeover-cutoff field. Each scoped
  account sees a store's rows only within its own era window(s). This is what makes re-franchising and resale
  safe: a single cutoff breaks the moment a store changes hands TWICE (buy-back then re-franchise — the new
  franchisee must not inherit the PRIOR franchisee's or HO's history). D10-9's forward cutoff becomes the
  first era boundary, not a special case.
- **Franchisee → franchisee SALE — RESOLVED (D-OS-3): NO direct path.** Kunal: do it as buy-back→HO then
  reassign HO→new franchisee (two existing paths). The HO era between the two franchise eras IS the clean
  boundary, so B never sees A's history — the ownership-era model handles it for free. Tool 5 dropped.
- **Baseline era/cutoff record for EVERY franchise store (Codex R2-1):** born-franchise stores get one at
  creation; existing franchise stores get one seeded at cutover (that seeding ships with the Account Access
  chunk — see its §R2-1); this chunk's wizard maintains them from then on.

## Carried-in deferred item
- **D10-9 — franchise-takeover opening-balance cost cutoff** (LOCKED by Kunal 2026-07-08, see
  `AZURE-CHUNK10-SCOPE.md` §D10-9): when a company store converts to a franchise, the new franchisee's cost
  visibility starts at the takeover date (opening balance), not the store's full corporate cost history. Fires on
  conversion → belongs to THIS chunk (moved here from the Account Access chunk, D-AA-4).

## Key interactions (flag at design)
- **Chunk 10 (row-level store isolation):** every tool here CHANGES an account's StoreIds scope → scope-version
  lifecycle + client purge/re-pull must fire on change. Conversion/onboarding = the scope-change events Chunk 10's
  machinery was built to survive.
- **Account Access chunk:** new franchise HO accounts get their capability set from the (now data-driven) role
  matrix; onboarding must not hard-code capabilities.
- **P-13:** all three tools are Director-gated, sudo-prompted (per the D-AA-5 policy) and must be enforced
  SERVER-side (gated LAs), not just in the UI.
