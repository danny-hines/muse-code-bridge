import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, symlink, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile), repository = resolve(import.meta.dirname, '..');
const macOS = process.platform === 'darwin';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'muse launcher test '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'custom root'), repo = join(root, 'repo'), runtime = join(root, 'runtime/bin');
  const app = join(dir, 'Fixture.app'), log = join(dir, 'launch.json');
  for (const path of [join(repo, 'scripts'), join(repo, 'dist'), runtime, join(app, 'Contents/MacOS'), join(app, 'Contents/Resources')]) await mkdir(path, { recursive: true });
  await cp(join(repository, 'scripts/launch-additive-macos.sh'), join(repo, 'scripts/launch-additive-macos.sh'));
  await cp(join(repository, 'dist/muse-additive.mjs'), join(repo, 'dist/muse-additive.mjs'));
  await writeFile(join(repo, '.muse-bridge-source.json'), '{}');
  await symlink(process.execPath, join(runtime, 'node'));
  await writeFile(join(runtime, 'muse'), '#!/bin/sh\necho "Muse Code 1.0.3"\n', { mode: 0o755 });
  await writeFile(join(app, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>MuseLauncherFixture</string></dict></plist>');
  await writeFile(join(app, 'Contents/Resources/codex'), '#!/bin/sh\necho "codex launcher fixture"\n', { mode: 0o755 });
  await writeFile(join(app, 'Contents/MacOS/MuseLauncherFixture'), `#!/bin/sh
"$MUSE_ADDITIVE_NODE_BIN" -e 'const e=process.env; require("fs").writeFileSync(e.LAUNCH_TEST_LOG,JSON.stringify({root:e.MUSE_BRIDGE_ROOT,state:e.MUSE_ADDITIVE_STATE_DIR,muse:e.MUSE_BRIDGE_EXECUTABLE,node:e.MUSE_ADDITIVE_NODE_BIN,wrapper:e.CODEX_CLI_PATH,forceStdio:e.CODEX_APP_SERVER_FORCE_CLI}));'
"$CODEX_CLI_PATH" --version
`, { mode: 0o755 });
  const env = { ...process.env, PATH: '/usr/bin:/bin', MUSE_ADDITIVE_APP_PATH: app, LAUNCH_TEST_LOG: log };
  for (const key of ['MUSE_BRIDGE_ROOT', 'MUSE_BRIDGE_NODE_BIN', 'MUSE_BRIDGE_EXECUTABLE', 'MUSE_ADDITIVE_STATE_DIR']) delete env[key];
  return { root, repo, log, env, run: (...args) => exec('/bin/bash', [join(repo, 'scripts/launch-additive-macos.sh'), ...args], { env }) };
}

test('launcher help is available without desktop dependencies', async () => {
  const result = await exec('/bin/bash', [join(repository, 'scripts/launch-additive-macos.sh'), '--help']);
  assert.match(result.stdout, /--check/); assert.match(result.stdout, /private Node and Muse/);
  assert.match(result.stdout, /Remote is unavailable/);
});

test('bootstrap snapshot launcher finds private binaries and custom root with a minimal PATH', { skip: !macOS }, async t => {
  const s = await fixture(t);
  const checked = await s.run('--check');
  assert.match(checked.stdout, /No app was launched/);
  await assert.rejects(access(s.log), { code: 'ENOENT' });
  await assert.rejects(access(join(s.root, 'additive')), { code: 'ENOENT' });
  const result = await s.run();
  assert.match(result.stdout, /codex launcher fixture/);
  const launched = JSON.parse(await readFile(s.log, 'utf8'));
  assert.equal(launched.root, s.root); assert.equal(launched.state, join(s.root, 'additive'));
  assert.equal(launched.node, await realpath(process.execPath)); assert.equal(launched.muse, await realpath(join(s.root, 'runtime/bin/muse')));
  assert.equal(launched.forceStdio, '1');
  await assert.rejects(access(launched.wrapper), { code: 'ENOENT' });
});

test('launcher rejects invalid explicit dependency overrides before opening the app', { skip: !macOS }, async t => {
  const s = await fixture(t), oldNode = join(s.root, 'old-node');
  await writeFile(oldNode, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  s.env.MUSE_BRIDGE_NODE_BIN = oldNode;
  await assert.rejects(s.run(), /Node.js 22\+ is required/);
  delete s.env.MUSE_BRIDGE_NODE_BIN;
  s.env.MUSE_BRIDGE_EXECUTABLE = join(s.root, 'missing-muse');
  await assert.rejects(s.run(), /Muse Code is required/);
  await assert.rejects(access(s.log), { code: 'ENOENT' });
});
