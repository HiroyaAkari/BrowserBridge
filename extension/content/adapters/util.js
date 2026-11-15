/* Shared DOM helpers for the three supported chat pages. */
(function (root) {
  'use strict';
  var BB = root.BB = root.BB || {}; BB.adapters = BB.adapters || {};
  function first(selectors, scope) { scope = scope || document; for (var i = 0; i < selectors.length; i++) { try { var el = scope.querySelector(selectors[i]); if (el) return el; } catch (e) {} } return null; }
  function all(selectors, scope) { scope = scope || document; for (var i = 0; i < selectors.length; i++) { try { var list = scope.querySelectorAll(selectors[i]); if (list.length) return Array.prototype.slice.call(list); } catch (e) {} } return []; }
  function visible(el) { if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false; var style = getComputedStyle(el); return style.display !== 'none' && style.visibility !== 'hidden'; }
  function factory(name, config) {
    return {
      name: name,
      assistantMessages: function () { return all(config.assistant); },
      isGenerating: function () { return all(config.generating).some(visible); },
      input: function () { return first(config.input); },
      send: function () { return first(config.send); }
    };
  }
  BB.adapters.factory = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this);
