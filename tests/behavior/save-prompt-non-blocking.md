# Behavior Test: The save prompt never blocks the page

**Slug**: `save-prompt-non-blocking`
**Status**: draft
**Created**: 2026-11-04
**Last Run**: never

## Intent

Verify, on a live page, that a login submit raises the corner save prompt (Sortie 06) **without** a blocking surface. While the prompt is up the page still accepts real clicks and typing. The prompt goes away on its own at about 10 s, and switching tabs drops it.

This needs a behavior test rather than a unit test because the claim is about native-surface topology. A unit test can prove that the manager sizes the view to the card. It cannot prove that a real `sendInputEvent` click over the guest reaches the guest while the prompt view is attached. That is the exact property the old full-guest sheet broke.

Prompt **content and pixels** are out of reach here (the prompt view is fail-closed to every automation op and to `captureWindow`), so they belong to the HAT.

## Preconditions

- Goldfinch is running via **`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`** against a **throwaway** profile (`--user-data-dir=<dir>`). The admin key is captured from the `AUTOMATION_DEV_MINT` stdout line. Admin is needed for `enumerateWindows` (`sheetVisible`, `savePromptVisible`).
- The vault is set up in that profile via `tests/behavior/fixtures/vault-login/build-fixtures.mjs <userDataDir>`, with the fixture served locally. Use the fixture's **capture mode** (`capture.html` → `landed.html`, added in Sortie 06 Leg 1; see the fixture README). Its submit **navigates** to a landing page that has a text input `#probe` and a `#bump` counter button with a visible count. The unmodified `index.html` `preventDefault()`s its submit and never releases an offer. The builder seeds a Login for the fixture origin in each jar's vault, so **each submit step uses a username AND password unique to the run** (a fresh tab each time). A unique pair makes the disposition `save` regardless of the seeded items; a repeated or default credential could instead match one and turn the offer into an `update`, or into no offer at all.
- **Variant A (unlocked)**: the operator has unlocked the vault once by typing the master password into the unlock sheet. No automation path can do this, by design.
- ⚠ The Goldfinch window holds real OS focus. Without it, Blink dispatches no focus events to the page, and the timer's "window not focused" pause (DD4) would hold the prompt up forever, faking a Step 5 failure.

## Observables Required

- **browser (guest main world)**: page state read via MCP `evaluate` / `readDom` on the guest wcId. This covers the typed value in a page input and a click counter the fixture page increments.
- **browser (window topology)**: `enumerateWindows()` → `sheetVisible` (existing), plus **`savePromptVisible` and `savePromptPaused` (NEW in Sortie 06 Leg 1, DD10)**. All are admin reads with zero cached state. They are the only observables for the prompt: whether it is up, and whether its timer is paused, can be measured, but its content cannot. The prompt view is refused to every automation op at every tier.
- **shell**: fixture HTTP 200; the `AUTOMATION_DEV_MINT` line.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Preconditions probe.** Connect an MCP client with the admin key and `curl` the fixture. Open a tab at the fixture's capture-mode page (`http://127.0.0.1:8099/capture.html`) in the fixture's persistent jar (`openTab` with `jarId`), then read `enumerateWindows()` and `evaluate` `document.hasFocus()` on the guest. | The handshake succeeds and `tools/list` includes `click`, `typeText`, `evaluate`, `enumerateWindows`. The fixture returns 200. The page loads. `savePromptVisible` is `false` and `sheetVisible` is `false`. `document.hasFocus()` is `true`. If it is `false`, **halt**: the window lacks OS focus, so the DD4 blur pause would hold the prompt and Steps 4–5 would fail for the wrong reason. Click the window and re-run. |
| 2 | **Submit.** `click` `#username` and `typeText` a username, then `click` `#password` and `typeText` a password. **Both the username and the password are unique to this run** (trusted input; not `vaultFill`, because capture provenance is value-bound). Press the submit button with the `click` tool (a trusted click). | The landing page loads (`#probe` present). Within 3 s, `savePromptVisible` is `true`, `savePromptPaused` is `false`, **and** `sheetVisible` is `false`: no full-guest sheet was raised. |
| 3 | **The page is usable under the prompt.** Within 5 s of Step 2: `click` `#probe`, `typeText` "still usable", then `click` `#bump` twice. | `evaluate` on the guest shows `#probe`'s value is `still usable` and the counter reads `2`. `savePromptVisible` is still `true`, so no interaction with the page dismissed it. |
| 4 | (wait point, no actions) | About 5 s after Step 2, `savePromptVisible` is still `true` and `savePromptPaused` is `false`. The timer is running and has not expired early. |
| 5 | (wait point, no actions) | Within 13 s of the moment Step 2 first saw `savePromptVisible: true` (the timer starts at presentation, not at submit), `savePromptVisible` becomes `false` without any action. `sheetVisible` stays `false`. |
| 6 | **Tab switch drops it.** In a fresh tab, repeat the Step 2 submit with a fresh username and password. Once `savePromptVisible` is `true`, open a second tab and make sure it is active (`activateTab` explicitly; don't rely on `openTab` activating it). Wait 1 s, then activate the first tab again. | `savePromptVisible` is `false` right after the switch. After switching back and waiting 1 s it is still `false`: the prompt was not re-shown. Whether the capture was dropped main-side, rather than merely hidden, is pinned by the manager and close-effects unit tests, not observable here. |
| 7 | **Recovery control.** In a fresh tab, repeat the Step 2 submit with a fresh unique username and password. | `savePromptVisible` becomes `true` again. This proves Steps 5–6 were the timeout and tab rules at work, not a wedged prompt path. |

## Out of Scope

- **Prompt pixels, placement, caret, find-bar stacking and the countdown bar**: by-eye only. The view is excluded from `captureWindow`, and the native-surface rule makes a human watching the rendered surface the acceptance signal (HAT).
- **F6 into the prompt, Esc / Not now / ✕, hover and focus pause**: MCP `pressKey` and `click` target a guest wcId, never the prompt view, so these are HAT steps.
- **Saving**: the save itself, the vault choice and the update re-ask. Main-side writes are covered by unit tests (`captureSave`, consent gate). The locked flow needs a master password typed into a chrome sheet, so it is operator-only.
- **That the held credential is discarded** on timeout or tab switch: there is no automation read for held records. Unit tests cover `vaultCaptureDismiss` on every close reason (DD6).
- **Screen-reader announcement**: HAT.
- Card/identity capture detection: `vault-card-fill-capture`.

## Variants

- **A: vault unlocked.** As written.
- **B: vault locked.** Lock via the vault indicator (the lock fan-out closes only vault credential sheets and the prompt), or relaunch the app, and run Steps 1–7 without unlocking. Every assertion is unchanged: a locked offer shows the same non-blocking corner prompt (primary "Unlock & save"), and in Step 2 `sheetVisible` must be `false` — the unit-level regression gate is that no `vault-unlock` sheet opens on offer arrival. Requires Leg 2 (landed). **HAT / by-eye, per the 2026-11-04 operator ruling:** live runs are deferred to the HAT; the Variant B live flow ("Unlock & save" → the unlock sheet → "Password saved to …" in the corner; an unlock in another window converting the prompt; the expired-after-unlock case) is run by eye with the operator, not by an automated run.
