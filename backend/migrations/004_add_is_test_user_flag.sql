-- Add is_test_user flag to users table
-- Used to exclude test/employee users from dashboard metrics
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_user BOOLEAN DEFAULT FALSE;
