import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

/**
 * Prisma 7 configuration.
 *
 * The datasource URL lives here rather than in `schema.prisma` because Prisma 7
 * moved connection configuration out of the schema. This file is consumed by the
 * Prisma CLI (`migrate`, `studio`, `db seed`); the application itself builds its
 * client from the adapter in `src/config/database.ts`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})