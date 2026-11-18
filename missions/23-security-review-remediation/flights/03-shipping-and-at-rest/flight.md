# Flight: Shipping and At-Rest

**Status**: in-flight
**Mission**: [Security Review Remediation](../../mission.md)

> Architect design review: **approve with changes** (2026-11-16). Incorporated: the macOS ad-hoc signature is reset after the fuse flip (DD2); the build is three jobs so that neither write access nor the right to attest sits beside dependency install scripts, and asset names are fixed and asserted (DD3, DD4); the stable-tag check no longer depends on checkout depth (DD3); the update notice is one `net.fetch` on the default session, has a read channel as well as a push, reacts to its setting mid-run, opens its link through a no-argument channel, and is split into two legs (DD1); the switch list is widened and the admin environment flag recorded as accepted (DD5); the acceptance candidate is tagged below the current stable version so the real notice shows (DD8); `release-pipeline` split in two.
>
> Operator instruction 2026-11-16: "merged, plan flight 3" (Flight 2 merged as #288). Operator rulings the same day, recorded under Open Questions: cookies at rest are measured first and ruled on after; the update notice shows in Settings → About and as a kebab item; a packaged build refuses the dangerous launch switches and keeps `--no-sandbox`; the flight ends with an acceptance walk on a public release-candidate build.

## Contributing to Criteria

- [ ] **An operator on an old build finds out, and can verify what they install** — the whole criterion. _(findings 3, 7, 18, 20; behavior-test-backed for the notice)_
- [ ] **Every finding 1–22 has a recorded disposition and the regression net is green** — this flight's share (findings 8, 19, and the unbuilt parts of 7 and 20), plus the final table for all twenty-two and the documentation sweep that closes the mission.

Reconnaissance (2026-11-16, see flight log): every item is **confirmed-live** except those below. Nothing is retired without a line here.

- [x] 3b — Electron patch lag: the runtime is on 45.3.2 (Flight 2 leg `electron-45`, `package.json`). Remaining: 45.3.3 is out; taken in leg `dependencies`.
- [x] 7 (checksums) — **already provided by GitHub**: every release asset carries a SHA-256 digest computed by GitHub (`gh api repos/msieurthenardier/goldfinch/releases/latest -q '.assets[].digest'` lists one per asset for v0.19.15, and the release page shows it). Remaining: nothing ties a digest to *this repository's workflow at this commit* (provenance), a published release can still be edited, and no document tells an operator how to check either. See DD3.
- [x] 7c — unsigned on macOS and Windows: accepted at mission planning (no certificates). Remaining: the docs say so plainly.
- [x] Dependabot #286 (Electron 44.10.0 → 45.3.0): superseded by Flight 2. **Operator ruling 2026-11-17: fold it in** — leg `dependencies` takes Electron to the current 45 patch, and the flight's pull request body carries `Closes #286` so the merge closes it. Nobody closes it by hand.

---

## Pre-Flight

### Objective

Close the shipping side of the security review. An operator running an old Goldfinch is told a newer release exists; anyone can check that a downloaded installer was built by this repository's release workflow from a named commit, and a published release cannot be changed afterwards; only an administrator can create a release tag, and the job that builds the installers holds no write access while dependency install scripts run. The installed app no longer accepts the Node environment variables, inspector arguments and launch switches that turn it into a general-purpose tool against its own operator. Every finding of the review ends with a written disposition.

### Open Questions

- [x] **Cookies at rest** → operator ruling 2026-11-16: *measure, then decide*. Q2 below; DD6.
- [x] **Where the update notice shows** → operator ruling: Settings → About and a kebab item that appears only when a newer release exists. No toolbar element. DD1.
- [x] **Launch switches** → operator ruling: refuse the dangerous ones in a packaged build; `--no-sandbox` stays honoured and documented. DD5.
- [x] **Acceptance walk** → operator ruling: yes, on a public release-candidate prerelease built by the new pipeline. DD8.
- [ ] **Q1 — Can a packaged build be run on the development host without touching the operator's real profile?** A packaged build does not take the dev-profile redirect (`src/main/main.js` — `if (!app.isPackaged) { app.setPath('userData', devUserDataPath(…)) }`), so by default it opens `~/.config/goldfinch` and contends for its single-instance lock. Expected answer: yes, with `XDG_CONFIG_HOME` pointed at a scratch directory. **Measured as the first step of leg `packaged-measurements`, before any other packaged launch**: launch with the variable set, confirm from the scratch directory's contents and from the real directory's unchanged modification times. An unpacked build on this host needs `--no-sandbox` (no setuid sandbox helper), so every packaged observation here is taken with it; the results say so.
- [ ] **Q2 — What does the cookie-encryption fuse do here?** On a copy of a profile holding a known cookie: (a) does the cookie survive the first launch with the fuse on; (b) is the stored value encrypted on disk afterwards (read the cookie database's `value` and `encrypted_value` columns); (c) which storage backend does this host select with no keyring (`safeStorage.getSelectedStorageBackend()`), and is a cookie written under it still readable when a keyring later appears, and the reverse; (d) does anything change for a dev launch. Leg `packaged-measurements`. The operator rules on DD6 from the answers.
- [ ] **Q3 — Which launch switches can a packaged build neutralise before they take effect?** For each of `--remote-debugging-port`, `--remote-debugging-pipe`, `--ignore-certificate-errors`, `--disable-web-security`: does `app.commandLine.removeSwitch` (present in `node_modules/electron/electron.d.ts`) called in the startup block, before `ready`, stop the effect — observed from outside (the debugging port does not answer; a bad-certificate page still fails; a cross-origin read is still refused)? Where removal does not work, the fallback is to exit before any window opens. Leg `packaged-measurements`. Decides DD5's mechanism per switch.
- [ ] **Q4 — Do the three runtime fuses break anything the packaged app does?** Nothing in `src/` forks a Node child or reads `NODE_OPTIONS` (grep: the only `child_process` uses are in `scripts/`, which run under plain Node, not the packaged binary). Expected: no effect. Measured in `packaged-measurements` on the unpacked Linux build: start, open a tab, the restart-to-apply relaunch (`relaunch` + `quit` in the Shields restart path), a second-instance URL hand-off.
- [x] **Q5 — Does flipping fuses leave the macOS build launchable?** An Apple-silicon build must carry an ad-hoc signature, and changing the binary invalidates it. Design review traced the builder: with `mac.identity: null` (this project's setting) signing is skipped (`app-builder-lib` `macPackager.js` `signApp`, the no-identity return), and the fuse flip re-signs only when `electronFuses.resetAdHocDarwinSignature` is true (`@electron/fuses` `dist/index.js`, its one `codesign` call). So DD2 sets that option from the start. **Not runnable on this host**: the operator is asked for one early launch of an Apple-silicon build (a manual dispatch build, or the first candidate) before the walk depends on it. If it still fails, the fuses move to a Windows-and-Linux-only packaging hook (the `electronFuses` option is not per-platform) and macOS is recorded as not done. **Operator ruling 2026-11-17: no Apple hardware is available; the early launch is skipped.** The fuses ship on macOS with the re-sign option, the disposition table records macOS as *not verified*, and the release notes of the first fused stable release ask macOS users to report a build that will not open. The operator relies on reports after release. **Measured on the macOS build runner 2026-11-17 (run 44116887492): after the fuse change the bundle verifies (`valid on disk`, `satisfies its Designated Requirement`, `Signature=adhoc`) and the app starts and opens its database. Still not run on a user's Mac.**
- [ ] **Q6 — What does turning on immutable releases do to the existing release flow?** The workflow creates a draft, uploads into it, then publishes (`.github/workflows/build.yml`); `docs/RELEASING.md` documents `gh release delete … --cleanup-tag` as the rollback and as the clean-up for release-candidate builds. To read from GitHub's documentation at leg `release-pipeline` design: whether a draft stays editable until published (expected yes), whether a published immutable release can be deleted, and whether its tag can be reused. The answers rewrite the rollback and clean-up paragraphs.
- [x] **Q7 — Does GitHub Actions artifact storage still block passing installers between jobs?** The workflow's header records that a 500 MB quota blocked releases at v0.5.x and that publishing straight to the release was the fix. The repository is public now. To check at leg `release-pipeline` design (documentation and the account's usage page). Decides between DD4's two shapes. **Answered 2026-11-17 by run 44116887492: no — three artifacts of 128–250 MB each uploaded and were downloaded by the next job on this public repository. DD4 shape (a) stands.**
- [x] **Q8 (operator) — The Windows fallback builder.** `ci/tasks/build-windows.yml` signs with a certificate on a personal worker. **Operator ruling 2026-11-17: remove it.** The task, its job in `ci/pipeline.yml`, and every mention in `ci/README.md`, `docs/RELEASING.md` and CLAUDE.md are deleted in leg `dependencies` (which already edits the Concourse task files); the GitHub workflow is the only Windows build.

### Platform check — what is already provided

Each row cites where the claim is made true. A row without a call site is a question, not a fact (Flight 2 debrief, learning 1).

| Concern | Already provided by | Evidence | Left for this flight |
| --- | --- | --- | --- |
| Checksums for release assets | GitHub | `assets[].digest` in the releases API (flight log, recon) | provenance, immutability, a verify recipe (DD3) |
| Build provenance | GitHub artifact attestations, free on public repositories | none in `build.yml` today | add the attestation step (DD3) |
| Immutable releases | a repository setting | `immutable-releases` → `{"enabled":false}` | operator turns it on (DD3) |
| Tag protection | repository rulesets | one ruleset, branch `main` only | operator adds a tag ruleset (DD3) |
| Default workflow token is read-only | repository setting | `actions/permissions/workflow` → `default_workflow_permissions: read`; `build.yml` top-level `permissions: contents: read` | the per-job escalation in `build` (DD4) |
| Action pins | already full-SHA | `build.yml`, `ci.yml` | keep; resolve SHAs for every action added |
| Fuse flipping | electron-builder's `electronFuses` build option | `node_modules/app-builder-lib/out/configuration.d.ts` (`electronFuses?: FuseOptionsV1`); `@electron/fuses` 1.8.0 already installed | choose the fuses (DD2) |
| `--inspect` and friends | the `nodeCliInspect` fuse (also stops `SIGUSR1` opening the inspector) | fuse documentation in the same typings | DD2 covers it; DD5 does not need to |
| "Is a newer stable release out?" | GitHub's `releases/latest` endpoint — excludes drafts and prereleases | used by `gh release view` above | the client (DD1) |
| Dev-only automation gates | `app.isPackaged` | `app-lifecycle.js` (`devOverride = !app.isPackaged && …`), `main.js` (`honorEnv: !app.isPackaged`) | the same key gates DD1's test override and DD5 |
| OS warning before running an unsigned installer | Windows SmartScreen, macOS Gatekeeper | not checkable here | stated in the docs; seen at the walk |

### Design Decisions

**DD1 — The app asks GitHub whether a newer stable release exists, and says so; it never downloads or installs anything.**

- *What is asked.* One `GET` to `https://api.github.com/repos/msieurthenardier/goldfinch/releases/latest`, about a minute after start and then once every 24 hours while running. Nothing is persisted about the check; each launch asks afresh.
- *What the request carries.* One `net.fetch` from the main process on the default session with `credentials: 'omit'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'` and an explicit fixed `User-Agent` header that names neither the app version nor the profile. **No new session is created**: design review read `session-runtime.js` `onSessionCreated` — a new session would take the whole web branch (Shields, the certificate observer, the download handler, spellcheck) for nothing, while on the default session the request has no `webContentsId`, so per-tab request recording returns early and nothing else applies to an API address with no query. It is the first remote `net.fetch` in `src/main/**`. It follows the system proxy. GitHub necessarily sees the operator's network address, and allows 60 unauthenticated requests an hour per address (a refusal is one more silent failure); the docs say both. The repository slug is drift-guarded against `package.json` `build.publish`.
- *What is believed from the answer.* The response is size-capped and parsed defensively; only `tag_name` is read, and only if it matches the same strict-semver pattern the release workflow enforces **and names no prerelease** (the endpoint excludes them; the validator refuses one anyway). The link shown is built by the app from that validated tag (`https://github.com/msieurthenardier/goldfinch/releases/tag/v…`); no URL or text from the response is ever displayed or opened. A failure of any kind is silent and leaves the previous state.
- *"Newer"* is semantic-version precedence against `app.getVersion()`, in a pure module under `src/shared/`. Prereleases are never offered (the endpoint excludes them); an operator running a release candidate is offered the stable release that supersedes it.
- *Setting.* `updateCheckEnabled`, default `true`, an additive key in `settings-store.js` `DEFAULTS` (no version bump, per that file's own rule for additive keys), with a switch in Settings. Off means no request is made: turning it off mid-run stops the timer, aborts a request in flight, clears the state and broadcasts the cleared state; turning it on starts a check without a restart (the reaction hangs where `register-settings-ipc.js` already reacts to a `spellcheck` write). The timer is cleared and any request aborted in `before-quit`.
- *The state.* Main holds it (`{ current, available }` or nothing). Source of truth: the last successful check. Rebuilt by: the start-up check, the 24-hour timer, the setting turning on. Cleared by: the setting turning off. Greatest staleness: 24 hours. Readers get it two ways — a `chromeOrInternal` read channel called at every chrome and Settings-page boot (so a window, a recovered chrome or a page opened after the push is right), and a broadcast on change.
- *Where it shows.* Settings → About gains the running version (the section is a placeholder today: "Version information and credits will appear here."; nothing exposes the version to pages yet — it rides the read channel) and, when one exists, "Version X.Y.Z is available" with a control that opens the release page in an ordinary web tab. The kebab menu gains one item, present only when a newer release exists, that does the same.
- *Opening the page.* A dedicated channel that takes **no arguments** — `internal` class for the Settings page, a `chrome`-class twin for the kebab action. Main builds the address from its own validated state and has the owning chrome open an untrusted tab with no container, as the external-URL path does. The existing `internal-open-tab-in-jar` is not used: it takes a page-supplied address.
- *The chrome side and `renderer.js`.* `renderer.js` is at 1,504 of 1,505 lines and the kebab is opened there with a static `buildKebabModel()` (`overlay-menus.js`, no parameters). The conditional item is therefore fed from module-level state inside `overlay-menus.js` (set by the update push, subscribed inside an existing controller's construction), so **`renderer.js` gains no line**; if leg design finds that impossible, the leg extracts first — it does not compact. `overlay-menus.test.js`'s guard that `kebabActions`' keys equal the default model's ids is updated deliberately, in the leg, to "default ids plus the update item". Nothing is added to the evaluate seam (41).
- *Dev and test.* An unpackaged build does not check, unless an environment variable names a loopback URL to ask instead — honoured only when `!app.isPackaged`, the pattern `main.js` already uses for the automation port (`honorEnv: !app.isPackaged`). That override is the behavior spec's handle.
- Rationale: notify-only was the operator's decision at mission planning; the endpoint already answers the prerelease question; trusting one validated field keeps a compromised or spoofed response from putting text or a link in front of the operator.
- Trade-off: an operator who never opens the kebab or Settings does not see it. Whether the kebab button itself should carry a mark is an alignment question for the walk, not built here.
- *Annotation 2026-11-17 (leg `update-download`; the sentence above stays as written).* Narrowed by operator ruling at the acceptance walk — "A download now button would be ideal in the settings page, the link in the kabab menu can continue to work as it does": the app never downloads **automatically**; a download the operator asks for, from Settings → About, is allowed, through the browser's own download path and an address the app builds from the validated version. The app still never installs, opens or runs anything.

**DD2 — Three runtime fuses are turned off in packaged builds.** `runAsNode`, `enableNodeOptionsEnvironmentVariable` and `enableNodeCliInspectArguments` are set to `false` through electron-builder's `electronFuses` option in `package.json`, with `resetAdHocDarwinSignature: true` (Q5; `mac.identity` stays `null`). The packaging check on Linux (`ci/tasks/package-linux.yml`, image pinned by digest) reads the fuses back from the built binary (`electron-fuses read`, already in `node_modules/.bin`) and fails if any of the three is on. Dev launches run the unmodified `node_modules` binary and are unaffected. Not touched, with the reason recorded in the disposition table: the two archive-integrity fuses (they need `asar`, and `asar:false` is load-bearing — CLAUDE.md, *Non-obvious gotchas*), and `grantFileProtocolExtraPrivileges` (the chrome is a `file://` page). Subject to Q4 and Q5.

**DD3 — A release can be traced to its build and cannot be changed afterwards.**

- The release workflow records **build provenance** for every installer with GitHub's attestation action (pinned to a full commit SHA). The attestation is made in the **upload job**, which runs no project code (DD4) — not in the job that runs install scripts, where a hostile script could mint an attestation for bytes of its choosing. The attested identity is the workflow and commit, so nothing is lost by attesting one job later; the upload job first checks each file against a digest list the build job wrote.
- **Checksums are GitHub's own per-asset digests** — no checksum file is published. `docs/RELEASING.md` and the README gain a short "verify your download" recipe: compare the digest, then `gh attestation verify <file> --repo msieurthenardier/goldfinch`; the recipe also names GitHub's own release attestation (`gh release verify`) if Q6 confirms it comes with immutable releases. The README's download block is regenerated at every version bump (`scripts/update-readme.mjs`, between its markers), so the recipe goes outside the markers or into the script's template.
- **Only reviewed history releases as stable**: first in `create-release`, before the draft exists, the workflow refuses a stable tag whose commit is not on `main` — asked of GitHub's compare endpoint (the default checkout is one commit deep, so a local ancestry test would be wrong), with one retry after a short wait because release-prep pushes the commit and the tag together. Stability is derived from the tag string, so a stable-looking name cannot claim the exemption. A prerelease tag is exempt — that is how an acceptance build of unmerged work is made — and is safe to exempt because prereleases are never offered by the update notice and are marked as prereleases. With the tag ruleset below this is a second line, not the first.
- **Repository settings, applied by the operator** from exact commands the leg supplies: a tag ruleset on `v*` (creation, update and deletion restricted to the administrator role) and immutable releases on. The Flight Director and crew change no repository setting.
- The updater metadata files (`latest*.yml`, `*.blockmap`) are published today though nothing reads them; whether to stop publishing them is decided at leg design (they are harmless, and an unused file is one more thing to explain).
- Rationale: operator decision at mission planning — no certificates; checksums, provenance, protected tags, immutable releases. Subject to Q6.

**DD4 — The job that installs dependencies cannot write to the repository.** Today the `build` job holds `contents: write` for its whole length, runs `npm ci` with install scripts, and checks out with persisted credentials. After: every checkout sets `persist-credentials: false`, and the write permission exists only where an upload happens. Two shapes, chosen at leg design by Q7: **(a)** `build` has `contents: read` and nothing else, builds with `--publish never`, writes a digest list, and hands the installers to a separate upload job that holds `contents: write`, `id-token: write` and `attestations: write`, checks the digests, attests, uploads, and runs no project code; or **(b)**, if installers cannot be passed between jobs, one job in which the token is given only to the upload step and never to `npm ci` or the build — in which case attestation rights do sit in that job, and the leg says so as a residual. (a) is preferred. Also: the `npm` cache is not used on tag builds; `create-release` loses its unneeded checkout; the workflow header's "publish straight to the Release" rationale is rewritten.
- **Asset names are a contract.** The builder's publisher uploads under space-free names (`Goldfinch-Setup-X.exe`), which the README links and the update metadata use; on disk the Windows installer is `Goldfinch Setup X.exe`, and a plain upload would let GitHub rename it. Shape (a) therefore sets explicit space-free `artifactName`s in `package.json` and the upload job asserts that the file list is exactly the names `scripts/update-readme.mjs` links plus whatever metadata is deliberately kept. `--publish never` still writes `latest*.yml` and blockmaps (the builder emits them whenever a publish target is configured), so dropping them is a decision the leg makes, not something that happens by itself.

**DD5 — A packaged build refuses launch switches that disable its protections.** In a packaged build only, at the top of the startup block and before `ready`: the switches in the list below are removed, or — for any switch Q3 shows cannot be removed in time — the app prints one line naming the switch and exits before opening a window. The decision is a pure function (`argv`, `isPackaged`) → actions, unit-tested; the startup block only applies it. `--no-sandbox` stays honoured (some Linux hosts cannot start the sandbox) and is documented as lowering protection. The operator's `--enable-features` / `--disable-features` composition (`main.js`, the one `appendSwitch('enable-features'`) is untouched and its ordering pin (`third-party-cookie-startup-order.test.js`) stays green. Unpackaged launches are unchanged — `dev:automation` passes `--no-sandbox` and dev tooling may use the others.

- *The list*, fixed at leg design from Q3 and held in one table: remote debugging (`--remote-debugging-port`, `-pipe`, `-address`, `--remote-allow-origins`); certificate and origin trust (`--ignore-certificate-errors`, `--ignore-certificate-errors-spki-list`, `--unsafely-treat-insecure-origin-as-secure`, `--disable-web-security`, `--disable-site-isolation-trials`); redirection (`--host-rules`, `--host-resolver-rules`); code loading (`--js-flags`, `--load-extension`). `--proxy-server` is **not** refused (operators legitimately set one) and is documented. An operator `--disable-features` that names the third-party-cookie feature already loses to `decideStartup`'s composition; whether one naming site isolation should be refused is decided at leg design. The decision function is tested with bare and `--switch=value` forms.
- *Placement*: after the dev-profile redirect and before the `enable-features` reader, closed in its own block; design review confirmed both order pins accept that position and that it must not sit between the reader and the `appendSwitch`.
- *Not changed, recorded as accepted*: `GOLDFINCH_AUTOMATION_ADMIN` is honoured in a packaged build (`mcp-server.js`, `main.js`). It is the operator's launch flag and by design the one door to the admin tier; it still needs automation enabled and a minted admin key.
- Stated limit: someone who can edit the launch command line or the files on disk already runs code as the operator; this stops the app being repurposed by a shortcut, a wrapper script or a URL handler, not by a local attacker with a debugger.

**DD6 — Cookies at rest: decided after measurement; if turned on, it lands last and alone.** The cookie-encryption fuse is one-way: Electron's own description says that turning it off again leaves the cookie store "effectively corrupt". After leg `packaged-measurements` reports Q2, the operator rules: **on** → leg `cookie-encryption` (one line in `electronFuses`, a release note, the docs), flown after every other source change so it can be dropped without disturbing them; **accept** → the finding is recorded as accepted with the measured reason, and the leg is not flown. The Flight Director's expectation, to be confirmed or overturned by the measurement: on a host with no keyring the protection is nominal, and the ruling turns on what a keyring appearing or disappearing does to existing cookies. One thing this host cannot measure and the ruling should weigh: on macOS the keychain item is tied to the app's signature, and an ad-hoc signature changes with every build — whether the next version can still read the cookies is unknown until two builds are installed in turn.

**DD7 — Dependencies: fix what ships, pin what builds, write down the rest.** The two moderate advisories in shipped code (`hono`, `@hono/node-server`, both transitive through the MCP SDK; `npm audit --omit=dev`) are fixed within the SDK's declared ranges — a lockfile change, or an `overrides` entry if the range forbids it; the SDK's exact pin is not moved for this. Electron goes to the current 45 patch. Advisories in build-only tooling (`minimatch` through electron-builder and eslint) are fixed where a non-breaking fix exists (an `overrides` entry, as `brace-expansion` already has) and otherwise recorded as accepted: build-time only, not shipped. The six Concourse task images move from the tag `node:22` to a digest. The audit gate is not lowered.

**DD8 — The acceptance build is a real prerelease.** The walk runs on a `vX.Y.Z-rc.N` tag pushed by the operator on the flight branch: it is the only way to exercise the new workflow end to end and the only source of Windows and macOS installers. It is public, and once immutable releases are on its tag number is spent for good (Q6). It is cut after every source leg has landed and been reviewed. What the walk covers: the provenance check and digests on the real assets; the installers start on each platform the operator has (Q5); the update notice against the real endpoint — the candidate is tagged **below the current stable version** (`v0.19.15-rc.N`: the workflow already sets the package version from the tag, and version precedence puts it under stable 0.19.15), so the installed candidate is genuinely offered v0.19.15 with no override (a packaged build ignores the dev-only one). `docs/RELEASING.md`'s advice to name a candidate after the *next* version is reworded for this case; a refused switch; and the seven by-eye items carried in `docs/RELEASING.md` from Flights 1 and 2, which this walk finally gives an owner.

**DD9 — Contracts the behavior spec depends on.** Changing any of these is a spec re-author, not an inline fix at the walk: the settings key `updateCheckEnabled`; the dev-only override variable's name; the bridge method the chrome and the Settings page read the update state through, and that state's field names; the About section's element ids.

### Shared Mechanisms Touched

- **The settings store and its broadcast** (`settings-store.js`, `settings-changed`) — shared by every preference, the chrome's caches, the Settings page. Assertion: one additive boolean; `load()` repair and the existing settings suites stay green; the chrome's `homePageCache` / `searchEngineCache` handling is not touched.
- **The kebab menu model** (`overlay-menus.js` `kebabActions` and the model it opens) — shared by every kebab item and by `sheet-accelerator.js`'s hand-mirrored shortcuts. Assertion: an item is added, none reordered or renamed; no accelerator is bound to it; the existing kebab tests stay green.
- **The IPC gate and its table** (`ipc-channel-table.js`, 205 rows; `ipc-gate-invariant.test.js`) — every new channel is a new row under an existing class. No new class.
- **`app.on('session-created')`** — a global hook. If DD1 creates a session, the leg lists what `onSessionCreated` would attach to it and excludes it explicitly; the third-party-cookie startup premise is unaffected (no new `appendSwitch`).
- **The startup block of `main.js`** — shared by the dev-profile redirect, the single-instance lock, the `enable-features` composition and `crashReporter.start()`, in an order pinned by `single-instance-lock-order.test.js` and `third-party-cookie-startup-order.test.js`. DD5's step goes first and both pins stay green; the leg re-runs the `third-party-cookie-isolation` spec, because a mistake in switch handling could silently drop the feature that isolation rests on.
- **The release workflow** — shared by stable releases, release-candidate builds for Windows acceptance (`docs/RELEASING.md`), and the manual dispatch smoke check. Each of the three is exercised or reasoned through in leg `release-pipeline`.

### Apparatus (premise-audited on both axes)

| What is verified | Acts through | Observes through | Limits |
| --- | --- | --- | --- |
| Update notice (spec `update-notice`) | dev mode (`dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`, admin key) with the dev-only override pointed at a loopback fixture that serves a chosen `tag_name` | the fixture's own request log (headers received: no cookie, the fixed user-agent; request count with the setting off = 0); `readDom` of `goldfinch://settings` for the About line and link target; `evaluate` in the chrome for the pushed state | **the kebab sheet is unobservable** (not in `AUTOMATABLE_MENU_TYPES`) — the kebab item is `[by-eye]`, pre-marked; the 24-hour repeat is unit-tested with an injected clock, not waited for |
| Fuses | `npm run pack`, then the fuse reader on `dist/linux-unpacked` | the reader's output; `ELECTRON_RUN_AS_NODE=1 <binary> -e …` no longer runs as Node | Linux only here; Windows and macOS at the walk |
| Launch switches | the unpacked packaged build, `XDG_CONFIG_HOME` in a scratch directory (Q1), launched with each switch | from outside the app: the debugging port does not answer; stdout line and exit code for a refusal | a packaged build has no dev key minting, so the MCP surface is not available on it — every observation is external |
| Cookie fuse (Q2) | a copy of the Electron binary with the fuse flipped by `@electron/fuses`, run in dev mode against a scratch profile, and a loopback page that sets a long-lived cookie | the cookie database read with `node:sqlite`; the fixture's log of the `Cookie` header on the next launch | measures this host only |
| Release pipeline | a manual dispatch run (build only), then the release-candidate tag | the run's logs; `gh attestation verify`; `gh api` for digests, immutability and the ruleset | the tag run is public and happens once per candidate |

No test or crew run starts a packaged build without the scratch `XDG_CONFIG_HOME`, opens a downloaded installer, or writes to the operator's clipboard or real profile.

### Prerequisites

- [x] Flight 2 merged (`e282eaf`); flight branch `flight/03-shipping-and-at-rest` created from it.
- [x] `gh` authenticated with rights to read rulesets and release settings (verified by the recon reads).
- [x] electron-builder accepts `electronFuses`; `@electron/fuses` is installed (cited above).
- [ ] The operator can apply repository settings (tag ruleset, immutable releases) when leg `release-pipeline` supplies the commands.
- [ ] The operator has a Windows and/or macOS machine for the walk (as for Flight 2's release checklist); what is not available is recorded as not walked.
- [ ] Ports for the loopback fixtures are free at each run (checked by the run, as in earlier flights).

### Pre-Flight Checklist

- [x] Architect design review incorporated (2026-11-16; one cycle — every change is the reviewer's stated remedy, so no second pass).
- [x] Operator go (2026-11-17, "begin").
- [x] Q8 answered: the Windows fallback builder is removed (leg `dependencies`).

---

## In-Flight

### Technical Approach

Dependencies first, so every measurement is taken on the runtime that ships. Then one leg that only measures — the packaged build's isolation, the switches, the cookie fuse — because three design decisions rest on facts that cannot be read from code, and Flight 2 paid twice for designing ahead of a measurement. Then the app-side changes, one decision per leg, none sharing a source file beyond `package.json` and the composition root. The release workflow changes after the app is finished, since its only real test is a tag. The one-way step, if the operator chooses it, goes last among source changes. Documentation and the final disposition table follow it so that they describe what was actually built. The walk closes the flight on a real candidate.

### Decisions against files

Drawn up before the leg list (Flight 2 debrief, recommendation 2): one leg per decision unless files overlap.

| Decision | Files | Leg |
| --- | --- | --- |
| DD7 | `package.json`, `package-lock.json`, `ci/tasks/*.yml` (image digests) | `dependencies` |
| Q1–Q4 | none in `src/`; a results document in this flight's directory | `packaged-measurements` |
| DD2 | `package.json` (`build.electronFuses`), `ci/tasks/package-linux.yml` | `runtime-fuses` |
| DD5 | new pure module, `src/main/main.js` startup block, tests, `docs/` | `launch-switches` |
| DD1, main half | new main module (fetch, schedule, state), new shared module (version precedence, response validation), `settings-store.js`, `register-settings-ipc.js`, `ipc-channel-table.js`, preloads, `renderer-globals.d.ts`, `app-lifecycle.js` (`before-quit`) | `update-check` |
| DD1, visible half | Settings page (`settings.html`, `settings.js`), `overlay-menus.js` and its test, an existing chrome controller, `docs/`, the behavior spec | `update-notice` |
| DD4 | `.github/workflows/build.yml` (job topology), `package.json` (`artifactName`s) | `release-build-split` |
| DD3 | `.github/workflows/build.yml` (tag check, attestation), `docs/RELEASING.md`, `README.md` and `scripts/update-readme.mjs`, `ci/README.md`; repository settings (operator) | `release-integrity` |
| DD6 | `package.json` (one line), `docs/` | `cookie-encryption` (conditional) |
| Criterion 10 | `mission.md`, `CLAUDE.md`, `docs/**` | `dispositions-and-docs` |

`package.json` is touched by four legs in sequence, each in a different key; no two legs are in flight together.

### Checkpoints

- After `packaged-measurements`: the operator rules on DD6 from Q2's answers, and any switch that cannot be removed is confirmed as "exit instead".
- After `runtime-fuses`: no macOS launch (Q5 ruling — no hardware). The leg's packaging check asserts from the build log that the re-sign step ran for the macOS target, which is the only evidence available.
- Before `release-integrity` lands: the operator applies the tag ruleset and immutable releases, and the leg confirms both by reading them back.
- Before the walk: flight-end review of all source changes passed; the operator pushes the candidate tag.

### Adaptation Criteria

- **Divert** if Q1 fails — a packaged build cannot be kept off the real profile on this host. Then every packaged observation moves to the walk, and `launch-switches` is verified by unit tests alone until then.
- **Divert** if the fuses stop the packaged app starting on any platform: that platform ships without them and the finding is recorded as open there.
- **Drop a leg** — `cookie-encryption`, on an "accept" ruling.
- **Stop and ask** if any step would need a repository setting changed by anyone but the operator, or a tag pushed.

### Legs

1. `dependencies` — runtime advisories fixed within the SDK's ranges; Electron to the current 45 patch (gates and the store suites re-run; the `third-party-cookie-isolation` spec is **not** re-run for a patch bump unless the release notes touch cookie features); build-tool advisories overridden or recorded; Concourse images pinned by digest. *Tier: low unless an override is needed.*
2. `packaged-measurements` — Q1 first, then Q3, Q2, Q4, on the unpacked Linux build and a fuse-flipped copy of the dev binary. No source change. Output: `packaged-measurements.md` in this directory and a flight-log entry. **Checkpoint: DD6 ruling.**
3. `runtime-fuses` — DD2 and its packaging check.
4. `launch-switches` — DD5, mechanism per switch from Q3; `third-party-cookie-isolation` re-run.
5. `update-check` — DD1's main half: the pure modules, the request, the schedule, the setting and its mid-run reaction, the state with its read channel and broadcast, the no-argument open channels. Unit-tested; a live smoke against the loopback fixture.
6. `update-notice` — DD1's visible half: About, the kebab item, the chrome wiring; behavior spec `update-notice` authored at leg design and run once as a test of the spec before it gates the leg.
7. `release-build-split` — DD4; Q7 answered at leg design; smoke-tested by a manual dispatch run (build only, publishes nothing).
8. `release-integrity` — DD3; Q6 answered at leg design. **Checkpoint: operator applies repository settings.**
9. ~~`cookie-encryption`~~ — **not flown.** Operator ruling 2026-11-17 on DD6, after leg `packaged-measurements`: "accept cookies as not fixed". Recorded in the disposition table with the measured reasons (nominal on a host with no keyring; one-way; unverifiable on macOS, where the keychain entry is tied to a per-build ad-hoc signature).
10. `dispositions-and-docs` — the table of findings 1–22 (fixed-and-pinned with the pinning test, or accepted with the reason) written into `mission.md`; the sweep of CLAUDE.md and `docs/` for any claim a finding named as false; the two standing planning rules from the Flight 2 debrief added to CLAUDE.md's *Project-specific planning rules*; the release checklist in `docs/RELEASING.md` given an owner and the items this walk covers struck from it afterwards. *Tier: low.*
11. `hat-and-alignment` *(interactive)* — DD8.

Out of this flight, by design: the confirmation dialog's primitive (Flight 2 debrief, recommendation 3 — its own sortie); splitting `vault-store.js` and `main.js` (maintenance work); squawks 0179–0194, none of which shares a file with this flight; popup and tab burst limits (0187, a sortie).

---

## Post-Flight

### Completion Checklist

- [ ] All legs `completed` or recorded as dropped with the ruling.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm audit --audit-level=high` pass.
- [ ] Flight-end review confirmed.
- [ ] The disposition table covers findings 1–22 with no blank row.
- [ ] Anything not walked is listed in the flight log and left on the release checklist.

### Verification

- **Behavior spec `update-notice`** (draft; authored in full at leg `update-notice` design). Key observable: with the override pointing at a fixture that reports a higher version, the Settings page's About section names that version and links to the app-built release address, and the fixture logged exactly one request carrying no cookie and the fixed user-agent; with a lower or equal version, a malformed tag, an oversized body, or a redirect, no notice appears; with the setting off at launch, and after it is turned off mid-run, the fixture logs no further request. About nine checkpoints; the kebab item is one `[by-eye]` row.
- **Unit**: version precedence table; response validation table; the scheduler with an injected clock; the switch decision table; the settings key's repair; the gate invariant with the new rows.
- **Packaging check**: fuses read back from the built Linux binary.
- **Re-run**: `third-party-cookie-isolation` after `launch-switches`.
- **Release**: a dispatch run of the changed workflow; then the candidate tag — attestation verified, digests present, the release immutable, a stable tag off `main` refused (shown by the workflow's own check on a dry run, not by pushing a bad tag).
- **By eye, at the walk**: installers start on each available platform; the kebab item; a refused switch on an installed build; the seven carried checklist items.
