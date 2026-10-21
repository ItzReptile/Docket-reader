// Pick the comments to hand-label for the eval.
//   bun run eval:sample FAA-2026-9178-0001 [--n 30] [--seed 7] [--force]
//
// Draws a seeded random sample of distinct texts (group representatives), so
// form letters count once, like the pipeline sees them. Writes eval/labels.json
// with empty labels; fill them in on the "Eval labels" tab of the review UI.

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { sql } from "../src/db.ts";
import { LABELS_PATH, type LabelFile } from "./labels.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { n: { type: "string", default: "30" }, seed: { type: "string", default: "7" }, force: { type: "boolean" } },
});
const documentId = positionals[0];
if (!documentId) throw new Error("usage: bun run eval:sample <document id>");
if (existsSync(LABELS_PATH) && !values.force) {
  throw new Error("eval/labels.json already exists; pass --force to replace it (this discards labels)");
}

// Small seeded PRNG (mulberry32) so the same seed gives the same sample.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// At least 10 words, so there is something to label.
const pool: { comment_id: string }[] = await sql`
  select g.representative_id as comment_id
  from comment_groups g join comments c on c.comment_id = g.representative_id
  where g.document_id = ${documentId} and array_length(regexp_split_to_array(trim(c.body), '[[:space:]]+'), 1) >= 10
  order by g.representative_id`;
await sql.close();

const random = rng(Number(values.seed));
const ids = pool.map((r) => r.comment_id);
for (let i = ids.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
}
const picked = ids.slice(0, Number(values.n)).sort();

const file: LabelFile = {
  documentId,
  comments: picked.map((commentId) => ({ commentId, stance: null, arguments: [] })),
};
await Bun.write(LABELS_PATH, JSON.stringify(file, null, 2) + "\n");
console.log(`sampled ${picked.length} of ${pool.length} distinct texts into eval/labels.json (seed ${values.seed})`);
