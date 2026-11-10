import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";

export function getDb() {
  const sql = neon(getEnv().DATABASE_URL);
  return drizzle(sql, { schema });
}
