const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

// Metro does not follow symlinks or look outside the app directory by default,
// so a monorepo needs both of these or `@ece/core` fails to resolve at bundle
// time with a message that does not mention workspaces at all.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
