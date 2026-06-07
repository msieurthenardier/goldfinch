# Leg: docs

**Status**: landed
**Flight**: [Settings Page Shell + Address-Bar Chips](../flight.md)

## Objective
Update `README.md` and `CLAUDE.md` to document what this flight added: the settings shell, the internal-page
**subresource-serving** model, the **address-bar chips + site-info popup**, and the **internal-tab
navigation lock** — referencing symbols/DD ids, **no line numbers**.

## Context
- This flight (legs 1–5) added, on top of Flight 4's `goldfinch://` scheme:
  - **Settings shell** (leg 3): `goldfinch://settings` is now a Chrome-style shell — sticky left
    section-nav + five titled sections (Appearance, Privacy & Shields, On startup / Home page, Downloads,
    About) with placeholder content; `settings.css` + `settings.js` (scroll-spy `aria-current`).
  - **Subresource serving** (leg 2): `handleInternal` serves a **per-host path allowlist** (`INTERNAL_PAGES`
    is now host → path → file) via the pure `src/main/internal-assets.js` resolver (`createResolver` +
    `contentTypeFor`), traversal-proof, content-type by extension, CSP unchanged.
  - **Address-bar chips** (leg 4): `#address-chip` in `#address-wrap` reflects the active tab — an
    internal-page identity chip on `goldfinch://`, a web-page site-info chip (connection + origin) on
    `http(s)`; the internal tab's address bar is **read-only**.
  - **Internal-tab navigation lock** (leg 4): a web URL entered in a `goldfinch://` tab opens a **new normal
    tab** instead of navigating the internal tab (the UX half of the Flight-4 Known Issue; the
    security-critical bridge origin-check stays Flight 6).
  - **Site-info popup** (leg 5): the web chip opens a `menuController`-registered popup (origin, connection,
    a `tab.privacy` summary, "Site settings →" into Shields); the internal chip shows a static secure-page
    note.
  - **menuController keyboard hoist** (leg 1): the APG keydown contract was hoisted into `menuController`.
- **Doc anchors that exist today** (locate by intent, the project owns the structure): `CLAUDE.md` has an
  Architecture/Patterns area including a "Two-point hostile-URL security boundary" and an "Internal
  `goldfinch://` pages — trusted-embedder security model" pattern; `README.md` has Features, Keyboard
  shortcuts, Architecture, and an "Internal pages (`goldfinch://`)" section. Update these in place / extend
  them; do not prescribe new heading names beyond what reads naturally.

## Inputs
- `README.md`, `CLAUDE.md` (current).
- The landed code from legs 1–5.

## Outputs
- `README.md` and `CLAUDE.md` updated to describe the settings shell, subresource serving, chips/popup, and
  the internal-tab lock — accurately and at the right altitude for each doc (README = user/contributor
  overview; CLAUDE.md = architecture/patterns for future agents).

## Acceptance Criteria
- [ ] `README.md` mentions the **settings area** (`goldfinch://settings`, reachable via the kebab → Settings)
  and its shell shape, the **address-bar chips** (internal identity chip / web site-info chip + popup), and
  the **internal-tab navigation lock**, integrated into the existing Features / Internal-pages sections.
- [ ] `CLAUDE.md` documents the **subresource-serving model** (`INTERNAL_PAGES` per-host path allowlist +
  `internal-assets.js` resolver, traversal-proof, CSP unchanged) extending its internal-pages pattern, and
  notes the **address-bar chip + lock** behavior and that the **security-critical internal-bridge
  origin-check remains a Flight-6 TODO** (so a future agent doesn't assume the internal tab is fully
  hardened).
- [ ] References use **symbols / DD ids**, **not line numbers** (per project convention).
- [ ] No source/behavior changes — docs only. `npm run lint` stays green (markdown/Prettier if configured).
- [ ] No operator identity / absolute home paths introduced (repo-relative paths only).

## Verification Steps
- `git diff` shows only `README.md` / `CLAUDE.md` changes.
- Read both: the four feature areas are described accurately and match the landed code (spot-check symbol
  names: `INTERNAL_PAGES`, `internal-assets.js`, `#address-chip`, `site-info-popup`, `navigate()` lock).
- `npm run lint` green.

## Implementation Guidance
1. **README** — in Features (or the internal-pages section), add the settings area + how to reach it (kebab
   → Settings), the chips + site-info popup, and the internal-tab lock. Keep it user-facing and brief.
2. **CLAUDE.md** — extend the internal-`goldfinch://`-pages pattern with the subresource-serving model
   (`INTERNAL_PAGES` host→path map, `internal-assets.js` `createResolver`/`contentTypeFor`, traversal-proof,
   `INTERNAL_CSP` unchanged). Add a short note on the address-bar chip + read-only internal bar + the
   navigation lock, and **explicitly flag the Flight-6 bridge origin-check as still-open** security work.
3. Reference symbols and DD ids; avoid line numbers (they drift).

## Edge Cases
- **Don't overstate security**: the internal-tab lock is UX-only; the bridge origin-check is Flight 6. Make
  that boundary explicit in CLAUDE.md so it isn't misread as "internal pages are fully isolated."
- **Keep README user-altitude**: implementation symbols belong in CLAUDE.md, not README.

## Files Affected
- `README.md` — settings area, chips/popup, internal-tab lock (user-facing).
- `CLAUDE.md` — subresource-serving model, chip/lock architecture, Flight-6 origin-check TODO.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified
- [ ] `npm run lint` green
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
