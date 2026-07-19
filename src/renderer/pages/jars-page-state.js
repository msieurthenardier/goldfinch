export const EMPTY_UI = Object.freeze({ mode: null, rowId: null, action: null, draft: null });

export function normalizeDefaultId(def, burnerId) {
  if (!def || typeof def.id !== 'string' || def.id === burnerId) return null;
  return def.id;
}

export function findContainer(containers, id) {
  return containers.find((container) => container.id === id) || null;
}

export function reconcileTransient(ui, rows) {
  if (ui.mode !== 'confirm' || rows.some((row) => row.id === ui.rowId)) return ui;
  return { ...EMPTY_UI };
}

export function stateFromPayload(previous, payload) {
  const containers = Array.isArray(payload?.containers) ? payload.containers : [];
  const defaultId = payload?.defaultId ?? null;
  if (previous.containers === containers && previous.defaultId === defaultId) return previous;
  return { containers, defaultId };
}

export function sectionSetKey(rows) {
  return rows.map((row) => row.id).join('|');
}

/** @returns {'create'|null} */
export function createPanelModeKey(ui) {
  return ui.mode === 'create' ? 'create' : null;
}

export function exactHashTarget(hash, validIds) {
  if (typeof hash !== 'string' || hash.length < 2 || hash[0] !== '#') return null;
  const target = hash.slice(1);
  return validIds.has(target) ? target : null;
}
