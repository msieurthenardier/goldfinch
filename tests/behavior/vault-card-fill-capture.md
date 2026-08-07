# Behavior Test: Payment cards are detected, offered, and captured on a live page

**Slug**: `vault-card-fill-capture`
**Status**: active
**Created**: 2026-08-07
**Last Run**: 2026-08-07-11-07-27 — [run log](./vault-card-fill-capture/runs/2026-08-07-11-07-27.md) (**PASS**, 34/34 automated cases; the fill step remains operator-only — see *Out of Scope*)

## Intent

Verify that a **payment card** stored in the vault is reachable from a live web page (issue #152): the decorative lock icon anchors on real card fields, the gesture round-trip reaches the chrome-owned sheet, and a submitted payment form raises a save offer **only** when the submitted value is plausibly a card.

This needs a behavior test rather than a unit test for one specific reason: **card detection is heuristic where login detection is structural.** A login form has an anchor the browser itself identifies (`input[type=password]`); a card form has none — every field is `text`/`tel`/a `<select>` — so `src/preload/vault-card-fields.js` resolves roles from the WHATWG `autocomplete` `cc-*` tokens, with a narrow name/id fallback for unhinted checkouts. The unit suite drives that logic against a hand-rolled fake document, which cannot prove Chromium reflects `autocomplete` the way the module reads it, that real layout/visibility gating admits the fields, or that the fallback stays contained on a real page. Only a live run does.

The **negative** cases carry as much weight as the positive ones. A false positive puts an icon on an unrelated field and, worse, lets capture read an unrelated submitted value as a PAN — so "no icon on the address form" and "no offer for a Luhn-invalid number" are load-bearing assertions, not garnish.

## Preconditions

- Goldfinch running via **`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`**, with the admin key captured from the `AUTOMATION_DEV_MINT` stdout line. Admin is needed for `enumerateWindows` (the `sheetVisible` read that Steps 5–9 depend on).
- **A vault that is set up**, with at least one card seeded. Use a throwaway profile rather than the operator's own — `--user-data-dir=<dir>` works (the app appends `-dev` to it), and `tests/behavior/fixtures/vault-card/seed-cards.mjs <userDataDir> <masterPassword> [jarId]` seeds cards into an already-set-up vault. The vault may be **locked**; every assertion below holds either way (a held capture raises the unlock sheet instead of the save sheet, and both register as a sheet).
- The fixture served at **`http://127.0.0.1:8098/`** — `python3 -m http.server 8098` from `tests/behavior/fixtures/vault-card/`. Card fill is **not** origin-matched, so the port need not match anything stored; serving on a second port is a valid extra check.
- ⚠ **The Goldfinch window must hold real OS focus** for Steps 2–4 and 8–9. See *Apparatus constraints* — this is the failure mode most likely to fake a pass.

## Observables Required

- **browser (guest main world)** — the injected icon node (`[data-goldfinch-vault-lock]`) and its `aria-label`, read via the MCP `evaluate` tool on the guest wcId. The label is the **only** kind carrier: there is deliberately no `data-kind` attribute, because the icon's attribute set is pinned by `vault-fill-icon.test.js` as a "holds nothing a hostile page can read" guard.
- **browser (window topology)** — `enumerateWindows().sheetVisible`, an admin read with zero cached state. This is the only observable for the sheet: the entire `vault-*` menuType family is refused to `readDom` / `readAxTree` / `captureScreenshot` by the (menuType × op) gate, so *whether* an offer opened is measurable but its *content* is not.
- **shell** — fixture HTTP 200; the `AUTOMATION_DEV_MINT` line.

## Apparatus constraints

Four properties of this surface, all measured rather than assumed. Two of them produce **convincing false results** rather than errors, so they are preconditions, not trivia. The apparatus (`tests/behavior/fixtures/vault-card/drive.mjs`) encodes all four.

1. **`openTab` takes `jarId`, not `container`.** An unrecognized property is silently ignored, so a mistyped `container: 'burner'` opens in the *default* jar and every burner assertion then "fails" against a persistent-jar tab that legitimately shows icons.
2. **Sheets cannot be dismissed from here.** `pressKey` targets a guest wcId, and the sheet is refused to every drive op. An Escape after a sheet opens goes to the page; the sheet stays up and every later case trivially sees `sheetVisible: true`. Each capture case therefore runs in its **own tab** and closes it (`tab-close` is a real sheet-close reason) and asserts a clean start.
3. **`.focus()` is legitimate; a scripted click is not.** Only click/contextmenu are `isTrusted`-gated, so scripted focus exercises the same placement path a human focus takes. Clicks must go through the `click` tool (`sendInputEvent`) to be trusted.
4. **⚠ The focus-dependent suites need real OS focus.** Blink dispatches no focus events to an unfocused document: `el.focus()` still sets `activeElement`, but no `focusin` fires, so no icon is ever placed — and **every negative assertion then passes for the wrong reason**. Neither `activateTab` (a programmatic `win.focus()` does not take under WSLg) nor a synthetic `click` (`sendInputEvent` moves no OS focus) restores it. The apparatus therefore runs a **positive control** first and aborts the focus-dependent suites if it fails; the capture suite is focus-independent and still runs.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Preconditions probe.** Connect an MCP client with the admin key; `curl` the fixture. Open a tab at the fixture in a persistent jar (`openTab` with `jarId`). | Handshake succeeds and `tools/list` includes `evaluate`, `click`, `enumerateWindows`. Fixture returns 200. The tab loads (`.marker` present). |
| 2 | **Positive control (focus precondition).** Focus form 1's `cc-number` field; read `[data-goldfinch-vault-lock]` and `document.hasFocus()`. | An icon is present. If not — and `hasFocus` is `false` — **halt the focus-dependent steps**: nothing can place an icon, so Steps 3–4 and 8–9 would pass vacuously. Click the window and re-run. |
| 3 | **Detection sweep.** Focus every field of all 9 forms in turn; record whether an icon appears and its `aria-label`. | Matches the fixture contract exactly: card icons on forms 1, 2, 4, 5, 8 and on form 3's number+csc and form 6's number; **no icon** on form 3's month/year selects, form 6's `membership_expiry` decoy, or any of form 7's five fields; **login**-labelled icons on form 9. |
| 4 | **Kind labelling.** Inspect the labels captured in Step 3. | Card anchors read `Fill card from vault` / `Unlock vault to fill card`; login anchors read `…login…`. The kind rides the accessible name only — assert no `data-kind` attribute exists. |
| 5 | **Capture — valid card.** In a fresh tab, fill form 1 with a Luhn-valid PAN and **click its submit button** (a real trusted click); read `sheetVisible`. | A sheet opens. (Locked vault → the unlock sheet; unlocked → the save sheet. Either satisfies this step.) |
| 6 | **Capture — Luhn-invalid.** Fresh tab; submit form 8 with `4242424242424241`. | **No sheet.** The plausibility gate refuses it. Note the icon *is* present on that form — detection is structural; it is the *offer* that is gated. |
| 7 | **Capture — non-card forms.** Fresh tab each: submit form 8 with `12345` (too short), then form 7 (address/phone/quantity/order). | **No sheet** in either case. |
| 8 | **Capture — recovery control.** Fresh tab; submit form 5 (unhinted) with a valid Mastercard. | A sheet opens — proving Steps 6–7 were the gate deciding, not a wedged or one-shot capture path. |
| 9 | **Gesture round-trip + isTrusted guard.** Fresh tab: focus form 1's card number, **click the icon** with the `click` tool → read `sheetVisible`. Then in another fresh tab, dispatch a **scripted** `MouseEvent('click')` on the icon → read `sheetVisible`. | The trusted click opens a sheet (guest → main → chrome → sheet round-trip works for a *card* anchor). The scripted dispatch opens **nothing** — a hostile page cannot raise the prompt. |
| 10 | **Operator step — the actual fill.** Unlock the vault by typing the master password into the sheet, then use the icon on each of forms 1–6 and pick a seeded card. | Fields populate per the fixture's per-form expectations: combined `MM/YY`; `MM/YYYY` where `maxlength="7"`; split selects matched on option value; the decoy left empty; the clicked *form* filled, not the first one. |

## Out of Scope

- **The actual fill (Step 10) is operator-only, by design.** The picker requires an unlocked vault, and unlock requires typing the master password into a chrome-owned sheet. No automation path installs the MRK — a per-jar or admin access key unwraps vault keys directly and never the manager — so this is a security property, not an apparatus gap. It will not become automatable without weakening that boundary.
- **Sheet content.** The whole `vault-*` menuType family is unobservable (`AUTOMATABLE_MENU_TYPES` admits only `bookmarks-overflow` / `bookmark-edit`). Assertions about picker rows, sectioning, or offer copy are operator-only.
- **Burner and internal-tab exclusion.** `openTab` refuses any jarId absent from the registry (including `burner`) and accepts http(s) only, so neither is reachable from this apparatus. Both are covered by the unchanged `vaultEligible` gate and its unit tests.
- **MCP card fill.** The automation vault surface is deliberately login-only; `docs/mcp-automation.md`'s "never card data" guarantee is unchanged by issue #152.
- Login capture/fill — covered by `vault-capture-save-update` and `vault-human-fill-boundary`.
