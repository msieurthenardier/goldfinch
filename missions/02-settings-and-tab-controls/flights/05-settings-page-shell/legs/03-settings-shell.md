# Leg: settings-shell

**Status**: landed
**Flight**: [Settings Page Shell + Address-Bar Chips](../flight.md)

## Objective
Enrich `goldfinch://settings` from the stub into a Chrome-style settings shell — a persistent left
section-nav plus a scrolling column of five titled `<section>`s with placeholder content — fully accessible,
served under the unchanged strict CSP.

## Context
- **DD1.** Single-document shell: a `<nav>` sidebar of in-page anchor links (one per section) + a scrolling
  content column of `<section>`s, each with an `<h2>` and placeholder content. Sections (DD1, operator):
  **Appearance · Privacy & Shields · On startup / Home page · Downloads · About**. **Native `#anchor`
  navigation** (links are `<a href="#appearance">` etc.) — keyboard- and AT-operable with **no JS**. An
  **optional** minimal `settings.js` adds only scroll-spy `aria-current` highlighting. Single document with
  in-page anchors → no real `goldfinch://` sub-navigation ever fires `will-navigate` (mission constraint
  holds trivially).
- **DD3.** `settings.css` is **self-contained** — re-declares the brand tokens (`--accent: #f5c518`,
  `--accent-fg: #1e1f25`, dark bg `#1e1f25`); does **not** `@import` the chrome `styles.css`. Leg 2 already
  created a minimal `settings.css` (tokens + body bg) and wired the `<link>` — this leg enriches it.
- **CSP — inline forbidden.** `INTERNAL_CSP` is `default-src 'self'; …` with **no `'unsafe-inline'`**, so
  **no inline `<style>` and no inline `<script>` and no inline event-handler attributes** (`onclick=` etc.).
  All CSS lives in the served `settings.css`; any JS lives in a served `settings.js`.
- **Subresource serving (leg 2).** Leg 2 serves `/` (html) and `/settings.css` via the per-host path
  allowlist in `src/main/main.js` `INTERNAL_PAGES`. **If this leg ships `settings.js`, it MUST add a
  `/settings.js` entry to that map** (and the `path.join(__dirname,...)` absolute path) — otherwise the
  script 404s. Keep the map honest: only add the entry if the file is actually shipped.
- **Verification (DD8).** The guest DOM read path is **proven** (Flight-4 live): a guest CDP attach reads
  `goldfinch://settings` DOM, and `npm run a11y -- --target=goldfinch://settings` runs the guest axe audit.
  Both are exercised in leg 7; this leg's a11y obligation is to introduce **no new** WCAG A/AA violations.
- **CSP-subresource prior (DD2 deviation).** Leg 3 proceeds assuming the served `settings.css` (and
  `settings.js` if shipped) load under `'self'`; the live confirm is batched into leg 7 with a documented
  one-line CSP fallback.

## Inputs
What exists before this leg runs:
- `src/renderer/pages/settings.html` — stub (`<main><h1>Settings</h1><p>Coming soon.</p></main>`) with the
  `<link rel="stylesheet" href="settings.css">` already present.
- `src/renderer/pages/settings.css` — minimal brand-token + body stylesheet (leg 2).
- `src/main/main.js` `INTERNAL_PAGES` per-host path map serving `/` and `/settings.css`.
- The guest a11y mode `npm run a11y -- --target=goldfinch://settings` (Flight 4).

## Outputs
- `settings.html` enriched into the sidenav + 5 titled sections + placeholder content, using semantic
  landmarks and a correct heading hierarchy.
- `settings.css` enriched into the Chrome-style layout (sticky sidebar, scrolling content, brand styling).
- Optionally `settings.js` (scroll-spy `aria-current` only) + its `INTERNAL_PAGES` map entry, IF shipped.

- [ ] **(SC6 — structural, offline-verifiable)** `settings.html` has a **persistent left section-nav**
  (`<nav aria-label="Settings sections">` containing a `<ul role="list">` of five in-page anchor links
  `<a href="#…">`, one per section) and a **content column** (`<main>`) holding a single `<h1>Settings</h1>`
  (as `<main>`'s first child) followed by **five `<section>`s**, each with a unique `id` matching its nav
  link, an `<h2>` title, and placeholder content. Sections, in order with these ids: **Appearance**
  (`appearance`), **Privacy & Shields** (`privacy`), **On startup / Home page** (`startup`), **Downloads**
  (`downloads`), **About** (`about`). Every nav `href` maps one-to-one to a section `id`.
- [ ] **(SC6 — visual, deferred to leg 7 / HAT)** Rendered live, the shell **reads as a settings area** —
  sidebar legible as section navigation, sections as titled settings groups with visible placeholder text
  where controls are not yet wired (Flight 6). Tickable only at leg 7's live render / the HAT.
- [ ] **Native anchor navigation works with no JS**: each nav link's `href` is the matching section `id`;
  activating a link (click or keyboard Enter) moves to that section. Links are natively focusable with a
  visible focus indicator.
- [ ] **No inline CSS/JS**: zero `<style>` blocks, zero inline `style=`, zero inline `<script>`, zero inline
  `on*=` handlers. All styling in `settings.css`; all scripting in the served `settings.js`.
- [ ] `settings.css` is **self-contained** (no `@import` of the chrome stylesheet), re-declares the brand
  tokens using the **authoritative chrome values** (`--accent: #f5c518`, `--accent-fg: #1e1f25`, bg
  `#1e1f25`, **`--fg: #e6e7ea`** — match `src/renderer/styles.css`, correcting leg-2's `#e8e8ec`), and
  implements the sticky-sidebar + scrolling layout in the brand palette.
- [ ] **`settings.js` ships** (decided — DD1's enhancement): it does scroll-spy `aria-current="true"` on the
  active section's nav link **only** (a pure progressive enhancement — the page is fully usable with JS
  disabled/blocked); referenced via `<script src="settings.js" defer>`; **and `/settings.js` is added to
  `INTERNAL_PAGES` in `main.js`** with its `path.join(__dirname, …)` absolute path. The
  `internal-assets` unit test **already** covers `/settings.js` (leg-2 synthetic map) — no new test code,
  just confirm the real map matches.
- [ ] **Accessibility (SC8)**: semantic landmarks (`<nav>` + `<main>` cover all content; `<h1>` inside
  `<main>`), correct heading order (`h1` → `h2`s, no skips), every interactive element reachable and
  labelled, text contrast ≥4.5:1. Intent: **no new** WCAG A/AA violations under
  `npm run a11y -- --target=goldfinch://settings` (the live guest audit runs in leg 7). The page must use
  the **`<body>` as the scroll container** (not an `overflow` on `<main>`) to avoid the
  `scrollable-region-focusable` rule; if a non-body element must scroll, it carries `tabindex="0"`.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (the `internal-assets` unit tests still pass; if
  `/settings.js` was added to the map, extend/confirm those tests cover it).

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Read `settings.html`: confirm `<nav>` + 5 anchor links, `<main>` + 5 `<section id=…><h2>`, ids match
  hrefs, no inline style/script/on* handlers, single `<h1>`.
- Read `settings.css`: confirm self-contained, brand tokens, sticky sidebar + scrolling layout.
- If `settings.js` shipped: confirm `/settings.js` is in `INTERNAL_PAGES` and the unit tests cover it.
- **Deferred to leg 7 (live):** open `goldfinch://settings`, confirm the shell renders styled, the sidenav
  and sections appear, keyboard Tab→Enter through the nav works, and
  `npm run a11y -- --target=goldfinch://settings` is clean vs the pinned `ACCEPTED` baseline. The DD2 CSP
  spike (css/js load with no `securitypolicyviolation`) is confirmed here too.

## Implementation Guidance

1. **Rewrite `settings.html` body** with this structure (semantic, no inline style/script):
   - `<nav aria-label="Settings sections">` containing `<ul role="list">` of five `<li><a
     href="#appearance">Appearance</a></li>` … links (the explicit `role="list"` defends against AT list-
     semantics stripping when `list-style:none` is applied).
   - `<main>` whose **first child is the single `<h1>Settings</h1>`** (keeps the heading inside a landmark
     so axe's `region` rule can't fire), followed by five `<section id="…"><h2>…</h2> …placeholder…
     </section>`. Ids: `appearance`, `privacy`, `startup`, `downloads`, `about` — one-to-one with the nav
     hrefs. (Do NOT use a separate non-landmark `<header>` — content outside `<nav>`/`<main>` trips
     `region`.)
   - Placeholder content per section: a short sentence describing what will live there (e.g. Privacy &
     Shields → "Shields toggles will appear here." — but DO NOT wire real controls; that's Flight 6).

2. **Enrich `settings.css`** (self-contained): correct the token block to the authoritative chrome values
   (esp. `--fg: #e6e7ea`); add the layout — e.g. a CSS grid/flex with a **sticky** left `<nav>`
   (`position: sticky; top: 0`); **let `<body>` (the viewport) be the scroll container** — do NOT put
   `overflow:auto` on `<main>` (that would make `<main>` a focusable-scroll-region axe finding). Style nav
   links (hover/`:focus-visible` ring), `:target` and/or `[aria-current]` section-link highlight, section
   spacing, `<h1>`/`<h2>` type scale. Put `scroll-margin-top` on sections so anchor jumps clear the sticky
   nav. Gate smooth scrolling behind reduced-motion: `@media (prefers-reduced-motion: no-preference) { html
   { scroll-behavior: smooth; } }`. Verify text contrast ≥4.5:1 — including muted/placeholder text (don't
   let it drop below `#9aa0ac`-ish on `#1e1f25`; check it).

3. **Ship `settings.js`** — scroll-spy only: an `IntersectionObserver` that sets `aria-current="true"` on
   the nav link of the section currently in view and removes it from the others. **No other behavior.**
   - Add `<script src="settings.js" defer>` to `settings.html`.
   - Add `'/settings.js': path.join(__dirname, '..', 'renderer', 'pages', 'settings.js')` to
     `INTERNAL_PAGES` in `main.js`. `contentTypeFor` already maps `.js → text/javascript`, and the
     `internal-assets` unit test already asserts `/settings.js` resolves (leg-2 synthetic map) — confirm,
     don't duplicate.
   - It must remain a **pure enhancement**: the page is fully navigable with JS disabled or CSP-blocked
     (native anchors carry navigation; scroll-spy is cosmetic).

4. **Accessibility pass**: one `<h1>`, `<h2>` per section (no level skips); `<nav>` has an `aria-label`;
   links have discernible text; focus-visible styling present; color contrast of text on the dark bg meets
   4.5:1 (the brand `--fg`/`--accent` on `#1e1f25` — verify the placeholder text color too).

## Edge Cases
- **`region` / `landmark-unique` axe rules**: all content must sit inside landmarks; don't leave bare text
  outside `<nav>`/`<main>`/`<header>`. Avoid two `<nav>`s without distinct labels.
- **Sticky sidebar + anchor jump**: a section scrolled to under a sticky header is an a11y/UX trap — use
  `scroll-margin-top` on sections.
- **No `'unsafe-inline'`**: a stray inline `style=` or `onclick=` will be CSP-blocked at runtime even though
  it passes lint — keep everything in the served files.
- **ids/hrefs drift**: a nav link whose `href` has no matching section id is a dead link — keep them
  one-to-one.
- **JS-disabled / CSP-blocked JS**: the shell must be fully navigable without `settings.js` (native anchors
  carry it); scroll-spy is cosmetic only.

## Files Affected
- `src/renderer/pages/settings.html` — enriched shell (nav + `<h1>` + 5 sections; `<script src="settings.js" defer>`).
- `src/renderer/pages/settings.css` — enriched Chrome-style layout (self-contained; `--fg` corrected to `#e6e7ea`).
- `src/renderer/pages/settings.js` (new) — scroll-spy `aria-current` only.
- `src/main/main.js` — add `/settings.js` to `INTERNAL_PAGES` (absolute path).
- `test/unit/internal-assets.test.js` — no change expected (already covers `/settings.js`); confirm green.
- **CSP fallback location (leg-7 contingency, not this leg)**: if the DD2 spike fails live, `INTERNAL_CSP`
  in `src/main/main.js` gets `style-src 'self'; script-src 'self'` appended (no `'unsafe-inline'`).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live a11y/render deferred to leg 7)
- [ ] Tests passing (offline gates + unit tests)
- [ ] Update flight-log.md with leg progress entry (note whether `settings.js` shipped, and if so that the
  map entry + unit test were added)
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
