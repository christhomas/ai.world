# Self-hosting with Docker Compose

This runs the published game server and tools portal on one Docker host. It does not require
Kubernetes. The Compose file stores server data in a named Docker volume and reads the tools login
settings from a local `.env` file.

## Start the server

Install Docker with the Compose plugin, then from a fresh checkout:

```sh
cp .env.example .env
chmod 600 .env
openssl rand -hex 32       # copy this value into TOOLS_SECRET
openssl rand -base64 24    # copy this value into TOOLS_ADMIN_PASSWORD
```

Edit `.env`: choose `TOOLS_ADMIN_USER`, paste the two generated values, and leave
`AI_WORLD_BIND=127.0.0.1` and `TRUST_PROXY=0` when a reverse proxy runs on this host. The portal
rejects an initial password shorter than twelve characters. Do not commit `.env`; it contains the
portal signing key and bootstrap password.

Start it and check the container health:

```sh
docker compose up -d
docker compose ps
docker compose logs world
```

The image serves the game and server on port 8787. With a proxy on the Docker host, point it at
`http://127.0.0.1:8787`, configure it to redirect HTTP to HTTPS, preserve the original scheme in
`X-Forwarded-Proto`, and allow WebSocket upgrades. Then set `TRUST_PROXY=1` in `.env` and run
`docker compose up -d` again. Only enable this when the proxy is trusted and overwrites forwarded
headers; otherwise a client could spoof the scheme used for secure login cookies. If the proxy is
another container, put both services on a private Compose network and proxy to `world:8787` rather
than publishing the port to the host.

Open `https://your-host/tools/` to sign in. The first account is created once, on the first start
with an empty account database, from `TOOLS_ADMIN_USER` and `TOOLS_ADMIN_PASSWORD`. Those variables
do not reset an account after it exists; the account and sessions are stored in SQLite under
`/data/ai-world.sqlite`. Keep `TOOLS_SECRET` unchanged: it signs session cookies, and changing it
invalidates existing logins. If the signing key changes, sign in again. The game page is at `/` on
the same origin.

`AI_WORLD_TAG=latest` follows the image published from `main`. For controlled upgrades, set it to a
published release version, for example `AI_WORLD_TAG=0.102.5`, then run `docker compose pull` and
`docker compose up -d`. To build the image from the checkout instead, run `docker build -t ai-world:local .`
and set `image: ai-world:local` in `compose.yaml` before starting Compose.

## Data, backups and restore

The `ai-world-data` volume mounted at `/data` holds the named-world records, per-world server state,
and SQLite database for tools accounts, sessions and other durable server data. Compose leaves this
volume in place when a container is recreated or when you run `docker compose down`. Do not use
`docker compose down --volumes` unless you intend to delete it.

The game client's solo saves are different: they live in that browser's IndexedDB, under the
website origin. They are not copied to the Docker host, shared with another browser, or included in
the server volume backup. The server volume contains multiplayer/shared server state and tools
accounts. Back up browser saves separately using the browser or device that owns them.

For a consistent server backup, stop the single server process while archiving the volume. Store a
private copy of `.env` separately; it is not in the volume. Keep the backup directory outside the
source checkout so a later `git add .` cannot stage the copied credentials. Set
`AI_WORLD_BACKUP_DIR` if you want a different private location:

```sh
docker compose stop world
backup_dir="${AI_WORLD_BACKUP_DIR:-$HOME/ai-world-backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
cp -p .env "$backup_dir/.env-$backup_stamp"
docker run --rm \
  -v ai-world-data:/data:ro \
  -v "$backup_dir:/backup" \
  alpine:3.21 \
  sh -c "tar -czf /backup/ai-world-data-$backup_stamp.tgz -C /data ."
docker compose start world
```

To restore an archive, preserve a backup of the current volume first. The commands below remove the
Compose container, recreate the named volume, and restore its contents:

```sh
docker compose down
backup_dir="${AI_WORLD_BACKUP_DIR:-$HOME/ai-world-backups}"
docker volume rm ai-world-data
docker volume create ai-world-data
docker run --rm \
  -v ai-world-data:/data \
  -v "$backup_dir:/backup:ro" \
  alpine:3.21 \
  tar -xzf /backup/ai-world-data-YYYYMMDDTHHMMSSZ.tgz -C /data
cp -p "$backup_dir/.env-YYYYMMDDTHHMMSSZ" .env
chmod 600 .env
docker compose up -d
```

Use the same timestamp for the archive and `.env` copy. Restore the matching private `.env`
as well so the tools signing key and proxy setting stay the same. Keep backups and `.env` access
restricted: together they contain the server's durable state and the credentials used to protect
the tools portal.
