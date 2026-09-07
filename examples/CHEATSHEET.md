# NodusCommand Cheat Sheet (ES/EN)

Guía rápida de comandos para onboarding y uso diario.

---

## 1) Setup inicial / Initial setup

```bash
# Instalar dependencias del CLI / Install CLI deps
pnpm install
pnpm link

# Inicializar proyecto / Initialize project
noduscm init

# Levantar entorno / Start environment
noduscm up

# Acceder al sitio / Access site
# https://my-domain.localhost:8443
```

---

## 2) HTTPS por defecto / Default HTTPS

```json
{
  "localHttps": true,
  "localHttpsPort": 8443,
  "localApachePort": 8080,
  "localMysqlPort": 3306,
  "autoManageHosts": true
}
```

```bash
# Regenerar y levantar / Regenerate and start
noduscm generate
noduscm up
```

---

## 3) Migración / Migration 80/443 → 8080/8443

```bash
# 1) Actualiza puertos en .noduscm.json
# 2) Reinicia entorno
noduscm down
noduscm generate
noduscm up
```

Usa tu dominio con puerto HTTPS:

```text
https://my-domain.localhost:8443
```

---

## 4) Ciclo diario / Daily workflow

```bash
# Levantar / Start
noduscm up

# Bajar / Stop
noduscm down

# Regenerar compose/apache/dockerfile desde config
noduscm generate
```

---

## 5) Pull remoto por SSH / Remote SSH pull

```bash
# Todo: archivos + DB / Everything: files + DB
noduscm pull

# Solo DB / DB only
noduscm pull --db-only

# Solo archivos / Files only
noduscm pull --files-only

# Solo uploads / Uploads only
noduscm pull --uploads-only

# Ruta específica / Specific path
noduscm pull --specified-path /wp-content/themes/my-theme
```

Exclusiones / Excludes:

```bash
noduscm pull --files-only \
  --exclude wp-content/uploads/cache \
  --exclude wp-content/upgrade
```

---

## 6) Pull desde contenedor remoto / Remote container pull (Coolify)

```bash
# DB desde contenedor remoto
noduscm pull --db-container-only --container-id your-db-container

# Uploads desde contenedor remoto
noduscm pull --uploads-container-only --container-id your-app-container

# Archivos desde contenedor remoto
noduscm pull --files-container-only --container-id your-app-container
```

---

## 7) Backups & Import DB

```bash
# Crear backup local de DB
noduscm backup

# Listar backups / List backups
noduscm backup:list

# Restaurar backup / Restore backup
noduscm backup:restore

# Importar .sql externo al contenedor local / Import external .sql into local container
noduscm import-db /path/to/backup.sql
```

> `import-db` elimina automáticamente `USE`, `CREATE DATABASE` y `DROP DATABASE`
> del dump para evitar conflictos entre el nombre de BD del hosting y el local.

---

## 8) Info del proyecto / Project info

```bash
noduscm info
```

Muestra URL local (con HTTPS si está activo), base de datos local y remota, SSH y puertos.

---

## 9) Shell interactivo / Interactive shell

```bash
# Acceder como webuser (default, estilo cPanel)
noduscm shell

# Acceder como root
noduscm shell --root
```

Dentro del contenedor como `webuser`:

```bash
wp plugin list              # WP-CLI sin sudo
sudo service apache2 restart  # con sudo (password: webuser)
```

---

## 10) Bind mounts personalizados / Custom bind mounts

```bash
noduscm init \
  --mount /abs/path/plugin:/var/www/html/wp-content/plugins/plugin:z \
  --mount /abs/path/theme:/var/www/html/wp-content/themes/theme:z
```

Formato:

```text
<absolute-local-path>:<container-path>[:mode]
```

---

## 11) Eliminación de infraestructura / Infra cleanup

```bash
noduscm remove
```

Elimina contenedores, volúmenes y archivos generados de NodusCommand, pero conserva `wordpress/` y `wp-content/`.
