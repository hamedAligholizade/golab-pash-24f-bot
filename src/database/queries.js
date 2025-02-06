const { pool } = require('./init');
const { logger } = require('../utils/logger');

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
const banUser = async (userId, reason, duration, issuedBy) => {
    try {
        // Convert duration to integer
        const durationInt = duration ? parseInt(duration) : null;
        const banUntil = durationInt ? new Date(Date.now() + (durationInt * 60 * 1000)) : null;
        
        // Update user's ban status
        const userQuery = `
            UPDATE users 
            SET is_banned = true,
                ban_until = $2
            WHERE user_id = $1
            RETURNING *;
        `;
        await pool.query(userQuery, [userId, banUntil]);

        // Log the infraction
        return await logInfraction(userId, 'BAN', reason, 'BAN', durationInt, issuedBy);
    } catch (error) {
        logger.error('Error banning user:', {
            error: error.message,
            userId
        });
        throw error;
    }
};

const unbanUser = async (userId) => {
    try {
        const query = `
            UPDATE users 
            SET is_banned = false,
                ban_until = null
            WHERE user_id = $1
            RETURNING *;
        `;
        const result = await pool.query(query, [userId]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error unbanning user:', {
            error: error.message,
            userId
        });
        throw error;
    }
};

const getBannedUsers = async () => {
    try {
        const query = `
            SELECT u.*, i.created_at as ban_start, i.duration as ban_duration
            FROM users u
            JOIN infractions i ON u.user_id = i.user_id
            WHERE u.is_banned = true 
            AND i.type = 'BAN'
            AND i.expires_at <= NOW()
            AND NOT EXISTS (
                SELECT 1 FROM infractions i2
                WHERE i2.user_id = i.user_id
                AND i2.type = 'BAN'
                AND i2.expires_at > NOW()
            )
            ORDER BY i.created_at DESC;
        `;
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        logger.error('Error getting banned users:', {
            error: error.message
        });
        throw error;
    }
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
    try {
        // Validate message type
        const validTypes = ['TEXT', 'PHOTO', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'ANIMATION'];
        if (!validTypes.includes(messageType.toUpperCase())) {
            throw new Error('Invalid message type. Must be one of: ' + validTypes.join(', '));
        }

        const query = `
            INSERT INTO message_logs (message_id, user_id, chat_id, message_type, content)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const result = await pool.query(query, [messageId, userId, chatId, messageType.toUpperCase(), content]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error logging message:', {
            error: error.message,
            messageId,
            userId,
            chatId,
            messageType
        });
        throw error;
    }
};

const deleteMessage = async (messageId, deletedBy) => {
    try {
        const query = `
            UPDATE message_logs 
            SET is_deleted = true,
                deleted_by = $2,
                deleted_at = CURRENT_TIMESTAMP
            WHERE message_id = $1
            AND is_deleted = false
            RETURNING *;
        `;
        const result = await pool.query(query, [messageId, deletedBy]);
        
        if (!result.rows[0]) {
            throw new Error('Message not found or already deleted');
        }
        
        return result.rows[0];
    } catch (error) {
        logger.error('Error deleting message:', {
            error: error.message,
            messageId,
            deletedBy
        });
        throw error;
    }
};

// Infractions
const logInfraction = async (userId, type, reason, action, duration, issuedBy) => {
    try {
        // Convert duration to integer if provided
        const durationInt = duration ? parseInt(duration) : null;
        
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
                    THEN NOW() + ($5 * interval '1 minute')
                    ELSE NULL 
                END
            )
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, type, reason, action, durationInt, issuedBy]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error logging infraction:', {
            error: error.message,
            userId,
            type,
            action,
            duration
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
    const query = `
        SELECT * FROM group_settings 
        WHERE chat_id = $1;
    `;
    const result = await pool.query(query, [chatId]);
    return result.rows[0];
};

const updateGroupSettings = async (chatId, settings) => {
    try {
        // Validate and convert numeric settings
        const spamSensitivity = settings.spamSensitivity ? parseInt(settings.spamSensitivity) : 5;
        const maxWarnings = settings.maxWarnings ? parseInt(settings.maxWarnings) : 3;
        const muteDuration = settings.muteDuration ? parseInt(settings.muteDuration) : 60;
        const banDuration = settings.banDuration ? parseInt(settings.banDuration) : 1440;

        // Validate ranges
        if (spamSensitivity < 1 || spamSensitivity > 10) {
            throw new Error('Spam sensitivity must be between 1 and 10');
        }
        if (maxWarnings < 1) {
            throw new Error('Max warnings must be at least 1');
        }
        if (muteDuration < 1) {
            throw new Error('Mute duration must be at least 1 minute');
        }
        if (banDuration < 1) {
            throw new Error('Ban duration must be at least 1 minute');
        }

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
            spamSensitivity,
            maxWarnings,
            muteDuration,
            banDuration
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
        // Validate severity
        const severityInt = parseInt(severity);
        if (isNaN(severityInt) || severityInt < 1 || severityInt > 5) {
            throw new Error('Severity must be a number between 1 and 5');
        }

        // Validate content type
        const validTypes = ['WORD', 'PHRASE', 'REGEX', 'LINK'];
        if (!validTypes.includes(contentType.toUpperCase())) {
            throw new Error('Invalid content type. Must be one of: ' + validTypes.join(', '));
        }

        const query = `
            INSERT INTO banned_content (content, content_type, severity, added_by)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const result = await pool.query(query, [content, contentType.toUpperCase(), severityInt, addedBy]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error adding banned content:', {
            error: error.message,
            content,
            contentType,
            severity,
            addedBy
        });
        throw error;
    }
};

const getBannedContent = async () => {
    const query = 'SELECT * FROM banned_content ORDER BY severity DESC;';
    const result = await pool.query(query);
    return result.rows;
};

// Custom Commands
const addCustomCommand = async (command, response, createdBy) => {
    try {
        // Validate command format
        if (!command.startsWith('/')) {
            throw new Error('Custom commands must start with /');
        }
        if (command.length < 2) {
            throw new Error('Command must be at least 2 characters long');
        }
        if (!response || response.trim().length === 0) {
            throw new Error('Response cannot be empty');
        }

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
        const result = await pool.query(query, [command.toLowerCase(), response, createdBy]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error adding custom command:', {
            error: error.message,
            command,
            createdBy
        });
        throw error;
    }
};

const getCustomCommand = async (command) => {
    const query = 'SELECT * FROM custom_commands WHERE command = $1 AND is_active = true;';
    const result = await pool.query(query, [command]);
    return result.rows[0];
};

// Activity Tracking
const updateUserActivity = async (userId, type) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const query = `
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
        const result = await pool.query(query, [userId, today, type]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error updating user activity:', error);
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
                COALESCE(SUM(a.messages_sent), 0) as total_messages,
                COALESCE(SUM(a.reactions_added), 0) as total_reactions,
                COALESCE(SUM(a.commands_used), 0) as total_commands
            FROM users u
            LEFT JOIN activity_stats a ON u.user_id = a.user_id
            GROUP BY u.user_id, u.username, u.first_name, u.last_name
            HAVING COALESCE(SUM(a.messages_sent), 0) > 0
            ORDER BY total_messages DESC
            LIMIT $1;
        `;
        const result = await pool.query(query, [limit]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting top users:', {
            error: error.message,
            limit
        });
        throw error;
    }
};

const getActiveUsers = async (days = 7) => {
    try {
        const query = `
            SELECT DISTINCT 
                u.*, 
                COALESCE(SUM(a.messages_sent), 0) as messages_in_period,
                COALESCE(SUM(a.reactions_added), 0) as reactions_in_period,
                COALESCE(SUM(a.commands_used), 0) as commands_in_period,
                MAX(a.date) as last_active_date
            FROM users u
            JOIN activity_stats a ON u.user_id = a.user_id
            WHERE a.date >= CURRENT_DATE - ($1 || ' days')::interval
            GROUP BY u.user_id, u.username, u.first_name, u.last_name
            HAVING COALESCE(SUM(a.messages_sent), 0) > 0
            ORDER BY last_active_date DESC;
        `;
        const result = await pool.query(query, [days]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting active users:', {
            error: error.message,
            days
        });
        throw error;
    }
};

// User Stats
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
        logger.error('Error calculating user stats:', {
            error: error.message,
            userId
        });
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
        logger.error('Error getting user achievements:', {
            error: error.message,
            userId
        });
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
        logger.error('Error awarding achievement:', {
            error: error.message,
            userId,
            achievementId
        });
        throw error;
    }
};

const getUserChats = async (userId) => {
    try {
        const query = `
            SELECT DISTINCT 
                m.chat_id,
                COUNT(*) as message_count,
                MAX(m.created_at) as last_message_at
            FROM message_logs m
            WHERE m.user_id = $1
            AND NOT m.is_deleted
            GROUP BY m.chat_id
            ORDER BY last_message_at DESC;
        `;
        const result = await pool.query(query, [userId]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting user chats:', {
            error: error.message,
            userId
        });
        throw error;
    }
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

const updateEventParticipation = async (eventId, userId) => {
    try {
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

// Feedback
const submitFeedback = async (userId, content) => {
    try {
        const query = `
            INSERT INTO feedback (user_id, content)
            VALUES ($1, $2)
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, content]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error submitting feedback:', {
            error: error.message,
            userId
        });
        throw error;
    }
};

const updateFeedbackStatus = async (feedbackId, status, reviewedBy) => {
    try {
        const query = `
            UPDATE feedback
            SET status = $2,
                reviewed_by = $3,
                reviewed_at = CURRENT_TIMESTAMP
            WHERE feedback_id = $1
            RETURNING *;
        `;
        const result = await pool.query(query, [feedbackId, status, reviewedBy]);
        return result.rows[0];
    } catch (error) {
        logger.error('Error updating feedback status:', {
            error: error.message,
            feedbackId,
            status
        });
        throw error;
    }
};

const getExpiredRestrictions = async () => {
    try {
        const query = `
            SELECT DISTINCT 
                i.user_id, 
                i.type, 
                i.duration, 
                i.created_at, 
                i.expires_at,
                u.username, 
                u.first_name, 
                u.last_name,
                m.chat_id
            FROM infractions i
            JOIN users u ON i.user_id = u.user_id
            JOIN message_logs m ON i.user_id = m.user_id
            WHERE i.type IN ('BAN', 'MUTE')
            AND i.expires_at <= NOW()
            AND NOT EXISTS (
                SELECT 1 FROM infractions i2
                WHERE i2.user_id = i.user_id
                AND i2.type = i.type
                AND i2.expires_at > NOW()
            )
            ORDER BY i.created_at DESC;
        `;
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        logger.error('Error getting expired restrictions:', {
            error: error.message
        });
        throw error;
    }
};

const removeRestriction = async (userId, type) => {
    try {
        let query;
        let params;
        if (type === 'BAN') {
            query = `
                UPDATE users 
                SET is_banned = false, 
                    ban_until = null
                WHERE user_id = $1
                RETURNING *;
            `;
            params = [userId];
        } else if (type === 'MUTE') {
            query = `
                INSERT INTO infractions (user_id, type, reason, action, duration, issued_by)
                VALUES ($1, $2, 'Restriction expired automatically', 'UNMUTE', 0, NULL)
                RETURNING *;
            `;
            params = [userId, type];
        } else {
            throw new Error('Invalid restriction type');
        }
        
        const result = await pool.query(query, params);
        return result.rows[0];
    } catch (error) {
        logger.error('Error removing restriction:', {
            error: error.message,
            userId,
            type
        });
        throw error;
    }
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

// Ban Management
const getExpiredBans = async () => {
    try {
        const query = `
            SELECT DISTINCT u.user_id, m.chat_id
            FROM users u
            JOIN infractions i ON u.user_id = i.user_id
            JOIN message_logs m ON u.user_id = m.user_id
            WHERE u.is_banned = true
            AND i.type = 'BAN'
            AND i.expires_at <= NOW()
            AND NOT EXISTS (
                SELECT 1 FROM infractions i2
                WHERE i2.user_id = i.user_id
                AND i2.type = 'BAN'
                AND i2.expires_at > NOW()
            )
            GROUP BY u.user_id, m.chat_id
            ORDER BY u.user_id;
        `;
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        logger.error('Error getting expired bans:', {
            error: error.message
        });
        throw error;
    }
};

// Mute Management
const getExpiredMutes = async () => {
    try {
        const query = `
            SELECT 
                mu.user_id,
                mu.chat_id,
                mu.muted_until,
                mu.reason,
                mu.muted_by,
                u.username,
                u.first_name,
                u.last_name,
                mb.username as muted_by_username,
                mb.first_name as muted_by_first_name
            FROM muted_users mu
            JOIN users u ON mu.user_id = u.user_id
            LEFT JOIN users mb ON mu.muted_by = mb.user_id
            WHERE mu.muted_until <= NOW()
            AND NOT EXISTS (
                -- Check if there's no newer mute that's still active
                SELECT 1 FROM muted_users mu2
                WHERE mu2.user_id = mu.user_id
                AND mu2.chat_id = mu.chat_id
                AND mu2.muted_until > NOW()
                AND mu2.created_at > mu.created_at
            )
            ORDER BY mu.muted_until ASC;
        `;
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        logger.error('Error getting expired mutes:', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};

const unmuteMember = async (userId, chatId, unmutedBy = null) => {
    try {
        // Validate parameters
        if (!userId || !chatId) {
            throw new Error('Missing required parameters');
        }

        // Check if user is actually muted
        const muteCheck = await pool.query(
            'SELECT * FROM muted_users WHERE user_id = $1 AND chat_id = $2',
            [userId, chatId]
        );
        
        if (!muteCheck.rows[0]) {
            throw new Error('User is not muted in this chat');
        }

        // Remove from muted_users table
        const query = `
            DELETE FROM muted_users
            WHERE user_id = $1 AND chat_id = $2
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, chatId]);

        // Log the unmute action
        await logInfraction(
            userId,
            'UNMUTE',
            'Manual unmute' + (unmutedBy ? ' by moderator' : ''),
            'UNMUTE',
            0,
            unmutedBy
        );

        return {
            unmuted: result.rows[0],
            previousMute: muteCheck.rows[0]
        };
    } catch (error) {
        logger.error('Error unmuting member:', {
            error: error.message,
            userId,
            chatId,
            unmutedBy
        });
        throw error;
    }
};

// Mute Management
const muteUser = async (userId, chatId, duration, reason, mutedBy) => {
    try {
        // Validate parameters
        if (!userId || !chatId || !duration || !mutedBy) {
            throw new Error('Missing required parameters');
        }

        // Convert and validate duration
        const durationInt = parseInt(duration);
        if (isNaN(durationInt)) {
            throw new Error('Duration must be a valid number');
        }
        if (durationInt <= 0) {
            throw new Error('Duration must be greater than 0');
        }
        if (durationInt > 43200) { // Max 30 days
            throw new Error('Duration cannot exceed 30 days (43200 minutes)');
        }

        const mutedUntil = new Date(Date.now() + (durationInt * 60 * 1000));
        
        // Check if user exists
        const userExists = await pool.query('SELECT 1 FROM users WHERE user_id = $1', [userId]);
        if (!userExists.rows[0]) {
            throw new Error('User not found');
        }

        // Insert into muted_users table
        const muteQuery = `
            INSERT INTO muted_users (user_id, chat_id, muted_until, muted_by, reason)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, chat_id) 
            DO UPDATE SET
                muted_until = EXCLUDED.muted_until,
                reason = EXCLUDED.reason,
                muted_by = EXCLUDED.muted_by,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
        const muteResult = await pool.query(muteQuery, [
            userId, 
            chatId, 
            mutedUntil, 
            mutedBy, 
            reason || 'No reason provided'
        ]);

        // Log the infraction
        const infraction = await logInfraction(
            userId, 
            'MUTE', 
            reason || 'No reason provided', 
            'MUTE', 
            durationInt, 
            mutedBy
        );

        return {
            mute: muteResult.rows[0],
            infraction
        };
    } catch (error) {
        logger.error('Error muting user:', {
            error: error.message,
            userId,
            chatId,
            duration,
            mutedBy
        });
        throw error;
    }
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
    getUserRestrictedChats,
    getExpiredBans,
    getExpiredMutes,
    unmuteMember,
    muteUser
}; 