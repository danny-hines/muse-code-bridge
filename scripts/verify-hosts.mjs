// Exercise the exact generated Hermes/OpenCode launch commands with an MCP client.
// No host app or model turn is started; this verifies wiring, not the desktop UI.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { configure, serverName } from './configure-host.mjs';
import { configureSkills } from './configure-skills.mjs';
import { parse as yaml } from 'yaml';
import { parse as jsonc } from 'jsonc-parser';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dir = await mkdtemp(join(tmpdir(), 'muse-host-verification-'));
const repo = resolve(import.meta.dirname, '..');
try {
  for (const [host, version] of [['hermes', '1'], ['opencode', '1'], ['opencode', '2']]) {
    const file = join(dir, host + version + (host === 'hermes' ? '.yaml' : '.jsonc'));
    const result = await configure({ host, repo, node: process.execPath,
      muse: process.env.MUSE_BRIDGE_EXECUTABLE || join(homedir(), '.local/bin/muse'),
      opencodeVersion: version,
      env: { ...process.env, MUSE_BRIDGE_HERMES_CONFIG: file, MUSE_BRIDGE_OPENCODE_CONFIG: file },
    });
    const skillRoot = join(dir, host + version + '-skills');
    await configureSkills({ host, repo, env: { MUSE_BRIDGE_HERMES_SKILLS_DIR: skillRoot, MUSE_BRIDGE_OPENCODE_SKILLS_DIR: skillRoot } });
    for (const name of ['muse', 'muse-implement', 'muse-review']) {
      const skill = await readFile(join(skillRoot, name, 'SKILL.md'), 'utf8');
      if (!skill.startsWith('---\nname: ' + name + '\n')) throw new Error('Installed skill is missing its discovery metadata.');
    }
    const contents = await readFile(result.file, 'utf8');
    const data = host === 'hermes' ? yaml(contents) : jsonc(contents);
    const entry = host === 'hermes' ? data.mcp_servers[serverName] : (version === '2' ? data.mcp.servers : data.mcp)[serverName];
    const [command, ...args] = host === 'hermes' ? [entry.command, ...entry.args] : entry.command;
    const client = new Client({ name: 'muse-host-verification', version: '0.1.0' });
    try {
      await client.connect(new StdioClientTransport({ command, args, env: { ...process.env, ...(entry.env || entry.environment) }, stderr: 'pipe' }));
      const tools = await client.listTools();
      if (tools.tools.length !== 8) throw new Error('Unexpected tool inventory.');
      if (!client.getInstructions()?.includes('muse_poll')) throw new Error('Missing host collaboration instructions.');
      const status = await client.callTool({ name: 'muse_status', arguments: {} });
      if (status.isError || !status.structuredContent?.ready) throw new Error('Muse handshake failed.');
      console.log(`${host} ${version}: generated config → MCP → official Muse handshake passed.`);
    } finally { await client.close(); }
  }
} finally { await rm(dir, { recursive: true, force: true }); }
