/*
 * Browser Bridge parser — CONTRACT v1.3
 * Classic-script UMD. A command is exactly one fenced @@RUN block addressed
 * to the active session key. @@TO/@@FROM are deliberately non-executable.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BB = root.BB || {};
  root.BB.parser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_TIMEOUT = 120;
  var MIN_TIMEOUT = 1;
  var MAX_TIMEOUT = 900;

  function failure(code, message, results) {
    return { ok: false, block: null, results: results || [], error: { code: code, message: message || code } };
  }

  function normalize(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, '');
  }

  function asText(input) {
    if (Array.isArray(input)) return input.map(function (v) { return normalize(v); }).join('\n');
    return normalize(input);
  }

  function directiveKind(line) {
    var m = /^\s*(?:>\s*)?@@(RUN|TO|FROM|RESULT)\b/i.exec(line);
    return m ? m[1].toUpperCase() : null;
  }

  function clampTimeout(value) {
    if (value === undefined || value === null || !/^\d+(?:\.\d+)?$/.test(String(value))) return DEFAULT_TIMEOUT;
    var n = Math.floor(Number(value));
    if (!isFinite(n)) return DEFAULT_TIMEOUT;
    if (n < MIN_TIMEOUT) return MIN_TIMEOUT;
    if (n > MAX_TIMEOUT) return MAX_TIMEOUT;
    return n;
  }

  function fieldsFromHeader(line) {
    var rest = String(line).replace(/^\s*@@RUN\b/i, '');
    var fields = Object.create(null);
    var re = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*([^\s]+)/g;
    var match;
    while ((match = re.exec(rest))) fields[match[1].toLowerCase()] = match[2];
    return fields;
  }

  function parseResultBlocks(fences) {
    var out = [];
    for (var i = 0; i < fences.length; i++) {
      var lines = fences[i].lines;
      for (var j = 0; j < lines.length; j++) {
        var head = /^\s*@@RESULT\s+(.+)$/i.exec(lines[j]);
        if (!head) continue;
        var id = /\bid\s*=\s*([^\s]+)/i.exec(head[1]);
        var status = /\bstatus\s*=\s*([^\s]+)/i.exec(head[1]);
        var end = -1;
        for (var k = j + 1; k < lines.length; k++) {
          if (/^\s*@@END\s*$/i.test(lines[k])) { end = k; break; }
        }
        if (end < 0) continue;
        out.push({ id: id ? id[1] : null, status: status ? status[1] : null, output: lines.slice(j + 1, end).join('\n') });
        j = end;
      }
    }
    return out;
  }

  function parse(text, opts) {
    opts = opts || {};
    var source = asText(text);
    var lines = source.split('\n');
    var fences = [];
    var outside = [];
    var active = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var open = /^\s*(`{3,}|~{3,})[^`~]*$/.exec(line);
      if (!active && open) {
        active = { token: open[1], lines: [] };
        continue;
      }
      if (active && new RegExp('^\\s*' + active.token.charAt(0) + '{' + active.token.length + ',}\\s*$').test(line)) {
        fences.push(active);
        active = null;
        continue;
      }
      if (active) active.lines.push(line);
      else outside.push(line);
    }
    if (active) fences.push(active);

    var outsideKinds = outside.map(directiveKind).filter(Boolean);
    var runs = [];
    var phaseThree = false;
    for (var f = 0; f < fences.length; f++) {
      var fence = fences[f];
      for (var x = 0; x < fence.lines.length; x++) {
        var kind = directiveKind(fence.lines[x]);
        if (kind === 'RUN') runs.push({ fence: fence, index: x });
        if (kind === 'TO' || kind === 'FROM') phaseThree = true;
      }
    }

    if (outsideKinds.indexOf('RUN') !== -1 || outsideKinds.indexOf('TO') !== -1 || outsideKinds.indexOf('FROM') !== -1) {
      return failure('not-fenced', 'directive is not inside a fenced code block');
    }
    if (!runs.length) {
      if (phaseThree) return failure('not-a-run-block', '@@TO and @@FROM are reserved for phase 3');
      var resultRecords = opts.role && opts.role !== 'assistant' ? parseResultBlocks(fences) : [];
      return failure('no-block', 'no @@RUN block was found', resultRecords);
    }

    var found = runs[0];
    var bodyLines = [];
    var end = -1;
    for (var b = found.index + 1; b < found.fence.lines.length; b++) {
      if (/^\s*@@END\s*$/i.test(found.fence.lines[b])) { end = b; break; }
      bodyLines.push(found.fence.lines[b]);
    }
    if (end < 0) return failure('unterminated', '@@RUN block is missing @@END');

    var fields = fieldsFromHeader(found.fence.lines[found.index]);
    if (!fields.key) return failure('missing-key', '@@RUN header has no key');
    if (typeof opts.key !== 'string' || fields.key !== opts.key) return failure('wrong-key', 'block key does not match this session');
    if (!fields.id || !/^\d+$/.test(fields.id)) return failure('missing-id', '@@RUN header has no non-negative integer id');

    var requestedMode = fields.mode ? String(fields.mode).toLowerCase() : 'ask';
    if (['lines', 'script', 'ask', 'auto', 'read'].indexOf(requestedMode) === -1) requestedMode = 'ask';
    return {
      ok: true,
      block: {
        agent: fields.agent || '',
        key: fields.key,
        id: Number(fields.id),
        mode: requestedMode,
        timeoutSec: clampTimeout(fields.timeout),
        body: bodyLines.join('\n')
      },
      results: [],
      error: null
    };
  }

  function parseMessage(preTexts, key) {
    var parsed = parse(preTexts, { key: key, role: 'assistant' });
    if (parsed.ok) {
      return {
        status: 'ok',
        block: {
          kind: 'RUN',
          id: parsed.block.id,
          mode: (parsed.block.mode === 'ask' || parsed.block.mode === 'auto' || parsed.block.mode === 'read') ? 'lines' : parsed.block.mode,
          timeout: parsed.block.timeoutSec,
          body: parsed.block.body
        }
      };
    }
    if (parsed.error.code === 'no-block' || parsed.error.code === 'wrong-key') {
      return { status: 'none', reason: parsed.error.code === 'wrong-key' ? 'key-mismatch' : 'no-block' };
    }
    if (parsed.error.code === 'multiple-blocks') return { status: 'multiple', reason: 'multiple-blocks' };
    return { status: 'invalid', reason: parsed.error.code };
  }

  function parsemessage(preTexts, key) {
    var message = parseMessage(preTexts, key);
    if (message.status === 'ok') {
      return {
        status: 'ok',
        kind: 'run',
        id: message.block.id,
        mode: message.block.mode,
        timeout: message.block.timeout,
        body: message.block.body
      };
    }
    return { status: message.status, reason: message.reason };
  }

  return { parse: parse, parseMessage: parseMessage, parsemessage: parsemessage, clampTimeout: clampTimeout, DEFAULT_TIMEOUT: DEFAULT_TIMEOUT, MAX_TIMEOUT: MAX_TIMEOUT };
});