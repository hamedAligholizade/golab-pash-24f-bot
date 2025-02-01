/**
 * Format a duration string into a human-readable format
 * @param {string} duration Duration string (e.g., '1 hour', '2 days')
 * @returns {string} Formatted duration
 */
function formatDuration(duration) {
    if (!duration) return 'indefinite';

    const parts = duration.split(' ');
    if (parts.length !== 2) return duration;

    const value = parseInt(parts[0]);
    const unit = parts[1].toLowerCase();

    if (isNaN(value)) return duration;

    switch (unit) {
        case 'second':
        case 'seconds':
            return `${value} second${value === 1 ? '' : 's'}`;
        case 'minute':
        case 'minutes':
            return `${value} minute${value === 1 ? '' : 's'}`;
        case 'hour':
        case 'hours':
            return `${value} hour${value === 1 ? '' : 's'}`;
        case 'day':
        case 'days':
            return `${value} day${value === 1 ? '' : 's'}`;
        case 'week':
        case 'weeks':
            return `${value} week${value === 1 ? '' : 's'}`;
        case 'month':
        case 'months':
            return `${value} month${value === 1 ? '' : 's'}`;
        default:
            return duration;
    }
}

/**
 * Format a number with appropriate suffixes
 * @param {number} num Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

/**
 * Format a date relative to now
 * @param {Date} date Date to format
 * @returns {string} Formatted date string
 */
function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
        return date.toLocaleDateString();
    }
    if (days > 0) {
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }
    if (hours > 0) {
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    if (minutes > 0) {
        return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    }
    return 'just now';
}

/**
 * Format bytes into human-readable size
 * @param {number} bytes Number of bytes
 * @returns {string} Formatted size string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format a username for display
 * @param {Object} user User object
 * @returns {string} Formatted username
 */
function formatUsername(user) {
    if (!user) return 'Unknown User';
    
    if (user.username) {
        return `@${user.username}`;
    }
    
    const name = [user.first_name, user.last_name]
        .filter(Boolean)
        .join(' ');
    
    return name || `User${user.id}`;
}

/**
 * Format message content for display
 * @param {string} content Message content
 * @param {number} maxLength Maximum length
 * @returns {string} Formatted content
 */
function formatMessageContent(content, maxLength = 50) {
    if (!content) return '[No Content]';
    
    // Remove extra whitespace
    content = content.replace(/\s+/g, ' ').trim();
    
    // Truncate if too long
    if (content.length > maxLength) {
        return content.substring(0, maxLength - 3) + '...';
    }
    
    return content;
}

/**
 * Format a list of items
 * @param {Array} items Array of items
 * @param {string} conjunction Conjunction to use (e.g., 'and', 'or')
 * @returns {string} Formatted list
 */
function formatList(items, conjunction = 'and') {
    if (!items || items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
    
    return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

/**
 * Format a role name
 * @param {string} role Role name
 * @returns {string} Formatted role name
 */
function formatRole(role) {
    switch (role.toLowerCase()) {
        case 'admin':
            return '👑 Admin';
        case 'moderator':
            return '🛡️ Moderator';
        case 'member':
            return '👤 Member';
        default:
            return role;
    }
}

/**
 * Format an error message for users
 * @param {Error} error Error object
 * @returns {string} User-friendly error message
 */
function formatErrorMessage(error) {
    // Common error messages
    const errorMessages = {
        'ETELEGRAM': 'A Telegram error occurred. Please try again later.',
        'ECONNREFUSED': 'Could not connect to the server. Please try again later.',
        'ETIMEDOUT': 'The request timed out. Please try again.',
        'ENOTFOUND': 'Could not reach the server. Please check your connection.'
    };

    // Get the error code (if any)
    const errorCode = error.code || error.message.split(':')[0];

    // Return user-friendly message or generic error
    return errorMessages[errorCode] || 'An error occurred. Please try again later.';
}

module.exports = {
    formatDuration,
    formatNumber,
    formatRelativeTime,
    formatBytes,
    formatUsername,
    formatMessageContent,
    formatList,
    formatRole,
    formatErrorMessage
}; 