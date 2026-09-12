import { parse } from 'smol-toml';

const keys = ['model', 'model_provider', 'model_catalog_json', 'model_reasoning_effort', 'web_search'];
const selectedLine = new RegExp(`^\\s*(${keys.join('|')})\\s*=`);
const begin = '# BEGIN MUSE NATIVE PROVIDER (managed)';
const end = '# END MUSE NATIVE PROVIDER (managed)';
export const providerId = 'muse_bridge';

export function enableConfig(text, { model, catalogPath, port, token }) {
  let parsed; try { parsed = parse(text); } catch { throw new Error('Codex configuration is not valid TOML; no settings changed.'); }
  if (text.includes(begin) || parsed.model_providers?.[providerId]) throw new Error('Muse native configuration already exists or conflicts with a provider entry.');
  const lines = text.split('\n');
  const removed = [];
  // Only replace simple, top-level selected-model keys. Never rewrite unrelated TOML.
  let inRoot = true;
  const kept = lines.filter((line, index) => {
    if (/^\s*\[/.test(line)) inRoot = false;
    if (!inRoot) return true;
    const match = line.match(selectedLine);
    if (!match) return true;
    try { const value = parse(line)[match[1]]; if (typeof value !== 'string') throw new Error(); }
    catch { throw new Error('Selected-model configuration uses multiline or complex TOML. Simplify those settings before enabling Muse.'); }
    removed.push({ index, line }); return false;
  });
  for (const key of keys) if (parsed[key] !== undefined && !removed.some(x => new RegExp(`^\\s*${key}\\s*=`).test(x.line))) throw new Error(`Cannot safely replace the existing ${key} setting.`);
  const header = `${begin}\nmodel = ${JSON.stringify(model)}\nmodel_provider = ${JSON.stringify(providerId)}\nmodel_catalog_json = ${JSON.stringify(catalogPath)}\nmodel_reasoning_effort = "high"\nweb_search = "disabled"\n${end}\n`;
  const provider = `\n${begin}\n[model_providers.${providerId}]\nname = "Muse Code Bridge (experimental)"\nbase_url = "http://127.0.0.1:${port}/v1"\nexperimental_bearer_token = ${JSON.stringify(token)}\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\nstream_idle_timeout_ms = 180000\n${end}\n`;
  const next = header + kept.join('\n') + provider;
  const actual = parse(next);
  if (actual.model !== model || actual.model_provider !== providerId) throw new Error('Could not validate Muse provider configuration.');
  return { text: next, restore: { header, provider, removed, original: text } };
}

export function disableConfig(text, restore) {
  if (!text.startsWith(restore.header) || !text.endsWith(restore.provider)) throw new Error('Managed Muse settings changed. Restore them from the backup manually; no config was overwritten.');
  const rest = text.slice(restore.header.length, -restore.provider.length);
  const lines = rest.split('\n');
  for (const { index, line } of restore.removed) lines.splice(index, 0, line);
  // Exact restoration when untouched. With unrelated edits, restore original
  // selected-model lines at the root instead of using now-stale line numbers.
  const reconstructed = lines.join('\n');
  const next = reconstructed === restore.original ? reconstructed : restore.removed.map(x => x.line).join('\n') + '\n' + rest;
  parse(next);
  return next;
}
