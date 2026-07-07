# Azure Chunk 8 — Wave Review (ledger archival)

**Status:** BUILT on staging, sentinels green, on HOLD for the single cutover. Design review converged earlier
(PASTE-TO-AUDITORS-CHUNK8-SPEC.txt). This is the internal build record + deviations for the code audit.

## What shipped (staging)
| Layer | Artifact | Role |
|-------|----------|------|
| Function | `snapshotCompute.js` | opening-balance snapshot by monotonic SP-id cutoff; tombstone-aware; neutrality proof + hashes |
| Logic App | `bob-stock-archive-staging` | Director-gated archive run (lock→read→compute→copy→verify→publish-last→delete→release) |
| Logic App | `bob-stock-archive-pull-staging` | Director/HO-gated on-demand archive read by date range (reports) |
| Client | `sync.js` | `_spId` persist + backfill; snapshot adopt; `pullArchive`/`_fromArchive`; `archivePullUrl` config |
| Client | `index.html` (Stock/Pages) | `_adoptSnapshot`/activation gate/`_buildCache` fold; report banner + overlay; snapshot-aware integrity |
| Client | `db.js` | `pruneArchivedLedger` (durable working-set shrink) |
| Client | `records.js` | archived-key resolver (`stockStateFor(keys, stepTimestamp)`) |
| Tests | `smoke-test.js` / `saboteur-runner.js` | S-202..S-208 (7 sentinels + 7 mutations) |

## Decisions realised (D8-1..7)
- **Cutoff by monotonic SP Id, not date** — a late/offline backdated movement gets a new higher Id → folds
  post-cutoff, never lost. (Proven: crux A.)
- **Publish snapshot LAST** — archive copy is durable + verified before the client-visible version flip; live
  deletes are safe post-publish because the client filters live rows by `_spId > cutoffId`.
- **Neutrality gate + hashes** — snap+kept==full for every pair or the run aborts (422); archive verified by
  count + full SourceId-set before publish (500 on mismatch).
- **Idempotent** by SourceId; **fail-closed** on truncation (413), not-neutral (422), verify-fail (500),
  bad-auth (401), locked (409).
- **Activation gate** (client) — a snapshot is used only once the device has pulled past its cutoff; else the
  fold falls back to full-sum (always correct).
- **Archived-key resolver** — a record-step predating the cutoff treats a missing (pruned) key as confirmed.
- **Reports fail-closed** — a movement report whose range reaches archived history warns (never silently
  under-counts); Director/HO can load the archive overlay to include it.

## Build deviations / notes for the audit
1. **Passthru write bodies must be STRINGs.** The sharepointonline `/httpRequest` connector 400s on an object
   body ("Body parameters missing"), so every archive-LA write body is built escape-safe via
   `string(setProperty(json('{}'),...))`. SP Number columns return floats, so SourceId set-compares cast `int()`.
2. **Tombstone handling moved into snapshotCompute** (append-only ledger keeps the tombstoned original + the
   'deleted' row). Without it the snapshot over-counted a deleted movement vs the client. Cross-boundary
   (original archived, tombstone post-cutoff) is correct as long as the tombstone is present at archival time.
   **Residual (documented):** a tombstone arriving in a LATER archival cycle for an already-archived+snapshotted
   original cannot retroactively adjust that snapshot — mitigated operationally (don't delete long-archived
   movements; the retain window keeps original+tombstone together). Flagged for the audit.
3. **Archive-pull gate** = `directorOk OR (storeOk AND storeId=='head_office')`. Franchisees cannot pull other
   stores' archived movements. Franchise-scoping over the archive is a Chunk-10 concern (noted).
4. **Verify step** checks archive count + full SourceId-set, not an in-WDL re-hash (no sha256 in WDL). The
   Function is the hash authority. Flag if an in-app hash re-verify is wanted.
5. **Read_live single page $top=5000 + truncation→413.** >5000-per-run needs `__next` paging; the
   5000-or-6-months cadence is designed to stay under it. Documented, not implemented.
6. **Prune is gated to synced-and-<=cutoff rows only** — never an unsynced or `_spId==null` row (no stock loss).
   `_verifyCacheIntegrity` was made snapshot-aware so it doesn't false-alarm after a prune.

## Proofs run (Claude's local gate)
- snapshotCompute unit + deployed parity (identical hashes); tombstone same-set + cross-boundary.
- Archive LA end-to-end on a controlled ArchTest list: happy path + 401 + 409 + idempotent crash-recovery +
  late-backdated + neutrality. Archive-pull LA: Director read + bad-key 401.
- Client fold (6 scenarios) + resolver (6 scenarios) logic proofs.
- Sentinels 199/199 green on clean code (incl. S-202..208). Scoped saboteur sweep S-202..208 → (see run).

## Cleanup owed before audit-handoff / cutover
Delete `bob-stock-tmp-c8` passthru + `StockTransactions_ArchTest` + leftover test rows; reset staging
`stock_snapshot`→v0 and `archive_state`→idle; rotate the snapshotCompute `logicapp` function key with the other
Function keys (AZURE-CUTOVER-SECURITY-CHECKLIST.md).
