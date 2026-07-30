# Backend Integration Guide

Complete guide for backend developers integrating with the iMessage Multi-Chunk Relay Server.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Authentication Setup](#authentication-setup)
3. [Receiving Messages from Mac Server](#receiving-messages-from-mac-server)
4. [Sending Messages to Mac Server](#sending-messages-to-mac-server)
5. [Error Handling](#error-handling)
6. [Rate Limits](#rate-limits)
7. [Testing](#testing)
8. [Production Checklist](#production-checklist)
9. [Code Examples](#code-examples)

---

## Quick Start

### 1. Setup Communication

**Mac Server → Backend:**
- Mac server forwards incoming messages to `POST /mac/webhook` on your backend
- Includes `Authorization: Bearer <REMOTE_SERVER_APIKEY>` if configured

**Backend → Mac Server:**
- Backend sends responses to `POST <MAC_SERVER_URL>/api/send`
- **MUST** include `Authorization: Bearer <MAC_SERVER_APIKEY>`

### 2. Exchange API Keys

```bash
# Generate keys
openssl rand -base64 32  # For MAC_SERVER_APIKEY
openssl rand -base64 32  # For REMOTE_SERVER_APIKEY

# Mac server .env
MAC_SERVER_APIKEY=<key1>
REMOTE_SERVER_APIKEY=<key2>

# Backend .env
IMESSAGE_MAC_URL=http://mac-server:8787
IMESSAGE_MAC_API_KEY=<key1>
WEBHOOK_API_KEY=<key2>
```

---

## Authentication Setup

### Authenticating Requests TO Mac Server

**All requests to Mac server must include:**

```http
Authorization: Bearer <MAC_SERVER_APIKEY>
```

**Example (cURL):**
```bash
curl -X POST http://localhost:8787/api/send \
  -H "Authorization: Bearer YOUR_GENERATED_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"reply_type": "message", "phone_number": "+15555550100", "messages": [{"text": "Hello"}]}'
```

### Authenticating Requests FROM Mac Server

**Mac server will include (if `REMOTE_SERVER_APIKEY` is set):**

```http
Authorization: Bearer <REMOTE_SERVER_APIKEY>
```

**Validate in your backend:**

```javascript
// Express.js example
app.post('/mac/webhook', (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedToken = `Bearer ${process.env.WEBHOOK_API_KEY}`;

  if (authHeader !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Process request
  // ...
});
```

---

## Receiving Messages from Mac Server

### Endpoint: `POST /mac/webhook`

**Request Format:**

```json
{
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Hey, I'm feeling really tired today",
      "timestamp": "2025-12-04T18:30:45Z"
    },
    {
      "text": "Should I still workout?",
      "timestamp": "2025-12-04T18:30:48Z"
    }
  ]
}
```

**Fields:**
- `phone_number` (string): Sender's phone number in E.164 format
- `messages` (array): Array of message objects
  - `text` (string): Message content
  - `timestamp` (string): ISO 8601 timestamp

**Response:** You must return one of two response types (see next section)

---

## Sending Messages to Mac Server

### Endpoint: `POST /api/send`

**Base URL:** Configured in `REMOTE_SERVER_URL` (Mac server .env)

### Response Type 1: Send Messages

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
  ],
  "delay_before_typing": 3.0,
  "typing_duration": 5.0
}
```

**Required Fields:**
- `reply_type`: Must be `"message"`
- `phone_number`: Recipient (E.164 format)
- `messages`: Array of message chunks (1-20 chunks)
  - `text`: Message content (required, max 10KB)
  - `delay_after_previous`: Seconds to wait after previous chunk (optional, default: 0.7s)

**Optional Fields:**
- `delay_before_typing`: Seconds to wait before showing typing (default: 0)
- `typing_duration`: Seconds to show typing indicator (default: 3)

### Response Type 2: No Reply

```json
{
  "reply_type": "no_reply",
  "phone_number": "+15555550100"
}
```

**Use Cases:**
- Acknowledge message without responding
- Rate limiting / quota exceeded
- Non-conversational messages

---

## Error Handling

### Mac Server Error Responses

#### Authentication Errors (401)

```json
{
  "error": "Unauthorized - invalid API key"
}
```

**Causes:**
- Missing `Authorization` header
- Wrong API key
- Invalid header format (not "Bearer <token>")

**Solution:**
- Check `MAC_SERVER_APIKEY` is set correctly
- Verify header format: `Authorization: Bearer <key>`

#### Validation Errors (400)

```json
{
  "error": "phone_number must be in E.164 format (e.g., +15555550100)"
}
```

**Common Causes:**
- Invalid phone number format
- Message array exceeds 20 chunks
- Message text exceeds 10KB
- Invalid delay values (negative, > 3600s)

**Solution:**
- Validate input before sending
- Use E.164 phone numbers
- Split long responses into multiple messages (max 20)

#### Rate Limit Errors (429)

```json
{
  "error": "Too many requests",
  "retry_after_seconds": 42
}
```

**Headers:**
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1701708280
```

**Limit:** 10 requests per minute per IP

**Solution:**
- Implement exponential backoff
- Respect `retry_after_seconds`
- Use request queuing

### Handling Network Errors

```javascript
async function sendToMacServer(phoneNumber, messages) {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(`${MAC_SERVER_URL}/api/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MAC_SERVER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reply_type: 'message',
          phone_number: phoneNumber,
          messages: messages,
          delay_before_typing: 2.0,
          typing_duration: 3.0
        }),
        timeout: 10000 // 10s timeout
      });

      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
        console.log(`Rate limited, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Mac server error: ${error.error}`);
      }

      const result = await response.json();
      console.log(`Job created: ${result.job_id}`);
      return result;

    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        throw error;
      }

      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}
```

---

## Rate Limits

### Mac Server Limits

**Endpoint:** `/api/send`
- **Limit:** 10 requests/minute per IP
- **Status Code:** 429 Too Many Requests
- **Headers:** `X-RateLimit-*`

### Best Practices

1. **Implement Request Queue:**
   ```javascript
   const queue = new PQueue({
     concurrency: 1,
     interval: 6000,    // 6 seconds
     intervalCap: 1     // 1 request per 6s = 10/min
   });

   await queue.add(() => sendToMacServer(phone, messages));
   ```

2. **Monitor Rate Limit Headers:**
   ```javascript
   const remaining = response.headers.get('X-RateLimit-Remaining');
   if (parseInt(remaining) < 2) {
     console.warn('Approaching rate limit!');
   }
   ```

3. **Respect Retry-After:**
   ```javascript
   if (response.status === 429) {
     const retryAfter = response.headers.get('Retry-After') || 60;
     await sleep(retryAfter * 1000);
   }
   ```

---

## Testing

### Health Check

```bash
curl http://localhost:8787/health
```

**Response:**
```json
{
  "ok": true,
  "status": "operational"
}
```

### Status Check (Requires Auth)

```bash
curl http://localhost:8787/status \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**
```json
{
  "ok": true,
  "buffered_conversations": 1,
  "currently_typing": null,
  "pending_jobs": 2,
  "pending_chunks": 5
}
```

### Send Test Message

```bash
curl -X POST http://localhost:8787/api/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "reply_type": "message",
    "phone_number": "+15555550100",
    "messages": [
      {"text": "Test message 1"},
      {"text": "Test message 2"}
    ],
    "delay_before_typing": 1.0,
    "typing_duration": 2.0
  }'
```

**Success Response:**
```json
{
  "ok": true,
  "job_id": 42,
  "message": "Job created successfully"
}
```

---

## Production Checklist

### Before Deployment

- [ ] API keys generated using `openssl rand -base64 32`
- [ ] `MAC_SERVER_APIKEY` configured in Mac server
- [ ] `REMOTE_SERVER_APIKEY` configured in both servers
- [ ] Backend validates incoming webhook auth tokens
- [ ] Backend includes auth header in all Mac server requests
- [ ] Rate limiting implemented in backend
- [ ] Error handling and retries implemented
- [ ] Request timeouts configured (10-30s recommended)
- [ ] Logging configured for debugging
- [ ] Monitoring/alerting for failed requests

### Network Security

- [ ] Mac server only accessible to backend (localhost or VPN)
- [ ] TLS/HTTPS enabled if exposed to internet
- [ ] Firewall rules configured
- [ ] API keys stored securely (env variables, secrets manager)
- [ ] API keys not committed to version control

### Testing

- [ ] Health check endpoint tested
- [ ] Webhook endpoint tested
- [ ] Message sending tested
- [ ] Error handling tested (401, 400, 429)
- [ ] Rate limit behavior tested
- [ ] Network timeout behavior tested

---

## Code Examples

### Node.js + Express

**Webhook Handler:**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// Webhook endpoint
app.post('/mac/webhook', async (req, res) => {
  // Validate auth
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.WEBHOOK_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone_number, messages } = req.body;

  console.log(`Received ${messages.length} messages from ${phone_number}`);

  // Process messages with your AI/logic
  const responseText = await processMessages(messages);

  // Send response back to Mac server
  try {
    const result = await sendToMacServer(phone_number, [
      { text: responseText }
    ]);

    res.json({ ok: true, job_id: result.job_id });
  } catch (error) {
    console.error('Failed to send to Mac server:', error);
    res.status(500).json({ error: error.message });
  }
});

async function sendToMacServer(phoneNumber, messages) {
  const response = await fetch(`${process.env.IMESSAGE_MAC_URL}/api/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.IMESSAGE_MAC_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reply_type: 'message',
      phone_number: phoneNumber,
      messages: messages,
      delay_before_typing: 2.0,
      typing_duration: 3.0
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Mac server error: ${error.error}`);
  }

  return await response.json();
}

app.listen(3000, () => {
  console.log('Backend server running on port 3000');
});
```

### Python + Flask

```python
from flask import Flask, request, jsonify
import requests
import os

app = Flask(__name__)

MAC_SERVER_URL = os.getenv('IMESSAGE_MAC_URL')
MAC_API_KEY = os.getenv('IMESSAGE_MAC_API_KEY')
WEBHOOK_API_KEY = os.getenv('WEBHOOK_API_KEY')

@app.route('/mac/webhook', methods=['POST'])
def webhook():
    # Validate auth
    auth_header = request.headers.get('Authorization')
    if auth_header != f'Bearer {WEBHOOK_API_KEY}':
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    phone_number = data['phone_number']
    messages = data['messages']

    print(f"Received {len(messages)} messages from {phone_number}")

    # Process messages
    response_text = process_messages(messages)

    # Send response to Mac server
    try:
        result = send_to_mac_server(phone_number, [{'text': response_text}])
        return jsonify({'ok': True, 'job_id': result['job_id']})
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'error': str(e)}), 500

def send_to_mac_server(phone_number, messages):
    response = requests.post(
        f'{MAC_SERVER_URL}/api/send',
        headers={
            'Authorization': f'Bearer {MAC_API_KEY}',
            'Content-Type': 'application/json'
        },
        json={
            'reply_type': 'message',
            'phone_number': phone_number,
            'messages': messages,
            'delay_before_typing': 2.0,
            'typing_duration': 3.0
        },
        timeout=10
    )

    response.raise_for_status()
    return response.json()

if __name__ == '__main__':
    app.run(port=3000)
```

### TypeScript + Next.js API Route

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';

interface InboundMessage {
  text: string;
  timestamp: string;
}

interface WebhookRequest {
  phone_number: string;
  messages: InboundMessage[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate auth
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.WEBHOOK_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone_number, messages } = req.body as WebhookRequest;

  console.log(`Received ${messages.length} messages from ${phone_number}`);

  // Process messages
  const responseText = await processMessages(messages);

  // Send to Mac server
  try {
    const response = await fetch(`${process.env.IMESSAGE_MAC_URL}/api/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.IMESSAGE_MAC_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reply_type: 'message',
        phone_number,
        messages: [{ text: responseText }],
        delay_before_typing: 2.0,
        typing_duration: 3.0,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error);
    }

    const result = await response.json();
    res.status(200).json({ ok: true, job_id: result.job_id });
  } catch (error) {
    console.error('Mac server error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
}

async function processMessages(messages: InboundMessage[]): Promise<string> {
  // Your AI/logic here
  return "Response message";
}
```

---

## Common Patterns

### Multi-Chunk Responses

```javascript
// Break long response into natural chunks
const chunks = [
  { text: "Here's your workout plan:" },
  { text: "• 3x10 push-ups", delay_after_previous: 1.0 },
  { text: "• 3x12 dumbbell rows", delay_after_previous: 1.0 },
  { text: "• 2x15 shoulder press", delay_after_previous: 1.0 },
  { text: "Good luck! 💪", delay_after_previous: 2.0 }
];

await sendToMacServer(phone_number, chunks);
```

### Conditional Responses

```javascript
app.post('/mac/webhook', async (req, res) => {
  const { phone_number, messages } = req.body;

  // Check if user wants to stop
  const lastMessage = messages[messages.length - 1].text.toLowerCase();

  if (lastMessage === 'stop' || lastMessage === 'unsubscribe') {
    // No reply
    res.json({
      reply_type: 'no_reply',
      phone_number
    });

    // Update user in database
    await markUserUnsubscribed(phone_number);
    return;
  }

  // Normal response
  const response = await generateResponse(messages);
  res.json({
    reply_type: 'message',
    phone_number,
    messages: [{ text: response }]
  });
});
```

---

## Troubleshooting

### "Unauthorized" Error

**Check:**
1. `MAC_SERVER_APIKEY` is set in Mac server `.env`
2. Backend is sending correct key in `Authorization` header
3. Header format is exactly `Bearer <key>` (with space)

### "Rate limit exceeded"

**Solutions:**
1. Implement request queuing (max 10/minute)
2. Respect `Retry-After` header
3. Monitor `X-RateLimit-Remaining` header

### Messages not arriving

**Check:**
1. Mac server logs for `[POLL]` entries
2. Mac server is running
3. Messages app is open on Mac
4. Full Disk Access granted to Terminal/iTerm

### Typing indicator not showing

**Check:**
1. `typing_duration` > 0
2. Messages app is in focus (or will work when opened)
3. Mac server logs for `[TYPING]` entries

---

## Support

For integration issues:

1. Check Mac server logs: `pm2 logs imessage-relay`
2. Test health endpoint: `curl http://mac-server:8787/health`
3. Verify authentication with `/status` endpoint
4. Review [docs/SECURITY.md](./SECURITY.md) for security best practices

---

**Last Updated:** 2025-12-22
