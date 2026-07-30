import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequireAuth,
  createRateLimiter,
  validateSendRequest,
  PHONE_REGEX,
  MAX_CHUNKS,
  MAX_MESSAGE_LENGTH,
  MAX_DELAY_SECONDS,
} from '../lib/middleware.js';

const FAKE_PHONE = '+15555550100';

function mockReq({ headers = {}, body = {}, ip = '127.0.0.1' } = {}) {
  return { headers, body, ip, connection: { remoteAddress: ip } };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  return res;
}

function run(middleware, req) {
  const res = mockRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

// ============================================================================
// requireAuth
// ============================================================================

test('requireAuth accepts a valid bearer token', () => {
  const requireAuth = createRequireAuth('secret-key');
  const { nextCalled } = run(requireAuth, mockReq({ headers: { authorization: 'Bearer secret-key' } }));
  assert.equal(nextCalled, true);
});

test('requireAuth rejects a missing Authorization header', () => {
  const requireAuth = createRequireAuth('secret-key');
  const { res, nextCalled } = run(requireAuth, mockReq());
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth rejects a non-Bearer scheme', () => {
  const requireAuth = createRequireAuth('secret-key');
  const { res, nextCalled } = run(requireAuth, mockReq({ headers: { authorization: 'Basic secret-key' } }));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth rejects a wrong token', () => {
  const requireAuth = createRequireAuth('secret-key');
  const { res, nextCalled } = run(requireAuth, mockReq({ headers: { authorization: 'Bearer wrong' } }));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth rejects an empty token', () => {
  const requireAuth = createRequireAuth('secret-key');
  const { res, nextCalled } = run(requireAuth, mockReq({ headers: { authorization: 'Bearer' } }));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth passes everything through when no API key is configured', () => {
  const requireAuth = createRequireAuth(undefined);
  const { nextCalled } = run(requireAuth, mockReq());
  assert.equal(nextCalled, true);
});

// ============================================================================
// rateLimiter
// ============================================================================

test('rateLimiter allows requests up to the limit and sets headers', () => {
  const rateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
  for (let i = 1; i <= 3; i++) {
    const { res, nextCalled } = run(rateLimiter, mockReq({ ip: '10.0.0.1' }));
    assert.equal(nextCalled, true, `request ${i} should pass`);
    assert.equal(res.headers['X-RateLimit-Limit'], 3);
    assert.equal(res.headers['X-RateLimit-Remaining'], 3 - i);
  }
});

test('rateLimiter rejects requests over the limit with 429 and retry info', () => {
  const rateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
  run(rateLimiter, mockReq({ ip: '10.0.0.2' }));
  run(rateLimiter, mockReq({ ip: '10.0.0.2' }));
  const { res, nextCalled } = run(rateLimiter, mockReq({ ip: '10.0.0.2' }));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.ok(res.body.retry_after_seconds > 0);
  assert.ok(res.body.retry_after_seconds <= 60);
});

test('rateLimiter tracks each client IP separately', () => {
  const rateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
  const first = run(rateLimiter, mockReq({ ip: '10.0.0.3' }));
  const other = run(rateLimiter, mockReq({ ip: '10.0.0.4' }));
  assert.equal(first.nextCalled, true);
  assert.equal(other.nextCalled, true);
});

test('rateLimiter resets after the window expires', async () => {
  const rateLimiter = createRateLimiter({ windowMs: 50, maxRequests: 1 });
  run(rateLimiter, mockReq({ ip: '10.0.0.5' }));
  const blocked = run(rateLimiter, mockReq({ ip: '10.0.0.5' }));
  assert.equal(blocked.res.statusCode, 429);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const allowed = run(rateLimiter, mockReq({ ip: '10.0.0.5' }));
  assert.equal(allowed.nextCalled, true);
});

// ============================================================================
// PHONE_REGEX (E.164)
// ============================================================================

test('PHONE_REGEX accepts valid E.164 numbers', () => {
  assert.ok(PHONE_REGEX.test(FAKE_PHONE));
  assert.ok(PHONE_REGEX.test('+442071838750'));
  assert.ok(PHONE_REGEX.test('+81312345678'));
});

test('PHONE_REGEX rejects invalid numbers', () => {
  assert.ok(!PHONE_REGEX.test('15555550100'), 'missing +');
  assert.ok(!PHONE_REGEX.test('+05555550100'), 'leading zero country code');
  assert.ok(!PHONE_REGEX.test('+1 555 555 0100'), 'spaces');
  assert.ok(!PHONE_REGEX.test('+1'), 'too short');
  assert.ok(!PHONE_REGEX.test('+1234567890123456'), 'more than 15 digits');
  assert.ok(!PHONE_REGEX.test('+1555555010a'), 'letters');
  assert.ok(!PHONE_REGEX.test(''), 'empty');
});

// ============================================================================
// validateSendRequest
// ============================================================================

function validate(body) {
  return run(validateSendRequest, mockReq({ body }));
}

test('validateSendRequest accepts a valid message request', () => {
  const { nextCalled } = validate({
    reply_type: 'message',
    phone_number: FAKE_PHONE,
    messages: [{ text: 'hello' }, { text: 'world', delay_after_previous: 1.5 }],
  });
  assert.equal(nextCalled, true);
});

test('validateSendRequest accepts no_reply without messages', () => {
  const { nextCalled } = validate({ reply_type: 'no_reply', phone_number: FAKE_PHONE });
  assert.equal(nextCalled, true);
});

test('validateSendRequest rejects missing or unknown reply_type', () => {
  assert.equal(validate({ phone_number: FAKE_PHONE }).res.statusCode, 400);
  assert.equal(validate({ reply_type: 'shout', phone_number: FAKE_PHONE }).res.statusCode, 400);
});

test('validateSendRequest rejects missing or malformed phone_number', () => {
  assert.equal(validate({ reply_type: 'message', messages: [{ text: 'hi' }] }).res.statusCode, 400);
  assert.equal(
    validate({ reply_type: 'message', phone_number: '555-0100', messages: [{ text: 'hi' }] }).res.statusCode,
    400
  );
});

test('validateSendRequest rejects missing, empty, or oversized messages arrays', () => {
  assert.equal(validate({ reply_type: 'message', phone_number: FAKE_PHONE }).res.statusCode, 400);
  assert.equal(validate({ reply_type: 'message', phone_number: FAKE_PHONE, messages: [] }).res.statusCode, 400);
  const tooMany = Array.from({ length: MAX_CHUNKS + 1 }, () => ({ text: 'hi' }));
  assert.equal(
    validate({ reply_type: 'message', phone_number: FAKE_PHONE, messages: tooMany }).res.statusCode,
    400
  );
});

test('validateSendRequest rejects chunks without text or with oversized text', () => {
  assert.equal(
    validate({ reply_type: 'message', phone_number: FAKE_PHONE, messages: [{}] }).res.statusCode,
    400
  );
  assert.equal(
    validate({ reply_type: 'message', phone_number: FAKE_PHONE, messages: ['hi'] }).res.statusCode,
    400
  );
  const oversized = { text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) };
  assert.equal(
    validate({ reply_type: 'message', phone_number: FAKE_PHONE, messages: [oversized] }).res.statusCode,
    400
  );
});

test('validateSendRequest rejects out-of-range delay_after_previous', () => {
  const cases = [-1, MAX_DELAY_SECONDS + 1, 'abc', Infinity];
  for (const delay of cases) {
    const { res, nextCalled } = validate({
      reply_type: 'message',
      phone_number: FAKE_PHONE,
      messages: [{ text: 'hi', delay_after_previous: delay }],
    });
    assert.equal(nextCalled, false, `delay ${delay} should be rejected`);
    assert.equal(res.statusCode, 400);
  }
});

test('validateSendRequest accepts boundary delay values', () => {
  for (const delay of [0, MAX_DELAY_SECONDS]) {
    const { nextCalled } = validate({
      reply_type: 'message',
      phone_number: FAKE_PHONE,
      messages: [{ text: 'hi', delay_after_previous: delay }],
    });
    assert.equal(nextCalled, true, `delay ${delay} should be accepted`);
  }
});
