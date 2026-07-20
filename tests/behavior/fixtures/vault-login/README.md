# vault-login fixture

Fixtures for the `vault-mcp-surface` behavior test (Mission 12, Flight 1, Leg 4) —
the fill-only MCP vault surface end-to-end.

## Contents

- **`build-fixtures.mjs`** — headless vault-fixture builder. Drives the
  Electron-free `vault-store` API to stage a manager + global vault + two jar
  vaults (`jar-a`, `jar-b`), each seeded with a Login item for the fixture origin
  (jar-a's login carries a TOTP secret), and mints a per-jar access key for each
  jar.
- **`index.html`** — the static login page (username + `type=password` fields)
  the test navigates to and asserts `vaultFill` populates.

## Build the vault fixtures

```
node tests/behavior/fixtures/vault-login/build-fixtures.mjs <userDataDir>
```

`<userDataDir>` is Goldfinch's userData directory — the store writes under
`<userDataDir>/vaults/`. Use a **fresh/empty** dir (the builder mints a new
manager; it refuses an already-set-up dir). It prints a JSON blob to stdout:

```json
{
  "jarKeyIds":        { "jar-a": "...", "jar-b": "..." },
  "jarAccessSecrets": { "jar-a": "...", "jar-b": "..." },
  "adminPrivateKeyB64": "...",
  "recoveryKeyDisplay": "...",
  "fixtureOrigin": "http://127.0.0.1:8099"
}
```

Capture these for the run — the access secrets, admin private key, and recovery
key are returned **exactly once** and are never persisted in plaintext. `jarKeyIds`
are the per-envelope key-ids the filesystem step (step 8) enumerates.

## Serve the login page

From **this directory**, on port **8099** (must match the seeded logins'
`fixtureOrigin`), on a plain HTTP port distinct from the MCP loopback (49707):

```
python3 -m http.server 8099
```

Reachable at `http://127.0.0.1:8099/`. Serve on a different host/port only if you
rebuild the fixtures with a matching `FIXTURE_ORIGIN` in `build-fixtures.mjs`.
