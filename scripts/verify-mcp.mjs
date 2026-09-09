import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const pluginDir = resolve(process.argv[2] || 'plugins/muse-bridge');
const client = new Client({ name: 'muse-bridge-verification', version: '0.1.0' });
const transport = new StdioClientTransport({ command: '/bin/sh', args: ['./scripts/launch.sh'], cwd: pluginDir, stderr: 'pipe' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  if (tools.tools.length !== 8) throw new Error('Unexpected tool inventory.');
  console.log('MCP tools:', tools.tools.map(t => t.name).join(', '));
  const result = await client.callTool({ name: 'muse_status', arguments: {} });
  if (result.isError) throw new Error(result.content[0].text);
  console.log('MCP → bundled bridge → official Muse handshake passed.');
  const sessionId = process.argv[3];
  if (sessionId) {
    const poll = await client.callTool({ name: 'muse_poll', arguments: { session_id: sessionId } });
    if (poll.isError) throw new Error(poll.content[0].text);
    const data = poll.structuredContent;
    if (data.status !== 'completed') throw new Error('Durable session did not resume in completed state.');
    console.log('Resumed live session:', data.status, data.items.filter(i => i.kind === 'agentMessage').map(i => i.text));
  }
} finally { await client.close(); }
