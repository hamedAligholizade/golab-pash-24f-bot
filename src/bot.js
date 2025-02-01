const TelegramBot = require('node-telegram-bot-api');
const config = require('./config/config');
const { initDatabase } = require('./database/init');
const queries = require('./database/queries');
const { handleCommand } = require('./commands/commandHandler');
const { handleMessage } = require('./middlewares/messageHandler');
const { handleNewMember } = require('./middlewares/memberHandler');
const { handleCallback } = require('./middlewares/callbackHandler');
const { handleReaction } = require('./middlewares/reactionHandler');
const { scheduleJobs } = require('./utils/scheduler');
const { logger } = require('./utils/logger');

// Message cache for spam detection
const messageCache = new Map();

async function startBot() {
    try {
        // Initialize database
        await initDatabase();
        logger.info('Database initialized successfully');

        // Initialize bot
        const bot = new TelegramBot(config.botToken, { polling: true });
        logger.info('Bot initialized successfully');

        // Schedule periodic jobs
        scheduleJobs(bot);

        // Handle new chat members
        bot.on('new_chat_members', async (msg) => {
            try {
                await handleNewMember(bot, msg);
            } catch (error) {
                logger.error('Error handling new chat member:', error);
            }
        });

        // Handle all messages
        bot.on('message', async (msg) => {
            try {
                // Skip handling messages from banned users
                const user = await queries.getUserById(msg.from.id);
                if (user?.is_banned) {
                    if (user.ban_until && user.ban_until < new Date()) {
                        await queries.unbanUser(msg.from.id);
                    } else {
                        return;
                    }
                }

                // Log message for stats
                await queries.logMessage(
                    msg.message_id,
                    msg.from.id,
                    msg.chat.id,
                    msg.text ? 'text' : 'media',
                    msg.text || ''
                );

                // Update user activity
                await queries.updateUserActivity(msg.from.id, 'messages_sent');

                // Check if it's a command
                if (msg.text && (msg.text.startsWith(config.commandPrefix) || msg.text.startsWith(config.adminCommandPrefix))) {
                    await handleCommand(bot, msg);
                    return;
                }

                // Handle regular message
                await handleMessage(bot, msg, messageCache);
            } catch (error) {
                logger.error('Error handling message:', error);
            }
        });

        // Handle callback queries (for buttons)
        bot.on('callback_query', async (callbackQuery) => {
            try {
                await handleCallback(bot, callbackQuery);
            } catch (error) {
                logger.error('Error handling callback query:', error);
            }
        });

        // Handle message reactions
        bot.on('message_reaction', async (reaction) => {
            try {
                await handleReaction(bot, reaction);
            } catch (error) {
                logger.error('Error handling reaction:', error);
            }
        });

        // Handle left chat member
        bot.on('left_chat_member', async (msg) => {
            try {
                logger.info(`User ${msg.left_chat_member.id} left the chat ${msg.chat.id}`);
                // You could add custom handling here if needed
            } catch (error) {
                logger.error('Error handling left chat member:', error);
            }
        });

        // Error handling
        bot.on('polling_error', (error) => {
            logger.error('Polling error:', error);
        });

        bot.on('error', (error) => {
            logger.error('General bot error:', error);
        });

        logger.info('Bot is running...');
    } catch (error) {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    logger.info('Received SIGINT. Performing graceful shutdown...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM. Performing graceful shutdown...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

startBot(); 