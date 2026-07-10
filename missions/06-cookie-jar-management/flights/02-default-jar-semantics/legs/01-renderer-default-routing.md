# Leg: renderer-default-routing

**Status**: completed
**Flight**: [Default-Jar Semantics](../flight.md)

## Objective

Retire the renderer's reserved-default assumptions: delete `DEFAULT_CONTAINER`, route
every partition-less tab (including the boot tab) through live `containers`/`defaultId`
state fed by a boot snapshot and the `jars-changed` broadcast, drop the literal-id dot
suppression, and consume the shared `BURNER` constant at both renderer duplication
sites. Implements flight DD1, DD2, DD3, DD6, DD8.

## Context

- **DD1**: `createTab(url, null)` resolves the container at call time — the flagged
  default jar, or a fresh `makeBurner()` tab when Burner holds the flag.
- **DD2**: renderer `containers`/`defaultId` is a declared cache of the jar store —
  source of truth jars.js; rebuild = boot snapshot + `jars-changed` invalidation
  events; every registry mutation path already broadcasts (all four mutating jar-ipc
  channels via `broadcastJarsChanged`, jar-ipc.js:50-53, and the picker's
  `new-container-create` in main.js — verified at flight design). On each event the
  renderer replaces state wholesale and re-renders open-tab jar dots.
- **DD3**: the boot tab gates on the jars snapshot; **reconciliation contract**:
  `jars-get-default` returns a structured-cloned container-or-BURNER object, so Burner
  detection MUST be by id (`d.id !== BURNER.id`), never reference identity (flight
  Architect review cycle 1, HIGH).
- **DD6**: dot suppressed only for the `internal` pseudo-jar.
- **DD8**: `BURNER` global loaded via script tag; `makeBurner()` and
  `buildContainerModel`'s sentinel derive name/color from it.
- Prior-leg learnings: none (first leg of flight). From F1: shared modules use the
  dual CJS/global export pattern (container-menu.js:45-49, burner.js:25-29); tests are
  Node-runner unit files under `test/unit/`.

## Inputs

- Flight 1 merged: v2 store, six jar IPC channels, preload wrappers `jarsList`,
  `jarsGetDefault` (chrome-preload.js:58), `onJarsChanged` (chrome-preload.js:61),
  `jars-changed` payload `{ containers, defaultId }` with `defaultId: null` ⇔ Burner
  (jar-ipc.js:52).
- `src/shared/burner.js` frozen `BURNER` with dual export (burner.js:21, :25-29).
- Clean working tree on branch `flight/02-default-jar-semantics` (flight artifacts +
  behavior spec untracked/committed-later is fine).

## Outputs

- `src/shared/default-routing.js` (new) — pure `resolveNewTabContainer` helper.
- `src/renderer/renderer.js` — no `DEFAULT_CONTAINER`; live jar state + listener;
  routing through the helper; dot policy; `makeBurner` consuming `BURNER`.
- `src/shared/container-menu.js` — sentinel consumes `BURNER`.
- `src/renderer/index.html` — script tags for `burner.js` and `default-routing.js`.
- `src/renderer/renderer-globals.d.ts` — `BURNER` / `resolveNewTabContainer` globals
  declared (typecheck).
- `src/shared/burner.js` — stale header NOTE (burner.js:17-19, "still duplicate…
  Flight 2/3 scope") updated to reflect consumption.
- `test/unit/default-routing.test.js` (new) + `test/unit/container-menu.test.js`
  updates. Full suite, typecheck, lint green.

## Acceptance Criteria

- [x] `grep -n "DEFAULT_CONTAINER" src/ -r` → 0 matches (code and comments).
- [x] `grep -rn "ff8c42" src/` → exactly 1 match: `src/shared/burner.js:21`.
- [x] `src/shared/default-routing.js` exists, dual-exported, and
      `resolveNewTabContainer` satisfies the truth table in `test/unit/default-routing.test.js`
      (see Implementation Guidance step 2 for the required rows).
- [x] `createTab` with a null container resolves: flagged default jar when
      `defaultId` matches a container; a fresh `makeBurner()` container when
      `defaultId` is `null` (Burner default), `undefined` (snapshot not yet arrived),
      or stale (no matching container).
- [x] Boot tab creation is gated on BOTH the home-page setting read and the jars boot
      snapshot; the snapshot normalizes `jarsGetDefault()` by id-comparison against
      the global `BURNER.id`.
- [x] Renderer subscribes to `onJarsChanged`; on each event it replaces
      `containers`/`defaultId` wholesale (empty array respected — no placeholder
      resurrection) and refreshes open tabs whose jar still exists: `tab.container`
      reference, dot background color, and dot title. Removed-jar tabs keep their
      last-known container (flight DD2 trade-off).
- [x] Tab dot renders for every jar except `internal` (the `'default'` clause at
      renderer.js:713 is gone); dot markup/title escaping unchanged.
- [x] `makeBurner()` and `buildContainerModel`'s burner sentinel derive name and color
      from `BURNER`; container-menu.js resolves `BURNER` hybrid-style (require under
      CJS, global in the renderer); index.html loads `burner.js` **before**
      `container-menu.js` and `default-routing.js` before `renderer.js`.
- [x] `npm test` green (count strictly > 1132), `npm run typecheck` green,
      `npm run lint` green.

## Verification Steps

- Run the two greps above; run `npm test`, `npm run typecheck`, `npm run lint`.
- `node -e "const {resolveNewTabContainer}=require('./src/shared/default-routing');console.log(resolveNewTabContainer([{id:'a'}],'a'), resolveNewTabContainer([],null), resolveNewTabContainer([{id:'a'}],'b'))"`
  → `{id:'a'} null null`.
- Manual code inspection for the listener re-render path (no unit seam — real-boot
  verification is Leg 3's and the HAT's job; the behavior test
  `new-tab-default-routing` pins routing end-to-end).

## Implementation Guidance

1. **Load `BURNER` in the chrome document** — add
   `<script src="../shared/burner.js"></script>` immediately BEFORE the
   container-menu.js tag (src/renderer/index.html:188) and
   `<script src="../shared/default-routing.js"></script>` after it (both before
   renderer.js at :190). Declare in renderer-globals.d.ts (pattern:
   `declare function buildContainerModel(...)` at renderer-globals.d.ts:323):
   `declare const BURNER: { id: string, name: string, color: string };` and the
   helper's signature.

2. **New `src/shared/default-routing.js`** — dual export like container-menu.js:45-49.
   ```js
   function resolveNewTabContainer(containers, defaultId) {
     if (defaultId == null) return null; // null = Burner holds the flag; undefined = snapshot pending — both mint a burner
     return (containers || []).find((c) => c && c.id === defaultId) || null;
   }
   ```
   Return contract: a container object, or `null` meaning "the caller mints a fresh
   burner". Truth-table tests (new file, existing unit-test conventions): match →
   container; `null` → `null`; `undefined` → `null`; stale id (no match) → `null`;
   empty/undefined containers array → `null`; never throws on malformed entries
   (`[null, {id:'a'}]`).
   Rationale for stale→burner: the store guarantees a resolvable `defaultId` at rest,
   so a miss is a transient broadcast-in-flight window or a snapshot failure; a burner
   tab is the privacy-conservative fallback (nothing lands in an unintended persistent
   jar, the tab evaporates). Put this rationale in the module header.

3. **Renderer jar state** (replaces renderer.js:106-114):
   ```js
   let containers = [];
   // undefined = boot snapshot not yet arrived; null = Burner holds the flag.
   let defaultId;
   function applyJarsState(list, dId) {
     containers = Array.isArray(list) ? list : [];
     defaultId = dId;
     refreshOpenTabJars();
     updateAutomationIndicator(lastSnap); // preserve the existing late-snapshot re-render (renderer.js:110-113)
   }
   const jarsBoot = Promise.all([
     window.goldfinch.jarsList(),
     window.goldfinch.jarsGetDefault()
   ]).then(([list, d]) => {
     applyJarsState(list, d && d.id !== BURNER.id ? d.id : null); // id-compare, NEVER reference (DD3)
   }).catch(() => { /* defaultId stays undefined → burner routing; Leg 3 real boots prove the happy path */ });
   window.goldfinch.onJarsChanged((p) => {
     if (p && Array.isArray(p.containers)) applyJarsState(p.containers, p.defaultId);
   });
   ```
   NOTE: `updateAutomationIndicator`/`lastSnap` are declared later in the file
   (renderer.js:1791) — the current code already calls it from this early `.then()`
   (safe: runs post-parse). Keep that shape.
   `refreshOpenTabJars()`: for each `tabs` entry, skip `trusted` tabs and tabs whose
   `container.burner` is truthy; find `fresh = containers.find(c => c.id === tab.container.id)`;
   if found, set `tab.container = fresh` and update the tab button's dot via
   `tab.btn.querySelector('.tab-jar')` (`tab.btn` stored at renderer.js:726; span
   emitted in the `btn.innerHTML` at :715-716) — set `style.background = fresh.color`,
   `title = fresh.name` (title composition matches
   the create-time markup at renderer.js:715 — plain `title` property assignment, so
   no HTML-escaping concern). If the span is absent (tab created while its jar was the
   suppressed legacy default — impossible after this leg, but tabs from before a
   hot-reload may lack it) skip silently.

4. **`createTab` routing** (renderer.js:675-677): replace
   `: container || DEFAULT_CONTAINER;` with
   `: container || resolveNewTabContainer(containers, defaultId) || makeBurner();`
   Update the DATA-LOSS-TRAP comment above it (renderer.js:670-674) — it names
   `DEFAULT_CONTAINER`; reword to describe the resolved-default/burner routing while
   preserving the trap explanation (jar object is single-source for partition +
   tab.container + dot).

5. **Dot policy** (renderer.js:712-713): condition becomes `jar.id === 'internal'`.
   Update the comment (renderer.js:710-711) — "Colored dot for every jar; the internal
   (Settings) pseudo-jar is chrome, not a user container — no dot."

6. **`makeBurner`** (renderer.js:490-492): derive from the global —
   `{ id: \`burner-${n}\`, name: BURNER.name, color: BURNER.color, partition: \`burner:${n}\`, burner: true }`.
   The `burner-<n>` id/partition scheme is identity-bearing — unchanged.

7. **`pJar` fallback** (renderer.js:2079): `(tab && tab.container) || DEFAULT_CONTAINER`
   → guard instead: when there is no active tab or container, still build and
   **return the section element** with a neutral "—" body. `pJar()`'s only call site
   is `body.appendChild(pJar())` (renderer.js:2123) — it MUST always return an
   `HTMLElement`; a bare `return;` would crash (design review, cycle 1 — MEDIUM).
   Every tab now always carries a real container, so this is a defensive path only;
   do not fabricate a jar.

7b. **Retire the picker's local push** (renderer.js:2644, design review cycle 1 —
   HIGH): `new-container-create`'s handler broadcasts `jars-changed` BEFORE its invoke
   reply resolves (main.js:1879-1886 → jar-ipc.js:50-53), so by the time
   `createContainerAndOpenTab`'s `await` returns, the listener has already replaced
   `containers` with an array that contains the new jar — the old `containers.push(c)`
   would append a duplicate, differently-referenced entry. Delete the push; keep using
   the returned `c` for the immediate `createTab(currentHomePage(), c)` (the next
   broadcast/`refreshOpenTabJars` reconciles `tab.container` by id). Update the
   comment at renderer.js:2641.

8. **Boot tab gating** (renderer.js:2649): replace the settings-only chain with
   ```js
   Promise.all([
     window.goldfinch.settingsGet('homePage').catch(() => null),
     jarsBoot
   ]).then(([url]) => createTab(url || HOMEPAGE));
   ```
   Preserves the current failure semantics (settings failure → HOMEPAGE) and adds the
   DD3 gate. `jarsBoot` already swallows its own failure (step 3), so the boot tab can
   never be blocked by a jars IPC error.

9. **container-menu.js sentinel** (container-menu.js:36): resolve `BURNER` at module
   top hybrid-style:
   ```js
   const { BURNER } = typeof module !== 'undefined' && module.exports
     ? require('./burner')
     : /** @type {{ BURNER: { id: string, name: string, color: string } }} */ (/** @type {any} */ (globalThis));
   ```
   then `model.push({ id: 'action:burner', label: \`${BURNER.name} tab (evaporates)\`, color: BURNER.color });`
   Keep the label's flattened-text convention comment. Update the file-header NOTE in
   burner.js (:17-19) — the duplication it flags is retired by this leg.

10. **Comment sweep** — update renderer.js:2441 (automation openTab comment "null
    container → createTab uses DEFAULT_CONTAINER (today's behavior)" → "null container
    → createTab resolves the current default jar (or a fresh burner when Burner holds
    the flag)"), `src/renderer/menu-overlay.js:157` (comment names the
    "`DEFAULT_CONTAINER` grey" — reword; comment-only, that document never loads
    container-menu/burner), and `src/preload/chrome-preload.js:60` ("Nothing
    subscribes until Flight 2." — now stale). Then re-run the grep AC to confirm 0
    matches.

11. **Tests** — new `test/unit/default-routing.test.js` (truth table, step 2);
    `test/unit/container-menu.test.js`: pin sentinel `color === require('../../src/shared/burner').BURNER.color`
    and label derives from `BURNER.name` (replace any literal `#ff8c42` expectation —
    the value is identical, so this is a source-of-truth pin, not a behavior change).
    Follow F1's staged-invariant naming if any existing assertion inverts (none
    expected this leg).

## Edge Cases

- **Empty registry at boot** (all jars deleted in a prior session): snapshot yields
  `[]` + Burner sentinel → `defaultId = null` → boot tab is a fresh burner. No
  placeholder resurrection (the old `if (list && list.length)` guard is gone).
- **Tab created in the pre-snapshot window** (ms-scale: user hits Ctrl+T before
  `jarsBoot` resolves): `defaultId === undefined` → burner tab. Deliberate
  privacy-conservative direction; document inline. The boot tab itself is gated and
  can't hit this.
- **`jars-changed` for a removed jar while its tab is open**: tab keeps the stale
  container object (live session on a wiped partition); no dot change. Flight 3/5 owns
  closing such tabs.
- **Stale `defaultId` in the broadcast-in-flight window**: helper returns `null` →
  burner tab (see step 2 rationale).
- **Burner-named user jar**: reserved-namespace remap (jars.js) guarantees no listed
  container ever has `id === 'burner'`/`burner-*`, so the id-comparison normalization
  and `refreshOpenTabJars`'s burner skip cannot misfire on user jars.
- **Malformed broadcast payload**: guarded (`Array.isArray(p.containers)`) — state
  untouched on garbage.

## Files Affected

- `src/renderer/renderer.js` — state block :106-114, createTab :663-716, pJar :2079,
  picker push :2641-2646, automation comment :2441, boot tab :2649, makeBurner
  :490-492, new `refreshOpenTabJars`
- `src/renderer/menu-overlay.js` — comment :157
- `src/preload/chrome-preload.js` — stale comment :60
- `src/shared/default-routing.js` — NEW
- `src/shared/container-menu.js` — BURNER hybrid resolution, sentinel :36
- `src/shared/burner.js` — header NOTE :17-19
- `src/renderer/index.html` — script block :185-190
- `src/renderer/renderer-globals.d.ts` — new global declarations
- `test/unit/default-routing.test.js` — NEW
- `test/unit/container-menu.test.js` — sentinel pins

---

## Citation Audit

All code citations verified against the working tree at flight-branch creation
(main `d1e6be0`, 2026-07-09, no intervening commits): renderer.js:106-114 (state +
placeholder guard), :361/:365 (picker dispatch), :490-492 (makeBurner), :663-716
(createTab incl. :677 fallback, :670-674 trap comment, :710-715 dot), :770
(zero-tabs guard — inherits routing automatically, no edit), :2079 (pJar), :2424-2452
(automation hook incl. :2441 comment), :2649 (boot tab); chrome-preload.js:53-61;
jar-ipc.js:50-53, :95; burner.js:17-29; container-menu.js:36, :45-49;
index.html:185-190; renderer-globals.d.ts:323 (declaration pattern). 0 drifted,
0 gone, 0 unverifiable.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (suite + typecheck + lint)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (deferred-review mode: `completed` happens at
      the flight-level commit)
- [x] Do NOT commit — the flight uses a single deferred review + commit
