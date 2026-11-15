# BrowserBridge CONTRACT v1.3

This is the current, complete contract. It supersedes earlier `@@KEY`, `@@TO-as-command`, ES-module, adapter-translation, and `com.sessionguard.bridge` drafts.

## Frozen decisions

- **D4:** Every JavaScript file beneath `extension/` is a classic-script UMD module: CommonJS `module.exports` for Node tests and `globalThis.BB.<name>` in the browser. The MV3 worker is classic and uses `importScripts`; no `import` or `export` appears in extension source.
- **D8:** `BB.router.createRouter({sid, guard, native:{send}, reply, notify})` is in `extension/background/router.js` and returns `request`, `approve`, `skip`, `setMode`, `stop`, `onNative`, and `getState`.
- **D9:** The manifest permissions are exactly `nativeMessaging` and `storage`. Host coverage is exactly `https://claude.ai/*`, `https://chatgpt.com/*`, and `https://gemini.google.com/*`. No notifications permission is used.
- **D11:** The Native Messaging host is `com.browserbridge.bridge`.
- **D13:** The router passes the guard module through unchanged and calls `guard.check(req.body, req.mode)`. Its result has exactly `{hardStop, reason}`. A hard stop or guard failure is held in both Ask and Auto until `approve(id)`; `skip(id)` replies blocked.
- **D14:** Timeout defaults to 120 seconds and is clamped to `[1, 900]` in both parser and router before native dispatch.
- **D15:** `request()` claims an ID immediately after accepting a nonempty request. A duplicate is dropped without a second tab reply, including while the original is in flight.
- **D16:** Delivery artifacts use `END-OF-FILE <path> <line count>` footers outside executable/JSON syntax. No chat UI text is copied into source files.
- **D17:** Test invocations use an explicit glob, for example `node --test tests/*.test.js`; never a bare tests directory.

## Module map

| Path | Browser global / Node API |
|---|---|
| `extension/content/parser.js` | `BB.parser.parseMessage(preTexts, key)`; compatibility `parse(text, opts)` |
| `extension/content/format.js` | `BB.format.formatResult(result)`, `BB.format.formatHandshake(key)` |
| `extension/background/router.js` | `BB.router.createRouter(deps)` |
| `extension/guard/guard.js` | `BB.guard.check(body, mode)` |
| `bridge/bridge.py` | Native Messaging stdio host |

## Command grammar

A command is exactly one closed fenced block:

```text
```
@@RUN key=<session-key> id=<non-negative integer> timeout=<seconds> mode=<lines|script>
<command body>
@@END
```
```

`agent=` is tolerated for compatibility but does not authorize execution. Header keys are case-insensitive, spaces around `=` and CRLF are accepted, `timeout` defaults to 120 and clamps to 1–900, and `mode` defaults to `lines`. `@@TO` and `@@FROM` are phase-3-only envelopes and never executable.

`parseMessage(preTexts, key)` returns:

```js
{ status: 'ok'|'none'|'multiple'|'invalid', block?, reason? }
```

An ok block is `{kind:'RUN', id, mode, timeout, body}`. Wrong-key/no-command is `none`; multiple RUN blocks is `multiple`; malformed headers, missing terminator, bad id, or missing key is `invalid`.

## Result grammar

```text
@@RESULT id=<id> status=<status>[ exit=<code>][ time=<value>][ cwd=<path>]
<output>
@@END
```

The formatter also accepts legacy `durationMs` and emits `duration=<n>ms` for compatibility. Output trailing newlines are removed. Output above 8192 UTF-8 bytes retains the tail on a character boundary and prepends a dropped-byte marker.

## Router behavior

`request({id, tabId, body, timeout, mode})` is asynchronous. It rejects empty bodies, silently drops a duplicate claimed ID, calls `guard.check(body, mode)`, then:

| Condition | Result |
|---|---|
| guard hard stop or guard exception/rejection | held as `asking`, reason shown, no native dispatch |
| router Ask mode | held as `asking` |
| router Auto mode, clean request | dispatched or FIFO queued |

At most one native run is active. The native run record is:

```js
{ v: 1, type: 'run', sid, id, mode: 'lines'|'script', timeout, body }
```

`approve(id)` dispatches one held request. `skip(id)` returns a blocked result to its originating tab. `stop()` clears pending/queued work, sends `{v:1,type:'stop'}`, and holds later work until an approval releases the latch. `onNative()` handles `started`, `needs-user`, `result`, `error`, `log`, and `pong`.

## Guard table

| Rule id | Required stop |
|---|---|
| `rm-root` | recursive force delete of `/`, `~`, `$HOME`, or top-level system paths |
| `mkfs` | filesystem/partition tooling |
| `dd-device` | `dd` to a block device |
| `remote-shell` | `curl`/`wget` output piped to an interpreter |
| `power` | shutdown, reboot, poweroff, halt, init 0/6 |
| `fork-bomb` | shell fork bomb |
| `etc-write` | writes under `/etc` |
| `rm-no-preserve-root` | `rm --no-preserve-root` |
| `chmod-root` | recursive permission/owner changes on system roots |
| `device-redirect` | redirect to a block device |
| `kill-all` | kill-all process commands |
| `secret-exfil` | credential material plus network command |
| `protected-file` | protected system files, authorized_keys, cron |
| `git-force-push` | forced main/master rewrite |
| `read-only` | mutations in read-only modes |

## D13–D15 closure

The current router calls the direct guard signature, holds hard stops and guard failures, clamps router timeouts, and claims accepted IDs before queueing. The deterministic router tests are green for these cases.
END-OF-FILE docs/CONTRACT.md 100
