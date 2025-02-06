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
                // Save or update user first
                await queries.saveUser(
                    msg.from.id,
                    msg.from.username,
                    msg.from.first_name,
                    msg.from.last_name
                );

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

        // Check for expired bans every minute
        async function checkExpiredBans() {
            try {
                // Get all banned users whose ban has expired
                const expiredBans = await queries.getBannedUsers();
                
                for (const user of expiredBans) {
                    try {
                        // Get all chats where the user was banned
                        const bannedChats = await queries.getUserBannedChats(user.user_id);
                        
                        // Unban from each chat
                        for (const chat of bannedChats) {
                            try {
                                await bot.unbanChatMember(chat.chat_id, user.user_id);
                                logger.info(`Automatically unbanned user ${user.user_id} from chat ${chat.chat_id} (ban expired)`);
                            } catch (chatError) {
                                logger.error('Failed to unban user from chat:', {
                                    error: chatError.message,
                                    userId: user.user_id,
                                    chatId: chat.chat_id
                                });
                            }
                        }

                        // Update user's ban status in database
                        await queries.unbanUser(user.user_id);
                    } catch (userError) {
                        logger.error('Error processing expired ban for user:', {
                            error: userError.message,
                            userId: user.user_id
                        });
                    }
                }
            } catch (error) {
                logger.error('Error checking expired bans:', error);
            }
        }

        // Start the expired bans check interval
        setInterval(checkExpiredBans, 60000); // Run every minute

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