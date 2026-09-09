/* SystemGuard Remote WebApp v3.
 * Два режима:
 *  LIVE  — прямая связь с ПК по HTTPS (Cloudflare Tunnel): статы, скриншоты,
 *          MJPEG-видео, камера, мгновенные команды, файлы и вывод CMD — всё
 *          прямо здесь. Нужны ссылка + токен из вкладки Telegram в приложении.
 *  RELAY — команды через Telegram.WebApp.sendData в десктопный бот,
 *          ответы приходят сообщениями в чат. Токенов в браузере нет вообще.
 * Иконки — только инлайновые SVG (Lucide), никаких эмодзи в интерфейсе. */
(function () {
    'use strict';

    /* ── SVG-иконки (Lucide, stroke) ─────────────────────────────── */
    var P = {
        shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
        radio: '<circle cx="12" cy="12" r="2"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
        activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
        hdd: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
        battery: '<rect width="16" height="10" x="2" y="7" rx="2" ry="2"/><line x1="22" x2="22" y1="11" y2="13"/><line x1="6" x2="6" y1="11" y2="13"/><line x1="10" x2="10" y1="11" y2="13"/><line x1="14" x2="14" y1="11" y2="13"/>',
        clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
        mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
        monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
        camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
        video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>',
        power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
        restart: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
        moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
        lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
        play: '<polygon points="6 3 20 12 6 21 6 3"/>',
        prev: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
        next: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
        zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
        globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
        signal: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>',
        list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
        stop: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
        folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
        terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
        star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
        sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
        check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
        alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'
    };
    function svg(name) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || P.info) + '</svg>';
    }
    document.querySelectorAll('[data-icon]').forEach(function (el) {
        el.innerHTML = svg(el.getAttribute('data-icon'));
    });

    /* ── База ─────────────────────────────────────────────── */
    var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    var inTelegram = !!tg;
    try { if (tg) { tg.ready(); tg.expand(); } } catch (e) {}

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function toast(msg, isErr) {
        var wrap = $('toasts');
        if (!wrap) return;
        var d = document.createElement('div');
        d.className = 'toast' + (isErr ? ' err' : '');
        d.innerHTML = svg(isErr ? 'alert' : 'check') + '<span>' + esc(msg) + '</span>';
        wrap.appendChild(d);
        while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
        setTimeout(function () {
            d.style.opacity = '0';
            d.style.transition = 'opacity .3s';
            setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 320);
        }, 2600);
    }
    function haptic(kind) {
        try {
            if (tg && tg.HapticFeedback) {
                if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success');
                else if (kind === 'err') tg.HapticFeedback.notificationOccurred('error');
                else tg.HapticFeedback.impactOccurred('light');
            }
        } catch (e) {}
    }
    function store(k, v) {
        try { localStorage.setItem(k, v); } catch (e) {}
        try { tg && tg.CloudStorage && tg.CloudStorage.setItem(k, v); } catch (e) {}
    }
    function load(k) {
        try { var v = localStorage.getItem(k); if (v) return v; } catch (e) {}
        return '';
    }

    /* ── LIVE-клиент (прямой HTTPS до ПК) ─────────────────── */
    var Live = {
        base: '', token: '', on: false,
        pollTimer: null, shotTimer: null, mjpeg: false,
        init: function () {
            var u = ($('liveUrl') && $('liveUrl').value) || load('sg_live_url');
            var t = ($('liveToken') && $('liveToken').value) || load('sg_live_token');
            if (u && $('liveUrl')) $('liveUrl').value = u;
            if (t && $('liveToken')) $('liveToken').value = t;
            if (u && t) this.connect(true);
        },
        api: function (path, opts) {
            var self = this;
            opts = opts || {};
            var headers = { 'X-Token': self.token };
            if (opts.body) headers['Content-Type'] = 'application/json';
            var ctrl = new AbortController();
            var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000);
            return fetch(self.base + path, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body ? JSON.stringify(opts.body) : undefined,
                signal: ctrl.signal
            }).then(function (r) {
                clearTimeout(timer);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                var ct = r.headers.get('content-type') || '';
                return ct.indexOf('json') >= 0 ? r.json() : r.blob();
            });
        },
        connect: function (silent) {
            var self = this;
            var u = ($('liveUrl').value || '').trim().replace(/\/+$/, '');
            var t = ($('liveToken').value || '').trim();
            if (!u || !t) { if (!silent) toast('Введите ссылку и токен', true); return; }
            self.base = u; self.token = t;
            self.setState('Проверка связи…');
            self.api('/api/status', { timeout: 12000 }).then(function (s) {
                if (!s || s.ok === false) throw new Error((s && s.error) || 'bad reply');
                self.on = true;
                store('sg_live_url', u); store('sg_live_token', t);
                self.renderStatus(s);
                self.startPoll();
                self.refreshShot();
                $('livePanels').classList.remove('hidden');
                $('liveDisconnect').classList.remove('hidden');
                self.setState('Связано с ' + (s.machine || 'ПК'));
                setMode('Live');
                toast('Live связано');
                haptic('ok');
            }).catch(function (e) {
                self.on = false;
                self.setState('Нет связи: ' + e.message);
                if (!silent) { toast('Нет связи: ' + e.message, true); haptic('err'); }
            });
        },
        disconnect: function () {
            this.on = false; this.base = '';
            clearInterval(this.pollTimer); clearInterval(this.shotTimer);
            this.pollTimer = this.shotTimer = null;
            this.setMjpeg(false);
            $('livePanels').classList.add('hidden');
            $('liveDisconnect').classList.add('hidden');
            this.setState('Не связано — работает relay через чат');
            setMode(inTelegram ? 'Relay' : 'Demo');
        },
        setState: function (t) { var e = $('liveState'); if (e) e.textContent = t; },
        startPoll: function () {
            var self = this;
            clearInterval(self.pollTimer);
            self.pollTimer = setInterval(function () {
                if (!self.on) return;
                self.api('/api/status', { timeout: 8000 }).then(function (s) {
                    if (s && s.ok !== false) self.renderStatus(s);
                }).catch(function () {});
            }, 2500);
            clearInterval(self.shotTimer);
            self.shotTimer = setInterval(function () {
                if (!self.on || self.mjpeg) return;
                self.refreshShot();
            }, 3000);
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
        },
        shotUrl: function (w, q) {
            return this.base + '/api/shot.jpg?w=' + (w || 800) + '&q=' + (q || 55) + '&t=' + Date.now();
        },
        refreshShot: function () {
            var img = $('liveScreen');
            if (img && this.on) img.src = this.shotUrl(800, 55);
        },
        setMjpeg: function (on) {
            this.mjpeg = on;
            var img = $('liveScreen'), btn = $('mjpegBtn');
            if (on && img) img.src = this.base + '/api/mjpeg?fps=2&q=50';
            if (btn) btn.textContent = on ? 'Стоп видео' : 'Видео';
            if (!on) this.refreshShot();
        },
        camShot: function () {
            var self = this;
            var img = $('liveCam');
            if (img) {
                img.classList.remove('hidden');
                img.src = self.base + '/api/cam.jpg?t=' + Date.now();
            }
        }
    };

    function setText(id, v) { var e = $(id); if (e) e.textContent = v; }
    function setMode(m) {
        var e = $('modeLabel'); if (e) e.textContent = m;
        var d = $('statusDot'); if (d) d.classList.toggle('off', m !== 'Live');
    }

    /* ── Единая отправка ──────────────────────────────────── */
    var LIVE_ACTIONS = { volume: 1, brightness: 1, mute: 1, play: 1, prev: 1, next: 1, shutdown: 1, restart: 1, cancel: 1, sleep: 1, lock: 1, open: 1, close: 1, cmd: 1, ls: 1, clean: 1, ram: 1, ip: 1, ping: 1, uptime: 1, battery: 1, free: 1, apps: 1, status: 1 };

    var LABELS = {
        status: 'Статус', screenshot: 'Скриншот', stream: 'Стрим в чат', stop: 'Стоп',
        cam: 'Камера', shutdown: 'Выключение через 60с', restart: 'Рестарт через 60с',
        sleep: 'Сон', lock: 'Блокировка', cancel: 'Таймер отменён', mute: 'Мут',
        play: 'Play/Pause', next: 'Следующий трек', prev: 'Предыдущий трек',
        volume: 'Громкость', brightness: 'Яркость', open: 'Открытие', close: 'Завершение',
        ls: 'Список файлов', get: 'Файл', cmd: 'Команда', clean: 'Очистка', ram: 'RAM',
        ip: 'IP', ping: 'Ping', uptime: 'Uptime', battery: 'Батарея', free: 'Диски',
        apps: 'Приложения', license: 'Счёт на оплату', processes: 'Процессы'
    };
    function label(a) { return LABELS[a] || ('/' + a); }

    function relay(action, arg) {
        if (!inTelegram) { toast('Демо-режим: откройте через Web App в боте', true); haptic('err'); return; }
        try {
            tg.sendData(JSON.stringify({ action: action, arg: arg || '' }));
            haptic('ok');
            toast(label(action) + ' → ответ в чате');
        } catch (e) { toast('Не удалось отправить', true); haptic('err'); }
    }

    // Возвращает promise только для live-ветки с inline-рендером
    function run(action, arg, inline) {
        action = String(action || '').toLowerCase();
        arg = arg == null ? '' : String(arg);
        if (action === 'license') { relay(action, arg); return null; }
        if (Live.on && LIVE_ACTIONS[action]) return liveRun(action, arg, inline);
        relay(action, arg);
        return null;
    }

    function liveRun(action, arg, inline) {
        haptic();
        return Live.api('/api/action', { method: 'POST', body: { action: action, arg: arg } })
            .then(function (r) {
                if (!r) throw new Error('empty');
                if (r.ok === false) { toast(r.error || 'Ошибка', true); haptic('err'); return r; }
                haptic('ok');
                if (inline) inline(r); else toast(r.message || label(action));
                if (action === 'volume') Live.api('/api/status').then(function (s) { if (s && s.ok !== false) Live.renderStatus(s); }).catch(function () {});
                return r;
            })
            .catch(function (e) {
                toast('Live недоступен, шлю через чат', true);
                Live.disconnect();
                relay(action, arg);
            });
    }

    /* ── Привязка UI ──────────────────────────────────────── */
    document.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('.cmd[data-action]') : null;
        if (b) {
            ev.preventDefault();
            var a = b.dataset.action, arg = b.dataset.arg || '';
            if ((a === 'shutdown' || a === 'restart') && !b.dataset.armed) {
                b.dataset.armed = '1';
                var old = b.innerHTML;
                b.innerHTML = 'Точно? Ещё раз';
                setTimeout(function () { b.innerHTML = old; delete b.dataset.armed; }, 3000);
                haptic();
                return;
            }
            if (a === 'ls') { doLs(arg || $('lsPath').value); return; }
            if (a === 'get') { doGet($('getPath').value); return; }
            run(a, arg);
            return;
        }
        var g = ev.target.closest ? ev.target.closest('[data-goto]') : null;
        if (g) { switchTab(g.dataset.goto); return; }
        var chipLs = ev.target.closest ? ev.target.closest('[data-ls]') : null;
        if (chipLs) {
            var lp = $('lsPath');
            if (lp) lp.value = chipLs.dataset.ls;
            doLs(chipLs.dataset.ls);
            return;
        }
        var chipCmd = ev.target.closest ? ev.target.closest('[data-cmd]') : null;
        if (chipCmd) {
            var ci = $('cmdInput');
            if (ci) ci.value = chipCmd.dataset.cmd;
            doCmd(chipCmd.dataset.cmd);
        }
    });

    function switchTab(name) {
        document.querySelectorAll('.tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.tab === name);
        });
        document.querySelectorAll('.tab-page').forEach(function (p) {
            p.classList.toggle('active', p.id === 'tab-' + name);
        });
        haptic();
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    }
    document.querySelectorAll('.tab').forEach(function (t) {
        t.addEventListener('click', function () { switchTab(t.dataset.tab); });
    });

    /* Слайдеры: live — мгновенно на сервер, relay — командой в чат */
    function bindVolume() {
        var r = $('volRange'), v = $('volVal');
        if (r && v) r.addEventListener('input', function () { v.textContent = r.value + '%'; });
        var apply = $('volApply');
        if (apply) apply.addEventListener('click', function () {
            run('volume', r.value, function (res) {
                if (res.message) toast(res.message);
            });
        });
        if (r) {
            var deb = null;
            r.addEventListener('change', function () {
                if (!Live.on) return;
                clearTimeout(deb);
                deb = setTimeout(function () { run('volume', r.value); }, 200);
            });
        }
    }
    function bindBrightness() {
        var r = $('briRange'), v = $('briVal');
        if (r && v) r.addEventListener('input', function () { v.textContent = r.value; });
        var apply = $('briApply');
        if (apply) apply.addEventListener('click', function () {
            run('brightness', r.value, function (res) { toast(res.message || res.error || ''); });
        });
    }

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

    function doCmd(val) {
        if (Live.on) {
            run('cmd', val, function (r) {
                var out = $('cmdOut');
                if (out) {
                    out.classList.remove('hidden');
                    out.textContent = (r.output || r.message || '').slice(0, 6000);
                }
            });
        } else {
            var i = $('cmdInput'); if (i) i.value = '';
            relay('cmd', val);
        }
    }

    function doLs(path) {
        path = (path || '').trim();
        if (Live.on) {
            run('ls', path, function (r) { renderFiles(r.path || path, r.items || []); });
        } else {
            relay('ls', path);
            var box = $('fileList');
            if (box) box.innerHTML = '<div class="hint">Список придёт в чат с ботом.</div>';
        }
    }

    function doGet(path) {
        path = (path || '').trim();
        if (!path) { toast('Введите путь', true); return; }
        if (Live.on) {
            window.open(Live.base + '/api/file?path=' + encodeURIComponent(path), '_blank');
            toast('Скачивание началось');
        } else relay('get', path);
    }

    function renderFiles(path, items) {
        var box = $('fileList');
        if (!box) return;
        var h = '<div class="hint">' + esc(path) + ' · ' + items.length + '</div>';
        var cur = path;
        items.forEach(function (it) {
            var ic = it.type === 'dir' ? 'folder' : 'download';
            h += '<div class="frow" data-p="' + esc(cur + (cur.slice(-1) === '\\' ? '' : '\\') + it.name) + '" data-t="' + it.type + '">' +
                svg(ic) + '<span class="fname">' + esc(it.name) + '</span><span class="fsize">' + esc(it.size || '') + '</span></div>';
        });
        box.innerHTML = h || '<div class="hint">Пусто</div>';
        box.querySelectorAll('.frow').forEach(function (row) {
            row.addEventListener('click', function () {
                var p = row.getAttribute('data-p'), t = row.getAttribute('data-t');
                if (t === 'dir') {
                    var lp = $('lsPath'); if (lp) lp.value = p;
                    doLs(p);
                } else doGet(p);
            });
        });
    }

    /* ── Init ─────────────────────────────────────────────── */
    (function init() {
        bindVolume(); bindBrightness();
        bindRow('openName', 'openBtn', function (v) {
            run('open', v, function (r) {
                var o = $('appOut');
                if (o) { o.classList.remove('hidden'); o.textContent = r.message || ''; }
            });
        });
        bindRow('closeName', 'closeBtn', function (v) {
            run('close', v, function (r) {
                var o = $('appOut');
                if (o) { o.classList.remove('hidden'); o.textContent = r.message || ''; }
            });
        });
        bindRow('lsPath', 'lsBtn', doLs);
        bindRow('getPath', 'getBtn', doGet);
        bindRow('cmdInput', 'cmdBtn', doCmd);

        var lc = $('liveConnect');
        if (lc) lc.addEventListener('click', function () { Live.connect(false); });
        var ld = $('liveDisconnect');
        if (ld) ld.addEventListener('click', function () { Live.disconnect(); toast('Live отключён'); });
        var shot = $('shotBtn');
        if (shot) shot.addEventListener('click', function () {
            if (Live.on) Live.refreshShot();
            else run('screenshot', '');
        });
        var mj = $('mjpegBtn');
        if (mj) mj.addEventListener('click', function () {
            if (!Live.on) { run('stream', ''); return; }
            Live.setMjpeg(!Live.mjpeg);
            haptic();
        });
        var cam = $('camBtn');
        if (cam) cam.addEventListener('click', function () {
            if (Live.on) { Live.camShot(); haptic(); }
            else run('cam', '');
        });

        Live.init();

        var dot = $('statusDot'), banner = $('envBanner');
        if (inTelegram) {
            if (banner) banner.classList.add('hidden');
            try {
                var uname = (tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.username) || '';
                setMode(Live.on ? 'Live' : (uname ? '@' + uname : 'Relay'));
            } catch (e) { setMode('Relay'); }
            if (dot && !Live.on) dot.classList.add('off');
        } else {
            if (banner) banner.classList.remove('hidden');
            setMode('Demo');
            if (dot) dot.classList.add('off');
        }
    })();
})();
