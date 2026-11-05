# vault-login fixture

Fixtures for the `vault-mcp-surface` behavior test (Mission 12, Flight 1, Leg 4) —
the fill-only MCP vault surface end-to-end.

## Contents

- **`build-fixtures.mjs`** — headless fixture builder that **fully provisions a
  fresh userData profile** so `npm run dev:automation` launched against it is
  immediately drivable by the test with **no UI / manual minting**. It:
  1. Registers two real jars (**Jar A** / **Jar B**) in the jar registry (`app.db`).
  2. Stages a vault manager + global vault + one vault per jar, each seeded with a
     Login item for the fixture origin (Jar A's login carries a TOTP secret), and
     mints a per-jar vault **access key** for each jar.
  3. Provisions the automation **transport keys** (a per-jar key + an admin key)
     as `settings-store` hashes and flips `automationEnabled` on — so the running
     app's MCP auth gate accepts the pre-known bearer tokens directly.
- **`index.html`** — the static login page (username + `type=password` fields)
  the test navigates to and asserts `vaultFill` populates. Its submit is
  `preventDefault()`ed (the fill must never navigate) — **unchanged**; `vault-mcp-surface`
  relies on it.
- **`capture.html` + `landed.html`** — **capture mode** (Sortie 06, Leg 1), for the
  `save-prompt-non-blocking` behavior test; see [Capture mode](#capture-mode) below.

## Build the vault fixtures

```
node tests/behavior/fixtures/vault-login/build-fixtures.mjs <userDataDir>
```

`<userDataDir>` is Goldfinch's userData directory — the jar registry + settings
persist to `<userDataDir>/app.db` and the vault files under
`<userDataDir>/vaults/`. Use a **fresh/empty** dir (the builder mints a new
manager; it refuses an already-set-up dir). It prints a JSON blob to stdout:

```json
{
  "jarIds":            { "a": "jar-a", "b": "jar-b" },
  "jarTransportKeys":  { "a": "...", "b": "..." },
  "adminTransportKey": "...",
  "jarAccessSecrets":  { "a": "...", "b": "..." },
  "jarAccessKeyIds":   { "a": "...", "b": "..." },
  "adminVaultPrivateKeyB64": "...",
  "recoveryKeyDisplay": "...",
  "fixtureOrigin": "http://127.0.0.1:8099",
  "masterPassword": "..."
}
```

Capture these for the run — the transport keys, vault access secrets, admin
vault private key, recovery key, and master password are returned **exactly
once**; the transport keys and vault access secrets live on disk only as
hashes / wrapped envelopes, never in plaintext. Wiring for the run:

- **`jarTransportKeys.a`** → `GOLDFINCH_MCP_KEY` (the per-jar bearer token for the
  test-jar MCP session); **`adminTransportKey`** → `GOLDFINCH_MCP_ADMIN_KEY`.
- **`jarAccessSecrets.a` / `.b`** are the per-jar vault access secrets presented to
  `vaultUnlock`; **`jarAccessKeyIds`** are the per-envelope key-ids the filesystem
  step (step 8) enumerates; **`adminVaultPrivateKeyB64`** is the admin vault-unlock
  key for the admin variant.
- The admin variant also needs `GOLDFINCH_AUTOMATION_ADMIN` set in the app's env.

## Serve the login page

From **this directory**, on port **8099** (must match the seeded logins'
`fixtureOrigin`), on a plain HTTP port distinct from the MCP loopback (49707):

```
python3 -m http.server 8099
```

Reachable at `http://127.0.0.1:8099/`. Serve on a different host/port only if you
rebuild the fixtures with a matching `FIXTURE_ORIGIN` in `build-fixtures.mjs`.

## Capture mode

`index.html` can never produce a save offer: its submit is suppressed and nothing navigates or
detaches, so no held capture is ever released. **Capture mode** is the same fixture origin with a
login form whose submit **really navigates**:

- **`capture.html`** — `#username` (`autocomplete="username"`), `#password`
  (`type="password"`, `autocomplete="current-password"`) and `#submit`. The `<form>` is a plain
  GET to `landed.html` and its submit is **not** `preventDefault()`ed. The inputs carry **no
  `name` attribute**, so the browser submits neither value: the landing URL is a bare
  `landed.html?` and no credential reaches the address bar or the static server's log.
- **`landed.html`** — the page the form lands on: `<input id="probe">`, `<button id="bump">` and a
  visible `#count` (starts at `0`, +1 per `#bump` click). It proves the page stays fully usable
  (click / type) while the corner save prompt shows over it. Nothing is persisted, so a fresh tab
  always starts at `0`.

The flow the behavior test drives: open `http://127.0.0.1:8099/capture.html` in a persistent-jar
tab → `typeText` into `#username` and `#password` → a **trusted `click`** on `#submit` → the page
navigates to `landed.html` and `did-navigate` **releases** the held capture as an offer.

**Use a username AND password unique to each run** for every submit step. The builder seeds a
Login for the fixture origin in each jar's vault, so a repeated or default credential could match
it and turn the offer into an `update` (or no offer at all, if identical). A unique pair makes the
disposition `save` regardless of the seeded items. (The old "profile has no login for the origin"
precondition is therefore not needed.)

Serve it exactly like `index.html` (`python3 -m http.server 8099` from this directory).
