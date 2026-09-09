/* SystemGuard Remote WebApp v2.
 * Транспорт: Telegram.WebApp.sendData(JSON) -> десктопный бот получает web_app_data
 * и выполняет команду. Ответы бота приходят обычными сообщениями в чат.
 * (Старый подход с Bot API getUpdates из браузера неработоспособен by design:
 *  sendMessage шлёт ОТ имени бота и никогда не создаёт update для самого бота,
 *  а токен в localStorage — дыра. Поэтому токенов здесь больше нет вообще.) */
(function () {
    'use strict';

    var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    var inTelegram = !!tg;
    try { if (tg) { tg.ready(); tg.expand(); } } catch (e) {}

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    var ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    var ICON_ERR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';

    function toast(msg, isErr) {
        var wrap = $('toasts');
        if (!wrap) return;
        var d = document.createElement('div');
        d.className = 'toast' + (isErr ? ' err' : '');
        d.innerHTML = (isErr ? ICON_ERR : ICON_OK) + '<span>' + esc(msg) + '</span>';
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

    // Главная отправка: {action, arg} -> бот
    function send(action, arg) {
        action = String(action || '').trim().toLowerCase();
        arg = arg == null ? '' : String(arg).trim();
        if (!action) return;
        if (!inTelegram) {
            toast('Демо-режим: откройте через кнопку Web App в боте', true);
            haptic('err');
            return;
        }
        try {
            tg.sendData(JSON.stringify({ action: action, arg: arg }));
            haptic('ok');
            toast(label(action) + ' → ответ придёт в чат');
        } catch (e) {
            toast('Не удалось отправить: ' + e.message, true);
            haptic('err');
        }
    }

    var LABELS = {
        status: 'Статус запрошен', screenshot: 'Скриншот делается', stream: 'Стрим запускается',
        stop: 'Стрим останавливается', cam: 'Камера снимает', shutdown: 'Выключение через 60с',
        restart: 'Перезагрузка через 60с', sleep: 'Уходим в сон', lock: 'Блокировка',
        cancel: 'Таймер отменён', mute: 'Мут', play: 'Play/Pause', next: 'Следующий трек',
        prev: 'Предыдущий трек', volume: 'Громкость', brightness: 'Яркость',
        open: 'Открытие приложения', close: 'Завершение процесса', ls: 'Список файлов',
        get: 'Файл запрошен', cmd: 'Команда выполняется', clean: 'Очистка запущена',
        ram: 'Оптимизация RAM', ip: 'IP запрошен', ping: 'Ping запущен', uptime: 'Uptime',
        battery: 'Батарея', free: 'Диски', apps: 'Приложения', license: 'Счёт на оплату'
    };
    function label(a) { return LABELS[a] || ('/' + a); }

    // Делегирование кнопок [data-action]
    document.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('[data-action]') : null;
        if (b) {
            ev.preventDefault();
            var needConfirm = (b.dataset.action === 'shutdown' || b.dataset.action === 'restart');
            if (needConfirm && !b.dataset.armed) {
                b.dataset.armed = '1';
                var old = b.innerHTML;
                b.innerHTML = 'Точно? Жми ещё раз';
                setTimeout(function () { b.innerHTML = old; delete b.dataset.armed; }, 3000);
                haptic();
                return;
            }
            send(b.dataset.action, b.dataset.arg || '');
            return;
        }
        var g = ev.target.closest ? ev.target.closest('[data-goto]') : null;
        if (g) { switchTab(g.dataset.goto); return; }
        var chipLs = ev.target.closest ? ev.target.closest('[data-ls]') : null;
        if (chipLs) {
            var lp = $('lsPath');
            if (lp) lp.value = chipLs.dataset.ls;
            send('ls', chipLs.dataset.ls);
            return;
        }
        var chipCmd = ev.target.closest ? ev.target.closest('[data-cmd]') : null;
        if (chipCmd) {
            var ci = $('cmdInput');
            if (ci) ci.value = chipCmd.dataset.cmd;
            send('cmd', chipCmd.dataset.cmd);
        }
    });

    // Табы
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

    // Слайдеры
    function bindSlider(rangeId, valId, applyId, action) {
        var r = $(rangeId), v = $(valId), b = $(applyId);
        if (r && v) r.addEventListener('input', function () { v.textContent = r.value; });
        if (r && !b) {
            var deb = null;
            r.addEventListener('change', function () {
                clearTimeout(deb);
                deb = setTimeout(function () { send(action, r.value); }, 150);
            });
        }
        if (b && r) b.addEventListener('click', function () { send(action, r.value); });
    }
    bindSlider('volRange', 'volVal', 'volApply', 'volume');
    bindSlider('briRange', 'briVal', 'briApply', 'brightness');

    function bindRow(inputId, btnId, action) {
        var i = $(inputId), b = $(btnId);
        if (!i || !b) return;
        var go = function () {
            var val = i.value.trim();
            if (!val) { toast('Введите значение', true); return; }
            send(action, val);
            if (action === 'cmd') i.value = '';
        };
        b.addEventListener('click', go);
        i.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); go(); }
        });
    }
    bindRow('openName', 'openBtn', 'open');
    bindRow('closeName', 'closeBtn', 'close');
    bindRow('lsPath', 'lsBtn', 'ls');
    bindRow('getPath', 'getBtn', 'get');
    bindRow('cmdInput', 'cmdBtn', 'cmd');

    // Статус окружения + тема
    (function init() {
        var dot = $('statusDot'), mode = $('modeLabel'), banner = $('envBanner');
        if (inTelegram) {
            if (dot) dot.classList.remove('off');
            if (mode) {
                var uname = '';
                try { uname = (tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.username) || ''; } catch (e) {}
                mode.textContent = uname ? '@' + uname : 'Telegram';
            }
            if (banner) banner.classList.add('hidden');
            try {
                if (tg.colorScheme === 'light') document.body.classList.add('light');
                if (tg.MainButton) { tg.MainButton.hide(); }
                tg.onEvent && tg.onEvent('themeChanged', function () {});
            } catch (e) {}
        } else {
            if (dot) dot.classList.add('off');
            if (mode) mode.textContent = 'Demo';
            if (banner) banner.classList.remove('hidden');
        }
    })();
})();
