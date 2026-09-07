# 03 - Levantar, regenerar y detener entorno

## `noduscm up`

```bash
noduscm up
```

### Qué hace

- Si `localHttps: true`, genera certificados HTTPS de confianza local con mkcert
- Agrega automáticamente el dominio a `/etc/hosts` si `autoManageHosts: true`

### Flujo con HTTPS
## `noduscm generate`
```bash
noduscm up

# Primeras ejecuciones pueden solicitar autenticación para mkcert
# First runs may request authentication for mkcert
# ? NodusCommand needs to trust a local CA (mkcert -install). Continue? Yes

# Certificados generados en ./certs/
# Certificates generated in ./certs/
# URLs con HTTPS disponibles en el output
# HTTPS URLs available in the output
```

```bash
noduscm generate
```

### Cuándo usarlo

Cuando editaste `.noduscm.json` (mounts, DB, dominio, etc.) y quieres regenerar archivos sin levantar contenedores todavía.

### Archivos generados

- `docker-compose.yml`
- `apache.conf`
- `Dockerfile.apache`

## `noduscm down`

```bash
noduscm down
```

Detiene el entorno (`compose down`) sin borrar el proyecto.

## Flujo típico

```bash
noduscm generate
noduscm up
# trabajo normal...
noduscm down
```
