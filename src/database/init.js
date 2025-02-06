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

        // Create admin user if they don't exist
        if (config.adminUserId) {
            // Save admin user directly without using queries.js
            await pool.query(`
                INSERT INTO users (user_id, username, first_name, last_name, joined_date)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id) 
                DO UPDATE SET 
                    username = EXCLUDED.username,
                    first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name
                RETURNING *;
            `, [config.adminUserId, 'admin', 'Admin', null, new Date()]);
        }

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

        // Assign admin role to admin user if it exists
        if (config.adminUserId) {
            const roleResult = await pool.query('SELECT role_id FROM roles WHERE role_name = $1', ['Admin']);
            if (roleResult.rows[0]) {
                await pool.query(`
                    INSERT INTO user_roles (user_id, role_id, assigned_by)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (user_id, role_id) DO NOTHING
                `, [config.adminUserId, roleResult.rows[0].role_id, config.adminUserId]);
            }
        }

        console.log('Default roles initialized successfully');

        // Create infractions table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS infractions (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                type VARCHAR(50) NOT NULL,
                description TEXT,
                action_taken VARCHAR(50),
                duration INTERVAL,
                enforced_by BIGINT,
                processed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Add processed column if it doesn't exist
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 
                    FROM information_schema.columns 
                    WHERE table_name='infractions' AND column_name='processed'
                ) THEN
                    ALTER TABLE infractions ADD COLUMN processed BOOLEAN DEFAULT false;
                END IF;
            END $$;
        `);
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}

module.exports = {
    pool,
    initDatabase
}; 