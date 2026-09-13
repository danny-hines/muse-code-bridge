import { randomUUID } from 'node:crypto';
import { MuseHost } from './msp.mjs';

export const museProvider = 'muse_bridge_additive';
export const musePrefix = 'muse/';
export const museModelName = id => musePrefix + id;
export const isMuseModel = id => typeof id === 'string' && id.startsWith(musePrefix);

export async function discoverMuse(connection) {
  const host = new MuseHost({ connection });
  try { await host.start(); return (await host.request('model/list', {})).models; }
  finally { host.close(); }
}

// Discovery is separate from the host's OpenAI catalog. Failure never replaces it.
export class AdditiveCatalog {
  constructor({ discover, intervalMs = 300000, now = Date.now } = {}) {
    this.discover = discover; this.intervalMs = intervalMs; this.now = now;
    this.hostIds = new Set(); this.pages = new Map();
    this.models = []; this.updatedAt = null; this.error = null; this.inflight = null;
  }
  async refresh() {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const models = await this.discover();
        if (!Array.isArray(models) || models.some(m => !m || typeof m.modelId !== 'string' || !m.modelId || m.modelId.length > 256)) throw new Error('Invalid catalog');
        if (new Set(models.map(m => m.modelId)).size !== models.length) throw new Error('Duplicate model identifiers');
        this.models = models; this.updatedAt = this.now(); this.error = null;
      } catch {
        // Do not expose raw upstream errors: they may contain account details.
        this.error = 'Muse model discovery is unavailable. Cached models may no longer be accessible.';
      }
      return this.models;
    })();
    try { return await this.inflight; } finally { this.inflight = null; }
  }
  async ensureFresh() {
    if (this.updatedAt === null || this.now() - this.updatedAt >= this.intervalMs) await this.refresh();
    return this.models;
  }
  start() { this.timer = setInterval(() => this.refresh(), this.intervalMs); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); }
  ids() { return this.models.map(m => m.modelId); }
  async resolve(id) {
    if (!isMuseModel(id) || this.hostIds.has(id)) return null;
    await this.ensureFresh();
    const actual = id.slice(musePrefix.length);
    if (!this.ids().includes(actual)) throw new Error('This Muse model is not in the current account catalog. Select an available model; no provider fallback was attempted.');
    if (this.error) throw new Error('Muse discovery failed. Reconnect before starting a new Muse request; no provider fallback was attempted.');
    return actual;
  }
  async list(fetchHost, params = {}) {
    const limit = params.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid model page size.');
    for (const [id, page] of this.pages) if (this.now() - page.createdAt > 600000) this.pages.delete(id);
    if (params.cursor) {
      const page = this.pages.get(params.cursor);
      if (!page || page.includeHidden !== Boolean(params.includeHidden)) throw new Error('Model page expired or invalid. Load the model list again.');
      return this.page(page, limit);
    }
    // Fetch upstream pagination completely before building our own stable pages.
    // Model metadata and the host default remain untouched.
    let cursor = null, openai, data = []; const cursors = new Set();
    do {
      const next = await fetchHost({ ...params, cursor, limit: 100 });
      openai ||= next; data.push(...next.data); cursor = next.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('Host returned a repeated model cursor.');
      if (cursor) cursors.add(cursor);
      if (cursors.size > 100 || data.length > 10000) throw new Error('Host model catalog exceeds the prototype limit.');
    } while (cursor);
    await this.ensureFresh();
    this.hostIds = new Set(data.flatMap(m => [m.id, m.model]));
    const extras = this.models.filter(m => !m.hidden || params.includeHidden).slice().sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault))).map(m => ({
      id: museModelName(m.modelId), model: museModelName(m.modelId),
      displayName: `${m.displayLabel || m.displayName || m.modelId} (Muse bridge · experimental)`,
      description: this.error || 'Muse via the configured bridge account or API key. Text and host tools only.',
      hidden: Boolean(m.hidden), isDefault: false,
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort, description: `${reasoningEffort} reasoning` })),
      inputModalities: ['text'], supportsPersonality: false,
    }));
    // A host identifier wins a collision; never hijack an existing OpenAI entry.
    const snapshot = { meta: openai, data: [...data, ...extras.filter(m => !this.hostIds.has(m.id))], offset: 0, createdAt: this.now(), includeHidden: Boolean(params.includeHidden) };
    return this.page(snapshot, limit);
  }
  page(snapshot, limit) {
    const end = snapshot.offset + limit;
    let nextCursor = null;
    if (end < snapshot.data.length) {
      nextCursor = `muse-catalog:${randomUUID()}`;
      this.pages.set(nextCursor, { ...snapshot, offset: end });
      while (this.pages.size > 256) this.pages.delete(this.pages.keys().next().value);
    }
    return { ...snapshot.meta, data: snapshot.data.slice(snapshot.offset, end), nextCursor };
  }
}
