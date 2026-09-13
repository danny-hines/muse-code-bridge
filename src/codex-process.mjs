import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

// One stdio connection to the real Codex app server. No credentials are inspected.
export class CodexProcess extends EventEmitter {
  constructor(executable, args, { env = process.env, cwd, timeoutMs = 120000 } = {}) {
    super();
    this.pending = new Map(); this.nextId = 0; this.buffer = ''; this.closed = false;
    this.timeoutMs = timeoutMs;
    this.child = spawn(executable, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolve => {
      this.child.once('exit', () => { this.didExit = true; this.fail(); resolve(); });
      this.child.once('error', () => { this.didExit = true; this.fail(); resolve(); });
    });
    // Raw diagnostics can include prompts and account details. Do not relay them.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.fail());
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', data => this.consume(data));
  }
  consume(data) {
    this.buffer += data;
    if (this.buffer.length > 32 * 1024 * 1024) { this.fail(); this.child.kill('SIGTERM'); return; }
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.fail(); this.child.kill('SIGTERM'); return; }
      if (!message.method && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(Object.assign(new Error(message.error.message), { rpcError: message.error }));
        else pending.resolve(message.result);
      } else this.emit('message', message);
    }
  }
  send(message) {
    if (this.closed) throw new Error('Codex connection closed. Reopen the task before continuing.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params) {
    if (this.closed) return Promise.reject(new Error('Codex connection closed.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out. Its outcome is unknown; no retry was attempted.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  fail() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex worker exited. No provider fallback was attempted.')); }
    this.pending.clear(); this.emit('closed');
  }
  async stop() {
    if (this.didExit) return this.exited;
    // A normal EOF lets Codex flush the task before another worker resumes it.
    this.child.stdin.end();
    const kill = setTimeout(() => this.child.kill('SIGTERM'), 1500);
    const force = setTimeout(() => this.child.kill('SIGKILL'), 5000);
    await this.exited; clearTimeout(kill); clearTimeout(force);
  }
}
