const config = require('../config/config');

// ANSI color codes for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

// Log levels and their corresponding colors
const logLevels = {
    error: { priority: 0, color: colors.red },
    warn: { priority: 1, color: colors.yellow },
    info: { priority: 2, color: colors.green },
    debug: { priority: 3, color: colors.blue }
};

// Get current log level priority from config
const currentLogLevelPriority = logLevels[config.logLevel || 'info'].priority;

/**
 * Format the current timestamp
 * @returns {string} Formatted timestamp
 */
function getTimestamp() {
    const now = new Date();
    return now.toISOString();
}

/**
 * Format a log message with timestamp and optional metadata
 * @param {string} level Log level
 * @param {string} message Main log message
 * @param {Object} [metadata] Additional metadata to log
 * @returns {string} Formatted log message
 */
function formatLogMessage(level, message, metadata = null) {
    const timestamp = getTimestamp();
    const levelColor = logLevels[level].color;
    
    let formattedMessage = `${colors.dim}${timestamp}${colors.reset} ${levelColor}${level.toUpperCase()}${colors.reset}: ${message}`;
    
    if (metadata) {
        const metadataStr = JSON.stringify(metadata, null, 2);
        formattedMessage += `\n${colors.dim}${metadataStr}${colors.reset}`;
    }
    
    return formattedMessage;
}

/**
 * Write a log message to the appropriate output
 * @param {string} level Log level
 * @param {string} message Log message
 * @param {Object} [metadata] Additional metadata
 */
function writeLog(level, message, metadata = null) {
    // Check if we should log this level
    if (logLevels[level].priority > currentLogLevelPriority) {
        return;
    }

    const formattedMessage = formatLogMessage(level, message, metadata);

    // Write to appropriate output
    if (level === 'error') {
        console.error(formattedMessage);
    } else {
        console.log(formattedMessage);
    }

    // Here you could add additional log destinations (file, external service, etc.)
}

/**
 * Clean sensitive data from objects before logging
 * @param {Object} obj Object to clean
 * @returns {Object} Cleaned object
 */
function cleanSensitiveData(obj) {
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
    
    // Handle non-objects and null
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    try {
        // Use JSON methods to handle circular references automatically
        const stringified = JSON.stringify(obj, (key, value) => {
            // Handle Error objects
            if (value instanceof Error) {
                return {
                    name: value.name,
                    message: value.message,
                    stack: value.stack
                };
            }

            // Redact sensitive values
            if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
                return '[REDACTED]';
            }

            return value;
        });

        return JSON.parse(stringified);
    } catch (error) {
        // If JSON.stringify fails (e.g., due to circular references), return a simplified object
        if (obj instanceof Error) {
            return {
                name: obj.name,
                message: obj.message,
                stack: obj.stack
            };
        }

        // For other objects, return a basic representation
        return {
            type: obj.constructor.name,
            toString: obj.toString(),
            error: 'Object could not be fully serialized'
        };
    }
}

// Logger interface
const logger = {
    error(message, metadata = null) {
        if (metadata) {
            metadata = cleanSensitiveData(metadata);
        }
        writeLog('error', message, metadata);
    },

    warn(message, metadata = null) {
        if (metadata) {
            metadata = cleanSensitiveData(metadata);
        }
        writeLog('warn', message, metadata);
    },

    info(message, metadata = null) {
        if (metadata) {
            metadata = cleanSensitiveData(metadata);
        }
        writeLog('info', message, metadata);
    },

    debug(message, metadata = null) {
        if (metadata) {
            metadata = cleanSensitiveData(metadata);
        }
        writeLog('debug', message, metadata);
    },

    /**
     * Log the start of an operation
     * @param {string} operation Operation name
     * @param {Object} [metadata] Operation metadata
     */
    startOperation(operation, metadata = null) {
        this.info(`Starting ${operation}`, metadata);
    },

    /**
     * Log the end of an operation
     * @param {string} operation Operation name
     * @param {number} startTime Operation start time
     * @param {Object} [metadata] Operation metadata
     */
    endOperation(operation, startTime, metadata = null) {
        const duration = Date.now() - startTime;
        this.info(`Completed ${operation} in ${duration}ms`, metadata);
    },

    /**
     * Log an error with stack trace
     * @param {string} message Error message
     * @param {Error} error Error object
     * @param {Object} [metadata] Additional metadata
     */
    errorWithStack(message, error, metadata = null) {
        const errorMetadata = {
            ...metadata,
            stack: error.stack,
            name: error.name,
            message: error.message
        };
        this.error(message, errorMetadata);
    }
};

// Freeze the logger object to prevent modifications
Object.freeze(logger);

module.exports = {
    logger
}; 