# Update check

Goldfinch tells you when a newer **stable** release exists. It never downloads, installs or runs
anything: it only remembers a version number and offers to open the release page in a tab.

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
Chromium's network stack adds (`Accept-Encoding`, `Accept-Language`, `Sec-Fetch-*`). It sends **no
cookies** (credentials omitted, a sign-in challenge is never answered), **no `Referer`, no `Origin`,
no `Authorization`**, is never served from or stored in a cache, and carries neither the app version
nor an `Electron/` token. It goes through the main process, not through any cookie jar or tab, and
follows the **system proxy** like the rest of the browser. GitHub sees the machine's network address,
as for any web request.

## State and bridge

`{ current, available, releaseUrl, checkEnabled }` — held in main (`src/main/update-check.js`),
pushed to every chrome and internal page as `update-state-changed`, read with `update:get-state`.
`checkEnabled` is the setting's value only. Opening the release page (`update:open-release-page`,
`internal-update-open-release-page`) takes **no argument**: main sends the address it built to the
chrome of the calling window, which opens it as an ordinary tab.

## Where it shows

- **Settings -> About**: `Goldfinch <version>` always; when a newer release is known, `Version <x> is available.`
  and a **View release notes** button (which opens the release page through the no-argument channel above).
- **The kebab menu**: an `Update available — <x>` item at the top, present only while a newer release is
  known. There is no toolbar element.
- Both are drawn from one pure model (`src/shared/update-notice-model.js`) over main's state, never from
  anything the page or chrome fetched. The behavior spec is `tests/behavior/update-notice.md`; its release
  endpoint stand-in is `tests/behavior/fixtures/update-check/server.cjs`.

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
