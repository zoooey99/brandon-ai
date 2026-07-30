// lib/relay.js
// Pure helpers for chat.db timestamps, chunk send timing, and backend URLs.

/**
 * Convert an Apple Cocoa timestamp (seconds or nanoseconds since 2001-01-01)
 * to a Unix timestamp in seconds.
 */
export function appleToUnix(appleDate) {
  const n = Number(appleDate);
  const seconds = n > 1e12 ? n / 1e9 : n;
  return Math.round(seconds + 978307200);
}

/**
 * Delay (in seconds) to wait before sending a chunk.
 * The first chunk is sent immediately; later chunks use the chunk's
 * delay_after_previous when provided, otherwise the default delay.
 */
export function getChunkDelaySeconds(chunk, index, defaultDelaySeconds) {
  if (index === 0) return 0;
  return chunk.delay_after_previous != null
    ? parseFloat(chunk.delay_after_previous)
    : defaultDelaySeconds;
}

/**
 * Resolve the backend webhook URL, appending /mac/webhook unless
 * the configured URL already ends with it.
 */
export function buildWebhookUrl(remoteServerUrl) {
  return remoteServerUrl.endsWith('/mac/webhook')
    ? remoteServerUrl
    : `${remoteServerUrl.replace(/\/$/, '')}/mac/webhook`;
}
