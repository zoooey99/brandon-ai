
## Server Endpoints

### 1. GET `/health`

Unauthenticated liveness check.

**Response:**
```json
{ "ok": true, "status": "operational" }
```

---

### 2. GET `/status`

System status endpoint. Requires `Authorization: Bearer <MAC_SERVER_APIKEY>`.

**Request:**
```http
GET http://localhost:8787/status
```

**Response:**
```json
{
  "ok": true,
  "currently_typing_for": "+15555550100",
  "typing_queue": ["+15555550100"],
  "typing_queue_length": 1
}
```

**Fields:**
- `ok` (boolean): Server is operational
- `currently_typing_for` (string|null): Phone number of the conversation currently showing the typing indicator, or `null`
- `typing_queue` (array): Conversations waiting for the typing indicator
- `typing_queue_length` (integer): Length of that queue

**Use Cases:**
- Health monitoring
- Debugging typing-queue state
- Verifying server is running

---

### 3. POST `/api/send`

Endpoint for the backend to send message responses back to the Mac server. Requires `Authorization: Bearer <MAC_SERVER_APIKEY>`; rate-limited per IP.

**Request:**
```http
POST http://localhost:8787/api/send
Content-Type: application/json
```

**Request Body (Multi-Chunk Response):**
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "First message chunk",
      "delay_after_previous": 0.5
    },
    {
      "text": "Second message chunk",
      "delay_after_previous": 2.0
    },
    {
      "text": "Third message chunk"
    }
  ]
}
```

**Request Body (No Reply):**
```json
{
  "reply_type": "no_reply",
  "phone_number": "+15555550100"
}
```

**Response (Success):**
```json
{ "ok": true, "message": "Sent 3 chunk(s) to +15555550100" }
```

**Response (No Reply / Nothing to Send):**
```json
{ "ok": true, "message": "No reply" }
```

**Response (Error):**
```json
{ "error": "phone_number is required" }
```

**Status Codes:**
- `200 OK`: Request processed successfully
- `400 Bad Request`: Missing required fields or invalid format
- `401 Unauthorized`: Missing or invalid API key
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Error while sending

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reply_type` | string | Yes | Either `"message"` or `"no_reply"` |
| `phone_number` | string | Yes | Recipient phone number in E.164 (e.g., `"+15555550100"`) |
| `messages` | array | Conditional | Required if `reply_type` is `"message"` |
| `messages[].text` | string | Yes | Message content to send |
| `messages[].delay_after_previous` | float | No | Delay in seconds after the previous chunk (default: `INTER_CHUNK_DELAY_SECONDS`; ignored for the first chunk) |

**Sending Behavior:**
1. Stop the typing indicator for this conversation and clear the input field
2. Send the first chunk immediately
3. Wait `messages[n].delay_after_previous` seconds before each subsequent chunk
4. Resume the typing indicator for the next conversation in the queue (if any)

---
