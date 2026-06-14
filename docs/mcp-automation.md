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
| Default URL | `http://127.0.0.1:7777/mcp` |
| Bind | `127.0.0.1` only (never `0.0.0.0` / `::`) |
| Port override | `GOLDFINCH_MCP_PORT` (any valid positive integer; else `7777`) |
| Transport | MCP Streamable HTTP, stateful (per-connection session id) |

**The path is a convention, not a route.** The server runs the Origin/Host guard and then hands
*every* request — at any path — to the transport; it does not route on the URL path. The documented
`/mcp` path is purely a clean, conventional URL. A consumer that posts to `http://127.0.0.1:7777/`
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

The repo's `.mcp.json` registers this server for Claude Code as an HTTP MCP server:

```json
"goldfinch": { "type": "http", "url": "http://127.0.0.1:7777/mcp" }
```

This entry is **inert until `npm run dev:automation` is running** — a connection failure means the
server isn't up, not that the config is wrong. (The same file also registers the `playwright`
server; that entry is unrelated to this surface.)
