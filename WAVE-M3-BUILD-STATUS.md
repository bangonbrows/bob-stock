# WAVE M3 — BUILD STATUS (Group 3: backup / resilience)

**Branch:** `fix/cli-tri-audit-2026-05` · **Files:** `index.html`, `sw.js`, `sync.js`, `phase2.js`, `staticwebapp.config.json` (+ harness) · **Status:** BUILT + self-proven; NOT committed, NOT deployed (held for the combined M1+M2+M3 full sweep).

**Spec-audit gate (before any code):** AGY = APPROVE; GPT = APPROVE-WITH-CHANGES — both refinements folded in. Packs: `audit-artifacts/WAVE-M3-SCOPE.md`, `PASTE-TO-AUDITORS-WAVE-M3.txt`.

## Fixes implemented
| # | Finding | What changed | Where |
|---|---------|--------------|-------|
| 1 | **GPT-9** restore "safety copy" hollow | `_snapshotForUndo()` takes a REAL scrubbed snapshot of current data (was copying the post-migration-absent localStorage key); new director-only **"Undo last restore"** button + `_undoRestore()` that writes the snapshot back → reload → re-migrate | `index.html` `_importBackup`, `_snapshotForUndo`, `_undoRestore`, `_dirDataBackup` |
| 2 | **GPT-10** checksum never verified | `_verifyBackupChecksum()` recomputes sha256 over the body (minus `_meta`) BEFORE validate mutates; reject on mismatch; accept legacy (no checksum) | `index.html` `_importBackup`, `_verifyBackupChecksum` |
| 3 | **Ca-M17** navigationFallback no exclude | Added `exclude` for js/css/json/png/ico/svg/webmanifest/woff(2)/map + `/icons/*` | `staticwebapp.config.json` |
| 4 | **GPT-5b** SW push icon path wrong | `./icon-192.png` → `./icons/icon-192.png` (icon + badge) | `sw.js` push handler |
| 5 | **GPT-5c** brittle atomic install | Split CORE_URLS (required, `addAll`) vs OPTIONAL_URLS (CDN, `Promise.all`+`.catch`) — a CDN miss no longer fails the install; a missing core file still does | `sw.js` install |
| 6 | **GPT-18** Math.random IDs | crypto.getRandomValues hex for stepper id (phase2), device id + tab id (sync); jitter Math.random left alone | `phase2.js`, `sync.js` |
| 7 | date-preset month-end overflow | `_subMonths(date,n)` clamps the day to the target month's last day; used by 3m/6m/1y/yoy | `index.html` `_setCompPeriods` |

## Spec change-requests (pre-build) — how handled
- **GPT-9:** Undo handler itself is gated (`Auth.is('director')`), not just the button; snapshot taken AFTER validation, BEFORE overwrite; `_prerestore` cleared only AFTER the rollback write succeeds.
- **GPT-5c:** core local app-shell files are REQUIRED (install fails if missing, so a broken deploy can't replace a working cache); only CDN assets are best-effort.

## Code-review gate (post-implementation) — PASS
- AGY = **PASS (APPROVE)** all 7; ran the harness locally (149/149 + 8/8).
- GPT = **APPROVE-WITH-CHANGES**, one P2 — APPLIED: `_importBackup` ignored `_snapshotForUndo()`'s `false` return and overwrote anyway, so a failed snapshot (quota/serialization) left no safety net. Now: **if `_snapshotForUndo()` returns false, the restore is ABORTED** with a clear "could not save a safety snapshot" message — current data is never overwritten without a usable undo snapshot. (Defensive failure-branch; the snapshot mechanism itself is covered by S-153.)
- → All three waves (M1+M2+M3) now fully signed off (spec + code, both auditors).

## Harness
- New sentinels **S-153…S-158** → suite now **149 sentinels**. (S-153/154/157 are live Playwright; S-155/156/158 are honest source-level checks — SW install + the SWA config aren't runtime-driveable under headless file://, flagged as such.)
- New saboteurs (8): S-153, S-153b, S-154, S-155, S-155b, S-156, S-157, S-158.
- Smoke result: **149/149 PASS on clean code**.
- Targeted saboteur result: **8 CAUGHT / 0 BLIND / 0 skipped / 0 INFRA-FAIL of 8** (S-153, S-153b, S-154, S-155, S-155b, S-156, S-157, S-158; baseline re-confirmed 149/149). (Harness fix during this: added `staticwebapp.config.json` to the runner's SRC_FILES so config mutations copy into the temp workdir.)
- Duplicate-def sweep on edited methods: clean.

## Out of scope (later)
- Server-side trio (W5, GCLI-2, Ca-M15) → Azure phase.

## Next
Smoke + targeted saboteur PASS → the **one combined full saboteur sweep across M1+M2+M3 (149 sentinels)** → Kunal authorises → commit all three waves together. No deploy without explicit OK + milestone audit.
