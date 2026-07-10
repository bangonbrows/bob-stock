# Org-Structure Chunk — store/franchise topology tools (SCOPE STUB — design after Account Access chunk)

**Status:** DESIGN SESSION 2026-07-10 (Kunal) — decisions D-OS-1..8 + BUILD PLAN below. **Spec reviews: R1
2026-07-10 (Codex BLOCK ×5 + AGY BLOCK ×5, all REAL) → §OS-SR-1..9; R2 2026-07-10 (BLOCK — all R1 folds
CONFIRMED closed, 1 converged race + 2 refinements) → §OS-SR-5/7-amend + OS-SR-10/11.** R3 2026-07-10 (AGY PASS +
Codex BLOCK×1) → §OS-SR-12. Findings 10 → 3 → 1, converged. Next: Codex one-item re-confirm of OS-SR-12 →
BUILD. Split from Account Access by **D-AA-4**. (Account Access chunk = ✅ DONE + triple-audited
+ AA-20 gated.)

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

## KUNAL DECISIONS round 2 (2026-07-10)
- **D-OS-6 — buy-back EXPORT content:** for the ex-franchisee's ownership ERA, per product — (a) product
  USAGE (quantities moved/consumed), (b) their COST for that usage (cost basis), (c) retail-sales
  PROFITABILITY (retail revenue − cost). It's an accounting/tax hand-off. Format = CSV bundle (matches the
  existing CSV exports); a wizard step at buy-back (per D-OS-5). NOT the raw ledger — the computed
  usage/cost/profit summary.
- **D-OS-7 — wizard field set is EXTENSIBLE.** Start with: store name, phone, type; franchise adds franchise
  discount/loading % + the office-account login. Kunal: "if there's anything else we can add that later" —
  build the field set so MORE fields can be added without a redesign (data-driven form, same spirit as the
  data-driven role matrix).
- **D-OS-8 — YES to the plain-English CONFIRMATION/PREVIEW step** before the atomic commit: a summary of
  exactly what will change ("moves Booragoon HO→Franchisee X; X sees data from today; HO keeps full history;
  store till stays; these 2 manager logins are cancelled") — Director confirms, then the atomic write fires.

## DESIGN SHAPE / BUILD PLAN (2026-07-10 — build-ready pending spec review)
**Data model — ownership ERAS.** A store carries `ownerHistory: [{ owner, from, to|null }]` (owner = 'HO' or a
franchisee-account id). The CURRENT era is the open one (`to:null`). Every ownership transition CLOSES the
open era (`to = now`) and OPENS a new one. Scope reads (Chunk 10) + cost/archive visibility (Account Access
SR-6 era cutoffs) key off these — a scoped account sees a store's rows only within ITS era window(s).
Born-franchise + existing-franchise stores get a baseline era seeded at cutover (Account Access §R2-1).

**The wizard = ONE Director tool, sudo-floored, atomic (SR-9).** Operations:
- **Create store** — HO-operated (owner HO, open era) OR born-franchise (pick/lookup franchisee → their era).
- **Onboard NEW franchisee** — create the office/HO account (from the data-driven role matrix, D-AA-3) + their
  first store, one flow. (Real case A.)
- **Add store to EXISTING franchisee** — new store, owner = chosen existing franchisee, joins their scope.
  (Real case B.)
- **Convert HO store → franchise** — close HO era, open franchise era (this IS the D10-9 takeover cutoff = era
  boundary); store POS account re-scoped to the franchisee (D-OS-2); personal staff/manager/TM accounts lose
  this store from scope, deactivate if left with zero (D-OS-2 nuance).
- **Buy-back franchise store → HO** — close franchise era, open HO era; ex-franchisee scope ends (devices
  purge, Chunk 10); EXPORT step (D-OS-6); office account left ALONE for manual deactivation (D-OS-4).
- **(NO direct fran→fran — D-OS-3: buy-back then reassign.)**

**Every operation:** (1) plain-English PREVIEW (D-OS-8) → (2) Director sudo confirm → (3) ONE atomic write
that updates: store flags/owner era, ALL affected credentials' StoreIds + scopeVersion (store POS, personal
accounts, franchise office, ex-owner — R2 Codex-2), access-policy defaults for any new account, and the era
boundary — so devices converge cleanly and no account is ever left seeing data it shouldn't (SR-9). Fallback
if the tool isn't ready for the Sep–Oct franchisee = the SAME logic as a scripted admin runbook (SR-9), never
ad-hoc SharePoint edits.

**Server/client split:** client = the wizard UI + preview. Server (gated LAs) = the real enforcement — the
atomic topology write + scope-version bumps + era records, Director-key + sudo gated (P-13); the client wizard
is convenience, the LA is the gate. Reuses Chunk 10 scope machinery + Account Access era-cutoff enforcement
(both already built + audited).

## ADOPTED SPEC-REVIEW CHANGES (R1 — Codex BLOCK ×5 + AGY BLOCK ×5, folded 2026-07-10)
Both auditors BLOCKED; every finding triaged REAL (the two code-touching ones ground-truthed against sync.js).
These GOVERN the build and materially rework the hard parts my first draft hand-waved. Where an OS-SR conflicts
with earlier text, the OS-SR wins.

- **OS-SR-1 (Codex-1 + AGY-3, atomicity/split-brain) — a dedicated `topology-change` Logic App with a
  PENDING/2-phase-commit + reconcile pattern.** SharePoint has NO cross-list transaction. The wizard sends ONE
  INTENT payload (which store, what transition) to the LA; the LA: (a) writes a topology-change RECORD
  `status:pending` (store, from-owner, to-owner, ts, the server-derived fanout), (b) applies every sub-change
  idempotently (era close/open, per-credential StoreIds + scopeVersion, snapshot, cutoff, account
  activate/deactivate), (c) marks the record `complete`. A crash mid-way is RESUMABLE — a reconcile sweep
  re-applies missing steps idempotently. **Reads FAIL CLOSED for a store while a topology change on it is
  pending.** NO client-orchestrated multi-write (also the P-13 fix).
- **OS-SR-2 (Codex-2) — the SERVER derives the affected-credential set, never the client.** The LA recomputes
  "ALL affected credentials" from server-owned rows (who holds this StoreId, the store's ownerHistory, the
  franchisee's accounts). The client preview is DISPLAY-only; a tampered client payload can't omit an ex-owner/
  manager/TM/POS from the fanout.
- **OS-SR-3 (AGY-1, the lens must be ERA-AWARE) — GROUND-TRUTHED REAL.** Reports currently read the LIVE
  `store/product.franchiseDiscount` + `isFranchise`, so a buy-back (flag off) would retroactively strip the
  loading from PAST franchise-era invoices. Fix: each ownerHistory ERA record carries the franchise status +
  franchiseDiscount% IN FORCE during that era; money in reports is computed per-row from the era covering THAT
  ROW's date, not the live flag. Kunal's "flip the flag" is correct for CURRENT/ongoing; HISTORICAL/spanning
  reports read the as-of-date era. (Still no baked-in costs — the lens just reads the rate from the era, not
  the live store flag.)
- **OS-SR-4 (Codex-3) — buy-back EXPORT bound to the CLOSED era interval [from, to), server-generated.** From
  server-owned ownerHistory, filtered to the ex-franchisee's `[era.from, era.to)` (BOTH bounds) — never a
  lower-bound-only or client-filtered report. HO's post-buy-back rows can't leak into the ex-franchisee's
  usage/cost/profit export.
- **OS-SR-5 (AGY-2, offline data loss) — GROUND-TRUTHED REAL: push BEFORE purge.** `_reconcileScope`
  (sync.js:1889) purges immediately on a scope change with no pre-flush. Before ANY scope purge the client MUST
  flush pending offline writes (offline queue + unsynced recordSteps/StockTransactions), and the ingest LAs
  must accept rows whose timestamp falls in the device's OLD era window. **Chunk 10 CLIENT hardening, required
  companion to this chunk** (protects every scope change, not just topology). A topology change must never wipe
  unpushed offline work.
- **OS-SR-6 (AGY-4) — device-bound roles see the CURRENT era only.** `store_account` (POS) + `store_manager`
  lack a franchiseeId; by rule they are restricted to the currently-ACTIVE era for their StoreId — the physical
  device follows current ownership and can never pull a prior owner's history after a hand-over. Franchisee/HO
  accounts map to their owner's era(s). Define explicitly in the server read-rules.
- **OS-SR-7 (AGY-5) — snapshot SERVER-side + atomic with the era boundary.** The D10-9 opening-balance snapshot
  is captured inside the `topology-change` LA (a consistent server-side sum), stamped with the era boundary in
  one motion — never client-generated mid-trading-day (which desyncs against live pushes).
- **OS-SR-8 (Codex-5) — ownership keys off a STABLE franchisee ENTITY id, not the mutable account.**
  `ownerHistory.owner` = a franchiseeId (stable entity), NOT the office-account/login row. Credentials MAP to
  the franchiseeId. Deactivating + later recreating a franchisee's office account (or reusing a username) never
  orphans or misattributes era history. Introduce the franchisee entity id.
- **OS-SR-9 (Codex-4) — empty-office INVARIANT resolves the D-OS-4 tension.** An office account left active
  after its last store leaves has ZERO stores ⇒ NO live store data (empty scope, reads return nothing).
  Settlement is NOT done by pulling post-buy-back data: transfer/settle stock BEFORE the buy-back and/or via the
  era-bounded EXPORT + an HO-run workflow. So "active for settlement" = the login still exists (Director hasn't
  deleted it) but sees nothing live. Sequence: settle/transfer stock → buy back (scope ends, export handed
  over) → Director deactivates the office when ready.

## ADOPTED SPEC-REVIEW CHANGES (R2 — Codex BLOCK + AGY BLOCK, folded 2026-07-10)
R2 confirmed ALL R1 folds (OS-SR-1..9) CLOSED. Both auditors CONVERGED on ONE race the R1 fold introduced
(snapshot vs late offline rows); AGY added two refinements. All triaged REAL (rate-history ground-truthed:
`franchiseDiscount` is a single scalar per store/product, no history — line ~605).

- **OS-SR-5/7 AMENDMENT (Codex-1 + AGY-1, CONVERGED — the race the fold introduced).** OS-SR-5 (accept old-era
  offline rows) clashed with OS-SR-7 (finalized opening snapshot): a pre-boundary offline row arriving AFTER
  the snapshot is stamped would silently land in the OLD era and leave the NEW owner with ghost stock. FIX:
  (a) the topology-change LA QUIESCES first — it keeps the change `pending` and the opening snapshot PROVISIONAL
  until the store's devices have flushed their old-era queues, within a bounded drain window; (b) a pre-boundary
  row that STILL arrives after the boundary is FINALIZED is QUARANTINED with a `stale_era` code and surfaced to
  the Director for manual settlement/reconciliation — NEVER silently applied. So no silent opening-balance
  corruption; late rows become a visible reconciliation item, not ghost stock.
- **OS-SR-10 (AGY-2, anti-backdating) — the old-era flush is SERVER-AUTHORIZED, not client-timestamp-trusted.**
  Client timestamps are attacker-controlled; "accept if timestamp ∈ old era" alone lets an ex-owner backdate a
  row into a CLOSED era after access ended. The push-before-purge flush (OS-SR-5) is authorized by a ONE-SHOT,
  EXPIRING, server-issued grace tied to the device's PREVIOUS scopeVersion/credential; ingest accepts old-era
  rows ONLY within that bounded flush authorization. After the grace window (or once flushed), old-era writes
  for that store from that ex-credential are REJECTED. Timestamp is never sufficient on its own.
- **OS-SR-11 (AGY-3, decouple PRICING from OWNERSHIP; refines OS-SR-3) — GROUND-TRUTHED (no rate history
  today).** A franchise loading can change WITHOUT an ownership change (Director renegotiates), so one ownership
  era can't hold two rates. Split them: a store/franchise carries a dated PRICING-RATE HISTORY
  (`{rate, from, to}` intervals), SEPARATE from ownership eras. Ownership eras govern VISIBILITY (which rows an
  account sees); pricing intervals govern the NUMBER (which rate applies to a row's date). The lens + buy-back
  export read the rate AS-OF each row's date from the pricing history (which may sub-divide an ownership era).
  NOTE: this also fixes a PRE-EXISTING latent gap — any franchise-discount change today retroactively rewrites
  past invoices because only the current scalar exists.

## ADOPTED SPEC-REVIEW CHANGES (R3 — AGY PASS + Codex BLOCK×1, folded 2026-07-10)
R3: **AGY PASS** (cleared for build — all R2 folds confirmed closed). **Codex** confirmed all R2 folds closed
with ONE remaining refinement (the completion of OS-SR-11), triaged REAL + folded:

- **OS-SR-12 (Codex-R3, pricing-history immutability) — completes OS-SR-11.** Pricing-rate intervals are
  SERVER-OWNED and APPEND-ONLY once any row/invoice falls within them. A rate change creates a NEW interval
  from an effective date — it NEVER mutates a prior interval. Correcting a closed/used interval is a
  Director-AUDITED ADJUSTMENT path (a logged, visible correction record), not a silent overwrite of historical
  pricing. So past invoices stay immutable through the pricing history exactly as they are through the
  append-only ledger (standard slowly-changing-dimension discipline). Without this, a Director editing a closed
  interval (10%→12% "to fix a setup mistake") would retroactively rewrite past invoices via the history table.

## ✅ STATUS: SPEC CONVERGED + BUILD-READY (2026-07-10). Codex PASS + AGY PASS on the OS-SR-12 re-confirm;
both cleared for build. Governing set: D-OS-1..8 + BUILD PLAN + OS-SR-1..12. Journey: R1 BLOCK×10 → R2 BLOCK×3
→ R3 (AGY PASS, Codex×1) → R4 both PASS.

## NEXT: BUILD (wave by wave, per-wave audits, same as Account Access) → milestone 6-way blind audit (covers
both chunks) → cutover. Build order sketch: (W1) discovery + the topology-change contract/enforcement matrix;
(W2) server — topology-change LA (pending/2-phase/reconcile) + ownership-era + pricing-history + snapshot;
(W3) Chunk-10 companion: offline push-before-purge + server-authorized old-era flush (OS-SR-5/10);
(W4) era-aware lens + [from,to) export; (W5) the Director wizard UI + preview; (W6) sentinels/saboteurs +
full local gate + staging proof.

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
