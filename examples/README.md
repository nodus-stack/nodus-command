# NodusCommand Examples

Guía práctica de uso para `noduscm` (CLI de entornos WordPress con Docker/Podman).

Esta carpeta documenta escenarios reales por tipo de uso, desde inicialización local hasta sincronización remota y mantenimiento.

## Versiones de esta guía

- Español (este archivo)
- [English version](./README.en.md)
- [Cheat Sheet ES/EN](./CHEATSHEET.md)

## Índice

1. **01 - Nuevo proyecto desde cero** · [ES](./01-init-blank-project.md) | [EN](./01-init-blank-project.en.md)
2. **02 - Inicializar proyecto existente** · [ES](./02-init-existing-project.md) | [EN](./02-init-existing-project.en.md)
3. **03 - Levantar, regenerar y detener entorno** · [ES](./03-up-generate-down.md) | [EN](./03-up-generate-down.en.md)
4. **04 - Pull desde servidor remoto (SSH + rsync)** · [ES](./04-pull-ssh-modes.md) | [EN](./04-pull-ssh-modes.en.md)
5. **05 - Pull desde contenedores remotos (Coolify)** · [ES](./05-pull-container-modes.md) | [EN](./05-pull-container-modes.en.md)
6. **06 - Backups locales de base de datos** · [ES](./06-backup-local-db.md) | [EN](./06-backup-local-db.en.md)
7. **07 - Bind mounts personalizados** · [ES](./07-custom-mounts.md) | [EN](./07-custom-mounts.en.md)
8. **08 - Eliminar proyecto sin borrar WP files** · [ES](./08-remove-project.md) | [EN](./08-remove-project.en.md)
9. **09 - Referencia rápida de `.noduscm.json`** · [ES](./09-config-reference.md) | [EN](./09-config-reference.en.md)
10. **10 - Troubleshooting** · [ES](./10-troubleshooting.md) | [EN](./10-troubleshooting.en.md)
11. **11 - Importar base de datos desde archivo** · [ES](./11-import-db.md) | [EN](./11-import-db.en.md)
12. **12 - Shell interactivo en el contenedor** · [ES](./12-shell.md) | [EN](./12-shell.en.md)

## Flujo recomendado

```bash
# 1) Crear configuración + archivos base
noduscm init

# 2) Levantar contenedores
noduscm up

# 3) (Opcional) sincronizar remoto
noduscm pull

# 4) (Opcional) importar backup SQL del hosting
noduscm import-db backup.sql

# 5) Backup local cuando lo necesites
noduscm backup

# 6) Ver info del proyecto
noduscm info

# 7) Abrir terminal en el contenedor
noduscm shell

# 8) Detener entorno
noduscm down
```

## Nota importante

HTTPS local está habilitado por defecto con certificados mkcert.
La URL típica es `https://<tu-dominio>.localhost:8443`.

El contenedor Apache corre como `webuser` (no root). Usa `noduscm shell` para acceder. La contraseña de sudo es `webuser`.

`pull` tiene modos mutuamente excluyentes. Usa **solo uno** por ejecución:

- `--db-only`
- `--files-only`
- `--uploads-only`
- `--specified-path`
- `--files-container-only`
- `--db-container-only`
- `--uploads-container-only`
