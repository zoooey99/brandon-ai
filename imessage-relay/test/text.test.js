import test from 'node:test';
import assert from 'node:assert/strict';
import {
  showVisible,
  truncateForLog,
  sanitizeExact,
  stripNoiseTokens,
  dropBinaryNoiseKeepHumanText,
  decodeAttributedBody,
} from '../lib/text.js';

const NUL = String.fromCharCode(0);
const BOM = String.fromCharCode(0xfeff);
const CTRL = String.fromCharCode(1);
const REPLACEMENT = String.fromCharCode(0xfffd);
const PRIVATE_USE = String.fromCharCode(0xe000);

test('showVisible makes whitespace visible', () => {
  assert.equal(showVisible('a b'), 'a·b');
  assert.equal(showVisible('a\tb'), 'a→b');
  assert.equal(showVisible('a\nb'), 'a\\nb');
  assert.equal(showVisible('a\rb'), 'a\\rb');
});

test('truncateForLog truncates long text with a length note', () => {
  const long = 'x'.repeat(60);
  assert.equal(truncateForLog(long), `${'x'.repeat(50)}... [60 chars total]`);
});

test('truncateForLog leaves short text alone', () => {
  assert.equal(truncateForLog('hello'), 'hello');
});

test('truncateForLog returns empty string for falsy input', () => {
  assert.equal(truncateForLog(''), '');
  assert.equal(truncateForLog(null), '');
});

test('truncateForLog passes text through unchanged in verbose mode', () => {
  const long = 'x'.repeat(60);
  assert.equal(truncateForLog(long, 50, true), long);
});

test('sanitizeExact strips NUL bytes and a leading BOM', () => {
  assert.equal(sanitizeExact(`${BOM}hi${NUL}there${NUL}`), 'hithere');
  assert.equal(sanitizeExact(null), '');
  assert.equal(sanitizeExact(undefined), '');
});

test('sanitizeExact only strips BOM at the start', () => {
  assert.equal(sanitizeExact(`a${BOM}b`), `a${BOM}b`);
});

test('stripNoiseTokens removes Foundation class-name noise', () => {
  const input = 'streamtypedNSAttributedStringHello NSStringworldNSDictionary';
  assert.equal(stripNoiseTokens(input), 'Hello world');
});

test('dropBinaryNoiseKeepHumanText removes control and private-use characters', () => {
  const input = `a${CTRL}b${REPLACEMENT}c${PRIVATE_USE}d`;
  assert.equal(dropBinaryNoiseKeepHumanText(input), 'abcd');
  assert.equal(dropBinaryNoiseKeepHumanText('keep\nnewlines\tand tabs'), 'keep\nnewlines\tand tabs');
});

test('decodeAttributedBody extracts NS.string from a binary plist', () => {
  const bplistBase64 =
    'YnBsaXN0MDDRAQJZTlMuc3RyaW5nXxARSGVsbG8gZnJvbSBicGxpc3QICxUAAAAAAAABAQAAAAAAAAADAAAAAAAAAAAAAAAAAAAAKQ==';
  const buf = Buffer.from(bplistBase64, 'base64');
  assert.equal(decodeAttributedBody(buf), 'Hello from bplist');
});

test('decodeAttributedBody falls back to noise-stripping for non-plist buffers', () => {
  const raw = Buffer.from(`streamtypedNSAttributedString${CTRL}Hey, are we still on?${CTRL}NSDictionary`, 'utf8');
  assert.equal(decodeAttributedBody(raw), 'Hey, are we still on?');
});

test('decodeAttributedBody returns empty string for empty or all-noise input', () => {
  assert.equal(decodeAttributedBody(null), '');
  assert.equal(decodeAttributedBody(undefined), '');
  assert.equal(decodeAttributedBody(Buffer.from(`${CTRL}${CTRL}  `, 'utf8')), '');
});
