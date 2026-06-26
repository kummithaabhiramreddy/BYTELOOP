const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3000' ? 'http://localhost:3000' : '';

// ─── AUTH & SESSION STATE ───────────────────────────────────────
let currentUserId = localStorage.getItem('userId');
let currentUserName = localStorage.getItem('userName');

const state = {
    appInternet: false,
    wifi: false,
    hotspot: false,
    apps: false
};

let allAppsData = []; // Store the fetched apps globally for search
let userDataRemaining = 10.0; // Track remaining data for depletion check

// ─── DOM ELEMENTS ───────────────────────────────────────────────
const authScreen = document.getElementById('authScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const settingsScreen = document.getElementById('settingsScreen');
const userNameEl = document.getElementById('userName');
const dataProgressBar = document.getElementById('dataProgressBar');
const quotaValueEl = document.getElementById('quota-value');
const quotaUsedEl = document.getElementById('quota-used');
const quotaRemainingEl = document.getElementById('quota-remaining');

const btnInternet = document.getElementById('btn-internet');
const btnWifi = document.getElementById('btn-wifi');
const btnHotspot = document.getElementById('btn-hotspot');
const btnApps = document.getElementById('btn-apps');

const appViewer = document.getElementById('app-viewer');
const statusMessage = document.getElementById('status-message');
const appGrid = document.getElementById('app-grid');
const searchContainer = document.getElementById('search-container');
const searchInput = document.getElementById('app-search');

const dataToast = document.getElementById('dataToast');
const toastMsg = document.getElementById('toastMsg');

// ─── TOAST NOTIFICATION ─────────────────────────────────────────
function showToast(message, type) {
    toastMsg.textContent = message;
    if (type === 'success') {
        dataToast.style.background = 'linear-gradient(135deg, #38a169, #48bb78)';
        dataToast.style.boxShadow = '0 8px 32px rgba(56, 161, 105, 0.4)';
    } else {
        dataToast.style.background = 'linear-gradient(135deg, #f56565, #ed8936)';
        dataToast.style.boxShadow = '0 8px 32px rgba(245, 101, 101, 0.4)';
    }
    dataToast.classList.remove('show');
    // Force reflow to restart animation
    void dataToast.offsetWidth;
    dataToast.style.display = 'flex';
    dataToast.classList.add('show');
    setTimeout(() => {
        dataToast.classList.remove('show');
        setTimeout(() => { dataToast.style.display = 'none'; }, 500);
    }, 4000);
}

// ─── AUTH FLOW ──────────────────────────────────────────────────
function switchAuth(tab) {
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const authMsg = document.getElementById('authMsg');

    authMsg.style.display = 'none';
    authMsg.textContent = '';

    if (tab === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
    } else {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
    }
}

async function login() {
    const user = document.getElementById('loginPhone').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();

    if (!user || !pass) {
        showAuthMsg('Phone number and password are required', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: user, password: pass })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('userName', data.phoneNumber);
            currentUserId = data.userId;
            currentUserName = data.phoneNumber;

            // Instant wallet store: save user data to database within seconds
            instantWalletSync(data.userId);
            showDashboard();
        } else {
            showAuthMsg(data.error || 'Invalid credentials', 'error');
        }
    } catch (e) {
        showAuthMsg('Network error connecting to backend', 'error');
    }
}

async function register() {
    const user = document.getElementById('regPhone').value.trim();
    const pass = document.getElementById('regPassword').value.trim();

    if (!user || !pass) {
        showAuthMsg('Phone number and password are required', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: user, password: pass })
        });
        const data = await res.json();
        if (res.ok) {
            showAuthMsg('Account created successfully! Please login.', 'success');
            setTimeout(() => switchAuth('login'), 1500);
        } else {
            showAuthMsg(data.error || 'Phone number already exists', 'error');
        }
    } catch (e) {
        showAuthMsg('Network error connecting to backend', 'error');
    }
}

function logout() {
    localStorage.clear();
    currentUserId = null;
    currentUserName = null;
    dashboardScreen.style.display = 'none';
    if (settingsScreen) settingsScreen.style.display = 'none';
    authScreen.style.display = 'flex';
}

function showAuthMsg(text, type) {
    const msg = document.getElementById('authMsg');
    msg.textContent = text;
    msg.style.display = 'block';
    msg.className = `msg ${type === 'success' ? 'success-msg' : 'error-msg'}`;
}

function showDashboard() {
    authScreen.style.display = 'none';
    if (settingsScreen) settingsScreen.style.display = 'none';
    dashboardScreen.style.display = 'flex';
    userNameEl.textContent = currentUserName;
    fetchStats();
    updateUI();
}

function showSettings() {
    dashboardScreen.style.display = 'none';
    if (settingsScreen) settingsScreen.style.display = 'flex';
}

function hideSettings() {
    if (settingsScreen) settingsScreen.style.display = 'none';
    dashboardScreen.style.display = 'flex';
}

// ─── INSTANT WALLET SYNC ────────────────────────────────────────
// Stores user data to database instantly on login
async function instantWalletSync(userId) {
    try {
        await fetch(`${API_BASE}/api/vault/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId || currentUserId })
        });
    } catch (e) {
        // Silently handle - vault save is best-effort on login
    }
}

// ─── DATA UNIT FORMATTER ────────────────────────────────────────
function formatDataUnits(gbVal) {
    if (gbVal == null || isNaN(gbVal)) return '0 B';
    const bytes = parseFloat(gbVal) * 1024 * 1024 * 1024;
    if (bytes === 0) return '0 GB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const idx = Math.min(Math.max(i, 0), sizes.length - 1);
    const value = bytes / Math.pow(k, idx);
    return `${parseFloat(value.toFixed(2))} ${sizes[idx]}`;
}

// ─── STATS FETCHING ─────────────────────────────────────────────
async function fetchStats() {
    if (!currentUserId) return;
    try {
        const res = await fetch(`${API_BASE}/api/stats/${currentUserId}`);
        if (!res.ok) throw new Error('Stats fetch failed');
        const data = await res.json();

        const total = data.totalDataQuota || 10.0;
        const used = data.totalUsed || 0.0;
        const remaining = Math.max(total - used, 0.0);

        // Update global tracking
        userDataRemaining = remaining;

        const vault = data.vaultData || 0.0;
        quotaValueEl.textContent = `${Math.round(vault * 1000).toLocaleString()} Credits`;
        
        const quotaDeviceText = document.getElementById('quota-device-text');
        if (quotaDeviceText) {
            quotaDeviceText.textContent = `${remaining.toFixed(2)} GB Remaining`;
        }
        quotaUsedEl.textContent = `${used.toFixed(2)} GB`;
        quotaRemainingEl.textContent = `${total.toFixed(2)} GB`;

        let percent = (used / total) * 100;
        if (percent > 100) percent = 100;
        dataProgressBar.style.width = `${percent}%`;

        if (percent > 85) {
            dataProgressBar.style.background = 'linear-gradient(90deg, #ed8936, #f56565)';
        } else {
            dataProgressBar.style.background = 'linear-gradient(90deg, var(--primary), #667eea)';
        }

        // Update AI Optimizer display
        const aiPredictedEl = document.getElementById('ai-predicted');
        const aiRiskEl = document.getElementById('ai-risk');
        const aiRecommendationEl = document.getElementById('ai-recommendation');
        
        if (aiPredictedEl) {
            aiPredictedEl.textContent = `${Math.round(data.predictedFutureUsage * 1000).toLocaleString()} Credits`;
        }
        
        const wastageRisk = remaining > 2.0 ? 'High' : remaining > 0.5 ? 'Medium' : 'Low';
        if (aiRiskEl) {
            aiRiskEl.textContent = wastageRisk;
            if (wastageRisk === 'High') {
                aiRiskEl.style.color = '#ef4444';
            } else if (wastageRisk === 'Medium') {
                aiRiskEl.style.color = '#ed8936';
            } else {
                aiRiskEl.style.color = '#10b981';
            }
        }
        
        if (aiRecommendationEl) {
            if (remaining > 0.1) {
                aiRecommendationEl.innerHTML = `<i class="ph ph-warning-circle" style="vertical-align: middle; margin-right: 4px;"></i> AI: Convert <strong>${remaining.toFixed(2)} GB</strong> of unused data to <strong>${Math.round(remaining * 1000)} Credits</strong> before it expires!`;
            } else {
                aiRecommendationEl.innerHTML = `<i class="ph ph-check-circle" style="vertical-align: middle; margin-right: 4px;"></i> AI: Usage fully optimized. No significant wastage risk detected.`;
            }
        }

        // Perform AI Auto-Convert if enabled
        if (localStorage.getItem('aiAutoConvertState') === 'true' && remaining > 1.0) {
            console.log("AI Auto-Converting unused data...");
            fetch(`${API_BASE}/api/vault/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUserId })
            })
            .then(res => res.json())
            .then(() => {
                showToast(`AI Auto-Converted unused data into Credits!`, 'success');
                fetchStats();
            })
            .catch(e => console.error(e));
        }

        // Check data depletion
        if (remaining <= 0 && state.appInternet) {
            state.appInternet = false;
            localStorage.setItem('appInternetToggleState', 'false');
            updateUI();
            showToast('Your stored data is completed! App Internet disabled. Please store more data in your wallet.', 'error');
        }
    } catch (e) {
        console.error('Error fetching data saver statistics:', e);
    }
}

// ─── DEVICE DASHBOARD LOGIC ───────────────────────────────────────
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 60%)`;
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(/[\s.-]+/);
    if (parts.length > 1 && parts[1].length > 0) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function updateUI() {
    btnInternet.classList.toggle('active', state.appInternet);
    btnWifi.classList.toggle('active', state.wifi);
    btnHotspot.classList.toggle('active', state.hotspot);
    btnApps.classList.toggle('active', state.apps);

    if (!state.apps) {
        appGrid.style.display = 'none';
        searchContainer.style.display = 'none';
        statusMessage.style.display = 'flex';
        statusMessage.innerHTML = '<h2>Select \'Apps\' to view installed applications.</h2>';
    } else {
        if (allAppsData.length === 0) {
            statusMessage.style.display = 'flex';
            statusMessage.innerHTML = '<div class="status-icon-wrapper" style="color:var(--primary);"><i class="ph ph-spinner ph-spin"></i></div><h2>Fetching real device apps...</h2>';
            appGrid.style.display = 'none';
            searchContainer.style.display = 'none';
            pollApps();
        } else {
            statusMessage.style.display = 'none';
            appGrid.style.display = 'grid';
            searchContainer.style.display = 'flex';
            renderApps(allAppsData);
        }
    }
}

const MOCK_APPS_ANDROID = [
    { id: 101, name: "WhatsApp", appId: "whatsapp://send", iconData: null },
    { id: 102, name: "Instagram", appId: "instagram://", iconData: null },
    { id: 103, name: "YouTube", appId: "vnd.youtube://", iconData: null },
    { id: 104, name: "Facebook", appId: "fb://", iconData: null },
    { id: 105, name: "Chrome", appId: "googlechrome://", iconData: null },
    { id: 106, name: "Maps", appId: "google.navigation:q=0,0", iconData: null },
    { id: 107, name: "Spotify", appId: "spotify://", iconData: null },
    { id: 108, name: "Twitter", appId: "twitter://", iconData: null },
    { id: 109, name: "Gmail", appId: "googlegmail://", iconData: null },
    { id: 110, name: "Snapchat", appId: "snapchat://", iconData: null },
    { id: 111, name: "Settings", appId: "android-settings://", iconData: null },
    { id: 112, name: "Play Store", appId: "market://", iconData: null }
];

const MOCK_APPS_IOS = [
    { id: 201, name: "Messages", appId: "sms:", iconData: null },
    { id: 202, name: "FaceTime", appId: "facetime://", iconData: null },
    { id: 203, name: "Photos", appId: "photos-redirect://", iconData: null },
    { id: 204, name: "Maps", appId: "maps://", iconData: null },
    { id: 205, name: "Mail", appId: "mailto:", iconData: null },
    { id: 206, name: "Weather", appId: "weather://", iconData: null },
    { id: 207, name: "App Store", appId: "itms-apps://", iconData: null },
    { id: 208, name: "Safari", appId: "x-web-search://", iconData: null },
    { id: 209, name: "WhatsApp", appId: "whatsapp://", iconData: null },
    { id: 210, name: "Instagram", appId: "instagram://", iconData: null },
    { id: 211, name: "YouTube", appId: "youtube://", iconData: null },
    { id: 212, name: "Spotify", appId: "spotify://", iconData: null }
];

function getClientOS() {
    const userAgent = window.navigator.userAgent || window.navigator.vendor || window.opera;
    if (/android/i.test(userAgent)) {
        return "Android";
    }
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
        return "iOS";
    }
    return "PC";
}

function pollApps() {
    if (!state.apps) return;

    fetch(`${API_BASE}/api/apps`)
        .then(res => {
            if (res.status === 202) {
                setTimeout(pollApps, 1000);
                statusMessage.innerHTML = '<div class="status-icon-wrapper" style="color:var(--primary);"><i class="ph ph-spinner ph-spin"></i></div><h2>Server is extracting icons...</h2><p>This takes a moment on first load.</p>';
                return null;
            }
            return res.json();
        })
        .then(data => {
            if (data && state.apps) {
                allAppsData = data;
                statusMessage.style.display = 'none';
                appGrid.style.display = 'grid';
                searchContainer.style.display = 'flex';
                renderApps(data);
            }
        })
        .catch(err => {
            console.error("Failed to fetch apps:", err);
            statusMessage.innerHTML = '<div class="status-icon-wrapper" style="color:red;"><i class="ph ph-x-circle"></i></div><h2 style="color: #ef4444;">Failed to connect</h2><p>Make sure Node.js server is running.</p>';
        });
}

function renderApps(appsArray) {
    appGrid.innerHTML = '';
    
    appsArray.forEach(app => {
        const item = document.createElement('div');
        item.className = 'app-item';
        
        let iconHtml = '';
        if (app.iconData) {
            iconHtml = `<img src="${app.iconData}" alt="${app.name} icon" />`;
        } else {
            const color = stringToColor(app.name);
            const initials = getInitials(app.name);
            iconHtml = `<span style="color: ${color}; font-weight: 800; font-family: 'Outfit';">${initials}</span>`;
        }

        item.innerHTML = `
            <div class="app-icon">
                ${iconHtml}
            </div>
            <span title="${app.name}">${app.name}</span>
        `;
        
        // Direct launch using App Internet - no modal
        item.addEventListener('click', () => {
            directLaunchApp(app.appId, app.name);
        });

        appGrid.appendChild(item);
    });
}

// ─── DIRECT APP LAUNCH (No Modal) ───────────────────────────────
// Apps directly connect via App Internet. No mobile internet option.
async function directLaunchApp(appId, name) {
    // If Wi-Fi is connected, launch freely without using App Internet Data
    if (state.wifi && window.lastWifiConnected) {
        console.log(`Launching: ${name} (${appId}) via Free Wi-Fi`);
        showToast(`${name} connected via Wi-Fi (Free)`, 'success');
        
        // Launch directly via server
        fetch(`${API_BASE}/api/apps/launch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId })
        })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                showToast(`Failed to launch ${name}: ${data.error}`, 'error');
            }
        })
        .catch(err => {
            showToast(`Error launching ${name}.`, 'error');
        });
        return;
    }

    // Auto-enable App Internet if not already on
    if (!state.appInternet) {
        state.appInternet = true;
        localStorage.setItem('appInternetToggleState', 'true');
        updateUI();
    }

    // Check if user has remaining data
    if (userDataRemaining <= 0) {
        showToast('Your stored data is completed! Please store more data in your wallet.', 'error');
        return;
    }

    console.log(`Launching: ${name} (${appId}) via App Internet`);
    showToast(`${name} launched successfully! (Free Launch)`, 'success');


    // Launch the application on PC via server
    fetch(`${API_BASE}/api/apps/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId })
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) {
            showToast(`Failed to launch ${name}: ${data.error}`, 'error');
        }
    })
    .catch(err => {
        console.error("Failed to connect to launch endpoint:", err);
        showToast(`Error launching ${name}. Check server connection.`, 'error');
    });
}

// Search filtering
searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filteredApps = allAppsData.filter(app => app.name.toLowerCase().includes(query));
    renderApps(filteredApps);
});

// Event Listeners - Direct connection, no modal
btnInternet.addEventListener('click', () => { 
    state.appInternet = !state.appInternet; 
    localStorage.setItem('appInternetToggleState', state.appInternet ? 'true' : 'false');
    
    if (state.appInternet) {
        showToast('App Internet enabled. Apps will use your stored data.', 'success');
    }
    
    updateUI(); 
});
btnWifi.addEventListener('click', () => { window.location.href = 'wifi.html'; });
btnHotspot.addEventListener('click', (e) => { 
    const badge = document.getElementById('hotspot-badge');
    const popup = document.getElementById('hotspot-popup');
    
    // Prevent navigation if clicking inside the popup
    if (popup && (e.target === popup || popup.contains(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    
    // Toggle popup when clicking the badge
    if (badge && (e.target === badge || badge.contains(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        
        if (popup.style.display === 'flex') {
            popup.style.display = 'none';
        } else {
            popup.style.display = 'flex';
            clearTimeout(window.hotspotPopupTimeout);
            window.hotspotPopupTimeout = setTimeout(() => {
                if (popup) popup.style.display = 'none';
            }, 5000);
        }
        return;
    }
    
    // Otherwise, navigate to Hotspot Settings
    window.location.href = 'hotspot.html'; 
});
btnApps.addEventListener('click', () => { state.apps = !state.apps; updateUI(); });

// ─── INITIALIZATION ──────────────────────────────────────────────
if (localStorage.getItem('appInternetToggleState') === 'true') {
    state.appInternet = true;
}
if (localStorage.getItem('wifiToggleState') === 'true') {
    state.wifi = true;
}
if (localStorage.getItem('hotspotToggleState') === 'true') {
    state.hotspot = true;
}

// Check authentication
if (currentUserId) {
    showDashboard();
} else {
    authScreen.style.display = 'flex';
}

const userId = localStorage.getItem('userId') || '';
Promise.all([
    fetch(`${API_BASE}/api/wifi/status${userId ? '?userId=' + userId : ''}`).then(r => r.json()).catch(() => ({ connected: false })),
    fetch(`${API_BASE}/api/hotspot/status${userId ? '?userId=' + userId : ''}`).then(r => r.json()).catch(() => ({ active: false }))
]).then(([wifiData, hotspotData]) => {
    // Only update UI, do not auto-force state = true
    const wifiLabel = document.querySelector('#btn-wifi .btn-label');
    if (wifiLabel) {
        wifiLabel.textContent = (wifiData.connected && wifiData.ssid) ? wifiData.ssid : 'WIFI';
    }
    if (currentUserId) {
        updateUI();
    }
});

// Re-sync states when navigating back (bfcache issue prevention)
window.addEventListener('pageshow', (e) => {
    if (localStorage.getItem('wifiToggleState') === 'true') {
        state.wifi = true;
    } else {
        state.wifi = false;
    }

    if (localStorage.getItem('hotspotToggleState') === 'true') {
        state.hotspot = true;
    } else {
        state.hotspot = false;
    }
    if (currentUserId) {
        updateUI();
        fetchStats();
        fetchDashboardWifiStatus();
        fetchHotspotClients();
    }
});

async function fetchHotspotClients() {
    if (!currentUserId) return;
    try {
        const res = await fetch(`${API_BASE}/api/hotspot/status?userId=${currentUserId}`);
        const data = await res.json();
        const badge = document.getElementById('hotspot-badge');
        if (data.active && data.clients && data.clients.length > 0) {
            if(badge) {
                badge.style.display = 'flex';
                badge.textContent = data.clients.length;
            }
            renderHotspotPopupList(data.clients);
        } else {
            if(badge) badge.style.display = 'none';
            renderHotspotPopupList([]);
        }
    } catch (e) {
        console.error('Error fetching hotspot clients:', e);
    }
}

async function fetchDashboardWifiStatus() {
    if (!currentUserId) return;
    try {
        const res = await fetch(`${API_BASE}/api/wifi/status?userId=${currentUserId}`);
        const data = await res.json();
        const wifiLabel = document.querySelector('#btn-wifi .btn-label');
        if (wifiLabel) {
            wifiLabel.textContent = (data.connected && data.ssid) ? data.ssid : 'WIFI';
        }
        
        if (!data.connected && state.wifi && localStorage.getItem('wifiToggleState') === 'true' && window.lastWifiConnected === true) {
            state.wifi = false;
            localStorage.setItem('wifiToggleState', 'false');
            updateUI();
        }
        window.lastWifiConnected = data.connected;
    } catch (e) {
        console.error('Error fetching wifi status:', e);
    }
}

function renderHotspotPopupList(clients) {
    const list = document.getElementById('hotspot-popup-list');
    if (!list) return;
    list.innerHTML = '';
    if (clients.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; text-align: center; margin: 0;">No devices</p>';
        return;
    }
    clients.forEach(c => {
        list.innerHTML += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-base); padding: 0.5rem; border-radius: 8px; box-shadow: var(--shadow-inset); font-size: 0.85rem;">
                <span style="font-weight: 600; color: var(--text-main);">${c.name || 'Unknown Device'}</span>
            </div>
        `;
    });
}

// Auto-refresh stats every 10 seconds for live data
setInterval(() => {
    if (currentUserId) {
        fetchStats();
        fetchDashboardWifiStatus();
        fetchHotspotClients();
    }
}, 10000);

// AI Auto-Convert Handlers
function toggleAiAutoConvert() {
    const checkbox = document.getElementById('ai-auto-toggle');
    if (checkbox) {
        localStorage.setItem('aiAutoConvertState', checkbox.checked ? 'true' : 'false');
        showToast(checkbox.checked ? 'AI Auto-Converter Enabled' : 'AI Auto-Converter Disabled', 'success');
    }
}
window.toggleAiAutoConvert = toggleAiAutoConvert;

// Initialize AI Auto-Convert toggle state
window.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.getElementById('ai-auto-toggle');
    if (checkbox) {
        checkbox.checked = localStorage.getItem('aiAutoConvertState') === 'true';
    }
});
