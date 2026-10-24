# Squawk 0162: Typing freezes the tab on pages with many form-less text inputs

**Status**: completed
**Type**: defect
**Severity**: grounding
**Reported**: 2026-10-24
**Completed**: 2026-10-24

## Report
GitHub issue #270. On a page with many text-like inputs that are NOT inside a `<form>`, each trusted keystroke blocks the tab, and the cost grows superlinearly with the field count. 54 label-wrapped `<input type="text">` fields take about 9.4 s per keystroke. The issue's real-world trigger was a single-page app (the-one's agent editor) with no `<form>` element, which froze for 0.5–1.3 s per edit. Script-dispatched events are unaffected because the observer short-circuits on `isTrusted`.

Repro: on any http(s) tab, build N label-wrapped text inputs directly under `<body>`, focus the first one, and type. Measure `beforeinput` → document-capture `input` (recipe in the issue body).

## Evidence
- Live repro (`dev:automation` + MCP `typeText`, 2026-10-24), time per keystroke: 1 field 1–3 ms · 12 → 33–59 ms · 24 → 378–446 ms · 36 → 1,951 ms · 54 → 9,426 ms (about n⁴). Control, 54 `type=number` fields + 1 text field: 12 ms. The same 24 / 54 text fields inside one `<form>`: 4 ms / 9–11 ms.
- Attribution: a window-capture `input` timestamp versus the page's document-capture `input` timestamp puts all of the cost in between, where the isolated-world observer's document-capture listener runs. Chromium's own insertion (`beforeinput` → window-capture `input`) is about 1 ms.
- `src/preload/vault-entry-observer.js:handleFieldEvent` runs `detect()`, then `emit()` → `snapshot()` → `detect()` again, on both `keydown` and `input`. That is four full detections per real keystroke.
- `src/preload/vault-identity-fields.js:findAllIdentityFields` keeps the document scope open after a miss ("the document scope is left open on a miss"), so it re-runs `identityEntryForScope(doc, doc)` for every form-less candidate. That's n passes, and the result never depends on which field triggered the pass. Each pass's `candidateFields` calls `isClaimedByCard` → `findAllCardFields(doc)` (plus `isClaimedByLogin` → `findAllLoginFields(doc)`) once per field. That's another n.
- `src/preload/vault-card-fields.js:findAllCardFields` likewise re-runs `rolesIn(doc)` for every form-less candidate ("the document scope stays unmarked so a later form-less number can still match"), so it is n² on its own. Net cost per detection: about n⁴.
- Repro scripts (local only): `/tmp/claude-1000/-home-cprch-projects-goldfinch/e30d33d4-47e8-4e42-a02f-ce79daf79b78/scratchpad/repro/{repro,attr}.mjs`.

## Corrective Action
Identity detection now computes the login/card claimed-node Set once per `findAllIdentityFields` call (`claimedNodes(doc)`), threaded as a private optional parameter through `candidateFields`/`resolveScope`/`identityEntryForScope`, instead of re-running `findAllLoginFields`/`findAllCardFields` once per field per scope. Both `findAllIdentityFields` and `findAllCardFields` now mark the document scope visited on a miss as well as form scopes: a scope's result depends only on (scope, doc), never on the field that reached it, so the re-walks could not change the answer. The observer's `handleFieldEvent` passes the entries it just detected to `emit` -> `snapshot(entries = detect())`, after the `isTrusted` short-circuit, so one keystroke handler does one detection. Exports and signatures are unchanged (`isClaimedByLogin`/`isClaimedByCard` untouched). Chosen over caching across calls because that would need invalidation on DOM mutation; this is stateless and result-identical.

## Verification
- Unit: `npm test` 6047 pass / 0 fail; `npm run lint`, `npm run typecheck`, `npm run format:check` clean. Tests added to `test/unit/vault-identity-fields.test.js` and `vault-card-fields.test.js`:
  - equivalence: late form-less anchor, no anchor, mixed form + form-less, login- and card-claimed exclusion;
  - work counts: document-query counts the same at 6 and 60 fields, the same with 1 and 10 forms, and the card document scope evaluated once.
  The three work-count pins fail on the pre-fix source; the equivalence tests pass on both.
- Live (`dev:automation`, MCP `typeText`, 5 keystrokes each, after the fix; ms per keystroke `beforeinput` → document-capture `input`, observer share in parentheses):
  - form-less text: 1 field 0.2–0.7 (0.1–0.3) · 24 → 0.5–0.9 (0.3–0.6) · 54 → 0.8–1.3 (0.5–0.8), previously 9,426 · 216 → 1.9–2.8 (1.1–1.8) · 1,000 → 6.9–8.2 (4.4–4.9) · 4,000 → 32.5–34.0 (19.6–20.5);
  - controls: 54 number + 1 text 0.4–0.9; 54 text in a `<form>` 0.5–1.1.
  From 1,000 to 4,000 fields the observer share grows 4.3× for 4× the fields, so it is now linear.
- Not pinned: no observer-level unit test asserts one `detect()` per trusted event (Reviewer non-blocking note; accepted — the live numbers cover it, and the two detector fixes carry the complexity win).

## Sign-Off
**Reviewer**: independent Reviewer agent (leg-execution crew, Sonnet)
**Verdict**: confirmed
**Commit**: the `squawk/0162` commit on `squawk/0162-form-less-text-inputs-superlinear-keystroke-cost`
