/* Chrome adapter — the only background/UI support module that calls chrome.*. */
(function (root) {
  'use strict';
  var BB = root.BB = root.BB || {};
  var HOST = 'com.browserbridge.bridge';
  var ALLOWED = ['https://claude.ai/*', 'https://chatgpt.com/*', 'https://gemini.google.com/*'];
  var ALLOWED_RE = /^https:\/\/(claude\.ai|chatgpt\.com|gemini\.google\.com)\//;
  var KEYS = { sid: 'bb.sid', key: 'bb.key', mode: 'bb.mode' };
  var cache = { sid: null, key: null, mode: 'ask' };
  var readyPromise = null;

  function bytesHex(n) {
    var a = new Uint8Array(n); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function session() { return chrome && chrome.storage && chrome.storage.session; }
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = Promise.resolve().then(function () {
      var area = session(); return area ? area.get([KEYS.sid, KEYS.key, KEYS.mode]) : {};
    }).catch(function () { return {}; }).then(function (stored) {
      stored = stored || {}; var patch = {};
      cache.sid = typeof stored[KEYS.sid] === 'string' && stored[KEYS.sid] ? stored[KEYS.sid] : 'sid-' + bytesHex(8);
      cache.key = typeof stored[KEYS.key] === 'string' && stored[KEYS.key] ? stored[KEYS.key] : bytesHex(32);
      cache.mode = stored[KEYS.mode] === 'auto' ? 'auto' : 'ask';
      if (!stored[KEYS.sid]) patch[KEYS.sid] = cache.sid;
      if (!stored[KEYS.key]) patch[KEYS.key] = cache.key;
      if (!stored[KEYS.mode]) patch[KEYS.mode] = cache.mode;
      var area = session(); return Object.keys(patch).length && area ? area.set(patch).then(function () { return cache; }) : cache;
    });
    return readyPromise;
  }
  function setMode(mode) {
    cache.mode = mode === 'auto' ? 'auto' : 'ask';
    var area = session();
    return (area ? area.set({ 'bb.mode': cache.mode }) : Promise.resolve()).then(function () { return cache.mode; });
  }
  function sendToTab(tabId, message) {
    if (tabId === undefined || tabId === null) return Promise.resolve(false);
    return Promise.resolve(chrome.tabs.sendMessage(tabId, message)).then(function () { return true; }, function () { return false; });
  }
  function isAllowedUrl(url) { return typeof url === 'string' && ALLOWED_RE.test(url); }
  function badge(text, color, title) {
    try { chrome.action.setBadgeText({ text: text || '' }); if (color) chrome.action.setBadgeBackgroundColor({ color: color }); if (title) chrome.action.setTitle({ title: title }); } catch (e) { /* shutdown */ }
  }
  function clearBadge() { badge('', null, 'Browser Bridge'); }
  function broadcastPopup(message) { try { var p = chrome.runtime.sendMessage(message); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  function broadcastState(state) {
    broadcastPopup({ type: 'bb:state', state: state });
    if (state && state.pending && state.pending.length) badge(String(state.pending.length), '#b45309', 'Browser Bridge: command needs approval');
    else if (state && state.current) badge('…', '#2563eb', 'Browser Bridge: running');
    else clearBadge();
  }
  function notify(event) {
    event = event || {};
    if (event.type === 'needs-user') {
      badge(String(event.count || 1), '#b45309', 'Browser Bridge: command needs approval');
      if (event.tabId !== undefined) sendToTab(event.tabId, { type: 'bb:needs-user', id: event.id, reason: event.reason, hardStop: event.hardStop === true });
      broadcastPopup({ type: 'bb:needs-user', payload: event });
    }
  }
  function broadcastSession(key, mode) {
    return Promise.resolve(chrome.tabs.query({ url: ALLOWED })).then(function (tabs) {
      return Promise.all((tabs || []).map(function (tab) { return sendToTab(tab.id, { type: 'bb:session', key: key, mode: mode }); }));
    }).catch(function () { return []; });
  }
  function createNative(options) {
    options = options || {}; var port = null;
    function connect() {
      if (port) return port;
      port = chrome.runtime.connectNative(options.host || HOST);
      port.onMessage.addListener(function (message) { if (typeof options.onMessage === 'function') options.onMessage(message); });
      port.onDisconnect.addListener(function () { var detail = chrome.runtime.lastError && chrome.runtime.lastError.message || 'disconnected'; port = null; if (typeof options.onDisconnect === 'function') options.onDisconnect(detail); });
      return port;
    }
    return {
      send: function (message) { connect().postMessage(message); return true; },
      disconnect: function () { if (port) try { port.disconnect(); } catch (e) {} port = null; },
      get connected() { return !!port; }
    };
  }
  /* Event/message adapters keep chrome.* out of worker.js and popup.js. */
  var runtime = {
    sendMessage: function (message) {
      try { return Promise.resolve(chrome.runtime.sendMessage(message)); }
      catch (error) { return Promise.reject(error); }
    },
    onMessage: function (handler) {
      chrome.runtime.onMessage.addListener(function (message, sender, respond) {
        return handler(message, sender || {}, respond);
      });
    },
    onInstalled: function (handler) { chrome.runtime.onInstalled.addListener(handler); },
    onStartup: function (handler) { chrome.runtime.onStartup.addListener(handler); },
    onSuspend: function (handler) { if (chrome.runtime.onSuspend) chrome.runtime.onSuspend.addListener(handler); },
    getURL: function (path) { return chrome.runtime.getURL(path); }
  };
  var tabs = {
    onUpdated: function (handler) { chrome.tabs.onUpdated.addListener(handler); }
  };

  var ALLOWED = [
  'https://claude.ai/*',
  'https://chatgpt.com/*',
  'https://gemini.google.com/*',
  'https://arena.ai/*',
  'https://chat.z.ai/*',
  'https://z.ai/*', 'https://*.kimi.ai/*', 'https://*.kimi.com/*', 'https://www.perplexity.ai/*', 'https://perplexity.ai/*'
];
var ALLOWED_RE = /^https:\/\/(claude\.ai|chatgpt\.com|gemini\.google\.com|arena\.ai|chat\.z\.ai|z\.ai|(www\.)?kimi\.(ai|com)|(www\.)?perplexity\.ai)\//;

  BB.browser = {
    HOST: HOST, ALLOWED: ALLOWED, ready: ready, setMode: setMode,
    getSid: function () { return cache.sid; }, getKey: function () { return cache.key; }, getMode: function () { return cache.mode; },
    isAllowedUrl: isAllowedUrl, sendToTab: sendToTab, broadcastSession: broadcastSession,
    broadcastState: broadcastState, notify: notify, clearBadge: clearBadge, createNative: createNative,
    runtime: runtime, tabs: tabs
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
// END-OF-FILE extension/background/browser.js 110
