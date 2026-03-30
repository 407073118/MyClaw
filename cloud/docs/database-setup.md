# MyClaw Cloud Database Setup

This file captures the database configuration steps that power the MyClaw Cloud workspace.

## 1. Target database
- PostgreSQL (defaults to 5432)
- Host `localhost` for the local Docker stack
- ORM: Prisma with schema at `apps/cloud-api/prisma/schema.prisma`

Default connection values use the `myclaw_cloud` database, which can be created via the supplied Docker compose file.

## 2. Key files
- `apps/cloud-api/.env` (runtime configuration)
- `apps/cloud-api/.env.example` (template you can copy to `.env`)
- `infra/docker-compose.yml` (local Postgres service name `myclaw-cloud-postgres`)

If you customize credentials, update the `.env` file and regenerate Prisma client before running the API.

## 3. Required environment variables
```env
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=myclaw_cloud
DB_USER=<your-db-user>
DB_PASSWORD=<your-db-password>
DATABASE_URL=postgresql://<your-db-user>:<your-db-password>@127.0.0.1:5432/myclaw_cloud?schema=public
```

Make sure the `DATABASE_URL` matches the other DB_* values. The default Docker compose file creates `postgres/123456` but you can override them.

## 4. Seeding the database
After Postgres is available, run:
```powershell
pnpm --dir apps/cloud-api prisma:generate
pnpm --dir apps/cloud-api prisma:push
pnpm --dir apps/cloud-api prisma:seed
```

These commands generate the Prisma client, push the current schema to `myclaw_cloud`, and seed hub/install data.

## 5. Docker helper
Use the infra Docker compose for a standalone database:
```powershell
pnpm dev:db
```
If you stop the container, bring it back with `pnpm dev:db`.

## 6. Notes
- The default credentials in `infra/docker-compose.yml` target `myclaw_cloud`.
- Once the database is ready, the API will read the `DATABASE_URL` from `.env` and work with MyClaw-specific tables only.
