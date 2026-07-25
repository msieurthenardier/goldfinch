# Flight: Renderer OS Sandbox

**Status**: landed

> Architect design review: **approve with changes** (2026-07-25) — incorporated: `beforeBuild`→`beforePack` (return-value footgun), criterion wording tightened to "web-guest", CLAUDE.md:29 "opposite" revision flagged, `getOSProcessId`+`/proc` seccomp diff adopted as the sandbox-active check. **Design review empirically verified the OS sandbox engages on this WSL2 kernel** — the flight's central risk is retired. Autonomous phase-gate progression pre-authorized (issue #131 directive).
**Mission**: [Web-Content Security Hardening](../../mission.md)

## Contributing to Criteria

- [x] A compromised web-guest renderer is contained by the OS sandbox: every **web-guest** content view constructs with the sandbox enabled, and a unit pin prevents regression. *(finding 1. The trusted chrome view is a deliberate, tracked exception per DD4 — not a web-content surface; the two overlay preloads flip too.)*
- [x] The three preload-delivered capabilities — fingerprint farbling, media-panel scanning, and vault fill/capture — all work in the live app after sandboxing, verified against a real page. *(behavior-test-backed)*
- [x] The security posture record (CLAUDE.md architecture notes) reflects the new invariants: sandbox ruling documented next to the existing `contextIsolation` note; no stale claims remain. *(partially — the sandbox half)*

---

## Pre-Flight

### Objective

Flip the web-guest `WebContentsView` from `sandbox: false` to `sandbox: true` so a V8/Blink RCE on a hostile page stays inside Chromium's OS sandbox (seccomp-bpf / namespaces / job objects) instead of executing with full user-account privileges. The single mechanical blocker is that `webview-preload.js` uses two relative `require()`s (`./vault-fill-fields`, `./vault-fill-icon`) that a sandboxed preload's restricted loader cannot resolve — so the flight first introduces a preload **bundling** step (the repo's first build-time transform), verifies the bundled preload behaves identically, then flips the sandbox and re-verifies the three preload-delivered capabilities (farbling, media scan, vault fill/capture) live. `contextIsolation: false` stays (load-bearing for farbling in the page main world); the sandbox restricts the preload's Node surface, not world isolation — the guest↔preload trust boundary is unchanged.

### Open Questions

- [x] Can a sandboxed preload with `contextIsolation:false` still run in the page main world and use `ipcRenderer`? → Yes. `internal-preload.js` already runs `sandbox:true` in production (existence proof); `sandbox:true` + `contextIsolation:false` is a supported Electron combination — the sandbox restricts the Node API surface, not context isolation. `webview-preload` requires only `ipcRenderer` from `electron` (the one bare specifier sandboxed preloads keep) plus DOM/web-platform globals; recon confirmed **zero** `fs`/`path`/`os`/`process`/`Buffer`/`__dirname` usage across the whole 3-file graph.
- [x] What exactly blocks the flip? → Only the two relative `require()`s at `webview-preload.js:11-12`. Both leaves are pure (no requires, no cycles, no npm/`src/shared` deps).
- [x] Highest-risk runtime behavior under sandbox? → The two synchronous `ipcRenderer.sendSync` round-trips at preload-init (`vault-eligible` at `webview-preload.js:219`, `shields-farble` at `:373`) must still return synchronously from a sandboxed renderer, and typed-array (`Uint8Array`) transfer on `guest-vault-capture`/`vault-fill` must survive the sandboxed IPC boundary. All covered by the leg-2 live verification.
- [x] Chrome view too? → Resolved by DD4: no (this flight). Two overlay preloads flip for free; chrome-preload bundling + chrome-view main flip deferred with rationale.

### Design Decisions

**DD1 — Bundle via esbuild (devDependency), generated artifact is NOT committed**
- Add `esbuild` as a **devDependency** (mission constraint explicitly permits a bundler as a devDep; the shipped app keeps `@modelcontextprotocol/sdk` as its sole runtime dependency). A hand-rolled inliner was considered — the graph is trivial enough — but esbuild is the robust, standard choice that survives future graph growth, and it's dev-only so the zero-runtime-dependency identity is intact.
- `npm run build:preload` bundles `src/preload/webview-preload.js` → `src/preload/webview-preload.bundle.js` (CJS, `platform=node`, `external:electron`, no minify — readable output, sourcemap not needed on disk).
- **The bundle is gitignored, not committed** (house preference against committed generated artifacts; also structurally prevents source↔bundle drift). It is regenerated at every entry point that launches or tests the app — see DD2. Drift is impossible because the artifact is always fresh.
- The two leaf sources (`vault-fill-fields.js`, `vault-fill-icon.js`) **stay in place** as requirable CJS modules — three test files require them directly (`test/unit/vault-fill-fields.test.js:12`, `test/unit/vault-fill-icon.test.js:26-27`). Bundle emits an *additional* artifact; it never inlines-and-deletes the leaves.

**DD2 — Regenerate at every entry; the bundle is invisible to all quality tooling**
- The bundle is a pure build artifact. It is excluded from **eslint** (add to `eslint.config.mjs` ignores), **prettier** (`.prettierignore`), **tsc** (`jsconfig.json` exclude), and **git** (`.gitignore`) — so no quality tool ever lints/formats/typechecks/commits it, whether present or not.
- `build:preload` is wired into every path that runs the app so a bare checkout is never stale: npm `prestart` + `pretest` hooks, `scripts/dev-launch.mjs` (the canonical dev entry — regenerate before `spawn(electron)`), and an electron-builder **`beforePack`** hook (a small JS file, referenced by string path from the inline `package.json` build block) so `pack`/`dist` and the CI package/build tasks (`ci/tasks/package-linux.yml`, `build-linux.yml`, `build-windows.yml` — all invoke `electron-builder` directly) regenerate too.
  - **`beforePack`, not `beforeBuild` (design-review correction)**: `beforeBuild`'s return value gates whether electron-builder runs its own dependency rebuild — a hook that runs esbuild and doesn't `return true` silently disables that rebuild (harmless now, a latent trap if a native dep — e.g. keytar-style vault storage — ever lands). `beforePack` is unconditional (`void` return, no such semantics) and fires before app-file copy, so ordering is correct. Also note `jsconfig.json` has **no `exclude` key today** — leg 1 adds one, doesn't edit an existing one.
- Verification that the wiring is complete is a leg-1 acceptance criterion (each entry point produces the bundle before it needs it).

**DD3 — `main.js` points the web preload at the bundle**
- `src/main/main.js:1276` `webPreloadPath` changes from `webview-preload.js` to `webview-preload.bundle.js`. The trusted branch (`internal-preload.js`) is untouched. The `register-tab-ipc.test.js` harness supplies its own fake path (`:134`), so this rename does not touch that test — only the `sandbox` value does.

**DD4 — Web guests flip; two overlay preloads flip for free; chrome view deferred**
- **Web guests** (`register-tab-ipc.js:88`): `sandbox: false` → `true`. This is the finding-1 target (hostile pages render here). The test pin at `register-tab-ipc.test.js:191` flips to `true`; the comment block at `:185-188` (which currently asserts "sandbox off" as an invariant) is rewritten to the new invariant.
- **Overlay preloads** (`find-overlay-preload.js`, `menu-overlay-preload.js`): already sandbox-clean (electron-only requires; only `process.platform` beyond that, which sandboxed preloads expose). Flip `window-factory.js:70` and `:94` to `sandbox:true` — free hardening on two trusted surfaces; update the whole-object `deepEqual` pins at `window-factory.test.js:39,42`.
- **Chrome view** (`window-factory.js:178`, `sandbox:false`): **deferred**. Rationale: (a) it loads the trusted `file://` chrome (`index.html`), not hostile pages — far lower value than the web-guest flip; (b) `chrome-preload.js` has two `src/shared` relative requires (`internal-page`, `automation-dev`) → needs its own bundling treatment plus the CJS-quartet eslint interaction; (c) it reads `process.argv` via `isMcpAutomationEnabled(process.argv)` to gate the automation surface — a sandboxed-preload `argv` regression would fail the automation surface *closed* (functional regression), needing its own live-verification. Deferring keeps this flight's risk concentrated on the one high-value flip. Recorded as a mission Known Issue / future-flight candidate, not silently dropped.

**DD5 — Live verification is the acceptance gate; `dev:automation`'s `--no-sandbox` caveat**
- `npm run dev:automation` passes `--no-sandbox` (disables the OS sandbox process-wide). That is **fine for verifying the preload still functions** under `sandbox:true` webPreferences (the Node-API restriction is a webPreferences effect, independent of the OS sandbox flag), but it means `dev:automation` cannot itself prove the OS sandbox is *active*. The active-sandbox claim is verified separately: (a) the unit pin asserts `sandbox:true` in webPreferences, and (b) an FD check confirms the guest renderer is OS-sandboxed via `webContents.getOSProcessId()` → diff `/proc/<pid>/status` against the main process (`Seccomp: 2` with an extra filter, `NoNewPrivs: 1`, distinct user-namespace inode). **Design review empirically confirmed this WSL2 kernel (`6.18.33.2-microsoft-standard-WSL2`) engages Chromium's sandbox on a real `sandbox:true` renderer via the unprivileged-userns path** — the flight's central risk is retired; leg 2 reconfirms on the actual `WebContentsView` web-guest entry (a formality). The functional capability checks (farbling/media/vault) run under `dev:automation`.
- Acceptance apparatus: the existing **`tests/behavior/farbling-correctness.md`** behavior test covers farbling; media-panel scan and vault fill/capture get FD live checks against a real page (media grid populated + a `guest-vault-capture`/`vault-fill` round-trip). If the vault-capture check needs vault setup, the FD performs the minimal setup live.

### Prerequisites

- [x] Flight 1 landed (branch `flight/02-renderer-os-sandbox` is stacked on it — the media-proxy/favicon changes are present)
- [x] Recon complete: full webview-preload dependency graph, IPC channel inventory, build/eslint/tsc integration points enumerated (flight log)
- [x] Live apparatus probe at execution start: `dev:automation` boots the bundled preload and the guest still farbles/scans/vault-fills (leg 2)
- [x] `esbuild` installable (network for `npm i -D esbuild` — verify at leg 1 start)

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (esbuild install + live probe at execution)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 introduces the bundling infrastructure with **no sandbox change** — the app must behave byte-identically with the bundled preload, which makes the risky new-tooling step independently verifiable before anything security-relevant changes. Leg 2 flips the sandbox (web guests + two overlays), updates the pins/comments, updates CLAUDE.md, and runs the live capability verification. The two legs are separated at the "bundle works" checkpoint — a genuine risk seam (new build tooling whose correctness gates the flip).

### Checkpoints

- [x] `build:preload` produces a working bundle; app boots and the guest farbles/scans/vault-fills identically with `sandbox` still `false` (leg 1 — infra proven in isolation)
- [x] Every launch/test/build entry regenerates the bundle (no stale-checkout failure mode)
- [x] Web guest + two overlays construct `sandbox:true`; unit pins updated; full suite green
- [x] Live: farbling behavior test passes, media panel scans, vault fill + capture round-trip — all under `sandbox:true`
- [x] OS sandbox confirmed active on the guest renderer (not just webPreferences set)
- [x] CLAUDE.md updated (sandbox ruling by the `contextIsolation` note; stale `sendToHost` claim fixed)

### Adaptation Criteria

**Divert if**:
- A sandboxed `sendSync` (`vault-eligible`/`shields-farble`) hangs or returns undefined at preload-init → investigate before flipping; if unresolvable, the flip is blocked and escalates (this is the core premise of the flight).
- esbuild cannot be installed (offline) → fall back to the hand-rolled inliner noted in DD1 (2 pure leaves make this ~40 lines), same wiring.

**Acceptable variations**:
- Exact bundle output path/name, esbuild flags, the specific entry points chosen to host `build:preload` (as long as every launch/test/build path is covered).
- Whether the OS-sandbox-active check uses a process inspection or a no-`--no-sandbox` launch.

### Legs

> **Note:** Tentative; planned one at a time.

- [x] `preload-bundling-infra` — esbuild devDep + `build:preload` + entry-point wiring + tooling exclusions; point `main.js` at the bundle; verify the app behaves identically with the bundled preload, sandbox still `false`. (No security change — pure infra, independently verifiable.)
- [x] `sandbox-flip-and-verify` — flip web guest + two overlay preloads to `sandbox:true`; update unit pins + comments; CLAUDE.md sandbox ruling + stale-doc fix; live-verify farbling (behavior test) + media scan + vault fill/capture; confirm OS sandbox active.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged (branch `flight/02-renderer-os-sandbox`, commits `flight/02: …` + `Mission: 13` trailer)
- [x] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`)
- [x] Documentation updated: CLAUDE.md sandbox invariant added; the CLAUDE.md:29 "Internal views are the opposite (isolated + sandboxed)" sentence **revised** (after the flip, web views are also sandboxed — just not isolated — so "opposite" is wrong, not merely incomplete); stale `sendToHost` claim (CLAUDE.md:32) fixed.

### Verification

- Unit: `sandbox:true` pinned for web guest + both overlays; bundle-integrity/graph test (bundled artifact exposes the three imported functions; no relative-`require` survives in the bundle).
- Live: `/behavior-test farbling-correctness` passes under sandbox; FD media-scan + vault fill/capture round-trip; OS-sandbox-active confirmation.
- Full gate green.
