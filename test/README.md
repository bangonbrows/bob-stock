# BOB Stock App — tests

The regression safety net, version-controlled **with** the app.

- `smoke-test.js` — **29 sentinels**. Each passes on clean code and is proven (by the
  runner below) to flip red if a real bug is reintroduced. Every sentinel drives the
  **live** shipped code path (no re-derived copies).
- `saboteur-runner.js` — the file-mutation loop. Copies the source, applies a real
  bug, boots it, and confirms the matching sentinel turns red. A sentinel that stays
  green on its own saboteur is "blind" and the runner fails the build. Each mutation
  runs in its **own fresh child process** (isolates Playwright browser teardown so a
  long run can't crash before the summary).
- `csp-check.js` — serves the app over http **with the real CSP + security headers**
  (from `staticwebapp.config.json`) and asserts it boots with zero CSP violations.
- `verify-release.js` — **static release gate** (no browser): fails if a dev CDN is
  present, an external script is unpinned / missing SRI, the SW precache drifts, a
  required security header / CSP directive is missing, the dependency inventory or
  lockfile is missing, or the C1 backup-scrub / Wave-B permission map has regressed.

## Setup (one-time)
```
cd test
npm install        # downloads Playwright (a headless browser)
```

## Run
```
npm run smoke      # expect: 29/29 sentinels PASS on clean code
npm run saboteur   # expect: baseline 29/29 green, then 29 CAUGHT, 0 BLIND
node verify-release.js   # static gate — expect RELEASE-GATE PASS
node csp-check.js        # expect CSP-CHECK PASS (0 violations)
```

Both `smoke` and `saboteur` exit non-zero on failure, so they can gate a commit/deploy.

## ⚠ What these tests DO and DO NOT prove (framework P-13)
These tests prove **regressions are caught** and that the app's safety/permission logic
**works for an honest client**. They are **NOT** a proof of tamper-proof security. The
saboteur suite verifies **client-side gates only** — it cannot prove server-side
enforcement, because there is none yet (all auth/authz runs in the browser, the accepted
M-3 / D-039 alpha trade-off). A determined user with DevTools can still bypass any
client-side check. **No audit report may describe browser-side role checks as "secure
enforcement."** Server-side enforcement is the P1 / Azure-phase work — see
`../Stock Audit Framework v1/EXTERNAL-STANDARDS-COVERAGE.md`.

## Notes
- `smoke-test.js` finds the app via `path.resolve(__dirname, '..')` — it tests the repo
  it lives in. Pass a directory as `node smoke-test.js <dir>` to test another copy.
- Extend `MUTATIONS` in `saboteur-runner.js` as new invariants are added; the full
  catalogue + methodology is in the audit framework's `SABOTEUR-MUTATION-LIST.md`.
