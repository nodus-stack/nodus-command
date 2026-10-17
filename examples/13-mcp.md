# 13) Agentes de IA con `noduscm mcp`

`noduscm mcp` levanta un servidor MCP **local** para que Claude Code, Claude Desktop o tu propia interfaz de agentes gestionen tus proyectos de NodusCommand. Pueden arrancarlos y detenerlos, correr WP-CLI, traer datos de producción, hacer backups y leer los logs.

Si prefieres usar el conector de Nodus en la nube (`mcp.nodusproject.dev`, el mismo de claude.ai), usa `noduscm connect` (abajo): Claude podrá diseñar en tus sitios locales y usar estas mismas herramientas.

## Conectar

### Claude Code

```bash
claude mcp add noduscm -- noduscm mcp --root ~/WorkspacePHP
```

### Claude Desktop

En `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "noduscm": { "command": "noduscm", "args": ["mcp", "--root", "/home/tu-usuario/WorkspacePHP"] }
  }
}
```

### Tu interfaz de agentes (HTTP local)

```bash
NODUSCM_MCP_TOKEN=un-token-largo noduscm mcp --http 7337 --cors http://localhost:5173
```

- **URL:** `http://127.0.0.1:7337/mcp` (Streamable HTTP, sin estado).
- **Autenticación:** encabezado `Authorization: Bearer un-token-largo`. Si no defines token, se genera uno y se imprime al arrancar.
- **Red:** solo escucha en `127.0.0.1` y rechaza otros `Host`.
- **Navegador:** `--cors` habilita un origen concreto, por si la interfaz llama desde el navegador.

## Opciones

| Opción | Uso |
| --- | --- |
| `--root <dir>` | Busca proyectos (`.noduscm.json`) bajo esa carpeta, hasta 2 niveles. Se puede repetir. |
| `--http [puerto]` | HTTP local en lugar de stdio (puerto 7337 por defecto). |
| `--token <token>` | Token para `--http`. También sirve `NODUSCM_MCP_TOKEN`. |
| `--cors <origen>` | Origen web permitido para `--http`. Se puede repetir. |
| `--allow-exec` | Activa `container_exec` y `wp shell` / `wp eval-file`, que ejecutan comandos arbitrarios. |

Además, `noduscm init` y `noduscm up` guardan cada proyecto en `~/.config/noduscm/projects.json`.

## Herramientas

| Tool | Qué hace |
| --- | --- |
| `list_projects`, `register_project` | Proyectos del equipo |
| `project_info`, `project_status` | Config sin contraseñas, URLs, contenedores |
| `project_up`, `project_down` | `noduscm up` / `down` |
| `project_logs` | Logs de Apache (errores PHP) o MySQL |
| `wp_cli` | WP-CLI dentro del contenedor (`["plugin","list"]`) |
| `project_pull` | `noduscm pull` (all, db, files, uploads, paths, modo contenedor) |
| `project_backup`, `list_backups`, `restore_backup` | Backups de la DB local |
| `import_db` | `noduscm import-db` |
| `project_generate`, `project_rebootstrap` | Regenerar archivos Docker o `wordpress/` y `wp-content/` |
| `project_remove` | `noduscm remove` |
| `container_exec` | Comando de shell en el contenedor (solo con `--allow-exec`) |

## Seguridad

- **Nada pide contraseña ni sudo.** El servidor ejecuta los comandos con `NODUSCM_NON_INTERACTIVE=1`. Si hace falta tocar `/etc/hosts` o correr `mkcert -install`, lo dice en la salida y tienes que hacerlo una vez desde tu terminal.
- **Confirmación.** Lo que borra o reemplaza datos locales exige `confirm = slug` del proyecto: traer la DB, restaurar un backup, `import_db` con `force`, `rebootstrap --force` y `remove`.
- **Contraseñas.** `project_info` nunca devuelve las de la DB ni las de SSH.

## Conector en la nube: `noduscm connect`

Conecta tu equipo al conector de Nodus para que Claude (claude.ai, Claude Desktop o el móvil) trabaje con tus sitios locales. La conexión es **saliente** (WebSocket): no se abre ningún puerto en tu equipo.

```bash
# 1. En https://mcp.nodusproject.dev/connect → "Generar código de equipo" (vale 10 min, un uso)
# 2. Empareja una vez y déjalo corriendo
noduscm connect --code NCM-XXXX-XXXX --root ~/WorkspacePHP
# Las siguientes veces basta con:
noduscm connect
```

| Opción | Para qué |
| --- | --- |
| `--server <url>` | Otro conector (por defecto el guardado o `https://mcp.nodusproject.dev`) |
| `--name <nombre>` | Nombre del equipo en Claude (por defecto el hostname) |
| `--root <dir>` | Carpetas donde buscar proyectos (repetible) |
| `--allow-exec` | Igual que en `noduscm mcp` |
| `--no-confirm-publish` | No preguntar en la terminal antes de subir a la rama de producción |
| `--reset` | Olvida el emparejamiento y vuelve a emparejar |

Las credenciales quedan en `~/.config/noduscm/device.json` (permisos 600). Para revocar el equipo, quítalo en `/connect`.

El conector solo puede llamar a las URLs locales de tus proyectos registrados (`*.localhost` siempre va a 127.0.0.1); nada más de tu red.

### Flujo local → producción con Git

1. Monta el clon de tu tema en el proyecto (`mounts` en `.noduscm.json`, ver `07-custom-mounts.md`) y levántalo (`noduscm up`).
2. En Claude: *"vincula mi sitio local"* → `link_local_site`. El sitio aparece como `local-…` y funcionan todas las tools de diseño y el preview.
3. Diseña y revisa el preview. Al guardar, los archivos del tema cambian en tu clon.
4. Cuando lo apruebes, Claude revisa la rama conectada en producción (`jet.repos_list`) y ejecuta `git_publish`:
   - `mode: "direct"`: commit y merge a esa rama (en un worktree temporal si estás en otra rama) y push.
   - `mode: "pr"`: rama de trabajo + PR hacia la rama conectada (con `gh`; si no está, te da la URL). `merge_pr: true` lo mergea.
5. En producción, `jet.repo_pull` (Nodus Jet) trae los cambios.

| Tool | Qué hace |
| --- | --- |
| `project_repos` | Repos Git montados en el proyecto (temas/plugins) |
| `git_status` | Rama, cambios, ahead/behind |
| `git_publish` | Commit + publicar en la rama conectada (direct o PR) |
| `site_pair_code` | Código para vincular el sitio local al conector (lo usa `link_local_site`) |

**Confirmación en tu terminal.** Antes de subir algo a la rama de producción (`git_publish` en modo `direct`, o `pr` con `merge_pr`), `noduscm connect` muestra el proyecto, la rama, el mensaje y los archivos, y espera `y`/`s`. Si respondes otra cosa o pasan 10 minutos, no se hace commit ni push. Así, aunque Claude rellene `confirm`, nada llega a producción sin que lo aceptes tú. Si `connect` corre sin terminal (servicio), se rechaza: usa `--no-confirm-publish` solo si sabes lo que haces.

Git usa tus credenciales (SSH o el helper de credenciales); no se guardan en el conector. Por seguridad, Git corre sin hooks y se niega a operar si el `.git/config` del repo tiene claves que ejecutan programas.
