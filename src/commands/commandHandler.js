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
        await bot.sendMessage(chatId, 'سلام! من ربات مدیریت گروه شما هستم. برای دیدن دستورات موجود از /help استفاده کنید.');
    },

    '/help': async (bot, msg) => {
        const chatId = msg.chat.id;
        const helpText = `
دستورات موجود:

دستورات عمومی:
/rules - مشاهده قوانین گروه
/info - دریافت اطلاعات گروه
/stats - مشاهده آمار فعالیت شما
/top - مشاهده کاربران فعال برتر
/events - لیست رویدادهای پیش رو
/feedback <پیام> - ارسال بازخورد

دستورات کاربری:
/me - مشاهده پروفایل شما
/birthday <DD-MM> - تنظیم تاریخ تولد

دستورات رویداد:
/event_join <شناسه_رویداد> - پیوستن به رویداد
/event_leave <شناسه_رویداد> - ترک رویداد

دستورات مدیریتی (نیاز به دسترسی، فقط در سوپرگروه‌ها):
!ban - پاسخ: !ban <مدت> [دلیل]
      مستقیم: !ban <@نام‌کاربری> <مدت> [دلیل]
!unban <@نام‌کاربری> - رفع مسدودیت کاربر
!mute - پاسخ: !mute <مدت> [دلیل]
       مستقیم: !mute <@نام‌کاربری> <مدت> [دلیل]
!unmute - پاسخ: !unmute
         مستقیم: !unmute <@نام‌کاربری>
!warn - پاسخ: !warn [دلیل]
       مستقیم: !warn <@نام‌کاربری> [دلیل]
!kick - پاسخ: !kick [دلیل]
       مستقیم: !kick <@نام‌کاربری> [دلیل]
!pin - پاسخ به پیام با !pin
!unpin - پاسخ به پیام با !unpin، یا فقط !unpin برای برداشتن آخرین پیام سنجاق شده
!settings - مدیریت تنظیمات گروه
!poll - ایجاد نظرسنجی (سوال و گزینه‌ها را در خطوط جدید بنویسید)
!announce - ارسال اطلاعیه
!stats_all - مشاهده آمار گروه
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
📊 اطلاعات گروه
نام: ${chat.title}
تعداد اعضا: ${memberCount}
توضیحات: ${chat.description || 'بدون توضیحات'}
تاریخ ایجاد: ${new Date(chat.date * 1000).toLocaleDateString('fa-IR')}
`;
        await bot.sendMessage(chatId, info);
    },

    '/stats': async (bot, msg) => {
        const userId = msg.from.id;
        const stats = await queries.getTopUsers(1);
        const userStats = stats.find(s => s.user_id === userId);
        
        if (!userStats) {
            await bot.sendMessage(msg.chat.id, 'هنوز فعالیتی ثبت نشده است.');
            return;
        }

        const statsText = `
📊 آمار فعالیت شما
پیام‌ها: ${userStats.total_messages}
واکنش‌ها: ${userStats.total_reactions}
دستورات استفاده شده: ${userStats.total_commands}
`;
        await bot.sendMessage(msg.chat.id, statsText);
    },

    '/top': async (bot, msg) => {
        const topUsers = await queries.getTopUsers(10);
        let topText = '🏆 10 کاربر فعال برتر:\n\n';
        
        for (let i = 0; i < topUsers.length; i++) {
            const user = topUsers[i];
            topText += `${i + 1}. ${user.username || user.first_name}: ${user.total_messages} پیام\n`;
        }
        
        await bot.sendMessage(msg.chat.id, topText);
    },

    '/feedback': async (bot, msg) => {
        const feedback = msg.text.split(' ').slice(1).join(' ');
        if (!feedback) {
            await bot.sendMessage(msg.chat.id, 'لطفاً پیام بازخورد خود را وارد کنید: /feedback <پیام شما>');
            return;
        }

        await queries.submitFeedback(msg.from.id, feedback);
        await bot.sendMessage(msg.chat.id, 'از بازخورد شما متشکریم! 🙏');
    },

    // Admin Commands
    '!ban': async (bot, msg) => {
        if (!await isAdmin(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const args = msg.text.split(' ');
        let targetUser;
        let duration;
        let reason;

        if (msg.reply_to_message) {
            targetUser = msg.reply_to_message.from;
            duration = parseInt(args[1]);
            reason = args.slice(2).join(' ') || 'دلیلی ذکر نشده';
        } else {
            if (args.length < 3) {
                await bot.sendMessage(msg.chat.id, 'نحوه استفاده:\nپاسخ به پیام: !ban <مدت> [دلیل]\nیا: !ban <@نام‌کاربری> <مدت> [دلیل]\nمدت به دقیقه');
                return;
            }
            duration = parseInt(args[2]);
            reason = args.slice(3).join(' ') || 'دلیلی ذکر نشده';
        }

        if (isNaN(duration) || duration <= 0) {
            await bot.sendMessage(msg.chat.id, 'لطفاً مدت زمان معتبری به دقیقه وارد کنید.');
            return;
        }

        try {
            if (!msg.reply_to_message) {
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
                await bot.sendMessage(msg.chat.id, '⚠️ شما نمی‌توانید مدیران یا ناظران را مسدود کنید.');
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
                until_date: Math.floor(Date.now() / 1000) + (duration * 60),
                revoke_messages: false // Don't delete previous messages
            });
            
            const banMsg = `🚫 ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} به مدت ${duration} دقیقه مسدود شد.\nدلیل: ${reason}`;
            try {
                await bot.sendMessage(msg.chat.id, banMsg);
            } catch (sendError) {
                logger.error('Error sending ban message:', {
                    error: sendError.message,
                    chatId: msg.chat.id,
                    targetUser: targetUser.id
                });
                // Try sending without the @ mention if that fails
                await bot.sendMessage(msg.chat.id, `🚫 کاربر به مدت ${duration} دقیقه مسدود شد.\nدلیل: ${reason}`);
            }

            // Log the ban
            await queries.logInfraction(targetUser.id, 'BAN', reason, 'BAN', `${duration} minutes`, msg.from.id);
        } catch (error) {
            logger.error('Error banning user:', error);
            await bot.sendMessage(
                msg.chat.id,
                error.message === 'Could not find user. Make sure the username or ID is correct.'
                    ? error.message
                    : 'خطا در مسدود کردن کاربر. لطفاً نام کاربری/شناسه را بررسی کرده و دوباره تلاش کنید.'
            );
        }
    },

    '!unban': async (bot, msg) => {
        if (!await isAdmin(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 2) {
            await bot.sendMessage(msg.chat.id, 'نحوه استفاده: !unban <کاربر>\nمی‌توانید کاربر را با نام کاربری (@username) یا شناسه مشخص کنید.');
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

            const unbanMsg = `✅ کاربر ${targetUser.username ? '@' + targetUser.username : `شناسه: ${targetUser.id}`} از مسدودیت خارج شد.`;
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
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const args = msg.text.split(' ');
        let targetUser;
        let reason;

        // Check if command is a reply to a message
        if (msg.reply_to_message) {
            targetUser = msg.reply_to_message.from;
            reason = args.slice(1).join(' ') || 'دلیلی ذکر نشده';
        } else {
            if (args.length < 2) {
                await bot.sendMessage(msg.chat.id, 'نحوه استفاده:\nپاسخ به پیام: !warn [دلیل]\nیا: !warn <@نام‌کاربری> [دلیل]');
                return;
            }
            reason = args.slice(2).join(' ') || 'دلیلی ذکر نشده';
        }

        try {
            if (!msg.reply_to_message) {
                // Get user by username or ID
                const userIdentifier = args[1].startsWith('@') ? args[1].substring(1) : args[1];
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
                await bot.sendMessage(msg.chat.id, '⚠️ شما نمی‌توانید مدیران یا ناظران را اخطار دهید.');
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
            const warningMsg = `⚠️ ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} اخطار دریافت کرد.\nدلیل: ${reason}`;
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
                    `کاربر به ${warningCount} اخطار رسید و به مدت 1 ساعت سکوت شد.`
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
        if (!await isAdmin(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const text = msg.text.trim();
        const lines = text.split('\n');

        if (lines.length < 3) {
            const usage = `نحوه استفاده: !poll
<سوال>
<گزینه 1>
<گزینه 2>
[گزینه 3]
...

مثال:
!poll
رنگ مورد علاقه شما چیست؟
قرمز
آبی
سبز`;
            await bot.sendMessage(msg.chat.id, usage);
            return;
        }

        const question = lines[1];
        const options = lines.slice(2).filter(line => line.trim());

        if (options.length < 2 || options.length > 10) {
            await bot.sendMessage(msg.chat.id, '⚠️ نظرسنجی باید بین 2 تا 10 گزینه داشته باشد.');
            return;
        }

        try {
            const pollMessage = await createPoll(bot, msg.chat.id, question, options);
            logger.info(`نظرسنجی توسط ${msg.from.username || msg.from.id} در گروه ${msg.chat.id} ایجاد شد`, { messageId: pollMessage.message_id });
        } catch (error) {
            logger.error('Error creating poll:', error);
            await bot.sendMessage(msg.chat.id, '❌ خطا در ایجاد نظرسنجی. لطفاً دوباره تلاش کنید.');
        }
    },

    '!settings': async (bot, msg) => {
        if (!await isAdmin(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const settings = await queries.getGroupSettings(msg.chat.id);
        const settingsText = `
تنظیمات فعلی گروه:

پیام خوش‌آمدگویی: ${settings?.welcome_message || config.welcomeMessage}
قوانین: ${settings?.rules || config.defaultRules}
حساسیت به اسپم: ${settings?.spam_sensitivity || config.defaultSpamSensitivity}
حداکثر اخطارها: ${settings?.max_warnings || config.maxWarnings}
مدت سکوت: ${formatDuration(settings?.mute_duration || config.defaultMuteDuration)}
مدت مسدودیت: ${formatDuration(settings?.ban_duration || config.defaultBanDuration)}

برای تغییر تنظیمات از دستورات زیر استفاده کنید:
!set welcome <پیام>
!set rules <قوانین>
!set spam_sensitivity <1-10>
!set max_warnings <تعداد>
!set mute_duration <مدت>
!set ban_duration <مدت>
`;
        await bot.sendMessage(msg.chat.id, settingsText);
    },

    '!mute': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const args = msg.text.split(' ');
        let targetUser;
        let duration;
        let reason;

        // Check if command is a reply to a message
        if (msg.reply_to_message) {
            targetUser = msg.reply_to_message.from;
            duration = parseInt(args[1]);
            reason = args.slice(2).join(' ') || 'دلیلی ذکر نشده';
        } else {
            if (args.length < 3) {
                await bot.sendMessage(msg.chat.id, 'نحوه استفاده:\nپاسخ به پیام: !mute <مدت> [دلیل]\nیا: !mute <@نام‌کاربری> <مدت> [دلیل]\nمدت به دقیقه');
                return;
            }
            duration = parseInt(args[2]);
            reason = args.slice(3).join(' ') || 'دلیلی ذکر نشده';
        }

        if (isNaN(duration) || duration <= 0) {
            await bot.sendMessage(msg.chat.id, 'لطفاً مدت زمان معتبری به دقیقه وارد کنید.');
            return;
        }

        try {
            if (!msg.reply_to_message) {
                // Get user by username or ID
                const userIdentifier = args[1].startsWith('@') ? args[1].substring(1) : args[1];
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
                await bot.sendMessage(msg.chat.id, '⚠️ شما نمی‌توانید مدیران یا ناظران را سکوت دهید.');
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
            await queries.logInfraction(targetUser.id, 'MUTE', reason, 'MUTE', `${duration} minutes`, msg.from.id);
            
            const muteMsg = `🔇 ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} به مدت ${duration} دقیقه سکوت شد.\nدلیل: ${reason}`;
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
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const args = msg.text.split(' ');
        if (args.length < 2) {
            await bot.sendMessage(msg.chat.id, 'نحوه استفاده: !unmute <کاربر>\nمی‌توانید کاربر را با نام کاربری (@username) یا با پاسخ به پیام آن انتخاب کنید.');
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
            
            const unmuteMsg = `🔊 ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} از سکوت خارج شد.`;
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
    },

    '!kick': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const args = msg.text.split(' ');
        let targetUser;
        let reason;

        // Check if command is a reply to a message
        if (msg.reply_to_message) {
            targetUser = msg.reply_to_message.from;
            reason = args.slice(1).join(' ') || 'دلیلی ذکر نشده';
        } else {
            if (args.length < 2) {
                await bot.sendMessage(msg.chat.id, 'نحوه استفاده:\nپاسخ به پیام: !kick [دلیل]\nیا: !kick <@نام‌کاربری> [دلیل]');
                return;
            }
            reason = args.slice(2).join(' ') || 'دلیلی ذکر نشده';
        }

        try {
            if (!msg.reply_to_message) {
                // Get user by username or ID
                const userIdentifier = args[1].startsWith('@') ? args[1].substring(1) : args[1];
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

            // Don't allow kicking admins/moderators
            const isTargetAdmin = await isAdmin(targetUser.id, msg.chat.id, bot);
            const isTargetMod = await isModerator(targetUser.id, msg.chat.id, bot);
            if (isTargetAdmin || isTargetMod) {
                await bot.sendMessage(msg.chat.id, '⚠️ شما نمی‌توانید مدیران یا ناظران را بندازید.');
                return;
            }

            // Save user to database first
            await queries.saveUser(
                targetUser.id,
                targetUser.username,
                targetUser.first_name,
                targetUser.last_name
            );

            // Kick the user
            await bot.banChatMember(msg.chat.id, targetUser.id);
            await bot.unbanChatMember(msg.chat.id, targetUser.id); // Immediately unban to allow them to rejoin

            // Log the kick
            await queries.logInfraction(targetUser.id, 'KICK', reason, 'KICK', null, msg.from.id);
            
            const kickMsg = `👢 ${targetUser.username ? '@' + targetUser.username : targetUser.first_name} به مدت ${duration} دقیقه بندازید.\nدلیل: ${reason}`;
            await bot.sendMessage(msg.chat.id, kickMsg);
        } catch (error) {
            logger.error('Error kicking user:', {
                error: error.message,
                stack: error.stack,
                command: msg.text,
                chatId: msg.chat.id,
                fromUser: msg.from.id
            });
            await bot.sendMessage(msg.chat.id, error.message);
        }
    },

    '!pin': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        if (!msg.reply_to_message) {
            await bot.sendMessage(msg.chat.id, 'نحوه استفاده: پاسخ به پیام با !pin برای سنجاق کردن آن.');
            return;
        }

        try {
            await bot.pinChatMessage(msg.chat.id, msg.reply_to_message.message_id);
            await bot.sendMessage(msg.chat.id, '📌 پیام با موفقیت سنجاق شد.');
        } catch (error) {
            logger.error('Error pinning message:', error);
            await bot.sendMessage(msg.chat.id, 'خطا در سنجاق کردن پیام. لطفاً دوباره تلاش کنید.');
        }
    },

    '!unpin': async (bot, msg) => {
        if (!await isModerator(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        if (!msg.reply_to_message) {
            // If no message is replied to, unpin the last pinned message
            await bot.unpinChatMessage(msg.chat.id);
            await bot.sendMessage(msg.chat.id, '📌 آخرین پیام سنجاق شده برداشته شد.');
        } else {
            await bot.unpinChatMessage(msg.chat.id, {
                message_id: msg.reply_to_message.message_id
            });
            await bot.sendMessage(msg.chat.id, '📌 پیام با موفقیت برداشته شد.');
        }
    },

    '!announce': async (bot, msg) => {
        if (!await isAdmin(msg.from.id, msg.chat.id, bot)) {
            await bot.sendMessage(msg.chat.id, 'شما دسترسی لازم برای استفاده از این دستور را ندارید.');
            return;
        }

        const announcement = msg.text.split('\n').slice(1).join('\n');
        if (!announcement) {
            await bot.sendMessage(msg.chat.id, 'نحوه استفاده: !announce\n<پیام اطلاعیه>\n\nپیام اطلاعیه را در یک خط جدید بعد از دستور وارد کنید.');
            return;
        }

        try {
            // Format the announcement message
            const formattedAnnouncement = `📢 *اطلاعیه*\n\n${announcement}\n\n_توسط: ${msg.from.username ? '@' + msg.from.username : msg.from.first_name}_`;

            // Send the announcement
            const sentMsg = await bot.sendMessage(msg.chat.id, formattedAnnouncement, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });

            // Pin the announcement if in a supergroup
            const chat = await bot.getChat(msg.chat.id);
            if (chat.type === 'supergroup') {
                try {
                    await bot.pinChatMessage(msg.chat.id, sentMsg.message_id);
                } catch (pinError) {
                    logger.error('Failed to pin announcement:', pinError);
                    // Don't throw here as the announcement was still sent
                }
            }
        } catch (error) {
            logger.error('Error sending announcement:', {
                error: error.message,
                stack: error.stack,
                chatId: msg.chat.id,
                fromUser: msg.from.id
            });
            await bot.sendMessage(msg.chat.id, 'خطا در ارسال اطلاعیه. لطفاً دوباره تلاش کنید.');
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