// @ts-check
// The one sentence both surfaces use when the automation server is not on the port that was configured
// (Mission 23 Flight 2, leg `port-and-permissions`, flight DD5: the fallback stays, and it is shown). The
// chrome's indicator tooltip and the automation page both call this, so the wording cannot drift. Pure; never
// throws.

/**
 * @param {unknown} configured  the configured port, or anything else for "not known"
 * @param {unknown} bound  the port the server is listening on, or null when it is not listening
 * @returns {string | null}  the line, or null when there is nothing to say (equal, not listening, not known)
 */
export function portMovedLine(configured, bound) {
  if (!Number.isInteger(configured) || !Number.isInteger(bound)) return null;
  if (configured === bound) return null;
  return 'Listening on ' + bound + ' — ' + configured + ' was in use';
}
