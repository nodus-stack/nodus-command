# `noduscm up --tunnel` (ngrok) — Design

Target version: **1.4.0** (minor bump).

## Goal

Expose the local WordPress site through an ngrok tunnel with one flag, and keep WordPress working behind it (correct `WP_HOME` / `WP_SITEURL`, HTTPS detection, no redirect back to the local URL).

## Scope

In (v1):
- `noduscm up --tunnel` — starts an ngrok tunnel to the local Apache HTTP port.
- `noduscm up --tunnel-url <url>` — same, with a fixed ngrok domain (paid plan). Implies `--tunnel`. Also readable from `tunnel.url` in `.noduscm.json`; the flag wins.
- Rewrite `WP_HOME` / `WP_SITEURL` in `wordpress/wp-config.php` for the tunnel and restore them afterwards.
- Apache HTTP→HTTPS redirect must not fire for tunnel traffic.

Out (deferred, YAGNI):
- cloudflared and Microsoft devtunnel. A `PROVIDERS` map with a single `ngrok` entry keeps the door open.
- Passing arbitrary extra provider args (`tunnel.args`).
- Search-replace of absolute URLs stored in the database.

## CLI

```
noduscm up --tunnel
noduscm up --tunnel-url https://my-site.ngrok.app
```

- `--tunnel-url` must be an `https://` URL; otherwise fail fast before starting anything.
- Without `--tunnel`/`--tunnel-url`, `up` behaves as today (plus the state-file restore below).

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/lib/tunnel.js` | `startTunnel({ provider, port, url })` → `{ url, stop() }`. Spawns the binary with `execa`, discovers the public URL, cleans up. Holds `PROVIDERS`. | execa |
| `applyWpUrl(wpConfigPath, url)` in `src/lib/wordpress.js` | Rewrites only the URL block of `wp-config.php`. | fs-extra |
| `generateWpConfig` (existing) | Emits the URL block with markers. | — |
| `buildApacheHttpRedirectBlock` in `src/lib/templates.js` (existing) | Skips the redirect when `X-Forwarded-Proto` is `https`. | — |
| `src/commands/up.js` + `bin/noduscm.js` (existing) | Flags, orchestration, signal handling. | above |
| `src/commands/down.js` (existing) | Restores the local URL if a stale `.noduscm/tunnel.json` exists. | `applyWpUrl` |

## ngrok provider

- Command: `ngrok http <localApachePort> [--url <url>] --log=stdout --log-format=json`.
- Local ngrok is 3.39.5; its `http` command takes `--url https://…` (the older `--domain` is not used).
- URL discovery: parse the JSON log from stdout for the `started tunnel` line and read its `url`. This avoids polling `127.0.0.1:4040`, which is wrong when another ngrok agent already owns that port.
- **First implementation task:** run a real ngrok and record the exact log line; the parser is written against that capture, not against memory.
- Always use the URL ngrok reports as the source of truth (also with `--tunnel-url`); the explicit URL is only passed to ngrok.
- Timeout: 30 s without a URL → kill the process, fail with the last stderr line.
- Binary not found → error with install hint (`https://ngrok.com/download`). Auth error from ngrok → surface its message unchanged.

Target port is a published Apache HTTP port, bypassing Traefik (the tunnel `Host` header would not match the Traefik router rule and returns 404, and ngrok v3 has no `--host-header` flag).

Resolved during planning: only two compose variants publish Apache today (`docker-compose-windows.yml` and `docker-compose-podman-simple.yml`, via `localApachePort`). The Traefik variants (`docker-compose.yml`, `docker-compose-remote-db.yml`) do not, and `localApachePort` (default 8080) would collide with the Traefik dashboard on 8080. Rule: use `localApachePort` when the selected variant already publishes it; otherwise publish a dedicated port **8088** (`8088:80`) on the Apache service, and only when `up` runs with a tunnel. `up` already regenerates the compose file on every run, so toggling the flag recreates the Apache container.

## wp-config.php

`generateWpConfig` emits:

```php
// nodus:url-start
define( 'WP_HOME', '<url>' );
define( 'WP_SITEURL', '<url>' );
// nodus:url-end
if ( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && 'https' === $_SERVER['HTTP_X_FORWARDED_PROTO'] ) {
    $_SERVER['HTTPS'] = 'on';
}
```

- `applyWpUrl` replaces only the lines between the markers; salts and everything else stay untouched (regenerating the whole file would change salts and log everyone out).
- Legacy `wp-config.php` without markers: fallback regex on the two `define` lines, inserting the markers on the first rewrite. The forwarded-proto snippet is inserted if missing.
- Idempotent: applying the same URL twice yields an identical file.

## Apache

Add `RewriteCond %{HTTP:X-Forwarded-Proto} !https` before the existing redirect `RewriteRule`. Harmless without a tunnel.

## Lifecycle

1. Existing `up` flow runs (hosts, certs, compose, containers, MySQL checks).
2. Start the tunnel; write `.noduscm/tunnel.json` (`{ url, startedAt }`); `applyWpUrl(..., publicUrl)`.
3. Print public URL and `<url>/wp-admin`; stay in the foreground.
4. On SIGINT/SIGTERM, or if ngrok exits unexpectedly: stop the tunnel, `applyWpUrl(..., localUrl)` (via `getLocalSiteUrl`), delete the state file. Containers stay up. Unexpected ngrok exit ends with exit code 1.
5. Crash safety: if the process was SIGKILLed, the state file survives. The next `up` or `down` (with or without `--tunnel`) sees it, restores the local URL and deletes it. Without a state file, plain `up` never touches `wp-config.php`, so hand-edited URLs are not overwritten.

## Known limits

- Absolute URLs stored in the DB (post content, options like `siteurl` when the constants are absent) stay local; the constants cover WordPress core only.
- ngrok free plan shows an interstitial page on the first visit and allows a single agent session.
- Windows is not covered by end-to-end testing.

## Testing (vitest)

- `tunnel.js`: log-line parsing from the captured real ngrok output; timeout and binary-missing paths with a mocked spawn.
- `applyWpUrl`: block replacement, idempotency, legacy fallback, restore, salts untouched.
- `templates`: redirect contains the `X-Forwarded-Proto` condition.
- `up` flag validation (`--tunnel-url` must be `https://`).
- Manual end-to-end with the real ngrok (free URL and the paid fixed URL).

## Documentation and release

- Update `README.md` and the bilingual `examples/` (ES + EN, including `examples/03-up-generate-down*` and `CHEATSHEET.md`), plus `CHANGELOG.md`.
- Version 1.4.0 via `npm version minor` when requested. Commits and pushes are made by the maintainer.
