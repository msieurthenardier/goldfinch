// @ts-check

// M18 F3 L1 (DD8): the vault-credential menuType allowlist for the blur-survival axis
// — operator ruling: vault credential sheets retain their half-entered state through
// window blur/refocus (the copy-paste-from-another-secrets-manager scenario), reversing
// the shipped default. Membership was VERIFIED at design review against the sheet
// templates: every listed menuType renders a `type="password"` input.
//
// Applied ONCE, at the SINGLE chrome-side funnel every vault sheet open passes through
// (`src/renderer/chrome/overlay-menus.js`'s `open()`) — never scattered across the ~20
// `vault-controller.js` open call sites (including the `*ForAudit` a11y duplicates,
// which funnel through that same `open()` too). A single shared Set, imported by both
// the chrome funnel and `menu-overlay-manager.js`'s close-on-lock scoping below, so
// membership can never drift between the two sites.
//
// 'vault-import-unlock' is the menuType actually threaded through `open()` for the
// import-bundle secret sheet — the TEMPLATE it renders is keyed 'vault-import' in
// menu-overlay.js's TEMPLATES map (a naming split that predates this leg; the entry
// below tracks the open-time menuType, since that's what the funnel and the manager
// both key on).
//
// Explicitly OUT (verified at design review): the dismiss-locked one-time-key SHOW
// sheets (vault-recovery-show, vault-accesskey-show, vault-adminkey-show — already
// `dismissible:false`, blur-immune via THAT axis), vault-capture (the capture offer
// card — no typed secret; its own `dismissible:false` is an unrelated mechanism and
// stays untouched), vault-picker (metadata-only by design).
const VAULT_BLUR_SURVIVAL_MENU_TYPES = Object.freeze(
  new Set([
    'vault-unlock',
    'vault-set',
    'vault-stepup',
    'vault-import-unlock',
    'vault-change-master',
    'vault-recover',
    'vault-compromise',
    'vault-compromise-recover'
  ])
);

/**
 * Whether `menuType` is in the blur-survival allowlist.
 * @param {string} menuType
 * @returns {boolean}
 */
export function survivesBlur(menuType) {
  return VAULT_BLUR_SURVIVAL_MENU_TYPES.has(menuType);
}

// Close-on-lock scope (DD8, this leg's AC): the SAME allowlist, MINUS 'vault-unlock' —
// locking is vault-unlock's own precondition, not its invalidation (a duplicate/racing
// lock broadcast must never close the prompt mid-typing, and there would be no way to
// re-open it), so it is exempt even though it survives blur. Every OTHER allowlisted
// sheet — including vault-recover / vault-compromise-recover, which both work from a
// LOCKED vault — still closes on lock: autolock firing means the operator walked away,
// and wiping half-typed new-master material is the conservative ruling (the flow
// reopens cleanly from the locked state).
/**
 * @param {string} menuType
 * @returns {boolean}
 */
export function closesOnVaultLock(menuType) {
  return menuType !== 'vault-unlock' && VAULT_BLUR_SURVIVAL_MENU_TYPES.has(menuType);
}

export { VAULT_BLUR_SURVIVAL_MENU_TYPES };
