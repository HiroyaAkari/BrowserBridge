/* Browser Bridge popup controller. Browser APIs are delegated to BB.browser. */
(function () {
  'use strict';
  var B = globalThis.BB.browser;
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    key: $('key'), show: $('show'), copy: $('copy'), ask: $('ask'), auto: $('auto'),
    pill: $('mode-pill'), help: $('mode-help'), notice: $('notice'), count: $('count'),
    empty: $('empty'), pending: $('pending'), command: $('command'), reason: $('reason'),
    run: $('run'), skip: $('skip'), running: $('running'), stop: $('stop'), status: $('status')
  };
  var state = { key: '', visible: false, data: null };

  function setStatus(text, kind) {
    el.status.textContent = text || '';
    el.status.className = kind || '';
  }
  function send(message) { return B.runtime.sendMessage(message); }
  function firstPending(snapshot) {
    return snapshot && Array.isArray(snapshot.pending) && snapshot.pending.length ? snapshot.pending[0] : null;
  }
  function render(snapshot) {
    if (!snapshot) return;
    state.data = snapshot;
    if (snapshot.key) state.key = snapshot.key;
    el.key.textContent = state.visible ? state.key.replace(/(.{8})/g, '$1 ').trim() : '••••••••••••••••••••••••';
    var auto = snapshot.mode === 'auto';
    el.pill.textContent = auto ? 'Auto' : 'Ask';
    el.ask.classList.toggle('selected', !auto);
    el.auto.classList.toggle('selected', auto);
    el.help.textContent = auto ? 'Auto runs clean commands; hard stops still wait.' : 'Ask is the default and resets when the browser closes.';
    var item = firstPending(snapshot);
    el.pending.hidden = !item;
    el.empty.hidden = !!item;
    el.run.disabled = !item;
    el.skip.disabled = !item;
    el.notice.hidden = !item;
    if (item) {
      el.command.textContent = item.body || '(empty command)';
      el.reason.textContent = item.reason || 'Ask mode: click Run or Skip.';
    }
    var count = (snapshot.pending || []).length;
    el.count.hidden = !count;
    el.count.textContent = count ? 'needs you ' + count : '';
    el.running.textContent = snapshot.current ? (snapshot.current.body || 'Running…') : 'Idle.';
  }
  function refresh() {
    return send({ type: 'bb:get-state' }).then(function (reply) {
      if (!reply) { setStatus('Service worker not responding.', 'err'); return; }
      render(reply.state);
    }).catch(function (error) {
      setStatus(error.message || 'Could not reach service worker.', 'err');
    });
  }
  function action(type, fields) {
    return send(Object.assign({ type: type }, fields || {})).then(function (reply) {
      if (!reply) throw new Error('no response from service worker');
      if (reply.ok === false) throw new Error(reply.error || 'request failed');
      render(reply.state);
      return reply;
    }).catch(function (error) { setStatus(error.message || String(error), 'err'); });
  }

  el.show.addEventListener('click', function () {
    state.visible = !state.visible;
    el.show.textContent = state.visible ? 'Hide' : 'Show';
    render(state.data);
  });
  el.copy.addEventListener('click', function () {
    if (!state.key) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.key).then(function () { setStatus('Session key copied.', 'ok'); }, function () { setStatus('Copy failed; use Show.', 'err'); });
    } else setStatus('Clipboard unavailable; use Show.', 'err');
  });
  el.ask.addEventListener('click', function () { action('bb:set-mode', { mode: 'ask' }); });
  el.auto.addEventListener('click', function () { action('bb:set-mode', { mode: 'auto' }); });
  el.run.addEventListener('click', function () { var item = firstPending(state.data); if (item) action('bb:approve', { id: item.id }); });
  el.skip.addEventListener('click', function () { var item = firstPending(state.data); if (item) action('bb:skip', { id: item.id }); });
  el.stop.addEventListener('click', function () { action('bb:stop'); });

  B.runtime.onMessage(function (message) {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'bb:state') render(message.state);
    if (message.type === 'bb:needs-user') refresh();
    return false;
  });
  refresh().catch(function (error) { setStatus(error.message || 'Could not reach service worker.', 'err'); });
})();
// END-OF-FILE extension/ui/popup.js