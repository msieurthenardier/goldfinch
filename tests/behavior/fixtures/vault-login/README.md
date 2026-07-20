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
  the test navigates to and asserts `vaultFill` populates.

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
