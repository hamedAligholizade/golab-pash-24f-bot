const config = require('../config/config');
const { logger } = require('./logger');

/**
 * Check if a message is spam based on various criteria
 * @param {string} text Message text to check
 * @param {Array} recentMessages Array of recent messages from the same user
 * @param {number} sensitivity Spam sensitivity level (1-10)
 * @returns {boolean} Whether the message is considered spam
 */
function isSpam(text, recentMessages, sensitivity = 5) {
    try {
        if (!text) return false;

        // Convert sensitivity to a 0-1 scale
        const sensitivityFactor = sensitivity / 10;

        // Check for common spam patterns
        const spamPatterns = [
            // Excessive capitalization
            text => {
                const caps = text.replace(/[^A-Z]/g, '').length;
                const total = text.replace(/[^a-zA-Z]/g, '').length;
                return total > 0 && (caps / total) > (0.7 - (sensitivityFactor * 0.2));
            },
            
            // Repeated characters
            text => {
                const repeats = text.match(/(.)\1{4,}/g);
                return repeats && repeats.length > (2 - Math.floor(sensitivityFactor * 2));
            },
            
            // URL spam
            text => {
                const urls = text.match(/https?:\/\/[^\s]+/g);
                return urls && urls.length > (2 - Math.floor(sensitivityFactor * 2));
            },
            
            // Repeated words
            text => {
                const words = text.toLowerCase().split(/\s+/);
                const wordCounts = {};
                words.forEach(word => {
                    wordCounts[word] = (wordCounts[word] || 0) + 1;
                });
                return Object.values(wordCounts).some(count => count > (3 - Math.floor(sensitivityFactor * 2)));
            },
            
            // Message length
            text => {
                return text.length > (500 - (sensitivityFactor * 200));
            },
            
            // Similar to recent messages
            text => {
                if (!recentMessages || recentMessages.length === 0) return false;
                return recentMessages.some(msg => {
                    if (!msg.text) return false;
                    const similarity = calculateSimilarity(text, msg.text);
                    return similarity > (0.8 - (sensitivityFactor * 0.2));
                });
            }
        ];

        // Count how many spam patterns match
        const spamScore = spamPatterns.reduce((score, pattern) => {
            return score + (pattern(text) ? 1 : 0);
        }, 0);

        // Calculate threshold based on sensitivity
        const threshold = Math.max(1, Math.floor(3 - (sensitivityFactor * 2)));

        return spamScore >= threshold;
    } catch (error) {
        logger.error('Error checking spam:', error);
        return false;
    }
}

/**
 * Check if text contains any banned content
 * @param {string} text Text to check
 * @param {Array} bannedContent Array of banned content objects
 * @returns {Object|null} Matched banned content or null if none found
 */
async function containsBannedContent(text, bannedContent) {
    try {
        if (!text || !bannedContent || bannedContent.length === 0) return null;

        // Convert text to lowercase for case-insensitive matching
        const lowerText = text.toLowerCase();

        // Sort banned content by severity (highest first)
        const sortedContent = [...bannedContent].sort((a, b) => b.severity - a.severity);

        for (const banned of sortedContent) {
            switch (banned.content_type) {
                case 'WORD':
                    // Check for exact word matches
                    const words = lowerText.split(/\W+/);
                    if (words.includes(banned.content.toLowerCase())) {
                        return banned;
                    }
                    break;

                case 'PHRASE':
                    // Check for phrase matches
                    if (lowerText.includes(banned.content.toLowerCase())) {
                        return banned;
                    }
                    break;

                case 'REGEX':
                    try {
                        // Check for regex matches
                        const regex = new RegExp(banned.content, 'i');
                        if (regex.test(text)) {
                            return banned;
                        }
                    } catch (error) {
                        logger.error('Invalid regex in banned content:', error);
                    }
                    break;

                case 'LINK':
                    // Check for link matches
                    const urlRegex = /(https?:\/\/[^\s]+)/gi;
                    const urls = text.match(urlRegex) || [];
                    for (const url of urls) {
                        if (url.toLowerCase().includes(banned.content.toLowerCase())) {
                            return banned;
                        }
                    }
                    break;
            }
        }

        return null;
    } catch (error) {
        logger.error('Error checking banned content:', error);
        return null;
    }
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * @param {string} str1 First string
 * @param {string} str2 Second string
 * @returns {number} Similarity score between 0 and 1
 */
function calculateSimilarity(str1, str2) {
    if (typeof str1 !== 'string' || typeof str2 !== 'string') return 0;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const costs = [];
    for (let i = 0; i <= shorter.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= longer.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (shorter[i - 1] !== longer[j - 1]) {
                    newValue = Math.min(
                        Math.min(newValue, lastValue),
                        costs[j]
                    ) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) {
            costs[longer.length] = lastValue;
        }
    }
    
    return (longer.length - costs[shorter.length]) / longer.length;
}

module.exports = {
    isSpam,
    containsBannedContent,
    calculateSimilarity
}; 