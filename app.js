/* SystemGuard Remote WebApp v4 — полное зеркало десктопа.
 * ПРИНЦИП: всё выполняется ВНУТРИ WebApp через Live HTTP API.
 * tg.sendData НЕ вызывается никогда — поэтому приложение НЕ закрывается
 * после каждого действия (sendData по дизайну Telegram закрывает WebApp).
 * License/Pro: команда копируется в буфер — вставьте в чат с ботом.
 * Кадры и MJPEG идут с ?token= в URL (img не умеет в headers).
 * Выводы консоли — inline в <pre> через textContent, кириллица чистая
 * (сервер: OEM-декод + UnsafeRelaxedJsonEscaping). */
(function () {
    'use strict';

    var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    var inTelegram = !!tg;
    try {
        if (tg) {
            tg.ready();
            try { tg.expand(); } catch (e) {}
            // Иначе свайп вниз закрывает приложение вместо прокрутки —
            // главная причина «верстка не листается» на телефоне.
            try {
                if (tg.isVersionAtLeast && tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
            } catch (e) {}
            try { tg.setHeaderColor && tg.setHeaderColor('#F1F4F8'); } catch (e) {}
            try { tg.setBackgroundColor && tg.setBackgroundColor('#F1F4F8'); } catch (e) {}
        }
    } catch (e) {}

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
        d.textContent = msg;
        wrap.appendChild(d);
        while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
        setTimeout(function () {
            d.style.opacity = '0';
            setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 300);
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
    function copyText(t, label) {
        function done() { toast((label || 'Скопировано') + ' — вставьте в чат с ботом'); haptic('ok'); }
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

    /* ── Настройки ── */
    var S = { statusSec: 2.5, shotSec: 3, fps: 15, q: 55, screenFps: 15, camFps: 15 };
    function loadSettings() {
        try {
            var raw = localStorage.getItem('sg_cfg4');
            if (raw) {
                var c = JSON.parse(raw);
                if (c.statusSec >= 1 && c.statusSec <= 30) S.statusSec = c.statusSec;
                if (c.shotSec >= 2 && c.shotSec <= 60) S.shotSec = c.shotSec;
                if (c.fps >= 1 && c.fps <= 30) S.fps = c.fps;
                if (c.q >= 30 && c.q <= 85) S.q = c.q;
                if (c.screenFps >= 1 && c.screenFps <= 30) S.screenFps = c.screenFps;
                if (c.camFps >= 1 && c.camFps <= 30) S.camFps = c.camFps;
            }
        } catch (e) {}
    }
    function saveSettings() {
        try { localStorage.setItem('sg_cfg4', JSON.stringify(S)); } catch (e) {}
        try { tg && tg.CloudStorage && tg.CloudStorage.setItem('sg_cfg4', JSON.stringify(S)); } catch (e) {}
    }
    function store(k, v) {
        try { localStorage.setItem(k, v); } catch (e) {}
        try { tg && tg.CloudStorage && tg.CloudStorage.setItem(k, v); } catch (e) {}
    }
    function load(k) {
        try { var v = localStorage.getItem(k); if (v) return v; } catch (e) {}
        return '';
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
        // Токен дублируем: header X-Token (fetch) + ?token= (img/download).
        q: function (path) {
            var sep = path.indexOf('?') >= 0 ? '&' : '?';
            return this.base + path + sep + 'token=' + encodeURIComponent(this.token);
        },
        api: function (path, opts) {
            var self = this;
            opts = opts || {};
            var headers = { 'X-Token': self.token };
            if (opts.body) headers['Content-Type'] = 'application/json';
            var ctrl = new AbortController();
            var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000);
            // token и в query — на случай строгих прокси, режущих headers
            var sep = path.indexOf('?') >= 0 ? '&' : '?';
            var url = self.base + path + sep + 'token=' + encodeURIComponent(self.token);
            return fetch(url, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body ? JSON.stringify(opts.body) : undefined,
                signal: ctrl.signal
            }).then(function (r) {
                clearTimeout(timer);
                if (r.status === 401) {
                    var ae = new Error('Неверный токен (401). Скопируйте токен из вкладки Telegram на ПК заново.');
                    ae.code = 401;
                    throw ae;
                }
                if (!r.ok) throw new Error('HTTP ' + r.status);
                var ct = r.headers.get('content-type') || '';
                return ct.indexOf('json') >= 0 ? r.json() : r.blob();
            }).catch(function (e) {
                clearTimeout(timer);
                throw normErr(e);
            });
        },
        cleanToken: function (s) { return String(s || '').replace(/\s+/g, ''); },
        cleanUrl: function (s) { return String(s || '').replace(/\s+/g, '').replace(/\/+$/, ''); },
        // 401 = токен на ПК сменился, а в приложении лежит старый.
        // Стираем сохранённый, чтобы не долбиться протухшим, и просим новый.
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
                self.diag('Ссылка должна начинаться с https:// — внутри Telegram разрешён только HTTPS.\nPublish live link даёт https://…trycloudflare.com');
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
                $('livePanels').classList.remove('hidden');
                $('liveDisconnect').classList.remove('hidden');
                self.setState('Связано с ' + (s.machine || 'ПК'));
                setMode('Live');
                toast('Live связано — всё внутри приложения');
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
            this.stopScreenVideo(); this.stopCamVideo();
            $('livePanels').classList.add('hidden');
            $('liveDisconnect').classList.add('hidden');
            this.setState('Не связано');
            setMode(inTelegram ? 'Офлайн' : 'Демо');
        },
        setState: function (t) { var e = $('liveState'); if (e) e.textContent = t; },
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
        },
        refreshShot: function () {
            var img = $('liveScreen');
            if (img && this.on) {
                delete img.dataset.video;
                img.src = this.q('/api/shot.jpg?w=960&q=' + S.q) + '&t=' + Date.now();
            }
        },
        startScreenVideo: function (fps) {
            var img = $('liveScreen');
            if (!img || !this.on) return;
            img.dataset.video = '1';
            img.src = this.q('/api/mjpeg?fps=' + (fps || S.screenFps) + '&q=' + S.q + '&w=960');
            var btn = $('mjpegBtn'); if (btn) btn.textContent = 'Видео ●';
        },
        stopScreenVideo: function () {
            var img = $('liveScreen');
            if (img) { delete img.dataset.video; img.src = ''; }
            var btn = $('mjpegBtn'); if (btn) btn.textContent = 'Видео';
        },
        camShot: function () {
            var img = $('liveCam');
            if (img && this.on) {
                img.classList.remove('hidden');
                delete img.dataset.video;
                img.src = this.q('/api/cam.jpg') + '&t=' + Date.now();
            }
        },
        startCamVideo: function (fps) {
            var img = $('liveCam');
            if (!img || !this.on) return;
            img.classList.remove('hidden');
            img.dataset.video = '1';
            img.src = this.q('/api/cammjpeg?fps=' + (fps || S.camFps) + '&q=' + S.q);
        },
        stopCamVideo: function () {
            var img = $('liveCam');
            if (img) { delete img.dataset.video; }
        }
    };

    function normErr(e) {
        if (e && e.name === 'AbortError') return new Error('Таймаут: ПК не ответил за 12–15 сек (спит, выключен или туннель упал).');
        if (e instanceof TypeError) return new Error('failed to fetch: сеть/туннель недоступен. Проверьте: 1) ПК включён и приложение запущено, 2) live опубликован (Publish live link), 3) ссылка свежая (туннель меняет URL при перезапуске), 4) интернет на телефоне.');
        return e;
    }
    function diagText(e, url) {
        var m = (e && e.message) || String(e);
        return 'Диагностика:\n' +
            '• Ошибка: ' + m + '\n' +
            '• URL: ' + (url || '—') + '\n' +
            '• Что проверить:\n' +
            '  1. ССЫЛКА ОДНОРАЗОВАЯ: при каждом Publish / перезапуске ПК\n' +
            '     туннель выдаёт НОВЫЙ адрес. Свежий всегда в чате:\n' +
            '     отправьте боту /live и скопируйте оттуда.\n' +
            '  2. На ПК приложение запущено, live опубликован (зелёный статус).\n' +
            '  3. Ссылка целиком, без пробелов, начинается с https://.\n' +
            '  4. Токен совпадает (вкладка Telegram на ПК).\n' +
            '  5. ПК не спит/не выключен. Вне дома — только через туннель.\n' +
            '  6. Подождите 20 сек и нажмите Проверить ещё раз\n' +
            '     (туннель холодным стартует медленно).';
    }

    function setText(id, v) { var e = $(id); if (e) e.textContent = v; }
    function setMode(m) {
        var e = $('modeLabel'); if (e) e.textContent = m;
        var d = $('statusDot'); if (d) d.className = 'dot ' + (m === 'Live' ? 'on' : (m === 'Офлайн' || m === 'Демо' ? 'off' : ''));
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

    /* ── Выполнение: ВСЁ внутри WebApp, закрытия нет ── */
    var OUT_MAP = {
        perf: 'statusOut', sysinfo: 'statusOut', uptime: 'statusOut', battery: 'statusOut',
        free: 'statusOut', license_status: 'statusOut', power_plans: 'powerOut',
        ip: 'netOut', ping: 'netOut', netstat: 'netOut', connections: 'netOut',
        wifi: 'netOut', dnsflush: 'netOut', ports: 'netOut',
        defender_status: 'secOut', cleanup_info: 'secOut', clean: 'secOut', ram: 'secOut',
        eventlog: 'secOut', services: 'secOut', game_boost: 'secOut', sched_list: 'secOut'
    };
    var LABELS = {
        shutdown: 'Выключение через 60с', restart: 'Рестарт через 60с', sleep: 'Сон',
        hibernate: 'Гибернация', lock: 'Блокировка', wake: 'Пробуждение экрана',
        cancel: 'Таймер отменён', mute: 'Мут', play: 'Play/Pause', next: 'Трек ▶',
        prev: 'Трек ◀', volume: 'Громкость', brightness: 'Яркость',
        open: 'Открытие', close: 'Завершение', cmd: 'Команда', ls: 'Файлы',
        clean: 'Очистка', ram: 'RAM', perf: 'Perf', sysinfo: 'Система'
    };
    function label(a) { return LABELS[a] || a; }

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
                // Списки с items рендерим отдельно, текст — в out
                if (action === 'processes') { renderProcs(r.items || [], text); return r; }
                if (action === 'startup') { renderStartup(r.items || [], text); return r; }
                if (action === 'uninstall_list') { renderUninstall(r.items || [], text); return r; }
                if (action === 'connections' || action === 'power_plans' || action === 'sched_list') {
                    var oid = outId || OUT_MAP[action] || 'secOut';
                    showOut(oid, text);
                    toast(r.message || label(action));
                    return r;
                }
                if (action === 'ls') { renderFiles(r.path || '', r.items || []); return r; }
                var target = outId || OUT_MAP[action];
                if (target) showOut(target, text);
                else toast(String(text).slice(0, 160));
                return r;
            })
            .catch(function (e) {
                toast('Нет связи: ' + (e.message || e), true);
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
                h += '<div class="frow"><span class="fname">' + esc(it.name) + ' · ' + it.pid + ' · ' + it.mem + ' MB</span>' +
                    '<button class="kill" data-kill="' + esc(it.name) + '">✕</button></div>';
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
            h += '<div class="frow"><span class="fname">' + (it.enabled ? '[ON] ' : '[OFF] ') + esc(it.name) + '</span>' +
                '<button class="kill" data-st="' + esc(it.name) + '" data-en="' + (it.enabled ? '0' : '1') + '">' + (it.enabled ? 'OFF' : 'ON') + '</button></div>';
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
            h += '<div class="frow" data-u="' + esc(it.name) + '"><span class="fname">' + esc(it.name) + '</span><span class="fsize">' + esc(it.version || '') + '</span></div>';
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
    function renderFiles(path, items) {
        var box = $('fileList');
        if (!box) return;
        var h = '<div class="hint">' + esc(path) + ' · ' + items.length + '</div>';
        items.forEach(function (it) {
            var full = path + (path.slice(-1) === '\\' ? '' : '\\') + it.name;
            h += '<div class="frow" data-p="' + esc(full) + '" data-t="' + it.type + '">' +
                '<span class="fname">' + esc(it.name) + '</span><span class="fsize">' + esc(it.size || '') + '</span></div>';
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

    function doLs(path) {
        path = (path || '').trim();
        if (!needLive()) return;
        run('ls', path);
    }
    function doGet(path) {
        path = (path || '').trim();
        if (!path) { toast('Введите путь', true); return; }
        if (!needLive()) return;
        toast('Скачивание…');
        // fetch с токеном → blob → сохранение (встроено, без window.open без токена)
        var sep = '?';
        var url = Live.base + '/api/file?path=' + encodeURIComponent(path) + '&token=' + encodeURIComponent(Live.token);
        fetch(url, { headers: { 'X-Token': Live.token } }).then(function (r) {
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
    function doCmd(val) {
        if (!val) { toast('Введите команду', true); return; }
        run('cmd', val, 'cmdOut');
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
    }
    document.querySelectorAll('.tab').forEach(function (t) {
        t.addEventListener('click', function () { switchTab(t.dataset.tab); });
    });

    /* ── Init ── */
    (function init() {
        loadSettings();

        // Слайдеры значений
        var vr = $('volRange'), vv = $('volVal');
        if (vr && vv) vr.addEventListener('input', function () { vv.textContent = vr.value + '%'; });
        var br = $('briRange'), bv = $('briVal');
        if (br && bv) br.addEventListener('input', function () { bv.textContent = br.value; });
        var sf = $('screenFps'), sv = $('screenFpsVal'), sl = $('screenFpsLabel');
        if (sf) sf.value = S.screenFps;
        if (sf) sf.addEventListener('input', function () {
            S.screenFps = parseInt(sf.value, 10) || 15;
            if (sv) sv.textContent = S.screenFps;
            if (sl) sl.textContent = S.screenFps + ' FPS';
        });
        var cf = $('camFps'), cv = $('camFpsVal'), cl = $('camFpsLabel');
        if (cf) cf.value = S.camFps;
        if (cf) cf.addEventListener('input', function () {
            S.camFps = parseInt(cf.value, 10) || 15;
            if (cv) cv.textContent = S.camFps;
            if (cl) cl.textContent = S.camFps + ' FPS';
        });
        if (sv) sv.textContent = S.screenFps;
        if (sl) sl.textContent = S.screenFps + ' FPS';
        if (cv) cv.textContent = S.camFps;
        if (cl) cl.textContent = S.camFps + ' FPS';

        // Универсальные кнопки data-run (всё внутри, без закрытия)
        document.addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('[data-run]') : null;
            if (b) {
                ev.preventDefault();
                var a = b.dataset.run, arg = b.dataset.arg || '';
                if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
                var map = { perf: 'statusOut', sysinfo: 'statusOut', uptime: 'statusOut', battery: 'statusOut', free: 'statusOut', license_status: 'statusOut', power_plans: 'powerOut', ip: 'netOut', ping: 'netOut', netstat: 'netOut', connections: 'netOut', wifi: 'netOut', dnsflush: 'netOut', defender_status: 'secOut', cleanup_info: 'secOut', clean: 'secOut', ram: 'secOut', eventlog: 'secOut', services: 'secOut', game_boost: 'secOut', sched_list: 'secOut' };
                run(a, arg, map[a]);
                return;
            }
            var cp = ev.target.closest ? ev.target.closest('[data-copy]') : null;
            if (cp) {
                ev.preventDefault();
                copyText(cp.dataset.copy, cp.dataset.copy);
                return;
            }
            var pol = ev.target.closest ? ev.target.closest('[data-policy]') : null;
            if (pol) {
                ev.preventDefault();
                if (!needLive()) return;
                Live.api('/api/policy?kind=' + pol.dataset.policy).then(function (r) {
                    showOut('policyOut', r.text || '');
                }).catch(function (e) { toast('Нет связи', true); });
                return;
            }
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
        bindRow('lsPath', 'lsBtn', doLs);
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

        var shot = $('shotBtn');
        if (shot) shot.addEventListener('click', function () {
            if (!needLive()) return;
            Live.refreshShot(); toast('Кадр обновлён'); haptic('ok');
        });
        var mj = $('mjpegBtn');
        if (mj) mj.addEventListener('click', function () {
            if (!needLive()) return;
            Live.startScreenVideo(S.screenFps);
            toast('Видео экрана: ' + S.screenFps + ' FPS'); haptic('ok');
        });
        var ms = $('mjpegStop');
        if (ms) ms.addEventListener('click', function () {
            Live.stopScreenVideo(); Live.refreshShot(); toast('Видео выключено');
        });
        var cam = $('camBtn');
        if (cam) cam.addEventListener('click', function () {
            if (!needLive()) return;
            Live.camShot(); toast('Фото камеры'); haptic('ok');
        });
        var cvb = $('camVideoBtn');
        if (cvb) cvb.addEventListener('click', function () {
            if (!needLive()) return;
            Live.startCamVideo(S.camFps);
            toast('Видео камеры: ' + S.camFps + ' FPS'); haptic('ok');
        });
        var csb = $('camStopBtn');
        if (csb) csb.addEventListener('click', function () { Live.stopCamVideo(); toast('Видео камеры выключено'); });

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
        var pb = $('procsBtn');
        if (pb) pb.addEventListener('click', function () { run('processes', '', 'procOut'); });
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

        Live.init();

        /* Настройки */
        (function settings() {
            var ss = $('setStatusSec'), sh = $('setShotSec'), fp = $('setFps'),
                qq = $('setQ'), svb = $('setSave'),
                rs = $('setReset'), info = $('setInfo');
            if (!ss) return;
            ss.value = S.statusSec; sh.value = S.shotSec; fp.value = S.fps; qq.value = S.q;
            var paintInfo = function () {
                info.textContent = 'Сервер: ' + (Live.base || '—') +
                    ' · Режим: ' + (Live.on ? 'LIVE (всё внутри)' : (inTelegram ? 'офлайн' : 'демо'));
            };
            paintInfo();
            setInterval(paintInfo, 3000);
            svb.addEventListener('click', function () {
                var a = parseFloat(ss.value), b = parseFloat(sh.value),
                    c = parseInt(fp.value, 10), d = parseInt(qq.value, 10);
                if (!(a >= 1 && a <= 30)) { toast('Статы: 1–30 сек', true); return; }
                if (!(b >= 2 && b <= 60)) { toast('Скриншоты: 2–60 сек', true); return; }
                if (!(c >= 1 && c <= 30)) { toast('FPS: 1–30', true); return; }
                if (!(d >= 30 && d <= 85)) { toast('Качество: 30–85', true); return; }
                S.statusSec = a; S.shotSec = b; S.fps = c; S.q = d;
                saveSettings();
                if (Live.on) Live.startPoll();
                toast('Настройки сохранены'); haptic('ok');
            });
            rs.addEventListener('click', function () {
                ['sg_live_url', 'sg_live_token', 'sg_cfg4'].forEach(function (k) {
                    try { localStorage.removeItem(k); } catch (e) {}
                    try { tg && tg.CloudStorage && tg.CloudStorage.removeItem(k); } catch (e) {}
                });
                S = { statusSec: 2.5, shotSec: 3, fps: 15, q: 55, screenFps: 15, camFps: 15 };
                ss.value = S.statusSec; sh.value = S.shotSec; fp.value = S.fps; qq.value = S.q;
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
