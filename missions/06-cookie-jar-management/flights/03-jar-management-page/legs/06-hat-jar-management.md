# Leg: hat-jar-management

**Status**: completed
**Flight**: [Jar Management Page](../flight.md)

## Objective

Operator-witnessed acceptance of Flight 3's user-visible surfaces: the jars page's
look-and-feel and full CRUD flows on the real profile (reversibly), live
propagation page↔chrome in both directions, accelerator parity under page focus,
popup inheritance from a real click, and the destructive delete story on a scratch
profile. Interactive — the Flight Director guides one step at a time; fixes are
applied inline and re-verified. CP5 gate.

## Context

- Everything machine-verifiable is already green (suite 1223/1223; behavior tests
  18/18 across three specs; boot smoke 3/3). This leg judges what the apparatus
  cannot observe (DD9): page DOM, look-and-feel, real keyboard input, real clicks.
- **Two-environment split (F2 HAT precedent)**: the operator's REAL dev profile is
  touched only reversibly (create→delete a throwaway jar; move the default flag
  and move it back); the destructive delete-all demo runs on an FD-staged scratch
  profile. Every real-profile mutation is reversed before its step closes.
- Apparatus for the scratch demo: the same launch recipe as Leg 5's runs; the
  operator watches the window while the FD drives via chrome-eval.
- Housekeeping rider (F1 rec 5): `containers.json.v1.bak` in the real dev profile
  expired at F1's merge — operator-witnessed deletion in step 7.

## Verification Steps (guided, one at a time)

1. **Real profile — reach the page + look-and-feel (DD3/DD5 posture).** Operator
   launches their normal dev app; opens the kebab (⋮) menu → "Cookie jars". The
   page lists every real jar with color dot, name, and the default marker on the
   flag holder; the Burner row is present with NO edit/delete/default controls;
   the tab is titled "Cookie Jars — Goldfinch"; the feel matches
   settings/downloads. Also: container picker (▾) shows "Manage jars…" under
   "+ New container…" and it opens the page too.
2. **Real profile — create (reversible part 1).** From the page: "+ New jar" →
   first type a name of ONLY SPACES and confirm Create stays disabled (the
   page-side trim is the sole enforcement for whitespace-only names — this path
   has no machine witness, HAT-only coverage) → then name "HAT Test", pick a
   palette color → create. The row appears; the picker (without reload) now
   lists HAT Test; open a tab in it via the picker — dot color matches.
3. **Real profile — rename/recolor live propagation.** Edit HAT Test → rename to
   "HAT Renamed", different swatch → save. The open tab's dot recolors and
   tooltip renames without restart; the page row and picker update; while the
   page is open, quick-create "HAT Quick" from the PICKER — the page row list
   updates live (chrome→page direction). Delete "HAT Quick" from the page
   (first confirm-flow exercise: consequence text visible; try Escape/Cancel
   once, then Confirm).
4. **Real profile — set-default round-trip (reversible part 2).** Note the
   current default holder. Set HAT Renamed as default from the page → marker
   moves; Ctrl+T lands in HAT Renamed (dot check). Set the ORIGINAL holder back
   as default → Ctrl+T lands in it again.
5. **Real profile — delete closes tabs (reversible part 3, net-zero point).**
   With the HAT Renamed tab still open, delete HAT Renamed from the page
   (Confirm) → its open tab closes; jar vanishes from page + picker. Real
   profile is now back to its pre-HAT state (original jars, original default).
6. **Real profile — accelerator parity + popup inheritance (D2/DD7/DD8
   surfaces).** With a WEB page focused (click into page content first):
   Ctrl+T (new tab — F2 regression check), Ctrl+W (closes that tab — newly
   forwarded), Ctrl+L (address bar), Ctrl+R (reload). With the JARS PAGE focused:
   Ctrl+W closes it (internal allowlist), reopen via kebab. Then, in a tab in a
   NON-default jar, click a real `target="_blank"` link (operator's choice of
   site) → the new tab's dot matches the SOURCE jar, not the default.
   (FD crib notes: Ctrl+R is deliberately INERT on internal pages — the internal
   allowlist is new-tab + close-tab only; don't misread that as a failure. The
   row default button reads "Make default"; the delete confirm text is verbatim
   "Deletes this jar and wipes its cookies, site storage, and cache. Open tabs
   in this jar will close."; the default marker is a small uppercase "Default"
   pill.)
7. **Scratch profile — destructive demo + housekeeping.** FD launches a scratch
   instance (operator watches that window): open the jars page; FD FIRST opens
   one tab in each seed jar via `openTab` (so there are tabs to close —
   design-review catch), then deletes both seed jars via chrome-eval — operator
   watches rows disappear live, those tabs close, the fallback burner tab
   appear, and the page show Burner as default; FD adds a jar — row appears,
   marked default. FD tears down. Then, operator-witnessed:
   delete `~/.config/goldfinch-dev/containers.json.v1.bak` (F1 rec 5 — its
   restoration purpose expired at F1's merge).
8. **Sign-off.** Operator states satisfied; any issues found were fixed inline
   and re-verified.

## Acceptance Criteria

- [x] Steps 1-7 confirmed by the operator (visual + behavioral); any findings
      fixed inline and re-verified before proceeding
- [x] Real profile verifiably restored to pre-HAT state (original jars, original
      default, HAT jars gone) — step 5 is the checkpoint
- [x] Inline fixes (if any) verified (suite/typecheck/lint) and committed in a
      HAT-fixes commit
- [x] `.v1.bak` housekeeping done (operator-witnessed)

## Post-Completion Checklist

- [x] Flight-log entry with per-step outcomes + operator verdicts
- [x] Leg status → `completed`; CP5 checked; flight → `landed`; mission Flights
      list updated; `[COMPLETE:flight]`
