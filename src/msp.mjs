import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readConnection } from './auth.mjs';
import { bridgeVersion } from './build-info.mjs';

export function uuid7() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 15) | 0x70;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export function findMuse(env = process.env) {
  const candidates = env.MUSE_BRIDGE_EXECUTABLE ? [env.MUSE_BRIDGE_EXECUTABLE] : [
    join(homedir(), '.local/bin/muse'), '/opt/homebrew/bin/muse', '/usr/local/bin/muse',
    ...(env.PATH || '').split(delimiter).filter(Boolean).map(p => join(p, 'muse')),
  ];
  for (const file of candidates) {
    try { accessSync(file, constants.X_OK); return file; } catch {}
  }
  throw new Error('Muse CLI was not found. Install Muse Code from Meta, then sign in with muse login. Set MUSE_BRIDGE_EXECUTABLE if it is installed elsewhere.');
}

export function museEnvironment(env = process.env, connection = { mode: 'account' }) {
  const result = { ...env };
  // The official CLI documents that this key overrides a Meta account login.
  // Do not turn subscription requests into implicit API-key requests.
  delete result.META_API_KEY;
  if (connection.mode === 'api-key') {
    if (!connection.apiKey) throw new Error('API mode has no credential. No account fallback was attempted.');
    result.META_API_KEY = connection.apiKey;
  } else if (connection.mode !== 'account') throw new Error('Unknown authentication mode.');
  return result;
}

export class MuseHost extends EventEmitter {
  constructor({ mode = 'read-only', executable, env = process.env, connection, timeoutMs = 15000 } = {}) {
    super();
    this.mode = mode;
    this.executable = executable;
    this.env = env;
    this.connection = connection || readConnection(env);
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    this.buffer = '';
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.initialize();
    return this.startPromise;
  }

  async initialize() {
    const args = ['serve'];
    if (this.mode === 'read-only') args.push('--disable-shell', '--disable-write');
    this.child = spawn(this.executable || findMuse(this.env), args, {
      env: museEnvironment(this.env, this.connection), stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Never forward raw CLI stderr; it can contain personal paths or auth details.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.fail(new Error('Muse input connection closed.')));
    this.child.on('error', error => this.fail(new Error(`Unable to start Muse: ${error.code || 'process error'}`)));
    this.child.on('exit', (code, signal) => this.fail(new Error(`Muse exited (${signal || code}). Resume the session after reconnecting.`)));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.consume(chunk));
    const result = await this.request('initialize', {
      clientInfo: { name: 'muse_bridge', title: 'Muse Bridge', version: bridgeVersion },
    });
    if (result.schema?.version !== 1) {
      this.close();
      throw new Error(`Unsupported Muse protocol version: ${result.schema?.version}. Update Muse Bridge.`);
    }
    this.notify('initialized', {});
    this.info = result;
    return result;
  }

  consume(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) {
      this.fail(new Error('Muse emitted an oversized protocol frame.'));
      this.close();
      return;
    }
    let end;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        this.fail(new Error('Muse emitted invalid protocol JSON.'));
        this.close();
        return;
      }
      if (message.method) {
        // MSP approvals and questions may arrive as both requests and view events.
        // Decisions use approval/decide or userInput/answer, never a guessed reply.
        if (message.id !== undefined && !['approval/request', 'userInput/request'].includes(message.method)) {
          this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported client method' } }) + '\n');
        }
        this.emit('event', message.method, message.params || {});
      } else if (this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          const error = new Error(message.error.message || 'Muse rejected the request.');
          error.code = message.error.code;
          error.kind = message.error.data?.kind;
          pending.reject(error);
        } else pending.resolve(message.result);
      }
    }
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error('Muse connection is closed.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Muse ${method} acknowledgement timed out. Its outcome is unknown; check the session before retrying.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params) {
    if (!this.closed) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.emit('disconnect', error);
  }

  close() {
    this.fail(new Error('Muse Bridge closed.'));
    if (this.child && this.child.exitCode === null) {
      this.child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
      }, 2000);
      timer.unref();
    }
  }
}
