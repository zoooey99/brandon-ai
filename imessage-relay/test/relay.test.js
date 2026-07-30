import test from 'node:test';
import assert from 'node:assert/strict';
import { appleToUnix, getChunkDelaySeconds, buildWebhookUrl } from '../lib/relay.js';

// Apple epoch (2001-01-01T00:00:00Z) is 978307200 seconds after the Unix epoch.
const APPLE_EPOCH_OFFSET = 978307200;

test('appleToUnix converts second-precision Apple timestamps', () => {
  assert.equal(appleToUnix(0), APPLE_EPOCH_OFFSET);
  // 2021-01-01T00:00:00Z is 631152000s after the Apple epoch
  assert.equal(appleToUnix(631152000), 1609459200);
});

test('appleToUnix converts nanosecond-precision Apple timestamps', () => {
  // Values above 1e12 are treated as nanoseconds
  assert.equal(appleToUnix(631152000 * 1e9), 1609459200);
});

test('appleToUnix rounds to whole seconds', () => {
  assert.equal(appleToUnix(1.4), APPLE_EPOCH_OFFSET + 1);
  assert.equal(appleToUnix(1.6), APPLE_EPOCH_OFFSET + 2);
});

test('first chunk is sent immediately', () => {
  assert.equal(getChunkDelaySeconds({ text: 'hi' }, 0, 0.7), 0);
  // Even an explicit delay on the first chunk is ignored
  assert.equal(getChunkDelaySeconds({ text: 'hi', delay_after_previous: 5 }, 0, 0.7), 0);
});

test('later chunks use the default inter-chunk delay', () => {
  assert.equal(getChunkDelaySeconds({ text: 'hi' }, 1, 0.7), 0.7);
  assert.equal(getChunkDelaySeconds({ text: 'hi' }, 5, 1.2), 1.2);
});

test('later chunks honor an explicit delay_after_previous', () => {
  assert.equal(getChunkDelaySeconds({ text: 'hi', delay_after_previous: 2.5 }, 1, 0.7), 2.5);
  assert.equal(getChunkDelaySeconds({ text: 'hi', delay_after_previous: 0 }, 1, 0.7), 0);
  // String values are parsed
  assert.equal(getChunkDelaySeconds({ text: 'hi', delay_after_previous: '1.5' }, 2, 0.7), 1.5);
});

test('buildWebhookUrl appends /mac/webhook', () => {
  assert.equal(buildWebhookUrl('https://backend.example.com'), 'https://backend.example.com/mac/webhook');
});

test('buildWebhookUrl strips a trailing slash before appending', () => {
  assert.equal(buildWebhookUrl('https://backend.example.com/'), 'https://backend.example.com/mac/webhook');
});

test('buildWebhookUrl leaves a full webhook URL unchanged', () => {
  assert.equal(buildWebhookUrl('https://backend.example.com/mac/webhook'), 'https://backend.example.com/mac/webhook');
});
