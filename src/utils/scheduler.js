const cron = require('node-cron');
const queries = require('../database/queries');
const { logger } = require('./logger');

async function checkExpiredBans(bot) {
    try {
        const expiredBans = await queries.getExpiredBans();
        for (const ban of expiredBans) {
            try {
                await bot.unbanChatMember(ban.chat_id, ban.user_id);
                await queries.unbanUser(ban.user_id);
                logger.info(`Unbanned user ${ban.user_id} from chat ${ban.chat_id}`);
            } catch (error) {
                logger.error('Error unbanning user:', {
                    error: error.message,
                    userId: ban.user_id,
                    chatId: ban.chat_id
                });
            }
        }
    } catch (error) {
        logger.error('Error checking expired bans:', error);
    }
}

async function checkExpiredMutes(bot) {
    try {
        const expiredMutes = await queries.getExpiredMutes();
        for (const mute of expiredMutes) {
            try {
                await bot.restrictChatMember(mute.chat_id, mute.user_id, {
                    can_send_messages: true,
                    can_send_media_messages: true,
                    can_send_other_messages: true,
                    can_add_web_page_previews: true
                });
                await queries.unmuteMember(mute.user_id, mute.chat_id);
                logger.info(`Unmuted user ${mute.user_id} in chat ${mute.chat_id}`);
            } catch (error) {
                logger.error('Error unmuting user:', {
                    error: error.message,
                    userId: mute.user_id,
                    chatId: mute.chat_id
                });
            }
        }
    } catch (error) {
        logger.error('Error checking expired mutes:', error);
    }
}

async function cleanOldMessages() {
    try {
        const daysToKeep = 30; // Keep messages for 30 days
        await queries.deleteOldMessages(daysToKeep);
        logger.info(`Cleaned messages older than ${daysToKeep} days`);
    } catch (error) {
        logger.error('Error cleaning old messages:', error);
    }
}

async function updateUserStats() {
    try {
        await queries.updateAllUserStats();
        logger.info('Updated user statistics');
    } catch (error) {
        logger.error('Error updating user stats:', error);
    }
}

async function checkBirthdays(bot) {
    try {
        const todaysBirthdays = await queries.getTodaysBirthdays();
        for (const birthday of todaysBirthdays) {
            try {
                const message = `🎉 تولدت مبارک ${birthday.username || birthday.first_name}! 🎂`;
                await bot.sendMessage(birthday.chat_id, message);
                logger.info(`Sent birthday message to ${birthday.user_id}`);
            } catch (error) {
                logger.error('Error sending birthday message:', {
                    error: error.message,
                    userId: birthday.user_id
                });
            }
        }
    } catch (error) {
        logger.error('Error checking birthdays:', error);
    }
}

function scheduleJobs(bot) {
    // Check expired bans every 5 minutes
    cron.schedule('*/5 * * * *', () => checkExpiredBans(bot));

    // Check expired mutes every 5 minutes
    cron.schedule('*/5 * * * *', () => checkExpiredMutes(bot));

    // Clean old messages daily at 3 AM
    cron.schedule('0 3 * * *', () => cleanOldMessages());

    // Update user stats every hour
    cron.schedule('0 * * * *', () => updateUserStats());

    // Check birthdays daily at 9 AM
    cron.schedule('0 9 * * *', () => checkBirthdays(bot));

    logger.info('Scheduled jobs initialized');
}

module.exports = {
    scheduleJobs
}; 