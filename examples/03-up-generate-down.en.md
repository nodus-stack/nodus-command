# 03 - Start, regenerate, and stop environment

## `noduscm up`

```bash
noduscm up
```

### What it does

- If `localHttps: true`, generates locally-trusted HTTPS certificates with mkcert
- Automatically adds domain to `/etc/hosts` if `autoManageHosts: true`

### HTTPS flow
## `noduscm generate`
```bash
noduscm up

# First runs may request authentication for mkcert
# ? NodusCommand needs to trust a local CA (mkcert -install). Continue? Yes

# Certificates generated in ./certs/
# HTTPS URLs available in output
```

```bash
noduscm generate
```

### When to use it

When you edited `.noduscm.json` (mounts, DB mode, domain, etc.) and want to regenerate files without starting containers yet.

### Generated files

- `docker-compose.yml`
- `apache.conf`
- `Dockerfile.apache`

## `noduscm down`

```bash
noduscm down
```

Stops the environment (`compose down`) without deleting the project.

## Typical flow

```bash
noduscm generate
noduscm up
# normal work...
noduscm down
```
