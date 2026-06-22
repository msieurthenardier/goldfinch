# Leg: app-icon

**Status**: completed
**Flight**: [Polish & MCP Hygiene](../flight.md)

## Objective

Make the committed-but-orphaned `goldfinch_new.png` art the actual app/window icon by replacing the
contents of the build-consumed `build/icon.png` (pure asset swap, zero code change), and clear the now-dead
`src/renderer/assets/goldfinch_new.png` so the wire-up leaves no new orphan.

## Context

- **Resolves the flight's "App-icon target" Open Question** (`flight.md:78`-`:87`). The operator answered
  the Flight-5 debrief question ("New app icon (will wire up)"), so the intended target is the **app/window
  icon** — option **(i)** in the Open Question — *not* the in-UI `#brand` image (option ii) and *not* both
  (option iii). The `#brand` image (`goldfinch_color.png`) is explicitly out of scope.
- **Closes the Flight-5 debrief action item** ("Wire up `goldfinch_new.png` as the app icon… investigate
  icon reference sites… or decide it's an asset-only addition. Currently committed but unreferenced",
  `flights/05-downloads-surface/flight-debrief.md` Action Items).
- **HAT/visual-only** (`flight.md:284`): no automated assertion is owed. No unit test asserts an icon; the
  icon is verified by eye in the optional `hat-and-alignment` leg and, authoritatively, in a packaged build.
- **Verified reference map** (grep over `src/`, `package.json`, `index.html`, CI configs; excludes
  `missions/` planning docs):
  | Asset | Referenced at | Status |
  |-------|---------------|--------|
  | `goldfinch_new.png` | **nowhere in source** (only planning docs) | orphan — this leg's input |
  | `goldfinch_color.png` | `src/renderer/index.html:58` (`#brand` img) | live — out of scope |
  | `goldfinch_mono.png` | **nowhere** | orphan — flagged below, out of scope |
  | `build/icon.png` | `src/main/main.js:257` (`BrowserWindow.icon`) + electron-builder `buildResources: "build"` (`package.json:34`) | live — the wire target |
- **The build already consumes `build/icon.png` on every platform.** electron-builder
  (`package.json:23`-`:65` `build`) sets `directories.buildResources: "build"` (`:34`) and pins no per-target
  icon path — so it auto-discovers `build/icon.png` and **auto-generates** the Windows `.ico` and macOS
  `.icns` from it (confirmed by `build/README.md:9`-`:13`). CI that exercises this: GitHub `build.yml:119`
  (`electron-builder --${platform} --publish`, all three platforms on a tag), GitHub `ci.yml:60`
  (`electron-builder --linux --dir`), and Concourse `ci/pipeline.yml:72`-`:73` (`package-linux`). **None pin
  an icon path** — all rely on the `build/icon.png` convention. Replacing the file's contents therefore
  re-icons the window (`main.js:257`) *and* every packaged installer with **no code or config change**.
- **Why the asset swap, not pointing `main.js` at `assets/`** (option b): option (b) would re-icon only the
  window and leave the packaged installers iconed off `build/icon.png` (a now-stale image), splitting the
  source of truth across two files. Option (a) keeps a single icon source. (Sequencing aside: leg 4
  touched `main.js` at `:18`/`:540`/`:981`, disjoint from `:257`, so option b would be conflict-free — but
  it is not chosen.)

## Inputs

What exists before this leg runs:
- `src/renderer/assets/goldfinch_new.png` — committed at `953bc83`, **761×761**, 8-bit RGBA PNG, 345 KB
  (verified via `file`). Referenced nowhere in source.
- `build/icon.png` — **1024×1024**, 8-bit colormap PNG, ~185 KB. The current app icon, consumed by
  `main.js:257` and electron-builder.
- `src/main/main.js:257` — `icon: path.join(__dirname, '..', '..', 'build', 'icon.png')` inside the
  `BrowserWindow` options (`main.js:250` `mainWindow = new BrowserWindow({`). **Unchanged by this leg.**
- `build/README.md` — documents the icon convention: `build/icon.png`, **"1024×1024 ideal (≥512×512
  required)"** (`:9`, `:13`); electron-builder auto-generates `.ico`/`.icns`.
- `package.json:23`-`:65` — the `build` block; `:34` `buildResources: "build"`; no per-target icon path.
- Legs 1-4 of this flight are landed (uncommitted). Tests at HEAD: 871 `test()` calls across
  `test/unit/*.test.js` (the flight prose cites ~950 including subtests; either way this leg adds none).

## Outputs

What exists after this leg completes:
- `build/icon.png` — **content replaced** with the `goldfinch_new.png` art (same filename/path, so all
  existing references keep working untouched). See the dimension decision in Implementation Guidance.
- `src/renderer/assets/goldfinch_new.png` — **removed** (its content now lives at the wired `build/icon.png`
  path; leaving the duplicate would create exactly the new-orphan the flight is trying to avoid).
- **No source-code changes.** `main.js`, `package.json`, `index.html`, CI configs untouched.
- `goldfinch_mono.png` — **left as-is** (flagged below; out of scope for this leg).

## Acceptance Criteria

- [x] **Icon in place:** `build/icon.png` is the `goldfinch_new.png` art (the bytes match the source the
  operator approved), at the wired path `main.js:257` + electron-builder already consume — so the window and
  packaged installers pick it up with no code change.
- [x] **Dimensions/format satisfy the constraint:** `build/icon.png` is a square PNG ≥512×512 (electron-
  builder's Linux/auto-`.ico`/auto-`.icns` floor per `build/README.md:9`). The new art is 761×761 — meets
  the **≥512 hard requirement** but is **below the documented 1024 ideal**; resolved as **option (a) accept
  761×761 as-is** per operator decision ("Ship 761 now"). A future 1024 master can replace it (follow-up
  noted in flight log).
- [x] **No new orphan:** `goldfinch_new.png` is no longer an unreferenced asset — its content is the wired
  `build/icon.png` and the stray `src/renderer/assets/goldfinch_new.png` copy is removed. `grep -rn
  goldfinch_new src/ package.json` returns nothing.
- [x] **No regressions:** `npm test` (950 tests pass), `npm run typecheck`, `npm run lint` stay green. (This leg
  changes only a binary asset + deletes an unreferenced one; it cannot affect them — confirmed.)
- [x] **`#brand` untouched:** `index.html:58` still references `goldfinch_color.png`; this leg does not
  touch the in-UI brand image.
- [ ] **App shows the new icon — HAT/deferred:** window-icon and packaged-installer-icon visual confirmation
  is deferred to the `hat-and-alignment` leg and/or a packaged build (see Edge Cases / HAT note). Not a
  blocking criterion for landing this source-wiring leg. **(Remains deferred.)**

## Verification Steps

- `file build/icon.png` — PNG, square, ≥512×512 (per the dimension decision: 761×761 or 1024×1024).
- Confirm the swap: the new `build/icon.png` content equals the approved art (e.g. `cmp` against the
  operator-provided master, or against the pre-removal `goldfinch_new.png` if the swap is a straight copy).
- `grep -rn "goldfinch_new" src/ package.json` — **no output** (orphan gone).
- `git status` — `build/icon.png` modified, `src/renderer/assets/goldfinch_new.png` deleted, nothing else.
- `npm test && npm run typecheck && npm run lint` — all clean (unchanged from pre-leg).
- **HAT (deferred to `hat-and-alignment` / packaged build):** launch `npm run dev` → the OS window/taskbar
  shows the new goldfinch icon. For the authoritative installer-icon check, a Concourse/GitHub packaged
  build is required (heavier; out of scope for this leg's acceptance — recorded as build-time HAT).

## Implementation Guidance

1. **Resolve the dimension question (DESIGN-REVIEW GATE — do this first).**
   The new art is **761×761**; the file it replaces is **1024×1024** and `build/README.md:9` calls 1024
   "ideal." A straight swap is a *resolution downgrade* (icons upscaled by the OS/electron-builder from 761
   to 1024 for the `.icns`/large `.ico` slots will look softer than the current icon). Pick one, surfacing
   the choice to the operator at design review:
   - **(a) Accept 761×761 as-is.** Simplest; meets the ≥512 hard floor; electron-builder will downscale
     cleanly to all needed sizes (16–512) and upscale only the 1024 `.icns` slot. Lowest effort; mild
     softness at the very largest size only.
   - **(b) Upscale the 761 art to 1024×1024** before writing `build/icon.png` (e.g. ImageMagick `convert
     goldfinch_new.png -resize 1024x1024 build/icon.png`). Restores the 1024 ideal but interpolates pixels
     the source doesn't have — no real detail gained, larger file. **Note:** ImageMagick `identify`/`convert`
     are **not installed** in this environment (verified) — this option needs a tool install or a Node/sharp
     step, raising effort.
   - **(c) Ask the operator for a 1024×1024 master** of the new art. Best fidelity; blocks on operator input.
   **Recommendation: (a)** — it's the minimal-blast-radius drop-in, satisfies the hard requirement, and the
   only cost is the largest icon slot. Note the 1024-vs-761 trade in the flight log so a future master can
   replace it. If the operator wants pixel-perfect parity with the old icon's resolution, escalate to (c).

2. **Swap the icon content** (after the dimension decision). For recommendation (a) it's a straight move:
   ```
   git mv src/renderer/assets/goldfinch_new.png build/icon.png
   ```
   `git mv` over the existing tracked `build/icon.png` overwrites its content and stages the rename in one
   step — replacing the icon *and* removing the orphan simultaneously, which is exactly the two-in-one this
   leg needs. (If option b/c produces a new 1024 file, write that to `build/icon.png` and `git rm` the
   stray `src/renderer/assets/goldfinch_new.png` separately.)

3. **Confirm zero source/config drift.** Do **not** edit `main.js:257`, `package.json`, `index.html`, or any
   CI file. The path `build/icon.png` is unchanged, so every existing reference resolves to the new art with
   no code change. Verify with `git status` (only the asset move/delete should appear).

4. **Run the green-check suite.** `npm test && npm run typecheck && npm run lint`. These must be unchanged
   from pre-leg state; if anything moves, the swap touched something it shouldn't have.

5. **Log the icon-source decision** in `flight-log.md`: which dimension option was taken (a/b/c), the
   761-vs-1024 trade, and that packaged-installer-icon verification is deferred to a build (HAT/build-time).

## Edge Cases

- **`goldfinch_new.png` does NOT meet the format/size requirement** — it **does** (761×761 ≥ 512, square,
  PNG). Documented here so the implementing agent re-confirms with `file build/icon.png` rather than assuming;
  if a different source art is substituted at design review, re-check ≥512 + square.
- **Resolution downgrade (761 < 1024 ideal):** handled by the Step-1 design-review gate. Not a hard
  failure — the ≥512 floor is met — but a quality choice the operator should sign off on.
- **`goldfinch_mono.png` is also orphaned** (referenced nowhere — confirmed by grep, same dead-asset status
  as `goldfinch_new.png` was). It is **out of scope** for this leg: this leg's job is wiring the new icon,
  not a broad dead-asset sweep, and removing an unrelated committed asset risks an unintended deletion the
  operator didn't sanction. **Flagged for the operator / the `hat-and-alignment` leg / a future maintenance
  pass** — do not delete it here unless the operator explicitly extends scope.
- **`#brand` image stays `goldfinch_color.png`:** the operator's answer was specifically the *app icon*, not
  the in-UI brand. Do not retire or repoint `goldfinch_color.png`.
- **Packaged-installer icon is heavier to verify** than the window icon: it needs a Concourse/GitHub packaged
  build to inspect the embedded `.ico`/`.icns`/AppImage icon. Scope this leg to the **source wiring + window
  icon**; record packaged-icon confirmation as **HAT/build-time** (carried to `hat-and-alignment` or a
  release build), not a blocking AC here.
- **`build/` is git-tracked** (`build/icon.png`, `build/README.md` are committed — verified via
  `git ls-files`), so the swapped icon will be committed with the flight; no gitignore concern. (The
  `goldfinch-*.png` gitignore entry, `.gitignore:9`, targets repo-root test screenshots, not `build/icon.png`
  or `src/renderer/assets/` — confirmed it does not match either path.)

## Files Affected

- `build/icon.png` — content replaced with the `goldfinch_new.png` art (path unchanged; all references keep
  working).
- `src/renderer/assets/goldfinch_new.png` — removed (content moved to the wired `build/icon.png`; no new
  orphan left behind).
- *(No source/config edits: `main.js:257`, `package.json`, `index.html`, CI configs all untouched.)*
- *(Out of scope, flagged only: `src/renderer/assets/goldfinch_mono.png` orphan — operator/future pass.)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`, `npm run typecheck`, `npm run lint` — unchanged from pre-leg)
- [ ] Update flight-log.md with leg progress entry (incl. the dimension decision a/b/c + deferred
  packaged-icon HAT note)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — `verify-and-behavior-tests` and the optional `hat-and-alignment` follow)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

All code/config citations verified against current code at leg design time (read/grepped this session):
`src/main/main.js:257` (`icon: path.join(__dirname, '..', '..', 'build', 'icon.png')`, inside the
`BrowserWindow` at `:250`); `src/renderer/index.html:58` (`#brand` → `assets/goldfinch_color.png`);
`package.json:34` (`buildResources: "build"`, within the `build` block `:23`-`:65`, no per-target icon
path); `build/README.md:9`/`:13` (1024 ideal / ≥512 required, auto-`.ico`/`.icns`); `.github/workflows/
build.yml:119` (`electron-builder --${platform} --publish`); `.github/workflows/ci.yml:60`
(`electron-builder --linux --dir`); `ci/pipeline.yml:72`-`:73` (`package-linux`); `.gitignore:9`
(`goldfinch-*.png`, does not match `build/icon.png` or `src/renderer/assets/`). Asset facts verified via
`file` + `git ls-files`: `goldfinch_new.png` 761×761 RGBA committed at `953bc83`, referenced nowhere in
source; `build/icon.png` 1024×1024 (tracked); `goldfinch_mono.png` 512×512 tracked but referenced nowhere
(orphan); `goldfinch_color.png` 512×512, referenced only at `index.html:58`. No drift found.
