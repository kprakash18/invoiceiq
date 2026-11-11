# InvoiceIQ native Render deployment

The Blueprint uses a Vite Static Site, a native Node Web Service that supervises
the API and BullMQ worker as separate processes, a native Python extraction Web
Service, Render PostgreSQL, Render Key Value, and a 10 GB backend disk mounted at
`/app/storage`. Docker remains for local development only.

## Blueprint values

Create the Blueprint from the repository root using `render.yaml`. The services
and database use the Oregon region. Set the prompted environment values:

- `VITE_API_URL`: public backend URL ending in `/api`.
- `FRONTEND_URL`: public frontend origin (comma-separated origins are accepted).
- `GEMINI_API_KEY`: extraction service secret.

The backend gets `DATABASE_URL` and `REDIS_URL` from private Render connections.
`EXTRACTION_SERVICE_URL` uses the extraction service's private `hostport`; the
backend adds `http://`. The browser must use the API's public URL.

## One-time initialization for the brand-new production database

Use these steps only for a newly created, empty Render PostgreSQL database. The
current `backend/prisma/schema.prisma` is authoritative. This initialization
uses `db push` and the configured `prisma/seed.js`; it does not execute the
historical migration directory.

The Prisma 7 config reads `DATABASE_URL` for CLI operations. The seed creates
its Prisma Client with `PrismaPg` using that same variable. The normal Render
build runs `npm run build`, which generates Prisma Client.

The API recovers queued jobs during startup, so it cannot remain healthy until
the tables exist. The committed Blueprint intentionally has no database setup
command. After creating the Blueprint resources, the first API start will fail
health checks against the empty database without changing it. Before enabling
traffic, set this temporary **Pre-Deploy Command** in the backend Web Service
settings and manually trigger one redeploy. It runs from the backend root:

```sh
npx prisma db push && npx prisma db seed && node scripts/verify-seed.js
```

The Render build generates the client before this command. If initializing
outside Render from the `backend` directory, use this exact order:

```sh
npx prisma generate
npx prisma db push
npx prisma db seed
node scripts/verify-seed.js
```

Do not add `--accept-data-loss`. Do not run these commands against a development
or existing database. The verification script expects a fresh database and
checks exactly 3 users, 5 vendors, 6 purchase orders, 6 PO lines, their vendor
and line-item relationships, and zero invoices or processing jobs.

Run the seed once, before the API accepts traffic. The current seed upserts
users, vendors, and purchase orders, but resets seeded PO status to `OPEN` and
deletes/recreates each seeded PO's lines. Do not rerun it after invoices or
allocations exist.

After the initialization deploy succeeds and verification passes, immediately
clear the temporary **Pre-Deploy Command** in Render and save the service
settings before any subsequent deploy. Confirm the saved backend build command
is `npm ci --include=dev && npm run build` and the start command is
`npm run start:render`.

## Normal deployments

Normal builds install dependencies and run `prisma generate` only. Normal starts
run the API and worker supervisor only. They do not run `db push`, `db seed`,
migrations, resets, or database initialization. The committed Blueprint has no
pre-deploy command, and the temporary initialization command must be removed
after the initial setup.

Future schema changes require a separate reviewed database-change procedure
with a forward change and rollback plan. Do not add automatic schema sync or
seeding to regular build or start commands.

## Runtime paths and health

The backend's `STORAGE_DIR` points uploads, temporary files, retries, and
processing reads to `/app/storage`; local runs default to `backend/storage`.
The extraction build installs `tesseract-ocr` and `tesseract-ocr-eng` for the
existing `pytesseract` implementation, then installs `requirements.txt`.

Render health checks are `/api/health` for the backend and `/health` for the
extraction service. The static site rewrites client routes to `/index.html`.
