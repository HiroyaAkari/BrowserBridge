#!/usr/bin/env python3
"""BrowserBridge native-host acceptance test.

A system tmux is required by default. Set BB_FAKE_TMUX=1 explicitly to run the
in-process protocol shim; that mode never invokes a shell and is not evidence
that real tmux marker/prompt behavior works.
"""
import io
import os
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge  # noqa: E402


class TmuxShim(bridge.TmuxBridge):
    """Explicit test double; never selected unless BB_FAKE_TMUX=1."""
    def __init__(self, log_dir):
        self.session = 'selftest-shim'
        self.log_dir = log_dir
        self.stop_event = threading.Event()
        self.cwd = '/workspace'

    def ensure(self):
        return None

    def run_one(self, command, timeout, emit, request_id):
        command = str(command)
        if command.startswith('sleep '):
            return {'status': 'timeout', 'exit': None, 'cwd': None, 'output': ''}
        if 'Password:' in command:
            emit({'type': 'needs-user', 'id': request_id, 'kind': 'password', 'message': 'Password:'})
            return {'status': 'needs-user', 'exit': None, 'cwd': None, 'output': 'Password:'}
        if command == 'false':
            return {'status': 'done', 'exit': 1, 'cwd': self.cwd, 'output': ''}
        if command == 'true':
            return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': ''}
        if command == 'echo no':
            return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': 'no'}
        if command == 'echo hi':
            return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': 'hi'}
        if command == 'pwd':
            return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': self.cwd}
        if command == 'cd /tmp':
            self.cwd = '/tmp'
            return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': ''}
        if command.startswith('seq 1 300'):
            return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': '\n'.join(str(i) for i in range(1, 301))}
        if command.startswith('bash '):
            path = shlex.split(command)[1]
            with open(path, encoding='utf-8') as handle:
                body = handle.read()
            output = 'hello from script' if 'hello from script' in body else ''
            return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': output}
        if 'password=abc123' in command:
            return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': 'password=abc123\n-----BEGIN RSA PRIVATE KEY-----\nFAKEKEY\n-----END RSA PRIVATE KEY-----'}
        return {'status': 'done', 'exit': 0, 'cwd': self.cwd, 'output': ''}


def choose_bridge(log_dir):
    if os.environ.get('BB_FAKE_TMUX') == '1':
        return TmuxShim(log_dir), 'SHIM', None
    tmux = shutil.which('tmux')
    if not tmux:
        return None, None, 'tmux unavailable; not run (set BB_FAKE_TMUX=1 only for the explicit protocol shim)'
    version = subprocess.check_output([tmux, '-V'], text=True).strip()
    session = 'browserbridge_selftest_{}'.format(os.getpid())
    return bridge.TmuxBridge(session=session, log_dir=log_dir), 'system ' + version, None


def main():
    temp = tempfile.mkdtemp(prefix='browserbridge_selftest_')
    host, tmux_kind, unavailable = choose_bridge(os.path.join(temp, 'logs'))
    if unavailable:
        print('tmux: unavailable')
        print(unavailable)
        shutil.rmtree(temp, ignore_errors=True)
        return 2

    events = []
    passed = 0
    total = 10

    def emit(message):
        events.append(message)

    def run(rid, body, mode='lines', timeout=None):
        message = {'id': rid, 'type': 'run', 'mode': mode, 'body': body}
        if timeout is not None:
            message['timeout'] = timeout
        return host.run(message, emit)

    def case(number, name, fn):
        nonlocal passed
        try:
            fn()
            passed += 1
            print('ok   {}/10 - {}'.format(number, name))
        except Exception as error:
            print('FAIL {}/10 - {}: {}'.format(number, name, error))

    case(1, 'echo hi -> done, exit 0, output hi', lambda: _assert(run('t1', ['echo hi']), status='done', exit=0, output='hi'))
    case(2, 'false -> failed, exit 1', lambda: _assert(run('t2', ['false']), status='failed', exit=1))

    def stops_on_failure():
        result = run('t3', ['true', 'false', 'echo no'])
        assert result['status'] == 'failed' and result['exit'] == 1 and 'no' not in result['output']
    case(3, 'line mode stops at first failure', stops_on_failure)

    case(4, 'timeout propagates', lambda: _assert(run('t4', ['sleep 5'], timeout=1), status='timeout'))

    def password_prompt():
        events.clear()
        # The real bridge reports a quiet password-like prompt after its
        # deliberate 30-second stall threshold, so keep the process alive long
        # enough for that observation and then let the request time out.
        result = run('t5', ["printf 'Password: '; sleep 40"], timeout=32)
        assert result['status'] == 'needs-user'
        assert any(e.get('type') == 'needs-user' and e.get('kind') == 'password' for e in events)
    case(5, 'password-like prompt emits needs-user', password_prompt)

    def redaction():
        result = run('t6', ["echo password=abc123; echo '-----BEGIN RSA PRIVATE KEY-----'; echo FAKEKEY; echo '-----END RSA PRIVATE KEY-----'"])
        assert 'abc123' not in result['output'] and 'FAKEKEY' not in result['output'] and 'REDACTED' in result['output']
    case(6, 'secrets are redacted', redaction)

    def truncation():
        result = run('t7', ['seq 1 300'])
        assert result['truncated'] is True and result['output'].split('\n')[0] == '1' and result['output'].split('\n')[-1] == '300'
        assert os.path.isfile(result['log'])
    case(7, 'long output is truncated and logged', truncation)

    def script_mode():
        result = run('t8', "cat <<'EOF'\nhello from script\nEOF", mode='script')
        assert result['status'] == 'done' and 'hello from script' in result['output']
    case(8, 'script mode executes a temporary script', script_mode)

    def cwd_persists():
        _assert(run('t9a', ['cd /tmp']), status='done')
        result = run('t9b', ['pwd'])
        assert result['cwd'] == '/tmp' and result['output'] == '/tmp'
    case(9, 'cwd persists between runs', cwd_persists)

    def framing():
        payload = {'id': 't10', 'type': 'ping'}
        raw = io.BytesIO()
        bridge.write_message(raw, payload, threading.Lock())
        raw.seek(0)
        assert bridge.read_message(raw) == payload
        assert raw.getvalue()[:4] == struct.pack('<I', len(b'{"id": "t10", "type": "ping"}'))
    case(10, 'native-message framing round-trips', framing)

    if tmux_kind != 'SHIM':
        host.tmux('kill-session', '-t', host.session, check=False)
    shutil.rmtree(temp, ignore_errors=True)
    print('tmux: ' + tmux_kind)
    if passed == total:
        print('SELFTEST OK {}/{}'.format(passed, total))
        return 0
    print('SELFTEST FAILED {}/{}'.format(passed, total))
    return 1


def _assert(result, **expected):
    for key, value in expected.items():
        assert result.get(key) == value, (key, result)


if __name__ == '__main__':
    raise SystemExit(main())
# END-OF-FILE bridge/selftest.py 177
