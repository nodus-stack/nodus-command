# 09 - Referencia rápida de `.noduscm.json`

Ejemplo base con configuración HTTPS:

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

## Campos clave

- `tablePrefix`: Prefijo de tablas de WordPress en la base de datos (por defecto: `wp_`). También se acepta dentro de `database.tablePrefix`.
- `localHttps`: Habilitar certificados HTTPS automáticos con mkcert (por defecto: `true`)
- `localHttpsPort`: Puerto HTTPS (por defecto: `8443`)
- `localApachePort`: Puerto HTTP (por defecto: `8080`)
- `localMysqlPort`: Puerto MySQL (por defecto: `3306`)
- `autoManageHosts`: Agregar automáticamente el dominio a /etc/hosts (por defecto: `true`)
- `ssh.authType`: Tipo de autenticación SSH — `"key"` (por defecto) o `"password"`

## Buenas prácticas

- No compartir este archivo si contiene credenciales reales
- Mantener `remotePath` apuntando al root WordPress remoto
- Revisar `mounts` cuando cambies de máquina
