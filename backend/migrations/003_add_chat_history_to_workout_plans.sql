-- Migration: Add chat_history column to workout_plans
-- Purpose: Store planning conversation history for admin visibility
-- Date: 2025-01-19

-- Add chat_history column to workout_plans table
-- This stores the conversation between user and AI during plan generation
-- Format: [{role: "user"|"assistant", content: "message text"}]
ALTER TABLE workout_plans
ADD COLUMN IF NOT EXISTS chat_history JSONB DEFAULT '[]';

-- Add comment for documentation
COMMENT ON COLUMN workout_plans.chat_history IS 'Stores planning conversation history as array of {role, content} objects';
