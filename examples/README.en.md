# NodusCommand Examples (English)

Practical usage guide for `noduscm` (WordPress local environment CLI with Docker/Podman).

This folder documents real scenarios by use case, from local initialization to remote sync and maintenance.

## Guide versions

- English (this file)
- [Versión en español](./README.md)
- [Cheat Sheet ES/EN](./CHEATSHEET.md)

## Index

1. **01 - New project from scratch** · [EN](./01-init-blank-project.en.md) | [ES](./01-init-blank-project.md)
2. **02 - Initialize an existing project** · [EN](./02-init-existing-project.en.md) | [ES](./02-init-existing-project.md)
3. **03 - Start, regenerate and stop environment** · [EN](./03-up-generate-down.en.md) | [ES](./03-up-generate-down.md)
4. **04 - Pull from remote server (SSH + rsync)** · [EN](./04-pull-ssh-modes.en.md) | [ES](./04-pull-ssh-modes.md)
5. **05 - Pull from remote containers (Coolify)** · [EN](./05-pull-container-modes.en.md) | [ES](./05-pull-container-modes.md)
6. **06 - Local database backups** · [EN](./06-backup-local-db.en.md) | [ES](./06-backup-local-db.md)
7. **07 - Custom bind mounts** · [EN](./07-custom-mounts.en.md) | [ES](./07-custom-mounts.md)
8. **08 - Remove project without deleting WP files** · [EN](./08-remove-project.en.md) | [ES](./08-remove-project.md)
9. **09 - `.noduscm.json` quick reference** · [EN](./09-config-reference.en.md) | [ES](./09-config-reference.md)
10. **10 - Troubleshooting** · [EN](./10-troubleshooting.en.md) | [ES](./10-troubleshooting.md)
11. **11 - Import database from file** · [EN](./11-import-db.en.md) | [ES](./11-import-db.md)
12. **12 - Interactive shell in the container** · [EN](./12-shell.en.md) | [ES](./12-shell.md)

## Recommended flow

```bash
# 1) Create config + base files
noduscm init

# 2) Start containers
noduscm up

# 3) (Optional) sync from remote
noduscm pull

# 4) (Optional) import SQL backup from hosting
noduscm import-db backup.sql

# 5) Create local backups as needed
noduscm backup

# 6) View project info
noduscm info

# 7) Open shell in the container
noduscm shell

# 8) Stop environment
noduscm down
```

## Important note

Local HTTPS is enabled by default with mkcert certificates.
Typical URL is `https://<your-domain>.localhost:8443`.

The Apache container runs as `webuser` (non-root). Use `noduscm shell` to access it. Sudo password is `webuser`.

`pull` modes are mutually exclusive. Use only one mode per run:

- `--db-only`
- `--files-only`
- `--uploads-only`
- `--specified-path`
- `--files-container-only`
- `--db-container-only`
- `--uploads-container-only`

## Quick onboarding

See [CHEATSHEET.md](./CHEATSHEET.md) for a one-page command cheat sheet.
