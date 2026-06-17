# Flight Debrief: Bulk spec migration + ungated-path hardening (scoped)

**Date**: 2026-06-17
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](flight.md)
**Status**: landed
**Duration**: 2026-06-16 (planning sign-off) → 2026-06-17 (landed)
**Legs Completed**: 9 of 9

## Outcome Assessment

### Objectives Achieved
F7 delivered SC11 part 2 (scoped): the surface-compatible Group-B behavior specs were migrated off the ungated CDP-`:9222`/`cdp-driver.mjs` apparatus onto the gated admin/jar MCP surface, audit-log paging replaced the silent 50-cap, and the ungated `:9222` path was hardened (not removed). Concretely:
- **8 specs migrated** (legs 2–5): `unified-tab-controls`, `responsive-tab-strip`, `toolbar-pins`, `menu-dismissal`, `tab-scheme-guard`, `settings-controls`, `settings-automation` (dual-target), `core-browsing-shields` (admin). Grep-clean of `:9222`/`cdp-driver`/`dev:debug`/`remote-debugging`; genuine in-page-eval checkpoints (`settings-controls` 9/10, the `npm run a11y` steps, `farbling`, the `a11y-audit` rewrite) deferred to F8-eval and annotated in-spec by capability gate.
- **Audit-log paging** (leg 6): a pure, unit-tested `src/shared/audit-paging.js` state machine (freeze-on-page-2+) + renderer wiring; shipped with **standard numbered pagination** (`‹ 1 2 3 … ›`) after the HAT.
- **`:9222` hardened** (leg 7): `--remote-allow-origins` narrowed `*` → `http://127.0.0.1:9222`, probe-confirmed load-bearing (foreign Origin → 403) and non-breaking (no-Origin Node clients → 101); `.mcp.json` Playwright entry trimmed; `devtools-cdp-conflict` annotated.
- **Unplanned source capability** (leg 1): `pressKey` modifier chords (`Ctrl+M`/`Ctrl+Shift+P`) — added in-flight when the leg-2 design review found the surface couldn't express a keyboard-shortcut checkpoint.
- **Live verification** (legs 8–9): FD-driven MCP-surface verification (confound-free, `:9222` down) + a guided HAT that dogfooded the **real registered `mcp__goldfinch__*`** connection.

### Mission Criteria Advanced
- **SC11 (part 2, scoped)** — migrate-what-fits + harden. Full `:9222` retirement + the eval items remain F8-eval (as scoped). Net: the dogfooding surface is now the gated MCP path for the migrated subset, and the wide-open `*` Origin exposure is closed.

All seven In-Flight checkpoints met (chrome specs migrated; settings-automation dual-target; core-browsing-shields admin; audit paging; `:9222` hardened + deferred path unbroken; live pass; HAT). Gates green throughout: **709 pass / 0 fail**, typecheck + lint clean.

## What Went Well

- **Per-leg design review earned its keep.** It caught, *before* implementation, issues that would otherwise have been runtime failures: the modifier-chord gap (leg 2 → leg 1), the dogfooding-reflexivity in `settings-automation` (the harness's own admin session pollutes the indicator/log it observes), the property-vs-attribute trap (post-interaction `.checked`/`.value` aren't in `outerHTML` → read via `readAxTree` / the store), and the eval-vs-observable classification (`menu-dismissal` focus assertions migrate via `readAxTree`'s focused node, NOT eval). Several reviews corrected the *initial* design rather than rubber-stamping it.
- **The `:9222` hardening resolve-or-divert resolved to the best case.** The three-arm WS probe (no-Origin=101, foreign-Origin=403, loopback=101) settled the Architect's MED premise risk empirically and proved the narrowing is genuinely load-bearing, not cosmetic.
- **The HAT (DD6) caught two real defects** unit tests structurally could not: the audit-viewer serve bug (404) and the bespoke-pager UX rejection. F6's HAT caught SC10 gaps; F7's repeats the pattern — the HAT is where renderer-in-guest integration + UX fit get witnessed.
- **Dogfooding the real MCP** (operator directive) validated the surface as an external consumer uses it — `openTab`/`readDom`/`readAxTree` work on a jar key; `getChromeTarget` correctly refused (`admin-only`). Stronger than the FD's side-channel client.
- **The `src/shared/` dual-export idiom scaled cleanly** to a second module (`audit-paging.js`), keeping the freshness state machine pure + unit-tested (38 cases) while the renderer wiring stayed thin.
- **Batched-review execution model** (design-review per leg, one code review + commit at the end) kept the flight moving; the intermediate commit banked legs 1–7 behind a passing review before the live pass.

## What Could Be Improved

### Process
- **The leg-6 serve bug had no owning AC.** `audit-paging.js` was loaded by `settings.html` but never registered in `INTERNAL_PAGES`, so the `goldfinch://` scheme 404'd it → the viewer rendered nothing. Leg 6 was correctly scoped renderer-only (AC5 carved out `src/main/**`), which left the html-`<script>` ↔ `INTERNAL_PAGES` registration as nobody's acceptance criterion. **Lesson:** any leg that adds a `<script src>` to an internal page must carry an explicit "register it in `INTERNAL_PAGES` + a resolver test" AC.
- **The modifier-chord gap was discoverable pre-flight.** It surfaced at the leg-2 design review, but it was visible from `mcp-tools.js:PRESS_KEY_NAMES` vs. the spec step tables without running anything. A **pre-flight surface-capability sweep** ("can `pressKey`/the tools express every input these specs require?") would have caught it during planning, avoiding the in-flight 8→9 leg growth.
- **The pager UX over-specified the presentation layer.** DD4 invented a bespoke "Newer/Older/Paused — N newer · back to live/Showing X–Y of N" affordance; the operator replaced it with conventional numbered pagination at the HAT. The freshness *contract* was sound; the UX *expression* should have defaulted to a conventional pattern. **Lesson:** for operator-facing UI, default to conventional patterns unless there's a specific reason to deviate.

### Technical
- **`settings.js` is growing large** — it now hosts home-page, shields, appearance-pins, automation-enable/port/keys, and the pager IIFEs, with no unit coverage (renderer-only by design). A future split into per-controller `settings-*.js` files (each `INTERNAL_PAGES`-registered) would narrow future legs.
- **Two new `scrollable-region-focusable` a11y violations** (`.ps-list` in the privacy panel + lightbox) surfaced during the leg-7 `npm run a11y` run — real accessibility debt, currently carried (ACCEPTED/known), needing triage rather than indefinite carry.
- **`devtools-cdp-conflict` has been `BLOCKED-AS-WRITTEN` since F3** — now clearly annotated (gated on a missing non-CDP DevTools-open affordance), but the block is aging; F8-eval should give it an unblock plan or retire it.
- **Renderer-in-guest integration remains untestable by unit tests** — the serve-seam (and the pager DOM wiring) can only be verified live. The post-HAT `internal-assets.test.js` case pins the *specific* entry; a systematic guard would read `settings.html`'s `<script src>` paths and assert each resolves via `INTERNAL_PAGES`.

### Documentation
- **CLAUDE.md's automation-security section describes the flag-gated model** ("gated on `--automation-dev` … stopgap"). F8's toggle-binds re-architecture will require rewriting it, not just appending.
- The `INTERNAL_PAGES` declaration should carry a comment noting the dual-registration requirement (html `<script>` + map entry) to prevent recurrence of the serve bug.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Added leg 1 `presskey-modifier-chords` (8→9 legs) in-flight | leg-2 design review found `pressKey` can't send chords; operator chose to add the capability vs. defer/hybrid | **No** (the in-flight add). **Yes** — adopt a pre-flight *surface-capability sweep* so such gaps surface in planning. |
| DD4 bespoke pager UX → standard numbered pagination | operator UX directive at the HAT | **Yes** — default operator-facing UI to conventional patterns. |
| Audit-paging serve path (`INTERNAL_PAGES`) was a missed dependency, fixed at HAT | renderer-only leg scope left the registration unowned | **Yes** — `INTERNAL_PAGES` entry + resolver test as a required AC for new internal-page subresources. |
| `:9222` narrowing landed (vs. the named divert) | empirical probe confirmed both arms (load-bearing + non-breaking) | n/a — resolve-or-divert worked as designed. |
| Whole F8 scope (toggle-binds gating, dev-profile isolation, port free-fallback) surfaced at the HAT | the dev-vs-installed coexistence + production-opt-in model was never fully designed | **No** (it's the HAT doing its job). Carried to a dedicated F8 with its own design pass. |

## Key Learnings

1. **The per-leg design-review loop is the flight's highest-leverage quality gate** — it caught capability gaps, reflexivity, and apparatus-classification errors that unit tests and the batched code review would have missed entirely (they'd have surfaced as leg-8 live failures or worse).
2. **The HAT catches the seams unit tests can't reach** — renderer-in-guest serving + UX fit. Treat DD6's guided HAT as a *default* for any renderer-side interactive feature, not an optional checkbox.
3. **The automation surface's instance + gating model was designed for a single-instance dev harness**, not production opt-in or dev/installed coexistence. The HAT made this concrete (shared-`~/.config/goldfinch` pollution; port collision; flag-vs-toggle binding). This is the load-bearing rationale for F8.
4. **Dogfooding the real consumer path > a bespoke driver** for final verification — it exercises auth, scoping, and transport exactly as a real client does.
5. **Test-suite health is good** — 709 pass (+59 vs F6's 650), wall-clock ~774ms (flat/faster despite more tests, since the new cases are synchronous pure-logic). No new suites, no flakes, no skips.
6. **Environment note (not a flight issue):** a safety-classifier (`opus-4-8[1m]`) outage interrupted the session mid-HAT, blocking Write/Bash for a stretch; work resumed cleanly. Recorded for context, not as a methodology finding.

## Recommendations

1. **Adopt an `INTERNAL_PAGES` cross-reference guard** — add a unit test that extracts `<script src>`/`<link href>` paths from `settings.html` (and future internal-page HTML) and asserts each resolves via the live `INTERNAL_PAGES` map (`internal-assets.js` is Electron-free, so this is feasible), plus a comment at the `INTERNAL_PAGES` declaration. Make "register new internal-page subresources" a standard leg AC.
2. **Add a pre-flight surface-capability sweep** for spec-migration flights — verify every input/observation the target specs require is expressible through the current tools *before* execution (the chord gap was discoverable from `mcp-tools.js` alone).
3. **Default operator-facing UI legs to conventional patterns** — reserve bespoke affordances for cases with a specific justification (the pager lesson).
4. **Sequence F8's dev-profile isolation FIRST (or with) the toggle-binds change** — under toggle-binds, a dev run that leaves `automationEnabled=true` in a shared profile would auto-bind the surface on the next launch; isolation is a *prerequisite*, not a follow-on. Rewrite CLAUDE.md's automation-security section as part of F8.
5. **Triage the two `.ps-list` a11y violations** — `tabindex="0"` on the scroll containers or an explicit ACCEPTED decision; bundle into F8 if it touches those UI areas, else a small a11y maintenance leg.

## Action Items
- [ ] **Plan F8** via `/flight`: production gating re-architecture (toggle-binds the surface; `GOLDFINCH_AUTOMATION_ADMIN` usable on the production binary; `--automation-dev` demoted to dev convenience) + dev-profile isolation + launch-time MCP port free-fallback (env-strict / else free-port). It moves the security boundary → needs an Architect design pass. (Recorded in mission Known Issues.)
- [ ] **Operator: reset the polluted production profile** — Settings → Automation → toggle off + Revoke the dev-minted keys in `~/.config/goldfinch` (flipped/left by the FD's pre-isolation dev runs).
- [ ] **Restore / reconcile `~/.claude.json`** — its goldfinch MCP Bearer was repointed to a dev jar key on `:7799` (now down); backup at `~/.claude.json.bak-gf`.
- [ ] **Add the `INTERNAL_PAGES` cross-reference test + AC pattern** (recommendation 1).
- [ ] **Triage the two `scrollable-region-focusable` a11y violations** (recommendation 5).
- [ ] **Behavior-test candidate (F8):** a `/behavior-test` spec for "settings Activity viewer renders + pages" would guard the renderer-in-guest serve/render seam that unit tests can't reach — best authored once F8's gating/instance model makes it cleanly launchable.

## Skill Effectiveness Notes
- **Mission/Flight/Leg hierarchy held.** The in-flight leg addition (leg 1) and the scope discovery (F8) were absorbed cleanly via flight-log Decisions + leg renumbering, without rewriting upstream artifacts — the methodology's "preserve framing, record the pivot" guidance worked.
- **Flight skill:** the resolve-or-divert leg structure (leg 7) and the deferred-item-by-capability-gate annotations were effective patterns worth reusing. The one gap: design decisions can over-specify presentation (DD4 pager) — flight design should stay at the contract level for UI and let the HAT settle UX.
- **Leg skill:** acceptance criteria were largely mechanically verifiable (grep patterns, gate pass/fail). The blind spot was cross-process integration ACs (the `INTERNAL_PAGES` seam) — leg ACs should explicitly cover renderer↔main integration points a leg's own scope touches.
