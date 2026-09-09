import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
await mkdir('plugins/muse-bridge/scripts', { recursive: true });
const result = await build({
  entryPoints: ['src/server.mjs'],
  outfile: 'plugins/muse-bridge/scripts/server.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
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
await writeFile('plugins/muse-bridge/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
await copyFile('README.md', 'plugins/muse-bridge/README.md');
await copyFile('LICENSE', 'plugins/muse-bridge/LICENSE');
console.log('Built the self-contained Muse Bridge server.');
