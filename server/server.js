const express = require('express');
const cors = require('cors');
const db = require('./database');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('../client'));

// ---------- USER AUTHENTICATION ----------

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    try {
        const result = await db.query(
            `INSERT INTO Users (username, password, totalDataQuota, vaultData, rewardPoints) VALUES ($1, $2, 100.0, 0, 0) RETURNING id`, 
            [username, password]
        );
        res.json({ success: true, userId: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Username already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.query(`SELECT id, username FROM Users WHERE username = $1 AND password = $2`, [username, password]);
        if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });
        res.json({ success: true, userId: result.rows[0].id, username: result.rows[0].username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const result = await db.query(`SELECT id, username FROM Users`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- USAGE & STATS ----------

app.post('/api/usage', async (req, res) => {
    const { userId, dataUsed } = req.body;
    if (!userId || dataUsed == null) return res.status(400).json({ error: 'userId and dataUsed are required' });
    
    try {
        const result = await db.query(
            `INSERT INTO UsageLogs (userId, dataUsed) VALUES ($1, $2) RETURNING id`, 
            [userId, dataUsed]
        );
        res.json({ success: true, logId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const userRes = await db.query(`SELECT * FROM Users WHERE id = $1`, [userId]);
        if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
        const user = userRes.rows[0];
        
        const logsRes = await db.query(`SELECT * FROM UsageLogs WHERE userId = $1 ORDER BY timestamp DESC LIMIT 30`, [userId]);
        const logs = logsRes.rows;
        
        let totalUsed = logs.reduce((sum, log) => sum + log.dataused, 0); 
        let unusedData = user.totaldataquota - totalUsed;
        
        let predictedFutureUsage = logs.length > 0 ? (totalUsed / logs.length) * 30 : 0;
        
        res.json({
            user: user.username,
            totalDataQuota: user.totaldataquota,
            totalUsed: parseFloat(totalUsed.toFixed(2)),
            unusedData: parseFloat(unusedData.toFixed(2)),
            predictedFutureUsage: parseFloat(predictedFutureUsage.toFixed(2)),
            vaultData: user.vaultdata,
            rewardPoints: user.rewardpoints
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- VAULT & REWARDS ----------

app.post('/api/vault/save', async (req, res) => {
    const { userId } = req.body;
    try {
        await db.query('BEGIN');
        const userRes = await db.query(`SELECT totaldataquota FROM Users WHERE id = $1`, [userId]);
        if (userRes.rowCount === 0) throw new Error('User not found');
        const totalQuota = userRes.rows[0].totaldataquota;
        
        const logsRes = await db.query(`SELECT sum(dataUsed) as totalused FROM UsageLogs WHERE userId = $1`, [userId]);
        let totalUsed = logsRes.rows[0].totalused || 0;
        let unusedData = totalQuota - totalUsed;
        
        if (unusedData <= 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'No unused data to save' });
        }
        
        await db.query(
            `UPDATE Users SET vaultData = vaultData + $1, totalDataQuota = $2 WHERE id = $3`, 
            [unusedData, totalUsed, userId]
        );
        await db.query('COMMIT');
        res.json({ success: true, savedData: unusedData });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vault/retrieve', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        await db.query('BEGIN');
        const userRes = await db.query(`SELECT vaultdata FROM Users WHERE id = $1`, [userId]);
        if (userRes.rowCount === 0) throw new Error('User not found');
        
        let vaultData = userRes.rows[0].vaultdata;
        if (vaultData < amount || amount <= 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'Insufficient vault data' });
        }
        
        await db.query(
            `UPDATE Users SET vaultData = vaultData - $1, totalDataQuota = totalDataQuota + $1 WHERE id = $2`, 
            [amount, userId]
        );
        await db.query('COMMIT');
        res.json({ success: true, retrievedAmount: amount });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/gift', async (req, res) => {
    const { fromUserId, toUserId, dataAmount } = req.body;
    try {
        await db.query('BEGIN');
        const updateSender = await db.query(
            `UPDATE Users SET totalDataQuota = totalDataQuota - $1 WHERE id = $2 AND totalDataQuota >= $1 RETURNING id`, 
            [dataAmount, fromUserId]
        );
        if (updateSender.rowCount === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'Insufficient data or user not found' });
        }
        await db.query(`UPDATE Users SET totalDataQuota = totalDataQuota + $1 WHERE id = $2`, [dataAmount, toUserId]);
        await db.query(
            `INSERT INTO Transactions (fromUserId, toUserId, dataAmount, type) VALUES ($1, $2, $3, 'GIFT')`, 
            [fromUserId, toUserId, dataAmount]
        );
        await db.query('COMMIT');
        res.json({ success: true, giftedAmount: dataAmount });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`IoT Data Saver backend listening at http://localhost:${port}`);
});
