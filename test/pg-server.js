// In-process Postgres via PGlite exposed as a real TCP server, so Prisma
// connects to it exactly like any other Postgres. No Docker / no daemon.

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export async function startTestPostgres({ port = 55432 } = {}) {
  const db = new PGlite();
  await db.waitReady;

  // Minimal DDL matching prisma/schema.prisma.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "item" (
      "id"         BIGSERIAL PRIMARY KEY,
      "name"       VARCHAR(255) NOT NULL,
      "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "user" (
      "id"            BIGSERIAL PRIMARY KEY,
      "email"         VARCHAR(255) NOT NULL UNIQUE,
      "password_hash" VARCHAR(255) NOT NULL,
      "created_at"    TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();

  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?schema=public`,
    async reset() {
      await db.exec(`TRUNCATE "item", "user" RESTART IDENTITY;`);
    },
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
