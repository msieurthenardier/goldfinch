# Releasing

Releases are **tag-driven**: pushing a `vX.Y.Z` tag runs `.github/workflows/build.yml`,
which builds installers for Windows/macOS/Linux and publishes a GitHub Release with them
attached. Nothing else is needed to ship the binaries. A stable tag is made on a commit that is
already on `main` (see *Cut a release*); the workflow refuses a stable tag that is not.

## The release workflow

Four jobs. The one that runs project code (dependency install scripts, the build) cannot write
to the repository or the release; the one that writes runs none of it.

| Job | Runs on | Permissions | May do |
| --- | --- | --- | --- |
| `create-release` (tags only) | Linux | `contents: write` | Validates the tag as strict semver, classifies stable vs prerelease, for a **stable** tag requires its commit to be reachable from the default branch (see *The stable-tag rule*), then creates the **draft** release with the hand-written notes from `docs/releases/vX.Y.Z.md` (see *Release notes*). `gh` and inline shell only; no checkout, no project code. |
| `build` (mac / linux / win) | one runner each | `contents: read`, no token or secret anywhere in the job | Checkout (credentials not persisted), on the Linux entry only `npm audit --audit-level=high` (before anything is installed), `npm ci`, version from the tag, `electron-builder --publish never`, fuse check on the unpacked app, macOS ad-hoc signature verification, one start of the unpacked app, then stages that platform's installers **by exact name** with their SHA-256 list and the version, and uploads them as a one-day, uncompressed Actions artifact. |
| `upload` | Linux | `contents: write`, `id-token: write`, `attestations: write` | No checkout, no `node` / `npm`. Downloads the three artifacts, recomputes every digest, asserts the file names are exactly the five expected for the tag's version, then `gh release upload` into the draft (the token is given to that one step), then `actions/attest` creates a provenance attestation for exactly those five verified files (tag builds only). The signing permissions exist in this job and no other. |
| `publish-release` (tags only) | Linux | `contents: write` | Flips the draft to published: stable tag -> latest, prerelease tag -> prerelease. Only after `upload` succeeded. |

The digest comparison proves the files were not changed between jobs; it does not prove the build
job was honest (that job is the party being contained).

**A release holds five installers and nothing else**: `Goldfinch-Setup-X.exe`, `Goldfinch-X-arm64.dmg`,
`Goldfinch-X-arm64-mac.zip`, `Goldfinch-X.AppImage`, `goldfinch_X_amd64.deb`. The updater metadata the
builder can write (`latest*.yml`, `*.blockmap`) is no longer published, and a release carries none: the
app notifies about a new version, it does not self-update (accepted, 2026-11-17). The names are set per
target in `package.json` (`artifactName`) and are the ones `scripts/update-readme.mjs` links
(`test/unit/artifact-names.test.js`).

What a release carries beyond the files: GitHub's SHA-256 digest for each asset (shown on the release
page; `gh api repos/msieurthenardier/goldfinch/releases/latest -q '.assets[] | "\(.name) \(.digest)"'`),
one build provenance attestation per installer (made by the `upload` job), and, once the repository's
immutable-releases setting is on, a release attestation made by GitHub when the release is published. No
checksum file is published. The attest step ran on all three release candidates of the acceptance walk
(2026-11-17): five subjects each, with `contents: write`, `id-token: write` and `attestations: write`
only (`artifact-metadata: write` is not needed). `v0.19.15-rc.2` is the first immutable release, so the
first with a release attestation; the walk verified one with `gh release verify` (Flight 3 flight log,
leg 11).

**A manual dispatch runs everything except the upload and the release steps**: it builds, checks and
stages the installers and runs the `upload` job's name and digest checks, and publishes nothing. The
staged installers stay on the run as one-day artifacts.

The invariants (every `uses:` pinned to a full SHA with a `# vX.Y.Z` comment; the build job's
`contents: read`, no token and no persisted checkout credentials; the upload job running no project
code; `--publish always` appearing nowhere; one-day, uncompressed artifacts; the upload job's exact
permission set and one tag-gated attest step after the upload, whose subjects are the verified list only)
are pinned by `test/unit/release-workflow-invariants.test.js`, a text scan of the workflow files. The
stable-tag decision function is extracted from the workflow and run against canned answers by
`test/unit/stable-tag-check.test.js`.

## The audit gate

The `build` job's Linux entry runs `npm audit --audit-level=high` right after Node is set up and
**before `npm ci`** (it reads `package-lock.json` and needs no install, so no project install
script runs ahead of the gate; the lockfile is platform-independent, so one entry is enough). It runs on
a tag and on a manual dispatch. `upload` needs every `build` entry to succeed, so a failed audit stops
the upload, the attestation and the publish even though the other platforms finish (`fail-fast: false`).

- A failed audit leaves the draft release behind; the next run reuses it. Harmless.
- An advisory published after a commit merged can fail a later tag. That is intended: fix it with a dependency bump, never by lowering the gate.
- A transient registry or advisory-API failure fails the release closed. The remedy is a re-run. Never add retry-then-pass logic.
- `ci.yml` and `ci/tasks/audit.yml` remain the PR-time gates; this step is the release's own, so a release cannot be cut from a commit that never passed.
- The step's first live confirmation on the tag path is the next real release (candidate or stable); a manual dispatch shows it runs and passes on the dispatch path only.

## The stable-tag rule

In `create-release`, after the semver validation and before the draft exists, a **stable** tag
(`vX.Y.Z`, no prerelease part; decided from the tag string, never from a name) is checked against GitHub's
compare endpoint: `repos/<repo>/compare/<default branch>...<tagged commit>`. `identical` or `behind` means
the commit is contained in the default branch and the run goes on; `ahead`, `diverged`, a 404, any error
and any unparseable answer stop the run with no release created. One retry after about ten seconds covers
a tag pushed seconds ago (a 403 is not retried). A prerelease tag skips the check.

What this proves is that the tagged commit is **reachable from the default branch**: not that it is the
branch head, and not that it passed checks. It matters because the app's update notice believes
`releases/latest`, so a stable release must come from history that is on `main`. A refused run is
recoverable (merge, then tag the merged commit); a stable release from unreviewed history is not. The
check ran at the acceptance walk (2026-11-17) on an annotated stable-looking tag on a commit not on `main`: compare
answered `ahead` and the run refused, creating no release. That showed `GITHUB_SHA` on an annotated tag is
the tagged commit and that the job's token may call the compare endpoint. **Still not exercised:** a stable
tag on a `main` commit passing the check; the next real release is its first run.

## Release notes

Each release's title and text come from `docs/releases/vX.Y.Z.md`; the format is `docs/releases/README.md`.
`create-release` reads the file through the contents API at the tagged commit and splits it with inline
shell (no checkout, no project code in a job that holds the write token). A candidate reads its target
version's file and gets the tag in its title and a candidate line in its text. A missing or malformed file
falls back to generated notes with a warning and a line in the run summary, and never fails the run. A
re-run on a still-draft release re-applies the file; a published release is never edited by the workflow
(a re-run on one reaches only that no-edit branch, and that draft re-edit has been run against a stub
`gh`, not live). `test/unit/release-workflow-invariants.test.js` executes the workflow's own shell against
every notes file and the edge cases.

**What `npm test` guarantees:** the file for `package.json`'s version is **present** in every commit the
tests pass on (`test/unit/release-notes.test.js`), and every notes file has its own version in its title
line. It goes red at the bump only if the file was not committed earlier; a file written ahead of the bump
(as for a candidate, which reads its target version's file) keeps the bump green. Both are fine. It is a
test-time rule: a hand-made tag on a commit without the file still publishes, with generated notes and the
summary line saying why.

**Editing a published release's notes** is by hand, after the exact text is approved, from the same file
through the same splitter (`docs/releases/README.md`, *Hand edits*). Only the assets and the tag of an
immutable release are locked.

## Cut a release

Releases are cut the way the repository is protected: the version bump arrives by pull request, and the tag
is made on the **merged commit on `main`** afterwards. The tag never exists before its commit is on `main`.

From a clean, up-to-date `main` with green gates (`npm test`, `npm run typecheck`, `npm run lint`):

```bash
git switch -c release-prep/vX.Y.Z
npm version patch --no-git-tag-version      # or minor / major
# write docs/releases/vX.Y.Z.md (format: docs/releases/README.md); the operator approves the text in the PR
git add docs/releases/vX.Y.Z.md             # -a below takes tracked files only
git commit -a -m "release-prep: bump to X.Y.Z"
git push -u origin release-prep/vX.Y.Z
```

The notes file goes in the same commit as the bump. Without the `git add`, `git commit -a` leaves a new
file out, a pre-push test run on your working tree passes, and `main` goes red after the squash-merge.

Open a pull request, let the checks run, squash-merge it. Then:

```bash
git switch main && git pull --ff-only
git log -1                                  # confirm this is the squash commit of the release-prep pull request
git tag -a vX.Y.Z -m "vX.Y.Z"               # on that commit
git push origin vX.Y.Z
```

Tagging the branch's own commit (before the merge) is refused by the stable-tag check, because a squash
merge makes a different commit.

`npm version … --no-git-tag-version` still runs the lifecycle hooks (checked in a scratch clone): the
**`preversion` guard** (`scripts/check-psl-fresh.mjs`, offline) refuses the bump (non-zero exit) when the
vendored Public Suffix List snapshot (`src/main/public_suffix_list.dat`) is more than 90 days old, then it
bumps `package.json` + `package-lock.json`, then the **`version` hook** (`scripts/update-readme.mjs`)
regenerates the README download block and stages `README.md`. It creates **no commit and no tag**, and its
`-m` flag does nothing here, which is why the commit is made by hand (`-a` takes the two unstaged files; the
README is already staged). The README's verify section sits outside the generated block and is not touched.

If the PSL guard refuses:

1. `node scripts/update-psl.mjs` (fetches only publicsuffix.org, validates, overwrites the `.dat`
   and the `Snapshot:` line in `src/main/psl.js`; never commits),
2. re-check `SUPPLEMENT_SUFFIX` in `src/main/trackers.js` (amazonaws.com, netlify.com, surge.sh,
   glitch.me) against the new `.dat`,
3. `npm test` (`psl.test.js` runs against the vendored `.dat`) and review the curated `TRACKERS` table,
4. commit the refresh as its own reviewed change, then cut the release.

Refresh proactively too if it has been a while. The README download-link bump is folded into the
release-prep change, so there is no post-release job pushing back to `main`. (That job was removed: it
needed the `github-actions` bot to bypass the `main` ruleset, which it cannot.)

The tag fires the build workflow; the installers publish a minute or two later, at which point the
download links written into the release-prep change go live.

## Rollback

Under immutable releases a published release cannot be changed, and deleting one does **not** free its
tag name: the name is spent, and a git tag for a published release cannot be moved or deleted while the
release exists. So never re-tag. To undo a bad release, publish the **next patch version** with the fix
(the title, notes and prerelease / latest flags of the bad one stay editable, so it can be marked a
prerelease or annotated). A release published before immutability was turned on is not covered and can
still be deleted with its tag; `v0.19.15-rc.2` is the first immutable release (`v0.19.15-rc.1` was
published before the setting was on and is not immutable).

## One-time repository settings

Two settings, applied once by the repository owner (the exact commands, confirmation reads and undo
calls are in the Mission 23 flight 03 log, *Leg 08 operator runbook*). Neither is applied by the workflow.
Both are applied and were observed at the acceptance walk (2026-11-17; Flight 3 flight log, leg 11).

- **A tag ruleset on `v*`** restricting creation, updates and deletion, with the repository-administrator
  role on the bypass list so the owner's own tag push still works (ruleset `release-tags`; GitHub stores the `update` rule
  without the `update_allows_fetch_and_merge` parameter for a tag ruleset; the owner's tag pushes are
  accepted under it, and it does not stop the workflow's token creating a release for an existing tag). Reason: without it anyone with write
  access can create or move a `v*` tag, and a tag is what fires the release workflow.
- **Immutable releases** (Settings -> Releases). Reason: after publishing, the assets and the tag are
  locked, so a published installer cannot be swapped and a name cannot be reused; GitHub also writes a
  release attestation. Applies only to releases published after it is enabled. A prerelease is immutable
  like any other release; a draft stayed writable until it was published.

Order, as run: the tag ruleset, then the first release candidate (proved the tag path, the attestation, and
that the ruleset lets the workflow create its release), then immutability, then a second candidate (showed a
prerelease is immutable too).

## Verifying a release

For a downloader, `README.md` has the commands (digest comparison, `gh attestation verify <file> -R
msieurthenardier/goldfinch --signer-workflow msieurthenardier/goldfinch/.github/workflows/build.yml`, and
`gh release verify` / `gh release verify-asset` for an immutable release). They need a recent GitHub CLI
with those commands. They were run at the acceptance walk (2026-11-17) on Linux with GitHub CLI 2.104.0:
`gh attestation verify` as written in the README succeeded on a downloaded installer (and failed for a wrong
workflow and for a modified file); `gh release verify <tag>` and `gh release verify-asset <tag> <file>`
succeeded on an immutable candidate. In a terminal a successful `gh attestation verify` prints the policy it
enforced and "Verification succeeded!"; with output redirected it prints nothing and exits 0. The CLI on the
development host (2.45.0) has none of these commands. **Not run on Windows or macOS.** What a pass shows: the file was built by this repository's release workflow from the named commit.
It does not show the code is safe and is not an operating-system signature (SmartScreen and Gatekeeper
still warn).

## Release candidates and hands-on builds

WSL can't build the NSIS installer. A manual `workflow_dispatch` run of `build.yml` builds, checks and
stages the real installers and uploads them to no release (see *The release workflow*); they stay on the
run as one-day artifacts. **A hands-on Windows or macOS check needs only that run's artifacts** — no public
release.

A **prerelease tag** is needed only when the *published path itself* is under test (the draft, the upload,
the attestation, the publish), or when the update notice is: a candidate tagged **below** the current
stable version, so the notice is exercised without becoming "latest". Push a strict-semver prerelease tag
on the commit under test:

```bash
git tag -a vX.Y.Z-rc.N <commit> -m "release candidate"
git push origin vX.Y.Z-rc.N
```

Use the next release's version with `-rc.N`. No version-bump commit is needed: the workflow's "Set version
from tag" step syncs `package.json` from the tag. A prerelease tag publishes a GitHub **prerelease** (not
"latest") and skips the stable-tag check, so the commit need not be on `main`. **Each `-rc.N` is used
once**: with immutable releases on, a deleted release's tag name cannot be reused, so a re-check is the
next `N`. Before immutability is on, `gh release delete vX.Y.Z-rc.N --yes --cleanup-tag` still cleans up
(and the local tag with `git tag -d`); after it, do not expect to. This is **outward-facing** — the
prerelease is public — so only tag commits you're willing to publish.

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
`file://` page), `enableCookieEncryption` (**not turned on, accepted**: operator ruling 2026-11-17 after
measurement; see *Accepted, not fixed* below), and `WasmTrapHandlers` (Electron's own default, on). `scripts/check-fuses.mjs` pins the whole
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

### Accepted, not fixed (release side)

Each is a recorded decision, with the reason and who decided it, in the *Dispositions* section of
`missions/23-security-review-remediation/mission.md`; this is the one line an operator of the release would look for.

- **No operating-system code signing** (finding 7; operator decision 2026-11-12). SmartScreen and Gatekeeper still warn.
- **Cookies are stored unencrypted at rest** (finding 8; operator ruling 2026-11-17). The cookie-encryption fuse protects
  little without an operating-system keyring, is one-way, and could not be verified on macOS. Windows DPAPI and the macOS
  keychain were not measured (`missions/23-security-review-remediation/flights/03-shipping-and-at-rest/packaged-measurements.md`).
- **No integrity check of the code on disk** (finding 8): `asar: false` is load-bearing, and the two archive-integrity
  fuses need `asar`.
- **Launch switches left honoured or not covered** (finding 19): see *Launch switches* below.
- **Repository settings, applied and observed (not accepted risks):** the tag ruleset and immutable releases (*One-time
  repository settings*), applied and observed at the acceptance walk, 2026-11-17.

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

## Release checklist: by-eye items

Things the development host (Linux under WSL) cannot show, carried from Mission 23's flights. Each has one owner
column: **walk** says whether Flight 3's leg `hat-and-alignment` (the acceptance walk on a release candidate; flight
plan DD8) is planned to walk it. That leg strikes an item it has walked (the row stays, marked walked with the date and candidate). An item nobody has walked is not accepted by eye, it is unwalked.

| # | What to look at | Platform | Walk |
| --- | --- | --- | --- |
| 1 | **Internet-origin mark on downloads (Flight 1, operator ruling).** Download a file with the installer build and confirm it carries the internet-origin mark (Windows Mark-of-the-Web) or the quarantine attribute (macOS), and that the system warns before running a downloaded program. If the mark is missing, writing it becomes the fix. Not checked from CI. | Windows, macOS | Planned (DD8 "the seven carried items") |
| 2 | **Vault locks on sleep and screen lock (Flight 2).** Unlock the vault, sleep the machine (Windows and macOS: also lock the screen), wake it; the vault is locked. On Linux only sleep locks it (platform limitation). | Windows, macOS, Linux | Planned (DD8) |
| 3 | **A copied secret leaves the clipboard (Flight 2).** Copy a password from the vault page, wait 25 seconds, paste: nothing pastes. Control: copy a password, then copy other text; the other text is still there after 25 seconds. On Windows, clipboard history (Win+V) may keep the entry; the app cannot remove it, which is a known limit, not a failure. | Windows, macOS, Linux | Planned (DD8) |
| 4 | **Quit with a secret on the clipboard (Flight 2).** Copy a password, quit within ten seconds, then paste; record what pastes (best effort by design). | Windows, macOS, Linux | Planned (DD8) |
| 5 | **Reveal confirmation dialog (Flight 2).** With an admin automation client attached, click the eye on a vault password; a native dialog appears parented to the window with Cancel as the default (press Enter: nothing is revealed), the window is usable the moment the dialog is answered, and switching tabs while it is open cancels it. | Windows, macOS | Planned (DD8) |
| 6 | **Vault upgrade on a real profile (Flight 2).** Before the first unlock on this version, copy the `vaults` directory aside (paths are in the vault-upgrade release note under *Notes* below); unlock, and every vault and item is present; an earlier version then cannot open the profile. | Any | Planned (DD8) |
| 7 | **Jar-key shortcuts (Flight 2).** With a jar-scoped automation key, send a quit chord (Ctrl+Q / Cmd+Q) with `pressKey` to a tab; the app does not quit. Press the same chord on the keyboard; it does. | Windows, macOS | Planned (DD8) |
| 8 | **The kebab menu's "Update available" item (Flight 3).** With a newer release offered, the kebab shows the item, it opens the release page in a tab, and it is absent when there is no newer release. Seen only through the model and unit tests so far. | Any (a desktop with a display) | **Walked** 2026-11-17, `v0.19.15-rc.3`, Windows (operator: pass). Linux and macOS not seen. |
| 9 | **A refused launch switch on an installed build (Flight 3).** Launch the installed app with a refused switch (for example `--js-flags=--expose-gc`): it exits with code 64 and shows an error box naming the switch. On Linux the box printed two stderr lines and no window. | Windows, macOS | Planned (the plan lists "a refused switch on an installed build") |
| 10 | **Windows `/switch` forms and case (Flight 3).** `goldfinch.exe /remote-debugging-port=9222` and a differently cased form are stripped or refused the same way as the `--` forms. Handled by Chromium's parser; never run on Windows. | Windows | Not named in the plan; the Flight Director assigns it |
| 11 | **The macOS build on real hardware (Flight 3).** The app opens after the fuse change and the ad-hoc re-sign. Verified only on the build runner (`codesign` valid, one start check), never on a Mac. | macOS (Apple Silicon) | **Not walkable by the operator** (no Apple hardware, ruling 2026-11-17); the release notes ask macOS users to report a build that will not open |
| 12 | **The Settings About section's spacing (Flight 3).** The version line, the update status, the button and the checkbox row sit with sensible spacing (the checkbox row sat directly under the button in the spec run). | Any | **Walked** 2026-11-17, `v0.19.15-rc.3`, Windows (operator: pass, after the layout fix). |
| 13 | **Flight 1's unwalked acceptance groups 2 to 6 and Flight 2's groups 3 to 7** (sheet cards behind the newly guarded channels, tabs and media, downloads and address bar, a second window, wording; the rest of Flight 2's walk). Each has unit or behavior-test coverage; nobody has looked. | Any | Not in the plan's seven; no owner assigned; the Flight Director decides |
| 14 | **The About "Download now" button (Flight 3).** Press it on macOS and on Linux; the installer for that platform downloads. A real download was seen only on Windows (`v0.19.15-rc.3`, operator, 2026-11-17). | macOS, Linux | Not walkable by the operator on macOS; Linux not assigned; the Flight Director decides |

## Notes

- The release-prep change goes through a pull request like any other (the `main` ruleset requires it);
  the tag is pushed afterwards, on the merged commit.
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
- **By-eye release checklist** — see *Release checklist: by-eye items* above. Items are struck there by the leg or the person who walks them.
- The Windows installer now registers Goldfinch as a browser (`build/installer.nsh`: `GoldfinchHTML`
  ProgID, `StartMenuInternet\Goldfinch` Capabilities, `RegisteredApplications`) so it appears under
  Settings → Apps → Default apps; the Linux `.deb` ships a `goldfinch.desktop` with the http/https
  `MimeType`. Updates re-run `customInstall` (idempotent) and skip the uninstall deletes
  (`${isUpdated}`-guarded), so the operator's default survives an update. Upgrading **from** a
  pre-include version runs that old uninstaller, which has no macro — expected. The Windows half is
  accepted by the sortie's Windows HAT (leg 3), not from CI. `desktopName: goldfinch.desktop` also
  changes the dev app_id/WM_CLASS (dev runs `electron .` against this `package.json`).
