# Behavior Test: Opt-in spellcheck (default OFF, suggestions via the context menu)

**Slug**: `spellcheck`
**Status**: draft
**Created**: 2026-06-19
**Last Run**: never

> **Known environment limitation (WSLg).** Under WSLg the red spellcheck **squiggle does not paint into a
> `captureWindow` frame** even when `isSpellCheckerEnabled() === true` (Leg-2 premise-audit, Electron
> 42.4.0 — the compositor does not render the red wavy underline into a captured bitmap; the API toggle is
> CONFIRMED live, the *rendering* is not observable here). The **squiggle-render** step and the **macOS
> native-`NSSpellChecker` suggestion** path are therefore **macOS/HAT-authoritative** and are expected
> **INCONCLUSIVE on WSLg** — do **not** fail them; the Flight-Director run **dispositions** them
> (INCONCLUSIVE-on-WSLg with the disposition, never a silent pass). The opt-in **state** and the menu
> **suggestion/correction plumbing** ARE WSLg-acceptance observables. Mirrors the `find-in-page.md`
> cold-start warning block.

## Intent

Verify SC3: spellcheck is **OFF by default** (no egress, no engagement) and is **opt-in** via Settings →
Appearance; once enabled, misspelled words in editable fields are spell-checked, and the
`#page-context-menu` surfaces dictionary **suggestions** that, when chosen, **correct** the word through
the `correctMisspelling` round-trip. This needs a behavior test, not a unit test: the spellchecker is
gated at the **session layer** (`setSpellCheckerLanguages(['en-US'])` on / `[]` off, across
`defaultSession` + `PAGE_PARTITION` + every live web jar, never the internal session), the dictionary is
fetched live from the Chromium CDN on first opt-in (Linux/Windows), and the suggestion→correction is a
cross-process round-trip (guest `context-menu` params → chrome menu → `page-context-correct` →
`replaceMisspelling` on the guest) — none of which a unit test reproduces.

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707`. Capture the
  `adminKey` from the `AUTOMATION_DEV_MINT` stdout line. MCP server on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Admin key attaches via the Bearer header** (same SDK `StreamableHTTPClientTransport` pattern as
  `toolbar-pins.md` / `page-context-menu.md` — the admin key is required: it reaches the chrome shell, the
  internal `goldfinch://settings` guest, and the web guests).
- **Dual targets — chrome + the settings guest + a web guest.**
  - **Chrome** (`getChromeTarget()` → chrome `wcId`): the `#page-context-menu` (read via
    `readDom`/`readAxTree`/`captureWindow`; drive via coordinate `click`/`pressKey`).
  - **Settings guest** (`enumerateTabs` → the `goldfinch://settings` entry → `guestWcId`): the
    **Appearance** Spellcheck checkbox (`#spellcheck-enabled`), driven like `toolbar-pins.md` drives the
    pin toggles.
  - **Web guest** (a normal web tab → its `wcId` via `enumerateTabs`): the editable field where a
    misspelling is typed (`typeText`) and right-clicked (`click { button: 'right' }`), and where the field
    text is read back via `evaluate` (guest main world).
- **Coordinate-click rule** (same as `toolbar-pins.md` / `page-context-menu.md`): locate targets in a
  `captureWindow()` frame; clicks are coordinate-based.
- **STATE-proxy discipline (load-bearing — see the Default-OFF step + Out of Scope).** Goldfinch's MCP
  surface has **no network-observation tool** (the 27-tool surface is drive/observe/eval/devtools/discovery
  only), and `evaluate` runs in the **guest main world**, so it **cannot** read the main-process
  `session.getSpellCheckerLanguages()` / `isSpellCheckerEnabled()`. The spec therefore asserts the **state
  proxy** — `settings.json` `spellcheck` + whether the forwarded `params` carry spellcheck engagement —
  NEVER a literal network/no-fetch assertion. Do **not** author a `[mixed-frame]` network row.
- **Fresh-profile reset (setup-friendly).** Before running, reset `userData/settings.json` (delete it or
  set `spellcheck: false`) so the Default-OFF baseline holds. `settings.json` is filesystem-readable.
- **Active-precondition probe** (Step 1): `tools/list` includes (presence-checked) `getChromeTarget`,
  `enumerateTabs`, `click`, `typeText`, `pressKey`, `readDom`, `readAxTree`, `captureWindow`, `evaluate`;
  `getChromeTarget()` returns a numeric chrome `wcId`.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify (it launches its own
  browser). The apparatus is the SDK admin MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`.

## Observables Required

- **filesystem (`userData/settings.json` `spellcheck` — measured via Read/Bash):** the opt-in state proxy
  (OFF by default; flips to `true` on enable; back to `false` on disable).
- **mcp / browser (chrome DOM + a11y tree, + the forwarded `params` — measured via the admin MCP client):**
  whether the `#page-context-menu` shows a **spelling-suggestions section** (i.e. whether the forwarded
  `params` carried a `misspelledWord` + `dictionarySuggestions`); the Appearance checkbox `aria-checked`;
  the suggestion items' text.
- **browser (guest main world — measured via the `evaluate` tool):** the editable field's `.value`/text
  before and after choosing a suggestion (the correction round-trip's DOM observable).
- **screenshot (HAT/macOS-authoritative only — `captureWindow`):** the red squiggle render — INCONCLUSIVE
  on WSLg (see the top-of-spec block), dispositioned, not asserted as a WSLg pass.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; `tools/list`; `getChromeTarget()` → chrome `wcId`. | `tools/list` **includes** (presence-checked) the drive/observe/eval tools this spec uses; `getChromeTarget()` returns a **numeric** chrome `wcId`. If the probe fails, halt. |
| 2 | **Default OFF — opt-in gate (WSLg-acceptance, STATE observable).** With a freshly-reset profile (Preconditions), read `userData/settings.json` (filesystem). Open a web tab, focus an editable field, `typeText` a misspelled word (e.g. `teh`), then `click(webWcId, x, y, { button: 'right' })` on it; read the chrome `#page-context-menu` (`readDom`/`readAxTree`). | `settings.json` carries `spellcheck:false` (or the key is absent — the store default is `false`); and the forwarded `params` carry an **empty/absent `misspelledWord`** and **empty `dictionarySuggestions`**, so the menu shows **no spelling-suggestions section** — the spellchecker is **not engaged** because the gate is OFF. *(This is the **state proxy**, NOT a network assertion — see the no-egress carve-out in Out of Scope.)* |
| 3 | **Enable via Settings (WSLg-acceptance, state observable).** Open `goldfinch://settings`; record `guestWcId` via `enumerateTabs`; navigate to **Appearance**; `captureWindow()` to locate the **Spellcheck** checkbox (`#spellcheck-enabled`); `click(guestWcId, x, y)` it ON (or anchor + keyboard-activate). Re-read `readAxTree(guestWcId)` and `userData/settings.json`. | The checkbox reads **checked** (`aria-checked="true"` / `checked`); `settings.json` `spellcheck === true` (persisted, filesystem); the help text shows the **new-tabs / reload-open-tabs** wording (the Leg-2 conservative copy — never "squiggles appear on this already-open tab"). `[a11y]` |
| 4 | **Squiggle on a misspelled word (macOS/HAT-authoritative — INCONCLUSIVE on WSLg).** Open a **new** web tab (per the new-tabs wording); focus an editable field; `typeText` a misspelled word; wait briefly; `captureWindow()`. | **(HAT/macOS):** a red wavy underline renders under the misspelled word (screenshot observable). **WSLg disposition:** **INCONCLUSIVE** — the API toggle is confirmed live but the squiggle does not paint into a captured frame (Leg-2 premise-audit). **Flag, do not fail.** |
| 5 | **Right-click → suggestions → choose → correction (mixed acceptance).** In that new tab, `click(webWcId, x, y, { button: 'right' })` on the misspelled word; read the chrome `#page-context-menu` (`readDom`/`readAxTree`). If a suggestion is present, `click(wcId, x, y)` it; then `evaluate` the editable field's text on the guest. | **WSLg-acceptance (menu plumbing):** when the forwarded `params` carry a `misspelledWord` + non-empty `dictionarySuggestions`, the menu renders a **spelling-suggestions section** (capped at 8; a **"No suggestions"** placeholder if `misspelledWord` is set but the list is empty) above the editable section; choosing a suggestion fires the `correctMisspelling` round-trip and the field text **changes to the chosen word** (`evaluate` DOM observable). **Dict-not-loaded case (NOT a failure):** on WSLg the dictionary may not have loaded (the one-time `.bdic` CDN fetch may not fire on an `executeJavaScript`-driven focus, or may be cached), so `dictionarySuggestions` can be **empty** — treat an **empty list as the dict-not-loaded case, a populated list as confirming the plumbing**; neither is a failure. **macOS-authoritative:** the native-`NSSpellChecker` suggestion-list *content* + the visual correction on a real display. |
| 6 | **Disable round-trips OFF.** Re-open `goldfinch://settings` → Appearance; `click(guestWcId, x, y)` the Spellcheck checkbox OFF (or keyboard-activate). Read `userData/settings.json`. | The checkbox reads **unchecked**; `settings.json` `spellcheck === false` (persisted) — the session layer clears the web sessions via `setSpellCheckerLanguages([])`. *(Whether macOS `NSSpellChecker` squiggles clear on OFF is macOS-authoritative — Out of Scope.)* `[a11y]` |

**Row conventions:** Step 2 asserts the **state proxy** (OFF by default + no spellcheck engagement in
`params`), which IS WSLg-observable. Step 4 is the **squiggle render**, macOS/HAT-authoritative
(INCONCLUSIVE on WSLg — dispositioned, not failed). Step 5 mixes a **WSLg-acceptance** menu-plumbing
assertion (when a `misspelledWord` is present, the suggestions render + correction round-trips) with a
**macOS-authoritative** native-speller content path; an empty suggestion list is the dict-not-loaded case,
not a failure. `[a11y]`-marked rows are accessibility-relevant.

## Out of Scope

- **The literal no-`.bdic`-egress assertion** — that **no** `.bdic` GET to `redirector.gvt1.com/edgedl/
  chrome/dict/…` fires before opt-in, and **exactly one** per-language fetch after opt-in on Linux/Windows
  — is **HAT / network-trace-authoritative**. Goldfinch's MCP surface has **no network-observation tool**,
  and `evaluate` runs in the guest main world (it can't read the main-process session), so this is **not
  measurable on the apparatus**. The WSLg assertion is the **state proxy** only (Step 2). *(Documented in
  README + CLAUDE.md as the accepted, opt-in-only egress; verify the actual fetch via a network trace on
  macOS/HAT.)*
- **The macOS native-`NSSpellChecker` path** — on macOS Electron uses the OS dictionary (no `.bdic`
  fetch); the squiggle render, the suggestion-list content, and whether OFF clears squiggles are all
  **macOS-authoritative**.
- **The squiggle pixels** — the red wavy underline render is HAT-authoritative (INCONCLUSIVE on WSLg, per
  the top-of-spec block).
- **The find-bar / other editable affordances** — unrelated; not this spec.
- **The page context menu render itself** (sections, cursor, keyboard nav, Inspect) — owned by
  `page-context-menu.md`; this spec cross-references it for the menu render and asserts only the
  **spelling-suggestions** section + the **correction round-trip** on top of it.
- **The Appearance toggle mechanics** (the checkbox's read/write/persist plumbing in general) — covered by
  `settings-controls.md` as a regression; here it is exercised only as the spellcheck opt-in driver.

## Variants (optional)

- After opt-in, type a **correctly-spelled** word and right-click it: `params` carry **no**
  `misspelledWord`, so the menu shows **no** spelling-suggestions section (the inverse of Step 5).
- On macOS/HAT: confirm the one-time per-language `.bdic` fetch fires on the **first** post-opt-in editable
  focus and **not** again (network trace), and that nothing fetches while OFF.
