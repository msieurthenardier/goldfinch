// @ts-check
// goldfinch://vault serves this through an exact flat route (internal-page-map.js). It
// statically imports NOTHING from src/shared/: the pure destination-label helper is
// injected by vault.js, so a unit test loads this file by plain dynamic import() (the
// vault-filter-controller.js / vault-browser-import-controller.js precedent).

/**
 * Every operator-facing copy string of the Copy-to flow (AC12) in one frozen table, so the
 * unit test asserts against the shipped text rather than a retyped literal.
 */
export const COPY_TEXT = Object.freeze({
  untitled: '(untitled)',
  step1Title: (/** @type {string} */ title) => `Copy “${title}” to…`,
  destLabel: 'Copy to',
  destAria: 'Copy destination',
  noDestination: 'There is no other vault to copy to.',
  submitStep1: 'Copy',
  step2Title: (/** @type {string} */ dest) => `Already in ${dest}`,
  step2Message: (/** @type {string} */ title, /** @type {string|null} */ username) =>
    username ? `The destination already has “${title}” (${username}).` : `The destination already has “${title}”.`,
  step2Identity: (/** @type {string} */ dest, /** @type {string} */ title) =>
    `${dest} already has an identity profile, “${title}”. A vault holds only one.`,
  destPlaceholder: 'Choose a vault…',
  choiceLegend: 'What should happen?',
  choiceSkip: 'Skip — do not copy this item',
  choiceReplace: 'Replace — the existing item’s fields will be overwritten',
  choiceReplaceIdentity: 'Replace the existing identity profile',
  choiceKeepBoth: 'Keep both — copy this as a new item',
  submitStep2: 'Apply',
  submitStep2Identity: 'Replace',
  stale: 'This vault changed since you chose — please choose again.',
  busy: 'A vault rotation is in progress — try again when it finishes.',
  state: 'This item could not be copied to that vault.',
  failed: 'Copy failed.',
  copied: (/** @type {string} */ dest) => `Copied to ${dest}.`,
  keptBoth: (/** @type {string} */ dest, /** @type {string} */ title) => `Copied to ${dest} as “${title}”.`,
  replaced: (/** @type {string} */ dest, /** @type {string} */ title) => `Replaced “${title}” in ${dest}.`,
  skipped: 'Skipped — nothing copied.',
  alreadyPresent: (/** @type {string} */ dest) => `Already in ${dest} — nothing copied.`,
  deleteFailed: 'Could not delete the item.',
  revokeFailed: 'Could not revoke the access key.'
});

const RESOLUTION_ORDER = ['skip', 'replace', 'keep-both'];

/**
 * Owns the per-item row actions that open a modal: the delete confirm and the
 * revoke-access-key confirm (moved verbatim from vault.js) plus the two-step Copy-to flow
 * (Sortie 04, DD8/DD9). Every render is `textContent`-only; the only reply fields ever
 * shown are `match.title`, `match.username`, the kept-both `title` and destination labels.
 *
 * @param {{
 *   document: any,
 *   bridge: {
 *     vaultItemDelete: (a: any) => Promise<any>,
 *     vaultAccessKeyRevoke: (a: any) => Promise<any>,
 *     vaultItemCopy: (a: any) => Promise<any>,
 *     vaultState: () => Promise<any>
 *   },
 *   dom: {
 *     el: (tag: string, className?: string, text?: string) => any,
 *     iconButton: (iconKey: string, ariaLabel: string, onClick: () => void, opts?: any) => any,
 *     openModal: (opts: any) => { close: () => void, setSubmitEnabled: (on: boolean) => void, setStatus: (text: string) => void },
 *     appendOption: (select: any, value: string, text: string) => void
 *   },
 *   copyDestinationOptions: (jars: any, presence: any, globalPresence: any, sourceVaultId: string) => Array<{ vaultId: string, label: string }>,
 *   getJarRows: () => any[],
 *   getJarVaultPresence: () => Record<string, any>,
 *   getRenderEpoch: () => number,
 *   refresh: () => void,
 *   setNotice: (text: string) => void
 * }} deps
 */
export function createItemActionsController(deps) {
  const { document, bridge, dom, copyDestinationOptions, getJarRows, getJarVaultPresence } = deps;
  const { getRenderEpoch, refresh, setNotice } = deps;
  const { el, openModal, appendOption } = dom;

  /**
   * The delete-item confirm modal (DD-C: reuse openModal, a message body + a danger submit). The
   * per-row Delete opens this DIRECTLY. Only on confirm does it call vaultItemDelete; a
   * { locked } race closes the modal + refreshes.
   * @param {{ vaultId: string, itemId: string, title: string }} args
   */
  function openDeleteConfirm({ vaultId, itemId, title }) {
    const body = el('div', 'vault-modal-form');
    const msg = el('p', 'vault-confirm-message');
    msg.appendChild(document.createTextNode('Permanently delete '));
    msg.appendChild(el('strong', 'vault-confirm-name', title)); // attacker-influenced → textContent
    msg.appendChild(document.createTextNode('? This can’t be undone.'));
    body.appendChild(msg);

    const handle = openModal({
      title: 'Delete item',
      body,
      submitLabel: 'Delete',
      submitEnabled: true,
      danger: true,
      onSubmit: () => {
        handle.setSubmitEnabled(false);
        Promise.resolve(bridge.vaultItemDelete({ vaultId, itemId }))
          .then(() => {
            handle.close();
            refresh();
          })
          .catch(() => {
            handle.setStatus(COPY_TEXT.deleteFailed);
            handle.setSubmitEnabled(true);
          });
      }
    });
  }

  /**
   * The revoke-access-key confirm modal (DD-B). Same shape as the delete confirm; on confirm
   * calls vaultAccessKeyRevoke and re-fetches the key list (a { locked } race refreshes the page).
   * @param {{ vaultId: string, keyId: string, refreshKeys: () => void }} args
   */
  function openRevokeConfirm({ vaultId, keyId, refreshKeys }) {
    const body = el('div', 'vault-modal-form');
    const msg = el('p', 'vault-confirm-message');
    msg.appendChild(document.createTextNode('Revoke access key '));
    msg.appendChild(el('strong', 'vault-confirm-name', keyId));
    msg.appendChild(document.createTextNode('? Any automation using it will stop working.'));
    body.appendChild(msg);

    const handle = openModal({
      title: 'Revoke access key',
      body,
      submitLabel: 'Revoke',
      submitEnabled: true,
      danger: true,
      onSubmit: () => {
        handle.setSubmitEnabled(false);
        Promise.resolve(bridge.vaultAccessKeyRevoke({ vaultId, keyId }))
          .then((res) => {
            if (!res || res.locked) {
              handle.close();
              refresh();
              return;
            }
            handle.close();
            refreshKeys();
          })
          .catch(() => {
            handle.setStatus(COPY_TEXT.revokeFailed);
            handle.setSubmitEnabled(true);
          });
      }
    });
  }

  /** @param {unknown} title @returns {string} */
  const titleOf = (title) => (typeof title === 'string' && title ? title : COPY_TEXT.untitled);

  /** The destination's display name: the label text before its " — N secrets" suffix. */
  const destName = (/** @type {string} */ label) => {
    const i = label.lastIndexOf(' — ');
    return i === -1 ? label : label.slice(0, i);
  };

  /**
   * The ONE copy call site (both steps). `epoch` is the render epoch of the modal that sent it:
   * once a render has moved past it the modal is gone, so a reply opens no modal and sets no
   * status — but a WRITTEN outcome still surfaces its notice, so a landed copy always has a surface.
   * @param {any} payload
   * @param {number} epoch
   * @param {{ close: () => void, setSubmitEnabled: (on: boolean) => void, setStatus: (text: string) => void }} handle
   * @param {{ destName: string, vaultId: string, meta: any, invoker: any, match?: any }} ctx
   */
  function submitCopy(payload, epoch, handle, ctx) {
    const moved = () => getRenderEpoch() !== epoch;
    /** @param {string} text @param {boolean} written */
    const finish = (text, written) => {
      if (moved() && !written) return;
      if (!moved()) handle.close();
      setNotice(text);
      refresh();
    };
    /** @param {string} text */
    const fail = (text) => {
      if (moved()) return;
      handle.setStatus(text);
      handle.setSubmitEnabled(true);
    };
    Promise.resolve()
      .then(() => bridge.vaultItemCopy(payload))
      .then(
        (res) => {
          if (res && res.locked) {
            if (!moved()) handle.close();
            if (!moved()) refresh();
            return;
          }
          if (!res || res.ok !== true) {
            fail(
              res && res.reason === 'busy'
                ? COPY_TEXT.busy
                : res && res.reason === 'state'
                  ? COPY_TEXT.state
                  : COPY_TEXT.failed
            );
            return;
          }
          switch (res.outcome) {
            case 'copied':
              return finish(COPY_TEXT.copied(ctx.destName), true);
            case 'kept-both':
              return finish(COPY_TEXT.keptBoth(ctx.destName, titleOf(res.title)), true);
            case 'replaced':
              return finish(COPY_TEXT.replaced(ctx.destName, titleOf(ctx.match && ctx.match.title)), true);
            case 'skipped':
              return finish(COPY_TEXT.skipped, false);
            case 'already-present':
              return finish(COPY_TEXT.alreadyPresent(ctx.destName), false);
            case 'needs-resolution':
              if (moved()) return;
              if (ctx.invoker && ctx.invoker.isConnected) ctx.invoker.focus();
              renderStep2(
                payload,
                { ...ctx, match: res.match, allowed: res.allowed },
                payload.resolution !== undefined
              );
              return;
            default:
              fail(COPY_TEXT.failed);
          }
        },
        () => fail(COPY_TEXT.failed)
      );
  }

  /**
   * Step 2 — the collision choice. `ctx.allowed` is rendered exactly (DD3); the checked radio is
   * read AT SUBMIT TIME. `stale` re-renders from a new match with the status line.
   * @param {any} prior
   * @param {{ destName: string, vaultId: string, meta: any, invoker: any, match: any, allowed: any }} ctx
   * @param {boolean} stale
   */
  function renderStep2(prior, ctx, stale) {
    const match = ctx.match && typeof ctx.match === 'object' ? ctx.match : {};
    const allowed = RESOLUTION_ORDER.filter((r) => Array.isArray(ctx.allowed) && ctx.allowed.includes(r));
    const identity = match.type === 'identity';
    const body = el('div', 'vault-modal-form');
    body.appendChild(
      el(
        'p',
        'vault-confirm-message',
        identity
          ? COPY_TEXT.step2Identity(ctx.destName, titleOf(match.title))
          : COPY_TEXT.step2Message(
              titleOf(match.title),
              match.type === 'login' && typeof match.username === 'string' && match.username ? match.username : null
            )
      )
    );
    const group = el('fieldset', 'vault-copy-choice');
    group.appendChild(el('legend', 'vault-field-label', COPY_TEXT.choiceLegend));
    const radios = [];
    for (const [i, resolution] of allowed.entries()) {
      const row = el('label', 'vault-copy-option');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'vault-copy-resolution';
      radio.value = resolution;
      radio.checked = i === 0; // ordered skip, replace, keep-both: Skip, else the only/first option
      radios.push(radio);
      row.appendChild(radio);
      const text =
        resolution === 'skip'
          ? COPY_TEXT.choiceSkip
          : resolution === 'replace'
            ? identity
              ? COPY_TEXT.choiceReplaceIdentity
              : COPY_TEXT.choiceReplace
            : COPY_TEXT.choiceKeepBoth;
      row.appendChild(el('span', undefined, text));
      group.appendChild(row);
    }
    body.appendChild(group);

    const epoch = getRenderEpoch();
    const handle = openModal({
      title: COPY_TEXT.step2Title(ctx.destName),
      body,
      submitLabel: identity ? COPY_TEXT.submitStep2Identity : COPY_TEXT.submitStep2,
      submitEnabled: radios.length > 0,
      onSubmit: () => {
        const chosen = radios.find((r) => r.checked);
        if (!chosen) return;
        handle.setSubmitEnabled(false);
        submitCopy(
          {
            sourceVaultId: prior.sourceVaultId,
            itemId: prior.itemId,
            destVaultId: prior.destVaultId,
            resolution: chosen.value,
            matchId: match.id
          },
          epoch,
          handle,
          ctx
        );
      }
    });
    if (stale) handle.setStatus(COPY_TEXT.stale);
  }

  /**
   * Step 1 — pick a destination. The global vault's presence is a fresh `vaultState()` read (the
   * browser-import precedent); jar presence comes from the page's refreshed caches (advisory —
   * main is authoritative).
   * @param {{ vaultId: string, meta: any, invoker?: any }} args
   */
  function openCopyTo({ vaultId, meta, invoker }) {
    Promise.resolve()
      .then(() => bridge.vaultState())
      .then((state) => {
        const vaults = Array.isArray(state && state.vaults) ? state.vaults : [];
        const g = vaults.find((/** @type {any} */ v) => v && v.vaultId === 'global');
        return g && typeof g.count === 'number' ? { hasVault: true, count: g.count } : { hasVault: false };
      })
      .catch(() => ({ hasVault: false }))
      .then((globalPresence) => {
        const options = copyDestinationOptions(getJarRows(), getJarVaultPresence(), globalPresence, vaultId);
        const body = el('div', 'vault-modal-form');
        let select = null;
        if (options.length) {
          const field = el('label', 'vault-field');
          field.appendChild(el('span', 'vault-field-label', COPY_TEXT.destLabel));
          select = el('select', 'vault-settings-select');
          select.setAttribute('aria-label', COPY_TEXT.destAria);
          appendOption(select, '', COPY_TEXT.destPlaceholder);
          select.children[0].disabled = true;
          select.children[0].selected = true;
          select.value = '';
          for (const o of options) appendOption(select, o.vaultId, o.label);
          field.appendChild(select);
          body.appendChild(field);
        } else {
          body.appendChild(el('p', 'vault-lede', COPY_TEXT.noDestination));
        }
        const epoch = getRenderEpoch();
        const handle = openModal({
          title: COPY_TEXT.step1Title(titleOf(meta && meta.title)),
          body,
          submitLabel: COPY_TEXT.submitStep1,
          submitEnabled: false,
          onSubmit: () => {
            if (!select) return;
            const destVaultId = select.value;
            const chosen = options.find((o) => o.vaultId === destVaultId);
            if (!chosen) return;
            handle.setSubmitEnabled(false);
            submitCopy({ sourceVaultId: vaultId, itemId: meta.id, destVaultId }, epoch, handle, {
              destName: destName(chosen.label),
              vaultId,
              meta,
              invoker
            });
          }
        });
        if (select) select.addEventListener('change', () => handle.setSubmitEnabled(select.value !== ''));
      });
  }

  return { openDeleteConfirm, openRevokeConfirm, openCopyTo };
}
