import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
await mkdir('plugins/muse-codex-bridge/scripts', { recursive: true });
await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: { 'muse-server': 'src/server.mjs', 'configure-host': 'scripts/configure-host.mjs', 'configure-auth': 'scripts/configure-auth.mjs' },
  outdir: 'dist', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  mainFields: ['module', 'main'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'eof', metafile: true,
});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let dir = dirname(input);
  while (dir.includes('node_modules')) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg.name && pkg.version) { packages.add(dir); break; }
    } catch {}
    dir = dirname(dir);
  }
}
const notices = [];
for (const dir of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const files = (await readdir(dir)).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name));
  notices.push(`## ${pkg.name} ${pkg.version} (${pkg.license || 'see package'})`);
  for (const name of files) notices.push(await readFile(join(dir, name), 'utf8'));
}
await writeFile('plugins/muse-codex-bridge/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
await copyFile('dist/muse-server.mjs', 'plugins/muse-codex-bridge/scripts/server.mjs');
await copyFile('integrations/codex/README.md', 'plugins/muse-codex-bridge/README.md');
await copyFile('LICENSE', 'plugins/muse-codex-bridge/LICENSE');
console.log('Built the shared Muse server, host installer, and Codex plugin.');
