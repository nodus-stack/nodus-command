# 07 - Custom bind mounts

## Goal

Mount local repositories (plugins/themes) inside the container for live development.

## During `init`

```bash
noduscm init \
  --mount /home/user/WorkspacePHP/my-plugin:/var/www/html/wp-content/plugins/my-plugin:z \
  --mount /home/user/WorkspacePHP/my-theme:/var/www/html/wp-content/themes/my-theme:z
```

## Format

```text
<absolute-local-path>:<container-path>[:mode]
```

Example:

```text
/home/user/repo:/var/www/html/wp-content/plugins/repo:z
```

## Edit mounts later

1. Edit `mounts` in `.noduscm.json`
2. Run:

```bash
noduscm generate
noduscm up
```

## Tip

Use absolute paths to avoid resolution errors.
