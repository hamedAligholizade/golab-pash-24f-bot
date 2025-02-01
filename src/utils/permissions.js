const config = require('../config/config');
const queries = require('../database/queries');
const { logger } = require('./logger');

/**
 * Check if a user is an admin
 * @param {number} userId User ID to check
 * @param {number} chatId Chat ID to check in
 * @returns {Promise<boolean>} Whether the user is an admin
 */
async function isAdmin(userId, chatId) {
    try {
        // Check if user is the bot admin
        if (userId.toString() === config.adminUserId) {
            return true;
        }

        // Check user roles
        const roles = await queries.getUserRoles(userId);
        if (roles.some(role => role.role_name === 'Admin')) {
            return true;
        }

        // Check Telegram chat admin status
        const chatMember = await bot.getChatMember(chatId, userId);
        return ['creator', 'administrator'].includes(chatMember.status);
    } catch (error) {
        logger.error('Error checking admin status:', error);
        return false;
    }
}

/**
 * Check if a user is a moderator or higher
 * @param {number} userId User ID to check
 * @param {number} chatId Chat ID to check in
 * @returns {Promise<boolean>} Whether the user is a moderator or higher
 */
async function isModerator(userId, chatId) {
    try {
        // Admins are also moderators
        if (await isAdmin(userId, chatId)) {
            return true;
        }

        // Check user roles
        const roles = await queries.getUserRoles(userId);
        return roles.some(role => ['Moderator', 'Admin'].includes(role.role_name));
    } catch (error) {
        logger.error('Error checking moderator status:', error);
        return false;
    }
}

/**
 * Check if a user has a specific permission
 * @param {number} userId User ID to check
 * @param {string} permission Permission to check
 * @returns {Promise<boolean>} Whether the user has the permission
 */
async function hasPermission(userId, permission) {
    try {
        // Get user roles
        const roles = await queries.getUserRoles(userId);
        
        // Check if any role has the permission
        return roles.some(role => role[permission] === true);
    } catch (error) {
        logger.error('Error checking permission:', error);
        return false;
    }
}

/**
 * Get all permissions for a user
 * @param {number} userId User ID to check
 * @returns {Promise<Object>} Object containing all permissions and their values
 */
async function getUserPermissions(userId) {
    try {
        const roles = await queries.getUserRoles(userId);
        const permissions = {
            can_delete_messages: false,
            can_ban_users: false,
            can_manage_roles: false,
            can_pin_messages: false,
            can_create_polls: false,
            can_invite_users: false
        };

        // Combine permissions from all roles
        for (const role of roles) {
            for (const [permission, value] of Object.entries(role)) {
                if (permission in permissions) {
                    permissions[permission] = permissions[permission] || value;
                }
            }
        }

        return permissions;
    } catch (error) {
        logger.error('Error getting user permissions:', error);
        return null;
    }
}

/**
 * Check if a user can perform an action on another user
 * @param {number} actorId User ID performing the action
 * @param {number} targetId User ID being acted upon
 * @param {number} chatId Chat ID where the action is being performed
 * @returns {Promise<boolean>} Whether the action is allowed
 */
async function canActOnUser(actorId, targetId, chatId) {
    try {
        // Can't act on self
        if (actorId === targetId) {
            return false;
        }

        // Get roles for both users
        const actorRoles = await queries.getUserRoles(actorId);
        const targetRoles = await queries.getUserRoles(targetId);

        // Get highest role level for each user
        const getRoleLevel = (roleName) => {
            switch (roleName) {
                case 'Admin': return 3;
                case 'Moderator': return 2;
                case 'Member': return 1;
                default: return 0;
            }
        };

        const actorLevel = Math.max(...actorRoles.map(r => getRoleLevel(r.role_name)));
        const targetLevel = Math.max(...targetRoles.map(r => getRoleLevel(r.role_name)));

        // Actor must have higher role level than target
        return actorLevel > targetLevel;
    } catch (error) {
        logger.error('Error checking action permission:', error);
        return false;
    }
}

module.exports = {
    isAdmin,
    isModerator,
    hasPermission,
    getUserPermissions,
    canActOnUser
}; 