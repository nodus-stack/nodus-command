# 09 - `.noduscm.json` quick reference

Base example with HTTPS configuration:

```json
{
  "name": "My WordPress Site",
  "slug": "my-wordpress-site",
  "domain": "my-wordpress-site.localhost",
  "wpVersion": "6.9",
  "engine": "podman",
  "tablePrefix": "wp_",
  "database": {
    "type": "local",
    "host": "my-wordpress-site-mysql",
    "name": "wordpress",
    "user": "wordpress",
    "password": "wordpress",
    "rootPassword": "root"
  },
  "ssh": {
    "host": "example.com",
    "port": 22,
    "user": "username",
    "authType": "key",
    "keyFile": "/path/to/key",
    "remotePath": "/var/www/html",
    "database": {
      "host": "localhost",
      "name": "production_db",
      "user": "db_user",
      "password": "db_password"
    }
  },
  "localHttps": true,
  "localHttpsPort": 8443,
  "localApachePort": 8080,
  "localMysqlPort": 3306,
  "autoManageHosts": true,
  "mounts": [],
  "env": {
    "MY_PASSWORD_FOR_SOMETHING": "VALUE"
  },
  "pullDefaults": {
    "exclude": []
  }
}
```

## Key fields

- `tablePrefix`: WordPress database table prefix (default: `wp_`). Also accepted as `database.tablePrefix`.
- `localHttps`: Enable automatic HTTPS with mkcert certificates (default: `true`)
- `localHttpsPort`: HTTPS port (default: `8443`)
- `localApachePort`: HTTP port (default: `8080`)
- `localMysqlPort`: MySQL port (default: `3306`)
- `autoManageHosts`: Automatically add domain to /etc/hosts (default: `true`)
- `ssh.authType`: SSH authentication type — `"key"` (default) or `"password"`

## Best practices

- Do not share this file if it contains real credentials
- Keep `remotePath` pointing to remote WordPress root
- Re-check `mounts` when moving to another machine
