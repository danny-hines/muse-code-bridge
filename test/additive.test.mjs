import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdditiveCatalog } from '../src/additive-catalog.mjs';
import { shouldWrap, assertStdio } from '../src/additive-cli.mjs';
import { RouteStore, AdditiveRouter } from '../src/additive-router.mjs';
import { EventEmitter } from 'node:events';
import { createNativeServer } from '../src/native-server.mjs';

const hostModel = (model, extra = {}) => ({ id: model, model, hidden: false, isDefault: true, inputModalities: ['text', 'image'], ...extra });
const fetchModels = models => async () => ({ data: models, nextCursor: null });

test('live catalogs preserve host metadata/default and discover arbitrary new IDs from both providers', async () => {
  let now = 0, muse = [{ modelId: 'meta-old', isDefault: true }];
  const catalog = new AdditiveCatalog({ now: () => now, intervalMs: 50, discover: async () => muse });
  const original = hostModel('host-old', { upgrade: 'host-next', supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }] });
  let models = [original];
  const fetch = async () => ({ data: models, nextCursor: null, otherMetadata: 'keep' });
  const first = await catalog.list(fetch);
  assert.deepEqual(first.data[0], original); assert.equal(first.data[1].isDefault, false);
  assert.equal(first.otherMetadata, 'keep');
  now = 51; muse = [...muse, { modelId: 'totally-new-meta-id', isDefault: true }]; models = [...models, hostModel('new-host-id', { isDefault: false })];
  const next = await catalog.list(fetch);
  assert.deepEqual(next.data.map(m => m.model), ['host-old', 'new-host-id', 'muse/meta-old', 'muse/totally-new-meta-id']);
  assert.equal(await catalog.resolve('muse/totally-new-meta-id'), 'totally-new-meta-id');
  assert.deepEqual(next.data.filter(m => m.isDefault), [original]);
});

test('combined pagination honors page size, host cursors, hidden entries, and stable snapshots', async () => {
  const calls = [];
  const catalog = new AdditiveCatalog({ discover: async () => [{ modelId: 'm1' }, { modelId: 'm2' }, { modelId: 'secret', hidden: true }] });
  const fetch = async p => { calls.push(p.cursor); return { data: [hostModel(p.cursor ? 'h2' : 'h1')], nextCursor: p.cursor ? null : 'host-private-cursor' }; };
  const first = await catalog.list(fetch, { limit: 2 });
  assert.deepEqual(calls, [null, 'host-private-cursor']); assert.equal(first.data.length, 2);
  const second = await catalog.list(fetch, { limit: 1, cursor: first.nextCursor });
  const last = await catalog.list(fetch, { limit: 1, cursor: second.nextCursor });
  assert.equal(second.data[0].model, 'muse/m1'); assert.equal(last.data[0].model, 'muse/m2'); assert.equal(last.nextCursor, null);
  assert.equal(calls.length, 2);
  await assert.rejects(catalog.list(fetch, { cursor: first.nextCursor, includeHidden: true }), /expired or invalid/);
  await assert.rejects(catalog.list(fetch, { cursor: 'untrusted' }), /expired or invalid/);
});

test('discovery failures leave host models intact and surface stale Muse entries without generation fallback', async () => {
  let fail = false;
  const catalog = new AdditiveCatalog({ discover: async () => { if (fail) throw new Error('sensitive upstream details'); return [{ modelId: 'a' }]; } });
  await catalog.refresh(); fail = true; await catalog.refresh();
  const original = hostModel('host');
  const list = await catalog.list(fetchModels([original]));
  assert.deepEqual(list.data[0], original); assert.match(list.data[1].description, /unavailable/);
  assert.doesNotMatch(JSON.stringify(list), /sensitive/);
  await assert.rejects(catalog.resolve('muse/a'), /discovery failed/);
  assert.equal(await catalog.resolve('host'), null);
});

test('model removals are enforced, and the host retains ownership of a colliding identifier', async () => {
  let models = [{ modelId: 'a' }, { modelId: 'b' }];
  const catalog = new AdditiveCatalog({ discover: async () => models });
  const host = hostModel('muse/a');
  const list = await catalog.list(fetchModels([host]));
  assert.deepEqual(list.data.map(x => x.model), ['muse/a', 'muse/b']);
  assert.equal(await catalog.resolve('muse/a'), null);
  const router = new AdditiveRouter({ coordinator: new EventEmitter(), catalog, store: {}, emit: () => {} });
  await assert.rejects(router.route('muse/a', { muse: true, model: 'a' }), /no provider switch/);
  assert.deepEqual(await router.route('muse/a'), { muse: false, model: 'muse/a' });
  models = []; await catalog.refresh();
  await assert.rejects(catalog.resolve('muse/b'), /not in the current account catalog/);
});

test('background refresh discovers models without a list request and stops cleanly', async t => {
  let count = 0;
  const catalog = new AdditiveCatalog({ intervalMs: 10, discover: async () => [{ modelId: `revision-${++count}` }] });
  catalog.start(); t.after(() => catalog.stop());
  for (let i = 0; count < 2 && i < 40; i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(count >= 2); catalog.stop(); const last = count;
  await new Promise(r => setTimeout(r, 25)); assert.equal(count, last);
});

test('routing state survives restart, serializes writes, and stores no task prompts or credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'muse-route-store-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'routes.json'), store = new RouteStore(path); await store.load();
  await Promise.all([store.set('task-a', { muse: true, model: 'm', prompt: 'private task', token: 'private token' }), store.set('task-b', { muse: false, model: 'h' })]);
  const next = new RouteStore(path); await next.load();
  assert.deepEqual(next.get('task-a'), { muse: true, model: 'm' }); assert.equal(next.get('task-b').muse, false);
  assert.doesNotMatch(await readFile(path, 'utf8'), /private/); assert.equal((await stat(path)).mode & 0o077, 0);
});

test('HTTP model validation follows the live catalog and rejects removed models before execution', async t => {
  const token = 'fixture-token-'.repeat(4); let models = ['old'], calls = 0;
  const server = createNativeServer({ token, connection: { mode: 'account' }, getModels: async () => models,
    runner: async () => { calls++; return '{"kind":"message","text":"ok"}'; },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.stop());
  const request = model => fetch(`http://127.0.0.1:${server.address().port}/v1/responses`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: 'hello' }) });
  assert.equal((await request('old')).status, 200); models = ['brand-new'];
  assert.equal((await request('brand-new')).status, 200); assert.equal((await request('old')).status, 400);
  assert.equal(calls, 2);
});

test('desktop CLI flags before app-server still activate routing; other commands pass through', () => {
  assert.equal(shouldWrap(['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled']), true);
  assert.equal(shouldWrap(['app-server', 'daemon', 'version']), false);
  assert.equal(shouldWrap(['exec', 'app-server']), false);
  assert.equal(shouldWrap(['-c', 'app-server', 'exec']), false);
  assert.doesNotThrow(() => assertStdio(['app-server', '--listen', 'stdio://']));
  assert.throws(() => assertStdio(['app-server', '--listen=ws://127.0.0.1:9000']), /only stdio/);
});

test('the distributable wrapper help does not execute imported server entry points', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['dist/muse-additive.mjs', '--help'], { cwd: new URL('..', import.meta.url) });
  assert.match(stdout, /additive routing prototype/); assert.equal(stderr, '');
});
