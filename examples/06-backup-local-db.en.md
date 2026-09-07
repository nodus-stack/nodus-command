# 06 - Local database backups

## When it works

Only when your project is configured with a local database (`database.type = local`).

## Create a backup

```bash
noduscm backup
```

## Where it is stored

- Folder: `.noduscm/backups/`
- Format: `backup-<timestamp>.sql`

## Recommendations

- Run a backup before large pull operations or structural changes
- Version your source code, not large SQL dumps

## Current CLI status note

The codebase includes internal logic for backup list/restore, but the currently exposed public command is only `noduscm backup`.
