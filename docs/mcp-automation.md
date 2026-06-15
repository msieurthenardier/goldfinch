# Goldfinch MCP Automation Surface

A consumer reference for Goldfinch's local automation server — an [MCP](https://modelcontextprotocol.io)
(Model Context Protocol) server that lets an external agent **drive** (navigate / click / type /
scroll / keypress) and **observe** (screenshot / window capture / DOM read / accessibility tree)
the browser's tabs over a loopback HTTP transport.

> **Status: dev-gated, not yet shipped.** The automation surface is gated behind `--automation-dev`
> and is exposed in **no released build before Flight 4**. Today it runs only when you launch the
> app yourself with `npm run dev:automation`. None of this is reachable in an installed Goldfinch.

## Overview

The server is built on the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`, Goldfinch's
first and only runtime dependency). It speaks **Streamable HTTP** with a stateful session model,
binds to **loopback only** (`127.0.0.1`), and advertises **16 tools** — 12 drive tools and 4
observe tools. Tools are a thin adapter over Goldfinch's internal automation engine; the same
security guards that protect the engine (URL safety, handle resolution) apply unchanged.

## Launch

```bash
npm run dev:automation
```

This is `electron . --enable-logging --no-sandbox --automation-dev`. The `--automation-dev` flag
is the **only** thing that starts the MCP server — it is decoupled from `--remote-debugging-port`,
so `npm run dev:debug` (CDP) does **not** start it. There is no production launch path; the surface
ships in no release before Flight 4.

## Endpoint

| | |
|---|---|
| Default URL | `http://127.0.0.1:49707/mcp` |
| Bind | `127.0.0.1` only (never `0.0.0.0` / `::`) |
| Port override | `GOLDFINCH_MCP_PORT` (any valid positive integer; else `49707`) |
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

- **Enable automation surface** — an off-by-default opt-in checkbox (`automationEnabled`). The
  server only binds under `--automation-dev`, but even then the auth gate `401`s every request until
  this toggle is on. Off is the safe default; nothing is reachable until you opt in.
- **MCP address + Copy** — a read-only field showing the **live** address (`127.0.0.1:<port>`) with
  a Copy button. Paste it straight into your MCP client or `.mcp.json`.
- **MCP client config block + Copy** — a ready-to-paste `.mcp.json` entry populated with the live
  address, with its own Copy button. Drop it into your MCP client config as-is; it tracks the active
  port, so it stays current across a live rebind.
- **Port + Save + Find free port** — the configurable listen port (`automationPort`, default
  **`49707`**, range `[1024, 65535]`). Save validates and **applies the new port immediately** — the
  running server rebinds to it (the old listener is released), and the address / config block /
  status line all update live. `GOLDFINCH_MCP_PORT` (the dev/test env override) still takes
  precedence where set, so a Saved value only takes effect when that env var is unset. A failed
  rebind (e.g. the chosen port is already in use) surfaces on the status line so you can pick another
  — Find free port suggests an open one.
- **Bind status** — a status line that reads `Connected — listening on 127.0.0.1:<port>` when the
  server is bound, `Failed to bind: <error>` on a bind error (including a failed live rebind), or
  `Not running — start Goldfinch with --automation-dev to bind the surface` when the surface isn't
  listening.
- **Connect hint** — inline guidance to point the MCP client at the address above with an
  `Authorization: Bearer <key>` header (generate a key under **Keys**), noting it is loopback-only
  and pointing back to this doc for WSL2 / Docker connection details.

## Authentication — off by default, key-gated (Flight 4)

The Origin/Host guard is necessary but not sufficient: a local non-browser tool also passes it.
So the surface is **off by default and key-gated**. Even under `--automation-dev` the server
*binds*, but a second pre-routing gate (the **auth gate**, which runs *after* the 403 origin guard)
rejects every request with **`401`** unless **both** hold:

1. The surface is **enabled** (the `automationEnabled` setting is `true`), and
2. The request presents a **valid key** as `Authorization: Bearer <key>`.

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
    `click`, `typeText`, `scroll`, `pressKey`, `captureScreenshot`, `readDom`, `readAxTree`) refuses
    an out-of-jar `wcId` with an `automation: out-of-jar` error.
  - **Burner tabs are unautomatable.** A burner jar (`burner:N`) is renderer-only and matches no
    persistent jar — its tabs are dropped from `enumerateTabs` and refused on every op. No key can be
    minted for a burner.
  - `captureWindow` (whole-window composite) is **admin-only** for a jar key — it fails with a
    **distinct** `automation: admin-only` error (not `out-of-jar`).
  - **Known limitation (v1):** `openTab` cannot target a specific jar for a jar key; a new tab opens
    in the renderer's active container. A tab that lands in another jar is simply not enumerable or
    drivable by this key (confinement still holds — there is no cross-jar read).
  - **A key whose jar no longer exists drives nothing.** If the jar is deleted from the registry
    while a key is still valid, every op for that identity errors (`automation: no-such-jar`).

- **The admin identity bypasses jar-scoping.** An `admin`-resolved connection enumerates **every**
  jar's guest tabs **and** the internal `goldfinch://settings` tab, can drive/observe any of them
  (the **sole** relaxation of the internal-session exclusion), and may call `captureWindow`. Admin is
  the *only* identity allowed to touch the internal session. (For this flight, "admin sees all + the
  chrome" means cross-jar guest visibility + the internal tab + `captureWindow`'s whole-window
  composite. Driving the chrome renderer itself — toolbar / tab strip — is structurally
  undiscoverable via the surface today and is a later affordance.)

> **Status:** the surface now binds identity to the session and enforces jar-scoping + the admin
> tier. Audit logging and the operator-facing key-mint / indicator UI land in later Flight-4/Flight-5
> legs. There is no production launch path yet.

## Tool reference

All 16 tools below match `src/main/automation/mcp-tools.js` exactly. Every tool addresses a tab
by its integer **`wcId`** (the tab's `webContents.id`), obtained from `openTab` or `enumerateTabs`.

### Drive tools (12)

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `enumerateTabs` | *(none)* | JSON text: array of `{ wcId, url, title, jarId, active }` for all drivable (non-internal, dom-ready) tabs |
| `openTab` | `{ url: string }` *(required)* | JSON text: the new tab's `wcId` (number) — or `null` if the URL was rejected renderer-side or no handle appeared within the timeout (a **normal** result, not an error) |
| `closeTab` | `{ wcId: integer }` *(required)* | JSON text: boolean success signal (`true`/`false`) |
| `activateTab` | `{ wcId: integer }` *(required)* | JSON text: boolean success signal (`true`/`false`) |
| `navigate` | `{ wcId: integer, url: string }` *(required)* | JSON text `{"ok":true}` (void op; http(s) only — unsafe URLs are refused) |
| `goBack` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` (no-op when there is no back history) |
| `goForward` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` (no-op when there is no forward history) |
| `reload` | `{ wcId: integer }` *(required)* | JSON text `{"ok":true}` |
| `click` | `{ wcId: integer, x: number, y: number, button?: "left"\|"right"\|"middle", clickCount?: integer }` *(`wcId`, `x`, `y` required)* | JSON text `{"ok":true}` — synthetic click at guest-viewport-relative `(x, y)` |
| `typeText` | `{ wcId: integer, text: string }` *(required)* | JSON text `{"ok":true}` — types char-by-char into the focused element (for named keys, use `pressKey`) |
| `scroll` | `{ wcId: integer, x: number, y: number, dx: number, dy: number }` *(required)* | JSON text `{"ok":true}` — synthetic wheel event at `(x, y)` by pixel deltas `(dx, dy)` |
| `pressKey` | `{ wcId: integer, name: string }` *(required)* | JSON text `{"ok":true}` — presses one named key. Known names: `Tab, Enter, Escape, Space, ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Delete, Backspace, ShiftTab` |

### Observe tools (4)

| Tool | Input schema | Result shape |
|------|--------------|--------------|
| `captureScreenshot` | `{ wcId: integer, delayMs?: integer }` *(`wcId` required)* | **Image content** (PNG, `image/png`). The tab is brought to front first; `delayMs` optionally tunes the paint-settle wait after foregrounding |
| `captureWindow` | *(none)* | **Image content** (PNG, `image/png`) of the whole browser window (chrome + composited guests) |
| `readDom` | `{ wcId: integer }` *(required)* | JSON text: `{ url, title, html }` — the full live `document.documentElement` outerHTML (no trimming), foreground-first |
| `readAxTree` | `{ wcId: integer }` *(required)* | JSON text: the accessibility-tree `AXNode` array — **or** a `{ automation: "debugger-unavailable", reason, wcId }` refusal (a **normal** result, see below). Foreground-first; uses the in-process debugger |

## Result and refusal semantics

The server returns three content shapes, and distinguishes *operational* outcomes (normal results)
from *genuine errors*:

- **Image content** — `captureScreenshot` and `captureWindow` return a single image block
  (`{ type: "image", data: <base64 PNG>, mimeType: "image/png" }`). The base64 is passed through
  verbatim — never JSON-wrapped.
- **JSON text** — every other tool returns one text block whose `text` is JSON. Void ops
  (`navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`)
  serialize to the single consistent shape `{"ok":true}`. Ops with a real return value
  (`enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `readDom`, `readAxTree`) serialize their
  actual value (array / number / boolean / `null` / object).
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
  { ts, sessionId, identity, op, targetWcId, outcome: "ok" | "error", errorCode }
  ```
  `ts` is epoch-ms; `op` is the tool name; `targetWcId` is the call's `wcId` argument or `null`
  (no-wcId ops: `enumerateTabs`, `openTab`, `captureWindow`); `outcome` is `"ok"` unless the call
  returned an `isError` result; `errorCode` carries the discriminated refusal code parsed from the
  `automation: <code> — …` message (e.g. `out-of-jar`, `admin-only`, `internal-session`,
  `bad-handle`) — or `"error"` for a bare/unexpected throw, and `null` on success.

**Snapshot shape** (the broadcast payload **and** the on-demand read):

```js
{
  sessions: [ { sessionId, identity, kind, jarId, since }, … ],
  log:      [ { ts, sessionId, identity, op, targetWcId, outcome, errorCode }, … ]  // newest-last
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
it. Run it against a live server:

```bash
npm run dev:automation                      # terminal 1: start the app + server
node scripts/mcp-example-client.mjs         # terminal 2: drive it
```

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
failure means the server isn't up, not that the config is wrong. (The repo's `.mcp.json` still
registers the `playwright` server; that entry is unrelated to this surface.)
