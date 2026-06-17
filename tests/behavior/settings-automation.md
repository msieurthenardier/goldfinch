# Behavior Test: Automation settings — toggle, address/port, keys, activity

**Slug**: `settings-automation`
**Status**: active
**Created**: 2026-06-15
**Last Run**: 2026-06-15-12-40-28 (pass — 12/13; 1 deferred to `mcp-jar-scoping` admin run; see `settings-automation/runs/`)

## Intent
Verify that the `goldfinch://settings` **Automation** section is a complete, self-service control
surface: the operator can turn the surface on/off, see the live MCP connection address + bind-status,
configure the listen port (with a "find free port" helper), generate / rotate / revoke a per-jar key
(show-once plaintext + copy) and — when env-gated — the admin key, and watch automation activity (a
visible chrome indicator + an in-settings audit viewer). This needs a behavior test, not a unit test,
because the assertions are real-environment, cross-process UI observations: the settings shell renders
inside a `<webview>` guest on the privileged `goldfinch://` scheme (read/driven via the admin MCP
surface's `allowInternal` enumeration), the activity indicator lives in the chrome renderer (read via
`getChromeTarget`), and the indicator/viewer only populate against a **live MCP session** over the
loopback transport. It backs **SC9** (keys managed from Settings — generate / rotate / revoke, effective
immediately), the **visible half of SC10** (a visible "automation active" indicator that distinguishes
admin from jar and names the jar, plus an action-log viewer), and the **SC8 toggle UI** (the
off-by-default opt-in gets its operator-facing control).

## Preconditions
- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT={port}`. At
  launch, the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout —
  capture **both** the jar `key` and the `adminKey`. The MCP server listens on
  `127.0.0.1:{port}/mcp`. One `dev:automation` instance serves **both** the harness's own driving
  session **and** the staged session(s) of Steps 11–13 (single instance; record which jar key stages
  which session).
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default
  `49707`). The spec refers to it as `{port}` throughout, so the rendered address is predictable
  regardless of the default. Export it once at launch and reuse it in all SDK calls and in the
  loopback staging POST.
- **How the admin key attaches to the harness client (load-bearing).** Connect an admin MCP client
  (SDK `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on
  `127.0.0.1:{port}/mcp`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }
  );
  ```
  The Bearer rides every request the transport sends.
- **The harness needs the admin key.** A jar key is refused `getChromeTarget` (`admin-only`) and
  cannot see the internal `goldfinch://settings` guest (jar keys cannot reach internal sessions).
  Only the admin identity can enumerate + drive the chrome and the internal guest (admin engine
  built with `{ allowInternal: true }`). **This is also why the harness shows up as an admin
  session** — see the reflexivity note below.
- **Reflexivity (load-bearing for Steps 11–13).** The harness drives via its **own admin MCP
  session**. That session is a live automation session: `audit-log.js`'s `activeSessions()` returns
  it as a `{ kind: 'admin', identity: 'admin', … }` row, the chrome indicator counts it
  (`renderer.js`'s indicator label), and **every tool call the harness makes** (`readDom`,
  `readAxTree`, `getChromeTarget`, `enumerateTabs`) is **recorded in the action log** under
  `identity: 'admin'` / name `app / chrome` (`mcp-server.js` records each call with `identity` +
  `sessionId`). The old CDP harness contributed **no** MCP session; the MCP harness contributes
  **one persistent admin session plus continuous log noise**. So every indicator/viewer
  count/list/log assertion in Steps 11–13 is **relative to a baseline that includes the harness's
  own admin session** — see those steps for the explicit accounting.
- **Two distinct targets (load-bearing for this spec):**
  - **Chrome target** (`getChromeTarget()` → chrome `wcId`): the Goldfinch chrome UI — the
    `#automation-indicator`, its `#automation-indicator-badge`, and its `title`/`aria-label`. Read
    via `readDom(wcId)` / `readAxTree(wcId)` / `captureWindow()`. The indicator lives in the chrome
    renderer, **NOT** in the settings guest.
  - **Internal guest target** (from `enumerateTabs` → the entry with `url: 'goldfinch://settings'`
    → its `wcId` as `guestWcId`): the `goldfinch://settings` `<webview>` guest — the entire
    `<section id="automation">` (enable toggle, address/port fields, Keys subsection,
    `#automation-active-sessions`, `#automation-activity-log`). Read via `readDom(guestWcId)` /
    `readAxTree(guestWcId)`; drive via `click(guestWcId, x, y)` / `typeText(guestWcId, …)` /
    `pressKey(guestWcId, …)`. **Do NOT use `getChromeTarget` for the settings-section content** —
    that is the internal-guest target. Keep the two `wcId`s straight per step.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over
  the MCP surface; element ids below (`#automation-enabled`, `#automation-copy-address`, …) name
  *which control* to locate visually, not a selector you can pass.
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold key/type into the bare
  document does not relocate focus. **Before any `typeText` or keyboard sequence into a field,
  establish a focus anchor by sending a `click(guestWcId, x, y)` into that field first.**
- **Property-vs-attribute rule (load-bearing — see AC3).** `readDom` returns the element's
  **`outerHTML`** — serialized **attributes**, which do NOT reflect a control's live **property**
  after interaction (a clicked checkbox's `.checked`, an input's edited `.value`). For
  post-interaction control state the **authoritative witness is the filesystem store read**
  (`automationEnabled` / `automationPort` / key hashes in `userData/settings.json`) — Steps 3/6/7
  assert these directly. A `readAxTree(guestWcId)` `checked`/`value` read is a **secondary
  UI-reflection check, degradable to `partial`**: the AX node's `checked` is a **string**
  (`"true"`/`"false"`, not a boolean), and AX-on-guest carrying `checked`/`value` is LIVE-UNKNOWN
  until leg-8 confirms it (`observe.js` flags guest AX as raw `getFullAXTree` output whose shape is
  not guaranteed). If the AX node lacks the property, **fall back to a re-render + `readDom`** (the
  re-rendered `outerHTML` then reflects the committed state) and mark the UI-reflection sub-read
  `partial`. Use `readDom` for **text content, `hidden`/`disabled` attributes, `title`/`aria-label`,
  and element presence** (these are attribute-serialized — correct over `readDom`).
- **The build includes** the leg-2–4 Automation section: the enable toggle, address/port/bind-status
  controls, the per-jar + admin key controls, and the activity indicator + audit viewer.
- **Admin-tier steps** require `GOLDFINCH_AUTOMATION_ADMIN` set in the launch env; without it, the
  admin block is expected hidden (the negative case in step 9).
- **Live-session staging (Steps 11–13) — the system under test, unchanged.** Using the minted jar
  key (and, with `GOLDFINCH_AUTOMATION_ADMIN`, the admin key), a minimal MCP client opens a session
  via a loopback `initialize` POST to `http://127.0.0.1:{port}/mcp` with
  `Authorization: Bearer <key>` (or the Flight-3 example client). **This staged session is the
  system under test, NOT the driving apparatus** — keep it exactly as written. It is distinct from
  the harness's own admin session that drives the reads.
- **Active-precondition probe** (Step 1): confirm `tools/list` shows **17 tools** including
  `getChromeTarget`, and `getChromeTarget()` returns a numeric chrome `wcId`. After opening
  Settings, confirm the `goldfinch://settings` guest is enumerable via `enumerateTabs` (the admin
  engine's `allowInternal` makes the internal guest visible; if it is absent, halt).
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its
  own browser and never touches this app (false pass). The apparatus is the SDK admin MCP client
  over `127.0.0.1:{port}`, app launched via `npm run dev:automation`. This is **not** the CDP attach
  path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP surface is
  used.

## Observables Required
- mcp (admin MCP tools — `readDom(guestWcId)` / `readAxTree(guestWcId)` for the rendered guest DOM
  of `goldfinch://settings` (the `#automation` section controls + their text/attributes; AX
  `checked`/`value` as a secondary UI-reflection check); `readDom(wcId)` / `readAxTree(wcId)` /
  `captureWindow()` for the chrome renderer's `#automation-indicator` + badge + `title`/`aria-label`;
  `enumerateTabs` for the guest `wcId` + the active-session list snapshot — all measured via the
  admin MCP client)
- filesystem (the **authoritative** post-interaction witness — `automationEnabled`,
  `automationPort`, and key hashes in `userData/settings.json`, read via Read/Bash)
- http (the loopback `initialize` POST to `/mcp` with a Bearer to stage the live session under test
  — measured via Bash/curl or the example client)
- shell (precondition probes: `tools/list` count and `getChromeTarget` result; the
  `AUTOMATION_DEV_MINT` stdout line — measured via the MCP client or Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; call `getChromeTarget()` and record `wcId`. | `tools/list` returns **17 tools** including `getChromeTarget`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. Else halt. |
| 2 | Open Settings via the kebab (take a `captureWindow()` screenshot; locate the kebab (⋮) button; `click(wcId, x, y)` to open the menu, then `click(wcId, x, y)` on the Settings item), or the identical trusted path `openTab('goldfinch://settings', null, {trusted:true})` — note which. Wait for load. Call `enumerateTabs` and identify the `goldfinch://settings` entry; record its `wcId` as `guestWcId`. Call `readDom(guestWcId)` and confirm the `#automation` section + its nav link render. | A `goldfinch://settings` tab opens (partition `goldfinch-internal`); `enumerateTabs` includes the entry (the admin engine's `allowInternal` makes the internal guest enumerable). Record `guestWcId`. The guest shows a `<section id="automation">` with an enable toggle, an address field, a port field, a Keys subsection, and an Activity area. |
| 3 | Read `automationEnabled` from `userData/settings.json` (filesystem — the **authoritative** state) and the toggle's AX `checked` via `readAxTree(guestWcId)` (the `#automation-enabled` node — *secondary UI-reflection check*). Establish a focus anchor with `click(guestWcId, x, y)` on the toggle and click it to flip. Re-read **both** (store + AX). | The persisted `automationEnabled` and the toggle's AX `checked` (string `"true"`/`"false"`) start consistent, flip together on click, and the **new persisted value matches** (filesystem read-back — authoritative). The AX-`checked` UI-reflection sub-read degrades to `partial` if the guest AX node lacks `checked` (fall back to a re-render + `readDom` of the section). `[a11y]` |
| 4 | Read `#automation-address.value`, `#automation-status` text, and `#automation-enabled-note` text via `readDom(guestWcId)` (these are attribute/text reads — correct over `readDom`). | The address reads exactly `http://127.0.0.1:{port}/mcp` (host `127.0.0.1`, the pinned `{port}`). `#automation-status` reflects reality with the verbatim prefixes: `Connected — listening on 127.0.0.1:{port}` when the MCP surface is bound this launch (it is — we launched `dev:automation`); `Not running — start Goldfinch with --automation-dev to bind the surface` when the surface isn't active; or `Failed to bind: <error>` on a bind failure. When bound, `#automation-enabled-note` is empty; when not bound it reads `Takes effect when Goldfinch is launched with --automation-dev.` (the SC8 honesty note). |
| 5 | Locate `#automation-copy-address` via `captureWindow()`; `click(guestWcId, x, y)`. Read the transient `#automation-message` via `readDom(guestWcId)`. | `#automation-message` shows "Copied" (the in-DOM witness; the clipboard itself is not an MCP observable, so the DOM message is the copy witness the spec relies on); no error. |
| 6 | Read `#automation-port.value` via `readDom(guestWcId)` and `automationPort` from the store (filesystem). Focus-anchor `click(guestWcId, …)` on the port field, `typeText(guestWcId, '80')` (out of range), locate + `click` `#automation-port-save`; read `#automation-message` + the **persisted** `automationPort` (filesystem). Then clear + `typeText(guestWcId, '{port}')` (valid), save; re-read the **persisted** value. | The pending field shows the stored `automationPort`. The out-of-range save shows an inline error ("Invalid port (1024–65535)") via `#automation-message` and does **NOT** change the persisted `automationPort` (filesystem read-back unchanged — authoritative). The valid save **persists** (filesystem read-back matches `{port}`) and shows no error. (No live rebind — change is next-launch by design.) |
| 7 | Locate `#automation-find-port` via `captureWindow()`; `click(guestWcId, x, y)`. Read `#automation-port.value` via `readDom(guestWcId)` + the **persisted** `automationPort` (filesystem). | The field is populated with a free loopback port in `49152–65535` and the value is **persisted** (filesystem read-back matches; or, if none free, an inline "no free port found" via `#automation-message` with the field unchanged). |
| 8 | In `#automation-jars`, find the `default` jar row; read its key-status text + the Revoke button's `disabled` attribute via `readDom(guestWcId)` (attribute reads — correct over `readDom`). Locate + `click(guestWcId, …)` its mint button (labeled **Generate key** while `!hasKey`); read `#automation-key-reveal` (present/hidden via `readDom`) + `#automation-key-value` (text via `readDom`); locate + `click` `#automation-key-copy`; re-read the row status + the mint-button label + Revoke `disabled` (all `readDom`). Click the same mint button (now **Rotate key**); confirm a NEW key in `#automation-key-value`. Click **Revoke**; re-read the row + reveal. Read **`automationEnabled` from the store** (filesystem). | Pre-mint: status `no key`, the **Revoke** button has `disabled` (`readDom`). Generate: `#automation-key-reveal` becomes present/visible with a non-empty one-time key in `#automation-key-value` (`readDom` text); copy succeeds; the row flips to `key set`, the mint button relabels to **Rotate key**, **Revoke** loses `disabled`. The persisted `automationEnabled` is now `true` (a side effect of `enableAndMintJarKey`) — **read it back from the store (authoritative)**; NOTE the `#automation-enabled` checkbox itself only re-syncs on the next settings load (the side-effect write does not broadcast `settings-changed`), so **assert the *stored* value, not the live checkbox**. Rotate: a different key is revealed and the row stays `key set`. Revoke: the row returns to `no key`, **Revoke** regains `disabled`, the reveal is cleared/hidden (all `readDom`). |
| 9 | Trigger a settings re-render / re-open the section; read `#automation-key-reveal` and `#automation-admin.hidden` via `readDom(guestWcId)` (presence + `hidden` attribute — correct over `readDom`). | The show-once key is NOT re-fetchable — after refresh `#automation-key-reveal` is hidden/empty (only the hash is stored). `#automation-admin` has `hidden` (`#automation-admin.hidden === true`) when `GOLDFINCH_AUTOMATION_ADMIN` is unset, and is present without `hidden` (block shown) when it is set. |
| 10 | (Admin-tier — only when `GOLDFINCH_AUTOMATION_ADMIN` set) Read `#automation-admin-status` via `readDom(guestWcId)`. Locate + `click(guestWcId, …)` `#automation-admin-mint`; read the reveal (`#automation-key-reveal`/`#automation-key-value`) + `#automation-admin-status` (`readDom`). Locate + `click` `#automation-admin-revoke`; re-read status. | Mint: the admin key is revealed once (+ copyable) and `#automation-admin-status` reads `Admin key set`; revoke returns it to `No admin key`. (Negative path when the env gate is unset is covered by step 9.) |
| 11 | **Stage a live jar session (system under test):** using the minted `AUTOMATION_DEV_MINT` jar key, POST an MCP `initialize` to `http://127.0.0.1:{port}/mcp` with `Authorization: Bearer <jar-key>`; **snapshot the staged session's `sessionId` + its jarId + its `since`** from the response / the viewer to disambiguate it from the harness admin row. Read the **chrome** `#automation-indicator` via `getChromeTarget`→chrome `wcId` + `readDom`/`readAxTree`/`captureWindow` (`.hidden`? `#automation-indicator-badge` text? `title`/`aria-label`). Read `#automation-active-sessions` + `#automation-activity-log` via the **settings-guest** `wcId` + `readDom`. | **Baseline = the harness admin session.** With the staged jar session attached: `#automation-indicator` is NOT `.hidden`; its badge count = **staged + 1 (the harness admin session)**; its `title`/`aria-label` reads `<n> automation session(s) connected: <name-list>` where the name-list **always includes the harness `admin` name** plus the staged jar's display name (wording "connected", names the jar). `#automation-active-sessions` lists **two rows** — the harness admin row AND the staged **jar** row; the **staged jar row** (identified by its snapshotted jarId/`since`, NOT "the only row") names its jar + shows a "since" time. `#automation-activity-log`: the staged session's `initialize`/tool entries appear **identified by the staged jarId** — NOT "the newest entry" (the **newest** rows are the harness's own `readDom`/`readAxTree`/`getChromeTarget` reads under `app / chrome` / `admin`; a runner should recognize that noise). **HAT-deferred (leg 9):** the absolute **empty-state** ("No automation sessions" / indicator hidden) is **NOT observable over the MCP surface** — every read is itself an admin session, so the harness is always ≥1 session — verified by the leg-9 HAT with the MCP harness disconnected (a human/dev-tools observer). *(Degradable to `partial` if a jar session cannot be staged in the run env — the cross-jar/admin/burner matrix is covered by `mcp-jar-scoping`; this step confirms a real session renders against the baseline.)* |
| 12 | (Stage an admin session under test) Open a **second** staged session with the **admin** Bearer (loopback `initialize` POST); **snapshot its `sessionId`/`since`** (it is `kind: 'admin'`, same kind as the harness — disambiguate by `sessionId`/`since`). Re-read the chrome `#automation-indicator` (`getChromeTarget`+`readDom`/`readAxTree`) + `#automation-active-sessions` (guest `wcId`+`readDom`). | The indicator **already carries `.admin`** (the harness admin session set it before this step — do **NOT** assert "the indicator *gains* `.admin`"). Assert instead that a **distinct staged admin row is added** to `#automation-active-sessions`: the viewer now lists the harness admin row, the staged jar row (Step 11), and the **staged admin row** — the staged admin row is marked with the `.admin` class and labeled `admin` (not via a jar name), distinct from the jar row, and is identified by its snapshotted `sessionId`/`since` (distinct from the harness admin row, which is also `kind: 'admin'`). The badge count rises by one (staged-jar + staged-admin + harness-admin). *(Degradable to `partial`; admin matrix lives in `mcp-jar-scoping`.)* |
| 13 | Close the staged session(s) — distinguish a **proper termination** (`transport.terminateSession()` → DELETE) from an **ungraceful disconnect** (process death / `client.close()` only). Re-read `#automation-active-sessions` (guest `wcId`+`readDom`) + the chrome `#automation-indicator` (`getChromeTarget`). | **Proper termination (DELETE) — the MCP-observable assertion:** the staged session is **removed** from `#automation-active-sessions` (identified by its snapshotted `sessionId`/jarId), and the list **returns to the harness-only baseline** (the harness admin row remains, since the harness is still connected) — this IS observable over the surface and is the real behavior under test. **HAT-deferred (leg 9):** the absolute **"returns to *No automation sessions*" + "indicator hides"** outcome is **NOT observable via the MCP surface** (the harness is always a live admin session), so it routes to the **leg-9 HAT** — a human/dev-tools observer watches the indicator hide when the last *real* session closes **with the MCP harness disconnected**. **Ungraceful disconnect (no DELETE):** the session legitimately **lingers** as "connected" until a DELETE or app restart — the SDK treats a dropped SSE stream as resumable, and `client.close()` tears down locally without a DELETE (DD6 transport-lifecycle wording). A run that can only stage ungraceful disconnects records this as a known limitation, not a fail. |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Steps 11–13's live-session checks
degrade to `partial`/`inconclusive` if a session can't be staged in the run environment; the UI-control
steps (2–10) fully verify SC9 + SC8 + the SC10 viewer's structure (against the harness baseline)
without a *staged* session. **Reflexivity caveat (Steps 11–13):** the harness's own admin session is
always present in the indicator count, the session list, the name-list, and (as the newest rows) the
action log — every count/list/log assertion is relative to that baseline, and the staged session is
identified by its snapshotted `sessionId`/jarId/`since`, never by "the only row" or "the newest entry".
The absolute zero-session / indicator-hidden frame is **HAT-verified (leg 9)** with the harness
disconnected — it cannot be observed over the MCP surface, which is itself a session.

## Out of Scope
- **MCP transport / auth internals** — the Bearer gate, 401s, loopback bind, Origin/Host allow-listing:
  covered by `mcp-auth-gating` and `mcp-loopback-origin-guard`.
- **The cross-jar scoping matrix** (a jar key seeing only its jar's tabs; internal-session exclusion;
  burner unautomatable; admin sees all): covered by `mcp-jar-scoping` (run in the same leg-6 pass).
- **Live rebind on a port change** — by design the port change takes effect on next launch, not live;
  this spec asserts persistence + the pending/active distinction, not a live rebind.
- **The full action-log fidelity** of every op type — the viewer is checked for structure + a real
  staged session's entries (identified by staged identity), not an exhaustive op catalog, and not the
  harness's own self-generated read entries.
- **The absolute indicator-hidden / zero-session state** — not observable over the MCP surface (the
  harness is always a live admin session); verified by the **leg-9 HAT** with the harness disconnected.

## Variants (optional)
- N/A for the draft. Could later parametrize across multiple jars (personal/work) once the cross-jar
  staging from `mcp-jar-scoping` is folded in, or add a no-`--automation-dev` variant asserting the
  whole section reads "Not running" honestly (note: that variant still has the harness admin session
  if driven over MCP — it would need the leg-9 HAT framing for a true zero-state read).
</content>
</invoke>
