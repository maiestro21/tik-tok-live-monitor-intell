-- Add severity column to trigger_words table
ALTER TABLE trigger_words 
ADD COLUMN IF NOT EXISTS severity VARCHAR(50) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high'));

-- Update existing trigger words to have medium severity if null
UPDATE trigger_words SET severity = 'medium' WHERE severity IS NULL;
