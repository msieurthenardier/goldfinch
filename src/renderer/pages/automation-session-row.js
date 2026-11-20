// @ts-check
// Pure helper for the automation page's active-session rows (squawk 0161). Two sessions of the same kind and
// identity opened in the same second otherwise render identical rows, so each row also shows the first
// SESSION_ID_PREFIX_LENGTH characters of its session id (operator ruling 2026-11-19). The page already
// receives the full id in the activity snapshot; nothing new crosses IPC.

export const SESSION_ID_PREFIX_LENGTH = 8;

/**
 * @param {unknown} sessionId
 * @returns {string | null} the leading characters of a non-empty string id, or null when there is none to show
 */
export function sessionIdPrefix(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  return sessionId.slice(0, SESSION_ID_PREFIX_LENGTH);
}
