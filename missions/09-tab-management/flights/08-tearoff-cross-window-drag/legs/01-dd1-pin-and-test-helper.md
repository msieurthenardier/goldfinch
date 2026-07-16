# Leg: 01-dd1-pin-and-test-helper

**Status**: landed
**Flight**: [Tear-off and Cross-Window Drag](../flight.md)

## Objective

Pin DD1's synchronous delete/set invariant as an executable test anchored on code
identity, extract the source-scan toolkit the pin needs, and discharge F7's AC7 — all
before any leg edits `main.js`.

## Context

This is F7's **blocking prerequisite** (its debrief: *"BEFORE F8"*). DD1's claim that
duplicate tabs are *"structurally impossible"* rests entirely on `source.tabViews.delete`
and `target.tabViews.set` being **adjacent with no suspension point between them**. Today:

- `main.js` carries **no warning at the site** — `grep -n "synchron" src/main/main.js`
  → 12 hits, **none at the handler**.
- **No test requires `main.js` at all** (`grep -rl "require.*main/main" test/` → 0).
- ~~**Four recorded line numbers for the pair are all wrong**~~ — **FALSE; corrected at
  implementation.** Four *distinct* line numbers were recorded across F7's artifacts —
  `2699-2700` (flight.md), `2639-2640` (leg 2's "correction"), `2712-2713` (leg 3),
  `2756-2757` (the debrief) — but **only THREE were wrong. The fourth was CORRECT** at this
  leg's start (measured: the pair sat at exactly 2756/2757). The leg asserting that four
  unverified citations were all wrong **did not verify its own count** — the flight's
  signature failure, in the leg written to end it, and the **fourth** artifact in this
  lineage caught doing it.
  **The true argument is stronger than the overstated one**: this leg's own 8-line site
  comment moved the pair to **2764/2765**, invalidating the one citation that was right.
  A line number is not wrong because authors are careless — it is wrong because **the next
  edit above it moves it**, and leg 1 is the proof. *(This also vindicates the flight's
  prerequisite that leg 1 land before any leg edits `main.js`.)*
- **F8's implementer reading the code sees nothing.**

If an `await` enters between the two statements, DD1 degrades from a loud duplicate to a
**silent missing tab** — quieter than the bug it replaced.

**Design decisions in force**: DD10 (two readings per state-asserting AC), DD11 (per-leg
line budget). **Leg 4 will factor the move core out of this handler** — the pin's vacuity
guard is what makes that factoring fail loudly instead of silently retiring the pin.

## Inputs

- `src/main/main.js` — **byte-unchanged since `b2d3afc`** (`git diff b2d3afc..HEAD --
  src/main/main.js` → empty). The handler is registered as
  `ipcMain.handle('tab-move-to-new-window', (event, payload) => {` and is **synchronous**
  (zero `await`/`async` in its body).
- `test/unit/window-closed-invariant.test.js` and `test/unit/broadcast-invariant.test.js`
  — both currently passing; both carry their own copy of `maskComments` +
  `findMatchingBracket`.
- `src/main/capture-timeout.js` — carries an "ELECTRON-FREE by construction (no
  `require('electron')`)" **comment**, which is why F7's AC7 grep returns 1.
- Suite green: 1833/1833.

## Outputs

- `test/helpers/source-scan.js` (new) — the shared toolkit.
- `test/unit/move-tab-synchrony.test.js` (new) — the DD1 pin.
- `src/main/main.js` — a comment at the delete/set site naming the invariant.
- `test/unit/window-closed-invariant.test.js`, `test/unit/broadcast-invariant.test.js` —
  import the helper instead of carrying copies.
- F7's leg-2 AC7 corrected in place with the masked reading and both DD10 numbers.

## Acceptance Criteria

> **Every state-asserting AC below records TWO readings (DD10): the instrument on the
> real artifact when the property holds, and when it is mutated so it does not. Equal
> readings, or an unrun mutation, means the AC is NOT discharged. Mutations are
> in-memory or reverted — never committed. Run each `grep -c` STANDALONE: it exits 1 on
> zero matches and will silently break an `&&` chain.**

> **Scope and shape, settled at design review.** The scan walks **all of `src/main/**`**
> (not `main.js` alone), so that leg 4's factoring — which may move the move core into a
> new file — lands somewhere the pin can still be re-anchored. The helper therefore also
> exports `collectSources`.
> **The mutation tests are COMMITTED, and they mutate the REAL source in memory** (read
> `main.js`, `.replace(...)`, scan the string; no file is ever written). This is a
> deliberate upgrade on the house pattern, which commits synthetic-string tests and
> leaves real-source mutation as a by-hand step. DD10 asks for the reading *"on the real
> artifact, in the same run, in both directions"* — an in-memory mutation of the real
> file **is exactly that**, and it costs nothing.

- [x] **AC1 — the toolkit is extracted, and extraction is proven by byte-identity, not by
      "the suites still pass".** `test/helpers/source-scan.js` exports `maskComments`,
      `findMatchingBracket`, `collectSources`. Both invariant suites import them and carry
      no local copy.
      **Instrument**: assert the extracted function bodies are **byte-identical to the
      copies being deleted** (mechanical and decisive). *"Both suites pass before and
      after"* is NOT sufficient on its own — it is the vacuous shape this leg exists to
      warn about. **Baselines for the record: `window-closed-invariant` = 8 tests,
      `broadcast-invariant` = 6; both must still pass with those counts.**
      **THREE divergences must be ruled on, not one** *(corrected at design review — the
      leg carried its own unverified "verbatim", the flight's signature word)*:
      (a) `findMatchingBracket` bodies are byte-identical but its **docstrings differ
      substantially**; (b) `maskComments` docstrings differ; (c) `maskComments` **bodies
      differ by two inline comments** (`// closing quote`; `// the newline itself (if any)
      is handled by the default branch`). Rule which text survives and say why in the
      helper header.
- [x] **AC2 — the pin is anchored on code identity, proven by SHIFTING THE REAL FILE.**
      *(Replaced at design review. The draft's instrument was `grep -c "2756\|2757"` → 0.
      Measured: that reads **0 for the correct implementation AND for three of four
      line-anchored ones** — `lines.slice(2710,2783)`, `const HANDLER_LINE = 2711`, and a
      byte-offset slice all pass it. **Both DD10 readings are 0 ⇒ undischargeable by its
      own rule.** The handler registers at 2711, so the most natural line-anchor isn't
      even in the grep's alphabet.)*
      **Instrument**: mutate the real `main.js` in memory by **prepending 40 blank
      lines**, then re-run the scan.
      **Two readings**: real → handler found, pin passes. Shifted → handler found **40
      lines lower**, pin **still passes**. A line-anchored implementation loses the pair
      on the shifted copy. **This varies with the property asserted, on the real artifact,
      in the same run, in both directions.** Commit it as a test.
- [x] **AC3 — the pin fails a handler whose CALLBACK is `async`.** Detection is on the
      **callback specifically** — the arrow function passed to `ipcMain.handle` — **not
      `async` anywhere in the body slice** *(specified at design review; the looser form
      false-positives on nested thunks — see AC5's deletion).*
      Mutate the real source in memory to `ipcMain.handle('tab-move-to-new-window', async
      (event, payload) => {`.
      **Two readings**: real → **0 violations**; mutated → **≥1** naming the handler.
- [x] **AC4 — the pin fails a suspension point between the delete and the set — mutated to
      a REACHABLE state.** *(Corrected at design review: the draft inserted `await
      Promise.resolve();` into the **sync** callback, which is a **SyntaxError** — an
      unreachable source state. A text scan reports ≥1 and the AC "discharges" while
      proving the scan detects something that can never exist. That is a reading shaped
      like evidence.)*
      Mutate **`async` on the callback AND the `await` between the statements, together**.
      **Two readings**: real → **0**; mutated → **≥1**.
      This is the **durable** AC: it names the actual invariant and survives any future
      relaxation of AC3.
- [ ] ~~**AC5 — await anywhere in the handler body.**~~ **CUT at design review.** `await`
      requires `async`, so **AC3 subsumes every reachable violation AC5 would catch**.
      What it catches *uniquely* is a nested async thunk — **which is not a suspension
      point of the handler**. Demonstrated against a leg-4-plausible edit
      (`queueChromeSend(target, async () => [… await …])`, a deferred thunk that runs at
      delivery time): real → clean, AC3 → clean, AC4 → clean, **AC5 → VIOLATION**. A
      false-positive generator with zero independent value, aimed squarely at code leg 4
      is likely to write.
- [x] **AC5 (was AC6) — VACUITY GUARD, on BOTH the anchor and the pair.**
      *(Anchor half added at design review — the draft guarded pair-absence only, leaving
      anchor-absence undefined: `indexOf` → `-1`, and two implementers would build
      different things, one of them a silent vacuous pass. Both house suites guard exactly
      this and the draft omitted it.)*
      **(a) The anchor is found EXACTLY ONCE** across `src/main/**` (measured: **1**). A
      rename, a channel-string change, or a deleted handler **fails here** rather than
      passing on nothing.
      **(b) The pair is present in the anchored body.** Mutate the real source in memory
      to remove `source.tabViews.delete(p.wcId);`.
      **Two readings**: real → pair **found**, passes; mutated → **FAILS**, naming the
      missing statement.
      **This is the AC that protects leg 4.** Leg 4 factors the move core out of this
      handler; unguarded, the pin would find an anchor with no pair in it and **pass on an
      empty body** — retiring itself exactly when the code it protects is most exposed.
      Guarded, leg 4's factoring **fails loudly** and forces a re-anchor to the pair's new
      home. That is the intended outcome, not a regression.
- [x] **AC6 (was AC7) — the pin ignores a registration-shaped mention inside a COMMENT.**
      **Two readings**: a source whose only match is inside a comment → **0 violations**;
      the same text uncommented → **≥1**. **Discharged on the synthetic source** (0/0
      violations → 1 anchor/2 violations).
      ~~*(Without masking, the comment AC7 adds — which says the word "await" — would trip
      this leg's own test.)*~~ — **the RATIONALE is FALSE; measured at implementation.**
      Swapping `maskComments` for the identity function and re-running the pin against the
      **real** `src/main/**` yields an **IDENTICAL reading** (anchors 1, async false, pair
      true, awaitBetween false). **Both premises fail**: AC7's comment sits **above** the
      delete, outside the `delete..set` slice the pin inspects; and `move-tab-payload.js`
      spells the channel in **backticks**, which the quoted anchor never matches. So on the
      real tree **masking has discrimination ZERO** — the same defect shape as AC2's cut
      instrument, in the AC written to justify the mask.
      **The mask is KEPT**, on the honest ground: free, house idiom, and protective against
      leg-4-plausible edits (a comment *between* the pair naming `await`; a quoted channel
      mention in prose). **The synthetic reading is what proves it works; the real tree does
      not currently exercise it**, and the pin's header says so rather than inheriting the
      claim.
- [x] **AC7 (was AC8) — the comment lands at the site and states what is ACTUALLY
      PINNED.** It **adds to** the existing 4-line comment already at the site (it does
      not replace it — confirm, or the line budget silently changes meaning).
      It states: **no suspension point may separate the delete from the set** — *not*
      "they must be adjacent". *(Corrected at design review: no AC asserts adjacency, and
      AC4 permits arbitrary **sync** code between them, which is the correct invariant
      since sync code cannot suspend. The prose must not claim a stronger contract than
      the pin enforces — a comment that overstates its pin is a proxy.)*
      It also states the consequence — an `await` between them turns a **loud duplicate**
      into a **silent missing tab**, quieter than the bug DD1 replaced — and names
      `test/unit/move-tab-synchrony.test.js`.
      **Verify AC6's masked reading still passes with the comment in place** → 0
      violations.
- [x] **AC8 (was AC9) — F7's AC7 is discharged with a masked reading, at BOTH sites.**
      All six readings below were **independently re-measured at design review and hold
      exactly**:

      | file | naive `grep -c` | masked | |
      |---|---|---|---|
      | `src/main/capture-timeout.js` | **1** (a comment, the file's own header) | **0** | the subject |
      | `src/main/automation/observe.js` | **1** (a comment) | **0** | Electron-free control |
      | `src/main/automation/engine.js` | **1** (`const { webContents, session } = require('electron');`) | **1** | **genuine positive control — a real require** |

      **Naive reads 1 on all three — discrimination ZERO. Masked splits them 0/0/1.**
      Correct `legs/02-live-defect-fixes.md` at **BOTH sites** *(found at design review —
      the draft said "in place", singular)*: **line 145** (the AC itself, checked `[x]`
      claiming "→ 0") and **line 236** (a verification command block, `# AC7 — the helper
      is Electron-free` / `→ 0`). **Fixing only the AC leaves the failing command live in
      the runbook** — the identical half-fix as the debrief's "delete 2 lines" that would
      have left three leaked wrappers live.
- [x] **AC9 (was AC10) — the suite is green with a STATED delta, and no mutation is
      committed.** *(Corrected at design review: "1833 + the new tests" is unfalsifiable —
      a reduction offset by additions is invisible.)* Baseline **1833**; state the expected
      new-test count and assert `1833 + N` exactly. `npm run lint`, `npm run typecheck`
      green. `git diff src/main/main.js` shows **only** the comment. `git status
      --porcelain` shows no stray mutation artifacts — **every mutation is in-memory; no
      file is ever written.**
- [x] **AC10 — the helper header records `maskComments`'s REGEX-LITERAL blind spot.**
      *(Found at design review.)* A regex literal containing an odd number of quote
      characters (`/don't/`, `/['"]/`) **inverts quote parity and silently disables comment
      masking for the rest of the file** — after which this leg's own AC7 comment would
      survive the mask and trip the pin on the word "await" in its own prose.
      **Currently latent**: `grep -cE "/\[[^]]*['\"]" src/main/main.js` → **0**, and it
      fails **loud**, not silent — hence low severity. But **leg 4 adds code to
      `main.js`**, and **neither existing docstring mentions it**. AC1's docstring ruling
      is the natural home. Record it; do not fix it.

## Line Budget (DD11)

- `src/main/main.js`: **+8 lines maximum** (comment only). Currently **3517**. A change
  that would exceed this **stops and reports** — it means the leg is doing something it
  was not scoped to do.
- No product behavior changes in this leg. **Zero lines of executable `src/` change.**

## Out of Scope

- The transport, the drag model, `adopt-tab`, the move core factoring — legs 2-6.
- The `missions/**` leaked-wrapper scan, the `renderer.js` kebab comment, the AC27 record
  correction, the stale-header scrub — **moved to leg 6 at design review** (artifact
  work, not `main.js`-coupled).
- `getAttachedWindow`/`crossWindow` retirement — DD13, coupled to V7, handed to
  maintenance.

## Verification Steps

1. `npm test` — green, **exactly 1833 + N** (N stated, not implied).
2. `npm run lint` — green. `npm run typecheck` — green. **Run each standalone**: `grep -c`
   exits 1 on zero matches and silently breaks an `&&` chain (this is how F7 lost a
   *correct* control).
3. Every mutation in AC2-AC6 run, with **both numbers recorded in the flight log**. An
   unrun mutation means the AC is **not discharged** (DD10). The mutations are committed
   tests operating on in-memory copies of the real source.
4. `git diff src/main/main.js` — the comment only, **added to** the existing site comment.
5. `git status --porcelain` — no stray mutation artifacts; no file was ever written.

## Design Review

**Pass 1: `needs rework` → applied in full.** 4 high, 3 medium, 2 low. The reviewer ran
the mutations rather than reasoning about them, which is what found the two worst:

- **AC2's instrument had discrimination zero** — `grep -c "2756\|2757"` reads **0 for the
  correct implementation and for 3 of 4 line-anchored ones**. Both DD10 readings 0 ⇒
  undischargeable **by its own rule**, in the AC written to enforce that rule. Replaced
  with the 40-blank-line shift of the real file.
- **AC4/AC5 mutated to a SyntaxError** — `await` in a sync callback cannot parse. The
  scan would report ≥1 and "discharge" the AC while proving it detects **a state that can
  never exist**.
- **AC5 cut entirely**: `await` requires `async`, so AC3 subsumes its every reachable
  catch; its unique catches are **nested async thunks, which are not suspension points**.
  Demonstrated firing on `queueChromeSend(target, async () => …)` — **a leg-4-plausible
  edit**. A false-positive generator aimed at code leg 4 is likely to write.
- **My stated rationale for AC4 was false** (*"AC3 alone would pass a sync handler that
  awaits internally via a helper"*) — a sync handler **cannot await**, and calling an
  async helper without awaiting is not a suspension point. Third time this flight that a
  *reason* I composed was wrong while the *ruling* survived.
- **AC1 carried the flight's own unverified word**: "verbatim" / "docstrings differ" —
  there are **three** divergences, including **two inline comments inside `maskComments`'s
  body**.
- One premise in **my review prompt was itself false**: I asserted that a `maskComments`
  masking everything would make both suites pass with the same counts. The reviewer
  tested it — **both suites FAIL** (their inherited vacuity guards catch both degenerate
  cases). The suites are less defenseless than I assumed.

**Pass 2: folded into implementation, by FD ruling.** The pass-1 fixes were precise,
independently verified, and applied mechanically — a second design pass would re-derive
what pass 1 measured. Instead the implementing Developer is instructed to **first audit
every AC for implementability and flag any that cannot be discharged as written, before
writing code**. This preserves the review's function (catch it before it ships) without
spending a cycle re-reading verified findings. Recorded as a deliberate call, not a skip.
