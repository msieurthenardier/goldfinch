# Squawk 0071: Electron major bump 43.4.1 → 44.3.0 (Dependabot #210)

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-14
**Completed**: —

## Report

Dependabot opened PR #210 bumping `electron` from **43.4.1 → 44.3.0** — a
**MAJOR** version step (43 → 44), NOT a routine dev-dep bump. It carries
CLAUDE.md's explicit standing tax (App database section): "every Electron major
bump re-runs the full store suite (`history-store` + `app-db` + all five stores)
and treats a `node:sqlite` API break as a first-class migration cost."
`node:sqlite` is an EXPERIMENTAL Node/Electron API and the primary risk surface —
a major Electron bump can move Node versions and change or break it.

**This squawk is provisional.** It qualifies as `servicing` ONLY if the bump is
clean. **Escalation condition (fails the squawk no-design gate → becomes a
flight):** if completing it requires ANY `node:sqlite` (or other Electron/Node)
API migration work beyond a mechanical "bump the range + regenerate the lockfile
+ full green bar + the store suites pass + a manual dev-launch smoke", STOP and
escalate to `/mission-control:flight` rather than force it through as a squawk.

## Evidence

- `package.json` devDependency `electron`: `43.4.1` (installed 43.4.1); PR #210
  targets `44.3.0`.
- CLAUDE.md, App database (`src/main/app-db.js`) — the "Standing tax: every
  Electron major bump re-runs the full store suite … a `node:sqlite` API break
  as a first-class migration cost" rule; decision records in the mission
  08/10 `flight.md` files.
- `src/main/app-db.js` / `src/main/history-store.js` — the `node:sqlite`
  (`DatabaseSync`) consumers; `test/unit/` store suites are the gate.
- NOT the GitHub Actions SHA-pin rule — that governs workflow `uses:` refs; this
  is an npm dependency, verified by lockfile integrity, not a mutable tag.

## Corrective Action

*(written at completion — expected, IF clean: bump `electron` to `^44.3.0` in
package.json, `npm install` to regenerate the lockfile, run `npm audit
--audit-level=high` + the full green bar + specifically the store suites
(`app-db`, `history-store`, and all five document stores) + a manual `npm run
dev:automation` boot smoke. If any store suite or a node:sqlite call breaks →
ESCALATE, do not "fix" here.)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
