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
        if (!await isAdmin(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 3) {
            await bot.sendMessage(msg.chat.id, 'Usage: !ban <user> <duration> <reason>\nDuration in minutes. You can specify user by username (@username) or by replying to their message.');
            return;
        }

        let targetUser;
        const duration = parseInt(args[2]);
        const reason = args.slice(3).join(' ');

        if (isNaN(duration) || duration <= 0) {
            await bot.sendMessage(msg.chat.id, 'Please provide a valid duration in minutes.');
            return;
        }

        try {
            // Check if command is a reply to a message
            if (msg.reply_to_message) {
                targetUser = msg.reply_to_message.from;
            } else {
                // Get user by username or ID
                const userIdentifier = args[1].replace('@', '');
                try {
                    // Try to parse as user ID first
                    const userId = parseInt(userIdentifier);
                    if (!isNaN(userId)) {
                        const chatMember = await bot.getChatMember(msg.chat.id, userId);
                        targetUser = chatMember.user;
                    } else {
                        // If not a number, treat as username
                        const chatMember = await bot.getChatMember(msg.chat.id, '@' + userIdentifier);
                        targetUser = chatMember.user;
                    }
                } catch (error) {
                    throw new Error('Could not find user. Make sure the username or ID is correct.');
                }
            }

            // Don't allow banning admins/moderators
            const isTargetAdmin = await isAdmin(targetUser.id, msg.chat.id, bot);
            const isTargetMod = await isModerator(targetUser.id, msg.chat.id, bot);
            if (isTargetAdmin || isTargetMod) {
                await bot.sendMessage(msg.chat.id, '⚠️ You cannot ban administrators or moderators.');
                return;
            }

            // Save user to database first
            await queries.saveUser(
                targetUser.id,
                targetUser.username,
                targetUser.first_name,
                targetUser.last_name
            );

            // Ban the user
            await queries.banUser(targetUser.id, reason, duration, msg.from.id);
            await bot.banChatMember(msg.chat.id, targetUser.id, {
                until_date: Math.floor(Date.now() / 1000) + (duration * 60)
            });
            
            const banMsg = `🚫 ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} has been banned for ${duration} minutes.\nReason: ${reason}`;
            await bot.sendMessage(msg.chat.id, banMsg);
        } catch (error) {
            logger.error('Error banning user:', error);
            await bot.sendMessage(
                msg.chat.id,
                error.message === 'Could not find user. Make sure the username or ID is correct.'
                    ? error.message
                    : 'Failed to ban user. Please check the username/ID and try again.'
            );
        }
    },

    '!unban': async (bot, msg) => {
        if (!await isAdmin(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 2) {
            await bot.sendMessage(msg.chat.id, 'Usage: !unban <user>\nYou can specify user by username (@username) or user ID.');
            return;
        }

        let targetUser;
        try {
            // Get user by username or ID
            const userIdentifier = args[1].replace('@', '');
            try {
                // Try to parse as user ID first
                const userId = parseInt(userIdentifier);
                if (!isNaN(userId)) {
                    targetUser = { id: userId, username: userIdentifier };
                } else {
                    // If not a number, treat as username
                    targetUser = { id: null, username: userIdentifier };
                }
            } catch (error) {
                throw new Error('Could not process user identifier. Please provide a valid username or ID.');
            }

            // Unban the user
            if (targetUser.id) {
                await queries.unbanUser(targetUser.id);
                await bot.unbanChatMember(msg.chat.id, targetUser.id);
            } else {
                await bot.unbanChatMember(msg.chat.id, '@' + targetUser.username);
            }

            const unbanMsg = `✅ User ${targetUser.username ? '@' + targetUser.username : `ID: ${targetUser.id}`} has been unbanned.`;
            await bot.sendMessage(msg.chat.id, unbanMsg);
        } catch (error) {
            logger.error('Error unbanning user:', error);
            await bot.sendMessage(
                msg.chat.id,
                error.message.includes('Could not process user identifier')
                    ? error.message
                    : 'Failed to unban user. Please check the username/ID and try again.'
            );
        }
    },

    '!warn': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 2) {
            await bot.sendMessage(msg.chat.id, 'Usage: !warn <@username or user_id> <reason>\nExample: !warn @user spamming\nOr reply to a message with: !warn reason');
            return;
        }

        let targetUser;
        let reason;

        try {
            // Check if command is a reply to a message
            if (msg.reply_to_message) {
                logger.debug('Getting user from reply message:', {
                    replyMessage: msg.reply_to_message.message_id,
                    fromUser: msg.reply_to_message.from
                });
                targetUser = msg.reply_to_message.from;
                reason = args.slice(1).join(' ');
            } else {
                // Get user by username or ID
                const userIdentifier = args[1].startsWith('@') ? args[1].substring(1) : args[1];
                reason = args.slice(2).join(' ');

                logger.debug('Looking up user:', {
                    userIdentifier,
                    chatId: msg.chat.id
                });

                try {
                    // Try to parse as user ID first
                    const userId = parseInt(userIdentifier);
                    if (!isNaN(userId)) {
                        logger.debug('Looking up user by ID:', { userId });
                        const chatMember = await bot.getChatMember(msg.chat.id, userId);
                        targetUser = chatMember.user;
                    } else {
                        // If not a number, treat as username
                        logger.debug('Looking up user by username:', { username: userIdentifier });
                        
                        try {
                            // Try direct lookup with @ symbol first
                            const chatMember = await bot.getChatMember(msg.chat.id, `@${userIdentifier}`);
                            targetUser = chatMember.user;
                            logger.debug('Found user by direct lookup:', { user: targetUser });
                        } catch (directLookupError) {
                            logger.error('Direct lookup failed:', directLookupError);
                            try {
                                // Try without @ symbol as last resort
                                const chatMember = await bot.getChatMember(msg.chat.id, userIdentifier);
                                targetUser = chatMember.user;
                                logger.debug('Found user by username without @:', { user: targetUser });
                            } catch (error) {
                                logger.error('All lookup attempts failed:', {
                                    error: error.message,
                                    userIdentifier,
                                    chatId: msg.chat.id
                                });
                                throw new Error(`Could not find user "${args[1]}" in this chat. Make sure the username or ID is correct and the user is in the chat.`);
                            }
                        }
                    }
                } catch (error) {
                    logger.error('Error getting chat member:', {
                        error: error.message,
                        userIdentifier,
                        chatId: msg.chat.id
                    });
                    throw new Error(`Could not find user "${args[1]}" in this chat. Make sure the username or ID is correct and the user is in the chat.`);
                }
            }

            if (!targetUser) {
                throw new Error('Could not identify the target user. Please use a valid @username or user ID, or reply to the user\'s message.');
            }

            // Don't allow warning admins/moderators
            const isTargetAdmin = await isAdmin(targetUser.id, msg.chat.id, bot);
            const isTargetMod = await isModerator(targetUser.id, msg.chat.id, bot);
            if (isTargetAdmin || isTargetMod) {
                await bot.sendMessage(msg.chat.id, '⚠️ You cannot warn administrators or moderators.');
                return;
            }

            // Save user to database first
            await queries.saveUser(
                targetUser.id,
                targetUser.username,
                targetUser.first_name,
                targetUser.last_name
            );

            // Log the warning
            await queries.logInfraction(targetUser.id, 'WARN', reason, 'WARN', null, msg.from.id);
            
            // Send warning message
            const warningMsg = `⚠️ ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} has been warned.\nReason: ${reason}`;
            await bot.sendMessage(msg.chat.id, warningMsg);

            // Get warning count
            const warnings = await queries.getUserInfractions(targetUser.id);
            const warningCount = warnings.filter(w => w.type === 'WARN').length;
            
            // If user has too many warnings, take additional action
            const settings = await queries.getGroupSettings(msg.chat.id);
            const maxWarnings = settings?.max_warnings || config.maxWarnings;
            
            if (warningCount >= maxWarnings) {
                await bot.restrictChatMember(msg.chat.id, targetUser.id, {
                    can_send_messages: false,
                    until_date: Math.floor(Date.now() / 1000) + 3600 // 1 hour mute
                });
                await bot.sendMessage(
                    msg.chat.id,
                    `User has reached ${warningCount} warnings and has been muted for 1 hour.`
                );
            }
        } catch (error) {
            logger.error('Error warning user:', {
                error: error.message,
                stack: error.stack,
                command: msg.text,
                chatId: msg.chat.id,
                fromUser: msg.from.id
            });
            await bot.sendMessage(msg.chat.id, error.message);
        }
    },

    '!poll': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id, bot)) {
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
        if (!await isAdmin(msg.from.id, msg.chat.id, bot)) {
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
    },

    '!mute': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 3) {
            await bot.sendMessage(msg.chat.id, 'Usage: !mute <user> <duration> [reason]\nDuration in minutes. You can specify user by username (@username) or by replying to their message.');
            return;
        }

        let targetUser;
        const duration = parseInt(args[2]);
        const reason = args.length > 3 ? args.slice(3).join(' ') : 'No reason provided';

        if (isNaN(duration) || duration <= 0) {
            await bot.sendMessage(msg.chat.id, 'Please provide a valid duration in minutes.');
            return;
        }

        try {
            // Check if command is a reply to a message
            if (msg.reply_to_message) {
                logger.debug('Getting user from reply message:', {
                    replyMessage: msg.reply_to_message.message_id,
                    fromUser: msg.reply_to_message.from
                });
                targetUser = msg.reply_to_message.from;
            } else {
                // Get user by username or ID
                const userIdentifier = args[1].startsWith('@') ? args[1].substring(1) : args[1];
                logger.debug('Looking up user:', {
                    userIdentifier,
                    chatId: msg.chat.id
                });

                try {
                    // Try to parse as user ID first
                    const userId = parseInt(userIdentifier);
                    if (!isNaN(userId)) {
                        logger.debug('Looking up user by ID:', { userId });
                        const chatMember = await bot.getChatMember(msg.chat.id, userId);
                        targetUser = chatMember.user;
                    } else {
                        // If not a number, treat as username
                        logger.debug('Looking up user by username:', { username: userIdentifier });
                        
                        try {
                            // Try direct lookup with @ symbol first
                            const chatMember = await bot.getChatMember(msg.chat.id, `@${userIdentifier}`);
                            targetUser = chatMember.user;
                            logger.debug('Found user by direct lookup:', { user: targetUser });
                        } catch (directLookupError) {
                            logger.error('Direct lookup failed:', directLookupError);
                            try {
                                // Try without @ symbol as last resort
                                const chatMember = await bot.getChatMember(msg.chat.id, userIdentifier);
                                targetUser = chatMember.user;
                                logger.debug('Found user by username without @:', { user: targetUser });
                            } catch (error) {
                                logger.error('All lookup attempts failed:', {
                                    error: error.message,
                                    userIdentifier,
                                    chatId: msg.chat.id
                                });
                                throw new Error(`Could not find user "${args[1]}" in this chat. Make sure the username or ID is correct and the user is in the chat.`);
                            }
                        }
                    }
                } catch (error) {
                    logger.error('Error getting chat member:', {
                        error: error.message,
                        userIdentifier,
                        chatId: msg.chat.id
                    });
                    throw new Error(`Could not find user "${args[1]}" in this chat. Make sure the username or ID is correct and the user is in the chat.`);
                }
            }

            if (!targetUser) {
                throw new Error('Could not identify the target user. Please use a valid @username or user ID, or reply to the user\'s message.');
            }

            // Don't allow muting admins/moderators
            const isTargetAdmin = await isAdmin(targetUser.id, msg.chat.id, bot);
            const isTargetMod = await isModerator(targetUser.id, msg.chat.id, bot);
            if (isTargetAdmin || isTargetMod) {
                await bot.sendMessage(msg.chat.id, '⚠️ You cannot mute administrators or moderators.');
                return;
            }

            // Save user to database first
            await queries.saveUser(
                targetUser.id,
                targetUser.username,
                targetUser.first_name,
                targetUser.last_name
            );

            // Mute the user
            await bot.restrictChatMember(msg.chat.id, targetUser.id, {
                can_send_messages: false,
                can_send_media_messages: false,
                can_send_other_messages: false,
                can_add_web_page_previews: false,
                until_date: Math.floor(Date.now() / 1000) + (duration * 60)
            });

            // Log the mute
            await queries.logInfraction(targetUser.id, 'MUTE', reason, 'MUTE', duration * 60, msg.from.id);
            
            const muteMsg = `🔇 ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} has been muted for ${duration} minutes.\nReason: ${reason}`;
            await bot.sendMessage(msg.chat.id, muteMsg);
        } catch (error) {
            logger.error('Error muting user:', {
                error: error.message,
                stack: error.stack,
                command: msg.text,
                chatId: msg.chat.id,
                fromUser: msg.from.id
            });
            await bot.sendMessage(msg.chat.id, error.message);
        }
    },

    '!unmute': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 2) {
            await bot.sendMessage(msg.chat.id, 'Usage: !unmute <user>\nYou can specify user by username (@username) or by replying to their message.');
            return;
        }

        let targetUser;
        try {
            // Check if command is a reply to a message
            if (msg.reply_to_message) {
                targetUser = msg.reply_to_message.from;
            } else {
                // Get user by username or ID
                const userIdentifier = args[1].replace('@', '');
                try {
                    // Try to parse as user ID first
                    const userId = parseInt(userIdentifier);
                    if (!isNaN(userId)) {
                        const chatMember = await bot.getChatMember(msg.chat.id, userId);
                        targetUser = chatMember.user;
                    } else {
                        // If not a number, treat as username
                        const chatMember = await bot.getChatMember(msg.chat.id, '@' + userIdentifier);
                        targetUser = chatMember.user;
                    }
                } catch (error) {
                    throw new Error('Could not find user. Make sure the username or ID is correct.');
                }
            }

            // Unmute the user
            await bot.restrictChatMember(msg.chat.id, targetUser.id, {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true
            });
            
            const unmuteMsg = `🔊 ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} has been unmuted.`;
            await bot.sendMessage(msg.chat.id, unmuteMsg);
        } catch (error) {
            logger.error('Error unmuting user:', error);
            await bot.sendMessage(
                msg.chat.id,
                error.message === 'Could not find user. Make sure the username or ID is correct.'
                    ? error.message
                    : 'Failed to unmute user. Please check the username/ID and try again.'
            );
        }
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