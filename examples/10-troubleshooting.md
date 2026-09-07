# 10 - Troubleshooting

## `Config file not found: .noduscm.json`

Estás fuera del directorio del proyecto o no corriste `noduscm init`.

## `Neither Docker nor Podman found`

Instala Docker o Podman y verifica que el binario esté en `PATH`.

## `SSH connection failed`

Revisa:

- host/puerto/usuario
- ruta de private key
- permisos de la key
- acceso al host remoto

## `wp-content folder not found` en existing project

`init` en modo existing exige `wp-content/` en la carpeta actual.

## Pull con errores de modo

No combines modos de `pull`; usa un solo flag de modo por ejecución.

## DB no lista después de `up`

Espera unos segundos adicionales y vuelve a probar. El contenedor MySQL puede tardar en inicializar.

## Los mounts no aparecen en contenedor

1. Verifica entradas en `mounts` dentro de `.noduscm.json`
2. Regenera compose:

```bash
noduscm generate
```

3. Reinicia contenedores:

```bash
noduscm down
noduscm up
```

## Problemas de certificados HTTPS

### `Connection refused` en puerto 8443

Verifica que `localHttps: true` esté en `.noduscm.json` y que `mkcert` esté instalado:

```bash
which mkcert
```

### Certificado no confiable en el navegador

1. Verifica que `./certs/local.crt` exista en el proyecto.
2. Regenera certificados:

```bash
rm -rf certs/
noduscm up
```

### `/etc/hosts` no actualizado

Si `autoManageHosts: true` pero el dominio no resuelve:

```bash
grep "my-domain.localhost" /etc/hosts
noduscm generate
noduscm up
```

## Migración rápida `80/443` → `8080/8443`

Si vienes de una configuración vieja con puertos privilegiados, actualiza `.noduscm.json`:

```json
{
  "localHttps": true,
  "localApachePort": 8080,
  "localHttpsPort": 8443,
  "localMysqlPort": 3306,
  "autoManageHosts": true
}
```

Luego aplica cambios:

```bash
noduscm down
noduscm generate
noduscm up
```

Abre el sitio con dominio y puerto HTTPS, por ejemplo:

```text
https://my-project.localhost:8443
```
