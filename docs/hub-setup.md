# Hub setup (outlet PC)

The desktop runs the outlet's server itself, on a PostgreSQL 18 that ships inside the app. Nothing else
has to be installed. An external PostgreSQL (Docker or a manual install) is still supported for IT
who want the database outside the app.

## Option A — Bundled database (default)

1. Run the installer. It also installs the Microsoft Visual C++ runtime the database needs.
2. Open the app. On first run it asks for the database port, user and password (defaults: port
   `5433`, user `postgres`, a generated password). Keep the defaults unless another program already
   uses the port.
3. The app creates the database and starts it. It listens on this PC only (127.0.0.1); tablets talk to
   the desktop's API, never to Postgres.

The database runs while the app is open and stops when it quits. Its data is kept in
`%ProgramData%\POS D4\pg18` and survives app updates and uninstall; deleting it is a separate, explicit
step.

Exclude `%ProgramData%\POS D4\pg18` and `postgres.exe` from antivirus scanning; a scanner locking data
files can stop the database.

To connect with `psql` (support only, while the app is open):

```
"%LOCALAPPDATA%\Programs\POS D4\resources\pg\bin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d pos_hub
```

## Option B — Docker Desktop (external database)

1. Install Docker Desktop for Windows and enable "Start Docker Desktop when you sign in".
2. Copy `docker-compose.yml` (shipped in the app's `hub` folder) to a folder such as `C:\pos-hub`.
3. Set the password and port before the first start. Next to `docker-compose.yml`, create `.env`:
   ```
   POSTGRES_PASSWORD=<strong password>
   PG_PORT=5432
   ```
   then in that folder run:
   ```
   docker compose up -d
   ```
4. In the app, choose an external database and fill: Host `127.0.0.1`, Port (`PG_PORT`), Database
   `pos_hub`, User `postgres`, Password (`POSTGRES_PASSWORD`). Press **Tes koneksi**, then
   **Simpan & hubungkan**.

`POSTGRES_PASSWORD` only applies when the database is first created. To change it later:

```
docker compose exec postgres psql -U postgres -c "ALTER ROLE postgres PASSWORD '<new password>'"
```

then enter the new password in the app. To change the port, edit `PG_PORT`, run `docker compose up -d`
again (data is kept) and update the port in the app.

The database listens on this PC only (127.0.0.1) by design. `restart: unless-stopped` brings it back
after a reboot once Docker Desktop has started. If the desktop opens first it shows
"Database tidak terhubung" and retries every 5 seconds on its own.

## Option C — Manual PostgreSQL install (external database)

1. Install PostgreSQL 18 from postgresql.org. Remember the `postgres` password; keep port 5432.
2. In Services (`services.msc`), set **postgresql-x64-18** to Startup type **Automatic**.
3. Create the database (Command Prompt, from `C:\Program Files\PostgreSQL\18\bin`):
   ```
   createdb -U postgres pos_hub
   ```
4. Fill the app's external database screen as in Option B.

## Tablets on the outlet network

Tablets reach the hub over the Wi-Fi: Windows Firewall must allow it and the network must be Private.
See [hub-network-windows.md](hub-network-windows.md).

## Changing the API port

The local server listens on port 3333. To change it, quit the app, edit `apiPort` in
`%APPDATA%\POS D4\hub.json`, and start the app again. Tablets must then use the new port, and the
firewall rule must follow it (see [hub-network-windows.md](hub-network-windows.md)).

## Logs

Logs are in `%APPDATA%\POS D4\logs\`: `api.log` for the server, `pg.log` for the bundled database. If
the server stops more than 3 times in 10 minutes the app shows "Server berhenti berulang kali" with the
log path and a **Buka log** button.

## Troubleshooting

| Message | Check |
| --- | --- |
| Tidak bisa terhubung ke … | Bundled: see `pg.log`, port not taken by another program. External: Docker Desktop running / PostgreSQL service started; host and port correct |
| User atau password salah. | The password chosen on first run (A), in `.env` (B) or during install (C) |
| Database pos_hub belum ada. | Run `createdb -U postgres pos_hub` (C), or `docker compose up -d` created it (B) |
