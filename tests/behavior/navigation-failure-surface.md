# Behavior Test: Navigation Failure Surface

**Slug**: `navigation-failure-surface`
**Status**: active
**Created**: 2026-09-15
**Last Run**: 2026-09-15 — pass (9/9 judged checkpoints; step 1 rerun on a refusing loopback host; timeout variant skipped; run log `navigation-failure-surface/runs/2026-09-15-15-01-54.md`)

## Intent

Verifies that a top-frame navigation that cannot complete never leaves the
operator on a blank page: the failed tab shows a chrome-owned surface naming
the intended address and an app-authored reason with a working Retry; the
tab strip marks the tab without the operator switching to it; the address bar
keeps the intended address; the automation census reports the failure; a
closed failed tab reopens at its intended address; and a certificate failure
reaches the same generic surface (until Flight 2 specialises it). The whole
chain — engine event → main registry state → guest hidden → owner-routed push
→ chrome panel/strip/census — is only observable on the live app; unit tests
pin each link but not the rendered result.

## Preconditions

- The live rig is up: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
  (WSLg). Launched **WITHOUT** `--insecure-tls-fixtures` — the certificate row
  depends on the throwaway CA being untrusted. **Bind-probe for a free fixture
  port `{P}`** (`ss -ltn` cannot see WSL2 ports held by Windows-side
  listeners); leave the MCP port alone. Nothing may be listening on `{P}` at
  the start of the run — every refused row depends on it, and step 6 starts
  a server on it only then. `{P}` must NOT be one of Chromium's restricted
  ports: the leg-1 spike measured `http://127.0.0.1:1/` failing with
  `ERR_UNSAFE_PORT` (code -312), not `ERR_CONNECTION_REFUSED` — a high
  ephemeral port (e.g. 40000–49000, excluding the MCP port) is safe.
  **Loopback host**: `{L}` is a loopback address that actually REFUSES an
  unbound port. Under WSL2 **mirrored networking** (`.wslconfig`
  `networkingMode=mirrored`) SYNs to unbound `127.0.0.1` ports are silently
  dropped (no RST — the tab sits pending, never `ERR_CONNECTION_REFUSED`);
  `127.0.0.2` refuses at 0 ms (run 2026-09-15). Precheck:
  `curl -m 3 http://{L}:{P}/` must fail immediately with "Connection refused",
  not time out. The retry server is bound to the same host
  (`--bind {L}`) — the URL host must match the bind. The TLS fixture stays on
  `127.0.0.1` (a bound port answers under either mode).
- The admin MCP key is available **by env-var reference ONLY, never a command
  literal** (standing carry). Capture it from the launch's
  `AUTOMATION_DEV_MINT` line.
- Fixture certs generated: `node tests/behavior/fixtures/web-compat/gen-certs.mjs`
  (throwaway CA + server cert; gitignored). TLS fixture running on a second
  free port `{T}`: `node tests/behavior/fixtures/web-compat/serve-tls.mjs --port {T}`.
- A fresh profile is not required; at least one persistent jar exists (the
  fresh-seed `personal` suffices).
- Active precondition checks (step 0): the census resolves and every existing
  tab reports `loadState: "ok"` (close stale failed tabs from earlier sessions
  first — the dev profile restores them); the TLS fixture answers on `{T}`
  (`curl -k -m 3 https://127.0.0.1:{T}/` → any HTTP response); the app was NOT
  launched with `--insecure-tls-fixtures`.

## Observables Required

- rendered chrome state — the composited window (measured via the goldfinch
  MCP `captureWindow` tool, admin; on the WSLg/Wayland rig its capturePage
  fallback can report `chrome window unavailable` — leg-1 live check — in
  which case `captureScreenshot` of the CHROME wcId from `getChromeTarget`
  is the equivalent rendered observable, since the panel is chrome DOM and
  the guest is hidden) and the chrome view's accessibility tree (measured
  via `getChromeTarget` + `readAxTree`)
- app tab state — per-tab `url`, `title`, `loadState`, `loadError`, `active`
  (measured via the goldfinch MCP `enumerateTabs` tool)
- chrome DOM drive — clicking the surface's Retry via `getChromeTarget` +
  `evaluate` (`document.getElementById('load-failure-retry').click()`), and
  keyboard via `pressKey` (supplementary; never primary evidence)
- shell — starting the retry fixture server (`python3 -u -m http.server {P}
  --bind {L} --directory tests/behavior/fixtures/keyboard-nav`; readiness by
  `ss -ltn` + a curl 200, not the banner line — stdout is block-buffered when
  redirected), exit/stdout

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 0 | Enumerate tabs. | The census resolves; every row carries `loadState: "ok"` and `loadError: null`. *(active precondition check)* |
| 1 | Open a tab via `openTab` to `http://{L}:{P}/`. Wait up to 10 s. Capture the window. Read the chrome a11y tree. Enumerate tabs. | The window shows an explanatory panel in the page area — not a blank page — with a heading, the address `http://{L}:{P}/` shown verbatim, wording that the connection was refused, the raw code `ERR_CONNECTION_REFUSED`, and a **Retry** button. The a11y tree exposes the heading, the address text, and a button named Retry. The census row for the new tab has `url` `http://{L}:{P}/` (never a `chrome-error:` address), `loadState: "failed"`, and `loadError.name` `ERR_CONNECTION_REFUSED`. |
| 2 | Capture the window again, framing the tab strip and address bar. | The active tab's strip entry shows a warning glyph in place of a favicon and a title derived from the host (`{L}:{P}`, not "New tab"); the address bar reads `http://{L}:{P}/`. The glyph is visual only; the tab's accessible name carries the "— failed to load" suffix (the a11y equivalent of the mark). |
| 3 | Navigate the same tab (via `navigate`) to `http://nonexistent-host-abc123xyz.invalid/`. Wait up to 15 s. Capture the window. Enumerate tabs. | The panel re-renders for the new address: it names `nonexistent-host-abc123xyz.invalid`, says the site's address could not be found, and shows `ERR_NAME_NOT_RESOLVED`; the census row reports `loadState: "failed"` with that name and the `.invalid` URL; the address bar reads the `.invalid` address (not the previous one). |
| 4 | Open a second tab via `openTab` to `about:blank` (it becomes active). Then, via `navigate`, point the **first** tab (still in the background) at `http://{L}:{P}/`. Wait 5 s. Capture the window. Enumerate tabs. | The active tab shows its own (blank, ordinary) page — no failure panel. The **inactive** first tab's strip entry shows the warning glyph and host title without having been switched to. Census: first tab `loadState: "failed"`, second tab `loadState: "ok"`. |
| 5 | Activate the first tab via `activateTab`. Capture the window. | The failure panel for `http://{L}:{P}/` is shown; the second tab's entry is unmarked. *(failure state is projected on activation, not lost in the background)* |
| 6 | Navigate the first tab to `http://{L}:{P}/links.html` (nothing listening). Wait up to 10 s. Capture. Then, in the shell, start `python3 -u -m http.server {P} --bind {L} --directory tests/behavior/fixtures/keyboard-nav` and wait for its "Serving HTTP" line. Then, via the chrome apparatus, click Retry (a pointer click at the button's chrome-relative rect, or `evaluate` of `.click()` — both drive the same handler; say which). Wait up to 10 s. Capture the window. Enumerate tabs. | Before the server starts: the refused panel for `http://{L}:{P}/links.html`. After Retry: the `links.html` fixture's links are visible in the page area, the panel is gone, the strip entry shows an ordinary title with no warning glyph, and the census row reports `loadState: "ok"`, `loadError: null`, `url` `http://{L}:{P}/links.html`. |
| 7 | Navigate the first tab to `https://127.0.0.1:{T}/` (the throwaway-CA TLS fixture). Wait up to 10 s. Capture the window. Enumerate tabs. | The generic failure panel appears — never a blank page — with certificate wording, the address, and `ERR_CERT_AUTHORITY_INVALID`; census `loadState: "failed"`. *(Flight 2 replaces this with the interstitial; until then the generic surface is the floor.)* |
| 8 | Via the chrome apparatus, set the address bar to `http://{L}:{Q}/` (`{Q}`: a second free port — `{P}` still has the step-6 server) and press Enter (the typed-navigation path, which blurs the input expecting the page). Wait up to 10 s. Read the chrome a11y tree's focused node. Then move focus to the address bar (focus `#address`), read the focused node, press F6, and read the focused node again (the probe must START away from the heading to be discriminating); then press Tab repeatedly (at most 6 presses), reading the focused node after each. | After the typed navigation fails, focus is NOT on `<body>`: the a11y tree reports the panel's heading focused. After F6 the heading is focused (the content gesture lands in the panel, never in the hidden guest). Within the Tab presses, focus reaches the Retry button. `[a11y]` The panel is keyboard-reachable without a mouse and a typed-then-failed navigation never orphans focus. *(HAT-only clause: a visible focus ring appears on Retry — unobservable under automation on WSLg, where `document.hasFocus()` is false and `:focus-visible` cannot match; the operator verifies by eye.)* |
| 9 | Close the first (failed) tab via `closeTab`. Then press Control+Shift+T on the chrome target. Wait up to 10 s. Enumerate tabs. | A tab reopens whose `url` is the closed tab's intended address (`http://{L}:{Q}/` after step 8) — never `chrome-error://chromewebdata/` — and it lands back on the failure panel with `loadState: "failed"`. |
| 10 | Stop the `http.server` started in step 6 and the TLS fixture. | (cleanup; no judgment) |

## Out of Scope

- Rendered focus ring under automation (see step 8's HAT-only clause).

- Certificate interstitial, informed override, "not secure" indicator, and
  the certificate viewer — Flight 2 (`#143`).
- Renderer crashes and hangs — Flight 3 (`#133`).
- Subframe failures (a broken iframe is the page's problem; DD2).
- Offline (`ERR_INTERNET_DISCONNECTED`) — cannot be induced on the rig
  without dropping the WSL2 network; unit-pinned in the classification model.
- `captureScreenshot` of the failed tab — the guest is hidden by design; the
  observable is the composited window.

## Variants (optional)

- **`timeout`** — after step 7, navigate the tab to `http://192.0.2.1:81/`
  (TEST-NET-1, non-routable). Wait up to 130 s. Expected: the panel appears
  with either the timed-out or the unreachable wording
  (`ERR_CONNECTION_TIMED_OUT` / `ERR_ADDRESS_UNREACHABLE` — the rig's routing
  decides which), census `loadState: "failed"`. Skipping this variant is
  noted in the run log, not a failure.
