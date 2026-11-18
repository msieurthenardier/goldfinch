# Sortie: Release notes — hand-written notes on every release page

**Status**: completed

> Architect design review 2026-11-17: **approve with changes**, incorporated — the file name and title prefix use `base` (MAJOR.MINOR.PATCH), not the validation step's `core`, which keeps a candidate's prerelease suffix; the release-prep sequence adds the notes file explicitly (`git commit -a` skips a new file); the enforcement is stated as "present in every passing commit"; draft detection fails closed; the splitter's byte limits, control-byte check and file outputs are specified; the extraction helper takes a name and asserts exactly one definition; a fallback is written to the run's step summary; the path check stays narrow and squawk 0204 stays open.

## Charter

### Outcome
Every Goldfinch release page opens with hand-written notes that say, in plain terms, what changed and what to do before upgrading, instead of a bare list of merged pull requests.

### Why Now
At Mission 23 Flight 3's acceptance walk (2026-11-17) the operator said "we need a better release notes page and process" (the content, not an in-app "what's new"). v0.19.16 and v0.19.17 shipped with GitHub's generated one-line notes, and the in-app "View release notes" button (Settings → About) lands on exactly those pages. The Flight 3 debrief listed "hand-written release notes published by the workflow" as a sortie candidate; the Sortie 09 debrief's recommendation 4 named it the next update-area sortie.

### Success Criteria
- [x] A release whose notes file exists publishes with that file's title and text; a release candidate (`-rc.N`) uses its target version's file. With no file, or a malformed one, the release publishes as today (tag title, generated notes) and never fails.
- [x] `npm test` fails when `package.json`'s version has no notes file, or a notes file's title doesn't start with its own version — so writing the notes is part of the release-prep pull request.
- [x] v0.19.16 and v0.19.17 on GitHub carry hand-written notes the operator approved word for word.
- [x] The publishing path is proven on a real release candidate (`v0.19.18-rc.1`) before the next stable release.

### Constraints
- The release workflow's hardening holds: the build job holds no token; `create-release` runs no project code (it reads the notes file through the GitHub API at the tagged commit, no checkout); actions stay SHA-pinned, no new third-party action; a stable tag must still be on `main`.
- The workflow never re-titles or re-notes a release that is already published. Edits to published releases are by hand, after the operator approves the exact text.
- No GitHub-provided text reaches the app's DOM; the app's update code is unchanged.
- The notes claim only what was verified (where something was checked only on a build runner or only on Linux, they say so), and carry no local paths, user names or host names.

Operator answers at chartering (2026-11-17): modelled on the-one's release notes (`docs/releases/vX.Y.Z.md`); the notes shape is **the-one's shape plus a "Before you upgrade" section** when there is something to do first; a release candidate's page reads **"v0.19.18-rc.1 — <title>" with an opening candidate line**. Charter agreed: "looks good".

---

## Pre-Flight

### Objective

Make hand-written, per-version release notes the source of every release page's title and text: a committed file per version, published by the release workflow without weakening its hardening, enforced at the version bump by a unit test, documented in the release process, and applied to the two releases already published without them.

### Open Questions

- [x] Notes shape — operator: the-one's shape plus "Before you upgrade".
- [x] Release-candidate page — operator: tag title plus a candidate line, borrowing the target's notes.
- [x] **Can a published immutable release's notes be edited?** Yes — GitHub's immutable-releases page: "Only the assets and tag are locked." and "You can still edit the title and release notes of a published immutable release". Verified 2026-11-17 (docs; the `gh release edit` call itself is exercised at the walk).
- [x] **Can `create-release` read a committed file without a checkout?** Yes — `gh api -H "Accept: application/vnd.github.raw+json" "repos/<owner>/<repo>/contents/<path>?ref=<sha>"` returned the raw file at the v0.19.17 commit and a clean `HTTP 404` for a missing path (probed 2026-11-17 with the operator's token; the job's `GITHUB_TOKEN` already holds `contents: write`, which includes read).
- [x] **Who writes the notes?** The Flight Director drafts them at release-prep from the flight and sortie artifacts (logs, debriefs, measurements); the operator approves the text in the release-prep pull request. In this sortie the Developer drafts v0.19.16 and v0.19.17 from named sources, and the operator approves both word for word at the walk.
- [x] **Releases before v0.19.16** — untouched (out of charter).

### Design Decisions

**DD1 — One file per version: `docs/releases/vX.Y.Z.md`.**
- First line `# vX.Y.Z — <title>`: the title as it appears on GitHub, starting with its own version (the em dash is the house separator; the test requires the version then a space).
- Everything after the first line (leading blank lines trimmed) is the release text, GitHub Markdown.
- Shape (operator): a one-line summary; then only the sections that have content, in this order: **Before you upgrade** (only when there is something to do first — v0.19.16's vault file conversion is the model), **Added**, **Changed**, **Fixed**, **Notes** (known limits, what was verified where, platform reports wanted).
- Written for the person using the app: what changed for them, no internal design ids, leg slugs or squawk numbers. Every claim limited to what was verified, saying where (Flight 3 draft's rule). No local paths, user names or host names (the repository is public); a generic per-OS data folder (`%APPDATA%\goldfinch`, `~/.config/goldfinch`) is allowed.
- `docs/releases/README.md` is the format guide (modelled on the-one's), and says how the file is used by the workflow.
- Rationale: matches the-one (operator's reference), keeps notes in the release-prep pull request where they are reviewed with the bump, and one file per version keeps a candidate's lookup trivial.

**DD2 — Published by `create-release`, read through the contents API, split by inline shell.**
- In `create-release`'s "Create the draft release" step, recompute inline from `GITHUB_REF_NAME` (already validated as strict semver by the earlier step of the same job): `ver="${GITHUB_REF_NAME#v}"`, **`base="${ver%%[-+]*}"`** (MAJOR.MINOR.PATCH only — the file name and the title prefix). **Not the validation step's `core`**: `build.yml:68` `core="${ver%%+*}"` strips only build metadata, so for `v0.19.18-rc.1` it is `0.19.18-rc.1` (Architect review, high). Fetch `docs/releases/v${base}.md` with `gh api -H "Accept: application/vnd.github.raw+json" "repos/${GITHUB_REPOSITORY}/contents/docs/releases/v${base}.md?ref=${GITHUB_SHA}"` into a file under `RUNNER_TEMP` (a non-zero `gh api` exit is a fallback), then split it with a shell function `split_release_notes` defined inline in the step.
- **No project code runs in this job** (it holds `contents: write`): no checkout, no `node`/`npm`/`npx`, no repository script — the splitter is workflow text, like `expected_names()` in the `upload` job. (This replaces the node splitter discussed before chartering: running a repository script here would hand project code the write token.)
- **Splitter interface**: `split_release_notes <file> <base> <tag> <is-candidate> <title-out> <body-out>`; returns 0 and writes the two files, or returns non-zero and prints one reason word on stderr. Title and text never travel through stdout or a variable built by command substitution (NUL and trailing-newline pitfalls). Runs under `LC_ALL=C`; coreutils and GNU sed only.
- **Splitter rules** (all must hold, else fall back): file size at most 65,536 bytes (`wc -c`, checked first); no control byte in the first line apart from its line ending (a tab included), and no NUL anywhere in the file (checked on the file, not a variable); a leading UTF-8 BOM and every `\r` removed; first line `# ` then a title that starts with `v${base} ` and has text after the version, at most 200 **bytes**, no trailing space; the text after the first line, leading blank lines trimmed, contains a non-whitespace byte.
- **Release candidate** — decided exactly as the validation step decides stability (`core="${ver%%+*}"`, a candidate iff `core` contains `-`; build metadata alone is stable), never by comparing the tag with `v${base}` (second review, high: that would make `v1.2.3+build` a candidate). For a candidate only, the title's leading `v${base}` is replaced by the tag (`"${tag}${title#"v${base}"}"`, pattern quoted so it is not a glob — `v0.19.18-rc.1 — <title>`), and the text opens with `Release candidate for v${base} — for testing, not general use.` and a blank line, then the target's text (operator choice). A stable tag's title and text are the file's, unchanged (a `+build` tag keeps the file's `v${base} — …` title). The splitter takes the candidate decision as an argument and reads no step-scoped variable (`GITHUB_*`, `RUNNER_TEMP`), because the tests extract and run it standalone.
- **Fallback, never fail**: a 404, any other API error, an oversized or malformed file → one `::warning::` line naming the reason word (no file content echoed) and today's call, `--generate-notes --title "${GITHUB_REF_NAME}"`. The step runs under GitHub's `shell: bash` (`bash --noprofile --norc -eo pipefail`), so every notes-logic command that can fail is guarded and the notes logic cannot abort the step (leg 01 design review, high — an earlier version of this line wrongly said the step sets neither); only the `gh release create`/`edit` itself can fail the job, as today. Either way the step writes one line to `$GITHUB_STEP_SUMMARY` — `Release notes: docs/releases/v<base>.md` or `Release notes: generated (reason: <word>)` — so a fallback is visible on the run page, not only in the log (Architect question 1: the charter's "never fail" stands).
- Title and text go to `gh` as a quoted variable (`--title "$title"`; it always begins with `v`, never `-`) and `--notes-file` respectively — never interpolated into a `${{ }}` expression.
- A notes release carries exactly the file's text: GitHub's generated "What's Changed" list and "Full Changelog" link are not added (stated in the format guide).

**DD3 — Re-runs and published releases.**
- `create-release` already reuses an existing release. New: if the existing release is still a **draft** and notes were found, its title and text are replaced from the file (`gh release edit --title --notes-file`) — a re-run after a notes fix picks it up. If it is **published**, or its draft state cannot be read, nothing is edited (charter constraint; **fail closed** on the no-edit rule). Release state (none / draft / published) is read from the-one's bounded `gh release list --json tagName,isDraft` (the by-tag view may not return drafts — leg 01 design review); only an exact draft answer allows an edit, and a failed read falls back to today's existence check with no edit. The published branch is protective only (a re-run after publish fails later at the upload anyway, because assets are immutable); it is pinned by text, not executed.
- `publish-release` is unchanged; a regex over its whole job text pins no `--notes`, `--notes-file`, `--title` or `--generate-notes`.

**DD4 — Tests: the workflow's own splitter is run, and every notes file is checked.**
- `release-workflow-invariants.test.js` extends its existing extraction pattern: `functionTexts()` takes the function name as a parameter (today its regex is hard-coded to `expected_names`), and the new tests take `split_release_notes() { … }` from `jobs['create-release']`, asserting **exactly one** definition (a rename must not extract nothing and pass vacuously). Run with `bash` (reusing the module's `bashOk` skip) against (a) every `docs/releases/v*.md` with its own base and tag `v<base>` (must split; title starts with its own version) and (b) fixtures in a temp dir: missing `# ` line, `#v0.19.18` (no space), `# v0.19.18` (no title text), wrong version, trailing space in title, empty and whitespace-only text, CRLF, BOM, over 65,536 bytes, a control byte in the title, a 201-byte title; the candidate rewrite for `v1.2.3-rc.1`, `v1.2.3-alpha-1` and `v1.2.3-rc.1+b2` (title and opening line), and `v1.2.3+build` (stable: no candidate line, title unchanged). The `base` derivation (`${ver%%[-+]*}`) and the candidate decision are extracted and run for the same four tags.
- New pins (text): `create-release` has no `actions/checkout` and no `npm`/`npx`/`node`/`scripts/` run line, and `GH_TOKEN` is its only credential; the contents-API path uses `?ref=${GITHUB_SHA}` and `v${base}`; the fallback `--generate-notes` remains; the draft-only edit is guarded by `isDraft`; no `${{ }}` expression names the title or body; `publish-release` pinned as in DD3.
- New `test/unit/release-notes.test.js` (JS-only, no shell; paths from `path.join(__dirname, '..', '..')`): every file in `docs/releases/` is either `README.md` or matches `^v\d+\.\d+\.\d+\.md$`; each title starts with its file's version and a space; each text non-empty; **`docs/releases/v<package.json version>.md` exists**; no file contains `/home/`, `/Users/`, `C:\Users\`, `\\Users\\`, `/tmp/`, `/var/folders/` or `~/` followed by anything but `.config/goldfinch` (backslashes in general stay allowed — `%APPDATA%\goldfinch`). This is a narrow check on `docs/releases/` only; squawk 0204 (the repo-wide path-hygiene pin) stays open and, when completed, should absorb these patterns into its one shared scan rather than keep a second list.
- Formatting: `.prettierignore` already ignores `*.md`, and eslint does not read Markdown — no config change.

**DD5 — The process change.** `docs/RELEASING.md` *Cut a release*:
- The notes file goes in **the same commit as the bump**, and the documented sequence adds it explicitly — `git add docs/releases/vX.Y.Z.md` before `git commit -a` (`-a` takes tracked files only; without the add, a pre-push `fly execute` of the working tree passes and `main` goes red after the squash-merge — Architect review, high).
- What the test guarantees: the current version's file is **present** in every commit `npm test` passes on. It goes red at the bump only when the file was not committed earlier; a file written ahead (as for a candidate, which reads its target version's file) means the bump stays green. Both are fine.
- The test is a test-time rule; DD2's fallback is the release-time rule. A hand-made tag on a commit without the file publishes with generated notes and the step-summary line — the documented flow cannot reach that.
- A candidate's notes are its target version's file, which may be committed before the bump.
- Editing a published release's notes is by hand, after approval, from the same file through the same splitter (DD6).
- CLAUDE.md's *Cutting a release* paragraph gains one sentence pointing at `docs/releases/README.md`.

**DD6 — Backfill v0.19.16 and v0.19.17.**
- `docs/releases/v0.19.16.md` from Mission 23 Flight 3's `release-notes-draft.md`, reshaped to DD1 (its "Before you upgrade: your vaults" section stays first), every claim kept as limited as the draft's, the macOS request under Notes.
- `docs/releases/v0.19.17.md` from Sortie 09 (`sorties/09-update-awareness/`): the kebab dot, Check now, "Last checked", the "Download now" spoken-name fix.
- Applied at the walk with `gh release edit vX.Y.Z --title "$title" --notes-file <body>` only after the operator approves each file word for word. The title and body come from **the workflow's own `split_release_notes`**, extracted from `build.yml` and run locally — the notes file is the single source for both the workflow and the hand edit. v0.19.17 is `package.json`'s current version, so its file must exist for `npm test` to pass.
- The format guide (`docs/releases/README.md`) includes a worked example and the candidate-line wording.

**DD7 — Verification apparatus.** No app runtime is involved (no behavior spec): unit tests for the splitter and files; the real path is proven at the walk on `v0.19.18-rc.1`, tagged on the sortie branch's pushed commit carrying a draft `docs/releases/v0.19.18.md` (this sortie's own notes), observed with `gh release view` (title, first line of text, prerelease, immutable) and the run's step-summary line. The fallback path (no file) is unit-tested only; it is today's behaviour, observed on every release so far. The draft re-edit branch (DD3) is executed in tests against a stub `gh`; it is not exercised live (re-running `create-release` on a published immutable candidate would only reach the protective no-edit branch).
- The build job sets the version from the tag with `--ignore-scripts` and runs no unit tests, so a candidate tagged while `package.json` is still 0.19.17 builds as 0.19.18-rc.1 (Architect trace b). After the sortie merges, `v0.19.18.md` sits on `main` ahead of the bump — harmless, and the bump then stays green.

### Prerequisites

- [x] Contents API raw read at a commit, with 404 for a missing file — probed.
- [x] Immutable releases allow title/notes edits — GitHub docs.
- [x] Precedent for executing workflow shell in tests — `release-workflow-invariants.test.js` `functionTexts()` / `expected_names()`.
- [x] Operator authorises the walk's outward actions when reached: pushing the branch, the `v0.19.18-rc.1` tag, and the two `gh release edit` calls.

### Pre-Flight Checklist

- [x] Charter agreed
- [x] Open questions resolved
- [x] Architect design review incorporated (two cycles)
- [x] Legs defined

---

## In-Flight

### Technical Approach

One implementation leg changes `build.yml`'s `create-release` job (step output for `core`; notes fetch, split and create/edit in the draft step), extends `release-workflow-invariants.test.js`, adds `test/unit/release-notes.test.js`, `docs/releases/README.md`, `docs/releases/v0.19.16.md`, `docs/releases/v0.19.17.md`, and updates `docs/RELEASING.md` and CLAUDE.md. The walk proves it on a candidate and applies the backfill.

### Checkpoints

- [x] Leg 01 landed: gates green (`npm test`, typecheck, lint, format:check), the splitter executed in tests against every notes file and the fixtures.
- [x] Code review confirmed.
- [x] Walk: operator approves both backfill files; `v0.19.18-rc.1` publishes with the candidate title and line; v0.19.16 and v0.19.17 edited.

### Adaptation Criteria

**Divert if**: the contents API or `gh release edit` behaves differently on the runner than probed (e.g. the job token cannot read the path at a tag) — stop and redesign the read path with the operator; never add a checkout to `create-release` without a ruling.

**Acceptable variations**: the exact warning texts; the 64 KiB / 200-character limits if GitHub's own limits are lower; the fixture list.

### Legs

- [x] `01-notes-in-the-workflow` — the workflow's notes step, both test files, the format guide, the two backfill files, the release-process docs
- [x] `02-hat-and-alignment` — operator approves the backfill text; `v0.19.18-rc.1` proves the path; v0.19.16 and v0.19.17 edited (interactive)

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code review confirmed
- [x] Charter criteria checked
- [x] Docs current (`docs/RELEASING.md`, `docs/releases/README.md`, CLAUDE.md)

### Verification

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` green.
- `gh release view v0.19.18-rc.1 --json name,body,isPrerelease,isImmutable` shows the candidate title, the candidate line first, `isPrerelease: true`.
- `gh release view v0.19.16` / `v0.19.17` show the approved titles and text; assets unchanged (five each).
