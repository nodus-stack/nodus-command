# 13) AI agents with `noduscm mcp`

`noduscm mcp` starts a **local** MCP server so Claude Code, Claude Desktop or your own agent UI can manage your NodusCommand projects. Agents can start and stop them, run WP-CLI, pull from production, take backups and read the logs.

To use the cloud Nodus connector instead (`mcp.nodusproject.dev`, the one in claude.ai), run `noduscm connect` (below): Claude can then design on your local sites and use these same tools.

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

## Cloud connector: `noduscm connect`

Connects your machine to the Nodus connector so Claude (claude.ai, Claude Desktop or mobile) can work with your local sites. The connection is **outbound** (WebSocket): no port is opened on your machine.

```bash
# 1. In https://mcp.nodusproject.dev/connect → "Generar código de equipo" (valid 10 min, single use)
# 2. Pair once and keep it running
noduscm connect --code NCM-XXXX-XXXX --root ~/WorkspacePHP
# Next times:
noduscm connect
```

| Option | Purpose |
| --- | --- |
| `--server <url>` | Another connector (default: saved one or `https://mcp.nodusproject.dev`) |
| `--name <name>` | Device name shown in Claude (default: hostname) |
| `--root <dir>` | Folders to discover projects in (repeatable) |
| `--allow-exec` | Same as in `noduscm mcp` |
| `--reset` | Forget the pairing and pair again |

Credentials are saved in `~/.config/noduscm/device.json` (mode 600). To revoke the device, remove it in `/connect`.

The connector can only call the local URLs of your registered projects (`*.localhost` always goes to 127.0.0.1); nothing else on your network.

### Local → production flow with Git

1. Mount your theme clone in the project (`mounts` in `.noduscm.json`, see `07-custom-mounts.en.md`) and start it (`noduscm up`).
2. In Claude: *"link my local site"* → `link_local_site`. The site shows up as `local-…` and every design tool and the preview work with it.
3. Design and review the preview. Saving changes the theme files in your clone.
4. Once approved, Claude checks the branch connected in production (`jet.repos_list`) and runs `git_publish`:
   - `mode: "direct"`: commit and merge into that branch (in a temporary worktree if you are on another branch), then push.
   - `mode: "pr"`: work branch + PR to the connected branch (with `gh`; otherwise you get the URL). `merge_pr: true` merges it.
5. In production, `jet.repo_pull` (Nodus Jet) pulls the changes.

| Tool | What it does |
| --- | --- |
| `project_repos` | Git repos mounted in the project (themes/plugins) |
| `git_status` | Branch, changes, ahead/behind |
| `git_publish` | Commit + publish to the connected branch (direct or PR) |
| `site_pair_code` | Code to link the local site to the connector (used by `link_local_site`) |

Git uses your own credentials (SSH or credential helper); they are never stored in the connector.
