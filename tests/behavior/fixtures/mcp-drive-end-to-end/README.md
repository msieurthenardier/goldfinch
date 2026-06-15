# mcp-drive-end-to-end fixture

Behavior-test fixture for the `mcp-drive-end-to-end` test. Serves a static page whose
render **visibly echoes** synthesized input so trusted input driven over the Goldfinch
MCP surface (`typeText` / `click` / `pressKey`) can be confirmed by **rendered state**
(screenshot pixels + a11y tree), not by a DOM `.value` read (AUTHORING.md rendered-state
discipline).

The page mirrors:

- **typed text** → a large blue `ECHO: <text>` line (`#echo`),
- **a click on `#btn`** → `CLICK: button was clicked` (`#click-label`),
- **Enter pressed in the field** → `KEY: Enter pressed` (`#key-label`).

## Serve

Run from this directory **on a non-CDP HTTP port** (NOT 9222 — that's the CDP port the
`dev:debug` path uses; this spec uses the `dev:automation` path which has no CDP port, but
keep the fixture port distinct anyway, e.g. `8090`):

```
python3 -m http.server 8090
```

The fixture is then reachable at **http://127.0.0.1:8090/**.

The spec navigates an MCP-opened tab to this URL, synthesizes input via the MCP drive
tools, and asserts the echo appears in a `captureScreenshot` (pixels) / `readAxTree`
(a11y) read of the same tab.
