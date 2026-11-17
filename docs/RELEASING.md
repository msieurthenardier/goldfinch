# Releasing

Releases are **tag-driven**: pushing a `vX.Y.Z` tag runs `.github/workflows/build.yml`,
which builds installers for Windows/macOS/Linux and publishes a GitHub Release with them
attached. Nothing else is needed to ship the binaries.

## The release workflow

Four jobs. The one that runs project code (dependency install scripts, the build) cannot write
to the repository or the release; the one that writes runs none of it.

| Job | Runs on | Permissions | May do |
| --- | --- | --- | --- |
| `create-release` (tags only) | Linux | `contents: write` | Validates the tag as strict semver, classifies stable vs prerelease, creates the **draft** release. `gh` only; no checkout. |
| `build` (mac / linux / win) | one runner each | `contents: read`, no token or secret anywhere in the job | Checkout (credentials not persisted), `npm ci`, version from the tag, `electron-builder --publish never`, fuse check on the unpacked app, macOS ad-hoc signature verification, one start of the unpacked app, then stages that platform's installers **by exact name** with their SHA-256 list and the version, and uploads them as a one-day, uncompressed Actions artifact. |
| `upload` | Linux | `contents: write` | No checkout, no `node` / `npm`. Downloads the three artifacts, recomputes every digest, asserts the file names are exactly the five expected for the tag's version, then `gh release upload` into the draft (the token is given to that one step). |
| `publish-release` (tags only) | Linux | `contents: write` | Flips the draft to published: stable tag -> latest, prerelease tag -> prerelease. Only after `upload` succeeded. |

The digest comparison proves the files were not changed between jobs; it does not prove the build
job was honest (that job is the party being contained).

**A release holds five installers and nothing else**: `Goldfinch-Setup-X.exe`, `Goldfinch-X-arm64.dmg`,
`Goldfinch-X-arm64-mac.zip`, `Goldfinch-X.AppImage`, `goldfinch_X_amd64.deb`. The updater metadata the
builder can write (`latest*.yml`, `*.blockmap`) is no longer published: the app notifies about a new
version, it does not self-update. The names are set per target in `package.json` (`artifactName`) and
are the ones `scripts/update-readme.mjs` links (`test/unit/artifact-names.test.js`).

**A manual dispatch runs everything except the upload and the release steps**: it builds, checks and
stages the installers and runs the `upload` job's name and digest checks, and publishes nothing. The
staged installers stay on the run as one-day artifacts.

The invariants (every `uses:` pinned to a full SHA with a `# vX.Y.Z` comment; the build job's
`contents: read`, no token and no persisted checkout credentials; the upload job running no project
code; `--publish always` appearing nowhere; one-day, uncompressed artifacts) are pinned by
`test/unit/release-workflow-invariants.test.js`, a text scan of the workflow files.

## Cut a release

From an up-to-date `main` with green gates (`npm test`, `npm run typecheck`, `npm run lint`):

```bash
npm version patch -m "release-prep: bump to %s"   # or minor / major
git push --follow-tags
```

`npm version` first runs the **`preversion` guard** (`scripts/check-psl-fresh.mjs`, offline): it
refuses the bump (non-zero exit) when the vendored Public Suffix List snapshot
(`src/main/public_suffix_list.dat`) is more than 90 days old. If it refuses:

1. `node scripts/update-psl.mjs` (fetches only publicsuffix.org, validates, overwrites the `.dat`
   and the `Snapshot:` line in `src/main/psl.js`; never commits),
2. re-check `SUPPLEMENT_SUFFIX` in `src/main/trackers.js` (amazonaws.com, netlify.com, surge.sh,
   glitch.me) against the new `.dat`,
3. `npm test` (`psl.test.js` runs against the vendored `.dat`) and review the curated `TRACKERS` table,
4. commit the refresh as its own reviewed change, then cut the release.

Refresh proactively too if it has been a while. Then `npm version` does three things in one commit:

1. bumps `package.json` + `package-lock.json`,
2. runs the **`version` npm-lifecycle hook** → `scripts/update-readme.mjs` regenerates the
   README download links (from the new `package.json` version) and stages `README.md`, and
3. commits all of the above and creates the `vX.Y.Z` tag.

So the **README download-link bump is folded into release-prep** — there is no post-release
job that pushes back to `main`. (That job was removed: it required the `github-actions` bot
to bypass the `main` ruleset — "Changes must be made through a pull request" — which it
can't, so it only ever failed. Regenerating the links at bump time keeps `main` protected.)

`git push --follow-tags` pushes the release-prep commit **and** the tag. The tag fires the
build workflow; the installers publish a minute or two later, at which point the just-written
download links go live.

## Windows HAT build (prerelease tag)

WSL can't build the NSIS installer, and a manual `workflow_dispatch` run of `build.yml` is a
smoke check that builds, checks and stages the installers but uploads them to no release (see *The
release workflow* above). To get a published installer for a human acceptance test, push a strict-semver **prerelease** tag on the commit under test:

```bash
git tag -a vX.Y.Z-rc.N <commit> -m "Windows HAT build"
git push origin vX.Y.Z-rc.N
```

Use the **next** release's version (minor for a feature) with `-rc.N`, and bump `N` for re-checks
after HAT fixes. No version-bump commit is needed: the workflow's "Set version from tag" step syncs
`package.json` from the tag, and a prerelease tag publishes a GitHub **prerelease** (not "latest")
with all installers. Download `Goldfinch-Setup-…exe` from the release page. Afterwards clean up:

```bash
gh release delete vX.Y.Z-rc.N --yes --cleanup-tag
git tag -d vX.Y.Z-rc.N
```

This is **outward-facing** — the prerelease is public — so only tag commits you're willing to publish.

## Runtime fuses

Packaged builds ship with three Electron fuses turned off (`package.json` `build.electronFuses`;
electron-builder flips them while packing, on every platform it packs):

| Fuse | Off means |
| --- | --- |
| `runAsNode` | `ELECTRON_RUN_AS_NODE=1 goldfinch -e '...'` no longer runs the binary as a plain Node interpreter. |
| `enableNodeOptionsEnvironmentVariable` | `NODE_OPTIONS` is not consulted. |
| `enableNodeCliInspectArguments` | `--inspect` / `--inspect-brk` open no debugger port. |

Deliberately left alone: `enableEmbeddedAsarIntegrityValidation` and `onlyLoadAppFromAsar` (they need
`asar`, and `asar: false` is load-bearing), `grantFileProtocolExtraPrivileges` (stays on: the chrome is a
`file://` page), `enableCookieEncryption` (the operator's separate decision; one-way, see the flight
notes), and `WasmTrapHandlers` (Electron's own default, on). `scripts/check-fuses.mjs` pins the whole
table, so any of these changing by accident fails the packaging step too.

- **Check a build:** `node scripts/check-fuses.mjs <path-to-binary>` (CI runs it on
  `dist/linux-unpacked/goldfinch` after packing: `ci/tasks/package-linux.yml`, and the *Check Electron
  fuses* step of `.github/workflows/ci.yml`; the release workflow's `build` job runs it on every
  platform's unpacked app). Exit 0 only when the table matches.
- **Read them from an installed build:** `npx electron-fuses read --app <path-to-binary>` (the `goldfinch`
  binary on Linux, `Goldfinch.exe` on Windows, the `.app` on macOS).
- **macOS:** changing the binary breaks the ad-hoc signature an Apple-silicon build needs, so
  `resetAdHocDarwinSignature: true` makes the fuse step re-sign it. That cannot be run on Linux; it is
  checked on the macOS build runner of the release workflow (`codesign --verify --deep --strict` and an
  ad-hoc-signature check, then one start of the unpacked app), not on hardware.
- The dev app runs the unmodified `node_modules/electron` binary and is unaffected.

## Launch switches

An **installed** (packaged) build does not obey the command-line switches that turn off its protections.
The threat is the app being repurposed through its command line by something that is not a local attacker
with a debugger: a shortcut, a wrapper script, a URL-handler argument. Someone who can edit the files on
disk already runs code as the operator; that is not defended. A dev launch (`npm start`,
`npm run dev:automation`) is unaffected: the decision runs only when `app.isPackaged`.

`src/main/launch-switches.js` holds two tables; the block in `main.js` applies them before the
single-instance lock, so a refused launch opens no store, takes no lock and hands nothing to a running
instance. Chromium's own parser decides what counts as a switch (bare, `=value`, a `/` prefix on Windows),
through `app.commandLine.hasSwitch`.

**Stripped** (removed before `ready`; removal was measured to stop the effect on the packaged Linux build,
except where noted). One stderr line, `goldfinch: ignored launch switches: --a, --b`, lists what was removed.

| Switch | What it would otherwise allow |
| --- | --- |
| `remote-debugging-port`, `remote-debugging-pipe` | A full DevTools-protocol connection to the browser and every page. |
| `remote-debugging-address`, `remote-allow-origins`, `remote-debugging-targets` | Widen or reshape the above; meaningless once it is stripped (not measured on their own). |
| `ignore-certificate-errors` | Accept any TLS certificate. |
| `disable-web-security` | Same-origin policy off. |
| `host-rules`, `host-resolver-rules` | Redirect any hostname to an address of the launcher's choosing. |
| `load-extension`, `disable-extensions-except` | Electron ignores `--load-extension` (measured: no effect); listed so a later Electron that honours it is covered. |

**Refused** (the launch stops): the removal was measured insufficient, or was not measured, and refusing
needs no proof that removal is in time. One stderr line, `goldfinch: refusing to start: --a (exit 64)`,
then a native error box titled *Goldfinch cannot start with these options* (on Linux, before `ready`,
Electron writes the box to stderr instead: a second pair of lines), then `app.exit(64); process.exit(64)`
(64 is `EX_USAGE`). Names come from the tables only, never from the command line.

| Switch | What it would otherwise allow |
| --- | --- |
| `js-flags` | Arbitrary V8 flags. Measured: removal reaches the renderers but not the main process. |
| `ignore-certificate-errors-spki-list`, `unsafely-treat-insecure-origin-as-secure` | Trust chosen keys or treat chosen origins as secure. Unmeasured. |
| `disable-site-isolation-trials`, `disable-site-isolation-for-policy` | Site isolation off. Unmeasured. |
| `disable-features` naming `IsolateOrigins`, `SitePerProcess` or `site-per-process` | Site isolation off (exact, case-sensitive tokens after splitting on commas and trimming, a `<study` or `:params` suffix cut off). Other entries keep working, including `ForceThirdPartyCookieBlockingEnabled`. |
| `allow-running-insecure-content` | Mixed content. Unmeasured. |
| `ssl-key-log-file`, `log-net-log` | Write TLS session secrets or a full network capture to a file of the launcher's choosing. Unmeasured. |

Everything in the refused table beyond `js-flags` is unmeasured and refused by default. A switch whose
removal fails (the call throws, or the switch is still present afterwards) is promoted to a refusal.

**Deliberately still honoured.** `--no-sandbox` and `--disable-gpu-sandbox` (some Linux hosts cannot start
the sandbox; running without it lowers protection and is the operator's choice). `--proxy-server` and its
relatives (operator ruling 2026-11-17). `GOLDFINCH_AUTOMATION_ADMIN`: whoever can set it already has full
access, and the admin tier still needs automation turned on and a minted key. `--user-data-dir`,
`--enable-features`, and `--disable-features` in general. `--allow-file-access-from-files` is on neither
list: Electron adds it to every launch itself while the `GrantFileProtocolExtraPrivileges` fuse is on (the
chrome is a `file://` page), so an operator-supplied copy changes nothing and listing it would refuse every
start.

**Not covered.** The process-launcher family (`--gpu-launcher`, `--renderer-cmd-prefix`,
`--utility-cmd-prefix`, `--browser-subprocess-path`): whether a refusal at the top of `main.js` is early
enough for them was not measured, so no protection is claimed; Electron's own argument check for URL-handler
launches is the existing defence. A local attacker who can edit files or the environment. Windows `/switch`
forms and case are handled by Chromium's parser; they were not run on Windows.

A relaunch (Shields *Restart now*) re-passes the original arguments, so a stripped switch is stripped again
and a launch that passed passes again.

**Adding a switch** is a table row plus a measurement of whether `removeSwitch` before `ready` stops its
effect (`docs/dev-testing.md` *Packaged build on a dev host*; observe the effect from outside the app). When
in doubt it goes in the refused table.

## Notes

- Pushing the release-prep commit straight to protected `main` relies on a **repo-admin
  bypass** of the pull-request rule (the maintainer pushes it directly). Everyone else opens
  a PR.
- The download links point at `vX.Y.Z` assets that don't exist until the build finishes — a
  short, expected window between the tag push and the installers appearing on the Release.
- To regenerate the links by hand for an arbitrary version:
  `node scripts/update-readme.mjs 0.11.1` (with no argument it uses the `package.json` version).
- The workflow's build job syncs `package.json` from the tag with `--ignore-scripts`, so the
  `version` hook never runs in CI — it only regenerates the README during local release-prep.
- **Electron major bump** — re-run the `third-party-cookie-isolation` behavior spec
  (`/mission-control:behavior-test third-party-cookie-isolation`) before releasing. Third-party
  cookie isolation depends on Chromium's `ForceThirdPartyCookieBlockingEnabled` feature name; an
  unknown `enable-features` name is silently ignored and header stripping no longer backs it up, so
  a bump that drops the feature would make isolation fail open with no other signal. (Also re-run
  the full store suite for `node:sqlite`.)
- **Release note for the first release carrying the vault upgrade (Mission 23, Flight 2)** — include verbatim: *"After you first unlock your vault on this version, your vault files are converted to a new file version (version 2) that earlier versions of Goldfinch cannot open, and a bundle exported by this version cannot be opened by an earlier version either. The only way back is a copy of your vaults directory made before that first unlock — copy it now: the `vaults` folder inside Goldfinch's data directory (Linux `~/.config/goldfinch/vaults`, macOS `~/Library/Application Support/goldfinch/vaults`, Windows `%APPDATA%\goldfinch\vaults`)."* No backup of the old files is kept by the app, on purpose (`docs/vault.md` → *The upgrade*).
- **Downloaded-file safety on the installers (operator ruling, Mission 23)** — on the Windows and macOS installers, download a file and confirm it carries the internet-origin mark (Windows Mark-of-the-Web) or the quarantine attribute (macOS), and that the system warns before running a downloaded program. If the mark is missing, writing it becomes the fix; this is not checked from CI.
- **By-eye checks for the first release carrying Mission 23 Flight 2 (installed build)** — the development host cannot show these (WSL raises no power events; WSLg bridges the clipboard to Windows), and the flight's acceptance walk was stopped early, so a person checks them once on a real install:
  1. **Vault locks on sleep / screen lock** — unlock the vault, sleep the machine (Windows/macOS: also try locking the screen), wake it; the vault is locked. On Linux only sleep locks the vault; screen lock does not (platform limitation).
  2. **A copied secret leaves the clipboard** — copy a password from the vault page, wait 25 seconds, paste; nothing pastes. Control: copy a password, then copy other text; the other text is still there after 25 seconds. On Windows, clipboard history (Win+V) may keep the entry — the app cannot remove it; a known limit, not a failure.
  3. **Quit with a secret on the clipboard** — copy a password, quit within ten seconds, then paste; record what pastes (best effort by design).
  4. **Reveal confirmation dialog (Windows, macOS)** — with an admin automation client attached, click the eye on a vault password; a native dialog appears parented to the window with Cancel as the default (press Enter: nothing is revealed), the window is usable the moment the dialog is answered, and switching tabs while it is open cancels it.
  5. **Vault upgrade on a real profile** — before the first unlock on this version, copy the `vaults` directory aside (paths are in the release note above); unlock, and every vault and item is present; an earlier version then cannot open the profile.
  6. **Jar-key shortcuts (Windows, macOS)** — with a jar-scoped automation key, send a quit chord (Ctrl+Q / Cmd+Q) with `pressKey` to a tab; the app does not quit. Press the same chord on the keyboard; it does.
- The Windows installer now registers Goldfinch as a browser (`build/installer.nsh`: `GoldfinchHTML`
  ProgID, `StartMenuInternet\Goldfinch` Capabilities, `RegisteredApplications`) so it appears under
  Settings → Apps → Default apps; the Linux `.deb` ships a `goldfinch.desktop` with the http/https
  `MimeType`. Updates re-run `customInstall` (idempotent) and skip the uninstall deletes
  (`${isUpdated}`-guarded), so the operator's default survives an update. Upgrading **from** a
  pre-include version runs that old uninstaller, which has no macro — expected. The Windows half is
  accepted by the sortie's Windows HAT (leg 3), not from CI. `desktopName: goldfinch.desktop` also
  changes the dev app_id/WM_CLASS (dev runs `electron .` against this `package.json`).
