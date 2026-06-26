let BOT_TOKEN = localStorage.getItem('sg_token') || '';
let CHAT_ID = localStorage.getItem('sg_chatid') || '';

// Автозаполнение полей
document.getElementById('botToken').value = BOT_TOKEN;
document.getElementById('chatId').value = CHAT_ID;

// Автоподключение если есть сохранённые данные
if (BOT_TOKEN && CHAT_ID) {
    connect();
}

function connect() {
    BOT_TOKEN = document.getElementById('botToken').value.trim();
    CHAT_ID = document.getElementById('chatId').value.trim();
    if (BOT_TOKEN && CHAT_ID) {
        localStorage.setItem('sg_token', BOT_TOKEN);
        localStorage.setItem('sg_chatid', CHAT_ID);
        updateConnectionStatus(true);
        log('✓ Connected to bot');
        refresh();
    } else {
        updateConnectionStatus(false);
        log('✗ Enter Bot Token and Chat ID');
    }
}

function updateConnectionStatus(online) {
    const el = document.getElementById('connectionStatus');
    if (online) {
        el.innerHTML = '<span class="status-dot online"></span> Connected';
        el.style.color = '#34D399';
    } else {
        el.innerHTML = '<span class="status-dot offline"></span> Offline';
        el.style.color = '#FB7185';
    }
}

async function send(cmd) {
    if (!BOT_TOKEN || !CHAT_ID) { 
        log('✗ Not connected. Enter Bot Token and Chat ID.'); 
        return; 
    }
    log('> ' + cmd);
    try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: cmd })
        });
        const data = await res.json();
        if (data.ok) {
            log('✓ Sent to PC');
        } else {
            log('✗ Bot error: ' + (data.description || 'Unknown'));
        }
    } catch(e) { 
        log('✗ Network error: ' + e.message); 
    }
}

function sendCmd() {
    const input = document.getElementById('cmdInput');
    const cmd = input.value.trim();
    if (cmd) { send(cmd); input.value = ''; }
}

async function refresh() {
    if (!BOT_TOKEN || !CHAT_ID) return;
    document.getElementById('sysInfo').textContent = 'Loading...';
    document.getElementById('procList').textContent = 'Loading...';
    send('/status');
    send('/processes');
}

function log(msg) {
    const l = document.getElementById('log');
    const time = new Date().toLocaleTimeString();
    l.innerHTML = '[' + time + '] ' + msg + '<br>' + l.innerHTML;
}

// Tabs
document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
        document.querySelectorAll('.tab,.tab-content').forEach(e => e.classList.remove('active'));
        t.classList.add('active');
        document.getElementById(t.dataset.tab).classList.add('active');
    };
});

// Автоподключение при загрузке
if (BOT_TOKEN && CHAT_ID) {
    connect();
}