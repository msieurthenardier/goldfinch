# Leg: vault-fill

**Status**: completed
**Flight**: [Vault Core + Automation Surface](../flight.md)

## Objective

Wire the real main→preload credential-injection channel (so `vaultFill` fills a live
top-frame login form without the password crossing the MCP wire), stage the headless
vault-fixture builder + login-form fixture page, and run the `vault-mcp-surface` behavior
test — closing checkpoint c and the flight's end-to-end verification.

## Context

- **Leg 4 of 4.** Depends on Legs 1–3 (landed). Leg 3 left an injected **fill delegate
  stub** (`vault-fill-not-wired`) in `main.js` and the `vault-context.fill` path that
  resolves the credential + enforces jar-membership/origin-match, then calls the delegate.
  This leg makes the delegate real and proves the whole surface live.
- **Seams (verified):**
  - `src/preload/webview-preload.js` runs in the guest **main world** (`contextIsolation:false`),
    uses `ipcRenderer.on('rescan-media', …)` for main→preload and `ipcRenderer.send(…)` for
    preload→main. The vault-fill channel mirrors `rescan-media`.
  - Guests run **`nodeIntegration:false`** (`register-tab-ipc.js` web prefs) — page JS cannot
    obtain `ipcRenderer`, so it can't register a rogue `vault-fill` listener. This is the
    load-bearing DD7 security premise; assert it stays true.
  - `main.js` injects the stub fill delegate + the stateless vault-store read path into
    `createMcpServer` (Leg 3). This leg swaps the stub for the real delegate.
  - `webContents.send(channel, payload)` delivers to the **main frame's** preload (top-frame
    only) — the natural top-frame gate; the preload additionally guards `window.top === window`.

## Inputs

- Legs 1–3 landed (`vault-crypto`, `vault-store`, `vault-context` + the MCP wire + the stub delegate).
- `src/preload/webview-preload.js`, `src/main/main.js` (+ wherever the stub delegate is injected).

## Outputs

- **Modified** `src/preload/webview-preload.js` — a `vault-fill` `ipcRenderer.on` handler that
  fills the top-frame login form (username + `type=password`) and dispatches `input`/`change`
  events; the field-selection logic factored into a testable pure helper.
- **Modified** `src/main/main.js` (or the delegate injection site) — the **real** fill delegate:
  `({ wcId, credential }) => webContents.fromId(wcId)?.send('vault-fill', credential)`. No
  password is returned to the caller.
- **New** `test/unit/vault-fill-fields.test.js` — unit test for the field-selection/fill helper
  against a minimal fake `document` (zero-dep; no jsdom).
- **New** `tests/behavior/fixtures/vault-login/build-fixtures.mjs` — headless builder driving the
  `vault-store` API (see guidance; injects `listJars`): `setup` a manager, create global + two jar
  vaults, seed Login items (fixture origin; one with a TOTP secret), mint per-jar access keys, and
  **emit the keyIds + access secrets + admin private key + recovery key** for the run. (Placed under
  `tests/behavior/fixtures/` per the project's behavior-fixture convention, not `test/unit/**`.)
- **New** `tests/behavior/fixtures/vault-login/index.html` — a static login page (a form with a
  username input and a `type=password` input) served at a stable local origin for the behavior test.
- **Behavior-test run log** at `tests/behavior/vault-mcp-surface/runs/{ts}.md` (produced by
  `/behavior-test vault-mcp-surface`).

## Acceptance Criteria

- [ ] **Real fill delegate**: `vaultFill` over MCP causes the target tab's top-frame login form to be populated (username + password set, `input`/`change` dispatched); the **password never appears** in the `vaultFill` tool result nor anywhere on the MCP wire (the credential travels main→preload only).
- [ ] **Top-frame only**: the preload fills only when `window.top === window`; a cross-origin iframe is never filled (the delegate sends via `webContents.send`, which targets the main frame; the preload guards top-frame).
- [ ] **Field-selection helper** unit-tested: given a fake document with a username + `type=password` field it locates and fills both and dispatches events; given no password field it fills nothing; verified in `vault-fill-fields.test.js`.
- [ ] **nodeIntegration-off invariant asserted**: `test/unit/register-tab-ipc.test.js` gains an explicit `assert.equal(webView.opts.webPreferences.nodeIntegration, false)` (and `sandbox === false`) on the **web** branch — the current test pins these only on the internal branch, and this is the load-bearing DD7 premise (page JS cannot acquire `ipcRenderer` to spoof `vault-fill`). Committing to the assertion, not the disjunction.
- [ ] **Fixture builder** produces, headlessly, a manager + global + two jar vaults with seeded logins (one TOTP-bearing) and minted per-jar access keys, emitting their keyIds/secrets + admin private key + recovery key — runnable via `node test/helpers/vault-fixture-builder.mjs <userDataDir>`.
- [ ] **Login fixture page** loads at a stable origin with the username + `type=password` fields the behavior test drives.
- [ ] **`vault-mcp-surface` behavior test passes** (`/behavior-test vault-mcp-surface`): the 10-step table green — unlock via access key, metadata-only list, live-page fill with no wire leak (step 5), TOTP code-only, strict per-jar scope + file-level absent-envelope (step 8), audit reflects ops, session-teardown re-lock. The run log is committed; evidence stays in the ephemeral path. **If the live GUI/automation environment cannot be stood up in this session, the leg records the behavior test as a staged prerequisite (fixtures + run command ready) with that disposition in the flight log, per the flight's behavior-test-execution prerequisite — and the operator runs it.**
- [ ] `timeout 150 node --test test/unit/vault-fill-fields.test.js` passes; full `npm test` green; typecheck + lint clean.

## Verification Steps

- `timeout 240 npm test` — full suite green (the new field-selection test + no regressions).
- `npm run typecheck` && `npm run lint` — clean.
- `node test/helpers/vault-fixture-builder.mjs /tmp/vault-fixture-check` — builds a fixture set and prints the secrets without error; inspect the written `userData/vaults/` (no plaintext secret in the files).
- `/behavior-test vault-mcp-surface` — run by the Flight Director (live env); confirm pass or record the staged-prerequisite disposition.
- `grep -n "password" ` the `vaultFill` result path — assert no password field on the wire.

## Implementation Guidance

1. **`webview-preload.js` fill handler** — add near the `rescan-media` listener:
   `ipcRenderer.on('vault-fill', (_e, cred) => fillLoginForm(document, cred));` Guard
   `if (window.top !== window) return;` at the top of `fillLoginForm`. Factor the field logic
   into `findLoginFields(doc)` + `fillLoginForm(doc, cred)` (pure over a `document`-like object)
   so it unit-tests without a browser. **Pin the DOM surface** (so the fake document models it
   exactly): `doc.querySelectorAll('input[type=password]')` → take the first; its form is
   `pw.form` (fallback `pw.closest('form')`); the username field is the last text/email/tel/
   no-type input **preceding** the password field within that form (or `form.querySelector`
   over those types before the pw in document order). Set `.value`; dispatch
   `new Event('input',{bubbles:true})` + `new Event('change',{bubbles:true})` (Node 22 provides
   global `Event`). Fill nothing if no password field. Follow the hand-rolled fake-DOM precedent
   in `test/unit/helpers/jars-page-dom.js` / `media-controller.test.js`.

2. **Real delegate in `main.js`** — replace the `vault-fill-not-wired` stub with
   `({ wcId, credential }) => { const wc = webContents.fromId(wcId); if (wc) wc.send('vault-fill', credential); }`.
   The credential object is `{ username, password }` (+ optional field hints). It never returns
   to the vault-context caller / MCP result.

3. **Field-selection test** (`vault-fill-fields.test.js`) — a minimal fake `document` (objects
   with `querySelectorAll`/`querySelector` returning fake inputs recording `.value` + dispatched
   events). Assert: fills both fields + dispatches; no-password-field → no fill; multiple forms →
   the password-bearing form is targeted.

4. **Fixture builder** (`tests/behavior/fixtures/vault-login/build-fixtures.mjs`) — use
   `createRequire(import.meta.url)` to require the CJS `vault-store` (the `scripts/dev-launch.mjs`
   interop precedent). **`load(userDataDir, { listJars: () => [{id:'jar-a'},{id:'jar-b'}], getAutoLockMinutes: () => 10 })`
   — injecting `listJars` with the two fixture jar ids is REQUIRED** (`_resolveTarget` throws
   `unknown or non-persistent jar` for any non-`global` target not in `listJars()`; the default is
   `() => []`, so jar writes hard-fail without it). `await setup({masterPassword})`, **retain that
   master password** (both `setup` and the step-up `mintAccessKey({masterPassword})` are async and
   the mint re-checks it), `await saveItem` for global + each jar (fixture origin; one login with an
   `otpauth://` TOTP secret), `await mintAccessKey(jarId, {masterPassword})` for each jar. Print a
   JSON blob `{ jarKeyIds, jarAccessSecrets, adminPrivateKeyB64, recoveryKeyDisplay, fixtureOrigin }`
   to stdout for the behavior-test operator.

5. **Login fixture page** (`test/fixtures/vault-login.html`) — a minimal `<form>` with
   `<input name=username>` + `<input type=password name=password>` + a submit button. Serve it at a
   stable origin (a tiny `http` static server helper, or document a `file://`/localhost path the
   behavior test navigates to). The origin must match the seeded login items' origin.

6. **Run the behavior test** — the Flight Director invokes `/behavior-test vault-mcp-surface`
   (NOT a Developer agent — the run skill owns its Executor+Validator crew). Preconditions: dev
   build on this branch with `--automation-dev`, the fixture set built (step 4), the fixture page
   served (step 5), transport keys + `GOLDFINCH_AUTOMATION_ADMIN` exported per the spec. If the
   live GUI can't be stood up here, stage everything and record the disposition (flight log +
   run-log placeholder) for the operator.

## Edge Cases

- **No login form on the page** → preload fills nothing; `vaultFill` still returns a normal "no
  fillable form" result, no password on the wire.
- **Password field inside a cross-origin iframe** → not filled (top-frame guard + `webContents.send`
  targets the main frame).
- **Multiple forms / multiple password fields** → target the first password-bearing form; document
  the heuristic (F2 hardens detection per the mission open question).
- **`webContents.fromId(wcId)` gone** (tab closed mid-fill) → delegate no-ops safely.
- **Behavior-test env unavailable** → staged-prerequisite disposition, not a silent skip.
- **Hostile page main world** — `findLoginFields`/`fillLoginForm` run in the guest main world
  (contextIsolation off), so a page could present fake fields. Exposure is confined by the
  **upstream exact-origin match** in `vault-context.fill` (Leg 3): a site is only ever handed *its
  own* credential, one at a time, and the password never returns over the wire. This is the same
  reasoning as DD7's decorative-icon framing — the trust boundary is the chrome-owned resolution,
  not the page DOM.

## Files Affected

- `src/preload/webview-preload.js` — **modified** (vault-fill handler + field helper).
- `src/main/main.js` — **modified** (real fill delegate).
- `test/unit/vault-fill-fields.test.js` — **new**.
- `test/unit/register-tab-ipc.test.js` — **modified** (assert web-guest `nodeIntegration:false`).
- `tests/behavior/fixtures/vault-login/build-fixtures.mjs` — **new**.
- `tests/behavior/fixtures/vault-login/index.html` — **new**.
- `tests/behavior/vault-mcp-surface/runs/{ts}.md` — **new** (behavior-test run log, or staged placeholder).
- `missions/12-password-manager/flights/01-vault-core-and-automation/flight-log.md` — leg progress entry.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified (behavior test passed OR staged-disposition recorded)
- [ ] Tests passing (new + full `npm test`), typecheck + lint clean
- [ ] Update flight-log.md with the leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Do NOT check off the leg in flight.md, do NOT commit (deferred flight-end commit)

---

## Citation Audit

Citations verified at leg design time: `webview-preload.js` main-world + `ipcRenderer.on('rescan-media')`
pattern (verified); `register-tab-ipc.js` web-guest `nodeIntegration:false` (verified);
`window-factory.js:67-92` `nodeIntegration:false` for chrome views (verified); the Leg 3 stub
delegate + `createMcpServer` injection (from the landed Leg 3). No `file:line` bare citations requiring repair.
