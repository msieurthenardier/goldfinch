# Squawk 0166: Client-cert fixture leaves its private key and the Throwaway CA in the operator's NSS database

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-26
**Completed**: 2026-10-26

## Report
The operator's real user NSS database (`~/.pki/nssdb`) still holds residue from the `web-compat-client-cert` fixture:
- `Goldfinch Fixture Client` (`u,u,u`) with its RSA private key. Chromium offers it in the certificate chooser to any site that requests a client certificate.
- `Goldfinch Fixture Throwaway CA` (no trust bits, expired 2026-08-04).

It was found during the 2026-10-26 trust-store audit (eMudhra, #273). There are two causes:
1. **`import-client-cert.mjs --remove` is incomplete.** `--import` runs `pk12util -i certs/client.p12`. `gen-certs.mjs` builds that PKCS#12 with `-certfile ca.pem`, so the import adds three things: the client cert, its private key, and the Throwaway CA. `--remove` runs only `certutil -D -n "Goldfinch Fixture Client"`, which deletes the cert entry. It leaves the private key and the CA.
2. **`tests/behavior/web-compat-client-cert.md` has no teardown step.** The import is a precondition, described as "reversible via `--remove`", but no step runs `--remove`, so a completed run leaves everything in place.

The residue also contradicts `tests/behavior/tls-trust-surface.md`, whose precondition says "The untrusted CA is NEVER imported".

**Fix:**
- Make `--remove` delete the cert together with its key, and delete the bundled CA.
- Make `--remove` idempotent when an entry is absent, mirroring `import-trust-anchor.mjs`'s precheck.
- Add an explicit teardown step to the spec.
- Run the fixed `--remove` once on the operator's database to clear the current residue. The operator authorized this on 2026-10-26.

## Evidence
- `certutil -L -d sql:$HOME/.pki/nssdb`: `Goldfinch Fixture Client u,u,u` and `Goldfinch Fixture Throwaway CA ,,`.
- `certutil -K -d sql:$HOME/.pki/nssdb`: `< 0> rsa 62096e0abad8… Goldfinch Fixture Client`.
- `tests/behavior/fixtures/web-compat/gen-certs.mjs`: `openssl pkcs12 -export … -certfile ca.pem -name 'Goldfinch Fixture Client'`.
- `tests/behavior/fixtures/web-compat/import-client-cert.mjs` `--remove`: `spawnSync('certutil', ['-D', '-d', NSS_DB, '-n', NICKNAME])`, deleting one nickname only.
- `tests/behavior/web-compat-client-cert.md` Preconditions: the `--import` line, with no matching teardown row.

## Corrective Action
- `import-client-cert.mjs --remove` now deletes the client cert together with its key (`certutil -F -n`), any orphaned key still listed under the fixture nickname (`certutil -K` parse, `certutil -F -k <id>`; an older cert-only remove leaves the key listed under the same nickname), and the Throwaway CA (`CA_NICKNAME`, from gen-certs.mjs `CA_SUBJECT`; `-D`). Each nickname is prechecked with `certutil -L -n`; absence is success (exit 0), any other certutil failure exits 1. No other NSS entry is addressed. Header comment, `--import` message and usage updated.
- README NSS-import section documents the three imported items and the full `--remove`.
- `web-compat-client-cert.md` gains step 5 (teardown + `-L`/`-K` assertions); precondition references it.

## Verification
- Scratch NSS db (`HOME=<scratch>`, deleted afterwards): legacy orphan state (old `certutil -D` of the cert) -> new `--remove` cleaned orphan key `fc9e656db2f6` and the CA; `--import` -> `-L` showed client `u,u,u` + CA, `-K` showed 1 key; `--remove` -> both lists empty; second `--remove` exit 0 ("nothing to remove").
- Real db (`~/.pki/nssdb`), before: `-L` = `Goldfinch Fixture Client u,u,u`, `Goldfinch Fixture Throwaway CA ,,`; `-K` = `< 0> rsa 62096e0abad8 Goldfinch Fixture Client`. These were the ONLY entries. After `--remove`: `-L` empty, `-K` "no keys found". Second run exit 0, nothing to remove. No other entries existed to change.
- `npm run lint`, `npm run format:check`: both pass.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking issues.
- Key deletion matches the fixture nickname by exact equality. A scratch-db key named `Goldfinch Fixture Client Extra` and an `Unrelated Test Cert` cert and key both survived `--remove`.
- `--remove` is idempotent ("nothing to remove", exit 0), uses `spawnSync` argv arrays only, and changes nothing in `src/`.
- `CA_NICKNAME` matches `gen-certs.mjs` `CA_SUBJECT`.
- A read-only check of the real db shows no certificates and no keys.
- Lint and format:check pass.

**Commit**: the `squawk/0166` commit on `squawk/0166-client-cert-fixture-nss-residue`
