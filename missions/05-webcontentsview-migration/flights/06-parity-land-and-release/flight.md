# Flight: Parity Sweep, Mission Landing & v0.6.0 Release

**Status**: in-flight
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria
- [ ] **SC1** — Native guest surface: source-absence of the **functional** forms verified + the app launches
  and browses. (Precise pattern — DD10: absence of a constructed `<webview>` element, a `webviewTag:`
  webPreferences key, and a `will-attach-webview` registration in the tab/guest path. **Whitelisted legitimate
  residuals** that must NOT fail the check: the `src/preload/webview-preload.js` filename (load-bearing preload),
  the `#webviews` guest-region DOM slot id, and historical comments that state the machinery was removed.)
- [ ] **SC3** — Browser-behavior parity: the browsing / tab-strip / chrome-UI corpus passes on the native surface.
- [ ] **SC8** — Frameless window & controls parity, per platform: Linux/WSLg in-loop; **macOS by build-readiness
  + recorded decision** (no in-loop mac venue — DD2), per the mission's macOS constraint.
- [ ] **Mission landing** — `mission/05` merges to `main`; the migration ships as **v0.6.0** with all installers.

> **This is the mission-landing + release flight** (operator: "inclusive… cut a release and a minor version with
> all the installers"). It closes the remaining parity criteria, lands the mission to `main`, and cuts a real
> **v0.6.0** GitHub release with mac/win/linux installers. Large by design — see the sizing note in Legs.

---

## Pre-Flight

### Objective
Prove browser-behavior parity (SC3) on the native `WebContentsView` surface, fold the Flight-5 debrief
carry-forwards + the parked `<webview>` terminology sweep so the release ships clean, verify macOS
build-readiness, merge `mission/05` to `main`, and cut a real **v0.6.0** release (all installers) via the
tag-driven GitHub Actions path.

### Open Questions
- [x] **macOS depth?** → **Build-readiness only** (DD2). Resolved (operator).
- [x] **Release target?** → **Cut a real v0.6.0 release** (DD3). Resolved (operator).
- [x] **`<webview>` terminology sweep?** → **Land it in F6** (DD5). Resolved (operator).
- [x] **Is `main` cleanly mergeable from `mission/05`?** → **Yes** (planning-verified 2026-07-08): `main`
  (`18470bc`) is a clean ancestor of `mission/05`, no divergence, mission branch 53 commits ahead → clean merge.
- [ ] **Who pushes the `v0.6.0` tag?** The tag push triggers a public, hard-to-reverse publish — operator-gated
  (DD8). Confirm the operator authorizes/performs the tag push at the release leg.

### Design Decisions

**DD1 — Inclusive landing + release.** F6 = SC3 corpus + carry-forwards + `<webview>` sweep + macOS
build-readiness + merge-to-`main` + a real v0.6.0 release. Trade-off: a large flight; managed by clear
leg boundaries and a parity-before-merge-before-release ordering (DD8).

**DD2 — macOS = build-readiness only; runtime verification deferred.** No in-loop mac venue this mission. The
mac installer **builds** in GitHub Actions (`macos-latest`, unsigned — `identity:null`), which satisfies SC8's
mac arm as **build-readiness + recorded decision** (per the mission Constraint). The keyboard-bridge macOS HAT
(cross-view Tab + Ctrl+L, web & internal) and the WSLg-authoritative items (CDP-conflict, find new-search count,
focus-ring/squiggle) are **carried as post-release/contributor follow-ups — NOT F6 gates.**
- Rationale: matches the mission's explicit macOS apparatus decision; building ≠ runtime-verifying.
- Trade-off: mac-authoritative behavior remains cross-fingers-pending-venue (documented, not a blocking gate).

**DD3 — Release path: tag-driven GitHub Actions, publish to GitHub Releases.** `.github/workflows/build.yml`
triggers on `push: tags: v*` → `create-release` (draft + auto-notes, semver-validated) → matrix build
(macos-latest / ubuntu / windows) running `electron-builder --publish always` (uploads installers **directly**
to the Release; the artifact-storage path was retired after the v0.5.0/0.5.1 quota failures) → `publish-release`.
Auth is the repo default `GITHUB_TOKEN` — **no extra secrets**. The **tag is the version source-of-truth** (the
workflow syncs `package.json` from it). Concourse `build-linux`/`build-windows` are secondary/manual.

**DD4 — Version 0.5.7 → 0.6.0 (minor).** The WebContentsView migration is a substantial architectural change
(new guest-surface model, keyboard bridge, retired freeze-frame) → a **minor** bump, not a patch. Tag `v0.6.0`.

**DD5 — Land the `<webview>` terminology sweep** (~15 behavior specs' prose + `src/preload/webview-preload.js`
header + any residual source comments) so the 0.6.0 migration release ships without stale `<webview>` language.
Prose/comments only — **zero functional dependency** (recon: zero `sendToHost`; corpus drives by `wcId`).

**DD6 — Include the `nav.js` internal-guard hardening.** Add the op-local `isInternalContents` post-resolve
guard to **all four** `nav.js` ops (`navigate`/`goBack`/`goForward`/`reload`) to match how every sibling
(`zoom`/`find`/`print`/`observe`) guards *all* its ops — closes the pre-existing admin-navigate-internal
asymmetry before a public release. Safe: internal settings pages load via the main-process/chrome path, never via
the MCP `nav` op, so the guard only closes the bypass.
- **Test-coverage caveat (Architect [high]):** the *existing* `test/unit/automation-nav.test.js` internal-refusal
  cases pass `deps` **without** `allowInternal`, so they only exercise `resolveContents`'s pre-existing throw
  (`resolve.js:104`) — NOT the admin path that is the actual gap. New unit tests **MUST assert refusal with
  `allowInternal:true` explicitly**, or the leg can land "done" with the bug intact. This is an acceptance
  criterion for Leg 2, not a suggestion.

**DD7 — Build-readiness dry-run BEFORE the real tag.** Trigger `build.yml` via **`workflow_dispatch`**
(build-only, no publish) across all three platforms to confirm installers build cleanly — catching a broken
mac/win build without publishing anything. Only after a green dry-run + a green merge do we push `v0.6.0`.

**DD8 — Ordering: parity → merge → release; the tag push is operator-gated.** Parity (SC3 corpus +
carry-forwards + macOS build-readiness) is proven BEFORE merging `mission/05` → `main`; the release is cut FROM
`main`. Pushing `v0.6.0` is an **outward-facing, hard-to-reverse publish** — performed/authorized by the operator.

**DD9 — SC3 apparatus = the F5-proven model.** Admin-wired instance on `GOLDFINCH_MCP_PORT=8899` (49707 is
Hyper-V-reserved on this rig) + Executor→independent-Validator with raw-payload evidence. WSLg venue limits
(focus-ring pixels, etc.) → recorded, macOS-authoritative deferred. **Release-verification observability
(read path):** the GitHub Actions run status + `gh release view v0.6.0` asset list (mac dmg+zip, win nsis,
linux AppImage+deb) — the assertion that the release actually shipped its installers.

**DD10 — SC1 = absence of the FUNCTIONAL `<webview>` forms, not a naive token grep.** See the SC1 criterion
above: a naive "zero `webview` matches" would false-fail on the whitelisted residuals (`webview-preload.js`
filename, `#webviews` slot id, historical "removed" comments). SC1 checks for a constructed `<webview>` element /
`webviewTag:` webPreferences / `will-attach-webview` registration in the tab/guest path — none of which remain
(recon: `renderer.js:683` sets `webview:null` per tab; the only `will-attach-webview`/`webviewTag` mention is the
`renderer.js:956` comment stating they were removed).

**DD11 — Release side-effects the operator must expect (Architect-surfaced).**
- **Unsigned/un-notarized mac installer — RESOLVED (operator, 2026-07-08): ship unsigned + disclose.** No Apple
  Developer ID cert is available (self-signed/ad-hoc only, which gives **no** Gatekeeper-clearing benefit for
  downloads), so there is **no signing leg**. `identity:null` (`package.json`) + `CSC_IDENTITY_AUTO_DISCOVERY:false`
  (`build.yml`) → the published dmg/zip is Gatekeeper-quarantined; mac users must right-click-Open. The v0.6.0
  release notes **MUST disclose the unsigned status + the right-click-Open instructions** (Leg `version-and-notes`).
  Proper Developer-ID signing + notarization is a post-release follow-up once a cert exists.
- **The workflow commits back to `main`.** `build.yml`'s `update-readme` job runs `scripts/update-readme.mjs`
  then `git push origin HEAD:main` after a stable publish — so cutting v0.6.0 lands an **automated bot commit on
  `main`**. Expected, not a bad state; the `cut-release` leg calls it out so it isn't mistaken for drift.
- **`asar:false` + `files:["src/**/*"]`** ships the unbundled source tree in the installer — the
  `release-readiness` audit confirms this is deliberate (pre-existing), not a leftover.

### Prerequisites
- [ ] `main` is cleanly mergeable from `mission/05-webcontentsview-migration` (verified at planning — no conflicts).
- [ ] SC3 corpus apparatus: admin-wired instance on `8899` (F5 recipe, proven).
- [ ] `.github/workflows/build.yml` is functional; `GITHUB_TOKEN` is the repo default (no extra secrets needed).
- [ ] Tag-push authorization for `v0.6.0` (operator-gated — the public publish).
- [ ] `npm test` / `typecheck` / `lint` green at flight start (F5: 1060/1060).

### Pre-Flight Checklist
- [ ] All open questions resolved (merge-clean + tag-pusher confirmed at execution)
- [ ] Design decisions documented
- [ ] Prerequisites verified
- [ ] Validation approach defined (SC3 Witnessed corpus + release-artifact observability)
- [ ] Legs defined

---

## In-Flight

### Technical Approach
Prove parity, clean the surface, dry-run the build, land, then release — in that order (DD8).

1. **SC3 corpus** on the native surface (apparatus-gated) + the DD9 mint-gate OFF-branch positive-witness.
2. **Carry-forwards + `<webview>` sweep**: `nav.js` hardening (unit-tested), doc reconciliations, the
   terminology sweep, and the SC1 source-absence check.
3. **Release-readiness**: audit electron-builder + `build.yml`; run the `workflow_dispatch` build-only dry-run
   (all 3 platforms); local `electron-builder --dir` linux smoke; record the macOS build-readiness decision.
4. **Version + notes**: bump `0.6.0`; author the release notes (migration highlights + carried follow-ups).
5. **Merge** `mission/05` → `main` (parity proven).
6. **Cut v0.6.0**: tag on `main`, push (operator-gated) → Actions builds + publishes all installers; verify the
   run + `gh release view v0.6.0`.
7. **Release smoke / HAT** *(optional)*: launch the linux installer, browse (SC1 browse), confirm the release.

### Checkpoints
- [ ] SC3 corpus PASS on the native surface (+ DD9 OFF-branch witnessed)
- [ ] `nav.js` hardened + unit-tested; doc reconciliations done; `<webview>` sweep complete; SC1 source-absence green
- [ ] `workflow_dispatch` build-only dry-run green on all 3 platforms (incl. macOS build-readiness)
- [ ] `0.6.0` bump + release notes staged
- [ ] `mission/05` merged to `main` (clean); `main` builds/tests green
- [ ] `v0.6.0` tagged + pushed; Actions published the release; all 5 installers present on the GitHub Release
- [ ] `npm test` / `typecheck` / `lint` green throughout

### Adaptation Criteria
**Divert if**:
- The SC3 corpus surfaces a real (non-WSLg-venue) regression larger than an in-leg fix — fix-and-rerun, or log
  and split if structural.
- The `workflow_dispatch` dry-run fails a platform build — fix the build before merging/tagging (never tag a
  broken build).
- `main` has unexpected merge conflicts — resolve before proceeding.

**Acceptable variations**:
- WSLg venue limits on SC3 specs (focus-ring, etc.) → recorded/deferred, not failures.
- Release notes wording; which linux installer format is smoked.

### Legs
> **Note:** Tentative; planned one at a time. **Sizing:** this is a large landing+release flight (corpus +
> release engineering + CI) — likely > the 1–3-day norm; kept as one flight per operator intent, with strict
> parity-before-merge-before-release ordering.

- [x] `sc3-browsing-corpus` — 8 browsing/tab/chrome specs + DD9 OFF-branch. ✅ **SC3 PASS 8/8 + DD9 witnessed** (2026-07-08); no regressions; spec-drift → Leg 2, pre-existing tensions → debrief.
- [x] `carry-forwards-and-webview-sweep` — `nav.js` op-local internal guard on **all four** ops (navigate/goBack/goForward/reload) **+ unit tests that assert refusal with `allowInternal:true`** (the existing tests don't — DD6); doc reconciliations (page-context Escape target; `mcp-drive` Preconditions); the repo-wide `<webview>`→WebContentsView sweep (specs + `webview-preload.js` header + source comments); **SC1 source-absence** per the DD10 functional-form pattern + whitelist. test/typecheck/lint green. ✅ **landed** (2026-07-08): 5 new admin-path nav tests, 1065/1065; SC1 residuals = whitelist only.
- [x] `release-readiness` — config audit + local linux installer smoke. ✅ **landed** (2026-07-08): AppImage+deb build clean; asar:false deliberate; build.yml sound. The 3-platform CI dry-run runs post-merge-pre-tag (DD7 refinement).
- [x] `version-and-notes` — bumped `package.json` → 0.6.0 (== tag `v0.6.0`); authored `v0.6.0-release-notes.md` (migration highlights + unsigned-mac disclosure + follow-ups). ✅ **landed** (2026-07-08).
- [ ] `merge-to-main` — merge `mission/05` → `main` (parity proven; clean — planning-verified FF-able); confirm `main` builds/tests green. **Landing.**
- [ ] `cut-release` — tag `v0.6.0` on `main`, push (**operator-gated**); verify Actions builds + publishes all installers to the GitHub Release (`gh release view v0.6.0`). **Note (DD11): the `update-readme` job auto-commits back to `main` after a stable publish — expected, not drift.** **Outward-facing.**
- [ ] `release-smoke-and-hat` *(optional, **non-gating** — a green publish is NOT held hostage to a WSLg smoke)* — launch the published linux installer, browse (SC1 browse), confirm the release reads clean; guided HAT.

---

## Post-Flight

### Completion Checklist
- [ ] SC1/SC3 met; SC8 mac arm recorded as build-readiness; mission landing done
- [ ] `mission/05` merged to `main`; v0.6.0 released with all installers
- [ ] `npm test` / `typecheck` / `lint` green on `main`
- [ ] Carried follow-ups (macOS HAT, WSLg-authoritative items, nav.js if deferred) recorded for the mission debrief

### Verification
- **SC3**: the browsing/tab/chrome corpus PASS on the native surface (Witnessed).
- **SC1**: source-absence grep clean + the app browses.
- **SC8 (mac arm)**: the macOS installer builds in Actions (build-readiness); runtime deferred per DD2.
- **Release**: `gh release view v0.6.0` shows mac (dmg+zip), win (nsis), linux (AppImage+deb); the Actions run
  is green; `main` is at 0.6.0.
- **Mission landing**: this flight completing ⇒ `/mission-debrief` is the natural next step (assesses the
  overall WebContentsView-migration outcome and carries the deferred macOS/venue follow-ups).
