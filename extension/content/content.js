/*
 * Page-side Browser Bridge loop. It never contacts the network. It watches only
 * the most recent assistant response after page-load baseline, parses fenced
 * @@RUN blocks, and sends commands only to the extension worker.
 */
(function (root) {
  'use strict';
  var BB = root.BB = root.BB || {};
  var host = String(location.hostname || '');
  var site = /claude\.ai$/.test(host) ? 'claude' : /chatgpt\.com$/.test(host) ? 'chatgpt' : /gemini\.google\.com$/.test(host) ? 'gemini' : /arena\.ai$/.test(host) ? 'arena' : /(^|\.)z\.ai$/.test(host) ? 'zai' : /(^|\.)kimi\.(ai|com)$/.test(host) ? "kimi" : null;
  if (!site || !BB.adapters || typeof BB.adapters[site] !== 'function' || !BB.parser || !BB.format) return;
  var adapter = BB.adapters[site]();
  var state = { key: null, started: false, baseline: Object.create(null), handled: Object.create(null), processing: false, scheduled: null };
         
  function messageId(el, index) {
    var attrs = ['data-message-id', 'data-id', 'id', 'data-testid'];
    for (var i = 0; i < attrs.length; i++) { var value = el.getAttribute && el.getAttribute(attrs[i]); if (value) return attrs[i] + ':' + value; }
    var text = Array.prototype.map.call(el.querySelectorAll('pre'), function (pre) { return pre.textContent || ''; }).join('\n');
    var h = 5381; for (var n = 0; n < text.length; n++) h = ((h * 33) ^ text.charCodeAt(n)) >>> 0;
    return 'hash:' + h.toString(16) + ':' + index;
  }
  function send(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) { void chrome.runtime.lastError; resolve(response || null); });
      } catch (e) { resolve(null); }
    });
  }
    function assistantText(el) {
    return Array.prototype.map.call(el.querySelectorAll('pre'), function (pre) {
      var txt = pre.textContent || '';
      return '```\n' + txt + '\n```';
    });
  }
  function insert(el, value) {
    if (!el) return false;
    el.focus();
    var tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') {
      var proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    } else {
      if (site === 'gemini' || site === 'kimi') { var sel = window.getSelection(), rg = document.createRange(); rg.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(rg); var ok = false; try { ok = document.execCommand('insertText', false, value); } catch (e) {} if (!ok) el.textContent = value; } else { el.textContent = value; }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function submit(tries) { tries = tries || 0;
    var button = adapter.send(); if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') { button.click(); return true; } if (tries < 25) { setTimeout(function () { submit(tries + 1); }, 120); return true; }
    var box = adapter.input();
    if (box) { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); return true; }
    return false;
  }
  function deliver(result) {
    var box = adapter.input();
    if (!box) return;
    var text = BB.format.formatResult({ id: result.id, status: result.status, exit: result.exit, durationMs: result.time, output: result.output });
    if (insert(box, text)) setTimeout(submit, 40);
  }
  function scan() {
    state.scheduled = null;
    if (!state.started || state.processing || !state.key || adapter.isGenerating()) return;
    var messages = adapter.assistantMessages();
    if (!messages.length) return;
    var last = messages[messages.length - 1];
    var id = messageId(last, messages.length - 1);
    if (state.baseline[id] || state.handled[id]) return;
    var parsed = BB.parser.parse(assistantText(last), { key: state.key, role: 'assistant' });
    if (!parsed.ok) { if (parsed.error.code !== 'no-block') state.handled[id] = true; return; }
    state.handled[id] = true; state.processing = true;
    send({ type: 'bb:run-request', id: String(parsed.block.id), body: parsed.block.body, timeout: parsed.block.timeoutSec, mode: parsed.block.mode })
      .then(function () { state.processing = false; }).catch(function () { state.processing = false; });
  }
  function schedule() { if (!state.scheduled) state.scheduled = setTimeout(scan, 180); }
  function begin(key) {
    if (typeof key !== 'string' || !key) return;
    state.key = key;
    if (!state.started) {
      adapter.assistantMessages().forEach(function (el, index) { state.baseline[messageId(el, index)] = true; });
      state.started = true;
      new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      setInterval(scan, 900);
    }
    schedule();
  }
  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'bb:session') begin(message.key);
    if (message.type === 'bb:result' && message.result) deliver(message.result);
  });
  send({ type: 'bb:hello', site: site }).then(function (reply) { if (reply && reply.ok) begin(reply.key); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
