# Security Guide

## Overview

This document outlines the security features, best practices, and considerations for deploying the iMessage Multi-Chunk Relay Server.

---

## Table of Contents

1. [Security Features](#security-features)
2. [Configuration Best Practices](#configuration-best-practices)
3. [Authentication](#authentication)
4. [Rate Limiting](#rate-limiting)
5. [Input Validation](#input-validation)
6. [Data Privacy](#data-privacy)
7. [Network Security](#network-security)
8. [Monitoring and Logging](#monitoring-and-logging)
9. [Incident Response](#incident-response)

---

## Security Features

### 1. **API Authentication** 🔐

All sensitive endpoints require Bearer token authentication.

**Protected Endpoints:**
- `POST /api/send` - Requires `MAC_SERVER_APIKEY`
- `GET /status` - Requires `MAC_SERVER_APIKEY`

**Public Endpoints:**
- `GET /health` - No authentication required (basic health check only)

**Implementation:**
```javascript
Authorization: Bearer <MAC_SERVER_APIKEY>
```

⚠️ **WARNING:** If `MAC_SERVER_APIKEY` is not set, all endpoints become publicly accessible!

### 2. **Rate Limiting** 🚦

Prevents abuse and DoS attacks.

**Limits:**
- 10 requests per minute per IP address
- Returns `429 Too Many Requests` when exceeded
- Includes rate limit headers:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Requests remaining in window
  - `X-RateLimit-Reset`: Unix timestamp when limit resets

### 3. **Input Validation** ✅

Comprehensive validation on all `/api/send` requests:

| Field | Validation |
|-------|-----------|
| `reply_type` | Must be `"message"` or `"no_reply"` |
| `phone_number` | Must be E.164 format (e.g., `+15555550100`) |
| `messages` | Max 20 chunks, each max 10KB |
| `delay_before_typing` | 0-3600 seconds |
| `typing_duration` | 0-3600 seconds |
| `messages[].delay_after_previous` | 0-3600 seconds |

**Rejects:**
- Invalid phone number formats (prevents injection)
- Messages exceeding size limits (prevents DoS)
- Invalid numeric values (prevents crashes)
- Malformed JSON (automatic via Express)

### 4. **Request Size Limiting** 📦

Maximum request body size: **1MB**

Prevents memory exhaustion attacks.

### 5. **Database Security** 🗄️

- **Read-only access** to `chat.db` (macOS Messages database)
- **SQL injection protection** via prepared statements
- **Automatic cleanup** of old data:
  - Jobs/chunks older than 7 days
  - Processed messages older than 30 days
  - Daily VACUUM to reclaim disk space

### 6. **Graceful Shutdown** 🛑

Properly closes database connections on:
- `SIGTERM` (e.g., from systemd, Docker)
- `SIGINT` (e.g., Ctrl+C)

Prevents database corruption.

---

## Configuration Best Practices

### 1. **Generate Strong API Keys**

```bash
# Generate a secure random API key
openssl rand -base64 32

# Example output:
# YOUR_GENERATED_API_KEY_HERE
```

### 2. **Environment Variables**

**Required:**
```bash
REMOTE_SERVER_URL=https://your-render-server.com
MAC_SERVER_APIKEY=<generated-key>
```

**Recommended:**
```bash
REMOTE_SERVER_APIKEY=<render-server-key>
ENABLE_VERBOSE_LOGGING=false
```

### 3. **File Permissions**

```bash
# Protect .env file
chmod 600 .env

# Verify it's gitignored
grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore
```

---

## Authentication

### How It Works

1. Backend server sends API requests with `Authorization` header
2. Mac server validates token against `MAC_SERVER_APIKEY`
3. Invalid/missing tokens receive `401 Unauthorized`

### Example Request (Backend → Mac Server)

```bash
curl -X POST http://localhost:8787/api/send \
  -H "Authorization: Bearer YOUR_GENERATED_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "reply_type": "message",
    "phone_number": "+15555550100",
    "messages": [{"text": "Hello"}]
  }'
```

### Example Request (Mac Server → Backend)

```bash
# Mac server automatically includes this when forwarding messages:
POST https://your-render-server.com/mac/webhook
Authorization: Bearer <REMOTE_SERVER_APIKEY>
Content-Type: application/json
```

### Authentication Errors

**Missing Token:**
```json
{
  "error": "Unauthorized - Authorization header required"
}
```

**Invalid Format:**
```json
{
  "error": "Unauthorized - Bearer token required"
}
```

**Wrong Token:**
```json
{
  "error": "Unauthorized - invalid API key"
}
```

---

## Rate Limiting

### Behavior

- **Window:** 60 seconds (sliding)
- **Limit:** 10 requests per IP
- **Response:** HTTP 429 with retry-after

### Example Response

```json
{
  "error": "Too many requests",
  "retry_after_seconds": 42
}
```

### Headers

```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 1701708280
```

### Bypass (Not Recommended)

To disable rate limiting for trusted backend:
1. Use a reverse proxy (nginx, Caddy) to strip client IPs
2. Or modify `rateLimiter` function to whitelist specific IPs

---

## Input Validation

### Phone Number Validation

**Format:** E.164 international format

**Valid Examples:**
- `+15555550100` (US)
- `+442071234567` (UK)
- `+81312345678` (Japan)

**Invalid Examples:**
- `5555550100` (missing +)
- `+1 (555) 555-0100` (formatting)
- `+0123456789` (starts with 0)

**Regex:** `/^\+[1-9]\d{1,14}$/`

### Message Validation

**Limits:**
- **Max chunks per request:** 20
- **Max message length:** 10,000 characters (10KB)
- **Max delay:** 3,600 seconds (1 hour)

**Prevents:**
- Memory exhaustion (huge messages)
- Disk exhaustion (millions of chunks)
- Time manipulation (negative/infinite delays)

### Validation Errors

```json
{
  "error": "phone_number must be in E.164 format (e.g., +15555550100)"
}
```

```json
{
  "error": "messages array cannot exceed 20 chunks (received 50)"
}
```

```json
{
  "error": "messages[3].text exceeds maximum length of 10000 characters"
}
```

---

## Data Privacy

### Sensitive Data Handling

#### 1. **Message Content**

**Logged (by default):**
- Truncated to 50 characters
- Example: `"Hey, are you there? I need help with..."` → `"Hey, are you there? I need help with... [158 chars total]"`

**Full logging (optional):**
```bash
ENABLE_VERBOSE_LOGGING=true
```
⚠️ **WARNING:** Only enable for debugging! Logs full message content.

#### 2. **Database Storage**

**What's Stored:**
- `local.db` contains full message text in plaintext
- `processed_messages` table tracks message IDs

**Security Measures:**
- Automatic cleanup (7-30 day retention)
- File permissions (set by SQLite)
- No encryption at rest (consider adding if needed)

**Encryption (Advanced):**

To encrypt `local.db`, use `better-sqlite3-cipher`:

```bash
npm install better-sqlite3-cipher
```

Update `server.js`:
```javascript
const Database = require('better-sqlite3-cipher');
const localDb = new Database(LOCAL_DB_PATH, {
  key: process.env.DB_ENCRYPTION_KEY
});
```

#### 3. **API Keys in Logs**

- ✅ API keys are **NEVER** logged
- ✅ Authorization headers are **NOT** logged
- ✅ Only authentication failures are logged (without token values)

---

## Network Security

### 1. **Localhost-Only Deployment (Recommended)**

**Default:** Server binds to `0.0.0.0:8787` (all interfaces)

**Secure:**
```javascript
// Modify server.js startup:
app.listen(PORT, '127.0.0.1', () => { ... });
```

Then use a reverse proxy (nginx) for external access.

### 2. **Firewall Rules**

**macOS:**
```bash
# Allow only from backend server IP
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/node
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --blockapp /usr/local/bin/node
```

**Linux (iptables):**
```bash
# Allow only from 192.168.1.100 (backend server)
iptables -A INPUT -p tcp --dport 8787 -s 192.168.1.100 -j ACCEPT
iptables -A INPUT -p tcp --dport 8787 -j DROP
```

### 3. **TLS/HTTPS (for Exposed Servers)**

Use nginx as reverse proxy:

```nginx
server {
    listen 443 ssl;
    server_name mac-server.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 4. **Ngrok / Tunnel Security**

If using ngrok for backend → Mac communication:

```bash
# Use auth token and custom subdomain
ngrok http 8787 --subdomain=my-mac-server --auth="user:password"
```

⚠️ **WARNING:** Ngrok exposes your server publicly! Always use:
- `MAC_SERVER_APIKEY` for authentication
- Ngrok's built-in auth (`--auth`)
- Custom subdomain (harder to guess)

---

## Monitoring and Logging

### Log Prefixes

| Prefix | Meaning |
|--------|---------|
| `[AUTH]` | Authentication events |
| `[RATE LIMIT]` | Rate limit violations |
| `[POLL]` | Chat.db polling |
| `[BACKEND]` | Communication with the backend server |
| `[TYPING]` / `[TYPING QUEUE]` | Typing indicator execution and queueing |
| `[SEND]` / `[API SEND]` | Message sending |
| `[SEND]` | Message sending |
| `[CLEANUP]` | Database cleanup |
| `[SHUTDOWN]` | Graceful shutdown |
| `[ERROR]` | General errors |

### Security Monitoring

**Watch for:**
```bash
# Authentication failures
grep "\[AUTH\] Request rejected" server.log

# Rate limit violations
grep "\[RATE LIMIT\]" server.log

# Validation errors (potential attacks)
grep "error.*exceeded" server.log

# Failed sends (potential issues)
grep "\[SEND ERROR\]" server.log
```

### Log Rotation

**macOS (launchd):**

Create `/Library/LaunchDaemons/com.yourapp.logrotate.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.yourapp.logrotate</string>
    <key>Program</key>
    <string>/usr/bin/gzip</string>
    <key>ProgramArguments</key>
    <array>
        <string>/var/log/imessage-relay.log</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
```

---

## Incident Response

### 1. **Compromised API Key**

**Immediate Actions:**
1. Generate new API key:
   ```bash
   openssl rand -base64 32
   ```

2. Update `.env`:
   ```bash
   MAC_SERVER_APIKEY=<new-key>
   ```

3. Restart server:
   ```bash
   pm2 restart imessage-relay
   ```

4. Update backend server with new key

5. Review logs for unauthorized access:
   ```bash
   grep "\[AUTH\]" server.log | tail -100
   ```

### 2. **Suspicious Activity**

**Check:**
```bash
# Failed auth attempts
grep "invalid" server.log | grep AUTH

# Rate limit violations
grep "exceeded rate limit" server.log

# Unusual phone numbers
grep "SEND" server.log | awk '{print $5}' | sort | uniq -c | sort -rn
```

### 3. **Database Compromise**

**If `local.db` is compromised:**

1. Stop server immediately:
   ```bash
   pm2 stop imessage-relay
   ```

2. Delete database:
   ```bash
   rm local.db
   ```

3. Restart server (will recreate clean database):
   ```bash
   pm2 start imessage-relay
   ```

4. Review access logs to identify intrusion vector

---

## Security Checklist

Before production deployment:

- [ ] `MAC_SERVER_APIKEY` is set to strong random value
- [ ] `REMOTE_SERVER_APIKEY` is configured (if backend requires auth)
- [ ] `.env` file has `chmod 600` permissions
- [ ] `.env` is in `.gitignore`
- [ ] `ENABLE_VERBOSE_LOGGING` is set to `false`
- [ ] Server is behind firewall or only accessible to backend
- [ ] TLS/HTTPS enabled if exposed to internet
- [ ] Log monitoring/alerting configured
- [ ] Regular backups of `local.db` (if needed)
- [ ] Incident response plan documented
- [ ] Team knows how to rotate API keys

---

## Contact

For security issues or questions:

1. Review server logs first
2. Check this documentation
3. Contact your security team

**DO NOT** disclose security vulnerabilities publicly.

---

**Last Updated:** 2025-12-22
