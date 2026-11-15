/*
 * Browser Bridge router — CONTRACT v1.3.
 * UMD with no browser-API access. It serializes native work, owns Ask/Auto approval,
 * claims ids immediately, and treats a guard verdict as routing data only.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BB = root.BB || {};
  root.BB.router = api;
  root.BBRouter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DEFAULT_TIMEOUT = 120;
  var MIN_TIMEOUT = 1;
  var MAX_TIMEOUT = 900;
  var MAX_SEEN = 500;

  function clampTimeout(value) {
    if (value === undefined || value === null || value === '' || !isFinite(Number(value))) return DEFAULT_TIMEOUT;
    var number = Math.floor(Number(value));
    if (number < MIN_TIMEOUT) return MIN_TIMEOUT;
    if (number > MAX_TIMEOUT) return MAX_TIMEOUT;
    return number;
  }

  function normalMode(value) { return value === 'auto' ? 'auto' : 'ask'; }
  function noOp() {}

  function createRouter(deps) {
    var d = deps || {};
    if (!d.native || typeof d.native.send !== 'function') throw new Error('createRouter: native.send(payload) is required');
    if (!d.guard || typeof d.guard.check !== 'function') throw new Error('createRouter: guard.check(body, mode) is required');
    if (typeof d.reply !== 'function') throw new Error('createRouter: reply(tabId, result) is required');

    var native = d.native;
    var guard = d.guard;
    var reply = d.reply;
    var notify = typeof d.notify === 'function' ? d.notify : noOp;
    var onEvent = typeof d.onEvent === 'function' ? d.onEvent : noOp;
    var sid = String(d.sid || 'session');
    var mode = normalMode(d.mode);
    var current = null;
    var queue = [];
    var awaiting = [];
    var claimed = Object.create(null);
    var claimOrder = [];
    var stopLatch = false;
    var sequence = 0;

    function emit(event) {
      try { onEvent(event); } catch (e) { /* telemetry cannot affect routing */ }
    }
    function safeNotify(event) {
      try { notify(event); } catch (e) { /* popup may be closed */ }
    }
    function safeReply(tabId, payload) {
      if (tabId === undefined || tabId === null) return;
      try { reply(tabId, payload); } catch (e) { emit({ type: 'reply-error', id: payload && payload.id, error: String(e && e.message || e) }); }
    }
    function claim(id) {
      claimed[id] = true;
      claimOrder.push(id);
      while (claimOrder.length > MAX_SEEN) delete claimed[claimOrder.shift()];
    }
    function blockedPayload(id, reason) {
      return { v: 1, type: 'result', status: 'blocked', id: id, exit: null, time: 0, cwd: '', output: String(reason), reason: String(reason) };
    }
    function visible(item) {
      if (!item) return null;
      return { id: item.id, tabId: item.tabId, body: item.body, mode: item.requestMode, timeout: item.timeout, status: item.status, reason: item.reason || null, hardStop: item.hardStop === true, createdAt: item.createdAt, startedAt: item.startedAt || null };
    }
    function state() {
      var pendingViews = awaiting.map(visible);
      return {
        sid: sid,
        mode: mode,
        hardStop: stopLatch,
        current: visible(current),
        running: current ? { id: current.id, command: current.body } : null,
        pending: pendingViews,
        pendingItem: pendingViews.length ? pendingViews[0] : null,
        awaiting: awaiting.length,
        awaitingCount: awaiting.length,
        queueLength: queue.length
      };
    }
    function pushedState() { emit({ type: 'state', state: state() }); }
    function item(id, input, verdict) {
      return {
        id: id,
        tabId: input.tabId,
        body: input.body,
        timeout: clampTimeout(input.timeout),
        requestMode: String(input.mode || 'ask').toLowerCase(),
        guardMode: String(input.mode || '').toLowerCase() === 'read' ? 'read' : 'auto',
        hardStop: verdict && verdict.hardStop === true,
        reason: verdict && typeof verdict.reason === 'string' ? verdict.reason : null,
        status: 'new',
        createdAt: new Date().toISOString(),
        startedAt: null,
        sequence: ++sequence
      };
    }
    function hold(entry, reason) {
      entry.reason = reason || entry.reason || 'ask-mode';
      entry.status = 'asking';
      awaiting.push(entry);
      safeNotify({ type: 'needs-user', id: entry.id, body: entry.body, command: entry.body, reason: entry.reason, hardStop: entry.hardStop === true, count: awaiting.length, tabId: entry.tabId });
      pushedState();
      return { ok: true, id: entry.id, status: 'asking', reason: entry.reason };
    }
    function start(entry) {
      current = entry;
      entry.status = 'running';
      entry.startedAt = new Date().toISOString();
      var nativeMode = entry.requestMode === 'script' ? 'script' : 'lines';
      var payload = { v: 1, type: 'run', sid: sid, id: entry.id, mode: nativeMode, timeout: entry.timeout, body: entry.body, tabId: entry.tabId };
      try {
        native.send(payload);
        emit({ type: 'sent', id: entry.id });
      } catch (err) {
        current = null;
        var errorPayload = { v: 1, type: 'result', status: 'error', id: entry.id, exit: null, time: 0, cwd: '', output: 'bridge unavailable: ' + String(err && err.message || err) };
        safeReply(entry.tabId, errorPayload);
        emit({ type: 'finished', id: entry.id, status: 'error' });
      }
      pushedState();
    }
    function drain() {
      if (current || stopLatch || !queue.length) return;
      start(queue.shift());
    }
    function reject(input, id, reason, silent) {
      var result = { ok: false, id: id, status: 'blocked', reason: reason };
      if (!silent) safeReply(input.tabId, blockedPayload(id, reason));
      emit({ type: 'blocked', id: id, reason: reason, silent: silent === true });
      pushedState();
      return result;
    }
    function guardVerdict(input) {
      try {
        return Promise.resolve(guard.check(input.body, input.mode))
          .then(function (value) { return value || { hardStop: false, reason: null }; }, function (error) {
            return { hardStop: true, reason: 'guard-error: ' + String(error && error.message || error) };
          });
      } catch (error) {
        return Promise.resolve({ hardStop: true, reason: 'guard-error: ' + String(error && error.message || error) });
      }
    }

    function request(input) {
      input = input || {};
      var id = input.id === undefined || input.id === null ? '' : String(input.id).trim();
      if (!id || typeof input.body !== 'string' || !input.body.trim()) return Promise.resolve(reject(input, id || null, 'empty command body', false));
      if (claimed[id]) return Promise.resolve(reject(input, id, 'duplicate id: this run was already handled', true));
      claim(id);
      return guardVerdict(input).then(function (verdict) {
        var entry = item(id, input, verdict);
        if (entry.hardStop) return hold(entry, entry.reason || 'hard-stop');
        if (stopLatch) return hold(entry, 'stopped');
        if (mode !== 'auto') return hold(entry, 'ask-mode');
        queue.push(entry);
        var wasIdle = !current && !stopLatch;
        drain();
        pushedState();
        return { ok: true, id: id, status: wasIdle ? 'running' : 'queued', reason: null };
      });
    }

    function findAwaiting(id) {
      for (var i = 0; i < awaiting.length; i++) if (awaiting[i].id === String(id)) return i;
      return -1;
    }
    function approve(id) {
      var at = findAwaiting(id);
      if (at < 0) return { ok: false, reason: 'unknown id' };
      var entry = awaiting.splice(at, 1)[0];
      if (stopLatch) stopLatch = false;
      entry.status = 'queued';
      queue.push(entry);
      drain();
      pushedState();
      return { ok: true, id: entry.id };
    }
    function skip(id) {
      var at = findAwaiting(id);
      if (at < 0) return { ok: false, reason: current && current.id === String(id) ? 'already running; use stop()' : 'unknown id' };
      var entry = awaiting.splice(at, 1)[0];
      entry.status = 'blocked';
      var payload = blockedPayload(entry.id, 'skipped by user');
      safeReply(entry.tabId, payload);
      emit({ type: 'skipped', id: entry.id });
      pushedState();
      return { ok: true, id: entry.id, promise: Promise.resolve(payload) };
    }
    function stop() {
      var queued = queue.splice(0);
      var pending = awaiting.splice(0);
      var dropped = queued.concat(pending);
      for (var i = 0; i < dropped.length; i++) safeReply(dropped[i].tabId, blockedPayload(dropped[i].id, 'stopped before it ran'));
      stopLatch = true;
      if (current) current.status = 'stopping';
      try { native.send({ v: 1, type: 'stop' }); } catch (e) { emit({ type: 'native-send-error', error: String(e && e.message || e) }); }
      safeNotify({ type: 'stopped', count: 0 });
      emit({ type: 'stopped', cleared: dropped.length, inFlight: current && current.id });
      pushedState();
      return { ok: true, stopped: true, cleared: dropped.length, inFlight: current ? current.id : null };
    }
    function setMode(next) {
      if (next !== 'ask' && next !== 'auto') return { ok: false, reason: 'mode must be ask or auto' };
      mode = next;
      if (mode === 'auto') drain();
      pushedState();
      return { ok: true, mode: mode };
    }
    function complete(entry, message) {
      if (current !== entry) return { ok: false, reason: 'not-running' };
      current = null;
      var status = message.status || 'done';
      var payload = {
        v: 1, type: 'result', status: status, id: entry.id,
        exit: message.exit === undefined ? null : message.exit,
        time: message.time === undefined ? (message.duration === undefined ? 0 : Math.round(Number(message.duration) * 1000)) : message.time,
        cwd: message.cwd === undefined || message.cwd === null ? '' : message.cwd,
        output: message.output === undefined || message.output === null ? '' : String(message.output)
      };
      if (message.truncated !== undefined) payload.truncated = message.truncated;
      safeReply(entry.tabId, payload);
      emit({ type: 'finished', id: entry.id, status: status });
      drain();
      pushedState();
      return { ok: true, status: status };
    }
        function onNative(message) {
      if (!message || typeof message !== 'object') return { ok: false, reason: 'empty native message' };
      if (message.type === 'started') { if (current && (!message.id || String(message.id) === current.id)) current.status = 'running'; safeNotify({ type: 'started', id: message.id }); pushedState(); return { ok: true }; }
      if (message.type === 'stopped') {
        if (current && (!message.id || String(message.id) === current.id)) return complete(current, { status: 'stopped', output: 'stopped by user', exit: null, cwd: '' });
        pushedState(); return { ok: true };
      }
      if (message.type === 'needs-user') {
        if (current && (!message.id || String(message.id) === current.id)) current.status = 'needs-user';
        safeNotify({ type: 'needs-user', id: message.id || current && current.id, body: current && current.body, command: current && current.body, text: message.message || message.text || '', reason: message.reason || message.kind || 'needs-user', count: 1, tabId: current && current.tabId });
        pushedState(); return { ok: true };
      }
      if (message.type === 'result') {
        if (!current) { safeNotify({ type: 'orphan-result', id: message.id }); return { ok: true }; }
        if (message.id !== undefined && String(message.id) !== current.id) return { ok: false, reason: 'id mismatch' };
        return complete(current, message);
      }
      if (message.type === 'error') {
        if (!current) { safeNotify({ type: 'orphan-error', id: message.id }); return { ok: true }; }
        if (message.id !== undefined && String(message.id) !== current.id) return { ok: false, reason: 'id mismatch' };
        return complete(current, { status: 'error', output: message.error || message.message || 'bridge error', exit: null, cwd: '' });
      }
      if (message.type === 'pong' || message.type === 'log') { safeNotify({ type: message.type, id: message.id, text: message.message || '' }); return { ok: true }; }
      return { ok: false, reason: 'unknown native message type' };
    }
    function reset() { current = null; queue = []; awaiting = []; claimed = Object.create(null); claimOrder = []; stopLatch = false; pushedState(); return { ok: true }; }

    return {
      request: request, approve: approve, skip: skip, stop: stop, setMode: setMode,
      getMode: function () { return mode; }, getState: state, onNative: onNative, reset: reset,
      hasSeen: function (id) { return claimed[String(id)] === true; },
      entryOf: function (id) { var key = String(id); if (current && current.id === key) return current; for (var i = 0; i < awaiting.length; i++) if (awaiting[i].id === key) return awaiting[i]; for (var j = 0; j < queue.length; j++) if (queue[j].id === key) return queue[j]; return null; },
      setSid: function (value) { sid = String(value || sid); return sid; },
      clampTimeout: clampTimeout
    };
  }
  return { createRouter: createRouter, clampTimeout: clampTimeout, DEFAULT_TIMEOUT: DEFAULT_TIMEOUT, MAX_TIMEOUT: MAX_TIMEOUT };
});
// END-OF-FILE extension/background/router.js 274