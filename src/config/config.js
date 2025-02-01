require('dotenv').config();

module.exports = {
    // Bot Configuration
    botToken: process.env.BOT_TOKEN,
    adminUserId: process.env.ADMIN_USER_ID,
    
    // Database Configuration
    dbUser: process.env.DB_USER,
    dbHost: process.env.DB_HOST,
    dbName: process.env.DB_NAME,
    dbPassword: process.env.DB_PASSWORD,
    dbPort: process.env.DB_PORT || 5432,
    
    // Moderation Settings
    defaultSpamSensitivity: 5,
    maxWarnings: 3,
    defaultMuteDuration: '1 hour',
    defaultBanDuration: '1 day',
    
    // Message Limits
    maxMessagesPerMinute: 10,
    maxSimilarMessages: 3,
    
    // Feature Flags
    enableAntiSpam: true,
    enableContentFilter: true,
    enableWelcomeMessage: true,
    enableAutoModeration: true,
    enableUserStats: true,
    enablePolls: true,
    enableEvents: true,
    enableFeedback: true,
    
    // Custom Settings
    welcomeMessage: process.env.WELCOME_MESSAGE || 'Welcome to our group! 👋\nPlease read the rules and enjoy your stay!',
    defaultRules: process.env.DEFAULT_RULES || `📜 Group Rules:
1. Be respectful to all members
2. No spam or self-promotion
3. No NSFW content
4. No hate speech or harassment
5. Follow the admins' instructions

Breaking these rules may result in warnings, mutes, or bans.`,
    
    // Command Prefixes
    commandPrefix: '/',
    adminCommandPrefix: '!',
    
    // Timeouts and Intervals
    userStatsUpdateInterval: 5 * 60 * 1000, // 5 minutes
    dailySummaryTime: '00:00', // UTC time for daily summary
    temporaryBanCheckInterval: 60 * 1000, // 1 minute
    
    // Backup Settings
    backupInterval: 24 * 60 * 60 * 1000, // 24 hours
    maxBackupAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    
    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    
    // API Rate Limits
    apiRateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100 // limit each IP to 100 requests per windowMs
    }
}; 