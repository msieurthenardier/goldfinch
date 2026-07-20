# Goldfinch MCP Automation Surface

A consumer reference for Goldfinch's local automation server — an [MCP](https://modelcontextprotocol.io)
(Model Context Protocol) server that lets an external agent **drive** (navigate / click / type /
scroll / keypress) and **observe** (screenshot / window capture / DOM read / accessibility tree)
the browser's tabs over a loopback HTTP transport.

> **Status: shipped, off by default.** The automation surface is part of the installed Goldfinch.
> It is **bound by the Settings `automationEnabled` toggle** — a human flips it on under
> `goldfinch://settings` → **Automation**, and nothing binds or is reachable until they do. The
> surface stays **opt-in, per-jar-key authenticated, loopback-only, and Origin/Host-guarded**
> regardless. (`--automation-dev` remains a dev-only convenience that force-binds an unpackaged dev
> run — a complete no-op on a packaged build; see Launch.)

## Overview

The server is built on the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`, Goldfinch's
first and only runtime dependency). It speaks **Streamable HTTP** with a stateful session model,
binds to **loopback only** (`127.0.0.1`), and advertises **34 tools** — 18 drive tools, 4
observe tools, 2 eval tools, 2 devtools tools, 3 admin chrome/app-level tools (`getChromeTarget`
+ `enumerateWindows` + `downloadsList`), 1 history tool (`getHistory`, jar-confined — not
admin-only), and 4 **vault tools** (`vaultUnlock` / `vaultList` / `vaultTotp` / `vaultFill` — the
**fill-only** password-vault surface). The first 30 tools are a
thin adapter over Goldfinch's
internal automation engine; the same
security guards that protect the engine (URL safety, handle resolution) apply unchanged. The 4
vault tools are **non-engine-op**: they dispatch to a per-session vault context, cryptographically
scoped by the session's identity (see *Vault tools*).

## Consumer Contract

These are the stable guarantees an external consumer can build against. Each links to the section
that documents it in full; the summary below is the authority phrasing from the status block above.

| Guarantee | Detail |
|---|---|
| **Off by default / opt-in** | Nothing binds until a human flips the `automationEnabled` toggle on in Settings. There is no programmatic enable path. See *Settings controls* and *Authentication*. |
| **Per-jar key-gated** | Every request must present `Authorization: Bearer <key>`. Keys are per-jar (a key authorises only its own jar's tabs) and shown once at mint. A separate **admin tier** is available when `GOLDFINCH_AUTOMATION_ADMIN` is set in the environment and an admin key has been minted. See *Authentication*. |
| **Loopback-only bind** | The server binds `127.0.0.1` only — never `0.0.0.0` or `::`. See *Endpoint*. |
| **Inject-then-run / no-persistence pairing** | `injectScript` makes no persistence guarantee across subsequent `evaluate` calls; pair them immediately in sequence. See *Eval tools*. |
| **Internal-session (`goldfinch://settings`) always excluded** | Both eval tools and both DevTools tools refuse the internal session — even for admin. See the security-invariant blocks under *Eval tools* and *DevTools tools*. |
| **Result / refusal error contract** | `openTab null` and `readAxTree debugger-unavailable` are normal results, not errors. Only a genuine engine throw sets `isError: true`. See *Result and refusal semantics*. |

**Reach boundary.** Goldfinch binds `127.0.0.1` only. Reaching that loopback from the consumer's
process is the **consumer's concern** — no shim or proxy is provided. When the consumer's process
runs on the same host as Goldfinch (the typical case), loopback is reachable directly. For
containerised consumers (WSL2, Docker) the consumer must arrange a route to the host's loopback —
e.g. the host-gateway IP on Linux Docker, or host network mode.

### Production getting-started

> **This is the production path for an installed Goldfinch binary.** For dev/dogfooding (unpackaged
> builds, script harnesses), see the [`AUTOMATION_DEV_MINT` mechanism](#dogfooding--dev-key-acquisition-the-automation_dev_mint-mechanism)
> under *Launch*. The two paths are mutually exclusive — `AUTOMATION_DEV_MINT` is a no-op on a
> packaged build.

**Steps:**

1. **Enable the automation surface first.** In the running Goldfinch, open `goldfinch://settings` →
   **Automation** and turn on the **Enable automation surface** toggle. The server binds immediately.
   The live address appears in the address field below the toggle — copy it from there (see
   *Settings controls*). **The Keys mint button is disabled while the toggle is off** — you must
   flip the toggle before minting a key.

2. **Choose your target jar.** Each key authorises one jar's tabs. The dev auto-mint (below)
   follows the live default flag — the legacy `default` jar on a profile migrated from a
   pre-v2 install until the operator moves it, `Personal` on a fresh install (a fresh install
   seeds **Personal** + **Work**). To mint by hand instead, in the **Keys** section of the
   Automation settings, select the jar you want to automate and mint a key. The plaintext is
   shown once — copy it immediately (see *Authentication*).

3. **Add a `.mcp.json` entry in your MCP client's config.** Add the following entry to **your own**
   MCP client config (Claude Code's `.mcp.json`, Cursor's MCP config, etc.) — **not** to Goldfinch's
   repo `.mcp.json`, which ships with an empty `mcpServers` map by design:

   ```json
   "goldfinch": { "type": "http", "url": "http://127.0.0.1:49707/mcp" }
   ```

   Substitute the live port shown in Settings (see *`.mcp.json` registration*). The entry is inert
   until the surface is enabled and the app is running.

4. **Run your client with the key.** Pass the minted per-jar key to your client via the
   `GOLDFINCH_MCP_KEY` env var. For the bundled example client (see *Example client*):

   ```bash
   GOLDFINCH_MCP_KEY=<your-per-jar-key> node scripts/mcp-example-client.mjs
   ```

   For Claude Code / Cursor, the key is presented in the `.mcp.json` entry or via your client's
   auth configuration; consult your MCP client's documentation for `Authorization: Bearer` header
   configuration.

## Launch

**Production (the installed binary).** The MCP server binds on the **Settings `automationEnabled`
toggle**. Open `goldfinch://settings` → **Automation** and turn the toggle on; the server starts
immediately (no relaunch). The toggle is the **sole bind gate** — it governs both the launch-time
bind (the persisted value is read at startup) and the live bind (flipping it on/off starts/stops the
running server). Off is the safe default. Enablement is **human-only**: there is no programmatic
enable path, and minting a key does **not** enable the surface.

**Dev convenience.**

```bash
npm run dev:automation
```

This is `electron . --enable-logging --no-sandbox --automation-dev`. `--automation-dev` is a
**dev-only force-bind** (it also satisfies the auth gate's enable side, wires the dev-invoke seam,
and unlocks the env-gated auto-mint) — a convenience for headless drives that binds an unpackaged
dev run **regardless of the persisted toggle**, *without writing the setting* (the persisted
`automationEnabled` stays whatever it was — human-only enablement is preserved). It is **a complete
no-op on a packaged build**: every call site ANDs `!app.isPackaged`, so a shipped binary ignores the
flag entirely. The MCP surface is structurally independent of any legacy CDP path — the ungated CDP
debugging launch was removed in F9, so `--automation-dev` is the sole dev-automation switch. Dev runs are **profile-isolated** — an unpackaged launch points
`userData` at a sibling `…/goldfinch-dev` directory (`app.setPath` when `!app.isPackaged`), so dev
keys/settings never touch the installed profile.

### Dogfooding / dev key acquisition (the `AUTOMATION_DEV_MINT` mechanism)

A standalone Node script (`scripts/a11y-audit.mjs`, the farbling driver, an external
agent harness) cannot reach the app's IPC to mint itself a key. The **dev-only**
auto-mint affordance bridges that gap: launching with **both** `--automation-dev`
(via `npm run dev:automation`) **and** `GOLDFINCH_AUTOMATION_DEV_MINT=1` makes the app
mint a key on startup and print **one** parseable line to stdout:

```
AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey|null>"}
```

- `key` — a freshly minted key for the **resolved default jar** (whichever jar currently
  holds the default flag — the legacy `default` jar on a profile migrated from a pre-v2
  install, `Personal` on a fresh install, or wherever the operator has since moved the
  flag). When the resolved default is **Burner** (an emptied jar registry — no persistent
  jars left), the jar mint is skipped with one parseable stderr notice
  (`[mcp] dev auto-mint skipped: default is Burner (no persistent jars)`) and `key` is
  `null` in the printed line; the surface still binds.
- `adminKey` — the **admin** key, minted **only** when `GOLDFINCH_AUTOMATION_ADMIN=1` is
  also set; otherwise `null`.

It is **double-gated and dev-only**: it fires only under `shouldAutoMint` (the exact
`--automation-dev` token **and** `GOLDFINCH_AUTOMATION_DEV_MINT === '1'`), is
`!app.isPackaged`-gated, and is a **no-op on a packaged build**. A plain
`npm run dev:automation` (no `DEV_MINT`) prints nothing — off-by-default stays
observable. Minting writes only the key *hash*; the plaintext is shown once on this
line and never persisted or re-derivable.

**Recipe — attach a script to a dev key:**

```bash
# Terminal 1 — launch the app, surface bound, dev key minted (note the printed line):
GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation
#   → AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey>"}

# Terminal 2 — export the key the consumer needs, then run it:
export GOLDFINCH_MCP_ADMIN_KEY=<adminKey>   # admin/chrome work (e.g. the a11y chrome sweep)
export GOLDFINCH_MCP_KEY=<jarKey>           # jar-scoped guest work
node scripts/a11y-audit.mjs                 # or any consumer of scripts/lib/mcp-client.mjs
```

`scripts/lib/mcp-client.mjs`'s `connectAutomation()` reads `GOLDFINCH_MCP_ADMIN_KEY`
(preferred) / `GOLDFINCH_MCP_KEY` from env by default and attaches the
`Authorization: Bearer <key>` header. This is the **attach** model — the operator
launches the app out-of-band and the script connects to the already-running loopback
server; it does not spawn the app.

## Endpoint

| | |
|---|---|
| Default URL | `http://127.0.0.1:49707/mcp` |
| Bind | `127.0.0.1` only (never `0.0.0.0` / `::`) |
| Production port | the `automationPort` setting (default `49707`), with **free-fallback** if it is taken — the **bound** port is surfaced live in Settings |
| Port override (dev only) | `GOLDFINCH_MCP_PORT` (honored only on an unpackaged build; **ignored on a packaged binary**) — a dev env pin binds **exactly-or-fails-loudly** (no fallback) |
| Transport | MCP Streamable HTTP, stateful (per-connection session id) |

**The path is a convention, not a route.** The server runs the Origin/Host guard and then hands
*every* request — at any path — to the transport; it does not route on the URL path. The documented
`/mcp` path is purely a clean, conventional URL. A consumer that posts to `http://127.0.0.1:49707/`
works identically. The example client and the `.mcp.json` entry both use `/mcp`.

### Loopback Origin / Host requirement — and why you might get a 403

Binding to `127.0.0.1` is necessary but **not sufficient**: Goldfinch renders hostile web pages,
and a rendered page can reach a loopback server via DNS-rebinding. So before any MCP processing,
a pure allow-list guard inspects every request and returns **`403`** (the request never reaches
the SDK) unless **all** of these hold:

- The **`Host`** header is present and loopback (`127.0.0.1`, `::1`, `localhost`, or the
  IPv6-mapped form). The port in `Host` is ignored — loopback-ness is what matters.
- The **peer socket address** is loopback.
- The **`Origin`** header, *if present*, is loopback. A request with **no** `Origin` header is
  allowed (that signals a local non-browser tool — the MCP client, `curl` — not a page). An
  `Origin: null` (opaque origin) is treated as present-and-non-loopback → **denied**.

A standard MCP SDK client over loopback satisfies this by default. If you see a `403`, you are
almost certainly behind a proxy or header-rewriter that injected a non-loopback `Host`/`Origin`
or rewrote the peer address — fix the consumer's headers, not the server.

## Settings controls (Flight 5)

The surface is configured from `goldfinch://settings` under **Automation**. All controls are local
GUI surface — they never expose a key plaintext beyond its one-time mint reveal.

- **Enable automation surface** — an off-by-default opt-in checkbox (`automationEnabled`). This
  toggle is the **bind gate**: the running server starts when it goes on and stops (tearing down any
  live session) when it goes off. Off is the safe default — nothing binds or is reachable until a
  human turns it on. Enablement is **human-only**: this checkbox is the only enable path; no
  programmatic action (including minting a key) flips it on.
- **MCP address + Copy** — a read-only field showing the **live** address (`127.0.0.1:<port>`) with
  a Copy button. Paste it straight into your MCP client or `.mcp.json`.
- **MCP client config block + Copy** — a ready-to-paste `.mcp.json` entry populated with the live
  address, with its own Copy button. Drop it into your MCP client config as-is; it tracks the active
  port, so it stays current across a live rebind.
- **Port + Save + Find free port** — the configurable listen port (`automationPort`, default
  **`49707`**, range `[1024, 65535]`). Save validates and **applies the new port immediately** — the
  running server rebinds to it (the old listener is released), and the address / config block /
  status line all update live. In production the server **free-falls-back**: if the saved port is
  already in use, it automatically moves to the next free port and binds there — your persisted
  preference is **not** overwritten (the *bound* port is what the address / config block show, while
  the saved preference is retried on the next start). Find free port suggests an open port to save.
  `GOLDFINCH_MCP_PORT` is a **dev-only** override (ignored on a packaged binary): when honored on an
  unpackaged dev run it pins the port **exactly-or-fails-loudly** — no free-fallback — so a dev pin
  that is taken surfaces a bind error rather than silently moving.
- **Bind status** — a status line that reads `Connected — listening on 127.0.0.1:<port>` when the
  server is bound, `Failed to bind: <error>` on a bind error (including a failed live rebind), or
  `Not running — turn on the Automation toggle to bind the surface` when the surface isn't
  listening.
- **Connect hint** — inline guidance to point the MCP client at the address above with an
  `Authorization: Bearer <key>` header (generate a key under **Keys**), noting it is loopback-only
  and pointing back to this doc for WSL2 / Docker connection details.
- **Keys (mint / revoke)** — the **Keys** section mints per-jar keys (and, when
  `GOLDFINCH_AUTOMATION_ADMIN` is set, an admin key). **Key generation is gated on the persisted
  toggle (DD9):** the jar and admin **mint** buttons are **disabled while the `automationEnabled`
  toggle is off**, and re-enable live when it flips on. **Revoke is always available** — you can
  revoke a key regardless of the toggle state. Minting a key never enables the surface (human-only
  enablement); it only registers the key's hash.

## Authentication — off by default, key-gated (Flight 4)

The Origin/Host guard is necessary but not sufficient: a local non-browser tool also passes it.
So the surface is **off by default and key-gated**. In production the `automationEnabled` toggle
both **binds** the server and satisfies the enable side of the auth gate — once bound, a second
pre-routing gate (the **auth gate**, which runs *after* the 403 origin guard) still rejects every
request with **`401`** unless **both** hold:

1. The surface is **enabled** (the `automationEnabled` setting is `true`), and
2. The request presents a **valid key** as `Authorization: Bearer <key>`.

> **Dev-enable override.** On an unpackaged dev run, `--automation-dev` satisfies the *enable* side
> of this gate **in memory** without writing the setting — so a dev harness is usable while the
> persisted `automationEnabled` stays `false` (human-only enablement is preserved). A valid key is
> still required. This override is a no-op on a packaged binary.

When either fails, the response is a **bare `401`** (no body, no JSON-RPC envelope) — deliberately
mirroring the origin guard's bare `403`, because both are pre-routing security decisions made before
any MCP processing.

### Key presentation

Present your key in the standard Bearer scheme:

```
Authorization: Bearer <key>
```

The scheme is **case-insensitive** (`Bearer`, `bearer`) and tolerant of surrounding whitespace. An
empty token (`Authorization: Bearer ` with nothing after it) is treated as no key → `401`.

### Key model

- **Per-jar keys.** Each key authenticates as a specific cookie-jar identity (`jarId`). Keys are
  generated with a CSPRNG and **shown once at mint** — only their SHA-256 hashes are persisted
  (`automationKeyHashes` in the settings store). Goldfinch never stores or logs the plaintext.
- **Admin tier.** A separate admin credential exists behind an **environment presence gate**: the
  admin key matches **only** when the process is launched with `GOLDFINCH_AUTOMATION_ADMIN` set
  **and** an admin key has actually been minted (`automationAdminKeyHash` non-empty). With the gate
  unset, an otherwise-valid admin key is `401`'d.

### Identity binding and jar-scoping

A request's key resolves to an **identity** — a `jarId` or the literal `admin` — and that identity
**confines what the connection can see and drive**:

- **Identity is bound at session creation and re-checked on every request.** When an MCP session is
  opened (`initialize`), the resolved identity is bound to it. Every subsequent request re-resolves
  the presented key **live** (reading settings fresh) and confirms it still resolves to the **same**
  identity the session was opened with. Two consequences:
  - **Toggle-off / full revoke kills a live session.** If the surface is disabled
    (`automationEnabled = false`) or the key is fully revoked between requests, the very next request
    resolves to no identity → bare **401**. No reconnect handshake survives a disable.
  - **A session id reused under a different valid key is rejected.** If a known `Mcp-Session-Id` is
    replayed with a *different* still-valid key (or this jar's key is rotated while other valid keys
    remain), the identity no longer matches the session's bound identity → bare **401**.

- **A jar key sees and drives ONLY its own jar's tabs.** Jar membership is decided by **session
  object identity** — the tab's `webContents.session` must be the *same* `Session` object Electron
  interns for the jar's partition. It is **never** decided by the renderer-reported `jarId` label
  (which a page cannot be trusted to set honestly). Concretely, for a jar key:
  - `enumerateTabs` returns only tabs whose resolved session belongs to the jar. A tab whose label
    *says* another jar but whose session is in-jar **is** included; a tab labelled in-jar but whose
    session is elsewhere is **excluded**.
  - Every tab-targeting op (`closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`,
    `click`, `typeText`, `scroll`, `pressKey`, `dragPointer`, `getZoom`, `setZoom`, `printToPDF`,
    `findInPage`, `stopFindInPage`,
    `captureScreenshot`, `readDom`, `readAxTree`) refuses
    an out-of-jar `wcId` with an `automation: out-of-jar` error.
  - **Burner tabs are unautomatable.** A burner jar (`burner:N`) is renderer-only and matches no
    persistent jar — its tabs are dropped from `enumerateTabs` and refused on every op. No key can be
    minted for a burner.
  - `captureWindow` (whole-window composite) is **admin-only** for a jar key — it fails with a
    **distinct** `automation: admin-only` error (not `out-of-jar`).
  - **`openTab` is jar-targeted (DD3, Flight 6).** A jar key's `openTab` always opens in *its own
    jar* — the façade forces the caller's `jar.id` regardless of whether `jarId` was supplied. A jar
    key supplying its own `jarId` explicitly is allowed; supplying a **foreign** `jarId` is refused
    with `automation: out-of-jar`. An **unknown** `jarId` (not in the renderer's container registry)
    is refused at the renderer with `automation: unknown-jar` — there is no silent fallback to the
    default container.
  - **A key whose jar no longer exists drives nothing.** If the jar is deleted from the registry
    while a key is still valid, every op for that identity errors (`automation: no-such-jar`).

- **The admin identity bypasses jar-scoping — admin's TWO relaxations (M05 F8 DD8).** An
  `admin`-resolved connection enumerates **every** jar's guest tabs **and** every open tab in
  the internal session (`goldfinch://settings`, `goldfinch://downloads`, `goldfinch://jars`),
  can drive/observe any of them, and may call `captureWindow`,
  `getChromeTarget`, and `downloadsList`. `allowInternal` is **no longer the sole** admin
  relaxation — the resolver grants admin exactly two:
  1. the **internal-session exclusion** is lifted (admin may drive/observe the internal tab;
     the eval/DevTools ops still refuse it — see their security-invariant blocks);
  2. **non-tab, non-chrome wcIds resolve at the admin tier only** — a live `WebContentsView`
     that is not in main's `tabViews` and is not the chrome (the chrome-class overlay views:
     the **menu-overlay sheet**, the **find overlay**) is refused for jar keys with
     `automation: non-tab-contents` (defense-in-depth; jar-tier wcId-first ops were already
     refused on session identity with `out-of-jar`).
  Admin is the *only* identity allowed to touch the internal session, discover the chrome
  renderer, resolve the overlay views, or read the app-level downloads model. Jar keys calling
  `getChromeTarget` or `downloadsList` get `automation: admin-only` (mirroring `captureWindow`).
  The `wcId` returned by `getChromeTarget` is then passed to the drive/observe tools to act on /
  read the app shell (tab strip, toolbar, menu triggers).

- **Overlay views are non-enumerable but probe-addressable (design choice, M05 F7/F8).** The find
  overlay and the menu-overlay sheet are deliberately **not registered in `tabViews`**, so they
  never appear in `enumerateTabs` — but they remain live webContents, directly addressable by
  wcId at the **admin tier** (the enumerable-vs-addressable nuance, documented at construction).
  Apparatus that needs them (the a11y audit's five `sheet:*` menu states, behavior tests)
  discovers the wcId with an id-space **probe walk around the known ids** — `readDom(id)`
  succeeding with the overlay's markup identifies it; a failed probe on a non-existent id is a
  normal refused result. **Since M09 F7 (DD6), `readDom` and `evaluate` no longer activate their
  target**, so probing a background *tab* no longer switches to it — the walk's foreground-first
  hazard (a tab-switch closing the open sheet menu under audit) is **gone**. Skipping every
  `enumerateTabs` wcId and the chrome wcId is still the recommended shape — it is cheaper, and
  the overlays are never in `enumerateTabs`, so skipping tabs loses nothing — but it is no longer
  load-bearing for correctness. `activateTab` on a non-tab wcId (an overlay) returns `false`
  harmlessly; see its row below.

> **Status:** the surface binds identity to the session and enforces jar-scoping + the admin tier.
> It ships in the installed binary, bound by the Settings `automationEnabled` toggle (audit logging
> and the operator-facing key-mint / indicator UI landed in Flight 5). The **admin tier works on the
> packaged binary** too: it is gated purely on the `GOLDFINCH_AUTOMATION_ADMIN` env presence (plus a
> minted admin key) — env-only, with no dev/`isPackaged` coupling.

## Multi-window semantics

Goldfinch supports multiple windows (M09 F6). Since **M09 Flight 7** the automation surface's
multi-window semantics are a **deliberate, final contract** — the F6 interim (window-scoped
enumeration, no window discriminator, no window discovery, a probe-walk for overlays) is retired.

- **`enumerateWindows()` is the single discovery primitive — admin-only.** It lists every open
  window: `{ windowId, chromeWcId, booted, activeTabWcId, lastFocused, sheetWcId?, sheetVisible,
  findWcId?, findVisible }`. It answers "what windows exist", "which one am I bound to", "where is
  this window's menu sheet / find bar", and "is this window's tab list complete yet". Every field
  is read from the live window registry at call time — there is no cache to go stale.
  - **Admin-only**, because window topology is an app-level cross-jar view: the census names
    windows a jar identity may hold no tabs in at all. Jar keys are refused with
    `automation: admin-only` — the same doctrine as `downloadsList` / `getChromeTarget`.
  - **`lastFocused` is NOT an OS-focus claim.** It reports main's own tracker — seeded at window
    create and at programmatic focus, membership-validated at read with a first-record fallback.
    Goldfinch deliberately refuses to assert OS focus: on some compositors (WSLg) programmatic
    `focus()` fires no focus event and `getFocusedWindow()` goes stale indefinitely. Treat "which
    window am I bound to?" as answered here, never by a focus probe.
  - **An ABSENT `sheetWcId` / `findWcId` means that overlay has NEVER been created** in that
    window — both are lazy, created on first show, so a window that never opens a menu never
    instantiates a sheet. This is distinct from a *present* id with `sheetVisible: false`, which
    means "instantiated but currently hidden". The visibility flags are separate fields precisely
    so those two states cannot be conflated.
  - It **retires the id-space probe walk.** Previously nothing could *enumerate* non-tab contents
    — the admin relaxation made overlay views addressable but never listable — so drivers guessed
    ids in a range and asked each one what document it held. `enumerateWindows` is an exact, O(1)
    read; the walk was an O(64) guess.

- **`enumerateTabs` is an ALL-WINDOWS census, and every row carries `windowId`.** It returns
  `{ wcId, url, title, jarId, active, windowId }` for every drivable tab in every window, ordered
  by window creation order, then each window's own tab creation order. The return is a **plain
  array** — no wrapper, no marker, no properties beyond the elements.
  - **The window registry is the ownership authority**; the renderer is authoritative only for
    `url` / `title` / `jarId`. A window's chrome reporting a tab is not evidence that it owns it:
    each window's rows are filtered to that window's registry-recorded membership, and `windowId`
    is stamped from the registry. This makes a duplicate **structurally impossible** — a tab
    caught mid-move between two windows can be *reported* by both chromes, but only the window
    that owns it stamps a row.
  - **Jar keys still see only their own jar's tabs** — the confinement is by resolved session and
    is unchanged. A jar key now sees its jar's tabs across *all* windows, but never the window
    topology (that is `enumerateWindows`, admin-only).

- **A mid-boot window contributes ZERO tab rows — and `booted` is how you know.** A window whose
  chrome has not finished booting (`booted: false`) is skipped by the census entirely.
  **A window created by moving a tab out of another window holds that adopted tab before its own
  chrome boots, so the tab is invisible for that interval.** That is exactly what `booted` exists
  to disclose, and it is honest rather than lossy: an un-booted window's renderer genuinely has no
  tabs yet. **A caller needing a guaranteed-total census polls `enumerateWindows()` until every
  row's `booted` is true**, then calls `enumerateTabs()`. The census deliberately carries no
  completeness marker of its own — topology belongs at the admin discovery op, and bolting a field
  onto an array return silently breaks callers that filter it.

- **`getChromeTarget({ windowId? })` — omitted = last-focused.** Supplied and resolvable → that
  window's chrome. Supplied and unknown → `automation: no-such-window` (a named refusal, never a
  silent fall-back to another window). Its return gains `windowId`:
  `{ wcId, kind: 'chrome', url, windowId }`.

- **`captureWindow({ windowId? })` — omitted = last-focused.** Supplied and unknown →
  `automation: no-such-window`. **Its image content is unchanged**: the op returns pixels, not
  topology. To learn which window a capture came from, pass a `windowId` you chose, or read
  `enumerateWindows()`'s `lastFocused` row when you omitted it.

- **`captureWindow` binds by window IDENTITY.** It composites the resolved window and no other.
  The F6-era two-window mis-pick caveat is **retired**: capture no longer selects a
  `desktopCapturer` source by size similarity (which could grab an unrelated same-sized window),
  but by the window's own media-source identity.

- **Raw-`wcId` ops work cross-window.** Every wcId-first op (`navigate`, `evaluate`, `readDom`,
  `readAxTree`, `click`, `pressKey`, `captureScreenshot`, …) resolves tabs in **any** window at
  its existing tier: tab membership is all-windows, and **every window's chrome** is a
  chrome-class wcId — admin-addressable (jar keys are refused on any registered chrome).
  `enumerateWindows` reports every window's `chromeWcId` directly, so a new window's chrome no
  longer has to be caught via `getChromeTarget` at the moment it is created.

The per-spec impact of these semantics on the behavior-test corpus is catalogued in
[`docs/behavior-specs-single-window-audit.md`](behavior-specs-single-window-audit.md) — the F7
input artifact.

## Tool reference

All 34 tools below match `src/main/automation/mcp-tools.js` exactly. Most tools address a tab
by its integer **`wcId`** (the tab's `webContents.id`), obtained from `openTab`, `enumerateTabs`,
or (for the chrome renderer) `getChromeTarget`; the two admin chrome/app-level tools
(`getChromeTarget`, `downloadsList`) take no `wcId`. The four **vault tools** (`vaultUnlock` /
`vaultList` / `vaultTotp` / `vaultFill`) are documented in their own section below.

### Drive tools (18)

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `enumerateTabs` | *(none)* | JSON text: array of `{ wcId, url, title, jarId, active, windowId }` for all drivable (dom-ready) tabs across **all windows** (M09 F7 — see *Multi-window semantics*). `windowId` is stamped from the window registry, which is authoritative for ownership. A window whose chrome has not finished booting contributes **zero rows** — poll `enumerateWindows()` until every `booted` is true for a guaranteed-total census. Admin listings include the internal `goldfinch://` tabs; jar-key listings never do (session filter) |
| `openTab` | `{ url: string, jarId?: string }` *(`url` required; `jarId` optional)* | JSON text: the new tab's `wcId` (number) — or `null` if the URL was rejected renderer-side or no handle appeared within the timeout (a **normal** result, not an error). `jarId`: a jar key may only supply its own jar id (foreign → `out-of-jar`); admin may supply any; an unknown id is refused (`unknown-jar`); omit to open in the current default jar (a fresh evaporating burner tab when Burner holds the flag) — admin identity only; a jar key's omitted `jarId` still forces that key's own jar. |
| `closeTab` | `{ wcId: integer }` *(required)* | JSON text: boolean success signal (`true`/`false`) |
| `activateTab` | `{ wcId: integer }` *(required)* | JSON text: boolean success signal. `true` — the tab was activated **and its owning window raised** (M09 F7 DD6: the dispatch goes to the tab's OWNING window's chrome, so this works across windows). `false` — the wcId is **not a registry-owned tab** (e.g. an overlay view probed by id): no activation, no raise, no error. A third outcome is a **refusal**, not a boolean: if the registry says a window owns the tab but that window's chrome cannot activate it (a registry/renderer desync), the op errors with `automation: activate-refused — …` (isError) rather than silently returning `false`. |
| `navigate` | `{ wcId: integer, url: string }` *(required)* | JSON text `{"ok":true}` (void op; http(s) only — unsafe URLs are refused) |
| `goBack` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` (no-op when there is no back history) |
| `goForward` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` (no-op when there is no forward history) |
| `reload` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` |
| `click` | `{ wcId: integer, x: number, y: number, button?: "left"\|"right"\|"middle", clickCount?: integer }` *(`wcId`, `x`, `y` required)* | JSON text `{"ok":true}` — synthetic click at guest-viewport-relative `(x, y)` |
| `typeText` | `{ wcId: integer, text: string }` *(required)* | JSON text `{"ok":true}` — types char-by-char into the focused element (for named keys, use `pressKey`) |
| `scroll` | `{ wcId: integer, x: number, y: number, dx: number, dy: number }` *(required)* | JSON text `{"ok":true}` — synthetic wheel event at `(x, y)` by pixel deltas `(dx, dy)` |
| `pressKey` | `{ wcId: integer, name: string, modifiers?: ("control"\|"shift"\|"alt"\|"meta")[] }` *(`wcId` required; `name` or its alias `key` required)* | JSON text `{"ok":true}` — presses one key, optionally as a modifier chord. Known `name` values: `Tab, Enter, Escape, Space, ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Delete, Backspace, ShiftTab`, **or a single printable letter/digit** (e.g. `"M"`, `"1"`) for chord use. Pass `modifiers` to hold modifier keys during the press — accepted values are `control`, `shift`, `alt`, `meta`. **Example — Ctrl+M:** `{ "wcId": 42, "name": "M", "modifiers": ["control"] }`; **Ctrl+Shift+P:** `{ "wcId": 42, "name": "P", "modifiers": ["control", "shift"] }`. An unknown modifier is rejected (the call errors) rather than silently dropped. |
| `getZoom` | `{ wcId: integer }` *(required)* | JSON text: `{"factor":n}` — the tab's current page zoom factor (`1.0` = 100%) |
| `setZoom` | `{ wcId: integer, factor: number }` *(required)* | JSON text: the applied `{"factor":n}` — `factor` is clamped to `[0.25, 5.0]`, so the returned value may differ from the requested one |
| `printToPDF` | `{ wcId: integer }` *(required)* | JSON text: a base64-encoded PDF string. Foreground-first (a backgrounded tab is activated before rendering). Decode the base64 and verify it begins with `%PDF-` |
| `findInPage` | `{ wcId: integer, text: string, forward?: boolean, findNext?: boolean, matchCase?: boolean }` *(`wcId` and `text` required)* | JSON text: `{"activeMatchOrdinal":n,"matches":m}` — the current match index (1-based) and total match count. Foreground-first. Refuses the internal `goldfinch://settings` session. |
| `stopFindInPage` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` (void op). Clears the active find session and removes any match highlights on the page content. Does not affect the find-overlay UI (the floating find bar is a separate main-owned `WebContentsView`, not chrome DOM). Refuses the internal `goldfinch://settings` session. |
| `dragPointer` | `{ wcId: integer, from: {x,y}, to: {x,y}, steps?: integer, stepDelayMs?: integer }` *(`wcId`, `from`, `to` required)* | JSON text `{"ok":true}` — synthetic pointer drag: mouseDown at `from`, `steps` (default 12) interpolated mouseMove events with the button held, then mouseUp at `to`. Each event is paced `stepDelayMs` (default 4) apart — an unpaced synchronous burst gets coalesced by Chromium down to essentially the first + last move (confirmed at the M09 F2 Leg 2 premise spike). Use for drag-and-drop gestures a plain click cannot express (e.g. an in-page slider, a text-selection sweep, or a page's own drag-and-drop widget). **Not for tab drags**: the tab strip's reorder/tear-off/cross-window gestures are native HTML5 DnD as of M09 F11, which synthetic pointer injection cannot initiate — the HAT-apparatus behavior specs (`tests/behavior/cross-window-drag.md`) own them. |

> **Security invariant — internal session always excluded.** `getZoom`, `setZoom`, `printToPDF`, `findInPage`, and `stopFindInPage`
> refuse the internal `goldfinch://settings` session with an op-local
> `automation: <op> — internal-session excluded` refusal **before** touching the page, regardless of
> identity (admin included) — matching the eval/devtools internal-exclusion guards. Page zoom and
> print are web-content affordances; the privileged internal chrome is never a target.

### Observe tools (4)

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `captureScreenshot` | `{ wcId: integer, delayMs?: integer }` *(`wcId` required)* | **Image content** (PNG, `image/png`). The tab is brought to front first; `delayMs` optionally tunes the paint-settle wait after foregrounding |
| `captureWindow` | `windowId` *(optional, integer)* | **Image content** (PNG, `image/png`) of a whole browser window (chrome + composited guests). `windowId` omitted → the **last-focused** window; supplied → that window, bound by window identity; unknown → `automation: no-such-window`. The image content is the same either way — this op returns pixels, not topology; read `enumerateWindows()` to learn window ids (see *Multi-window semantics*) |
| `readDom` | `{ wcId: integer }` *(required)* | JSON text: `{ url, title, html }` — the full live `document.documentElement` outerHTML (no trimming). **Does NOT foreground its target** (M09 F7 DD6): a background tab — including one in another, unfocused window — is read where it sits, without activating it or raising its window. |
| `readAxTree` | `{ wcId: integer }` *(required)* | JSON text: the accessibility-tree `AXNode` array — **or** a `{ automation: "debugger-unavailable", reason, wcId }` refusal (a **normal** result, see below). Foreground-first; uses the in-process debugger |

### Eval tools (2)

Debugger-free JavaScript evaluation in the target tab's **main world** via `webContents.executeJavaScript`
(**ZERO CDP** — these tools never touch the in-process debugger, so they run concurrently with
`readAxTree`/`scroll` without lock contention). Because `executeJavaScript` evaluates in the page's V8
isolate (not via a `<script>` tag), `script-src` CSP does **not** apply — so one `injectScript` can inject a
library like axe-core and a following `evaluate` can read `axe.run(...)` back. The returned Promise is
natively awaited.

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `evaluate` | `{ wcId: integer, expression: string }` *(required)* | JSON text: the evaluated value. A returned Promise is awaited; the resolved value **must be JSON-serializable** — a non-serializable return (function, DOM node, circular object) is refused with `automation: evaluate — return value is not JSON-serializable` (isError). An in-page throw surfaces as an error result (isError). **Does NOT foreground its target** (M09 F7 DD6): the tab is evaluated where it sits — a background tab is not brought to front and its window is not raised. |
| `injectScript` | `{ wcId: integer, script: string }` *(required)* | JSON text `{"ok":true}` (void). Defines globals / patches prototypes (e.g. the axe-core source, a farbling hook). **Skips foreground-to-act** (defining a global needs no paint). Makes **no persistence guarantee** — globals it defines are not promised to survive across a later `evaluate` gap (a navigation clears them); pair `injectScript` immediately with one `evaluate`. An in-page throw surfaces as an error result (isError). |

> **Security invariant — internal session always excluded, even for admin.** Both eval tools refuse the
> internal `goldfinch://settings` session with `automation: evaluate — internal-session excluded` (and the
> analogous `injectScript` message) **before** any `executeJavaScript`, regardless of identity. Admin builds
> its engine with `allowInternal:true` (so it can run read-only ops on the internal tab), but arbitrary JS in
> `goldfinch://settings` would reach the privileged `goldfinchInternal` bridge — so the eval ops carry their
> own op-local refusal that fires even for admin. This is the single most important security item in the eval surface.

### DevTools tools (2)

Open / close the Chromium DevTools front-end on a tab via `webContents.openDevTools({mode:'detach'})`
/ `webContents.closeDevTools()` — **NO CDP from these ops** (the CDP *client* they spawn is Chromium's
own DevTools front-end). `{mode:'detach'}` opens DevTools in a **separate OS window**, preferred under
WSLg over the default docked mode (less compositor interference, more predictable). Neither op brings
the tab to the foreground.

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `openDevTools` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` (void). Opens a detached DevTools window on the tab. |
| `closeDevTools` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` (void). Closes DevTools, releasing the CDP client. **Idempotent** — closing when DevTools is not open is a no-op. |

> **Capability distinction.** Opening DevTools establishes a CDP client on the tab, so a **concurrent
> `readAxTree`/`scroll`** (which attach the in-process debugger) will surface a
> `{ automation: "debugger-unavailable", reason, wcId }` / attach-failed result — that is **expected**,
> not a regression. By contrast, `evaluate`/`injectScript` **keep working** under DevTools (they use
> `webContents.executeJavaScript`, not the debugger). Call `closeDevTools` to release the client so a
> subsequent `readAxTree`/`scroll` can attach again.

> **Security invariant — internal session always excluded, even for admin.** Both DevTools tools refuse the
> internal `goldfinch://settings` session with `automation: openDevTools — internal-session excluded` (and the
> analogous `closeDevTools` message) **before** opening/closing DevTools, regardless of identity. Opening
> DevTools establishes a full CDP client on the page (functionally a debugger attach), and the mission rule
> forbids a debugger client on the internal session — a privilege-escalation surface onto the privileged
> `goldfinchInternal` bridge. (Jar-scoped guests / admin chrome are allowed; DevTools on a jar's own guest is
> within the jar key's authority.)

### Admin chrome / app-level (3)

All three tools are **admin-only** and **app-level** — they take **no `wcId`** (no per-tab target).
A jar key calling any of the three is refused with `automation: admin-only` (the distinct admin-tier
refusal, mirroring `captureWindow`).

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `getChromeTarget` | `windowId` *(optional, integer)* | JSON text: `{ wcId, kind: "chrome", url, windowId }` — a window's chrome renderer. `windowId` omitted → the **last-focused** window; supplied → that window; unknown → `automation: no-such-window` (never a silent fall-back). Pass the returned `wcId` to the drive/observe tools to act on / read the app shell (tab strip, toolbar, menus). See *Multi-window semantics*. |
| `enumerateWindows` | *(none)* | **ADMIN ONLY.** JSON text: array of `{ windowId, chromeWcId, booted, activeTabWcId, lastFocused, sheetWcId?, sheetVisible, findWcId?, findVisible }` — one row per open window, in window creation order. The single window-topology discovery primitive: it resolves each window's chrome and overlay wcIds **exactly** (no id-space probing), and `booted` is `enumerateTabs`'s completeness signal. `sheetWcId`/`findWcId` are **absent** when that overlay has never been created (both are lazy); `sheetVisible`/`findVisible` are separate so "instantiated but hidden" is distinguishable from "never shown". `lastFocused` is main-side tracked — **not** an OS-focus claim. Jar keys get `automation: admin-only`. See *Multi-window semantics*. |
| `downloadsList` | *(none)* | JSON text: the app-level downloads records — an array of `{ id, url, filename, savePath, state, received, total, … }` (in-progress + completed history, persisted across restart). `filename` is the sanitized save name; `savePath` is the real on-disk path (`null` until known); `state` is the download lifecycle (`progressing` / `completed` / `interrupted` / …); `received`/`total` are byte counts. The internal `goldfinch://downloads` **page** that renders this model lives in the internal session and is **not** readable via the eval/observe tools — `downloadsList` is the automation-surface view of the same model. |

> **Admin-only.** Jar keys calling `getChromeTarget` receive `automation: admin-only` (mirroring
> `captureWindow`). Jar keys that attempt to drive the chrome renderer directly by supplying the
> chrome `wcId` to a wcId-first op are refused with `automation: out-of-jar` (chrome-exclusion
> guard in `resolveContentsForJar`, defense-in-depth). Only admin sessions may discover or drive
> the chrome.

### History tools (1)

`getHistory` reads recorded browsing-history visits for a jar (Mission 08 Flight 5) — a **custom,
no-`wcId` op** like `enumerateTabs`/`openTab`/`captureWindow`/`getChromeTarget`/`downloadsList`
above, but **jar-CONFINED, not admin-only**: like `enumerateTabs`/`openTab`, a jar key may call it
successfully for its own jar — contrast with `captureWindow`/`getChromeTarget`/`downloadsList`,
which are admin-only refusals for a jar key.

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `getHistory` | `{ jarId?: string, query?: string, limit?: integer, before?: integer }` *(all optional)* | JSON text: `{ jarId, visits }` — `visits` is an array of `{ id, url, title, visitedAt }` (epoch-ms), newest-first for a recent-visits listing or relevance-ordered for a search. |

**Identity semantics.**
- **Jar key** — `jarId` is **optional**: omit it to read your own jar's history. If supplied, it
  **must match** your own jar id; a foreign `jarId` is refused with `automation: out-of-jar`,
  thrown by the scope façade **before** any store read (zero rows touched on refusal).
- **Admin** — `jarId` is **required** (admin has no implicit jar, unlike a jar key) and may name
  **any** known jar. A missing/non-string `jarId` is refused with `automation: bad-args — jarId
  required`; a `jarId` that does not resolve against the jar registry is refused with
  `automation: unknown-jar` (checked via an injected `isKnownJar` accessor — an explicit refusal,
  not a silent empty result).

**`query` vs. `before` (search has no cursor).** Omit `query` for a recent-visits listing —
`before` optionally pages it backward as a cursor (an unknown/foreign `before` id yields an empty
array, fail-closed, never a cross-jar cursor probe). Supply `query` for a text search over
`url`/`title`; `before` has no meaning in search mode, so supplying **both** `query` and `before`
together is refused with `automation: bad-args — query does not page` — for either identity, so a
jar key hits this the same as admin. `limit` applies to either mode.

**Refusal codes, by identity:**
- **Jar key**: `automation: out-of-jar` (foreign `jarId`, façade-level, before any read) ·
  `automation: bad-args — query does not page` (both `query` and `before` supplied).
- **Admin**: `automation: bad-args — jarId required` (missing/non-string `jarId`) ·
  `automation: unknown-jar` (`jarId` not in the jar registry) ·
  `automation: bad-args — query does not page` (both `query` and `before` supplied).

This is a **read-only** surface — there is no history mutation tool here (clear/delete stay
operator-surface only, `goldfinch://jars`); agents get memory of a jar's history, not the ability
to erase it.

### Vault tools (4)

The four vault tools expose Goldfinch's password vault (Mission 12) over automation as a
deliberately **fill-only** surface: an agent can unlock, browse metadata, read a TOTP code, and
**fill** a matching credential into a page — but a **password is never returned across this
boundary**. These tools are **non-engine-op**: they dispatch to a **per-session vault context**,
not the automation engine, and hold no cross-session state.

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `vaultUnlock` | `{ accessKey: string }` *(required)* | JSON text: `{ unlocked: [vaultId, …] }` — the vaults this session opened. A **wrong/foreign key opens nothing** (`{ unlocked: [] }`, a **normal** result, not an error). |
| `vaultList` | *(none)* | JSON text: array of `{ vaultId, id, title, origin, username, hasTotp }` — **metadata only** for the login items in this session's unlocked vaults. **Never** a password, TOTP secret, or card data. Only unlocked vaults contribute. |
| `vaultTotp` | `{ itemId: string }` *(required)* | JSON text: `{ id, code }` — the **current** TOTP code for a named unlocked item. `code` is `null` when the item is absent, not in an unlocked vault, or has no TOTP. The TOTP **secret** is never returned. |
| `vaultFill` | `{ wcId: integer, itemId: string }` *(required)* | JSON text: `{ filled: true, id }` on success, or a **normal** `{ filled: false, reason }` (`"locked"` / `"no-match"` / `"origin-mismatch"`) when nothing was filled. The credential is handed to Goldfinch's internal fill effect and **never returned**. |

**Cryptographic scope by session identity (DD4).** The reachable vault set is decided by the
session's key identity, not a tool argument:

- **Jar key** — `vaultUnlock`'s `accessKey` is that jar's **per-jar vault access secret**, and it
  unlocks **only that jar's vault**. A per-jar access key structurally holds no envelope for the
  global vault or sibling jars, so a jar automation session **cannot reach the global vault** in
  this flight (global logins via automation require the admin key — a dedicated global-scoped
  access-key tier is a deferred open question).
- **Admin key** — `vaultUnlock`'s `accessKey` is the **X25519 admin private key (base64)**. It
  opens the Manager Root Key and therefore **every** vault (including jar vaults created after
  setup). Handing the admin private key over a tool argument is the intended admin-automation
  unlock; the Settings UI recommends against embedding it in config.

**`vaultFill` wire policy (fill-only).** `vaultFill` resolves the login item by id from an unlocked
reachable vault, then enforces **two** gates before filling:

1. **Jar membership** — the target `wcId` must belong to this session's reachable jar (a jar session
   naming a **foreign/sibling** tab is refused with `automation: out-of-jar`, the same
   session-object-identity check the drive/observe tools use). Admin may target any tab.
2. **Top-frame origin match** — the resolved tab's origin must match the item's stored origin; a
   mismatch is a **normal** `{ filled: false, reason: "origin-mismatch" }`, and the credential is
   **not** filled.

Only then is `{ wcId, credential }` handed to Goldfinch's internal fill effect. The credential
(username/password) **never crosses back to the client** — the result carries only `{ filled, id }`.
"Locked" (nothing unlocked) and "no-match" (no such item) are likewise **normal results**, not
errors.

**Session lifecycle + zeroization.** A session's vault keys live in memory as Buffers and are
`.fill(0)`-**zeroized on transport teardown** (a graceful `DELETE` or a dropped SSE stream) — a
fresh session must `vaultUnlock` again. A **per-session idle timer** (duration from the
`vaultAutoLockMinutes` setting, reset on each vault op) zeroizes the session as a belt-and-suspenders
backstop for a client that drops without signalling. There is **no singleton coupling** with the
operator's own vault lock in either direction: automation unlock/teardown never changes the human
lock state, and a human "Lock now" never empties a live automation session (each holds its own
fresh-buffer copies).

**Audit.** All four vault tools flow through the standard activity audit (below). The recorded
`detail` carries the **item id** for `vaultFill` / `vaultTotp` and **nothing** for `vaultUnlock` /
`vaultList` — **never** the `accessKey` (per-jar secret or admin private key), a password, a TOTP
secret, or a vault key.

## Result and refusal semantics

The server returns three content shapes, and distinguishes *operational* outcomes (normal results)
from *genuine errors*:

- **Image content** — `captureScreenshot` and `captureWindow` return a single image block
  (`{ type: "image", data: <base64 PNG>, mimeType: "image/png" }`). The base64 is passed through
  verbatim — never JSON-wrapped.
- **JSON text** — every other tool returns one text block whose `text` is JSON. Void ops
  (`navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`,
  `dragPointer`, `stopFindInPage`)
  serialize to the single consistent shape `{"ok":true}`. Ops with a real return value
  (`enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `getZoom`, `setZoom`, `printToPDF`,
  `findInPage`,
  `readDom`, `readAxTree`) serialize their
  actual value (array / number / boolean / `null` / object / string — `getZoom`/`setZoom` return
  `{factor}`, `printToPDF` returns a base64 string, `findInPage` returns `{activeMatchOrdinal, matches}`).
- **Refusal-as-normal-result** — two outcomes are **normal results the agent should read and react
  to**, *not* errors:
  - `openTab` returning `null` (URL rejected renderer-side, or no handle within the timeout).
  - `readAxTree` returning `{ automation: "debugger-unavailable", reason, wcId }` when the debugger
    is busy (DevTools open, or another client attached). React by retrying or closing DevTools —
    do not treat it as a failure.
- **`isError` results** — only a **genuine throw** in the engine (an unknown tool, a bad/dead/
  internal `wcId`, a window-closed null-deref, a post-attach CDP failure) produces a result with
  `isError: true`; its text carries the `automation: …` error message. Consumers should branch on
  `isError` and surface the message, while treating the two refusals above as ordinary data.

  Two named refusals landed in **M09 F7** (both `isError`):
  - **`automation: activate-refused — …`** (DD6) — `activateTab` on a tab the registry says a
    window owns, whose chrome could not activate it (a registry/renderer desync). Distinct from
    the plain `false` returned for a wcId that is **not a registry-owned tab** (an overlay probed
    by id), which stays a normal boolean result. Pre-F7 the desync case *also* returned a `false`
    that every caller discarded — so a cross-window act proceeded against an unraised background
    guest and reported success. It is now loud.
  - **`automation: capture-timeout — {target} did not settle within {ms}ms (the view may be
    detached)`** (DD7) — a `capturePage()` that did not settle within the 3000ms bound, on
    `captureScreenshot` or on `captureWindow`'s chrome/guest capture. A **detached-but-live** view
    passes every liveness guard and its `capturePage()` never settles, which pre-F7 wedged the
    request forever with no server-side recovery. The refusal **names its target** (`chrome`,
    `active guest`, `wcId 42`, …) so a composite capture says which layer hung. Note
    `captureWindow`'s *overlay* layers (find bar, menu sheet) do **not** hard-refuse on timeout —
    that layer is dropped and logged, so a slow menu cannot fail an otherwise-good window capture.
    A merely-slow capture can trip the bound; the refusal is the signal to retry.

## Accessibility-tree caveat (stale handles)

`readAxTree` returns raw `AXNode`s whose `backendNodeId` and `frameId` are **CDP-session-scoped**
and **stale-on-detach**: they are informational identifiers within the read that produced them,
**not** durable, live element references. The engine detaches the debugger after each read, so a
handle from one `readAxTree` call must not be reused later.

There is **no action-by-handle in this flight** — you cannot pass a `backendNodeId` to `click` or
any other tool. Address elements by **coordinates** (`click`/`scroll`) or by reading the DOM
(`readDom`) instead. Likewise, `readAxTree`'s engine-level `depth`/`properties` options are an
unimplemented stub and are deliberately **not** exposed in the tool's input schema (the tool takes
`wcId` only) — do not pass them.

## Activity audit + the `automation-activity-changed` broadcast (Flight-5 contract)

The server keeps an **in-memory audit log** of automation activity and fans changes out to the
Goldfinch chrome over the internal IPC channel **`automation-activity-changed`**. This is the
**data half of SC10** (Flight 4): there is **no operator-facing UI this flight** — Flight 5 renders
the live indicator + log viewer against this contract. The shape below is the deliverable.

**What is tracked.** Two views, captured per *snapshot*:

- **`sessions`** — the currently-active automation sessions (one per connected MCP client), each:
  ```js
  { sessionId, identity, kind: "admin" | "jar", jarId, since }
  ```
  `kind` distinguishes the **admin** tier from a **jar** identity; a jar session **names** its jar
  in `jarId` (admin's `jarId` is `null`). `since` is epoch-ms (the session-open time). Tracking
  follows the **transport lifecycle**: a session appears on `initialize` and is removed when its
  transport closes. A properly-terminated session (a `DELETE`) clears as before; **ungraceful client
  disconnects are now detected too** — a dropped standalone GET SSE stream tears the session down, so
  the indicator / viewer don't keep showing a stale "connected" session after a client crashes or
  goes away without a `DELETE`.
- **`log`** — a **bounded ring** (capacity **500**) of recent tool invocations, **newest-last**
  (natural append order), each:
  ```js
  { ts, sessionId, identity, op, targetWcId, outcome: "ok" | "error", errorCode, detail }
  ```
  `ts` is epoch-ms; `op` is the tool name; `targetWcId` is the call's `wcId` argument or `null`
  (no-wcId ops: `enumerateTabs`, `openTab`, `captureWindow`); `outcome` is `"ok"` unless the call
  returned an `isError` result; `errorCode` carries the discriminated refusal code parsed from the
  `automation: <code> — …` message (e.g. `out-of-jar`, `admin-only`, `internal-session`,
  `bad-handle`) — or `"error"` for a bare/unexpected throw, and `null` on success. `detail` is a
  short per-op context string for operator auditability — e.g. `url=https://…` for `navigate`/
  `openTab`, `(x,y)` for `click`/`scroll`, `(fx,fy)->(tx,ty)` for `dragPointer`, `key=Enter` for
  `pressKey` (chords append the
  modifiers, e.g. `key=M+control`), `text(N chars)` for
  `typeText` (**length only — content is never logged**); `null` for ops where `targetWcId`
  already names the tab sufficiently (`enumerateTabs`, `captureWindow`, `getChromeTarget`,
  `readDom`, etc.).

**Snapshot shape** (the broadcast payload **and** the on-demand read):

```js
{
  sessions: [ { sessionId, identity, kind, jarId, since }, … ],
  log:      [ { ts, sessionId, identity, op, targetWcId, outcome, errorCode, detail }, … ]  // newest-last
}
```

**Broadcast cadence.** The channel fires the **full snapshot per mutation** — once per recorded
tool call and once per session open/close. For one local consumer this is fine; Flight 5 may
debounce/coalesce if desired (not required here). A session **close** fires exactly one update with
that session removed.

**On-demand read.** Beyond the broadcast, the server object exposes `getActivity()` → the current
snapshot, so Flight 5 / a future IPC query can read state without waiting for an event.

**Semantics to keep in mind for the indicator:**

- The **ring is a live tail, not an archive** — once 500 entries accumulate, the oldest are silently
  evicted. Do not assume full history; this is in-memory only and **does not survive a restart** (no
  disk persistence this flight — reversible later if history-across-restarts is wanted).
- `sessions` tracks **transport liveness, not auth-liveness**. A session whose key is **revoked
  mid-flight stays listed as active until its next request 401s and its transport closes** — the
  revoke *is* enforced at the gate (the next request is rejected), but the indicator lags to the
  transport close. Expect a brief, bounded lag rather than instant disappearance on revoke. Note this
  is distinct from a *client* going away: an ungraceful disconnect (a dropped standalone GET SSE
  stream) now closes the transport directly, so a crashed or vanished client no longer lingers as a
  stale "connected" session.

## Example client

`scripts/mcp-example-client.mjs` is a runnable, SDK-only example: it connects over loopback
Streamable HTTP, lists the tools, opens a tab, then navigates / screenshots / reads the DOM against
it. Run it against a live dev server:

```bash
npm run dev:automation                      # terminal 1: start the app + server (dev)
GOLDFINCH_MCP_KEY=<key> node scripts/mcp-example-client.mjs  # terminal 2: drive it
```

**`GOLDFINCH_MCP_KEY` is required.** The example client reads the per-jar key from this env var and
attaches `Authorization: Bearer <key>` to every request. Without it the server returns `401`.
In a dev run, obtain the key via `GOLDFINCH_AUTOMATION_DEV_MINT` (see the
[`AUTOMATION_DEV_MINT` mechanism](#dogfooding--dev-key-acquisition-the-automation_dev_mint-mechanism));
in a production run, mint the key in the Settings Keys UI (see *Production getting-started* above).

It honors the same endpoint overrides as documented above (`GOLDFINCH_MCP_PORT`, or
`GOLDFINCH_MCP_URL` for a full-URL escape hatch). It is **attach-don't-launch** — it does not start
the app.

## `.mcp.json` registration

The repo's `.mcp.json` does **not** ship a standing `goldfinch` entry. The surface is
**off-by-default** (see the Settings toggle below): in a normal session there is no server to
reach, so a standing entry would produce perpetual failed connection attempts on every Claude Code
start. Instead, a consumer who opts in adds the entry themselves at their configured port:

```json
"goldfinch": { "type": "http", "url": "http://127.0.0.1:49707/mcp" }
```

Substitute your configured port (the Settings UI shows the live address — copy it from there). The
entry is **inert until the automation surface is enabled and the app is running** — a connection
failure means the server isn't up, not that the config is wrong. (The repo's `.mcp.json` ships an
empty `mcpServers` map — it registers no servers, including no `goldfinch` entry.)
