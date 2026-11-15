'use strict';
/* v1.3 lower-case BB.parser.parsemessage API coverage. */
const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../extension/content/parser');

const KEY = 'v13-key';
function fenced(...lines) { return ['```', ...lines, '```'].join('\n'); }
function run(header, body) { return fenced(header, body, '@@END'); }

test('parsemessage is exported as the lower-case v1.3 API', () => {
  assert.equal(typeof parser.parsemessage, 'function');
  assert.equal(typeof globalThis.BB.parser.parsemessage, 'function');
});

test('parseMessage returns the v1.1 nested RUN block shape', () => {
  const result = parser.parseMessage([run('@@RUN key=' + KEY + ' id=7 mode=script timeout=5', 'echo hello')], KEY);
  assert.deepEqual(result, { status: 'ok', block: { kind: 'RUN', id: 7, mode: 'script', timeout: 5, body: 'echo hello' } });
});

test('parsemessage returns exactly the flat ok run record', () => {
  const result = parser.parsemessage([run('@@RUN key=' + KEY + ' id=7 mode=script timeout=5', 'echo hello')], KEY);
  assert.deepEqual(result, { status: 'ok', kind: 'run', id: 7, mode: 'script', timeout: 5, body: 'echo hello' });
});

test('parsemessage defaults line execution mode and timeout', () => {
  const result = parser.parsemessage([run('@@RUN key=' + KEY + ' id=8', 'pwd')], KEY);
  assert.deepEqual(result, { status: 'ok', kind: 'run', id: 8, mode: 'lines', timeout: 120, body: 'pwd' });
});

test('parsemessage reports none for no block or a wrong session key', () => {
  assert.deepEqual(parser.parsemessage(['ordinary assistant reply'], KEY), { status: 'none', reason: 'no-block' });
  assert.deepEqual(parser.parsemessage([run('@@RUN key=other id=1', 'pwd')], KEY), { status: 'none', reason: 'key-mismatch' });
});

test('parsemessage reports multiple and invalid malformed run blocks', () => {
  const two = fenced('@@RUN key=' + KEY + ' id=1', 'true', '@@END', '@@RUN key=' + KEY + ' id=2', 'false', '@@END');
  assert.deepEqual(parser.parsemessage([two], KEY), { status: 'multiple', reason: 'multiple-blocks' });
  assert.deepEqual(parser.parsemessage([fenced('@@RUN key=' + KEY + ' id=1', 'true')], KEY), { status: 'invalid', reason: 'unterminated' });
});
// END-OF-FILE tests/parser.contract.test.js 41
