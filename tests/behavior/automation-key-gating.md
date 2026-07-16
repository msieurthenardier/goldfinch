# Behavior Test: Automation toggle gates key generation (not revocation)

**Slug**: `automation-key-gating`
**Status**: draft
**Created**: 2026-06-17
**Last Run**: 2026-06-17-17-23-30 — [run log](./automation-key-gating/runs/2026-06-17-17-23-30.md) (**partial** — toggle-OFF gating contract Steps 1-3 PASS via readDom; live toggle-flip Steps 4-6 carried, apparatus-limited)

## Intent
Verify the F8 **DD9** contract in the `goldfinch://settings` Keys subsection: when the automation
**enable toggle is OFF**, key **generation** is disabled — every jar's `Generate key` / `Rotate key`
button and the env-gated admin `Generate/Rotate admin key` button are `disabled` — while **Revoke**
stays available (governed only by whether a key exists), because we do **not** auto-revoke on
toggle-off. Flipping the toggle ON enables the mint buttons **live** (no reload); flipping OFF disables
them again. This needs a behavior test, not a unit test: the gating is a **rendered, cross-IIFE,
live-broadcast-wired** behavior in a guest WebContentsView on the `goldfinch://` scheme (the key-management
IIFE must observe the persisted `automationEnabled` and react to `onSettingsChanged`), and the
toggle→buttons coupling only manifests in the real rendered DOM. It backs the **SC8** opt-in model and
the F8 human-only-enable thesis: the surface must be a deliberate human ON before credentials can be
provisioned for it.

**Why this is testable in DEV (load-bearing).** Under F8, `dev:automation` installs an in-memory
**dev-enable override** (DD3/DD4) that keeps the surface **bound + auth-enabled regardless of the
persisted toggle** — so the admin MCP harness stays connected and can drive/observe the UI **while the
persisted `automationEnabled` is OFF**. The Keys gating reads the **persisted** value (the one the
toggle checkbox reflects), not the effective-bound state, so dev faithfully reproduces the production
"toggle OFF" UI. Without the override the surface would be unreachable when off and the contract could
not be observed over MCP at all.

## Preconditions
- **Apparatus — admin MCP surface (as in `settings-automation`).** Goldfinch running via
  `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1
  GOLDFINCH_MCP_PORT={port}` (dev-only env override — DD6). Capture the `AUTOMATION_DEV_MINT` jar
  `key` + `adminKey` from stdout. Connect an admin MCP client (`StreamableHTTPClientTransport`,
  `Authorization: Bearer <adminKey>`) on `127.0.0.1:{port}/mcp`. See `settings-automation.md`
  Preconditions for the full apparatus, the coordinate-click + focus-anchor rules, and the
  two-target (`chrome` vs `guestWcId`) discipline — assumed, not repeated.
- **Persisted toggle starts OFF (load-bearing).** On the **isolated dev profile** (F8 DD1,
  `~/.config/goldfinch-dev`), `automationEnabled` is `false` by default. After F8 DD3 the auto-mint
  no longer flips it, so at launch the **persisted** toggle is OFF even though the surface is live
  (dev override). Confirm by reading `automationEnabled` from `<dev-userData>/settings.json` before
  Step 1 (authoritative). If a prior run left it `true`, flip it off via the UI first (or reset the
  dev profile).
- **A jar WITH a key exists while OFF (fixture for the revoke-while-off assertion).** The
  `GOLDFINCH_AUTOMATION_DEV_MINT` auto-mint provisions **the resolved-default jar's** key at
  launch (programmatic, not the UI button — unaffected by DD9 gating) without enabling the
  toggle — post-M06 F2 DD7 this is whichever jar `jarsGetDefault()` reports, the legacy
  `default` jar on this migrated dev profile unless the default flag has been moved. **Record
  which jar holds the default flag before Step 1** — the spec's "the `default` jar row" /
  "the `default` jar's key" references below mean *that* jar, not necessarily the literal id
  `default`. So at launch: the resolved-default jar has `hasKey = true`, persisted toggle
  OFF — the exact fixture for "Revoke enabled while OFF." Confirm the resolved-default jar's
  key hash is present in `settings.json` and the toggle is OFF.
- **`disabled` is an attribute → readable over `readDom`.** Button `disabled` state serializes into
  `outerHTML`, so `readDom(guestWcId)` reads it directly (per the property-vs-attribute rule —
  attributes are correct over `readDom`; this avoids the post-interaction `.checked` trap). The
  toggle's **persisted** state is read from the store (authoritative), with the checkbox AX as a
  secondary UI-reflection check.
- **The build includes F8 DD9** — the Keys IIFE reads `automationEnabled` + subscribes to
  `onSettingsChanged`; jar mint buttons (`Generate key`/`Rotate key`) + the admin mint button gate on
  the persisted toggle; Revoke gates only on `hasKey`.
- **Apparatus disqualification:** `chrome-devtools` MCP does not qualify (launches its own browser).
  The apparatus is the SDK admin MCP client over `127.0.0.1:{port}`, app via `npm run dev:automation`
  (no `:9222`).

## Observables Required
- mcp (admin MCP tools — `readDom(guestWcId)` for the Keys rows' button labels + `disabled`
  attributes + jar key-status text; `captureWindow()` to locate the toggle + buttons for coordinate
  clicks; `click(guestWcId, x, y)` to flip the toggle + press buttons; `enumerateTabs` for `guestWcId`)
- filesystem (the **authoritative** persisted `automationEnabled` + jar key hashes in
  `<dev-userData>/settings.json`, read via Read/Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Precondition probe.** Connect the admin client; `tools/list`; `getChromeTarget()`. Read `automationEnabled` + the resolved-default jar's key hash from `<dev-userData>/settings.json` (record which jar holds the default flag via `jarsGetDefault()`/store — this is *the resolved-default jar* referenced below). Open Settings (`openTab('goldfinch://settings', null, {trusted:true})` or kebab→Settings); `enumerateTabs` → record `guestWcId`; `readDom(guestWcId)` to confirm the `#automation` section + `#automation-jars` render. | `getChromeTarget()` returns a numeric chrome `wcId` (surface is live via the dev override). The store shows `automationEnabled === false` (persisted toggle OFF) AND a non-empty key hash for the resolved-default jar (fixture present). The Keys subsection renders with at least the resolved-default jar's row. Else halt. |
| 2 | **Toggle-OFF gating (jar).** With the toggle OFF, `readDom(guestWcId)` the resolved-default jar's row (it has a key → mint button labeled `Rotate key`) and, if present, a keyless jar row (mint labeled `Generate key`). Read each row's mint button `disabled` + Revoke button `disabled` + the `jar-key-status` text. | Toggle OFF ⇒ every jar's **mint** button (`Rotate key` for the resolved-default jar, `Generate key` for keyless jars) is **`disabled`**. The resolved-default jar's **Revoke** button is **enabled** (`hasKey`); a keyless jar's Revoke is `disabled` (`!hasKey`, unchanged pre-existing behavior). Status text reads `key set` / `no key` accordingly. `[a11y]` |
| 3 | **Toggle-OFF gating (admin).** (Only when `GOLDFINCH_AUTOMATION_ADMIN` set.) `readDom(guestWcId)` the `#automation-admin` block: the admin mint button (`Generate admin key`/`Rotate admin key`) `disabled` + the admin Revoke `disabled` + `#automation-admin-status`. | Toggle OFF ⇒ the admin **mint** button is **`disabled`**. Admin **Revoke** follows `adminKeySet` only (enabled iff an admin key exists), independent of the toggle. (If the env gate is unset, the admin block is hidden — skip with `partial`.) |
| 4 | **Flip toggle ON (live enable).** Focus-anchor `click(guestWcId, x, y)` on the enable toggle and click to flip it ON. Re-read the persisted `automationEnabled` (store) + re-`readDom(guestWcId)` the jar mint buttons + admin mint button `disabled`. | Persisted `automationEnabled` flips to `true` (store read-back — authoritative). The jar mint buttons (`Generate key`/`Rotate key`) and the admin mint button become **enabled** — **live, without a reload** (the Keys IIFE reacted to `onSettingsChanged`). Revoke buttons unchanged (still `hasKey`-gated). The surface stays connected throughout (dev override — the harness does not lose its session when the persisted toggle changes). `[a11y]` |
| 5 | **Flip toggle OFF again (live disable).** `click(guestWcId, x, y)` the toggle to OFF. Re-read the store + the mint buttons' `disabled`. | Persisted `automationEnabled` returns to `false`; the jar + admin **mint** buttons are **`disabled`** again, live. Revoke unchanged. |
| 6 | **Revoke works while OFF (no auto-revoke + not gated).** With the toggle OFF, locate the resolved-default jar's **Revoke** button (enabled per Step 2); `click(guestWcId, x, y)`. Re-read that row's status + its key hash from the store. | The revoke **succeeds while the toggle is OFF**: the resolved-default jar's row flips to `no key`, its Revoke becomes `disabled`, its mint button relabels to `Generate key` (still `disabled`, toggle OFF), and the key hash is **removed from the store** (authoritative). Proves Revoke is independent of the toggle and that toggle-off did **not** auto-revoke earlier (the key survived Steps 2–5 until this explicit revoke). |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant (disabled-state + control labels).
Step 3 degrades to `partial` if `GOLDFINCH_AUTOMATION_ADMIN` is unset. The authoritative witness for
toggle + key state is the **store read** (`settings.json`); button `disabled` is read from `readDom`
`outerHTML` (attribute — correct). The dev-override decoupling (surface live while persisted toggle
OFF) is what makes Steps 2–6 observable over MCP — note it in the run log.

## Out of Scope
- **The bind/auth consequence of the toggle in production** (toggle binds/unbinds the server) — that is
  packaged-build behavior, covered by the F8 `verify-integration` + HAT legs, not this dev UI test.
- **Key validity / auth gating over the wire** (a minted key authenticates; a revoked key 401s) —
  covered by `mcp-auth-gating` / `mcp-jar-scoping`.
- **Show-once reveal + copy mechanics, rotate-produces-new-key** — covered by `settings-automation`
  (Steps 8–10); this test asserts only the **enable/disable gating** of the mint controls.
- **Persistence/restart behavior of keys** — out of scope.

## Variants (optional)
- Parametrize across multiple jars (a keyed + a keyless jar) to assert the gating is uniform across
  rows (the keyed/keyless distinction only changes the mint label + Revoke's `hasKey` gate, never the
  toggle gate on mint).
