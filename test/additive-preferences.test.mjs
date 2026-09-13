import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdditivePreferences } from '../src/additive-preferences.mjs';

const edit = (keyPath, value) => ({ keyPath, value, mergeStrategy: 'upsert' });
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'muse-preferences-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const preferences = new AdditivePreferences(join(dir, 'preferences.json')); await preferences.load();
  const host = {
    config: { model: 'host-model', model_reasoning_effort: 'ultra', model_provider: 'openai', features: { test: true } },
    origins: { model: { name: { type: 'user', file: join(dir, 'config.toml') }, version: 'host-version' } },
    layers: [{ name: { type: 'user', file: join(dir, 'config.toml') }, version: 'host-version', config: { model: 'host-model' } }],
  };
  const forwarded = [];
  const handlers = {
    readConfig: async () => host,
    forward: async (...args) => { forwarded.push(args); return { status: 'ok', version: 'native-version', filePath: join(dir, 'config.toml') }; },
    validateModel: async model => {
      if (model === 'muse/removed') throw new Error('model removed');
      return { muse: model.startsWith('muse/'), model: model.replace(/^muse\//, ''), privatePrompt: 'do not persist' };
    },
  };
  const batch = (edits, extra) => preferences.dispatch('config/batchWrite', { edits, ...extra }, handlers);
  return { dir, preferences, host, handlers, forwarded, batch };
}

test('desktop picker saves model and effort privately, survives restart, and can reset to native defaults', async t => {
  const { preferences, host, batch, forwarded } = await setup(t);
  const original = structuredClone(host);
  const saved = await batch([edit('model', 'muse/meta-model'), edit('model_reasoning_effort', 'low')], { filePath: null, expectedVersion: null, reloadUserConfig: true });
  assert.equal(saved.status, 'ok'); assert.equal(saved.filePath, preferences.path);
  assert.equal((await stat(preferences.path)).mode & 0o077, 0);
  assert.doesNotMatch(await readFile(preferences.path, 'utf8'), /do not persist|features|privatePrompt/);
  const next = new AdditivePreferences(preferences.path); await next.load();
  const projected = next.project(host);
  assert.equal(projected.config.model, 'muse/meta-model'); assert.equal(projected.config.model_reasoning_effort, 'low');
  assert.equal(projected.config.model_provider, 'openai'); assert.equal(projected.origins.model.version, saved.version);
  assert.equal(projected.layers[0].version, 'host-version'); assert.equal(projected.layers.at(-1).name.type, 'sessionFlags');
  assert.deepEqual(next.selection(host).route, { muse: true, model: 'meta-model' });
  assert.deepEqual(host, original); assert.deepEqual(forwarded, []);
  await batch([edit('model', 'host-other'), edit('model_reasoning_effort', 'future-effort')]);
  assert.equal(preferences.project(host).config.model, 'host-other');
  await batch([edit('model', null), edit('model_reasoning_effort', null)]);
  assert.deepEqual(preferences.project(host), original);
});

test('profile model preferences remain scoped and quoted TOML paths are supported', async t => {
  const { preferences, host, batch } = await setup(t);
  host.config.profiles = { 'work.one': { model: 'host-work', model_reasoning_effort: 'high' }, other: { model: 'host-other' } };
  await batch([edit('model', 'muse/root'), edit('profiles."work.one".model', 'muse/profile'), edit('profiles."work.one".model_reasoning_effort', 'low')]);
  host.config.profile = 'work.one';
  assert.equal(preferences.selection(host).config.model, 'muse/profile');
  assert.equal(preferences.selection(host).config.model_reasoning_effort, 'low');
  assert.deepEqual(preferences.selection(host).route, { muse: true, model: 'profile' });
  host.config.profile = 'other';
  assert.equal(preferences.selection(host).config.model, 'host-other'); assert.equal(preferences.selection(host).route, undefined);
  delete host.config.profile;
  assert.equal(preferences.selection(host).config.model, 'muse/root');
});

test('stale and concurrent versions cannot overwrite a newer preference; failures leave the queue usable', async t => {
  const { preferences, batch } = await setup(t);
  const expectedVersion = preferences.version;
  const results = await Promise.allSettled([
    batch([edit('model', 'muse/first')], { expectedVersion }),
    batch([edit('model', 'muse/stale')], { expectedVersion }),
  ]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /Read config again/);
  await batch([edit('model_reasoning_effort', 'low')], { expectedVersion: preferences.version, filePath: preferences.path });
  const disk = await readFile(preferences.path, 'utf8');
  await assert.rejects(batch([edit('model_reasoning_effort', 'high'), edit('model', 'muse/removed')]), /removed/);
  assert.equal(await readFile(preferences.path, 'utf8'), disk); assert.equal(preferences.values.model, 'muse/first');
});

test('mixed batches, provider overrides and project targets fail before mutation; unrelated writes stay native', async t => {
  const { preferences, batch, forwarded, host } = await setup(t);
  for (const edits of [
    [edit('model', 'muse/one'), edit('features.test', true)],
    [edit('model', 'muse/one'), edit('model_provider', 'oops')],
    [edit('profiles.work.model_catalog_json', '/tmp/catalog')],
    [edit('profiles.work', { model: 'muse/one' })],
    [edit('"model".bad', 'muse/one')],
  ]) await assert.rejects(batch(edits));
  await assert.rejects(batch([edit('model', 'muse/one')], { filePath: '/some/project/config.toml' }), /not project/);
  assert.equal(preferences.hasValues, false); assert.equal(forwarded.length, 0);
  const native = [edit('features.test', false)];
  await batch(native, { expectedVersion: 'host-version' });
  assert.deepEqual(forwarded[0], ['config/batchWrite', { edits: native, expectedVersion: 'host-version' }]);
  await batch([edit('model', 'muse/one')], { filePath: host.layers[0].name.file });
  assert.equal(forwarded.length, 1);
  await assert.rejects(batch(native, { filePath: preferences.path }), /only model and reasoning/);
});

test('disk failure and damaged preferences never silently commit or fall back to the host', async t => {
  const { preferences, batch } = await setup(t);
  await mkdir(preferences.path);
  await assert.rejects(batch([edit('model', 'muse/one')]));
  assert.equal(preferences.hasValues, false);
  await rm(preferences.path, { recursive: true });
  await batch([edit('model', 'muse/one')]);
  const saved = JSON.parse(await readFile(preferences.path, 'utf8'));
  delete saved.routes.model;
  await writeFile(preferences.path, JSON.stringify(saved));
  await assert.rejects(new AdditivePreferences(preferences.path).load(), /No provider fallback/);
});
