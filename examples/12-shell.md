# 12 - Shell interactivo en el contenedor Apache

NodusCommand configura el contenedor Apache con un usuario `webuser` (UID 1000) que replica el modelo de acceso estilo cPanel: propietario de los archivos, parte del grupo `www-data`, con sudo completo sin contraseña para comandos del día a día.

## Acceder al contenedor

```bash
# Como webuser (por defecto)
noduscm shell

# Como root (para tareas de sistema)
noduscm shell --root
```

## Usuario webuser

| Propiedad     | Valor           |
|---------------|-----------------|
| Usuario       | `webuser`       |
| UID           | `1000`          |
| Grupo         | `www-data`      |
| Contraseña    | `webuser`       |
| Directorio    | `/var/www/html` |

## Comandos comunes dentro del contenedor

```bash
# WP-CLI sin sudo
wp plugin list
wp plugin activate nombre-plugin
wp cache flush
wp search-replace 'https://ejemplo.com' 'https://mi-proyecto.localhost:8443'

# Permisos de archivos
chmod 644 .htaccess
chown webuser:www-data wp-config.php

# Reiniciar Apache (requiere sudo, password: webuser)
sudo service apache2 restart
sudo apachectl configtest
```

## Modelo de permisos

Apache workers corren como `webuser`, igual que los procesos PHP. Los archivos en `/var/www/html` son propiedad de `webuser:www-data` con permisos `775`, por lo que puedes crear, editar y eliminar archivos sin necesidad de `sudo`.

## Acceso directo sin noduscm shell

Si prefieres hacerlo manualmente:

```bash
podman exec -u webuser -it <slug>-apache bash
# o
docker exec -u webuser -it <slug>-apache bash
```
