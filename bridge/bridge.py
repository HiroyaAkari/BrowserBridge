#!/usr/bin/env python3
"""Browser Bridge Native Messaging host.

A dependency-free, local-only bridge to one persistent tmux shell. Chrome talks
through stdin/stdout Native Messaging frames; no network listener is opened.
The extension is expected to send {type:'run', id, mode:'lines'|'script',
body, timeout}. Results use the JSON shape consumed by background/router.js.

This host intentionally does not supply passwords or confirmation responses.
It only reports detected prompts and eventually returns needs-user/timeout.
"""
import json, os, queue, re, shlex, shutil, struct, subprocess, sys, tempfile, threading, time, uuid

DEFAULT_TIMEOUT, MAX_TIMEOUT, POLL = 120, 900, 0.1
STALL_AFTER, HEAD_LINES, TAIL_LINES, MAX_FRAME = 30.0, 40, 160, 64 * 1024 * 1024
PROMPT = 'BB$ '
PASSWORD_RE = re.compile(r'\b(password|passphrase)\b[^\n]{0,80}[:：]', re.I)
CONFIRM_RE = re.compile(r'(\[[yY]\s*/\s*[nN]\]|\[[nN]\s*/\s*[yY]\]|\(\s*[yY]\s*/\s*[nN]\s*\))')
PRIVATE_KEY_RE = re.compile(r'-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----', re.S)
BEARER_RE = re.compile(r'(authorization\s*[:=]\s*bearer\s+)\S+', re.I)
SECRET_RE = re.compile(r'\b(password|passwd|secret|token|api[-_]?key|access[-_]?key|auth[-_]?token)\b(\s*[=:]\s*)[^\s"\'`]+', re.I)


def redact(text):
    text = PRIVATE_KEY_RE.sub('[REDACTED PRIVATE KEY]', text or '')
    text = BEARER_RE.sub(r'\1[REDACTED]', text)
    return SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + '[REDACTED]', text)


def truncate(text, path):
    lines = text.split('\n') if text else []
    if len(lines) <= HEAD_LINES + TAIL_LINES:
        return text, False
    cut = len(lines) - HEAD_LINES - TAIL_LINES
    notice = '[... {} lines truncated — full log: {} ...]'.format(cut, path)
    return '\n'.join(lines[:HEAD_LINES] + [notice] + lines[-TAIL_LINES:]), True


class TmuxBridge:
    def __init__(self, session=None, log_dir=None):
        if not shutil.which('tmux'):
            raise RuntimeError('tmux binary not found in PATH')
        self.session = session or os.environ.get('BB_SESSION', 'browserbridge')
        self.log_dir = log_dir or os.environ.get('BB_LOG_DIR', os.path.expanduser('~/.browserbridge/logs'))
        self.stop_event = threading.Event()

    def tmux(self, *args, check=True):
        proc = subprocess.run(['tmux', *args], capture_output=True, text=True)
        if check and proc.returncode:
            raise RuntimeError('tmux {} failed: {}'.format(' '.join(args), proc.stderr.strip()))
        return proc

    def send_line(self, line):
        if line:
            self.tmux('send-keys', '-t', self.session, '-l', '--', line)
        self.tmux('send-keys', '-t', self.session, 'Enter')

    def capture(self):
        return self.tmux('capture-pane', '-p', '-J', '-S', '-', '-t', self.session).stdout

    def ensure(self):
        if self.tmux('has-session', '-t', self.session, check=False).returncode:
           self.tmux('new-session', '-d', '-s', self.session, '-x', '200', '-y', '50', '/bin/bash', '--norc', '--noprofile')
        time.sleep(.15)
        self.send_line("export PS1='{}' PS2=''".format(PROMPT))
        token = 'BB_READY_' + uuid.uuid4().hex
        self.send_line("printf '%s\\n' {}".format(shlex.quote(token)))
        until = time.monotonic() + 10
        while time.monotonic() < until:
            if token in self.capture():
                return
            time.sleep(POLL)
        raise RuntimeError('tmux session did not become ready')

    def interrupt(self):
        self.stop_event.set()
        self.tmux('send-keys', '-t', self.session, 'C-c', check=False)

    def marker(self, kind):
        token = '<<BB_{}_{}>>'.format(kind, uuid.uuid4().hex)
        mid = len(token) // 2
        return token, token[:mid], token[mid:]

    @staticmethod
    def strip_region(region, sent):
        output = []
        sent = [s.rstrip() for s in sent if s.strip()]
        for line in region.split('\n'):
            line = line.rstrip('\r').rstrip()
            for command in sent:
                if line.endswith(command):
                    line = line[:-len(command)].rstrip()
                    break
            if line and line != PROMPT.rstrip():
                output.append(line)
        return '\n'.join(output)

    def run_one(self, command, timeout, emit, request_id):
        start, s1, s2 = self.marker('S')
        end, e1, e2 = self.marker('E')
        start_line = "printf '%s\\n' '{}''{}'".format(s1, s2)
        end_line = "printf '{}:%s:%s\\n' '{}''{}' \"$?\" \"$PWD\"".format('%s', e1, e2)
        sent = [start_line, command, end_line]
        self.send_line(start_line)
        self.send_line(command)
        self.send_line(end_line)
        end_re = re.compile(re.escape(end) + r':(\d+):(.*)')
        until = time.monotonic() + timeout
        last, changed, notified = None, time.monotonic(), False
        while time.monotonic() < until:
            if self.stop_event.is_set():
                time.sleep(.15)
                pane = self.capture(); pos = pane.rfind(start)
                return {'status': 'stopped', 'exit': None, 'cwd': None, 'output': self.strip_region(pane[pos + len(start):] if pos >= 0 else '', sent)}
            pane = self.capture(); pos = pane.rfind(start)
            if pos >= 0:
                after = pane[pos + len(start):]
                match = end_re.search(after)
                if match:
                    return {'status': 'done', 'exit': int(match.group(1)), 'cwd': match.group(2).strip(), 'output': self.strip_region(after[:match.start()], sent)}
                if after != last:
                    last, changed = after, time.monotonic()
                elif not notified:
                    shown = self.strip_region(after, sent)
                    last_line = shown.split('\n')[-1] if shown else ''
                    kind = None
                    if PASSWORD_RE.search(last_line): kind = 'password'
                    elif CONFIRM_RE.search(last_line): kind = 'confirm'
                    elif time.monotonic() - changed >= min(STALL_AFTER, max(2.0, timeout / 2)): kind = 'stall'
                    if kind:
                        notified = True
                        emit({'type': 'needs-user', 'id': request_id, 'kind': kind, 'message': (last_line or 'no output change detected')[:160]})
            time.sleep(POLL)
        self.tmux('send-keys', '-t', self.session, 'C-c', check=False)
        time.sleep(.2)
        pane = self.capture(); pos = pane.rfind(start)
        return {'status': 'needs-user' if notified else 'timeout', 'exit': None, 'cwd': None, 'output': self.strip_region(pane[pos + len(start):] if pos >= 0 else '', sent)}

    def write_log(self, request_id, text, status):
        os.makedirs(self.log_dir, exist_ok=True)
        safe = re.sub(r'[^A-Za-z0-9._-]+', '_', str(request_id)) or 'run'
        path = os.path.join(self.log_dir, safe + '.log')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('# Browser Bridge log\n# id={} status={}\n\n{}'.format(request_id, status, text))
        return path

    def run(self, message, emit):
        began = time.monotonic(); self.stop_event.clear()
        request_id = str(message.get('id') or uuid.uuid4().hex[:12])
        try: timeout = int(message.get('timeout', DEFAULT_TIMEOUT))
        except (TypeError, ValueError): timeout = DEFAULT_TIMEOUT
        timeout = max(1, min(timeout, MAX_TIMEOUT))
        raw = message.get('body', '')
        run_mode = message.get('mode', 'lines')
        script = None
        if run_mode == 'lines':
            commands = raw if isinstance(raw, list) else str(raw).split('\n')
            commands = [str(c) for c in commands if str(c).strip()]
        elif run_mode == 'script':
            fd, script = tempfile.mkstemp(prefix='browserbridge_', suffix='.sh')
            with os.fdopen(fd, 'w', encoding='utf-8') as fh: fh.write(str(raw) + ('' if str(raw).endswith('\n') else '\n'))
            commands = ['bash ' + shlex.quote(script)]
        else:
            commands = []
        if not commands:
            return self.result(request_id, 'error', None, None, 'nothing to run', False, '', began)
        self.ensure()
        deadline = began + timeout; chunks = []; status = 'done'; exit_code = None; cwd = None
        try:
            for command in commands:
                remaining = deadline - time.monotonic()
                if remaining <= 0: status = 'timeout'; break
                answer = self.run_one(command, remaining, emit, request_id)
                chunks.append(answer.get('output', ''))
                if answer.get('cwd') is not None: cwd = answer['cwd']
                if answer['status'] != 'done': status = answer['status']; break
                exit_code = answer['exit']
                if exit_code != 0: status = 'failed'; break
        finally:
            if script:
                try: os.unlink(script)
                except OSError: pass
        text = redact('\n'.join(chunks).strip('\n'))
        log = self.write_log(request_id, text, status)
        output, was_truncated = truncate(text, log)
        return self.result(request_id, status, exit_code, cwd, output, was_truncated, log, began)

    @staticmethod
    def result(request_id, status, exit_code, cwd, output, truncated, log, began):
        return {'type': 'result', 'id': request_id, 'status': status, 'exit': exit_code, 'cwd': cwd, 'output': output, 'truncated': truncated, 'log': log, 'duration': round(time.monotonic() - began, 3)}


def read_message(stream):
    header = stream.read(4)
    if not header or len(header) != 4: return None
    size, = struct.unpack('<I', header)
    if size > MAX_FRAME: raise ValueError('oversized native-messaging frame')
    payload = stream.read(size)
    if len(payload) != size: return None
    return json.loads(payload.decode('utf-8'))


def write_message(stream, data, lock):
    encoded = json.dumps(data, ensure_ascii=False).encode('utf-8')
    with lock:
        stream.write(struct.pack('<I', len(encoded))); stream.write(encoded); stream.flush()


def main():
    bridge = TmuxBridge(); bridge.ensure_session = bridge.ensure
    inbox = queue.Queue(); lock = threading.Lock(); out = sys.stdout.buffer
    def emit(message): write_message(out, message, lock)
    def reader():
        while True:
            try: message = read_message(sys.stdin.buffer)
            except Exception as error: emit({'type':'error','id':None,'error':'invalid message: '+str(error)}); continue
            if message is None: inbox.put(None); return
            if not isinstance(message, dict): continue
            if message.get('type') == 'ping': emit({'type':'pong','id':message.get('id')})
            elif message.get('type') == 'stop':
                bridge.interrupt(); emit({'type':'stopped','id':message.get('id')})
            else: inbox.put(message)
    threading.Thread(target=reader, daemon=True).start()
    while True:
        message = inbox.get()
        if message is None: return
        if message.get('type') != 'run': emit({'type':'error','id':message.get('id'),'error':'unsupported message type'}); continue
        try: emit(bridge.run(message, emit))
        except Exception as error: emit({'type':'result','id':message.get('id'),'status':'error','exit':None,'cwd':None,'output':'bridge error: '+str(error),'truncated':False,'log':'','duration':0})

if __name__ == '__main__': main()
