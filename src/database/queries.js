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
const logInfraction = async (userId, type, reason, action, duration, issuedBy) => {
    try {
        const query = `
            INSERT INTO infractions (
                user_id, 
                type, 
                reason, 
                action, 
                duration, 
                issued_by,
                expires_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6,
                CASE 
                    WHEN $5 IS NOT NULL 
                    THEN NOW() + ($5 || ' minutes')::interval 
                    ELSE NULL 
                END
            )
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, type, reason, action, duration, issuedBy]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error logging infraction:', {
            error: error.message,
            userId,
            type,
            action
        });
        throw error;
    }
};

const getUserInfractions = async (userId) => {
    try {
        const query = `
            SELECT 
                i.*,
                u.username as issued_by_username,
                u.first_name as issued_by_first_name
            FROM infractions i
            LEFT JOIN users u ON i.issued_by = u.user_id
            WHERE i.user_id = $1
            ORDER BY i.issued_at DESC;
        `;
        const result = await pool.query(query, [userId]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting user infractions:', {
            error: error.message,
            userId
        });
        throw error;
    }
};

// Group Settings
const getGroupSettings = async (chatId) => {
    try {
        const query = `
            SELECT * FROM group_settings 
            WHERE chat_id = $1;
        `;
        const result = await pool.query(query, [chatId]);
        
        // If no settings exist, create default settings
        if (!result.rows[0]) {
            const defaultSettings = {
                welcomeMessage: 'Welcome to our group! 👋',
                rules: 'Please be respectful and follow the group rules.',
                spamSensitivity: 5,
                maxWarnings: 3,
                muteDuration: 60,
                banDuration: 1440
            };
            return (await updateGroupSettings(chatId, defaultSettings)).rows[0];
        }
        
        return result.rows[0];
    } catch (error) {
        logger.error('Error getting group settings:', {
            error: error.message,
            chatId
        });
        throw error;
    }
};

const updateGroupSettings = async (chatId, settings) => {
    try {
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
        const result = await pool.query(query, [
            chatId,
            settings.welcomeMessage,
            settings.rules,
            settings.spamSensitivity,
            settings.maxWarnings,
            settings.muteDuration,
            settings.banDuration
        ]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error updating group settings:', {
            error: error.message,
            chatId,
            settings
        });
        throw error;
    }
};

// Content Moderation
const addBannedContent = async (content, contentType, severity, addedBy) => {
    try {
        const query = `
            INSERT INTO banned_content (content, content_type, severity, added_by)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const result = await pool.query(query, [content, contentType, severity, addedBy]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error adding banned content:', error);
        throw error;
    }
};

const getBannedContent = async () => {
    try {
        const query = `
            SELECT * FROM banned_content 
            WHERE is_active = true 
            ORDER BY severity DESC, created_at DESC;
        `;
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        logger.error('Error getting banned content:', error);
        throw error;
    }
};

// Custom Commands
const addCustomCommand = async (command, response, createdBy) => {
    try {
        const query = `
            INSERT INTO custom_commands (command, response, created_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (command) 
            DO UPDATE SET
                response = EXCLUDED.response,
                created_by = EXCLUDED.created_by,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
        const result = await pool.query(query, [command, response, createdBy]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error adding custom command:', error);
        throw error;
    }
};

const getCustomCommand = async (command) => {
    try {
        const query = `
            SELECT * FROM custom_commands 
            WHERE command = $1 AND is_active = true;
        `;
        const result = await pool.query(query, [command]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error getting custom command:', error);
        throw error;
    }
};

// Activity Tracking
const updateUserActivity = async (userId, type) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // First, insert activity into user_activity table for detailed logging
        const activityQuery = `
            INSERT INTO user_activity (user_id, activity_type, activity_data)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        
        const activityData = {
            timestamp: new Date(),
            type: type
        };

        await pool.query(activityQuery, [userId, type, activityData]);

        // Then, update activity_stats for aggregated statistics
        const statsQuery = `
            INSERT INTO activity_stats (user_id, date, messages_sent, reactions_added, commands_used)
            VALUES ($1, $2, 
                CASE WHEN $3 = 'messages_sent' THEN 1 ELSE 0 END,
                CASE WHEN $3 = 'reaction_added' THEN 1 ELSE 0 END,
                CASE WHEN $3 = 'command_used' THEN 1 ELSE 0 END
            )
            ON CONFLICT (user_id, date)
            DO UPDATE SET
                messages_sent = activity_stats.messages_sent + 
                    CASE WHEN $3 = 'messages_sent' THEN 1 ELSE 0 END,
                reactions_added = activity_stats.reactions_added + 
                    CASE WHEN $3 = 'reaction_added' THEN 1 ELSE 0 END,
                commands_used = activity_stats.commands_used + 
                    CASE WHEN $3 = 'command_used' THEN 1 ELSE 0 END
            RETURNING *;
        `;
        
        const result = await pool.query(statsQuery, [userId, today, type]);

        // Update user totals
        const updateUserQuery = `
            UPDATE users 
            SET total_messages = total_messages + 
                    CASE WHEN $2 = 'messages_sent' THEN 1 ELSE 0 END,
                total_reactions = total_reactions + 
                    CASE WHEN $2 = 'reaction_added' THEN 1 ELSE 0 END,
                total_commands = total_commands + 
                    CASE WHEN $2 = 'command_used' THEN 1 ELSE 0 END
            WHERE user_id = $1
            RETURNING *;
        `;
        
        await pool.query(updateUserQuery, [userId, type]);
        
        return result.rows[0];
    } catch (error) {
        logger.error('Error updating user activity:', {
            error: error.message,
            userId,
            type
        });
        throw error;
    }
};

const getTopUsers = async (limit = 10) => {
    try {
        const query = `
            SELECT 
                u.user_id,
                u.username,
                u.first_name,
                u.last_name,
                u.total_messages,
                u.total_reactions,
                u.total_commands
            FROM users u
            WHERE u.total_messages > 0
            ORDER BY u.total_messages DESC
            LIMIT $1;
        `;
        const result = await pool.query(query, [limit]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting top users:', error);
        throw error;
    }
};

const getActiveUsers = async () => {
    try {
        const query = `
            SELECT DISTINCT u.* 
            FROM users u
            JOIN activity_stats a ON u.user_id = a.user_id
            WHERE a.date >= CURRENT_DATE - INTERVAL '7 days'
            AND (a.messages_sent > 0 OR a.reactions_added > 0 OR a.commands_used > 0)
        `;
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        logger.error('Error getting active users:', error);
        throw error;
    }
};

const calculateUserStats = async (userId) => {
    try {
        const query = `
            SELECT 
                SUM(messages_sent) as total_messages,
                COUNT(DISTINCT date) as active_days,
                SUM(reactions_added) as total_reactions,
                SUM(commands_used) as total_commands
            FROM activity_stats
            WHERE user_id = $1
            AND date >= CURRENT_DATE - INTERVAL '30 days'
        `;
        const result = await pool.query(query, [userId]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error calculating user stats:', error);
        throw error;
    }
};

// Achievements
const getAchievements = async () => {
    try {
        const query = 'SELECT * FROM achievements ORDER BY requirement_count ASC;';
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        logger.error('Error getting achievements:', error);
        throw error;
    }
};

const getUserAchievements = async (userId) => {
    try {
        const query = `
            SELECT a.* 
            FROM achievements a
            JOIN user_achievements ua ON a.achievement_id = ua.achievement_id
            WHERE ua.user_id = $1
            ORDER BY ua.awarded_at DESC;
        `;
        const result = await pool.query(query, [userId]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting user achievements:', error);
        throw error;
    }
};

const awardAchievement = async (userId, achievementId) => {
    try {
        const query = `
            INSERT INTO user_achievements (user_id, achievement_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id, achievement_id) DO NOTHING
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, achievementId]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error awarding achievement:', error);
        throw error;
    }
};

// Check for achievements
const checkAndAwardAchievements = async (userId) => {
    try {
        // Get user stats
        const stats = await calculateUserStats(userId);
        
        // Get all achievements user hasn't earned yet
        const query = `
            SELECT a.* 
            FROM achievements a
            WHERE NOT EXISTS (
                SELECT 1 FROM user_achievements ua 
                WHERE ua.achievement_id = a.achievement_id 
                AND ua.user_id = $1
            );
        `;
        const result = await pool.query(query, [userId]);
        const unearned = result.rows;

        // Check each achievement
        for (const achievement of unearned) {
            let earned = false;
            switch (achievement.requirement_type) {
                case 'MESSAGES':
                    earned = stats.total_messages >= achievement.requirement_count;
                    break;
                case 'REACTIONS':
                    earned = stats.total_reactions >= achievement.requirement_count;
                    break;
                case 'COMMANDS':
                    earned = stats.total_commands >= achievement.requirement_count;
                    break;
                case 'DAYS_ACTIVE':
                    earned = stats.active_days >= achievement.requirement_count;
                    break;
            }

            if (earned) {
                await awardAchievement(userId, achievement.achievement_id);
            }
        }
    } catch (error) {
        logger.error('Error checking achievements:', error);
        throw error;
    }
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
const createEvent = async (title, description, startTime, endTime, location, maxParticipants, createdBy) => {
    try {
        const query = `
            INSERT INTO events (
                title, 
                description, 
                start_time, 
                end_time, 
                location,
                max_participants,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `;
        const result = await pool.query(query, [
            title, 
            description, 
            startTime, 
            endTime, 
            location,
            maxParticipants,
            createdBy
        ]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error creating event:', {
            error: error.message,
            title,
            createdBy
        });
        throw error;
    }
};

const getEvent = async (eventId) => {
    try {
        const query = `
            SELECT 
                e.*,
                u.username as creator_username,
                u.first_name as creator_first_name,
                COUNT(ep.user_id) as participant_count
            FROM events e
            LEFT JOIN users u ON e.created_by = u.user_id
            LEFT JOIN event_participants ep ON e.event_id = ep.event_id
            WHERE e.event_id = $1
            GROUP BY e.event_id, u.user_id;
        `;
        const result = await pool.query(query, [eventId]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error getting event:', {
            error: error.message,
            eventId
        });
        throw error;
    }
};

const updateEventParticipation = async (eventId, userId) => {
    try {
        // First check if the event is full
        const event = await getEvent(eventId);
        if (event.max_participants && event.participant_count >= event.max_participants) {
            throw new Error('Event is full');
        }

        const query = `
            INSERT INTO event_participants (event_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (event_id, user_id) DO NOTHING
            RETURNING *;
        `;
        const result = await pool.query(query, [eventId, userId]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error updating event participation:', {
            error: error.message,
            eventId,
            userId
        });
        throw error;
    }
};

const removeEventParticipation = async (eventId, userId) => {
    try {
        const query = `
            DELETE FROM event_participants
            WHERE event_id = $1 AND user_id = $2
            RETURNING *;
        `;
        const result = await pool.query(query, [eventId, userId]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error removing event participation:', {
            error: error.message,
            eventId,
            userId
        });
        throw error;
    }
};

const getUpcomingEvents = async (limit = 5) => {
    try {
        const query = `
            SELECT 
                e.*,
                u.username as creator_username,
                u.first_name as creator_first_name,
                COUNT(ep.user_id) as participant_count
            FROM events e
            LEFT JOIN users u ON e.created_by = u.user_id
            LEFT JOIN event_participants ep ON e.event_id = ep.event_id
            WHERE e.start_time > NOW()
            GROUP BY e.event_id, u.user_id
            ORDER BY e.start_time ASC
            LIMIT $1;
        `;
        const result = await pool.query(query, [limit]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting upcoming events:', error);
        throw error;
    }
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
        AND i.created_at + i.duration <= NOW()
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
    getEvent,
    updateEventParticipation,
    removeEventParticipation,
    getUpcomingEvents,
    // Feedback
    submitFeedback,
    updateFeedbackStatus,
    getExpiredRestrictions,
    removeRestriction,
    getUserRestrictedChats,
    // Achievements
    getAchievements,
    checkAndAwardAchievements
}; 