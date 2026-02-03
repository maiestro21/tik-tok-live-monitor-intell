-- Migration script to apply code review fixes
-- Run this script on existing database to apply the fixes

-- ============================================================================
-- FIX 1: Remove duplicate 'acknowledged' from alerts status CHECK constraint
-- ============================================================================
-- Drop the old constraint
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_status_check;

-- Add the corrected constraint
ALTER TABLE alerts ADD CONSTRAINT alerts_status_check 
CHECK (status IN ('pending', 'new', 'acknowledged', 'resolved'));

-- ============================================================================
-- FIX 2: Add UNIQUE constraint for trigger words
-- ============================================================================
-- This prevents duplicate trigger words with same word + case sensitivity
CREATE UNIQUE INDEX IF NOT EXISTS idx_trigger_words_unique 
ON trigger_words(LOWER(word), case_sensitive);

-- ============================================================================
-- FIX 3: Ensure anti_blocking_settings row exists (for upsert fix)
-- ============================================================================
-- This is already handled by ON CONFLICT in the code, but ensure row exists
INSERT INTO anti_blocking_settings (id, settings) 
VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Cleanup: Remove any duplicate trigger words (if any exist)
-- ============================================================================
-- This will keep only the first occurrence of each unique word+case combination
DELETE FROM trigger_words t1
WHERE t1.id NOT IN (
    SELECT MIN(t2.id)
    FROM trigger_words t2
    GROUP BY LOWER(t2.word), t2.case_sensitive
);
