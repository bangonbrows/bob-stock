# Review request — OS-W4.4 Contract 1 BUILD audit (deployed staging behaviour)

The Contract 1 design you both PASSed at spec-R2 is now BUILT and applied to staging. This round is
the BUILD audit: verify the DEPLOYED behaviour yourself on the real staging cloud, not just the code.

Read first (in your OWN fresh copy of the repo — never the live working tree):
1. `AZURE-CHUNK-ORG-STAGING-LEDGER.md` — the W4.4 Contract 1 entry: exactly what was applied, the
   13/13 proof run, the build findings, and the FIVE open items (please confirm you agree items 1–5
   are the right residual set, and that none of them is silently load-bearing for what shipped).
2. `AZURE-CHUNK-ORG-W44-C1-DESIGN.md` — the converged spec (status banner + §1–§4).
3. Draft-turned-shipped code: `azure-functions/src/functions/attestRows.js` + `test/attest-proof.js`
   (58 checks — run locally: `node test/attest-proof.js`).
4. The apply runner `audit-artifacts/rekey-staging.js` is NOT in your copy (gitignored) — the ledger
   describes the applied state; you verify the state itself, not the runner.

Cloud verification (Kunal supplies: the staging push endpoint URL, a store device key, the attestRows
function-route URL+key, and read access to `StockTransactions_Validate`):
- Drive a real push through `bob-stock-push-v2-validate-staging`; confirm the stored row carries
  `EconSig` = `v1:k1:<64 hex>` and that `op:'verify'` returns true for the stored row.
- Edit a covered field on YOUR OWN stored probe row directly in SharePoint; confirm verify flips
  false. (Only ever touch rows you created.)
- Re-push the same TransactionId; confirm it lands in `duplicates[]`.
- Probe the failure contract however you see fit WITHOUT breaking shared state — do NOT modify the
  Function App settings (the keyring outage drill is already evidenced in the ledger; ask for the run
  record if you want it).
- Namespace every probe row id (`gpt_`/`agy_` prefix) and DELETE your probe rows when done.

House rules (unchanged): findings only, no edits; scoped probes only (no full mutation sweep); name
your artifacts in plain QA wording; this note is a pointer — the repo files are authoritative.
Verdict: PASS / PASS-with-notes / BLOCK with numbered findings + the concrete failing scenario.
