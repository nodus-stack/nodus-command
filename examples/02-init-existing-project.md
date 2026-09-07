# 02 - Inicializar proyecto existente

## Cuándo usar este flujo

Cuando ya tienes código en la carpeta (especialmente `wp-content/`) y quieres que NodusCommand lo orqueste.

## Requisito

Idealmente debe existir `wp-content/` en el directorio actual para conservar tu contenido actual.
Si no existe, `init` continúa y crea una estructura base de `wp-content/`.

## Comando

```bash
noduscm init
```

Durante el prompt selecciona:

- `Project type: Existing project`

## Qué hace

- Mantiene tu `wp-content/`
- Descarga core WordPress en `wordpress/`
- Genera archivos de infraestructura (`docker-compose.yml`, `apache.conf`, `Dockerfile.apache`)
- Crea `.noduscm.json`

## Levantar entorno

```bash
noduscm up
```

## Errores comunes

### `wp-content folder not found`

`init` mostrará una advertencia y creará `wp-content/` base automáticamente.
