# 01 - New project from scratch

## When to use this flow

When you want to create a clean WordPress project in a new folder and get it running quickly.

## Command

```bash
noduscm init
```

## What it does internally

- Detects container engine (`podman` or `docker`)
- Prompts for name, domain, project type, and WordPress version
- Configures local or remote database
- (Optional) configures SSH for future sync operations
- Downloads WordPress (`wordpress/`)
- Prepares a clean `wp-content/`
- Generates:
  - `wp-config.php`
  - `docker-compose.yml`
  - `apache.conf`
  - `Dockerfile.apache`
  - `.noduscm.json`
- Creates `.noduscm/backups/`

## Full example

```bash
mkdir my-site && cd my-site
noduscm init
noduscm up
```

## Expected result

- Local site at `https://my-site.localhost:8443` (automatic HTTPS)
- Admin at `https://my-site.localhost:8443/wp-admin`
- Locally-trusted certificates in `./certs/`
- Domain automatically added to `/etc/hosts`

## Tips

- Use a `*.localhost` domain during init
- HTTPS is enabled by default automatically
- Certificates are generated with mkcert (locally-trusted)
- If you plan remote sync later, configure SSH during init
