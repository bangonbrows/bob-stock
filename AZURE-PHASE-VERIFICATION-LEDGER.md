# Azure Phase — Verification Ledger (audit-the-audits)

**Purpose:** every Azure-phase item, who BUILT it, who EXECUTED the verification, and — critically — whether an external auditor (GPT-Codex / AGY) **independently RAN** the checks vs only **read** the artifacts and trusted Claude's reported results. Wherever "Auditor RAN = NO" and the check is reproducible, the auditors are asked to run it themselves (see `audit-artifacts/PASTE-TO-AUDITORS-AZURE-FULL-RERUN.txt`).

**The gap (Kunal, 2026-06-23):** throughout the Azure phase the auditors reviewed exported artifacts and Claude's reported numbers, but did NOT execute the harness / saboteur / probes themselves. GPT explicitly stated on the last pass: *"I did not touch cloud resources or run scripts."* This breaks our own banked rules (*"audits must run, not just read"*; *P-17 audit blind*). The client harness needs NO secret and NO Azure access, so there is no reason it can't be re-run independently.

**Where it changed:** client-side waves through ~June 14 (e.g. Wave G) had GPT run the live harness (58/58). The Azure phase (~June 22) switched auditors to a read-only "artifact review" model — correct for the secret-bearing Azure probes, but it wrongly swept the credential-free client harness into read-only too.

## Ledger

| # | Item | Built/ran by | Auditor reviewed | Auditor RAN | Independently re-runnable? |
|---|---|---|---|---|---|
| Z0 | Backend inventory (Logic Apps via az) | Claude | — | NO | No (needs az/sub) — informational only |
| Z1 | D1 sync-model decision (append-only record-steps) | design | GPT+AGY (read) | n/a (design) | n/a |
| Z2 | Chunk 0 staging env (StockTransactions_Staging; push/pull-v2-staging clones) + end-to-end round-trip | Claude | GPT+AGY APPROVE-w-changes (read) | NO | **YES — Azure staging probe** |
| Z3 | Chunk 1 indexing (live already indexed; staging Graph-flag) + FU3 index manifest | Claude | AGY+GPT (read) | NO | Partial (Azure) |
| Z4 | Contract probes: 5,500-row seed; FU1 pull-pagination 502 (>5k); FU2 dedup PASS | Claude | reviewed findings (read) | NO | **YES — Azure staging probe** |
| Z5 | Pull-5k spike + the fake-index finding (Graph indexed:true ≠ real index) | Claude | reviewed (read) | NO | **YES — Azure staging probe** |
| Z6 | Pull-5k RESOLUTION: real-index experiment (IdxTest 6k), ID-cursor decision | Claude | GPT+AGY design audit (read) | NO | **YES — Azure staging probe** |
| Z7 | Pull-hardening BUILD: `sync.js` ID-cursor + `bob-stock-pull-v2-idcursor-staging` + sentinels S-159/160/161 + S-04/20/152 update. Smoke 152/152, saboteur 6/0 | Claude | GPT+AGY impl audit (read) | **NO (GPT: "did not run scripts")** | **YES — full HARNESS (no creds) + Azure probe** |
| Z8 | Validation probes (staging seeded to 20,048): P1 full walk, P2 top=100, P2b top=2, P3 mid-pull resume, P5 ID-gap | Claude | in ratify pack (read) | NO | **YES — Azure staging probe** |
| Z9 | Post-audit fixes: dual-contract workflow (`bob-stock-pull-v2-dual-staging`), fail-closed, `$top` clamp, sentinel S-162. Smoke 153/153, saboteur 7/0 | Claude | GPT+AGY ratify (read) | **NO** | **YES — full HARNESS + Azure probe** |

## What the auditors are now asked to independently RUN

**WS1 — Client harness (NO credentials, fully turnkey, the overnight job).** Re-verifies EVERY sentinel across ALL waves (not just Azure):
- `node test/smoke-test.js` → expect **153/153 PASS**.
- Full saboteur suite (all 153 mutations) → expect **every mutation CAUGHT, 0 BLIND, 0 INFRA-FAIL**, baseline 153/153.
- Report their OWN observed numbers (not Claude's).

**WS2 — Azure staging probes (need staging callback URLs from Kunal; staging already seeded to ~20k; live untouched).** Reproduce the empirical infra claims:
- Round-trip (push staging → pull staging).
- ID-cursor full walk across 20k (idcursor + dual workflows) — all pages 200, IDs strictly increasing, crosses 5k/20k.
- Dual-contract routing: `{lastId}` → mode=idcursor; `{since,$skip}` → mode=legacy; `$top:99999` → clamped to 2000.
- Mid-pull resume idempotency; legacy paging with `$skip>0`; dup-TransactionId dedup.

**Out of independent scope (need the Graph automation secret, which we withhold):** seeding rows, gap-delete. Mitigation: Claude's probe transcripts in `AZURE-CONTRACT-PROBES.md` + `AZURE-PULL-HARDENING-WAVE-REVIEW.md`; OR mint a read-only Graph credential if Kunal wants those reproduced too.

## Standing rule (banked)
External auditors must **execute** the client harness (smoke + saboteur) themselves every wave — not accept Claude's reported run. Credential-free, so no excuse. See `feedback_audit_browser_run`.
