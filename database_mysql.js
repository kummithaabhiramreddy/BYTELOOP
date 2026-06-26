const mysql = require('mysql2/promise');
require('dotenv').config();

const connectionUri = process.env.MYSQL_URL || 'mysql://root:@localhost:3306/byteloop';

const pool = mysql.createPool(connectionUri);

async function initDB() {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log('Connected to MySQL database.');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                phoneNumber VARCHAR(20) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                totalDataQuota FLOAT NOT NULL DEFAULT 10.0,
                vaultData FLOAT DEFAULT 0,
                rewardPoints INT DEFAULT 0,
                bankAccount VARCHAR(255) UNIQUE,
                bankBalance DECIMAL(10, 2) DEFAULT 100.00,
                bankCvv VARCHAR(10) DEFAULT '123',
                bankAccountEdited BOOLEAN DEFAULT false,
                hotspotNetworkName VARCHAR(255),
                hotspotPrice FLOAT DEFAULT 50.0
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS UsageLogs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                userId INT,
                dataUsed FLOAT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                fromUserId INT,
                toUserId INT,
                dataAmount FLOAT NOT NULL,
                type VARCHAR(50),
                paymentAmount DECIMAL(10, 2) DEFAULT 0,
                txRef VARCHAR(50),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Plans (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL,
                gb FLOAT NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                description VARCHAR(255)
            )
        `);

        const [plansCheck] = await connection.query('SELECT count(*) as count FROM Plans');
        if (plansCheck[0].count === 0) {
            await connection.query(`
                INSERT INTO Plans (name, gb, price, description) VALUES
                ('Starter Pack', 5.0, 1.00, 'Great for basic browsing and email sync'),
                ('Value Pack', 15.0, 2.00, 'Perfect for streaming and daily usage'),
                ('Pro Pack', 50.0, 3.00, 'Ideal for heavy download and hot-spotting'),
                ('Elite Pack', 100.0, 4.00, 'Ultimate storage quota for power users')
            `);
            console.log('Default plans seeded.');
        }

        // Seed merchant account if it doesn't exist
        const [merchantCheck] = await connection.query(
            `SELECT id FROM Users WHERE bankAccount = '41658250083'`
        );
        if (merchantCheck.length === 0) {
            await connection.query(
                `INSERT INTO Users (phoneNumber, password, totalDataQuota, vaultData, rewardPoints, bankAccount, bankBalance, bankCvv, bankAccountEdited)
                 VALUES ('0000000000', 'merchant_internal', 0, 0, 0, '41658250083', 0.00, '999', true)`
            );
            console.log('Merchant account (41658250083) seeded.');
        }
        
    } catch (err) {
        console.error('Error initializing MySQL database schema:', err);
    } finally {
        if (connection) connection.release();
    }
}

initDB();

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
