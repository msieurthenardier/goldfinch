# Behavior Test Run: spellcheck — SKELETON (PENDING HAT RUN)

> **SKELETON — DO NOT TREAT AS A RESULT.** Pre-written by the Leg-6 deterministic pass (PART D setup) to
> reduce friction for the operator-driven `hat-and-alignment` (HAT) leg. **It records no verdicts.** The
> live HAT run must: rename this file to the real `{ts}` timestamp (`YYYY-MM-DD-HH-MM-SS.md`), fill every
> `<TODO>`, set the per-row dispositions, and — when the WSLg-acceptance rows (1–3, 5 plumbing-half, 6)
> pass — flip the spec header `**Status**: draft → active` (AC10 / DD5). The native-render rows (Step 4
> squiggle PAINT; Step 5's native-`NSSpellChecker` content half) are recorded **per-row
> INCONCLUSIVE-on-WSLg / macOS-deferred** — NOT failed, NOT used to keep the spec `draft`. Delete this
> skeleton once the real run log lands.

**Spec**: [tests/behavior/spellcheck.md](../../spellcheck.md)
**Status**: <TODO: pass (WSLg-acceptance rows) | fail>
**Started**: <TODO ISO timestamp>
**Completed**: <TODO>
**Duration**: <TODO>
**Mode**: scripted live integration smoke (leg-permitted) OR Witnessed `/behavior-test spellcheck`.
**Apparatus**: Goldfinch MCP automation surface (loopback), **admin** key (chrome `#page-context-menu` +
the `goldfinch://settings` guest + a web guest). The `chrome-devtools` MCP does NOT qualify.
**Driver**: <TODO — not committed>

## Summary

<TODO: per the Leg-6 DD5 plan — rows 1, 2, 3, 5(plumbing half), 6 are WSLg-acceptance RUN; row 4 (squiggle
PAINT) and row 5's native-speller-content half are INCONCLUSIVE-on-WSLg / macOS-deferred (folded into the
HAT leg). An empty `dictionarySuggestions` is the dict-not-loaded case — NEUTRAL, not a failure.>

## Environment

- App: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (WSLg, X11/`:0`).
- MCP server **bound port <TODO>** (capture live; do NOT hardcode 49707).
- Profile reset: `userData/settings.json` deleted or `spellcheck: false` before the run (Default-OFF baseline).

## Step Results (per-row disposition — DD5)

### Step 1 (active-precondition probe) — <TODO>
- **Disposition**: RUN. tools/list presence + numeric chrome `wcId`. <TODO>

### Step 2 (Default-OFF state proxy) — <TODO>
- **Disposition**: RUN (state proxy, NOT a network assertion). `settings.json` `spellcheck:false` (or
  absent); right-click a misspelled word → forwarded `params` carry empty/absent `misspelledWord` +
  empty `dictionarySuggestions` → menu shows **no** spelling-suggestions section. <TODO raw + verdict + evidence>

### Step 3 (enable via Settings → Appearance) — <TODO>
- **Disposition**: RUN. `#spellcheck-enabled` reads checked (`aria-checked="true"`); `settings.json`
  `spellcheck === true` (filesystem); help text shows the conservative new-tabs/reload wording. `[a11y]` <TODO>

### Step 4 (squiggle PAINT on a misspelled word) — INCONCLUSIVE-on-WSLg / macOS-deferred
- **Disposition**: **INCONCLUSIVE-on-WSLg.** The red wavy underline does not paint into a `captureWindow`
  frame under WSLg (Leg-2 premise-audit, Electron 42.4.0); the API toggle is confirmed live, the render is
  not observable here. **Flag, do NOT fail.** Folded into `hat-and-alignment` (real macOS display). <TODO note>

### Step 5 (right-click → suggestions → choose → correction) — MIXED <TODO>
- **Disposition (plumbing half — RUN)**: when forwarded `params` carry a `misspelledWord` + non-empty
  `dictionarySuggestions`, the menu renders a spelling-suggestions section (capped at 8; "No suggestions"
  placeholder when set-but-empty); choosing one fires `correctMisspelling` and the field text changes
  (`evaluate` DOM observable). **Empty `dictionarySuggestions` = dict-not-loaded = NEUTRAL, not a failure.**
- **Disposition (native-content half — INCONCLUSIVE-on-WSLg / macOS-deferred)**: the native `NSSpellChecker`
  suggestion-list **content** + the visual correction on a real display — macOS-authoritative. Folded into HAT.
- <TODO raw + verdict (plumbing) + evidence>

### Step 6 (disable round-trips OFF) — <TODO>
- **Disposition**: RUN. `#spellcheck-enabled` unchecked; `settings.json` `spellcheck === false`
  (filesystem). `[a11y]` <TODO>

## Orchestrator Notes

- <TODO: mode + bound port; confirm `settings.json` reads off the dev profile (`~/.config/goldfinch-dev`);
  note whether the `.bdic` dict loaded (empty-suggestions = dict-not-loaded, neutral).>

## Evidence

Ephemeral (NOT committed): `/tmp/behavior-tests/goldfinch/spellcheck/<TODO ts>/` — <TODO>.

## Disposition

<TODO: on the WSLg-acceptance rows (1–3, 5 plumbing, 6) passing, flip `spellcheck.md`
`**Status**: draft → active` and set `**Last Run**`. Record Step 4 + Step 5's native-content half per-row
as INCONCLUSIVE-on-WSLg / macOS-deferred and fold them into `hat-and-alignment` — never used to keep the
spec `draft`.>
