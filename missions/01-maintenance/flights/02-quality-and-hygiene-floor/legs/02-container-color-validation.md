# Leg: container-color-validation

**Status**: completed
**Flight**: [Quality & Hygiene Floor](../flight.md)

## Objective
Close the container-`color` HTML-attribute injection sink (mission Known Issue): validate `color` to an injection-safe format wherever a container is built, so a tampered `containers.json` (or a compromised renderer calling `jars-add`) cannot break out of `style="background:${c.color}"` in the chrome.

## Context
- Mission Known Issue (Flight 1 debrief). `validateContainers` (`jars.js:21-56`) coerces `color` to *any* string at `jars.js:43` (`typeof color === 'string' ? color : '#b06ef5'`); `add(name, color)` (`jars.js:80-89`) takes a renderer-supplied color at `jars.js:85` (`color: color || '#b06ef5'`). Both flow unescaped into the chrome at `renderer.js:76, 127, 883` (`style="background:${c.color}"`), while `name` is `escapeHtml`'d. A value like `#000"><img src=x onerror=…>` breaks out of the attribute into HTML in the privileged renderer.
- Threat tier: same as F7 — requires local file tamper or a compromised renderer (second-order). An incomplete fix from Flight 1.
- Test infra (Leg 1): shared `test/helpers/electron-stub.js` + `test/unit/jars.test.js` already require it; `node --test` runner scoped to `test/unit/`.

## Inputs
- `src/main/jars.js` — `validateContainers` (`:21-56`), `add` (`:80-89`), `module.exports` (`:91`).
- `test/unit/jars.test.js` — existing validateContainers suite (uses the shared stub).

## Outputs
- `src/main/jars.js` — add an exported pure `isSafeColor(color)`; use it in **both** `validateContainers` (replace `:43` coercion) and `add` (`:85`); fall back to `'#b06ef5'` when unsafe.
- `test/unit/jars.test.js` — add `isSafeColor` + color-validation cases.

## Acceptance Criteria
- [ ] `isSafeColor(color)` returns **true** only for: a hex color `/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/`, **or** a letters-only CSS color keyword `/^[a-zA-Z]{1,20}$/`. Returns **false** for non-strings and any value containing `(`, `;`, `"`, `'`, `<`, `>`, whitespace, or other punctuation (these are the injection-bearing characters). Exported from `jars.js`.
- [ ] `validateContainers` sets `color` to `entry.color` when `isSafeColor(entry.color)`, else `'#b06ef5'` (the default). No kept container can carry an unsafe color.
- [ ] `add(name, color)` sets `color` to the supplied `color` when `isSafeColor(color)`, else `'#b06ef5'`. (Closes the `jars-add` IPC path too.)
- [ ] All existing `DEFAULTS` colors (`#9aa0ac`, `#4caf50`, `#2196f3`, `#f5c518`) and `add`'s `#b06ef5` pass `isSafeColor` — no legitimate container is altered.
- [ ] `test/unit/jars.test.js` covers: `isSafeColor` **accepts** `#9aa0ac`, `#abc` (3), `#abcd` (4), `#11223344` (8), `red`, `RebeccaPurple`; **rejects** `url(x)`, `red;`, `#000"><img>`, `red"`, `rgb(0,0,0)` (parens), `#12` (2), `#1234567` (7), `#xyz`, `''`, `'  red'`, `123`/non-string, `'a b'`. And: `validateContainers` with an entry whose `color` is an injection payload → that container's `color` becomes `'#b06ef5'` (other fields preserved, container still kept). Confirm no existing color test asserts a non-conforming string is kept.
- [ ] `npm test` passes (count grows; jars suite green).
- [ ] The mission Known Issue checkbox is ticked in `mission.md` (Known Issues section).

## Verification Steps
- `npm test` → exits 0; new `isSafeColor`/color cases pass.
- `grep -n "isSafeColor" src/main/jars.js` → defined, used in `validateContainers` AND `add`, exported.
- Read `jars.js:43` + `:85` to confirm both now route through `isSafeColor`.

## Implementation Guidance
1. **`isSafeColor(color)`** (pure, top of `jars.js`):
   ```js
   const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
   const KEYWORD = /^[a-zA-Z]{1,20}$/;
   function isSafeColor(c) { return typeof c === 'string' && (HEX.test(c) || KEYWORD.test(c)); }
   ```
   Rationale: hex covers all real data; the letters-only keyword branch accepts any CSS color name (`red`, `rebeccapurple`) without enumerating 148 names, and **cannot contain injection characters** (`(`, `;`, `"`, `<`, space all excluded). `rgb()/hsl()` function-colors are intentionally rejected (renderer uses hex) — they fall back to the default harmlessly.
2. **`validateContainers`**: replace `color: typeof color === 'string' ? color : '#b06ef5'` (`:43`) with `color: isSafeColor(color) ? color : '#b06ef5'`.
3. **`add`**: replace `color: color || '#b06ef5'` (`:85`) with `color: isSafeColor(color) ? color : '#b06ef5'`.
4. **Export** `isSafeColor` in `module.exports`.
5. **Tests**: extend `test/unit/jars.test.js` (stub already required) with the AC cases. Also **rename the existing `'string color is kept as-is'` test (`jars.test.js:254`)** to `'valid hex color string is kept'` — it uses `#ff0000` (still passes), but the old name documents the removed any-string behavior and is a regression trap.
6. **Tick the mission Known Issue**: in `missions/01-maintenance/mission.md`, check the `[ ]` container-`color` Known Issue → `[x]` with a one-line "fixed in Flight 2 / leg container-color-validation".

## Out of Scope (considered, not changed)
- **Renderer-constructed containers with hardcoded colors**: `DEFAULT_CONTAINER` (`renderer.js:61`, `#9aa0ac`) and `makeBurner()` (`renderer.js:67`, `#ff8c42`) build container objects in renderer-only code and feed the same three sinks. Both are **hardcoded string literals** that pass `isSafeColor`, so there is no injection today. They are intentionally out of this leg's scope (no user/IPC input reaches them). **Flag for the future**: if either ever takes a dynamic color (user input / IPC), it would bypass the `jars.js` validation this leg adds — at that point the renderer should gate via `isSafeColor` (or, better, escape at the sink). Noted, not fixed.

## Edge Cases
- **3/4/6/8 hex only**: `#12` (2), `#12345` (5), `#1234567` (7) → rejected. All real colors are 3/6/8.
- **Keyword length cap (20)**: prevents an absurd letters-only string; real keywords ≤ ~20 chars (`lightgoldenrodyellow` = 20).
- **`rgb(...)`/`hsl(...)`**: rejected (parens) → default fallback. Acceptable; the UI emits hex.
- **Non-string** (`null`, number, object): rejected → default.
- **`add`'s `color` is optional**: when omitted (`undefined`), `isSafeColor(undefined)` is false → `'#b06ef5'` (same as the old `|| '#b06ef5'` default). No behavior change for the no-color call.

## Files Affected
- `src/main/jars.js` — `isSafeColor` + use in `validateContainers`/`add` + export
- `test/unit/jars.test.js` — color-validation cases
- `missions/01-maintenance/mission.md` — tick the container-`color` Known Issue

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 2 of 6)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
