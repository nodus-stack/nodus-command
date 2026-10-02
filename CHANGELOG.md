# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Theme sync over HTTPS (proof of concept), no SSH required.** Works with sites running the Nodus Jet plugin (REST API `/wp-json/nodus-jet/v1`).
  - `noduscm login --site <url>` — pair with a one-time code generated in wp-admin → Nodus Jet → CLI. The token is stored in `~/.config/noduscm/auth.json` (mode 600), never in the project. `logout` revokes it on the server; `whoami` shows the session.
  - `noduscm theme init --name <name>` creates the theme on the site and a local folder; `theme clone <slug>` downloads an existing CLI theme.
  - `noduscm theme push | pull` sync by manifest (only changed files), with `--dry-run`, `--delete` (deletions are opt-in) and `--force`. Push aborts if the server changed since the last sync; pull aborts if local edits would be overwritten.
  - `noduscm theme dev` watches the folder and pushes every change; prints the preview URL (`?nodus_jet_preview=<slug>`).
  - `.noduscmignore` (defaults: `node_modules/`, `.git/`, `*.map`, `.env`). Only whitelisted extensions are synced; dotfiles are never sent.
- **Plugin sync (experiment):** `noduscm plugin list | init | clone | push | pull | dev`, same flow as themes against `/wp-json/nodus-jet/v1/plugins`. Files only: plugins are never activated, deactivated or previewed from the CLI (activate them in wp-admin). The folder context is stored in `.noduscm/plugin.json`; running `theme …` in a plugin folder (or vice versa) fails with a clear message. PHP syntax errors are rejected by the site with the file and line, and the whole batch is not written.
- **Media files and larger files:** `mp4`, `webm`, `ogg`, `mp3`, `wav`, `pdf` and `bmp` are now synced (themes and plugins). Per-file limit raised from 2 MB to 16 MB (the site can lower or raise it with the `nodus_jet_cli_max_file_bytes` filter); big files travel alone in their own request, and `pull`/`clone` fetch what doesn't fit in one response in follow-up requests.
- Dependency: `chokidar` (file watching).

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
