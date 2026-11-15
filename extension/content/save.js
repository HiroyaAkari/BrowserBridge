/* Browser Bridge: @@SAVE blocks from Arena are saved into ~/Claude/arena only. */
(function () {
"use strict"; if (!/(^|\.)arena\.ai$/.test(location.hostname)) return;
var BB = self.BB || {}, ad = BB.adapters && typeof BB.adapters.arena === "function" ? BB.adapters.arena() : null; if (!ad) return;
var done = {}, n = 0, q = String.fromCharCode(39);
function h(s) { var x = 5381, i; for (i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x.toString(16); }
function blocks() { var ms = ad.assistantMessages(); if (!ms.length) return []; return Array.prototype.slice.call(ms[ms.length - 1].querySelectorAll("pre")); }
function mark() { ad.assistantMessages().forEach(function (el) { Array.prototype.forEach.call(el.querySelectorAll("pre"), function (p) { done[h(p.textContent || "")] = 1; }); }); }
function save(hdr, code) {
 var nm = (/\bname=(\S+)/.exec(hdr) || [])[1], ow = /\boverwrite=yes\b/.test(hdr);
 if (!nm || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(nm) || nm.indexOf("..") >= 0 || !/\.(py|js|ts|json|txt|md|html|css|sh|rs|go|c|h|cpp|java|toml|ya?ml|csv)$/i.test(nm)) { console.warn("[bb-save] bad file name"); return; }
 if (code.length > 200000) { console.warn("[bb-save] too large"); return; }
 var b = btoa(unescape(encodeURIComponent(code))), id = "save-" + Date.now().toString(36) + (++n);
 var body = "D=\"$HOME/Claude/arena\"; F=\"$D/" + nm + "\"; mkdir -p \"$D\"; if [ -L \"$F\" ]; then echo \"not saved: " + nm + " is a symlink\"; exit 1; fi; if [ -e \"$F\" ] && [ " + (ow ? "yes" : "no") + " = no ]; then echo \"not saved: " + nm + " already exists\"; exit 1; fi; echo " + q + b + q + " | base64 -d > \"$F\" && echo \"saved " + nm + " $(wc -c < \"$F\") bytes\"";
 chrome.runtime.sendMessage({ type: "bb:run-request", id: id, body: body, timeout: 30, mode: "script", bbSave: true }, function () { void chrome.runtime.lastError; });
}
function scan() { if (ad.isGenerating()) return; var bl = blocks(); for (var i = 0; i < bl.length; i++) { var t = bl[i].textContent || "", m = /^\s*@@SAVE\s+([^\n]*)\n([\s\S]*?)\n[ \t]*@@END\s*$/.exec(t); if (!m) continue; var k = h(t); if (done[k]) continue; done[k] = 1; save(m[1], m[2]); } }
setTimeout(function () { mark(); setInterval(scan, 1500); new MutationObserver(function () { setTimeout(scan, 400); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); }, 4000);
})();
