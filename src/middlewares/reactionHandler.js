const config = require('../config/config');
const queries = require('../database/queries');
const { logger } = require('../utils/logger');
const { isAdmin, isModerator } = require('../utils/permissions');

async function handleReaction(bot, reaction) {
    try {
        const chatId = reaction.chat.id;
        const userId = reaction.user.id;
        const messageId = reaction.message_id;
        const emoji = reaction.emoji;

        // Log reaction for stats
        await queries.updateUserActivity(userId, 'reactions_added');

        // Handle special reactions (if enabled in config)
        if (config.enableReactionActions) {
            await handleSpecialReactions(bot, reaction);
        }
    } catch (error) {
        logger.error('Error handling reaction:', error);
    }
}

async function handleSpecialReactions(bot, reaction) {
    const chatId = reaction.chat.id;
    const userId = reaction.user.id;
    const messageId = reaction.message_id;
    const emoji = reaction.emoji;

    try {
        // Get message author
        const message = await bot.getMessage(chatId, messageId);
        const authorId = message.from.id;

        // Handle different special reactions
        switch (emoji) {
            // Pin message reaction
            case '📌':
                if (await isModerator(userId, chatId)) {
                    await bot.pinChatMessage(chatId, messageId);
                    logger.info(`Message ${messageId} pinned by ${userId} in chat ${chatId}`);
                }
                break;

            // Delete message reaction
            case '🗑️':
                if (await isModerator(userId, chatId) || userId === authorId) {
                    await bot.deleteMessage(chatId, messageId);
                    logger.info(`Message ${messageId} deleted by ${userId} in chat ${chatId}`);
                }
                break;

            // Report message reaction
            case '⚠️':
                await handleReportReaction(bot, reaction, message);
                break;

            // Star message reaction (for highlights)
            case '⭐':
                await handleStarReaction(bot, reaction, message);
                break;
        }
    } catch (error) {
        logger.error('Error handling special reaction:', error);
    }
}

async function handleReportReaction(bot, reaction, message) {
    const chatId = reaction.chat.id;
    const reporterId = reaction.user.id;
    const messageId = reaction.message_id;
    const authorId = message.from.id;

    try {
        // Get group admins
        const admins = await bot.getChatAdministrators(chatId);
        const adminIds = admins.map(admin => admin.user.id);

        // Skip if reporter is message author or admin
        if (reporterId === authorId || adminIds.includes(reporterId)) {
            return;
        }

        // Get existing reports for this message
        const reports = await queries.getMessageReports(messageId);
        
        // Check if user already reported this message
        if (reports.some(report => report.reporter_id === reporterId)) {
            return;
        }

        // Log the report
        await queries.logMessageReport(messageId, reporterId, 'PENDING');

        // If enough reports, notify admins
        if (reports.length + 1 >= 3) { // Threshold for reports
            const reportMessage = `
⚠️ Message Report Alert

Message ID: ${messageId}
Author: ${message.from.username || message.from.first_name} (${authorId})
Content: ${message.text || '[Media Message]'}
Reports: ${reports.length + 1}

Actions:
/delete_${messageId} - Delete message
/warn_${authorId} - Warn user
/ignore_${messageId} - Ignore reports
`;

            // Send alert to all admins
            for (const adminId of adminIds) {
                await bot.sendMessage(adminId, reportMessage);
            }
        }
    } catch (error) {
        logger.error('Error handling report reaction:', error);
    }
}

async function handleStarReaction(bot, reaction, message) {
    const chatId = reaction.chat.id;
    const messageId = reaction.message_id;

    try {
        // Get message reactions
        const reactions = await bot.getMessageReactions(chatId, messageId);
        const starCount = reactions.filter(r => r.emoji === '⭐').length;

        // If enough stars, add to highlights
        if (starCount >= 5) { // Threshold for highlights
            const highlightChannel = await queries.getHighlightChannel(chatId);
            
            if (highlightChannel) {
                // Format highlight message
                const highlightMessage = `
⭐ Highlighted Message

From: ${message.from.username || message.from.first_name}
Stars: ${starCount}

${message.text || '[Media Message]'}
`;

                // Forward to highlight channel
                await bot.sendMessage(highlightChannel, highlightMessage, {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: 'Go to Message',
                                url: `https://t.me/c/${chatId}/${messageId}`
                            }
                        ]]
                    }
                });

                // Log the highlight
                await queries.logHighlight(messageId, chatId, starCount);
            }
        }
    } catch (error) {
        logger.error('Error handling star reaction:', error);
    }
}

module.exports = {
    handleReaction
}; 