# Leg: carry-forwards-and-webview-sweep

**Status**: landed
**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](../flight.md)

## Objective
Fold the Flight-5 debrief carry-forwards + the Leg-1 spec-drift + the parked `<webview>` terminology sweep, and
verify SC1 source-absence — so the v0.6.0 release ships clean.

## Scope
1. **`nav.js` hardening (DD6 — the one real code change).** Add an op-local `isInternalContents` post-resolve
   guard to **all four** `nav.js` ops (`navigate`/`goBack`/`goForward`/`reload`), mirroring `zoom`/`find`/`print`.
   **Acceptance-critical (Architect [high]):** the existing `test/unit/automation-nav.test.js` internal-refusal
   cases pass `deps` WITHOUT `allowInternal`, so they only exercise `resolveContents`'s pre-existing throw — NOT
   the admin path. **New unit tests MUST assert refusal with `allowInternal:true` explicitly** for each op.
2. **Doc reconciliations:**
   - Page-context Escape target: CLAUDE.md page-context prose says "address bar"; the spec + observed behavior say
     `#kebab`. Align CLAUDE.md to the observed `#kebab`.
   - `mcp-drive-end-to-end.md` Preconditions: mention the admin key that Step 9 (`getChromeTarget`/`captureWindow`,
     admin-only) needs — currently framed jar-only.
   - **From Leg 1:** `settings-shell` step 10 — "Site settings" opens `goldfinch://settings/#privacy` (F7 rewire),
     not a slide-out panel; update the spec text. `settings-shell` step 11 — the internal-tab nav-lock is now a
     **read-only address bar** (`readOnly=true` on internal, editable on web); the "type a web URL → new tab"
     affordance no longer applies. Update the spec to the read-only-address invariant (FD-accepted as intended).
3. **`<webview>`→WebContentsView terminology sweep (DD5):** the ~15 behavior specs' prose + `src/preload/webview-preload.js`
   header + any residual source comments. **Prose/comments ONLY** — do NOT change functional spec steps or code
   logic (zero functional dependency; the corpus drives by `wcId`).
4. **SC1 source-absence (DD10):** verify absence of the **functional** forms — a constructed `<webview>` element,
   a `webviewTag:` webPreferences key, a `will-attach-webview` registration — in the tab/guest path. **Whitelist**
   the legitimate residuals: `src/preload/webview-preload.js` filename, the `#webviews` DOM slot id, historical
   comments stating the machinery was removed. Record the grep + expected residuals in the flight log.

## Acceptance Criteria
- [x] `nav.js`: all 4 ops guard internal even under `allowInternal:true`; **new unit tests assert `allowInternal:true` refusal per op**.
- [x] Doc reconciliations applied (page-context Escape; mcp-drive Preconditions; settings-shell 10/11).
- [x] `<webview>` terminology sweep complete (specs prose + `webview-preload.js` header + source comments); no functional changes.
- [x] SC1 source-absence verified per DD10 + whitelist; result recorded in the flight log.
- [x] `npm test` (all pass — new nav tests included) / `npm run typecheck` / `npm run lint` green.

## Files Affected
- `src/main/automation/nav.js` + `test/unit/automation-nav.test.js`; `CLAUDE.md`; `tests/behavior/{page-context-menu,mcp-drive-end-to-end,settings-shell}.md` + the ~15 `<webview>`-prose specs; `src/preload/webview-preload.js` (header) + residual source comments.

---

## Post-Completion Checklist
- [x] All acceptance criteria met; test/typecheck/lint green
- [x] Flight log updated (SC1 grep result; nav.js approach; sweep scope)
- [x] Leg status → `landed` (no commit — batch-commit at flight end); check off in flight.md
- [x] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
