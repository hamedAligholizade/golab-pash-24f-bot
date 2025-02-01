const config = require('../config/config');
const queries = require('../database/queries');
const { logger } = require('../utils/logger');

async function handleCallback(bot, callbackQuery) {
    try {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;
        const data = callbackQuery.data;

        // Parse callback data
        const [action, ...params] = data.split('_');

        switch (action) {
            case 'rules':
                await handleRulesCallback(bot, chatId, userId);
                break;

            case 'help':
                await handleHelpCallback(bot, chatId, userId);
                break;

            case 'event':
                await handleEventCallback(bot, chatId, userId, params);
                break;

            case 'poll':
                await handlePollCallback(bot, chatId, userId, params);
                break;

            case 'settings':
                await handleSettingsCallback(bot, chatId, userId, params);
                break;

            default:
                logger.warn(`Unknown callback action: ${action}`);
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'This button is no longer active.'
                });
        }

        // Answer callback query to remove loading state
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        logger.error('Error handling callback:', error);
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: 'An error occurred. Please try again.',
            show_alert: true
        });
    }
}

async function handleRulesCallback(bot, chatId, userId) {
    try {
        const settings = await queries.getGroupSettings(chatId);
        const rules = settings?.rules || config.defaultRules;

        await bot.sendMessage(chatId, rules, {
            parse_mode: 'HTML',
            reply_to_message_id: userId
        });
    } catch (error) {
        logger.error('Error handling rules callback:', error);
        throw error;
    }
}

async function handleHelpCallback(bot, chatId, userId) {
    try {
        const helpMessage = `
🤖 Bot Commands Help

General Commands:
/rules - View group rules
/info - Get group information
/stats - View your activity stats
/top - View top active users
/events - List upcoming events
/feedback - Submit feedback

User Commands:
/me - View your profile
/birthday - Set your birthday

Event Commands:
/event_join - Join an event
/event_leave - Leave an event

Need more help? Contact an admin!
`;

        await bot.sendMessage(chatId, helpMessage, {
            parse_mode: 'HTML',
            reply_to_message_id: userId
        });
    } catch (error) {
        logger.error('Error handling help callback:', error);
        throw error;
    }
}

async function handleEventCallback(bot, chatId, userId, params) {
    try {
        const [action, eventId] = params;
        
        switch (action) {
            case 'join':
                await queries.updateEventParticipation(eventId, userId, 'GOING');
                await bot.sendMessage(chatId, '✅ You have joined the event!', {
                    reply_to_message_id: userId
                });
                break;

            case 'maybe':
                await queries.updateEventParticipation(eventId, userId, 'MAYBE');
                await bot.sendMessage(chatId, '🤔 You might attend the event.', {
                    reply_to_message_id: userId
                });
                break;

            case 'leave':
                await queries.updateEventParticipation(eventId, userId, 'NOT_GOING');
                await bot.sendMessage(chatId, '❌ You have left the event.', {
                    reply_to_message_id: userId
                });
                break;
        }
    } catch (error) {
        logger.error('Error handling event callback:', error);
        throw error;
    }
}

async function handlePollCallback(bot, chatId, userId, params) {
    try {
        const [pollId, choice] = params;
        
        // Update poll vote
        await queries.updatePollVote(pollId, userId, choice);
        
        // Get updated poll results
        const poll = await queries.getPoll(pollId);
        const results = await queries.getPollResults(pollId);
        
        // Format results message
        let resultsMessage = `📊 Poll: ${poll.question}\n\n`;
        for (const result of results) {
            const percentage = (result.votes / poll.total_votes) * 100;
            resultsMessage += `${result.option}: ${percentage.toFixed(1)}% (${result.votes} votes)\n`;
        }
        
        // Update original poll message
        await bot.editMessageText(resultsMessage, {
            chat_id: chatId,
            message_id: poll.message_id,
            reply_markup: poll.reply_markup
        });
    } catch (error) {
        logger.error('Error handling poll callback:', error);
        throw error;
    }
}

async function handleSettingsCallback(bot, chatId, userId, params) {
    try {
        // Check if user is admin
        if (!await isAdmin(userId, chatId)) {
            await bot.sendMessage(chatId, '⚠️ You do not have permission to change settings.', {
                reply_to_message_id: userId
            });
            return;
        }

        const [setting, value] = params;
        const settings = await queries.getGroupSettings(chatId);
        
        switch (setting) {
            case 'welcome':
                await queries.updateGroupSettings(chatId, {
                    ...settings,
                    welcome_message: value
                });
                break;

            case 'rules':
                await queries.updateGroupSettings(chatId, {
                    ...settings,
                    rules: value
                });
                break;

            case 'spam':
                await queries.updateGroupSettings(chatId, {
                    ...settings,
                    spam_sensitivity: parseInt(value)
                });
                break;

            case 'warnings':
                await queries.updateGroupSettings(chatId, {
                    ...settings,
                    max_warnings: parseInt(value)
                });
                break;
        }

        await bot.sendMessage(chatId, '✅ Settings updated successfully!', {
            reply_to_message_id: userId
        });
    } catch (error) {
        logger.error('Error handling settings callback:', error);
        throw error;
    }
}

module.exports = {
    handleCallback
}; 