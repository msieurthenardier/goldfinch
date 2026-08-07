# vault-card fixture

Manual-verification fixture for the payment-card fill + capture path (issue #152).

All card data here is **fake** — the seeded PANs are the standard publicly-documented
test numbers. They are Luhn-valid, which matters: the capture path's plausibility
gate rejects Luhn-invalid input, so a made-up number would not round-trip.

## Contents

- **`index.html`** — nine forms, each a deliberate detection variant, including three
  **negative** cases that must *not* be detected (or must not be *offered*). Each form
  shows a live readout of its own field values, so a fill is verifiable at a glance
  without devtools.
- **`seed-cards.mjs`** — seeds card items into an **already set-up** vault, so fill is
  testable without hand-entering a card first. (It does not provision a profile —
  that's `vault-login/build-fixtures.mjs`.)

## 1. Seed some cards

Run with the **app closed** (the vault is file-backed with no cross-process locking):

```
node tests/behavior/fixtures/vault-card/seed-cards.mjs ~/.config/goldfinch-dev '<master password>' [jarId]
```

Seeds two cards into the **global** vault (reachable from every jar) and, if you pass
a `jarId`, a third into that jar. It prints the seeded ids and the known jars.

No vault set up yet? Create one in the app first at `goldfinch://vault`, or start from
a fresh profile with `vault-login/build-fixtures.mjs`.

## 2. Serve the page

From **this directory**, on port **8098** — distinct from the vault-login fixture's
8099 and the MCP loopback 49707:

```
python3 -m http.server 8098
```

Reachable at `http://127.0.0.1:8098/`.

Card fill is **not** origin-matched, so — unlike the vault-login fixture — this port
does not have to match anything stored. That is itself worth checking: serve on a
second port and confirm the cards still offer.

## 3. Launch the app

```
GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation
```

Open `http://127.0.0.1:8098/` in a **persistent-jar** tab (not a burner — burner tabs
are structurally excluded) and unlock the vault.

## What to check

### Fill

| # | Form | Expected |
|---|---|---|
| 1 | Fully hinted, combined `cc-exp` | Icon on all four fields; every field fills; expiry `MM/YY` |
| 2 | Combined expiry, `maxlength="7"` | Expiry fills as `MM/YYYY` |
| 3 | Split month/year `<select>`s | **No icon on the selects**; fill matches the `YY` option |
| 4 | `section-pay billing cc-number` | Identical to #1 — prefixes are tokenized through |
| 5 | Unhinted (`card_number`, `cvv`) | Still detected via the name/id fallback |
| 6 | Hinted number + `membership_expiry` decoy | Number fills; **decoy stays empty** |
| 9 | Login control | Cards section appears regardless of origin; Logins only if one matches |

Also worth confirming across the set:

- The picker shows **Logins** and **Cards** headings only when both families are
  present, and picking the *n*th row fills *that* row's item (the section headings must
  not shift the index).
- The icon's accessible name reads "Fill card from vault" on a card field and "Fill
  login from vault" on a login field.
- Focusing a card field on **form 3** and clicking the icon fills **form 3**, not form
  1 — the gesture binds the clicked form.

### Capture

- Submitting **form 1** with a fresh card offers **Save card?** with a `Visa •••• 4242`
  subject row and both vault choices.
- Re-submitting the **same** card unchanged offers **nothing** (the no-op guard).
- Changing only the expiry and re-submitting offers **Update card?** with no vault
  choice, and updates in place rather than duplicating.
- Submitting **form 8** (Luhn-invalid `4242424242424241`) offers **nothing** — the
  plausibility gate refuses it. The icon still appears, because detection is structural;
  it's the *offer* that's gated.
- Submitting **form 7** (address/quantity) offers nothing and shows no icon anywhere.

### Negative / boundary

- A **burner tab** shows no icon and no offer at all.
- A `goldfinch://` internal tab shows no icon.
- With the vault **locked**, the icon shows the closed/amber glyph and clicking it
  raises the unlock prompt first; a submit into a locked vault holds the card and
  offers to save *after* the unlock.
- Nothing in the picker, the offer sheet, or the page DOM ever shows the full PAN or
  the CVV — only `brand` + `•••• last4`.
