import { createSyncCommands } from '../sync.js';

const commands = createSyncCommands('mu-plugin');

export const muPluginListCommand = commands.list;
export const muPluginInitCommand = commands.init;
export const muPluginCloneCommand = commands.clone;
export const muPluginPushCommand = commands.push;
export const muPluginPullCommand = commands.pull;
export const muPluginDevCommand = commands.dev;
