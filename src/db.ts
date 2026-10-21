import { SQL } from "bun";
import { config } from "./config.ts";

// Bun ships a Postgres client, so there is no driver dependency.
// Use it as a tagged template: await sql`select * from comments where comment_id = ${id}`
export const sql = new SQL(config.databaseUrl);

export async function initSchema() {
  const schema = await Bun.file(new URL("../db/schema.sql", import.meta.url)).text();
  await sql.unsafe(schema);
}
