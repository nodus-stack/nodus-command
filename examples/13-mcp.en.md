# 13) AI agents with `noduscm mcp`

`noduscm mcp` starts a **local** MCP server so Claude Code, Claude Desktop or your own agent UI can manage your NodusCommand projects. Agents can start and stop them, run WP-CLI, pull from production, take backups and read the logs.

The remote Nodus connector (`mcp.nodusproject.dev`) cannot reach your machine. Use this server for local sites and the remote connector for production sites.

## Connect

### Claude Code

```bash
claude mcp add noduscm -- noduscm mcp --root ~/WorkspacePHP
```

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "noduscm": { "command": "noduscm", "args": ["mcp", "--root", "/home/you/WorkspacePHP"] }
  }
}
```

### Your agent UI (local HTTP)

```bash
NODUSCM_MCP_TOKEN=a-long-token noduscm mcp --http 7337 --cors http://localhost:5173
```

- **URL:** `http://127.0.0.1:7337/mcp` (stateless Streamable HTTP).
- **Auth:** header `Authorization: Bearer a-long-token`. If you set no token, one is generated and printed at startup.
- **Network:** it only listens on `127.0.0.1` and rejects other `Host` headers.
- **Browser:** `--cors` allows one specific origin, in case your UI calls it from the browser.

## Options

| Option | Use |
| --- | --- |
| `--root <dir>` | Discover projects (`.noduscm.json`) under that folder, up to 2 levels deep. Repeatable. |
| `--http [port]` | Local HTTP instead of stdio (default port 7337). |
| `--token <token>` | Token for `--http`. `NODUSCM_MCP_TOKEN` also works. |
| `--cors <origin>` | Allowed web origin for `--http`. Repeatable. |
| `--allow-exec` | Enables `container_exec` and `wp shell` / `wp eval-file`, which run arbitrary commands. |

`noduscm init` and `noduscm up` also save each project to `~/.config/noduscm/projects.json`.

## Tools

| Tool | What it does |
| --- | --- |
| `list_projects`, `register_project` | Projects on this machine |
| `project_info`, `project_status` | Config without passwords, URLs, containers |
| `project_up`, `project_down` | `noduscm up` / `down` |
| `project_logs` | Apache (PHP errors) or MySQL logs |
| `wp_cli` | WP-CLI inside the container (`["plugin","list"]`) |
| `project_pull` | `noduscm pull` (all, db, files, uploads, paths, container mode) |
| `project_backup`, `list_backups`, `restore_backup` | Local DB backups |
| `import_db` | `noduscm import-db` |
| `project_generate`, `project_rebootstrap` | Regenerate the Docker files or `wordpress/` and `wp-content/` |
| `project_remove` | `noduscm remove` |
| `container_exec` | Shell command in the container (only with `--allow-exec`) |

## Safety

- **No passwords or sudo prompts.** The server runs commands with `NODUSCM_NON_INTERACTIVE=1`. If editing `/etc/hosts` or running `mkcert -install` is needed, the output says so and you have to do it once from your terminal.
- **Confirmation.** Anything that deletes or replaces local data requires `confirm = <project slug>`: pulling the DB, restoring a backup, `import_db` with `force`, `rebootstrap --force` and `remove`.
- **Passwords.** `project_info` never returns the DB or SSH passwords.
