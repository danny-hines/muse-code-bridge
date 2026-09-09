import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, cp, access, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const sha = 'a'.repeat(40);
const nodeBase = 'https://nodejs.org/dist/latest-v22.x';
const shellQuote = s => `'${s.replaceAll("'", "'\\''")}'`;
const exists = async path => { try { await access(path); return true; } catch { return false; } };

async function setup(t, { missing = false, checksumMismatch = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'muse bootstrap test '));
  const root = join(dir, 'managed');
  const bin = join(dir, 'fixtures');
  const log = join(dir, 'log.jsonl');
  const source = join(dir, 'source');
  await mkdir(bin); await mkdir(source);
  await writeFile(log, '');
  for (const name of ['install.sh', '.agents', 'plugins', 'integrations', 'dist']) await cp(join(repo, name), join(source, name), { recursive: true });
  await mkdir(join(source, 'scripts'));
  await cp(join(repo, 'scripts/prepare-bootstrap.mjs'), join(source, 'scripts/prepare-bootstrap.mjs'));
  const repoTar = join(dir, 'repo.tar.gz');
  await exec('tar', ['-czf', repoTar, '-C', dir, 'source']);
  const commit = join(dir, 'commit.json');
  await writeFile(commit, JSON.stringify({ sha }));

  const codex = join(bin, 'codex');
  const muse = join(bin, 'muse');
  const shebang = `#!${process.execPath}\n`;
  const logger = `const fs = require('node:fs'); const args = process.argv.slice(2); fs.appendFileSync(process.env.BOOTSTRAP_TEST_LOG, JSON.stringify({tool: TOOL, args})+'\\n');\n`;
  await writeFile(codex, shebang + logger.replace('TOOL', '"codex"') + `if(args[1]==='list') console.log('{"installed":[]}');`, { mode: 0o755 });
  await writeFile(muse, shebang + logger.replace('TOOL', '"muse"') + `if(args[0]==='--version') console.log('Muse Code 1.0.3');`, { mode: 0o755 });
  const museInstaller = join(dir, 'official-muse-fixture.sh');
  await writeFile(museInstaller, `#!/bin/bash
set -eu
[[ "$MUSE_NO_MODIFY_PATH" = 1 && "$MUSE_LOGIN" = 0 && -z "\${META_API_KEY:-}" ]]
mkdir -p "$MUSE_INSTALL_DIR"
cp "$BOOTSTRAP_TEST_MUSE" "$MUSE_INSTALL_DIR/muse"
`);

  const nodeFolder = join(dir, 'node-package');
  await mkdir(join(nodeFolder, 'bin'), { recursive: true });
  await writeFile(join(nodeFolder, 'bin/node'), `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`, { mode: 0o755 });
  await writeFile(join(nodeFolder, 'bin/npm'), shebang + logger.replace('TOOL', '"npm"') + `
const path = require('node:path'); const prefix = args[args.indexOf('--prefix')+1];
fs.mkdirSync(path.join(prefix,'node_modules/.bin'),{recursive:true});
fs.copyFileSync(process.env.BOOTSTRAP_TEST_CODEX,path.join(prefix,'node_modules/.bin/codex'));
fs.chmodSync(path.join(prefix,'node_modules/.bin/codex'),0o755);
`, { mode: 0o755 });
  const nodeTar = join(dir, 'node.tar.gz');
  await exec('tar', ['-czf', nodeTar, '-C', dir, 'node-package']);
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const nodeName = `node-v22.23.2-${os}-${arch}.tar.gz`;
  const sum = checksumMismatch ? '0'.repeat(64) : createHash('sha256').update(await readFile(nodeTar)).digest('hex');
  const sums = join(dir, 'SHASUMS256.txt');
  await writeFile(sums, `${sum}  ${nodeName}\n`);
  const routes = {
    [`${nodeBase}/SHASUMS256.txt`]: sums,
    [`https://nodejs.org/dist/v22.23.2/${nodeName}`]: nodeTar,
    'https://api.github.com/repos/danny-hines/muse-code-bridge/commits/main': commit,
    [`https://codeload.github.com/danny-hines/muse-code-bridge/tar.gz/${sha}`]: repoTar,
    'https://dev.meta.ai/install.sh': museInstaller,
  };
  await writeFile(join(bin, 'curl'), shebang + logger.replace('TOOL', '"curl"') + `
const routes=JSON.parse(process.env.BOOTSTRAP_TEST_ROUTES);
const url=args.at(-1); const file=routes[url];
if(!file){console.error('Unexpected download: '+url);process.exit(22)}
fs.copyFileSync(file,args[args.indexOf('--output')+1]);
`, { mode: 0o755 });
  const env = {
    ...process.env, PATH: bin + ':' + process.env.PATH, MUSE_BRIDGE_ROOT: root,
    MUSE_BRIDGE_NODE_BIN: missing ? join(dir, 'absent-node') : process.execPath,
    MUSE_BRIDGE_EXECUTABLE: missing ? join(dir, 'absent-muse') : muse,
    MUSE_BRIDGE_CODEX_BIN: missing ? join(dir, 'absent-codex') : codex,
    MUSE_BRIDGE_REF: 'main', BOOTSTRAP_TEST_ROUTES: JSON.stringify(routes),
    BOOTSTRAP_TEST_LOG: log, BOOTSTRAP_TEST_MUSE: muse, BOOTSTRAP_TEST_CODEX: codex,
    META_API_KEY: 'test-only', MUSE_BRIDGE_HERMES_CONFIG: join(dir, 'hermes.yaml'), MUSE_BRIDGE_OPENCODE_CONFIG: join(dir, 'opencode.jsonc'),
  };
  t.after(() => rm(dir, { recursive: true, force: true }));
  return {
    root, env, dir,
    run: async (...args) => exec('/bin/bash', ['-c', 'script=$1; shift; cat "$script" | bash -s -- --no-login "$@"', 'bootstrap-test', join(repo, 'bootstrap.sh'), ...args], { env }),
    calls: async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),
  };
}

test('piped bootstrap reuses existing tools, downloads pinned source, and cleans temporary files', async t => {
  const s = await setup(t);
  const result = await s.run();
  assert.match(result.stdout, /Setup finished/);
  const marker = JSON.parse(await readFile(join(s.root, 'repo/.muse-bridge-source.json')));
  assert.equal(marker.commit, sha);
  const calls = await s.calls();
  assert.equal(calls.filter(c => c.tool === 'curl').length, 2);
  assert.ok(!calls.some(c => c.tool === 'npm' || c.args[0] === 'login'));
  assert.ok(calls.some(c => c.tool === 'codex' && c.args[1] === 'add' && c.args[2] === 'muse-codex-bridge@muse-code-bridge'));
  assert.equal(await exists(join(s.root, '.bootstrap-lock')), false);
});

test('fresh-machine bootstrap installs Node, Muse, and Codex without modifying system tools', async t => {
  const s = await setup(t, { missing: true });
  await s.run();
  const calls = await s.calls();
  assert.equal(calls.filter(c => c.tool === 'curl').length, 5);
  const npm = calls.find(c => c.tool === 'npm');
  assert.ok(npm.args.includes('--ignore-scripts'));
  assert.ok(npm.args.includes('@openai/codex@0.153.4'));
  assert.ok(await exists(join(s.root, 'runtime/bin/node')));
  assert.ok(await exists(join(s.root, 'runtime/bin/muse')));
  assert.ok(await exists(join(s.root, 'runtime/bin/codex')));
});

test('bad Node checksum stops before extracting or registering source', async t => {
  const s = await setup(t, { missing: true, checksumMismatch: true });
  await assert.rejects(s.run(), e => /checksum mismatch/.test(e.stderr));
  assert.equal(await exists(join(s.root, 'repo')), false);
  assert.equal(await exists(join(s.root, '.bootstrap-lock')), false);
  assert.ok(!(await s.calls()).some(c => c.tool === 'codex' || c.tool === 'npm'));
});

test('reruns resolve managed executables instead of creating self-referencing links', async t => {
  const s = await setup(t);
  await s.run();
  s.env.MUSE_BRIDGE_NODE_BIN = join(s.root, 'runtime/bin/node');
  s.env.MUSE_BRIDGE_EXECUTABLE = join(s.root, 'runtime/bin/muse');
  s.env.MUSE_BRIDGE_CODEX_BIN = join(s.root, 'runtime/bin/codex');
  await s.run();
  assert.notEqual(await readlink(s.env.MUSE_BRIDGE_NODE_BIN), s.env.MUSE_BRIDGE_NODE_BIN);
  assert.equal(await exists(join(s.root, 'repo.previous')), false);
});

test('bootstrap preserves local edits and refuses unmanaged destination directories', async t => {
  const s = await setup(t);
  await mkdir(join(s.root, 'repo'), { recursive: true });
  await writeFile(join(s.root, 'repo/my-notes.txt'), 'keep');
  await assert.rejects(s.run(), e => /unmanaged directory/.test(e.stderr));
  assert.equal(await readFile(join(s.root, 'repo/my-notes.txt'), 'utf8'), 'keep');
  await rm(join(s.root, 'repo'), { recursive: true });
  await s.run();
  const file = join(s.root, 'repo/install.sh');
  await writeFile(file, 'my edits');
  await assert.rejects(s.run(), e => /source files have changed/.test(e.stderr));
  assert.equal(await readFile(file, 'utf8'), 'my edits');
});

test('Hermes bootstrap installs shared dependencies without downloading or calling Codex', async t => {
  const s = await setup(t, { missing: true });
  await s.run('--host', 'hermes');
  const calls = await s.calls();
  assert.ok(!calls.some(c => c.tool === 'codex' || c.tool === 'npm'));
  assert.equal(await exists(join(s.root, 'runtime/bin/codex')), false);
  assert.match(await readFile(s.env.MUSE_BRIDGE_HERMES_CONFIG, 'utf8'), /muse_code_bridge:/);
});

test('one bootstrap configures both alternative hosts; a later Codex install preserves them', async t => {
  const s = await setup(t);
  await s.run('--host', 'hermes', '--host', 'opencode', '--opencode-version', '2');
  const before = await readFile(s.env.MUSE_BRIDGE_OPENCODE_CONFIG, 'utf8');
  assert.ok(JSON.parse(before).mcp.servers.muse_code_bridge);
  assert.ok(!(await s.calls()).some(c => c.tool === 'codex'));
  await s.run('--host', 'codex');
  assert.equal(await readFile(s.env.MUSE_BRIDGE_OPENCODE_CONFIG, 'utf8'), before);
  assert.ok(await exists(join(s.root, 'runtime/bin/codex')));
  await s.run('--host', 'hermes');
  assert.ok(await exists(join(s.root, 'runtime/bin/codex')));
});

test('invalid host arguments stop before downloads or configuration changes', async t => {
  const s = await setup(t);
  await assert.rejects(s.run('--host', 'unknown'), /Unknown host/);
  await assert.rejects(s.run('--opencode-version', '3'), /OpenCode version/);
  assert.equal((await s.calls()).length, 0);
  assert.equal(await exists(s.root), false);
});
