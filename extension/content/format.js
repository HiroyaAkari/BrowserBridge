/* Browser Bridge result formatter — CONTRACT v1.4, classic-script UMD. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BB = root.BB || {};
  root.BB.format = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DEFAULT_MAX_BYTES = 8192;

  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    // Node fallback for old test environments only.
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8');
    var escaped = unescape(encodeURIComponent(text));
    var out = new Uint8Array(escaped.length);
    for (var i = 0; i < escaped.length; i++) out[i] = escaped.charCodeAt(i);
    return out;
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
    var raw = '';
    for (var i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(raw)); } catch (e) { return raw; }
  }

  function trimTrailingNewlines(text) {
    return String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  }

  function truncate(text, maxBytes) {
    var bytes = utf8Bytes(text);
    var max = Number(maxBytes);
    if (!isFinite(max) || max < 0) max = DEFAULT_MAX_BYTES;
    max = Math.floor(max);
    if (bytes.length <= max) return { text: text, dropped: 0 };
    var start = bytes.length - max;
    // Do not begin inside a multi-byte UTF-8 character.
    while (start < bytes.length && (bytes[start] & 0xC0) === 0x80) start += 1;
    return { text: decodeUtf8(bytes.slice(start)), dropped: start };
  }

  function normalizedStatus(value) {
    var status = String(value || 'done').toLowerCase();
    if (status === 'ok') return 'done';
    if (status === 'error') return 'failed';
    return ['done', 'failed', 'timeout', 'needs-user', 'blocked'].indexOf(status) >= 0 ? status : 'failed';
  }

  function finite(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0;
  }

  function formatResult(result) {
    result = result || {};
    var status = normalizedStatus(result.status);
    var id = result.id === undefined || result.id === null ? '' : String(result.id);
    var output = trimTrailingNewlines(result.output !== undefined ? result.output : result.text);
    var cut = truncate(output, result.maxBytes === undefined ? DEFAULT_MAX_BYTES : result.maxBytes);
    output = cut.dropped ? '[truncated: ' + cut.dropped + ' bytes dropped]\n' + cut.text : cut.text;

    var header = '@@RESULT id=' + id + ' status=' + status;
    var exit = result.exitCode !== undefined ? result.exitCode : result.exit;
    if ((status === 'done' || status === 'failed') && exit !== undefined && exit !== null && exit !== '') header += ' exit=' + String(exit);
    /* Legacy callers use durationMs; the current bridge record uses time and
     * cwd. Emit the supplied representation without inventing fields. */
    if (finite(result.durationMs)) header += ' duration=' + Math.floor(result.durationMs) + 'ms';
    else if (result.time !== undefined && result.time !== null && result.time !== '') header += ' time=' + String(result.time);
    if (result.cwd !== undefined && result.cwd !== null && result.cwd !== '') header += ' cwd=' + String(result.cwd);
    return output ? header + '\n' + output + '\n@@END' : header + '\n@@END';
  }

  function formatHandshake(key) {
    return '@@KEY ' + String(key || '');
  }

  return { formatResult: formatResult, formatHandshake: formatHandshake, truncate: truncate, DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES };
});
// END-OF-FILE extension/content/format.js 82
