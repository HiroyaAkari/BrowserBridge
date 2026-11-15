'use strict';
/* v1.3 D13(a-e), D14, and D15 coverage without changing supplied router tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Router = require('../extension/background/router');
const Guard = require('../extension/guard/guard');

function setup(overrides) {
  const sent = [];
  const replies = [];
  const notices = [];
  const deps = Object.assign({
    sid: 'contract-session',
    mode: 'ask',
    native: { send(message) { sent.push(message); } },
    guard: Guard,
    reply(tabId, payload) { replies.push({ tabId, payload }); },
    notify(message) { notices.push(message); }
  }, overrides || {});
  return { router: Router.createRouter(deps), sent, replies, notices };
}
function request(subject, id, body, extra) {
  return subject.router.request(Object.assign({ id, tabId: 41, body, timeout: 120, mode: 'lines' }, extra || {}));
}

test('D13(a): calls the supplied guard directly with req.body and req.mode', async () => {
  let seen;
  const guard = { check(body, mode) { seen = { receiver: this, body, mode }; return { hardStop: false, reason: null }; } };
  const subject = setup({ guard });
  const result = await request(subject, 'd13-a', 'printf hello', { mode: 'script' });
  assert.equal(result.status, 'asking');
  assert.deepEqual(seen, { receiver: guard, body: 'printf hello', mode: 'script' });
});

test('D13(b): an exact hard-stop verdict is held in Ask with its nonempty reason', async () => {
  const reason = 'test-stop: explicit review required';
  const subject = setup({ guard: { check() { return { hardStop: true, reason }; } } });
  const result = await request(subject, 'd13-b', 'harmless text');
  assert.deepEqual(result, { ok: true, id: 'd13-b', status: 'asking', reason });
  assert.equal(subject.sent.length, 0);
  assert.equal(subject.router.getState().pendingItem.hardStop, true);
});

test('D13(c): an actual mkfs.ext4 hard stop is held in Auto with a nonempty reason', async () => {
  const subject = setup({ mode: 'auto' });
  const result = await request(subject, 'd13-c', 'mkfs.ext4 /dev/sda');
  assert.equal(result.status, 'asking');
  assert.equal(typeof result.reason, 'string');
  assert.notEqual(result.reason.trim(), '');
  assert.match(result.reason, /^mkfs: /);
  assert.equal(subject.sent.length, 0);
});

test('D13(d): a throwing or rejecting guard is held in Auto until explicit approval', async () => {
  const sync = setup({ mode: 'auto', guard: { check() { throw new Error('sync failure'); } } });
  const syncResult = await request(sync, 'd13-d-sync', 'echo safe');
  assert.equal(syncResult.status, 'asking');
  assert.match(syncResult.reason, /^guard-error: sync failure$/);
  assert.equal(sync.sent.length, 0);

  const rejected = setup({ mode: 'auto', guard: { check() { return Promise.reject(new Error('async failure')); } } });
  const rejectedResult = await request(rejected, 'd13-d-async', 'echo safe');
  assert.equal(rejectedResult.status, 'asking');
  assert.match(rejectedResult.reason, /^guard-error: async failure$/);
  assert.deepEqual(rejected.router.approve('d13-d-async'), { ok: true, id: 'd13-d-async' });
  assert.equal(rejected.sent.filter((message) => message.type === 'run').length, 1);
});

test('D13(e): skip of a held command replies blocked and never dispatches', async () => {
  const subject = setup({ mode: 'auto' });
  await request(subject, 'd13-e', 'mkfs.ext4 /dev/sda');
  const skipped = subject.router.skip('d13-e');
  assert.deepEqual(skipped, { ok: true, id: 'd13-e', promise: skipped.promise });
  await skipped.promise;
  assert.equal(subject.sent.length, 0);
  assert.equal(subject.replies.length, 1);
  assert.equal(subject.replies[0].payload.status, 'blocked');
});

test('D14: router defaults and clamps every native timeout before dispatch', async () => {
  const subject = setup({ mode: 'auto' });
  const cases = [
    ['d14-default', undefined, 120],
    ['d14-low', 0, 1],
    ['d14-high', 901, 900],
    ['d14-decimal', '17.9', 17]
  ];
  for (const [id, timeout, expected] of cases) {
    const result = await request(subject, id, 'true', { timeout });
    const sent = subject.sent.filter((message) => message.type === 'run').at(-1);
    assert.equal(result.status, 'running');
    assert.equal(sent.timeout, expected);
    subject.router.onNative({ type: 'result', id, status: 'done', exit: 0, output: '' });
  }
});

test('D15: ID is claimed before an asynchronous guard settles, so duplicate is silent', async () => {
  let release;
  let calls = 0;
  const guard = { check() { calls += 1; return new Promise((resolve) => { release = resolve; }); } };
  const subject = setup({ mode: 'auto', guard });
  const first = request(subject, 'd15', 'echo first');
  const duplicate = await request(subject, 'd15', 'echo second');
  assert.deepEqual(duplicate, { ok: false, id: 'd15', status: 'blocked', reason: 'duplicate id: this run was already handled' });
  assert.equal(calls, 1);
  assert.equal(subject.replies.length, 0);
  release({ hardStop: false, reason: null });
  const firstResult = await first;
  assert.equal(firstResult.status, 'running');
  assert.equal(subject.sent.filter((message) => message.type === 'run').length, 1);
});
// END-OF-FILE tests/router.contract.test.js 112
