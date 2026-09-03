# Squawk 0062: Web pages can badge the Goldfinch taskbar icon via the Badging API

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-02
**Completed**: 2026-09-02

## Report

On an installed v0.14.1 (Windows 11, fresh install), the Goldfinch taskbar
icon showed a persistent "17" badge — a number in a dark circle at the
icon's top-right corner, the same rendering Discord's unread badge uses.
It survived a full quit and relaunch, hover showed a single window, Task
Manager showed one healthy process tree (main + gpu + network + audio + six
renderers), and Notification Center held no Goldfinch entries. The number
was Telegram Web's unread count: a tab on `https://web.telegram.org` was
being session-restored, and its page script republished the count on every
load.

Root cause: Chromium's Badging API (`navigator.setAppBadge(n)` /
`navigator.clearAppBadge()`) is exposed to every web page, and Electron
implements it by forwarding straight to the app-level badge — on Windows an
overlay icon on every window's taskbar button, on macOS the dock badge, on
Linux the Unity launcher count. In Chrome the call only affects an
_installed PWA's_ own icon; in an Electron browser it lands on the
browser's icon. There is no permission prompt and no permission string —
Electron's `setPermissionRequestHandler` / `setPermissionCheckHandler`
never see it, so the positive permission allowlist that already denies
`notifications` is bypassed by construction. Any page in any jar (top-level
or, since the guest preload is main-frame-only, any subframe) can write a
number onto the browser's OS-level identity, silently, persistently, and
across restarts via session restore.

Reproduce: open any page in a web tab and run `navigator.setAppBadge(17)`
in DevTools → the Goldfinch taskbar/dock icon shows 17. Quit and relaunch
with the tab restored → a page that re-sets on load brings it back.
`navigator.clearAppBadge()` from that page clears it (this is how the live
instance was cleared during triage).

Proposed fix (one read pass, no design decision): disable the Blink feature
for the whole app — `app.commandLine.appendSwitch('disable-blink-features',
'Badging')` in `src/main/main.js`, at module scope beside the other
before-ready process setup (`registerSchemesAsPrivileged` /
`setAppUserModelId`). That removes `setAppBadge`/`clearAppBadge` from
`Navigator.prototype` in every frame of every session (web jars, internal
pages, chrome, sheet), so there is no main-frame-only gap to plug and no
main-side counter-clear timer. Nothing in the product calls the API (no
`app.setBadgeCount` / `setOverlayIcon` / `setBadge` site anywhere in
`src/`). The Blink feature name must be confirmed live at completion (see
Verification): if the switch is ignored, fall back to deleting the two
methods from `Navigator.prototype` in `src/preload/webview-preload.js`'s
main-world top (main frame only — an accepted narrower net) plus a
`web-contents-created` hook, and note the subframe gap.

## Evidence

- Live, over the MCP `evaluate` op against the installed 0.14.1 instance,
  Telegram tab (wcId 3): `typeof navigator.setAppBadge` → `"function"`;
  `Notification.permission` → `"denied"`; `await
navigator.clearAppBadge()` resolved → operator confirmed the taskbar
  "17" disappeared immediately. Second web tab (wcId 4): `setAppBadge`
  present, `Notification.permission` `"denied"` — the notification
  allowlist is working; it simply does not govern badging.
- `src/main/session-runtime.js:ALLOWED_PERMISSIONS` — the shared
  positive allowlist for both permission handlers; badging has no
  permission string in Electron 43.4.1 (`package.json` devDependency), so
  no allowlist entry could deny it.
- `grep -rn -iE "setBadgeCount|setOverlayIcon|setBadge|badging" src/` →
  no hits: the app never sets or clears a badge, so any badge on the icon
  is page-originated.
- `grep -n "appendSwitch" src/main/main.js` → no Blink-feature switch
  exists yet; `ozone-platform.js:9` / `main.js:195` document why
  ozone-platform in particular can't be set in-app — that caveat is about
  the launcher-inherited GPU/child process flag and does not apply to a
  Blink runtime feature, which every renderer reads from the browser
  process's command line.
- Notification Center screenshot (operator, 2026-09-02): only Windows
  Security entries under Goldfinch's identifier — rules out toasts as the
  badge source.

## Corrective Action

The proposed `--disable-blink-features=Badging` switch was implemented first
and verified live to be a **no-op**: the flag reached every renderer's
command line (`--disable-blink-features=Badging` visible on the
`--type=renderer` processes) yet `typeof navigator.setAppBadge` stayed
`"function"`. Chromium's `runtime_enabled_features.json5` has no entry
containing "Badg" — the API shipped unflagged — and Electron's
`electron_browser_client.cc` binds `blink::mojom::BadgeService`
unconditionally for every frame AND for service workers
(`badge_manager.cc`'s `SetBadge` forwards to `Browser::SetBadgeCount` with
no gate). The switch and its test were removed again; `src/main/main.js` is
untouched by this squawk.

Landed fix — the squawk's named fallback: `src/preload/webview-preload.js`
deletes `setAppBadge` and `clearAppBadge` from `Navigator.prototype` at
module top, before any page script runs (contextIsolation:false makes the
preload the page's first script; WebIDL operations are configurable, so
`delete` works — live-checked: descriptor `configurable: true`, delete
returns `true`, `typeof` → `"undefined"`). The guest preload is served from
the esbuild bundle `webview-preload.bundle.js` (gitignored, rebuilt by
`npm run build:preload` / the `pretest`+`prestart` hooks and by
`scripts/dev-launch.mjs`), so no wiring change was needed. No other file
in `src/` changes. The Report's "plus a `web-contents-created` hook" half
of the fallback was dropped: once the deletion lives in the preload there is
no job left for a main-side hook (it cannot reach a renderer realm, and no
main-side badge signal exists to react to).

**Scope, stated plainly — this is a best-effort deny, not a security
boundary.** Two bypasses remain, both live-probed on the dev build:

- Any iframe realm: the preload runs in the top frame only
  (`nodeIntegrationInSubFrames` is off), so a page can reach a fresh
  `Navigator.prototype` through a same-origin `about:blank` iframe or a
  cross-origin sandboxed one — Blink does not restrict badging to the
  top-level document (`iframe.set: "function"`, call `"ok"`).
- Service workers: a registered SW's `self.navigator.setAppBadge(11)`
  succeeds (`{"set":"function","call":"ok"}` from a local-origin probe);
  no preload runs there. Dedicated workers do NOT expose the API
  (`"undefined"` in a blob Worker), so that path is already closed.

Why still ship it: every real-world caller (Telegram Web, Slack, Discord's
web app, every PWA framework) badges from its top-level document, which this
closes — the reported defect is fixed. A structural gate needs an Electron
change (a permission check in front of `BadgeService`, or a `WebPreferences`
opt-out); running the preload in every subframe is a design change with its
own review (the media scanner, vault gesture and bookmark-drop wiring all
assume a single top-frame instance) and would still leave the SW path.
Both follow-ups are outside this squawk's gate and are noted, not started.

## Verification

- Live, over the MCP `evaluate` op against a `dev:automation` launch of the
  fixed worktree (bundle rebuilt), fresh `https://example.com/` tab:
  `{"top":{"set":"undefined","clear":"undefined","inProto":false}, …
"setAppBadgeCall":"TypeError: navigator.setAppBadge is not a function"}`
  — both methods gone from the top frame and `navigator.setAppBadge(17)`
  throws rather than silently no-opping. Same probe against the unfixed
  bundle moments earlier: `set: "function"`, call succeeded. The iframe
  half of the same probe still reports `"function"` — the documented gap.
- `test/unit/badging-preload-pin.test.js` (3 tests, green): source-scans
  the preload for the two-name delete loop, pins it before the preload's
  first listener registration (module-top, first-script region) and
  unguarded, and walks `src/` to assert no product call to
  `setBadgeCount` / `setOverlayIcon` / `setAppBadge` / `clearAppBadge`
  exists, so removing the API removes no feature.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`
  green in the squawk worktree.
- The operator's installed instance was cleared during triage via a
  page-side `navigator.clearAppBadge()`; confirmed the badge vanished.

## Sign-Off

**Reviewer**: independent Reviewer agent (scoped to the diff; neuter-verified
against temp copies of the preload, real file untouched)
**Verdict**: confirmed — the top-frame main-world deletion closes the reported
vector before any page script can capture the methods, the per-name try/catch
cannot break the rest of the preload, the Corrective Action states both
live-probed bypasses (iframe realms, service workers) without overselling the
fix, and the three pins go red on loop removal, relocation below the keydown
registration, an enclosing `if`, an enclosing IIFE, and single-name deletion,
while the call-shaped `src/` scan matches a synthetic `app.setBadgeCount(3)`
and correctly skips the preload's own string-literal loop (and its gitignored
bundle twin). Three non-blocking cleanups were applied before sign-off:
`collectSources` reused from `test/helpers/source-scan.js` instead of a
duplicate walker, the first-listener anchor made wrap-insensitive, and the
"unguarded" check switched from a nearest-`;\n` slice (which a guard block
containing its own statement slipped past) to a brace-depth count — the
guard-with-statement mutation is now red too.
**Commit**: `squawk/0062-badging-api-taskbar-badge` (via its PR against `main`)
