# Update check

Goldfinch tells you when a newer **stable** release exists. It never downloads anything on its own and
never installs or runs anything: the check only remembers a version number, and you choose what happens
next - open the release page in a tab, or press **Download now** to start an ordinary download of the
installer for your computer (below).

## What is asked, and when

- One `GET` to `https://api.github.com/repos/msieurthenardier/goldfinch/releases/latest` (GitHub's
  public "latest release" answer, which excludes prereleases and drafts).
- The first check runs about 60 seconds after startup, then every 24 hours measured from the start of
  the previous check (a machine that slept simply checks late; there is no catch-up burst). A check
  never overlaps another and a request is abandoned after 15 seconds.
- Only the answer's `tag_name` is believed, and only when it is a strict stable version
  (`v` + `MAJOR.MINOR.PATCH`, no prerelease or build suffix). Nothing else from the response is shown,
  stored or opened; the release address is built by the app from the validated version.
  A body larger than 512 KiB is abandoned unread.
- A refusal, a rate limit, an error, a redirect (a renamed or moved repository answers 301, and a
  redirect is never followed) or a network failure is **silent**: nothing is shown and the previous
  state is kept. The unauthenticated GitHub API limit is 60 requests per hour per address, far above
  one a day.

## What the request carries

`GET` with `User-Agent: Goldfinch-update-check` and `Accept: application/vnd.github+json`, plus what
Chromium's network stack adds (`Accept-Encoding`, `Accept-Language`, `Sec-Fetch-*`; the last two reveal
the browser's language preference and that the request is a fetch, an accepted disclosure). It sends **no
cookies** (credentials omitted, a sign-in challenge is never answered), **no `Referer`, no `Origin`,
no `Authorization`**, is never served from or stored in a cache, and carries neither the app version
nor an `Electron/` token. It goes through the main process, not through any cookie jar or tab, and
follows the **system proxy** like the rest of the browser. GitHub sees the machine's network address,
as for any web request.

## State and bridge

`{ current, available, releaseUrl, checkEnabled, downloadName }` — held in main (`src/main/update-check.js`),
pushed to every chrome and internal page as `update-state-changed`, read with `update:get-state`.
`checkEnabled` is the setting's value only. Opening the release page (`update:open-release-page`,
`internal-update-open-release-page`) takes **no argument**: main sends the address it built to the
chrome of the calling window, which opens it as an ordinary tab. `downloadName` is computed in `getState()`
from `available` and this machine (null when nothing is available or no direct installer exists), never stored.

## Where it shows

- **Settings -> About**: `Goldfinch <version>` always, showing the running version whenever it is well-formed (prerelease and build suffix included, e.g. `0.19.15-rc.2`; `Goldfinch` alone if it is missing or malformed); when a newer release is known, `Version <x> is available.`
  and, when this machine has a direct installer, a **Download now** button with a hint line (see *Download now*),
  plus a **View release notes** button (which opens the release page through the no-argument channel above).
  With no direct installer for the machine the hint reads "Download the installer for your system from the
  release page, then run it to update." and there is no download button.
- **The kebab menu**: an `Update available — <x>` item at the top, present only while a newer release is
  known. There is no toolbar element.
- Both are drawn from one pure model (`src/shared/update-notice-model.js`) over main's state, never from
  anything the page or chrome fetched. The behavior spec is `tests/behavior/update-notice.md`; its release
  endpoint stand-in is `tests/behavior/fixtures/update-check/server.cjs`.

## Download now

Settings -> About, when a newer release is known and this machine has a direct installer. One no-argument
channel (`internal-update-download`, internal pages only) makes the main process start **one ordinary
download** of an address it builds itself: `https://github.com/msieurthenardier/goldfinch/releases/download/v<version>/<installer>`,
from the constant repository slug, the validated version and a fixed installer name - never from the check's
response, the release address or the developer override.

| This machine | Installer |
|---|---|
| Windows | `Goldfinch-Setup-<v>.exe` |
| macOS, Apple silicon | `Goldfinch-<v>-arm64.dmg` |
| Linux x64, running from an AppImage | `Goldfinch-<v>.AppImage` |
| Linux x64, otherwise | `goldfinch_<v>_amd64.deb` |
| anything else (an Intel Mac, Linux on another architecture) | none: only the release page is offered |

Emulation is not seen through: an x64 build under Rosetta reports an Intel Mac and gets no button, and
Windows on ARM gets the x64 installer.

- **It is an ordinary download**: through the browser's own default session (which holds no site cookies), into
  the downloads folder, under the name Chromium derives (normally the asset's own name), shown in the
  toolbar indicator and on `goldfinch://downloads`. No native dialog is raised. Because the record has no
  identity (jar), the downloads page offers no Retry for it - press **Download now** again. A second press
  while this download is still in progress starts nothing. "This download" is a record at exactly that
  address, or one with no identity whose saved file name is the expected installer name (also with the
  ` (n)` suffix added before the extension), because GitHub redirects the request and the stored address
  is probably the redirect target. The operator saw a real download from this button on Windows on a release
  candidate (`v0.19.15-rc.3`, 2026-11-17; Flight 3 flight log, leg 11). It has not been seen on macOS or Linux,
  and the walk record does not say what address the finished record held.
- **The app never opens, runs or verifies the file.** Opening it from Downloads goes through the existing
  single open function, and the operating system then asks before running it. To check the file, use the
  digest and attestation commands in the README.
- **A developer build still builds the github.com address** (the override only moves the check). The
  behavior spec runs with a dead proxy for exactly that reason.
- A failure to connect leaves an `interrupted` record (shown as Failed) and no file in the downloads folder.

## Turning it off

The **Check for new versions** checkbox in Settings -> About sets it.

Setting `updateCheckEnabled` (default `true`, changeable over the settings bridge). Switching it off
clears the state, aborts a request in flight and stops the schedule; switching it on checks at once.

## Developer variables (unpackaged builds only)

- `GOLDFINCH_UPDATE_CHECK_URL` — an `http://127.0.0.1:<port>/…` or `http://localhost:<port>/…` address
  to check instead of GitHub (first check after 1 second). A packaged build ignores it, and an
  unpackaged build without a loopback value makes **no request at all**.
- `GOLDFINCH_UPDATE_TRACE=1` — prints `[update-check] outcome=<code>`, one of `newer`, `current`,
  `disabled`, `http-<status>`, `redirect`, `too-large`, `bad-json`, `bad-tag`, `network`, `aborted`,
  `timeout`. (Measured: a `407` answered by a non-proxy origin surfaces as `network`, because Chromium
  treats an unexpected proxy-auth answer as a transport failure.)
