# Flight Log: Harden the Hostile-Page Security Boundary

**Flight**: [Harden the Hostile-Page Security Boundary](flight.md)

## Summary
In flight (execution started 2026-06-05). Design complete and Architect-approved; reconnaissance confirmed all six findings live (F1 scope-expanded to two enforcement points).

---

## Flight Director Notes

- **Phase 1 setup** — Loaded crew (`leg-execution.md`, valid), mission, flight, behavior spec. Node v22 (supports `node --test`). Crew: Developer + Reviewer (both Sonnet); Accessibility Reviewer disabled (this flight touches security code, not UI — the renderer `createTab`/poster edits are non-visual). Will spawn the Accessibility Reviewer only if a leg turns out to touch user-facing UI.
- **Git decision** — Branched `flight/01-hostile-page-hardening` off `main` (global "branch first" rule). Baseline-committing the planning artifacts (maintenance report, full mission scaffold, behavior spec) + the mission→active / flight→in-flight transitions, so leg implementation accumulates on a clean tree. Per this skill, code review + commit are deferred to a single pass after the last autonomous leg.
- **Mission activated** — `01-maintenance` `planning → active`; flight `ready → in-flight`.
- **Leg order** — F1 first (`tab-scheme-guard`): highest priority and it bootstraps the `node --test` runner the later legs reuse. Then download-path-hardening, poster-css-sanitize, remove-open-external, containers-json-validation. All five are autonomous (no HAT leg).

---

## Reconnaissance Report

Source artifact: [maintenance/2026-06-05.md](../../../../maintenance/2026-06-05.md). Each cited finding walked against current `src/` (HEAD on `main` at design time).

| Item | Classification | Evidence (current code) | Recommendation |
|------|----------------|-------------------------|----------------|
| F1 — `open-tab` scheme bypass | **confirmed-live** | `main.js:58-61` `setWindowOpenHandler(({url})=>send('open-tab',url))` → `chrome-preload.js:36` `onOpenTab` → `renderer.js:1083` → `createTab` `renderer.js:106-111` `webview.setAttribute('src', url)`. No scheme guard at any hop. | Fix — **expanded scope, see note below**. |
| F3 — `open-external` unconstrained | **confirmed-live** | `main.js:156-158` `shell.openExternal(url)` (only `if(url)`); bridged `chrome-preload.js:13`. `grep openExternal src/renderer/renderer.js` → **no caller** (confirmed unused). | Fix — recommend **removing** the unused binding (handler + bridge line) rather than allowlisting a dead capability. |
| F4 — `saveDir` not containment-checked | **confirmed-live** | `main.js:72,77` stores renderer `saveDir`; `main.js:117-119` `item.setSavePath(uniquePath(meta.saveDir, suggested))`. Sole legit source is the native dialog `choose-download-dir` `main.js:101-107`. | Fix — defense-in-depth; bundle with F5 (same handler/`uniquePath`). |
| F5 — filename traversal residue | **confirmed-live** | `main.js:88-99` `uniquePath`: `replace(/[\/\\:*?"<>\|]/g,'_').slice(0,180)` — no `..`/leading-dot/reserved-name guard, no `path.resolve` containment. | Fix — bundle with F4. |
| F6 — `poster` CSS sink | **confirmed-live** | `renderer.js:355` `thumb.style.backgroundImage = \`url("${item.poster}")\`` — unescaped, unlike sibling sinks. | Fix as cited. |
| F7 — `containers.json` no shape validation | **confirmed-live** | `jars.js:21-30` `if (Array.isArray(saved) && saved.length) containers = saved;` — wholesale assign, no per-field validation. | Fix as cited. |

**No items retired** — all six are real work; line citations are accurate.

### Recon discovery — F1 scope expansion
`createTab(url)` (`renderer.js:106`) is the single choke point for **all** tab creation, called from 6 sites. Two pass *untrusted* URLs into the webview `src`:
1. `onOpenTab` (`renderer.js:1083`) — the page-supplied `window.open()` URL (the cited F1 path), and
2. **media-open** (`renderer.js:428`) `createTab(item.url)` — a **page-derived media URL** opened as a full tab. This is a *second* hostile-URL injection vector through the same sink that the source finding did not enumerate.

Implication: the scheme guard belongs in `createTab` (covers both vectors + any future caller), not only in `setWindowOpenHandler`. The address-bar path `toUrl` (`renderer.js:249-255`) is user-initiated and passes `scheme://` through verbatim — lower priority, but a shared helper can cover it too.

---

## Design Review (Phase 5b)

**Cycle 1 — Architect (Sonnet): approve with changes.** All six findings verified live; citations accurate. Issues incorporated into the spec:
- **[high] F1 in-page navigation gap** — gating `createTab` alone misses `window.location='file://'` self-navigation (no `will-navigate` listener exists). **Fix added:** main-process `will-navigate` guard on webview guests sharing the same `isSafeTabUrl`. Strengthened the dual-export DD (helper now used by main + renderer). Behavior spec gained an in-page-nav step.
- **[high] F4 approved-set restart concern** — investigated: renderer fetches `bulk.dir` fresh per bulk run (`renderer.js:569,586`), never persisted, so a **session-scoped** Set is sufficient and restart-safe. Documented in the F4 DD; no persistence added.
- **[med] F5 containment placement** — clarified: assert on the **final** resolved path after the dedup loop, not the pre-loop string.
- **[med] F6 CSS.escape insufficient** — corrected: scheme-allowlist is the **sole** gate; `CSS.escape`/`escapeHtml` explicitly rejected (wrong semantics for `url()` context).
- **[low] F7 data loss** — corrected: **per-entry** validation preserving valid user containers; DEFAULTS merged only as a floor.
- Suggestions folded in: create `src/shared/` dir; `blob:` trade-off confirmed lossless via `webview-preload.js:68`; engines ≥18 assumption noted (owned by Flight 2).

**Cycle 2 — Architect (Sonnet): APPROVE.** All five prior issues confirmed resolved against real code (`will-navigate` is preventable on the guest contents in hand at `main.js:58`; no fourth vector — Chromium blocks 3xx→`file:` redirects). One new low nit (behavior Step 5 lacked a positive anchor) — fixed inline. Flight is execution-ready.

---

## Leg Progress

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes
