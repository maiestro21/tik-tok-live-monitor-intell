-- TikTok Live Monitor PostgreSQL Database Schema
-- This script creates all necessary tables and indexes for the migration from JSON files to PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ============================================================================
-- TIKTOK ACCOUNTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS tiktok_accounts (
    id VARCHAR(255) PRIMARY KEY,
    handle VARCHAR(255) UNIQUE NOT NULL,
    unique_id VARCHAR(255),
    nickname VARCHAR(255),
    signature TEXT,
    bio TEXT,
    profile_picture_url TEXT,
    verified BOOLEAN DEFAULT FALSE,
    secret BOOLEAN DEFAULT FALSE,
    private_account BOOLEAN DEFAULT FALSE,
    language VARCHAR(50),
    region VARCHAR(100),
    sec_uid VARCHAR(255),
    follower_count BIGINT DEFAULT 0,
    following_count BIGINT DEFAULT 0,
    video_count BIGINT DEFAULT 0,
    heart_count BIGINT DEFAULT 0,
    digg_count BIGINT DEFAULT 0,
    friend_count BIGINT DEFAULT 0,
    creation_date TIMESTAMPTZ,
    create_time BIGINT,
    unique_id_modify_time TIMESTAMPTZ,
    unique_id_modify_time_unix BIGINT,
    nick_name_modify_time TIMESTAMPTZ,
    nick_name_modify_time_unix BIGINT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_handle ON tiktok_accounts(handle);
CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_unique_id ON tiktok_accounts(unique_id);

-- ============================================================================
-- MONITORED TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS monitored (
    handle VARCHAR(255) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    current_live_session_id UUID,
    last_checked_at TIMESTAMPTZ,
    last_live_time TIMESTAMPTZ,
    FOREIGN KEY (handle) REFERENCES tiktok_accounts(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_monitored_enabled ON monitored(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_monitored_current_session ON monitored(current_live_session_id) WHERE current_live_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_monitored_handle_enabled ON monitored(handle, enabled) WHERE enabled = true;

-- ============================================================================
-- LIVE SESSIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS live_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    handle VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended', 'connection_failed')),
    room_id BIGINT,
    stats JSONB NOT NULL DEFAULT '{}',
    FOREIGN KEY (handle) REFERENCES tiktok_accounts(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_live_sessions_handle_status ON live_sessions(handle, status, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_live_sessions_start_time ON live_sessions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions(status) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_live_sessions_handle_start ON live_sessions(handle, start_time DESC);

-- ============================================================================
-- EVENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    user_data JSONB,
    event_data JSONB,
    location JSONB,
    FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_session_type_time ON events(session_id, type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_id, timestamp DESC);

-- GIN indexes for JSONB columns to improve search performance
CREATE INDEX IF NOT EXISTS idx_events_user_data_gin ON events USING GIN (user_data);
CREATE INDEX IF NOT EXISTS idx_events_event_data_gin ON events USING GIN (event_data);

-- Functional index for case-insensitive username search (for autocomplete)
CREATE INDEX IF NOT EXISTS idx_events_user_uniqueid_lower ON events (LOWER(user_data->>'uniqueId')) WHERE type = 'chat' AND user_data->>'uniqueId' IS NOT NULL;

-- ============================================================================
-- STATS HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS stats_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    stats JSONB NOT NULL,
    FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stats_history_session_time ON stats_history(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_stats_history_timestamp ON stats_history(timestamp DESC);

-- ============================================================================
-- ALERTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    handle VARCHAR(255) NOT NULL,
    session_id UUID,
    event_id UUID,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(50) NOT NULL CHECK (severity IN ('LOW', 'MED', 'MEDIUM', 'HIGH')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'new', 'acknowledged', 'resolved')),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (handle) REFERENCES tiktok_accounts(handle) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_handle_status ON alerts(handle, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_session_id ON alerts(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

-- ============================================================================
-- TRIGGER WORDS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS trigger_words (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    word VARCHAR(255) NOT NULL,
    case_sensitive BOOLEAN DEFAULT FALSE, -- Kept for compatibility, always false (case-insensitive)
    severity VARCHAR(50) NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MED', 'MEDIUM', 'HIGH')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trigger_words_word ON trigger_words(word);

-- Unique constraint to prevent duplicate trigger words (case-insensitive)
-- Note: case_sensitive is ignored, all words are stored in lowercase and matched case-insensitively
CREATE UNIQUE INDEX IF NOT EXISTS idx_trigger_words_unique 
ON trigger_words(LOWER(word));

-- ============================================================================
-- ANTI-BLOCKING SETTINGS TABLE (Singleton)
-- ============================================================================
CREATE TABLE IF NOT EXISTS anti_blocking_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings JSONB NOT NULL DEFAULT '{}'
);

-- Insert default row if it doesn't exist
INSERT INTO anti_blocking_settings (id, settings) 
VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TIKTOK BLOCKS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS tiktok_blocks (
    handle VARCHAR(255) PRIMARY KEY,
    active_blocks JSONB DEFAULT '{}',
    block_history JSONB DEFAULT '{}',
    dismissed_warnings JSONB DEFAULT '{}',
    FOREIGN KEY (handle) REFERENCES tiktok_accounts(handle) ON DELETE CASCADE
);

-- ============================================================================
-- ACCOUNT HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS account_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    handle VARCHAR(255) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    field VARCHAR(255) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    source VARCHAR(50) DEFAULT 'sync',
    FOREIGN KEY (handle) REFERENCES tiktok_accounts(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_history_handle_time ON account_history(handle, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_account_history_timestamp ON account_history(timestamp DESC);

-- ============================================================================
-- CONSOLE LOGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS console_logs (
    id VARCHAR(255) PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    level VARCHAR(50) NOT NULL CHECK (level IN ('info', 'warn', 'error', 'debug')),
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_console_logs_timestamp ON console_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_console_logs_level ON console_logs(level);

-- ============================================================================
-- FUNCTIONS FOR AUTOMATIC TIMESTAMPS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for tiktok_accounts
CREATE TRIGGER update_tiktok_accounts_updated_at 
    BEFORE UPDATE ON tiktok_accounts 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
