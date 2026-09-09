import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MuseHost } from '../src/msp.mjs';

async function fixture(t, mode = 'normal') {
  const dir = await mkdtemp(join(tmpdir(), 'muse-process-test-'));
  const file = join(dir, 'fake-muse');
  await writeFile(file, `#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', line => {
  const m = JSON.parse(line); if (m.id === undefined) return;
  if (${JSON.stringify(mode)} === 'malformed') { process.stdout.write('not JSON\\n'); return; }
  if (m.method === 'initialize') {
    const out = JSON.stringify({jsonrpc:'2.0',id:m.id,result:{schema:{version:1},serverInfo:{version:'fixture'}}})+'\\n';
    process.stdout.write(out.slice(0, 10)); setTimeout(() => process.stdout.write(out.slice(10)), 5);
  } else if (m.method === 'crash') process.exit(2);
  else process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{args:process.argv.slice(2),hasApiKey:!!process.env.META_API_KEY}})+'\\n');
});
`, { mode: 0o755 });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return file;
}

test('real process transport handles partial frames, restricted flags, and API-key removal', async t => {
  const host = new MuseHost({ executable: await fixture(t), mode: 'read-only', connection: { mode: 'account' }, env: { ...process.env, META_API_KEY: 'test-only' } });
  t.after(() => host.close());
  await host.start();
  const result = await host.request('inspect', {});
  assert.deepEqual(result.args, ['serve', '--disable-shell', '--disable-write']);
  assert.equal(result.hasApiKey, false);
});

test('process exit rejects pending requests promptly', async t => {
  const host = new MuseHost({ executable: await fixture(t), connection: { mode: 'account' } });
  t.after(() => host.close());
  await host.start();
  await assert.rejects(host.request('crash', {}), /Muse exited/);
});

test('malformed protocol output fails closed', async t => {
  const host = new MuseHost({ executable: await fixture(t, 'malformed'), connection: { mode: 'account' } });
  t.after(() => host.close());
  await assert.rejects(host.start(), /invalid protocol JSON/);
});

test('code process retains the default sandbox without bypass flags', async t => {
  const host = new MuseHost({ executable: await fixture(t), mode: 'code', connection: { mode: 'account' } });
  t.after(() => host.close());
  await host.start();
  assert.deepEqual((await host.request('inspect', {})).args, ['serve']);
});

test('explicit API mode injects the selected key into the Muse child without CLI arguments', async t => {
  const host = new MuseHost({ executable: await fixture(t), connection: { mode: 'api-key', apiKey: 'fixture-key' } });
  t.after(() => host.close());
  await host.start();
  const result = await host.request('inspect', {});
  assert.equal(result.hasApiKey, true);
  assert.deepEqual(result.args, ['serve', '--disable-shell', '--disable-write']);
});
