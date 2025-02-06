const queries = require('../database/queries');
const { logger } = require('./logger');

async function setBirthday(userId, birthdayDate) {
    try {
        // Validate date format (DD-MM)
        const dateRegex = /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])$/;
        if (!dateRegex.test(birthdayDate)) {
            throw new Error('Invalid date format. Please use DD-MM format (e.g., 25-12)');
        }

        // Parse the date
        const [day, month] = birthdayDate.split('-').map(Number);

        // Validate date
        const isValidDate = validateDate(day, month);
        if (!isValidDate) {
            throw new Error('Invalid date. Please enter a valid date.');
        }

        // Create a date object for storage (using current year)
        const currentYear = new Date().getFullYear();
        const birthDate = new Date(currentYear, month - 1, day);

        // Update user's birthday in database
        await queries.updateUserBirthday(userId, birthDate);

        logger.info('Birthday set successfully', {
            userId: userId,
            birthday: birthdayDate
        });

        return {
            success: true,
            message: 'Birthday set successfully! 🎂'
        };
    } catch (error) {
        logger.error('Error setting birthday:', error);
        throw error;
    }
}

async function getBirthday(userId) {
    try {
        const user = await queries.getUserById(userId);
        if (!user || !user.birthday) {
            return null;
        }

        const birthday = new Date(user.birthday);
        return {
            day: birthday.getDate(),
            month: birthday.getMonth() + 1,
            formatted: `${String(birthday.getDate()).padStart(2, '0')}-${String(birthday.getMonth() + 1).padStart(2, '0')}`
        };
    } catch (error) {
        logger.error('Error getting birthday:', error);
        throw error;
    }
}

async function removeBirthday(userId) {
    try {
        await queries.updateUserBirthday(userId, null);
        logger.info('Birthday removed successfully', {
            userId: userId
        });

        return {
            success: true,
            message: 'Birthday removed successfully!'
        };
    } catch (error) {
        logger.error('Error removing birthday:', error);
        throw error;
    }
}

function validateDate(day, month) {
    // Check month range
    if (month < 1 || month > 12) return false;

    // Get last day of the month
    const currentYear = new Date().getFullYear();
    const lastDay = new Date(currentYear, month, 0).getDate();

    // Check day range
    return day >= 1 && day <= lastDay;
}

async function getUpcomingBirthdays(chatId, limit = 5) {
    try {
        const birthdays = await queries.getUpcomingBirthdays(chatId, limit);
        return birthdays.map(user => ({
            userId: user.user_id,
            username: user.username,
            firstName: user.first_name,
            birthday: new Date(user.birthday),
            daysUntil: calculateDaysUntil(new Date(user.birthday))
        }));
    } catch (error) {
        logger.error('Error getting upcoming birthdays:', error);
        throw error;
    }
}

function calculateDaysUntil(birthday) {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // Create this year's birthday date
    const thisYearBirthday = new Date(currentYear, birthday.getMonth(), birthday.getDate());
    
    // If birthday has passed this year, use next year's date
    if (thisYearBirthday < today) {
        thisYearBirthday.setFullYear(currentYear + 1);
    }
    
    // Calculate difference in days
    const diffTime = Math.abs(thisYearBirthday - today);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

module.exports = {
    setBirthday,
    getBirthday,
    removeBirthday,
    getUpcomingBirthdays
};