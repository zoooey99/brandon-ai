# iMessage Multi-Chunk Relay Server

The Mac-side relay that makes [Brandon](../README.md) possible: since Apple offers no iMessage API, this server reads incoming texts straight from the Mac's Messages database and sends replies via AppleScript, with **multi-chunk message delivery** and **typing indicators**.

## 🎯 Features

- ✅ **Multi-Chunk Responses** - Send multiple message bubbles with natural timing
- ✅ **Typing Indicators** - Shows typing indicator to recipient before sending
- ✅ **Typing Queue** - Only one conversation can show typing at a time
- ✅ **Deduplication** - Processed messages tracked in SQLite so nothing is handled twice
- ✅ **Silent Error Handling** - Logs errors without blocking other messages
- ✅ **Real-time Monitoring** - Status endpoint for system health checks

## 🏗️ Architecture

```
┌─────────────┐        ┌─────────────┐  forward  ┌─────────────┐
│             │  poll  │             ├───────────> Backend     │
│  chat.db    ├────────> Mac Server  │           │  Server     │
│  (read)     │        │             │ <─────────┤             │
└─────────────┘        │             │ POST      └─────────────┘
                       │             │ /api/send
                       │  ┌──────────┴──────────┐
                       │  │  local.db (write)   │
                       │  │  • processed_msgs   │
                       │  └─────────────────────┘
                       │
                       │  execute
                       v
                  ┌─────────────┐
                  │ AppleScript │
                  │  • typing   │
                  │  • clear    │
                  │  • send     │
                  └─────────────┘
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy and edit `.env`:

```bash
# Required
REMOTE_SERVER_URL=https://your-backend-server.com
CHAT_DB=/Users/yourname/Library/Messages/chat.db

# Optional (defaults shown)
PORT=8787
POLL_MS=1500
INTER_CHUNK_DELAY_SECONDS=0.7
PLACEHOLDER_TEXT=...
```

See [.env.example](./.env.example) for the full list, including the security settings.

### 3. Start Server

```bash
./start.sh
```

Or manually:

```bash
node server.js
```

## 📖 How It Works

### Inbound Flow

1. **Poll chat.db** - Server polls every 1.5s for new messages
2. **Deduplicate** - Already-processed message IDs are skipped (tracked in `local.db`)
3. **Start typing** - Sender is added to the typing queue and the indicator starts
4. **Forward to backend** - Each message is POSTed to the backend's `/mac/webhook`

### Outbound Flow

1. **Backend responds** - Backend POSTs the reply to `/api/send`
2. **Validate** - Auth, rate limit, phone format, and chunk contents are checked
3. **Clear input** - Run `Clear_input.scpt` to remove the typing placeholder
4. **Send chunks** - Run `send_imessage.scpt` per chunk, honoring per-chunk delays
5. **Resume queue** - Typing resumes for the next waiting conversation (if any)

## 🔧 Configuration

### Timing Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `INTER_CHUNK_DELAY_SECONDS` | 0.7 | Delay between sending each chunk |
| `POLL_MS` | 1500 | How often to poll chat.db |

### AppleScript Files

- **typing.scpt** - Opens conversation, types placeholder text (shows typing indicator)
- **Clear_input.scpt** - Clears the message input field (Cmd+A + Delete)
- **send_imessage.scpt** - Sends a complete message to recipient

## 📡 API Reference

### Status Endpoint

```bash
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

### Backend Integration

See [docs/BACKEND_INTEGRATION.md](./docs/BACKEND_INTEGRATION.md) for detailed request/response format.

**Example Backend Response (POST /api/send):**
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    { "text": "First message" },
    { "text": "Second message", "delay_after_previous": 1.5 },
    { "text": "Third message" }
  ]
}
```

## 🧪 Testing

Unit tests cover the pure logic (text decoding, chunk timing, phone validation, auth, and rate limiting) using the built-in `node:test` runner:

```bash
npm test
```

Test files live in `test/` and exercise the modules in `lib/`.

### Manual Database Inspection

```bash
sqlite3 local.db "SELECT * FROM processed_messages ORDER BY processed_at DESC LIMIT 10"
```

## 📊 Database Schema

### processed_messages
- `message_id` - Chat.db row ID (primary key)
- `phone_number` - Sender's phone number
- `processed_at` - When message was processed

## 🐛 Troubleshooting

### Server won't start

**Issue:** `Error: SQLITE_CANTOPEN: unable to open database file`

**Fix:** Check that `CHAT_DB` path in `.env` points to correct Messages database:
```bash
ls ~/Library/Messages/chat.db
```

### Messages not being detected

**Issue:** Server running but not seeing new messages

**Fix:**
1. Grant Full Disk Access to Terminal/iTerm in System Preferences → Security & Privacy
2. Restart server
3. Check chat.db polling in logs: `[POLL] New message from...`

### Typing indicator not showing

**Issue:** Messages send but recipient doesn't see typing

**Fix:**
1. Verify `typing.scpt` is executable
2. Check Messages app is responding (not frozen)
3. Test manually: `osascript typing.scpt "+15555550100" "..."`

### Multiple conversations typing at once

**Issue:** Typing conflicts between conversations

**Fix:** This is normal. Only one conversation shows typing at a time; the rest wait in the typing queue. Check logs for:
```
[TYPING QUEUE] Added +15555550100. Queue: [+15555550100]
```

## 📝 Logs

The server provides detailed logging with prefixes:

- `[POLL]` - Chat.db polling events
- `[BACKEND]` - Communication with the backend server
- `[TYPING]` / `[TYPING QUEUE]` - Typing indicator execution and queueing
- `[CLEAR]` - Input clearing
- `[SEND]` / `[API SEND]` - Message sending
- `[CLEANUP]` - Periodic local.db cleanup
- `[SHUTDOWN]` - Graceful shutdown

## 🎛️ Advanced Configuration

### Custom AppleScript Paths

```bash
TYPING_SCRIPT=/custom/path/typing.scpt
CLEAR_INPUT_SCRIPT=/custom/path/clear.scpt
SEND_SCRIPT=/custom/path/send.scpt
```

### Custom Database Location

```bash
LOCAL_DB_PATH=/custom/path/local.db
```

### Backend Server Authentication

```bash
REMOTE_SERVER_APIKEY=your_api_key_here
```

The API key is sent as `Bearer` token in `Authorization` header.

## 🔒 Security

### Security Features

✅ **Bearer Token Authentication** - Protect `/api/send` and `/status` endpoints
✅ **Rate Limiting** - 10 requests/minute per IP
✅ **Input Validation** - Phone number format, message size limits
✅ **Request Size Limiting** - 1MB max payload
✅ **Automatic Database Cleanup** - 30-day data retention
✅ **Graceful Shutdown** - Proper database connection handling
✅ **Truncated Logging** - Sensitive data protection in logs

### Quick Setup

1. **Generate API Key:**
   ```bash
   openssl rand -base64 32
   ```

2. **Add to `.env`:**
   ```bash
   MAC_SERVER_APIKEY=your_generated_key_here
   ```

3. **Configure Backend Server:**
   ```javascript
   // Backend must send this header:
   headers: {
     'Authorization': 'Bearer your_generated_key_here'
   }
   ```

### Security Best Practices

- ✅ **ALWAYS** set `MAC_SERVER_APIKEY` in production
- ✅ Use strong, randomly generated API keys (32+ chars)
- ✅ Keep `.env` file permissions at `chmod 600`
- ✅ Only expose server to trusted backend (localhost or VPN)
- ✅ Monitor logs for `[AUTH]` and `[RATE LIMIT]` events
- ✅ Rotate API keys regularly
- ✅ Set `ENABLE_VERBOSE_LOGGING=false` in production

⚠️ **WARNING:** Without `MAC_SERVER_APIKEY`, anyone can send messages through your Mac!

### Additional Security

- **Full Disk Access** required for reading chat.db
- **Local database** stores message text (plaintext, auto-cleaned)
- **TLS/HTTPS** recommended if exposed beyond localhost
- **Firewall rules** recommended to restrict access

For detailed security information, see [docs/SECURITY.md](./docs/SECURITY.md)

## 📚 Files

- `server.js` - Main server application
- `lib/` - Extracted pure logic (text decoding, timing, middleware)
- `test/` - Unit tests (`npm test`, uses `node:test`)
- `local.db` - SQLite database for processed-message state (auto-created)
- `typing.scpt` - Shows typing indicator
- `Clear_input.scpt` - Clears message input
- `send_imessage.scpt` - Sends messages
- `docs/` - Integration, protocol, and security documentation
- `.env` - Configuration (not in git)

## 🤝 Contributing

1. Test thoroughly before committing
2. Keep AppleScripts compatible with macOS 13+
3. Document any new configuration options
4. Add appropriate log prefixes for debugging

## 📄 License

MIT

---

**Questions?** Check the logs first, then refer to docs/BACKEND_INTEGRATION.md for integration details.
