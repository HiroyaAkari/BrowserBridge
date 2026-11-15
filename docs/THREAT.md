# BrowserBridge threat model — v1.3

## Assets

- The developer’s machine, repository, and shell state
- The per-browser-session command key
- Native command output and local logs
- User attention at approval prompts

## Controls

1. A random session key is kept in `chrome.storage.session` and given only to content scripts on the three allowed hosts.
2. Only one fenced `@@RUN` block with the correct key, valid ID, and closing `@@END` can enter the router.
3. The router claims an ID before it can be held, queued, run, skipped, or completed.
4. Ask mode is the default. Auto never bypasses a guard hard stop.
5. The native bridge serializes runs, applies a 1–900 second timeout, supports Stop, redacts common secret patterns, and truncates output.
6. Needs-user notification uses the toolbar badge/popup rather than an OS notification permission.

## Residual risks

| ID | Risk | Mitigation / status |
|---|---|---|
| R1 | Prompt injection can create a syntactically valid command because the model sees the key. | The key is only an accident detector; approval and a disposable execution environment are required. |
| R2 | Approval fatigue can turn an approval into rubber stamping. | Show exact command and guard reason; keep Ask default. |
| R3 | UI/dispatch TOCTOU. | Router forwards the parsed body, not raw page HTML. |
| R4 | Denylist bypass through scripts, aliases, package scripts, encodings, or unknown commands. | Guard is defense in depth, never a sandbox. |
| R5 | Guard false positives. | Preserve safe-near-miss tests. |
| R6 | Secrets or injection text in command output/logs. | Common redaction and truncation only; treat all output/logs as sensitive. |
| R7 | Truncation hides significant prior output. | Tail retention marker; full local log path. |
| R8 | Forged assistant `@@RESULT`. | Parser treats assistant result blocks as inert. |
| R9 | Key disclosure through chat, logs, screen sharing, or hostile host page. | Rotate by browser restart; never commit it. |
| R10 | A process may outlive Stop/timeout. | Native Stop is best effort; test in disposable environment. |
| R11 | Unicode/bidi and rendering ambiguity. | Render commands as code; do not trust copied unreviewed HTML. |
| R12 | Multiple/split blocks can confuse execution. | Exactly one closed RUN block is accepted. |
| R13 | A single click can release `rm -rf /`, mkfs, remote shell, or `/etc` writes. | Deliberate D13 policy; require exact command/reason display and use disposable hosts. |
| R14 | Native host installation can be misconfigured. | Fixed host name and exact origin in the OS host manifest. |
| R15 | Live selectors drift on chat sites. | Browser acceptance tests and selector maintenance. |

## D13–D15 status

- **D13 closed in deterministic tests:** hard stops and guard exceptions hold for approval in Ask and Auto; Skip reports blocked.
- **D14 closed in deterministic tests:** router dispatch receives only a timeout in `[1,900]`.
- **D15 closed in deterministic tests:** accepted IDs are claimed before guard/queue state, so an in-flight duplicate produces no second run or reply.

## Non-goals

This project does not sandbox the host, authenticate a human approver, guarantee secret redaction, verify remote software, or protect a user who deliberately approves a dangerous command. Do not use it as a security boundary.
END-OF-FILE docs/THREAT.md 48
