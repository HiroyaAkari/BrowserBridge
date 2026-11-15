/* Browser Bridge relay (page side): @@TO blocks from Claude go to another AI tab, its reply comes back as @@FROM. */
(function (root) {
"use strict"; var AUTO_RELAY = true;
var BB = root.BB || {}, host = String(location.hostname || "");
var site = /claude\.ai$/.test(host) ? "claude" : /chatgpt\.com$/.test(host) ? "chatgpt" : /gemini\.google\.com$/.test(host) ? "gemini" : /perplexity\.ai$/.test(host) ? "perplexity" : /arena\.ai$/.test(host) ? "arena" : /(^|\.)z\.ai$/.test(host) ? "zai" : /(^|\.)kimi\.(ai|com)$/.test(host) ? "kimi" : null;
if (!site || !BB.adapters || typeof BB.adapters[site] !== "function") return;
var ad = BB.adapters[site](), key = null, started = false, handled = {}, port = null, busy = false;
function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }
function put(el, v) {
  if (!el) return false; el.focus(); var t = String(el.tagName || "").toLowerCase();
  if (t === "textarea" || t === "input") { var d = Object.getOwnPropertyDescriptor(t === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value"); if (d && d.set) d.set.call(el, v); else el.value = v; }
  else { var s = getSelection(), r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); var ok = false; try { ok = document.execCommand("insertText", false, v); } catch (e) {} if (!ok) el.textContent = v; }
  el.dispatchEvent(new Event("input", { bubbles: true })); return true;
}
function submit(n) {
  n = n || 0; var b = ad.send();
  if (b && !b.disabled && b.getAttribute("aria-disabled") !== "true") { b.click(); return; }
  if (n < 25) { setTimeout(function () { submit(n + 1); }, 120); return; }
  var x = ad.input(); if (x) x.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
}
function say(v) { if (put(ad.input(), v)) setTimeout(submit, 60); }
function banner(text, yes, no) { if (AUTO_RELAY && yes) { yes(); return; }
  var old = document.getElementById("bb-relay-banner"); if (old) old.remove();
  var d = document.createElement("div"); d.id = "bb-relay-banner";
  d.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:360px;background:#222;color:#fff;padding:12px;border-radius:8px;font:13px sans-serif;white-space:pre-wrap";
  var p = document.createElement("div"); p.textContent = text; d.appendChild(p);
  function btn(l, f) { var b = document.createElement("button"); b.textContent = l; b.style.cssText = "margin:8px 8px 0 0;padding:4px 10px;cursor:pointer"; b.onclick = function () { d.remove(); if (f) f(); }; d.appendChild(b); }
  if (yes) { btn("Approve", yes); btn("Deny", no); } else btn("OK");
  document.body.appendChild(d);
}
function clean(s) { return String(s || "").replace(/@@/g, "@ @"); }
function parseTo(txt) {
  var lines = txt.replace(/\r/g, "").split("\n"), h = /^\s*@@TO\s+(.*)$/.exec(lines[0]); if (!h) return null;
  var f = {}; h[1].replace(/(\w+)=(\S+)/g, function (_, k, v) { f[k.toLowerCase()] = v; });
  var body = [], end = false;
  for (var i = 1; i < lines.length; i++) { if (/^\s*@@END\s*$/.test(lines[i])) { end = true; break; } body.push(lines[i]); }
  if (!end || !f.key || f.key !== key || !f.to || !f.id) return null;
  return { to: f.to.toLowerCase(), id: f.id, body: body.join("\n").trim() };
}
var queue = [];
function stripUi(t) { var l = String(t || "").replace(/\r/g, "").split("\n"); while (l.length && /^\s*(thinking( complete)?|thought for.*|copy|retry|share)\s*$/i.test(l[0])) l.shift(); return l.join("\n").trim(); }
function pick(el) { var pr = el.querySelectorAll("pre"), i, m; for (i = pr.length - 1; i >= 0; i--) { m = /^\s*@@REPLY[^\n]*\n([\s\S]*?)\n?\s*@@END\s*$/.exec(pr[i].textContent || ""); if (m) return m[1].trim(); } return stripUi(el.innerText); }
function intro(m) { var s = "[From " + m.from + " via Browser Bridge, msg " + m.id + "]\n" + m.body + "\n\nReply with ONE fenced code block that starts with a line @@REPLY and ends with a line @@END. Only that block is sent back."; if (site === "arena") s += " You are the code writer. To save a file, put ONE fenced code block in your reply that starts with the line @@SAVE name=FILENAME (a plain file name, no folders) followed by the file content, and ends with a line @@END. It is saved automatically into your own folder, so you never need a key or commands. Add overwrite=yes on the @@SAVE line only when you must replace an existing file."; return s; }
function pump() { if (busy || !queue.length) return; var m = queue.shift(); busy = true; var before = ad.assistantMessages().length, t0 = Date.now(), stable = 0, lastLen = -1; say(intro(m)); var iv = setInterval(function () { var ms = ad.assistantMessages(), done = false, text = ""; if (ms.length > before && !ad.isGenerating()) { var tx = ms[ms.length - 1].innerText || ""; if (tx.length && tx.length === lastLen) stable++; else { stable = 0; lastLen = tx.length; } if (stable >= 5 && (/^thinking complete/i.test(tx.trim()) || !/^thinking/i.test(tx.trim()))) { done = true; text = pick(ms[ms.length - 1]); } } if (Date.now() - t0 > 180000) { done = true; text = "[no reply within 3 minutes]"; } if (done) { clearInterval(iv); busy = false; if (port) port.postMessage({ t: "reply", id: m.id, origin: m.origin, text: text }); setTimeout(pump, 1500); } }, 1000); }
function deliver(m) { queue.push(m); pump(); }
function onMsg(m) {
  if (!m || !m.t) return;
  if (m.t === "deliver") deliver(m);
  else if (m.t === "inbox") qsay("@@FROM from=" + m.from + " id=" + m.id + "\n" + clean(m.text) + "\n@@END");
  else if (m.t === "error") say("@@FROM from=" + m.to + " id=" + m.id + " status=failed\n" + clean(m.reason) + "\n@@END");
}
var inq = [], draining = false;
function qsay(v) { inq.push(v); drain(); }
function drain() { if (draining || !inq.length) return; draining = true; var t = inq.shift(), n = 0; (function w() { if (ad.isGenerating() && n++ < 120) { setTimeout(w, 1000); return; } say(t); setTimeout(function () { draining = false; drain(); }, 4000); })(); }
function connect() {
  try { port = chrome.runtime.connect({ name: "bb-relay" }); } catch (e) { setTimeout(connect, 2000); return; }
  port.postMessage({ t: "hello", site: site }); port.onMessage.addListener(onMsg);
  port.onDisconnect.addListener(function () { port = null; setTimeout(connect, 1000); });
}
function scan() {
  if (!key || !started || ad.isGenerating()) return;
  var ms = ad.assistantMessages(); if (!ms.length) return;
  var pres = ms[ms.length - 1].querySelectorAll("pre");
  for (var i = 0; i < pres.length; i++) {
    var txt = pres[i].textContent || ""; if (!/^\s*@@TO\b/.test(txt)) continue;
    var id = hash(txt); if (handled[id]) continue; handled[id] = true;
    var p = parseTo(txt); if (!p) continue;
    banner("Claude wants to send to " + p.to + ":\n" + p.body.slice(0, 300), function () { if (port) port.postMessage({ t: "send", id: p.id, to: p.to, body: p.body }); }, function () { say("@@FROM from=" + p.to + " id=" + p.id + " status=denied\nuser denied\n@@END"); });
  }
}
var timer = null; function sched() { if (!timer) timer = setTimeout(function () { timer = null; scan(); }, 300); }
function begin(k) {
  if (typeof k !== "string" || !k) return; key = k;
  if (!started) {
    ad.assistantMessages().forEach(function (el) { Array.prototype.forEach.call(el.querySelectorAll("pre"), function (pr) { handled[hash(pr.textContent || "")] = true; }); });
    started = true; connect(); new MutationObserver(sched).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); setInterval(scan, 1500);
  }
}
chrome.runtime.onMessage.addListener(function (m) { if (m && m.type === "bb:session") begin(m.key); });
chrome.runtime.sendMessage({ type: "bb:hello", site: site }, function (r) { void chrome.runtime.lastError; if (r && r.ok) begin(r.key); });
})(typeof globalThis !== "undefined" ? globalThis : this);
