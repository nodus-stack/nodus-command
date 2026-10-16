# 13) Agentes de IA con `noduscm mcp`

`noduscm mcp` levanta un servidor MCP **local** para que Claude Code, Claude Desktop o tu propia interfaz de agentes gestionen tus proyectos de NodusCommand. Pueden arrancarlos y detenerlos, correr WP-CLI, traer datos de producción, hacer backups y leer los logs.

El conector remoto de Nodus (`mcp.nodusproject.dev`) no puede entrar a tu equipo. Para los sitios locales se usa este servidor; para los sitios en producción, el conector remoto.

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
