# Leg: activity-indicator-and-audit-viewer

**Status**: completed
**Flight**: [Settings key management + automation UI](../flight.md)

## Objective
Render the visible half of SC10: an always-visible chrome toolbar indicator that lights when ≥1 automation session is attached (distinguishing an admin session from a jar session and naming the jar), plus a detailed audit-log viewer in the settings page — both consuming the Flight-4 `automation-activity-changed` broadcast on the data contract that already ships.

## Context
- **DD6**: both surfaces. (1) An always-visible **chrome toolbar indicator** (SC10 requires the operator can *see* a session is active without opening settings) — add an `onAutomationActivity` listener to `chrome-preload.js` + a small toolbar status light that lights when ≥1 session is attached. (2) A detailed **audit-log viewer in the settings page** via `onAutomationActivity` on the internal bridge. Both **distinguish admin vs jar and name the jar**.
- Indicator copy reflects **transport lifecycle, not auth-liveness** — phrase it "connected", not "authorized" (a revoked session lingers until its transport closes; DD5/DD6).
- **SC10 data layer + the `automation-activity-changed` broadcast landed in Flight 4.** This leg renders it. The broadcast already fans out to the chrome renderer AND internal guests via `broadcastToChromeAndInternal`.
- The audit contract (from `src/main/automation/audit-log.js`): the broadcast payload and `mcpServer.getActivity()` both return `{ sessions, log }` where:
  - `sessions`: `[{ sessionId, identity, kind: 'admin'|'jar', jarId: string|null, since: number }]`
  - `log`: `[{ ts, sessionId, identity, op, targetWcId, outcome: 'ok'|'error', errorCode: string|null }]` (bounded ring, newest last, cap 500)

## Inputs
What exists before this leg runs:
- `src/main/automation/mcp-server.js` — `getActivity()` returns `auditLog.snapshot()` = `{ sessions, log }`. The server is `mcpServer` in `main.js` (null when the surface isn't active).
- `src/main/main.js` — `broadcast: (payload) => broadcastToChromeAndInternal('automation-activity-changed', payload)` is wired into `createMcpServer`; `broadcastToChromeAndInternal` fans to chrome + internal sessions. The leg-1 `automation:get-status` + leg-3 key IPCs are present. No `automation:get-activity` handler yet.
- `src/preload/chrome-preload.js` — `window.goldfinch` exposes `onSettingsChanged`/`onShieldsChanged`/`onPrivacyNet` (raw `ipcRenderer.on` pattern) + invoke getters like `shieldsGet`/`settingsGet`. **No** `onAutomationActivity` / activity getter yet.
- `src/preload/internal-preload.js` — `window.goldfinchInternal` with the `on`/`off` handle registry and leg-2/3 automation methods. **No** `onAutomationActivity` yet (deliberately deferred from leg 2).
- `src/renderer/index.html` — `#toolbar` (lines ~49–83): `#toggle-media`, `#toggle-privacy` (the `.icon-btn` + `.tb-glyph` + `.tb-badge` precedent), `#kebab`. Insertion point for the indicator is between `#toggle-privacy` and `#kebab`.
- `src/renderer/renderer.js` — the `els` ref object; the shields-button live-update precedent (`shieldsGet()` initial + `onShieldsChanged` live → `renderPrivacy`); `applyToolbarPins`; the `containers` jars array (`{id,name,color,partition}`) for jarId→name mapping.
- `src/renderer/styles.css` — `#toolbar`, `.icon-btn`, `.tb-glyph`, `.tb-badge`, `#toggle-privacy.alert` (state-driven styling precedent), `.hidden`, the color tokens (`--accent` gold, `--fg-dim`, etc.).
- `src/renderer/pages/settings.{html,js,css}` — the leg-2/3 `<section id="automation">`; the internal-bridge subscribe/`pagehide`-cleanup pattern (`onSettingsChanged`/`offSettingsChanged`).
- `src/renderer/renderer-globals.d.ts` — the `window.goldfinch` and `GoldfinchInternalBridge` type contracts.

## Outputs
- `automation:get-activity` bare IPC handler in `main.js` (read-only snapshot).
- `chrome-preload.js`: `automationGetActivity()` + `onAutomationActivity(cb)`.
- `internal-preload.js`: `automationGetActivity()` + `onAutomationActivity(cb)`/`offAutomationActivity(h)` (+ d.ts).
- A toolbar indicator `#automation-indicator` in `index.html` + its renderer controller + CSS.
- An audit-log viewer in `<section id="automation">` (settings) + its controller + CSS.

## Acceptance Criteria
- [ ] **AC1** — `main.js` registers a read-only `automation:get-activity` handler returning `mcpServer ? mcpServer.getActivity() : { sessions: [], log: [] }`. (Bare `ipcMain.handle`, consistent with the chrome-trusted `settings-get`/`shields-get` reads; the data is non-secret operator-facing audit state, reachable only through the chrome/internal preloads, never a web page. **Add a code comment** mirroring the `settings-get` bare-rationale so a future reader doesn't "fix" it by wrapping it in `registerInternalHandler` — which would silently break the chrome indicator, since the chrome's `file://` origin fails the internal-origin check. The sibling `automation:*` handlers ARE origin-checked because only the settings page calls them; this one is deliberately the exception because the chrome also reads it. If lint/a test asserts all `automation:*` channels are origin-checked, reconcile it — confirmed by AC8's lint/test-green gate.)
- [ ] **AC2** — `chrome-preload.js` exposes on `window.goldfinch`: `automationGetActivity: () => ipcRenderer.invoke('automation:get-activity')` and `onAutomationActivity: (cb) => ipcRenderer.on('automation-activity-changed', (_e, d) => cb(d))` (raw pattern, matching `onShieldsChanged`). The `window.goldfinch` type in `renderer-globals.d.ts` is updated.
- [ ] **AC3** — `internal-preload.js` exposes `automationGetActivity()` (invoke) + `onAutomationActivity(cb)`/`offAutomationActivity(h)` (via the existing `on`/`off` handle registry, matching `onSettingsChanged`/`offSettingsChanged`). The `GoldfinchInternalBridge` type is updated.
- [ ] **AC4** — `index.html` gains a `#automation-indicator` `.icon-btn` (with a `.tb-glyph` and/or a small dot) in `#toolbar` between `#toggle-privacy` and `#kebab`, `hidden` by default. It is NOT a pinnable item (no `toolbarPins` gating).
- [ ] **AC5** — `renderer.js` queries the initial snapshot via `automationGetActivity()` on load and subscribes via `onAutomationActivity`, calling an `updateAutomationIndicator({sessions})` that: hides the indicator AND clears the badge when `sessions.length === 0`; shows it otherwise; sets a count badge to `sessions.length`; sets a descriptive `title` + `aria-label` that **names the attached identities** — admin sessions labeled "admin", jar sessions named by jar (map `jarId`→display name via the `containers` array, falling back to the raw `jarId`); and applies an **admin-distinct** visual state (an `.admin` class with a distinct **non-alarm** color — NOT danger-red, which reads as "error"; admin is "more privileged", not "broken". A violet/blue accent or a ring is appropriate; final color polish is a HAT/leg-7 concern) when any attached session has `kind === 'admin'`. Wording is "connected" (transport lifecycle), never "authorized". **Cache the last snapshot** (`lastSnap`) and re-run `updateAutomationIndicator(lastSnap)` once the `containers` jars list resolves, so a jar session's display name is correct even if the snapshot arrives before `jarsList()` (see Edge Cases).
- [ ] **AC6** — `settings.html` gains an audit-log viewer inside `<section id="automation">` (e.g. an `<h3>Activity</h3>` + `#automation-active-sessions` list + `#automation-activity-log` list). The controller renders the initial `automationGetActivity()` snapshot and live `onAutomationActivity` updates: active sessions show kind (admin/jar), the named jar, and a relative/absolute "since"; the action log shows recent entries (op, identity, outcome, time) newest-first, bounded to a sane display count (e.g. last 50). Admin vs jar is visually distinguished. The listener is removed on `pagehide` via `offAutomationActivity`. When there are no active sessions / no log entries, an empty-state line is shown ("No automation sessions" / "No recent activity").
- [ ] **AC7** — Identity/jar names rendered from audit data are inserted via `textContent`/`createElement` (never `innerHTML` interpolation) — `jarId` is operator-controlled (jar names). No plaintext keys/hashes appear anywhere in the indicator or viewer (the contract carries neither).
- [ ] **AC8** — `npm run typecheck`, `npm run lint`, and `npm test` all pass / stay green. The toolbar and settings viewer render without console errors. (Live verification — indicator lights on a real attached session, viewer lists it, admin vs jar distinguished — is exercised in leg 6's `settings-automation` + `mcp-jar-scoping` runs.)

## Verification Steps
- AC1/AC2/AC3: `grep -n "automation:get-activity" src/main/main.js src/preload/*.js`; `grep -n "onAutomationActivity\|automationGetActivity" src/preload/chrome-preload.js src/preload/internal-preload.js`.
- AC4: `grep -n "automation-indicator" src/renderer/index.html`.
- AC5/AC6: `grep -n "updateAutomationIndicator\|automation-active-sessions\|automation-activity-log" src/renderer/renderer.js src/renderer/pages/settings.js`.
- AC8: `npm run typecheck && npm run lint && npm test` clean.
- Live indicator/viewer behavior: leg 6 (`settings-automation` CDP + `mcp-jar-scoping` MCP run — an attached session is the apparatus).

## Implementation Guidance

1. **main.js — activity snapshot IPC (AC1).** Near the other automation handlers:
   ```js
   ipcMain.handle('automation:get-activity', () => (mcpServer ? mcpServer.getActivity() : { sessions: [], log: [] }));
   ```
   (Bare, like `settings-get` — the chrome and the settings page both read it; a web page cannot reach `ipcRenderer`.)

2. **chrome-preload.js — bridge (AC2).** In the `window.goldfinch` object, near the settings/shields listeners:
   ```js
   automationGetActivity: () => ipcRenderer.invoke('automation:get-activity'),
   onAutomationActivity: (cb) => ipcRenderer.on('automation-activity-changed', (_e, d) => cb(d)),
   ```

3. **internal-preload.js — bridge (AC3).** Add to `goldfinchInternal`:
   ```js
   automationGetActivity: () => ipcRenderer.invoke('automation:get-activity'),
   onAutomationActivity: (cb) => on('automation-activity-changed', cb),
   offAutomationActivity: (h) => off(h),
   ```

4. **renderer-globals.d.ts (AC2/AC3).** Add `automationGetActivity` + `onAutomationActivity` to the chrome `GoldfinchBridge` interface, and `automationGetActivity`/`onAutomationActivity`/`offAutomationActivity` to `GoldfinchInternalBridge`. Use the audit snapshot shape `{ sessions: AutomationSession[], log: AutomationLogEntry[] }` — declare `AutomationSession` (`{ sessionId, identity, kind, jarId, since }`) + `AutomationLogEntry` (`{ ts, sessionId, identity, op, targetWcId, outcome, errorCode }`) or inline as `any[]` (either typechecks under the project's `checkJs`/non-strict config).

5. **index.html — indicator (AC4).** Insert between `#toggle-privacy` and `#kebab`:
   ```html
   <button id="automation-indicator" class="icon-btn hidden" type="button" title="Automation" aria-label="Automation sessions">
     <svg class="tb-glyph" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><!-- a "robot"/"plug" glyph, e.g. Lucide "bot" --><path d="..."/></svg>
     <span id="automation-indicator-badge" class="tb-badge hidden" aria-hidden="true"></span>
   </button>
   ```
   (Pick any clear inline SVG glyph consistent with the others; CSP-safe inline.)

6. **renderer.js — indicator controller (AC5, AC7).**
   - Add `automationIndicator` + its badge to the `els` map.
   - `function jarDisplayName(jarId) { const c = containers.find((x) => x.id === jarId); return c ? c.name : jarId; }`.
   - `function updateAutomationIndicator(snap) { const sessions = (snap && snap.sessions) || []; const n = sessions.length; els.automationIndicator.classList.toggle('hidden', n === 0); if (!n) return; const hasAdmin = sessions.some((s) => s.kind === 'admin'); const names = sessions.map((s) => s.kind === 'admin' ? 'admin' : jarDisplayName(s.jarId)); badge.textContent = String(n); badge.classList.remove('hidden'); els.automationIndicator.classList.toggle('admin', hasAdmin); const label = n + ' automation session' + (n>1?'s':'') + ' connected: ' + names.join(', '); els.automationIndicator.title = label; els.automationIndicator.setAttribute('aria-label', label); }`.
   - Maintain `let lastSnap = { sessions: [] };` updated at the top of `updateAutomationIndicator`. On init: `window.goldfinch.automationGetActivity().then(updateAutomationIndicator).catch(() => {});` and `window.goldfinch.onAutomationActivity(updateAutomationIndicator);` (mirror the shields-button init/subscribe at the same place). Where `jarsList()` resolves and replaces `containers`, add `updateAutomationIndicator(lastSnap);` so jar display names correct once the jars load.
   - Build no HTML from `jarId` via innerHTML — `title`/`textContent` only.

7. **styles.css — indicator (AC4/AC5).** Mirror `#toggle-privacy`: `#automation-indicator { position: relative; width: 36px; display: flex; align-items: center; justify-content: center; }`; reuse `.tb-glyph`/`.tb-badge`. A connected (jar-only) state uses `--accent` (gold); an admin-distinct state uses a **non-alarm** distinct color (e.g. `#automation-indicator.admin { color: #a371f7; }` violet — NOT red/danger). Keep it subtle and consistent; final color is a HAT/leg-7 polish point.

8. **settings.html — audit viewer (AC6).** Inside `<section id="automation">`, placed AFTER the `#automation-admin` block (section order: Keys → Admin key → Activity, which reads cleanly):
   ```html
   <h3>Activity</h3>
   <div id="automation-active-sessions"></div>
   <h4>Recent actions</h4>
   <div id="automation-activity-log"></div>
   ```

9. **settings.js — viewer controller (AC6, AC7).** A new IIFE (guard on the bridge):
   - `renderActivity(snap)`: rebuild `#automation-active-sessions` — for each session a row "admin" or "jar: {jarId}" + "since {time}", admin rows visually distinct (a class); empty-state line when none. Rebuild `#automation-activity-log` — newest-first (`log` is newest-last, so reverse a copy), capped to ~50 rows, each "{time} · {op} · {identity} · {outcome}" with error rows distinct; empty-state when none. Use `createElement`+`textContent`.
   - On load: `automationGetActivity().then(renderActivity)`; subscribe `const h = onAutomationActivity(renderActivity)`; `pagehide` → `offAutomationActivity(h)`.
   - Format `ts`/`since` with `new Date(ts).toLocaleTimeString()` (renderer has a clock; this is display-only).

10. **settings.css — viewer (AC6).** Small list/row styling reusing tokens; an admin-distinct color; a `.muted` empty state; monospace-ish log rows if desired. Dark theme consistent.

## Edge Cases
- **Surface not active (`mcpServer === null`)** → `automation:get-activity` returns `{ sessions: [], log: [] }`; indicator stays hidden; viewer shows empty states. Not an error.
- **Session attached before chrome/settings load** → the initial `automationGetActivity()` query renders current state immediately (the broadcast alone would miss already-open sessions).
- **Snapshot arrives before the jars list (`containers`) loads** → a jar session's title shows the raw `jarId` transiently (correct, just not the friendly name); caching `lastSnap` and re-running `updateAutomationIndicator` once `jarsList()` resolves corrects the display name. Admin sessions are unaffected (labeled "admin", not via `containers`).
- **Revoked-but-still-connected session** → still appears as a connected session until its transport closes (DD6 "connected" semantics) — correct, not a bug.
- **`jarId` with HTML metacharacters / unknown jar** → `textContent` rendering; `jarDisplayName` falls back to the raw `jarId` if not in `containers`.
- **Rapid activity (per-mutation broadcast)** → the viewer re-renders per event; acceptable for one local consumer (DD6 notes debounce only if it feels chatty — not required here). Cap the log render to ~50 rows to bound DOM work.
- **Listener accumulation across settings reloads** → removed on `pagehide` via `offAutomationActivity` (the registry pattern); the chrome indicator listener lives for the chrome's lifetime (no reload churn).

## Files Affected
- `src/main/main.js` — `automation:get-activity` bare handler.
- `src/preload/chrome-preload.js` — `automationGetActivity` + `onAutomationActivity`.
- `src/preload/internal-preload.js` — `automationGetActivity` + `onAutomationActivity`/`offAutomationActivity`.
- `src/renderer/renderer-globals.d.ts` — both bridge contracts.
- `src/renderer/index.html` — `#automation-indicator`.
- `src/renderer/renderer.js` — `updateAutomationIndicator` + init/subscribe + `els` entry + `jarDisplayName`.
- `src/renderer/styles.css` — indicator styling.
- `src/renderer/pages/settings.html` — Activity viewer markup.
- `src/renderer/pages/settings.js` — viewer IIFE.
- `src/renderer/pages/settings.css` — viewer styling.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (typecheck + lint + unit; live deferred to leg 6)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred to Phase 2d)
- [ ] Do NOT check off the leg in flight.md (deferred to batched commit)
- [ ] Do NOT commit per-leg
