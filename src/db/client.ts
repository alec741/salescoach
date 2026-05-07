import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const hasDatabase = Boolean(process.env.DATABASE_URL);

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const sql = neon(process.env.DATABASE_URL);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof getDb>;
