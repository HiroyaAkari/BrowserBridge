# Browser Bridge — implementation and verification status

**Updated:** 2026-11-12 (Asia/Phnom_Penh)  
**Canonical baseline chosen:** CONTRACT v1.4 from the latest supplied material. Earlier `@@KEY`, `@@TO-as-command`, ES-module, `com.sessionguard.bridge`, and v1.2 router variants were not merged into the runnable tree.

## Executive verdict

A coherent **source tree now exists** and the core deterministic suite passes. The extension is **ready for an unpacked-Chrome test**, but it is **not yet verified end to end** because this environment has no `tmux` binary and no Chrome/native-host installation was performed.

| Layer | Status | Evidence |
|---|---|---|
| Parser / formatter | Passing | `tests/parser.test.js`, `tests/format.test.js` |
| Guard | Passing core coverage | `tests/guard.test.js`; includes root delete, remote-shell, `/etc`, read-only and safe-near-miss checks |
| Router | Passing core v1.4 behavior | `tests/router.test.js`; tests Ask, Auto serialization, hard-stop hold, guard failure hold, Skip, Stop, timeout clamp, and in-flight duplicate rejection |
| Manifest / JavaScript | Passing static checks | manifest JSON parse and `node --check` completed |
| Content/UI integration | Built, unverified in Chrome | MV3 service worker and popup not browser-tested here |
| Native bridge | Built, unverified | `bridge.py` compiles; no `tmux` is installed in this workspace |

## What was implemented

- **One grammar:** fenced `@@RUN agent=… key=… id=… [mode=…] [timeout=…] … @@END`.
- **One protocol / host name:** `com.browserbridge.bridge`; background router sends `{v:1,type:'run',sid,id,mode:'lines',timeout,body}`.
- **Classic-script UMD modules:** no package-level ES-module requirement; MV3 worker uses `importScripts()`.
- **Ask/Auto router:** serial native queue, explicit approval, Skip and Stop behavior, immediate ID claiming, and 1–900 second wire-timeout enforcement.
- **Guard wiring:** router calls `guard.check(body, mode)` directly and holds hard stops (including a throwing/rejecting guard) for a human decision.
- **Popup:** session key display/copy, Ask/Auto mode, pending command/reason, Run, Skip, Stop, and state updates.
- **Content loop:** baseline existing assistant replies, wait for generation to end, parse only new last-assistant `<pre>` blocks, send request to worker, format results into composer.
- **Native host:** framed stdio protocol, persistent tmux session, stop/prompt detection, redaction, truncation, and log files.

## Verified command output

```text
npm test
# tests 15
# pass 15
# fail 0
```

Also verified:

```text
manifest JSON OK
all extension JavaScript: syntax OK
bridge/bridge.py: Python compilation OK
tmux: not installed in this workspace
```

## Important remaining blockers / acceptance tasks

1. **Install and exercise tmux.** The Native Messaging host cannot be called working until its real tmux execution path is tested on the target machine.
2. **Install the host manifest.** `bridge/com.browserbridge.bridge.json.template` still requires a real absolute `bridge.py` path and the unpacked Chrome extension ID.
3. **Load `extension/` in Chrome.** Confirm worker startup, sender checks, popup messages, and Native Messaging permission behavior.
4. **Test live sites.** Claude/ChatGPT/Gemini selectors are best-effort and may need adjustment.
5. **Review D13 policy.** A hard stop such as `rm -rf /` is deliberately held then executable after one approval. This is a high-risk v1.4 policy, not a protection guarantee.
6. **Use a disposable environment.** The guard is a denylist and cannot make local-shell execution safe.

## Report for head manager

- The previously pasted agents produced conflicting versions. I consolidated the latest **v1.4** requirements into one runnable implementation rather than mixing those variants.
- The two known v1.2 router defects are addressed in this implementation: timeout is clamped before dispatch and IDs are claimed before a command can be pending/running.
- The deterministic code gate is green (**15 pass, 0 fail**).
- The real extension/native-host acceptance gate is **still open**, blocked only by unavailable Chrome/tmux integration in this sandbox—not by a failing deterministic test.
