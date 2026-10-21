// Step 3 + 4 over the whole docket: run the extractor on every group
// representative that doesn't have a result for this model yet.

import { sql } from "../db.ts";
import { chatModel } from "../llm/index.ts";
import { extractComment, type RuleInfo } from "../extract.ts";

export async function ruleInfo(documentId: string): Promise<RuleInfo> {
  const [doc] = await sql`select document_id, agency_id, title, summary from documents where document_id = ${documentId}`;
  if (!doc) throw new Error(`${documentId} is not in the database. Run fetch first.`);
  return { documentId: doc.document_id, agencyId: doc.agency_id, title: doc.title, summary: doc.summary };
}

export async function extractAll(documentId: string, opts: { model?: string; limit?: number } = {}) {
  const llm = chatModel(opts.model);
  const rule = await ruleInfo(documentId);

  // Biggest form-letter groups first: they cover the most commenters.
  const todo: { comment_id: string; body: string; size: number }[] = await sql`
    select g.representative_id as comment_id, c.body, g.size
    from comment_groups g join comments c on c.comment_id = g.representative_id
    where g.document_id = ${documentId}
      and not exists (select 1 from extractions e where e.comment_id = g.representative_id and e.model = ${llm.model})
    order by g.size desc, g.representative_id
    limit ${opts.limit ?? 1_000_000}`;
  console.log(`extracting ${todo.length} comments with ${llm.model}`);

  let n = 0;
  let quotes = 0;
  let verified = 0;
  try {
    for (const { comment_id, body } of todo) {
      n++;
      let result;
      try {
        result = await extractComment(llm, rule, comment_id, body);
      } catch (err) {
        console.warn(`  ${comment_id}: ${(err as Error).message}`);
        continue;
      }
      const status = result.claims.length === 0 ? "empty" : result.claims.every((c) => c.quoteOk) ? "ok" : "flagged";
      await sql.begin(async (tx) => {
        await tx`delete from claims where comment_id = ${comment_id} and model = ${llm.model}`;
        for (const c of result.claims) {
          await tx`
            insert into claims (comment_id, model, argument, quote, quote_ok, quote_error, quote_start, quote_end)
            values (${comment_id}, ${llm.model}, ${c.argument}, ${c.quote}, ${c.quoteOk}, ${c.quoteError ?? null}, ${c.start ?? null}, ${c.end ?? null})`;
        }
        await tx`
          insert into extractions (comment_id, model, stance, status, llm_calls, seconds)
          values (${comment_id}, ${llm.model}, ${result.stance}, ${status}, ${result.llmCalls}, ${result.seconds})
          on conflict (comment_id, model) do update set
            stance = excluded.stance, status = excluded.status, llm_calls = excluded.llm_calls,
            seconds = excluded.seconds, created_at = now()`;
      });
      quotes += result.claims.length;
      verified += result.claims.filter((c) => c.quoteOk).length;
      const flag = status === "flagged" ? "  FLAGGED" : "";
      console.log(
        `  [${n}/${todo.length}] ${comment_id} ${result.stance.padEnd(7)} ${result.claims.length} args ` +
          `${result.seconds.toFixed(1)}s${flag}`,
      );
    }
  } finally {
    await llm.unload?.();
  }
  if (quotes) console.log(`quote check: ${verified}/${quotes} quotes verified (${((100 * verified) / quotes).toFixed(1)}%)`);
}
