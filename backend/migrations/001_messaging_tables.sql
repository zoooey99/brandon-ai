-- Brandon Backend Messaging Tables Migration
-- Created: 2025-12-22
-- Description: Adds tables for SMS messaging, conversation context, scheduled messages, and agent prompts

-- ============================================================================
-- Table: messages
-- Purpose: Store full conversation history (inbound and outbound SMS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_messages_user_created ON messages(user_id, created_at DESC);
CREATE INDEX idx_messages_phone ON messages(phone_number);
CREATE INDEX idx_messages_direction ON messages(direction);

-- ============================================================================
-- Table: conversation_context
-- Purpose: Store AI conversation state and context for each user
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversation_context (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_data JSONB NOT NULL DEFAULT '{}',
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Index for user lookups
CREATE INDEX idx_conversation_context_user ON conversation_context(user_id);

-- ============================================================================
-- Table: scheduled_messages
-- Purpose: Queue for daily workout reminders and scheduled messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  scheduled_time TIMESTAMP NOT NULL,
  message_content TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient scheduling and querying
CREATE INDEX idx_scheduled_pending ON scheduled_messages(scheduled_time, status)
  WHERE status = 'pending';
CREATE INDEX idx_scheduled_user ON scheduled_messages(user_id);

-- ============================================================================
-- Table: agent_prompts
-- Purpose: Store and version control AI agent prompts (optional, for DB-driven prompts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_prompts (
  id SERIAL PRIMARY KEY,
  name VARCHAR UNIQUE NOT NULL,
  prompt_text TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for active prompts
CREATE INDEX idx_agent_prompts_active ON agent_prompts(name, is_active)
  WHERE is_active = TRUE;

-- ============================================================================
-- Initial Data: Default Prompts (optional)
-- ============================================================================
INSERT INTO agent_prompts (name, prompt_text, version, is_active) VALUES
('coach_agent', 'You are Brandon, an enthusiastic fitness coach. Keep responses short and encouraging.', 1, TRUE),
('daily_message', 'Generate a motivating daily workout reminder.', 1, TRUE)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE messages IS 'Full SMS conversation history between users and Brandon';
COMMENT ON TABLE conversation_context IS 'AI conversation state and context per user';
COMMENT ON TABLE scheduled_messages IS 'Queue for daily workout reminders and scheduled messages';
COMMENT ON TABLE agent_prompts IS 'Versioned AI agent prompts (optional database-driven prompts)';

COMMENT ON COLUMN messages.direction IS 'Either inbound (user to Brandon) or outbound (Brandon to user)';
COMMENT ON COLUMN messages.metadata IS 'Additional data like job_id, chunks, timestamps, etc.';
COMMENT ON COLUMN conversation_context.context_data IS 'JSON containing recent messages, workout info, etc.';
COMMENT ON COLUMN scheduled_messages.status IS 'pending, sent, or failed';
