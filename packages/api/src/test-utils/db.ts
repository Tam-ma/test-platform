import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle/migrations',
)

export interface TestDbHandle {
  /** Drizzle client typed as a D1 database so services accept it unchanged. */
  db: DrizzleD1Database<typeof schema>
  /** Underlying better-sqlite3 handle, for raw assertions if needed. */
  raw: Database.Database
  close: () => void
}

/**
 * Creates an isolated in-memory SQLite database with the full Drizzle schema
 * applied via the same migration SQL used for D1. The returned client is cast to
 * the D1 database type — the Drizzle query API is identical across the SQLite and
 * D1 drivers for the CRUD operations the services use, so this exercises real SQL
 * without needing miniflare or a remote D1 binding.
 */
export function createTestDb(): TestDbHandle {
  const raw = new Database(':memory:')
  raw.pragma('foreign_keys = ON')
  const db = drizzle(raw, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return {
    db: db as unknown as DrizzleD1Database<typeof schema>,
    raw,
    close: () => raw.close(),
  }
}
