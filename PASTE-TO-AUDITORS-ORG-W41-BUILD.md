# AUDIT PACK — Org-Structure chunk, W4.1 BUILD re-audit (round 2) — Codex + AGY

**You are re-auditing the OS-W4.1 BUILD after round 1.** ALL SEVEN of your findings were REAL and are
FIXED — full ledger in `AZURE-CHUNK-ORG-W41-AUDIT-RESPONSE.md` (one probe per finding, your exact repros
where you gave them). Branch `azure-phase-5-8-server`; audit the LATEST commit on it. Both auditors in
parallel; isolate your own worktree; report-only.

## Two SCOPED SPEC AMENDMENTS need your explicit OK (the freeze rule)
Flagged in `AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md`'s status block:
1. **`state.office.forId`** (your C5): the bundle carries its query key; `OFFICE_ID_MISMATCH` for an
   inconsistent/misdirected bundle; leg 0 binds consulted reads to the entity's officeStoreId; LA §1 echoes.
2. **`NO_OFFICE_PRICING` diagnostic re-pin** (your C6 / engineer-note 1, which you both technically
   agreed with): PRICING_ERA_MISALIGNED is the surfaced reason for a missing office default;
   NO_OFFICE_PRICING = defense-in-depth (now also guarding the future-dated-rate case).

## What changed since round 1 (all in topology.js + the proof suite; zero client files)
- `expect` = FULL decision fields (Role/franchiseeId/isStorePOS/isFranchiseOffice + StoreIds/Active);
  createAccounts entries carry `expect.absent`.
- `franchiseeExists(osid)` joins the officeStoreId namespace check (your C2 repro now ⇒ USERNAME_TAKEN).
- provenOffice: rejects `officeStoreId === storeId` (your C3); requires the office era AND the inherited
  rate to be PRESENTLY effective (`from ≤ now`, your C4a); the bundle validation applies ORPHAN_ERA_OWNER
  to the office surface (your C4b).
- Onboard: four-way pairwise distinctness across minted ids (AGY's repro ⇒ BAD_NEW_FRANCHISEE); forId
  binding (`OFFICE_ID_MISMATCH`).

## Run
`node test/topology-proof.js` → **256/256** on clean code. smoke 251/251 · static PASS · CSP PASS.

## Attack (fresh surface)
- The forId binding: any path where a bundle passes with forId consistent but the CONTENT from elsewhere
  (the LA is trusted for reads — is the envelope contract with LA §1 step 3 airtight as written)?
- The effectiveness legs: boundary cases (era.from === now exactly; a closed future interval alongside a
  current open one).
- The expanded expect: is any DECISION input still missing (e.g. the credential's id itself, username
  aliases feeding uniqueness — do any affect fanout selection)?
- The four-way distinctness: enumerate all 6 pairs across {storeId, officeStoreId, franchiseeId,
  officeUsername} — each rejected, each with a sensible reason?
- Regression: your round-1 repros (each is now a permanent probe — verify they bind the REAL module).

## Verdict
PASS / PASS-with-notes / BLOCK + explicit OK/objection on EACH of the two scoped amendments. When BOTH of
you pass all items, W4.1's build converges and W4.2 (the lens) begins.
