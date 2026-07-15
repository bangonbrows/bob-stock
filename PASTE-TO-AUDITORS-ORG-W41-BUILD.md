# AUDIT PACK — Org-Structure chunk, W4.1 BUILD (planner extension) — Codex + AGY

**You are auditing the OS-W4.1 BUILD** — the first W4 build wave, implementing the spec YOU froze
(`AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md`, locked at R14 after both of you passed it). Your job: verify the
CODE faithfully implements the LOCKED spec, and try to break it. Branch `azure-phase-5-8-server`, build
commit **`e479c97`**. Both auditors run in parallel; isolate your own worktree.

## Non-negotiables (framework rules)
- **RUN it.** `node test/topology-proof.js` → **244/244** on clean code (191 pre-existing + 53 new W4.1
  probes). Write your OWN adversarial probes against the required module — the suite requires the REAL
  `azure-functions/src/functions/topology.js`.
- **Report ONLY.** Numbered findings (P0-P3 + concrete repro). Claude ground-truths every finding.
- **The frozen spec is the requirement.** Any deviation is a finding even if it "looks fine". Anything
  needing a SPEC change reopens W4.1's review per the freeze rule — say so explicitly.

## What was built (all in topology.js + the proof suite; ZERO client files touched)
| Piece | Spec pin |
|---|---|
| `state.office` bundle validation (envelope, strict flags, validEras, whole-map pricing, existence agreement, era alignment — the FULL W2 discipline mirrored) | P1/SR-48 |
| `provenOffice()` — the SIX-leg identity proof + inherited-rate source | P5/SR-79/101 |
| add/convert/create-franchise: `intent.rate` FORBIDDEN (`RATE_NOT_ALLOWED`), rate CLONED from the office's open `'*'` | P3/SR-47 |
| onboard: `officeCreate` (store row + open era + `'*'` series), `BAD_OFFICE_STORE_ID` mutual distinctness, `OFFICE_STORE_ID_TAKEN` via the SR-77 read, office account scoped `[officeStoreId, storeId]`, NO office POS | P2/P4/SR-48/72/77 |
| `OFFICE_STORE_OP_FORBIDDEN` on any op targeting an office store row (+ target-row flag typing) | P4/SR-71 |
| plan `claims {ids, pricingKeys, reads.pricing}` + per-fanout `expect` preconditions | P6/SR-98/99/111 |
| `validPricingSeries` + `isIsoUtc` exported | P7/SR-8 |

## Engineer's honest notes (attack these first)
1. **`NO_OFFICE_PRICING` is unreachable through a validating bundle** (belt-and-braces only): the office
   bundle's era-alignment check already forces an open `'*'` whenever the office era is open — so a
   missing office default fails earlier as `PRICING_ERA_MISALIGNED`. Verify my reachability analysis; if
   you find a path where it IS reachable (or the earlier reason masks something the spec wanted distinct),
   that's a finding.
2. **`RATE_NOT_ALLOWED` is a NEW reason code** the frozen spec didn't name (it pinned "DROP intent.rate"
   without the reject-vs-ignore choice). I chose fail-closed-on-contradictory-intent, house style. Judge it.
3. **Reason-code allocation on onboard ids:** intra-intent collisions (officeStoreId = storeId/
   officeUsername/franchiseeId) ⇒ `BAD_OFFICE_STORE_ID`; collisions with EXISTING logins ⇒
   `USERNAME_TAKEN`; an existing store row at the id ⇒ `OFFICE_STORE_ID_TAKEN`. The spec named the reasons
   but not this exact partition. Judge it.
4. **`claims.reads.pricing` carries the raw as-read maps** (pure content for the LA's scoped CAS) rather
   than a digest — the pure engine has no crypto. Confirm this satisfies SR-99's intent.
5. **Fixture updates to pre-existing probes** (convert/add/onboard success paths + the three OS-A-F3 rate
   probes) were REQUIRED by the spec's API change — verify each updated probe still proves its ORIGINAL
   concern (the F3 malformed-rate guards moved to onboard, the only rate-taking op).

## Attack surface
- Cross-collection: can a state bundle pass all six legs yet bind the WRONG office (aliasing between
  franchisees, office creds, entity rows)? Can `office.store.id` collide with the TARGET storeId?
- Onboard: two `usernameTaken` surfaces (storeId vs officeStoreId) — any ordering hole? An office bundle
  supplied for the WRONG id (the LA read row X, the plan claims id Y — nothing binds `office.store.id` to
  `intent.officeStoreId` when the row is ABSENT... can a present-row-elsewhere slip through)?
- The clone: any path where the cloned interval misaligns with the store's new era, or where
  `appendPricingForKey` errors surface with a confusing reason?
- Claims/expect completeness: does every mutating plan name every identifier/pricing key it touches?
- Regression: all 191 pre-existing behaviours (the fixtures changed — did any assertion silently weaken?).

## Gates already green (verify, don't trust)
topology **244/244** · smoke **251/251** · static PASS · CSP PASS. No client files touched; the saboteur
sweep's client mutations are untouched by this wave (the proof suite is the pure engine's sentinel layer).

## Verdict
PASS / PASS-with-notes / BLOCK, numbered findings with concrete repros (a state+intent that produces a
wrong plan or wrong reason, or a spec pin the code deviates from).
