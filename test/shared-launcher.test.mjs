import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

test('macOS shortcut scopes the endpoint shim and Remote environment to the app, then cleans up', { skip: process.platform !== 'darwin' }, async t => {
  const root = await mkdtemp(join(tmpdir(), "Muse shortcut's fixture "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codex = join(root, 'codex'), app = join(root, 'app'), output = join(root, 'result.json'), configFile = join(root, 'launcher.json');
  await writeFile(codex, '#!/bin/sh\necho native-fixture-1\n', { mode: 0o700 });
  await writeFile(app, `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(process.env.MUSE_TEST_OUTPUT,JSON.stringify({shim:process.env.CODEX_CLI_PATH,shimText:fs.readFileSync(process.env.CODEX_CLI_PATH,'utf8'),force:process.env.CODEX_APP_SERVER_FORCE_CLI,disabled:process.env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED,native:process.env.MUSE_SHARED_CODEX_BIN,root:process.env.MUSE_BRIDGE_ROOT}));\n`, { mode: 0o700 });
  const config = { nodeBin: process.execPath, entrypoint: codex, museBin: codex, codexBin: codex, appBin: app, nativeVersion: 'native-fixture-1', bridgeRoot: root, environment: {} };
  await writeFile(configFile, JSON.stringify(config));
  const env = { ...process.env, CODEX_CLI_PATH: '/fixture/parent', CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1', MUSE_TEST_OUTPUT: output };
  const launcher = resolve('scripts/launch-shared-macos.mjs');
  await run(process.execPath, [launcher, configFile, '--check'], { env });
  await assert.rejects(access(output));
  await run(process.execPath, [launcher, configFile], { env });
  const result = JSON.parse(await readFile(output));
  assert.equal(result.force, '1'); assert.equal(result.disabled, undefined); assert.equal(result.root, root); assert.equal(result.native, codex);
  assert.match(result.shimText, /exec "\$MUSE_SHARED_NODE_BIN" "\$MUSE_SHARED_ENTRYPOINT" "\$@"/);
  await assert.rejects(access(result.shim));
  assert.equal(env.CODEX_CLI_PATH, '/fixture/parent'); assert.equal(env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED, '1');
  await writeFile(configFile, JSON.stringify({ ...config, nativeVersion: 'old-native' }));
  await assert.rejects(run(process.execPath, [launcher, configFile, '--check'], { env }), error => /ChatGPT was updated/.test(error.stderr));
});

test('LaunchServices accepts the companion shell app format without opening a terminal', { skip: process.platform !== 'darwin', timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'Muse LaunchServices fixture ')), app = join(root, 'Fixture.app'), marker = join(root, 'opened');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
  await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.muse-code-bridge.fixture.${Date.now()}</string><key>CFBundleExecutable</key><string>launch</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
  await writeFile(join(app, 'Contents/MacOS/launch'), `#!/bin/sh\n/usr/bin/touch '${marker}'\n`, { mode: 0o700 });
  await run('/usr/bin/open', ['-W', '-g', app], { timeout: 10000 });
  await access(marker);
});
