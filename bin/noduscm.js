#!/usr/bin/env node

import { Command } from "commander";
import backupCommand from "../src/commands/backup.js";
import downCommand from "../src/commands/down.js";
import generateCommand from "../src/commands/generate.js";
import importDbCommand from "../src/commands/import-db.js";
import infoCommand from "../src/commands/info.js";
import initCommand from "../src/commands/init.js";
import pullCommand from "../src/commands/pull.js";
import rebootstrapCommand from "../src/commands/rebootstrap.js";
import removeCommand from "../src/commands/remove.js";
import shellCommand from "../src/commands/shell.js";
import upCommand from "../src/commands/up.js";
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

program.parse();
