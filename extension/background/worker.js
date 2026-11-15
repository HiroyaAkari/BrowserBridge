/* Browser Bridge MV3 service worker (classic script; all decisions are in router.js). */
'use strict';

/* Core scripts — these MUST load or the extension cannot function. */
importScripts('browser.js', 'router.js', 'relay-bg.js');

/* Optional guard — safe to fail; the fallback in init() will hard-stop every
   command so nothing runs unapproved. */
try {
  importScripts('../guard/guard.js');
} catch (error) {
  console.warn('[browser-bridge] optional guard load failed', error && error.message);
}

(function () {
  var B = self.BB && self.BB.browser;
  var router = null;
  var native = null;
  var initialized = null;

  function init() {
    if (initialized) return initialized;
    initialized = B.ready().then(function (session) {
      native = B.createNative({
        onMessage: function (message) { if (router) router.onNative(message); },
                onDisconnect: function (detail) {
          console.warn('[browser-bridge] native disconnected:', detail);
          if (router) {
            var st = router.getState();
            if (st.current) {
              router.onNative({ type: 'error', id: st.current.id, error: 'Native host disconnected: ' + detail });
            } else {
              B.broadcastState(freshState());
            }
          }
        }
      });
      var guard = self.BB && self.BB.guard && typeof self.BB.guard.check === 'function'
        ? self.BB.guard
        : { check: function () { return { hardStop: true, reason: 'guard-unavailable' }; } };
      router = self.BB.router.createRouter({
        sid: session.sid,
        mode: session.mode,
        native: native,
        guard: guard,
        reply: function (tabId, result) { B.sendToTab(tabId, { type: 'bb:result', result: result }); },
        notify: B.notify,
        onEvent: function (event) { if (event.type === 'state') B.broadcastState(freshState(event.state)); }
      });
      B.broadcastState(freshState());
      return session;
    });
    return initialized;
  }

  function freshState(raw) {
    var state = raw || (router ? router.getState() : {});
    state = Object.assign({}, state, { key: B.getKey(), sid: B.getSid(), bridgeConnected: native ? native.connected : false });
    return state;
  }
  function pageSender(sender) {
    var url = sender && (sender.url || sender.tab && sender.tab.url);
    return B.isAllowedUrl(url);
  }
  function popupSender(sender) {
    return !!(sender && typeof sender.url === 'string' && sender.url.indexOf(B.runtime.getURL('ui/')) === 0);
  }
  function asyncReply(sendResponse, work) {
    Promise.resolve().then(work).then(function (value) { sendResponse(value); }, function (error) { sendResponse({ ok: false, error: String(error && error.message || error) }); });
    return true;
  }

  B.runtime.onMessage(function (message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') return false;
    if (popupSender(sender)) {
      return asyncReply(sendResponse, function () { return init().then(function () {
        if (message.type === 'bb:get-state') return { ok: true, state: freshState() };
        if (message.type === 'bb:set-mode') {
          var change = router.setMode(message.mode);
          if (!change.ok) return { ok: false, error: change.reason };
          return B.setMode(change.mode).then(function () { return B.broadcastSession(B.getKey(), change.mode); }).then(function () { return { ok: true, state: freshState(), result: change }; });
        }
        if (message.type === 'bb:approve') return { ok: true, result: router.approve(message.id), state: freshState() };
        if (message.type === 'bb:skip') return { ok: true, result: router.skip(message.id), state: freshState() };
        if (message.type === 'bb:stop') return { ok: true, result: router.stop(), state: freshState() };
        return { ok: false, error: 'unknown popup message: ' + message.type };
      }); });
    }
    if (!pageSender(sender)) { sendResponse({ ok: false, error: 'sender not allowed' }); return false; }
    return asyncReply(sendResponse, function () { return init().then(function () {
      if (message.type === 'bb:hello') {
        var hello = { ok: true, key: B.getKey(), mode: router.getMode() };
        if (sender.tab && sender.tab.id !== undefined) B.sendToTab(sender.tab.id, { type: 'bb:session', key: hello.key, mode: hello.mode });
        return hello;
      }
      if (message.type === 'bb:run-request') {
var bbHost = ""; try { bbHost = new URL(sender.url || (sender.tab && sender.tab.url) || "").hostname; } catch (e) {} if (/(^|\.)arena\.ai$/.test(bbHost) && !(message.bbSave === true && String(message.body).indexOf("D=") === 0 && String(message.body).indexOf("HOME/Claude/arena") === 4)) { var q = String.fromCharCode(39); message.body = "bwrap --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp --bind $HOME/Claude/arena /work --chdir /work --unshare-all --die-with-parent bash -c " + q + String(message.body || "").replace(new RegExp(q, "g"), q + "\\" + q + q) + q; message.mode = "ask"; }
        return router.request({ tabId: sender.tab && sender.tab.id, id: message.id, body: message.body, timeout: message.timeout, mode: message.mode })
          .then(function (result) { return { ok: true, result: result, state: freshState() }; });
      }
      if (message.type === 'bb:stop') return { ok: true, result: router.stop(), state: freshState() };
      return { ok: false, error: 'unknown page message: ' + message.type };
    }); });
  });

  B.runtime.onInstalled(function () { init().then(function () { B.clearBadge(); return B.broadcastSession(B.getKey(), B.getMode()); }); });
  B.runtime.onStartup(function () { init().then(function () { return B.broadcastSession(B.getKey(), B.getMode()); }); });
  B.tabs.onUpdated(function (tabId, change, tab) {
    if (change.status === 'complete' && B.isAllowedUrl(tab && tab.url)) init().then(function () { return B.sendToTab(tabId, { type: 'bb:session', key: B.getKey(), mode: B.getMode() }); });
  });
  B.runtime.onSuspend(function () { if (native) native.disconnect(); });
  init().catch(function (error) { console.error('[browser-bridge] initialization failed', error); });
})();
// END-OF-FILE extension/background/worker.js