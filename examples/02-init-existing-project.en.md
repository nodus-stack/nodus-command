# 02 - Initialize an existing project

## When to use this flow

When you already have code in the folder (especially `wp-content/`) and want NodusCommand to orchestrate it.

## Requirement

Ideally, `wp-content/` exists in the current directory so your content is preserved.
If it's missing, `init` now continues and creates a base `wp-content/` structure.

## Command

```bash
noduscm init
```

During the prompt choose:

- `Project type: Existing project`

## What it does

- Keeps your existing `wp-content/`
- Downloads WordPress core into `wordpress/`
- Generates infrastructure files (`docker-compose.yml`, `apache.conf`, `Dockerfile.apache`)
- Creates `.noduscm.json`

## Start environment

```bash
noduscm up
```

## Common error

### `wp-content folder not found`

`init` shows a warning and creates a base `wp-content/` folder automatically.
