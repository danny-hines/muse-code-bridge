import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'smol-toml';

const owned = new Set(['model', 'model_reasoning_effort']);
const protectedKeys = new Set(['model_provider', 'model_catalog_json']);

// Parse TOML key paths, including quoted profile names, without evaluating code.
function segments(key) {
  if (typeof key !== 'string' || /[\r\n]/.test(key)) throw new Error('Invalid config key path.');
  let node;
  try { node = parse(`${key} = 1`); } catch { throw new Error('Invalid config key path.'); }
  const parts = [];
  while (node && typeof node === 'object') {
    const entries = Object.entries(node);
    if (entries.length !== 1) throw new Error('Invalid config key path.');
    parts.push(entries[0][0]); node = entries[0][1];
  }
  if (node !== 1) throw new Error('Invalid config key path.');
  return parts;
}
const canonical = parts => parts.map(p => /^[\w-]+$/.test(p) ? p : JSON.stringify(p)).join('.');
function classify(key) {
  const parts = segments(key);
  const field = parts[0] === 'profiles' && parts.length >= 3 ? parts[2] : parts[0];
  const leaf = parts.length === 1 || (parts[0] === 'profiles' && parts.length === 3);
  if (protectedKeys.has(field)) return { kind: 'protected' };
  if (owned.has(field)) {
    if (!leaf) throw new Error('Model preferences must be scalar config keys.');
    return { kind: 'preference', parts, key: canonical(parts), field };
  }
  // Whole-profile replacement could also persist a Muse model into normal config.
  if (parts[0] === 'profiles' && parts.length < 3) return { kind: 'protected' };
  return { kind: 'other' };
}
function validValue(value) {
  return value === null || (typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value));
}
function assignPath(object, parts, value) {
  let node = object;
  for (const part of parts.slice(0, -1)) {
    const next = Object.hasOwn(node, part) ? node[part] : null;
    Object.defineProperty(node, part, { value: next && typeof next === 'object' ? next : {}, enumerable: true, writable: true, configurable: true });
    node = node[part];
  }
  Object.defineProperty(node, parts.at(-1), { value, enumerable: true, writable: true, configurable: true });
}
const ordered = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
const serialize = (values, routes) => JSON.stringify({ schemaVersion: 1, values: ordered(values), routes: ordered(routes) }) + '\n';
const versionOf = (values, routes) => `muse-preferences:${createHash('sha256').update(serialize(values, routes)).digest('hex')}`;

// Model picker writes are session defaults owned by this adapter, never writes to
// CODEX_HOME. The JSON file contains only model/effort values, including profiles.
export class AdditivePreferences {
  constructor(path) { this.path = resolve(path); this.values = {}; this.routes = {}; this.writes = Promise.resolve(); }
  get version() { return versionOf(this.values, this.routes); }
  get hasValues() { return Object.keys(this.values).length > 0; }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      if (saved.schemaVersion !== 1 || !saved.values || typeof saved.values !== 'object' || Array.isArray(saved.values)) throw new Error('invalid');
      for (const [key, value] of Object.entries(saved.values)) {
        const info = classify(key);
        if (info.kind !== 'preference' || info.key !== key || value === null || !validValue(value)) throw new Error('invalid');
      }
      if (!saved.routes || typeof saved.routes !== 'object' || Array.isArray(saved.routes)) throw new Error('invalid');
      const routes = {};
      for (const [key, route] of Object.entries(saved.routes)) {
        if (classify(key).field !== 'model' || !route || typeof route.muse !== 'boolean' || !validValue(route.model) || route.model === null
          || saved.values[key] !== (route.muse ? `muse/${route.model}` : route.model)) throw new Error('invalid');
        routes[key] = { muse: route.muse, model: route.model };
      }
      if (Object.keys(saved.values).some(key => classify(key).field === 'model' && !Object.hasOwn(routes, key))) throw new Error('invalid');
      this.values = saved.values; this.routes = routes;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read additive model preferences. No provider fallback was attempted.');
    }
  }
  project(result) {
    if (!this.hasValues) return result;
    const projected = structuredClone(result), overlay = {};
    const metadata = { name: { type: 'sessionFlags' }, version: this.version };
    for (const [key, value] of Object.entries(this.values)) {
      const { parts } = classify(key);
      assignPath(projected.config, parts, value); assignPath(overlay, parts, value);
      projected.origins[key] = metadata;
    }
    if (Array.isArray(projected.layers)) projected.layers.push({ ...metadata, config: overlay });
    return projected;
  }
  selection(result) {
    const config = this.project(result).config;
    const profile = config.profile != null && Object.hasOwn(config.profiles || {}, config.profile) ? config.profiles[config.profile] : null;
    const key = profile?.model != null ? canonical(['profiles', config.profile, 'model']) : 'model';
    return { config: { ...config, ...Object.fromEntries(Object.entries(profile || {}).filter(([, v]) => v != null)) }, route: this.routes[key] };
  }
  async dispatch(method, params, { readConfig, forward, validateModel }) {
    const edits = method === 'config/value/write' ? [params] : params.edits;
    if (!Array.isArray(edits)) throw new Error('Config edits must be an array.');
    const info = edits.map(edit => classify(edit.keyPath));
    if (info.some(i => i.kind === 'protected')) throw new Error('Global provider/catalog and whole-profile replacement are not supported by the additive bridge. Select a model in the picker.');
    if (!info.some(i => i.kind === 'preference')) {
      if (params.filePath === this.path || params.expectedVersion?.startsWith('muse-preferences:')) throw new Error('The additive preference file accepts only model and reasoning settings.');
      return forward(method, params);
    }
    // The desktop batches model + effort. Do not split an arbitrary mixed batch
    // across two files: either the entire request is owned here or none is applied.
    if (info.some(i => i.kind !== 'preference')) throw new Error('Save model preferences separately from other config settings. No edits were applied.');
    const write = async () => {
      if (params.expectedVersion != null && params.expectedVersion !== this.version) throw new Error('Additive model preferences changed or use a different config version. Read config again before saving.');
      if (params.filePath != null && resolve(params.filePath) !== this.path) {
        const host = await readConfig({ includeLayers: true });
        if (!host.layers?.some(l => l.name.type === 'user' && resolve(l.name.file) === resolve(params.filePath))) throw new Error('Additive model preferences support the user default or bridge preference file, not project config files.');
      }
      const values = { ...this.values }, routes = { ...this.routes };
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i], entry = info[i];
        if (!['replace', 'upsert'].includes(edit.mergeStrategy) || !validValue(edit.value)) throw new Error('Invalid model preference value or merge strategy.');
        if (entry.field === 'model') {
          if (edit.value === null) delete routes[entry.key];
          else {
            const route = await validateModel(edit.value);
            routes[entry.key] = { muse: route.muse, model: route.model };
          }
        }
        if (edit.value === null) delete values[entry.key]; else values[entry.key] = edit.value;
      }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temp, serialize(values, routes), { flag: 'wx', mode: 0o600 }); await rename(temp, this.path); }
      finally { await unlink(temp).catch(() => {}); }
      this.values = values; this.routes = routes;
      return { status: 'ok', filePath: this.path, version: this.version };
    };
    const pending = this.writes.then(write);
    this.writes = pending.catch(() => {});
    return pending;
  }
}
