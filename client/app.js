const API_URL = 'http://localhost:3000/api';
let currentUserId = localStorage.getItem('userId');
let currentUserName = localStorage.getItem('userName');

function switchAuth(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    if (tab === 'login') {
        document.querySelector('.auth-tab:nth-child(1)').classList.add('active');
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
    } else {
        document.querySelector('.auth-tab:nth-child(2)').classList.add('active');
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
    }
    document.getElementById('authMsg').textContent = '';
}

async function login() {
    const user = document.getElementById('loginUsername').value;
    const pass = document.getElementById('loginPassword').value;
    const msg = document.getElementById('authMsg');
    
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username: user, password: pass})
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('userName', data.username);
            currentUserId = data.userId;
            currentUserName = data.username;
            showDashboard();
        } else {
            msg.textContent = data.error; msg.className = 'msg error-msg';
        }
    } catch (e) { msg.textContent = 'Network Error'; msg.className = 'msg error-msg'; }
}

async function register() {
    const user = document.getElementById('regUsername').value;
    const pass = document.getElementById('regPassword').value;
    const msg = document.getElementById('authMsg');
    
    try {
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username: user, password: pass})
        });
        const data = await res.json();
        if (res.ok) {
            msg.textContent = 'Account created! Please login.'; msg.className = 'msg success-msg';
            setTimeout(() => switchAuth('login'), 1500);
        } else {
            msg.textContent = data.error; msg.className = 'msg error-msg';
        }
    } catch (e) { msg.textContent = 'Network Error'; msg.className = 'msg error-msg'; }
}

function logout() {
    localStorage.clear();
    currentUserId = null;
    currentUserName = null;
    document.getElementById('dashboardScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'block';
}

function showDashboard() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('dashboardScreen').style.display = 'block';
    document.getElementById('userName').textContent = currentUserName;
    fetchStats();
    fetchUsers();
}

async function fetchUsers() {
    try {
        const res = await fetch(`${API_URL}/users`);
        const users = await res.json();
        const select = document.getElementById('giftRecipient');
        select.innerHTML = '';
        users.forEach(u => {
            if (u.id != currentUserId) {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.username;
                select.appendChild(opt);
            }
        });
    } catch(e) {}
}

async function fetchStats() {
    try {
        const response = await fetch(`${API_URL}/stats/${currentUserId}`);
        if (!response.ok) throw new Error('Failed to fetch data');
        const data = await response.json();
        
        document.getElementById('totalQuota').textContent = data.totalDataQuota + ' GB';
        document.getElementById('totalUsed').textContent = data.totalUsed + ' GB';
        document.getElementById('unusedData').textContent = data.unusedData + ' GB';
        document.getElementById('vaultData').textContent = data.vaultData + ' GB';
        
        let percentUsed = (data.totalUsed / data.totalDataQuota) * 100;
        if (percentUsed > 100) percentUsed = 100;
        document.getElementById('dataProgressBar').style.width = percentUsed + '%';
        
        if (percentUsed > 80) document.getElementById('dataProgressBar').style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
        else document.getElementById('dataProgressBar').style.background = 'linear-gradient(90deg, #3b82f6, #8b5cf6)';
    } catch (err) {}
}

async function saveToVault() {
    const msg = document.getElementById('vaultMsg');
    msg.textContent = 'Saving...'; msg.className = 'msg';
    try {
        const res = await fetch(`${API_URL}/vault/save`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({userId: currentUserId})
        });
        const data = await res.json();
        if (res.ok) {
            msg.textContent = `Saved ${data.savedData} GB to vault!`; msg.className = 'msg success-msg';
            fetchStats();
        } else {
            msg.textContent = data.error; msg.className = 'msg error-msg';
        }
    } catch (e) { msg.textContent = 'Error'; msg.className = 'msg error-msg'; }
}

async function retrieveFromVault() {
    const msg = document.getElementById('vaultMsg');
    const amount = parseFloat(document.getElementById('retrieveAmount').value);
    if (!amount) return;
    msg.textContent = 'Retrieving...'; msg.className = 'msg';
    try {
        const res = await fetch(`${API_URL}/vault/retrieve`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({userId: currentUserId, amount: amount})
        });
        const data = await res.json();
        if (res.ok) {
            msg.textContent = `Retrieved ${data.retrievedAmount} GB from vault!`; msg.className = 'msg success-msg';
            document.getElementById('retrieveAmount').value = '';
            fetchStats();
        } else {
            msg.textContent = data.error; msg.className = 'msg error-msg';
        }
    } catch (e) { msg.textContent = 'Error'; msg.className = 'msg error-msg'; }
}

async function giftData() {
    const msg = document.getElementById('giftMsg');
    const amount = parseFloat(document.getElementById('giftAmount').value);
    const recipient = parseInt(document.getElementById('giftRecipient').value);
    if (!amount || !recipient) return;
    
    msg.textContent = 'Sending...'; msg.className = 'msg';
    try {
        const res = await fetch(`${API_URL}/gift`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ fromUserId: currentUserId, toUserId: recipient, dataAmount: amount })
        });
        const data = await res.json();
        if (res.ok) {
            msg.textContent = `Gifted ${data.giftedAmount} GB!`; msg.className = 'msg success-msg';
            document.getElementById('giftAmount').value = '';
            fetchStats();
        } else {
            msg.textContent = data.error; msg.className = 'msg error-msg';
        }
    } catch (e) { msg.textContent = 'Error'; msg.className = 'msg error-msg'; }
}

// Initial flow
if (currentUserId) {
    showDashboard();
} else {
    document.getElementById('authScreen').style.display = 'block';
}
