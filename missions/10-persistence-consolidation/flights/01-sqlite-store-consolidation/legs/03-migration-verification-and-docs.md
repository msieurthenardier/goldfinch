# Leg: migration-verification-and-docs

**Status**: completed
**Flight**: [SQLite Store Consolidation](../flight.md)

## Objective

Prove the consolidation against the real app — the `sqlite-store-migration`
behavior test (seeded-profile migration fidelity + corrupt-DB boot recovery)
— and land the documentation: CLAUDE.md store sections, BACKLOG retirement
(+ stale-Node fix), and DD1 re-affirmation cross-links.

## Context

- Legs 1-2 landed (uncommitted): all five stores persist via `app.db`
  `documents` rows; boot seam reshaped; suite 2017 pass / 0 fail.
- Apparatus premise (audited at leg design): no goldfinch instance running;
  Wayland socket present (`/mnt/wslg/runtime-dir/wayland-0`); the app is
  launchable via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1`; the
  out-of-band launch/quit harness is the session's own shell (M09 F10
  precedent). Dev profile dir = the `devUserDataPath(...)`-suffixed
  userData; it gets a pre-test backup and post-test restore.
- Standing carry: the admin MCP key is captured into an env var from the
  launch output and passed by reference ONLY — never printed, never a
  command literal.

## Inputs

- Legs 1-2 working tree; behavior spec `tests/behavior/sqlite-store-migration.md`
  (authored at flight design).

## Outputs

- Behavior-test run log under `tests/behavior/sqlite-store-migration/runs/`
  (committed with the flight).
- CLAUDE.md: settings-store section notes the row-backed substrate; a new
  app-db subsection (or equivalent placement) documents `app.db`, the
  document seam, migration + `.migrated` semantics, quarantine, DD1
  re-affirmation pointer to the flight's DD1; the five store descriptions
  reflect Electron-free + injected + codec discipline (shields included).
- BACKLOG.md: "Persistent storage substrate: JSON stores → SQLite" entry
  retired (marked landed with pointer to M10 F1, per how BACKLOG retires
  entries — see the shrink-to-fit entry's pattern), stale "Node ≥ 22.12"
  note corrected to the verified bundled Node 24.18.
- Flight log updated; leg statuses current.

## Acceptance Criteria

- [x] `/behavior-test sqlite-store-migration` run completes with verdict
      **pass** (run log committed). If the rig fails mid-session for
      environmental reasons, the honest outcome is recorded and the run is
      HAT-scoped per the flight's Verification clause — never claimed
      green.
- [x] CLAUDE.md accurately describes the post-consolidation persistence
      architecture (app.db + documents seam + migration + quarantine +
      widened DD1 tax) with no stale references to the five JSON files as
      live stores.
- [x] BACKLOG entry retired + Node-note fix.
- [x] `npm test` / `npm run typecheck` / `npm run lint` still green after
      doc edits.

## Verification Steps

- Behavior-test run log status field = pass.
- Grep CLAUDE.md for `settings.json` / `shields.json` / `containers.json` /
  `downloads.json` / `session.json` — remaining mentions must be historical
  (migration/`.migrated` context), not live-store claims.
- `npm test` unchanged at 2017 pass.

## Implementation Guidance

1. **Docs first (Developer spawn)** — CLAUDE.md: update the "Settings store"
   section header block and add the app-db substrate description near the
   "History store" section (mirror its depth: pragmas, WAL family,
   quarantine, migration semantics, the DD5 unknown-version carve-out, DD10
   refined shields posture, the widened DD1 tax sentence). BACKLOG: retire
   the seed entry the way landed entries are retired (status line + pointer
   to M10 F1), fix the Node line.
2. **Then the live gate (Flight Director runs `/behavior-test
   sqlite-store-migration` directly)** — profile backup, seed, launch,
   verify, corrupt-DB variant, restore. The Executor/Validator crew and
   run-log format come from the behavior-test skill + ARTIFACTS.md.

## Edge Cases

- **Rig launch fails (no display/socket)** — record NO-GO honestly,
  HAT-scope the run (flight Verification clause), flight still lands on
  the structural layer.
- **Dev profile contains real state** — backup/restore is mandatory,
  verified by checksum before/after.

## Files Affected

- `CLAUDE.md`, `BACKLOG.md` — docs
- `tests/behavior/sqlite-store-migration/runs/…` — run log (created by the
  test run)
- flight/leg artifacts — statuses

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-end review/commit model)

## Citation Audit

No source-code line citations (docs + verification leg); store/flight
references verified live during legs 1-2.
