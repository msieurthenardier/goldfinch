# Behavior Test: Automation page — toggle, address/port, keys, activity

**Slug**: `settings-automation`
**Status**: active
**Created**: 2026-06-15
**Last Run**: 2026-10-23-23-19-44 (pass — 14/14; Step 3 AX-before and Step 12 identification partial; see `settings-automation/runs/`)

> **Re-authored 2026-10-23 (squawk 0156).** Brought current to the `goldfinch://automation` page (sortie 05) and the
> `app.db` settings store: (1) every `settings.json` read is now a read-only `node:sqlite` query of the dev profile's
> `app.db` `documents` row `store = 'settings'` (recipe in Preconditions); (2) status/note strings are the ones
> `src/renderer/pages/automation.js` renders today (`Connected — listening on 127.0.0.1:{port}`, `Not running — turn on the
> Automation toggle to bind the surface`, `Failed to bind: …`, note `Binds the local automation surface.` / empty);
> (3) text/attribute vs property reads fixed (`<input>` `.value` and `.checked` are NOT in `readDom` `outerHTML` — read via
> `evaluate` on the guest); (4) dev-mode truth: `dev:automation` force-binds regardless of the toggle (dev-enable override), so
> toggle flips do not unbind; port Save/Find-free-port **live-rebind** (the old "takes effect next launch" claim is gone) and
> `GOLDFINCH_MCP_PORT` wins over the persisted port; (5) admin mint rotates the harness's own key (Step 10 reworked); (6) new
> final **Step 14 cleanup/restore** plus an Orchestrator snapshot/restore instruction. Slugs and Steps 1–13 numbering kept.

## Intent
Verify that the `goldfinch://automation` page (opened from the ⋯ menu → Automation) is a complete, self-service control
surface: the operator can turn the surface on/off, see the live MCP connection address + bind-status,
configure the listen port (with a "find free port" helper), generate / rotate / revoke a per-jar key
(show-once plaintext + copy) and — when env-gated — the admin key, and watch automation activity (a
visible chrome indicator + an on-page audit viewer). This needs a behavior test, not a unit test,
because the assertions are real-environment, cross-process UI observations: the Automation page renders
inside a guest WebContentsView on the privileged `goldfinch://` scheme (read/driven via the admin MCP
surface's `allowInternal` enumeration), the activity indicator lives in the chrome renderer (read via
`getChromeTarget`), and the indicator/viewer only populate against a **live MCP session** over the
loopback transport. It backs **SC9** (keys managed from the Automation page — generate / rotate / revoke, effective
immediately), the **visible half of SC10** (a visible "automation active" indicator that distinguishes
admin from jar and names the jar, plus an action-log viewer), and the **SC8 toggle UI** (the
off-by-default opt-in gets its operator-facing control).

## Preconditions
- **Apparatus — admin MCP surface.** Goldfinch is running via
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT={port} npm run dev:automation` (the
  npm script already carries `--automation-dev`; never pass that flag by hand). At launch the app prints one parseable
  `AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey>"}` line to stdout — capture **both** keys (shown once;
  `DEV_MINT` replaces the resolved-default jar's key hash and the admin hash, so a stale static config would 401). Attach
  with `connectAutomation({ key: adminKey, port })` from `scripts/lib/mcp-client.mjs` (env-key script model,
  `GOLDFINCH_MCP_ADMIN_KEY`) — **never** the registered `goldfinch-dev` MCP server. Launch states and key capture:
  `docs/dev-testing.md`. The MCP server listens on
  `127.0.0.1:{port}/mcp` (bound at launch by the **dev-enable override** whatever `automationEnabled` is — see Steps 3/4). One `dev:automation` instance serves **both** the harness's own driving
  session **and** the staged session(s) of Steps 11–13 (single instance; record which jar key stages
  which session).
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default
  `49707`; in an unpackaged build this env **wins over the persisted `automationPort`**, so pinning keeps the harness
  endpoint fixed while Steps 6/7 change the *persisted* port). The spec refers to it as `{port}` throughout, so the rendered address is predictable
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
  cannot see the internal `goldfinch://automation` guest (jar keys cannot reach internal sessions).
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
    renderer, **NOT** in the automation guest.
  - **Internal guest target** (from `enumerateTabs` → the entry with `url: 'goldfinch://automation'`
    → its `wcId` as `guestWcId`): the `goldfinch://automation` guest WebContentsView — the whole page: sections
    `#connection` (enable toggle, address/port fields), `#keys` (per-jar + admin keys) and `#activity`
    (`#automation-active-sessions`, `#automation-activity-log`). Read via `readDom(guestWcId)` /
    `readAxTree(guestWcId)`; drive via `click(guestWcId, x, y)` / `typeText(guestWcId, …)` /
    `pressKey(guestWcId, …)`. **Do NOT use `getChromeTarget` for the Automation-page content** —
    that is the internal-guest target. Keep the two `wcId`s straight per step.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click({ wcId, x, y })` located via a `captureWindow()` screenshot. There are no CSS selectors over
  the MCP surface; element ids below (`#automation-enabled`, `#automation-copy-address`, …) name
  *which control* to locate visually, not a selector you can pass. (The 2026-07-08 run found guest coordinate clicks
  unreliable on its WSLg venue: if they do not land, fall back to a synthetic DOM click via `evaluate` —
  `document.getElementById('<id>').click()` — which fires the same handlers, and mark the row `partial` for input
  fidelity only.)
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold key/type into the bare
  document does not relocate focus. **Before any `typeText` or keyboard sequence into a field,
  establish a focus anchor by sending a `click({ wcId: guestWcId, x, y })` into that field first.** To replace a field's
  content: anchor, `pressKey({ wcId, name: "a", modifiers: ["control"] })`, then `typeText({ wcId, text })`.
- **Property-vs-attribute rule (load-bearing — see AC3).** `readDom` returns the element's
  **`outerHTML`** — serialized **attributes**, which do NOT reflect a control's live **property**
  after interaction (a clicked checkbox's `.checked`) **nor any `<input>` value the page sets in script**
  (`#automation-address`, `#automation-port`, `#automation-key-value` are `<input>`s whose `.value` is set by
  `automation.js`, so it is absent from `outerHTML`). Read those with `evaluate` on the guest wcId, e.g.
  `evaluate({ wcId: guestWcId, expression: "document.getElementById('automation-port').value" })` (`evaluate` takes
  `expression`; a wrong key returns `{ok:true}` silently; admin reaches the internal guest, and `evaluate` does not
  activate the tab). Never echo `#automation-key-value` into a log — assert `.length > 0` and inequality between mints
  only. For post-interaction persisted state the **authoritative witness is the store read** (Preconditions recipe:
  `automationEnabled` / `automationPort` / key-name list) — Steps 3/6/7/8 assert these directly. A `readAxTree(guestWcId)` `checked`/`value` read is a **secondary
  UI-reflection check, degradable to `partial`**: the AX node's `checked` is a **string**
  (`"true"`/`"false"`, not a boolean), and AX-on-guest carrying `checked`/`value` is LIVE-UNKNOWN
  until leg-8 confirms it (`observe.js` flags guest AX as raw `getFullAXTree` output whose shape is
  not guaranteed). If the AX node lacks the property, **fall back to the `evaluate` property read** (`document.getElementById('automation-enabled').checked`) and mark the AX
  sub-read `partial`. Use `readDom` for **text content, `hidden`/`disabled` attributes, `title`/`aria-label`,
  and element presence** (these are attribute-serialized — correct over `readDom`).
- **Dev-profile store location + read recipe (load-bearing for every "store read" below).** Under `npm run dev:automation`
  the app is profile-isolated (`!app.isPackaged` → `app.setPath`), so `userData` is **`~/.config/goldfinch-dev`**, NOT the
  installed `~/.config/goldfinch`. There is **no `settings.json`**: settings live in `~/.config/goldfinch-dev/app.db`, table
  `documents(store PK, payload, updated_at)`, row `store = 'settings'`, `payload` = the settings JSON. The fields this spec
  uses: `automationEnabled` (boolean), `automationPort` (integer, default 49707), `automationKeyHashes` (object, jarId →
  hash), `automationAdminKeyHash` (string, `''` when none). **"Store read" in this spec means this query** (read-only, safe
  while the app runs — SQLite WAL readers never block the app's writer, and each settings write is one committed
  whole-document UPSERT, so a read right after the UI action sees it; if a read looks one step stale, re-run it once). It
  prints key *names* and a boolean, never hashes:
  ```sh
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.config/goldfinch-dev/app.db',{readOnly:true});const s=JSON.parse(db.prepare(\"SELECT payload FROM documents WHERE store='settings'\").get().payload);console.log(JSON.stringify({automationEnabled:s.automationEnabled,automationPort:s.automationPort,jarKeys:Object.keys(s.automationKeyHashes||{}).sort(),adminKeySet:!!s.automationAdminKeyHash}))" 2>/dev/null
  ```
  (Node ≥ 22; the `ExperimentalWarning` goes to stderr, hence `2>/dev/null`. Comparing against the prod profile
  `~/.config/goldfinch` mis-fires as a false mismatch.) Do **not** write to `app.db` while the app runs.
- **State hygiene (this spec mutates the dev profile: toggle, port, jar/admin keys).** Before launching the app (app NOT
  running), the Orchestrator takes a **B0 snapshot** of the four automation fields to a scratch file (mode 0600; it contains
  hashes — never paste it into a run log) and records `enabledStart` / `portStart` / `jarKeys` / `adminKeySet` from the recipe:
  ```sh
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.config/goldfinch-dev/app.db',{readOnly:true});const s=JSON.parse(db.prepare(\"SELECT payload FROM documents WHERE store='settings'\").get().payload);const {automationEnabled,automationPort,automationKeyHashes,automationAdminKeyHash}=s;require('fs').writeFileSync(process.argv[1],JSON.stringify({automationEnabled,automationPort,automationKeyHashes,automationAdminKeyHash}),{mode:0o600})" <scratch>/automation-b0.json 2>/dev/null
  ```
  Step 14 restores toggle/port/keys in-app; **after the run, once the app has fully quit**, the Orchestrator restores B0 exactly
  (the launch's `DEV_MINT` mint replaces the default jar's key hash and the admin hash, which Step 14 cannot recover):
  ```sh
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.config/goldfinch-dev/app.db');const snap=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const r=db.prepare(\"SELECT payload FROM documents WHERE store='settings'\").get();const s=Object.assign(JSON.parse(r.payload),snap);db.prepare('UPDATE documents SET payload=?2, updated_at=?3 WHERE store=?1').run('settings',JSON.stringify(s,null,2),Date.now())" <scratch>/automation-b0.json 2>/dev/null
  ```
  then re-run the read recipe and confirm it equals B0. (Both snapshot/restore recipes were verified against a copy of the dev
  profile's `app.db`; never run the restore while the app is running.)
- **The build includes** the leg-2–4 Automation controls (now the `goldfinch://automation` page): the enable toggle, address/port/bind-status
  controls, the per-jar + admin key controls, and the activity indicator + audit viewer.
- **Admin-tier steps** require `GOLDFINCH_AUTOMATION_ADMIN` set in the launch env; without it, the
  admin block is expected hidden (the negative case in step 9). **Admin-key self-lockout (load-bearing):** the harness
  authenticates with the admin key and the gate re-validates the Bearer hash **per request**, so an admin mint/rotate or
  revoke from the page invalidates the harness's own key on its *next* request. Step 10 therefore does mint + read inside
  a single `evaluate` call and reconnects with the new key; the admin **revoke** is deferred to the very end of Step 14.
- **Live port rebind drops sessions.** `automation:set-port` persists the port and **live-rebinds** (stop → start), which
  tears down every live MCP session. After each Save / Find-free-port (Steps 6/7/14) the Executor reconnects
  (`connectAutomation`, same key, same pinned port — keys survive) and re-runs `enumerateTabs` (wcIds are unchanged).
  Record whether the old session survived.
- **Staged-session key.** The Step 11 staged jar session uses the jar key printed by `DEV_MINT` (the resolved-default jar —
  `personal` on the current dev profile; confirm from the jars store). **Steps 8 and 14 must not mint/rotate/revoke that
  jar** (use a different jar), or the staged key dies.
- **Live-session staging (Steps 11–13) — the system under test, unchanged.** Using the minted jar
  key (and, with `GOLDFINCH_AUTOMATION_ADMIN`, the admin key), a minimal MCP client opens a session
  via a loopback `initialize` POST to `http://127.0.0.1:{port}/mcp` with
  `Authorization: Bearer <key>` (or the Flight-3 example client). **This staged session is the
  system under test, NOT the driving apparatus** — keep it exactly as written. It is distinct from
  the harness's own admin session that drives the reads.
- **Active-precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an exact count) the tools this spec drives:
  `getChromeTarget`, and `getChromeTarget()` returns a numeric chrome `wcId`. After opening
  the Automation page, confirm the `goldfinch://automation` guest is enumerable via `enumerateTabs` (the admin
  engine's `allowInternal` makes the internal guest visible; if it is absent, halt).
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its
  own browser and never touches this app (false pass). The apparatus is the SDK admin MCP client
  over `127.0.0.1:{port}`, app launched via `npm run dev:automation`. This is **not** the CDP attach
  path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP surface is
  used.

## Observables Required
- mcp (admin MCP tools — `readDom(guestWcId)` / `readAxTree(guestWcId)` for the rendered guest DOM
  of `goldfinch://automation` (the `#connection`/`#keys`/`#activity` section controls + their text/attributes; AX
  `checked`/`value` as a secondary UI-reflection check); `readDom(wcId)` / `readAxTree(wcId)` /
  `captureWindow()` for the chrome renderer's `#automation-indicator` + badge + `title`/`aria-label`;
  `enumerateTabs` for the guest `wcId` + the active-session list snapshot — all measured via the
  admin MCP client)
- sqlite store (the **authoritative** post-interaction witness — `automationEnabled`, `automationPort`, and the
  key-name list / `adminKeySet` in the dev profile's `app.db` `documents` row `store = 'settings'`, read with the
  read-only recipe in Preconditions via Bash)
- http (the loopback `initialize` POST to `/mcp` with a Bearer to stage the live session under test
  — measured via Bash/curl or the example client)
- shell (precondition probes: `tools/list` and `getChromeTarget` result; the
  `AUTOMATION_DEV_MINT` stdout line; the B0 snapshot/restore — measured via the MCP client or Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** (Orchestrator, before launch: B0 snapshot + record `enabledStart`/`portStart`/`jarKeys`/`adminKeySet` via the Preconditions recipes.) Connect the admin MCP client (`connectAutomation`); call `tools/list`; call `getChromeTarget()` and record `wcId`. Run the store-read recipe and record the post-launch **B1** values (`DEV_MINT` has replaced the default jar's key hash and the admin hash). | `tools/list` **includes** (presence-checked, not an exact count) the tools this spec drives (`getChromeTarget`, `enumerateTabs`, `readDom`, `readAxTree`, `captureWindow`, `evaluate`, `click`, `typeText`, `pressKey`). `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. The store read returns a JSON line with `automationEnabled`, `automationPort`, `jarKeys`, `adminKeySet` (`true` under `GOLDFINCH_AUTOMATION_ADMIN`). Else halt. |
| 2 | Open the Automation page via the trusted chrome path — `evaluate({ wcId: <chrome wcId>, expression: "createTab('goldfinch://automation', null, { trusted: true })" })` (the same call the kebab → Automation action makes; the kebab sheet is unobservable, so the real menu click — ⋯ → Automation — is [by-eye]/HAT) — note which. Wait for load. Call `enumerateTabs` and identify the `goldfinch://automation` entry; record its `wcId` as `guestWcId`. Call `readDom(guestWcId)` and confirm the three sections + their nav links render. | A `goldfinch://automation` tab opens (partition `goldfinch-internal`); `enumerateTabs` includes the entry (the admin engine's `allowInternal` makes the internal guest enumerable). Record `guestWcId`. The guest shows an `<h1>Automation</h1>`, `<section id="connection">` (enable toggle `#automation-enabled`, `#automation-address`, `#automation-port`), `<section id="keys">` and `<section id="activity">`, plus a `<nav aria-label="Automation sections">` with Connection/Keys/Activity links. |
| 3 | Read `automationEnabled` from the store (recipe — the **authoritative** state; this is `enabledStart` unless the launch changed it) and the toggle's live state via `evaluate(guestWcId, "document.getElementById('automation-enabled').checked")` (plus the AX `checked` via `readAxTree(guestWcId)` — *secondary*). Read `#automation-status` text via `readDom` before and after the flip. Establish a focus anchor with `click({ wcId: guestWcId, x, y })` on the toggle and click it to flip. Re-read store, `.checked`, AX, `#automation-status`, and confirm the harness is still connected (`enumerateTabs` succeeds without reconnecting). | The persisted `automationEnabled` and the toggle's `.checked` start consistent (the page seeds the checkbox from the persisted value, not from the effective-bound state), flip together on click, and the **new persisted value matches** (store read-back — authoritative). **Dev-mode truth (dev-enable override, `devEnableOverride` in `mcp-server.js`/`toggle.js`):** a flip-OFF does **not** unbind in `dev:automation` and a flip-ON is a no-op re-bind, so in **both** directions `#automation-status` stays `Connected — listening on 127.0.0.1:{port}` and the harness session survives — assert that (it is what dev mode actually does; the production teardown-on-OFF / cold-start-on-ON is packaged-build behavior, out of scope here). The AX-`checked` sub-read (string `"true"`/`"false"`) degrades to `partial` if the guest AX node lacks `checked`. `[a11y]` |
| 4 | Read `#automation-address` `.value`, `#automation-port` `.value` (both via `evaluate` — `<input>` values are not in `outerHTML`), and `#automation-status`, `#automation-enabled-note`, `#automation-mcp-config` text via `readDom(guestWcId)`. | The address reads exactly `http://127.0.0.1:{port}/mcp` (host `127.0.0.1`, the pinned `{port}`). `#automation-status` reads `Connected — listening on 127.0.0.1:{port}` — the surface is bound this launch (dev force-bind, regardless of the toggle) — and `#automation-enabled-note` is empty (`''`, because the status carries `enabled: true`). `#automation-mcp-config` contains the JSON `{ "mcpServers": { "goldfinch": { "type": "http", "url": "http://127.0.0.1:{port}/mcp", "headers": { "Authorization": "Bearer <your-key>" } } } }` (literal placeholder, never a real key). **Not observable on this apparatus:** the other status renderings — `Not running — turn on the Automation toggle to bind the surface` with note `Binds the local automation surface.` (surface unbound), and `Failed to bind: <error>` (enabled but bind failed) — because the harness itself requires the bound surface; they are unreachable under `dev:automation` and are covered by a packaged build / `[by-eye]`/HAT only. Do not report their absence as a fail. |
| 5 | Locate `#automation-copy-address` via `captureWindow()`; `click({ wcId: guestWcId, x, y })`. Read `#automation-message` via `readDom(guestWcId)`. Then locate `#automation-copy-config`, click it, and re-read `#automation-message`. | `#automation-message` shows `Copied` after each click (the in-DOM witness; the clipboard itself is not an MCP observable). `Copy failed` is a FAIL (both the web clipboard and the `clipboardWrite` IPC fallback failed); no error text. |
| 6 | Read `#automation-port` `.value` (via `evaluate`) and `automationPort` from the store. Pick `{altPort}` = a valid port in `1024–65535` that differs from both `portStart` and `{port}` (e.g. `51873`). Focus-anchor `click` on the port field and enter `80` (out of range): read `#automation-port-save` `disabled` (`readDom`) and the **persisted** `automationPort`; do not synthesize a click on a disabled control. Then replace the content with `{altPort}`, confirm Save enables, click it, read `#automation-message`, `#automation-status`, the port field `.value`, and the **persisted** value. Reconnect the harness if its session dropped (rebind). | The field initially shows the stored `automationPort` (Save disabled — not dirty). With out-of-range input Save is `disabled` and the persisted port is unchanged (store read-back — authoritative); the defensive `Invalid port (1024–65535)` message stays unit/bridge-covered for callers that bypass UI validation. Valid `{altPort}` enables Save; click persists it (**store read-back equals `{altPort}`**) and `#automation-message` reads `Saved`. **Live rebind, not next-launch:** the server stop/starts immediately; because `GOLDFINCH_MCP_PORT` wins over the persisted port in dev, the bound port stays `{port}`, so `#automation-status` stays `Connected — listening on 127.0.0.1:{port}`, the address still reads `…:{port}/mcp`, the port field resets to `{port}` (the page re-seeds from the bound status) and Save is `disabled` again — the **persisted** value is `{altPort}` while the **bound** port is `{port}`. The live session may be dropped by the rebind (reconnect and note it). |
| 7 | Locate `#automation-find-port` via `captureWindow()`; `click({ wcId: guestWcId, x, y })`. Read `#automation-message`, `#automation-port` `.value` (via `evaluate`) and the **persisted** `automationPort` (store). Reconnect the harness if needed. | The persisted `automationPort` is now a free loopback port `{freePort}` in `49152–65535` (store read-back — authoritative; it differs from `{altPort}` unless that was the first free port) and `#automation-message` reads `Saved`; the bound port is still `{port}` (env wins), so the field/address show `{port}`. If no port is free, `#automation-message` reads `no free port found` and the persisted value is unchanged. |
| 8 | **Precondition: the toggle is ON** (Step 3 flipped `automationEnabled` from `enabledStart`; read the store; if it is OFF, click the toggle ON here so the DD9 gate permits minting). Read the persisted `automationEnabled` (record `enabledBefore`) and the store's `jarKeys`. In `#automation-jars`, pick a persistent jar row that is **not** the resolved-default jar (Preconditions) and preferably has **no key** (on the current dev profile the `test` jar); read its `.jar-key-status` text + the mint button's label/`disabled` + the Revoke button's `disabled` via `readDom(guestWcId)`. Locate + `click` its mint button (**Generate key** while `!hasKey`); read `#automation-key-reveal` (`hidden` attribute via `readDom`) and `#automation-key-value` `.length` (via `evaluate`, never the value); locate + `click` `#automation-key-copy` and read `#automation-key-message`; re-read the row status, the mint label and Revoke `disabled`. Click the same mint button (now **Rotate key**); confirm a NEW key (compare `.length > 0` and inequality of the two values inside one `evaluate`, returning only a boolean). Click **Revoke**; re-read the row + reveal. Read the store (`automationEnabled`, `jarKeys`) after each action. | **DD9 gate:** with the toggle ON the **mint** button has no `disabled`. Pre-mint: status `no key`, **Revoke** has `disabled`. Generate: `#automation-key-reveal` loses `hidden` with a non-empty one-time key in `#automation-key-value`; copy shows `Copied` in `#automation-key-message` (not `#automation-message`); the row flips to `key set`, the mint button relabels to **Rotate key**, **Revoke** loses `disabled`, and the store's `jarKeys` gains the jar. **DD3 (Flight 8): minting does NOT change `automationEnabled`** — every post-action store read **equals `enabledBefore`**; the `#automation-enabled` checkbox does not flip. Rotate: a different key is revealed, the row stays `key set`, `jarKeys` unchanged. Revoke: the row returns to `no key`, **Revoke** regains `disabled`, the reveal is cleared (`hidden` again, value emptied), the jar leaves `jarKeys`; `automationEnabled` is **still** `enabledBefore`. (If every non-default jar already has a key, run Rotate/Revoke only on a jar whose key the run created, or mark the row `partial` — never touch the staged-session jar.) |
| 9 | Reload the page via `evaluate(guestWcId, "location.reload()")` (the `reload` tool refuses internal tabs) and re-`readDom(guestWcId)`; read `#automation-key-reveal` and `#automation-admin` `hidden` attributes. | The show-once key is NOT re-fetchable — after reload `#automation-key-reveal` has `hidden` and its value is empty (only the hash is stored). `#automation-admin` has `hidden` when `GOLDFINCH_AUTOMATION_ADMIN` is unset, and is present without `hidden` (block shown) when it is set (this run: shown). |
| 10 | (Admin-tier — only when `GOLDFINCH_AUTOMATION_ADMIN` set) Read `#automation-admin-status` and the mint button label via `readDom(guestWcId)`. Because the harness is authenticated by the admin key being rotated, do the mint **in ONE `evaluate` call on `guestWcId`** that clicks `#automation-admin-mint`, awaits the re-render (poll up to ~2 s for `#automation-key-reveal` to lose `hidden`), and returns `{ revealed: <bool>, keyLength: <n>, status: <#automation-admin-status text>, label: <mint button text>, adminKey: <#automation-key-value .value> }` (the key is returned to the Executor only, never logged). Store-read `adminKeySet`. **Reconnect** with the returned `adminKey` (`connectAutomation({ key: adminKey, port })`) and re-`enumerateTabs`; this is now the admin key for Steps 11–14. Do **not** revoke here (see Step 14). | Mint: the admin key is revealed once (`revealed: true`, `keyLength > 0`), `status` reads `Admin key set`, the mint label reads `Rotate admin key` (it was already `Rotate admin key` when an admin key pre-existed — record), the store shows `adminKeySet: true`. The old harness key is now rejected (a 401 on a probe with the old key is the **expected** self-lockout, not a fail); the new key authenticates. The admin **revoke** (status → `No admin key`, button → `Generate admin key`) is asserted at the end of Step 14. (Negative path when the env gate is unset is covered by Step 9.) |
| 11 | **Stage a live jar session (system under test):** using the `AUTOMATION_DEV_MINT` jar key (the resolved-default jar's key, untouched by Steps 8/14), POST an MCP `initialize` to `http://127.0.0.1:{port}/mcp` with `Authorization: Bearer <jar-key>`; **snapshot the staged session's `sessionId` + its jarId + its `since`** from the response / the viewer to disambiguate it from the harness admin row. Read the **chrome** `#automation-indicator` via `getChromeTarget`→chrome `wcId` + `readDom`/`readAxTree`/`captureWindow` (`.hidden`? `#automation-indicator-badge` text? `title`/`aria-label`). Read `#automation-active-sessions` + `#automation-activity-log` via the **automation-guest** `wcId` + `readDom`. | **Baseline = the harness admin session.** With the staged jar session attached: `#automation-indicator` is NOT `.hidden`; its badge count equals the number of **persistent jar keys currently enabled** (the admin key and every live-session row are excluded from this badge). Its `title`/`aria-label` keeps persisted authorization and live activity distinct: `<n> jar(s) automation-enabled — connected: <name-list>` (`n` = the number of jar keys in the store, i.e. `Object.keys(automationKeyHashes).length`; singular `jar` when `n === 1`; read from the chrome's `#automation-indicator` `title`/`aria-label`, which are identical), where the connected name-list includes the harness `admin` identity plus the staged jar's display name (wording "connected", names the jar). `#automation-active-sessions` is the authoritative live-session count and lists **two rows** — the harness admin row AND the staged **jar** row; the **staged jar row** (identified by its snapshotted jarId/`since`, NOT "the only row") names its jar + shows `connected since <time>`. `#automation-activity-log`: the staged session's `initialize`/tool entries appear **identified by the staged jarId** — NOT "the newest entry" (the **newest** rows are the harness's own `readDom`/`readAxTree`/`getChromeTarget` reads under `app / chrome` / `admin`; a runner should recognize that noise). **HAT-deferred (leg 9):** the absolute **empty-state** (`No automation sessions` / indicator hidden) is **NOT observable over the MCP surface** — every read is itself an admin session, so the harness is always ≥1 session — verified by the leg-9 HAT with the MCP harness disconnected (a human/dev-tools observer). *(Degradable to `partial` if a jar session cannot be staged in the run env — the cross-jar/admin/burner matrix is covered by `mcp-jar-scoping`; this step confirms a real session renders against the baseline.)* |
| 12 | (Stage an admin session under test) Open a **second** staged session with the **current admin** Bearer (the key from Step 10; loopback `initialize` POST); **snapshot its `sessionId`/`since`** (it is `kind: 'admin'`, same kind as the harness — disambiguate by `sessionId`/`since`). Re-read the chrome `#automation-indicator` (`getChromeTarget`+`readDom`/`readAxTree`) + `#automation-active-sessions` (guest `wcId`+`readDom`). | The indicator **already carries `.admin`** (the harness admin session set it before this step — do **NOT** assert "the indicator *gains* `.admin`"). Assert instead that a **distinct staged admin row is added** to `#automation-active-sessions`: the viewer now lists the harness admin row, the staged jar row (Step 11), and the **staged admin row** — the staged admin row is marked with the `.admin` class and labeled `admin` (not via a jar name), distinct from the jar row, and is identified by its snapshotted `sessionId`/`since` (distinct from the harness admin row, which is also `kind: 'admin'`). The badge count remains the enabled persistent-jar-key count from Step 11 (admin sessions never increment it), while the `title`/`aria-label` connected name-list gains the distinct staged `admin` identity. *(Degradable to `partial`; admin matrix lives in `mcp-jar-scoping`.)* |
| 13 | Close the staged session(s) — distinguish a **proper termination** (`transport.terminateSession()` → DELETE) from an **ungraceful disconnect** (process death / `client.close()` only). Re-read `#automation-active-sessions` (guest `wcId`+`readDom`) + the chrome `#automation-indicator` (`getChromeTarget`). | **Proper termination (DELETE) — the MCP-observable assertion:** the staged session is **removed** from `#automation-active-sessions` (identified by its snapshotted `sessionId`/jarId), and the list **returns to the harness-only baseline** (the harness admin row remains, since the harness is still connected) — this IS observable over the surface and is the real behavior under test. **HAT-deferred (leg 9):** the absolute **"returns to *No automation sessions*" + "indicator hides"** outcome is **NOT observable via the MCP surface** (the harness is always a live admin session), so it routes to the **leg-9 HAT** — a human/dev-tools observer watches the indicator hide when the last *real* session closes **with the MCP harness disconnected**. **Ungraceful disconnect (no DELETE):** the session legitimately **lingers** as "connected" until a DELETE or app restart — the SDK treats a dropped SSE stream as resumable, and `client.close()` tears down locally without a DELETE (DD6 transport-lifecycle wording). A run that can only stage ungraceful disconnects records this as a known limitation, not a fail. |
| 14 | **Cleanup / restore (final step — returns the dev profile to its start state).** In this order, using `evaluate(guestWcId, …)` against the page bridge (each call awaited; reconnect after a port change): (a) `window.goldfinchInternal.automationSetPort(<portStart>)` (restores the persisted port; live-rebinds; reconnect) — if `portStart` equals the currently bound port this is still valid; (b) revoke every jar key present in the store that was **not** in `B1` (the run's mints) via `window.goldfinchInternal.automationJarKeyRevoke('<jarId>')` — normally none remain after Step 8; (c) `window.goldfinchInternal.settingsSet('automationEnabled', <enabledStart>)` (restores the toggle; dev override keeps the surface bound either way); (d) store-read and compare `automationEnabled`/`automationPort`/`jarKeys` to `enabledStart`/`portStart`/`B1.jarKeys`; (e) **last**, because it locks the harness out: in ONE `evaluate` call click `#automation-admin-revoke`, wait ~1 s, and return `#automation-admin-status` text + the mint button label. Then (Orchestrator, harness disconnected) store-read `adminKeySet`; quit the app; once it has fully exited run the **B0 restore** recipe (Preconditions) and re-run the read recipe to confirm B0. | (a)–(d): `automationPort === portStart`, `automationEnabled === enabledStart` and `jarKeys` equals `B1.jarKeys` (store read-back — authoritative), with no extra keys left behind. (e): admin revoke succeeds — status `No admin key`, mint label `Generate admin key`, `adminKeySet: false` in the store (revoke never touches `automationEnabled`). After the B0 restore the four automation fields equal the pre-launch snapshot (so the next launch's bind/port is unchanged). If the run aborted early, the Orchestrator still performs the B0 restore. |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Step 14 is a state-restore row (run it even after a failure). Steps 11–13's live-session checks
degrade to `partial`/`inconclusive` if a session can't be staged in the run environment; the UI-control
steps (2–10) fully verify SC9 + SC8 + the SC10 viewer's structure (against the harness baseline)
without a *staged* session. **Reflexivity caveat (Steps 11–13):** the harness's own admin session is
always present in the session list, connected name-list, and (as the newest rows) the action log, but
never in the indicator badge (which counts enabled persistent jar keys only). Every viewer/list/log
assertion is relative to that harness baseline, and the staged session is
identified by its snapshotted `sessionId`/jarId/`since`, never by "the only row" or "the newest entry".
The absolute zero-session / indicator-hidden frame is **HAT-verified (leg 9)** with the harness
disconnected — it cannot be observed over the MCP surface, which is itself a session.

## Out of Scope
- **MCP transport / auth internals** — the Bearer gate, 401s, loopback bind, Origin/Host allow-listing:
  covered by `mcp-auth-gating` and `mcp-loopback-origin-guard`.
- **The cross-jar scoping matrix** (a jar key seeing only its jar's tabs; internal-session exclusion;
  burner unautomatable; admin sees all): covered by `mcp-jar-scoping` (run in the same leg-6 pass).
- **Packaged-build bind semantics** — toggle-OFF teardown, toggle-ON cold start, the `Not running` / `Failed to bind`
  renderings, and port changes moving the bound port (impossible here: `GOLDFINCH_MCP_PORT` wins in dev). This spec
  asserts persistence + the dev-mode behavior (force-bound surface, live rebind drops sessions, persisted ≠ bound).
- **The full action-log fidelity** of every op type — the viewer is checked for structure + a real
  staged session's entries (identified by staged identity), not an exhaustive op catalog, and not the
  harness's own self-generated read entries.
- **The absolute indicator-hidden / zero-session state** — not observable over the MCP surface (the
  harness is always a live admin session); verified by the **leg-9 HAT** with the harness disconnected.

## Variants (optional)
- N/A for the draft. Could later parametrize across multiple jars (personal/work) once the cross-jar
  staging from `mcp-jar-scoping` is folded in. A "surface off" variant (status `Not running — turn on the Automation
  toggle to bind the surface`, note `Binds the local automation surface.`) is only reachable in a packaged build with the
  toggle off — not drivable over MCP (the harness needs the bound surface), so it is a `[by-eye]`/HAT check.
