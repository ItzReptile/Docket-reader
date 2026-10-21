// Command-line entry point for each pipeline step.
//   bun run fetch   FAA-2026-9178-0001 [--limit 20]
//   bun run group   FAA-2026-9178-0001 [--threshold 0.5]
//   bun run extract FAA-2026-9178-0001 [--model qwen3.5:4b] [--limit 20]
//   bun run merge   FAA-2026-9178-0001 [--threshold 0.88] [--force]
//   bun run memo    FAA-2026-9178-0001 [--include-pending] [--out memos/memo.md]
//   bun run stats   FAA-2026-9178-0001
//   bun run pipeline FAA-2026-9178-0001   (fetch, group, extract, merge in one go)

import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.ts";
import { initSchema, sql } from "./db.ts";
import { fetchComments } from "./pipeline/fetch.ts";
import { groupComments } from "./pipeline/group.ts";
import { extractAll } from "./pipeline/extract.ts";
import { mergeArguments } from "./pipeline/merge.ts";
import { buildMemo } from "./memo.ts";
import { summary } from "./queries.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    limit: { type: "string" },
    model: { type: "string" },
    threshold: { type: "string" },
    force: { type: "boolean" },
    out: { type: "string" },
    "include-pending": { type: "boolean" },
    "skip-list": { type: "boolean" },
  },
});

const [command, documentId] = positionals;
const limit = values.limit ? Number(values.limit) : undefined;
const threshold = values.threshold ? Number(values.threshold) : undefined;
const model = values.model ?? config.llmModel;

function needDocument(): string {
  if (!documentId) throw new Error(`usage: bun run ${command} <document id>, e.g. FAA-2026-9178-0001`);
  return documentId;
}

try {
  switch (command) {
    case "db:init":
      await initSchema();
      console.log("schema ready");
      break;
    case "fetch":
      await initSchema();
      await fetchComments(needDocument(), { limit, skipList: values["skip-list"] });
      break;
    case "group":
      await groupComments(needDocument(), threshold);
      break;
    case "extract":
      await extractAll(needDocument(), { model, limit });
      break;
    case "merge":
      await mergeArguments(needDocument(), { model, threshold, force: values.force });
      break;
    case "memo": {
      const { markdown, check } = await buildMemo(needDocument(), model, { includePending: values["include-pending"] });
      const out = values.out ?? `memos/${documentId}.md`;
      await mkdir(dirname(out), { recursive: true });
      await Bun.write(out, markdown);
      console.log(`wrote ${out}`);
      console.log(`  ${check.citedIds} comment IDs cited, ${check.unknownIds.length} not found in the database`);
      console.log(`  ${check.quotesChecked} quotes re-checked, ${check.quotesFailed.length} failed`);
      if (check.unknownIds.length || check.quotesFailed.length) process.exitCode = 1;
      break;
    }
    case "pipeline": {
      const id = needDocument();
      await initSchema();
      await fetchComments(id, { limit });
      await groupComments(id);
      await extractAll(id, { model });
      await mergeArguments(id, { model });
      console.log(`done. Review it with "bun run api" + "bun run web", or "bun run build && bun start".`);
      break;
    }
    case "stats":
      console.log(JSON.stringify(await summary(needDocument(), model), null, 2));
      break;
    default:
      console.log("commands: db:init, fetch, group, extract, merge, memo, stats, pipeline");
      process.exitCode = 1;
  }
} finally {
  await sql.close();
}
