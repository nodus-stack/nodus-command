# 07 - Bind mounts personalizados

## Objetivo

Montar repos locales (plugins/themes) dentro del contenedor para desarrollo en vivo.

## Durante `init`

```bash
noduscm init \
  --mount /home/user/WorkspacePHP/my-plugin:/var/www/html/wp-content/plugins/my-plugin:z \
  --mount /home/user/WorkspacePHP/my-theme:/var/www/html/wp-content/themes/my-theme:z
```

## Formato

```text
<absolute-local-path>:<container-path>[:mode]
```

Ejemplo:

```text
/home/user/repo:/var/www/html/wp-content/plugins/repo:z
```

## Editar mounts luego

1. Edita `.noduscm.json` en `mounts`
2. Ejecuta:

```bash
noduscm generate
noduscm up
```

## Tip

Usa paths absolutos para evitar errores de resolución.
