# 04 - Pull from remote server (SSH + rsync)

## Requirements

- `ssh` configured in `.noduscm.json`
- `rsync` installed locally
- valid remote credentials

## Important rules

- Use only one mode per run (`--db-only`, `--files-only`, etc.)
- `--exclude` applies to file sync, not DB-only/uploads-only modes

## 1) Full pull (files + DB)

```bash
noduscm pull
```

## 2) Database only

```bash
noduscm pull --db-only
```

## 3) Files only

```bash
noduscm pull --files-only
```

## 4) Uploads only

```bash
noduscm pull --uploads-only
```

## 5) Specific path(s) only

```bash
noduscm pull --specified-path /wp-content/themes/my-theme
```

Multiple paths:

```bash
noduscm pull \
  --specified-path /wp-content/uploads \
  --specified-path /wp-content/mu-plugins
```

Brace expansion:

```bash
noduscm pull --specified-path '/wp-content/{uploads,mu-plugins}'
```

## 6) Exclude paths

```bash
noduscm pull --files-only \
  --exclude wp-content/uploads/cache \
  --exclude wp-content/upgrade
```

## Persistent default excludes

In `.noduscm.json`:

```json
{
  "pullDefaults": {
    "exclude": [
      "/wp-content/themes/custom-theme"
    ]
  }
}
```
