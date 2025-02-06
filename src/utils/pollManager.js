const queries = require('../database/queries');
const { logger } = require('./logger');

async function createPoll(bot, chatId, question, options) {
    try {
        // Validate input
        if (!question || !options || options.length < 2 || options.length > 10) {
            throw new Error('Invalid poll parameters');
        }

        // Create the poll
        const poll = await bot.sendPoll(chatId, question, options, {
            is_anonymous: false,
            allows_multiple_answers: false,
            type: 'regular'
        });

        // Save poll to database
        await queries.savePoll(
            poll.message_id,
            chatId,
            question,
            options,
            new Date()
        );

        logger.info('Poll created successfully', {
            messageId: poll.message_id,
            chatId: chatId
        });

        return poll;
    } catch (error) {
        logger.error('Error creating poll:', error);
        throw error;
    }
}

async function closePoll(bot, chatId, messageId) {
    try {
        await bot.stopPoll(chatId, messageId);
        await queries.closePoll(messageId);

        logger.info('Poll closed successfully', {
            messageId: messageId,
            chatId: chatId
        });
    } catch (error) {
        logger.error('Error closing poll:', error);
        throw error;
    }
}

async function getPollResults(messageId) {
    try {
        return await queries.getPollResults(messageId);
    } catch (error) {
        logger.error('Error getting poll results:', error);
        throw error;
    }
}

module.exports = {
    createPoll,
    closePoll,
    getPollResults
};