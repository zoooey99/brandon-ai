# Mac Server Integration Guide

This document describes how the Brandon Backend integrates with the Mac iMessage relay server for SMS communication.

## Overview

The Mac server acts as a bridge between iMessage and the Brandon backend:
- **Inbound**: Mac receives SMS → Mac POSTs to Backend → Backend generates response → Returns to Mac → Mac sends SMS
- **Outbound**: Backend POSTs to Mac → Mac sends SMS via iMessage

---

## Authentication

All communication between Mac server and Backend requires API key authentication.

### API Keys

Two API keys are required:

1. **MAC_SERVER_APIKEY** - Backend uses this to authenticate TO Mac server
2. **REMOTE_SERVER_APIKEY** - Mac uses this to authenticate TO backend

Generate both with:
```bash
openssl rand -base64 32
```

### Configuration

**Backend (.env):**
```bash
MAC_SERVER_URL=http://localhost:8787
MAC_SERVER_APIKEY=<key1>
REMOTE_SERVER_APIKEY=<key2>
```

**Mac Server (.env):**
```bash
MAC_SERVER_APIKEY=<key1>
REMOTE_SERVER_APIKEY=<key2>
REMOTE_SERVER_URL=http://backend-url:8000/mac/webhook
```

---

## Inbound Messages (Mac → Backend)

### Endpoint: `POST /mac/webhook`

When a user sends an SMS, the Mac server POSTs to this backend endpoint.

**Authentication:**
```http
Authorization: Bearer <REMOTE_SERVER_APIKEY>
```

**Request Payload:**
```json
{
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Hey coach, I finished my workout!",
      "timestamp": "2025-12-22T14:30:45Z"
    },
    {
      "text": "Feeling great!",
      "timestamp": "2025-12-22T14:30:48Z"
    }
  ]
}
```

**Fields:**
- `phone_number` (string): Sender's phone in E.164 format (+1XXXXXXXXXX)
- `messages` (array): Array of message objects
  - `text` (string): Message content
  - `timestamp` (string): ISO 8601 timestamp

**Response Format (Send Message):**
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Awesome work!",
      "delay_after_previous": 0.0
    },
    {
      "text": "How was the intensity?",
      "delay_after_previous": 1.5
    }
  ],
  "delay_before_typing": 2.0,
  "typing_duration": 3.0
}
```

**Response Format (No Reply):**
```json
{
  "reply_type": "no_reply",
  "phone_number": "+15555550100"
}
```

**Response Fields:**
- `reply_type`: "message" or "no_reply"
- `phone_number`: Recipient phone number
- `messages`: Array of message chunks (if reply_type is "message")
  - `text`: Message content (required)
  - `delay_after_previous`: Seconds to wait after previous chunk (default: 0.7)
- `delay_before_typing`: Seconds to wait before showing typing indicator (default: 2.0)
- `typing_duration`: Seconds to show typing indicator (default: 3.0)

---

## Outbound Messages (Backend → Mac)

### Endpoint: `POST <MAC_SERVER_URL>/api/send`

Backend sends this request to Mac server to trigger SMS sending.

**Authentication:**
```http
Authorization: Bearer <MAC_SERVER_APIKEY>
```

**Request Payload:**
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Morning! Ready for leg day?",
      "delay_after_previous": 0.0
    }
  ],
  "delay_before_typing": 1.0,
  "typing_duration": 2.0
}
```

**Success Response:**
```json
{
  "ok": true,
  "job_id": 42,
  "message": "Job created successfully"
}
```

**Error Responses:**

**401 Unauthorized:**
```json
{
  "error": "Unauthorized - invalid API key"
}
```

**400 Bad Request:**
```json
{
  "error": "phone_number must be in E.164 format (e.g., +15555550100)"
}
```

**429 Too Many Requests:**
```json
{
  "error": "Too many requests",
  "retry_after_seconds": 42
}
```

Headers:
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1701708280
Retry-After: 42
```

---

## Rate Limiting

**Mac Server Limits:**
- **10 requests per minute** per IP address
- Applies to `/api/send` endpoint
- Backend implements request queuing to respect this limit

**Backend Implementation:**
- Tracks request times in sliding window
- Automatically waits if limit would be exceeded
- Handles 429 responses with exponential backoff

---

## Phone Number Format

**All phone numbers MUST be in E.164 format:**
- Format: `+[country code][area code][number]`
- Example: `+15555550100`
- No spaces, dashes, or parentheses
- Always starts with `+`

**Validation:**
- Backend validates on webhook receive
- Supabase stores phone numbers in E.164 format
- Frontend must save phone numbers in E.164 format

---

## Error Handling

### Backend → Mac Server Errors

**Network Errors:**
- Backend retries up to 3 times with exponential backoff
- Logs all failures for debugging

**Rate Limit (429):**
- Backend respects `Retry-After` header
- Waits specified seconds before retry
- Request stays in queue

**Authentication (401):**
- No retries (configuration issue)
- Logged as critical error
- Check `MAC_SERVER_APIKEY` matches

**Validation (400):**
- No retries (request invalid)
- Logged with details
- Fix request format

### Mac Server → Backend Errors

**Validation Failures:**
- User not registered
- Subscription inactive
- Backend returns friendly error message to user

**Processing Errors:**
- AI generation fails
- Database errors
- Backend returns fallback message to user

---

## Testing

### Health Check

```bash
# Test Mac server is running
curl http://localhost:8787/health
```

### Test Backend Webhook

```bash
curl -X POST http://localhost:8000/mac/webhook/test \
  -H "Authorization: Bearer <REMOTE_SERVER_APIKEY>"
```

### Send Test Message

```bash
curl -X POST http://localhost:8787/api/send \
  -H "Authorization: Bearer <MAC_SERVER_APIKEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "reply_type": "message",
    "phone_number": "+15555550100",
    "messages": [{"text": "Test message"}],
    "delay_before_typing": 1.0,
    "typing_duration": 2.0
  }'
```

---

## Monitoring

### Backend Logs

Location: `logs/brandon-backend.log`

Key log entries:
- `📨 Processing message(s) from` - Incoming webhook
- `✅ User validated` - Subscription check passed
- `🤖 Generating AI response` - AI generation started
- `✅ Generated response` - AI generation complete
- `📤 Sending message` - Sending to Mac server
- `❌ Error` - Any failures

### Mac Server Status

```bash
curl http://localhost:8787/status \
  -H "Authorization: Bearer <MAC_SERVER_APIKEY>"
```

Response:
```json
{
  "ok": true,
  "buffered_conversations": 1,
  "currently_typing": null,
  "pending_jobs": 2,
  "pending_chunks": 5
}
```

---

## Troubleshooting

### "Unauthorized" Error

**Symptoms:** 401 responses from Mac server

**Check:**
1. `MAC_SERVER_APIKEY` in backend .env matches Mac server
2. Header format: `Authorization: Bearer <key>` (with space)
3. No extra whitespace in .env file

### Messages Not Sending

**Check:**
1. Mac server running: `curl http://localhost:8787/health`
2. Backend can reach Mac server (network/firewall)
3. Rate limit not exceeded (check logs for rate limit warnings)
4. Mac iMessage app is open and functional

### Webhook Not Receiving

**Check:**
1. Backend running: `curl http://localhost:8000/health`
2. Mac server `REMOTE_SERVER_URL` points to backend
3. `REMOTE_SERVER_APIKEY` matches in both .env files
4. Backend logs for incoming requests

### Phone Number Not Recognized

**Check:**
1. Phone stored in Supabase `profiles.phone` in E.164 format
2. Matches number sending SMS
3. User has completed onboarding

---

## Mac Server Reference

Full Mac server documentation available in Mac server repository:
- `docs/BACKEND_INTEGRATION.md` - Complete integration guide
- `docs/SECURITY.md` - Security best practices
- `README.md` - Setup and configuration

---

## Support

For integration issues:
1. Check both backend and Mac server logs
2. Verify API keys match in both .env files
3. Test health endpoints
4. Review phone number format (E.164)
5. Check network connectivity between services
