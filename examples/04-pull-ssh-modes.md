# 04 - Pull desde servidor remoto (SSH + rsync)

## Requisitos

- `ssh` configurado en `.noduscm.json`
- `rsync` instalado localmente
- credenciales remotas válidas

## Reglas importantes

- Solo un modo por ejecución (`--db-only`, `--files-only`, etc.)
- `--exclude` aplica a sync de archivos, no a modos DB-only/uploads-only

## 1) Pull completo (archivos + DB)

```bash
noduscm pull
```

## 2) Solo base de datos

```bash
noduscm pull --db-only
```

## 3) Solo archivos

```bash
noduscm pull --files-only
```

## 4) Solo uploads

```bash
noduscm pull --uploads-only
```

## 5) Solo ruta(s) específica(s)

```bash
noduscm pull --specified-path /wp-content/themes/my-theme
```

Múltiples rutas:

```bash
noduscm pull \
  --specified-path /wp-content/uploads \
  --specified-path /wp-content/mu-plugins
```

Con brace expansion:

```bash
noduscm pull --specified-path '/wp-content/{uploads,mu-plugins}'
```

## 6) Excluir rutas

```bash
noduscm pull --files-only \
  --exclude wp-content/uploads/cache \
  --exclude wp-content/upgrade
```

## Excludes por defecto (persistentes)

En `.noduscm.json`:

```json
{
  "pullDefaults": {
    "exclude": [
      "/wp-content/themes/custom-theme"
    ]
  }
}
```
