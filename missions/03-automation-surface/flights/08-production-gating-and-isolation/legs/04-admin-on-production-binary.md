# Leg: admin-on-production-binary

**Status**: completed
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](../flight.md)

## Objective
Confirm the env-gated admin tier (`GOLDFINCH_AUTOMATION_ADMIN`) is usable on a **packaged** build — admin auth, `mintAdminKey`, and the admin UI control all resolve/appear with **no coupling** to `--automation-dev` or `!app.isPackaged`.

## Context
- **DD5** (Architect: "likely confirm-only"). The admin tier was always env-gated and independent of the dev flag. F8 demotes `--automation-dev` to dev-only (`!app.isPackaged`-gated, leg 3/4); this leg verifies that demotion did **not** drag the admin tier down with it — the admin env must still work on the shipped binary, since "the only special flag should be for the admin key, doable in the production instance" (mission Context).
- **No-code expected.** DD5's work is to (a) confirm nothing couples admin to the dev flag / `!app.isPackaged`, (b) confirm the env-gated admin **UI control** appears + functions on a packaged build, (c) confirm `mintAdminKey` + admin auth resolve under `app.isPackaged`. Admin still requires the human toggle ON (`resolveIdentity` needs `automationEnabled===true` OR the dev override — which is false when packaged — so on a packaged build it's the human toggle) **and** a minted admin key.
- **FD pre-audit (2026-06-17):** the admin path reads `GOLDFINCH_AUTOMATION_ADMIN` in exactly these places, all env-only, none touching `app.isPackaged` / the dev predicates:
  - `automation-auth.js` `validateKey` — admin resolves IFF `adminEnabled===true` (the env presence) AND the admin hash matches.
  - `mcp-server.js:454` — `adminEnabled = !!process.env.GOLDFINCH_AUTOMATION_ADMIN` in `resolveIdentity`.
  - `mcp-server.js:772` — `mintAdminKey` returns null unless the env is set.
  - `main.js:752` — `automation:list-keys` reports `adminEnabled` from the env (drives the UI).
  - `settings.js:603` — the admin block is `hidden` unless `adminEnabled` (from list-keys).
  This leg is an **independent confirmation** of that pre-audit, not a fix — unless the audit finds coupling, in which case it becomes a real fix and is re-reviewed.

## Inputs
- Legs 1–3 landed (uncommitted): dev flag now `!app.isPackaged`-gated at its three call sites; admin paths untouched by that gating.

## Outputs
- A recorded confirmation (flight-log) that admin auth / mint / UI are env-only, with no `app.isPackaged` or `--automation-dev` coupling — OR, if coupling is found, a fix decoupling them.
- The live "admin works on a packaged build" checks (UI appears, mint works, admin MCP client resolves admin identity) are folded into **leg 7 (`verify-integration`)**, which owns the packaged build. This leg does **not** require the packaged build.

## Acceptance Criteria
- [x] **No dev-flag / `app.isPackaged` coupling (static):** an audit of every `GOLDFINCH_AUTOMATION_ADMIN` reader and the admin code paths (`validateKey` admin branch, `resolveIdentity` admin, `mintAdminKey`, `automation:list-keys` `adminEnabled`, the `settings.js` admin block + admin mint/revoke handlers) confirms none of them gate on `app.isPackaged`, `isAutomationDevEnabled`, `isMcpAutomationEnabled`, or `devEnableOverride`. Result recorded in the flight-log (with the grep/inspection evidence). **CONFIRMED — all 5 functional readers are bare env-presence checks; dev-predicate scan of the admin files finds hits only in the enable gate / `devEnableOverride` plumbing, never an admin branch.**
- [x] **Admin requires toggle-on, not the dev override, on a packaged build (reasoning confirmed):** on `app.isPackaged`, `devEnableOverride` is false, so admin auth requires `automationEnabled===true` (human toggle) + a valid admin key — confirm `resolveIdentity`'s admin branch is reached only after the enable/override check passes, i.e. admin is not a back-door around the human-only enable. **CONFIRMED — `resolveIdentity` (mcp-server.js:449) runs the enable gate FIRST; `validateKey`/admin (line 455) is reached only after it passes. Packaged ⇒ override false ⇒ human toggle is sole enable. Not a back-door.**
- [x] **DD9 admin-mint gating intact (from leg 3):** the admin mint button is disabled when the persisted toggle is off (leg-3 work); confirm this composes correctly with the env gate (admin block visible via env; mint button enabled only when toggle on). No regression. **CONFIRMED — `renderAdmin`: block visibility = env (line 608), mint-button disabled = `!automationEnabled` (line 613), kept live via `onSettingsChanged`. Composes correctly.**
- [x] **No code change unless coupling found.** If the audit is clean, this leg makes **no source edits** — it records the confirmation and defers the live packaged-build checks to leg 7. If coupling is found, decouple it (admin gates on env only) and add/adjust a unit test; flag for re-review. **Audit CLEAN → no source edits. Live packaged-build checks deferred to leg 7.**
- [x] `npm test` / `typecheck` / `lint` remain green (trivially, if no code change). **726 pass / 0 fail; typecheck clean; lint clean — unchanged from leg 3.**

## Verification Steps
- `grep -rn "GOLDFINCH_AUTOMATION_ADMIN" src/` + read each admin code path; confirm env-only gating (no `isPackaged`/dev-predicate in any admin branch).
- Code inspection of `resolveIdentity`: the admin branch in `validateKey` is reached only after the `automationEnabled===true OR devEnableOverride()` enable check — admin is not a bypass.
- **Live (deferred to leg 7 on the packaged build):** with `GOLDFINCH_AUTOMATION_ADMIN` set + toggle on + a minted admin key, an admin MCP client resolves admin identity (`getChromeTarget` succeeds); without the env, the admin tier is invisible and admin auth is refused.

## Edge Cases
- **Admin env set but toggle off (packaged)** → admin block visible, admin mint button disabled (DD9), admin auth 401s (surface not enabled). Correct — admin is not a self-enable path.
- **Admin env set on a dev build** → already works today (env-only); unaffected by the `!app.isPackaged` demotion of `--automation-dev`.

## Files Affected
- None expected (confirm-only). If coupling is found: `src/main/automation/mcp-server.js` / `automation-auth.js` and a unit test.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (or unchanged-green if no code edit)
- [ ] Update flight-log.md with the confirmation evidence (or the fix, if coupling found); note the live packaged-build admin checks → leg 7
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 4 of 8)
- [ ] Commit deferred to flight-end batch review

## Citation Audit
Citations verified against current code at leg design time (2026-06-17, post-leg-3):
- `src/main/automation/automation-auth.js` `validateKey` admin branch (`c.adminEnabled === true && … hashEquals`) — **OK**.
- `src/main/automation/mcp-server.js:454` `adminEnabled = !!process.env.GOLDFINCH_AUTOMATION_ADMIN`; `:772` `mintAdminKey` env guard — **OK**.
- `src/main/main.js:752` `automation:list-keys` `adminEnabled` from env — **OK**.
- `src/renderer/pages/settings.js:603` admin block `hidden` unless `adminEnabled` — **OK**.
- grep confirms `GOLDFINCH_AUTOMATION_ADMIN` appears only in env-presence checks, never alongside `app.isPackaged` / dev predicates. **OK** (the leg's independent audit re-confirms).
