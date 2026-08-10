'use client';

/**
 * "Offline · 3 sign-ins are saved on this device and will send when the centre is back
 * online." Screen 4's strip, in pending-blue.
 *
 * Blue and never amber. A queued write in a concrete-walled centre is normal, and amber here
 * would train educators to ignore amber — the next amber thing they ignore is a ratio breach.
 *
 * Above the list and never over it: a strip that floats covers a child, and the one it covers
 * is the one nobody signs in.
 *
 * The pack gives this a 2s opacity pulse. Not reproduced, for the same reason as on mobile: a
 * pulse is how a screen says "attend to me now", which contradicts the reason the strip is
 * blue. The retry button is the thing worth having instead — automatic retry on reconnect
 * covers the normal case, and this covers the case where somebody is standing there wanting to
 * know it has gone.
 */
export function OfflineStrip({
  online,
  pendingCount,
  syncing,
  onRetry,
}: {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  onRetry: () => void;
}) {
  // Online with an empty queue: nothing true to say. An "all synced" banner is a permanent
  // line of furniture reporting the absence of news.
  if (online && pendingCount === 0) return null;

  /*
    The verb agrees, not just the noun.

    This read "1 sign-in are saved on this device" and "1 sign-in on their way", because only
    the noun was pluralised. The singular is not the rare case here — it is the first queued
    tap, which is the exact moment somebody is deciding whether this strip is telling them the
    truth about a child in the building.
  */
  const one = pendingCount === 1;
  const items = `${pendingCount} sign-in${one ? '' : 's'}`;

  const sentence = !online
    ? pendingCount === 0
      ? 'Offline. Sign-ins will be saved on this device until the connection is back.'
      : `Offline · ${items} ${one ? 'is' : 'are'} saved on this device and will send when the centre is back online.`
    : syncing
      ? `Sending · ${items} on ${one ? 'its' : 'their'} way.`
      : `${items} ${one ? 'is' : 'are'} saved on this device and ${one ? 'has' : 'have'} not reached the centre yet.`;

  return (
    <div className="offline-strip" role="status" aria-live="polite">
      <p className="offline-strip-text">
        <span aria-hidden="true">↻ </span>
        {sentence}
      </p>
      {/* Only worth offering when there is something to send and a connection to send it on. */}
      {online && pendingCount > 0 && (
        <button type="button" className="secondary offline-retry" onClick={onRetry} disabled={syncing}>
          {syncing ? 'Sending…' : 'Try sending now'}
        </button>
      )}
    </div>
  );
}
