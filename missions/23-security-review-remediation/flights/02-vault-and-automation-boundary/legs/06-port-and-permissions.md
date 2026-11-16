# Leg: port-and-permissions

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

Show the operator when the automation server is not on its configured port, and deny permissions by default on the internal session and for `window-management`.

## Context

- Flight DD5 (the port bullet) and DD8. Mission finding 17a, guard-audit NF2, NF5, NF6, P4. Split from `automation-bounds` at its design review: no source file in common.
- **Port — what exists** (design review, 2026-11-14): in `src/main/automation/mcp-server.js`, `preferred` is the configured port (not exposed) and `boundPort` starts equal to it and is set on bind, so "not listening" cannot be read from `boundPort` alone. `main.js` holds `mcpStatus` and `currentAutomationStatus()`, which returns one `port`. The automation page **already shows the bound port** ("Connected — listening on 127.0.0.1:<port>"; `automation.js`, fed by `automation:get-status`), and `recomputePortNote` compares the typed value with it. What is missing is the plain statement that the configured port was in use. The chrome's indicator is drawn by `src/renderer/chrome/privacy-controller.js` from the pure `src/shared/automation-indicator-model.js`, fed by `automation:get-activity` (`{ sessions, log }`). `renderer.js` is not involved.
- **The activity broadcast fires only from the audit log's `onChange`** (session open, session close, a recorded call). A bind, a fallback or a re-bind fires nothing today, and a re-bind constructs a new server instance. So a port carried on the activity snapshot would be stale until the next tool call unless a broadcast is added after `start()`.
- Operator ruling: keep the fallback, show it.
- **Permissions — what exists**: `src/main/session-runtime.js` — web sessions share one positive allowlist `ALLOWED_PERMISSIONS` between the request and check handlers (the one-shared-set shape is pinned; do not split it); `onSessionCreated`'s internal branch sets the marker and returns, so the internal session has **no** handler and Electron grants by default; `window-management` is on the allowlist and nothing in `src/` uses it. There is no `setDisplayMediaRequestHandler`; `display-capture` is not allowlisted.
- **Internal pages' own permission use** (design review): one — `navigator.clipboard.writeText` in `automation.js` `copyText`, which catches a throw or rejection and falls back to the bridge's `clipboardWrite`. No fullscreen, notifications, geolocation or media use under `src/renderer/pages/`.
- Not this leg's: that fallback sends no `{ secret: true }`, so the show-once key copy on the automation page never auto-clears — carried to leg `vault-lifecycle`, which owns the clipboard helper.
- The chrome view and the overlay views (sheet, find, save prompt) are not the internal session; whether they have permission handlers is checked in step 1 and reported, not changed, unless it is the same two lines.
- Budgets: do not touch `src/renderer/renderer.js`; the evaluate seam is closed (41).

## Inputs

- Legs 01–05 landed (uncommitted).
- Files named above; `test/unit/session-runtime.test.js` — "internal-session creation marks and refuses every web-session wiring" (its fake session records the two handlers) and the allowlist sample that includes `window-management`; `test/unit/automation-indicator-model.test.js`.

## Acceptance Criteria

**Measurements first (the tree as of leg `automation-bounds`, before any edit of this leg; scratch profile; output in the scratchpad, summary in the flight log)**

- [ ] **AC1 — Q4.** (a) On a web tab over loopback, `navigator.mediaDevices.getDisplayMedia()`: the promise's outcome and whether any picker appears. (b) A script opening popups in a loop, once inside a click handler (driven by an automation `click`) and once with no user activation: how many windows result (`enumerateWindows`). (c) On an internal page (admin `evaluate`): `navigator.permissions.query` for `notifications`, `geolocation`, `camera`, and `Notification.requestPermission()` — what the missing handler grants today. (d) Which session the chrome view and the three overlay views use and whether any permission handler covers them.
- [ ] **AC2 — Port, pre-change.** With a throwaway listener holding the configured port before launch: what the automation page and the indicator's tooltip say today.

**Port**

- [ ] **AC3 — Configured and bound are both known, and "not listening" is distinct.** The server exposes the configured port and whether it is listening; `currentAutomationStatus()` gains `configuredPort`; `getActivity()`'s reply gains `port: { configured, bound }` with `bound: null` when not listening. When automation is off the activity reply carries no port — "not known".
- [ ] **AC4 — Never stale.** After every `start()` — first bind, fallback, re-bind (on the **new** instance, after its `start()` resolves, not in its constructor) — and after a failed bind, the activity snapshot is broadcast. Unit: a re-bind to another port reaches the chrome-side snapshot with no tool call in between.
- [ ] **AC5 — Shown in the chrome.** `automation-indicator-model.js` projects `portMoved` and a line ("Listening on 49708 — 49707 was in use") when configured and bound differ; `privacy-controller.js` puts it in the indicator's tooltip. The model never throws on a snapshot with no `port` and shows no note for it. The indicator is hidden when no key is enabled — the note is then visible only on the automation page; that is intended and stated. Pure-model tests: not listening, equal, different, absent.
- [ ] **AC6 — Shown on the automation page**, beside the port field, from `automation:get-status`'s new `configuredPort` (not from the activity snapshot). Existing "Connected — listening on …" text and `recomputePortNote` keep working; patch in place. Page-controller test against the mock DOM.
- [ ] **AC7 — Docs state the limit.** `docs/mcp-automation.md`: the fallback remains; a local program can take the configured port first and receive whatever a client sends there; both surfaces show when the port moved; the only strict-port options that exist are the environment pin on an unpackaged build and an explicit port in tests — a packaged build has none. Say exactly that.

**Permissions**

- [ ] **AC8 — The internal session denies everything.** In `onSessionCreated`'s internal branch both handlers are installed and answer false for every permission; no `privacy-permission` message is sent for it. The web handlers and `ALLOWED_PERMISSIONS` are untouched apart from AC9. The existing test "internal-session creation marks and refuses every web-session wiring" is updated: the internal session now gets exactly these two handlers and no other web-session wiring. Unit: both deny an allowlisted name and an invented one. **Global-hook rule**: a new session-wide handler — the premise it could change is that every internal page still boots and works; AC11 proves it live.
- [ ] **AC9 — `window-management` is not granted.** Removed from `ALLOWED_PERMISSIONS`; the allowlist sample in `session-runtime.test.js` drops it and a case asserts it is denied by both handlers.
- [ ] **AC10 — Q4 disposed.** For each AC1 result: fixed here if it is a few lines in `session-runtime.js` or `guest-wiring.js` (an explicit display-media handler that denies; a cap on the popups one tab may hold open) with a unit test; otherwise described in the flight log for the Flight Director to log as a squawk. "Already denied" is a valid, recorded outcome. AC1(d): report only.

**Live and docs**

- [ ] **AC11 — Live, on the changed build** (scratch profile): AC2 repeated — both surfaces now say the port moved (read the indicator's `title` through admin `evaluate` on the chrome; read the automation page's line through `readDom`); a re-bind from the automation page updates both without any other call; all five internal pages boot and one action on each works (a settings toggle, the downloads list, the jars list, the vault state, the automation key list); the automation page's Copy puts the text on the clipboard — **observe which path ran** (the direct write succeeding, rejecting into the fallback, or resolving silently without writing, which would be a defect to fix here); AC1(a)–(c) re-measured; every apparatus primitive still works. Do not call gated bridge methods with an admin key attached except where a dialog is the thing under test — none is here.
- [ ] **AC12 — Docs.** `CLAUDE.md`: the permission sentence (internal session denies everything; `window-management` removed) and the indicator paragraph (port note). `docs/mcp-automation.md` per AC7.
- [ ] **AC13 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass.

## Verification Steps

- AC1, AC2, AC11: script output in the flight log.
- AC3–AC6: server / status tests, `automation-indicator-model.test.js`, the automation page's controller test.
- AC8–AC10: `test/unit/session-runtime.test.js` (and `guest-wiring.test.js` if a popup cap lands).
- AC7, AC12: read by the Flight Director.

## Implementation Guidance

1. AC1 and AC2 before any edit; report what is measured even where it contradicts this leg.
2. Port: server getters → status and activity shapes → broadcast after `start()` → model → controller tooltip → page line.
3. Permissions: factor the handler install so the internal branch can install its deny-all pair without touching the web path; then `window-management`.
4. Q4 disposal. Live smoke. Docs.
5. Do not commit. Leg `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **A snapshot with no `port`** reaching an already-open chrome: "not known", no note, no throw.
- **Automation switched off while the port had moved**: the note disappears with the listener.
- **The configured port becomes free and the operator re-binds to it**: the note clears on that broadcast.
- **The internal session is created more than once** (it should not be): the install is idempotent.
- **An internal page turns out to need a permission**: stop and report `[BLOCKED:internal-permission-<name>]` — do not allowlist it on your own.
- **A site that used `window-management`** loses multi-screen placement silently, like any permission not on the list. Accepted in flight DD8.
- **Anything needing a design call**: `[BLOCKED:<reason>]`.

## Files Affected

- `src/main/automation/mcp-server.js` (getters only — leg `automation-bounds` has just edited this file; keep its changes), `src/main/main.js` (status, broadcast after start), `src/main/register-settings-ipc.js` if the activity payload is shaped there; `src/shared/automation-indicator-model.js`, `src/renderer/chrome/privacy-controller.js`, `src/renderer/pages/automation.js`; `src/main/session-runtime.js`, possibly `src/main/guest-wiring.js`.
- Unit tests for each; `docs/mcp-automation.md`, `CLAUDE.md`.

## Citation Audit

From the design review of `automation-bounds` (Sonnet, 2026-11-14), which read these for this purpose: `mcp-server.js` `preferred` / `boundPort` and `start()`; `main.js` `mcpStatus`, `currentAutomationStatus`, the re-bind path; `audit-log.js` `onChange` as the only broadcast trigger; `register-settings-ipc.js` `automation:get-activity` (returns `{ sessions: [], log: [] }` when there is no server); `automation.js` connected line, `recomputePortNote`, `copyText`; `automation-indicator-model.js` inputs; `privacy-controller.js` builds the model input and sets the tooltip; `session-runtime.js` allowlist, handlers, internal branch; the two `session-runtime.test.js` sites. Tier: **high** (permission policy; a session-wide hook). No separate design-review pass was run for this file: its content is the reviewed half of `automation-bounds`, with that review's corrections applied.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
