import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);

// scripts/configure-auth.mjs
import { mkdir, writeFile, readFile, rename, unlink, lstat, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// src/auth.mjs
import { openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
function connectionPath(env = process.env) {
  const path = env.MUSE_BRIDGE_CONNECTION_FILE || join(env.MUSE_BRIDGE_ROOT || join(homedir(), ".local/share/muse-bridge"), "connection.json");
  if (!isAbsolute(path)) throw new Error("The bridge connection file must have an absolute path.");
  return path;
}
function validateConfig(config) {
  if (!config || config.version !== 1 || !["account", "api-key"].includes(config.mode) || Object.keys(config).some((key) => !["version", "mode", "api_key_file"].includes(key))) {
    throw new Error("Invalid bridge connection settings. Expected version 1 and account or api-key mode.");
  }
  if (config.mode === "api-key" && (typeof config.api_key_file !== "string" || !isAbsolute(config.api_key_file))) {
    throw new Error("API mode requires --api-key-file with an absolute path to a private key file.");
  }
  if (config.mode === "account" && config.api_key_file !== void 0) throw new Error("Account mode cannot specify an API key file.");
  return config;
}
function readConfig(env = process.env) {
  let text;
  try {
    text = readFileSync(connectionPath(env), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, mode: "account" };
    throw new Error("Cannot read bridge connection settings.");
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON in bridge connection settings.");
  }
  return validateConfig(config);
}
function resolveConnection(config) {
  validateConfig(config);
  const connection = { mode: config.mode };
  if (config.mode === "api-key") {
    let fd;
    let key;
    try {
      fd = openSync(config.api_key_file, "r");
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > 65536 || info.mode & 63 || process.getuid && info.uid !== process.getuid()) {
        throw new Error("unsafe");
      }
      key = readFileSync(fd, "utf8").trim();
      if (!key || /\s/.test(key)) throw new Error("invalid");
    } catch {
      throw new Error("Cannot use the API key file. It must be a readable file owned by you, private (chmod 600), and contain only the key. No account fallback was attempted.");
    } finally {
      if (fd !== void 0) closeSync(fd);
    }
    Object.defineProperty(connection, "apiKey", { value: key, enumerable: false });
  }
  return Object.freeze(connection);
}

// scripts/configure-auth.mjs
async function main() {
  let mode, keyFile, check = false, login = false, printMode = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--check") check = true;
    else if (arg === "--print-mode") printMode = true;
    else if (arg === "--login") login = true;
    else if (arg === "--auth" || arg === "--api-key-file") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      if (arg === "--auth") mode = value;
      else keyFile = resolve(value);
    } else throw new Error("Unknown authentication option.");
  }
  if (keyFile && mode !== "api-key") throw new Error("--api-key-file requires --auth api-key.");
  const file = connectionPath();
  const existing = readConfig();
  const config = mode ? validateConfig({ version: 1, mode, ...keyFile ? { api_key_file: keyFile } : {} }) : existing;
  if (login && config.mode === "api-key") throw new Error("--login cannot be used in API mode. Use --auth account to switch back.");
  resolveConnection(config);
  if (printMode) {
    console.log(config.mode);
    return;
  }
  console.log(`Muse authentication: ${config.mode === "account" ? "Muse-managed account credentials" : "explicit pay-as-you-go API key"}.`);
  if (check || !mode || JSON.stringify(config) === JSON.stringify(existing)) return;
  await mkdir(dirname(file), { recursive: true, mode: 448 });
  const lockPath = file + ".lock";
  let lock;
  try {
    lock = await open(lockPath, "wx", 384);
  } catch {
    throw new Error("Connection settings are locked by another setup.");
  }
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    let previous;
    try {
      const info = await lstat(file);
      if (!info.isFile()) throw new Error("Connection settings must be a regular file.");
      previous = await readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (JSON.stringify(readConfig()) !== JSON.stringify(existing)) throw new Error("Connection settings changed during setup. Rerun the command.");
    if (previous !== void 0) await writeFile(file + ".backup." + randomUUID(), previous, { flag: "wx", mode: 384 });
    await writeFile(temp, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 384 });
    await rename(temp, file);
    console.log("Saved the authentication choice. Restart every host using this bridge for it to take effect.");
  } finally {
    await unlink(temp).catch(() => {
    });
    await lock.close();
    await unlink(lockPath);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
