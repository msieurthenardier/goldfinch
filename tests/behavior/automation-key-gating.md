# Behavior Test: Automation toggle gates key generation (not revocation)

**Slug**: `automation-key-gating`
**Status**: draft
**Created**: 2026-06-17
**Last Run**: 2026-10-23-23-56-29 (pass — 7/7; see `automation-key-gating/runs/`)

> **Re-authored 2026-10-23 (squawk 0156).** (1) Every `settings.json` read is now a read-only `node:sqlite` query of the
> dev profile's `app.db` `documents` row `store = 'settings'` (recipe below; fields `automationEnabled`,
> `automationKeyHashes`, `automationAdminKeyHash`). (2) The persisted toggle is **not** assumed OFF at start (the current
> dev profile has it ON): Step 1 records `enabledStart` and sets the toggle OFF as setup. (3) Launch recipe updated
> (`GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 … npm run dev:automation`, `connectAutomation()` env-key
> attach; the `--automation-dev` flag is baked into the npm script). (4) Dev-override truth asserted (surface stays bound,
> status stays `Connected — listening on 127.0.0.1:{port}`, harness session survives toggle flips). (5) Button labels /
> status strings re-checked against `src/renderer/pages/automation.js` (`Generate key`/`Rotate key`, `Revoke`, `key set`/`no key`,
> `Generate admin key`/`Rotate admin key`, `Admin key set`/`No admin key` — unchanged). (6) New **Step 7 cleanup/restore**
> and an Orchestrator B0 snapshot/restore instruction so the run leaves the profile as it found it. Steps 1–6 numbering kept.

## Intent
Verify the F8 **DD9** contract on the `goldfinch://automation` page's Keys section: when the automation
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
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT={port} npm run dev:automation` (dev-only
  env override — DD6; the npm script already carries `--automation-dev`). Capture the one parseable
  `AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey>"}` stdout line (both keys shown once; `DEV_MINT` replaces the
  default jar's key hash and the admin hash). Attach an admin client with `connectAutomation({ key: adminKey, port })` from
  `scripts/lib/mcp-client.mjs` (env-key model) on `127.0.0.1:{port}/mcp` — never the registered `goldfinch-dev` MCP server
  (`docs/dev-testing.md`). See `settings-automation.md`
  Preconditions for the full apparatus, the coordinate-click + focus-anchor rules, and the
  two-target (`chrome` vs `guestWcId`) discipline — assumed, not repeated.
- **Store read recipe (replaces the retired `<dev-userData>/settings.json`).** Settings live in
  `~/.config/goldfinch-dev/app.db`, table `documents(store PK, payload, updated_at)`, row `store = 'settings'`. "Store read"
  below means this read-only query (safe while the app runs — WAL readers never block the writer; each settings write is one
  committed UPSERT, so re-run once if a read looks a step stale); it prints key *names* and booleans, never hashes (Node ≥ 22;
  the `ExperimentalWarning` is on stderr):
  ```sh
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.config/goldfinch-dev/app.db',{readOnly:true});const s=JSON.parse(db.prepare(\"SELECT payload FROM documents WHERE store='settings'\").get().payload);console.log(JSON.stringify({automationEnabled:s.automationEnabled,automationPort:s.automationPort,jarKeys:Object.keys(s.automationKeyHashes||{}).sort(),adminKeySet:!!s.automationAdminKeyHash}))" 2>/dev/null
  ```
- **Persisted toggle starts in an arbitrary state — set it OFF in Step 1 (load-bearing).** The dev profile's
  `automationEnabled` is whatever the last session left (currently `true`; it defaults to `false`). DD3 means the auto-mint
  never flips it, and the dev-enable override keeps the surface bound/authenticated whatever the toggle says, so the harness
  can set it OFF through the UI and keep driving. Step 1 records `enabledStart` and, if it is `true`, clicks the toggle OFF as
  setup before judging Step 2.
- **State hygiene (this spec flips the toggle and revokes a key).** Before launching (app NOT running) the Orchestrator takes
  a **B0 snapshot** of the four automation fields to a scratch file (mode 0600; contains hashes — never paste into a log):
  ```sh
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.config/goldfinch-dev/app.db',{readOnly:true});const s=JSON.parse(db.prepare(\"SELECT payload FROM documents WHERE store='settings'\").get().payload);const {automationEnabled,automationPort,automationKeyHashes,automationAdminKeyHash}=s;require('fs').writeFileSync(process.argv[1],JSON.stringify({automationEnabled,automationPort,automationKeyHashes,automationAdminKeyHash}),{mode:0o600})" <scratch>/automation-b0.json 2>/dev/null
  ```
  Step 7 restores the toggle in-app. **After the run, once the app has fully quit**, the Orchestrator restores B0 exactly
  (Step 6 revokes the launch-minted default-jar key, which no in-app step can bring back), then re-runs the read recipe to
  confirm it equals B0 — never run this while the app is running (both recipes were verified against a copy of the dev profile):
  ```sh
  node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.config/goldfinch-dev/app.db');const snap=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const r=db.prepare(\"SELECT payload FROM documents WHERE store='settings'\").get();const s=Object.assign(JSON.parse(r.payload),snap);db.prepare('UPDATE documents SET payload=?2, updated_at=?3 WHERE store=?1').run('settings',JSON.stringify(s,null,2),Date.now())" <scratch>/automation-b0.json 2>/dev/null
  ```
- **A jar WITH a key exists while OFF (fixture for the revoke-while-off assertion).** The
  `GOLDFINCH_AUTOMATION_DEV_MINT` auto-mint provisions **the resolved-default jar's** key at
  launch (programmatic, not the UI button — unaffected by DD9 gating) without touching the
  toggle — whichever jar `jarsGetDefault()` reports (read the `defaultId` of the `jars` row in `app.db`; `personal` on the
  current dev profile). **Record which jar holds the default flag before Step 1** — "the resolved-default jar" below means
  *that* jar. Confirm the recipe's `jarKeys` includes it.
- **`disabled` is an attribute → readable over `readDom`.** Button `disabled` state serializes into
  `outerHTML`, so `readDom(guestWcId)` reads it directly (per the property-vs-attribute rule —
  attributes are correct over `readDom`; this avoids the post-interaction `.checked` trap). The
  toggle's **persisted** state is read from the store (authoritative), with the checkbox AX as a
  secondary UI-reflection check.
- **Dev-override truth (asserted, not assumed).** `dev:automation` binds the surface regardless of the persisted toggle
  (`devEnableOverride`; flip-OFF returns early in `toggle.js`), so `#automation-status` reads `Connected — listening on
  127.0.0.1:{port}` and the harness session survives every toggle flip in Steps 1/4/5/7.
- **Property reads.** `<input>` values and a checkbox's `.checked` are not in `readDom` `outerHTML`; read the toggle with
  `evaluate({ wcId: guestWcId, expression: "document.getElementById('automation-enabled').checked" })` (`evaluate` takes
  `expression`; a wrong key silently returns `{ok:true}`). Button `disabled` and `hidden` are attributes — `readDom` is right.
- **Clicks.** Coordinate-based (`click({ wcId, x, y })` via `captureWindow()`), with a focus-anchor click first; if guest
  coordinate clicks do not land on the venue (WSLg), fall back to `evaluate` `document.getElementById('automation-enabled').click()`
  and mark the row `partial` for input fidelity only.
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
- sqlite store (the **authoritative** persisted `automationEnabled` + jar key names / `adminKeySet` in the dev profile's
  `app.db` `documents` row `store = 'settings'`, read with the recipe in Preconditions via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Precondition probe + toggle-OFF setup.** Connect the admin client (`connectAutomation`); `tools/list`; `getChromeTarget()`. Run the store-read recipe: record `enabledStart`, `jarKeys`, `adminKeySet`, and the resolved-default jar (`defaultId` of the `jars` row) — *the resolved-default jar* below. Open the Automation page (`evaluate({ wcId: <chrome wcId>, expression: "createTab('goldfinch://automation', null, { trusted: true })" })` — the chrome seam; the kebab click itself is [by-eye]/HAT); `enumerateTabs` → record `guestWcId`; `readDom(guestWcId)` to confirm the `#keys` section + `#automation-jars` render. Read the toggle (`evaluate` `.checked`). **If `enabledStart` is `true`, click the toggle OFF** (focus-anchor click first) and store-read until `automationEnabled === false`; confirm `enumerateTabs` still works (no reconnect) and `#automation-status` reads `Connected — listening on 127.0.0.1:{port}`. | `getChromeTarget()` returns a numeric chrome `wcId` (surface is live via the dev override). After setup the store shows `automationEnabled === false` (persisted toggle OFF) and `jarKeys` includes the resolved-default jar (key fixture present). The toggle's `.checked` is `false`. The Keys section renders with at least the resolved-default jar's row. The harness stays connected and the status stays `Connected — …` through the OFF flip (dev override). Else halt. |
| 2 | **Toggle-OFF gating (jar).** With the toggle OFF, `readDom(guestWcId)` the resolved-default jar's row (it has a key → mint button labeled `Rotate key`) and, if present, a keyless jar row (mint labeled `Generate key`). Read each row's mint button `disabled` + Revoke button `disabled` + the `.jar-key-status` text. | Toggle OFF ⇒ every jar's **mint** button (`Rotate key` for a keyed jar, `Generate key` for keyless jars) is **`disabled`**. The resolved-default jar's **Revoke** button is **enabled** (`hasKey`); a keyless jar's Revoke is `disabled` (`!hasKey`). Status text reads `key set` / `no key` accordingly. `[a11y]` |
| 3 | **Toggle-OFF gating (admin).** (Only when `GOLDFINCH_AUTOMATION_ADMIN` set.) `readDom(guestWcId)` the `#automation-admin` block (no `hidden`): the admin mint button (`Generate admin key`/`Rotate admin key`) `disabled` + the admin Revoke (`#automation-admin-revoke`) `disabled` + `#automation-admin-status` (`Admin key set` / `No admin key`). Do **not** click any admin control (a rotate/revoke would invalidate the harness's own key). | Toggle OFF ⇒ the admin **mint** button is **`disabled`**. Admin **Revoke** follows `adminKeySet` only (enabled iff an admin key exists — it does here, `DEV_MINT` minted one), independent of the toggle. (If the env gate is unset, the admin block has `hidden` — skip with `partial`.) |
| 4 | **Flip toggle ON (live enable).** Focus-anchor `click({ wcId: guestWcId, x, y })` on the enable toggle and click to flip it ON. Re-read the persisted `automationEnabled` (store) + the toggle `.checked` + re-`readDom(guestWcId)` the jar mint buttons + admin mint button `disabled` + `#automation-status`. | Persisted `automationEnabled` flips to `true` (store read-back — authoritative). The jar mint buttons (`Generate key`/`Rotate key`) and the admin mint button become **enabled** — **live, without a reload** (the Keys IIFE reacted to `onSettingsChanged`). Revoke buttons unchanged (still `hasKey`-gated). The surface stays connected throughout and `#automation-status` stays `Connected — listening on 127.0.0.1:{port}` (flip-ON on an already-bound dev surface is a guarded no-op; the harness does not lose its session). `[a11y]` |
| 5 | **Flip toggle OFF again (live disable).** `click({ wcId: guestWcId, x, y })` the toggle to OFF. Re-read the store + the toggle `.checked` + the mint buttons' `disabled` + `#automation-status`. | Persisted `automationEnabled` returns to `false`; the jar + admin **mint** buttons are **`disabled`** again, live. Revoke unchanged. The surface is **still bound** and the harness still connected (dev-enable override: flip-OFF returns early instead of tearing the server down) — status still `Connected — listening on 127.0.0.1:{port}`. |
| 6 | **Revoke works while OFF (no auto-revoke + not gated).** With the toggle OFF, locate the resolved-default jar's **Revoke** button (enabled per Step 2); `click({ wcId: guestWcId, x, y })`. Re-read that row's status/buttons via `readDom` and the store (`jarKeys`). | The revoke **succeeds while the toggle is OFF**: the resolved-default jar's row flips to `no key`, its Revoke becomes `disabled`, its mint button relabels to `Generate key` (still `disabled`, toggle OFF), and the jar **leaves `jarKeys` in the store** (authoritative). Proves Revoke is independent of the toggle and that toggle-off did **not** auto-revoke earlier (the key survived Steps 2–5 until this explicit revoke). The harness (admin key) is unaffected. |
| 7 | **Cleanup / restore (final step; run even after a failure).** Restore the toggle to `enabledStart`: if it differs from the current persisted value, click the toggle (or `evaluate` `window.goldfinchInternal.settingsSet('automationEnabled', <enabledStart>)` if clicks are unavailable). Store-read and compare `automationEnabled`/`automationPort`/`adminKeySet` to the start values; confirm no key was minted by this run (`jarKeys` ⊆ the launch set, minus the Step 6 revoke). Then the Orchestrator quits the app and performs the **B0 restore** (Preconditions) and re-reads the store. | `automationEnabled === enabledStart` and `automationPort` unchanged (this spec never touches the port); no extra keys. After the B0 restore the four automation fields equal the pre-launch snapshot, so the next launch's bind/port/keys are unchanged. |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant (disabled-state + control labels). Step 7 is a state-restore row.
Step 3 degrades to `partial` if `GOLDFINCH_AUTOMATION_ADMIN` is unset. The authoritative witness for
toggle + key state is the **store read** (`app.db` `documents` row `settings`); button `disabled` is read from `readDom`
`outerHTML` (attribute — correct). The dev-override decoupling (surface live while persisted toggle
OFF) is what makes Steps 2–6 observable over MCP — note it in the run log. Not covered here: the production consequence of toggle-OFF (server teardown) — packaged-build only.

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
