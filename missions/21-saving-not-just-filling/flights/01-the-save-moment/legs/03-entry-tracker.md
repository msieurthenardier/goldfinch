# Leg: entry-tracker

**Status**: completed
**Flight**: [The Save Moment](../flight.md)

## Objective

Build the entry tracker as the DD3f/DD3g hybrid: a **isolated-world observer** that
owns detection, provenance and the value-equality check and emits only plain data,
plus a **main-world module** that owns policy. Nothing consumes it yet — this leg
builds and wires the observation side only.

## Context

Charter: DD2, DD3, DD3d, DD3e, DD3f, DD3g. Read them before starting; this leg is
the fifth design of the same mechanism and the previous four each shipped a hole.

Why the shape is what it is, in one paragraph: a broadened capture trigger needs to
know an entry's values without DOM containment to lean on (DD2). Trusting those
values requires proving the operator really typed them (DD3). Four review rounds
defeated every main-world version of that proof — no provenance, a sticky flag, a
spoofed `value` accessor, a spoofed `target` accessor — because with
`contextIsolation:false` the page shares our realm and every read is reachable. A
live spike (Leg 2) proved an isolated world is immune by construction: across 30
real keystrokes it reported the true field identities and true values while the
main world saw only the attacker's. DD3g then closes the last gap — **no node
identity crosses the boundary**, because a reference cannot, and every scheme for
minting a crossable id is either page-writable or misassociates on mutation.

**Honest note on the evidence** (design review, recorded rather than smoothed): the
spike compared isolated-world reads against *bare* main-world reads, not against a
document-start-captured `target` getter. So it proves the isolated world is
**sufficient and structurally cleaner**, not that the captured-accessor route was
insufficient for that specific case. The adoption rationale does not rest on that
comparison — it rests on ending the category for any *future* accessor by
construction rather than by remembering.

## Inputs

- `src/preload/vault-fill-fields.js`, `src/preload/vault-card-fields.js` — the pure
  detection + fill modules. Both stay pure and `require`-able.
- `src/preload/vault-fill-icon.js` — `targetForAnchor` (`:182`), `pendingFillTarget`
  (`:175`), `FILL_TARGET_TTL_MS` (`:176`), `consumeFillTarget` (`:205`),
  `anchorKinds` (`:381`), the optional-dep idiom (`:155`).
- `src/preload/webview-preload.js` — the `IS_TOP_FRAME && vaultEligible` gate, the
  `isTrustedGet` capture (`:303`), the existing MutationObserver, and the
  `vault-fill` / `vault-fill-card` handlers. Note it imports only `ipcRenderer`
  today (`:10`); `webFrame` must be added.
- Leg 2's findings in the flight log — the live evidence this rests on.

## Outputs

- A thin isolated-world observer, composed from pure modules, installed at
  document-idle from the preload.
- A main-world policy module consuming plain snapshots.
- No behavioural change: nothing reads a snapshot yet.

## Acceptance Criteria

- [x] **No node identity crosses the world boundary (DD3g).** The observer's
      reported shape is plain serializable data only. A source scan of the
      main-world module finds no attempt to key state on anything originating in
      the isolated world.
- [x] Detection, the provenance map, detachment handling and the DD3 value-equality
      check all live in the isolated world, keyed by its own node references.
- [x] **The observer carries no policy**, pinned concretely (not by judgement): its
      source contains no reference to save/update disposition vocabulary
      (`update`, `save`, `dispose`, `captureId`) and no IPC symbol, and it stays
      under a stated line ceiling exported for the test — the house
      `RENDERER_LINE_BUDGET` idiom.
- [x] **The observer's LOGIC is unit-tested under `node --test`** against a fake
      document — short-circuit-before-resolve, the `keydown`-fires-before-`input`
      ordering, `isTrusted` pass-through, the equality check, detachment eviction,
      and the emitted snapshot shape. Only "does this run in a spoof-immune
      context" is left to the live probe.
- [x] **Value-bound provenance**: granting records the value observed at that
      instant; a later snapshot omits the field when its value has changed.
      Named cases: **keystroke-then-overwrite** and **fill-then-mutate**.
- [x] An untrusted (script-dispatched) `input`/`keydown` never grants provenance,
      asserted directly with a synthetic event.
- [x] A Goldfinch fill grants provenance. `fillLoginForm`/`fillCardForm` report
      `{ filled, fields: [{ field, value }] }` carrying the string **written** —
      for a `<select>`, `setChoiceValue` must report what it actually wrote, which
      can differ from the requested candidate. `setFieldValue` does not reach into
      the tracker.
- [x] **Live spoof probe (isolated-world half, dev launch):** with instance-level
      AND prototype-level `value` overrides AND an `Event.prototype.target`
      redirect installed by the page, the observer still reports the real field
      and the real typed value. This replaces the pre-DD3f unit-level spoof
      criteria, which tested a main-world read path that no longer exists.
- [x] **The observer script is delivered as build-time text.** A second esbuild
      target emits a `require`/`module`-free script from the observer core plus the
      two pure modules; its output is embedded as a generated constant the CJS
      preload bundle requires. No runtime file read — the spike proved the
      sandboxed preload has no `fs`.
- [x] **Install success is asserted on the RESOLVED VALUE's shape**, never on the
      absence of a rejection: a throw inside an isolated-world script resolves
      `undefined` rather than rejecting, so a broken injection would otherwise
      install nothing, silently, forever.
- [x] **Three-state snapshot (DD3h)**: per detected field
      `{ detected: true, value: <string|null> }` — `null` for detected-but-
      unprovenanced-or-mismatched, key absent for never-detected. A named unit test
      distinguishes the two "absent" causes, because DD3c depends on that
      distinction and a binary shape would force Leg 5 to rework this leg's output.
- [x] **Goldfinch fills write from the isolated world (DD3h)**, so fill and grant
      happen in one realm with no cross-world correlation. A fill grants provenance
      for exactly the fields it wrote, carrying the string written — for a
      `<select>`, what `setChoiceValue` actually wrote, which can differ from the
      requested candidate.
- [x] **Fail closed and NOT silent**: if the isolated-world install fails, every
      field reports unprovenanced AND a warning is logged once — the house
      fail-soft-with-a-log style. A systemic, indefinite outage of the whole
      feature must be diagnosable, not discovered months later.
- [x] Nothing depends on an isolated-world read resolving synchronously (DD3f) —
      the spike's observation of that is empirical, not contractual.
- [x] `pendingFillTarget`'s single-use + TTL + kind-match semantics are unchanged,
      proven by `test/unit/vault-fill-icon.test.js` passing **unmodified**.
- [x] Nothing consumes a snapshot yet: `npm test` passes with no change to any
      existing capture assertion.

## Verification Steps

- New unit suites for the observer core and the policy module, against hand-rolled
  fake documents in the `vault-card-fields.test.js` discipline.
- **The fake must model the accessor/property split** or the value-binding tests
  are vacuous: define the fake's `value` as a getter/setter pair on the prototype
  backed by a private field, so an instance-level `defineProperty` in a test is a
  faithful analog of the real attack.
- `test/unit/vault-fill-icon.test.js` passes unmodified.
- **Live probe** on `npm run dev:automation` with a scratch page (scratchpad, not
  the repo) carrying the three overrides above, per Leg 2's apparatus. **Add a
  fourth check the spike did not cover**: that an isolated-world `MutationObserver`
  actually observes main-world-triggered DOM mutations, so detachment eviction
  works. This is currently inferred from Q2's accessor/listener result, not
  verified — and this flight's standard is verify, not argue.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format`.
- **The shipped guest preload is a BUILT BUNDLE** (`webview-preload.bundle.js`,
  `scripts/build-preload.mjs`). `pretest` and `dev-launch.mjs` both rebuild, but
  editing preload source while the app is already running has no effect until a
  rebuild and a fresh tab. Leg 2 lost time rediscovering this.

## Implementation Guidance

1. **Observer core first, as an injected-deps module** — `createEntryObserver({
   document, findAllLoginFields, findAllCardFields, report })` — so its logic is
   `require`-able and testable. Its installation target being an isolated world is
   a deployment detail, not a reason to write untestable code.
2. **Provenance storage** keyed by the observer's own node references in a `Map`,
   holding the value observed at the granting event. A snapshot includes a field
   only when its current value still equals the stored one. Do **not** add a
   separate dirty flag — that is the sticky-boolean hole two reviews rejected.
3. **Install from `webview-preload.js`** under the existing
   `IS_TOP_FRAME && vaultEligible` gate via
   `webFrame.executeJavaScriptInIsolatedWorld`. Add the `webFrame` import. Use a
   single named world-id constant with a comment — no magic number — and note that
   no other isolated-world consumer exists in the app today, so a second one must
   pick a different id deliberately.
4. **Fills execute in the isolated world (DD3h).** The `vault-fill` /
   `vault-fill-card` IPC handlers hand the credential to the observer rather than
   calling `fillLoginForm`/`fillCardForm` in the main world; the fill runs in-world
   and grants provenance for exactly the fields it wrote, in the same realm as the
   map. This is what removes the correlation problem — do NOT reintroduce a
   main-world fill plus a cross-world "grant for field X" message, which is the
   crossing DD3g proved impossible.
   `fillLoginForm`/`fillCardForm` stay pure and still return
   `{ filled, fields: [{ field, value }] }`; `setChoiceValue` returns the string it
   actually wrote. **This is NOT additive** — `assert.deepEqual` rejects an extra
   key, and existing assertions in `test/unit/vault-fill-fields.test.js` and
   `test/unit/vault-card-fields.test.js` compare the result exactly. Update them.
   Secrets still never enter a page DOM beyond the field write itself, and the
   credential still never leaves main except over the existing channel.
7. **Build the observer text.** Add an esbuild target to
   `scripts/build-preload.mjs` producing a `module`/`require`-free script (IIFE or
   equivalent) from `vault-entry-observer.js` + the two pure modules, emitted as a
   generated constant. Verify the emitted text contains no `module.exports` and no
   bare `require(` — a trailing `module.exports` would throw at evaluation and, per
   DD3h, resolve `undefined` rather than rejecting.
5. **No main-world fallback listeners.** An earlier draft kept them "for the case
   where the isolated world is unavailable", but their reads may never grant
   provenance, so they would produce output that is then discarded. Failing closed
   means the map stays empty plus the one-time warning — nothing to wire.
6. **`targetForAnchor` keeps resolving in the main world** for icon placement, over
   the same pure module. Per DD3g that is a second call site of one module, not a
   second implementation — decorative, lower stakes, and it needs a main-world node
   to position against. `anchorKinds()` is likewise out of scope.

## Edge Cases

- **Framework re-render replaces a field.** The old node's entry is evicted by the
  observer's own MutationObserver; the new node is unprovenanced. Fail-closed and
  correct — but with no attacker involved it can silently lose a capture the
  operator expected. **Leg 4 (`fixture-corpus`) must carry this as a named
  known-unsolved shape.**
- **Our fills dispatch untrusted events** by construction, which is why the written
  value is reported rather than inferred from events.
- **Install-timing race.** `executeJavaScriptInIsolatedWorld` is async even at
  document-start, so a keystroke landing in the install window is unobserved. This
  fails closed — a possible missed capture, never forged provenance — and is
  spent against DD4's wrong-moment budget. Named rather than left implicit.
- **DD3e's `.isConnected` prohibition is SUPERSEDED here.** It existed because
  `.isConnected` is a spoofable main-world accessor. Inside the isolated world it
  is not reachable by the page at all, so the observer may use it; the recursive
  removed-node subtree search remains the right shape regardless, because framework
  unmounts remove a wrapper, not each input.
- **Memory.** The observer's map must not grow unbounded; evict on detachment and
  on document unload.
- **Detection-property spoofing is now closed for capture** (DD3g) because
  detection runs in the isolated world. It remains open for the icon's main-world
  placement — a cosmetic misdirection, not a value-authenticity issue.

## Out of Scope

- The gesture, the snapshot trigger, offer-on-settle, and DD3c's save-vs-update
  rule — all Leg 5 (`broadened-capture`).
- The fixture corpus — Leg 4.
- Any change to what is offered or when.

## Files Affected

- `src/preload/vault-entry-observer.js` — new, the isolated-world observer core.
- `src/preload/vault-entry-tracker.js` — new, the main-world policy module.
- `src/preload/vault-fill-icon.js` — resolve via the shared module; optional dep
  with an internal fallback (the `:155` idiom) so the icon tests stay unmodified.
- `src/preload/vault-fill-fields.js`, `src/preload/vault-card-fields.js` — report
  written values; `setChoiceValue` returns what it wrote.
- `src/preload/webview-preload.js` — `webFrame` import; install the observer;
  route the two fill handlers in-world.
- `scripts/build-preload.mjs` — new target emitting the observer script text.
- `test/unit/vault-entry-observer.test.js`, `test/unit/vault-entry-tracker.test.js`
  — new.
- `test/unit/vault-fill-fields.test.js`, `test/unit/vault-card-fields.test.js` —
  update result assertions for the new `fields` key.

## Citation Audit

Verified at design time (2026-09-19), covering the NEW mechanism as well as the
pre-existing surface:
- `webview-preload.js:10` imports `ipcRenderer` only — `webFrame` is genuinely
  absent and must be added. Confirmed.
- No isolated-world consumer exists anywhere in `src/` today, so the world-id
  constant is unclaimed. Confirmed by grep.
- `webFrame.executeJavaScriptInIsolatedWorld` reachable under this app's
  `sandbox: true` / `contextIsolation: false` guests — established live by the
  Leg 2 spike (Q1), not by documentation.
- `assert.deepEqual` rejects an extra enumerable key — verified by running it.
- `setChoiceValue` writes the matched option's value, which can differ from the
  requested candidate, and currently returns nothing. Confirmed.
- `vault-fill-icon.js` `:155` optional-dep idiom, `:175`/`:176`/`:182`/`:205`
  fill-target surface, `:381` `anchorKinds`. All confirmed.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`)
- [x] `npm run format` run
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (per the orchestration instruction — `completed` is a stale template wording; `landed` matches Leg 1/this flight's own convention)
- [x] Check off this leg in flight.md
- [x] Do NOT commit — review and commit are deferred to the end of the flight
