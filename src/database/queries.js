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
    // Message Logging
    logMessage,
    deleteMessage,
    // Infractions
    logInfraction,
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
    // Events
    createEvent,
    updateEventParticipation,
    // Feedback
    submitFeedback,
    updateFeedbackStatus
}; 