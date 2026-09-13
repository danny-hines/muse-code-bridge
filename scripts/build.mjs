import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, readdir, cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const inputs = ['package.json', 'package-lock.json', 'scripts/build.mjs',
  ...(await readdir('src')).filter(name => name.endsWith('.mjs')).map(name => join('src', name))].sort();
const fingerprint = createHash('sha256');
for (const path of inputs) fingerprint.update(path).update('\0').update(await readFile(path)).update('\0');
const bridgeBuild = fingerprint.digest('hex').slice(0, 16);

await mkdir('plugins/muse-codex-bridge/scripts', { recursive: true });
await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: { 'muse-server': 'src/server.mjs', 'muse-native-server': 'scripts/native-server.mjs', 'muse-native': 'scripts/native.mjs', 'muse-additive': 'scripts/additive.mjs', 'configure-host': 'scripts/configure-host.mjs', 'configure-auth': 'scripts/configure-auth.mjs', 'configure-skills': 'scripts/configure-skills.mjs' },
  outdir: 'dist', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  mainFields: ['module', 'main'],
  define: { __MUSE_BRIDGE_VERSION__: JSON.stringify(pkg.version), __MUSE_BRIDGE_BUILD__: JSON.stringify(bridgeBuild) },
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
for (const destination of ['dist/skills', 'plugins/muse-codex-bridge/skills']) {
  await rm(destination, { recursive: true, force: true });
  await cp('skills', destination, { recursive: true });
}
console.log(`Built the shared Muse server, host installer, and Codex plugin (${pkg.version}, build ${bridgeBuild}).`);
