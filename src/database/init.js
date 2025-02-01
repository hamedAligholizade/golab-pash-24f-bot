const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');

const pool = new Pool({
    user: config.dbUser,
    host: config.dbHost,
    database: config.dbName,
    password: config.dbPassword,
    port: config.dbPort,
});

async function initDatabase() {
    try {
        // Read and execute schema.sql
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = await fs.readFile(schemaPath, 'utf8');
        
        await pool.query(schema);
        console.log('Database schema initialized successfully');

        // Insert default roles if they don't exist
        const defaultRoles = [
            {
                name: 'Admin',
                permissions: {
                    can_delete_messages: true,
                    can_ban_users: true,
                    can_manage_roles: true,
                    can_pin_messages: true,
                    can_create_polls: true,
                    can_invite_users: true
                }
            },
            {
                name: 'Moderator',
                permissions: {
                    can_delete_messages: true,
                    can_ban_users: true,
                    can_pin_messages: true,
                    can_create_polls: true,
                    can_invite_users: true
                }
            },
            {
                name: 'Member',
                permissions: {
                    can_create_polls: true
                }
            }
        ];

        for (const role of defaultRoles) {
            await pool.query(`
                INSERT INTO roles (
                    role_name,
                    can_delete_messages,
                    can_ban_users,
                    can_manage_roles,
                    can_pin_messages,
                    can_create_polls,
                    can_invite_users
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (role_name) DO NOTHING
            `, [
                role.name,
                role.permissions.can_delete_messages || false,
                role.permissions.can_ban_users || false,
                role.permissions.can_manage_roles || false,
                role.permissions.can_pin_messages || false,
                role.permissions.can_create_polls || false,
                role.permissions.can_invite_users || false
            ]);
        }

        console.log('Default roles initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}

module.exports = {
    pool,
    initDatabase
}; 