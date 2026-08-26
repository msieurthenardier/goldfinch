# Squawk 0015: Welcome behavior specs — hygiene items from the Mission 16 Flight 3 gate runs

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-26
**Completed**: 2026-08-26

## Report

Four small spec-quality items surfaced by the Validators on the Flight 3 gate runs; none affected a verdict, each is a one-line edit:
- `tests/behavior/welcome-first-launch.md` rows 4 and 6 fold a follow-on action ("A subsequent Ctrl+T …") into the Expected Result cell — split each into its own row so an Executor cannot stop at the immediate post-action state.
- `tests/behavior/welcome-first-launch.md` rows 2 and 7 carry `[mixed-frame]` but are filesystem-only — drop the tag (or add a token browser check).
- `tests/behavior/welcome-first-launch.md` row 3 asserts an empty bookmarks bar is visible — on the dark chrome it has no visual signature; pre-seed one bookmark in the fixture so the bar is visible by content.
- `tests/behavior/welcome-home-first.md` row 2 says "a saved confirmation beneath it" — name the element (`#welcome-home-status`) so the check is exact.

## Evidence

- `tests/behavior/welcome-first-launch/runs/2026-08-26-02-10-54.md`, `tests/behavior/welcome-home-first/runs/2026-08-26-02-00-25.md` — Validator closing summaries.

## Corrective Action

- `tests/behavior/welcome-first-launch.md`:
  - Old rows 4 and 6 each split in two: old row 4 (choose Brave Search) kept its immediate expectation as new **row 4**; its folded "A subsequent Ctrl+T…" clause became new **row 5** (Press Ctrl+T → home-only welcome tab). Old row 5 (navigate the search) renumbered to **row 6**. Old row 6 (Ctrl+T + set home page) kept its immediate expectation as new **row 7**; its folded "Ctrl+T opens `https://example.com/`…" clause became new **row 8**. Old row 7 (final settings read) renumbered to **row 9**. All value-trace text and controller-condition citations moved with their original sentences, unchanged.
  - Old rows 2 and 9 (post-renumbering) — the settings-row reads — dropped the `[mixed-frame]` tag; both are filesystem-only with no paired browser observable, so the tag no longer applies. No browser check added (per the squawk's stated option).
  - Row 3 (bookmarks-bar check): added a **Preconditions** bullet describing a one-time setup — launch once against the fresh profile to initialize `app.db`, quit, insert one row into the `bookmarks` table for the fresh-seed default jar (`personal`, confirmed against `src/main/jars.js`'s `FRESH_SEED`) via `sqlite3`, then relaunch for the observed run — following the established quit/insert-while-down/relaunch pattern already used in `bookmarks-bar.md` row 12. Row 3's Expected Result reworded to check the bar by content: `button.bm-item` inside `#bookmarks-bar` (confirmed against `src/renderer/chrome/bookmarks-bar.js`'s `btn.className = 'bm-item'`), instead of asserting an empty-but-present bar.
  - Updated the cross-reference in `tests/behavior/welcome-home-first.md`'s Out of Scope (`welcome-first-launch` steps 4–6 → **4–8**) to track the renumbering.
- `tests/behavior/welcome-home-first.md`:
  - Row 2's Expected Result: "a saved confirmation beneath it" → named the element, `#welcome-home-status` reading exactly "Saved — new tabs will open here." — verified against `src/renderer/chrome/welcome-controller.js` (`homeStatus.id = 'welcome-home-status'`; `homeStatus.textContent = home != null ? 'Saved — new tabs will open here.' : ''`) before quoting.

## Verification

- Re-read both edited specs top to bottom: row numbers are contiguous (1–9 in `welcome-first-launch.md`, unchanged 1–5 in `welcome-home-first.md`); every in-spec and cross-spec row-number reference resolves (the Intent's "step 4" note in `welcome-first-launch.md` still correctly names the row carrying the HAT-changed engine-block-stays behavior); required sections (Intent, Preconditions, Observables Required, Steps, Out of Scope) present in both.
- `npm test` — 3792/3792 pass, 0 fail (unchanged from before this squawk; specs aren't under test, gate confirmed green as part of the record).
- No source, test, other-spec, run-log, or crew files touched — diff confined to the two specs and this squawk artifact.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementers' reasoning) — one review round (clean on the first pass), batch turnaround 2026-08-26
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-26 (0013, 0014, 0015)` on `squawk/turnaround-2026-08-26` (PR number recorded on the PR itself)

Reviewer read both specs in full post-edit: rows contiguous (1–9 / 1–5), the cross-spec Out of Scope reference (`welcome-first-launch` steps 4–8) exact, split rows verbatim, `[mixed-frame]` retained only on genuinely mixed rows, the bookmark fixture matching `bookmarks-bar.md` row 12's quit/insert/relaunch pattern with the real `bookmarks` column set (`app-db.js`) and the `personal` fresh-seed jar id (`jars.js`), and `button.bm-item` / `#bookmarks-bar` / `#welcome-home-status` / "Saved — new tabs will open here." present in source. Suite 3792/3792. Verdict: "Squawk 0015's four spec-hygiene edits are correctly scoped, preserve original wording/citations, correctly renumber and cross-reference rows, and the new bookmark fixture matches the project's established pattern and real schema — approved."
