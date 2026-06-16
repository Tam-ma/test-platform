# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**AIBaaS (AI Benchmarking as a Service)** — a platform that benchmarks AI models on code tasks across 7 languages and 7 scenarios, scored by a multi-judge pipeline (automated + staff + users + self-review + an 8-model judge panel). It is the `test-platform` sub-project of the larger **Tamma** project. Most of `docs/` is design/research; the running code lives in `packages/`.

## Repository layout

Two packages, one stack each (the legacy Postgres/Knex/Express root backend was removed — there is no `src/` at the repo root):

| Path | Stack |
|------|-------|
| `packages/api` (`name: api`) | **Hono on Cloudflare Workers**, Drizzle ORM, **D1 (SQLite)**, Wrangler, Vitest |
| `packages/web` (`@tamma/web`) | **Next.js 15 App Router**, React 19, React Query, Tailwind, axios |

This is **not** an npm-workspaces monorepo — each package has its own `node_modules`, `package-lock.json`, and scripts. The root `package.json` only orchestrates (its scripts `cd` into the packages). Ignore the stale `packages/api/packages/web/` artifact if present.

## Commands

```bash
# Root (delegates to packages)
npm run dev          # api + web concurrently (dev:api / dev:web)
npm run build        # cd packages/web && next build
npm test             # cd packages/api && vitest

# API — cd packages/api
npm run dev          # wrangler dev on port 3187
npm test             # vitest (runs once under CI=true; locally it watches)
npx vitest run                         # run once
npx vitest run src/auth/permissions.test.ts   # single file
npx vitest run -t "owner"              # single test by name
npm run db:generate  # drizzle-kit generate (schema -> drizzle/migrations)
npm run db:migrate   # wrangler d1 migrations apply aibaas --local
npm run deploy       # wrangler deploy --minify
npm run cf-typegen   # regenerate Cloudflare binding types

# Web — cd packages/web
npm run dev          # next dev on port 3100
npm run type-check   # tsc --noEmit
npm test             # jest + RTL  (single: npx jest -t "renders")
```

**Ports:** api `3187`, web `3100`. Check a port is free before assuming a server is up; don't kill/restart running services without being asked.

**Note:** `packages/api` is not type-checked in CI (vitest/wrangler use esbuild, which strips types without checking). Validate the Worker bundles with `npx wrangler deploy --dry-run`.

## Architecture

### API (`packages/api`)
- Entry `src/index.ts`: one root Hono `app`. A global middleware builds the Drizzle client per request (`drizzle(c.env.DB, { schema })`) onto `c.get('db')`. Routes mounted: `/auth`, `/api-keys`, `/models`, `/organizations`.
- `Env` bindings: `DB` (D1), `KV`, `JWT_SECRET`, `RESEND_API_KEY?`, `ENVIRONMENT` (`wrangler.jsonc`).
- Layers are `routes/ → services/ → db/schema.ts` (no controllers layer). Auth is JWT via `@tsndr/cloudflare-worker-jwt` (`utils/jwt.ts`); passwords are SHA-256 in `utils/crypto.ts`. Email via Resend (`email.service.ts`; needs `RESEND_API_KEY` — a missing key disables sending, it is never hardcoded).

### Multi-tenancy + RBAC (the model everything hangs off)
- **Every user belongs to ≥1 organization.** Registration auto-creates a personal org (owner membership). The access token carries `activeOrgId`; `POST /organizations/switch` re-mints it.
- **Request pipeline:** `requireAuth` (`middleware/auth.middleware.ts`, sets `user`) → `loadOrgContext` (`middleware/org-context.ts`, resolves+verifies the active org, sets `userId`/`activeOrgId`/`orgRole`/`systemRole`) → `requireRole` / `requireMinimumRole` / `requirePermission` guards.
- **Roles/permissions** live in `src/auth/`: `permissions.ts` (5 roles — platform `super_admin` + per-org owner/admin/member/viewer — and a ~50-permission catalog with `ROLE_PERMISSIONS`/`ROLE_HIERARCHY`); `authorization.ts` resolves effective permissions. Pure, no DB.
- **Org-owned resources** carry `organizationId` and are scoped to the active org: `apiKeys`, `userModelConfigs`, `modelUsage`. `OrganizationService`/`MembershipService` manage orgs + membership. `db/backfill-orgs.ts` backfills personal orgs for pre-existing users.

### Data model (`src/db/schema.ts`, Drizzle/SQLite)
Tenancy/auth: `users` (incl. `systemRole`), `organizations`, `userOrganizations`, `verificationTokens`, `passwordResetTokens`, `apiKeys`, `apiKeyUsage`.
Benchmarking: `testBank` → `benchmarkRuns` → `benchmarkResults`, scored across `staffReviews`/`userReviews`/`judgeReviews`. Models: `llmModels`, `userModelConfigs`, `modelUsage`. Plus `systemConfig`. Final score weights: **40% automated / 25% staff / 20% user / 7.5% self / 7.5% judge** (`docs/BENCHMARKING-METHODOLOGY.md`).

### Benchmark engine (`src/services/benchmark/`)
The core product domain, but still **scaffold**: real multi-provider model calls, yet Node/CLI-only (shells out, uses `fs`/`child_process`), not mounted as an HTTP route, and parts of scoring are stubbed. Don't assume it runs inside the Worker.

### Web (`packages/web`)
Next.js App Router under `src/app/` (auth pages, `dashboard/`, `settings/api-keys/`); React Query providers; `AuthContext`. API calls go through `src/lib/api-client.ts` (axios, base `NEXT_PUBLIC_API_URL || http://localhost:3187`) and `src/services/*.service.ts`. Note there are still multiple axios setups (`lib/api.ts`, `lib/api-client.ts`, `services/api.ts`) — consolidating them is a known follow-up.

## Testing (API)
DB-backed suites use an **in-memory SQLite** harness, `src/test-utils/db.ts#createTestDb()`: it applies the real `drizzle/migrations` to a fresh better-sqlite3 database and returns the Drizzle client cast to the D1 type, so services run against real SQL with no miniflare/D1. Pure-logic suites (permissions, authorization) need no DB.

## Story-driven workflow (BMAD)
Work is planned as numbered epics/stories. Before building a feature, check whether a story defines it.
- `docs/epics.md` + `docs/PRD.md` + `docs/ARCHITECTURE.md` define scope; `docs/stories/epic-N/story-N-M/` holds per-story specs + `*.context.xml`.
- `docs/sprint-status.yaml` tracks story status (`backlog → drafted → ready-for-dev → in-progress → review → done`) — note it tracks *process stage*, not implementation (stories can read "ready-for-dev" while the code exists).
- `.github/workflows/create-story.yml` (+ `.github/scripts/create-story.ts`) scaffolds stories; `.github/chatmodes/*.chatmode.md` are BMAD agent personas. `config.yaml` is BMAD config (its paths reference an older absolute path).

## Gotchas
- **D1 migrations:** edit `db/schema.ts`, then `npm run db:generate`; apply with wrangler. Never hand-edit an applied migration. The same generated SQL is what the test harness applies.
- **Multi-tenant scoping:** org-owned queries scope by the **active org** (`c.get('activeOrgId')`), not `userId` — `userId` is just the creator. To act on a different org, switch to it.
- **Model-config endpoints** are authenticated + org-aware but their queries are still user-scoped (org-scoping them is a noted follow-up).
- **Zod v4** and **TypeScript 6** — APIs differ from older majors; verify against installed versions.
