# 06 - Backups locales de base de datos

## Cuándo funciona

Solo cuando tu proyecto está configurado con base de datos local (`database.type = local`).

## Crear backup

```bash
noduscm backup
```

## Dónde se guarda

- Carpeta: `.noduscm/backups/`
- Formato: `backup-<timestamp>.sql`

## Recomendaciones

- Ejecuta backup antes de pull masivo o cambios estructurales
- Versiona tu código, no los dumps SQL pesados

## Nota de estado actual del CLI

El código contempla lógica interna para listar/restaurar backups, pero en la interfaz de comandos actual solo está expuesto `noduscm backup`.
