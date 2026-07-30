// lib/middleware.js
// Express middleware: bearer-token auth, per-IP rate limiting, and
// request validation for POST /api/send.

// ============================================================================
// AUTHENTICATION
// ============================================================================
export function createRequireAuth(apiKey) {
  return function requireAuth(req, res, next) {
    if (!apiKey) {
      console.warn('[SECURITY WARNING] MAC_SERVER_APIKEY not set - endpoints are unprotected!');
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - Authorization header required' });
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Unauthorized - Bearer token required' });
    }

    if (token !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized - invalid API key' });
    }

    next();
  };
}

// ============================================================================
// RATE LIMITING
// ============================================================================
export function createRateLimiter({ windowMs = 60000, maxRequests = 10 } = {}) {
  const rateLimitMap = new Map();

  return function rateLimiter(req, res, next) {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    if (rateLimitMap.size > 1000) {
      for (const [ip, data] of rateLimitMap.entries()) {
        if (data.resetAt < now) rateLimitMap.delete(ip);
      }
    }

    let entry = rateLimitMap.get(clientIp);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      rateLimitMap.set(clientIp, entry);
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return res.status(429).json({ error: 'Too many requests', retry_after_seconds: retryAfter });
    }

    entry.count++;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - entry.count);
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));
    next();
  };
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================
export const PHONE_REGEX = /^\+[1-9]\d{1,14}$/;
export const MAX_CHUNKS = 20;
export const MAX_MESSAGE_LENGTH = 10000;
export const MAX_DELAY_SECONDS = 3600;

export function validateSendRequest(req, res, next) {
  const { reply_type, phone_number, messages } = req.body;

  if (!reply_type || typeof reply_type !== 'string') {
    return res.status(400).json({ error: 'reply_type is required and must be a string' });
  }

  if (reply_type !== 'message' && reply_type !== 'no_reply') {
    return res.status(400).json({ error: 'reply_type must be "message" or "no_reply"' });
  }

  if (!phone_number || typeof phone_number !== 'string') {
    return res.status(400).json({ error: 'phone_number is required and must be a string' });
  }

  if (!PHONE_REGEX.test(phone_number)) {
    return res.status(400).json({ error: 'phone_number must be in E.164 format (e.g., +15555550100)' });
  }

  if (reply_type === 'no_reply') return next();

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array when reply_type is "message"' });
  }

  if (messages.length === 0) {
    return res.status(400).json({ error: 'messages array cannot be empty' });
  }

  if (messages.length > MAX_CHUNKS) {
    return res.status(400).json({ error: `messages array cannot exceed ${MAX_CHUNKS} chunks` });
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (typeof msg !== 'object' || msg === null) {
      return res.status(400).json({ error: `messages[${i}] must be an object` });
    }
    if (!msg.text || typeof msg.text !== 'string' || msg.text.length === 0) {
      return res.status(400).json({ error: `messages[${i}].text is required and must be a non-empty string` });
    }
    if (msg.text.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `messages[${i}].text exceeds maximum length of ${MAX_MESSAGE_LENGTH}` });
    }
    if (msg.delay_after_previous != null) {
      const delay = Number(msg.delay_after_previous);
      if (isNaN(delay) || !isFinite(delay) || delay < 0 || delay > MAX_DELAY_SECONDS) {
        return res.status(400).json({ error: `messages[${i}].delay_after_previous must be between 0 and ${MAX_DELAY_SECONDS}` });
      }
    }
  }

  next();
}
