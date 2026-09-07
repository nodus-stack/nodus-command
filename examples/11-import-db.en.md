# 11 - Import database from a `.sql` file

Useful when the hosting provider does not allow SSH key generation or direct `mysqldump` access, but does allow exporting the database from their control panel.

## Basic usage

```bash
noduscm import-db /path/to/backup.sql
```

## Typical workflow

1. Download the `.sql` from your hosting panel (cPanel, Plesk, etc.)
2. Run the command pointing to the downloaded file:

```bash
noduscm import-db ~/Downloads/db_backup.sql
```

3. The file is copied into the MySQL container and imported automatically.

## What it does internally

```
1. Validates the file exists and ends in .sql
2. docker/podman cp <file> <slug>-mysql:/tmp/noduscm-import.sql
3. Strips USE, CREATE DATABASE and DROP DATABASE from the dump
4. mysql -u<user> -p<pass> <db> < /tmp/noduscm-import.sql
5. Cleans up the temp file from the container
```

## Why it strips USE / CREATE DATABASE

Hosting dumps usually include:

```sql
CREATE DATABASE IF NOT EXISTS `dbs12876357`;
USE `dbs12876357`;
```

Those statements would cause an `Access denied` error because the local user only has permissions on the local database, not the remote name. NodusCommand strips them automatically before importing.

## Notes

- The project must be running (`noduscm up`) before importing.
- If the database already has data, it will be replaced by the dump contents.
