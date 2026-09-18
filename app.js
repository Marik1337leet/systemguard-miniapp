/* SG CONSOLE v6 — пульт управления ПК.
 * Всё выполняется ВНУТРИ WebApp через Live HTTP API.
 * tg.sendData НЕ вызывается никогда — иначе Telegram закроет приложение.
 * Токен — только в ?token=, POST — как text/plain: никаких CORS-preflight,
 * иначе мобильные WebView режут связь («с ПК работает, с телефона нет»).
 * Кадры и MJPEG идут с ?token= в URL (img не умеет в headers).
 * Видео — MJPEG по своему HTTPS-туннелю: ноль лишней инфраструктуры,
 * работает везде, где открывается Telegram. WebRTC/SRT/RTMP здесь не
 * взлетят: им нужен UDP и публичный TURN/медиасервер, а телефон и ПК
 * сидят за NAT — P2P без своего TURN не соберётся, в браузере SRT
 * вообще не играет. Вместо этого: честные пресеты качества до
 * 1920px / q95 / 60 FPS + перезапуск потока одной кнопкой. */
(function () {
    'use strict';

    var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    var inTelegram = !!tg;
    try {
        if (tg) {
            tg.ready();
            try { tg.expand(); } catch (e) {}
            try {
                if (tg.isVersionAtLeast && tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
            } catch (e) {}
        }
    } catch (e) {}

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ── Настройки ── */
    var PRESETS = {
        eco:   { fps: 12, q: 45, w: 854 },
        pro:   { fps: 30, q: 65, w: 1280 },
        ultra: { fps: 60, q: 90, w: 1920 }
    };
    var S = {
        statusSec: 2.5, shotSec: 3, fps: 30, q: 65,
        screenFps: 30, camFps: 15, screenW: 1280, preset: 'pro',
        inputOn: true, theme: 'dark', haptics: true
    };
    function loadSettings() {
        try {
            var raw = localStorage.getItem('sg_cfg6') || localStorage.getItem('sg_cfg4');
            if (raw) {
                var c = JSON.parse(raw);
                if (c.statusSec >= 1 && c.statusSec <= 30) S.statusSec = c.statusSec;
                if (c.shotSec >= 2 && c.shotSec <= 60) S.shotSec = c.shotSec;
                if (c.fps >= 1 && c.fps <= 60) S.fps = c.fps;
                if (c.q >= 30 && c.q <= 95) S.q = c.q;
                if (c.screenFps >= 1 && c.screenFps <= 60) S.screenFps = c.screenFps;
                if (c.camFps >= 1 && c.camFps <= 60) S.camFps = c.camFps;
                if (c.screenW >= 320 && c.screenW <= 1920) S.screenW = c.screenW;
                if (PRESETS[c.preset]) S.preset = c.preset;
                if (typeof c.inputOn === 'boolean') S.inputOn = c.inputOn;
                if (c.theme === 'light' || c.theme === 'dark') S.theme = c.theme;
                if (typeof c.haptics === 'boolean') S.haptics = c.haptics;
            }
        } catch (e) {}
    }
    function saveSettings() {
        try { localStorage.setItem('sg_cfg6', JSON.stringify(S)); } catch (e) {}
        try { tg && tg.CloudStorage && tg.CloudStorage.setItem('sg_cfg6', JSON.stringify(S)); } catch (e) {}
    }
    function store(k, v) {
        try { localStorage.setItem(k, v); } catch (e) {}
        try { tg && tg.CloudStorage && tg.CloudStorage.setItem(k, v); } catch (e) {}
    }
    function load(k) {
        try { var v = localStorage.getItem(k); if (v) return v; } catch (e) {}
        return '';
    }

    function toast(msg, isErr) {
        var wrap = $('toasts');
        if (!wrap) return;
        var d = document.createElement('div');
        d.className = 'toast' + (isErr ? ' err' : '');
        d.textContent = msg;
        wrap.appendChild(d);
        while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
        setTimeout(function () {
            d.style.opacity = '0';
            setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 300);
        }, 2600);
    }
    function haptic(kind) {
        if (!S.haptics) return;
        try {
            if (tg && tg.HapticFeedback) {
                if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success');
                else if (kind === 'err') tg.HapticFeedback.notificationOccurred('error');
                else tg.HapticFeedback.impactOccurred('light');
            }
        } catch (e) {}
    }
    function copyText(t, label) {
        function done() { toast((label || 'Скопировано')); haptic('ok'); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(done, function () { fallback(); });
        } else fallback();
        function fallback() {
            try {
                var ta = document.createElement('textarea');
                ta.value = t; document.body.appendChild(ta);
                ta.select(); document.execCommand('copy');
                document.body.removeChild(ta); done();
            } catch (e) { toast('Не скопировалось', true); }
        }
    }

    /* ── Тема ── */
    function applyTheme(t) {
        S.theme = (t === 'light') ? 'light' : 'dark';
        try { document.documentElement.setAttribute('data-theme', S.theme); } catch (e) {}
        var sw = $('themeSwitch');
        if (sw) sw.checked = (S.theme === 'light');
        try {
            var bg = S.theme === 'light' ? '#ECEEF2' : '#0A0C10';
            if (tg && tg.setHeaderColor) tg.setHeaderColor(bg);
            if (tg && tg.setBackgroundColor) tg.setBackgroundColor(bg);
        } catch (e) {}
    }

    /* ── LIVE-клиент ── */
    var Live = {
        base: '', token: '', on: false,
        pollTimer: null, shotTimer: null,
        init: function () {
            var u = ($('liveUrl') && $('liveUrl').value) || load('sg_live_url');
            var t = ($('liveToken') && $('liveToken').value) || load('sg_live_token');
            if (u && $('liveUrl')) $('liveUrl').value = u;
            if (t && $('liveToken')) $('liveToken').value = t;
            if (u && t) this.connect(true);
        },
        q: function (path) {
            var sep = path.indexOf('?') >= 0 ? '&' : '?';
            return this.base + path + sep + 'token=' + encodeURIComponent(this.token);
        },
        api: function (path, opts) {
            var self = this;
            opts = opts || {};
            var ctrl = new AbortController();
            var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000);
            var sep = path.indexOf('?') >= 0 ? '&' : '?';
            var url = self.base + path + sep + 'token=' + encodeURIComponent(self.token);
            var init = { method: opts.method || 'GET', signal: ctrl.signal };
            if (opts.body) {
                init.headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
                init.body = JSON.stringify(opts.body);
            }
            return fetch(url, init).then(function (r) {
                clearTimeout(timer);
                if (r.status === 401) {
                    var ae = new Error('Неверный токен (401). Скопируйте токен из вкладки Telegram на ПК заново.');
                    ae.code = 401;
                    throw ae;
                }
                if (r.status === 403) {
                    var fe = new Error('Cloudflare не пропустил (403). Откройте ссылку в Chrome на телефоне и пройдите проверку, затем вернитесь.');
                    fe.code = 403;
                    throw fe;
                }
                if (!r.ok) throw new Error('HTTP ' + r.status);
                var ct = r.headers.get('content-type') || '';
                if (ct.indexOf('json') >= 0) return r.json();
                return r.text().then(function (t) {
                    if (/<html/i.test(t)) {
                        var ce = new Error('Cloudflare показал страницу проверки. Откройте ссылку в Chrome на телефоне, пройдите проверку и нажмите Проверить снова.');
                        ce.code = 'cf-challenge';
                        throw ce;
                    }
                    throw new Error('Неожиданный ответ сервера');
                });
            }).catch(function (e) {
                clearTimeout(timer);
                throw normErr(e);
            });
        },
        cleanToken: function (s) { return String(s || '').replace(/\s+/g, ''); },
        cleanUrl: function (s) {
            s = String(s || '').trim().replace(/\s+/g, '').replace(/\/+$/, '');
            if (!s) return s;
            if (/^http:\/\//i.test(s)) s = 'https://' + s.slice(7);
            if (!/^https:\/\//i.test(s)) s = 'https://' + s;
            s = s.replace(/\/api(\/.*)?$/i, '').replace(/\/+$/, '');
            return s;
        },
        onAuthFail: function () {
            this.on = false;
            try { localStorage.removeItem('sg_live_token'); } catch (e) {}
            try { tg && tg.CloudStorage && tg.CloudStorage.removeItem('sg_live_token'); } catch (e) {}
            if ($('liveToken')) { $('liveToken').value = ''; try { $('liveToken').focus(); } catch (e) {} }
            this.setState('Токен не подошёл — вставьте новый из вкладки Telegram на ПК');
            this.diag('Сервер отвечает, но токен чужой (401).\n' +
                'Старый сохранённый токен стёрт.\n' +
                'На ПК: вкладка Telegram → скопируйте токен заново\n' +
                '(если не помогает — там же кнопка «Новый токен»,\n' +
                'после неё вставьте свежий сюда и нажмите Связать).');
        },
        connect: function (silent) {
            var self = this;
            var u = self.cleanUrl(($('liveUrl').value || ''));
            var t = self.cleanToken(($('liveToken').value || ''));
            if ($('liveUrl')) $('liveUrl').value = u;
            if ($('liveToken')) $('liveToken').value = t;
            if (!u || !t) { if (!silent) toast('Введите ссылку и токен', true); return; }
            if (!/^https:\/\//i.test(u)) {
                self.diag('Ссылка должна начинаться с https:// — внутри Telegram разрешён только HTTPS.');
                if (!silent) toast('Нужна https-ссылка', true);
                return;
            }
            self.base = u; self.token = t;
            self.setState('Проверка связи… (туннель может просыпаться до 20 сек)'); self.diag('');
            self.api('/api/status', { timeout: 20000 }).then(function (s) {
                if (!s || s.ok === false) throw new Error((s && s.error) || 'bad reply');
                self.on = true;
                store('sg_live_url', u); store('sg_live_token', t);
                self.renderStatus(s);
                self.startPoll();
                self.refreshShot();
                pushInputState();
                refreshDrives();
                $('livePanels').classList.remove('hidden');
                $('liveDisconnect').classList.remove('hidden');
                self.setState('Связано · ' + (s.machine || 'ПК'));
                setMode('Live');
                if (!silent) { toast('Live связано'); }
                haptic('ok');
            }).catch(function (e) {
                self.on = false;
                if (e && e.code === 401) { self.onAuthFail(); haptic('err'); return; }
                self.setState('Нет связи');
                self.diag(diagText(e, u));
                if (!silent) { toast('Нет связи — смотрите диагностику', true); haptic('err'); }
            });
        },
        test: function () {
            var self = this;
            var u = self.cleanUrl(($('liveUrl').value || ''));
            var t = self.cleanToken(($('liveToken').value || ''));
            if ($('liveUrl')) $('liveUrl').value = u;
            if ($('liveToken')) $('liveToken').value = t;
            if (!u || !t) { toast('Введите ссылку и токен', true); return; }
            self.base = u; self.token = t;
            self.setState('Проверка… (до 20 сек)');
            self.api('/api/status', { timeout: 20000 }).then(function (s) {
                self.setState('ОК: ' + (s.machine || 'ПК') + ' · ' + (s.time || ''));
                self.diag('');
                toast('Связь есть'); haptic('ok');
            }).catch(function (e) {
                if (e && e.code === 401) { self.onAuthFail(); haptic('err'); return; }
                self.setState('Нет связи');
                self.diag(diagText(e, u));
                haptic('err');
            });
        },
        disconnect: function () {
            this.on = false; this.base = '';
            clearInterval(this.pollTimer); clearInterval(this.shotTimer);
            this.pollTimer = this.shotTimer = null;
            try { this.stopStreams('all'); } catch (e) {}
            this.stopScreenVideo(); this.stopCamVideo();
            $('livePanels').classList.add('hidden');
            $('liveDisconnect').classList.add('hidden');
            this.setState('Не связано');
            setMode(inTelegram ? 'Офлайн' : 'Демо');
        },
        setState: function (t) {
            var e = $('liveState'); if (e) e.textContent = t;
            var m = $('liveStateMini'); if (m) m.textContent = Live.on ? 'LIVE' : '—';
        },
        diag: function (t) {
            var e = $('liveDiag');
            if (!e) return;
            if (!t) { e.classList.add('hidden'); e.textContent = ''; return; }
            e.classList.remove('hidden'); e.textContent = t;
        },
        startPoll: function () {
            var self = this;
            clearInterval(self.pollTimer);
            self.pollTimer = setInterval(function () {
                if (!self.on) return;
                self.api('/api/status', { timeout: 8000 }).then(function (s) {
                    if (s && s.ok !== false) self.renderStatus(s);
                }).catch(function () {});
            }, Math.max(1000, S.statusSec * 1000));
            clearInterval(self.shotTimer);
            self.shotTimer = setInterval(function () {
                if (!self.on) return;
                if ($('liveScreen') && !$('liveScreen').dataset.video) self.refreshShot();
            }, Math.max(2000, S.shotSec * 1000));
        },
        renderStatus: function (s) {
            setText('liveMachine', s.machine || '—');
            setText('liveTime', s.time || '');
            var pct = s.ramPct || 0;
            setText('liveRamText', (s.ramUsedGb || '?') + '/' + (s.ramTotalGb || '?') + ' GB · ' + pct + '%');
            var bar = $('liveRamBar'); if (bar) bar.style.width = Math.min(100, pct) + '%';
            var disks = (s.disks || []).map(function (d) { return d.name + ' ' + d.freeGb + '/' + d.totalGb + ' GB'; }).join(' · ');
            setText('liveDisks', disks || '—');
            setText('liveBatt', s.battery || '—');
            setText('liveUp', 'uptime ' + (s.uptime || '—'));
            if (s.vol != null && s.vol >= 0) {
                setText('liveVol', 'громкость ' + s.vol + '%');
                setText('volVal', s.vol + '%');
                var vr = $('volRange'); if (vr && document.activeElement !== vr) vr.value = s.vol;
            }
            // Сервер — источник правды по свичам (не трогаем 3 сек после ручного).
            if (Date.now() - inputToggleAt > 3000) {
                var should = !!(s.mouseOn && s.kbdOn);
                if (should !== !!S.inputOn) {
                    S.inputOn = should;
                    try { saveSettings(); } catch (e) {}
                    paintInputSwitch();
                }
            }
        },
        refreshShot: function () {
            var img = $('liveScreen');
            if (img && this.on) {
                delete img.dataset.video;
                img.src = this.q('/api/shot.jpg?w=' + S.screenW + '&q=' + S.q) + '&t=' + Date.now();
            }
        },
        screenVideoUrl: function () {
            return this.q('/api/mjpeg?fps=' + S.screenFps + '&q=' + S.q + '&w=' + S.screenW);
        },
        startScreenVideo: function () {
            var img = $('liveScreen');
            if (!img || !this.on) return;
            img.dataset.video = '1';
            img.src = this.screenVideoUrl();
            var btn = $('mjpegBtn'); if (btn) btn.innerHTML = 'Видео <span class="rec-dot"></span>';
        },
        stopStreams: function (kind) {
            try {
                fetch(this.q('/api/stop?kind=' + (kind || 'all')), { method: 'GET' })
                    .catch(function () {});
            } catch (e) {}
        },
        stopScreenVideo: function () {
            var img = $('liveScreen');
            if (img) { delete img.dataset.video; img.src = ''; }
            try { this.stopStreams('mjpeg'); } catch (e) {}
            var btn = $('mjpegBtn'); if (btn) btn.textContent = 'Видео';
        },
        camShot: function () {
            var img = $('liveCam');
            if (img && this.on) {
                img.classList.remove('hidden');
                delete img.dataset.video;
                img.src = this.q('/api/cam.jpg?w=960&q=' + S.q) + '&t=' + Date.now();
            }
        },
        startCamVideo: function () {
            var img = $('liveCam');
            if (!img || !this.on) return;
            img.classList.remove('hidden');
            img.dataset.video = '1';
            img.src = this.q('/api/cammjpeg?fps=' + S.camFps + '&q=' + S.q + '&w=960');
        },
        stopCamVideo: function () {
            var img = $('liveCam');
            if (img) { delete img.dataset.video; img.src = ''; img.classList.add('hidden'); }
            try { this.stopStreams('cam'); } catch (e) {}
        }
    };

    function normErr(e) {
        if (e && e.name === 'AbortError') return new Error('Таймаут: ПК не ответил за 12–15 сек (спит, выключен или туннель упал).');
        if (e instanceof TypeError) return new Error('failed to fetch: сеть/туннель недоступен. Проверьте: 1) ПК включён и приложение запущено, 2) live опубликован, 3) ссылка свежая (URL меняется при перезапуске), 4) интернет на телефоне.');
        return e;
    }
    function diagText(e, url) {
        var m = (e && e.message) || String(e);
        return 'Диагностика:\n' +
            '• Ошибка: ' + m + '\n' +
            '• URL: ' + (url || '—') + '\n' +
            '• Что проверить:\n' +
            '  1. Ссылка одноразовая: свежий адрес — по /live в чате с ботом.\n' +
            '  2. На ПК приложение запущено, live опубликован.\n' +
            '  3. Токен совпадает (вкладка Telegram на ПК).\n' +
            '  4. ПК не спит. Вне дома команды идут через чат: /status, /cmd…\n' +
            '  5. Проверка Cloudflare: откройте ссылку в Chrome на телефоне,\n' +
            '     пройдите проверку и нажмите Проверить снова.';
    }

    function setText(id, v) { var e = $(id); if (e) e.textContent = v; }
    function setMode(m) {
        var e = $('modeLabel'); if (e) e.textContent = m === 'Live' ? 'LIVE' : (m === 'Офлайн' ? 'OFFLINE' : 'DEMO');
        var d = $('statusDot'); if (d) d.className = 'dot ' + (m === 'Live' ? 'on' : 'off');
        var mv = $('moreConnVal'); if (mv) mv.textContent = m === 'Live' ? 'LIVE' : '—';
    }
    function needLive() {
        if (Live.on) return true;
        toast('Сначала свяжите ПК во вкладке Статус', true); haptic('err');
        switchTab('status');
        return false;
    }
    function showOut(id, text) {
        var o = $(id);
        if (!o) return;
        o.classList.remove('hidden');
        o.textContent = text;
    }

    /* ── Выполнение ── */
    var OUT_MAP = {
        perf: 'statusOut', sysinfo: 'statusOut', uptime: 'statusOut', battery: 'statusOut',
        free: 'statusOut', license_status: 'statusOut', power_plans: 'powerOut',
        ip: 'netOut', ping: 'netOut', netstat: 'netOut', connections: 'netOut',
        wifi: 'netOut', dnsflush: 'netOut', ports: 'netOut',
        defender_status: 'secOut', defender_scan: 'secOut', cleanup_info: 'secOut',
        clean: 'secOut', ram: 'secOut', eventlog: 'secOut', services: 'secOut',
        game_boost: 'secOut', game_killbrowsers: 'secOut', sched_list: 'secOut',
        remote: 'secOut', rdp: 'secOut', rdp_on: 'secOut', rdp_off: 'secOut',
        fan: 'secOut', fan_mode: 'secOut', hotkey: 'secOut'
    };
    var LABELS = {
        shutdown: 'Выключение через 60с', restart: 'Рестарт через 60с', sleep: 'Сон',
        hibernate: 'Гибернация', lock: 'Блокировка', wake: 'Пробуждение экрана',
        cancel: 'Таймер отменён', mute: 'Мут', play: 'Play/Pause', next: 'Трек ▶',
        prev: 'Трек ◀', volume: 'Громкость', brightness: 'Яркость',
        open: 'Открытие', close: 'Завершение', cmd: 'Команда', ls: 'Файлы',
        drives: 'Диски', file_delete: 'Удаление', file_mkdir: 'Папка',
        clean: 'Очистка', ram: 'RAM', perf: 'Perf', sysinfo: 'Система',
        remote: 'Удалённый доступ', defender_scan: 'Скан Defender'
    };
    function label(a) { return LABELS[a] || a; }

    var CHAT_FALLBACK = {
        shutdown: 1, restart: 1, sleep: 1, hibernate: 1, lock: 1, wake: 1,
        cancel: 1, battery: 1, free: 1, uptime: 1, perf: 1, sysinfo: 1,
        ip: 1, ping: 1, netstat: 1, mute: 1, play: 1, next: 1,
        prev: 1, volume: 1, brightness: 1, open: 1, close: 1, cmd: 1,
        ls: 1, processes: 1, apps: 1, startup: 1, clean: 1, ram: 1,
        eventlog: 1, unlock: 1, wifi: 1, remote: 1, fan: 1, fan_mode: 1, hotkey: 1,
        power_plans: 'plans', defender_status: 'defender',
        license_status: 'license', connections: 'netstat'
    };
    function chatFallback(action, arg) {
        if (!Object.prototype.hasOwnProperty.call(CHAT_FALLBACK, action)) return null;
        var cmd = CHAT_FALLBACK[action] === 1 ? action : CHAT_FALLBACK[action];
        return '/' + cmd + (arg ? ' ' + arg : '');
    }

    /* ── Мастер-свич ввода: показ + работа мыши и клавиатуры ── */
    var inputToggleAt = 0;
    function paintInputSwitch() {
        var sw = $('inputSwitch');
        if (sw) sw.checked = !!S.inputOn;
        var cards = $('inputCards');
        if (cards) cards.classList.toggle('hidden', !S.inputOn);
    }
    // Проталкивает локальное состояние свича на сервер (оба канала сразу).
    function pushInputState() {
        if (!Live.on) return;
        var v = S.inputOn ? 'on' : 'off';
        Live.api('/api/action', { method: 'POST', body: { action: 'mouse_enable', arg: v } }).catch(function () {});
        Live.api('/api/action', { method: 'POST', body: { action: 'kbd_enable', arg: v } }).catch(function () {});
    }
    function mrun(action, arg, outId) {
        if (!S.inputOn) { toast('Ввод с телефона выключен', true); return null; }
        return run(action, arg, outId);
    }
    function krun(action, arg, outId) {
        if (!S.inputOn) { toast('Ввод с телефона выключен', true); return null; }
        return run(action, arg, outId);
    }

    function run(action, arg, outId) {
        action = String(action || '').toLowerCase();
        arg = arg == null ? '' : String(arg);
        if (!needLive()) return null;
        haptic();
        return Live.api('/api/action', { method: 'POST', body: { action: action, arg: arg } })
            .then(function (r) {
                if (!r) throw new Error('empty');
                if (r.ok === false) { toast(r.error || 'Ошибка', true); haptic('err'); return r; }
                haptic('ok');
                var text = r.output || r.message || label(action);
                if (action === 'processes') { renderProcs(r.items || [], text); return r; }
                if (action === 'startup') { renderStartup(r.items || [], text); return r; }
                if (action === 'uninstall_list') { renderUninstall(r.items || [], text); return r; }
                if (action === 'connections' || action === 'power_plans' || action === 'sched_list') {
                    showOut(outId || OUT_MAP[action] || 'secOut', text);
                    toast(r.message || label(action));
                    return r;
                }
                if (action === 'ls') { renderFiles(r.path || '', r.parent || null, r.items || []); return r; }
                if (action === 'drives') { renderDriveChips(r.items || []); return r; }
                var target = outId || OUT_MAP[action];
                if (target) showOut(target, text);
                else toast(String(text).slice(0, 160));
                return r;
            })
            .catch(function (e) {
                var fb = chatFallback(action, arg);
                if (fb && inTelegram) {
                    copyText(fb, 'Live недоступен — команда скопирована');
                } else {
                    toast('Нет связи: ' + (e.message || e), true);
                }
                haptic('err');
                Live.diag(diagText(e, Live.base));
            });
    }

    /* ── Рендер списков ── */
    function renderProcs(items, text) {
        var box = $('procList');
        if (box) {
            var h = '';
            items.slice(0, 30).forEach(function (it) {
                h += '<div class="frow"><div class="f-main"><div class="f-name mono">' + esc(it.name) + '</div>' +
                    '<div class="f-meta">PID ' + it.pid + ' · ' + it.mem + ' MB</div></div>' +
                    '<button class="icon-btn danger" data-kill="' + esc(it.name) + '">✕</button></div>';
            });
            box.innerHTML = h || '<div class="hint">Пусто</div>';
            box.querySelectorAll('[data-kill]').forEach(function (b) {
                b.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    if (confirm('Завершить ' + b.getAttribute('data-kill') + '? Без сохранения.')) {
                        run('close', b.getAttribute('data-kill'), 'procOut');
                    }
                });
            });
        }
        if (text) showOut('procOut', text);
    }
    function renderStartup(items, text) {
        var box = $('startupList');
        if (!box) return;
        var h = '';
        items.forEach(function (it) {
            h += '<div class="frow"><div class="f-main"><div class="f-name mono">' + (it.enabled ? '[ON] ' : '[OFF] ') + esc(it.name) + '</div></div>' +
                '<button class="icon-btn go" data-st="' + esc(it.name) + '" data-en="' + (it.enabled ? '0' : '1') + '">' + (it.enabled ? 'OFF' : 'ON') + '</button></div>';
        });
        box.innerHTML = h || '<div class="hint">Пусто</div>';
        box.querySelectorAll('[data-st]').forEach(function (b) {
            b.addEventListener('click', function () {
                var en = b.getAttribute('data-en') === '1';
                run(en ? 'startup_enable' : 'startup_disable', b.getAttribute('data-st'), null);
                setTimeout(function () { run('startup', ''); }, 1200);
            });
        });
        void text;
    }
    function renderUninstall(items, text) {
        var box = $('uninstallList');
        if (!box) return;
        var h = '';
        items.slice(0, 40).forEach(function (it) {
            h += '<div class="frow" data-u="' + esc(it.name) + '"><div class="f-main"><div class="f-name">' + esc(it.name) + '</div>' +
                '<div class="f-meta">' + esc(it.version || '') + '</div></div></div>';
        });
        box.innerHTML = h || '<div class="hint">Пусто</div>';
        box.querySelectorAll('[data-u]').forEach(function (row) {
            row.addEventListener('click', function () {
                var n = row.getAttribute('data-u');
                var inp = $('uninstallName'); if (inp) inp.value = n;
                if (confirm('Запустить деинсталлятор: ' + n + '?')) run('uninstall', n, 'secOut');
            });
        });
        if (text) showOut('secOut', text);
    }

    /* ── Проводник ── */
    var FState = { path: '', parent: null, items: [] };
    function joinPath(dir, name) {
        if (!dir) return name;
        return dir + (dir.slice(-1) === '\\' ? '' : '\\') + name;
    }
    function doLs(path) {
        path = (path || '').trim();
        if (!needLive()) return;
        run('ls', path);
    }
    function refreshDrives() {
        if (!Live.on) return;
        Live.api('/api/action', { method: 'POST', body: { action: 'drives', arg: '' } })
            .then(function (r) { if (r && r.ok !== false) renderDriveChips(r.items || []); })
            .catch(function () {});
    }
    function renderDriveChips(items) {
        var box = $('driveChips');
        if (!box) return;
        box.innerHTML = '';
        items.forEach(function (it) {
            var b = document.createElement('button');
            b.className = 'chip';
            b.textContent = (it.name || '') + ' ' + (it.size ? '· ' + it.size.split(' ')[0] + ' GB' : '');
            b.title = (it.label || '') + ' ' + (it.size || '');
            b.addEventListener('click', function () { doLs(it.name); });
            box.appendChild(b);
        });
    }
    function renderFiles(path, parent, items) {
        FState = { path: path || '', parent: parent || null, items: items || [] };
        paintCrumbs();
        paintFileRows();
        var dl = $('upDestLabel'); if (dl) dl.textContent = FState.path || '—';
    }
    function splitPath(p) {
        // "C:\A\B" → ["C:\", "C:\A", "C:\A\B"]; UNC и прочее — по факту.
        var parts = String(p || '').split('\\').filter(function (x) { return x !== ''; });
        if (!parts.length) return [];
        var out = [];
        var acc = parts[0].slice(-1) === ':' ? parts[0] + '\\' : parts[0];
        out.push({ label: parts[0].slice(-1) === ':' ? parts[0] + '\\' : parts[0], full: acc });
        for (var i = 1; i < parts.length; i++) {
            acc = joinPath(acc, parts[i]);
            out.push({ label: parts[i], full: acc });
        }
        return out;
    }
    function paintCrumbs() {
        var bar = $('crumbBar');
        if (!bar) return;
        bar.innerHTML = '';
        if (!FState.path) { bar.innerHTML = '<span class="hint">Выберите диск ниже</span>'; return; }
        var segs = splitPath(FState.path);
        segs.forEach(function (s, i) {
            if (i > 0) {
                var sep = document.createElement('span');
                sep.className = 'crumb-sep'; sep.textContent = '/';
                bar.appendChild(sep);
            }
            var b = document.createElement('button');
            b.className = 'crumb' + (i === segs.length - 1 ? ' cur' : '');
            b.textContent = s.label;
            if (i !== segs.length - 1) {
                (function (full) { b.addEventListener('click', function () { doLs(full); }); })(s.full);
            }
            bar.appendChild(b);
        });
    }
    function paintFileRows() {
        var box = $('fileList');
        if (!box) return;
        var q = (($('fileSearch') && $('fileSearch').value) || '').toLowerCase();
        var items = FState.items.filter(function (it) {
            return !q || String(it.name || '').toLowerCase().indexOf(q) >= 0;
        });
        var cnt = $('fileCount');
        if (cnt) cnt.textContent = FState.items.length ? FState.items.length + ' объектов' : '—';
        if (!FState.path) { box.innerHTML = ''; return; }
        var h = '';
        if (FState.parent) {
            h += '<div class="frow" data-nav="up"><div class="f-ico">↑</div>' +
                '<div class="f-main"><div class="f-name">Вверх</div><div class="f-meta">..</div></div></div>';
        }
        items.forEach(function (it) {
            var full = joinPath(FState.path, it.name);
            if (it.type === 'dir' || it.type === 'drive') {
                h += '<div class="frow" data-nav="' + esc(full) + '"><div class="f-ico">▸</div>' +
                    '<div class="f-main"><div class="f-name">' + esc(it.name) + '</div>' +
                    '<div class="f-meta">папка' + (it.mtime ? ' · ' + esc(it.mtime) : '') + '</div></div>' +
                    '<button class="icon-btn danger" data-del="' + esc(full) + '" data-isdir="1" title="Удалить папку">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0l1 13h10l1-13"/></svg></button></div>';
            } else {
                h += '<div class="frow" data-get="' + esc(full) + '"><div class="f-ico">≡</div>' +
                    '<div class="f-main"><div class="f-name mono">' + esc(it.name) + '</div>' +
                    '<div class="f-meta">' + esc(it.size || '') + (it.mtime ? ' · ' + esc(it.mtime) : '') + '</div></div>' +
                    '<div class="f-act"><button class="icon-btn go" data-dl="' + esc(full) + '" title="Скачать">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16"/></svg></button>' +
                    '<button class="icon-btn danger" data-del="' + esc(full) + '" title="Удалить">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0l1 13h10l1-13"/></svg></button></div></div>';
            }
        });
        box.innerHTML = h || '<div class="hint">Пусто</div>';
        box.querySelectorAll('[data-nav]').forEach(function (row) {
            row.addEventListener('click', function (ev) {
                if (ev.target.closest && ev.target.closest('[data-del]')) return;
                var p = row.getAttribute('data-nav');
                doLs(p === 'up' ? (FState.parent || '') : p);
            });
        });
        box.querySelectorAll('[data-get]').forEach(function (row) {
            row.addEventListener('click', function (ev) {
                if (ev.target.closest && ev.target.closest('button')) return;
                doGet(row.getAttribute('data-get'));
            });
        });
        box.querySelectorAll('[data-dl]').forEach(function (b) {
            b.addEventListener('click', function (ev) {
                ev.stopPropagation();
                doGet(b.getAttribute('data-dl'));
            });
        });
        box.querySelectorAll('[data-del]').forEach(function (b) {
            b.addEventListener('click', function (ev) {
                ev.stopPropagation();
                var p = b.getAttribute('data-del');
                var isDir = b.getAttribute('data-isdir') === '1';
                if (!confirm((isDir ? 'Удалить папку со всем содержимым?\n' : 'Удалить файл?\n') + p)) return;
                run('file_delete', p, null);
                setTimeout(function () { if (FState.path) doLs(FState.path); }, 900);
            });
        });
    }

    function doGet(path) {
        path = (path || '').trim();
        if (!path) { toast('Введите путь', true); return; }
        if (!needLive()) return;
        toast('Скачивание…');
        var url = Live.base + '/api/file?path=' + encodeURIComponent(path) + '&token=' + encodeURIComponent(Live.token);
        fetch(url).then(function (r) {
            if (r.status === 401) throw new Error('Неверный токен (401)');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var ct = r.headers.get('content-type') || '';
            if (ct.indexOf('json') >= 0) return r.json().then(function (j) { throw new Error((j && j.error) || 'Ошибка файла'); });
            return r.blob();
        }).then(function (blob) {
            var a = document.createElement('a');
            var name = path.split('\\').pop() || 'file';
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            toast('Файл сохранён'); haptic('ok');
        }).catch(function (e) { toast('Скачивание: ' + e.message, true); haptic('err'); });
    }

    /* Загрузка с телефона на ПК — в текущую папку проводника.
     * Тело — сырые байты, Content-Type: text/plain (иначе preflight),
     * прогресс — через XHR. Лимит сервера 250 МБ. */
    function doUpload(files) {
        if (!files || !files.length) return;
        if (!needLive()) return;
        var dir = FState.path;
        if (!dir) { toast('Сначала откройте папку в проводнике', true); return; }
        var list = Array.prototype.slice.call(files);
        var prog = $('uploadProg'), bar = prog ? prog.querySelector('i') : null, st = $('uploadState');
        if (prog) prog.classList.remove('hidden');
        var i = 0, okCount = 0;
        haptic();
        function next() {
            if (i >= list.length) {
                if (st) st.textContent = 'Готово: ' + okCount + '/' + list.length;
                if (bar) bar.style.width = '100%';
                toast('Загружено: ' + okCount + '/' + list.length);
                haptic('ok');
                setTimeout(function () { if (prog) prog.classList.add('hidden'); if (bar) bar.style.width = '0'; }, 1500);
                if (FState.path) doLs(FState.path);
                return;
            }
            var f = list[i];
            if (st) st.textContent = (i + 1) + '/' + list.length + ' · ' + f.name;
            var xhr = new XMLHttpRequest();
            var url = Live.base + '/api/upload?dir=' + encodeURIComponent(dir) +
                '&name=' + encodeURIComponent(f.name) + '&token=' + encodeURIComponent(Live.token);
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
            xhr.upload.onprogress = function (ev) {
                if (ev.lengthComputable && bar) {
                    var pct = ((i + ev.loaded / ev.total) / list.length * 100);
                    bar.style.width = pct.toFixed(1) + '%';
                }
            };
            xhr.onload = function () {
                var ok = false, msg = 'HTTP ' + xhr.status;
                try {
                    var j = JSON.parse(xhr.responseText);
                    ok = !!(j && j.ok); msg = (j && (j.message || j.error)) || msg;
                } catch (e) {}
                if (xhr.status >= 200 && xhr.status < 300 && ok) { okCount++; }
                else if (st) st.textContent = f.name + ': ' + msg;
                i++; next();
            };
            xhr.onerror = function () {
                if (st) st.textContent = f.name + ': сеть недоступна';
                i++; next();
            };
            xhr.send(f);
        }
        next();
    }

    function doCmd(val) {
        if (!val) { toast('Введите команду', true); return; }
        run('cmd', val, 'cmdOut');
    }

    /* ── Автовставка ссылки и токена ── */
    function parseConnectionText(t) {
        t = String(t || '');
        var m = t.match(/https?:\/\/[^\s'"]+/i);
        var url = m ? m[0].replace(/[.,;:!?)\]]+$/, '') : '';
        var rest = m ? t.replace(m[0], ' ') : t;
        var tm = rest.match(/token\s*[:=]\s*([A-Za-z0-9\-_]{8,})/i);
        var token = tm ? tm[1] : '';
        if (!token) {
            var cands = rest.match(/[A-Za-z0-9\-_]{16,}/g) || [];
            token = cands[0] || '';
        }
        return { url: url, token: token };
    }
    function applyParsed(p, source) {
        var changed = false;
        if (p.url && $('liveUrl') && !$('liveUrl').value) { $('liveUrl').value = Live.cleanUrl(p.url); changed = true; }
        if (p.token && $('liveToken') && !$('liveToken').value) { $('liveToken').value = Live.cleanToken(p.token); changed = true; }
        if ($('liveUrl').value && $('liveToken').value && !Live.on) {
            Live.connect(source !== 'silent');
            return true;
        }
        if (changed) toast('Вставлено из буфера');
        return changed;
    }
    var autofillTried = false;
    function tryAutoFill(silent) {
        // 1) start_param из Telegram — base64 или "url|token".
        if (!autofillTried) {
            autofillTried = true;
            try {
                var sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
                if (sp) {
                    var txt = String(sp);
                    try {
                        var b64 = txt.replace(/-/g, '+').replace(/_/g, '/');
                        while (b64.length % 4) b64 += '=';
                        txt = decodeURIComponent(escape(atob(b64)));
                    } catch (e) { txt = String(sp); }
                    var pp = parseConnectionText(txt.replace(/\|/g, ' '));
                    if (pp.url || pp.token) { applyParsed(pp, 'silent'); return; }
                }
            } catch (e) {}
        }
        // 2) Буфер обмена: молча в фоне, с тостом — по кнопке.
        try {
            if (!navigator.clipboard || !navigator.clipboard.readText) {
                if (!silent) toast('Буфер недоступен — вставьте вручную', true);
                return;
            }
            navigator.clipboard.readText().then(function (t) {
                if (!t) { if (!silent) toast('Буфер пуст', true); return; }
                var p = parseConnectionText(t);
                if (!p.url && !p.token) { if (!silent) toast('Ссылки и токена в буфере нет', true); return; }
                applyParsed(p, silent ? 'silent' : 'tap');
            }).catch(function () {
                if (!silent) toast('Нет доступа к буферу — вставьте вручную', true);
            });
        } catch (e) {}
    }

    /* ── Табы ── */
    function switchTab(name) {
        document.querySelectorAll('.tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.tab === name);
        });
        document.querySelectorAll('.tab-page').forEach(function (p) {
            p.classList.toggle('active', p.id === 'tab-' + name);
        });
        haptic();
        try { window.scrollTo({ top: 0 }); } catch (e) { window.scrollTo(0, 0); }
        if (name === 'status') tryAutoFill(true);
        if (name === 'files' && Live.on && !FState.path) refreshDrives();
    }
    document.querySelectorAll('.tab').forEach(function (t) {
        t.addEventListener('click', function () { switchTab(t.dataset.tab); });
    });

    /* ── Пресеты качества ── */
    function paintPresetSeg() {
        document.querySelectorAll('#presetSeg button').forEach(function (b) {
            b.classList.toggle('on', b.dataset.preset === S.preset);
        });
    }
    function applyPreset(name, restart) {
        var p = PRESETS[name];
        if (!p) return;
        S.preset = name;
        S.screenFps = p.fps; S.q = p.q; S.screenW = p.w;
        saveSettings();
        paintStreamControls();
        paintPresetSeg();
        if (restart && Live.on && $('liveScreen') && $('liveScreen').dataset.video) {
            Live.stopScreenVideo();
            setTimeout(function () { Live.startScreenVideo(); }, 350);
        }
        toast('Качество: ' + name.toUpperCase());
    }
    function paintStreamControls() {
        var sf = $('screenFps'), sv = $('screenFpsVal'), sl = $('screenFpsLabel');
        if (sf) sf.value = S.screenFps;
        if (sv) sv.textContent = S.screenFps;
        if (sl) sl.textContent = S.screenFps + ' FPS';
        var cf = $('camFps'), cv = $('camFpsVal'), cl = $('camFpsLabel');
        if (cf) cf.value = S.camFps;
        if (cv) cv.textContent = S.camFps;
        if (cl) cl.textContent = S.camFps + ' FPS';
        var qr = $('qRange'), qv = $('qVal');
        if (qr) qr.value = S.q;
        if (qv) qv.textContent = S.q;
        var wr = $('wRange'), wv = $('wVal');
        if (wr) wr.value = S.screenW;
        if (wv) wv.textContent = S.screenW;
    }

    /* ── Init ── */
    (function init() {
        loadSettings();
        applyTheme(S.theme);
        var hs = $('hapSwitch'); if (hs) hs.checked = !!S.haptics;

        paintInputSwitch();
        paintStreamControls();
        paintPresetSeg();

        var vr = $('volRange'), vv = $('volVal');
        if (vr && vv) vr.addEventListener('input', function () { vv.textContent = vr.value + '%'; });
        var br = $('briRange'), bv = $('briVal');
        if (br && bv) br.addEventListener('input', function () { bv.textContent = br.value; });

        var sf = $('screenFps');
        if (sf) sf.addEventListener('input', function () {
            S.screenFps = parseInt(sf.value, 10) || 30;
            S.preset = ''; saveSettings();
            paintStreamControls(); paintPresetSeg();
        });
        var cf = $('camFps');
        if (cf) cf.addEventListener('input', function () {
            S.camFps = parseInt(cf.value, 10) || 15;
            saveSettings(); paintStreamControls();
        });
        var qr = $('qRange');
        if (qr) qr.addEventListener('input', function () {
            S.q = parseInt(qr.value, 10) || 65;
            S.preset = ''; saveSettings();
            paintStreamControls(); paintPresetSeg();
        });
        var wr = $('wRange');
        if (wr) wr.addEventListener('input', function () {
            S.screenW = parseInt(wr.value, 10) || 1280;
            S.preset = ''; saveSettings();
            paintStreamControls(); paintPresetSeg();
        });
        document.querySelectorAll('#presetSeg button').forEach(function (b) {
            b.addEventListener('click', function () { applyPreset(b.dataset.preset, true); });
        });

        // Крестики очистки
        function bindClear(btnId, inputId) {
            var b = $(btnId), i = $(inputId);
            if (!b || !i) return;
            b.addEventListener('click', function () {
                i.value = '';
                try { i.focus(); } catch (e) {}
                haptic();
            });
        }
        bindClear('urlClear', 'liveUrl');
        bindClear('tokenClear', 'liveToken');
        bindClear('searchClear', 'fileSearch');
        var fsi = $('fileSearch');
        if (fsi) fsi.addEventListener('input', function () { paintFileRows(); });

        // Универсальные кнопки
        document.addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('[data-run]') : null;
            if (b) {
                ev.preventDefault();
                var a = b.dataset.run, arg = b.dataset.arg || '';
                if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
                run(a, arg, OUT_MAP[a]);
                return;
            }
            var cp = ev.target.closest ? ev.target.closest('[data-copy]') : null;
            if (cp) {
                ev.preventDefault();
                copyText(cp.dataset.copy, cp.dataset.copy);
                return;
            }
            var kb = ev.target.closest ? ev.target.closest('[data-key]') : null;
            if (kb) {
                ev.preventDefault();
                krun('key', kb.dataset.key, null);
                return;
            }
            var pol = ev.target.closest ? ev.target.closest('[data-policy]') : null;
            if (pol) {
                ev.preventDefault();
                if (!needLive()) return;
                Live.api('/api/policy?kind=' + pol.dataset.policy).then(function (r) {
                    showOut('policyOut', r.text || '');
                }).catch(function () {
                    if (inTelegram) copyText('/' + pol.dataset.policy, 'Live недоступен — команда скопирована');
                    else toast('Нет связи', true);
                });
                return;
            }
            var chipCmd = ev.target.closest ? ev.target.closest('[data-cmd]') : null;
            if (chipCmd) {
                var ci = $('cmdInput');
                if (ci) ci.value = chipCmd.dataset.cmd;
                doCmd(chipCmd.dataset.cmd);
            }
        });

        function bindRow(inputId, btnId, fn) {
            var i = $(inputId), b = $(btnId);
            if (!i || !b) return;
            var go = function () {
                var val = i.value.trim();
                if (!val) { toast('Введите значение', true); return; }
                fn(val);
            };
            b.addEventListener('click', go);
            i.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); go(); }
            });
        }

        bindRow('openName', 'openBtn', function (v) { run('open', v, 'appOut'); });
        bindRow('closeName', 'closeBtn', function (v) { run('close', v, 'appOut'); });
        bindRow('getPath', 'getBtn', doGet);
        bindRow('cmdInput', 'cmdBtn', doCmd);

        var va = $('volApply');
        if (va) va.addEventListener('click', function () { run('volume', $('volRange').value, null); });
        if (vr) {
            var deb = null;
            vr.addEventListener('change', function () {
                if (!Live.on) return;
                clearTimeout(deb);
                deb = setTimeout(function () { run('volume', vr.value, null); }, 200);
            });
        }
        var ba = $('briApply');
        if (ba) ba.addEventListener('click', function () { run('brightness', $('briRange').value, null); });

        var lc = $('liveConnect');
        if (lc) lc.addEventListener('click', function () { Live.connect(false); });
        var lt = $('liveTest');
        if (lt) lt.addEventListener('click', function () { Live.test(); });
        var ld = $('liveDisconnect');
        if (ld) ld.addEventListener('click', function () { Live.disconnect(); toast('Live отключён'); });
        var pb = $('pasteBtn');
        if (pb) pb.addEventListener('click', function () { tryAutoFill(false); });

        // Экран / камера
        var shot = $('shotBtn');
        if (shot) shot.addEventListener('click', function () {
            if (!needLive()) return;
            Live.refreshShot(); toast('Кадр обновлён'); haptic('ok');
        });
        var mj = $('mjpegBtn');
        if (mj) mj.addEventListener('click', function () {
            if (!needLive()) return;
            Live.startScreenVideo();
            toast('Видео: ' + S.screenW + 'px · q' + S.q + ' · ' + S.screenFps + ' FPS'); haptic('ok');
        });
        var ms = $('mjpegStop');
        if (ms) ms.addEventListener('click', function () {
            Live.stopScreenVideo(); toast('Видео выключено');
        });
        var rs = $('streamRestartBtn');
        if (rs) rs.addEventListener('click', function () {
            if (!needLive()) return;
            Live.stopScreenVideo();
            setTimeout(function () { Live.startScreenVideo(); toast('Поток перезапущен'); }, 350);
        });
        var cam = $('camBtn');
        if (cam) cam.addEventListener('click', function () {
            if (!needLive()) return;
            Live.camShot(); toast('Фото камеры'); haptic('ok');
        });
        var cvb = $('camVideoBtn');
        if (cvb) cvb.addEventListener('click', function () {
            if (!needLive()) return;
            Live.startCamVideo();
            toast('Камера: ' + S.camFps + ' FPS'); haptic('ok');
        });
        var csb = $('camStopBtn');
        if (csb) csb.addEventListener('click', function () { Live.stopCamVideo(); toast('Камера выключена'); });

        /* ── Ввод: тачпад + вождение по кадру + клавиши ── */
        (function remote() {
            var pad = $('touchpad');
            if (pad) {
                var sx = 0, sy = 0, st = 0, accX = 0, accY = 0, lastSend = 0, moved = false, pid = null;
                var SENS = 2.2, TAP_MS = 250, TAP_PX = 12;
                function pos(t) { return { x: t.clientX, y: t.clientY }; }
                function flush(force) {
                    var now = Date.now();
                    if ((!force && now - lastSend < 60) || (accX === 0 && accY === 0)) return;
                    lastSend = now;
                    var dx = Math.round(accX), dy = Math.round(accY);
                    accX -= dx; accY -= dy;
                    if (dx || dy) mrun('mouse_move', dx + ',' + dy, null);
                }
                function start(x, y, id) {
                    if (!needLive()) return;
                    if (!S.inputOn) return;
                    sx = x; sy = y; st = Date.now(); moved = false;
                    accX = 0; accY = 0; pid = (id == null ? 'm' : id);
                }
                function move(x, y, id) {
                    if (!S.inputOn) return;
                    if (pid == null || (id != null && id !== pid)) return;
                    var dx = (x - sx) * SENS, dy = (y - sy) * SENS;
                    sx = x; sy = y;
                    moved = moved || Math.abs(dx) + Math.abs(dy) > TAP_PX;
                    accX += dx; accY += dy;
                    flush(false);
                }
                function end(id) {
                    if (pid == null || (id != null && id !== pid)) return;
                    pid = null;
                    flush(true);
                    if (!moved && Date.now() - st < TAP_MS) mrun('mouse_click', 'left', null);
                    moved = false;
                }
                pad.addEventListener('touchstart', function (e) {
                    e.preventDefault();
                    var t = e.changedTouches[0], p = pos(t);
                    start(p.x, p.y, t.identifier);
                }, { passive: false });
                pad.addEventListener('touchmove', function (e) {
                    e.preventDefault();
                    var t = e.changedTouches[0], p = pos(t);
                    move(p.x, p.y, t.identifier);
                }, { passive: false });
                pad.addEventListener('touchend', function (e) {
                    e.preventDefault();
                    end(e.changedTouches[0].identifier);
                });
                pad.addEventListener('touchcancel', function () { pid = null; moved = false; });
                pad.addEventListener('mousedown', function (e) { start(e.clientX, e.clientY, null); });
                window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY, 'm'); });
                window.addEventListener('mouseup', function () { end('m'); });
            }
            // Вождение мышью по трансляции: палец по картинке — курсор на ПК
            // следом. Тап = левый клик, долгое нажатие = правый клик.
            function paintDot(shot, fx, fy) {
                var dot = $('screenCursor');
                if (!dot || !shot) return;
                try {
                    var r = shot.getBoundingClientRect();
                    var wrap = shot.parentElement;
                    var wr = wrap ? wrap.getBoundingClientRect() : r;
                    dot.classList.remove('hidden');
                    dot.style.left = ((fx * r.width) + (r.left - wr.left)) + 'px';
                    dot.style.top = ((fy * r.height) + (r.top - wr.top)) + 'px';
                    clearTimeout(dot._t);
                    dot._t = setTimeout(function () { dot.classList.add('hidden'); }, 1500);
                } catch (err) {}
            }
            function fracFromEvent(shot, cx, cy) {
                var r = shot.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) return null;
                return {
                    fx: Math.min(1, Math.max(0, (cx - r.left) / r.width)),
                    fy: Math.min(1, Math.max(0, (cy - r.top) / r.height))
                };
            }
            var shot = $('liveScreen');
            if (shot) {
                var driving = false, downAt = 0, dx0 = 0, dy0 = 0, movedFar = false, lastSend = 0;
                var LONG_MS = 500, MOVE_PX = 10;
                shot.style.touchAction = 'none';
                shot.addEventListener('pointerdown', function (e) {
                    if (!Live.on || !S.inputOn) return;
                    try { shot.setPointerCapture(e.pointerId); } catch (err) {}
                    e.preventDefault();
                    driving = true; downAt = Date.now(); dx0 = e.clientX; dy0 = e.clientY; movedFar = false;
                    var f = fracFromEvent(shot, e.clientX, e.clientY);
                    if (f) { paintDot(shot, f.fx, f.fy); lastSend = Date.now(); mrun('mouse_move_to', f.fx.toFixed(3) + ',' + f.fy.toFixed(3), null); }
                });
                shot.addEventListener('pointermove', function (e) {
                    if (!driving || !Live.on || !S.inputOn) return;
                    if (!(e.buttons || e.pointerType === 'touch')) return;
                    e.preventDefault();
                    if (Math.abs(e.clientX - dx0) + Math.abs(e.clientY - dy0) > MOVE_PX) movedFar = true;
                    var f = fracFromEvent(shot, e.clientX, e.clientY);
                    if (!f) return;
                    if (movedFar) downAt = Date.now();
                    if (Date.now() - lastSend < 50) return;
                    lastSend = Date.now();
                    paintDot(shot, f.fx, f.fy);
                    mrun('mouse_move_to', f.fx.toFixed(3) + ',' + f.fy.toFixed(3), null);
                }, { passive: false });
                shot.addEventListener('pointerup', function (e) {
                    if (!driving) return;
                    driving = false;
                    e.preventDefault();
                    var dt = Date.now() - downAt;
                    if (!movedFar && dt < LONG_MS) {
                        var f = fracFromEvent(shot, e.clientX, e.clientY);
                        if (f) { paintDot(shot, f.fx, f.fy); mrun('mouse_click_at', f.fx.toFixed(3) + ',' + f.fy.toFixed(3), null); }
                    } else if (!movedFar) {
                        mrun('mouse_click', 'right', null);
                    }
                });
                shot.addEventListener('pointercancel', function () { driving = false; });
            }
            function bindKeyBtn(id, action, arg, isInput) {
                var b = $(id);
                if (b) b.addEventListener('click', function () {
                    if (isInput) mrun(action, arg, null);
                    else run(action, arg, null);
                });
            }
            bindKeyBtn('rclickBtn', 'mouse_click', 'right', true);
            bindKeyBtn('dblBtn', 'mouse_click', 'double', true);
            bindKeyBtn('wheelUpBtn', 'scroll', '3', true);
            bindKeyBtn('wheelDownBtn', 'scroll', '-3', true);
            var tb = $('typeBtn');
            if (tb) tb.addEventListener('click', function () {
                var i = $('typeInput');
                var v = i ? i.value : '';
                if (!v) { toast('Введите текст', true); return; }
                krun('type', v, null);
                if (i) i.value = '';
            });
            var ti = $('typeInput');
            if (ti) ti.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); if (tb) tb.click(); }
            });
        })();

        var wb = $('wolBtn');
        if (wb) wb.addEventListener('click', function () {
            var m = ($('wolMac').value || '').trim();
            if (!m) { toast('Введите MAC', true); return; }
            run('wol', m, 'powerOut');
        });
        var ub = $('unlockBtn');
        if (ub) ub.addEventListener('click', function () {
            var p = ($('unlockPass').value || '');
            if (!p) { toast('Введите пароль', true); return; }
            if (!confirm('Ввести пароль на экране блокировки?')) return;
            run('unlock', p, 'powerOut');
            $('unlockPass').value = '';
        });
        var pb2 = $('procsBtn');
        if (pb2) pb2.addEventListener('click', function () { run('processes', '', 'procOut'); });
        var sb = $('startupBtn');
        if (sb) sb.addEventListener('click', function () { run('startup', '', null); });
        var unb = $('uninstallBtn');
        if (unb) unb.addEventListener('click', function () {
            var n = ($('uninstallName').value || '').trim();
            if (n) {
                if (confirm('Запустить деинсталлятор: ' + n + '?')) run('uninstall', n, 'secOut');
            } else run('uninstall_list', '', 'secOut');
        });
        var portsBtn = $('portsBtn');
        if (portsBtn) portsBtn.addEventListener('click', function () {
            run('ports', ($('portsInput').value || '').trim(), 'netOut');
        });

        /* ── Проводник: назад / обновить / mkdir / загрузка ── */
        var bb = $('backBtn');
        if (bb) bb.addEventListener('click', function () {
            if (FState.parent) doLs(FState.parent);
            else toast('Уже корень');
        });
        var rb = $('refreshBtn');
        if (rb) rb.addEventListener('click', function () {
            if (FState.path) doLs(FState.path);
            else refreshDrives();
        });
        var mb = $('mkdirBtn');
        if (mb) mb.addEventListener('click', function () {
            var i = $('mkdirInput');
            var name = i ? i.value.trim().replace(/[\\/:*?"<>|]/g, '_') : '';
            if (!name) { toast('Введите имя папки', true); return; }
            if (!FState.path) { toast('Сначала откройте папку', true); return; }
            run('file_mkdir', joinPath(FState.path, name), null);
            if (i) i.value = '';
            setTimeout(function () { if (FState.path) doLs(FState.path); }, 900);
        });
        var upBtn = $('uploadBtn'), upInp = $('uploadInput');
        if (upBtn && upInp) {
            upBtn.addEventListener('click', function () {
                if (!needLive()) return;
                if (!FState.path) { toast('Сначала откройте папку в проводнике', true); return; }
                upInp.click();
            });
            upInp.addEventListener('change', function () {
                doUpload(upInp.files);
                try { upInp.value = ''; } catch (e) {}
            });
        }

        /* ── Мастер-свич ввода ── */
        var isw = $('inputSwitch');
        if (isw) isw.addEventListener('change', function () {
            S.inputOn = !!isw.checked;
            saveSettings();
            paintInputSwitch();
            inputToggleAt = Date.now();
            pushInputState();
            toast(S.inputOn ? 'Ввод включён' : 'Ввод выключен и скрыт');
            haptic('ok');
        });

        /* ── Ещё: тема, вибрация, ссылка, диагностика ── */
        var th = $('themeSwitch');
        if (th) th.addEventListener('change', function () {
            applyTheme(th.checked ? 'light' : 'dark');
            saveSettings();
            haptic('ok');
        });
        if (hs) hs.addEventListener('change', function () {
            S.haptics = !!hs.checked;
            saveSettings();
            haptic('ok');
        });
        var clb = $('copyLinkBtn');
        if (clb) clb.addEventListener('click', function () {
            if (Live.base) copyText(Live.base, 'Ссылка скопирована');
            else toast('Нет подключения', true);
        });
        var cdb = $('copyDiagBtn');
        if (cdb) cdb.addEventListener('click', function () {
            var txt = 'SG Console v6 · ' + new Date().toISOString() + '\n' +
                'Mode: ' + (Live.on ? 'LIVE' : 'offline') + '\n' +
                'Server: ' + (Live.base || '—') + '\n' +
                'Stream: ' + S.screenW + 'px q' + S.q + ' ' + S.screenFps + 'fps (' + (S.preset || 'custom') + ')\n' +
                'Path: ' + (FState.path || '—') + '\n' +
                'State: ' + (($('liveState') && $('liveState').textContent) || '—');
            copyText(txt, 'Диагностика скопирована');
        });

        Live.init();
        tryAutoFill(true);

        /* Настройки опроса */
        (function settings() {
            var ss = $('setStatusSec'), sh = $('setShotSec'), svb = $('setSave'),
                rs = $('setReset'), info = $('setInfo');
            if (!ss) return;
            ss.value = S.statusSec; sh.value = S.shotSec;
            var paintInfo = function () {
                info.textContent = 'Сервер: ' + (Live.base || '—') +
                    ' · ' + (Live.on ? 'LIVE' : (inTelegram ? 'офлайн' : 'демо'));
                var ms2 = $('moreServer');
                if (ms2) ms2.textContent = Live.base ? ('Сервер: ' + Live.base) : 'Нет подключения';
            };
            paintInfo();
            setInterval(paintInfo, 3000);
            svb.addEventListener('click', function () {
                var a = parseFloat(ss.value), b = parseFloat(sh.value);
                if (!(a >= 1 && a <= 30)) { toast('Статы: 1–30 сек', true); return; }
                if (!(b >= 2 && b <= 60)) { toast('Кадр: 2–60 сек', true); return; }
                S.statusSec = a; S.shotSec = b;
                saveSettings();
                if (Live.on) Live.startPoll();
                toast('Настройки сохранены'); haptic('ok');
            });
            rs.addEventListener('click', function () {
                if (!confirm('Сбросить ссылку, токен и все настройки?')) return;
                ['sg_live_url', 'sg_live_token', 'sg_cfg4', 'sg_cfg6'].forEach(function (k) {
                    try { localStorage.removeItem(k); } catch (e) {}
                    try { tg && tg.CloudStorage && tg.CloudStorage.removeItem(k); } catch (e) {}
                });
                S = {
                    statusSec: 2.5, shotSec: 3, fps: 30, q: 65,
                    screenFps: 30, camFps: 15, screenW: 1280, preset: 'pro',
                    inputOn: true, theme: S.theme, haptics: true
                };
                ss.value = S.statusSec; sh.value = S.shotSec;
                if ($('liveUrl')) $('liveUrl').value = '';
                if ($('liveToken')) $('liveToken').value = '';
                paintInputSwitch(); paintStreamControls(); paintPresetSeg();
                Live.disconnect();
                toast('Всё сброшено'); haptic('ok');
            });
        })();

        var banner = $('envBanner');
        if (inTelegram) {
            if (banner) banner.classList.add('hidden');
            setMode(Live.on ? 'Live' : 'Офлайн');
        } else {
            if (banner) banner.classList.remove('hidden');
            setMode('Демо');
        }
    })();
})();
