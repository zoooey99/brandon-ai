-- Migration: Add Prompt Version History and Drafts
-- Run this in Supabase SQL Editor: the Supabase SQL Editor

-- Create history table for prompt versions
CREATE TABLE IF NOT EXISTS agent_prompt_history (
    id SERIAL PRIMARY KEY,
    prompt_name TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    version INT NOT NULL,
    char_count INT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(prompt_name, version)
);

-- Create drafts table for auto-save
CREATE TABLE IF NOT EXISTS agent_prompt_drafts (
    id SERIAL PRIMARY KEY,
    prompt_name TEXT UNIQUE NOT NULL,
    draft_text TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Remove is_active column from agent_prompts (if exists)
ALTER TABLE agent_prompts DROP COLUMN IF EXISTS is_active;

-- Create index for faster history lookups
CREATE INDEX IF NOT EXISTS idx_prompt_history_name ON agent_prompt_history(prompt_name);
CREATE INDEX IF NOT EXISTS idx_prompt_history_name_version ON agent_prompt_history(prompt_name, version DESC);
