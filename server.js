const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const db = require('./database');

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Webhook needs raw body, so place it before express.json()
app.use('/api/payment/webhook', express.raw({type: 'application/json'}));
app.use(express.json());
// Serve root folder static files
app.use(express.static(__dirname));

// ─── Profile File Fallback Paths ─────────────────────────────────
const PROFILE_PATH = path.join(__dirname, 'profile_data.json');

function loadProfileFile() {
    try {
        if (fs.existsSync(PROFILE_PATH)) {
            return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
        }
    } catch (e) { }
    const hex = () => Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    return {
        name: os.userInfo().username || 'ByteLoop User',
        networkId: `BL-${hex()}-${hex().substring(0, 2)}`,
        preferences: {
            autoConnect: true,
            notifSound: true,
            dataSaver: false,
            showSignal: true
        }
    };
}

function saveProfileFile(data) {
    const existing = loadProfileFile();
    const merged = { ...existing, ...data };
    if (data.preferences) {
        merged.preferences = { ...existing.preferences, ...data.preferences };
    }
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(merged, null, 2));
    return merged;
}

// ─── Apps Cache ─────────────────────────────────────────────────
const FALLBACK_APPS = [
    { id: 1, name: "Google Chrome", appId: "Chrome", iconData: null },
    { id: 2, name: "File Explorer", appId: "Microsoft.Windows.Explorer", iconData: null },
    { id: 3, name: "Calculator", appId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", iconData: null },
    { id: 4, name: "Command Prompt", appId: "cmd.exe", iconData: null },
    { id: 5, name: "Notepad", appId: "notepad.exe", iconData: null },
    { id: 6, name: "Settings", appId: "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel", iconData: null },
    { id: 7, name: "Microsoft Edge", appId: "MicrosoftEdge", iconData: null },
    { id: 8, name: "Task Manager", appId: "taskmgr.exe", iconData: null },
    { id: 9, name: "Word", appId: "winword.exe", iconData: null },
    { id: 10, name: "PowerShell", appId: "powershell.exe", iconData: null }
];

let cachedApps = null;
let isFetching = false;

// ─── Hotspot Mock State Removed ───────────────────────────

function fetchAppsData() {
    if (isFetching) return;
    if (os.platform() !== 'win32') {
        console.log("Not running on Windows (Vercel). Using fallback apps instantly.");
        cachedApps = FALLBACK_APPS;
        return;
    }
    
    isFetching = true;
    console.log("Fetching and caching Windows apps (this takes a few seconds)...");

    const scriptPath = path.join(__dirname, 'fetch_apps.ps1');
    exec(`powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}"`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        isFetching = false;
        if (error) {
            console.error(`Error executing PowerShell: ${error.message}`);
            if (!cachedApps) {
                cachedApps = FALLBACK_APPS;
            }
            return;
        }
        try {
            const startIdx = stdout.indexOf('[');
            const endIdx = stdout.lastIndexOf(']');
            if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
                throw new Error("Could not find JSON array bounds in PowerShell stdout");
            }
            const jsonStr = stdout.substring(startIdx, endIdx + 1);
            const appsData = JSON.parse(jsonStr);
            cachedApps = appsData.map((app, index) => ({
                id: index + 1,
                name: app.Name,
                appId: app.AppID,
                iconData: app.IconBase64 ? `data:image/png;base64,${app.IconBase64}` : null
            })).filter(app => app.name);
            console.log("Successfully cached", cachedApps.length, "apps with icons!");
        } catch (parseError) {
            console.error(`Error parsing JSON: ${parseError.message}`);
            if (!cachedApps) {
                cachedApps = FALLBACK_APPS;
            }
        }
    });
}

// Fetch apps on startup
fetchAppsData();

// ─── WiFi Helpers ───────────────────────────────────────────────
function parseWifiScan(output) {
    const networks = [];
    const blocks = output.split(/SSID\s+\d+\s*:/);
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const ssidMatch = block.match(/^\s*(.+)/);
        const signalMatch = block.match(/Signal\s*:\s*(\d+)%/i);
        const authMatch = block.match(/Authentication\s*:\s*(.+)/i);

        if (ssidMatch) {
            const ssid = ssidMatch[1].trim();
            if (!ssid) continue;
            const signalPct = signalMatch ? parseInt(signalMatch[1]) : 0;
            const auth = authMatch ? authMatch[1].trim() : 'Open';
            const strength = signalPct > 75 ? 4 : signalPct > 50 ? 3 : signalPct > 25 ? 2 : 1;
            const secure = auth.toLowerCase() !== 'open';

            if (!networks.find(n => n.ssid === ssid)) {
                networks.push({ ssid, strength, secure, signal: signalPct + '%', auth });
            }
        }
    }
    networks.sort((a, b) => b.strength - a.strength);
    return networks;
}

function parseWifiStatus(output) {
    const state = output.match(/State\s*:\s*(.+)/i);
    const ssid = output.match(/SSID\s*:\s*(.+)/i);
    const signal = output.match(/Signal\s*:\s*(\d+%)/i);
    const auth = output.match(/Authentication\s*:\s*(.+)/i);
    const channel = output.match(/Channel\s*:\s*(\d+)/i);
    const receive = output.match(/Receive rate\s*\(Mbps\)\s*:\s*(.+)/i);
    const transmit = output.match(/Transmit rate\s*\(Mbps\)\s*:\s*(.+)/i);

    const connected = state ? state[1].trim().toLowerCase() === 'connected' : false;

    return {
        connected,
        ssid: ssid ? ssid[1].trim() : null,
        signal: signal ? signal[1].trim() : null,
        auth: auth ? auth[1].trim() : null,
        channel: channel ? channel[1].trim() : null,
        receiveRate: receive ? receive[1].trim() : null,
        transmitRate: transmit ? transmit[1].trim() : null
    };
}

function getNetworkInterfaces() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return { ip: iface.address, type: name };
            }
        }
    }
    return { ip: 'N/A', type: 'None' };
}

// ─── API Routes: Apps ──────────────────────────────────────────
app.get('/api/apps', (req, res) => {
    if (cachedApps) {
        res.json(cachedApps);
    } else if (isFetching) {
        res.status(202).json({ status: 'loading', message: 'Apps are currently being processed.' });
    } else {
        cachedApps = FALLBACK_APPS;
        res.json(cachedApps);
    }
});

app.post('/api/apps/launch', (req, res) => {
    const { appId } = req.body;
    if (!appId) {
        return res.status(400).json({ success: false, error: 'App ID is required' });
    }

    console.log(`Launching application with AppID: ${appId}`);
    
    // If running on Vercel (Linux), simulate the launch since we can't open Windows apps from the cloud
    if (os.platform() !== 'win32') {
        console.log(`Mock launch on Vercel for ${appId}`);
        return res.json({ success: true, message: `Simulated app launch (${appId}) on cloud server.` });
    }

    const cmdShell = `cmd.exe /c start "" "shell:AppsFolder\\${appId}"`;
    const cmdDirect = `cmd.exe /c start "" "${appId}"`;

    exec(cmdShell, (err) => {
        if (err) {
            console.log(`Failed shell:AppsFolder launch, trying direct command: ${cmdDirect}`);
            exec(cmdDirect, (err2) => {
                if (err2) {
                    res.status(500).json({ success: false, error: 'Failed to launch app: ' + err2.message });
                } else {
                    res.json({ success: true, message: 'App launched (direct fallback)' });
                }
            });
        } else {
            res.json({ success: true, message: 'App launched (shell:AppsFolder)' });
        }
    });
});

// ─── Mock State Storage (PostgreSQL for Vercel) ────────────────

async function setMockState(key, value) {
    try {
        await db.query(`
            INSERT INTO MockState (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [key, JSON.stringify(value)]);
    } catch(e) { console.error("setMockState error", e); }
}

async function getMockState(key, defaultVal) {
    try {
        const res = await db.query('SELECT value FROM MockState WHERE key = $1', [key]);
        if (res.rows.length > 0) return res.rows[0].value;
    } catch(e) { console.error("getMockState error", e); }
    return defaultVal;
}

// ─── API Routes: WiFi ──────────────────────────────────────────
app.get('/api/wifi/scan', async (req, res) => {
    try {
        // Fetch all hotspotNetworkNames from the Neon database
        const result = await db.query('SELECT hotspotNetworkName FROM Users WHERE hotspotNetworkName IS NOT NULL');
        let networks = result.rows.map(row => ({ 
            ssid: row.hotspotnetworkname, 
            secure: true, 
            strength: Math.floor(Math.random() * 40) + 60 
        }));
        
        // Add a few dummy networks
        networks.push({ ssid: 'Starbucks_Guest', secure: false, strength: 80 });
        networks.push({ ssid: 'Office_5G', secure: true, strength: 95 });
        
        // Add our local mock hotspot if active
        let hotspot = await getMockState('hotspot', { active: false, name: null });
        if (hotspot.active && hotspot.name) {
            networks.push({ ssid: hotspot.name, secure: true, strength: 100 });
        }
        
        res.json(networks);
    } catch (err) {
        console.error("Failed to fetch networks from DB:", err);
        res.json([
            { ssid: 'Guest WiFi', secure: false, strength: 90 }
        ]);
    }
});

app.get('/api/wifi/status', async (req, res) => {
    const userId = req.query.userId;
    const key = userId ? `wifiConnected_${userId}` : 'wifiConnected';
    let connected = await getMockState(key, null);
    
    let ownerName = null;
    if (connected) {
        try {
            const ownerResult = await db.query('SELECT phoneNumber FROM Users WHERE hotspotNetworkName = $1', [connected]);
            if (ownerResult.rows.length > 0) {
                ownerName = ownerResult.rows[0].phonenumber;
            }
        } catch (e) {
            console.error("Error getting wifi status owner info:", e);
        }
    }

    res.json({
        connected: connected !== null,
        ssid: connected,
        ownerName: ownerName,
        radioOn: true
    });
});

app.post('/api/wifi/connect', async (req, res) => {
    const { ssid, password, userId } = req.body;
    if (!ssid) {
        return res.status(400).json({ success: false, error: 'SSID is required' });
    }
    
    // Simulate connection delay
    setTimeout(async () => {
        const key = userId ? `wifiConnected_${userId}` : 'wifiConnected';
        await setMockState(key, ssid);

        // Find if this ssid corresponds to a user's hotspot in the DB
        try {
            const ownerResult = await db.query('SELECT id, phoneNumber FROM Users WHERE hotspotNetworkName = $1', [ssid]);
            if (ownerResult.rows.length > 0) {
                // Yes, this SSID matches a registered user's hotspot!
                const owner = ownerResult.rows[0];
                const ownerId = owner.id;
                
                let clientName = 'Connected Device';
                if (userId) {
                    const clientResult = await db.query('SELECT phoneNumber FROM Users WHERE id = $1', [userId]);
                    if (clientResult.rows.length > 0) {
                        clientName = clientResult.rows[0].phonenumber;
                    }
                }
                
                // Add the client to the owner's hotspot client list in the MockState
                const ownerKey = `hotspot_${ownerId}`;
                let hotspot = await getMockState(ownerKey, { active: true, name: ssid, clients: [] });
                if (!hotspot.clients) hotspot.clients = [];
                
                // Avoid duplicates
                if (!hotspot.clients.some(c => c.name === clientName)) {
                    hotspot.clients.push({
                        name: clientName,
                        userId: userId,
                        ip: `192.168.137.${Math.floor(Math.random() * 240) + 10}`,
                        signal: 'Connected'
                    });
                    await setMockState(ownerKey, hotspot);
                }
            }
        } catch (e) {
            console.error("Error linking wifi client to hotspot owner:", e);
        }

        res.json({ success: true, message: `Connected to ${ssid}` });
    }, 1500);
});

app.post('/api/wifi/disconnect', async (req, res) => {
    const { userId } = req.body;
    const key = userId ? `wifiConnected_${userId}` : 'wifiConnected';
    
    try {
        let currentSSID = await getMockState(key, null);
        if (currentSSID) {
            const ownerResult = await db.query('SELECT id FROM Users WHERE hotspotNetworkName = $1', [currentSSID]);
            if (ownerResult.rows.length > 0) {
                const ownerId = ownerResult.rows[0].id;
                const ownerKey = `hotspot_${ownerId}`;
                let hotspot = await getMockState(ownerKey, { active: true, name: currentSSID, clients: [] });
                
                let clientName = 'Connected Device';
                if (userId) {
                    const clientResult = await db.query('SELECT phoneNumber FROM Users WHERE id = $1', [userId]);
                    if (clientResult.rows.length > 0) {
                        clientName = clientResult.rows[0].phonenumber;
                    }
                }
                
                if (hotspot.clients) {
                    hotspot.clients = hotspot.clients.filter(c => c.name !== clientName);
                    await setMockState(ownerKey, hotspot);
                }
            }
        }
    } catch (e) {
        console.error("Error cleaning client from hotspot on manual disconnect:", e);
    }

    await setMockState(key, null);
    res.json({ success: true, message: 'Disconnected from Wi-Fi' });
});

// ─── API Routes: Hotspot ───────────────────────────────────────
app.get('/api/hotspot/status', async (req, res) => {
    const userId = req.query.userId;
    const key = userId ? `hotspot_${userId}` : 'hotspot';
    let hotspot = await getMockState(key, { active: false, name: null, clients: [] });
    if (hotspot.active && hotspot.clients.length === 0) {
        hotspot.clients = [{ name: 'Simulated Device', ip: '192.168.137.10', signal: 'Connected' }];
    } else if (!hotspot.active) {
        hotspot.clients = [];
    }
    res.json(hotspot);
});

app.post('/api/hotspot/start', async (req, res) => {
    const { name, password, userId } = req.body;
    const hName = name || 'ByteLoop';
    const hPassword = password || 'ByteLoop123';

    if (hPassword.length < 8) {
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const key = userId ? `hotspot_${userId}` : 'hotspot';
    await setMockState(key, { active: true, name: hName, clients: [] });

    if (userId) {
        try {
            await db.query('UPDATE Users SET hotspotNetworkName = $1 WHERE id = $2', [hName, userId]);
        } catch (e) {
            console.error("Failed to update hotspotNetworkName in DB:", e);
        }
    }

    res.json({ success: true, message: 'Simulated hotspot started' });
});

app.post('/api/hotspot/stop', async (req, res) => {
    const { userId } = req.body;
    const key = userId ? `hotspot_${userId}` : 'hotspot';
    await setMockState(key, { active: false, name: null, clients: [] });

    if (userId) {
        try {
            await db.query('UPDATE Users SET hotspotNetworkName = NULL WHERE id = $1', [userId]);
        } catch (e) {
            console.error("Failed to clear hotspotNetworkName in DB:", e);
        }
    }

    res.json({ success: true, message: 'Simulated hotspot stopped' });
});

app.post('/api/hotspot/disconnect-client', async (req, res) => {
    const { clientName, userId } = req.body; // userId is owner's ID
    if (!userId || !clientName) {
        return res.status(400).json({ success: false, error: 'Owner userId and clientName are required' });
    }

    try {
        const ownerKey = `hotspot_${userId}`;
        let hotspot = await getMockState(ownerKey, { active: false, name: null, clients: [] });
        
        if (hotspot.clients) {
            const clientIdx = hotspot.clients.findIndex(c => c.name === clientName);
            if (clientIdx !== -1) {
                const client = hotspot.clients[clientIdx];
                const clientUserId = client.userId;
                
                // Set client's wifi status to disconnected
                if (clientUserId) {
                    await setMockState(`wifiConnected_${clientUserId}`, null);
                }
                
                // Remove client from list
                hotspot.clients.splice(clientIdx, 1);
                await setMockState(ownerKey, hotspot);
            }
        }
        res.json({ success: true, message: 'Client disconnected successfully' });
    } catch (e) {
        console.error("Failed to disconnect client:", e);
        res.status(500).json({ success: false, error: 'Failed to disconnect client' });
    }
});

// ─── API Routes: System Info ───────────────────────────────────
app.get('/api/system/info', async (req, res) => {
    const uptime = os.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const userId = req.query.userId;
    const key = userId ? `wifiConnected_${userId}` : 'wifiConnected';
    let connected = await getMockState(key, null);

    res.json({
        hostname: os.hostname(),
        username: os.userInfo().username,
        os: `${os.type()} ${os.release()}`,
        platform: `${os.platform()} ${os.arch()}`,
        network: {
            connected: connected !== null,
            type: connected !== null ? `WiFi (${connected})` : 'Disconnected',
            ip: '192.168.1.100',
            signal: connected !== null ? '100%' : 'N/A'
        },
        dataUsage: {
            sent: 124.5,
            received: 512.3
        },
        uptime: `${hours}h ${minutes}m`
    });
});

// ─── API Routes: User Profile Settings (JSON storage) ──────────
app.get('/api/profile', (req, res) => {
    res.json(loadProfileFile());
});

app.post('/api/profile', (req, res) => {
    try {
        const updated = saveProfileFile(req.body);
        res.json(updated);
    } catch (e) {
        res.status(400).json({ error: 'Invalid request body' });
    }
});

// ─── API Routes: Database Auth & Stats (PostgreSQL) ────────────
app.post('/api/register', async (req, res) => {
    const { phoneNumber, password } = req.body;
    if (!phoneNumber || !password) return res.status(400).json({ error: 'Phone number and password required' });
    
    // Validate phone number format (digits only, 10-15 length)
    const phoneClean = phoneNumber.replace(/[^0-9]/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 15) {
        return res.status(400).json({ error: 'Phone number must be 10-15 digits' });
    }
    
    try {
        const bankAccount = '416' + Math.floor(10000000 + Math.random() * 90000000).toString();
        const bankCvv = Math.floor(100 + Math.random() * 900).toString();
        const result = await db.query(
            `INSERT INTO Users (phoneNumber, password, totalDataQuota, vaultData, rewardPoints, bankAccount, bankBalance, bankCvv, bankAccountEdited) 
             VALUES ($1, $2, 10.0, 0, 0, $3, 100.00, $4, false) RETURNING id`, 
            [phoneClean, password, bankAccount, bankCvv]
        );
        res.json({ success: true, userId: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Phone number already registered' });
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { phoneNumber, password } = req.body;
    const phoneClean = (phoneNumber || '').replace(/[^0-9]/g, '');
    try {
        const result = await db.query(
            `SELECT id, phoneNumber FROM Users WHERE phoneNumber = $1 AND password = $2`, 
            [phoneClean, password]
        );
        if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid phone number or password' });
        res.json({ success: true, userId: result.rows[0].id, phoneNumber: result.rows[0].phonenumber });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const result = await db.query(`SELECT id, phoneNumber FROM Users WHERE phoneNumber != '0000000000'`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
            phoneNumber: user.phonenumber,
            totalDataQuota: user.totaldataquota,
            totalUsed: parseFloat(totalUsed.toFixed(2)),
            unusedData: parseFloat(unusedData.toFixed(2)),
            predictedFutureUsage: parseFloat(predictedFutureUsage.toFixed(2)),
            vaultData: user.vaultdata,
            rewardPoints: user.rewardpoints,
            bankAccount: user.bankaccount,
            bankBalance: user.bankbalance ? parseFloat(user.bankbalance) : 0.00,
            bankCvv: user.bankcvv,
            bankAccountEdited: user.bankaccountedited || false
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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

// ─── API Routes: Bank Account Edit ─────────────────────────────
app.post('/api/bank/update-account', async (req, res) => {
    const { userId, bankAccount, bankCvv } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (!bankAccount || !bankCvv) return res.status(400).json({ error: 'Bank account and CVV are required' });
    
    // Validate bank account (11 digits starting with 416)
    const accClean = bankAccount.replace(/[^0-9]/g, '');
    if (accClean.length !== 11 || !accClean.startsWith('416')) {
        return res.status(400).json({ error: 'Bank account must be 11 digits starting with 416' });
    }
    
    // Validate CVV (3 digits)
    const cvvClean = bankCvv.replace(/[^0-9]/g, '');
    if (cvvClean.length !== 3) {
        return res.status(400).json({ error: 'CVV must be 3 digits' });
    }
    
    try {
        // Check if bank account is already taken by another user
        const existingCheck = await db.query(
            `SELECT id FROM Users WHERE bankAccount = $1 AND id != $2`,
            [accClean, userId]
        );
        if (existingCheck.rowCount > 0) {
            return res.status(400).json({ error: 'This bank account number is already registered to another user' });
        }
        
        const result = await db.query(
            `UPDATE Users SET bankAccount = $1, bankCvv = $2, bankAccountEdited = true WHERE id = $3 RETURNING bankAccount, bankCvv, bankAccountEdited`,
            [accClean, cvvClean, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ 
            success: true, 
            bankAccount: result.rows[0].bankaccount, 
            bankCvv: result.rows[0].bankcvv,
            bankAccountEdited: true,
            message: 'Bank account updated successfully. You can now purchase data plans.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── API Routes: User Transaction History ──────────────────────
app.get('/api/transactions/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const result = await db.query(`
            SELECT t.id, t.dataAmount, t.type, t.paymentAmount, t.txRef, t.timestamp,
                   uf.phoneNumber as fromPhone, ut.phoneNumber as toPhone
            FROM Transactions t
            LEFT JOIN Users uf ON t.fromUserId = uf.id
            LEFT JOIN Users ut ON t.toUserId = ut.id
            WHERE t.fromUserId = $1 OR t.toUserId = $1
            ORDER BY t.timestamp DESC LIMIT 50
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/payment/receipt/:transactionId', async (req, res) => {
    const txId = req.params.transactionId;
    try {
        const result = await db.query(`
            SELECT t.id, t.dataAmount, t.type, t.paymentAmount, t.txRef, t.timestamp,
                   uf.phoneNumber as fromPhone, uf.bankAccount as fromAccount,
                   ut.phoneNumber as toPhone, ut.bankAccount as toAccount
            FROM Transactions t
            LEFT JOIN Users uf ON t.fromUserId = uf.id
            LEFT JOIN Users ut ON t.toUserId = ut.id
            WHERE t.id = $1 OR t.txRef = $1
        `, [txId]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Transaction not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- PLANS & PAYMENTS ----------
app.get('/api/plans', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM Plans ORDER BY price ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/plans', async (req, res) => {
    const { action, id, name, gb, price, description } = req.body;
    if (!action) return res.status(400).json({ error: 'Action is required' });
    try {
        if (action === 'add') {
            if (!name || gb == null || price == null) {
                return res.status(400).json({ error: 'Name, GB, and price are required to add a plan' });
            }
            const result = await db.query(
                `INSERT INTO Plans (name, gb, price, description) VALUES ($1, $2, $3, $4) RETURNING *`,
                [name, parseFloat(gb), parseFloat(price), description || '']
            );
            return res.json({ success: true, plan: result.rows[0] });
        } else if (action === 'edit') {
            if (!id || !name || gb == null || price == null) {
                return res.status(400).json({ error: 'Id, name, GB, and price are required to edit a plan' });
            }
            const result = await db.query(
                `UPDATE Plans SET name = $1, gb = $2, price = $3, description = $4 WHERE id = $5 RETURNING *`,
                [name, parseFloat(gb), parseFloat(price), description || '', id]
            );
            if (result.rowCount === 0) return res.status(404).json({ error: 'Plan not found' });
            return res.json({ success: true, plan: result.rows[0] });
        } else if (action === 'delete') {
            if (!id) return res.status(400).json({ error: 'Id is required to delete a plan' });
            const result = await db.query('DELETE FROM Plans WHERE id = $1 RETURNING id', [id]);
            if (result.rowCount === 0) return res.status(404).json({ error: 'Plan not found' });
            return res.json({ success: true, deletedId: id });
        } else {
            return res.status(400).json({ error: 'Invalid plan action: ' + action });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/bank/account-details/:accountNumber', async (req, res) => {
    const { accountNumber } = req.params;
    if (!accountNumber) {
        return res.status(400).json({ error: 'Account number is required' });
    }
    try {
        const result = await db.query(
            `SELECT bankAccount, bankBalance FROM Users WHERE bankAccount = $1`,
            [accountNumber]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Bank account not found' });
        }
        res.json({
            bankAccount: result.rows[0].bankaccount,
            bankBalance: parseFloat(result.rows[0].bankbalance || 0)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stripe Checkout Session
app.post('/api/payment/create-checkout-session', async (req, res) => {
    const { userId, planId } = req.body;
    if (!userId || !planId) {
        return res.status(400).json({ error: 'userId and planId are required' });
    }

    try {
        const planRes = await db.query(`SELECT id, name, gb, price FROM Plans WHERE id = $1`, [planId]);
        if (planRes.rowCount === 0) {
            return res.status(404).json({ error: 'Selected plan not found' });
        }
        
        const plan = planRes.rows[0];
        
        // Ensure price is in cents for Stripe
        const unitAmount = Math.round(parseFloat(plan.price) * 100);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: plan.name,
                            description: `${plan.gb} GB Data Quota`,
                        },
                        unit_amount: unitAmount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${req.protocol}://${req.get('host')}/wallet.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get('host')}/wallet.html?canceled=true`,
            metadata: {
                userId: userId,
                planId: planId,
                planGb: plan.gb.toString(),
            },
        });

        res.json({ id: session.id, url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/payment/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        if (endpointSecret) {
            event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        } else {
            // Fallback if no webhook secret is set
            event = JSON.parse(req.body.toString());
        }
    } catch (err) {
        console.error('Webhook signature verification failed.', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        const userId = session.metadata.userId;
        const planGb = parseFloat(session.metadata.planGb);
        const amountPaid = session.amount_total / 100;
        const txRef = session.payment_intent || session.id;

        try {
            await db.query('BEGIN');
            
            // Add plan quota to user
            await db.query(
                `UPDATE Users SET totalDataQuota = totalDataQuota + $1 WHERE id = $2`, 
                [planGb, userId]
            );

            // Find merchant account ID
            const merchantRes = await db.query(`SELECT id FROM Users WHERE bankAccount = '41658250083'`);
            let merchantId = merchantRes.rowCount > 0 ? merchantRes.rows[0].id : null;
            
            // Log transaction
            await db.query(
                `INSERT INTO Transactions (fromUserId, toUserId, dataAmount, type, paymentAmount, txRef) 
                 VALUES ($1, $2, $3, 'PURCHASE', $4, $5)`, 
                 [userId, merchantId, planGb, amountPaid, txRef]
            );

            await db.query('COMMIT');
            console.log(`Payment successful for user ${userId}, added ${planGb} GB.`);
        } catch (dbErr) {
            await db.query('ROLLBACK');
            console.error('Database error on webhook:', dbErr.message);
        }
    }

    res.json({received: true});
});

// ─── API Routes: Admin Dashboard ──────────────────────────────
app.get('/api/admin/overview', async (req, res) => {
    try {
        const usersRes = await db.query('SELECT count(*) as total FROM Users');
        const logsRes = await db.query('SELECT count(*) as total, COALESCE(sum(dataUsed),0) as totalData FROM UsageLogs');
        const txRes = await db.query('SELECT count(*) as total FROM Transactions');
        const vaultRes = await db.query('SELECT COALESCE(sum(vaultData),0) as totalVault, COALESCE(sum(rewardPoints),0) as totalRewards FROM Users');
        const revRes = await db.query("SELECT COALESCE(sum(paymentAmount),0) as totalRevenue FROM Transactions WHERE type = 'PURCHASE'");
        res.json({
            totalUsers: parseInt(usersRes.rows[0].total),
            totalUsageLogs: parseInt(logsRes.rows[0].total),
            totalDataConsumed: parseFloat(logsRes.rows[0].totaldata || 0),
            totalTransactions: parseInt(txRes.rows[0].total),
            totalVaultStored: parseFloat(vaultRes.rows[0].totalvault || 0),
            totalRewardPoints: parseInt(vaultRes.rows[0].totalrewards || 0),
            totalRevenue: parseFloat(revRes.rows[0].totalrevenue || 0)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await db.query('SELECT id, phoneNumber, totalDataQuota, vaultData, rewardPoints, bankAccount, bankBalance, bankAccountEdited FROM Users ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/usage-logs', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT ul.id, u.username, ul.dataUsed, ul.timestamp 
            FROM UsageLogs ul 
            LEFT JOIN Users u ON ul.userId = u.id 
            ORDER BY ul.timestamp DESC LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/transactions', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT t.id, uf.phoneNumber as fromUser, ut.phoneNumber as toUser, t.dataAmount, t.type, t.paymentAmount, t.txRef, t.timestamp
            FROM Transactions t
            LEFT JOIN Users uf ON t.fromUserId = uf.id
            LEFT JOIN Users ut ON t.toUserId = ut.id
            ORDER BY t.timestamp DESC LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`ByteLoop Unified Server running at http://localhost:${PORT}/`);
    });
}

module.exports = app;
