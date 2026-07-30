# Brandon Backend Architecture

System architecture and design documentation for the Brandon fitness coaching backend.

## System Overview

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│             │   SMS   │              │  HTTP   │                 │
│    User     │◄───────►│  Mac Server  │◄───────►│  Brandon        │
│   (Phone)   │         │  (iMessage)  │         │  Backend        │
│             │         │              │         │  (FastAPI)      │
└─────────────┘         └──────────────┘         └────────┬────────┘
                                                           │
                                                           │ HTTP
                                                           │
                                     ┌─────────────────────┼─────────────────────┐
                                     │                     │                     │
                                     ▼                     ▼                     ▼
                              ┌───────────┐        ┌────────────┐       ┌──────────────┐
                              │  OpenAI   │        │  Supabase  │       │   Frontend   │
                              │   (GPT)   │        │ (Postgres) │       │   (Web App)  │
                              └───────────┘        └────────────┘       └──────────────┘
```

## Components

### 1. Mac Server (iMessage Relay)
- Runs on Mac with iMessage access
- Receives SMS from users
- Forwards to backend via webhook
- Sends AI responses back to users
- **Technology:** Node.js/Bun, AppleScript
- **Location:** Local Mac or cloud Mac instance

### 2. Brandon Backend (This Service)
- Receives webhooks from Mac server
- Validates user subscriptions
- Generates AI coaching responses
- Manages conversation history
- Schedules daily messages
- **Technology:** Python, FastAPI
- **Deployment:** Docker, Railway, Render, AWS, etc.

### 3. Supabase (Database)
- Stores user profiles and preferences
- Stores workout plans and sessions
- Stores message history
- Manages scheduled messages
- **Technology:** PostgreSQL, Supabase APIs
- **Region:** us-west-2 (shared Supabase project)

### 4. OpenAI
- Generates coaching responses
- Creates daily motivational messages
- **Model:** GPT-4o (configurable)
- **API:** OpenAI REST API

### 5. Frontend (Web App)
- User onboarding and profile setup
- Workout plan creation
- Payment/subscription management (Stripe)
- **Shares:** Same Supabase database
- **Technology:** (Your stack)

---

## Data Flow

### Incoming Message Flow

```
1. User sends SMS: "Hey coach, finished my workout!"
                    ↓
2. Mac receives SMS (iMessage)
                    ↓
3. Mac POSTs to /mac/webhook
   {
     "phone_number": "+1234567890",
     "messages": [{"text": "..."}]
   }
                    ↓
4. Backend validates phone number
                    ↓
5. Backend checks subscription status (Supabase)
                    ↓
6. Backend fetches user context:
   - Profile (goal, experience, equipment)
   - Workout plan
   - Recent message history (last 20)
                    ↓
7. Backend loads coaching prompt template
                    ↓
8. Backend calls OpenAI with:
   - Prompt template
   - User context
   - Incoming message
                    ↓
9. OpenAI generates response
                    ↓
10. Backend saves messages (inbound + outbound) to DB
                    ↓
11. Backend returns formatted response:
    {
      "reply_type": "message",
      "messages": [{"text": "Great work! ..."}]
    }
                    ↓
12. Mac server sends SMS to user
```

**Timeline:** ~2-5 seconds end-to-end

### Daily Message Flow

```
Midnight (00:00)
       ↓
1. Cron runs: schedule_daily_messages.py
                    ↓
2. Queries all users with preferred_text_time
                    ↓
3. For each user:
   - Calculate today's send time
   - Create scheduled_message record
   - Status: 'pending'
                    ↓
4. Script completes


Every Minute (*, *, *, *, *)
       ↓
1. Cron runs: send_scheduled_messages.py
                    ↓
2. Queries scheduled_messages WHERE:
   - status = 'pending'
   - scheduled_time <= NOW()
                    ↓
3. For each message:
   - Fetch user profile and workout plan
   - Extract today's workout
   - Load daily_message prompt
   - Call OpenAI to generate message
   - POST to Mac server /api/send
   - Update status to 'sent' or 'failed'
                    ↓
4. Mac server sends SMS to user
```

---

## Database Schema

### Existing Tables (From Frontend)

**users**
- id (PK)
- email, first_name, last_name
- stripe_customer_id, stripe_subscription_id
- **subscription_status** ← Used for validation
- signup_stage, created_at, updated_at

**profiles**
- id (PK), user_id (FK)
- name, **phone** ← Used for lookup
- age, sex, goal, consistency, experience
- equipment (JSONB), split, workout_days (JSONB)
- **preferred_text_time** ← For daily messages
- start_date, created_at

**workout_plans**
- id (PK), user_id (FK), profile_id (FK)
- **plan_data** (JSONB) ← Contains workout details
- status, created_at, updated_at

**workout_sessions**
- Tracks completed workouts
- Used for recent activity context

### New Tables (Backend)

**messages**
- id (PK), user_id (FK)
- phone_number, direction ('inbound'/'outbound')
- content, metadata (JSONB)
- created_at
- **Purpose:** Full conversation history

**conversation_context**
- id (PK), user_id (FK, unique)
- context_data (JSONB)
- last_updated
- **Purpose:** AI state and context caching

**scheduled_messages**
- id (PK), user_id (FK)
- phone_number, scheduled_time
- message_content (nullable, generated on send)
- status ('pending'/'sent'/'failed')
- sent_at, error_message, created_at
- **Purpose:** Daily message queue

**agent_prompts** (optional)
- id (PK), name (unique)
- prompt_text, version
- is_active, created_at, updated_at
- **Purpose:** Database-driven prompt management

---

## Service Layer

### User Validator (`user_validator.py`)
**Responsibility:** Validate users can receive messages

**Checks:**
1. Phone number exists in profiles
2. User account exists
3. Subscription status is valid ('active', 'trialing', 'past_due')

**Returns:** ValidationResult with user + profile data

### AI Agent (`ai_agent.py`)
**Responsibility:** Generate AI responses

**Functions:**
- `generate_response()` - Generate coaching response
- `generate_daily_message()` - Generate daily reminder

**Uses:** OpenAI GPT-4o with custom prompts

### Mac Client (`mac_client.py`)
**Responsibility:** Send messages to Mac server

**Features:**
- Rate limiting (10 req/min)
- Automatic retry with exponential backoff
- Error handling for 429, 401, 400
- Request queuing

### Message Handler (`message_handler.py`)
**Responsibility:** Orchestrate message processing

**Flow:**
1. Validate user
2. Save inbound message
3. Build AI context
4. Generate response
5. Save outbound message
6. Return formatted response

---

## Prompt System

### File-Based Prompts

Located in `app/prompts/`:
- `coach_agent.md` - Main coaching prompt
- `daily_message.md` - Daily reminder prompt

**Advantages:**
- Version controlled (Git)
- Easy to edit
- No DB dependency

**Template Variables:**
- `{user_name}`, `{goal}`, `{experience}`
- `{equipment}`, `{split}`
- `{workout_today}`, `{recent_messages}`
- `{incoming_message}`

### Prompt Loader

`prompts/loader.py`:
- Loads prompts from files
- Caches for performance
- Validates required prompts exist

---

## Scheduling

### Cron Jobs

**Schedule Daily Messages** (00:00 daily):
```bash
0 0 * * * /path/to/venv/bin/python /path/to/brandon-be/scripts/schedule_daily_messages.py
```

**Send Scheduled Messages** (every minute):
```bash
* * * * * /path/to/venv/bin/python /path/to/brandon-be/scripts/send_scheduled_messages.py
```

### Timing Accuracy

- **Scheduling accuracy:** Exact time stored in DB
- **Sending accuracy:** ±30 seconds (every minute check)
- **User experience:** Appears instant (good enough for daily messages)

---

## Security

### API Authentication

- **Mac → Backend:** Bearer token (REMOTE_SERVER_APIKEY)
- **Backend → Mac:** Bearer token (MAC_SERVER_APIKEY)
- **Backend → Supabase:** Service role key
- **Backend → OpenAI:** API key

### API Keys Storage

- **.env** file (local development)
- **Environment variables** (production)
- **Never committed to Git** (.gitignore)

### Phone Number Privacy

- Stored in E.164 format
- Validated before processing
- Used for user lookup only
- Not exposed in logs (truncated)

---

## Error Handling

### Validation Errors
- User not found → Friendly "not registered" message
- Subscription inactive → "renew subscription" message
- Returns message (not error) to avoid user confusion

### Processing Errors
- AI generation fails → Fallback message
- Mac server down → Logged, message queued
- Database errors → Logged, generic error message

### Retry Logic
- Mac server requests: 3 retries, exponential backoff
- Rate limits: Respect Retry-After header
- Network errors: Automatic retry with backoff

---

## Configuration

### Environment Variables

**Required:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `MAC_SERVER_URL`, `MAC_SERVER_APIKEY`, `REMOTE_SERVER_APIKEY`
- `OPENAI_API_KEY`

**Optional:**
- `OPENAI_MODEL` (default: gpt-4o)
- `BACKEND_HOST`, `BACKEND_PORT`
- `LOG_LEVEL` (default: INFO)
- `ENVIRONMENT` (development/staging/production)

### Configurable Limits

- `max_conversation_history` - Messages to include in AI context (default: 20)
- `mac_server_rate_limit` - Requests per minute (default: 10)
- `daily_message_lookback_minutes` - Scheduling window (default: 5)

---

## Logging

### Log Levels

- **INFO:** Normal operation (incoming messages, responses sent)
- **WARNING:** Validation failures, rate limits
- **ERROR:** Processing errors, Mac server errors
- **CRITICAL:** Fatal errors (config missing, service down)

### Log Format

```
2025-12-22 14:30:45 - app.service - LEVEL - Message
```

### Log Files

- **App logs:** `logs/brandon-backend.log`
- **Scheduler logs:** `logs/schedule_daily_messages.log`, `logs/send_scheduled_messages.log`
- **Rotation:** Configure with logrotate

---

## Scaling Considerations

### Current Design (1-1000 users)

- Single backend instance
- SQLite or local caching
- Simple cron jobs
- Mac server rate limit is bottleneck

### Future Scaling (1000+ users)

**Backend:**
- Multiple instances behind load balancer
- Redis for caching and rate limiting
- Celery for task queue (replace cron)
- Distributed rate limiting

**Database:**
- Connection pooling
- Read replicas for queries
- Indexed queries (already indexed)

**Mac Server:**
- Multiple Mac instances for redundancy
- Load balancing across Macs
- Higher rate limits with more instances

---

## Monitoring

### Health Checks

- **Backend:** `GET /health` (every 1-5 min)
- **Mac Server:** `GET /health` (every 1-5 min)
- **Supabase:** Connection test

### Metrics to Track

- Messages processed per minute
- AI generation latency
- Mac server send success rate
- Scheduled message delivery rate
- Error rates by type

### Alerts

- Backend down > 5 minutes
- Mac server down > 5 minutes
- Error rate > 10% for 10 minutes
- Scheduled message failures > 20%
- OpenAI API errors

---

## Testing Strategy

### Unit Tests
- Database queries
- User validation logic
- Prompt template filling
- Message chunking

### Integration Tests
- Webhook endpoint with mock data
- AI agent with mock OpenAI
- Mac client with mock server
- End-to-end message flow

### Manual Testing
- Send test SMS to Mac
- Verify response received
- Check database records
- Review logs

---

## Deployment

### Prerequisites
- Python 3.11+
- PostgreSQL (Supabase)
- OpenAI API key
- Mac server running

### Steps
1. Clone repo
2. Install dependencies: `pip install -r requirements.txt`
3. Configure `.env`
4. Run migrations: Apply SQL to Supabase
5. Start server: `uvicorn app.main:app`
6. Set up cron jobs
7. Test webhook with Mac server

### Production Checklist
- [ ] All environment variables set
- [ ] Migrations applied to Supabase
- [ ] Cron jobs configured
- [ ] Logs directory created
- [ ] Health checks enabled
- [ ] Monitoring configured
- [ ] Mac server configured with backend URL

---

## Future Enhancements

### Short Term
- Message editing/deletion
- Conversation branching
- Multi-language support
- Rich media (images, videos)

### Long Term
- Multiple coaching agents (nutrition, mindset)
- Voice message support
- Group coaching
- Analytics dashboard
- A/B testing prompts
- Sentiment analysis

---

## Documentation

- [Mac Integration](MAC_INTEGRATION.md) - Mac server interface details
- [API Documentation](API.md) - Complete API reference
- [Frontend Integration](FRONTEND_INTEGRATION.md) - Frontend data contracts
- README.md - Setup and deployment guide
