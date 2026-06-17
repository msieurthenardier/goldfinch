# Leg: human-only-enable-and-flag-demote

**Status**: completed
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](../flight.md)

## Objective
Make enabling the automation surface **human-only / UI-only** (no programmatic `automationEnabled=true` writer), demote `--automation-dev` to a dev-only convenience (no-op when packaged) via an **in-memory dev-enable override** that satisfies both the bind decision and the auth gate **without writing the setting**, and gate the Settings **key-generation** buttons (jar + admin mint) on the persisted toggle while leaving **Revoke** ungated.

## Context
- **DD3 + DD4 + DD9.** Companion to leg 2: leg 2 made the toggle the production bind gate and force-bound dev under the raw `isMcpAutomationEnabled(process.argv)` term; this leg replaces that with the proper dev-enable override, removes every programmatic enable path, gates the dev flag behind `!app.isPackaged`, and adds the DD9 mint-button gating.
- **The auth gate problem (Architect MEDIUM):** force-binding the *server* does **not** satisfy the auth gate — `resolveIdentity` (`mcp-server.js`) returns null unless `automationEnabled===true`. So a force-bound-but-disabled dev surface 401s everything. After we remove the auto-enable side-effect, the dev profile's persisted toggle stays **off**, so dev needs an **in-memory dev-enable override** that satisfies **both** the bind decision (DD2) **and** the auth gate, **without writing `automationEnabled`**. This keeps the persisted value `false` (human-only invariant preserved even in dev) while the headless harness gets a usable surface.
- **Full enumeration of `automationEnabled=true` writers (Architect-verified) — after this leg only (2) remains:**
  1. `enableAndMintJarKey` (`mcp-server.js`) `settings.set('automationEnabled', true)` — **removed here** (function loses the side-effect; renamed `mintJarKey`).
  2. the settings-UI toggle IPC `internal-settings-set` ← the toggle `change` handler — the **intended sole persisted human writer** (unchanged).
  3. the dev auto-mint stdout block (`main.js`, calls `enableAndMintJarKey`) — inherits the side-effect today; after the rename it mints the key hash only, and the dev-enable override (not a setting write) satisfies enable.
- **DD9 gates GENERATION not revocation, on the PERSISTED value:** mint buttons disabled when persisted `automationEnabled` is off; Revoke stays `hasKey`-gated (no auto-revoke). Gate on the **persisted** setting (what the toggle checkbox reflects), **not** `status.enabled`/effective-bound — so dev (override live, persisted off) faithfully mirrors production key-gating and the contract is testable in dev.

## Inputs
What exists before this leg runs (legs 1–2 landed, uncommitted):
- `mcp-server.js`: `enableAndMintJarKey(jarId, settings, jars)` — mints, stores hash under `automationKeyHashes`, **and `settings.set('automationEnabled', true)`**; `mintAdminKey(settings)` — mints admin hash, **does NOT** write `automationEnabled` (confirmed); `resolveIdentity` — `if (settings.get('automationEnabled') !== true) return null;` then `validateKey`; `createMcpServer(opts)` — accepts `getSettings`/`getEngine`/`scopeCtx`/etc.
- `main.js`: imports `{ …, enableAndMintJarKey, mintAdminKey, … }` (`main.js:17`); launch bind via `shouldBindAutomation({ automationEnabled: …, devForceBind: isMcpAutomationEnabled(process.argv) })` (leg 2); `applyAutomationEnabledChange(enabled)` (leg 2); auto-mint block calls `enableAndMintJarKey('default', settings, jars)`; the `automation:jar-key-mint` IPC; **call sites of the dev flag**: `main.js:241` (additionalArguments `isAutomationDevEnabled(process.argv)`), `main.js:939` (`if (isAutomationDevEnabled(process.argv))` dev-seam registration).
- `automation-dev.js`: pure predicates (electron-free) — `isAutomationDevEnabled`, `isMcpAutomationEnabled`, `shouldAutoMint`, `shouldBindAutomation`.
- `settings.js` (`src/renderer/pages/settings.js`): the **key-management IIFE** (`renderJars` with `mintBtn`/`revokeBtn`, `renderAdmin` with `adminMintBtn`/`adminRevokeBtn`, `refresh()`); the `automationKeysOnce()` shared fetch (returns `{jars, adminEnabled, adminKeySet}` — **not** `automationEnabled`); the enable IIFE that already reads `automationEnabled` + subscribes `onSettingsChanged`.
- `test/unit/automation-mcp-server.test.js`: imports + ~8 call sites of `enableAndMintJarKey`, including **`assert.equal(settings.get('automationEnabled'), true)`** (line ~990) which pins the **old** side-effect and MUST be inverted; line 414 `auth gate — 401 when automationEnabled is false`.
- Authored behavior spec `tests/behavior/automation-key-gating.md` (draft) — backs DD9; run at leg 7/8, not here.
- `tests/behavior/settings-automation.md` Step 8 — asserts the **old** "persisted `automationEnabled` is now `true` (a side effect of `enableAndMintJarKey`)"; must be updated.

## Outputs
- `enableAndMintJarKey` renamed `mintJarKey` and **stripped of the `settings.set('automationEnabled', true)` line** — it stores the key hash only. All references updated (mcp-server export + jsdoc, `main.js` import + 2 call sites + the stale jar-key-mint comment, the test import + call sites).
- An **in-memory dev-enable override** computed once in `main.js` (`!app.isPackaged && isMcpAutomationEnabled(process.argv)`), threaded into: the launch bind `devForceBind`, the `applyAutomationEnabledChange` flip-OFF guard (keep bound in dev), and the **auth gate** (`createMcpServer` gains a `devEnableOverride` option; `resolveIdentity` resolves identity when `automationEnabled===true` **OR** the override is set).
- `--automation-dev` gated with `&& !app.isPackaged` at the three main-process call sites (additionalArguments, dev-seam, the bind/auto-mint dev branch via the override). Predicates stay electron-free.
- No programmatic `automationEnabled=true` writer remains except the human toggle IPC (confirmed by grep + the inverted test).
- Settings key-management IIFE: jar + admin **mint** buttons `disabled` ⇔ persisted `automationEnabled` is off, **live** via `onSettingsChanged`; **Revoke** unchanged (gated only on `hasKey`/`adminKeySet`).
- `settings-automation.md` Step 8 updated (mint does NOT enable + DD9 gating); `automation-key-gating.md` referenced as the DD9 acceptance.

## Acceptance Criteria

### DD3 — remove the auto-enable side-effect (human-only enable)
- [x] `enableAndMintJarKey` is renamed `mintJarKey` and **no longer calls `settings.set('automationEnabled', true)`** — it stores the key hash under `automationKeyHashes` and returns the plaintext only. The mint guard (jarId must be in `jars.list()`) and the TypeError on empty jarId are preserved. Export + jsdoc updated; `main.js` import (`main.js:17`) + both call sites (auto-mint, `automation:jar-key-mint` IPC) updated; the stale jar-key-mint comment ("enableAndMintJarKey flips automationEnabled=true …") rewritten: mint now changes only `automationKeyHashes`; **keep the `settings-changed` broadcast and its rationale** — `automationKeyHashes` IS a setting and the broadcast re-syncs the key list's `hasKey`/`adminKeySet` rendering; only the false "flips automationEnabled=true / re-syncs the enable toggle" clause is dropped.
- [x] **Test assertions reconciled (state-machine reachability audit — there are 11 refs, not ~8):** in `test/unit/automation-mcp-server.test.js`:
  - **Invert** line ~990 `assert.equal(settings.get('automationEnabled'), true)` → assert minting does **NOT** enable (stays `undefined`).
  - **Reframe** the test names at ~985 ("minting a KNOWN jar id succeeds and the key validates") — drop any enable implication — and ~995 ("does not enable / store"), and the line-1002 message ("surface not enabled on a rejected mint") which is now misleading since mint *never* enables: reword to the "mint creates credential only, never enables" intent. Line 1002/1003's `automationKeyHashes` assertions stay.
  - **Rename all 11** `enableAndMintJarKey` references (1 import + 10 call sites) to `mintJarKey` — confirm the count is exactly 11 (`grep -c`), no estimate-driven partial rename.
- [x] **`mintAdminKey` unchanged** — confirmed it does not write `automationEnabled` (no code change; re-verify by reading it).
- [x] **No other programmatic enable path:** `grep -rn "automationEnabled" src/` confirms the only `settings.set('automationEnabled', …)` writer is the toggle IPC path (`internal-settings-set`). Confirm no MCP tool / engine writes settings (`mcp-tools.js`/`engine.js` have no `settings.set`; the auth gate's `getSettings` is read-only) — re-confirm by grep and note it in the flight-log.

### DD3/DD4 — dev-enable override + flag demotion
- [x] **In-memory dev-enable override** computed once in `main.js`: `const devEnableOverride = !app.isPackaged && isMcpAutomationEnabled(process.argv);`. It writes **nothing** to the settings store.
- [x] **Bind:** the launch gate's `devForceBind` term is now `devEnableOverride` (replacing leg 2's raw `isMcpAutomationEnabled(process.argv)`), so a **packaged** build never force-binds (only the human toggle does); an unpackaged `--automation-dev` run still force-binds.
- [x] **Live flip-OFF guard (DD2 companion):** `applyAutomationEnabledChange(false)` **skips the teardown when `devEnableOverride` is true** — the dev harness stays bound while the persisted toggle is independently off. In production (override false) flip-OFF tears down as in leg 2.
- [x] **Auth gate override:** `createMcpServer` accepts a `devEnableOverride` option (boolean or `() => boolean`; default falsy → normalize to `() => false`); `resolveIdentity` resolves identity when `settings.get('automationEnabled') === true` **OR** the override is active — then **still requires a valid Bearer key**. `main.js` passes the override into `createMcpServer` (in `startMcpServerInstance`). Unit tests cover: (a) override off + `automationEnabled` false + valid key → null (401); (b) override **on** + `automationEnabled` false + **valid** key → identity resolves; (c) **security-relevant negative — override on + `automationEnabled` false + missing/invalid key → still null (the override does NOT waive the key requirement)**; (d) the existing line-414 "401 when automationEnabled false" test stays green with the default-off override.
- [x] **Auto-mint auth fix:** the dev auto-mint block now mints via `mintJarKey` (key hash only) and relies on the override for enable; its stdout comment is corrected (no "flips automationEnabled=true"). The block's gate is `devEnableOverride` (inherits `!app.isPackaged`).
- [x] **Call-site `!app.isPackaged` gating (DD4) — predicates stay pure:** the three main-process call sites are ANDed with `!app.isPackaged`: (1) additionalArguments (`main.js:241`), (2) dev-seam registration (`main.js:939`), (3) the bind/auto-mint dev branch (via `devEnableOverride`). `automation-dev.js` is **not** modified to import electron — gating lives at the call sites. A packaged build: additionalArguments absent, dev-seam not registered, no force-bind/auto-mint.

### DD9 — toggle gates key generation, not revocation
- [x] The key-management IIFE reads the **persisted** `automationEnabled` (via `settingsGet('automationEnabled')` on init) and subscribes to `onSettingsChanged` to track live changes (remove the handle on `pagehide`, matching the existing IIFE pattern).
- [x] In `renderJars`, every jar's mint button (`Generate key` / `Rotate key`) is `disabled` ⇔ persisted `automationEnabled` is **off**; the **Revoke** button stays `disabled = !jar.hasKey` (unchanged, toggle-independent).
- [x] In `renderAdmin`, the admin mint button (`Generate/Rotate admin key`) is `disabled` ⇔ persisted `automationEnabled` is **off**; the admin **Revoke** stays `disabled = !adminKeySet`.
- [x] The mint buttons **enable/disable live** when the toggle flips (the `onSettingsChanged` callback updates the tracked value and re-renders — `refresh()` rebuilds jars+admin reading the tracked flag, or an equivalent re-evaluation of the `disabled` states). Gate strictly on the **persisted** value, never `status.enabled`.
- [x] **Spec drift fix — THREE active specs reference the retired side-effect / renamed function (review HIGH), not just one:**
  - `tests/behavior/settings-automation.md` Step 8 — drop the "persisted `automationEnabled` is now `true` (a side effect of `enableAndMintJarKey`)" assertion; assert minting does **NOT** enable + the DD9 gating.
  - `tests/behavior/mcp-jar-scoping.md` (lines ~23-24) — rename `enableAndMintJarKey`→`mintJarKey` and correct the "flips `automationEnabled = true`" apparatus prose: the auto-mint now mints the key **hash only**; the surface is enabled in dev by the **dev-enable override** (DD3/DD4), not by the mint.
  - `tests/behavior/mcp-auth-gating.md` (lines ~16, 21-22, and Run A Steps 1-2 at ~52-53) — rename the function refs + correct the "flips `automationEnabled = true`" prose, AND add a **Run-A semantic caveat**: under the dev-enable override a `dev:automation` launch is auth-enabled even with the persisted toggle off, so Run A's keyless/fabricated-Bearer 401s now observe **"no valid key"**, not **"surface disabled"**. The "Scope honesty" note (the off-state-is-gone-after-mint premise) is no longer literally true in dev. **True off-by-default (a real key still 401s while the surface is disabled) is only observable on a packaged build with the toggle off — verified at leg 7 / HAT**, not in dev. Update the prose to say so; do NOT silently leave the false premise.
  - `automation-key-gating.md` (already authored, draft) is the dedicated DD9 acceptance — referenced here, **run at leg 7/8** (live dev apparatus), not in this leg.
  - **This touches a landed SC8-backing spec (`mcp-auth-gating.md`).** Flag the semantic caveat prominently in the flight-log so the operator sees that F8's override redefined "off-by-default" observability (dev = no-key; packaged-toggle-off = true off) — this is a drift-from-observed-behavior update ARTIFACTS.md sanctions, consistent with the agreed packaged-build verification strategy, not a re-scoping.
- [x] **DD9 lands on code-inspection + the behavior spec** (the button-disabled gating is rendered cross-IIFE DOM behavior — not unit-testable without a DOM harness; `automation-key-gating.md` verifies it live). Note this in the flight-log.

### Gates
- [x] `npm test`, `npm run typecheck`, `npm run lint` all pass (including the inverted assertion + the new auth-override case).

## Verification Steps
- `npm test` — the inverted mint-no-longer-enables assertion passes; the new `devEnableOverride` auth case passes; existing auth/scope/server suites green.
- `npm run typecheck`, `npm run lint` — clean.
- `grep -rn "settings.set('automationEnabled'" src/` — exactly one writer (the toggle IPC path); paste the result into the flight-log.
- **Code inspection:** `mintJarKey` has no enable write; the override threads through bind + flip-OFF + auth; the three dev call sites are `!app.isPackaged`-gated; the mint buttons gate on the persisted toggle.
- **DD9 live (deferred to leg 7/8):** `/behavior-test automation-key-gating` — with the persisted toggle OFF the mint buttons are `disabled`, flip ON enables them live, flip OFF disables again, Revoke works while OFF. *Not run in this leg.*

## Implementation Guidance

1. **Rename + de-side-effect (`mcp-server.js`):** rename `enableAndMintJarKey` → `mintJarKey`, delete the `settings.set('automationEnabled', true)` line, update the jsdoc (drop "Enable the automation surface and"). Update the `module.exports`. Then update `main.js:17` import, the auto-mint call, and the `automation:jar-key-mint` IPC call + its comment. Update `test/unit/automation-mcp-server.test.js` import + all call sites; **invert** the line-990 assertion.

2. **Dev-enable override (`main.js`):** compute `const devEnableOverride = !app.isPackaged && isMcpAutomationEnabled(process.argv);` once (near the launch block, after `app.whenReady` so `app.isPackaged` is settled — it is available pre-ready too, but keep it with the other launch logic). Thread it:
   - Launch bind: `shouldBindAutomation({ automationEnabled: settings.get('automationEnabled') === true, devForceBind: devEnableOverride })`.
   - `applyAutomationEnabledChange`: in the `else` (OFF) branch, `if (devEnableOverride) return;` **before** teardown (keep the surface bound in dev). **Add a load-bearing comment on the ordering:** the persisted write already happened in the caller (`internal-settings-set` does `settings.set` *then* `applyAutomationEnabledChange`), so the persisted value goes `false` while the surface stays bound — this is exactly the DD9-testable state (`automation-key-gating.md` needs persisted-off + surface-live). Production (override false) tears down.
   - Auto-mint block: gate on `devEnableOverride` (replaces leg 2's `devForceBind`).

3. **Auth-gate override (`mcp-server.js` + `main.js`):** add `devEnableOverride` to `createMcpServer(opts)` (accept boolean or function; normalize to a `() => boolean` reader, default `() => false`). In `resolveIdentity`: `if (settings.get('automationEnabled') !== true && !devEnableOverride()) return null;`. In `startMcpServerInstance` (`main.js`), pass `devEnableOverride: () => devEnableOverride` (or the boolean) into `createMcpServer`. Add the auth-override unit cases.

4. **Call-site gating (`main.js`):** `main.js:241` → `...(isAutomationDevEnabled(process.argv) && !app.isPackaged ? { additionalArguments: ['--automation-dev'] } : {})`; `main.js:939` → `if (isAutomationDevEnabled(process.argv) && !app.isPackaged) {`. Do **not** touch `automation-dev.js`.

5. **DD9 mint-button gating (`settings.js` key IIFE):** add `let automationEnabled = false;` in the IIFE. **Avoid the init double-fetch + first-paint flicker (review medium):** fold the persisted read into the init so the FIRST render has the flag and no second `automationListKeys` fires — e.g. `Promise.all([automationKeysOnce(), bridge.settingsGet('automationEnabled')]).then(([info, en]) => { automationEnabled = !!en; if (info) { renderJars(info.jars); renderAdmin(info.adminEnabled, info.adminKeySet); } })` (replacing the current `automationKeysOnce().then(...)` init at the bottom of the IIFE). Note `refresh()` calls `automationListKeys()` directly (bypasses the `automationKeysOnce` memo) — so do NOT call `refresh()` purely to pick up the flag on init. In `renderJars` set `mintBtn.disabled = !automationEnabled;` (leave `revokeBtn.disabled = !jar.hasKey;`); in `renderAdmin` set `adminMintBtn.disabled = !automationEnabled;` (leave `adminRevokeBtn.disabled = !adminKeySet;`). Subscribe for live updates: `const hKeys = bridge.onSettingsChanged((all) => { if (all && all.automationEnabled != null) { automationEnabled = !!all.automationEnabled; refresh(); } });` and remove it on `pagehide` (matching the enable IIFE's handle-cleanup pattern). Gate strictly on the **persisted** value, never `status.enabled`.

6. **Spec Step 8 (`settings-automation.md`):** rewrite the Step 8 Expected-Results clause that asserts the auto-enable side-effect → assert minting does NOT change `automationEnabled` (read it back from the store: stays its prior value) and that the DD9 gating holds (mint button enabled only because the toggle was already on in that test's setup — adjust the step's precondition if needed so it remains internally consistent).

## Edge Cases
- **Packaged build + `--automation-dev` flag** → `devEnableOverride` is false (`!app.isPackaged` fails), so no force-bind, no dev-seam, no additionalArguments, no auto-mint, no auth override — the flag is a complete no-op. (Verified live at leg 7.)
- **Dev flip-OFF** → override true → `applyAutomationEnabledChange` keeps the surface bound; the persisted value is written false (so the UI mirrors production "off"), but the surface stays drivable — exactly what `automation-key-gating.md` needs.
- **Mint while toggle OFF (production)** → the mint button is `disabled`, so the human can't click it; even if reached programmatically, `mintJarKey` no longer enables, so it would create an inert credential — the gating is UX, the de-side-effect is the security property.
- **Revoke while OFF** → always allowed (no auto-revoke); `revokeJarKey` already 401s the next request via live re-validation. Unchanged.
- **`automationKeyHashes` write still broadcasts `settings-changed`** → correct (it is a setting); the enable toggle's `onSettingsChanged` listener will see no `automationEnabled` change, so the checkbox does not flip — which is the whole point.

## Files Affected
- `src/main/automation/mcp-server.js` — rename + de-side-effect `mintJarKey`; `devEnableOverride` option + `resolveIdentity` change.
- `src/main/main.js` — import rename; `devEnableOverride` compute + thread (bind, flip-OFF guard, auth, auto-mint); `!app.isPackaged` at the 3 call sites; jar-key-mint comment.
- `src/renderer/pages/settings.js` — DD9 mint-button gating + `onSettingsChanged` subscription in the key IIFE.
- `test/unit/automation-mcp-server.test.js` — rename all 11 refs; invert/reframe the enable assertions + test names; add `devEnableOverride` auth cases incl. the negative key-still-required case (or add to `automation-auth.test.js`).
- `tests/behavior/settings-automation.md` — Step 8 spec-drift fix.
- `tests/behavior/mcp-jar-scoping.md` — rename function refs + correct the "flips automationEnabled=true" apparatus prose.
- `tests/behavior/mcp-auth-gating.md` — rename function refs + correct apparatus prose + the Run-A off-by-default semantic caveat (dev override).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` + typecheck + lint)
- [x] Update flight-log.md with leg progress entry (paste the `automationEnabled` grep; note DD9 live verification → leg 7/8)
- [x] Set this leg's status to `landed` (per FD instruction — not `completed`; flight-end batch close)
- [ ] Check off this leg in flight.md (DEFERRED to FD / flight-end review per orchestrator instruction)
- [x] If final leg of flight: (N/A — leg 3 of 8)
- [x] Commit deferred to flight-end batch review (do NOT commit per-leg)

## Citation Audit
Citations verified against current code at leg design time (2026-06-17):
- `src/main/automation/mcp-server.js` `enableAndMintJarKey` (`settings.set('automationEnabled', true)` present) / `mintAdminKey` (no enable write — confirmed) / `resolveIdentity` (`if (settings.get('automationEnabled') !== true) return null;`) / `createMcpServer(opts)` option-bag — **OK** (read directly).
- `src/main/main.js:17` import of `enableAndMintJarKey`/`mintAdminKey`; `main.js:241` additionalArguments `isAutomationDevEnabled(process.argv)`; `main.js:939` `if (isAutomationDevEnabled(process.argv))` dev-seam; auto-mint `enableAndMintJarKey('default', settings, jars)`; `automation:jar-key-mint` IPC + comment — **OK** (grep + read; DD4's cited `:213`/`:895`/`:916` drifted to `:241`/`:939`/leg-2 bind block — corrected here).
- `src/renderer/pages/settings.js` key IIFE (`renderJars` `mintBtn`/`revokeBtn`, `renderAdmin` `adminMintBtn`/`adminRevokeBtn`, `refresh`, `automationKeysOnce`) — **OK**.
- `test/unit/automation-mcp-server.test.js:990` `assert.equal(settings.get('automationEnabled'), true)` (pins old side-effect — to invert); `:414` 401-when-disabled test — **OK**.
- `tests/behavior/settings-automation.md` Step 8 ("a side effect of `enableAndMintJarKey`") — **OK** (to update). `tests/behavior/automation-key-gating.md` draft exists — **OK**.
