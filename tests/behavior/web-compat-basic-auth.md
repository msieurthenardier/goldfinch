# Behavior Test: HTTP Basic Auth — Sheet Prompt and Vault-Mediated Agent Answer

**Slug**: `web-compat-basic-auth`
**Status**: active
**Created**: 2026-07-27
**Last Run**: 2026-07-28-19-58-55 (pass — 7/7, HAT mode; the operator performed Esc, credential typing and sheet reading; see `web-compat-basic-auth/runs/2026-07-28-19-58-55.md`)

## Intent

Verifies that a basic-auth-protected page prompts via the chrome-owned sheet, that correct credentials load the page, that cancel dismisses cleanly, that credentials never appear in any page DOM, and that an agent can answer a challenge via `vaultAnswerAuth` without the credential crossing the MCP boundary. The credential path spans main-process callback plumbing, sheet IPC, and the fixture server — only live observation covers the full chain. The fixture's JSONL request log is the read seam proving credentials reached the server.

## Preconditions

- Fixture server running: `node tests/behavior/fixtures/web-compat/serve.mjs --port {P} --log {logpath}` — `/protected` returns 401 `WWW-Authenticate: Basic realm="fixture"` until valid `Authorization` for user `fixtureuser` / password `fixturepass`.
- App launched via `npm run dev:automation` against a profile provisioned by the vault-login fixture pattern, with a vault Login item for origin `http://127.0.0.1:{P}` holding the fixture credentials, and the vault access key available to the test.
- goldfinch MCP reachable.

## Observables Required

- browser (sheet presence via `enumerateWindows()` `sheetVisible`; page DOM via `readDom`/`evaluate` — goldfinch MCP)
- human (HAT: the sign-in card is an `auth-basic` sheet, unreadable and unscriptable by automation at every tier, so reading it and sending it input is `[by-eye]`)
- filesystem (fixture JSONL request log — Read)
- http-indirect (server behavior observed through the fixture log and page state)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab to `http://127.0.0.1:{P}/protected`. | Within 2s a credential sheet appears: `enumerateWindows()` reports `sheetVisible: true`. The page has not loaded protected content. `[by-eye]` The card shows host `127.0.0.1:{P}` and realm "fixture" (card content is unobservable to automation). |
| 2 | Read the guest page DOM while the sheet is open. | No credential material and no input fields injected into the page DOM — the prompt is chrome-owned. `[by-eye]` [a11y] Sheet fields are labeled and keyboard-reachable (the sheet cannot be read or audited by automation). |
| 3 | `[by-eye]` The operator presses Escape on the sheet (an automation `pressKey` Escape leaves the card up). Automation-observable half: if the card is still up, dismiss it by navigating the tab away or closing the tab, and confirm `sheetVisible` is `false`. | Sheet dismisses (`sheetVisible: false`); the tab shows a failed/unauthorized state (no protected content); app remains responsive. Fixture log shows no `Authorization` header received. |
| 4 | Navigate to `/protected` again; `[by-eye]` the operator types `fixtureuser` / `fixturepass` into the sheet and submits (automation cannot type into the card). | Sheet closes (`sheetVisible: false`); page loads the protected content marker. Fixture log's latest entry shows a valid `Authorization: Basic` header. |
| 5 | Read the loaded page DOM and evaluate `document.body.innerText`. | Protected content visible; the password string appears nowhere in the DOM beyond what the server itself echoes (fixture echoes username only). |
| 6 | (Agent path) In a fresh session/profile state with the challenge pending on a new tab to `/protected`: unlock the vault via `vaultUnlock`, list items via `vaultList`, then call `vaultAnswerAuth` with the matching item id and the tab's wcId. | Tool returns `{answered: true}` with no credential fields in the result. The sheet (if shown) closes (`sheetVisible: false`); the page loads protected content; fixture log shows a valid `Authorization` header. |
| 7 | Call `vaultAnswerAuth` for a tab with no pending challenge. | Tool returns `{answered: false}` with a reason — no crash, no hung load. |

## Out of Scope

- Client certificates — `web-compat-client-cert`.
- Proxy auth (`authInfo.isProxy`) — cancelled silently in this flight; revisit if a proxy feature lands.
- Vault save/capture round-trip — covered by existing vault-login specs (re-run under `sandbox: true` is a flight verification item).
