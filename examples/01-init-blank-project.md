# 01 - Nuevo proyecto desde cero

## Cuándo usar este flujo

Cuando quieres crear un proyecto WordPress limpio en una carpeta nueva y levantarlo rápido.

## Comando

```bash
noduscm init
```

## Qué hace internamente

- Detecta engine (`podman` o `docker`)
- Pregunta nombre, dominio, tipo de proyecto, versión de WordPress
- Configura base de datos local o remota
- (Opcional) configura SSH para sincronizaciones futuras
- Descarga WordPress (`wordpress/`)
- Prepara `wp-content/` limpio
- Genera:
  - `wp-config.php`
  - `docker-compose.yml`
  - `apache.conf`
  - `Dockerfile.apache`
  - `.noduscm.json`
- Crea `.noduscm/backups/`

## Ejemplo completo

```bash
mkdir my-site && cd my-site
noduscm init
noduscm up
```

## Resultado esperado

- Sitio local en `https://my-site.localhost:8443` (HTTPS automático)
- Admin en `https://my-site.localhost:8443/wp-admin`
- Certificados de confianza local en `./certs/`
- Dominio añadido automáticamente a `/etc/hosts`

## Tips

- Usa dominio `*.localhost` en el prompt de init
- HTTPS se habilita automáticamente por defecto
- Los certificados se generan con mkcert (de confianza local)
- Si planeas sync remoto luego, configura SSH durante init
