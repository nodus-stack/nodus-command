# 08 - Remove project without deleting WP files

## Command

```bash
noduscm remove
```

## What it removes

- Containers
- Compose volumes
- `docker-compose.yml`
- `apache.conf`
- `Dockerfile.apache`
- `.noduscm/`
- `.noduscm.json`

## What it preserves

- `wordpress/`
- `wp-content/`

## When to use it

- Reset NodusCommand configuration
- Clean infrastructure without losing project code/content
