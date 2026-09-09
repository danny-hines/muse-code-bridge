import { openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export function connectionPath(env = process.env) {
  const path = env.MUSE_BRIDGE_CONNECTION_FILE || join(env.MUSE_BRIDGE_ROOT || join(homedir(), '.local/share/muse-bridge'), 'connection.json');
  if (!isAbsolute(path)) throw new Error('The bridge connection file must have an absolute path.');
  return path;
}

export function validateConfig(config) {
  if (!config || config.version !== 1 || !['account', 'api-key'].includes(config.mode) ||
      Object.keys(config).some(key => !['version', 'mode', 'api_key_file'].includes(key))) {
    throw new Error('Invalid bridge connection settings. Expected version 1 and account or api-key mode.');
  }
  if (config.mode === 'api-key' && (typeof config.api_key_file !== 'string' || !isAbsolute(config.api_key_file))) {
    throw new Error('API mode requires --api-key-file with an absolute path to a private key file.');
  }
  if (config.mode === 'account' && config.api_key_file !== undefined) throw new Error('Account mode cannot specify an API key file.');
  return config;
}

export function readConfig(env = process.env) {
  let text;
  try { text = readFileSync(connectionPath(env), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, mode: 'account' };
    throw new Error('Cannot read bridge connection settings.');
  }
  let config;
  try { config = JSON.parse(text); } catch { throw new Error('Invalid JSON in bridge connection settings.'); }
  return validateConfig(config);
}

export function resolveConnection(config) {
  validateConfig(config);
  const connection = { mode: config.mode };
  if (config.mode === 'api-key') {
    let fd;
    let key;
    try {
      fd = openSync(config.api_key_file, 'r');
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) ||
          (process.getuid && info.uid !== process.getuid())) {
        throw new Error('unsafe');
      }
      key = readFileSync(fd, 'utf8').trim();
      if (!key || /\s/.test(key)) throw new Error('invalid');
    } catch {
      throw new Error('Cannot use the API key file. It must be a readable file owned by you, private (chmod 600), and contain only the key. No account fallback was attempted.');
    } finally { if (fd !== undefined) closeSync(fd); }
    // Never include a key in serialized status, session metadata, or diagnostics.
    Object.defineProperty(connection, 'apiKey', { value: key, enumerable: false });
  }
  return Object.freeze(connection);
}

export function readConnection(env = process.env) {
  return resolveConnection(readConfig(env));
}
