// Desktop puts -c overrides before app-server in some builds. Preserve all flags.
export function appServerIndex(args) {
  const valued = new Set(['-c', '--config', '-p', '--profile', '-C', '--cd', '--enable', '--disable']);
  for (let i = 0; i < args.length; i++) {
    if (valued.has(args[i])) { i++; continue; }
    if (args[i].startsWith('-')) continue;
    return args[i] === 'app-server' ? i : -1;
  }
  return -1;
}
export function shouldWrap(args) {
  const index = appServerIndex(args);
  return index >= 0 && !['daemon', 'generate-json-schema', 'generate-ts', '--help', '-h'].includes(args[index + 1]);
}
export function assertStdio(args) {
  if (!shouldWrap(args)) throw new Error('The additive prototype requires app-server over stdio.');
  for (let i = 0; i < args.length; i++) {
    const value = args[i] === '--listen' ? args[++i] : args[i].startsWith('--listen=') ? args[i].slice(9) : null;
    if (value != null && value !== 'stdio://') throw new Error('The additive prototype supports only stdio transport.');
  }
}
