import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Database seam.
 *
 * Local-first is the default: a plain Postgres connection through the `pg`
 * adapter. Hosted Neon remains available explicitly through
 * DATABASE_DRIVER=neon. A placeholder URL keeps `next build` and the Prisma
 * client importable without a live database; queries still fail loudly.
 */
function createPrismaClient(): PrismaClient {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://doable:doable@127.0.0.1:5432/doable";

  const adapter =
    process.env.DATABASE_DRIVER === "neon"
      ? new PrismaNeon({ connectionString })
      : new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}