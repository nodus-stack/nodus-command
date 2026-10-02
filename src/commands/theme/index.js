import { createSyncCommands } from '../sync.js';

const commands = createSyncCommands('theme');

export const themeListCommand = commands.list;
export const themeInitCommand = commands.init;
export const themeCloneCommand = commands.clone;
export const themePushCommand = commands.push;
export const themePullCommand = commands.pull;
export const themeDevCommand = commands.dev;
