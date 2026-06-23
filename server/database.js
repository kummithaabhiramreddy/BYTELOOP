const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'internet_storage',
    password: process.env.PGPASSWORD || 'admin123',
    port: process.env.PGPORT || 5432,
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

async function initDB() {
    const client = await pool.connect();
    try {
        console.log('Connected to PostgreSQL database.');
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS Users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                totalDataQuota REAL NOT NULL,
                vaultData REAL DEFAULT 0,
                rewardPoints INTEGER DEFAULT 0
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS UsageLogs (
                id SERIAL PRIMARY KEY,
                userId INTEGER REFERENCES Users(id),
                dataUsed REAL NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS Transactions (
                id SERIAL PRIMARY KEY,
                fromUserId INTEGER,
                toUserId INTEGER,
                dataAmount REAL NOT NULL,
                type VARCHAR(50),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

    } catch (err) {
        console.error('Error initializing database schema:', err);
    } finally {
        client.release();
    }
}

initDB();

module.exports = {
    query: (text, params) => pool.query(text, params)
};
