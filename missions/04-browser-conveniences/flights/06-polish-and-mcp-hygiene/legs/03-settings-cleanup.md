# Leg: settings-cleanup

**Status**: completed
**Flight**: [Polish & MCP Hygiene](../flight.md)

## Objective

Remove the dead "Downloads" nav link + placeholder section from `goldfinch://settings` and fix the garbled
spellcheck-note copy — three single-purpose edits in `src/renderer/pages/settings.html`, with no JS/CSS
change and the scrollspy left intact.

## Context

- **DD3** (flight) — "Settings cleanup is deletion + a copy fix; keep the scrollspy consistent." Remove the
  `#downloads` nav link + `<section id="downloads">`; fix the `:63` note copy. No new behavior.
- **Rationale (DD1, Flight 5):** downloads now live at the internal `goldfinch://downloads` page (kebab item
  + `Ctrl+J`, landed in `../../05-downloads-surface/legs/03-downloads-entry.md`), not as a settings section.
  This placeholder is a stub from *before* that decision — operator-reported as dead.
- **Operator re-confirmed live** in the flight-log recon: `flight-log.md:28` (Downloads placeholder) and
  `flight-log.md:29` (spellcheck-note copy bug, found during recon) — both `confirmed-live` against current
  code.
- **Scrollspy is query-driven, not enumerated.** `settings.js:42` builds its section set from
  `document.querySelectorAll('main section[id]')` and `:43-44` builds its nav-link set from
  `nav[aria-label="Settings sections"] a[href^="#"]`; the `linkMap` (`:51-55`) maps each link's `href`
  fragment to the link. Removing one `<section>` + its `<li><a>` therefore drops cleanly out of both
  collections — nothing in JS or CSS names `#downloads` (verified by grep; see Acceptance Criteria).
- **The spellcheck-note element id is load-bearing.** `settings.js:245` does
  `document.getElementById('spellcheck-enabled')` for the checkbox; the **`#spellcheck-note` paragraph
  itself is NOT referenced by any JS selector** (grep returns nothing for `spellcheck-note` in
  settings.js/css). So this is a pure text-content edit — the `id="spellcheck-note"` attribute stays;
  only the visible copy changes.
- **Scope boundary:** HTML only. No edit to `settings.js`, `settings.css`, or any behavior-test spec in
  this leg. (One spec, `tests/behavior/settings-shell.md`, references the removed nav item — flagged for the
  `verify-and-behavior-tests` leg; see Edge Cases.)

## Inputs

What exists before this leg runs:
- `src/renderer/pages/settings.html:18` — `<li><a href="#downloads">Downloads</a></li>` (6th and last-but-one
  nav `<li>`, between `#startup` and `#about`).
- `src/renderer/pages/settings.html:126-128` — the placeholder section:
  ```html
  <section id="downloads">
    <h2>Downloads</h2>
    <p>Download location and options will appear here.</p>
  </section>
  ```
- `src/renderer/pages/settings.html:63` — the garbled note (exact current text):
  `<p id="spellcheck-note" class="muted">Enabling downloads a one-time dictionary from Google. Reload open tabs to enable.</p>`
- `src/renderer/pages/settings.js:42` — `Array.from(document.querySelectorAll('main section[id]'))` (scrollspy
  section set, dynamic).
- `src/renderer/pages/settings.js:43-44` — `document.querySelectorAll('nav[aria-label="Settings sections"] a[href^="#"]')`
  (nav-link set, dynamic) → `linkMap` at `:51-55`.
- `src/renderer/pages/settings.css` — styles the nav/sections generically (no `#downloads` selector; verified
  by grep).

## Outputs

What exists after this leg completes:
- `src/renderer/pages/settings.html` — the `#downloads` nav `<li>` removed; the `<section id="downloads">`
  removed; the `#spellcheck-note` paragraph's text corrected (id and classes unchanged). Net: −1 nav item,
  −1 section, 1 corrected sentence.
- No other files changed.

## Acceptance Criteria

- [x] **Nav link removed:** `settings.html` no longer contains `<a href="#downloads">`; the nav list has 5
  `<li>` items (Appearance, Privacy & Shields, Automation, On startup, About).
- [x] **Section removed:** `settings.html` no longer contains `<section id="downloads">` (or its `<h2>Downloads</h2>`
  / "Download location and options will appear here." copy). `<main>` has 5 `<section>`s.
- [x] **Copy fixed:** the `#spellcheck-note` paragraph reads exactly
  **"Enabling spellcheck downloads a one-time dictionary from Google. Reload open tabs to enable."** — the
  missing word **"spellcheck"** inserted after "Enabling". The element keeps `id="spellcheck-note"` and
  `class="muted"`.
- [x] **No dangling reference:** `grep -ni 'downloads' src/renderer/pages/settings.js src/renderer/pages/settings.css`
  returns nothing (it already does — this leg must not introduce one). `grep -ni 'href="#downloads"' src/renderer/pages/settings.html`
  returns nothing. (Verified: anchor/id grep returns no output; the sole remaining `downloads` hit in the HTML is the corrected note.)
- [x] **JS selector intact:** `grep -n 'spellcheck-note' src/renderer/pages/settings.js` returns nothing
  (the paragraph id is not a JS selector); `grep -n 'spellcheck-enabled' src/renderer/pages/settings.js`
  still finds the checkbox controller (`:245`, `:250`, `:255`) — i.e. the copy edit touched no selector.
  (Settings.js untouched by this leg — pure text-content edit.)
- [ ] **Scrollspy still tracks:** with the page loaded, scrolling through the 5 remaining sections sets
  `aria-current="true"` on the matching nav link and clears it from the others (no console error, no
  highlight stuck on a missing section). *(Deferred to HAT/verify leg — requires live GUI; scrollspy is
  query-driven so removal drops cleanly from both collections, per Context.)*
- [x] **Clean checks:** `npm test`, `npm run typecheck`, `npm run lint` all pass.

## Verification Steps

How to confirm each criterion is met:
- `grep -ni 'downloads' src/renderer/pages/settings.js src/renderer/pages/settings.css` → **no output**.
- `grep -ni 'downloads' src/renderer/pages/settings.html` → only the corrected note's "downloads"
  (the noun in "Enabling spellcheck downloads…"); **no `href="#downloads"`** and **no `id="downloads"`**.
- `grep -n 'spellcheck-note' src/renderer/pages/settings.js` → **no output**;
  `grep -n 'spellcheck-enabled' src/renderer/pages/settings.js` → still 3 hits (`:245`, `:250`, `:255`).
- `npm test` (`node --test test/unit/*.test.js`), `npm run typecheck`, `npm run lint` → all clean.
- **Manual / HAT** (`npm run dev`, open Settings via kebab): the section nav shows **no "Downloads" link**;
  there is **no Downloads section**; the spellcheck note under the Spellcheck toggle reads
  "Enabling spellcheck downloads a one-time dictionary from Google. Reload open tabs to enable."; scrolling
  highlights the correct nav link per section. *(This HAT confirmation belongs to the optional
  `hat-and-alignment` leg — the settings page is internal-session, so `npm run a11y` and live-page checks
  need a GUI+MCP run, per project conventions.)*

## Implementation Guidance

1. **Remove the nav link (`settings.html:18`).** Delete the line
   `<li><a href="#downloads">Downloads</a></li>` from the `<ul role="list">` under
   `<nav aria-label="Settings sections">`. The remaining order is: Appearance, Privacy & Shields, Automation,
   On startup, About.

2. **Remove the placeholder section (`settings.html:126-128`).** Delete the whole block:
   ```html
   <section id="downloads">
     <h2>Downloads</h2>
     <p>Download location and options will appear here.</p>
   </section>
   ```
   It sits between `<section id="startup">…</section>` and `<section id="about">…</section>`. Leave both
   neighbors intact.

3. **Fix the spellcheck-note copy (`settings.html:63`).** Change the paragraph's text from
   `Enabling downloads a one-time dictionary from Google. Reload open tabs to enable.`
   to
   `Enabling spellcheck downloads a one-time dictionary from Google. Reload open tabs to enable.`
   **Keep `id="spellcheck-note"` and `class="muted"` exactly** — only the text node changes. (The original
   dropped the word "spellcheck", leaving the misleading "Enabling downloads…".)

4. **Do not touch `settings.js` or `settings.css`.** The scrollspy is query-driven and self-adjusts; there
   is no `#downloads` reference to clean up in either file (confirm via the grep steps above). No CSS rule
   targets `#downloads`.

## Edge Cases

- **Scrollspy on a removed section:** none — `settings.js` rebuilds `sections` and `linkMap` from live DOM
  on load (`:42`, `:51-55`); a removed section simply isn't observed and a removed link isn't in the map.
  No `#downloads` key ever exists, so `setActive` (`:61-69`) never looks for it.
- **`grep 'downloads'` false positive in HTML after the fix:** the corrected note legitimately contains the
  *word* "downloads" ("Enabling spellcheck downloads…"). The dangling-reference check must look for the
  **anchor/id forms** (`href="#downloads"`, `id="downloads"`), not the bare word — see Verification Steps.
- **Behavior-test spec drift (do NOT fix here):** `tests/behavior/settings-shell.md:84` describes the nav as
  having the links "Appearance, Privacy & Shields, On startup / Home page, **Downloads**, About" and "**5**
  titled `<section>`s". That row is **already stale** (it omits Automation and miscounts — the live page has
  6 sections pre-cleanup, 5 post-cleanup), so removing Downloads will make it list a now-absent item. **Flag
  for the `verify-and-behavior-tests` leg** to reconcile the nav inventory + section count in that row;
  it is not in this leg's HTML-only scope. (Grep of `tests/behavior/*.md` shows `settings-shell.md` is the
  only spec that names the Downloads nav item/section.)

## Files Affected

- `src/renderer/pages/settings.html` — remove `#downloads` nav `<li>` (`:18`); remove `<section id="downloads">`
  (`:126-128`); fix `#spellcheck-note` copy (`:63`). **Only file changed.**
- *(Not edited: `settings.js`, `settings.css` — no `#downloads`/`spellcheck-note` references. `tests/behavior/settings-shell.md`
  needs a follow-up reconcile — owned by the `verify-and-behavior-tests` leg.)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [ ] Update flight-log.md with leg progress entry (note the `settings-shell.md` follow-up handed to the verify leg)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 3 of 6)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

All 9 code-location citations verified clean against current code at leg design time (read directly this
session; `settings.html`/`settings.js`/`settings.css` are unmodified on this branch vs `main`):
- `settings.html:18` — `<li><a href="#downloads">Downloads</a></li>` — OK.
- `settings.html:63` — `<p id="spellcheck-note" class="muted">Enabling downloads a one-time dictionary from Google. Reload open tabs to enable.</p>` — OK (exact current text confirmed via `sed -n 63p`).
- `settings.html:126-128` — `<section id="downloads"><h2>Downloads</h2><p>Download location and options will appear here.</p></section>` — OK.
- `settings.js:42` — `Array.from(document.querySelectorAll('main section[id]'))` — OK.
- `settings.js:43-44` — `document.querySelectorAll('nav[aria-label="Settings sections"] a[href^="#"]')` — OK.
- `settings.js:51-55` — `linkMap` (href-fragment → link) — OK.
- `settings.js:61-69` — `setActive(activeId)` — OK.
- `settings.js:245,250,255` — `#spellcheck-enabled` checkbox controller — OK.
- `settings.js:75` (flight DD3's cited IntersectionObserver line) — OK (the `new IntersectionObserver(...)` is at `:75`).

Grep verification (clean, no dangling refs): `downloads` → **0 hits** in `settings.js` and `settings.css`;
`spellcheck-note` → **0 hits** in `settings.js` and `settings.css`. Behavior-spec scan:
`tests/behavior/settings-shell.md:84` names the Downloads nav item/section (the only spec that does) — flagged
for the verify leg, not fixed here.
