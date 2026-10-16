# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-10-16

### Added
- `noduscm mcp`: local MCP server for AI agents (Claude Code, Claude Desktop, your own UI).
  - Transports: stdio by default; `--http [port]` serves on 127.0.0.1 with a Bearer token, a Host check and an optional `--cors` origin.
  - Tools: projects, info/status, up/down, logs, WP-CLI, pull, backups (create/list/restore), import-db, generate, rebootstrap and remove. `container_exec` is only available with `--allow-exec`.
  - Destructive tools require `confirm = <slug>`, and `project_info` never returns passwords.
- Project registry at `~/.config/noduscm/projects.json`, updated by `init` and `up`. Use `--root` to discover projects in folders.
- Non-interactive mode (`NODUSCM_NON_INTERACTIVE=1`, used by the MCP server):
  - The hosts file and `mkcert -install` steps are skipped with a warning instead of prompting for sudo.
  - New `noduscm remove --yes` flag.

### Fixed
- `noduscm backup` crashed because `containerExec` did not return the command output.
- `noduscm down` uses the project's compose file and exits with code 1 on failure.
- `--version` now reads the version from `package.json`.

## [1.3.0] - 2026-03-27

### Added
- `noduscm shell` — opens a bash session in the Apache container as `webuser` (non-root). Use `--root` flag to connect as root.
- `noduscm info` — displays full project summary: local URL (HTTPS-aware), local and remote database details, SSH config, and ports.
- `noduscm import-db <file>` — imports a local `.sql` file directly into the local MySQL container. Automatically strips `USE`, `CREATE DATABASE`, and `DROP DATABASE` statements to avoid cross-environment conflicts.
- SSH password authentication support. During `noduscm init`, users can now choose between SSH key file or password when configuring the remote connection.
- `tablePrefix` support in `.noduscm.json` (also accepted under `database.tablePrefix`). Used by `noduscm generate` and `noduscm init` to set `$table_prefix` in `wp-config.php`. Defaults to `wp_`.
- `webuser` (UID 1000) in the Apache container — mirrors cPanel-style user model. Apache workers run as `webuser`, files are owned by `webuser:www-data` with group-write permissions. The user has full `NOPASSWD` sudo for local development. Password: `webuser`.
- `containerShell` utility in `container.js` for opening interactive shells with a specific user.

### Changed
- Apache container no longer runs interactive sessions as root. `podman/docker exec` now defaults to `webuser`.
- `noduscm generate` now always regenerates `wp-config.php` in addition to Docker files.
- `rsyncPull` and `rsyncPush` automatically fall back to SFTP when SSH auth type is `password`.

### Fixed
- `import-db`: removed `USE <remote_db>` statements from SQL dumps before import to prevent `Access denied` errors caused by database name mismatches between hosting and local environments.

## [1.1.0] - 2026-03-25

### Added
- Automatic HTTPS certificate generation and trust flow using `mkcert`.
- Automatic local domain host management for `.localhost` project domains.
- New local network configuration options: `localHttps`, `localHttpsPort`, `localApachePort`, `localMysqlPort`, and `autoManageHosts`.
- Migration guidance from privileged ports (`80/443`) to non-privileged ports (`8080/8443`) in docs and examples.

### Changed
- Default local URLs now prioritize HTTPS and domain-based access.
- CLI startup output now reflects HTTPS-first local access information.

### Fixed
- Certificate generation and local URL behavior consistency during project startup.
- Documentation consistency across bilingual examples and troubleshooting guides.
