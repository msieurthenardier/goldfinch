// @ts-check

import { isInternalPageUrl, isSafeTabUrl } from './url-safety.js';

export const MAX_CLOSED_TABS = 25;

/**
 * Move one item in an ordered collection without mutating the input.
 * @template T
 * @param {T[]} items
 * @param {number} from
 * @param {number} to
 * @returns {T[]}
 */
export function moveItem(items, from, to) {
  if (!Array.isArray(items) || !Number.isInteger(from) || !Number.isInteger(to)) return Array.isArray(items) ? [...items] : [];
  if (from < 0 || from >= items.length) return [...items];
  const clamped = Math.max(0, Math.min(to, items.length - 1));
  if (clamped === from) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

/**
 * Build the tab-scoped menu rendered by the shared menu-overlay sheet.
 * @param {{ index: number, count: number, canReopen: boolean }} input
 */
export function tabContextModel({ index, count, canReopen }) {
  const hasTab = Number.isInteger(index) && index >= 0 && index < count;
  const item = (id, label, disabled = false) => ({ type: 'item', id, label, disabled });
  return [
    item('tab:close', 'Close', !hasTab),
    item('tab:close-others', 'Close other tabs', !hasTab || count <= 1),
    item('tab:close-right', 'Close tabs to the right', !hasTab || index >= count - 1),
    { type: 'separator' },
    item('tab:duplicate', 'Duplicate', !hasTab),
    item('tab:move-new-window', 'Move to new window', !hasTab),
    { type: 'separator' },
    item('tab:reopen-closed', 'Reopen closed tab', !canReopen),
  ];
}

/** @param {unknown} v */
function cleanString(v) {
  return typeof v === 'string' ? v : '';
}

/**
 * Return a persistence/transfer-safe tab record, or null for invalid and burner
 * tabs. Burner exclusion is enforced here so every caller gets the privacy rule.
 *
 * @param {any} raw
 * @returns {{
 *   url: string,
 *   title: string,
 *   favicon: string | null,
 *   trusted: boolean,
 *   container: { id: string, name: string, color: string, partition: string }
 * } | null}
 */
function normalizeRecord(raw, { allowBurner }) {
  if (!raw || typeof raw !== 'object') return null;
  const trusted = raw.trusted === true;
  const url = cleanString(raw.url);
  if (!(trusted ? isInternalPageUrl(url) : isSafeTabUrl(url))) return null;
  const c = raw.container;
  if (!c || typeof c !== 'object' || (!allowBurner && c.burner === true)) return null;
  const id = cleanString(c.id);
  const name = cleanString(c.name);
  const color = cleanString(c.color);
  const partition = cleanString(c.partition);
  if (!id || !name || !color || !partition) return null;
  if (trusted && id !== 'internal') return null;
  if (!trusted && id === 'internal') return null;
  const container = { id, name, color, partition };
  if (allowBurner && c.burner === true) container.burner = true;
  return {
    url,
    title: cleanString(raw.title) || url,
    favicon: typeof raw.favicon === 'string' && raw.favicon ? raw.favicon : null,
    trusted,
    container,
  };
}

export function normalizeTabRecord(raw) {
  return normalizeRecord(raw, { allowBurner: false });
}

/**
 * Normalize a live transfer payload. Unlike durable records, this preserves a
 * burner marker so private tabs can move without becoming restorable.
 * @param {any} raw
 */
export function normalizeTabTransferRecord(raw) {
  return normalizeRecord(raw, { allowBurner: true });
}

/**
 * Normalize the durable app-level tab state. Unknown/corrupt records are
 * discarded independently instead of invalidating the entire session.
 * @param {any} raw
 */
export function normalizeTabSession(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const windows = Array.isArray(source.windows)
    ? source.windows.map((candidate) => {
      const records = Array.isArray(candidate?.tabs)
        ? candidate.tabs.map(normalizeTabRecord).filter(Boolean)
        : [];
      if (records.length === 0) return null;
      const activeIndex = Number.isInteger(candidate?.activeIndex)
        ? Math.max(0, Math.min(candidate.activeIndex, records.length - 1))
        : 0;
      return { tabs: records, activeIndex };
    }).filter(Boolean)
    : [];
  const closedTabs = Array.isArray(source.closedTabs)
    ? source.closedTabs.map(normalizeTabRecord).filter(Boolean).slice(0, MAX_CLOSED_TABS)
    : [];
  return { version: 1, windows, closedTabs };
}

/**
 * Push newest-first into the bounded closed-tab stack.
 * @param {any[]} stack
 * @param {any} record
 */
export function pushClosedTab(stack, record) {
  const normalized = normalizeTabRecord(record);
  if (!normalized) return Array.isArray(stack) ? [...stack].slice(0, MAX_CLOSED_TABS) : [];
  return [normalized, ...(Array.isArray(stack) ? stack : [])].slice(0, MAX_CLOSED_TABS);
}
