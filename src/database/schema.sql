-- Users table
CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT PRIMARY KEY,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    birthday DATE,
    joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_banned BOOLEAN DEFAULT FALSE,
    ban_until TIMESTAMP,
    total_messages INTEGER DEFAULT 0,
    total_reactions INTEGER DEFAULT 0,
    total_commands INTEGER DEFAULT 0
);

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    can_delete_messages BOOLEAN DEFAULT FALSE,
    can_ban_users BOOLEAN DEFAULT FALSE,
    can_manage_roles BOOLEAN DEFAULT FALSE,
    can_pin_messages BOOLEAN DEFAULT FALSE,
    can_create_polls BOOLEAN DEFAULT FALSE,
    can_invite_users BOOLEAN DEFAULT FALSE
);

-- User roles mapping
CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT REFERENCES users(user_id),
    role_id INTEGER REFERENCES roles(role_id),
    assigned_by BIGINT REFERENCES users(user_id),
    assigned_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

-- Group settings
CREATE TABLE IF NOT EXISTS group_settings (
    chat_id BIGINT PRIMARY KEY,
    welcome_message TEXT,
    rules TEXT,
    spam_sensitivity INTEGER DEFAULT 5,
    max_warnings INTEGER DEFAULT 3,
    mute_duration INTEGER DEFAULT 60, -- in minutes
    ban_duration INTEGER DEFAULT 1440, -- in minutes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    message_id BIGINT,
    chat_id BIGINT,
    user_id BIGINT REFERENCES users(user_id),
    message_type VARCHAR(50),
    content TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, chat_id)
);

-- Message logs for analytics
CREATE TABLE IF NOT EXISTS message_logs (
    log_id SERIAL PRIMARY KEY,
    message_id BIGINT,
    chat_id BIGINT,
    user_id BIGINT REFERENCES users(user_id),
    message_type VARCHAR(50),
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User activity logs
CREATE TABLE IF NOT EXISTS user_activity (
    activity_id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    activity_type VARCHAR(50),
    activity_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Infractions (warnings, mutes, bans)
CREATE TABLE IF NOT EXISTS infractions (
    infraction_id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    type VARCHAR(50), -- WARN, MUTE, BAN
    reason TEXT,
    action VARCHAR(50),
    duration VARCHAR(50),
    issued_by BIGINT REFERENCES users(user_id),
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- Polls
CREATE TABLE IF NOT EXISTS polls (
    poll_id SERIAL PRIMARY KEY,
    message_id BIGINT,
    chat_id BIGINT,
    question TEXT,
    options TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    created_by BIGINT REFERENCES users(user_id)
);

-- Poll votes
CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id INTEGER REFERENCES polls(poll_id),
    user_id BIGINT REFERENCES users(user_id),
    option_index INTEGER,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (poll_id, user_id)
);

-- Events
CREATE TABLE IF NOT EXISTS events (
    event_id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    location VARCHAR(255),
    max_participants INTEGER,
    created_by BIGINT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Event participants
CREATE TABLE IF NOT EXISTS event_participants (
    event_id INTEGER REFERENCES events(event_id),
    user_id BIGINT REFERENCES users(user_id),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, user_id)
);

-- Feedback
CREATE TABLE IF NOT EXISTS feedback (
    feedback_id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    content TEXT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'PENDING' -- PENDING, REVIEWED, RESOLVED
);

-- Muted users
CREATE TABLE IF NOT EXISTS muted_users (
    mute_id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    chat_id BIGINT,
    muted_until TIMESTAMP,
    muted_by BIGINT REFERENCES users(user_id),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Activity stats table
CREATE TABLE IF NOT EXISTS activity_stats (
    stat_id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    date DATE NOT NULL,
    messages_sent INTEGER DEFAULT 0,
    reactions_added INTEGER DEFAULT 0,
    commands_used INTEGER DEFAULT 0,
    UNIQUE(user_id, date)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_user_id ON message_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_chat_id ON message_logs(chat_id);
CREATE INDEX IF NOT EXISTS idx_infractions_user_id ON infractions(user_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_event_id ON event_participants(event_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_muted_users_user_id ON muted_users(user_id);
CREATE INDEX IF NOT EXISTS idx_muted_users_chat_id ON muted_users(chat_id);
CREATE INDEX IF NOT EXISTS idx_activity_stats_user_date ON activity_stats(user_id, date);

-- Add triggers for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_group_settings_updated_at
    BEFORE UPDATE ON group_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();