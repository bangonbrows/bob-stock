# Org-Structure Chunk — store/franchise topology tools (SCOPE STUB — design after Account Access chunk)

**Status:** CAPTURED 2026-07-09, split out of the Account Access chunk by decision **D-AA-4**
(`AZURE-CHUNK-ACCOUNT-ACCESS-SCOPE.md`). NOT yet designed. Design session with Kunal AFTER the Account Access
chunk is built, then build + audit as its own unit, BEFORE the 6-way milestone blind audit.

**TIMELINE DRIVER (Kunal 2026-07-09):** a NEW FRANCHISEE is onboarding in ~2–3 months (≈Sep–Oct 2026). If the
build slips past that, fallback = Claude onboards them manually (accounts + stores + scopes set up directly);
the tools then serve the next onboarding.

## Scope (from the Account Access chunk's §C, Kunal 2026-07-07)
Director-facing tools that change the account/store TOPOLOGY (which stores exist, who owns them, which accounts
scope to them) — as opposed to the Account Access chunk, which changes what accounts CAN DO:

1. **Convert a store → franchise store** — flip a company store to a franchise; the existing `isFranchise` /
   `isFranchiseOffice` store flags are the seed.
2. **Onboard a NEW franchisee** — create their store(s) + their franchise HO/office account in one flow.
3. **Existing franchisee acquires ANOTHER store** — the store joins the SAME franchisee's scope under the SAME
   franchise HO (franchisee scope = a growing set of stores, one HO).

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
