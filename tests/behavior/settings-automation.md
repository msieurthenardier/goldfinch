# Behavior Test: Automation settings — toggle, address/port, keys, activity

**Slug**: `settings-automation`
**Status**: draft
**Created**: 2026-06-15
**Last Run**: never

## Intent
Verify that the `goldfinch://settings` **Automation** section is a complete, self-service control
surface: the operator can turn the surface on/off, see the live MCP connection address + bind-status,
configure the listen port (with a "find free port" helper), generate / rotate / revoke a per-jar key
(show-once plaintext + copy) and — when env-gated — the admin key, and watch automation activity (a
visible chrome indicator + an in-settings audit viewer). This needs a behavior test, not a unit test,
because the assertions are real-environment, cross-process UI observations: the settings shell renders
inside a `<webview>` guest on the privileged `goldfinch://` scheme (driven via CDP), the activity
indicator lives in the chrome renderer, and the indicator/viewer only populate against a **live MCP
session** over the loopback transport. It backs **SC9** (keys managed from Settings — generate / rotate
/ revoke, effective immediately), the **visible half of SC10** (a visible "automation active" indicator
that distinguishes admin from jar and names the jar, plus an action-log viewer), and the **SC8 toggle
UI** (the off-by-default opt-in gets its operator-facing control).

## Preconditions
- Goldfinch running via `npm run dev:debug` (CDP `:9222`); `scripts/cdp-driver.mjs` reaches it. **Not**
  the `chrome-devtools` MCP (it launches its own browser → false pass).
- The build includes the leg-2–4 Automation section: the enable toggle, address/port/bind-status
  controls, the per-jar + admin key controls, and the activity indicator + audit viewer.
- **Port pinned** for determinism: launch with `GOLDFINCH_MCP_PORT={port}` so the rendered address is
  predictable regardless of the new default (`49707`). The spec refers to it as `{port}` throughout.
- **Live-session staging** (for the indicator/viewer steps): launch with `--automation-dev` +
  `GOLDFINCH_AUTOMATION_DEV_MINT=1` so a jar key (and, with `GOLDFINCH_AUTOMATION_ADMIN` also set, an
  admin key) is minted once to stdout (`AUTOMATION_DEV_MINT {…}`); a minimal MCP client (a loopback
  `initialize` POST to `http://127.0.0.1:{port}/mcp` with `Authorization: Bearer <key>`, or the Flight-3
  example client) opens a session. Note: `dev:debug` enables the CDP port but NOT the MCP gate — the run
  must launch the MCP surface (`--automation-dev`) alongside, or run a second instance; record which.
- **Admin-tier steps** require `GOLDFINCH_AUTOMATION_ADMIN` set in the launch env; without it, the admin
  block is expected hidden (the negative case in step 9).
- **Guest-reachability probe**: after opening Settings, confirm the `goldfinch://settings` guest is
  attachable for DOM reads (it surfaced in the flat CDP `/json` list in Flight-4 runs; else fall back to
  `Target.getTargets`/`setAutoAttach`).

## Observables Required
- browser (rendered guest DOM of `goldfinch://settings` — the `#automation` section controls + their
  values/text; the chrome renderer's `#automation-indicator` + badge + title; settings written to the
  store, read back via the bridge — measured via `scripts/cdp-driver.mjs` / node-CDP attach to the guest
  **and** the chrome renderer; screenshot + DOM reads)
- http (loopback `initialize` to `/mcp` with a Bearer to stage a live session — measured via Bash/curl
  or the example client)
- shell (precondition probes; the `AUTOMATION_DEV_MINT` stdout line; `:9222` reachability — measured via
  Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe: `node scripts/cdp-driver.mjs eval '1+1'`; confirm a Goldfinch renderer target at `:9222`. | Returns `2`; the chrome renderer (index.html) target is present. Else halt. |
| 2 | Open Settings (kebab ⋮ → Settings, or the trusted `createTab('goldfinch://settings', null, {trusted:true})` — note which). Attach to the guest; confirm the `#automation` section + its nav link render. | A `goldfinch://settings` tab opens (partition `goldfinch-internal`); the guest shows a `<section id="automation">` with an enable toggle, an address field, a port field, a Keys subsection, and an Activity area. |
| 3 | Read `#automation-enabled.checked` and `automationEnabled` from the store; toggle `#automation-enabled` (click); re-read both. | The toggle's checked state and the persisted `automationEnabled` start consistent, flip together on click, and the new value is persisted (read-back matches). `[a11y]` |
| 4 | Read `#automation-address.value`, `#automation-status` text, and `#automation-enabled-note` text. | The address reads exactly `http://127.0.0.1:{port}/mcp` (host `127.0.0.1`, the pinned `{port}`). `#automation-status` reflects reality with the verbatim prefixes: `Connected — listening on 127.0.0.1:{port}` when the MCP surface is bound this launch; `Not running — start Goldfinch with --automation-dev to bind the surface` when the surface isn't active; or `Failed to bind: <error>` on a bind failure. When not bound, `#automation-enabled-note` reads `Takes effect when Goldfinch is launched with --automation-dev.` (the SC8 honesty note); empty when bound. |
| 5 | Click `#automation-copy-address`; read the clipboard (or the transient `#automation-message`). | The address is copied (clipboard holds `http://127.0.0.1:{port}/mcp`, or `#automation-message` shows "Copied"); no error. |
| 6 | Read `#automation-port.value` (pending). Enter an out-of-range value (e.g. `80`), click `#automation-port-save`; read `#automation-message` + the persisted `automationPort`. Then enter a valid value (e.g. `{port}`), save; read back. | The pending field shows the stored `automationPort`. The out-of-range save shows an inline error ("Invalid port (1024–65535)") and does NOT change the persisted value. The valid save persists and shows no error. (No live rebind — change is next-launch by design.) |
| 7 | Click `#automation-find-port`; read `#automation-port.value` + persisted `automationPort`. | The field is populated with a free loopback port in `49152–65535` and the value is persisted (or, if none free, an inline "no free port found" with the field unchanged). |
| 8 | In `#automation-jars`, find the `default` jar row; read its key-status text + the Revoke button's `disabled`. Click its mint button (labeled **Generate key** while `!hasKey`); read `#automation-key-reveal` (visible?) + `#automation-key-value`; click `#automation-key-copy`; re-read the jar row's status + the mint button label + Revoke `disabled`. Click the same mint button (now labeled **Rotate key**); confirm a NEW key is revealed. Click **Revoke**; re-read the row + reveal. | Pre-mint: status `no key`, the **Revoke** button `disabled`. Generate: `#automation-key-reveal` becomes visible with a non-empty one-time key in `#automation-key-value`; copy succeeds; the row flips to `key set`, the mint button relabels to **Rotate key**, and **Revoke** becomes enabled. The persisted `automationEnabled` is now `true` (a side effect of `enableAndMintJarKey`) — read it back from the store; NOTE the `#automation-enabled` checkbox itself only re-syncs on the next settings load (the side-effect write does not broadcast `settings-changed`), so assert the *stored* value, not the live checkbox. Rotate: a different key is revealed and the row stays `key set`. Revoke: the row returns to `no key`, **Revoke** disables again, the reveal is cleared/hidden. |
| 9 | Trigger a settings re-render / re-open the section; read `#automation-key-reveal`. Then read `#automation-admin.hidden`. | The show-once key is NOT re-fetchable — after refresh `#automation-key-reveal` is hidden/empty (only the hash is stored). `#automation-admin.hidden === true` when `GOLDFINCH_AUTOMATION_ADMIN` is unset, and `false` (block present) when it is set. |
| 10 | (Admin-tier — only when `GOLDFINCH_AUTOMATION_ADMIN` set) Read `#automation-admin-status`. Click `#automation-admin-mint`; read the reveal + status. Click `#automation-admin-revoke`; re-read status. | Mint: the admin key is revealed once (+ copyable) and `#automation-admin-status` reads `Admin key set`; revoke returns it to `No admin key`. (Negative path when the env gate is unset is covered by step 9.) |
| 11 | Stage a **live jar session**: using the `AUTOMATION_DEV_MINT` jar key, POST an MCP `initialize` to `http://127.0.0.1:{port}/mcp` with `Authorization: Bearer <jar-key>`. Attach to the **chrome renderer** (index.html) target and read `#automation-indicator` (`.hidden`? `#automation-indicator-badge` text? `title`/`aria-label`). Attach to the **settings guest** and read `#automation-active-sessions` + `#automation-activity-log`. | With a session attached: `#automation-indicator` is NOT `.hidden`, its badge shows the session count, and its `title`/`aria-label` reads `<n> automation session(s) connected: <default jar display name>` (wording "connected", names the jar). `#automation-active-sessions` lists the session as a **jar** session naming the jar + a "since" time; `#automation-activity-log` shows the `initialize`/tool entries newest-first. *(Degradable to `partial` if a session cannot be staged in the run env — the cross-jar/admin/burner matrix is covered by `mcp-jar-scoping`; this step only confirms the UI renders a real session, and the empty-state otherwise.)* |
| 12 | (If an admin session can also be staged) Open a second session with the admin Bearer; re-read `#automation-indicator` + `#automation-active-sessions`. | `#automation-indicator` gains the `.admin` class (a distinct **non-alarm** state) and the viewer marks the admin session row with the `.admin` class, labeled `admin` (not via a jar name), distinct from the jar row. *(Degradable to `partial`; admin matrix lives in `mcp-jar-scoping`.)* |
| 13 | Close the staged session(s) (drop the transport); re-read `#automation-indicator` + `#automation-active-sessions`. | Once all transports close, `#automation-indicator` hides again and `#automation-active-sessions` returns to its empty state ("No automation sessions"). (A revoked-but-open session legitimately lingers as "connected" until its transport closes — DD6.) |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Steps 11–13's live-session checks
degrade to `partial`/`inconclusive` if a session can't be staged in the run environment; the UI-control
steps (2–10) fully verify SC9 + SC8 + the SC10 viewer's empty state without a live session.

## Out of Scope
- **MCP transport / auth internals** — the Bearer gate, 401s, loopback bind, Origin/Host allow-listing:
  covered by `mcp-auth-gating` and `mcp-loopback-origin-guard`.
- **The cross-jar scoping matrix** (a jar key seeing only its jar's tabs; internal-session exclusion;
  burner unautomatable; admin sees all): covered by `mcp-jar-scoping` (run in the same leg-6 pass).
- **Live rebind on a port change** — by design the port change takes effect on next launch, not live;
  this spec asserts persistence + the pending/active distinction, not a live rebind.
- **The full action-log fidelity** of every op type — the viewer is checked for structure + a real
  session's entries, not an exhaustive op catalog.

## Variants (optional)
- N/A for the draft. Could later parametrize across multiple jars (personal/work) once the cross-jar
  staging from `mcp-jar-scoping` is folded in, or add a no-`--automation-dev` variant asserting the
  whole section reads "Not running" honestly.
