# Browser Bridge (CONTRACT v1.4 integration)

A local-only Chrome MV3 extension that recognizes a **single fenced `@@RUN` block** in a new assistant response, routes it through an approval queue, and executes approved commands only through a separately installed Native Messaging host.

## Current integration state

- ✅ Canonical implementation tree is present under `extension/` and `bridge/`.
- ✅ The deterministic Node suite passes: `15/15` tests.
- ✅ Manifest JSON and all JavaScript files pass syntax validation.
- ❌ The native-host/tmux integration has **not** been executed in this workspace: `tmux` is not installed here.
- ❌ The extension has **not** been loaded into Chrome here, so actual Chrome messaging, host installation, and real site selectors remain unverified.

Do not describe this as production-ready. The guard is a denylist, not a sandbox, and hard-stop commands are intentionally executable after an explicit approval under the supplied v1.4 policy.

## Command block grammar

```text
```
@@RUN agent=A4 key=<session-key> id=5 mode=ask timeout=120
pwd
@@END
```
```

- The block must be in a closed backtick/tilde fence.
- Exactly one `@@RUN` block is allowed per assistant message.
- `key` must match the current browser-session key displayed in the popup.
- `id` is a non-negative integer and is claimed immediately; it cannot replay while pending, running, skipped, or complete.
- `mode` is `ask`, `auto`, or `read`; the popup’s Ask/Auto choice controls automatic execution. `read` is passed to the guard as its read-only mode.
- `timeout` is clamped at both parsing and router boundaries to 1–900 seconds.
- `@@TO` and `@@FROM` are non-executable reserved envelopes.

## Test and syntax checks

```bash
npm test
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json')); console.log('manifest JSON OK')"
find extension -name '*.js' -print0 | xargs -0 -n1 node --check
python3 -m py_compile bridge/bridge.py
```

## Manual native-host installation (not done by this project)

1. Install `tmux` and confirm `tmux -V` works.
2. Ensure `bridge/bridge.py` is executable.
3. Load `extension/` unpacked in Chrome and copy its extension ID.
4. Copy `bridge/com.browserbridge.bridge.json.template` to Chrome’s OS-specific native-messaging-host directory.
5. Replace both placeholders: the absolute path to `bridge.py`, and the unpacked extension ID in `allowed_origins`.
6. Reload the extension, open its popup, then use a harmless command such as `pwd` in **Ask** mode.

The host name is **`com.browserbridge.bridge`**. It must match the manifest installed on the machine and `extension/background/browser.js`.

## Remaining required acceptance work

1. Load the unpacked extension in real Chrome and confirm no service-worker errors.
2. Test the session hello/key handoff on each supported host.
3. Test Ask → Run, Ask → Skip, Auto, hard-stop hold → Run/Skip, duplicate ID, and Stop.
4. Execute the native host with `tmux` installed and verify a safe `pwd` round trip.
5. Revisit site selectors against live Claude, ChatGPT, and Gemini UIs; they are intentionally best-effort and can drift.

## Security note

The session key prevents accidental replay, not prompt injection. The model can see the key, so treat every command block as untrusted input. Native execution should happen only in a disposable/containerized environment for sensitive work.
