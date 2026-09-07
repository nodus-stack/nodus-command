# 11 - Importar base de datos desde archivo `.sql`

Útil cuando el proveedor de hosting no permite generar SSH keys o ejecutar `mysqldump` directamente, pero sí exportar la base de datos desde su panel de control.

## Uso básico

```bash
noduscm import-db /ruta/al/backup.sql
```

## Flujo típico

1. Descarga el `.sql` desde el panel del hosting (cPanel, Plesk, etc.)
2. Corre el comando apuntando al archivo descargado:

```bash
noduscm import-db ~/Downloads/db_backup.sql
```

3. El archivo se copia al contenedor MySQL y se importa automáticamente.

## Lo que hace internamente

```
1. Valida que el archivo exista y termine en .sql
2. docker/podman cp <archivo> <slug>-mysql:/tmp/noduscm-import.sql
3. Filtra USE, CREATE DATABASE y DROP DATABASE del dump
4. mysql -u<user> -p<pass> <db> < /tmp/noduscm-import.sql
5. Limpia el archivo temporal del contenedor
```

## Por qué filtra USE / CREATE DATABASE

Los dumps de hosting suelen incluir:

```sql
CREATE DATABASE IF NOT EXISTS `dbs12876357`;
USE `dbs12876357`;
```

Esas instrucciones causarían un error `Access denied` porque el usuario local solo tiene permisos sobre la base de datos local (`wordpress`, `mi_proyecto_db`, etc.), no sobre el nombre remoto. NodusCommand las elimina automáticamente antes de importar.

## Notas

- El proyecto debe estar corriendo (`noduscm up`) antes de importar.
- Si la base de datos ya tiene datos, serán reemplazados por el contenido del dump.
