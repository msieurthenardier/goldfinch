# Release notes

Every release page opens with hand-written notes from a file in this folder. This guide is the format; the
release workflow (`.github/workflows/build.yml`, job `create-release`) reads the files, and
`docs/RELEASING.md` says when to write them.

## File name and title line

One file per version: `docs/releases/vX.Y.Z.md` (`X.Y.Z` is the plain version, no prerelease part). The
first line is the release title and must read:

```
# vX.Y.Z — <title>
```

A `# `, then the file's own version with its `v`, a space, then the title text (an em dash is the house
separator). No trailing space, at most 200 bytes, no tab or other control character. Everything after the
first line, minus leading blank lines, is the release text (GitHub Markdown) and must not be empty. A
leading byte order mark and carriage returns are removed; a file larger than 65,536 bytes is not used.

## Shape

A one-line summary first. Then only the sections that have something to say, in this order:

1. **Before you upgrade** — only when there is something to do first (the model: a file conversion that an
   earlier version cannot undo, and what to copy beforehand).
2. **Added**
3. **Changed**
4. **Fixed**
5. **Notes** — known limits, what was checked where, and platform reports you want.

## Voice

Write for the person using the app: what changed for them, in plain words. No design ids, work-item names,
leg or squawk numbers, and no internal module names. Say what the app does, not how it was built.

## Honesty

Claim only what was verified, and say where. If something was checked on one platform, on a build runner,
or only in automated tests, say so; if it was not checked, say that. Do not turn "expected" into "fixed".

## Path hygiene

The repository is public. No local paths, user names, host names or keys. A generic per-OS data folder is
fine (`%APPDATA%\goldfinch`, `~/.config/goldfinch`, `~/Library/Application Support/goldfinch`).
`test/unit/release-notes.test.js` checks the common local-path patterns.

## How the workflow uses a file

- When a `vX.Y.Z` tag is pushed, `create-release` reads `docs/releases/vX.Y.Z.md` through the GitHub
  contents API **at the tagged commit** (no checkout, no project code runs in that job), splits it with
  inline shell, and creates the draft release with that title and text.
- A release candidate (`vX.Y.Z-rc.N`, or any tag with a prerelease part) uses its **target** version's
  file. Its title keeps the file's title with the version replaced by the tag (`v0.19.18-rc.1 — <title>`),
  and the text opens with `Release candidate for vX.Y.Z — for testing, not general use.` and a blank line.
  A build-metadata suffix (`+build`) alone is not a candidate.
- A notes release carries exactly the file's text: no generated pull request list and no "Full Changelog"
  link.
- If the file is missing, unreadable or malformed, the release is created as before (the tag as the
  title, GitHub's generated notes), a warning names the reason, and the run's summary reads
  `Release notes: generated (reason: <word>)`. A good file reads `Release notes: docs/releases/vX.Y.Z.md`.
  The step never fails because of the notes.
- If a **draft** already exists for the tag (a re-run), its title and text are replaced from the file. A
  published release is never edited by the workflow.

## Hand edits

Editing a published release's title or text (still allowed on an immutable release) is by hand, after the
exact text is approved: take the title and body from the same file through the same splitter, then
`gh release edit vX.Y.Z --title "$title" --notes-file "$body"`.

## Example

```markdown
# v1.4.0 — Faster downloads and a new Shields switch

This release speeds up downloads and adds a switch for blocking pop-ups.

## Added

- **A pop-up switch in Shields.** Turn it on to stop pages opening new windows. Checked on Linux and
  Windows.

## Fixed

- **Retrying a failed download works again** when the tab it came from was closed. Checked on Linux.

## Notes

- Not checked on macOS.
```
