# Leg: pressKey-modifier-chords

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

## Objective
Extend the trusted-input `pressKey` path to send **modifier chords** (e.g. `Ctrl+M`, `Ctrl+Shift+P`) so keyboard-shortcut checkpoints — which the bulk migration needs and the current surface cannot express — become drivable over the admin MCP surface without `:9222`.

## Context
- **Discovered at leg-2 (`migrate-chrome-specs-a`) design review**, recorded in the flight log Decisions (2026-06-16): `toolbar-pins` Step 6 + its Shields variant assert that an *unpinned* toolbar item keeps its keyboard shortcut (`Ctrl+M` / `Ctrl+Shift+P`). The MCP `pressKey` cannot send chords — `keyEvents()` (`src/main/automation/input.js:38-48`) accepts only `KEY_MAP` single keys + the `ShiftTab` composite, and the `pressKey` tool schema (`src/main/automation/mcp-tools.js:252-271`) has no modifier slot.
- **This is a trusted-input gap, not an eval gap.** It adds *more of the existing `sendInputEvent` mechanism* (Electron keyboard events already carry a `modifiers` array — `keyEvents` already emits `{ type, keyCode, modifiers }`, and `ShiftTab` already proves the composite path) — NOT arbitrary in-page JS. So it is distinct from the deferred `evaluate` capability (DD5) and appropriate to land in F7. **Operator decision (2026-06-16): add it as this prerequisite source leg.**
- **Sequenced first**: the migrated `toolbar-pins` spec (leg 2) references this capability; leg 8 (`verify-integration`) runs it live. Landing the capability first keeps the authored spec honest.
- **Trusted-input invariant preserved**: chords go through `webContents.sendInputEvent` (real handlers + native focus traversal), exactly like every other key/click — no new CDP attach, no `:9222`, no debugger (only `scroll` uses the debugger; this leg does not touch that boundary).

## Inputs
What exists before this leg runs:
- `src/main/automation/input.js` — `KEY_MAP` (`:22-26`), `keyEvents(name)` (`:38-50` — throws on unknown; builds `{type,keyCode,modifiers}` pairs; `ShiftTab` composite at `:40`), `pressKey = (wcId, name, deps) => actOn(wcId, keyEvents(name), deps)` (`:236`).
- `src/main/automation/engine.js:74` — `pressKey: (wcId, name) => input.pressKey(wcId, name, deps())`.
- `src/main/automation/mcp-tools.js` — `PRESS_KEY_NAMES` (`:97`), the `pressKey` tool def (`:252-271`): schema `properties: { wcId, name, key }`, `required: ['wcId']`, `anyOf: name|key`, `call: (engine, args) => engine.pressKey(args.wcId, args.name ?? args.key)`.
- `src/main/automation/mcp-server.js` — `deriveAuditDetail` `case 'pressKey'` (`~:106-109`) reads `args.name ?? args.key` for the audit log. **Args-level, not signature-coupled** — adding `modifiers` does not break it (confirmed at design review). This leg extends it to record the chord (so the audit log distinguishes `M` from `Ctrl+M`).
- Tests: `test/unit/automation-input.test.js` (keyEvents/pressKey unit coverage), `test/unit/automation-mcp-tools.test.js` (tool-schema + call wiring), `test/unit/automation-mcp-server.test.js`.
- `docs/mcp-automation.md` — the 17-tool reference (pressKey entry).

## Outputs
What exists after this leg completes:
- `keyEvents(name, modifiers)` accepts an optional modifier list and a broadened key set (single printable letters/digits as key names, so `M`/`P` resolve) while preserving the `ShiftTab` composite and the throw-on-unknown contract.
- `pressKey(wcId, name, modifiers, deps)` threads modifiers through `actOn` → `sendInputEvent`.
- `engine.js` `pressKey` wrapper forwards `modifiers`.
- The `pressKey` MCP tool schema accepts an optional `modifiers: string[]`; `call` passes `args.modifiers` through. Backward-compatible: omitting `modifiers` behaves exactly as today.
- Unit tests cover: chord event-shape (`Ctrl+M` → keyDown/keyUp with `modifiers:['control']`, keyCode `M`), multi-modifier (`Ctrl+Shift+P`), modifier alias normalization, unknown-modifier throw, single-char key resolution, and **unchanged behavior for all existing single-key / `ShiftTab` calls**.
- `docs/mcp-automation.md` pressKey entry documents the `modifiers` parameter.

## Acceptance Criteria
- [x] **AC1 (chord builder)** — `keyEvents('M', ['control'])` returns a keyDown/keyUp pair with `keyCode` resolving to `M` and `modifiers` including `control`; `keyEvents('P', ['control','shift'])` includes both modifiers. Verified by unit test.
- [x] **AC2 (modifier validation + normalization)** — Accepted modifier names are validated against an explicit allow-list (`control`, `shift`, `alt`, `meta`); common aliases (`ctrl`→`control`, `cmd`/`command`→`meta`, `option`→`alt`) normalize; an unknown modifier **throws** with a clear message (mirrors the existing unknown-key throw). Verified by unit test.
- [x] **AC3 (key set broadened safely)** — A single printable letter/digit (`M`, `P`, `1`) resolves to its Electron Accelerator keyCode for chord use; the existing `KEY_MAP` friendly names and the `ShiftTab` composite still resolve; a still-unknown name throws. Verified by unit test.
- [x] **AC4 (backward compatibility)** — Every existing `pressKey(wcId, name)` call (no modifiers) produces byte-identical events to before this leg (guaranteed by defaulting `modifiers=[]` and trying the `ShiftTab`/`KEY_MAP` branches before the new single-char branch). The existing `automation-input` / `mcp-tools` tests pass UNMODIFIED except where intentionally extended for chords. **Note (confirmed at design review):** the current suite has NO test asserting a single letter throws (existing unknown-key tests use multi-char names + the empty string, which all still throw), so the invert/rename treatment has no target here — do not fabricate or force an inversion. *If* such a test existed it would be inverted/renamed (not deleted) with the intent shift documented; the empty-string throw (`keyEvents('')`) stays throwing.
- [x] **AC5 (tool schema + wiring)** — The `pressKey` MCP tool schema exposes optional `modifiers: { type: 'array', items: enum }`; `wcId` stays required; `name`/`key` `anyOf` is unchanged; `call` forwards `args.modifiers`; `engine.pressKey` forwards modifiers to `input.pressKey`. Verified by `automation-mcp-tools` test.
- [x] **AC6 (trusted-input invariant)** — Chords go through `sendInputEvent` only (no debugger/CDP attach, no `:9222`); the `actOn` foreground-to-act path is unchanged. Confirmed by code inspection + the scroll/debugger path untouched.
- [x] **AC7 (docs)** — `docs/mcp-automation.md` pressKey entry documents `modifiers`, with a `Ctrl+M` example and the accepted modifier names.
- [x] **AC8 (audit detail)** — `deriveAuditDetail` records the chord (e.g. `key=M+control`) so the audit log distinguishes a bare key from a chord; covered by a unit test. Bare-key calls keep their existing audit string.
- [x] **AC9 (gates green)** — `npm test` + `npm run typecheck` + `npm run lint` all pass.

## Verification Steps
- AC1–AC4: `npm test` (the extended `automation-input.test.js` cases); inspect `keyEvents` for the merged modifiers + single-char keyCode resolution + alias normalization + throw paths.
- AC5: `npm test` (the `automation-mcp-tools.test.js` schema/call cases); inspect the tool def + `engine.js:74` wrapper.
- AC6: inspect — `pressKey`/`actOn` use `sendInputEvent`; `grep -n "debugger\|9222\|withDebuggerSession" src/main/automation/input.js` shows only the pre-existing `scroll` path.
- AC7: read the pressKey section of `docs/mcp-automation.md`.
- AC8: `npm test && npm run typecheck && npm run lint` (project fail-fast timeout).

## Implementation Guidance
1. **`keyEvents(name, modifiers = [])`** (`input.js`):
   - Resolve the keyCode: `ShiftTab` composite first (unchanged), then `KEY_MAP[name]`, then — new — a single printable char (`/^[a-z0-9]$/i`) → its uppercase Electron keyCode (letters use uppercase; digits as-is). Still-unresolved → throw the existing-style error (now also listing that a single letter/digit is accepted).
   - Build the modifier list: normalize each via an alias map → validate against `{control, shift, alt, meta}` → throw on unknown. Merge with the composite's intrinsic modifier (e.g. `ShiftTab` keeps `shift` even if no `modifiers` passed). De-dupe.
   - Return the same `[{type:'keyDown',keyCode,modifiers},{type:'keyUp',keyCode,modifiers}]` shape.
2. **`pressKey(wcId, name, modifiers, deps)`** (`input.js:236`): `actOn(wcId, keyEvents(name, modifiers), deps)`. Keep the arrow-fn shape; add the param.
3. **`engine.js:74`**: `pressKey: (wcId, name, modifiers) => input.pressKey(wcId, name, modifiers, deps())`.
4. **`mcp-tools.js` pressKey tool** (`:252-271`): add `modifiers: { type:'array', items:{ type:'string', enum:['control','shift','alt','meta'] }, description:'optional modifier keys held during the press (e.g. ["control"] for Ctrl+M)' }` to `properties` — **the MCP enum advertises only the canonical four** (clean public contract); leave `required`/`anyOf` as-is; `call: (engine, args) => engine.pressKey(args.wcId, args.name ?? args.key, args.modifiers)`. Update the tool `description` + `PRESS_KEY_NAMES` doc text to mention chords. (The `keyEvents` layer still normalizes aliases `ctrl`/`cmd`/`command`/`option` defensively if a caller passes them, but the tool schema does not advertise them — operator decision at design review, Q1.)
5. **Audit detail** (`mcp-server.js` `deriveAuditDetail` `case 'pressKey'`, `~:106-109`): include the modifiers in the audit string (e.g. `key=M+control` / `key=P+control+shift`) so the audit log distinguishes a bare key from a chord. Keep the format consistent with the existing detail style; this is args-level (reads `args.modifiers`), no signature change.
6. **Tests**: extend `automation-input.test.js` (AC1–AC4 cases) and `automation-mcp-tools.test.js` (AC5); add/extend the `mcp-server` audit-detail coverage for the chord string (whichever test file owns `deriveAuditDetail`). Follow each file's existing assertion style. Per AC4, do NOT fabricate a single-char-throws inversion — the current suite has no such test.
7. **Docs**: add the `modifiers` param + a `Ctrl+M` example to the pressKey entry in `docs/mcp-automation.md`.

## Edge Cases
- **`ShiftTab` + explicit `modifiers`**: don't double-apply or drop `shift`; the composite's `shift` and any passed modifiers merge + de-dupe.
- **Unknown modifier**: throw (don't silently drop) — a silently-ignored modifier would make a chord checkpoint false-pass.
- **Case sensitivity**: friendly `KEY_MAP` names stay case-sensitive as today; the new single-char path is case-insensitive on input but resolves to the canonical (uppercase-letter) keyCode.
- **No modifiers passed**: must be byte-identical to current behavior (AC4) — guard the merge so an empty list yields the same `modifiers:[]` as before.
- **Electron modifier vocabulary (rationale corrected at design review)**: Electron `^42` `sendInputEvent` `modifiers` natively accepts BOTH forms (`control`/`ctrl`, `meta`/`cmd`/`command`, `alt`, `shift` — confirmed in `node_modules/electron/electron.d.ts` `InputEvent.modifiers`). So normalizing to the canonical `{control, shift, alt, meta}` is **our own choice** (one internal vocabulary + explicit typo rejection), NOT an Electron requirement. Do not "fix" `ctrl` thinking Electron rejects it — it doesn't; we normalize for cleanliness and validation.

## Files Affected
- `src/main/automation/input.js` — `keyEvents` (modifiers + single-char keys), `pressKey` signature.
- `src/main/automation/engine.js` — `pressKey` wrapper forwards modifiers.
- `src/main/automation/mcp-tools.js` — `pressKey` tool schema + `call` + `PRESS_KEY_NAMES`/description.
- `src/main/automation/mcp-server.js` — `deriveAuditDetail` `case 'pressKey'` records the chord (`key=M+control`).
- `test/unit/automation-input.test.js` — chord/alias/single-char/backward-compat cases.
- `test/unit/automation-mcp-tools.test.js` — schema + call-wiring cases.
- `test/unit/` audit-detail coverage (the file owning `deriveAuditDetail` — e.g. `automation-mcp-server.test.js`/`automation-audit-log.test.js`) — chord audit-string case.
- `docs/mcp-automation.md` — pressKey `modifiers` documentation.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `npm test`/typecheck/lint green
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg (committed with the Phase-2d review block)

## Citation Audit
Verified against current code at leg design time (2026-06-16): `input.js:22-26` (`KEY_MAP`), `:38-50` (`keyEvents`, throws, `ShiftTab` composite at `:40`), `:236` (`pressKey` arrow), `:69-77` (`mouseClickEvents`, sendInputEvent-based), `scroll` (`:205-227`, the only debugger path); `engine.js:74` (`pressKey` wrapper); `mcp-tools.js:97` (`PRESS_KEY_NAMES`), `:252-271` (pressKey tool def: schema/`required`/`anyOf`/`call`). Test files confirmed present: `test/unit/automation-input.test.js`, `automation-mcp-tools.test.js`, `automation-mcp-server.test.js`. Scripts confirmed: `package.json` `test`/`typecheck`/`lint`. All OK.
