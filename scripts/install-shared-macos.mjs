import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile, realpath, rm, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { findMuse } from '../src/msp.mjs';

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unxml = value => value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const help = `Install ChatGPT + Muse.app alongside the unchanged ChatGPT application.
Usage: node scripts/install-shared-macos.mjs [--dock]
Run npm run build first. --dock adds both shortcuts without replacing other Dock entries.
The app must already be installed. MUSE_SHARED_APP_PATH and MUSE_BRIDGE_ROOT are optional.
This does not launch, quit, or modify ChatGPT. Reinstall after verifying an app update.
`;
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(help); }
  else {
    if (args.some(arg => arg !== '--dock')) throw new Error('Unknown argument. Use --help.');
    if (process.platform !== 'darwin') throw new Error('This installer requires macOS.');
    if (+process.versions.node.split('.')[0] < 22) throw new Error('Node.js 22+ is required.');
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const appPath = process.env.MUSE_SHARED_APP_PATH || '/Applications/ChatGPT.app';
    const bridgeRoot = process.env.MUSE_BRIDGE_ROOT || join(homedir(), '.local/share/muse-bridge');
    const installRoot = join(bridgeRoot, 'shared-launcher');
    const appName = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    const codexBin = join(appPath, 'Contents/Resources/codex');
    const nativeVersion = execFileSync(codexBin, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
    // These hooks are experimental. Do not silently enable an unverified app
    // version; run the native integration test before updating this allowlist.
    if (nativeVersion !== 'codex-cli 0.154.0-alpha.6.2') throw new Error('This native app version has not been verified with the shared gateway. Use the stock icon until compatibility is tested.');
    let nodeBin = process.env.MUSE_BRIDGE_NODE_BIN || process.execPath;
    if (!process.env.MUSE_BRIDGE_NODE_BIN) {
      for (const candidate of [join(bridgeRoot, 'runtime/bin/node'), '/opt/homebrew/bin/node', '/usr/local/bin/node']) {
        try { if (await realpath(candidate) === await realpath(process.execPath)) { nodeBin = candidate; break; } } catch {}
      }
    }
    const museBin = await realpath(findMuse());
    await mkdir(installRoot, { recursive: true, mode: 0o700 });
    // Versioned payloads keep an already running shortcut's files intact.
    const payload = join(installRoot, 'versions', randomUUID()); await mkdir(payload, { recursive: true, mode: 0o700 });
    for (const name of ['muse-shared.mjs', 'muse-launch.mjs', 'THIRD_PARTY_NOTICES.txt']) await copyFile(join(repo, 'dist', name), join(payload, name));
    const configPath = join(payload, 'launcher.json');
    const environment = {};
    // Persist only intentional location overrides, never keys or account data.
    for (const key of ['CODEX_HOME', 'MUSE_BRIDGE_CONNECTION_FILE']) if (process.env[key]) environment[key] = process.env[key];
    const config = { nodeBin, entrypoint: join(payload, 'muse-shared.mjs'), museBin, codexBin, nativeVersion,
      appBin: join(appPath, 'Contents/MacOS', appName), bridgeRoot, environment };
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    const shortcut = join(homedir(), 'Applications', 'ChatGPT + Muse.app');
    const stage = shortcut + '.staging-' + randomUUID();
    await mkdir(join(stage, 'Contents/MacOS'), { recursive: true, mode: 0o700 });
    await mkdir(join(stage, 'Contents/Resources'), { mode: 0o700 });
    await writeFile(join(stage, 'Contents/MacOS/muse-launch'), `#!/bin/bash\nexec ${shellQuote(nodeBin)} ${shellQuote(join(payload, 'muse-launch.mjs'))} ${shellQuote(configPath)} "$@"\n`, { mode: 0o700 });
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.muse-code-bridge.shared-launcher</string>
<key>CFBundleName</key><string>ChatGPT + Muse</string>
<key>CFBundleDisplayName</key><string>ChatGPT + Muse</string>
<key>CFBundleExecutable</key><string>muse-launch</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>chatgpt-muse.icns</string><key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>\n`;
    await writeFile(join(stage, 'Contents/Info.plist'), plist);
    // The ChatGPT icon has a Meta badge so the two launchers remain distinct.
    await copyFile(join(repo, 'assets/launcher/chatgpt-muse.icns'), join(stage, 'Contents/Resources/chatgpt-muse.icns'));
    await writeFile(join(stage, 'Contents/Resources/muse-bridge-owned.json'), JSON.stringify({ schema: 1, installRoot }));
    let exists = false;
    try {
      const owned = JSON.parse(await readFile(join(shortcut, 'Contents/Resources/muse-bridge-owned.json'), 'utf8'));
      if (owned.schema !== 1 || owned.installRoot !== installRoot) throw new Error('An unrelated app already uses the ChatGPT + Muse name. It was not replaced.'); exists = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error;
      try { await readFile(join(shortcut, 'Contents/Info.plist')); throw new Error('An unrelated app already uses the ChatGPT + Muse name. It was not replaced.'); } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
    }
    if (exists) { const backup = shortcut + '.previous-' + randomUUID(); await rename(shortcut, backup); await rename(stage, shortcut); await rm(backup, { recursive: true }); }
    else await rename(stage, shortcut);
    execFileSync('/usr/bin/plutil', ['-lint', join(shortcut, 'Contents/Info.plist')], { stdio: 'ignore' });
    execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', shortcut], { stdio: 'ignore' });
    // Notify IconServices as well, so an existing shortcut does not retain the
    // generic application's cached icon in Finder or application pickers.
    const iconScript = 'ObjC.import("AppKit"); function run(argv) { const icon = $.NSImage.alloc.initWithContentsOfFile(argv[0]); if (!$.NSWorkspace.sharedWorkspace.setIconForFileOptions(icon, argv[1], 0)) throw Error("Could not refresh the shortcut icon"); }';
    execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', iconScript, join(shortcut, 'Contents/Resources/chatgpt-muse.icns'), shortcut], { stdio: 'ignore' });
    if (args.includes('--dock')) {
      const exported = execFileSync('/usr/bin/defaults', ['export', 'com.apple.dock', '-'], { encoding: 'utf8' });
      // Dock bookmarks contain binary plist values, so converting its entire
      // preferences to JSON is invalid. Read only file URLs in persistent-apps.
      const apps = execFileSync('/usr/bin/plutil', ['-extract', 'persistent-apps', 'xml1', '-o', '-', '-'], { input: exported, encoding: 'utf8' });
      const paths = new Set([...apps.matchAll(/<key>_CFURLString<\/key>\s*<string>([\s\S]*?)<\/string>/g)].map(match => {
        try { return fileURLToPath(unxml(match[1])).replace(/\/$/, ''); } catch { return ''; }
      }));
      let changed = false;
      for (const [path, label] of [[appPath, 'ChatGPT'], [shortcut, 'ChatGPT + Muse']]) {
        if (paths.has(path)) continue;
        const tile = `<dict><key>tile-type</key><string>file-tile</string><key>tile-data</key><dict><key>file-label</key><string>${xml(label)}</string><key>file-data</key><dict><key>_CFURLString</key><string>${xml(pathToFileURL(path).href + '/')}</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>`;
        execFileSync('/usr/bin/defaults', ['write', 'com.apple.dock', 'persistent-apps', '-array-add', tile]); changed = true;
      }
      if (changed) execFileSync('/usr/bin/killall', ['Dock'], { stdio: 'ignore' });
    }
    console.log(`Installed ${shortcut}\nNative compatibility: ${nativeVersion}\nFully quit ChatGPT, then open ChatGPT + Muse. Open the original ChatGPT icon for the standard runtime.\nNo ChatGPT config, account, task, or installed application files were changed.`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
