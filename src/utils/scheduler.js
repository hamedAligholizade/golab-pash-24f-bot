const config = require('../config/config');
const queries = require('../database/queries');
const { logger } = require('./logger');

/**
 * Schedule all periodic jobs
 * @param {TelegramBot} bot Telegram bot instance
 */
function scheduleJobs(bot) {
    // Check temporary bans every minute
    setInterval(() => checkTemporaryBans(bot), config.temporaryBanCheckInterval);

    // Update user stats every 5 minutes
    setInterval(() => updateUserStats(bot), config.userStatsUpdateInterval);

    // Send daily summary at specified time
    scheduleDailySummary(bot);

    // Backup data daily
    setInterval(() => backupData(bot), config.backupInterval);

    // Clean old backups weekly
    setInterval(cleanOldBackups, config.backupInterval * 7);

    logger.info('Scheduled jobs initialized');
}

/**
 * Check and unban users whose ban duration has expired
 * @param {TelegramBot} bot Telegram bot instance
 */
async function checkTemporaryBans(bot) {
    try {
        // Get all users with expired restrictions
        const expiredRestrictions = await queries.getExpiredRestrictions();
        
        if (!expiredRestrictions || expiredRestrictions.length === 0) {
            return; // No expired restrictions to process
        }

        logger.info(`Checking ${expiredRestrictions.length} temporary restrictions`);

        for (const restriction of expiredRestrictions) {
            try {
                // Get all chats where the user was restricted
                const restrictedChats = await queries.getUserRestrictedChats(restriction.user_id, restriction.type);
                
                // Remove restrictions from each chat
                for (const chat of restrictedChats) {
                    try {
                        if (restriction.type === 'BAN') {
                            await bot.unbanChatMember(chat.chat_id, restriction.user_id);
                            logger.info(`Automatically unbanned user ${restriction.user_id} from chat ${chat.chat_id} (ban expired)`);
                        } else if (restriction.type === 'MUTE') {
                            await bot.restrictChatMember(chat.chat_id, restriction.user_id, {
                                can_send_messages: true,
                                can_send_media_messages: true,
                                can_send_other_messages: true,
                                can_add_web_page_previews: true
                            });
                            logger.info(`Automatically unmuted user ${restriction.user_id} from chat ${chat.chat_id} (mute expired)`);
                        }

                        // Send notification to the chat
                        const actionText = restriction.type === 'BAN' ? 'مسدودیت' : 'سکوت';
                        const userMention = restriction.username ? 
                            `@${restriction.username}` : 
                            `${restriction.first_name}${restriction.last_name ? ' ' + restriction.last_name : ''}`;
                        
                        await bot.sendMessage(
                            chat.chat_id,
                            `🔄 ${actionText} ${userMention} به پایان رسید و به صورت خودکار برداشته شد.`
                        );
                    } catch (chatError) {
                        logger.error(`Failed to remove ${restriction.type.toLowerCase()} from chat:`, {
                            error: chatError.message,
                            userId: restriction.user_id,
                            chatId: chat.chat_id,
                            type: restriction.type
                        });
                    }
                }

                // Update restriction status in database
                await queries.removeRestriction(restriction.user_id, restriction.type);
            } catch (userError) {
                logger.error(`Error processing expired ${restriction.type.toLowerCase()}:`, {
                    error: userError.message,
                    userId: restriction.user_id,
                    type: restriction.type
                });
            }
        }
    } catch (error) {
        logger.error('Error checking temporary restrictions:', {
            error: error.message,
            stack: error.stack
        });
    }
}

/**
 * Update user activity statistics
 * @param {TelegramBot} bot Telegram bot instance
 */
async function updateUserStats(bot) {
    try {
        const activeUsers = await queries.getActiveUsers();
        
        for (const user of activeUsers) {
            try {
                // Calculate user statistics
                const stats = await queries.calculateUserStats(user.user_id);
                
                // Update user's activity record
                await queries.updateUserActivity(user.user_id, stats);
                
                // Check for achievements
                await checkAchievements(bot, user.user_id, stats);
            } catch (error) {
                logger.error(`Failed to update stats for user ${user.user_id}:`, error);
            }
        }
    } catch (error) {
        logger.error('Error updating user stats:', error);
    }
}

/**
 * Schedule daily summary message
 * @param {TelegramBot} bot Telegram bot instance
 */
function scheduleDailySummary(bot) {
    const [hour, minute] = config.dailySummaryTime.split(':').map(Number);
    
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === hour && now.getMinutes() === minute) {
            sendDailySummary(bot);
        }
    }, 60000); // Check every minute
}

/**
 * Send daily summary to all groups
 * @param {TelegramBot} bot Telegram bot instance
 */
async function sendDailySummary(bot) {
    try {
        const groups = await queries.getActiveGroups();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

        for (const group of groups) {
            try {
                // Get group statistics
                const stats = await queries.getGroupDailyStats(group.chat_id, yesterday);
                
                // Get top users
                const topUsers = await queries.getTopUsers(5);
                
                // Format summary message
                const summaryMessage = `
📊 Daily Summary (${yesterday.toLocaleDateString()})

Activity Overview:
• Total Messages: ${stats.total_messages}
• New Members: ${stats.new_members}
• Active Members: ${stats.active_members}
• Commands Used: ${stats.commands_used}

🏆 Top Active Users:
${topUsers.map((user, index) => `${index + 1}. @${user.username || user.user_id}: ${user.total_messages} messages`).join('\n')}

📈 Moderation Actions:
• Warnings Issued: ${stats.warnings_issued}
• Users Muted: ${stats.users_muted}
• Users Banned: ${stats.users_banned}
• Messages Deleted: ${stats.messages_deleted}

🎯 Today's Events:
${await formatTodayEvents(group.chat_id)}
`;

                await bot.sendMessage(group.chat_id, summaryMessage);
            } catch (error) {
                logger.error(`Failed to send daily summary to group ${group.chat_id}:`, error);
            }
        }
    } catch (error) {
        logger.error('Error sending daily summary:', error);
    }
}

/**
 * Format today's events for a group
 * @param {number} chatId Chat ID to get events for
 * @returns {Promise<string>} Formatted events string
 */
async function formatTodayEvents(chatId) {
    try {
        const events = await queries.getTodayEvents(chatId);
        
        if (events.length === 0) {
            return 'No events scheduled for today';
        }

        return events.map(event => `• ${event.title} at ${formatTime(event.start_time)}`).join('\n');
    } catch (error) {
        logger.error(`Error formatting events for chat ${chatId}:`, error);
        return 'Failed to load events';
    }
}

/**
 * Check and award user achievements
 * @param {TelegramBot} bot Telegram bot instance
 * @param {number} userId User ID to check
 * @param {Object} stats User statistics
 */
async function checkAchievements(bot, userId, stats) {
    try {
        const achievements = [
            {
                id: 'messages_100',
                name: 'Century Club',
                description: 'Send 100 messages',
                condition: stats => stats.total_messages >= 100
            },
            {
                id: 'daily_active_7',
                name: 'Week Warrior',
                description: 'Be active for 7 consecutive days',
                condition: stats => stats.active_days_streak >= 7
            },
            {
                id: 'reactions_50',
                name: 'Reaction Master',
                description: 'Add 50 reactions to messages',
                condition: stats => stats.total_reactions >= 50
            },
            {
                id: 'commands_20',
                name: 'Command Conqueror',
                description: 'Use 20 different bot commands',
                condition: stats => stats.unique_commands >= 20
            }
        ];

        // Get user's current achievements
        const userAchievements = await queries.getUserAchievements(userId);

        for (const achievement of achievements) {
            // Skip if user already has this achievement
            if (userAchievements.includes(achievement.id)) {
                continue;
            }

            // Check if user qualifies for achievement
            if (achievement.condition(stats)) {
                // Award achievement
                await queries.awardAchievement(userId, achievement.id);

                // Notify user
                const chats = await queries.getUserChats(userId);
                for (const chat of chats) {
                    await bot.sendMessage(
                        chat.chat_id,
                        `🏆 Congratulations @${stats.username || userId}!\nYou've earned the "${achievement.name}" achievement!\n\n${achievement.description}`
                    );
                }
            }
        }
    } catch (error) {
        logger.error(`Error checking achievements for user ${userId}:`, error);
    }
}

/**
 * Backup important data
 * @param {TelegramBot} bot Telegram bot instance
 */
async function backupData(bot) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupData = {
            users: await queries.getAllUsers(),
            roles: await queries.getAllRoles(),
            settings: await queries.getAllGroupSettings(),
            banned_content: await queries.getBannedContent(),
            custom_commands: await queries.getAllCustomCommands()
        };

        // Save backup to database or file system
        await queries.saveBackup(timestamp, backupData);
        
        // Notify admin
        if (config.adminUserId) {
            await bot.sendMessage(
                config.adminUserId,
                `📦 Database backup completed successfully.\nTimestamp: ${timestamp}`
            );
        }

        logger.info('Backup completed successfully', { timestamp });
    } catch (error) {
        logger.error('Error creating backup:', error);
        
        // Notify admin of backup failure
        if (config.adminUserId) {
            await bot.sendMessage(
                config.adminUserId,
                '⚠️ Database backup failed. Please check the logs.'
            );
        }
    }
}

/**
 * Clean old backups
 */
async function cleanOldBackups() {
    try {
        const maxAge = Date.now() - config.maxBackupAge;
        await queries.deleteOldBackups(maxAge);
        logger.info('Old backups cleaned successfully');
    } catch (error) {
        logger.error('Error cleaning old backups:', error);
    }
}

/**
 * Format time for display
 * @param {Date} date Date to format
 * @returns {string} Formatted time string
 */
function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

module.exports = {
    scheduleJobs
}; 