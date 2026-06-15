# Leg: automation-settings-section

**Status**: completed
**Flight**: [Settings key management + automation UI](../flight.md)

## Objective
Add an "Automation" section to `goldfinch://settings` — the off-by-default opt-in enable toggle (SC8 UI), the live MCP connection address with a copy button and bind-status, an editable port field with a "find a free port" button, and a cross-OS connect hint — wired through new `window.goldfinchInternal` bridge methods to the leg-1 IPC.

## Context
- **DD1**: surface the live bound address (`http://127.0.0.1:{port}/mcp`), bind-status (bound / failed / disabled), a copy button, an editable port field, and a "find free port" button. Port changes are **next-launch** — show the **active** port (from the status IPC) and the **pending** port (the stored `automationPort`), annotating the pending one "(takes effect on next launch)" when it differs. Host is fixed `127.0.0.1`.
- **DD5 / SC8**: the enable toggle drives `automationEnabled` via the settings bridge (`settingsSet`). This is the operator-facing opt-in that Flight 4's auth core already honors (off-by-default; the gate 401s until it's true AND a valid key is presented).
- **DD4**: copy buttons use `navigator.clipboard.writeText` in the secure `goldfinch://settings` context, with an internal-bridge `clipboard:write` IPC fallback (the internal webview runs `contextIsolation:true` + `sandbox`, where the web clipboard API can be blocked at runtime). **This leg is the first copy consumer (the address), so it builds the shared `copyText()` helper + the `clipboard:write` fallback IPC here; leg 3 (key copy) reuses it.**
- Leg 1 already shipped the main-process backend: `automation:get-status` → `{ enabled, host, port, bound, error }` and `automation:find-free-port` → `{ port }`, both via `registerInternalHandler`, plus the `automationPort` setting + validator. This leg is the renderer/bridge half that consumes them.
- The audit-activity listener (`onAutomationActivity`) and the visible indicator/viewer are **leg 4** — not this leg.

## Inputs
What exists before this leg runs:
- `src/preload/internal-preload.js` — origin-guarded `window.goldfinchInternal` (only on `goldfinch://settings`); a listener handle registry (`on`/`off`, lines ~24–54); the `contextBridge.exposeInMainWorld('goldfinchInternal', {...})` block (lines ~56–120) currently exposing `settingsGet/Set`, `onSettingsChanged/offSettingsChanged`, `shieldsGet/Set`, `onShieldsChanged/offShieldsChanged`.
- `src/renderer/pages/settings.html` — `<nav>` with section links (lines 11–19); `<main>` with `<section>`s (`#appearance`, `#privacy`, `#startup`, `#downloads`, `#about`, lines 22–65). Plain `<script src="settings.js" defer>`.
- `src/renderer/pages/settings.js` — per-section IIFE controllers; the canonical pattern: guard `if (!window.goldfinchInternal) return;`, `settingsGet(...).then(...)` on load, write on user input, `onSettingsChanged` for live sync, `offSettingsChanged(h)` on `pagehide`.
- `src/renderer/pages/settings.css` — color tokens (`:root`, lines 4–15); `.shield-row` control rows (label-left / control-right, lines ~172–198); checkbox toggle styling (lines ~204–243); `#home-page-input` text-input style (lines ~256–275); `#home-page-save` button style (lines ~277–299); `<h2>` section headers.
- `src/main/main.js` — leg-1 handlers `automation:get-status` / `automation:find-free-port` (registered via `registerInternalHandler`); `broadcastToChromeAndInternal`; the `goldfinch` scheme is `secure: true` (line ~32), so `navigator.clipboard` is available in the settings page.
- `src/main/internal-ipc.js` — `registerInternalHandler` (origin-checked: `goldfinch://settings` + `__goldfinchInternal`).

## Outputs
What exists after this leg completes:
- New bridge methods on `window.goldfinchInternal`: `automationGetStatus()`, `automationFindFreePort()`, `clipboardWrite(text)`.
- New `clipboard:write` IPC handler (origin-checked) in `main.js` backed by Electron's `clipboard.writeText`.
- A shared `copyText(text)` helper in `settings.js` (navigator.clipboard primary, `clipboardWrite` IPC fallback).
- An "Automation" nav entry + `<section id="automation">` in `settings.html` with the toggle, address+copy+status, port field+find-free-port, and connect hint.
- A new automation IIFE controller in `settings.js`.
- Matching CSS in `settings.css`.

## Acceptance Criteria
- [ ] **AC1** — `internal-preload.js` exposes `automationGetStatus: () => ipcRenderer.invoke('automation:get-status')`, `automationFindFreePort: () => ipcRenderer.invoke('automation:find-free-port')`, and `clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text)` on `window.goldfinchInternal`. (`onAutomationActivity`/`offAutomationActivity` are deliberately NOT added here — leg 4.)
- [ ] **AC2** — `main.js` registers `clipboard:write` via `registerInternalHandler` (NOT bare `ipcMain.handle`); the handler calls Electron `clipboard.writeText(String(text))` and returns `{ ok: true }`. It rejects (origin guard) a non-internal sender.
- [ ] **AC3** — `settings.html` gains a nav link `<li><a href="#automation">Automation</a></li>` and a `<section id="automation">` containing: (a) an enable toggle `#automation-enabled` styled like the shield toggles, with an adjacent helper-text element `#automation-enabled-note`; (b) a steady-state bind-status line `#automation-status` (NOT `role="status"` — plain element, set on load/refresh, to avoid double-announce with the transient message line); (c) an address display `#automation-address` + a copy button `#automation-copy-address`; (d) a port number input `#automation-port` (`min="1024" max="65535"`) + a save button `#automation-port-save` + a "find free port" button `#automation-find-port` + a pending-port annotation element `#automation-port-note`; (e) a transient feedback line `#automation-message` with `role="status"`; (f) a one-line connect-hint that defers detail to `docs/mcp-automation.md` (do NOT duplicate the full Bearer/WSL2/Docker prose inline — link to the doc to keep a single source of truth; do NOT hardcode a port). **Each control row is wrapped in a `<div class="settings-row">`** so the address+copy and the port+buttons lay out as coherent rows (the existing home-page row relies on bare-sibling inline-block, which does not generalize to multi-button rows).
- [ ] **AC4** — On load the controller renders state from `automationGetStatus()`: when `bound` → `#automation-status` reads "Connected — listening on 127.0.0.1:{port}"; when `enabled && !bound && error` → "Failed to bind: {error}"; when `!enabled` → "Not running — start Goldfinch with `--automation-dev` to bind the surface". The address `#automation-address` always shows the resolved `http://127.0.0.1:{port}/mcp` (host always `127.0.0.1`).
- [ ] **AC5** — The enable toggle reflects `automationEnabled` on load (`settingsGet`), writes it on change (`settingsSet('automationEnabled', checked)`), and stays in sync via `onSettingsChanged` (direct `.checked =` assignment, never `.click()`); the listener is removed on `pagehide` via `offSettingsChanged`. **Toggle-honesty (resolves design-review [high]):** the `automationEnabled` setting only gates auth on an *already-running* server; the server itself only binds under `--automation-dev`. So when `status.enabled === false`, `#automation-enabled-note` reads "Takes effect when Goldfinch is launched with `--automation-dev`." — the operator who flips it ON and sees "Not running" understands why. When `status.enabled === true` the note is empty. The setting is real and persists for the next dev launch (decision: keep the toggle, annotate it — option (a)).
- [ ] **AC6** — The port field shows the **pending** `automationPort` (`settingsGet('automationPort')`); "Save" writes it via `settingsSet('automationPort', Number(value))` — on a validator rejection the controller shows an inline error ("Invalid port (1024–65535)") and does not crash; "find free port" calls `automationFindFreePort()`, populates the field with the returned port and saves it (or shows "no free port found" on `null`, leaving the field unchanged). `#automation-port-note` shows "(takes effect on next launch)" **only when `status.bound` is true AND the pending port differs from `status.port`** (gate on `bound`, not bare inequality, so a transient disabled-state resolve match never shows a misleading note).
- [ ] **AC7** — The copy button copies the displayed address via a shared `copyText(text, messageEl)` helper: `navigator.clipboard.writeText` first, and on throw/rejection falls back to `goldfinchInternal.clipboardWrite`; a transient "Copied" / "Copy failed" message is shown. `copyText` is declared as a **top-level `async function` in a shared-helpers block above the IIFE controllers** (file-scope hoisted, no `window` pollution) — NOT inside the automation IIFE — so leg 3's separate key-copy IIFE calls it directly without duplication.
- [ ] **AC8** — `npm run typecheck` and `npm run lint` pass. `npm test` stays green (no unit regressions). The section renders without console errors when the settings page loads. (Live CDP behavior verification — toggle flips the setting, address/port/status render, copy works — is authored in leg 5 and run in leg 6; do NOT block this leg on the live run.)

## Verification Steps
- AC1/AC2: `grep -n "automationGetStatus\|automationFindFreePort\|clipboardWrite" src/preload/internal-preload.js`; `grep -n "clipboard:write" src/main/main.js` shows it via `registerInternalHandler`.
- AC3: `grep -n "automation" src/renderer/pages/settings.html` shows the nav link + section + the listed control IDs.
- AC8: `npm run typecheck && npm run lint && npm test` all clean.
- AC4–AC7: exercised live in leg 6's `settings-automation` CDP run (apparatus does not exist until leg 5 authors it).

## Implementation Guidance

1. **internal-preload.js — bridge methods (AC1).** In the `contextBridge.exposeInMainWorld('goldfinchInternal', {...})` object, after the shields methods, add:
   ```js
   // Automation status/address (Flight 5, Leg 2). Activity listeners are Leg 4.
   automationGetStatus: () => ipcRenderer.invoke('automation:get-status'),
   automationFindFreePort: () => ipcRenderer.invoke('automation:find-free-port'),
   clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
   ```

2. **main.js — clipboard fallback IPC (AC2).** Add `clipboard` to the `electron` require if not present. Near the other `registerInternalHandler` calls:
   ```js
   registerInternalHandler(ipcMain, 'clipboard:write', (_e, text) => {
     clipboard.writeText(String(text == null ? '' : text));
     return { ok: true };
   });
   ```

3. **settings.html — markup (AC3).** Add the nav `<li>` (place it after "Privacy & Shields" or before "About" — group it logically). Add the section, mirroring the existing markup style (reuse `.shield-row` for the toggle; wrap each non-toggle control in a `.settings-row` flex row; use shared `.settings-text-input` / `.settings-btn` classes — see CSS step 5):
   ```html
   <section id="automation">
     <h2>Automation</h2>
     <fieldset class="shields-group">
       <legend class="sr-only">Automation</legend>
       <label class="shield-row shield-parent"><span>Enable automation surface</span><input type="checkbox" id="automation-enabled" /></label>
     </fieldset>
     <p id="automation-enabled-note" class="muted"></p>
     <p id="automation-status">—</p>
     <div class="settings-row">
       <label for="automation-address">MCP address</label>
       <input id="automation-address" class="settings-text-input" type="text" readonly spellcheck="false" />
       <button id="automation-copy-address" class="settings-btn" type="button">Copy</button>
     </div>
     <div class="settings-row">
       <label for="automation-port">Port</label>
       <input id="automation-port" class="settings-text-input" type="number" min="1024" max="65535" autocomplete="off" />
       <button id="automation-port-save" class="settings-btn" type="button">Save</button>
       <button id="automation-find-port" class="settings-btn" type="button">Find free port</button>
       <span id="automation-port-note" class="muted"></span>
     </div>
     <p id="automation-message" role="status"></p>
     <p class="connect-hint">Point your MCP client at the address above with an <code>Authorization: Bearer &lt;key&gt;</code> header (generate a key under Jars). Loopback-only — see <a href="goldfinch://settings#" data-doc="mcp-automation">the automation docs</a> for WSL2 / Docker connection details.</p>
   </section>
   ```
   - The connect-hint is one line + a pointer to `docs/mcp-automation.md` (single source of truth — don't inline the full prose, don't hardcode a port). The link can be plain text referencing `docs/mcp-automation.md` if an in-app doc route doesn't exist; keep it simple (a `<code>docs/mcp-automation.md</code>` reference is acceptable).

4. **settings.js — shared helper + controller (AC4–AC7).**
   - **At file scope, above the IIFE controllers**, add a shared-helpers block with `async function copyText(text, messageEl) { try { await navigator.clipboard.writeText(text); } catch { try { await window.goldfinchInternal.clipboardWrite(text); } catch { if (messageEl) messageEl.textContent = 'Copy failed'; return; } } if (messageEl) { messageEl.textContent = 'Copied'; } }`. This is a top-level `function` declaration (hoisted, file-scope, visible to all IIFEs below) — leg 3 calls it directly. Optionally clear the transient message after a timeout.
   - Add a new automation IIFE: guard `if (!window.goldfinchInternal) return;`, grab all elements, bail if any missing. Keep a module-local `lastStatus` so `onSettingsChanged` can recompute the port note against the active bind.
   - `renderStatus(status)`: store `lastStatus = status`; set `#automation-address.value = 'http://127.0.0.1:' + status.port + '/mcp'`; set `#automation-status` text per AC4; set `#automation-enabled-note` per AC5 (the "--automation-dev" helper when `!status.enabled`, else empty); recompute the port note (gate on `status.bound`).
   - On load: `automationGetStatus().then(renderStatus)`; `settingsGet('automationEnabled').then(v => { enabledToggle.checked = !!v; })`; `settingsGet('automationPort').then(p => { portInput.value = p; })`.
   - Toggle `change` → `settingsSet('automationEnabled', enabledToggle.checked)` (catch → inline message). (No need to re-fetch status; the enabled-note only depends on `status.enabled`, which a setting flip does NOT change in a non-dev build — so the note stays correct.)
   - Port "Save" → `settingsSet('automationPort', Number(portInput.value))` then `automationGetStatus().then(renderStatus)`; catch → inline "Invalid port (1024–65535)" message.
   - "Find free port" → `automationFindFreePort()` → if `port != null` set the field, `settingsSet('automationPort', port)`, then refresh status; else message "no free port found".
   - Copy button → `copyText(addressInput.value, messageEl)`.
   - `recomputePortNote()`: `#automation-port-note` = `(lastStatus && lastStatus.bound && Number(portInput.value) !== lastStatus.port) ? '(takes effect on next launch)' : ''`.
   - `onSettingsChanged(all => { if (all.automationEnabled != null) enabledToggle.checked = !!all.automationEnabled; if (all.automationPort != null) { portInput.value = all.automationPort; recomputePortNote(); } })`; remove on `pagehide`.

5. **settings.css — styling (AC3).** Reuse existing tokens. Add **dedicated shared classes** (do NOT extend the `#home-page-input`/`#home-page-save` ID selectors — that couples the sections): `.settings-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 0; }`; `.settings-text-input { ...mirror #home-page-input (bg-2, bg-3 border, radius, padding, focus accent)... }` with a sensible `min-width` (the address wider, e.g. `min-width: 340px`; the port narrow, e.g. `#automation-port { min-width: 90px; max-width: 120px; }`); `.settings-btn { ...mirror #home-page-save (accent bg, radius, padding, hover brightness, focus outline)... }`; `.muted { color: var(--fg-dim); font-size: 12px; }` (if not already present); `.connect-hint { color: var(--fg-dim); font-size: 13px; margin-top: 10px; }`. (Optionally migrate `#home-page-input`/`#home-page-save` to also use the new classes, but that's not required for this leg.)

## Edge Cases
- **`navigator.clipboard` blocked at runtime** → `copyText` falls back to the `clipboardWrite` IPC (DD4). Both failing → "Copy failed" message, no throw.
- **Toggle flipped ON in a non-`--automation-dev` build** → the setting persists (for the next dev launch) but no server binds this launch; `#automation-status` stays "Not running" and `#automation-enabled-note` explains the `--automation-dev` requirement. This is honest, not a bug (resolves design-review [high]).
- **`automationGetStatus` returns `enabled:false`** (normal build, no `--automation-dev`) → status shows "Not running"; the address still renders the resolved port so the operator can pre-configure. Not an error state.
- **`find free port` returns `{ port: null }`** → inline "no free port found"; field unchanged.
- **Invalid port entered** → `settingsSet` rejects (validator); inline error; field keeps the user's text for correction; no crash.
- **Pending == active port** → `#automation-port-note` is empty (no misleading "next launch" note).
- **Bridge absent** (page somehow loaded outside the internal origin) → the guard returns early; the section renders inert (matches every other controller).

## Files Affected
- `src/preload/internal-preload.js` — `automationGetStatus` / `automationFindFreePort` / `clipboardWrite` bridge methods.
- `src/main/main.js` — `clipboard:write` IPC via `registerInternalHandler`; `clipboard` in the `electron` require.
- `src/renderer/pages/settings.html` — nav link + `<section id="automation">`.
- `src/renderer/pages/settings.js` — file-scoped `copyText` helper + the automation IIFE controller.
- `src/renderer/pages/settings.css` — automation section styling (extends existing selectors).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (typecheck + lint + unit; live CDP deferred to leg 6)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred to Phase 2d)
- [ ] Do NOT check off the leg in flight.md (deferred to batched commit)
- [ ] Do NOT commit per-leg
