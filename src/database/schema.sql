-- Users table to store member information
CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT PRIMARY KEY,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    ban_until TIMESTAMP,
    warnings INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    last_active TIMESTAMP,
    birthday DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Roles table for user role management
CREATE TABLE IF NOT EXISTS roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    can_delete_messages BOOLEAN DEFAULT FALSE,
    can_ban_users BOOLEAN DEFAULT FALSE,
    can_manage_roles BOOLEAN DEFAULT FALSE,
    can_pin_messages BOOLEAN DEFAULT FALSE,
    can_create_polls BOOLEAN DEFAULT FALSE,
    can_invite_users BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User roles mapping
CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT REFERENCES users(user_id),
    role_id INTEGER REFERENCES roles(role_id),
    assigned_by BIGINT REFERENCES users(user_id),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

-- Message logs for tracking and statistics
CREATE TABLE IF NOT EXISTS message_logs (
    message_id BIGINT PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    chat_id BIGINT,
    message_type VARCHAR(50),
    content TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_by BIGINT REFERENCES users(user_id),
    deleted_at TIMESTAMP
);

-- Banned words/phrases
CREATE TABLE IF NOT EXISTS banned_content (
    content_id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    content_type VARCHAR(50), -- 'WORD', 'PHRASE', 'REGEX', 'LINK'
    severity INTEGER DEFAULT 1,
    added_by BIGINT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User infractions log
CREATE TABLE IF NOT EXISTS infractions (
    infraction_id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    type VARCHAR(50), -- 'SPAM', 'BANNED_WORD', 'MANUAL', etc.
    description TEXT,
    action_taken VARCHAR(50), -- 'WARN', 'MUTE', 'BAN', etc.
    duration INTERVAL,
    enforced_by BIGINT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Custom commands
CREATE TABLE IF NOT EXISTS custom_commands (
    command_id SERIAL PRIMARY KEY,
    command VARCHAR(50) UNIQUE NOT NULL,
    response TEXT NOT NULL,
    created_by BIGINT REFERENCES users(user_id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Group settings
CREATE TABLE IF NOT EXISTS group_settings (
    chat_id BIGINT PRIMARY KEY,
    welcome_message TEXT,
    rules TEXT,
    spam_sensitivity INTEGER DEFAULT 5,
    max_warnings INTEGER DEFAULT 3,
    mute_duration INTERVAL DEFAULT '1 hour',
    ban_duration INTERVAL DEFAULT '1 day',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Events
CREATE TABLE IF NOT EXISTS events (
    event_id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    created_by BIGINT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Event participants
CREATE TABLE IF NOT EXISTS event_participants (
    event_id INTEGER REFERENCES events(event_id),
    user_id BIGINT REFERENCES users(user_id),
    status VARCHAR(50), -- 'GOING', 'MAYBE', 'NOT_GOING'
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, user_id)
);

-- User feedback
CREATE TABLE IF NOT EXISTS feedback (
    feedback_id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    content TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING', -- 'PENDING', 'REVIEWED', 'IMPLEMENTED'
    reviewed_by BIGINT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Activity stats
CREATE TABLE IF NOT EXISTS activity_stats (
    stat_id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    date DATE NOT NULL,
    messages_sent INTEGER DEFAULT 0,
    reactions_added INTEGER DEFAULT 0,
    commands_used INTEGER DEFAULT 0,
    UNIQUE (user_id, date)
);

-- User achievements
CREATE TABLE IF NOT EXISTS user_achievements (
    user_id BIGINT REFERENCES users(user_id),
    achievement_id VARCHAR(50) NOT NULL,
    awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, achievement_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_message_logs_user_id ON message_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_chat_id ON message_logs(chat_id);
CREATE INDEX IF NOT EXISTS idx_infractions_user_id ON infractions(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_stats_user_date ON activity_stats(user_id, date); 