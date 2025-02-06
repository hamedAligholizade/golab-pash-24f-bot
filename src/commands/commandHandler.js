const config = require('../config/config');
const queries = require('../database/queries');
const { logger } = require('../utils/logger');
const { isAdmin, isModerator } = require('../utils/permissions');
const { createPoll } = require('../utils/pollManager');
const { formatDuration } = require('../utils/formatter');

const commands = {
    // Public Commands
    '/start': async (bot, msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, 'Hello! I am your group management bot. Use /help to see available commands.');
    },

    '/help': async (bot, msg) => {
        const chatId = msg.chat.id;
        const helpText = `
Available Commands:

General Commands:
/rules - View group rules
/info - Get group information
/stats - View your activity stats
/top - View top active users
/events - List upcoming events
/feedback <message> - Submit feedback

User Commands:
/me - View your profile
/birthday <DD-MM> - Set your birthday

Event Commands:
/event_join <event_id> - Join an event
/event_leave <event_id> - Leave an event

Admin Commands (requires permissions):
!ban <user> <duration> <reason> - Ban a user
!unban <user> - Unban a user
!mute <user> <duration> - Mute a user
!unmute <user> - Unmute a user
!warn <user> <reason> - Warn a user
!kick <user> - Kick a user
!pin - Pin a message
!unpin - Unpin a message
!settings - Manage group settings
!poll - Create a poll
!announce - Make an announcement
!stats_all - View group statistics
`;
        await bot.sendMessage(chatId, helpText);
    },

    '/rules': async (bot, msg) => {
        const chatId = msg.chat.id;
        const settings = await queries.getGroupSettings(chatId);
        await bot.sendMessage(chatId, settings?.rules || config.defaultRules);
    },

    '/info': async (bot, msg) => {
        const chatId = msg.chat.id;
        const settings = await queries.getGroupSettings(chatId);
        const chat = await bot.getChat(chatId);
        const memberCount = await bot.getChatMemberCount(chatId);
        
        const info = `
📊 Group Information
Name: ${chat.title}
Members: ${memberCount}
Description: ${chat.description || 'No description'}
Created: ${new Date(chat.date * 1000).toLocaleDateString()}
`;
        await bot.sendMessage(chatId, info);
    },

    '/stats': async (bot, msg) => {
        const userId = msg.from.id;
        const stats = await queries.getTopUsers(1);
        const userStats = stats.find(s => s.user_id === userId);
        
        if (!userStats) {
            await bot.sendMessage(msg.chat.id, 'No activity recorded yet.');
            return;
        }

        const statsText = `
📊 Your Statistics
Messages: ${userStats.total_messages}
Reactions: ${userStats.total_reactions}
Commands Used: ${userStats.total_commands}
`;
        await bot.sendMessage(msg.chat.id, statsText);
    },

    '/top': async (bot, msg) => {
        const topUsers = await queries.getTopUsers(10);
        let topText = '🏆 Top 10 Active Users:\n\n';
        
        for (let i = 0; i < topUsers.length; i++) {
            const user = topUsers[i];
            topText += `${i + 1}. ${user.username || user.first_name}: ${user.total_messages} messages\n`;
        }
        
        await bot.sendMessage(msg.chat.id, topText);
    },

    '/feedback': async (bot, msg) => {
        const feedback = msg.text.split(' ').slice(1).join(' ');
        if (!feedback) {
            await bot.sendMessage(msg.chat.id, 'Please provide your feedback message: /feedback <your message>');
            return;
        }

        await queries.submitFeedback(msg.from.id, feedback);
        await bot.sendMessage(msg.chat.id, 'Thank you for your feedback! 🙏');
    },

    // Admin Commands
    '!ban': async (bot, msg) => {
        if (!await isAdmin(msg.from.id, msg.chat.id)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 3) {
            await bot.sendMessage(msg.chat.id, 'Usage: !ban <user> <duration> <reason>');
            return;
        }

        const username = args[1].replace('@', '');
        const duration = args[2];
        const reason = args.slice(3).join(' ');

        try {
            const chatMember = await bot.getChatMember(msg.chat.id, username);
            await queries.banUser(chatMember.user.id, reason, duration, msg.from.id);
            await bot.banChatMember(msg.chat.id, chatMember.user.id, {
                until_date: Math.floor(Date.now() / 1000) + (parseInt(duration) * 60)
            });
            
            await bot.sendMessage(msg.chat.id, `User @${username} has been banned for ${duration} minutes.\nReason: ${reason}`);
        } catch (error) {
            logger.error('Error banning user:', error);
            await bot.sendMessage(msg.chat.id, 'Failed to ban user. Please check the username and try again.');
        }
    },

    '!unban': async (bot, msg) => {
        if (!await isAdmin(msg.from.id, msg.chat.id)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const username = msg.text.split(' ')[1]?.replace('@', '');
        if (!username) {
            await bot.sendMessage(msg.chat.id, 'Usage: !unban <user>');
            return;
        }

        try {
            const chatMember = await bot.getChatMember(msg.chat.id, username);
            await queries.unbanUser(chatMember.user.id);
            await bot.unbanChatMember(msg.chat.id, chatMember.user.id);
            await bot.sendMessage(msg.chat.id, `User @${username} has been unbanned.`);
        } catch (error) {
            logger.error('Error unbanning user:', error);
            await bot.sendMessage(msg.chat.id, 'Failed to unban user. Please check the username and try again.');
        }
    },

    '!warn': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 3) {
            await bot.sendMessage(msg.chat.id, 'Usage: !warn <user> <reason>');
            return;
        }

        const username = args[1].replace('@', '');
        const reason = args.slice(2).join(' ');

        try {
            const chatMember = await bot.getChatMember(msg.chat.id, username);
            await queries.logInfraction(chatMember.user.id, 'WARN', reason, 'WARN', null, msg.from.id);
            await bot.sendMessage(msg.chat.id, `⚠️ @${username} has been warned.\nReason: ${reason}`);
        } catch (error) {
            logger.error('Error warning user:', error);
            await bot.sendMessage(msg.chat.id, 'Failed to warn user. Please check the username and try again.');
        }
    },

    '!poll': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const args = msg.text.split('\n');
        if (args.length < 3) {
            await bot.sendMessage(msg.chat.id, 'Usage: !poll\nQuestion\nOption 1\nOption 2\n...');
            return;
        }

        const question = args[1];
        const options = args.slice(2);

        try {
            await createPoll(bot, msg.chat.id, question, options);
        } catch (error) {
            logger.error('Error creating poll:', error);
            await bot.sendMessage(msg.chat.id, 'Failed to create poll. Please try again.');
        }
    },

    '!settings': async (bot, msg) => {
        if (!await isAdmin(msg.from.id, msg.chat.id)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const settings = await queries.getGroupSettings(msg.chat.id);
        const settingsText = `
Current Group Settings:

Welcome Message: ${settings?.welcome_message || config.welcomeMessage}
Rules: ${settings?.rules || config.defaultRules}
Spam Sensitivity: ${settings?.spam_sensitivity || config.defaultSpamSensitivity}
Max Warnings: ${settings?.max_warnings || config.maxWarnings}
Mute Duration: ${formatDuration(settings?.mute_duration || config.defaultMuteDuration)}
Ban Duration: ${formatDuration(settings?.ban_duration || config.defaultBanDuration)}

To change settings, use:
!set welcome <message>
!set rules <rules>
!set spam_sensitivity <1-10>
!set max_warnings <number>
!set mute_duration <duration>
!set ban_duration <duration>
`;
        await bot.sendMessage(msg.chat.id, settingsText);
    }
};

async function handleCommand(bot, msg) {
    try {
        const command = msg.text.split(' ')[0].toLowerCase();
        const handler = commands[command];

        // Log command processing start
        logger.info(`Processing command ${command} from user ${msg.from.id} in chat ${msg.chat.id}`);

        if (handler) {
            try {
                await handler(bot, msg);
                
                // Log command usage
                try {
                    await queries.updateUserActivity(msg.from.id, 'commands_used');
                } catch (activityError) {
                    logger.error('Failed to update command usage activity:', {
                        error: activityError.message,
                        stack: activityError.stack,
                        userId: msg.from.id,
                        command
                    });
                    // Don't throw here as this is not critical
                }

                // Log successful command execution
                logger.info(`Successfully executed command ${command} for user ${msg.from.id}`);
            } catch (handlerError) {
                logger.error('Command handler execution failed:', {
                    error: handlerError.message,
                    stack: handlerError.stack,
                    command,
                    userId: msg.from.id,
                    chatId: msg.chat.id
                });

                // Send appropriate error message to user
                let errorMessage = 'Sorry, there was an error executing your command.';
                if (handlerError.message.includes('permission')) {
                    errorMessage = 'You do not have permission to use this command.';
                } else if (handlerError.message.includes('not found')) {
                    errorMessage = 'The specified user or resource was not found.';
                } else if (handlerError.message.includes('invalid format')) {
                    errorMessage = 'Invalid command format. Please check the command syntax.';
                }

                try {
                    await bot.sendMessage(msg.chat.id, errorMessage);
                } catch (notifyError) {
                    logger.error('Failed to send error message to user:', {
                        error: notifyError.message,
                        originalError: handlerError.message
                    });
                }
            }
        } else {
            // Log unknown command
            logger.warn(`Unknown command attempted: ${command}`, {
                userId: msg.from.id,
                chatId: msg.chat.id
            });
        }
    } catch (error) {
        logger.error('Error handling command:', {
            error: error.message,
            stack: error.stack,
            command: msg?.text?.split(' ')[0],
            userId: msg?.from?.id,
            chatId: msg?.chat?.id,
            messageId: msg?.message_id
        });

        // Try to notify the user about the error
        try {
            await bot.sendMessage(msg.chat.id, 'Sorry, there was an error processing your command. Please try again later.');
        } catch (notifyError) {
            logger.error('Failed to notify user about error:', {
                error: notifyError.message,
                originalError: error.message
            });
        }
    }
}

module.exports = {
    handleCommand
}; 