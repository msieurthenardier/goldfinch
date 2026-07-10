# Mission: Cookie Jar Management

**Status**: active

## Outcome

The user governs their container identities from one dedicated page. They can see every
cookie jar at a glance, create new jars, rename and recolor existing ones, delete jars
they no longer want, choose which jar new browsing lands in, and clear a jar's stored
data — without touching config files or restarting the browser. A fresh install starts
with a sensible, minimal set of jars instead of today's arbitrary four.

## Context

Cookie jars already exist as a first-class concept in Goldfinch: each jar is an isolated
session partition (its own cookies, storage, cache) with its own fingerprint persona.
But the lifecycle surface is add-only — jars can be created from the tab-bar container
picker and never modified again. There is no way to rename, recolor, delete, or inspect
a jar, and the out-of-the-box set (Default, Personal, Work, Banking) was never
deliberately designed.

This mission is the deferred "jars-lifecycle" work referenced in the backlog. It adds a
third special page (alongside settings and downloads, which established the internal-page
pattern) and redesigns the default-jar model:

- **No reserved "Default" jar.** Any jar can be flagged as the default; the flag starts
  on Personal. Exactly one jar holds the flag at all times.
- **Burner is a static concept.** It always exists, cannot be renamed, recolored, or
  deleted, and keeps its evaporating (ephemeral, per-tab) semantics. If the last
  persistent jar is deleted, Burner becomes the default — new tabs are ephemeral until
  the user creates a persistent jar again.
- **Fresh installs get two persistent jars**: Personal (default) and Work. Both are
  ordinary jars — renameable, recolorable, deletable.
- **Existing installs keep their data.** The legacy Default jar (the current base
  partition) survives the upgrade as a normal jar — renameable and deletable like any
  other — so no logins or site data are lost.

**Sequencing decision**: Goldfinch has no browsing-history store yet (deferred to the
future SQLite-substrate mission). This mission proceeds first because history design
depends on settled jar lifecycle semantics (stable ids, delete-wipes-everything, the
default flag) — not the other way around. Per-jar data controls therefore cover what
exists today (cookies, site storage, cache, full identity wipe) and are designed as an
extensible list of clearable data classes so history clearing slots in later without a
layout rethink.

**Burner design stance**: Burner appears as a single, always-present entry in the jar
list (name, fixed color, no edit controls), but it is not a single session — every
burner tab continues to get its own fresh ephemeral partition, so burner tabs never
share state with each other. "Burner is the default" therefore means: new tabs with no
explicit jar open as fresh evaporating burner tabs. Burner's list entry is an identity
for management UI and the default flag, not a shared partition.

**Architect findings (viability check)**: the reserved-default assumption is duplicated
in four places today, not one — the jar store's validation floor, the main process's
hardcoded base-partition constant (pre-warmed at startup and used as the partition-less
fallback for the privacy cookie/storage handlers), the dev-automation auto-mint path
(which mints a jar key for the literal id `default` and would silently break on fresh
installs), and a renderer-side hardcoded first-tab container constant (a startup race
that is only benign today because the hardcoded value happens to equal the real
default). Each of these has an owning flight in the breakdown below. The automation
surface is otherwise well-decoupled — it resolves jar membership by live session
identity, not id string, and already degrades gracefully when a jar disappears.

## Success Criteria

- [ ] A dedicated jar-management page is reachable from the browser chrome alongside the
      existing special pages, listing every jar with its name, color indicator, and
      default marker. *(behavior-test-backed)*
- [ ] From that page, the user can create a jar with a chosen name and color, and the new
      jar is immediately usable for browsing from the container picker — no restart.
      *(behavior-test-backed)*
- [ ] The user can rename and recolor an existing jar; the change propagates to open tabs
      and the container picker without restart, and the jar's stored data (e.g. active
      logins) is preserved. *(behavior-test-backed)*
- [ ] The user can delete a jar after an explicit confirmation; its stored data is wiped,
      any open tabs in that jar close, and the jar disappears from all UI surfaces.
      *(behavior-test-backed)*
- [ ] Exactly one jar is the default at all times; new tabs open in the default jar; the
      user can move the default flag to any persistent jar from the management page.
      *(behavior-test-backed)*
- [ ] Burner always exists, exposes no rename/recolor/delete controls, and keeps its
      evaporating semantics; deleting the last persistent jar makes Burner the default,
      and creating a persistent jar again allows the flag to move back.
      *(behavior-test-backed)*
- [ ] Per-jar data controls let the user clear cookies, site storage, and cache
      independently, and perform a full identity wipe (data + fingerprint persona); the
      effect is observable (e.g. a logged-in site returns to logged-out).
      *(behavior-test-backed)*
- [ ] A fresh profile starts with exactly two persistent jars — Personal (default) and
      Work — plus the ever-present Burner.
- [ ] Upgrading an existing profile preserves all current browsing data; the legacy
      base-partition jar appears as a normal renameable, deletable jar.

## Stakeholders

- **Operator** — sole user and developer. Wants trustworthy identity separation with a
  management surface that matches how the rest of Goldfinch's special pages feel.
- **Automation surface (indirect)** — MCP tools and behavior tests address tabs and
  sessions; jar lifecycle changes must not break how automation resolves them.

## Constraints

- **Zero runtime dependencies** — the jar page and lifecycle machinery use only Electron
  and Node built-ins, consistent with project identity.
- **Injection-safe by construction** — jar names and colors are user-supplied data;
  rendering stays textContent-only and colors pass the shared safe-color validation, as
  the container picker and menu-overlay already enforce.
- **Special-page pattern** — the new page follows the established internal-page
  architecture (allowlisted assets, dedicated internal partition, no web content).
- **Burner invariants are non-negotiable** — always exists, never user-modifiable,
  ephemeral semantics unchanged, default-fallback behavior as described.
- **History clearing is out of scope** — arrives with the future history/SQLite mission;
  this mission only keeps the data-controls surface extensible for it.
- **Planning-hierarchy discipline** — existing behavior tests and the automation surface
  must keep passing; jar changes ship with migration, not breakage.

## Environment Requirements

- Local development toolchain (Node + npm, Electron dev run)
- GUI-capable environment for manual and behavior-test verification
- Behavior tests drive the real app through the registered automation apparatus

## Open Questions

- Entry points: which surfaces link to the jar page — a "Manage jars…" item in the
  container picker, a settings link, direct URL, all three?
- Color selection UX: fixed curated palette vs. free color input (both validated by the
  shared safe-color check).
- Does the default flag govern anything beyond new-tab placement (e.g. external link
  opens, session restore)?
- Should the container picker's existing "+ New container…" quick-create flow remain, be
  consolidated with the page's create flow, or link to the page?
- Renaming a jar: does the internal id/partition stay fixed forever (name is purely
  cosmetic), and is that surfaced anywhere?
- Fate of the main process's always-warmed base partition: after migration, does it
  remain a hidden internal fallback session for the partition-less privacy handlers, or
  collapse into "whichever jar is currently flagged default" (retired entirely once the
  legacy jar is deleted)? *(Architect question — owned by Flight 2 design)*
- Dev-automation auto-mint: when the resolved default jar is Burner (which the mint
  guard forbids as a target), should auto-mint skip, mint for the first persistent jar,
  or fail loudly? *(Architect question — owned by Flight 2 design)*
- Should "delete a jar while an automation key is scoped to it" be an explicit behavior
  test, given the automation layer documents graceful degradation but has never been
  tested end-to-end against real deletion? *(Architect suggestion — Flight 5 candidate)*

## Known Issues

- [x] A **fifth** reserved-default assumption exists beyond the Architect's original
      four: the renderer suppresses the jar color dot for `jar.id === 'default'`
      (renderer.js:713). Cosmetic-only — discovered during Flight 1 design review;
      fold into Flight 2's retirement sweep. *(Retired in Flight 2, DD6; operator
      kept always-dotted at HAT.)*
- [ ] `window.open`/`target=_blank` popups do NOT inherit the opener tab's jar —
      main's window-open handler forwards only the URL, so popups route to the
      default jar. Context-menu link-opens were fixed to inherit at Flight 2's HAT
      (operator ruling); the popup path needs opener plumbing (three-file change).
      Discovered in Flight 2 HAT, affects jar-confinement expectations — candidate
      for Flight 3 or 5.
- [ ] Guest-focus accelerator forwarding is incomplete beyond the fixed Ctrl+T:
      Ctrl+W and sibling chrome-class accelerators are still swallowed when a web
      page holds keyboard focus (same pre-existing `before-input-event` gap class).
      Discovered in Flight 2 HAT (D2 diagnosis), affects keyboard UX — candidate
      for a chrome-integration flight.
- [ ] Tabs whose jar is deleted stay open on the wiped partition and keep reporting
      the deleted jarId (documented Flight 2 DD2 trade-off; operator-observed at
      HAT). Flight 3's management-page delete must close open tabs in the jar
      (mission criterion 4).

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and
> created one at a time as work progresses. This list will evolve based on discoveries
> during implementation.

- [x] Flight 1: Jar lifecycle model — rename/recolor/delete/default-flag in the jar
      store and IPC surface, rewrite of the validation floor to the "exactly one
      default, Burner fallback" invariant, Burner's static list identity, legacy-Default
      migration (no UI yet)
- [x] Flight 2: Default-jar semantics — route new tabs through the default flag; retire
      all four reserved-base-partition assumptions (store floor, main-process base
      partition constant + privacy-handler fallbacks, dev auto-mint hardcode, renderer
      first-tab constant/race); Burner-as-default fallback behavior
- [ ] Flight 3: Jar management page — new special page with jar list, create, rename,
      recolor, delete, and set-default interactions
- [ ] Flight 4: Per-jar data controls — clear cookies / site storage / cache, full
      identity wipe integration, extensible clearable-data-class list
- [ ] Flight 5: Chrome integration — entry points, container-picker parity with the new
      lifecycle, fresh-install defaults verification, delete-with-open-tabs vs.
      zero-tabs-window invariant, cross-surface and automation-degradation behavior
      tests
