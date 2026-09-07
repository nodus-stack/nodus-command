# 12 - Interactive shell in the Apache container

NodusCommand configures the Apache container with a `webuser` (UID 1000) that mirrors a cPanel-style access model: file owner, member of the `www-data` group, with full passwordless sudo for day-to-day commands.

## Accessing the container

```bash
# As webuser (default)
noduscm shell

# As root (for system-level tasks)
noduscm shell --root
```

## webuser details

| Property      | Value           |
|---------------|-----------------|
| Username      | `webuser`       |
| UID           | `1000`          |
| Group         | `www-data`      |
| Password      | `webuser`       |
| Home/workdir  | `/var/www/html` |

## Common commands inside the container

```bash
# WP-CLI without sudo
wp plugin list
wp plugin activate plugin-name
wp cache flush
wp search-replace 'https://example.com' 'https://my-project.localhost:8443'

# File permissions
chmod 644 .htaccess
chown webuser:www-data wp-config.php

# Restart Apache (requires sudo, password: webuser)
sudo service apache2 restart
sudo apachectl configtest
```

## Permission model

Apache workers run as `webuser`, same as PHP processes. Files under `/var/www/html` are owned by `webuser:www-data` with `775` permissions, so you can create, edit, and delete files without `sudo`.

## Direct access without noduscm shell

If you prefer to do it manually:

```bash
podman exec -u webuser -it <slug>-apache bash
# or
docker exec -u webuser -it <slug>-apache bash
```
