// @ts-check
'use strict';

// Mission 23 Flight 1 (leg `downloads`): the pure decision behind the downloads page's Retry. A retry
// re-requests the record's URL through the session the download came from (`record.partition`); this
// module only decides WHETHER that is possible and says why not. Electron-free: every fact about the
// live app (which jars exist, whether a burner still has a tab) is injected.

const { isBurnerPartition } = require('../shared/burner');

/** Reason codes a refused retry answers (the page and the unit tests share this closed set). */
const RETRY_REASONS = Object.freeze({
  NO_RECORD: 'no-record',
  NO_PARTITION: 'no-partition',
  JAR_GONE: 'jar-gone',
  BURNER_GONE: 'burner-gone',
  UNSUPPORTED_URL: 'unsupported-url',
  REQUEST_FAILED: 'request-failed'
});

const REASON_TEXT = Object.freeze({
  [RETRY_REASONS.NO_RECORD]: 'Cannot retry: this download is no longer in the list.',
  [RETRY_REASONS.NO_PARTITION]: 'Cannot retry: this download does not record which identity it came from.',
  [RETRY_REASONS.JAR_GONE]: 'Cannot retry: the identity this download came from no longer exists.',
  [RETRY_REASONS.BURNER_GONE]: 'Cannot retry: the Burner tab this download came from has been closed.',
  [RETRY_REASONS.UNSUPPORTED_URL]: 'Cannot retry: only web addresses can be downloaded again.',
  [RETRY_REASONS.REQUEST_FAILED]: 'Cannot retry: the request could not be started.'
});

/**
 * The one line the downloads page shows for a reason code. Unknown codes get a generic line, never a
 * thrown error and never the raw code.
 * @param {unknown} code
 * @returns {string}
 */
function retryReasonText(code) {
  return (
    (typeof code === 'string' && Object.hasOwn(REASON_TEXT, code) && REASON_TEXT[code]) || 'Cannot retry this download.'
  );
}

/** @param {unknown} url */
function isHttpUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Decide a retry. Refused (with a reason, doing nothing) when: there is no record; the record has no
 * partition; the partition is a persistent jar that no longer exists; the partition is a burner with no
 * live tab or popup left; or the record's URL is not http(s).
 *
 * @param {any} record
 * @param {{ isJarPartition: (partition: string) => boolean, isBurnerLive: (partition: string) => boolean }} env
 * @returns {{ ok: boolean, partition?: string, url?: string, reason?: string }}
 */
function planRetry(record, env) {
  if (!record || typeof record !== 'object') return { ok: false, reason: RETRY_REASONS.NO_RECORD };
  const partition = record.partition;
  if (typeof partition !== 'string' || partition === '') return { ok: false, reason: RETRY_REASONS.NO_PARTITION };
  if (!isHttpUrl(record.url)) return { ok: false, reason: RETRY_REASONS.UNSUPPORTED_URL };
  if (isBurnerPartition(partition)) {
    if (!env.isBurnerLive(partition)) return { ok: false, reason: RETRY_REASONS.BURNER_GONE };
  } else if (!env.isJarPartition(partition)) {
    return { ok: false, reason: RETRY_REASONS.JAR_GONE };
  }
  return { ok: true, partition, url: record.url };
}

/**
 * The downloads-page row for a record: the record plus the main-derived retry verdict. The page shows
 * Retry only for a retryable row in a retry state and the note otherwise; main re-decides on the click.
 * @param {any} record
 * @param {{ isJarPartition: (partition: string) => boolean, isBurnerLive: (partition: string) => boolean }} env
 */
function projectRow(record, env) {
  const plan = planRetry(record, env);
  return {
    ...record,
    retryable: plan.ok,
    retryReason: plan.ok ? null : plan.reason,
    retryNote: plan.ok ? null : retryReasonText(plan.reason)
  };
}

module.exports = { RETRY_REASONS, retryReasonText, planRetry, projectRow };
