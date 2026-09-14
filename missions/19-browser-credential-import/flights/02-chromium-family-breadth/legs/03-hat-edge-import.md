# Leg: hat-edge-import

**Status**: completed
**Flight**: [Chromium Family Breadth](../flight.md)

## Objective

A guided human acceptance test on the running app covering two things: (a) a
real Edge export imports end-to-end on the generalized pipeline with the
Chromium-family copy reading right (the mission criterion), and (b) the restore
flow still works after leg 1's extraction (the CP1 spot-check that has no
automated DOM harness).

## Context

- Interactive leg (`hat-*`): no autonomous Developer/Reviewer cycle. The Flight
  Director guides the operator one step at a time; failures are diagnosed and
  fixed inline (fix-vs-feature gate + multi-surface trigger), committed as their
  own HAT-fix commits (Flight 1 precedent), the step re-verified before moving
  on.
- Under test: flight commit `cc877d0` (legs 1+2), draft PR #211. Both build legs
  `completed`; green bar 4436.
- Real credentials in play: the Edge export and any vault bundle are the
  operator's, never committed, never pasted (report in words/counts only).

## Prerequisites

- The app launched from this branch (dev profile — isolated, keeps the real
  vault untouched). WSLg note: if the window will not present, the Flight 1 HAT
  needed a machine restart or the X11 ozone backend.
- A vault set up + unlocked with ≥1 persistent jar.
- A real Edge password export (`edge://…/passwords` → Settings → Export
  passwords → CSV). The planning sample confirmed the format; this is the live
  full-file check.

## Acceptance Criteria (= verification steps, one at a time)

**Edge import (the mission criterion):**
- [x] **HE1 Generalized affordance + guidance.** On `goldfinch://vault` →
      Settings → Import / Export, the "Import from a browser…" button opens a
      pick modal whose lede is BROWSER-GENERIC — it names Chrome, Edge, and
      other Chromium browsers, and does NOT read "In Chrome … chrome://password-manager"
      only.
- [x] **HE2 Pick + generalized refusal.** A non-export file → the refusal reads
      "…isn't a recognized browser password export." (browser-generic, not
      "Chrome"). The real Edge export → "N logins found" (+ "M rows can't be
      imported" if any).
- [x] **HE3 Import lands.** Into an empty jar (Merge), the native confirm names
      the destination + count; Import → completion report reads true
      ("N imported", unmappable counts with reasons); the jar's Logins list shows
      the Edge logins with correct titles/origins/usernames; the `android://`
      row (if present) reported "non-web origin (android://)", federated rows as
      "no stored password", empty-username rows imported blank.
- [x] **HE4 Re-import dedupes.** Same Edge file, same jar (Merge) → "0 imported,
      N already present"; item count unchanged.

**Restore-flow spot-check (CP1 — leg 1 didn't break restore):**
- [x] **HR1 Export modal.** Settings → Import / Export → Export… opens, offers
      whole-profile and single-vault choices, and writes a bundle file (the
      moved `openExportModal` works; the post-export page notice shows via the
      `setNotice` handoff).
- [x] **HR2 Restore flow.** Import a vault bundle: pick → the secret sheet → the
      mapping modal renders (destination list, Replace/Merge, the dot-swatch
      color picker for a new jar) → commit → the completion modal lists per-vault
      outcomes. All of this is the extracted `openImportPickModal` /
      `openMappingModal` / `buildColorSwatchGrid` / `openCompletionModal` —
      confirm no visual/behavior regression vs. before.
- [x] **HR3 Resume affordance.** With a restore mapping modal open, trigger a
      lock-state change (lock the vault, or idle autolock) so the modal
      force-closes; after unlock, Settings shows a "Resume restore…" button that
      re-opens the mapping from the still-held record (the `pendingImportRecord`
      controller-ownership handoff working across the vault.js↔controller
      boundary).

## Verification Steps

Each step is operator-performed in the running app; the Flight Director records
each result in the flight log's Leg 3 entry and fixes failures inline.

## Fix Protocol

- Failure → diagnose; a code fix spawns a Developer (or, for a multi-surface /
  main-wiring fix, a lightweight design-review pass first), green bar, then the
  operator re-runs the step. Fixes commit per batch (never amend) on the flight
  branch; PR #211 updates. Every fix + fix-vs-feature call logged (HAT fix N).

## Files Affected

- Whatever inline fixes touch, plus `flight-log.md`.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (or dispositioned)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed`
- [x] Check off this leg in flight.md
- [x] Final leg of flight: flight.md status `landed`, check off flight in mission.md
- [x] Commit
