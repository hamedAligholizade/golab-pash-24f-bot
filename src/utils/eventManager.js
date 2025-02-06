const queries = require('../database/queries');
const { logger } = require('./logger');
const { formatDate } = require('./formatter');

async function createEvent(title, description, startTime, endTime, location, maxParticipants, createdBy) {
    try {
        const event = await queries.createEvent({
            title,
            description,
            start_time: startTime,
            end_time: endTime,
            location,
            max_participants: maxParticipants,
            created_by: createdBy
        });

        logger.info('Event created successfully', {
            eventId: event.event_id,
            createdBy: createdBy
        });

        return event;
    } catch (error) {
        logger.error('Error creating event:', error);
        throw error;
    }
}

async function joinEvent(eventId, userId) {
    try {
        const event = await queries.getEvent(eventId);
        if (!event) {
            throw new Error('Event not found');
        }

        // Check if event is full
        const participants = await queries.getEventParticipants(eventId);
        if (event.max_participants && participants.length >= event.max_participants) {
            throw new Error('Event is full');
        }

        // Check if user is already participating
        const isParticipating = participants.some(p => p.user_id === userId);
        if (isParticipating) {
            throw new Error('You are already participating in this event');
        }

        await queries.addEventParticipant(eventId, userId);
        logger.info('User joined event', {
            eventId: eventId,
            userId: userId
        });

        return {
            event,
            currentParticipants: participants.length + 1
        };
    } catch (error) {
        logger.error('Error joining event:', error);
        throw error;
    }
}

async function leaveEvent(eventId, userId) {
    try {
        const event = await queries.getEvent(eventId);
        if (!event) {
            throw new Error('Event not found');
        }

        await queries.removeEventParticipant(eventId, userId);
        logger.info('User left event', {
            eventId: eventId,
            userId: userId
        });

        return event;
    } catch (error) {
        logger.error('Error leaving event:', error);
        throw error;
    }
}

async function listEvents(chatId, includeExpired = false) {
    try {
        const events = await queries.getEvents(chatId, includeExpired);
        return events.map(event => ({
            ...event,
            start_time: formatDate(event.start_time),
            end_time: event.end_time ? formatDate(event.end_time) : null
        }));
    } catch (error) {
        logger.error('Error listing events:', error);
        throw error;
    }
}

async function getEventDetails(eventId) {
    try {
        const event = await queries.getEvent(eventId);
        if (!event) {
            throw new Error('Event not found');
        }

        const participants = await queries.getEventParticipants(eventId);
        return {
            ...event,
            start_time: formatDate(event.start_time),
            end_time: event.end_time ? formatDate(event.end_time) : null,
            participants: participants,
            participant_count: participants.length
        };
    } catch (error) {
        logger.error('Error getting event details:', error);
        throw error;
    }
}

async function cancelEvent(eventId, userId) {
    try {
        const event = await queries.getEvent(eventId);
        if (!event) {
            throw new Error('Event not found');
        }

        // Check if user is the event creator
        if (event.created_by !== userId) {
            throw new Error('Only the event creator can cancel the event');
        }

        await queries.deleteEvent(eventId);
        logger.info('Event cancelled', {
            eventId: eventId,
            cancelledBy: userId
        });

        return event;
    } catch (error) {
        logger.error('Error cancelling event:', error);
        throw error;
    }
}

module.exports = {
    createEvent,
    joinEvent,
    leaveEvent,
    listEvents,
    getEventDetails,
    cancelEvent
};