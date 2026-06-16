/**
 * Global vitest setup.
 *
 * The legacy Postgres/Knex test harness (a global migrate/truncate lifecycle
 * against a real Postgres test database) was removed in the multi-tenant
 * migration. DB-backed suites now spin up an isolated in-memory SQLite/Drizzle
 * instance per suite via `./test-utils/db` (createTestDb), which mirrors the D1
 * runtime without external services.
 */
export {}
