const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

const config = connectionString ? {
    connectionString,
    ssl: { rejectUnauthorized: false }
} : {
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'internet_storage',
    password: process.env.PGPASSWORD || 'admin123',
    port: process.env.PGPORT || 5432,
};

const pool = new Pool(config);

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});

async function initDB() {
    let client;
    try {
        client = await pool.connect();
        console.log('Connected to PostgreSQL database.');
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS Users (
                id SERIAL PRIMARY KEY,
                phoneNumber VARCHAR(20) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                totalDataQuota REAL NOT NULL DEFAULT 10.0,
                vaultData REAL DEFAULT 0,
                rewardPoints INTEGER DEFAULT 0,
                bankAccount VARCHAR(255) UNIQUE,
                bankBalance NUMERIC(10, 2) DEFAULT 100.00,
                bankCvv VARCHAR(10) DEFAULT '123',
                bankAccountEdited BOOLEAN DEFAULT false
            )
        `);

        // ── Migration: Add phoneNumber column for existing databases ──
        await client.query(`
            ALTER TABLE Users ADD COLUMN IF NOT EXISTS phoneNumber VARCHAR(20)
        `).catch(() => {});

        // Migrate existing username data to phoneNumber if phoneNumber is null
        await client.query(`
            UPDATE Users SET phoneNumber = username WHERE phoneNumber IS NULL AND username IS NOT NULL
        `).catch(() => {});

        // Drop NOT NULL constraint on username if it exists so new registrations without username succeed
        await client.query(`
            ALTER TABLE Users ALTER COLUMN username DROP NOT NULL
        `).catch(() => {});

        // Add bankAccountEdited column if it doesn't exist
        await client.query(`
            ALTER TABLE Users ADD COLUMN IF NOT EXISTS bankAccountEdited BOOLEAN DEFAULT false
        `).catch(() => {});

        // Add bank columns if they don't exist (for existing databases)
        await client.query(`
            ALTER TABLE Users ADD COLUMN IF NOT EXISTS bankAccount VARCHAR(255) UNIQUE
        `).catch(async (e) => {
            await client.query(`
                ALTER TABLE Users ADD CONSTRAINT users_bankaccount_key UNIQUE (bankAccount)
            `).catch(err => {
                if (err.code !== '42710') throw err;
            });
        });
        await client.query(`
            ALTER TABLE Users ADD COLUMN IF NOT EXISTS bankBalance NUMERIC(10, 2) DEFAULT 100.00
        `);
        await client.query(`
            ALTER TABLE Users ALTER COLUMN bankBalance TYPE NUMERIC(10, 2)
        `);
        await client.query(`
            ALTER TABLE Users ADD COLUMN IF NOT EXISTS bankCvv VARCHAR(10) DEFAULT '123'
        `);

        // Add paymentAmount and txRef columns to Transactions
        await client.query(`
            ALTER TABLE Transactions ADD COLUMN IF NOT EXISTS paymentAmount NUMERIC(10, 2) DEFAULT 0
        `);
        await client.query(`
            ALTER TABLE Transactions ALTER COLUMN paymentAmount TYPE NUMERIC(10, 2)
        `);
        await client.query(`
            ALTER TABLE Transactions ADD COLUMN IF NOT EXISTS txRef VARCHAR(50)
        `).catch(() => {});

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
                paymentAmount NUMERIC(10, 2) DEFAULT 0,
                txRef VARCHAR(50),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS Plans (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL,
                gb REAL NOT NULL,
                price NUMERIC(10, 2) NOT NULL,
                description VARCHAR(255)
            )
        `);

        const plansCheck = await client.query('SELECT count(*) as count FROM Plans');
        if (parseInt(plansCheck.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO Plans (name, gb, price, description) VALUES
                ('Starter Pack', 5.0, 1.00, 'Great for basic browsing and email sync'),
                ('Value Pack', 15.0, 2.00, 'Perfect for streaming and daily usage'),
                ('Pro Pack', 50.0, 3.00, 'Ideal for heavy download and hot-spotting'),
                ('Elite Pack', 100.0, 4.00, 'Ultimate storage quota for power users')
            `);
            console.log('Default plans seeded.');
        } else {
            // Update existing plans to the new cheaper prices
            await client.query(`UPDATE Plans SET price = 1.00 WHERE name = 'Starter Pack'`);
            await client.query(`UPDATE Plans SET price = 2.00 WHERE name = 'Value Pack'`);
            await client.query(`UPDATE Plans SET price = 3.00 WHERE name = 'Pro Pack'`);
            await client.query(`UPDATE Plans SET price = 4.00 WHERE name = 'Elite Pack'`);
        }

        // Seed merchant account if it doesn't exist
        const merchantCheck = await client.query(
            `SELECT id FROM Users WHERE bankAccount = '41658250083'`
        );
        if (merchantCheck.rowCount === 0) {
            await client.query(
                `INSERT INTO Users (phoneNumber, password, totalDataQuota, vaultData, rewardPoints, bankAccount, bankBalance, bankCvv, bankAccountEdited)
                 VALUES ('0000000000', 'merchant_internal', 0, 0, 0, '41658250083', 0.00, '999', true)
                 ON CONFLICT (phoneNumber) DO UPDATE SET bankAccount = '41658250083', bankCvv = '999'`
            );
            console.log('Merchant account (41658250083) seeded.');
        } else {
            await client.query(
                `UPDATE Users SET phoneNumber = COALESCE(phoneNumber, '0000000000'), bankCvv = '999' WHERE bankAccount = '41658250083'`
            );
        }

        // Backfill existing users who don't have a bank account assigned
        await client.query(`
            UPDATE Users SET bankAccount = '416' || LPAD(FLOOR(RANDOM() * 100000000)::TEXT, 8, '0')
            WHERE bankAccount IS NULL AND phoneNumber != '0000000000'
        `);

        // Backfill existing users who don't have a bank CVV code assigned
        await client.query(`
            UPDATE Users SET bankCvv = LPAD(FLOOR(RANDOM() * 900 + 100)::TEXT, 3, '0')
            WHERE bankCvv IS NULL AND phoneNumber != '0000000000'
        `);

    } catch (err) {
        console.error('Error initializing database schema:', err);
    } finally {
        if (client) client.release();
    }
}

initDB();

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
