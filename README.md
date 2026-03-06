# Tiny Server for My Blog

This small Node server serves the static site and exposes a simple JSON API to persist posts in `posts.json`.

Install and run:

```bash
npm install
npm start
```

Open in your browser:

http://localhost:3000/blog.html

- `GET /api/posts` returns the posts array.
- `POST /api/posts` accepts JSON { title, excerpt, body, author?, tags? } and saves to `posts.json`.

 - `POST /api/posts` accepts JSON { title, excerpt, body, author?, tags?, password } and saves to `posts.json` (requires publish password).
 - `POST /api/posts` accepts JSON { title, excerpt, body, author?, tags?, password } and saves to `posts.json` (requires publish password).

Pages:
- `/blog.html` — public blog view. It shows posts and includes a "Show last 30 days only" checkbox (checked by default).
- `/admin.html` — publishing page (admin). Use this to create new posts; the server requires the publish password.

Pruning / retention
- The server now prunes posts older than 30 days on startup, after each publish, and once daily. Pruned posts are moved to `posts-archive.json` rather than deleted.

Uniqueness rules for publishing
- The server enforces simple uniqueness rules to avoid duplicates:
	- Only one post is allowed per calendar day (UTC). Attempts to publish a second post on the same day will be rejected.
	- Posts with the same title (case-insensitive) or identical body content are rejected as duplicates.

If you prefer different rules (e.g., allow multiple posts per day but prevent exact duplicates only), tell me and I can adjust the server behavior.

Process management
- pm2: install `pm2` (global) and use the included `ecosystem.config.js`:

```bash
# install pm2 globally if you want it system-wide
npm install -g pm2
npm run start:pm2
```

- systemd: a sample `server.service` file is included. To run as a systemd service copy it to `/etc/systemd/system/server.service`, edit the `User` and `Environment` as needed (set `PUBLISH_PASSWORD`), then enable and start:

```bash
sudo cp server.service /etc/systemd/system/myblog.service
# edit /etc/systemd/system/myblog.service to set Environment or use an EnvironmentFile
sudo systemctl daemon-reload
sudo systemctl enable --now myblog.service
sudo journalctl -u myblog.service -f
```

Notes:
- Pruning moves older posts to `posts-archive.json`. If you prefer automatic deletion instead, I can change that behavior.
- For production, consider stronger auth (API keys, sessions) and backups before pruning.
Publish protection
- The server supports a simple publish password. Set the environment variable `PUBLISH_PASSWORD` before running the server.
	If not set, a default password of `secret` will be used (change this for anything public).

Example (set password and start):

```bash
export PUBLISH_PASSWORD="your-strong-password"
npm start
```

This is a minimal setup for local development. For production/public hosting consider using a managed backend or Git-backed workflow.

Admin management
- Use `/admin.html` to publish, edit, and delete posts. Editing and deleting require the publish password.
- Deleting a post moves it to `posts-archive.json` so it can be recovered.

Admin logs and archive
- The admin UI now includes an "Archived posts" section where you can restore archived posts back into the live `posts.json` list.
- The admin UI also exposes an activity log (most recent actions). Actions recorded: `publish`, `edit`, `delete`, `restore`, `prune`.
- Admin endpoints accept either a publish password in the request body (`password`) or a bearer token via `Authorization: Bearer <token>` when `ADMIN_TOKEN` is set. To use the token, set the `ADMIN_TOKEN` environment variable before starting the server.

Security note
- This setup is intentionally small and uses a single shared secret (password or token). For production, consider stronger user management and HTTPS.
