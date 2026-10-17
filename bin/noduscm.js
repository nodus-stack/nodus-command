#!/usr/bin/env node

import { readFileSync } from "fs";
import { Command } from "commander";
import backupCommand from "../src/commands/backup.js";
import connectCommand from "../src/commands/connect.js";
import downCommand from "../src/commands/down.js";
import generateCommand from "../src/commands/generate.js";
import importDbCommand from "../src/commands/import-db.js";
import infoCommand from "../src/commands/info.js";
import mcpCommand from "../src/commands/mcp.js";
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
import { showBanner, renderLogo } from "../src/ui/banner.js";

const program = new Command();

program
  .name("noduscm")
  .description("Modern WordPress local development environment")
  .version(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version)
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
  .option("--yes", "Skip the confirmation prompt")
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

program
  .command("mcp")
  .description("Run a local MCP server so AI agents can manage your projects")
  .option("--http [port]", "Serve over HTTP on 127.0.0.1 (default port 7337) instead of stdio")
  .option("--token <token>", "Bearer token for --http (default: NODUSCM_MCP_TOKEN or a random one)")
  .option(
    "--root <dir>",
    "Also discover projects under this folder (repeatable)",
    (value, previous = []) => [...previous, value],
    [],
  )
  .option(
    "--cors <origin>",
    "Allow a browser origin to call the --http server, e.g. http://localhost:5173 (repeatable)",
    (value, previous = []) => [...previous, value],
    [],
  )
  .option("--allow-exec", "Enable container_exec and wp shell/eval-file (arbitrary commands)")
  .action(mcpCommand);

program
  .command("connect")
  .description("Connect this machine to the Nodus connector so Claude can design on your local sites and run noduscm commands")
  .option("--server <url>", "Connector URL (default: saved one or https://mcp.nodusproject.dev)")
  .option("--code <code>", "Device code from <server>/connect (NCM-XXXX-XXXX)")
  .option("--name <name>", "Name shown in Claude (default: hostname)")
  .option(
    "--root <dir>",
    "Also discover projects under this folder (repeatable)",
    (value, previous = []) => [...previous, value],
    [],
  )
  .option("--allow-exec", "Enable container_exec and wp shell/eval-file (arbitrary commands)")
  .option("--no-confirm-publish", "Do not ask in this terminal before pushing to the production branch (git_publish)")
  .option("--reset", "Forget the saved device and pair again")
  .action(connectCommand);

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

const theme = program
  .command("theme")
  .description("Sync WordPress themes with a Nodus Jet site (no SSH)");

theme
  .command("list")
  .description("List themes on the site")
  .option("--site <url>", "Site URL")
  .action(themeListCommand);

theme
  .command("init")
  .description("Create a new theme on the site and a local folder for it")
  .requiredOption("--name <name>", "Theme name (slugified for the folder)")
  .option("--site <url>", "Site URL")
  .option("--dir <path>", "Local folder (default: ./<slug>)")
  .action(themeInitCommand);

theme
  .command("clone <slug>")
  .description("Download an existing CLI theme into a local folder")
  .option("--site <url>", "Site URL")
  .option("--dir <path>", "Local folder (default: ./<slug>)")
  .action(themeCloneCommand);

theme
  .command("push")
  .description("Upload local changes to the site")
  .option("--dir <path>", "Theme folder (default: current directory)")
  .option("--delete", "Also delete files that only exist on the server")
  .option("--dry-run", "Show what would change without sending anything")
  .option("--force", "Overwrite even if the server changed since the last sync")
  .action(themePushCommand);

theme
  .command("pull")
  .description("Download server changes")
  .option("--dir <path>", "Theme folder (default: current directory)")
  .option("--delete", "Also delete local files that no longer exist on the server")
  .option("--dry-run", "Show what would change without writing anything")
  .option("--force", "Overwrite local changes")
  .action(themePullCommand);

theme
  .command("dev")
  .description("Watch the folder and push every change")
  .option("--dir <path>", "Theme folder (default: current directory)")
  .option("--delete", "Propagate local deletions to the server")
  .option("--force", "Overwrite even if the server changed since the last sync")
  .action(themeDevCommand);

program.parse();
