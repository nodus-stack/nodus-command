import { createSyncCommands } from '../sync.js';

const commands = createSyncCommands('plugin');

export const pluginListCommand = commands.list;
export const pluginInitCommand = commands.init;
export const pluginCloneCommand = commands.clone;
export const pluginPushCommand = commands.push;
export const pluginPullCommand = commands.pull;
export const pluginDevCommand = commands.dev;
