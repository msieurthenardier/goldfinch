# Leg: readme-reframe

**Status**: completed
**Flight**: [External-consumer enablement + README reframe](../flight.md)

## Objective
Reframe `README.md`'s lead + Features so Goldfinch presents as a **privacy-first, operator-controllable,
AI-automatable** browser (the control / privacy / automatability triad) instead of a media-panel-only
browser, and surface the automation surface as a first-class capability with a pointer to the consumer
reference.

## Context
- **DD4** (flight): reframe the human-authored prose; **never** touch the auto-generated
  `<!-- DOWNLOADS:START -->`…`<!-- DOWNLOADS:END -->` block (owned by `scripts/update-readme.mjs`).
- **Architect L1**: the `### Development` block (`README.md:125-129`) already mentions
  `npm run dev:automation` and links `docs/mcp-automation.md` — do **not** duplicate it. The reframe is
  the top-of-README thesis (intro + Features), not the dev section.
- **Operator clarification**: keep the header logo (`README.md:2`); there are no screenshots to remove.
- The automatability pillar now genuinely exists (Flights 1–9: a gated, loopback-only, MCP-compatible
  automation surface) — so it's describable for the first time.

## Inputs
- `README.md` exists with: header logo (line 2), `# Goldfinch` H1 (line 5), media-panel-led intro
  **prose at lines 7–10**, a `## Download` section (heading line 12) wrapping the **auto-generated
  DOWNLOADS block at lines 14–28** (the `<!-- DOWNLOADS:START -->`…`<!-- DOWNLOADS:END -->` markers — the
  heading + blank line 12–13 are outside the block), a rich `## Features` list (lines 30–113), `## Run`
  + `### Development` (lines 115–129), and downstream sections.
- `docs/mcp-automation.md` exists as the consumer reference.
- The automation surface is **off-by-default via the Settings `automationEnabled` toggle**
  (human-only enablement), **key-gated** once enabled, **loopback-only**, MCP-compatible (per the
  mission and `docs/mcp-automation.md`).

## Designer decisions (from design review)
- **Keep the README high-level** on the surface: "off by default, operator-enabled via a Settings
  toggle" + a link to `docs/mcp-automation.md` for the how-to. Do **not** turn the README into an
  enablement tutorial.
- **The env-gated admin tier** is a power-user detail — keep it out of the README lead/Features (it's
  covered in depth in `docs/mcp-automation.md`); a generic "operator-controlled" framing suffices.
- **Do not reorder the `## Download` section** — section order stays frozen; the reframe is prose +
  one Features entry, not a restructure.
- **Leave the `### Development` block as-is** — its "dev-gated" wording is accurate for
  `npm run dev:automation` specifically and need not be reconciled with the new Features entry.

## Outputs
- `README.md` reframed: intro leads with the privacy / control / automatability framing; the media
  panel is presented as one notable feature, not the headline; a Features entry (or short subsection)
  describes the automation surface and links `docs/mcp-automation.md`.
- The DOWNLOADS auto-block, the header logo, and the `### Development` block are unchanged in substance
  (the Development block may stay exactly as-is).

## Acceptance Criteria
- [ ] The intro paragraph (currently lines 7–10) no longer frames the media panel as Goldfinch's
      defining characteristic; it leads with Goldfinch as a privacy-respecting, operator-controllable,
      AI-automatable Chromium browser.
- [ ] The automation surface is described as a first-class capability somewhere in the lead/Features:
      **off by default via the Settings `automationEnabled` toggle (operator-enabled)**, **key-gated**
      once on, **loopback-only**, **MCP-compatible** — accurate to the shipped surface — with a link to
      `docs/mcp-automation.md`. (The toggle is the primary user-facing affordance; "key-gated" alone
      would mislead a reader into thinking keys are the only step.)
- [ ] The media-panel description is **retained** (not deleted) — preserved as a feature, just no longer
      the headline.
- [ ] The `<!-- DOWNLOADS:START -->`…`<!-- DOWNLOADS:END -->` region is **byte-for-byte unchanged**.
- [ ] The header logo (`<img src="src/renderer/assets/goldfinch_color.png" …>`) is retained.
- [ ] No duplication of the `### Development` `dev:automation` pointer; if the lead/Features link to
      `docs/mcp-automation.md`, that's fine, but the dev-run instructions are not repeated.
- [ ] Existing factual claims about other features remain accurate (no invented capabilities).

## Verification Steps
- `git diff README.md` — confirm the DOWNLOADS block lines (14–28) are untouched; confirm line 2 logo
  intact.
- Read the reframed intro — confirms the triad framing and that the media panel is demoted to a feature.
- `grep -n 'mcp-automation.md' README.md` — confirms exactly the existing Development link plus at most
  one new lead/Features link, no duplicated run instructions.
- Confirm the automation description matches the shipped posture: off-by-default, key-gated, loopback-only
  (cross-check against `docs/mcp-automation.md` overview).

## Implementation Guidance
1. **Rewrite the intro (lines 7–10).** Lead with the browser's identity: a Chromium/Electron desktop
   browser built around **privacy** (Shields, farbling, container jars), **operator control**, and
   **AI-automatability** (a gated local automation surface). Mention the media panel as one of its
   standout features in a following clause/sentence — keep the existing media-panel language available
   for the Features list.
2. **Add an automation entry to Features (or a short subsection).** Describe the surface accurately:
   exposes drive/observe/eval tools over an **MCP-compatible loopback interface**, **off by default —
   enabled by the operator via the Settings `automationEnabled` toggle**, **key-gated** once enabled,
   **local-only** (binds `127.0.0.1`). Keep it high-level (per Designer decisions — no admin-tier
   detail, no enablement tutorial). Link `docs/mcp-automation.md` for the full consumer reference. Do
   **not** restate the `dev:automation` command (it lives in `### Development`).
3. **Leave the media-panel Features bullet (lines 100–113) intact** — it's accurate and stays.
4. **Do not touch** the DOWNLOADS block, the logo, or `scripts/update-readme.mjs`.

## Edge Cases
- **DOWNLOADS marker integrity**: a single stray edit inside the markers would be reverted on the next
  release and risks breaking the `update-readme.mjs` regex. Edit only outside the markers.
- **Overclaiming the surface**: do not describe capabilities the surface doesn't have (e.g. remote
  access, background driving) — it is foreground-to-act, loopback-only. Keep claims aligned with
  `docs/mcp-automation.md`.
- **Tone consistency**: match the existing README voice (concise, feature-bulleted), don't introduce a
  marketing register.
- **Development block is not a contradiction**: the `### Development` block's "dev-gated" wording
  describes `npm run dev:automation` (a dev force-bind) and is accurate — do not edit it to "reconcile"
  it with the production-posture Features entry. They describe different launch paths.
- **`grep -n 'mcp-automation.md' README.md` should return exactly two hits** after the leg (the existing
  Development link + the one new lead/Features link) — not more.

## Files Affected
- `README.md` — reframed intro + an automation-surface Features entry/subsection; everything else
  (logo, DOWNLOADS block, Development block, other Features, Run/Shortcuts/Architecture) preserved.

---
