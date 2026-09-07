# 05 - Pull from remote containers (Coolify)

## When to use this flow

When your remote app runs in containers and you want to extract data/files from container runtime.

## Key requirement

You must provide `--container-id`.

## Database only from remote container

```bash
noduscm pull --db-container-only --container-id your-db-container
```

## Uploads only from remote container

```bash
noduscm pull --uploads-container-only --container-id your-app-container
```

## Project files only from remote container

```bash
noduscm pull --files-container-only --container-id your-app-container
```

## Note

These modes are also mutually exclusive with all other `pull` mode flags.
