# 05 - Pull desde contenedores remotos (Coolify)

## Cuándo usar este flujo

Cuando tu app remota corre en contenedores y quieres extraer datos/archivos desde container runtime.

## Requisito clave

Debes indicar `--container-id`.

## Solo DB desde contenedor remoto

```bash
noduscm pull --db-container-only --container-id your-db-container
```

## Solo uploads desde contenedor remoto

```bash
noduscm pull --uploads-container-only --container-id your-app-container
```

## Solo archivos de proyecto desde contenedor remoto

```bash
noduscm pull --files-container-only --container-id your-app-container
```

## Nota

Estos modos también son mutuamente excluyentes con el resto de flags de `pull`.
