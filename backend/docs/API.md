# Brandon Backend API Documentation

Complete API reference for the Brandon Backend service.

## Base URL

```
http://localhost:8000 (development)
https://your-domain.com (production)
```

---

## Authentication

The backend uses Bearer token authentication for endpoints called by the Mac server.

```http
Authorization: Bearer <REMOTE_SERVER_APIKEY>
```

---

## Endpoints

### Health Check

Check if the backend service is running and healthy.

**Endpoint:** `GET /health`

**Authentication:** None required

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

**Status Codes:**
- `200` - Service is healthy

---

### Root

Get API information.

**Endpoint:** `GET /`

**Authentication:** None required

**Response:**
```json
{
  "name": "Brandon Backend",
  "version": "1.0.0",
  "status": "running",
  "environment": "development",
  "docs": "/docs"
}
```

---

### Receive Messages (Webhook)

Receive incoming SMS messages from Mac server.

**Endpoint:** `POST /mac/webhook`

**Authentication:** Required (`REMOTE_SERVER_APIKEY`)

**Headers:**
```http
Authorization: Bearer <REMOTE_SERVER_APIKEY>
Content-Type: application/json
```

**Request Body:**
```json
{
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Hey coach, I finished my workout today!",
      "timestamp": "2025-12-22T14:30:45Z"
    },
    {
      "text": "Feeling really strong!",
      "timestamp": "2025-12-22T14:30:48Z"
    }
  ]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| phone_number | string | Yes | Sender's phone in E.164 format |
| messages | array | Yes | Array of message objects |
| messages[].text | string | Yes | Message content |
| messages[].timestamp | string | Yes | ISO 8601 timestamp |

**Response (Send Message):**
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "That's awesome! Great job crushing your workout! 💪",
      "delay_after_previous": 0.0
    },
    {
      "text": "How was the intensity? Feeling good about it?",
      "delay_after_previous": 1.5
    }
  ],
  "delay_before_typing": 2.0,
  "typing_duration": 3.0
}
```

**Response (No Reply):**
```json
{
  "reply_type": "no_reply",
  "phone_number": "+15555550100"
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| reply_type | string | "message" or "no_reply" |
| phone_number | string | Recipient phone number |
| messages | array | Array of message chunks (if reply_type is "message") |
| messages[].text | string | Message content |
| messages[].delay_after_previous | number | Seconds to wait after previous chunk (default: 0.7) |
| delay_before_typing | number | Seconds before showing typing indicator (default: 2.0) |
| typing_duration | number | Seconds to show typing indicator (default: 3.0) |

**Status Codes:**
- `200` - Success (returns webhook response)
- `401` - Unauthorized (invalid API key)
- `422` - Validation error (invalid request format)

**Error Response:**
```json
{
  "detail": "Missing Authorization header"
}
```

---

### Test Webhook

Test webhook authentication without processing a message.

**Endpoint:** `GET /mac/webhook/test`

**Authentication:** Required (`REMOTE_SERVER_APIKEY`)

**Headers:**
```http
Authorization: Bearer <REMOTE_SERVER_APIKEY>
```

**Response:**
```json
{
  "status": "ok",
  "message": "Webhook authentication successful"
}
```

**Status Codes:**
- `200` - Authentication successful
- `401` - Unauthorized (invalid API key)

---

## Interactive API Documentation

The backend provides interactive API documentation via FastAPI:

### Swagger UI

```
http://localhost:8000/docs
```

Interactive documentation with:
- Try-it-out functionality
- Request/response examples
- Schema definitions

### ReDoc

```
http://localhost:8000/redoc
```

Alternative documentation interface with:
- Cleaner layout
- Better for reading
- Organized by tags

---

## Error Handling

### Error Response Format

All errors follow this format:

```json
{
  "detail": "Error message here"
}
```

Or for validation errors:

```json
{
  "detail": [
    {
      "loc": ["body", "phone_number"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

### Common Error Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 400 | Bad Request | Invalid JSON, missing required fields |
| 401 | Unauthorized | Missing or invalid Authorization header |
| 422 | Unprocessable Entity | Invalid data format (e.g., phone number) |
| 500 | Internal Server Error | Backend processing error |

---

## Request Flow

### Incoming Message Flow

1. **Mac Server** receives SMS from user
2. **Mac Server** POSTs to `/mac/webhook` with message data
3. **Backend** validates request and authentication
4. **Backend** validates user subscription and phone number
5. **Backend** saves incoming message to database
6. **Backend** fetches user profile, workout data, conversation history
7. **Backend** generates AI response via OpenAI
8. **Backend** saves outbound message to database
9. **Backend** returns formatted response to Mac Server
10. **Mac Server** sends SMS response to user

**Average Response Time:** 2-5 seconds (depends on OpenAI API)

---

## Rate Limits

### Backend Limits

Currently no rate limiting on backend endpoints. Mac server rate limiting (10 req/min) provides natural throttling.

### Recommendations

For production:
- Add rate limiting per phone number (e.g., 30 messages/hour)
- Add rate limiting per IP (e.g., 100 requests/hour)
- Implement request queuing for high volume

---

## Data Models

### WebhookRequest

```python
{
  "phone_number": "string (E.164)",
  "messages": [
    {
      "text": "string",
      "timestamp": "string (ISO 8601)"
    }
  ]
}
```

### WebhookResponse

```python
{
  "reply_type": "message" | "no_reply",
  "phone_number": "string (E.164)",
  "messages": [  # optional, only if reply_type is "message"
    {
      "text": "string",
      "delay_after_previous": "number (seconds)"
    }
  ],
  "delay_before_typing": "number (seconds)",
  "typing_duration": "number (seconds)"
}
```

---

## Example Requests

### Successful Message Processing

```bash
curl -X POST http://localhost:8000/mac/webhook \
  -H "Authorization: Bearer your-remote-server-apikey" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+15555550100",
    "messages": [
      {
        "text": "Finished my workout!",
        "timestamp": "2025-12-22T14:30:45Z"
      }
    ]
  }'
```

Response:
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Awesome work! How did you feel?",
      "delay_after_previous": 0.0
    }
  ],
  "delay_before_typing": 2.0,
  "typing_duration": 3.0
}
```

### Unregistered Phone Number

```bash
curl -X POST http://localhost:8000/mac/webhook \
  -H "Authorization: Bearer your-remote-server-apikey" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+15555550100",
    "messages": [
      {
        "text": "Hello",
        "timestamp": "2025-12-22T14:30:45Z"
      }
    ]
  }'
```

Response:
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Hey! I don't recognize this number. Make sure you're texting from the phone number registered with your Brandon account!",
      "delay_after_previous": 0.0
    }
  ],
  "delay_before_typing": 1.0,
  "typing_duration": 2.0
}
```

### Inactive Subscription

```bash
curl -X POST http://localhost:8000/mac/webhook \
  -H "Authorization: Bearer your-remote-server-apikey" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+15555550100",
    "messages": [
      {
        "text": "Hello",
        "timestamp": "2025-12-22T14:30:45Z"
      }
    ]
  }'
```

Response:
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Hey! Your subscription needs to be renewed to continue coaching. Visit your account to reactivate!",
      "delay_after_previous": 0.0
    }
  ],
  "delay_before_typing": 1.0,
  "typing_duration": 2.0
}
```

---

## Monitoring & Debugging

### Logs

Backend logs all requests and responses:

```
2025-12-22 14:30:45 - app.api.routes.messages - INFO - 📨 Received webhook from +15555550100 (1 message(s))
2025-12-22 14:30:45 - app.services.user_validator - INFO - 🔍 Validating user for phone: +15555550100
2025-12-22 14:30:45 - app.services.user_validator - INFO - ✅ User user_123 validated successfully (status: active)
2025-12-22 14:30:46 - app.services.ai_agent - INFO - 🤖 Generating AI response for user: John
2025-12-22 14:30:48 - app.services.ai_agent - INFO - ✅ Generated response (87 chars)
2025-12-22 14:30:48 - app.api.routes.messages - INFO - ✅ Webhook processed successfully (reply_type: message)
```

### Health Monitoring

Regular health check:
```bash
*/5 * * * * curl -f http://localhost:8000/health || echo "Backend down!"
```

---

## Development

### Running Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Run development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Testing

```bash
# Test health endpoint
curl http://localhost:8000/health

# Test webhook with valid auth
curl -X POST http://localhost:8000/mac/webhook/test \
  -H "Authorization: Bearer your-remote-server-apikey"

# View interactive docs
open http://localhost:8000/docs
```

---

## Support

For API issues or questions:
1. Check logs in `logs/brandon-backend.log`
2. Review interactive docs at `/docs`
3. Verify environment variables in `.env`
4. Test health endpoint: `GET /health`
