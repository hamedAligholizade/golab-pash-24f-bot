const config = require('../config/config');
const queries = require('../database/queries');
const { logger } = require('./logger');

/**
 * Create a new poll
 * @param {TelegramBot} bot Telegram bot instance
 * @param {number} chatId Chat ID where to create the poll
 * @param {string} question Poll question
 * @param {Array<string>} options Poll options
 * @returns {Promise<Object>} Created poll object
 */
async function createPoll(bot, chatId, question, options) {
    try {
        // Validate input
        if (!question || !options || options.length < 2) {
            throw new Error('Invalid poll parameters');
        }

        // Create poll message
        const message = await bot.sendPoll(chatId, question, options, {
            is_anonymous: false,
            allows_multiple_answers: false,
            // You can add more poll options here
        });

        // Save poll to database
        const poll = await queries.createPoll({
            chat_id: chatId,
            message_id: message.message_id,
            question: question,
            options: options,
            created_at: new Date(),
            is_active: true
        });

        logger.info(`Poll created in chat ${chatId}`, { pollId: poll.id });
        return message;
    } catch (error) {
        logger.error('Error creating poll:', error);
        throw error;
    }
}

/**
 * Update poll vote
 * @param {number} pollId Poll ID
 * @param {number} userId User ID
 * @param {number} optionIndex Selected option index
 * @returns {Promise<Object>} Updated poll results
 */
async function updatePollVote(pollId, userId, optionIndex) {
    try {
        // Get poll and validate
        const poll = await queries.getPoll(pollId);
        if (!poll || !poll.is_active) {
            throw new Error('Poll not found or inactive');
        }

        // Save vote
        await queries.savePollVote(pollId, userId, optionIndex);

        // Get updated results
        const results = await queries.getPollResults(pollId);
        
        logger.info(`Vote recorded for poll ${pollId}`, {
            userId,
            optionIndex
        });

        return results;
    } catch (error) {
        logger.error('Error updating poll vote:', error);
        throw error;
    }
}

/**
 * Close a poll
 * @param {TelegramBot} bot Telegram bot instance
 * @param {number} pollId Poll ID
 * @returns {Promise<Object>} Final poll results
 */
async function closePoll(bot, pollId) {
    try {
        // Get poll and validate
        const poll = await queries.getPoll(pollId);
        if (!poll || !poll.is_active) {
            throw new Error('Poll not found or already closed');
        }

        // Stop the poll
        await bot.stopPoll(poll.chat_id, poll.message_id);

        // Mark poll as inactive
        await queries.updatePoll(pollId, { is_active: false });

        // Get final results
        const results = await queries.getPollResults(pollId);

        // Format results message
        const resultsMessage = formatPollResults(poll, results);

        // Send results message
        await bot.sendMessage(poll.chat_id, resultsMessage, {
            parse_mode: 'HTML',
            reply_to_message_id: poll.message_id
        });

        logger.info(`Poll ${pollId} closed`, { results });
        return results;
    } catch (error) {
        logger.error('Error closing poll:', error);
        throw error;
    }
}

/**
 * Format poll results for display
 * @param {Object} poll Poll object
 * @param {Object} results Poll results
 * @returns {string} Formatted results message
 */
function formatPollResults(poll, results) {
    const totalVotes = results.reduce((sum, result) => sum + result.votes, 0);
    
    let message = `
📊 Poll Results: ${poll.question}

Total Votes: ${totalVotes}

Results:
`;

    results.forEach((result, index) => {
        const percentage = totalVotes > 0 ? (result.votes / totalVotes * 100).toFixed(1) : 0;
        const bar = createProgressBar(percentage);
        message += `\n${poll.options[index]}\n${bar} ${percentage}% (${result.votes} votes)`;
    });

    return message;
}

/**
 * Create a visual progress bar
 * @param {number} percentage Percentage value
 * @returns {string} Progress bar string
 */
function createProgressBar(percentage) {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '▒'.repeat(empty);
}

/**
 * Get active polls for a chat
 * @param {number} chatId Chat ID
 * @returns {Promise<Array>} Array of active polls
 */
async function getActivePolls(chatId) {
    try {
        return await queries.getActivePolls(chatId);
    } catch (error) {
        logger.error('Error getting active polls:', error);
        throw error;
    }
}

/**
 * Schedule poll closure
 * @param {TelegramBot} bot Telegram bot instance
 * @param {number} pollId Poll ID
 * @param {number} duration Duration in milliseconds
 */
async function schedulePollClosure(bot, pollId, duration) {
    try {
        setTimeout(async () => {
            try {
                await closePoll(bot, pollId);
            } catch (error) {
                logger.error('Error in scheduled poll closure:', error);
            }
        }, duration);

        logger.info(`Poll ${pollId} scheduled to close in ${duration}ms`);
    } catch (error) {
        logger.error('Error scheduling poll closure:', error);
        throw error;
    }
}

/**
 * Create a quick yes/no poll
 * @param {TelegramBot} bot Telegram bot instance
 * @param {number} chatId Chat ID
 * @param {string} question Poll question
 * @returns {Promise<Object>} Created poll object
 */
async function createQuickPoll(bot, chatId, question) {
    return createPoll(bot, chatId, question, ['Yes', 'No']);
}

/**
 * Create a survey with multiple questions
 * @param {TelegramBot} bot Telegram bot instance
 * @param {number} chatId Chat ID
 * @param {Object} survey Survey configuration
 * @returns {Promise<Array>} Array of created poll objects
 */
async function createSurvey(bot, chatId, survey) {
    try {
        const polls = [];
        
        for (const question of survey.questions) {
            // Add delay between questions to avoid flooding
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const poll = await createPoll(
                bot,
                chatId,
                question.text,
                question.options
            );
            
            polls.push(poll);
        }

        // Save survey metadata
        await queries.createSurvey({
            chat_id: chatId,
            title: survey.title,
            description: survey.description,
            poll_ids: polls.map(p => p.id),
            created_at: new Date()
        });

        return polls;
    } catch (error) {
        logger.error('Error creating survey:', error);
        throw error;
    }
}

module.exports = {
    createPoll,
    updatePollVote,
    closePoll,
    getActivePolls,
    schedulePollClosure,
    createQuickPoll,
    createSurvey
}; 