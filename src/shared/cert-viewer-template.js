// @ts-check

// DOM builder for the menu-overlay sheet's `cert-viewer` template (Mission 20
// Flight 2 Leg 4, DD9) — a READ-ONLY certificate summary card, fed by main's
// pure `certificate-summary.js` output over the chrome-trust `tab-certificate-
// get` read. Pure, document-injected builder (the cert-override-template.js /
// bookmark-edit-template.js idiom) — structure/aria is unit-testable offline;
// menu-overlay.js imports this and wires behaviour: a dismissible dialog card
// (Close focused on open, Escape/Close/backdrop/blur dismiss) — no invoke,
// nothing to submit, nothing to secure beyond what's already public in the
// TLS handshake. Every string renders via textContent only; the rows
// container scrolls independently of the fixed status line (the
// container-picker max-height + overflow-y idiom, menu-overlay.css).
//
// SECURITY: the model is exactly what tab-certificate-get returns — strings
// and capped arrays only (certificate-summary.js's own contract). This
// template never receives, and could not render, a PEM/Buffer/raw
// certificate object.

/**
 * Build the cert-viewer card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   status: HTMLElement,
 *   rows: HTMLElement,
 *   close: HTMLButtonElement,
 * }}
 */
export function buildCertViewerCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-cert-viewer';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner cert-viewer-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Certificate');
  node.appendChild(card);

  const status = document.createElement('div');
  status.id = 'sheet-cert-viewer-status';
  status.className = 'cert-viewer-status';
  card.appendChild(status);

  const rows = document.createElement('div');
  rows.id = 'sheet-cert-viewer-rows';
  rows.className = 'cert-viewer-rows';
  card.appendChild(rows);

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const close = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  close.id = 'sheet-cert-viewer-close';
  close.className = 'text-btn primary vault-sheet-btn';
  close.type = 'button';
  close.textContent = 'Close';
  actions.appendChild(close);
  card.appendChild(actions);

  return { node, card, status, rows, close };
}

/**
 * Flatten a principal object ({commonName, organization, locality, state,
 * country}) into "CN=x, O=y, L=z, ST=w, C=v" — only present fields, in that
 * order (certificate-summary.js's own flattenElectronPrincipal shape).
 * Never throws — a missing/malformed principal degrades to ''.
 * @param {any} p
 * @returns {string}
 */
function formatPrincipal(p) {
  if (!p || typeof p !== 'object') return '';
  const parts = [];
  if (p.commonName) parts.push(`CN=${p.commonName}`);
  if (p.organization) parts.push(`O=${p.organization}`);
  if (p.locality) parts.push(`L=${p.locality}`);
  if (p.state) parts.push(`ST=${p.state}`);
  if (p.country) parts.push(`C=${p.country}`);
  return parts.join(', ');
}

/**
 * The status line's copy — one of the four DD9 strings. A missing/null
 * summary (an evicted observer entry, or an internal/blank tab) is the
 * "unavailable" case; every other branch keys off `summary.status`.
 * @param {any} summary
 * @returns {string}
 */
function statusLine(summary) {
  if (!summary || typeof summary !== 'object') return 'Certificate details unavailable — reload to refresh';
  const error = typeof summary.error === 'string' && summary.error ? ` — ${summary.error}` : '';
  if (summary.status === 'overridden') return `Overridden this session${error}`;
  if (summary.status === 'untrusted') return `Not trusted${error}`;
  return 'Trusted';
}

/**
 * Append one labelled row (the site-info popup's `.si-row`/`.si-label`/
 * `.si-value` shape — reused here so the sheet's two read-only dialogs share
 * one visual language) into `container`. Text only, via textContent.
 * @param {Document} document
 * @param {HTMLElement} container
 * @param {string} label
 * @param {string} value
 */
function addRow(document, container, label, value) {
  const row = document.createElement('div');
  row.className = 'si-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'si-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'si-value';
  valueEl.textContent = value;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  container.appendChild(row);
}

/**
 * Pure: populate the status line + the labelled rows from the main-computed
 * certificate summary (tab-certificate-get's reply — DD9's shape). A
 * missing/null summary renders the status line ALONE, no rows (the "reload
 * to refresh" edge case) — never a throw. Every field renders via
 * textContent only; the SAN/chain arrays render EXACTLY what they are
 * given — capping happens at the summary layer (certificate-summary.js),
 * never here.
 * @param {{ status: HTMLElement, rows: HTMLElement }} card
 * @param {any} summary
 */
export function applyCertViewerModel(card, summary) {
  const document = card.rows.ownerDocument;
  card.status.textContent = statusLine(summary);
  card.rows.textContent = '';
  if (!summary || typeof summary !== 'object') return;

  addRow(document, card.rows, 'Issued to', formatPrincipal(summary.subject));
  addRow(document, card.rows, 'Issued by', formatPrincipal(summary.issuer));
  addRow(document, card.rows, 'Valid from', typeof summary.validFrom === 'string' ? summary.validFrom : '');
  addRow(document, card.rows, 'Valid until', typeof summary.validTo === 'string' ? summary.validTo : '');
  const san = Array.isArray(summary.san) ? summary.san : [];
  addRow(document, card.rows, 'Subject alternative names', san.length ? san.join(', ') : '—');
  addRow(document, card.rows, 'Serial', typeof summary.serial === 'string' ? summary.serial : '');
  const sha256 =
    (summary.fingerprints && typeof summary.fingerprints.sha256 === 'string' && summary.fingerprints.sha256) || '';
  const sha1 =
    (summary.fingerprints && typeof summary.fingerprints.sha1 === 'string' && summary.fingerprints.sha1) || '';
  addRow(document, card.rows, 'SHA-256 fingerprint', sha256);
  addRow(document, card.rows, 'SHA-1 fingerprint', sha1);
  const chain = Array.isArray(summary.chain) ? summary.chain : [];
  if (!chain.length) {
    addRow(document, card.rows, 'Chain', '—');
  } else {
    chain.forEach((link, i) => {
      const subject = (link && typeof link.subject === 'string' && link.subject) || '';
      const issuer = (link && typeof link.issuer === 'string' && link.issuer) || '';
      addRow(document, card.rows, `Chain[${i}]`, `${subject} → ${issuer}`);
    });
  }
}
