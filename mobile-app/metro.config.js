// Use Expo's Metro config so Expo start works (avoids TerminalReporter / exports errors)
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const brandRoot = path.resolve(__dirname, '..', 'brand');
config.watchFolders = [...(config.watchFolders || []), brandRoot];

module.exports = config;
