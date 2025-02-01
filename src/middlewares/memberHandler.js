const config = require('../config/config');
const queries = require('../database/queries');
const { logger } = require('../utils/logger');

async function handleNewMember(bot, msg) {
    try {
        const chatId = msg.chat.id;
        const settings = await queries.getGroupSettings(chatId);
        
        for (const newMember of msg.new_chat_members) {
            // Skip if it's a bot
            if (newMember.is_bot) continue;

            // Save user to database
            await queries.saveUser(
                newMember.id,
                newMember.username,
                newMember.first_name,
                newMember.last_name,
                new Date()
            );

            // Assign default member role
            await queries.assignRole(newMember.id, 'Member', null);

            if (config.enableWelcomeMessage) {
                // Get welcome message from settings or use default
                const welcomeMessage = settings?.welcome_message || config.welcomeMessage;
                const rules = settings?.rules || config.defaultRules;

                // Create welcome message with inline keyboard
                const message = `${welcomeMessage}\n\n@${newMember.username || newMember.first_name}`;
                
                const keyboard = {
                    inline_keyboard: [
                        [
                            {
                                text: '📜 Read Rules',
                                callback_data: `rules_${newMember.id}`
                            },
                            {
                                text: '❓ Help',
                                callback_data: `help_${newMember.id}`
                            }
                        ]
                    ]
                };

                // Send welcome message
                await bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });

                // Send rules in a separate message and pin it if it's a new group
                const chatMember = await bot.getChatMember(chatId, newMember.id);
                if (chatMember.status === 'creator') {
                    const rulesMessage = await bot.sendMessage(chatId, rules, {
                        parse_mode: 'HTML'
                    });
                    await bot.pinChatMessage(chatId, rulesMessage.message_id);
                }
            }

            // Log the join event
            logger.info(`New member joined: ${newMember.username || newMember.first_name} (${newMember.id}) in chat ${chatId}`);
        }
    } catch (error) {
        logger.error('Error handling new member:', error);
    }
}

async function handleMemberLeft(bot, msg) {
    try {
        const chatId = msg.chat.id;
        const leftMember = msg.left_chat_member;

        // Log the leave event
        logger.info(`Member left: ${leftMember.username || leftMember.first_name} (${leftMember.id}) from chat ${chatId}`);

        // You could add custom handling here, like:
        // - Sending a goodbye message
        // - Cleaning up user data
        // - Updating group statistics
    } catch (error) {
        logger.error('Error handling member left:', error);
    }
}

async function handleMemberRestricted(bot, msg) {
    try {
        const chatId = msg.chat.id;
        const member = msg.new_chat_member;

        // Log the restriction event
        logger.info(`Member restricted: ${member.username || member.first_name} (${member.id}) in chat ${chatId}`);

        // Handle different types of restrictions
        if (!member.can_send_messages) {
            // Member was muted
            await queries.logInfraction(
                member.id,
                'MUTE',
                'User was muted by an admin',
                'MUTE',
                null,
                msg.from.id
            );
        }
    } catch (error) {
        logger.error('Error handling member restricted:', error);
    }
}

module.exports = {
    handleNewMember,
    handleMemberLeft,
    handleMemberRestricted
}; 