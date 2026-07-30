# Security & Architecture Improvements

## Summary

This document summarizes all security and architecture improvements implemented for the iMessage Multi-Chunk Relay Server.

---

## 🔒 Critical Security Fixes Implemented

### 1. ✅ Bearer Token Authentication

**Problem:** API endpoints were completely open - anyone could send messages through your Mac.

**Solution:**
- Added `requireAuth` middleware for `/api/send` and `/status` endpoints
- Requires `Authorization: Bearer <MAC_SERVER_APIKEY>` header
- Returns `401 Unauthorized` for invalid/missing tokens
- **Backward compatible:** Shows warning if `MAC_SERVER_APIKEY` not set

**Files Modified:**
- `server.js:164-192` - Authentication middleware
- `server.js:592` - Protected `/status` endpoint
- `server.js:604` - Protected `/api/send` endpoint

**Testing:**
```bash
# Without auth (should fail)
curl -X POST http://localhost:8787/api/send

# With auth (should succeed)
curl -X POST http://localhost:8787/api/send \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reply_type":"no_reply","phone_number":"+15555550100"}'
```

---

### 2. ✅ Comprehensive Input Validation

**Problem:** No validation on `/api/send` - could send malicious data, huge payloads, or invalid formats.

**Solution:**
- Phone number validation (E.164 format: `/^\+[1-9]\d{1,14}$/`)
- Message limits: Max 20 chunks, 10KB per chunk
- Delay validation: 0-3600 seconds only
- Type checking for all fields
- Returns `400 Bad Request` with detailed error messages

**Files Modified:**
- `server.js:245-319` - `validateSendRequest` middleware
- `server.js:604` - Applied to `/api/send` endpoint

**Validation Rules:**

| Field | Validation |
|-------|-----------|
| `reply_type` | Must be `"message"` or `"no_reply"` |
| `phone_number` | E.164 format (e.g., `+15555550100`) |
| `messages` | Array, 1-20 chunks, each max 10KB |
| `delay_before_typing` | 0-3600 seconds, valid number |
| `typing_duration` | 0-3600 seconds, valid number |
| `messages[].delay_after_previous` | 0-3600 seconds, valid number |

---

### 3. ✅ Rate Limiting

**Problem:** No rate limits - could be DoS'd by flooding requests.

**Solution:**
- In-memory rate limiter: 10 requests/minute per IP
- Returns `429 Too Many Requests` when exceeded
- Includes rate limit headers (`X-RateLimit-*`)
- Automatic cleanup of old entries

**Files Modified:**
- `server.js:194-243` - `rateLimiter` middleware
- `server.js:604` - Applied to `/api/send` endpoint

**Headers:**
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1701708280
```

---

### 4. ✅ Request Size Limiting

**Problem:** No payload size limit - could cause out-of-memory crashes.

**Solution:**
- Express JSON body size limited to 1MB
- Prevents memory exhaustion attacks

**Files Modified:**
- `server.js:159` - `app.use(express.json({ limit: '1mb' }))`

---

### 5. ✅ Sensitive Data Protection in Logs

**Problem:** Full message content logged - privacy risk if logs are centralized.

**Solution:**
- Messages truncated to 50 characters in logs (by default)
- Added `ENABLE_VERBOSE_LOGGING` env variable for debugging
- Added `truncateForLog()` utility function
- Updated all sensitive logging locations

**Files Modified:**
- `server.js:31` - Added `ENABLE_VERBOSE_LOGGING` config
- `server.js:105-113` - Added `truncateForLog()` function
- `server.js:419-423` - Truncated Render payload logs
- `server.js:528` - Truncated job chunk logs
- `server.js:157` - Truncated send script logs
- `server.js:1003` - Truncated poll logs

**Example:**
```
Before: [SEND] Sending to +1234: "This is a very long message with sensitive information..."
After:  [SEND] Sending to +1234: "This is a very long message with... [158 chars total]"
```

---

### 6. ✅ Graceful Shutdown

**Problem:** Database connections not closed on exit - could cause corruption.

**Solution:**
- Added `SIGTERM` and `SIGINT` handlers
- Properly closes `chatDb` and `localDb` connections
- Prevents double-shutdown with `isShuttingDown` flag

**Files Modified:**
- `server.js:1088-1116` - Graceful shutdown handlers

**Testing:**
```bash
# Start server
node server.js

# Press Ctrl+C
# Should see: [SHUTDOWN] Received SIGINT, shutting down gracefully...
```

---

### 7. ✅ Database Cleanup

**Problem:** Database grows infinitely - will eventually degrade performance.

**Solution:**
- Automatic cleanup on startup and every 24 hours
- Deletes jobs/chunks older than 7 days
- Deletes processed messages older than 30 days
- Runs `VACUUM` to reclaim disk space

**Files Modified:**
- `server.js:34-36` - Cleanup configuration
- `server.js:1026-1086` - Cleanup functions
- `server.js:1162-1163` - Activated at startup

**Cleanup Schedule:**
- On startup: Immediate cleanup
- Periodic: Every 24 hours

---

### 8. ✅ Public Health Endpoint

**Problem:** `/status` required auth, making it hard to monitor uptime.

**Solution:**
- Added `/health` endpoint (no auth required)
- Returns simple `{"ok": true, "status": "operational"}`
- Use for uptime monitoring, load balancers, etc.

**Files Modified:**
- `server.js:586-589` - Added `/health` endpoint
- `server.js:592` - `/status` now requires auth

---

## 📚 Documentation Improvements

### 1. ✅ `.env.example` File

**Created:** `.env.example`

Complete example configuration with:
- All required and optional variables
- Security notes and best practices
- Comments explaining each option
- Example values

**Usage:**
```bash
cp .env.example .env
# Edit .env with your actual values
```

---

### 2. ✅ Security Documentation

**Created:** `docs/SECURITY.md`

Comprehensive security guide covering:
- Security features overview
- Configuration best practices
- Authentication setup
- Rate limiting details
- Input validation rules
- Data privacy considerations
- Network security recommendations
- Monitoring and logging
- Incident response procedures
- Security checklist

---

### 3. ✅ Backend Integration Guide

**Created:** `docs/BACKEND_INTEGRATION.md`

Complete guide for backend developers:
- Quick start instructions
- Authentication setup (both directions)
- Receiving messages from Mac server
- Sending messages to Mac server
- Error handling patterns
- Rate limit handling
- Testing procedures
- Production checklist
- Code examples (Node.js, Python, TypeScript)
- Common patterns
- Troubleshooting

---

### 4. ✅ Updated Existing Documentation

**Modified:**
- `README.md` - Added security section with quick setup
- `docs/API_PROTOCOL.md` - Added `/health` endpoint, authentication requirements, security considerations

---

## 🎯 Server Startup Changes

### Enhanced Startup Messages

**Before:**
```
Server:          http://localhost:8787
Chat DB:         ~/Library/Messages/chat.db
Local DB:        ./local.db
Remote Server:   https://your-render-server.com
```

**After:**
```
============================================================
iMessage Multi-Chunk Relay Server
============================================================
Server:          http://localhost:8787
Chat DB:         ~/Library/Messages/chat.db
Local DB:        ./local.db
Remote Server:   https://your-render-server.com
Public URL:      NOT CONFIGURED

Security:
  Authentication:    ENABLED  (or DISABLED (WARNING!))
  Rate Limiting:     10 req/60s
  Request Size Limit: 1MB
  Verbose Logging:   DISABLED

Configuration:
  Quiet Window:      7s
  Inter-chunk Delay: 0.7s
  Scheduler Poll:    500ms
  Placeholder:       "..."

Endpoints:
  GET  /health          - Public health check
  GET  /status          - Server status (requires auth)
  POST /api/send        - Render server sends messages here (requires auth)
============================================================

⚠️  [SECURITY WARNING] MAC_SERVER_APIKEY is not set!
⚠️  Your API endpoints are UNPROTECTED and can be accessed by anyone!
⚠️  Set MAC_SERVER_APIKEY in your .env file to enable authentication.

[STARTUP] Starting chat.db poller...
[STARTUP] Starting scheduler loop...
[STARTUP] Starting database cleanup scheduler...
[CLEANUP] Starting database cleanup...
[CLEANUP] Deleted 0 old jobs and 0 chunks (older than 7 days)
[CLEANUP] Deleted 0 processed message records (older than 30 days)
[CLEANUP] Database vacuumed to reclaim disk space
[CLEANUP] Cleanup complete
[CLEANUP] Scheduled to run every 24 hours
[STARTUP] All systems ready!
```

---

## 📊 Summary of Changes

### Code Changes

| File | Lines Added | Lines Modified | Purpose |
|------|-------------|----------------|---------|
| `server.js` | ~350 | ~50 | Security features, cleanup, logging |
| `.env.example` | ~85 | 0 | Configuration template |
| `docs/SECURITY.md` | ~700 | 0 | Security documentation |
| `docs/BACKEND_INTEGRATION.md` | ~850 | 0 | Integration guide |
| `README.md` | ~50 | ~10 | Security section |
| `docs/API_PROTOCOL.md` | ~60 | ~20 | Auth requirements, security |

**Total:** ~2,095 lines added, ~80 lines modified

### Security Improvements

| Feature | Status | Impact |
|---------|--------|--------|
| Authentication | ✅ Implemented | 🔴 Critical |
| Input Validation | ✅ Implemented | 🔴 Critical |
| Rate Limiting | ✅ Implemented | 🟠 High |
| Request Size Limit | ✅ Implemented | 🟠 High |
| Log Privacy | ✅ Implemented | 🟡 Medium |
| Database Cleanup | ✅ Implemented | 🟡 Medium |
| Graceful Shutdown | ✅ Implemented | 🟢 Low |
| Health Endpoint | ✅ Implemented | 🟢 Low |

---

## 🚀 Deployment Guide

### Step 1: Update Code

```bash
# Pull latest changes
git pull origin main

# Install dependencies (if needed)
npm install
```

### Step 2: Configure Security

```bash
# Generate API key
openssl rand -base64 32

# Update .env
echo "MAC_SERVER_APIKEY=<generated-key>" >> .env

# Set permissions
chmod 600 .env
```

### Step 3: Update Backend Server

```javascript
// Add to backend .env
IMESSAGE_MAC_API_KEY=<same-key-as-above>

// Update all requests to include header:
headers: {
  'Authorization': `Bearer ${process.env.IMESSAGE_MAC_API_KEY}`,
  'Content-Type': 'application/json'
}
```

### Step 4: Restart Services

```bash
# Restart Mac server
pm2 restart imessage-relay

# Restart backend server
pm2 restart backend-server
```

### Step 5: Verify

```bash
# Test health endpoint (no auth)
curl http://localhost:8787/health

# Test status endpoint (with auth)
curl http://localhost:8787/status \
  -H "Authorization: Bearer YOUR_KEY"

# Check logs
pm2 logs imessage-relay
```

---

## 🔍 Testing Checklist

### Security Testing

- [ ] `/health` endpoint works without auth
- [ ] `/status` endpoint requires auth
- [ ] `/api/send` endpoint requires auth
- [ ] Invalid auth token returns 401
- [ ] Missing auth token returns 401
- [ ] Rate limiting works (11th request returns 429)
- [ ] Invalid phone number returns 400
- [ ] Message > 10KB returns 400
- [ ] Message array > 20 chunks returns 400
- [ ] Negative delay returns 400

### Functionality Testing

- [ ] Server starts without errors
- [ ] Security warnings shown if `MAC_SERVER_APIKEY` not set
- [ ] Database cleanup runs on startup
- [ ] Messages still send successfully
- [ ] Typing indicator still works
- [ ] Multi-chunk messages still work
- [ ] Graceful shutdown works (Ctrl+C)
- [ ] Logs show truncated messages (not full text)

---

## 📝 Migration Notes

### Backward Compatibility

✅ **Fully backward compatible** if you don't set `MAC_SERVER_APIKEY`

- If `MAC_SERVER_APIKEY` not set, auth middleware allows all requests
- Shows warning on startup
- Existing backend code will continue to work

### Breaking Changes

⚠️ **If you set `MAC_SERVER_APIKEY`, backend MUST update!**

Backend must include `Authorization` header in all requests:

**Before:**
```javascript
await fetch('http://mac-server:8787/api/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

**After:**
```javascript
await fetch('http://mac-server:8787/api/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${MAC_API_KEY}`  // ← ADD THIS
  },
  body: JSON.stringify(payload)
});
```

---

## 🎉 Benefits

### Security Benefits

1. **Unauthorized access prevented** - Only backend can send messages
2. **DoS protection** - Rate limiting prevents flooding
3. **Injection attacks prevented** - Input validation blocks malicious data
4. **Privacy improved** - Sensitive data truncated in logs
5. **Database corruption prevented** - Graceful shutdown
6. **Disk space managed** - Automatic cleanup

### Operational Benefits

1. **Better monitoring** - `/health` endpoint for uptime checks
2. **Better debugging** - Verbose logging mode available
3. **Better stability** - Proper shutdown handling
4. **Better performance** - Database cleanup prevents bloat
5. **Better visibility** - Enhanced startup messages
6. **Better documentation** - Comprehensive guides for backend devs

---

## 🔗 Related Documentation

- [docs/SECURITY.md](./docs/SECURITY.md) - Complete security guide
- [docs/BACKEND_INTEGRATION.md](./docs/BACKEND_INTEGRATION.md) - Backend integration guide
- [docs/API_PROTOCOL.md](./docs/API_PROTOCOL.md) - API reference
- [README.md](./README.md) - Project overview
- [.env.example](./.env.example) - Configuration template

---

## ⚠️ Important Reminders

1. **ALWAYS** set `MAC_SERVER_APIKEY` in production
2. **NEVER** commit `.env` to git
3. Use strong random keys (`openssl rand -base64 32`)
4. Rotate API keys regularly
5. Monitor logs for `[AUTH]` and `[RATE LIMIT]` events
6. Set `ENABLE_VERBOSE_LOGGING=false` in production
7. Only expose server to trusted backend (localhost or VPN)
8. Consider TLS/HTTPS if exposed to internet

---

**Security Audit Completed:** 2025-12-22
**Improvements Implemented:** 8 critical + 4 documentation
**Backward Compatible:** Yes (with warnings)
**Production Ready:** Yes (after configuration)
