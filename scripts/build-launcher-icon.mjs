// Package the source PNG into standard macOS icon resolutions. No generation
// or native compiler is required when installing the existing .icns asset.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(join(tmpdir(), 'muse-icon-'));
try {
  const iconset = join(root, 'chatgpt-muse.iconset'); await mkdir(iconset);
  await Promise.all([16, 32, 128, 256, 512].flatMap(size => [1, 2].map(async scale => {
    await exec('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), join(repo, 'assets/launcher/chatgpt-muse.png'),
      '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  })));
  await exec('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(repo, 'assets/launcher/chatgpt-muse.icns')]);
  console.log('Packaged assets/launcher/chatgpt-muse.icns');
} finally { await rm(root, { recursive: true, force: true }); }
