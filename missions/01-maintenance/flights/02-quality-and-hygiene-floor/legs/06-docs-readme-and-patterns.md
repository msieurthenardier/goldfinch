# Leg: docs-readme-and-patterns

**Status**: completed
**Flight**: [Quality & Hygiene Floor](../flight.md)

## Objective
Make the public README accurately describe the shipped feature set (F12), and document in CLAUDE.md the architectural patterns + dev commands this mission introduced (Flight 1 debrief carry-forward + the new lint/typecheck scripts).

## Context
- F12 (maintenance report): `README.md` understates the app. Recon confirmed `## Features` omits the Shields/privacy/containers feature set (shipped v0.2.0 + the v0.3.0 security hardening), `## Keyboard shortcuts` omits `Ctrl+Shift+P`, and the `## Architecture` table omits `shields.js`/`jars.js`/`trackers.js`.
- Carry-forward (Flight 1 debrief): CLAUDE.md documents the `npm test` note but not the `src/shared/` dual-export predicate pattern or the `createTab` + `will-navigate` two-point security boundary. Also add the new `npm run lint`/`npm run typecheck` commands (Flight 2).
- Docs-only, markdown — independent of the code legs. `README.md`/`CLAUDE.md` are `.prettierignore`'d, so no formatter interaction.
- **Do NOT touch** the README `<!-- DOWNLOADS:START/END -->` auto-managed block (release workflow owns it).

## Inputs
- `README.md` (`## Features`, `## Keyboard shortcuts`, `## Architecture` sections), `CLAUDE.md`.
- Source of truth for accuracy: `src/main/shields.js` (block/strip/isolate/farble + paused sites), `src/main/jars.js` (Default/Personal/Work/Banking containers + burners + custom), `src/main/trackers.js` (tracker classification), `renderer.js` (the `Ctrl+Shift+P` privacy-panel binding, media panel), `src/main/main.js` (New Identity, permission denial).

## Outputs
- `README.md` — Features section covers Privacy/Shields (tracker blocking, tracking-param stripping, third-party cookie isolation, fingerprint farbling), cookie-jar containers (incl. burners), the privacy panel, and New Identity; Keyboard shortcuts includes `Ctrl+Shift+P`; Architecture table lists `shields.js`, `jars.js`, `trackers.js`.
- `CLAUDE.md` — a short subsection documenting (a) the `src/shared/` dual-export predicate pattern (one predicate, consumed by main via `require` and the renderer via `<script>` global, unit-tested), (b) the two-point hostile-URL boundary (`createTab` gate + main `will-navigate` guard, sharing `isSafeTabUrl`), and (c) the dev commands `npm run lint` / `npm run typecheck` (alongside the existing `npm test`).

## Acceptance Criteria
- [ ] README `## Features` accurately describes the privacy/Shields capabilities, the container/jar model (Default/Personal/Work/Banking + burner + user-created), the privacy panel, and New Identity — matching the actual behavior in `shields.js`/`jars.js`/`main.js` (no invented features).
- [ ] README `## Keyboard shortcuts` includes `Ctrl+Shift+P` (toggle privacy panel) and any other implemented-but-undocumented shortcut found in `renderer.js`.
- [ ] README `## Architecture` table includes `shields.js`, `jars.js`, `trackers.js` with one-line descriptions consistent with their actual roles.
- [ ] The `<!-- DOWNLOADS:START/END -->` block is untouched; the download table is not edited by hand.
- [ ] CLAUDE.md documents the `src/shared/` dual-export pattern, the `createTab` + `will-navigate` security boundary, and the `npm run lint`/`npm run typecheck` commands.
- [ ] No source/test/config files changed; `npm test`/`lint`/`typecheck` remain green (untouched).

## Verification Steps
- Read the README sections — verify each claimed feature maps to real code (cross-check `shields.js` strategies, `jars.js` DEFAULTS, the `Ctrl+Shift+P` handler in `renderer.js`).
- `grep -n "DOWNLOADS:START" README.md` → block intact; confirm the table rows under it are unchanged from current.
- `grep -n "shields.js\|jars.js\|trackers.js" README.md` → present in the architecture section.
- `grep -n "src/shared\|will-navigate\|npm run lint\|npm run typecheck" CLAUDE.md` → present.

## Implementation Guidance
1. **README Features**: add a "Privacy & Shields" subsection — tracker/ad blocking (`block`), tracking-parameter stripping + Referer trimming (`strip`), third-party cookie isolation (`isolate`), fingerprint farbling (`farble`), per-site pause; and a "Containers / cookie jars" subsection — isolated session partitions (Default/Personal/Work/Banking), ephemeral burner tabs, user-created jars, New Identity (wipe + reroll). Keep claims tied to real behavior; don't overstate.
2. **README Keyboard shortcuts**: add `Ctrl+Shift+P` → toggle privacy panel. Scan `renderer.js` keydown handlers for any other shortcut not already listed and add it.
3. **README Architecture**: add rows for `shields.js` (Shields config + URL/cookie policy helpers), `jars.js` (container/jar session partitions), `trackers.js` (registrable-domain + tracker classification).
4. **CLAUDE.md**: add a brief "Patterns" note (or extend the architecture section) covering the `src/shared/` dual-export predicate, the two-point security boundary, and list `npm run lint`/`npm run typecheck` in the commands area near the existing `npm test` line.
5. Leave the DOWNLOADS block and all code/config untouched.

## Edge Cases
- **Auto-managed DOWNLOADS block**: editing it would be clobbered by the next release and could conflict — never touch it.
- **Accuracy over completeness**: only document what the code actually does (e.g. don't claim signed builds — they're unsigned; don't claim features not in the code).
- **Project-owned doc shape**: these are the project's own README/CLAUDE.md — match their existing structure/heading style; add sections, don't restructure.

## Files Affected
- `README.md` — Features, Keyboard shortcuts, Architecture (NOT the DOWNLOADS block)
- `CLAUDE.md` — patterns + new dev commands

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] `npm test`/`lint`/`typecheck` still green (untouched)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 6 of 7)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
