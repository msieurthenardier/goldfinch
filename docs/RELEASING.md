# Releasing

Releases are **tag-driven**: pushing a `vX.Y.Z` tag runs `.github/workflows/build.yml`,
which builds installers for Windows/macOS/Linux and publishes a GitHub Release with them
attached. Nothing else is needed to ship the binaries.

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
build-only smoke check (`--publish never`, no artifact upload — see the workflow header for the
storage-quota history): it proves compilation but yields no installer. To get one for a human
acceptance test, push a strict-semver **prerelease** tag on the commit under test:

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
