# Brandon Backend

The coaching brain of [Brandon](../README.md), the AI fitness coach that lives in your texts. This FastAPI service receives messages from the [Mac iMessage relay](../imessage-relay/), generates personalized coaching responses, and manages daily workout reminders.

## Features

- 🤖 AI-powered coaching responses via OpenAI
- 💬 SMS integration via Mac iMessage relay server
- 📅 Scheduled daily workout reminders
- 💳 Subscription validation
- 📊 Full message history tracking
- 🔐 Secure API authentication
- ⚡ Rate limit handling

## Architecture

```
User (SMS) ↔ Mac Server ↔ Backend (FastAPI) ↔ Supabase
                                    ↕
                                 OpenAI
```

## Prerequisites

- Python 3.11+
- Supabase account (shared project with the web app)
- OpenAI API key
- Mac iMessage relay server running
- PostgreSQL (via Supabase)

## Setup

### 1. Clone and Install Dependencies

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

**Required Environment Variables:**
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key from Supabase
- `MAC_SERVER_URL` - URL of your Mac iMessage relay server
- `MAC_SERVER_APIKEY` - API key for Mac server (must match the relay's `.env`)
- `REMOTE_SERVER_APIKEY` - Generate with: `openssl rand -base64 32`
- `OPENAI_API_KEY` - Your OpenAI API key

### 3. Run Database Migrations

```bash
# Apply the messaging tables migration to Supabase
# See migrations/001_messaging_tables.sql
```

### 4. Configure Mac Server

In your Mac server `.env`, add:
```bash
REMOTE_SERVER_URL=http://your-backend-url:8000/mac/webhook
REMOTE_SERVER_APIKEY=<same as in backend .env>
```

## Running the Server

### Development

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Production

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

## Scheduled Tasks

### Daily Message Scheduling (runs at midnight)

```bash
# Add to crontab:
0 0 * * * /path/to/venv/bin/python /path/to/backend/scripts/schedule_daily_messages.py
```

### Send Scheduled Messages (runs every minute)

```bash
# Add to crontab:
* * * * * /path/to/venv/bin/python /path/to/backend/scripts/send_scheduled_messages.py
```

## API Endpoints

### POST /mac/webhook
Receives incoming SMS messages from Mac server.

**Authentication:** `Authorization: Bearer <REMOTE_SERVER_APIKEY>`

**Request:**
```json
{
  "phone_number": "+15555550100",
  "messages": [
    {
      "text": "Hey coach, finished my workout!",
      "timestamp": "2025-12-22T14:30:45Z"
    }
  ]
}
```

**Response:**
```json
{
  "reply_type": "message",
  "phone_number": "+15555550100",
  "messages": [
    {"text": "Great work! How did you feel?"}
  ],
  "delay_before_typing": 2.0,
  "typing_duration": 3.0
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

## Project Structure

```
backend/
├── app/
│   ├── main.py                 # FastAPI application
│   ├── config.py               # Configuration
│   ├── api/routes/             # API endpoints
│   ├── services/               # Business logic
│   ├── db/                     # Database layer
│   └── prompts/                # AI prompts
├── scripts/                    # Cron scripts
├── migrations/                 # SQL migrations
├── docs/                       # Documentation
└── requirements.txt
```

## Documentation

- [Mac Integration Guide](docs/MAC_INTEGRATION.md) - Mac server interface details
- [API Documentation](docs/API.md) - Complete API reference
- [Architecture](docs/ARCHITECTURE.md) - System design and data flow
- [Frontend Integration](docs/FRONTEND_INTEGRATION.md) - Frontend data contracts

## Development

### Running Tests

```bash
pytest
```

### Code Formatting

```bash
black app/ scripts/
```

### Type Checking

```bash
mypy app/
```

## Deployment

### Environment Variables

Ensure all required environment variables are set in your deployment environment.

### Database Migrations

Apply migrations to Supabase:
1. Go to Supabase Dashboard > SQL Editor
2. Run migrations from `migrations/` directory in order

### Monitoring

- Check logs: `tail -f logs/brandon-backend.log`
- Mac server status: `curl http://mac-server:8787/status`
- Backend health: `curl http://backend:8000/health`

## Troubleshooting

### "Unauthorized" error from Mac server
- Verify `MAC_SERVER_APIKEY` matches the key in Mac server `.env`
- Check `Authorization` header format: `Bearer <key>`

### Messages not sending
- Check Mac server is running: `curl http://mac-server:8787/health`
- Verify rate limits not exceeded (10 req/min)
- Check backend logs for errors

### Daily messages not arriving
- Verify cron jobs are running: `crontab -l`
- Check `scheduled_messages` table for pending messages
- Ensure `preferred_text_time` is set in user profiles

## Support

For issues or questions:
1. Check the documentation in `docs/`
2. Review Mac server logs
3. Check backend logs in `logs/`

## License

MIT (see the repository [LICENSE](../LICENSE))
