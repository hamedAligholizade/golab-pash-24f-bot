const { pool } = require('./init');

// User Management
const saveUser = async (userId, username, firstName, lastName, joinedDate = new Date()) => {
    const query = `
        INSERT INTO users (user_id, username, first_name, last_name, joined_date)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name
        RETURNING *;
    `;
    const result = await pool.query(query, [userId, username, firstName, lastName, joinedDate]);
    return result.rows[0];
};

const getUserById = async (userId) => {
    const query = 'SELECT * FROM users WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0];
};

// Role Management
const assignRole = async (userId, roleName, assignedBy) => {
    const roleQuery = 'SELECT role_id FROM roles WHERE role_name = $1';
    const roleResult = await pool.query(roleQuery, [roleName]);
    if (!roleResult.rows[0]) throw new Error('Role not found');

    const query = `
        INSERT INTO user_roles (user_id, role_id, assigned_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, role_id) DO NOTHING
        RETURNING *;
    `;
    return pool.query(query, [userId, roleResult.rows[0].role_id, assignedBy]);
};

const getUserRoles = async (userId) => {
    const query = `
        SELECT r.* FROM roles r
        JOIN user_roles ur ON r.role_id = ur.role_id
        WHERE ur.user_id = $1;
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
};

// Ban Management
const banUser = async (userId, reason, duration, bannedBy) => {
    const banUntil = duration ? new Date(Date.now() + duration) : null;
    const query = `
        UPDATE users 
        SET is_banned = true, 
            ban_reason = $2,
            ban_until = $3
        WHERE user_id = $1
        RETURNING *;
    `;
    const result = await pool.query(query, [userId, reason, banUntil]);
    
    // Log the infraction
    await logInfraction(userId, 'BAN', reason, 'BAN', duration, bannedBy);
    
    return result.rows[0];
};

const unbanUser = async (userId) => {
    const query = `
        UPDATE users 
        SET is_banned = false, 
            ban_reason = null,
            ban_until = null
        WHERE user_id = $1
        RETURNING *;
    `;
    return pool.query(query, [userId]);
};

const getBannedUsers = async () => {
    const query = `
        SELECT u.*, i.created_at as ban_start, i.duration as ban_duration
        FROM users u
        JOIN infractions i ON u.user_id = i.user_id
        WHERE u.is_banned = true 
        AND i.type = 'BAN'
        AND i.created_at + (i.duration || ' seconds')::interval <= NOW()
        AND NOT EXISTS (
            SELECT 1 FROM infractions i2
            WHERE i2.user_id = i.user_id
            AND i2.type = 'BAN'
            AND i2.created_at > i.created_at
        );
    `;
    const result = await pool.query(query);
    return result.rows;
};

const getUserBannedChats = async (userId) => {
    const query = `
        SELECT DISTINCT chat_id 
        FROM message_logs 
        WHERE user_id = $1
        AND chat_id IN (
            SELECT chat_id 
            FROM infractions 
            WHERE user_id = $1 
            AND type = 'BAN' 
            AND created_at >= NOW() - INTERVAL '30 days'
        )
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
};

// Message Logging
const logMessage = async (messageId, userId, chatId, messageType, content) => {
    const query = `
        INSERT INTO message_logs (message_id, user_id, chat_id, message_type, content)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
    `;
    return pool.query(query, [messageId, userId, chatId, messageType, content]);
};

const deleteMessage = async (messageId, deletedBy) => {
    const query = `
        UPDATE message_logs 
        SET is_deleted = true,
            deleted_by = $2,
            deleted_at = CURRENT_TIMESTAMP
        WHERE message_id = $1
        RETURNING *;
    `;
    return pool.query(query, [messageId, deletedBy]);
};

// Infractions
const logInfraction = async (userId, type, description, actionTaken, duration, enforcedBy) => {
    const query = `
        INSERT INTO infractions (user_id, type, description, action_taken, duration, enforced_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
    `;
    return pool.query(query, [userId, type, description, actionTaken, duration, enforcedBy]);
};

const getUserInfractions = async (userId) => {
    const query = `
        SELECT * FROM infractions
        WHERE user_id = $1
        ORDER BY created_at DESC;
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
};

// Group Settings
const getGroupSettings = async (chatId) => {
    const query = `
        SELECT * FROM group_settings 
        WHERE chat_id = $1;
    `;
    const result = await pool.query(query, [chatId]);
    return result.rows[0];
};

const updateGroupSettings = async (chatId, settings) => {
    const query = `
        INSERT INTO group_settings (
            chat_id, 
            welcome_message, 
            rules,
            spam_sensitivity,
            max_warnings,
            mute_duration,
            ban_duration
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (chat_id) 
        DO UPDATE SET
            welcome_message = EXCLUDED.welcome_message,
            rules = EXCLUDED.rules,
            spam_sensitivity = EXCLUDED.spam_sensitivity,
            max_warnings = EXCLUDED.max_warnings,
            mute_duration = EXCLUDED.mute_duration,
            ban_duration = EXCLUDED.ban_duration,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *;
    `;
    return pool.query(query, [
        chatId,
        settings.welcomeMessage,
        settings.rules,
        settings.spamSensitivity,
        settings.maxWarnings,
        settings.muteDuration,
        settings.banDuration
    ]);
};

// Content Moderation
const addBannedContent = async (content, contentType, severity, addedBy) => {
    const query = `
        INSERT INTO banned_content (content, content_type, severity, added_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
    `;
    return pool.query(query, [content, contentType, severity, addedBy]);
};

const getBannedContent = async () => {
    const query = 'SELECT * FROM banned_content ORDER BY severity DESC;';
    const result = await pool.query(query);
    return result.rows;
};

// Custom Commands
const addCustomCommand = async (command, response, createdBy) => {
    const query = `
        INSERT INTO custom_commands (command, response, created_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (command) 
        DO UPDATE SET
            response = EXCLUDED.response,
            created_by = EXCLUDED.created_by
        RETURNING *;
    `;
    return pool.query(query, [command, response, createdBy]);
};

const getCustomCommand = async (command) => {
    const query = 'SELECT * FROM custom_commands WHERE command = $1 AND is_active = true;';
    const result = await pool.query(query, [command]);
    return result.rows[0];
};

// Activity Tracking
const updateUserActivity = async (userId, type) => {
    const today = new Date().toISOString().split('T')[0];
    const query = `
        INSERT INTO activity_stats (user_id, date, ${type})
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, date)
        DO UPDATE SET
            ${type} = activity_stats.${type} + 1
        RETURNING *;
    `;
    return pool.query(query, [userId, today]);
};

const getTopUsers = async (limit = 10) => {
    const query = `
        SELECT u.user_id, u.username, u.first_name, u.last_name,
               SUM(a.messages_sent) as total_messages,
               SUM(a.reactions_added) as total_reactions,
               SUM(a.commands_used) as total_commands
        FROM users u
        JOIN activity_stats a ON u.user_id = a.user_id
        GROUP BY u.user_id, u.username, u.first_name, u.last_name
        ORDER BY total_messages DESC
        LIMIT $1;
    `;
    const result = await pool.query(query, [limit]);
    return result.rows;
};

const getActiveUsers = async () => {
    const query = `
        SELECT DISTINCT u.* 
        FROM users u
        JOIN activity_stats a ON u.user_id = a.user_id
        WHERE a.date >= CURRENT_DATE - INTERVAL '7 days'
    `;
    const result = await pool.query(query);
    return result.rows;
};

const calculateUserStats = async (userId) => {
    const query = `
        SELECT 
            COUNT(*) as total_messages,
            COUNT(DISTINCT DATE(date)) as active_days_streak,
            SUM(reactions_added) as total_reactions,
            COUNT(DISTINCT CASE WHEN commands_used > 0 THEN date END) as unique_commands
        FROM activity_stats
        WHERE user_id = $1
        AND date >= CURRENT_DATE - INTERVAL '30 days'
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0];
};

const getUserAchievements = async (userId) => {
    const query = `
        SELECT achievement_id
        FROM user_achievements
        WHERE user_id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows.map(row => row.achievement_id);
};

const awardAchievement = async (userId, achievementId) => {
    const query = `
        INSERT INTO user_achievements (user_id, achievement_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, achievement_id) DO NOTHING
        RETURNING *;
    `;
    return pool.query(query, [userId, achievementId]);
};

const getUserChats = async (userId) => {
    const query = `
        SELECT DISTINCT chat_id
        FROM message_logs
        WHERE user_id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
};

// Events
const createEvent = async (title, description, startTime, endTime, createdBy) => {
    const query = `
        INSERT INTO events (title, description, start_time, end_time, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
    `;
    return pool.query(query, [title, description, startTime, endTime, createdBy]);
};

const updateEventParticipation = async (eventId, userId, status) => {
    const query = `
        INSERT INTO event_participants (event_id, user_id, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (event_id, user_id)
        DO UPDATE SET
            status = EXCLUDED.status,
            registered_at = CURRENT_TIMESTAMP
        RETURNING *;
    `;
    return pool.query(query, [eventId, userId, status]);
};

// Feedback
const submitFeedback = async (userId, content) => {
    const query = `
        INSERT INTO feedback (user_id, content)
        VALUES ($1, $2)
        RETURNING *;
    `;
    return pool.query(query, [userId, content]);
};

const updateFeedbackStatus = async (feedbackId, status, reviewedBy) => {
    const query = `
        UPDATE feedback
        SET status = $2,
            reviewed_by = $3
        WHERE feedback_id = $1
        RETURNING *;
    `;
    return pool.query(query, [feedbackId, status, reviewedBy]);
};

const getExpiredRestrictions = async () => {
    const query = `
        SELECT DISTINCT i.user_id, i.type, i.duration, i.created_at, u.username, u.first_name, u.last_name,
               m.chat_id
        FROM infractions i
        JOIN users u ON i.user_id = u.user_id
        JOIN message_logs m ON i.user_id = m.user_id
        WHERE i.type IN ('BAN', 'MUTE')
        AND i.created_at + (i.duration || ' seconds')::interval <= NOW()
        AND NOT EXISTS (
            SELECT 1 FROM infractions i2
            WHERE i2.user_id = i.user_id
            AND i2.type = i.type
            AND i2.created_at > i.created_at
        )
        ORDER BY i.created_at DESC;
    `;
    const result = await pool.query(query);
    return result.rows;
};

const removeRestriction = async (userId, type) => {
    let query;
    if (type === 'BAN') {
        query = `
            UPDATE users 
            SET is_banned = false, 
                ban_reason = null,
                ban_until = null
            WHERE user_id = $1
            RETURNING *;
        `;
    } else if (type === 'MUTE') {
        // For mute, we just log that it's been removed since the actual unmute happens in Telegram
        query = `
            INSERT INTO infractions (user_id, type, description, action_taken, duration, enforced_by)
            VALUES ($1, $2, 'Restriction expired automatically', 'UNMUTE', 0, NULL)
            RETURNING *;
        `;
    }
    return pool.query(query, [userId]);
};

const getUserRestrictedChats = async (userId, type) => {
    const query = `
        SELECT DISTINCT chat_id 
        FROM message_logs 
        WHERE user_id = $1
        AND chat_id IN (
            SELECT DISTINCT m2.chat_id
            FROM message_logs m2
            JOIN infractions i ON i.user_id = m2.user_id
            WHERE i.user_id = $1 
            AND i.type = $2
            AND i.created_at >= NOW() - INTERVAL '30 days'
        )
    `;
    const result = await pool.query(query, [userId, type]);
    return result.rows;
};

module.exports = {
    // User Management
    saveUser,
    getUserById,
    // Role Management
    assignRole,
    getUserRoles,
    // Ban Management
    banUser,
    unbanUser,
    getBannedUsers,
    getUserBannedChats,
    // Message Logging
    logMessage,
    deleteMessage,
    // Infractions
    logInfraction,
    getUserInfractions,
    // Group Settings
    getGroupSettings,
    updateGroupSettings,
    // Content Moderation
    addBannedContent,
    getBannedContent,
    // Custom Commands
    addCustomCommand,
    getCustomCommand,
    // Activity Tracking
    updateUserActivity,
    getTopUsers,
    getActiveUsers,
    calculateUserStats,
    getUserAchievements,
    awardAchievement,
    getUserChats,
    // Events
    createEvent,
    updateEventParticipation,
    // Feedback
    submitFeedback,
    updateFeedbackStatus,
    getExpiredRestrictions,
    removeRestriction,
    getUserRestrictedChats
}; 