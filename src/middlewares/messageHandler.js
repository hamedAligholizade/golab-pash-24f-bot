const config = require('../config/config');
const queries = require('../database/queries');
const { logger } = require('../utils/logger');
const { isSpam, containsBannedContent } = require('../utils/contentFilter');

async function handleMessage(bot, msg, messageCache) {
    try {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Log message processing start
        logger.info(`Processing message from user ${userId} in chat ${chatId}`);

        // Get group settings
        let settings;
        try {
            settings = await queries.getGroupSettings(chatId);
        } catch (error) {
            logger.error('Failed to fetch group settings:', {
                error: error.message,
                stack: error.stack,
                chatId,
                userId
            });
            throw new Error('Failed to fetch group settings');
        }

        // Skip processing for admin messages
        try {
            if (await isAdmin(msg.from.id, chatId)) {
                return;
            }
        } catch (error) {
            logger.error('Failed to check admin status:', {
                error: error.message,
                stack: error.stack,
                userId,
                chatId
            });
            throw new Error('Failed to check admin status');
        }

        // Anti-spam check
        if (config.enableAntiSpam) {
            try {
                const isSpamMessage = await checkSpam(msg, messageCache, settings?.spam_sensitivity || config.defaultSpamSensitivity);
                if (isSpamMessage) {
                    await handleSpam(bot, msg, settings);
                    return;
                }
            } catch (error) {
                logger.error('Failed to perform spam check:', {
                    error: error.message,
                    stack: error.stack,
                    userId,
                    chatId,
                    messageId: msg.message_id
                });
                throw new Error('Failed to perform spam check');
            }
        }

        // Content filter check
        if (config.enableContentFilter && msg.text) {
            try {
                const bannedContent = await queries.getBannedContent();
                const violatedContent = await containsBannedContent(msg.text, bannedContent);
                
                if (violatedContent) {
                    await handleBannedContent(bot, msg, violatedContent, settings);
                    return;
                }
            } catch (error) {
                logger.error('Failed to check content filter:', {
                    error: error.message,
                    stack: error.stack,
                    userId,
                    chatId,
                    messageId: msg.message_id
                });
                throw new Error('Failed to check content filter');
            }
        }

        // Update message cache for spam detection
        try {
            updateMessageCache(msg, messageCache);
        } catch (error) {
            logger.error('Failed to update message cache:', {
                error: error.message,
                stack: error.stack,
                userId,
                chatId,
                messageId: msg.message_id
            });
            // Don't throw here as this is not critical
        }

        // Log successful message processing
        logger.info(`Successfully processed message from user ${userId} in chat ${chatId}`);

    } catch (error) {
        logger.error('Error handling message:', {
            error: error.message,
            stack: error.stack,
            userId: msg?.from?.id,
            chatId: msg?.chat?.id,
            messageId: msg?.message_id,
            messageType: msg?.text ? 'text' : 'media'
        });

        // Try to notify the user about the error
        try {
            await bot.sendMessage(msg.chat.id, 'Sorry, there was an error processing your message. Please try again later.');
        } catch (notifyError) {
            logger.error('Failed to notify user about error:', {
                error: notifyError.message,
                originalError: error.message
            });
        }
    }
}

async function checkSpam(msg, messageCache, sensitivity) {
    const userId = msg.from.id;
    const now = Date.now();
    const userMessages = messageCache.get(userId) || [];
    
    // Remove messages older than 1 minute
    const recentMessages = userMessages.filter(m => now - m.timestamp < 60000);
    
    // Check message frequency
    if (recentMessages.length >= config.maxMessagesPerMinute * (sensitivity / 5)) {
        return true;
    }

    // Check for similar messages (potential spam)
    if (msg.text) {
        const similarMessages = recentMessages.filter(m => 
            m.text && calculateSimilarity(m.text, msg.text) > 0.8
        );
        
        if (similarMessages.length >= config.maxSimilarMessages) {
            return true;
        }
    }

    return false;
}

function updateMessageCache(msg, messageCache) {
    const userId = msg.from.id;
    const userMessages = messageCache.get(userId) || [];
    
    userMessages.push({
        messageId: msg.message_id,
        text: msg.text,
        timestamp: Date.now()
    });

    // Keep only messages from the last minute
    const recentMessages = userMessages.filter(m => 
        Date.now() - m.timestamp < 60000
    );

    messageCache.set(userId, recentMessages);
}

async function handleSpam(bot, msg, settings) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    try {
        // Delete spam message
        await bot.deleteMessage(chatId, msg.message_id);

        // Log the infraction
        await queries.logInfraction(
            userId,
            'SPAM',
            'Excessive messages or similar content',
            'MUTE',
            settings?.mute_duration || config.defaultMuteDuration,
            null
        );

        // Get user's warning count
        const infractions = await queries.getUserInfractions(userId);
        const warningCount = infractions.length;

        if (warningCount >= (settings?.max_warnings || config.maxWarnings)) {
            // Ban user
            await bot.banChatMember(chatId, userId, {
                until_date: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour ban
            });
            await bot.sendMessage(chatId, `User ${msg.from.username || userId} has been banned for excessive spam.`);
        } else {
            // Mute user
            await bot.restrictChatMember(chatId, userId, {
                can_send_messages: false,
                until_date: Math.floor(Date.now() / 1000) + (60 * 10) // 10 minutes mute
            });
            await bot.sendMessage(
                chatId,
                `⚠️ @${msg.from.username || userId} has been muted for 10 minutes due to spam.\nWarning ${warningCount + 1}/${settings?.max_warnings || config.maxWarnings}`
            );
        }
    } catch (error) {
        logger.error('Error handling spam:', error);
    }
}

async function handleBannedContent(bot, msg, violatedContent, settings) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    try {
        // Delete message with banned content
        await bot.deleteMessage(chatId, msg.message_id);

        // Log the infraction
        await queries.logInfraction(
            userId,
            'BANNED_CONTENT',
            `Message contained banned content: ${violatedContent.content}`,
            'WARN',
            null,
            null
        );

        // Get user's warning count
        const infractions = await queries.getUserInfractions(userId);
        const warningCount = infractions.length;

        if (warningCount >= (settings?.max_warnings || config.maxWarnings)) {
            // Ban user
            await bot.banChatMember(chatId, userId, {
                until_date: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hour ban
            });
            await bot.sendMessage(
                chatId,
                `User ${msg.from.username || userId} has been banned for repeatedly posting prohibited content.`
            );
        } else {
            await bot.sendMessage(
                chatId,
                `⚠️ @${msg.from.username || userId}: Your message was deleted for containing prohibited content.\nWarning ${warningCount + 1}/${settings?.max_warnings || config.maxWarnings}`
            );
        }
    } catch (error) {
        logger.error('Error handling banned content:', error);
    }
}

// Utility function to calculate text similarity (Levenshtein distance based)
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) {
        return 1.0;
    }
    
    const costs = [];
    for (let i = 0; i <= shorter.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= longer.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (shorter[i - 1] !== longer[j - 1]) {
                    newValue = Math.min(
                        Math.min(newValue, lastValue),
                        costs[j]
                    ) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) {
            costs[longer.length] = lastValue;
        }
    }
    
    return (longer.length - costs[shorter.length]) / longer.length;
}

module.exports = {
    handleMessage
}; 