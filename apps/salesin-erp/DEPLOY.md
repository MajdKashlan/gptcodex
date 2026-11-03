# Deploying SalesIn (app.hmgtr.com) alongside ERPNext in Docker on a VPS (aaPanel)

## Topology

```
                    VPS (aaPanel)
┌──────────────────────────────────────────────────────────────┐
│  aaPanel nginx  :80 / :443   (owns TLS for both domains)      │
│      ├── erp.hmgtr.com  ──► ERPNext container  (already live) │
│      └── app.hmgtr.com  ──► 127.0.0.1:8081 ─┐                 │
│                                             │                 │
│  salesin-web container  ◄───────────────────┘                 │
│      nginx serves the SPA                                     │
│      and forwards /api,/files,/private,/socket.io ──► ERPNext │
└──────────────────────────────────────────────────────────────┘
```

The app is a **separate container and a separate site**. Your working ERPNext
stack is not modified.

## Why the API is proxied instead of called directly

Both verified against your live server:

1. **`erp.hmgtr.com` returns two `Access-Control-Allow-Origin` headers.** One from
   ERPNext's own `allow_cors` (echoing your origin, so `app.hmgtr.com` is already
   allowed) and one from a hardcoded nginx `add_header` set to
   `http://localhost:4200`. CORS permits exactly one value, so browsers reject the
   response outright.
2. **The session cookie is `SameSite=Lax`** - captured live as
   `sid=Guest; Max-Age=612000; HttpOnly; Path=/; SameSite=Lax`. Browsers never
   attach a Lax cookie to a cross-site fetch, so a direct call would arrive
   unauthenticated and every screen would bounce to `/login`.

Proxying removes both: the browser only ever talks to the app's own origin.

## Step 0 - push your code

The VPS clones from git, so anything uncommitted will not be deployed:

```bash
git add -A && git commit -m "deploy: docker + reverse proxy" && git push
```

## Step 1 - discover how ERPNext is published

Run on the VPS. You need the host port (or network name) that serves ERPNext:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
docker network ls
```

Look for the ERPNext web/frontend container and the host port it maps, commonly
`8080`. Note the container name and network name too - they enable the fastest
option in Step 3.

## Step 2 - get the source onto the VPS

Only source is needed. `node_modules` and `dist` are excluded by `.dockerignore`,
and the image builds the app itself, so the VPS needs **no Node.js**.

```bash
cd /www/wwwroot
git clone https://github.com/MajdKashlan/gptcodex.git
cd gptcodex/apps/salesin-erp
```

### Keep it in its own directory

`docker compose` derives the project name from the directory. This app lives in
its own folder precisely so `docker compose up` here can never touch your ERPNext
containers. Do **not** copy this compose file into the ERPNext stack's folder.

## Step 3 - choose the upstream

Set `ERPNEXT_UPSTREAM` in `docker-compose.yml`. It is rendered at container start,
so changing it needs a restart but **not** a rebuild.

| Value | When to use | Notes |
| --- | --- | --- |
| `http://host.docker.internal:8080` | ERPNext's nginx is published on host port 8080 | **Best for a single VPS.** Stays inside the host, no public-IP hairpin. `extra_hosts` is already configured. |
| `https://erp.hmgtr.com` | Default; works from anywhere | Sends traffic out to the public IP and back. Some firewalls block that (NAT hairpin). |
| `http://<container-name>:80` | You attach this service to ERPNext's own Docker network | Fastest, but couples the two stacks - only if you are comfortable sharing a network. |

`ERPNEXT_HOST` must stay `erp.hmgtr.com` whichever you pick: Frappe decides which
site to serve from the `Host` header, so forwarding `app.hmgtr.com` returns
"site not found".

## Step 4 - check the port is free

```bash
ss -ltnp | grep 8081 || echo "8081 is free"
```

If something already uses 8081, change the host side in `docker-compose.yml`
(`"127.0.0.1:8082:80"`) and use that port in Step 6.

## Step 5 - build and start

```bash
docker compose build
docker compose up -d
docker compose logs -f web
```

Building here also sidesteps a local machine that is low on memory - the Angular
compile happens inside the container.

## Step 6 - verify the proxy BEFORE touching TLS

```bash
curl -I http://127.0.0.1:8081/
curl -s http://127.0.0.1:8081/api/method/ping
```

The second command must print `{"message":"pong"}`. That proves the container can
reach ERPNext. Nothing downstream will work until this does - if it fails, revisit
Step 3.

## Step 7 - aaPanel site, reverse proxy, TLS

1. Website -> Add site -> `app.hmgtr.com`, no PHP, no database.
2. SSL -> Let's Encrypt -> issue for `app.hmgtr.com`, then force HTTPS.
3. Reverse proxy -> target `http://127.0.0.1:8081`. aaPanel forwards the original
   URI by default, which is what this config expects.
4. Add **no** CORS headers. Same-origin needs none, and adding them is what broke
   `erp.hmgtr.com`.

## Step 8 - verify in the browser

Sign in at `https://app.hmgtr.com`, then check:

| Check | Expected |
| --- | --- |
| DevTools -> Network | Requests to `https://app.hmgtr.com/api/...`, status 200 |
| Console | **No CORS messages at all** |
| Application -> Cookies | A `sid` cookie exists **for `app.hmgtr.com`** |
| First visit, signed out | Login page directly, with **no** `frappe.auth.get_logged_user` request |
| Hard refresh on `/customers` | Loads instead of 404 |
| Language toggle in the sidebar | Switches the whole app between Arabic (RTL) and English (LTR) |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `curl` to the ping endpoint hangs or returns 502 | Container cannot reach ERPNext. Switch `ERPNEXT_UPSTREAM` to `http://host.docker.internal:8080` |
| Frappe 404 or "site not found" | `Host` header wrong; it must be `erp.hmgtr.com` |
| 404 on `/customers` after refresh | SPA fallback missing; `try_files ... /index.html` is already in the template |
| `sid` cookie stored for `erp.hmgtr.com` instead | Your site sets a cookie domain. Uncomment `proxy_cookie_domain` in `deploy/default.conf.template` |
| Images/avatars broken | Check `/files/` and `/private/` are proxied; `/private/` needs the session cookie |
| Build fails on `npm ci` / `esbuild` | Add `RUN npm rebuild esbuild` after `npm ci` in the build stage |
| `docker compose up` disturbs ERPNext | You ran it from inside the ERPNext stack's directory. Move this project to its own folder |
| Login loops back to the login page | Cookie not stored or not sent - recheck the cookie row in Step 8 |

## Housekeeping on the ERPNext side

Remove the stray `add_header Access-Control-Allow-Origin "http://localhost:4200";`
line from nginx on `erp.hmgtr.com`. It is not blocking now that everything is
same-origin, but it hardcodes a development origin in production and would break
any future cross-origin client.

Also note `public/.htaccess` in this repo is Apache-only and is **ignored** by
nginx, for both the container and aaPanel. SPA routing is handled by `try_files`.

## Alternative: serve at `erp.hmgtr.com/salesin` instead

Serving under a subpath of the ERPNext domain removes the extra proxy hop for
`/api` entirely, but means editing the ERPNext stack's nginx config, which risks
the working site. If you want it, build with `ng build --base-href /salesin/` and
prefix the nginx `location` blocks to match. Ask and I will prepare it.
