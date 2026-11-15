/*
 * Browser Bridge command guard. Pure UMD module:
 * check(body, mode) -> { hardStop, reason }
 *
 * It is defence in depth, not a shell parser or sandbox. Hard stops are held
 * for explicit approval by the router; they are never automatically run.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AgentGuard = api;
  root.BB = root.BB || {};
  root.BB.guard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var READ_ONLY = new Set(['read', 'readonly', 'read-only', 'plan', 'dryrun', 'dry-run', 'dry_run']);
  var WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'nice', 'time', 'timeout', 'command', 'exec', 'setsid', 'stdbuf']);
  var ROOTISH = new Set(['/', '~', '$home', '${home}', '..', '../..', '/home', '/usr', '/usr/local', '/etc', '/var', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/opt', '/root', '/srv', '/sys', '/proc', '/dev', '/media', '/mnt']);
  var NETWORK = new Set(['curl', 'wget', 'http', 'https', 'httpie', 'nc', 'ncat', 'netcat', 'socat', 'scp', 'sftp', 'ssh', 'ftp', 'rsync', 'aria2c']);
  var MUTATORS = new Set(['rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'truncate', 'tee', 'dd', 'shred', 'chmod', 'chown', 'chgrp', 'ln', 'install', 'unlink', 'mkfifo', 'mknod', 'patch']);
  var READ_GIT = new Set(['status', 'log', 'diff', 'show', 'blame', 'grep', 'rev-parse', 'ls-files', 'describe', 'shortlog', 'cat-file', 'remote', 'config', 'branch', 'tag']);
  var READ_PM = new Set(['ls', 'list', 'view', 'info', 'show', 'outdated', 'audit', 'why', 'root', 'bin', 'help', 'explain', 'search', 'ping', '-v', '--version', 'version']);
  var PM = new Set(['npm', 'yarn', 'pnpm', 'bun', 'npx']);
  var SYSTEM_WRITE = new Set(['apt', 'apt-get', 'dpkg', 'yum', 'dnf', 'rpm', 'apk', 'pacman', 'brew', 'snap', 'pip', 'pip3', 'pipx', 'gem', 'composer', 'cargo', 'rustup', 'systemctl', 'service', 'launchctl', 'crontab', 'at', 'ssh', 'scp', 'sftp', 'rsync', 'docker', 'podman', 'kubectl', 'helm', 'terraform', 'ansible', 'vagrant', 'mount', 'umount', 'swapon', 'swapoff', 'iptables', 'nft', 'ufw', 'useradd', 'userdel', 'usermod', 'passwd', 'visudo', 'su', 'kill', 'pkill', 'killall']);

  function normalize(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/\\\n/g, ' ')
      .replace(/\$\{?ifs\}?/gi, ' ')
      .replace(/\\/g, '')
      .replace(/[`"'‘’“”«»]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function segments(text) {
    return text.replace(/\$\(/g, ' ; ').replace(/\)/g, ' ; ')
      .split(/(?:&&|\|\||[;|&\n])/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function stripWrappers(tokens) {
    var t = tokens.slice();
    while (t.length && (WRAPPERS.has(t[0]) || /^[a-z_][a-z0-9_]*=/.test(t[0]))) {
      t.shift();
      while (t.length && /^[a-z_][a-z0-9_]*=/.test(t[0])) t.shift();
    }
    return t;
  }

  function tokens(segment) { return stripWrappers(segment.split(' ').filter(Boolean)); }
  function shortFlag(token, letter) { return /^-[a-z]+$/i.test(token) && token.toLowerCase().indexOf(letter) >= 0; }
  function flag(token) { return token.length > 1 && token.charAt(0) === '-' && !/^-d/.test(token); }
  function rootish(value) {
    var path = String(value || '').toLowerCase().replace(/\/?\*+$/, '').replace(/\/+$/, '');
    if (!path) path = '/';
    return ROOTISH.has(path);
  }
  function result(id, detail) { return { hardStop: true, reason: id + ': ' + detail }; }

  function unconditional(text, segs) {
    if (/:\(\)\s*\{/.test(text) || /\b[a-z0-9_]+\(\)\s*\{\s*[a-z0-9_]+\s*\|\s*[a-z0-9_]+\s*&?\s*\}\s*;/.test(text)) return result('fork-bomb', 'shell fork bomb');

    for (var i = 0; i < segs.length; i++) {
      var t = tokens(segs[i]);
      if (!t.length) continue;
      var rm = t.indexOf('rm');
      if (rm >= 0) {
        if (t.indexOf('--no-preserve-root') >= 0) return result('rm-no-preserve-root', 'rm --no-preserve-root');
        var recursive = false, force = false, targets = [];
        for (var r = rm + 1; r < t.length; r++) {
          if (t[r] === '--recursive' || shortFlag(t[r], 'r')) recursive = true;
          if (t[r] === '--force' || shortFlag(t[r], 'f')) force = true;
          if (!flag(t[r])) targets.push(t[r]);
        }
        if (recursive && force) for (var rt = 0; rt < targets.length; rt++) if (rootish(targets[rt])) return result('rm-root', 'recursive force delete of ' + targets[rt]);
      }
      var permission = t[0] === 'chmod' || t[0] === 'chown' || t[0] === 'chgrp';
      if (permission) {
        var rec = t.some(function (v) { return v === '--recursive' || shortFlag(v, 'r'); });
        if (rec) for (var p = 1; p < t.length; p++) if (!flag(t[p]) && !/^[0-7]{1,4}$/.test(t[p]) && rootish(t[p])) return result('chmod-root', 'recursive ' + t[0] + ' on ' + t[p]);
      }
      if (t[0] === 'shutdown' || t[0] === 'reboot' || t[0] === 'halt' || t[0] === 'poweroff' || t[0] === 'kexec') return result('power', t[0] + ' would stop the host');
      if (t[0] === 'init' && /^(0|6)$/.test(t[1] || '')) return result('power', 'init ' + t[1] + ' would stop the host');
      if (t[0] === 'systemctl' && /^(poweroff|reboot|halt|kexec|suspend|hibernate)$/.test(t[1] || '')) return result('power', 'systemctl ' + t[1]);
      if (t[0] === 'kill' && t.slice(1).indexOf('-1') >= 0) return result('kill-all', 'kill -1 signals every process');
      if (t[0] === 'killall5') return result('kill-all', 'killall5 signals every process');
      if (t[0] === 'pkill' && t.slice(1).some(function (v) { return v === '-1' || v === '.' || v === '.*'; })) return result('kill-all', 'pkill matching everything');

      var redirects = segs[i].match(/(?:^|[^0-9&])>>?\s*([^\s|;&]+)/g) || [];
      for (var rd = 0; rd < redirects.length; rd++) {
        var target = redirects[rd].replace(/^.*>>?\s*/, '');
        if (/^\/dev\/(sd|hd|vd|xvd|nvme|mmcblk|disk|mapper|loop)/.test(target)) return result('device-redirect', 'redirect into a block device');
        if (/^\/etc(?:\/|$)/.test(target)) return result('etc-write', 'redirect writes ' + target);
      }
      if (['tee','cp','mv','ln','install','touch','mkdir','rmdir','rm','truncate','sed','chmod','chown','chgrp','dd','shred','patch','rsync','unlink'].indexOf(t[0]) >= 0) {
        if (t[0] !== 'sed' || t.some(function (a) { return a === '--in-place' || /^-i/.test(a); })) {
          var paths = t.slice(1).filter(function (a) { return !flag(a); });
          if (['cp','mv','ln','install','rsync'].indexOf(t[0]) >= 0) paths = paths.slice(-1);
          for (var ep = 0; ep < paths.length; ep++) if (/^\/etc(?:\/|$)/.test(paths[ep].replace(/^of=/, ''))) return result('etc-write', t[0] + ' writes under ' + paths[ep]);
        }
      }
      if (t[0] === 'git' && t[1] === 'push') {
        var args = t.slice(2), forced = args.some(function (a) { return a === '--force' || shortFlag(a, 'f'); });
        if (forced && args.some(function (a) { return !flag(a) && /(?:^|[:/])(main|master)$/.test(a); })) return result('git-force-push', 'force push rewrites main/master');
      }
    }

    if (/(?:^|[\s;|&/])(mkfs(?:\.[a-z0-9]+)?|mke2fs|mkswap|wipefs|fdisk|sfdisk|gdisk|parted|cryptsetup|pvcreate)\b/.test(text)) return result('mkfs', 'filesystem or partition tool');
    if (/\bdd\b[^;|&]*\bof=\/dev\/(sd|hd|vd|xvd|nvme|mmcblk|disk|mapper|loop)/.test(text)) return result('dd-device', 'dd writing to a block device');
    if (/\b(curl|wget|fetch|aria2c|http|httpie|ftp)\b[^|;]*\|\s*(?:sudo\s+)?[a-z0-9_./-]*?(?:sh|bash|zsh|dash|ksh|ash|fish|python[0-9.]*|node|deno|perl|ruby|php)\b/.test(text)) return result('remote-shell', 'remote output piped to an interpreter');
    if (/\b(base64|xxd|openssl|gpg)\b[^|;]*(?:\s-d\b|--decode|\s-r\b|enc\s+-d|decrypt)[^|;]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python[0-9.]*|node|perl|ruby|php)\b/.test(text)) return result('remote-shell', 'decoded payload piped to an interpreter');

    var secret = /(?:^|[\s/\\~.'"])(id_rsa|id_dsa|id_ecdsa|id_ed25519)(?!\.pub)(?![\w])/.exec(text) || /(?:^|[\s/\\~.])(\.aws\/credentials|\.netrc|\.git-credentials|\.npmrc|\.docker\/config\.json|\.pgpass|\.kube\/config|\.config\/gh\/hosts\.yml)\b/.exec(text);
    var usesNetwork = segs.some(function (s) { var t = tokens(s); return t.length && NETWORK.has(t[0]); });
    if (secret && usesNetwork) return result('secret-exfil', 'credential material in a command that touches the network');
    if (/\/etc\/(shadow|gshadow|sudoers(?:\.d)?|passwd)\b/.test(text)) return result('protected-file', 'touches protected /etc file');
    if (/>>?\s*\S*\.ssh\/authorized_keys\b/.test(text)) return result('protected-file', 'writes to authorized_keys');
    if (/(?:^|\s)(?:cat|cp|mv|scp|tee)\b[^;|&]*\/etc\/cron/.test(text)) return result('protected-file', 'touches cron');
    return null;
  }

  function readOnlyViolation(segs) {
    for (var i = 0; i < segs.length; i++) {
      var t = tokens(segs[i]); if (!t.length) continue;
      var cmd = t[0];
      if (MUTATORS.has(cmd)) return cmd + ' modifies the filesystem';
      if (cmd === 'sed' && t.some(function (a) { return a === '--in-place' || /^-i/.test(a); })) return 'sed -i rewrites files';
      if (cmd === 'find' && t.some(function (a) { return a === '-delete' || a === '-exec' || a === '-execdir'; })) return 'find can mutate or execute';
      if (cmd === 'xargs') return 'xargs can run anything';
      if (cmd === 'git' && !READ_GIT.has(t[1] || '')) return 'git ' + (t[1] || '') + ' is not read-only';
      if (PM.has(cmd) && !READ_PM.has(t[1] || '')) return cmd + ' ' + (t[1] || '') + ' can modify the workspace';
      if (SYSTEM_WRITE.has(cmd)) return cmd + ' is not allowed in read-only mode';
      if ((cmd === 'curl' || cmd === 'wget') && t.some(function (a) { return /^(-o|-O|--output|--remote-name|-d|--data|-F|--form|-T|--upload-file|-X)/.test(a); })) return cmd + ' can write or send data';
      var writes = segs[i].match(/>>?\s*([^\s|;&]+)/g) || [];
      for (var r = 0; r < writes.length; r++) if (!/^>>?\s*\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/.test(writes[r])) return 'redirect writes ' + writes[r].replace(/^>>?\s*/, '');
    }
    return null;
  }

  function check(body, mode) {
    var text = normalize(body);
    if (!text) return { hardStop: false, reason: null };
    var segs = segments(text);
    var stop = unconditional(text, segs);
    if (stop) return stop;
    if (READ_ONLY.has(String(mode || '').toLowerCase())) {
      var detail = readOnlyViolation(segs);
      if (detail) return result('read-only', detail);
    }
    return { hardStop: false, reason: null };
  }

  return { check: check, normalize: normalize };
});
// END-OF-FILE extension/guard/guard.js 164