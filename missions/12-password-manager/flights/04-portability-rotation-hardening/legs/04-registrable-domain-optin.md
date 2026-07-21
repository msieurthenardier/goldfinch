# Leg: registrable-domain-optin

**Status**: completed
**Flight**: [Portability + Rotation + Hardening + Docs](../flight.md)

## Objective

Add a per-credential **registrable-domain** fill opt-in behind a hardened matcher: a vendored Public
Suffix List snapshot + parser (`registrableDomainSafe`, fail-closed to exact) lets a credential opt into
matching across its eTLD+1 (e.g. `accounts.example.com` fills an `example.com` login) while **never**
sharing across an unrelated registry sibling or a multi-tenant platform tenant. Exact-origin stays the
default; the opt-in is per-item; **capture (save-vs-update) stays exact regardless of `matchMode`**.

## Context

- **Flight DD5 (Architect-ruled)** — a curated suffix set cannot make the mission's "**never** shares a
  credential across an unrelated ccTLD sibling" true (an *unlisted* public suffix silently over-collapses
  → a password leak that "fall back to exact on uncertainty" can't catch). A **vendored PSL** (`.dat`
  data asset, not an npm package → zero-dep) is the credential-safe answer. Do NOT reuse `trackers.js`'s
  `registrableDomain`/`MULTI_SUFFIX` (mission constraint; it's tracker-classification — it deliberately
  treats `github.io`/`amazonaws.com` as registrable, which would LEAK credentials across tenants).
- **Exact-origin today** — fill matches exact origin at THREE sites: `vault-context.js:323-334`
  (automation fill, `itemOrigin !== tabOrigin`), `vault-human.js:201` (human fill,
  `item.origin !== tabOrigin`), and the picker filter inside `reachableLoginItems`
  (`vault-store.js:1191`, `item.origin === origin`; fn `1171-1204`). All three branch on the item's
  `matchMode` via a shared helper; the **picker must widen** or a registrable-domain item never surfaces.
- **The picker filter has a FOURTH consumer** — capture disposition. `vault-human.js:251` calls
  `store.reachableLoginItems(jar.id, origin)` to decide save-vs-update, and `captureSave`
  (`vault-human.js:338-343`) rewrites the matched item's `origin`. If the widen bled into capture, a
  submit on `accounts.example.com` would be dispositioned as an *update* to an `example.com`
  registrable-domain item and **rewrite its origin down to the subdomain** — a data-integrity
  regression. **The widen must be opt-in per call**: the picker widens; capture stays exact.
- **Fail-closed** — `matchMode:'registrable-domain'` only ever *widens* from exact; any matcher
  uncertainty (IP literal, unparseable host, PSL miss, origin-parse failure, scheme mismatch) degrades
  to the exact string compare.

## Inputs

- `src/main/trackers.js` — `isIpLiteral` (`:63`, reusable guard idea) + `registrableDomain`/`MULTI_SUFFIX`
  (`:71`, the tracker-classification matcher that must **NOT** be reused for credentials — it returns
  `co.id` for `a.co.id`, collapsing unlisted registry siblings → a leak).
- `src/main/vault/vault-context.js:44-50` (`originOf` → `new URL(url).origin`, an opaque
  `scheme://host:port` string), `:323-334` (the automation exact gate); `src/main/vault/vault-human.js:53-57`
  (human `originOf`), `:158` (`reachableItems` → picker), `:201` (human fill gate), `:251` (capture
  disposition consumer), `:338-343` (`captureSave` origin rewrite); `src/main/vault/vault-store.js:1171-1204`
  (`reachableLoginItems`, filter at `:1191`), `:948` (`_normalizeItem` spreads all fields → the new field
  round-trips).
- `src/shared/vault-item-schema.js:36` (`SCHEMA.login.nonSecret`), `:88` (`metadataOf` positive
  whitelist — coerces an absent field to `null`); how `hasTotp` is surfaced as an explicit metadata flag
  (the model to mirror — NOT the `nonSecret` text-field list).
- `src/shared/vault-editor-model.js:29` (the `nonSecret` field-list → rendered text fields), `:161-167`
  (`assembleSave`); `test/unit/vault-editor-model.test.js:22` (the drift-guard that pins
  `nonSecretNames === schema.nonSecretFieldsFor` — adding `matchMode` to `nonSecret` would force it into
  the text-field taxonomy). `src/shared/vault-picker-template.js` — the picker (a widened-match badge).

## Outputs

- **Vendored PSL + parser (net-new)** — a committed `public_suffix_list.dat` snapshot (Mozilla PSL,
  MPL-2.0 — redistributable; record source URL + snapshot date + a refresh note) + a pure parser
  `src/main/vault/psl.js`: `registrableDomainSafe(host)` → the eTLD+1 for `host`. Algorithm: normalize
  (lowercase); **null** on an IP literal (`isIpLiteral` idea), empty, or unparseable host; find the
  matching PSL rule with **exception (`!`) rules taking priority over wildcard (`*`) rules, then
  longest-match wins** among the rest; the registrable domain is (that public suffix) + one more label;
  **null** if the host IS a public suffix or has no label above the suffix. `*` matches exactly one
  label; `!foo.bar` un-wildcards (the suffix becomes `bar`). **IDN**: `URL.hostname` yields punycode
  (`xn--…`) while the `.dat` lists Unicode labels — reconcile (or document that IDN hosts fail-close to
  null → exact). Pure; parses once at module load into a Set/Map index; heavily unit-tested.
- **`matchMode` metadata field** — model it like `hasTotp`, **not** as a `nonSecret` text field: add it
  to `metadataOf`'s output (`vault-item-schema.js:88`) as an explicit `login` metadata flag
  (`'exact'` default | `'registrable-domain'`; absent/legacy → `'exact'`), with dedicated editor +
  `assembleSave` handling. It must NOT enter `SCHEMA.login.nonSecret` (that trips the editor drift-guard
  and renders a text field). `_normalizeItem` already spreads it through persistence. Never a secret.
- **`originMatches(item, tabOrigin, { widen })` helper (new shared pure module `src/shared/origin-match.js`)** —
  inputs are opaque origin strings. `URL`-parse both; on any parse failure / empty / `"null"` host →
  fall back to the exact string compare (`item.origin === tabOrigin`). When `widen === true` AND
  `item.matchMode === 'registrable-domain'` (positive test — legacy `null` falls through to exact):
  match iff **same `protocol`** AND `registrableDomainSafe(itemHost)` and `registrableDomainSafe(tabHost)`
  are **both non-null and equal**; otherwise the exact string compare. `widen` defaults to `false`, so
  a caller that omits it gets today's exact behavior byte-for-byte. **Signature precision**: default the
  whole options object, `originMatches(item, tabOrigin, { widen = false } = {})` and
  `reachableLoginItems(jarId, origin, { widen = false } = {})` — the unchanged 2-arg capture caller
  (`store.reachableLoginItems(jar.id, origin)`) must not throw destructuring `undefined`.
- **The three sites branch via `originMatches`** — automation fill (`vault-context.js:323-334`) and human
  fill (`vault-human.js:201`) call it with `{ widen: true }`; `reachableLoginItems`
  (`vault-store.js:1191`) gains a `{ widen }` option (default `false`) and passes it into the filter.
  **The picker path** (`vault-human.js:158`) calls `reachableLoginItems(..., { widen: true })`; **the
  capture-disposition path** (`vault-human.js:251`) calls it with `widen` **false/omitted** (capture
  stays exact — no origin-rewrite regression).
- **Editor + picker** — a per-credential `matchMode` toggle in the editor (default exact; a clear
  "match any subdomain of {registrable-domain}" label). Because `reachableLoginItems` hand-builds its
  rows (`vault-store.js:1192-1199`, bypassing `metadataOf`), add an explicit `widened` flag to the pushed
  row (true when the match was a registrable-domain widen, not exact); the picker template renders a
  **distinct badge** on a widened offer (`textContent`-only) so the operator sees it isn't exact-origin.
- **Tests** — unit: the PSL parser (normal / `*` wildcard / `!` **exception** / host-IS-a-suffix → null /
  IP-literal → null / unknown-suffix → null / an IDN host; incl. `co.uk` → null, `github.io` tenants
  **distinct**, `s3.amazonaws.com`, a made-up unlisted ccTLD → null); `originMatches` (exact unchanged
  with `widen:false`; widens across a subdomain but NOT a registry sibling / platform tenant / scheme
  mismatch / **either-host-null** / **both-null** / origin-parse failure); the three sites honor
  `matchMode`; **capture disposition stays exact** for a registrable-domain item (does NOT rewrite its
  origin). Integration: a `registrable-domain` credential fills a hardened-matched subdomain but is
  refused across an excluded sibling at all three fill sites.

## Acceptance Criteria

- [x] `registrableDomainSafe(host)` returns the correct eTLD+1 (normal + `*` wildcard + `!` exception
      rules, exception-over-wildcard priority) and **null** on IP literals / unparseable / host-IS-a-suffix
      / unknown-suffix / (reconciled) IDN hosts (fail-closed). Heavily unit-tested, incl. multi-tenant
      platforms resolving tenants **distinct** and an unlisted ccTLD → null. IDN is RECONCILED (punycode
      host vs Unicode .dat via `domainToASCII`), exceeding the fail-closed floor.
- [x] `matchMode` is a `login` **metadata** field (surfaced via `metadataOf`, modeled like `hasTotp`,
      default `'exact'`; legacy = exact); it is **not** in `SCHEMA.login.nonSecret`, never renders as a
      text field, never carries a secret, and does not trip the editor drift-guard.
- [x] A `matchMode:'registrable-domain'` credential fills across a **hardened-matched subdomain**
      (e.g. `accounts.example.com` ↔ `example.com`) with the **same scheme**, but is **refused** across
      an unrelated registry sibling, a multi-tenant platform tenant, a scheme mismatch, or on any matcher
      uncertainty (→ exact) — at ALL THREE fill sites (automation / human / picker).
- [x] **Capture disposition stays exact** for a registrable-domain item: submitting on a matched
      subdomain does NOT disposition as an update to the eTLD+1 item and does NOT rewrite its origin.
- [x] Exact-origin remains the default and is byte-for-byte unchanged for `matchMode:'exact'`/legacy
      items and for any `originMatches` call with `widen` omitted.
- [x] Existing tests pass (the one exact-row-shape pin in `vault-store-reachable.test.js` and the
      matchMode metadata pin in `vault-item-schema.test.js` were extended for the new `widened`/`matchMode`
      fields — both are the very contracts this leg extends); `npm test` (2614/0), `npm run typecheck`, lint clean.

## Verification Steps

- Unit: the PSL parser (rule classes incl. exception + fail-closed null cases); `originMatches` (exact
  with `widen:false`; widen/refuse/fail-closed incl. either-null and both-null); the three sites honoring
  `matchMode`; capture disposition stays exact.
- Integration: a `registrable-domain` credential — fills the matched subdomain, refused across the
  excluded sibling/tenant/scheme — at automation fill, human fill, and the picker.
- `npm test` full — no regressions. typecheck + lint clean.
- Grep: `matchMode` never a secret / never in `nonSecret`; the matcher never uses `trackers.js`'s
  `MULTI_SUFFIX`/`registrableDomain`.

## Implementation Guidance

1. **PSL data + parser first** — vendor `public_suffix_list.dat` (record source + date); `src/main/vault/psl.js`
   parses it once at module load into an index, then `registrableDomainSafe(host)` per the algorithm in
   Outputs (exception>wildcard>longest; +1 label; null on suffix-is-host / IP / unparseable / IDN-unless-
   reconciled). Pure; unit-test the rule classes exhaustively.
2. **`matchMode` field** — surface via `metadataOf` as an explicit metadata flag (mirror `hasTotp`), with
   a dedicated editor toggle + `assembleSave` handling; do NOT add to `SCHEMA.login.nonSecret`.
3. **`originMatches(item, tabOrigin, { widen })`** (new `src/shared/origin-match.js`) — `URL`-parse both
   origins, fail-closed to exact on parse failure; positive `matchMode === 'registrable-domain'` test;
   same protocol + both `registrableDomainSafe` non-null + equal. Wire into the two fill sites with
   `{widen:true}`; give `reachableLoginItems` a `{widen}` option and pass `widen:true` from the picker
   path (`vault-human.js:158`) but not the capture path (`vault-human.js:251`).
4. **Editor + picker** — the toggle (default exact) + the widened-match badge (explicit `widened` row
   flag). `textContent`-only.
5. **Fix stale cite** — flight DD5 (`flight.md:142`) cites the picker filter as `vault-store.js:885`; the
   real filter is `:1191`. Note this in the flight-log entry (do not silently rewrite the flight spec body).

## Edge Cases

- **PSL miss / IP literal / unparseable / origin-parse failure** — `registrableDomainSafe`/`URL` → null →
  `originMatches` falls back to exact (fail-closed, no widening).
- **Exception-over-wildcard** — an `!` rule un-wildcards its parent even where a `*` rule would otherwise
  extend the suffix; the exception wins irrespective of label count.
- **Scheme mismatch** (https item vs http tab) — refused even in registrable-domain mode (protocol differs;
  exact fallback also refuses). The MITM guard.
- **`matchMode` absent (legacy)** — `metadataOf` yields `null` → treated as `'exact'` (positive-test path).
- **Multi-tenant platform** (`alice.github.io` vs `bob.github.io`) — the PSL lists `github.io` as a
  public suffix, so their eTLD+1 differ → refused. The whole point.
- **Registry sibling** (`a.co.id` vs `b.co.id`) — `co.id` is a public suffix in the PSL → refused.
- **Capture** — always exact (widen not passed); a subdomain submit never rewrites an eTLD+1 item's origin.
- **Port** — the registrable-domain widen requires same scheme; port need not match across subdomains
  (documented). Exact mode still requires the full origin incl. port.

## Files Affected

- `public_suffix_list.dat` (vendored data) + `src/main/vault/psl.js` (new parser).
- `src/shared/origin-match.js` (new) — `originMatches`.
- `src/shared/vault-item-schema.js` — `matchMode` via `metadataOf` (not `nonSecret`).
- `src/main/vault/vault-context.js`, `src/main/vault/vault-human.js`, `src/main/vault/vault-store.js` — the three sites + the `{widen}` option (picker-only).
- `src/shared/vault-editor-model.js` + `src/renderer/pages/vault.js` — the toggle; `src/shared/vault-picker-template.js` — the badge.
- `src/main/internal-page-map.js` — the `origin-match.js` shared-module route (if the page imports it).
- `test/unit/…` — the PSL parser, `originMatches`, the three sites, capture-stays-exact.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
