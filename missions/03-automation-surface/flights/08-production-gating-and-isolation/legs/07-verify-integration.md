# Leg: verify-integration

**Status**: ready
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](../flight.md)

## Objective
FD-driven live verification, on a **packaged** (`npm run pack`) build, that the F8 production posture holds — toggle-binds, human-only enable, admin-on-prod, port free-fallback, and dev-profile isolation — with cited machine-read evidence.

## Context
- **DD8a.** Legs 1–6 landed on code-inspection + unit tests; the live behavior (and the `app.isPackaged === true` paths in particular) can only be observed on a real packaged build, which the dev `electron .` path always reports as unpackaged. This leg is the live half.
- **Prerequisites (flight-level, deferred to execution):**
  - **`npm run pack` has never been run (no `dist/`).** The **first action** of this leg is to confirm `npm run pack` produces a launchable `--dir` build — watch for icon / linux-dep issues. Do **not** assume it builds.
  - **Operator profile reset** — in `~/.config/goldfinch`: Settings → Automation → toggle OFF + revoke the dev-minted jar/admin keys left by F7's pre-isolation dev runs (one-time; required before the installed-profile assertions can be trusted).
  - **GUI display** (WSLg/Linux) to launch the packaged app.
- **FD-driven, not agent-spawned** — the Flight Director runs the probes directly and cites machine-read evidence (curl status codes, file listings, stdout), per the M02 behavior-test-mode decision.

## Acceptance Criteria (each backed by cited machine-read evidence)
- [ ] **Pack builds + launches:** `npm run pack` produces a `dist/*-unpacked` (or platform equivalent) build that launches with a window. Record any icon/linux-dep fix needed. *(If pack fails, this is a finding — fix or record before proceeding.)*
- [ ] **Toggle-binds (packaged):** with the packaged app running and the toggle **OFF**, `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/mcp` → **connection-refused** (surface unbound). Flip the toggle **ON** in Settings → the same curl returns **401** (bound, keyless rejected); with a minted jar key in `Authorization: Bearer` → **200/initialize** succeeds. Flip **OFF** → connection-refused again; the chrome activity indicator clears. `--automation-dev` passed to the packaged binary changes **nothing** (no-op).
- [ ] **Human-only enable (packaged):** minting a jar key while the toggle is OFF does **not** bind the surface (curl still refused); no auto-mint apparatus runs on the packaged binary; confirm no programmatic path flips `automationEnabled` (the surface only binds after the human flips the toggle).
- [ ] **Admin on production:** with `GOLDFINCH_AUTOMATION_ADMIN` set on the packaged binary + toggle ON + a minted admin key, an admin MCP client resolves admin identity (`getChromeTarget` succeeds). Without the env, the admin tier is invisible (UI block hidden) and admin auth is refused.
- [ ] **Port free-fallback:** with the preferred port occupied, the setting/default path binds the next free port and the Settings live-address shows the **bound** port; two packaged instances launched back-to-back both bind (different ports). In a dev run, `GOLDFINCH_MCP_PORT=<taken>` **fails loudly** (surface unbound, clear error); on the packaged binary the env is **ignored**.
- [ ] **Dev-profile isolation:** a `dev:automation` launch reads/writes `~/.config/goldfinch-dev`; the installed `~/.config/goldfinch` is **byte/mtime-unchanged** across the dev session (capture before/after listings + mtimes, partition data included).
- [ ] **Gates:** full `npm test` + `npm run typecheck` + `npm run lint` green on the committed branch.
- [ ] **DD9 (may run here or in leg 8):** `/behavior-test automation-key-gating` passes (toggle OFF → mint buttons disabled, flip ON → enabled live, flip OFF → disabled; Revoke works while OFF).

## Verification Steps
- `npm run pack` then launch the unpacked binary; `curl` probes for each bind/auth transition (record status codes).
- `ls -la --time-style=full-iso ~/.config/goldfinch` before/after a dev session for the isolation assertion.
- Two-instance: launch packaged instance A, then B; read each Settings live-address port.
- Record all evidence (curl outputs, file listings, stdout) in the leg's flight-log entry / run notes. A failing criterion is an unmet acceptance criterion — fix in a **new** commit (no amend), re-verify.

## Files Affected
- None (verification leg) — unless a defect is found, which is fixed in a new commit by a spawned Developer, then re-verified.

---

## Post-Completion Checklist
- [ ] All criteria verified with cited evidence (or defects fixed + re-verified in new commits)
- [ ] Update flight-log.md with the evidence + verdicts
- [ ] Set this leg's status to `completed`; check off in flight.md
- [ ] Proceed to leg 8 (HAT) or, if leg 8 is folded, begin flight landing
