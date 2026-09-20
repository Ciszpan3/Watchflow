import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { env } from "./config/env.js";

if (!env.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const db = new PrismaClient({ adapter });

export async function assertUtf8Database() {
  const rows = await db.$queryRaw<Array<{ encoding: string }>>`
    SELECT pg_encoding_to_char(encoding) AS encoding
    FROM pg_database
    WHERE datname = current_database()
  `;
  const encoding = rows[0]?.encoding;
  if (encoding !== "UTF8") {
    throw new Error(`DATABASE_URL must point to a UTF8 PostgreSQL database. Current encoding: ${encoding ?? "unknown"}`);
  }
}
