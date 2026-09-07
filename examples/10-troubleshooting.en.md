# 10 - Troubleshooting

## `Config file not found: .noduscm.json`

You are outside the project directory or you have not run `noduscm init`.

## `Neither Docker nor Podman found`

Install Docker or Podman and verify the binary is available in `PATH`.

## `SSH connection failed`

Check:

- host/user/port
- private key path
- key permissions
- remote host access

## `wp-content folder not found` in existing project

`init` in existing mode requires `wp-content/` in the current folder.

## Pull mode errors

Do not combine pull modes; use only one mode flag per execution.

## DB not ready after `up`

Wait a few extra seconds and try again. MySQL container startup can take longer.

## Mounts are not visible in container

1. Verify `mounts` entries in `.noduscm.json`
2. Regenerate compose:

```bash
noduscm generate
```

3. Restart containers:

```bash
noduscm down
noduscm up
```

## HTTPS Certificate Issues

### `Connection refused` on port 8443

Check that `localHttps: true` is set in `.noduscm.json` and that `mkcert` is installed:

```bash
which mkcert
```

### Browser shows certificate as untrusted

1. Verify `./certs/local.crt` exists in the project.
2. Regenerate certificates:

```bash
rm -rf certs/
noduscm up
```

### `/etc/hosts` not updated

If `autoManageHosts: true` but the domain doesn't resolve:

```bash
grep "my-domain.localhost" /etc/hosts
noduscm generate
noduscm up
```

## Quick migration `80/443` → `8080/8443`

If you are migrating from old privileged ports, update `.noduscm.json`:

```json
{
  "localHttps": true,
  "localApachePort": 8080,
  "localHttpsPort": 8443,
  "localMysqlPort": 3306,
  "autoManageHosts": true
}
```

Then apply changes:

```bash
noduscm down
noduscm generate
noduscm up
```

Open your site using domain and HTTPS port, for example:

```text
https://my-project.localhost:8443
```
