# Org-Structure Chunk — store/franchise topology tools (SCOPE STUB — design after Account Access chunk)

**Status:** CAPTURED 2026-07-09, split out of the Account Access chunk by decision **D-AA-4**
(`AZURE-CHUNK-ACCOUNT-ACCESS-SCOPE.md`). NOT yet designed. Design session with Kunal AFTER the Account Access
chunk is built, then build + audit as its own unit, BEFORE the 6-way milestone blind audit.

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
- Existing-franchisee path bumps that franchisee's scopeVersion → their devices purge/re-pull per Chunk 10.
- The whole wizard is Director-gated + sudo-floored (always-password, per SR-1/D-AA-5 floor) and all its writes
  are atomic per SR-9 (StoreIds + scopeVersion + policy defaults + cutoff together).
- **Directors/HO retain FULL pre-conversion history visibility** — the cutoff is a franchisee-side visibility
  curtain, NOT a deletion (Kunal confirmed understanding 2026-07-09).

**Edge captured, NOT designed (decide later):** REVERSE conversion — a franchise store coming back under HO
(buy-back). What happens to the franchisee-era data visibility, the office account, the cutoff? Park until a
real case approaches.

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
