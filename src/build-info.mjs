// Bundles bake these values into the running process. Reading the installed
// manifest at request time could incorrectly label an old process as updated.
export const bridgeVersion = typeof __MUSE_BRIDGE_VERSION__ === 'string' ? __MUSE_BRIDGE_VERSION__ : 'source';
export const bridgeBuild = typeof __MUSE_BRIDGE_BUILD__ === 'string' ? __MUSE_BRIDGE_BUILD__ : 'source';
