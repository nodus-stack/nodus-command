# 08 - Eliminar proyecto sin borrar WP files

## Comando

```bash
noduscm remove
```

## Qué elimina

- Contenedores
- Volúmenes del compose
- `docker-compose.yml`
- `apache.conf`
- `Dockerfile.apache`
- `.noduscm/`
- `.noduscm.json`

## Qué preserva

- `wordpress/`
- `wp-content/`

## Cuándo usarlo

- Reiniciar configuración de NodusCommand
- Limpiar infraestructura sin perder código/contenido del proyecto
