import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);

// scripts/native.mjs
import { mkdir, readFile, writeFile, rename, lstat, unlink } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { dirname, join as join3, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";

// src/msp.mjs
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { accessSync, constants } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2, delimiter } from "node:path";

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
function readConnection(env = process.env) {
  return resolveConnection(readConfig(env));
}

// src/build-info.mjs
var bridgeVersion = true ? "0.1.0" : "source";

// src/msp.mjs
function findMuse(env = process.env) {
  const candidates = env.MUSE_BRIDGE_EXECUTABLE ? [env.MUSE_BRIDGE_EXECUTABLE] : [
    join2(homedir2(), ".local/bin/muse"),
    "/opt/homebrew/bin/muse",
    "/usr/local/bin/muse",
    ...(env.PATH || "").split(delimiter).filter(Boolean).map((p) => join2(p, "muse"))
  ];
  for (const file of candidates) {
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
    }
  }
  throw new Error("Muse CLI was not found. Install Muse Code from Meta, then sign in with muse login. Set MUSE_BRIDGE_EXECUTABLE if it is installed elsewhere.");
}
function museEnvironment(env = process.env, connection = { mode: "account" }) {
  const result = { ...env };
  delete result.META_API_KEY;
  if (connection.mode === "api-key") {
    if (!connection.apiKey) throw new Error("API mode has no credential. No account fallback was attempted.");
    result.META_API_KEY = connection.apiKey;
  } else if (connection.mode !== "account") throw new Error("Unknown authentication mode.");
  return result;
}
var MuseHost = class extends EventEmitter {
  constructor({ mode = "read-only", executable, env = process.env, connection, timeoutMs = 15e3 } = {}) {
    super();
    this.mode = mode;
    this.executable = executable;
    this.env = env;
    this.connection = connection || readConnection(env);
    this.timeoutMs = timeoutMs;
    this.pending = /* @__PURE__ */ new Map();
    this.nextId = 0;
    this.closed = false;
    this.buffer = "";
  }
  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.initialize();
    return this.startPromise;
  }
  async initialize() {
    const args = ["serve"];
    if (this.mode === "read-only") args.push("--disable-shell", "--disable-write");
    this.child = spawn(this.executable || findMuse(this.env), args, {
      env: museEnvironment(this.env, this.connection),
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stderr.on("data", () => {
    });
    this.child.stdin.on("error", () => this.fail(new Error("Muse input connection closed.")));
    this.child.on("error", (error) => this.fail(new Error(`Unable to start Muse: ${error.code || "process error"}`)));
    this.child.on("exit", (code, signal) => this.fail(new Error(`Muse exited (${signal || code}). Resume the session after reconnecting.`)));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    const result = await this.request("initialize", {
      clientInfo: { name: "muse_bridge", title: "Muse Bridge", version: bridgeVersion }
    });
    if (result.schema?.version !== 1) {
      this.close();
      throw new Error(`Unsupported Muse protocol version: ${result.schema?.version}. Update Muse Bridge.`);
    }
    this.notify("initialized", {});
    this.info = result;
    return result;
  }
  consume(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) {
      this.fail(new Error("Muse emitted an oversized protocol frame."));
      this.close();
      return;
    }
    let end2;
    while ((end2 = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end2);
      this.buffer = this.buffer.slice(end2 + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.fail(new Error("Muse emitted invalid protocol JSON."));
        this.close();
        return;
      }
      if (message.method) {
        if (message.id !== void 0 && !["approval/request", "userInput/request"].includes(message.method)) {
          this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported client method" } }) + "\n");
        }
        this.emit("event", message.method, message.params || {});
      } else if (this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          const error = new Error(message.error.message || "Muse rejected the request.");
          error.code = message.error.code;
          error.kind = message.error.data?.kind;
          pending.reject(error);
        } else pending.resolve(message.result);
      }
    }
  }
  request(method, params) {
    if (this.closed) return Promise.reject(new Error("Muse connection is closed."));
    const id = ++this.nextId;
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Muse ${method} acknowledgement timed out. Its outcome is unknown; check the session before retrying.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve2, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method, params) {
    if (!this.closed) this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit("disconnect", error);
  }
  close() {
    this.fail(new Error("Muse Bridge closed."));
    if (this.child && this.child.exitCode === null) {
      this.child.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
      }, 2e3);
      timer.unref();
    }
  }
};

// src/native-catalog.mjs
function makeCatalog(models) {
  return { models: models.map((model, priority) => ({
    slug: model,
    display_name: `${model.replace(/^muse-spark-/, "Muse Spark ").replace(/-contributor$/, " Contributor")} (experimental)`,
    description: "Muse Code through your configured bridge authentication. Experimental text and Codex tool adapter.",
    default_reasoning_level: "high",
    supported_reasoning_levels: ["low", "medium", "high", "xhigh"].map((effort) => ({ effort, description: `${effort} Muse reasoning` })),
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority,
    base_instructions: "You are Muse Code operating inside Codex. Use the tools provided by this host to complete the user request. Follow the supplied instructions, respect tool approvals, and verify work before reporting completion.",
    supports_reasoning_summaries: false,
    support_verbosity: false,
    apply_patch_tool_type: "freeform",
    truncation_policy: { mode: "bytes", limit: 1e4 },
    // A conservative adapter operating limit, not a claim about Meta's model capacity.
    context_window: 64e3,
    effective_context_window_percent: 90,
    input_modalities: ["text"],
    supports_search_tool: false,
    experimental_supported_tools: [],
    include_skills_usage_instructions: true,
    include_plugin_usage_instructions: true,
    include_apps_usage_instructions: true
  })) };
}

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    if (typeof date === "string") {
      let match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        hasTime && date[10] === " " && (date = date.replace(" ", "T"));
        if (match[2] && +match[2] > 23) {
          date = "";
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset && hasTime)
            date += "Z";
        }
      } else {
        date = "";
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
};

// node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
};

// node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0) {
  let idx = str.indexOf("\n", start);
  if (str.charCodeAt(idx - 1) === 13)
    idx--;
  return idx;
}
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in comments", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (1) {
    while ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}
function skipUntil(ctx, sep, end2) {
  let ptr = ctx.p;
  if (!end2) {
    ptr = indexOfNewline(ctx.s, ptr);
    ctx.p = ptr < 0 ? ctx.s.length : ptr;
    return;
  }
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 35) {
      skipComment(ctx);
    } else if (c === end2 || c === sep) {
      return;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: ctx.s,
    ptr
  });
}

// node_modules/smol-toml/dist/primitive.js
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
function parseString(ctx) {
  let start = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in strings", {
        toml: ctx.s,
        ptr: ctx.p
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state)
        parsed += ctx.s.slice(sliceStart, ctx.p);
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p + 1);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: ctx.s, ptr: ctx.p + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: ctx.s, ptr: ctx.p });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p + 1;
        state = 0;
      } else if (c === 32 || c === 9) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: ctx.s, ptr: ctx.p });
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: ctx.s,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  throw new TomlError("unfinished string", { toml: ctx.s, ptr: start });
}
function sliceAndTrimEndOf(ctx, start, end2) {
  let value = ctx.s.slice(start, end2);
  let commentIdx = value.indexOf("#");
  if (commentIdx > 0) {
    skipComment({ s: value, p: commentIdx, d: 0 });
    value = value.slice(0, commentIdx);
  }
  return value.trimEnd();
}
function parseValue(ctx, integersAsBigInt, end2) {
  let ptr = ctx.p;
  let err = { toml: ctx.s, ptr };
  skipUntil(ctx, 44, end2);
  let value = sliceAndTrimEndOf(ctx, ptr, ctx.p);
  if (!value)
    throw new TomlError("incomplete declaration: value expected", err);
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", err);
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", err);
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", err);
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid())
    throw new TomlError("invalid value", err);
  return date;
}

// node_modules/smol-toml/dist/extract.js
function extractValue(ctx, end2, integersAsBigInt) {
  let ptr = ctx.p;
  let c = ctx.s.charCodeAt(ptr);
  if (c === 91 || c === 123) {
    if (!ctx.d--) {
      throw new TomlError("document contains excessively nested structures. aborting.", {
        toml: ctx.s,
        ptr
      });
    }
    let value = c === 91 ? parseArray(ctx, integersAsBigInt) : parseInlineTable(ctx, integersAsBigInt);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return false;
  }
  return parseValue(ctx, integersAsBigInt, end2);
}

// node_modules/smol-toml/dist/struct.js
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(ctx, end2 = "=") {
  let start = ctx.p;
  let dot = start - 1;
  let parsed = [];
  let endPtr = ctx.s.indexOf(end2, start);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: ctx.s,
      ptr: start
    });
  }
  do {
    let c = ctx.s.charCodeAt(ctx.p = ++dot);
    if (c !== 32 && c !== 9) {
      if (c === 34 || c === 39) {
        if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2)) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        let part = parseString(ctx);
        dot = ctx.s.indexOf(".", ctx.p);
        let strEnd = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: ctx.s,
            ptr: newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        if (endPtr < ctx.p) {
          endPtr = ctx.s.indexOf(end2, ctx.p);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: ctx.s,
              ptr: start
            });
          }
        }
        parsed.push(part);
      } else {
        dot = ctx.s.indexOf(".", ctx.p);
        let part = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  ctx.p = endPtr + 1;
  skipVoid(ctx, true, true);
  return parsed;
}
function parseInlineTable(ctx, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let p = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = {};
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: ctx.s,
          ptr: p
        });
      }
      if (!hasOwn && k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      throw new TomlError("trying to redefine an already defined value", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
    let value = extractValue(ctx, 125, integersAsBigInt);
    seen.add(t[k] = value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished table encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}
function parseArray(ctx, integersAsBigInt) {
  let res = [];
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(ctx, 93, integersAsBigInt));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished array encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}

// node_modules/smol-toml/dist/parse.js
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
  let ctx = { s: toml, p: 0, d: maxDepth };
  let res = {};
  let meta = {};
  let tmp;
  let tbl = res;
  let m = meta;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      let k = parseKey(ctx, "]");
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p - 1) !== 93) {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: ctx.p - 1
          });
        }
        ctx.p++;
      }
      let p = peekTable(
        k,
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      m = p[2];
      tbl = p[1];
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      p[1][p[0]] = extractValue(ctx, void 0, integersAsBigInt);
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && tmp !== 13) {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr: ctx.p
      });
    }
    skipVoid(ctx);
  }
  return res;
}

// src/native-config.mjs
var keys = ["model", "model_provider", "model_catalog_json", "model_reasoning_effort", "web_search"];
var selectedLine = new RegExp(`^\\s*(${keys.join("|")})\\s*=`);
var begin = "# BEGIN MUSE NATIVE PROVIDER (managed)";
var end = "# END MUSE NATIVE PROVIDER (managed)";
var providerId = "muse_bridge";
function enableConfig(text, { model, catalogPath, port, token }) {
  let parsed;
  try {
    parsed = parse(text);
  } catch {
    throw new Error("Codex configuration is not valid TOML; no settings changed.");
  }
  if (text.includes(begin) || parsed.model_providers?.[providerId]) throw new Error("Muse native configuration already exists or conflicts with a provider entry.");
  const lines = text.split("\n");
  const removed = [];
  let inRoot = true;
  const kept = lines.filter((line, index) => {
    if (/^\s*\[/.test(line)) inRoot = false;
    if (!inRoot) return true;
    const match = line.match(selectedLine);
    if (!match) return true;
    try {
      const value = parse(line)[match[1]];
      if (typeof value !== "string") throw new Error();
    } catch {
      throw new Error("Selected-model configuration uses multiline or complex TOML. Simplify those settings before enabling Muse.");
    }
    removed.push({ index, line });
    return false;
  });
  for (const key of keys) if (parsed[key] !== void 0 && !removed.some((x) => new RegExp(`^\\s*${key}\\s*=`).test(x.line))) throw new Error(`Cannot safely replace the existing ${key} setting.`);
  const header = `${begin}
model = ${JSON.stringify(model)}
model_provider = ${JSON.stringify(providerId)}
model_catalog_json = ${JSON.stringify(catalogPath)}
model_reasoning_effort = "high"
web_search = "disabled"
${end}
`;
  const provider = `
${begin}
[model_providers.${providerId}]
name = "Muse Code Bridge (experimental)"
base_url = "http://127.0.0.1:${port}/v1"
experimental_bearer_token = ${JSON.stringify(token)}
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 180000
${end}
`;
  const next = header + kept.join("\n") + provider;
  const actual = parse(next);
  if (actual.model !== model || actual.model_provider !== providerId) throw new Error("Could not validate Muse provider configuration.");
  return { text: next, restore: { header, provider, removed, original: text } };
}
function disableConfig(text, restore) {
  if (!text.startsWith(restore.header) || !text.endsWith(restore.provider)) throw new Error("Managed Muse settings changed. Restore them from the backup manually; no config was overwritten.");
  const rest = text.slice(restore.header.length, -restore.provider.length);
  const lines = rest.split("\n");
  for (const { index, line } of restore.removed) lines.splice(index, 0, line);
  const reconstructed = lines.join("\n");
  const next = reconstructed === restore.original ? reconstructed : restore.removed.map((x) => x.line).join("\n") + "\n" + rest;
  parse(next);
  return next;
}

// scripts/native.mjs
var help = `Experimental Muse provider for Codex

node dist/muse-native.mjs install [--model ID] [--port 47831]
node dist/muse-native.mjs enable --replace-provider
node dist/muse-native.mjs disable
node dist/muse-native.mjs status

Install prepares the catalog and starts a localhost service on macOS.
Enable REPLACES the active provider and hides the normal model options.
Additive model selection is not implemented; desktop routing is not fully verified.
Disable restores the previous selection.
Restart the desktop app after enable/disable. Existing MCP skills remain installed.
On other systems, run the printed server command in a terminal or service manager.
`;
var xml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
async function exists(file) {
  try {
    return await lstat(file);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("Cannot read native provider settings or recovery data. No credentials were displayed.");
  }
}
async function atomic(file, text) {
  const stat = await exists(file);
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("Refusing to replace a symlink or non-file.");
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { mode: 384, flag: "wx" });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {
    });
  }
}
function installationSettings(previous, values, discovered, enabled) {
  const port = Number(values.port ?? previous?.port ?? 47831);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port.");
  const models = values.model ? [values.model] : previous?.models ?? discovered;
  if (!Array.isArray(models) || !models.length || models.some((m) => !discovered.includes(m))) throw new Error("A selected model is unavailable in the official Muse catalog. Disable the provider before selecting a different model with --model.");
  if (enabled && (!previous || previous.port !== port || JSON.stringify(previous.models) !== JSON.stringify(models))) throw new Error("Disable the current provider before changing its port or models.");
  return { port, models };
}
async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { model: { type: "string" }, port: { type: "string" }, help: { type: "boolean" }, root: { type: "string" }, "codex-config": { type: "string" }, "replace-provider": { type: "boolean" } } });
  const action = positionals[0];
  if (values.help || !action) {
    console.log(help);
    return;
  }
  if (action === "enable" && !values["replace-provider"]) throw new Error("Native activation REPLACES the active provider and hides the normal model options. Adding Muse alongside them is not implemented. Only use enable --replace-provider if you explicitly want replacement mode; desktop routing remains unverified. No settings changed.");
  const root = resolve(values.root || join3(process.env.MUSE_BRIDGE_ROOT || join3(homedir3(), ".local/share/muse-bridge"), "native"));
  const configPath = resolve(values["codex-config"] || join3(process.env.CODEX_HOME || join3(homedir3(), ".codex"), "config.toml"));
  const privateFile = join3(root, "provider.json"), catalogPath = join3(root, "models.json"), stateFile = join3(root, "codex-restore.json");
  if (action === "install") {
    const previous = await exists(privateFile) ? await readJson(privateFile) : null;
    const host = new MuseHost();
    let catalog;
    try {
      await host.start();
      catalog = await host.request("model/list", {});
    } finally {
      host.close();
    }
    const discovered = [...catalog.models].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((m) => m.modelId);
    const { port, models } = installationSettings(previous, values, discovered, Boolean(await exists(stateFile)));
    await mkdir(root, { recursive: true, mode: 448 });
    const config2 = { port, token: previous?.token || randomBytes(32).toString("hex"), models };
    await atomic(privateFile, JSON.stringify(config2) + "\n");
    await atomic(catalogPath, JSON.stringify(makeCatalog(models), null, 2) + "\n");
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const source = join3(sourceDir, "muse-native-server.mjs");
    await atomic(join3(root, "server.mjs"), await readFile(source, "utf8"));
    if (process.platform === "darwin") {
      const label = "com.muse-code-bridge.native";
      const plist = join3(homedir3(), "Library/LaunchAgents", `${label}.plist`);
      await mkdir(dirname(plist), { recursive: true });
      const args = [process.execPath, join3(root, "server.mjs"), "--config", privateFile];
      const env = { ...process.env, MUSE_BRIDGE_EXECUTABLE: findMuse() };
      const environment = ["MUSE_BRIDGE_EXECUTABLE", "MUSE_BRIDGE_CONNECTION_FILE", "MUSE_BRIDGE_ROOT", "XDG_CONFIG_HOME", "XDG_DATA_HOME"].filter((k) => env[k]);
      await atomic(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict>${environment.map((k) => `<key>${k}</key><string>${xml(env[k])}</string>`).join("")}</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardErrorPath</key><string>${xml(join3(root, "service.log"))}</string><key>StandardOutPath</key><string>${xml(join3(root, "service.log"))}</string></dict></plist>`);
      const domain = `gui/${process.getuid()}`;
      try {
        execFileSync("launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" });
      } catch {
      }
      let started = false;
      for (let attempt = 0; attempt < 20 && !started; attempt++) {
        try {
          execFileSync("launchctl", ["bootstrap", domain, plist], { stdio: "pipe" });
          started = true;
        } catch {
          await new Promise((resolve2) => setTimeout(resolve2, 150));
        }
      }
      if (!started) throw new Error("Could not start the Muse LaunchAgent. Its files are prepared; rerun install after the previous service exits.");
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt++) {
        try {
          const result = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${config2.token}` }, signal: AbortSignal.timeout(500) });
          ready = result.ok && (await result.json()).ready === true;
        } catch {
        }
        if (!ready) await new Promise((resolve2) => setTimeout(resolve2, 150));
      }
      if (!ready) throw new Error("The LaunchAgent started but its local health check failed. Codex settings have not been enabled.");
      console.log("Installed the experimental Muse provider and its macOS login service.");
    } else console.log(`Start the provider with: node ${JSON.stringify(join3(root, "server.mjs"))} --config ${JSON.stringify(privateFile)}`);
    console.log("Models: " + models.join(", "));
    console.log("Current Codex model settings were preserved. Additive model selection is not implemented.");
    console.log("Explicit replacement only: node dist/muse-native.mjs enable --replace-provider (hides normal model options).");
    return;
  }
  const config = await readJson(privateFile);
  if (action === "status") {
    const result = await fetch(`http://127.0.0.1:${config.port}/health`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(3e3) });
    const health = result.ok ? await result.json() : null;
    if (health?.ready !== true) throw new Error("The local provider did not pass its health check.");
    console.log(JSON.stringify(health, null, 2));
    return;
  }
  if (!["enable", "disable"].includes(action)) throw new Error("Unknown native command. Use --help.");
  await mkdir(dirname(configPath), { recursive: true });
  const lock = `${configPath}.muse-native.lock`;
  const handle = await import("node:fs/promises").then((fs) => fs.open(lock, "wx", 384));
  try {
    const text = await exists(configPath) ? await readFile(configPath, "utf8") : "";
    if (action === "enable") {
      const health = await fetch(`http://127.0.0.1:${config.port}/health`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(3e3) });
      if (!health.ok || (await health.json()).ready !== true) throw new Error("Start the local Muse provider before enabling it.");
      if (await exists(stateFile)) {
        const restore = await readJson(stateFile);
        if (restore.configPath !== configPath) throw new Error("The restore record belongs to a different Codex configuration.");
        const original = disableConfig(text, restore);
        const expected = enableConfig(original, { model: config.models[0], catalogPath, ...config });
        if (expected.restore.header !== restore.header || expected.restore.provider !== restore.provider) throw new Error("Native service settings changed. Disable before enabling the new configuration.");
        console.log("Muse native mode is already enabled. Existing settings and the original recovery copy were preserved.");
        return;
      }
      const next = enableConfig(text, { model: config.models[0], catalogPath, ...config });
      await atomic(stateFile, JSON.stringify({ configPath, ...next.restore }) + "\n");
      await atomic(configPath, next.text);
    } else {
      const restore = await readJson(stateFile);
      if (restore.configPath !== configPath) throw new Error("The restore record belongs to a different Codex configuration.");
      await atomic(configPath, disableConfig(text, restore));
      await unlink(stateFile);
    }
    console.log(`${action === "enable" ? "Enabled Muse for new Codex tasks" : "Restored the previous Codex model/provider selection"}. Fully quit and reopen the desktop app.`);
  } finally {
    await handle.close();
    await unlink(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
export {
  installationSettings,
  main
};
/*! Bundled license information:

smol-toml/dist/date.js:
smol-toml/dist/error.js:
smol-toml/dist/util.js:
smol-toml/dist/primitive.js:
smol-toml/dist/extract.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
