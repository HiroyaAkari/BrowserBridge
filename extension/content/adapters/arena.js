(function (root) {
  "use strict";
  var BB = root.BB = root.BB || {}; BB.adapters = BB.adapters || {};
  BB.adapters.arena = function () {
    var a = BB.adapters.factory("arena", BB.selectors.arena), base = a.assistantMessages;
    a.assistantMessages = function () { return base().slice().sort(function (x, y) { return x.getBoundingClientRect().top - y.getBoundingClientRect().top; }); };
    return a;
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
