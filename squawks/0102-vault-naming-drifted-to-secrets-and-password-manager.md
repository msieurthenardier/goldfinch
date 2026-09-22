# Squawk 0102: Vault naming drifted to "Secrets" and "Password manager"

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-22
**Completed**: 2026-09-22

## Report

The vault's user-facing name is inconsistent. The page and menu say "Secrets", while
the lock indicator and the unlock/setup sheets say "Password manager". The operator
wants one name. Rename the user-visible copy (operator ruling, 2026-09-22):

- **Vault page** (`goldfinch://vault`): heading → **Vaults**. The `<title>`, the nav
  `aria-label`, and the `<noscript>` line follow ("Vaults — Goldfinch", `Vaults`,
  "The vault requires JavaScript.").
- **Kebab menu item** → **Vault**. The tab-strip name for the vault tab
  (`INTERNAL_JAR_NAMES.vault`) → **Vault**, which keeps it matching the kebab label as
  its test comment intends.
- **Chrome lock indicator**: tooltip `title` → **Vault**; `aria-label` →
  **Vault locked** / **Vault unlocked**.
- **Unlock sheet**: "Unlock password manager" → **Unlock vault** (aria-label and header).
- **Setup**: "Set up the password manager" → **Set up the vault** (sheet aria-label, the
  vault page's not-set-up heading and button).

Copy only. No ids, channels, identifiers, or code comments change. Prose in
`docs/` and behavior-spec narrative that says "password manager" descriptively is out of
scope unless it quotes one of these UI strings verbatim.

## Evidence

- `src/renderer/pages/vault.html` — `<title>Secrets — Goldfinch</title>`,
  `<nav aria-label="Secrets">`, `<h1>Secrets</h1>`, `<noscript>` "The secrets manager requires JavaScript."
- `src/renderer/chrome/overlay-menus.js:17` — `{ id: 'vault', label: 'Secrets' }`
- `src/renderer/chrome/tab-controller.js:96` — `INTERNAL_JAR_NAMES … vault: 'Secrets'`
- `src/renderer/index.html:258-259` — `title="Password manager"`, `aria-label="Password manager locked"`
- `src/renderer/chrome/vault-controller.js:246` — `'Password manager unlocked' : 'Password manager locked'`
- `src/shared/vault-unlock-template.js:42,47` — `'Unlock password manager'`
- `src/shared/vault-set-template.js:39` — `'Set up the password manager'`
- `src/renderer/pages/vault.js:543,562` — `'Set up the password manager'` (heading + button)
- Pinned by tests that need the same edit: `test/unit/vault-unlock-template.test.js:27,52`,
  `test/unit/vault-set-template.test.js:26`, `test/unit/tab-controller.test.js:249`.
  Also grep `tests/behavior/*.md` and `docs/` for the old UI strings quoted verbatim (for
  example, a step that reads the indicator's aria-label or the unlock header).

## Corrective Action

Renamed the user-visible copy exactly per the Report's table — no ids, channels, or code
comments touched:

- `src/renderer/pages/vault.html`: `<title>` → "Vaults — Goldfinch", nav `aria-label` →
  "Vaults", `<h1>` → "Vaults", `<noscript>` → "The vault requires JavaScript."
- `src/renderer/pages/vault.css`: the seven `nav[aria-label='Secrets']` selectors → `nav[aria-label='Vaults']`.
  **Not in the Report's evidence list, but load-bearing** — these are functional CSS
  selectors matched against the live `aria-label` attribute (not decorative comments), so
  renaming the HTML's `aria-label` without this edit would have silently detached the
  entire left-nav sidebar's styling. Discovered while implementing, treated as a direct,
  mechanical consequence of the `aria-label` rename rather than a scope expansion.
- `src/renderer/chrome/overlay-menus.js`: kebab item `{ id: 'vault', label: 'Secrets' }` → `'Vault'`.
- `src/renderer/chrome/tab-controller.js`: `INTERNAL_JAR_NAMES.vault` `'Secrets'` → `'Vault'`.
- `src/renderer/index.html`: `#vault-indicator` `title="Password manager"` → `"Vault"`,
  `aria-label="Password manager locked"` → `"Vault locked"`.
- `src/renderer/chrome/vault-controller.js`: `renderVaultIndicator`'s label strings
  `'Password manager unlocked'`/`'Password manager locked'` → `'Vault unlocked'`/`'Vault locked'`.
  Confirmed no other site sets `#vault-indicator`'s `title` dynamically — it's static
  markup only, already covered by the `index.html` edit.
- `src/shared/vault-unlock-template.js`: card `aria-label` and header title
  `'Unlock password manager'` → `'Unlock vault'` (both occurrences).
- `src/shared/vault-set-template.js`: card `aria-label` `'Set up the password manager'` → `'Set up the vault'`.
- `src/renderer/pages/vault.js`: not-set-up `<h2>` heading and primary button text
  `'Set up the password manager'` → `'Set up the vault'` (both occurrences).

Test pins updated to match:
- `test/unit/tab-controller.test.js` — assertion + its explanatory comment (`'Secrets'` → `'Vault'`).
- `test/unit/vault-unlock-template.test.js` — both `'Unlock password manager'` pins → `'Unlock vault'`.
- `test/unit/vault-set-template.test.js` — `'Set up the password manager'` pin → `'Set up the vault'`.

Grepped `test/`, `tests/behavior/*.md`, `docs/`, and `scripts/a11y-audit.mjs`'s ACCEPTED
allowlist for verbatim quotes of the old strings. No other hits: the ACCEPTED allowlist
entries key off sheet-menuType labels and `openVault*OverlayForAudit()` hook names, never
rendered text. Remaining "password manager"/"secrets manager" occurrences in
`tests/behavior/*.md` and `docs/vault.md` are descriptive prose ("the password manager's
capture disposition…", "a secrets manager exists") that never quotes a UI string verbatim
— left unchanged per the Report's explicit carve-out. `missions/` historical flight
artifacts and `squawks/0009-*` (a past squawk record) were left untouched — out of scope
(history, not shipped copy), and `missions/22-find-it-in-the-vault/` was not touched at
all per instruction.

## Verification

- `timeout 600 npm test` — green both before and after `npm run format` (re-ran after
  format touched `index.html`'s formatting): `5654 tests, 5650 pass, 0 fail, 4 todo`.
- `npm run typecheck` — clean, no output.
- `npm run lint` — clean, no output.
- `npm run format` — reformatted `src/renderer/index.html` (collapsed the
  `#vault-indicator` button tag onto one line now that the shortened `title`/`aria-label`
  values fit Prettier's print width; no content beyond the intended rename).
- `npm run format:check` — "All matched files use Prettier code style!"
- Final grep, `grep -rn "'Secrets'\|\"Secrets\"\|>Secrets<\|Secrets — Goldfinch\|secrets manager" src/`
  and `grep -rn "Password manager\|password manager" src/` — every remaining hit is a code
  comment (`vault.js:45`, `index.html:246`, `vault.css:308`, `vault-crypto.js:5`,
  `vault-store.js:3504`) or the browser-import copy ("your browser's password manager",
  `vault-browser-import-controller.js:91`) — exactly the two carve-outs the Report names.
  No user-visible "Secrets" or "Password manager" string remains anywhere in `src/`.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew)
**Verdict**: confirmed — every rename present with the specified wording; the `vault.css`
`nav[aria-label='Vaults']` selector change judged a correct, complete mechanical consequence (no
other selector/query keys on the old label); diff confined to the reported surface; `npm test`
5650 pass / 0 fail / 4 todo, typecheck, lint, format:check green. One non-blocking note: the
`vault.css:308` comment still quotes the old "Set up the password manager" button text (comments
were out of scope).
**Commit**: see `squawk/0102: rename vault copy from Secrets/Password manager to Vault(s)`
