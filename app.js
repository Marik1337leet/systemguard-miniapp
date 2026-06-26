const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

let ws;
const WS_URL = 'ws://192.168.0.102'; // Замени на IP твоего ПК

// Connect WebSocket
function connectWS() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => log('✓ Connected to PC');
    ws.onmessage = (e) => { document.getElementById('terminal-output').textContent = e.data; };
    ws.onclose = () => { log('✗ Disconnected'); setTimeout(connectWS, 3000); };
    ws.onerror = () => log('✗ Connection error');
}
connectWS();

// Send command
function send(cmd) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(cmd);
        log(`> ${cmd}`);
    } else {
        log('✗ Not connected');
    }
}

// Quick commands
function refreshDashboard() { send('/status'); }
function getProcesses() { send('/processes'); }
function getInfo() { send('/info'); }
function shutdown() { send('/shutdown'); }
function restart() { send('/restart'); }
function sleep() { send('/sleep'); }
function lockPC() { send('/lock'); }
function setVolume(v) { send(`/volume ${v}`); }
function setBrightness(v) { send(`/brightness ${v}`); }
function media(cmd) { send(cmd); }

// Terminal execute
function executeTerminal() {
    const input = document.getElementById('terminal-input');
    const cmd = input.value.trim();
    if (cmd) { send(cmd); input.value = ''; }
}
document.getElementById('terminal-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') executeTerminal();
});

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// Log
function log(msg) {
    const c = document.getElementById('console');
    const time = new Date().toLocaleTimeString();
    c.innerHTML = `[${time}] ${msg}\n` + c.innerHTML;
    if (c.children.length > 50) c.removeChild(c.lastChild);
}