# Behavior Test: Vault fill-only MCP surface

**Slug**: `vault-mcp-surface`
**Status**: draft
**Created**: 2026-07-20
**Last Run**: never

## Intent

Verify the password manager's **fill-only MCP automation surface** end-to-end against the
live browser, covering the properties that only a real-environment run can assert: that a
scoped access key unlocks a vault over the wire, that `vaultList` returns metadata with no
secret material, that `vaultFill` populates a real login form **without the password ever
crossing the MCP channel**, that `vaultTotp` returns only the current rotating code, that a
per-jar access key is *cryptographically* unable to reach the global vault (verified as an
**absent envelope in the vault file**, not merely an "unlock refused" from the wire), and
that a torn-down MCP session's unlock state does not persist. Unit tests carry the crypto
correctness; this test carries the wire policy, the live-page fill, and the file-level
scope property — none of which a unit test can observe.

## Preconditions

- Goldfinch is running with the automation surface enabled (`npm run dev:automation`),
  loopback MCP on port 49707.
- The operator has exported, for the run: an **admin** transport key (`GOLDFINCH_MCP_ADMIN_KEY`)
  and a **per-jar** transport key (`GOLDFINCH_MCP_KEY`) for a designated test jar, per the
  ATTACH model the a11y harness uses.
- A **fixture vault set** exists on disk under `userData/vaults/`: a global vault and the
  test jar's vault, each set up (master password known to the fixture), each seeded with at
  least one Login item for the fixture origin (one carrying a TOTP secret). These are built
  by the **headless vault-fixture builder** — a node script driving the `vault-store` API,
  since no UI exists yet (DD9). A **per-jar vault access key** for the test jar and one for
  a *second* jar are minted by that builder and their plaintext captured for the run.
- For the audit assertion (step 9) and the admin variant: `GOLDFINCH_AUTOMATION_ADMIN` is
  set and an **admin transport key** is minted (`mintAdminKey` returns null otherwise),
  plus the admin vault access key.
- A **login-form fixture page** is reachable at a stable local origin: a page with a
  username input and a `type=password` input, at the origin the seeded Login item matches.
- The operator can read files under `userData/vaults/` (filesystem apparatus).

## Observables Required

- **http/mcp** (tool-call results — measured via the goldfinch MCP surface: `vaultUnlock`,
  `vaultList`, `vaultFill`, `vaultTotp`, plus `openTab`/`navigate` and `readDom`)
- **browser** (filled field values, page DOM — measured via `readDom` / `evaluate` over MCP;
  a per-jar key reads/evaluates its **own** tab — no admin key needed for the fill check)
- **filesystem** (the `.gfvault` file's envelope set + per-envelope plaintext key-ids —
  measured via `Read` / `Bash`)
- **audit** (the automation-activity indicator — measured from an **admin** session via
  `getChromeTarget` + `readDom`/`evaluate`; the audit log is in-memory with no MCP read tool)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open an MCP session with the **per-jar** transport key for the test jar. Call `vaultUnlock` presenting that jar's **vault access key**. | The session authenticates; `vaultUnlock` returns success. No secret (vault key, master password) appears in the result. |
| 2 | Call `vaultList` in the unlocked session. | Returns the (now unlocked) **test-jar** vault items as **metadata only** — origin, username, has-TOTP flag, vault badge. No password, no TOTP secret, no card data. A per-jar access key reaches **only its own jar's vault** — global-vault items are NOT listed (global via automation needs the admin key; see the admin variant). `vaultList` lists only unlocked vaults. |
| 3 | Over MCP, open a tab in the test jar and navigate it to the login-form fixture origin. Wait for the username + `type=password` fields to render. | The fixture page loads in the test jar; both fields are present. |
| 4 | Call `vaultFill` for the fixture origin's Login item, targeting that tab. | `vaultFill` returns success. **The tool result contains no password string.** |
| 5 | Read the filled form via `readDom`/`evaluate` on that tab. | The username field holds the item's username and the password field's value is populated (non-empty); input events fired (field reflects a real value, not a placeholder). The form was **not** submitted — the page did not navigate. |
| 6 | Call `vaultTotp` for the TOTP-carrying Login item. | Returns a 6-digit (or item-configured length) numeric code as text, and **nothing else** — no stored secret. |
| 7 | From a **second** MCP session using the **second jar's** transport key, call `vaultUnlock` presenting the **second jar's** vault access key, then attempt to `vaultList`/`vaultTotp` the **global** and the **test-jar** vaults' items. | The second jar's key unlocks only its own vault; it **cannot** read the global vault or the test jar's vault (not present in its list). |
| 8 | (Filesystem) Read the **global** `.gfvault` file and enumerate its envelope set by the per-envelope plaintext key-ids; also read `manager.json`. | Under the MRK model the global `.gfvault` carries an `mrk` envelope (+ only access envelopes explicitly minted on global) and **no envelope whose key-id is the second jar's (or test jar's) per-jar access key**; `manager.json` holds the `master`/`recovery`/`admin` envelopes over the MRK. The scope property is *absent envelope*, verified by key-id, not a runtime refusal. |
| 9 | From an **admin** MCP session, read the automation-activity indicator via `getChromeTarget` + `readDom`/`evaluate` and confirm the unlock, fill, and TOTP operations from steps 1–6 are reflected (with origin + jar). | The activity record shows the unlock, fill, and TOTP-issuance events for the correct jar/origin; no entry carries secret material (password, TOTP secret, or vault key). |
| 10 | Tear down the first MCP session (close the transport). Open a fresh session with the same per-jar transport key and, **without** calling `vaultUnlock`, call `vaultList`. | The vault is locked again: `vaultList` returns nothing (or refuses) until a fresh `vaultUnlock`. The prior session's unlock state did not survive teardown. |

**Row conventions**: one row = one checkpoint. Steps 5 and 8 carry the load-bearing
assertions (live-page fill with no wire leak; file-level absent-envelope scope).

## Out of Scope

- Crypto correctness of the KDF / AES-GCM / envelope math and TOTP-vs-reference — covered
  by Leg 1 unit tests, not here.
- The human fill path (lock icon, chrome-owned unlock prompt, picker) — Flight 2.
- The `goldfinch://vault` management UI, enrollment, export/import, rotation — Flight 3.
- Memory-level zeroization as a direct assertion — not observable; step 10 asserts the
  behavioral proxy (a torn-down session must re-unlock).

## Variants (optional)

- **Admin access key** (requires `GOLDFINCH_AUTOMATION_ADMIN` set + a minted admin
  transport key): repeat steps 1–2 with the admin vault access key and confirm it unlocks
  *every* vault including a jar vault created *after* the admin key was minted.
- **Registrable-domain opt-in** (once F2 hardens matching): a credential marked
  registrable-domain-scoped fills on a subdomain of its origin but not on an unrelated
  ccTLD sibling.
