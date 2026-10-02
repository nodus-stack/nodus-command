#!/usr/bin/env node

import { Command } from "commander";
import backupCommand from "../src/commands/backup.js";
import downCommand from "../src/commands/down.js";
import generateCommand from "../src/commands/generate.js";
import importDbCommand from "../src/commands/import-db.js";
import infoCommand from "../src/commands/info.js";
import { loginCommand, logoutCommand, whoamiCommand } from "../src/commands/login.js";
import initCommand from "../src/commands/init.js";
import pullCommand from "../src/commands/pull.js";
import rebootstrapCommand from "../src/commands/rebootstrap.js";
import removeCommand from "../src/commands/remove.js";
import shellCommand from "../src/commands/shell.js";
import upCommand from "../src/commands/up.js";
import {
  themeCloneCommand,
  themeDevCommand,
  themeInitCommand,
  themeListCommand,
  themePullCommand,
  themePushCommand,
} from "../src/commands/theme/index.js";
import {
  pluginCloneCommand,
  pluginDevCommand,
  pluginInitCommand,
  pluginListCommand,
  pluginPullCommand,
  pluginPushCommand,
} from "../src/commands/plugin/index.js";
import { showBanner, renderLogo } from "../src/ui/banner.js";

const program = new Command();

program
  .name("noduscm")
  .description("Modern WordPress local development environment")
  .version("1.3.1")
  .addHelpText("beforeAll", () => "\n" + renderLogo() + "\n")
  .hook("preAction", (thisCommand) => {
    if (thisCommand.args.length === 0) {
      showBanner();
    }
  });

program
  .command("init")
  .description("Initialize a new WordPress project")
  .option(
    "--mount <entry>",
    "Add custom bind mount entry (repeatable)",
    (value, previous = []) => {
      return [...previous, value];
    },
    [],
  )
  .action(initCommand);

program
  .command("up")
  .description("Start the WordPress project")
  .action(upCommand);

program
  .command("down")
  .description("Stop the WordPress project")
  .action(downCommand);

program
  .command("remove")
  .description("Remove the WordPress project completely")
  .action(removeCommand);

program
  .command("pull")
  .description("Sync files and database from remote server")
  .option("--db-only", "Only sync database")
  .option("--files-only", "Only sync files (no database)")
  .option("--uploads-only", "Only sync wp-content/uploads folder")
  .option(
    "--specified-path <path>",
    "Only sync specific remote file/folder path(s); repeatable",
    (value, previous = []) => {
      return [...previous, value];
    },
    [],
  )
  .option(
    "--files-container-only",
    "Only sync project files from a remote container (Coolify mode)",
  )
  .option(
    "--db-container-only",
    "Only sync database by dumping from a remote container (Coolify mode)",
  )
  .option(
    "--uploads-container-only",
    "Only sync wp-content/uploads from a remote container (Coolify mode)",
  )
  .option(
    "--container-id <id>",
    "Remote container ID/name used with container pull modes",
  )
  .option(
    "--exclude <path>",
    "Exclude a path/pattern from file sync (repeatable)",
    (value, previous = []) => {
      return [...previous, value];
    },
    [],
  )
  .action(pullCommand);

program
  .command("backup")
  .description("Backup local database")
  .action(backupCommand);

program
  .command("generate")
  .description("Generate Docker files from .noduscm.json")
  .action(generateCommand);

program
  .command("rebootstrap")
  .description(
    "Restore wordpress/ and wp-content/ from config (SSH or download)",
  )
  .option("--force", "Rebuild even if folders already exist")
  .action(rebootstrapCommand);

program
  .command("import-db <file>")
  .description(
    "Import a local .sql file directly into the local MySQL container",
  )
  .option(
    "--force",
    "Drop and recreate the local database before importing (overwrites existing tables), then search-replace the dump's site URL back to the local one",
  )
  .action(importDbCommand);

program
  .command("info")
  .description("Show project information (URLs, database, SSH)")
  .action(infoCommand);

program
  .command("shell")
  .description("Open a shell in the Apache container as webuser")
  .option("--root", "Connect as root instead of webuser")
  .action(shellCommand);

// --- Nodus Jet: sync de temas por HTTPS (sin SSH) ---------------------------

program
  .command("login")
  .description("Pair with a WordPress site running Nodus Jet")
  .requiredOption("--site <url>", "Site URL, e.g. https://example.com")
  .option("--code <code>", "One-time pairing code (prompted if omitted)")
  .option("--label <label>", "Name for this session (default: hostname)")
  .action(loginCommand);

program
  .command("logout")
  .description("Revoke the session and remove the local token")
  .option("--site <url>", "Site URL (optional if only one is logged in)")
  .action(logoutCommand);

program
  .command("whoami")
  .description("Show the current session for a site")
  .option("--site <url>", "Site URL (optional if only one is logged in)")
  .action(whoamiCommand);

const syncGroups = [
  {
    kind: "theme",
    group: "WordPress themes",
    actions: {
      list: themeListCommand,
      init: themeInitCommand,
      clone: themeCloneCommand,
      push: themePushCommand,
      pull: themePullCommand,
      dev: themeDevCommand,
    },
  },
  {
    kind: "plugin",
    group: "WordPress plugins",
    actions: {
      list: pluginListCommand,
      init: pluginInitCommand,
      clone: pluginCloneCommand,
      push: pluginPushCommand,
      pull: pluginPullCommand,
      dev: pluginDevCommand,
    },
  },
];

for (const { kind, group, actions } of syncGroups) {
  const cmd = program
    .command(kind)
    .description(`Sync ${group} with a Nodus Jet site (no SSH)${kind === "plugin" ? ". Never activates plugins" : ""}`);

  cmd
    .command("list")
    .description(`List ${kind}s on the site`)
    .option("--site <url>", "Site URL")
    .action(actions.list);

  cmd
    .command("init")
    .description(`Create a new ${kind} on the site and a local folder for it`)
    .requiredOption("--name <name>", `${kind[0].toUpperCase()}${kind.slice(1)} name (slugified for the folder)`)
    .option("--site <url>", "Site URL")
    .option("--dir <path>", "Local folder (default: ./<slug>)")
    .action(actions.init);

  cmd
    .command("clone <slug>")
    .description(`Download an existing CLI ${kind} into a local folder`)
    .option("--site <url>", "Site URL")
    .option("--dir <path>", "Local folder (default: ./<slug>)")
    .action(actions.clone);

  cmd
    .command("push")
    .description("Upload local changes to the site")
    .option("--dir <path>", `${kind[0].toUpperCase()}${kind.slice(1)} folder (default: current directory)`)
    .option("--delete", "Also delete files that only exist on the server")
    .option("--dry-run", "Show what would change without sending anything")
    .option("--force", "Overwrite even if the server changed since the last sync")
    .action(actions.push);

  cmd
    .command("pull")
    .description("Download server changes")
    .option("--dir <path>", `${kind[0].toUpperCase()}${kind.slice(1)} folder (default: current directory)`)
    .option("--delete", "Also delete local files that no longer exist on the server")
    .option("--dry-run", "Show what would change without writing anything")
    .option("--force", "Overwrite local changes")
    .action(actions.pull);

  cmd
    .command("dev")
    .description("Watch the folder and push every change")
    .option("--dir <path>", `${kind[0].toUpperCase()}${kind.slice(1)} folder (default: current directory)`)
    .option("--delete", "Propagate local deletions to the server")
    .option("--force", "Overwrite even if the server changed since the last sync")
    .action(actions.dev);
}

program.parse();
