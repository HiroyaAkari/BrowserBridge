/* Browser Bridge relay: routes @@TO messages between AI tabs over ports; separate from router.js. */
(function () {
  "use strict";
  var ports = [], sends = [];
  function tabOf(p) { return p.sender && p.sender.tab ? p.sender.tab.id : null; }
  function safe(p, m) { try { p.postMessage(m); } catch (e) {} }
  function bySite(s, not) { return ports.filter(function (p) { return p.bbSite === s && tabOf(p) !== not; })[0] || null; }
  function byTab(id) { return ports.filter(function (p) { return tabOf(p) === id; })[0] || null; }
  function rateOk() { var n = Date.now(); sends = sends.filter(function (t) { return n - t < 300000; }); if (sends.length >= 12) return false; sends.push(n); return true; }
  chrome.runtime.onConnect.addListener(function (p) {
    if (p.name !== "bb-relay" || !p.sender || !p.sender.tab) return;
    ports.push(p);
    p.onDisconnect.addListener(function () { var i = ports.indexOf(p); if (i >= 0) ports.splice(i, 1); });
    p.onMessage.addListener(function (m) {
      if (!m || typeof m.t !== "string") return;
      if (m.t === "hello") { p.bbSite = String(m.site || ""); return; }
      if (m.t === "send") {
        var to = String(m.to || "").toLowerCase(), tg = bySite(to, tabOf(p));
        if (!tg) return safe(p, { t: "error", id: m.id, to: to, reason: "no open tab for " + to });
        if (!rateOk()) return safe(p, { t: "error", id: m.id, to: to, reason: "rate limit: 12 relay messages per 5 minutes" });
        safe(tg, { t: "deliver", id: m.id, from: p.bbSite, origin: tabOf(p), body: String(m.body || "").slice(0, 20000) });
      } else if (m.t === "reply") {
        var o = byTab(m.origin);
        if (o) safe(o, { t: "inbox", id: m.id, from: p.bbSite, text: String(m.text || "").slice(0, 12000) });
      }
    });
  });
})();
