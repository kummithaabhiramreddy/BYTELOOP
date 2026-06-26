const express = require('express');
const router = express.Router();
const db = require('./database');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

// Middleware to verify JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// 1. Android App Login (Returns JWT)
router.post('/login', async (req, res) => {
    const { phoneNumber, password } = req.body;
    const phoneClean = (phoneNumber || '').replace(/[^0-9]/g, '');
    
    try {
        const result = await db.query(
            `SELECT id, phoneNumber FROM Users WHERE phoneNumber = $1 AND password = $2`, 
            [phoneClean, password]
        );
        if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const user = result.rows[0];
        const accessToken = jwt.sign({ userId: user.id, phone: user.phonenumber }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ success: true, token: accessToken, userId: user.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Sync Local Data Usage (from Android NetworkStatsManager)
router.post('/sync-usage', authenticateToken, async (req, res) => {
    const { dataUsedGB } = req.body; // Sent by Android app
    if (!dataUsedGB || dataUsedGB < 0) return res.status(400).json({ error: 'Invalid data amount' });
    
    try {
        await db.query('BEGIN');
        await db.query(`INSERT INTO UsageLogs (userId, dataUsed) VALUES ($1, $2)`, [req.user.userId, dataUsedGB]);
        await db.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

// 3. Fetch Wallet Status
router.get('/wallet', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(`SELECT totalDataQuota, vaultData FROM Users WHERE id = $1`, [req.user.userId]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
        
        const user = result.rows[0];
        
        const logsRes = await db.query(`SELECT sum(dataUsed) as totalused FROM UsageLogs WHERE userId = $1`, [req.user.userId]);
        const totalUsed = logsRes.rows[0].totalused || 0;
        
        const unusedData = Math.max(0, user.totaldataquota - totalUsed);
        
        res.json({
            quotaGB: user.totaldataquota,
            usedGB: totalUsed,
            unusedGB: unusedData,
            vaultCredits: Math.round(user.vaultdata * 1000)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. AI Prediction Endpoint (Predicts if user will run out of data before end of month)
router.get('/predict-usage', authenticateToken, async (req, res) => {
    try {
        const userRes = await db.query(`SELECT totalDataQuota FROM Users WHERE id = $1`, [req.user.userId]);
        if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
        
        const quotaGB = userRes.rows[0].totaldataquota;
        
        // Fetch last 30 logs (simulating historical data for a linear regression model)
        const logsRes = await db.query(`SELECT dataUsed, timestamp FROM UsageLogs WHERE userId = $1 ORDER BY timestamp DESC LIMIT 30`, [req.user.userId]);
        const logs = logsRes.rows;
        
        if (logs.length === 0) {
            return res.json({ 
                prediction: "Insufficient data to predict", 
                exhaustionProbability: 0,
                recommendedAction: "Keep using your device normally to gather usage statistics."
            });
        }
        
        const totalUsed = logs.reduce((sum, log) => sum + log.dataused, 0);
        const averageUsagePerEntry = totalUsed / logs.length;
        
        // Simple heuristic "AI" Prediction model logic:
        // Assuming user makes 1 entry per day, 30 days in a month
        const predictedMonthlyUsage = averageUsagePerEntry * 30;
        
        let exhaustionProbability = 0;
        let recommendedAction = "You're on track! No action needed.";
        
        if (predictedMonthlyUsage > quotaGB) {
            exhaustionProbability = Math.min(100, Math.round((predictedMonthlyUsage / quotaGB) * 100) - 100);
            recommendedAction = "Warning: High risk of running out of data. Consider purchasing a Data Pack or using Wi-Fi Marketplace.";
        } else if (predictedMonthlyUsage < (quotaGB * 0.5)) {
            recommendedAction = "You have excessive unused data. Consider selling it on the Hotspot marketplace or converting it to Credits!";
        }
        
        res.json({
            quotaGB: quotaGB,
            predictedMonthlyUsageGB: parseFloat(predictedMonthlyUsage.toFixed(2)),
            exhaustionProbabilityPct: exhaustionProbability,
            recommendedAction: recommendedAction
        });
        
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
